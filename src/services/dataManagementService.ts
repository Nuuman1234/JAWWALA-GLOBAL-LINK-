import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  LGA_DEFINITIONS,
  PuOperationalStatus,
  VerificationStatus,
  canManageTestData,
  type AgentCheckIn,
  type AggregatedResult,
  type ApprovedPuResult,
  type DeletionTombstone,
  type GeneratedReportRecord,
  type IncidentReport,
  type LgaId,
  type NotificationItem,
  type OperationalNote,
  type OperationalTask,
  type PollingUnit,
  type ReportAttachment,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
} from '../types/fdmis';
import { applyAggregationDelta, computeAggregationDelta } from '../utils/aggregationEngine';
import { toValidDocId } from './officialDirectory';
import { mergeServerTombstones, purgeDeletedRecordsEverywhere } from './offlineQueue';

function requireAuthUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated user session required.');
  return uid;
}

export function observeReportAttachments(
  user: UserAccount,
  onData: (attachments: ReportAttachment[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  if (!canManageTestData(user.role)) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, 'report_attachments'),
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ReportAttachment, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'report_attachments');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/**
 * Observes server-authoritative deletion tombstones across all active clients (Web & Android APK)
 * and immediately reconciles local IndexedDB caches/queues so permanently deleted records
 * NEVER reappear after reload, reconnection, or offline sync.
 */
export function observeDeletionTombstones(
  onData: (tombstones: DeletionTombstone[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'deletion_tombstones'),
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<DeletionTombstone, 'id'>),
      }));
      const ids = items.map((t) => t.recordId || t.id).filter(Boolean);
      if (ids.length > 0) {
        void mergeServerTombstones(ids);
      }
      onData(items);
    },
    (error) => {
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  );
}

export async function fetchServerTombstoneIdSet(): Promise<Set<string>> {
  try {
    const snap = await getDocs(collection(db, 'deletion_tombstones'));
    const ids = new Set<string>();
    snap.docs.forEach((d) => {
      ids.add(d.id);
      const recId = d.data()?.recordId;
      if (typeof recId === 'string' && recId) ids.add(recId);
    });
    return ids;
  } catch {
    return new Set<string>();
  }
}

export async function writeServerDeletionTombstones(
  actor: UserAccount,
  entries: Array<{ recordId: string; collectionName: string }>,
  reason: string
): Promise<void> {
  const uid = requireAuthUid();
  if (!canManageTestData(actor.role) || entries.length === 0) return;

  const deduped = new Map<string, string>();
  entries.forEach((e) => {
    if (e.recordId && e.recordId.trim()) {
      deduped.set(e.recordId.trim(), e.collectionName);
    }
  });

  const rows = Array.from(deduped.entries());
  const nowIso = new Date().toISOString();
  const CHUNK = 350;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = writeBatch(db);
    rows.slice(i, i + CHUNK).forEach(([recordId, collectionName]) => {
      const docId = toValidDocId(recordId);
      batch.set(doc(db, 'deletion_tombstones', docId), {
        recordId: recordId.slice(0, 128),
        collectionName: collectionName.slice(0, 64),
        deletedByUid: uid,
        deletedByEmail: actor.email.slice(0, 200),
        reason: reason.slice(0, 240),
        deletedAtIso: nowIso,
        createdAt: serverTimestamp(),
      });
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'deletion_tombstones');
    }
  }
}

export interface TestDeletionSelection {
  resultSubmissionIds: string[];
  approvedPuResultIds: string[];
  incidentIds: string[];
  checkInIds: string[];
  notificationIds: string[];
  timelineEventIds: string[];
  reportAttachmentIds: string[];
  noteIds?: string[];
  taskIds?: string[];
  generatedReportIds?: string[];
}

export interface TestDeletionResult {
  mode: 'SELECTED_TEST_RECORDS' | 'RESET_ALL_TEST_DATA';
  deletedResults: number;
  deletedApprovedResults: number;
  deletedIncidents: number;
  deletedCheckIns: number;
  deletedNotifications: number;
  deletedTimelineEvents: number;
  deletedEvidenceAttachments: number;
  deletedNotes: number;
  deletedTasks: number;
  deletedGeneratedReports: number;
  serverTombstonesWritten: number;
  totalDeleted: number;
  executedAtIso: string;
}

