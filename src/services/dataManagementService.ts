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
  canManageTestData,
  type AgentCheckIn,
  type AggregatedResult,
  type ApprovedPuResult,
  type IncidentReport,
  type NotificationItem,
  type PollingUnit,
  type ReportAttachment,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
} from '../types/fdmis';
import { applyAggregationDelta, computeAggregationDelta } from '../utils/aggregationEngine';

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

export interface TestDeletionSelection {
  resultSubmissionIds: string[];
  approvedPuResultIds: string[];
  incidentIds: string[];
  checkInIds: string[];
  notificationIds: string[];
  timelineEventIds: string[];
  reportAttachmentIds: string[];
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
    pollingUnits: PollingUnit[];
  }
): Promise<TestDeletionResult> {
  const uid = requireAuthUid();
  if (!canManageTestData(actor.role)) {
    throw new Error('Only Full Control Admin can manage or delete test data.');
  }

  const resultIdSet = new Set(selection.resultSubmissionIds);
  const incidentIdSet = new Set(selection.incidentIds);
  const checkInIdSet = new Set(selection.checkInIds);
  const notificationIdSet = new Set(selection.notificationIds);
  const timelineIdSet = new Set(selection.timelineEventIds);

  // Include approved PU results either explicitly selected or derived from deleted test submissions
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

  // Include evidence attachments either explicitly selected or linked to deleted test results/incidents
  const attachmentIdSet = new Set(selection.reportAttachmentIds);
  context.attachments.forEach((att) => {
    if (resultIdSet.has(att.reportId) || incidentIdSet.has(att.reportId)) {
      attachmentIdSet.add(att.id);
    }
  });

  const totalRequested =
    resultIdSet.size +
    approvedIdSet.size +
    incidentIdSet.size +
    checkInIdSet.size +
    notificationIdSet.size +
    timelineIdSet.size +
    attachmentIdSet.size;

  if (totalRequested === 0) {
    throw new Error('Select at least one record before confirming deletion.');
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
        if (publicSnap.exists()) {
          tx.delete(publicRef);
        }

        if (wardAggSnap.exists()) {
          const existingWardAgg = {
            id: wardAggId,
            ...(wardAggSnap.data() as Omit<AggregatedResult, 'id'>),
          };
          tx.set(wardAggRef, {
            ...applyAggregationDelta(
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
            ),
            updatedAt: serverTimestamp(),
          });
        }

        if (lgaAggSnap.exists()) {
          const existingLgaAgg = {
            id: lgaAggId,
            ...(lgaAggSnap.data() as Omit<AggregatedResult, 'id'>),
          };
          tx.set(lgaAggRef, {
            ...applyAggregationDelta(
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
            ),
            updatedAt: serverTimestamp(),
          });
        }

        if (constAggSnap.exists()) {
          const existingConstAgg = {
            id: constAggId,
            ...(constAggSnap.data() as Omit<AggregatedResult, 'id'>),
          };
          tx.set(constAggRef, {
            ...applyAggregationDelta(
              existingConstAgg,
              {
                id: constAggId,
                scopeType: 'CONSTITUENCY',
                scopeId: 'all',
                lgaId: 'all',
                wardId: '',
                label: 'Funtua & Dandume Federal Constituency',
                actorUid: uid,
              },
              delta
            ),
            updatedAt: serverTimestamp(),
          });
        }

        deletedApprovedCount += 1;
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `approved_pu_results/${puId}`);
    }
  }

  // 2. Delete result_submissions + their history subcollection
  const resultDeleteRefs: DocumentReference[] = [];
  for (const resId of resultIdSet) {
    try {
      const historySnap = await getDocs(collection(db, 'result_submissions', resId, 'history'));
      const historyRefs = historySnap.docs.map((d) => d.ref);
      await commitDeletesInChunks(historyRefs, `result_submissions/${resId}/history`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `result_submissions/${resId}/history`);
    }
    resultDeleteRefs.push(doc(db, 'result_submissions', resId));
  }
  await commitDeletesInChunks(resultDeleteRefs, 'result_submissions');

  // 3. Delete incidents, check-ins, notifications, timeline events, and attachments
  await commitDeletesInChunks(
    Array.from(incidentIdSet).map((id) => doc(db, 'incidents', id)),
    'incidents'
  );
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

  // 4. Safely reconcile PU operationalStatus ONLY if all operational records for that PU were removed
  // Never modify PU directory identity, ward, registered voters, or agent assignments.
  const affectedPuIds = new Set<string>();
  context.results.forEach((r) => {
    if (resultIdSet.has(r.id)) affectedPuIds.add(r.puId);
  });
  context.incidents.forEach((i) => {
    if (incidentIdSet.has(i.id)) affectedPuIds.add(i.puId);
  });
  context.checkIns.forEach((c) => {
    if (checkInIdSet.has(c.id)) affectedPuIds.add(c.puId);
  });

  if (affectedPuIds.size > 0) {
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
    affectedPuIds.forEach((puId) => {
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

  const executedAtIso = new Date().toISOString();
  const totalDeleted =
    resultIdSet.size +
    deletedApprovedCount +
    incidentIdSet.size +
    checkInIdSet.size +
    notificationIdSet.size +
    timelineIdSet.size +
    attachmentIdSet.size;

  const auditAction =
    context.mode === 'RESET_ALL_TEST_DATA' ? 'TEST_DATA_RESET' : 'TEST_DATA_SELECTED_DELETED';
  const summaryDetails =
    `[${executedAtIso}] Admin ${actor.displayName} (${actor.email}) deleted ${totalDeleted} test/selected record(s): ` +
    `results=${resultIdSet.size}, approvedResults=${deletedApprovedCount}, incidents=${incidentIdSet.size}, ` +
    `checkIns=${checkInIdSet.size}, notifications=${notificationIdSet.size}, timelineEvents=${timelineIdSet.size}, ` +
    `evidenceAttachments=${attachmentIdSet.size}. Directories, accounts, roles, and settings preserved.`;

  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: auditAction,
      affectedEntity: 'test_data_management',
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
    totalDeleted,
    executedAtIso,
  };
}