async function commitDeletesInChunks(refs: DocumentReference[], pathLabel: string): Promise<void> {
  if (refs.length === 0) return;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = refs.slice(i, i + CHUNK_SIZE);
    slice.forEach((ref) => batch.delete(ref));
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, pathLabel);
    }
  }
}

export async function deleteSelectedTestData(
  actor: UserAccount,
  selection: TestDeletionSelection,
  context: {
    mode: 'SELECTED_TEST_RECORDS' | 'RESET_ALL_TEST_DATA';
    results: ResultSubmission[];
    approvedPuResults: ApprovedPuResult[];
    incidents: IncidentReport[];
    checkIns: AgentCheckIn[];
    notifications: NotificationItem[];
    timelineEvents: TimelineEvent[];
    attachments: ReportAttachment[];
    notes?: OperationalNote[];
    tasks?: OperationalTask[];
    generatedReports?: GeneratedReportRecord[];
    pollingUnits: PollingUnit[];
  }
): Promise<TestDeletionResult> {
  const uid = requireAuthUid();
  if (!canManageTestData(actor.role)) {
    throw new Error('Only Full Control Admin can manage or delete operational records.');
  }

  const resultIdSet = new Set(selection.resultSubmissionIds);
  const incidentIdSet = new Set(selection.incidentIds);
  const checkInIdSet = new Set(selection.checkInIds);
  const notificationIdSet = new Set(selection.notificationIds);
  const timelineIdSet = new Set(selection.timelineEventIds);
  const noteIdSet = new Set(selection.noteIds || []);
  const taskIdSet = new Set(selection.taskIds || []);
  const generatedReportIdSet = new Set(selection.generatedReportIds || []);

  // Include approved PU results either explicitly selected or derived from deleted submissions
  const approvedIdSet = new Set(selection.approvedPuResultIds);
  context.approvedPuResults.forEach((apr) => {
    if (resultIdSet.has(apr.sourceSubmissionId)) {
      approvedIdSet.add(apr.puId);
    }
  });
  context.results.forEach((res) => {
    if (resultIdSet.has(res.id)) {
      const linkedApproved = context.approvedPuResults.find(
        (a) => a.puId === res.puId && a.sourceSubmissionId === res.id
      );
      if (linkedApproved) approvedIdSet.add(linkedApproved.puId);
    }
  });

  // Also check Firestore directly for any approved_pu_results referencing deleted submissions
  if (resultIdSet.size > 0) {
    try {
      const aprSnap = await getDocs(collection(db, 'approved_pu_results'));
      aprSnap.docs.forEach((d) => {
        const src = String(d.data()?.sourceSubmissionId || '');
        if (resultIdSet.has(src)) {
          approvedIdSet.add(d.id);
        }
      });
    } catch {
      // Fallback cleanly to memory context
    }
  }

  const deletedPuIds = new Set<string>(approvedIdSet);
  context.results.forEach((r) => {
    if (resultIdSet.has(r.id)) deletedPuIds.add(r.puId);
  });
  context.incidents.forEach((i) => {
    if (incidentIdSet.has(i.id)) deletedPuIds.add(i.puId);
  });
  context.checkIns.forEach((c) => {
    if (checkInIdSet.has(c.id)) deletedPuIds.add(c.puId);
  });

  // Include evidence attachments either explicitly selected or linked to deleted results/incidents/check-ins
  const attachmentIdSet = new Set(selection.reportAttachmentIds);
  context.attachments.forEach((att) => {
    if (
      resultIdSet.has(att.reportId) ||
      incidentIdSet.has(att.reportId) ||
      checkInIdSet.has(att.reportId)
    ) {
      attachmentIdSet.add(att.id);
    }
  });
  if (resultIdSet.size > 0 || incidentIdSet.size > 0 || checkInIdSet.size > 0) {
    try {
      const attSnap = await getDocs(collection(db, 'report_attachments'));
      attSnap.docs.forEach((d) => {
        const reportId = String(d.data()?.reportId || '');
        if (
          resultIdSet.has(reportId) ||
          incidentIdSet.has(reportId) ||
          checkInIdSet.has(reportId)
        ) {
          attachmentIdSet.add(d.id);
        }
      });
    } catch {
      // Fallback cleanly
    }
  }

  if (context.mode === 'RESET_ALL_TEST_DATA') {
    context.timelineEvents.forEach((ev) => {
      if (ev.isTestData || (ev.puId && deletedPuIds.has(ev.puId))) {
        timelineIdSet.add(ev.id);
      }
    });
    context.notifications.forEach((n) => {
      if (n.isTestData) notificationIdSet.add(n.id);
    });
    (context.notes || []).forEach((n) => {
      if (n.isTestData) noteIdSet.add(n.clientNoteId || n.id);
    });
    (context.tasks || []).forEach((t) => {
      if (t.isTestData) taskIdSet.add(t.id);
    });
  }

  const totalRequested =
    resultIdSet.size +
    approvedIdSet.size +
    incidentIdSet.size +
    checkInIdSet.size +
    notificationIdSet.size +
    timelineIdSet.size +
    attachmentIdSet.size +
    noteIdSet.size +
    taskIdSet.size +
    generatedReportIdSet.size;

  if (totalRequested === 0) {
    throw new Error('Select at least one record before confirming permanent deletion.');
  }

  // 1. Atomically reverse approved_pu_results, public_results, and aggregated_results deltas
  let deletedApprovedCount = 0;
  for (const puId of approvedIdSet) {
    const approvedRef = doc(db, 'approved_pu_results', puId);
    const publicRef = doc(db, 'public_results', puId);

    try {
      await runTransaction(db, async (tx) => {
        const approvedSnap = await tx.get(approvedRef);
        if (!approvedSnap.exists()) return;

        const existingApproved = {
          id: approvedSnap.id,
          ...(approvedSnap.data() as Omit<ApprovedPuResult, 'id'>),
        };
        const delta = computeAggregationDelta(existingApproved, null);

        const wardAggId = `ward_${existingApproved.wardId}`;
        const lgaAggId = `lga_${existingApproved.lgaId}`;
        const constAggId = 'constituency_all';

        const wardAggRef = doc(db, 'aggregated_results', wardAggId);
        const lgaAggRef = doc(db, 'aggregated_results', lgaAggId);
        const constAggRef = doc(db, 'aggregated_results', constAggId);
        const [publicSnap, wardAggSnap, lgaAggSnap, constAggSnap] = await Promise.all([
          tx.get(publicRef),
          tx.get(wardAggRef),
          tx.get(lgaAggRef),
          tx.get(constAggRef),
        ]);

        tx.delete(approvedRef);
        if (publicSnap.exists()) tx.delete(publicRef);

        if (wardAggSnap.exists()) {
          const existingWardAgg = {
            id: wardAggId,
            ...(wardAggSnap.data() as Omit<AggregatedResult, 'id'>),
          };
          const nextWardAgg = applyAggregationDelta(
            existingWardAgg,
            {
              id: wardAggId,
              scopeType: 'WARD',
              scopeId: existingApproved.wardId,
              lgaId: existingApproved.lgaId,
              wardId: existingApproved.wardId,
              label: existingApproved.wardName,
              actorUid: uid,
            },
            delta
          );
          if (nextWardAgg.verifiedPuCount <= 0 && nextWardAgg.totalVotesCast <= 0) {
            tx.delete(wardAggRef);
          } else {
            tx.set(wardAggRef, { ...nextWardAgg, updatedAt: serverTimestamp() });
          }
        }

        if (lgaAggSnap.exists()) {
          const existingLgaAgg = {
            id: lgaAggId,
            ...(lgaAggSnap.data() as Omit<AggregatedResult, 'id'>),
          };
          const nextLgaAgg = applyAggregationDelta(
            existingLgaAgg,
            {
              id: lgaAggId,
              scopeType: 'LGA',
              scopeId: existingApproved.lgaId,
              lgaId: existingApproved.lgaId,
              wardId: '',
              label: LGA_DEFINITIONS[existingApproved.lgaId]?.displayName || existingApproved.lgaId,
              actorUid: uid,
            },
            delta
          );
          if (nextLgaAgg.verifiedPuCount <= 0 && nextLgaAgg.totalVotesCast <= 0) {
            tx.delete(lgaAggRef);
          } else {
            tx.set(lgaAggRef, { ...nextLgaAgg, updatedAt: serverTimestamp() });
          }
        }

        if (constAggSnap.exists()) {
          const existingConstAgg = {
            id: constAggId,
            ...(constAggSnap.data() as Omit<AggregatedResult, 'id'>),
          };
          const nextConstAgg = applyAggregationDelta(
            existingConstAgg,
            {
              id: constAggId,
              scopeType: 'CONSTITUENCY',
              scopeId: 'all',
              lgaId: 'all',
              wardId: '',
              label: 'Funtua–Dandume Federal Constituency',
              actorUid: uid,
            },
            delta
          );
          if (nextConstAgg.verifiedPuCount <= 0 && nextConstAgg.totalVotesCast <= 0) {
            tx.delete(constAggRef);
          } else {
            tx.set(constAggRef, { ...nextConstAgg, updatedAt: serverTimestamp() });
          }
        }

        deletedApprovedCount += 1;
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `approved_pu_results/${puId}`);
    }
  }

  // 2. Delete result_submissions + history subcollections
  const resultDeleteRefs: DocumentReference[] = [];
  for (const resId of resultIdSet) {
    try {
      const historySnap = await getDocs(collection(db, 'result_submissions', resId, 'history'));
      await commitDeletesInChunks(
        historySnap.docs.map((d) => d.ref),
        `result_submissions/${resId}/history`
      );
    } catch {
      // Continue cleanly if subcollection empty or unavailable
    }
    resultDeleteRefs.push(doc(db, 'result_submissions', resId));
  }
  await commitDeletesInChunks(resultDeleteRefs, 'result_submissions');

  // 3. Delete incidents + incident history subcollections
  const incidentDeleteRefs: DocumentReference[] = [];
  for (const incId of incidentIdSet) {
    try {
      const histSnap = await getDocs(collection(db, 'incidents', incId, 'history'));
      await commitDeletesInChunks(
        histSnap.docs.map((d) => d.ref),
        `incidents/${incId}/history`
      );
    } catch {
      // Continue cleanly
    }
    incidentDeleteRefs.push(doc(db, 'incidents', incId));
  }
  await commitDeletesInChunks(incidentDeleteRefs, 'incidents');

  // 4. Delete operational_tasks + updates subcollections
  const taskDeleteRefs: DocumentReference[] = [];
  for (const taskId of taskIdSet) {
    try {
      const updSnap = await getDocs(collection(db, 'operational_tasks', taskId, 'updates'));
      await commitDeletesInChunks(
        updSnap.docs.map((d) => d.ref),
        `operational_tasks/${taskId}/updates`
      );
    } catch {
      // Continue cleanly
    }
    taskDeleteRefs.push(doc(db, 'operational_tasks', taskId));
  }
  await commitDeletesInChunks(taskDeleteRefs, 'operational_tasks');

  // 5. Delete check-ins, notifications, timeline events, attachments, notes, and archived reports
  await commitDeletesInChunks(
    Array.from(checkInIdSet).map((id) => doc(db, 'check_ins', id)),
    'check_ins'
  );
  await commitDeletesInChunks(
    Array.from(notificationIdSet).map((id) => doc(db, 'notifications', id)),
    'notifications'
  );
  await commitDeletesInChunks(
    Array.from(timelineIdSet).map((id) => doc(db, 'timeline_events', id)),
    'timeline_events'
  );
  await commitDeletesInChunks(
    Array.from(attachmentIdSet).map((id) => doc(db, 'report_attachments', id)),
    'report_attachments'
  );
  await commitDeletesInChunks(
    Array.from(noteIdSet).map((id) => doc(db, 'operational_notes', id)),
    'operational_notes'
  );
  await commitDeletesInChunks(
    Array.from(generatedReportIdSet).map((id) => doc(db, 'generated_reports', id)),
    'generated_reports'
  );

  // 6. Safely reconcile PU operationalStatus ONLY if all operational records for that PU were removed
  if (deletedPuIds.size > 0) {
    const remainingResultsByPu = new Set(
      context.results.filter((r) => !resultIdSet.has(r.id)).map((r) => r.puId)
    );
    const remainingIncidentsByPu = new Set(
      context.incidents.filter((i) => !incidentIdSet.has(i.id)).map((i) => i.puId)
    );
    const remainingCheckInsByPu = new Set(
      context.checkIns.filter((c) => !checkInIdSet.has(c.id)).map((c) => c.puId)
    );

    const puToReset: PollingUnit[] = [];
    deletedPuIds.forEach((puId) => {
      if (
        !remainingResultsByPu.has(puId) &&
        !remainingIncidentsByPu.has(puId) &&
        !remainingCheckInsByPu.has(puId)
      ) {
        const pu = context.pollingUnits.find((p) => p.id === puId);
        if (pu) puToReset.push(pu);
      }
    });

    const CHUNK = 400;
    for (let i = 0; i < puToReset.length; i += CHUNK) {
      const batch = writeBatch(db);
      puToReset.slice(i, i + CHUNK).forEach((pu) => {
        batch.update(doc(db, 'polling_units', pu.id), {
          operationalStatus: pu.assignedAgentUid
            ? PuOperationalStatus.AGENT_ASSIGNED
            : PuOperationalStatus.NOT_STARTED,
          updatedAt: serverTimestamp(),
        });
      });
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'polling_units');
      }
    }
  }

  // 7. Write SERVER-AUTHORITATIVE deletion_tombstones so deleted records can NEVER resurrect
  // on any browser, Android APK, offline upload queue, or backup restoration
  const tombstoneEntries: Array<{ recordId: string; collectionName: string }> = [];
  resultIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'result_submissions' }));
  approvedIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'approved_pu_results' }));
  incidentIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'incidents' }));
  checkInIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'check_ins' }));
  notificationIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'notifications' }));
  timelineIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'timeline_events' }));
  attachmentIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'report_attachments' }));
  noteIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'operational_notes' }));
  taskIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'operational_tasks' }));
  generatedReportIdSet.forEach((id) => tombstoneEntries.push({ recordId: id, collectionName: 'generated_reports' }));

  context.results.forEach((r) => {
    if (resultIdSet.has(r.id) && r.clientSubmissionId && r.clientSubmissionId !== r.id) {
      tombstoneEntries.push({ recordId: r.clientSubmissionId, collectionName: 'result_submissions' });
    }
  });
  context.incidents.forEach((i) => {
    if (incidentIdSet.has(i.id) && i.clientSubmissionId && i.clientSubmissionId !== i.id) {
      tombstoneEntries.push({ recordId: i.clientSubmissionId, collectionName: 'incidents' });
    }
  });
  context.checkIns.forEach((c) => {
    if (checkInIdSet.has(c.id) && c.clientSubmissionId && c.clientSubmissionId !== c.id) {
      tombstoneEntries.push({ recordId: c.clientSubmissionId, collectionName: 'check_ins' });
    }
  });

  await writeServerDeletionTombstones(
    actor,
    tombstoneEntries,
    context.mode === 'RESET_ALL_TEST_DATA'
      ? 'Full Control Admin operational test data reset'
      : 'Full Control Admin permanent record deletion'
  );

  // 8. Purge local IndexedDB queue, drafts, notes, snapshots, and cached dates immediately
  const allDeletedIds = tombstoneEntries.map((t) => t.recordId);
  await purgeDeletedRecordsEverywhere({
    ids: allDeletedIds,
    puIdsForApproved: Array.from(approvedIdSet),
    wipeAllOperational: context.mode === 'RESET_ALL_TEST_DATA',
  });

  const executedAtIso = new Date().toISOString();
  const totalDeleted =
    resultIdSet.size +
    deletedApprovedCount +
    incidentIdSet.size +
    checkInIdSet.size +
    notificationIdSet.size +
    timelineIdSet.size +
    attachmentIdSet.size +
    noteIdSet.size +
    taskIdSet.size +
    generatedReportIdSet.size;

  const auditAction =
    context.mode === 'RESET_ALL_TEST_DATA' ? 'TEST_DATA_RESET' : 'RECORDS_PERMANENTLY_DELETED';
  const summaryDetails =
    `[${executedAtIso}] Admin ${actor.displayName} (${actor.email}) permanently deleted ${totalDeleted} record(s) ` +
    `(results=${resultIdSet.size}, approved=${deletedApprovedCount}, incidents=${incidentIdSet.size}, ` +
    `checkIns=${checkInIdSet.size}, tasks=${taskIdSet.size}, reports=${generatedReportIdSet.size}, ` +
    `attachments=${attachmentIdSet.size}, notes=${noteIdSet.size}). Server tombstones written=${tombstoneEntries.length}.`;

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: auditAction,
      affectedEntity: 'data_management',
      affectedId: context.mode,
      details: summaryDetails.slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }

  return {
    mode: context.mode,
    deletedResults: resultIdSet.size,
    deletedApprovedResults: deletedApprovedCount,
    deletedIncidents: incidentIdSet.size,
    deletedCheckIns: checkInIdSet.size,
    deletedNotifications: notificationIdSet.size,
    deletedTimelineEvents: timelineIdSet.size,
    deletedEvidenceAttachments: attachmentIdSet.size,
    deletedNotes: noteIdSet.size,
    deletedTasks: taskIdSet.size,
    deletedGeneratedReports: generatedReportIdSet.size,
    serverTombstonesWritten: tombstoneEntries.length,
    totalDeleted,
    executedAtIso,
  };
}

export interface DataIntegrityScanReport {
  scannedAtIso: string;
  duplicateActiveResultGroups: Array<{
    puId: string;
    puCode: string;
    submissionIds: string[];
  }>;
  orphanedAttachmentIds: string[];
  aggregateDriftDetected: boolean;
  aggregateDriftDetails: string[];
  stalePuStatusCount: number;
  serverTombstoneCount: number;
}

/**
 * Scans live Firestore collections for duplicate submissions, orphaned evidence attachments,
 * and aggregate total drift without automatically deleting any valid data.
 */
export async function scanDataIntegrity(
  context: {
    results: ResultSubmission[];
    approvedPuResults: ApprovedPuResult[];
    incidents: IncidentReport[];
    checkIns: AgentCheckIn[];
    attachments: ReportAttachment[];
    pollingUnits: PollingUnit[];
  }
): Promise<DataIntegrityScanReport> {
  const byPu = new Map<string, ResultSubmission[]>();
  context.results.forEach((r) => {
    if (r.verificationStatus === VerificationStatus.REJECTED) return;
    const list = byPu.get(r.puId) || [];
    list.push(r);
    byPu.set(r.puId, list);
  });

  const duplicateActiveResultGroups: DataIntegrityScanReport['duplicateActiveResultGroups'] = [];
  byPu.forEach((list, puId) => {
    if (list.length > 1) {
      duplicateActiveResultGroups.push({
        puId,
        puCode: list[0].puCode,
        submissionIds: list.map((x) => x.id),
      });
    }
  });

  const validReportIds = new Set<string>([
    ...context.results.map((r) => r.id),
    ...context.incidents.map((i) => i.id),
    ...context.checkIns.map((c) => c.id),
  ]);
  const orphanedAttachmentIds = context.attachments
    .filter((att) => !validReportIds.has(att.reportId))
    .map((att) => att.id);

  // Check aggregate drift vs canonical approved_pu_results
  const aggregateDriftDetails: string[] = [];
  try {
    const aggSnap = await getDocs(collection(db, 'aggregated_results'));
    const constDoc = aggSnap.docs.find((d) => d.id === 'constituency_all');
    const canonicalVotes = context.approvedPuResults.reduce((s, r) => s + Number(r.totalVotesCast || 0), 0);
    const canonicalCount = context.approvedPuResults.length;
    if (constDoc) {
      const data = constDoc.data() as Partial<AggregatedResult>;
      if (Number(data.verifiedPuCount || 0) !== canonicalCount || Number(data.totalVotesCast || 0) !== canonicalVotes) {
        aggregateDriftDetails.push(
          `Constituency aggregate shows ${data.verifiedPuCount ?? 0} PU(s) / ${data.totalVotesCast ?? 0} cast votes vs ${canonicalCount} canonical approved PU(s) / ${canonicalVotes} cast votes.`
        );
      }
    } else if (canonicalCount > 0) {
      aggregateDriftDetails.push(
        `Constituency aggregate document is missing while ${canonicalCount} canonical approved PU result(s) exist.`
      );
    }
  } catch {
    // Ignore if unavailable offline
  }

  const activePuOperationalIds = new Set<string>([
    ...context.results.map((r) => r.puId),
    ...context.incidents.map((i) => i.puId),
    ...context.checkIns.map((c) => c.puId),
  ]);
  const stalePuStatusCount = context.pollingUnits.filter(
    (pu) =>
      pu.operationalStatus !== PuOperationalStatus.NOT_STARTED &&
      pu.operationalStatus !== PuOperationalStatus.AGENT_ASSIGNED &&
      !activePuOperationalIds.has(pu.id)
  ).length;

  const serverTombstones = await fetchServerTombstoneIdSet();

  return {
    scannedAtIso: new Date().toISOString(),
    duplicateActiveResultGroups,
    orphanedAttachmentIds,
    aggregateDriftDetected: aggregateDriftDetails.length > 0,
    aggregateDriftDetails,
    stalePuStatusCount,
    serverTombstoneCount: serverTombstones.size,
  };
}

/**
 * Rebuilds aggregated_results strictly from canonical approved_pu_results so totals
 * are 100% mathematically consistent after deletions or repairs. Never deletes valid data.
 */
export async function rebuildAggregatedResultsFromCanonical(
  actor: UserAccount
): Promise<{ rebuiltBuckets: number }> {
  const uid = requireAuthUid();
  if (!canManageTestData(actor.role)) {
    throw new Error('Only Full Control Admin can rebuild aggregated results.');
  }

  const [approvedSnap, existingAggSnap] = await Promise.all([
    getDocs(collection(db, 'approved_pu_results')),
    getDocs(collection(db, 'aggregated_results')),
  ]);

  const approved = approvedSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ApprovedPuResult, 'id'>),
  }));

  const buckets = new Map<string, Omit<AggregatedResult, 'id' | 'updatedAt'>>();

  const addRecordToBucket = (
    bucketId: string,
    meta: { scopeType: 'WARD' | 'LGA' | 'CONSTITUENCY'; scopeId: string; lgaId: string; wardId: string; label: string },
    rec: ApprovedPuResult
  ) => {
    const cur = buckets.get(bucketId) || {
      scopeType: meta.scopeType,
      scopeId: meta.scopeId,
      lgaId: meta.lgaId,
      wardId: meta.wardId,
      label: meta.label,
      verifiedPuCount: 0,
      apcVotes: 0,
      pdpVotes: 0,
      adcVotes: 0,
      othersVotes: 0,
      registeredVoters: 0,
      accreditedVoters: 0,
      validVotes: 0,
      rejectedVotes: 0,
      totalVotesCast: 0,
      updatedByUid: uid,
    };
    cur.verifiedPuCount += 1;
    cur.apcVotes += Number(rec.apcVotes || 0);
    cur.pdpVotes += Number(rec.pdpVotes || 0);
    cur.adcVotes += Number(rec.adcVotes || 0);
    cur.othersVotes += Number(rec.othersVotes || 0);
    cur.registeredVoters += Number(rec.registeredVoters || 0);
    cur.accreditedVoters += Number(rec.accreditedVoters || 0);
    cur.validVotes += Number(rec.validVotes || 0);
    cur.rejectedVotes += Number(rec.rejectedVotes || 0);
    cur.totalVotesCast += Number(rec.totalVotesCast || 0);
    buckets.set(bucketId, cur);
  };

  approved.forEach((rec) => {
    addRecordToBucket(
      `ward_${rec.wardId}`,
      { scopeType: 'WARD', scopeId: rec.wardId, lgaId: rec.lgaId, wardId: rec.wardId, label: rec.wardName },
      rec
    );
    addRecordToBucket(
      `lga_${rec.lgaId}`,
      {
        scopeType: 'LGA',
        scopeId: rec.lgaId,
        lgaId: rec.lgaId,
        wardId: '',
        label: LGA_DEFINITIONS[rec.lgaId as LgaId]?.displayName || rec.lgaId,
      },
      rec
    );
    addRecordToBucket(
      'constituency_all',
      {
        scopeType: 'CONSTITUENCY',
        scopeId: 'all',
        lgaId: 'all',
        wardId: '',
        label: 'Funtua–Dandume Federal Constituency',
      },
      rec
    );
  });

  const batch = writeBatch(db);
  existingAggSnap.docs.forEach((d) => {
    if (!buckets.has(d.id)) {
      batch.delete(d.ref);
    }
  });
  buckets.forEach((val, bucketId) => {
    batch.set(doc(db, 'aggregated_results', bucketId), {
      ...val,
      updatedAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'aggregated_results');
  }

  await setDoc(doc(collection(db, 'audit_logs')), {
    actorUid: uid,
    actorName: actor.displayName.slice(0, 120),
    actorEmail: actor.email.slice(0, 200),
    actorRole: actor.role,
    action: 'AGGREGATES_RECONCILED',
    affectedEntity: 'aggregated_results',
    affectedId: 'constituency_all',
    details: `Reconciled ${buckets.size} aggregate bucket(s) from ${approved.length} canonical approved PU result(s).`,
    createdAt: serverTimestamp(),
  });

  return { rebuiltBuckets: buckets.size };
}
