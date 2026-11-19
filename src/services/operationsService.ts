import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { rebuildAndSyncLocationCatalog } from './directoryService';
import {
  IncidentStatus,
  IncidentUrgency,
  LGA_DEFINITIONS,
  PU_STATUS_META,
  PuOperationalStatus,
  UserRole,
  VerificationStatus,
  canApprovePublicResults,
  canCorrectMasterDirectory,
  canReviewIncidents,
  canVerifyResults,
  type AgentCheckIn,
  type AggregatedResult,
  type ApprovedPuResult,
  type IncidentReport,
  type LgaId,
  type NotificationItem,
  type OfflineQueuedItem,
  type OperationalNote,
  type OperationalNoteCategory,
  type PollingUnit,
  type PublicVerifiedResult,
  type ResultHistoryEntry,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  applyAggregationDelta,
  computeAggregationDelta,
  validateResultFigures,
} from '../utils/aggregationEngine';
import { toValidDocId } from './officialDirectory';
import {
  deleteQueueItem,
  generateClientSubmissionId,
  getDeletedTombstones,
  getQueuedItems,
  saveLocalNote,
  updateQueueItemStatus,
} from './offlineQueue';
import {
  syncNoteDeleteToFirestore,
  syncNoteUpsertToFirestore,
} from './notesService';
import {
  createOperationalTask,
  submitOfficerTaskUpdate,
  type OfficerTaskUpdateInput,
} from './taskService';
import { archiveGeneratedReport } from './reportArchiveService';
import type {
  AnalyticsReportFilters,
  CompiledAutomaticReport,
} from '../utils/analyticsReportsEngine';
import type { OperationalTask, TaskPriority } from '../types/fdmis';

function requireAuthUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated user session required.');
  return uid;
}

async function computeEvidenceSha256(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function logAudit(
  actor: UserAccount,
  action: string,
  affectedEntity: string,
  affectedId: string,
  details: string
): Promise<void> {
  try {
    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: actor.uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: action.slice(0, 100),
      affectedEntity: affectedEntity.slice(0, 64),
      affectedId: affectedId.slice(0, 128),
      details: details.slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }
}

async function addTimelineEvent(
  actor: UserAccount,
  event: {
    eventType: string;
    title: string;
    description: string;
    lgaId: string;
    wardId: string;
    puId: string;
    puCode: string;
    isTestData?: boolean;
    deterministicEventId?: string;
  }
): Promise<void> {
  try {
    const ref = event.deterministicEventId
      ? doc(db, 'timeline_events', toValidDocId(event.deterministicEventId))
      : doc(collection(db, 'timeline_events'));
    if (event.deterministicEventId) {
      const existing = await getDoc(ref);
      if (existing.exists()) return;
    }
    await setDoc(ref, {
      eventType: event.eventType.slice(0, 64),
      title: event.title.slice(0, 160),
      description: event.description.slice(0, 600),
      lgaId: event.lgaId.slice(0, 32),
      wardId: event.wardId.slice(0, 128),
      puId: event.puId.slice(0, 128),
      puCode: event.puCode.slice(0, 40),
      actorUid: actor.uid,
      actorName: actor.displayName.slice(0, 120),
      isTestData: Boolean(event.isTestData),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'timeline_events');
  }
}

async function addNotification(
  actor: UserAccount,
  item: {
    title: string;
    body: string;
    type: string;
    targetLgaId: string;
    targetWardId: string;
    isCritical: boolean;
    isTestData?: boolean;
    deterministicNotificationId?: string;
  }
): Promise<void> {
  try {
    const ref = item.deterministicNotificationId
      ? doc(db, 'notifications', toValidDocId(item.deterministicNotificationId))
      : doc(collection(db, 'notifications'));
    if (item.deterministicNotificationId) {
      const existing = await getDoc(ref);
      if (existing.exists()) return;
    }
    await setDoc(ref, {
      title: item.title.slice(0, 160),
      body: item.body.slice(0, 1000),
      type: item.type.slice(0, 64),
      targetLgaId: item.targetLgaId.slice(0, 32),
      targetWardId: item.targetWardId.slice(0, 128),
      isCritical: item.isCritical,
      isTestData: Boolean(item.isTestData),
      createdByUid: actor.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'notifications');
  }
}

function buildAreaScopedQuery(
  collectionName: string,
  user: UserAccount,
  ownerField: string
): Query | null {
  const base = collection(db, collectionName);
  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    return base;
  }
  if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    return query(base, where('lgaId', '==', 'funtua'));
  }
  if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    return query(base, where('lgaId', '==', 'dandume'));
  }
  if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) {
      return query(base, where('wardId', '==', user.assignedWardId));
    }
    if (user.assignedLgaId) {
      return query(base, where('lgaId', '==', user.assignedLgaId));
    }
    return base;
  }
  if (
    (user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER) &&
    user.assignedWardId
  ) {
    return query(base, where('wardId', '==', user.assignedWardId));
  }
  if (user.role === UserRole.POLLING_UNIT_AGENT || user.role === UserRole.ORDINARY_USER) {
    return query(base, where(ownerField, '==', user.uid));
  }
  return null;
}

function toTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function observeCheckIns(
  user: UserAccount,
  onData: (items: AgentCheckIn[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = buildAreaScopedQuery('check_ins', user, 'agentUid');
  if (!q) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AgentCheckIn, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'check_ins');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeIncidents(
  user: UserAccount,
  onData: (items: IncidentReport[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = buildAreaScopedQuery('incidents', user, 'reporterUid');
  if (!q) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<IncidentReport, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'incidents');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeResultSubmissions(
  user: UserAccount,
  onData: (items: ResultSubmission[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = buildAreaScopedQuery('result_submissions', user, 'submittedByUid');
  if (!q) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ResultSubmission, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.updatedAt) - toTimestampMs(a.updatedAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'result_submissions');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeApprovedPuResults(
  user: UserAccount,
  onData: (items: ApprovedPuResult[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'approved_pu_results');
  let q: Query | null = null;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) {
      q = query(base, where('wardId', '==', user.assignedWardId));
    } else if (user.assignedLgaId) {
      q = query(base, where('lgaId', '==', user.assignedLgaId));
    } else {
      q = base;
    }
  } else if (
    (user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER) &&
    user.assignedWardId
  ) {
    q = query(base, where('wardId', '==', user.assignedWardId));
  } else if (user.role === UserRole.POLLING_UNIT_AGENT) {
    q = user.assignedPollingUnitId
      ? query(base, where('puId', '==', user.assignedPollingUnitId))
      : query(base, where('submittedByUid', '==', user.uid));
  }

  if (!q) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ApprovedPuResult, 'id'>) }))
        .sort((a, b) => a.puCode.localeCompare(b.puCode));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'approved_pu_results');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeAggregatedResults(
  user: UserAccount,
  onData: (items: AggregatedResult[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'aggregated_results');
  let q: Query | null = null;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) {
      q = query(base, where('scopeType', '==', 'WARD'), where('wardId', '==', user.assignedWardId));
    } else if (user.assignedLgaId) {
      q = query(base, where('lgaId', '==', user.assignedLgaId));
    } else {
      q = base;
    }
  } else if (
    (user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER) &&
    user.assignedWardId
  ) {
    q = query(base, where('scopeType', '==', 'WARD'), where('wardId', '==', user.assignedWardId));
  }

  if (!q) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AggregatedResult, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'aggregated_results');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observePublicResults(
  onData: (items: PublicVerifiedResult[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = collection(db, 'public_results');
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<PublicVerifiedResult, 'id'>) }))
        .sort((a, b) => a.puCode.localeCompare(b.puCode));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'public_results');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeTimelineEvents(
  user: UserAccount,
  onData: (items: TimelineEvent[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = buildAreaScopedQuery('timeline_events', user, 'actorUid');
  if (!q) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<TimelineEvent, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt))
        .slice(0, 250);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'timeline_events');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeNotifications(
  user: UserAccount,
  onData: (items: NotificationItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'notifications');
  let q: Query;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = query(base, orderBy('createdAt', 'desc'), limit(120));
  } else {
    const lgaTargets = ['all'];
    if (user.assignedLgaId) lgaTargets.push(user.assignedLgaId);
    q = query(base, where('targetLgaId', 'in', lgaTargets));
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
        .filter(
          (n) =>
            user.role === UserRole.FULL_CONTROL_ADMIN ||
            !n.targetWardId ||
            n.targetWardId === user.assignedWardId
        )
        .sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchResultHistory(resultId: string): Promise<ResultHistoryEntry[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'result_submissions', resultId, 'history'),
        orderBy('createdAt', 'desc')
      )
    );
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ResultHistoryEntry, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `result_submissions/${resultId}/history`);
  }
}

export async function submitCheckIn(
  actor: UserAccount,
  pu: PollingUnit,
  input: {
    arrivalTimeText: string;
    comments: string;
    batteryPercent: number;
    networkStatus: string;
    latitude?: number | null;
    longitude?: number | null;
    isTestData?: boolean;
    clientCreatedAtIso?: string;
  },
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();
  const clientSubmissionId =
    existingClientSubmissionId || generateClientSubmissionId('chk');
  const docId = toValidDocId(clientSubmissionId);
  const ref = doc(db, 'check_ins', docId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      return docId;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `check_ins/${docId}`);
  }

  const clientCreatedAtIso = (input.clientCreatedAtIso || new Date().toISOString()).slice(0, 64);

  const payload: Record<string, unknown> = {
    puId: pu.id,
    puCode: pu.puCode.slice(0, 40),
    puName: pu.name.slice(0, 160),
    lgaId: pu.lgaId,
    wardId: pu.wardId,
    agentUid: uid,
    agentName: actor.displayName.slice(0, 120),
    arrivalTimeText: input.arrivalTimeText.trim().slice(0, 64),
    comments: input.comments.trim().slice(0, 500),
    batteryPercent: Math.max(-1, Math.min(100, Math.round(input.batteryPercent))),
    networkStatus: input.networkStatus.trim().slice(0, 64),
    clientSubmissionId: docId,
    clientCreatedAtIso,
    serverSyncedAt: serverTimestamp(),
    isTestData: Boolean(input.isTestData),
    createdAt: serverTimestamp(),
  };
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    payload.latitude = input.latitude;
    payload.longitude = input.longitude;
  }

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `check_ins/${docId}`);
  }

  if (
    pu.operationalStatus === PuOperationalStatus.NOT_STARTED ||
    pu.operationalStatus === PuOperationalStatus.AGENT_ASSIGNED
  ) {
    try {
      await updateDoc(doc(db, 'polling_units', pu.id), {
        operationalStatus: PuOperationalStatus.AGENT_CHECKED_IN,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polling_units/${pu.id}`);
    }
  }

  await addTimelineEvent(actor, {
    eventType: 'AGENT_CHECK_IN',
    title: `Agent Checked In at ${pu.puCode}`,
    description: `${actor.displayName} confirmed presence at ${pu.name} (${input.arrivalTimeText}). ${input.comments}`.trim(),
    lgaId: pu.lgaId,
    wardId: pu.wardId,
    puId: pu.id,
    puCode: pu.puCode,
    isTestData: Boolean(input.isTestData),
  });

  await addNotification(actor, {
    title: `Agent Check-In: ${pu.puCode}`,
    body: `${actor.displayName} checked in at ${pu.name} (${pu.wardName}).`,
    type: 'AGENT_CHECK_IN',
    targetLgaId: pu.lgaId,
    targetWardId: pu.wardId,
    isCritical: false,
    isTestData: Boolean(input.isTestData),
  });

  await logAudit(
    actor,
    'AGENT_CHECK_IN_SUBMITTED',
    'check_ins',
    docId,
    `Agent checked in at ${pu.puCode} (${pu.name}) at ${input.arrivalTimeText}.`
  );

  return docId;
}

export async function updatePollingUnitStatus(
  actor: UserAccount,
  pu: PollingUnit,
  nextStatus: PuOperationalStatus,
  note = '',
  existingClientSubmissionId?: string
): Promise<void> {
  requireAuthUid();
  try {
    await updateDoc(doc(db, 'polling_units', pu.id), {
      operationalStatus: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `polling_units/${pu.id}`);
  }

  const label = PU_STATUS_META[nextStatus]?.label || nextStatus;
  await addTimelineEvent(actor, {
    eventType: 'PU_STATUS_UPDATE',
    title: `${pu.puCode}: ${label}`,
    description: note.trim() || `Polling unit ${pu.name} status updated to ${label}.`,
    lgaId: pu.lgaId,
    wardId: pu.wardId,
    puId: pu.id,
    puCode: pu.puCode,
    deterministicEventId: existingClientSubmissionId
      ? `evt_${existingClientSubmissionId}`
      : undefined,
  });

  await logAudit(
    actor,
    'POLLING_UNIT_STATUS_UPDATED',
    'polling_units',
    pu.id,
    `Updated ${pu.puCode} operationalStatus to ${nextStatus}.${note ? ` Note: ${note}` : ''}`
  );
}

export async function submitIncidentReport(
  actor: UserAccount,
  pu: PollingUnit,
  input: {
    title: string;
    category: string;
    description: string;
    urgency: IncidentUrgency;
    evidenceBase64?: string | null;
    evidenceFileName?: string | null;
    isTestData?: boolean;
    clientCreatedAtIso?: string;
  },
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();
  const cleanTitle = input.title.trim().slice(0, 160);
  const cleanDesc = input.description.trim().slice(0, 2000);
  if (cleanTitle.length < 3 || cleanDesc.length < 5) {
    throw new Error('Incident title (min 3 chars) and description (min 5 chars) are required.');
  }

  const clientSubmissionId =
    existingClientSubmissionId || generateClientSubmissionId('inc');
  const docId = toValidDocId(clientSubmissionId);
  const ref = doc(db, 'incidents', docId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `incidents/${docId}`);
  }

  const clientCreatedAtIso = (input.clientCreatedAtIso || new Date().toISOString()).slice(0, 64);

  const payload: Record<string, unknown> = {
    title: cleanTitle,
    category: input.category.slice(0, 100),
    description: cleanDesc,
    urgency: input.urgency,
    status: IncidentStatus.NEW,
    lgaId: pu.lgaId,
    wardId: pu.wardId,
    puId: pu.id,
    puCode: pu.puCode.slice(0, 40),
    puName: pu.name.slice(0, 160),
    reporterUid: uid,
    reporterName: actor.displayName.slice(0, 120),
    internalNotes: '',
    escalatedTo: '',
    reviewedByUid: '',
    clientSubmissionId: docId,
    clientCreatedAtIso,
    serverSyncedAt: serverTimestamp(),
    isTestData: Boolean(input.isTestData),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.evidenceBase64) {
    payload.evidenceBase64 = input.evidenceBase64;
    payload.evidenceFileName = (input.evidenceFileName || 'evidence.jpg').slice(0, 120);
  }

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `incidents/${docId}`);
  }

  if (input.evidenceBase64) {
    const attachmentId = toValidDocId(`att_${docId}`);
    const sha256Hash = await computeEvidenceSha256(input.evidenceBase64);
    try {
      await setDoc(doc(db, 'report_attachments', attachmentId), {
        attachmentId,
        reportId: docId,
        reportType: 'INCIDENT_REPORT',
        ownerUid: uid,
        lgaId: pu.lgaId,
        wardId: pu.wardId,
        puId: pu.id,
        fileName: (input.evidenceFileName || 'evidence.jpg').slice(0, 120),
        sha256Hash,
        sizeBytes: input.evidenceBase64.length,
        base64Data: input.evidenceBase64,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Attachment mirror is supplementary; incident already contains compressed evidence
    }
  }

  if (
    input.urgency === IncidentUrgency.CRITICAL ||
    input.urgency === IncidentUrgency.HIGH
  ) {
    try {
      await updateDoc(doc(db, 'polling_units', pu.id), {
        operationalStatus: PuOperationalStatus.INCIDENT_REPORTED,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal if status update restricted
    }
  }

  await addTimelineEvent(actor, {
    eventType: 'INCIDENT_REPORTED',
    title: `[${input.urgency}] ${cleanTitle}`,
    description: `${pu.puCode} · ${input.category}: ${cleanDesc.slice(0, 220)}`,
    lgaId: pu.lgaId,
    wardId: pu.wardId,
    puId: pu.id,
    puCode: pu.puCode,
    isTestData: Boolean(input.isTestData),
  });

  await addNotification(actor, {
    title: `${input.urgency === IncidentUrgency.CRITICAL ? 'CRITICAL ALERT' : 'Incident Reported'}: ${pu.puCode}`,
    body: `${cleanTitle} (${input.category}) at ${pu.name}, ${pu.wardName}.`,
    type: input.urgency === IncidentUrgency.CRITICAL ? 'CRITICAL_ALERT' : 'INCIDENT_REPORTED',
    targetLgaId: pu.lgaId,
    targetWardId: pu.wardId,
    isCritical: input.urgency === IncidentUrgency.CRITICAL,
    isTestData: Boolean(input.isTestData),
  });

  await logAudit(
    actor,
    'INCIDENT_REPORT_SUBMITTED',
    'incidents',
    docId,
    `Submitted ${input.urgency} incident "${cleanTitle}" for ${pu.puCode}.`
  );

  return docId;
}

export async function updateIncidentWorkflow(
  actor: UserAccount,
  incident: IncidentReport,
  updates: {
    status: IncidentStatus;
    urgency: IncidentUrgency;
    internalNotes: string;
    escalatedTo: string;
  }
): Promise<void> {
  const uid = requireAuthUid();
  if (!canReviewIncidents(actor.role)) {
    throw new Error('You do not have permission to review or escalate incidents.');
  }

  try {
    await updateDoc(doc(db, 'incidents', incident.id), {
      status: updates.status,
      urgency: updates.urgency,
      internalNotes: updates.internalNotes.trim().slice(0, 1500),
      escalatedTo: updates.escalatedTo.trim().slice(0, 120),
      reviewedByUid: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `incidents/${incident.id}`);
  }

  await addTimelineEvent(actor, {
    eventType: 'INCIDENT_UPDATED',
    title: `Incident ${updates.status}: ${incident.title}`,
    description: `Updated by ${actor.displayName} (${updates.urgency}). ${updates.escalatedTo ? `Escalated to: ${updates.escalatedTo}` : ''}`.trim(),
    lgaId: incident.lgaId,
    wardId: incident.wardId,
    puId: incident.puId,
    puCode: incident.puCode,
  });

  await logAudit(
    actor,
    'INCIDENT_WORKFLOW_UPDATED',
    'incidents',
    incident.id,
    `Incident "${incident.title}" transitioned ${incident.status} -> ${updates.status} (${updates.urgency}).`
  );
}

export async function submitPollingUnitResult(
  actor: UserAccount,
  pu: PollingUnit,
  input: {
    apcVotes: number;
    pdpVotes: number;
    adcVotes: number;
    othersVotes: number;
    registeredVoters: number;
    accreditedVoters: number;
    validVotes: number;
    rejectedVotes: number;
    totalVotesCast?: number;
    bvasStatus: string;
    bvasNotes: string;
    submissionNotes: string;
    ec8aImageBase64?: string | null;
    ec8aFileName?: string | null;
    asDraft?: boolean;
    isTestData?: boolean;
    clientCreatedAtIso?: string;
  },
  existingResult?: ResultSubmission | null,
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();

  if (actor.role === UserRole.POLLING_UNIT_AGENT) {
    if (!actor.assignedPollingUnitId || actor.assignedPollingUnitId !== pu.id) {
      throw new Error(
        'Polling Unit Agents may only submit results for their assigned polling unit.'
      );
    }
  }

  const apc = Math.floor(Number(input.apcVotes));
  const pdp = Math.floor(Number(input.pdpVotes));
  const adc = Math.floor(Number(input.adcVotes));
  const others = Math.floor(Number(input.othersVotes));
  const reg = Math.floor(Number(input.registeredVoters));
  const acc = Math.floor(Number(input.accreditedVoters));
  const valid = Math.floor(Number(input.validVotes));
  const rej = Math.floor(Number(input.rejectedVotes));
  const totalCast =
    typeof input.totalVotesCast === 'number'
      ? Math.floor(input.totalVotesCast)
      : valid + rej;

  const validation = validateResultFigures({
    apcVotes: apc,
    pdpVotes: pdp,
    adcVotes: adc,
    othersVotes: others,
    registeredVoters: reg,
    accreditedVoters: acc,
    validVotes: valid,
    rejectedVotes: rej,
    totalVotesCast: totalCast,
  });

  if (!validation.isValid) {
    throw new Error(validation.errors[0]);
  }

  const targetStatus = input.asDraft
    ? VerificationStatus.DRAFT
    : VerificationStatus.SUBMITTED;

  if (existingResult) {
    if (existingResult.verificationStatus === VerificationStatus.VERIFIED) {
      throw new Error(
        'This polling unit result is already FDMIS Verified and locked against agent resubmission.'
      );
    }
    if (
      existingResult.submittedByUid !== uid &&
      actor.role !== UserRole.FULL_CONTROL_ADMIN
    ) {
      throw new Error('Only the submitting agent or Full Control Admin can revise this draft/correction.');
    }
    if (
      existingResult.verificationStatus !== VerificationStatus.DRAFT &&
      existingResult.verificationStatus !== VerificationStatus.REQUIRES_CORRECTION &&
      actor.role !== UserRole.FULL_CONTROL_ADMIN
    ) {
      throw new Error('Submitted results cannot be silently overwritten unless returned for correction.');
    }

    const nextVersion = existingResult.version + 1;
    const updatePayload: Record<string, unknown> = {
      apcVotes: apc,
      pdpVotes: pdp,
      adcVotes: adc,
      othersVotes: others,
      registeredVoters: reg,
      accreditedVoters: acc,
      validVotes: valid,
      rejectedVotes: rej,
      totalVotesCast: totalCast,
      bvasStatus: input.bvasStatus.slice(0, 80),
      bvasNotes: input.bvasNotes.trim().slice(0, 1000),
      submissionNotes: input.submissionNotes.trim().slice(0, 1000),
      verificationStatus: targetStatus,
      version: nextVersion,
      updatedAt: serverTimestamp(),
    };
    if (input.ec8aImageBase64) {
      updatePayload.ec8aImageBase64 = input.ec8aImageBase64;
      updatePayload.ec8aFileName = (input.ec8aFileName || 'ec8a.jpg').slice(0, 120);
    }

    try {
      await updateDoc(doc(db, 'result_submissions', existingResult.id), updatePayload);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `result_submissions/${existingResult.id}`
      );
    }

    const historyRef = doc(
      collection(db, 'result_submissions', existingResult.id, 'history')
    );
    try {
      await setDoc(historyRef, {
        action: `RESUBMITTED_V${nextVersion}`,
        previousStatus: existingResult.verificationStatus,
        newStatus: targetStatus,
        note: input.submissionNotes.trim().slice(0, 1000) || `Revised submission v${nextVersion}`,
        actorUid: uid,
        actorName: actor.displayName.slice(0, 120),
        apcVotes: apc,
        pdpVotes: pdp,
        adcVotes: adc,
        othersVotes: others,
        registeredVoters: reg,
        accreditedVoters: acc,
        validVotes: valid,
        rejectedVotes: rej,
        totalVotesCast: totalCast,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `result_submissions/${existingResult.id}/history`
      );
    }

    if (!input.asDraft) {
      try {
        await updateDoc(doc(db, 'polling_units', pu.id), {
          operationalStatus: PuOperationalStatus.RESULT_SUBMITTED,
          registeredVoters: reg,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // ignore if already updated
      }

      await addTimelineEvent(actor, {
        eventType: 'RESULT_RESUBMITTED',
        title: `Result Resubmitted (v${nextVersion}) · ${pu.puCode}`,
        description: `APC: ${apc}, PDP: ${pdp}, ADC: ${adc}, OTHERS: ${others} · Valid: ${valid}, Rejected: ${rej}, Total Cast: ${totalCast}.`,
        lgaId: pu.lgaId,
        wardId: pu.wardId,
        puId: pu.id,
        puCode: pu.puCode,
        isTestData: Boolean(existingResult.isTestData || input.isTestData),
      });

      await logAudit(
        actor,
        'RESULT_RESUBMITTED',
        'result_submissions',
        existingResult.id,
        `Resubmitted result v${nextVersion} for ${pu.puCode} (APC=${apc}, PDP=${pdp}, ADC=${adc}, OTHERS=${others}, Valid=${valid}, Total=${totalCast}).`
      );
    }

    return existingResult.id;
  }

  const clientSubmissionId =
    existingClientSubmissionId || generateClientSubmissionId('res');
  const docId = toValidDocId(clientSubmissionId);
  const ref = doc(db, 'result_submissions', docId);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `result_submissions/${docId}`);
  }

  const payload: Record<string, unknown> = {
    puId: pu.id,
    puCode: pu.puCode.slice(0, 40),
    puName: pu.name.slice(0, 160),
    lgaId: pu.lgaId,
    wardId: pu.wardId,
    wardName: pu.wardName.slice(0, 120),
    submittedByUid: uid,
    submittedByName: actor.displayName.slice(0, 120),
    apcVotes: apc,
    pdpVotes: pdp,
    adcVotes: adc,
    othersVotes: others,
    registeredVoters: reg,
    accreditedVoters: acc,
    validVotes: valid,
    rejectedVotes: rej,
    totalVotesCast: totalCast,
    bvasStatus: input.bvasStatus.slice(0, 80),
    bvasNotes: input.bvasNotes.trim().slice(0, 1000),
    submissionNotes: input.submissionNotes.trim().slice(0, 1000),
    verificationStatus: targetStatus,
    publiclyApproved: false,
    reviewNote: '',
    reviewedByUid: '',
    reviewedByName: '',
    version: 1,
    clientSubmissionId: docId,
    clientCreatedAtIso: (input.clientCreatedAtIso || new Date().toISOString()).slice(0, 64),
    serverSyncedAt: serverTimestamp(),
    isTestData: Boolean(input.isTestData),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.ec8aImageBase64) {
    payload.ec8aImageBase64 = input.ec8aImageBase64;
    payload.ec8aFileName = (input.ec8aFileName || 'ec8a.jpg').slice(0, 120);
  }

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `result_submissions/${docId}`);
  }

  try {
    await setDoc(doc(collection(db, 'result_submissions', docId, 'history')), {
      action: input.asDraft ? 'DRAFT_CREATED_V1' : 'SUBMITTED_V1',
      previousStatus: 'NONE',
      newStatus: targetStatus,
      note: input.submissionNotes.trim().slice(0, 1000) || 'Initial polling unit submission',
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      apcVotes: apc,
      pdpVotes: pdp,
      adcVotes: adc,
      othersVotes: others,
      registeredVoters: reg,
      accreditedVoters: acc,
      validVotes: valid,
      rejectedVotes: rej,
      totalVotesCast: totalCast,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `result_submissions/${docId}/history`
    );
  }

  if (input.ec8aImageBase64) {
    const attachmentId = toValidDocId(`ec8a_${docId}`);
    const sha256Hash = await computeEvidenceSha256(input.ec8aImageBase64);
    try {
      await setDoc(doc(db, 'report_attachments', attachmentId), {
        attachmentId,
        reportId: docId,
        reportType: 'RESULT_SUBMISSION',
        ownerUid: uid,
        lgaId: pu.lgaId,
        wardId: pu.wardId,
        puId: pu.id,
        fileName: (input.ec8aFileName || 'ec8a.jpg').slice(0, 120),
        sha256Hash,
        sizeBytes: input.ec8aImageBase64.length,
        base64Data: input.ec8aImageBase64,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal attachment mirror
    }
  }

  if (!input.asDraft) {
    try {
      await updateDoc(doc(db, 'polling_units', pu.id), {
        operationalStatus: PuOperationalStatus.RESULT_SUBMITTED,
        registeredVoters: reg,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // ignore if restricted
    }

    await addTimelineEvent(actor, {
      eventType: 'RESULT_SUBMITTED',
      title: `Result Submitted · ${pu.puCode}`,
      description: `APC: ${apc}, PDP: ${pdp}, ADC: ${adc}, OTHERS: ${others} · Valid: ${valid}, Rejected: ${rej}, Total Cast: ${totalCast}.`,
      lgaId: pu.lgaId,
      wardId: pu.wardId,
      puId: pu.id,
      puCode: pu.puCode,
      isTestData: Boolean(input.isTestData),
    });

    await addNotification(actor, {
      title: `Result Submitted: ${pu.puCode}`,
      body: `${actor.displayName} submitted polling unit figures for ${pu.name} (${pu.wardName}).`,
      type: 'RESULT_SUBMITTED',
      targetLgaId: pu.lgaId,
      targetWardId: pu.wardId,
      isCritical: false,
      isTestData: Boolean(input.isTestData),
    });

    await logAudit(
      actor,
      'RESULT_SUBMITTED',
      'result_submissions',
      docId,
      `Submitted result v1 for ${pu.puCode} (APC=${apc}, PDP=${pdp}, ADC=${adc}, OTHERS=${others}, Valid=${valid}, Total=${totalCast}).`
    );
  }

  return docId;
}

export async function reviewResultSubmission(
  actor: UserAccount,
  submission: ResultSubmission,
  decision: VerificationStatus,
  reviewNote: string,
  approvePublic: boolean
): Promise<void> {
  const uid = requireAuthUid();
  if (!canVerifyResults(actor.role)) {
    throw new Error('Only authorized administrators or Verification Officers can review polling unit results.');
  }

  if (actor.role === UserRole.FUNTUA_SUPER_ADMIN && submission.lgaId !== 'funtua') {
    throw new Error('Funtua Super Admin cannot verify Dandume LGA results.');
  }
  if (actor.role === UserRole.DANDUME_SUPER_ADMIN && submission.lgaId !== 'dandume') {
    throw new Error('Dandume Super Admin cannot verify Funtua LGA results.');
  }
  if (actor.role === UserRole.VERIFICATION_OFFICER) {
    if (actor.assignedLgaId && actor.assignedLgaId !== submission.lgaId) {
      throw new Error('You can only verify results within your assigned LGA.');
    }
    if (actor.assignedWardId && actor.assignedWardId !== submission.wardId) {
      throw new Error('You can only verify results within your assigned Ward.');
    }
  }

  if (
    decision === VerificationStatus.VERIFIED &&
    submission.submittedByUid === uid
  ) {
    throw new Error(
      'Self-approval is prohibited: a verifier cannot approve a result they submitted.'
    );
  }

  const cleanNote = reviewNote.trim().slice(0, 1000);
  if (cleanNote.length < 3) {
    throw new Error('A mandatory reason/review note (min 3 characters) is required for every verification decision.');
  }

  const allowPublic =
    canApprovePublicResults(actor.role) &&
    decision === VerificationStatus.VERIFIED &&
    approvePublic;

  const subRef = doc(db, 'result_submissions', submission.id);
  const approvedRef = doc(db, 'approved_pu_results', submission.puId);
  const wardRef = doc(db, 'wards', submission.wardId);
  const aggWardRef = doc(db, 'aggregated_results', `ward_${submission.wardId}`);
  const aggLgaRef = doc(db, 'aggregated_results', `lga_${submission.lgaId}`);
  const aggConstRef = doc(db, 'aggregated_results', 'constituency_all');
  const historyRef = doc(collection(db, 'result_submissions', submission.id, 'history'));
  const publicRef = doc(db, 'public_results', submission.puId);

  let previousStatusRecorded: string = submission.verificationStatus;
  let liveIsTestData: boolean = Boolean(submission.isTestData);

  try {
    await runTransaction(db, async (tx) => {
      // ALL reads first before any writes
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists()) {
        throw new Error('Result submission record was not found.');
      }
      const liveSub = subSnap.data() as Omit<ResultSubmission, 'id'>;
      previousStatusRecorded = liveSub.verificationStatus;
      liveIsTestData = Boolean(liveSub.isTestData);

      if (
        decision === VerificationStatus.VERIFIED &&
        liveSub.submittedByUid === uid
      ) {
        throw new Error('Self-approval is prohibited: you cannot approve your own submission.');
      }

      if (
        liveSub.verificationStatus === VerificationStatus.VERIFIED &&
        actor.role !== UserRole.FULL_CONTROL_ADMIN
      ) {
        throw new Error(
          'This result is already FDMIS Verified and locked. Only Full Control Admin can modify or reverse an approved result.'
        );
      }

      const apcVotes = Number(liveSub.apcVotes ?? 0);
      const pdpVotes = Number(liveSub.pdpVotes ?? 0);
      const adcVotes = Number(liveSub.adcVotes ?? 0);
      const othersVotes = Number(liveSub.othersVotes ?? 0);

      if (decision === VerificationStatus.VERIFIED) {
        const sumParties = apcVotes + pdpVotes + adcVotes + othersVotes;
        if (sumParties !== liveSub.validVotes || liveSub.validVotes + liveSub.rejectedVotes !== liveSub.totalVotesCast) {
          throw new Error(
            'Cannot approve this result because party totals or vote sums fail mathematical validation. Request correction instead.'
          );
        }
      }

      const [approvedSnap, wardSnap, aggWardSnap, aggLgaSnap, aggConstSnap] =
        await Promise.all([
          tx.get(approvedRef),
          tx.get(wardRef),
          tx.get(aggWardRef),
          tx.get(aggLgaRef),
          tx.get(aggConstRef),
        ]);

      const prevApproved = approvedSnap.exists()
        ? ({ id: approvedSnap.id, ...(approvedSnap.data() as Omit<ApprovedPuResult, 'id'>) } as ApprovedPuResult)
        : null;

      let nextApproved: Omit<ApprovedPuResult, 'id' | 'approvedAt' | 'updatedAt'> | null = null;
      if (decision === VerificationStatus.VERIFIED) {
        nextApproved = {
          puId: liveSub.puId,
          puCode: liveSub.puCode,
          puName: liveSub.puName,
          lgaId: liveSub.lgaId,
          wardId: liveSub.wardId,
          wardName: liveSub.wardName,
          sourceSubmissionId: submission.id,
          submittedByUid: liveSub.submittedByUid,
          submittedByName: liveSub.submittedByName,
          approvedByUid: uid,
          approvedByName: actor.displayName.slice(0, 120),
          apcVotes,
          pdpVotes,
          adcVotes,
          othersVotes,
          registeredVoters: liveSub.registeredVoters,
          accreditedVoters: liveSub.accreditedVoters,
          validVotes: liveSub.validVotes,
          rejectedVotes: liveSub.rejectedVotes,
          totalVotesCast: liveSub.totalVotesCast,
        };
      }

      const shouldRecomputeAgg =
        decision === VerificationStatus.VERIFIED ||
        ((decision === VerificationStatus.REJECTED ||
          decision === VerificationStatus.REQUIRES_CORRECTION) &&
          prevApproved !== null &&
          prevApproved.sourceSubmissionId === submission.id);

      const updateFields: Record<string, unknown> = {
        verificationStatus: decision,
        reviewNote: cleanNote,
        reviewedByUid: uid,
        reviewedByName: actor.displayName.slice(0, 120),
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (canApprovePublicResults(actor.role)) {
        updateFields.publiclyApproved = allowPublic;
      }
      tx.update(subRef, updateFields);

      tx.set(historyRef, {
        action: `REVIEW_${decision}`,
        previousStatus: liveSub.verificationStatus,
        newStatus: decision,
        note: cleanNote,
        actorUid: uid,
        actorName: actor.displayName.slice(0, 120),
        apcVotes,
        pdpVotes,
        adcVotes,
        othersVotes,
        registeredVoters: liveSub.registeredVoters,
        accreditedVoters: liveSub.accreditedVoters,
        validVotes: liveSub.validVotes,
        rejectedVotes: liveSub.rejectedVotes,
        totalVotesCast: liveSub.totalVotesCast,
        createdAt: serverTimestamp(),
      });

      if (shouldRecomputeAgg) {
        const delta = computeAggregationDelta(prevApproved, nextApproved);
        const wardLabel = wardSnap.exists()
          ? String((wardSnap.data() as { name?: string }).name || liveSub.wardName)
          : liveSub.wardName;
        const lgaLabel = LGA_DEFINITIONS[liveSub.lgaId]?.displayName || liveSub.lgaId;

        if (nextApproved) {
          tx.set(approvedRef, {
            ...nextApproved,
            approvedAt: prevApproved?.approvedAt ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else if (prevApproved) {
          tx.delete(approvedRef);
        }

        const existingWardAgg = aggWardSnap.exists()
          ? ({ id: aggWardSnap.id, ...(aggWardSnap.data() as Omit<AggregatedResult, 'id'>) } as AggregatedResult)
          : null;
        const existingLgaAgg = aggLgaSnap.exists()
          ? ({ id: aggLgaSnap.id, ...(aggLgaSnap.data() as Omit<AggregatedResult, 'id'>) } as AggregatedResult)
          : null;
        const existingConstAgg = aggConstSnap.exists()
          ? ({ id: aggConstSnap.id, ...(aggConstSnap.data() as Omit<AggregatedResult, 'id'>) } as AggregatedResult)
          : null;

        tx.set(aggWardRef, {
          ...applyAggregationDelta(
            existingWardAgg,
            {
              id: `ward_${liveSub.wardId}`,
              scopeType: 'WARD',
              scopeId: liveSub.wardId,
              lgaId: liveSub.lgaId,
              wardId: liveSub.wardId,
              label: wardLabel,
              actorUid: uid,
            },
            delta
          ),
          updatedAt: serverTimestamp(),
        });

        tx.set(aggLgaRef, {
          ...applyAggregationDelta(
            existingLgaAgg,
            {
              id: `lga_${liveSub.lgaId}`,
              scopeType: 'LGA',
              scopeId: liveSub.lgaId,
              lgaId: liveSub.lgaId,
              wardId: '',
              label: lgaLabel,
              actorUid: uid,
            },
            delta
          ),
          updatedAt: serverTimestamp(),
        });

        tx.set(aggConstRef, {
          ...applyAggregationDelta(
            existingConstAgg,
            {
              id: 'constituency_all',
              scopeType: 'CONSTITUENCY',
              scopeId: 'all',
              lgaId: 'all',
              wardId: '',
              label: 'Funtua–Dandume Federal Constituency',
              actorUid: uid,
            },
            delta
          ),
          updatedAt: serverTimestamp(),
        });
      }

      if (canApprovePublicResults(actor.role)) {
        if (allowPublic) {
          tx.set(publicRef, {
            puCode: liveSub.puCode,
            puName: liveSub.puName,
            wardName: liveSub.wardName,
            lgaId: liveSub.lgaId,
            apcVotes,
            pdpVotes,
            adcVotes,
            othersVotes,
            registeredVoters: liveSub.registeredVoters,
            accreditedVoters: liveSub.accreditedVoters,
            validVotes: liveSub.validVotes,
            rejectedVotes: liveSub.rejectedVotes,
            totalVotesCast: liveSub.totalVotesCast,
            approvedByUid: uid,
            verifiedAt: serverTimestamp(),
          });
        } else {
          tx.delete(publicRef);
        }
      }
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `result_submissions/${submission.id}`
    );
  }

  const puStatus =
    decision === VerificationStatus.VERIFIED
      ? PuOperationalStatus.RESULT_VERIFIED
      : decision === VerificationStatus.UNDER_REVIEW
        ? PuOperationalStatus.RESULT_UNDER_REVIEW
        : PuOperationalStatus.RESULT_SUBMITTED;

  try {
    await updateDoc(doc(db, 'polling_units', submission.puId), {
      operationalStatus: puStatus,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal
  }

  await addTimelineEvent(actor, {
    eventType: `RESULT_${decision}`,
    title: `Result ${decision} · ${submission.puCode}`,
    description: `${actor.displayName} (${previousStatusRecorded} -> ${decision}): ${cleanNote}`,
    lgaId: submission.lgaId,
    wardId: submission.wardId,
    puId: submission.puId,
    puCode: submission.puCode,
    isTestData: liveIsTestData,
  });

  await addNotification(actor, {
    title: `Result ${decision}: ${submission.puCode}`,
    body: `${submission.puName} submission marked ${decision}. Note: ${cleanNote}`,
    type: 'VERIFICATION_DECISION',
    targetLgaId: submission.lgaId,
    targetWardId: submission.wardId,
    isCritical: decision === VerificationStatus.REJECTED,
    isTestData: liveIsTestData,
  });

  await logAudit(
    actor,
    `RESULT_${decision}`,
    'result_submissions',
    submission.id,
    `Reviewed ${submission.puCode} (${previousStatusRecorded} -> ${decision}, public=${allowPublic}). Note: ${cleanNote}`
  );
}

export async function sendSituationNotification(
  actor: UserAccount,
  input: {
    title: string;
    body: string;
    targetLgaId: string;
    targetWardId: string;
    isCritical: boolean;
    isTestData?: boolean;
  },
  existingClientSubmissionId?: string
): Promise<void> {
  requireAuthUid();
  if (!canReviewIncidents(actor.role)) {
    throw new Error('Only administrators and coordinators can broadcast announcements.');
  }

  await addNotification(actor, {
    title: input.title.trim(),
    body: input.body.trim(),
    type: input.isCritical ? 'CRITICAL_ANNOUNCEMENT' : 'ADMIN_ANNOUNCEMENT',
    targetLgaId: input.targetLgaId,
    targetWardId: input.targetWardId,
    isCritical: input.isCritical,
    isTestData: Boolean(input.isTestData),
    deterministicNotificationId: existingClientSubmissionId,
  });

  await logAudit(
    actor,
    'NOTIFICATION_BROADCAST',
    'notifications',
    input.targetLgaId,
    `Broadcasted announcement "${input.title.trim()}" to scope=${input.targetLgaId}${input.isTestData ? ' [TEST DATA]' : ''}.`
  );
}

export async function correctMasterPollingUnit(
  actor: UserAccount,
  pu: PollingUnit,
  updates: {
    name: string;
    locationDescription: string;
    registeredVoters: number;
    latitude: number | null;
    longitude: number | null;
    coordinatesVerified: boolean;
  },
  correctionReason: string
): Promise<void> {
  const uid = requireAuthUid();
  if (!canCorrectMasterDirectory(actor.role)) {
    throw new Error('Only Full Control Admin can execute controlled master directory corrections.');
  }

  const cleanReason = correctionReason.trim().slice(0, 520);
  if (cleanReason.length < 5) {
    throw new Error('Correction reason (min 5 characters) is mandatory.');
  }

  const batch = writeBatch(db);
  const backupRef = doc(collection(db, 'directory_backups'));
  const backupPayload: Record<string, unknown> = {
    entityType: 'polling_units',
    targetDocId: pu.id,
    lgaId: pu.lgaId,
    puCode: pu.puCode,
    previousName: pu.name,
    previousLocationDescription: pu.locationDescription,
    previousRegisteredVoters: pu.registeredVoters,
    previousCoordinatesVerified: pu.coordinatesVerified,
    correctionReason: cleanReason,
    backedUpByUid: uid,
    backedUpByEmail: actor.email,
    createdAt: serverTimestamp(),
  };
  if (typeof pu.latitude === 'number') backupPayload.previousLatitude = pu.latitude;
  if (typeof pu.longitude === 'number') backupPayload.previousLongitude = pu.longitude;
  batch.set(backupRef, backupPayload);

  const puRef = doc(db, 'polling_units', pu.id);
  const puUpdate: Record<string, unknown> = {
    name: updates.name.trim().slice(0, 160),
    locationDescription: updates.locationDescription.trim().slice(0, 300),
    registeredVoters: Math.max(0, Math.min(50000, Math.floor(updates.registeredVoters))),
    coordinatesVerified: updates.coordinatesVerified,
    latitude: updates.latitude,
    longitude: updates.longitude,
    updatedAt: serverTimestamp(),
  };
  batch.update(puRef, puUpdate);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `polling_units/${pu.id}`);
  }

  await rebuildAndSyncLocationCatalog(actor, pu.lgaId);

  await logAudit(
    actor,
    'MASTER_PU_CORRECTED',
    'polling_units',
    pu.id,
    `Corrected ${pu.puCode} with immutable backup (${backupRef.id}). Reason: ${cleanReason}`
  );
}

let activeQueueFlushPromise: Promise<{ syncedCount: number; failedCount: number }> | null =
  null;

export async function syncSingleQueuedItem(
  actor: UserAccount,
  item: OfflineQueuedItem,
  pollingUnits: PollingUnit[],
  existingResults: ResultSubmission[]
): Promise<boolean> {
  if (!navigator.onLine) return false;

  const tombstones = await getDeletedTombstones();
  const targetResultId =
    typeof item.payload?.targetResultId === 'string' ? item.payload.targetResultId : '';
  const clientNoteId =
    typeof item.payload?.clientNoteId === 'string' ? item.payload.clientNoteId : '';

  if (
    item.reportType !== 'NOTE_DELETE' &&
    (tombstones.has(item.clientSubmissionId) ||
      (targetResultId && tombstones.has(targetResultId)) ||
      (clientNoteId && tombstones.has(clientNoteId)))
  ) {
    await deleteQueueItem(item.clientSubmissionId);
    return true;
  }

  await updateQueueItemStatus(item.clientSubmissionId, 'SYNCING');

  try {
    if (item.reportType === 'NOTE_UPSERT') {
      const noteObj: OperationalNote = {
        id: clientNoteId || item.clientSubmissionId,
        clientNoteId: clientNoteId || item.clientSubmissionId,
        title: String(item.payload.title || ''),
        content: String(item.payload.content || ''),
        category: (item.payload.category as OperationalNoteCategory) || 'GENERAL',
        lgaId: (item.payload.lgaId as 'all' | LgaId) || item.lgaId || 'all',
        wardId: String(item.payload.wardId || item.wardId || ''),
        puId: String(item.payload.puId || item.puId || ''),
        puCode: String(item.payload.puCode || item.puCode || ''),
        puName: String(item.payload.puName || item.puName || ''),
        authorUid: actor.uid,
        authorName: actor.displayName,
        isPinned: Boolean(item.payload.isPinned),
        isTestData: Boolean(item.payload.isTestData),
        revision: Number(item.payload.revision || 1),
        clientCreatedAtIso: String(item.payload.createdAtIso || item.createdAtIso),
        updatedAt: String(item.payload.updatedAtIso || new Date().toISOString()),
        syncState: 'SYNCED',
      };
      await syncNoteUpsertToFirestore(actor, noteObj);
      await saveLocalNote(noteObj);
      await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
      return true;
    }

    if (item.reportType === 'NOTE_DELETE') {
      await syncNoteDeleteToFirestore(clientNoteId || item.clientSubmissionId);
      await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
      return true;
    }

    if (item.reportType === 'NOTIFICATION_BROADCAST') {
      await sendSituationNotification(
        actor,
        {
          title: String(item.payload.title || ''),
          body: String(item.payload.body || ''),
          targetLgaId: String(item.payload.targetLgaId || item.lgaId || 'all'),
          targetWardId: String(item.payload.targetWardId || item.wardId || ''),
          isCritical: Boolean(item.payload.isCritical),
          isTestData: Boolean(item.payload.isTestData),
        },
        item.clientSubmissionId
      );
      await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
      return true;
    }

    if (item.reportType === 'TASK_CREATE') {
      const lgaId = (item.payload.lgaId as LgaId) || (item.lgaId as LgaId);
      const wardId = String(item.payload.wardId || item.wardId || '');
      const wardName = String(item.payload.wardName || '');
      const assignedOfficerUid = String(item.payload.assignedOfficerUid || '');
      const assignedOfficerName = String(item.payload.assignedOfficerName || '');
      await createOperationalTask(
        actor,
        {
          title: String(item.payload.title || ''),
          description: String(item.payload.description || ''),
          priority: item.payload.priority as TaskPriority,
          lgaId,
          ward: {
            id: wardId,
            lgaId,
            wardCode: '',
            name: wardName,
            coordinatorUid: '',
            coordinatorName: '',
            expectedPollingUnits: 0,
            isTestData: false,
            createdByUid: actor.uid,
          },
          officer: {
            uid: assignedOfficerUid,
            displayName: assignedOfficerName,
            email: '',
            phone: '',
            role: UserRole.OPERATIONS_OFFICER,
            status: actor.status,
            assignedLgaId: lgaId,
            assignedWardId: wardId,
            assignedPollingUnitId: '',
            sessionRevoked: false,
          },
          startDateIso: String(item.payload.startDateIso || ''),
          dueDateIso: String(item.payload.dueDateIso || ''),
          clientCreatedAtIso: item.createdAtIso,
        },
        item.clientSubmissionId
      );
      await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
      return true;
    }

    if (item.reportType === 'TASK_OFFICER_UPDATE') {
      const taskId = String(item.payload.taskId || '');
      if (!taskId) {
        await updateQueueItemStatus(
          item.clientSubmissionId,
          'SYNC_FAILED',
          'Missing task reference for queued update.'
        );
        return false;
      }
      const taskSnap = await getDoc(doc(db, 'operational_tasks', taskId));
      if (!taskSnap.exists()) {
        await updateQueueItemStatus(
          item.clientSubmissionId,
          'SYNC_FAILED',
          'Task record no longer exists on the server.'
        );
        return false;
      }
      const liveTask = {
        id: taskSnap.id,
        ...(taskSnap.data() as Omit<OperationalTask, 'id'>),
      };
      await submitOfficerTaskUpdate(
        actor,
        liveTask,
        {
          nextStatus: item.payload.nextStatus as OfficerTaskUpdateInput['nextStatus'],
          progressPercent: Number(item.payload.progressPercent ?? liveTask.progressPercent ?? 0),
          fieldReport: String(item.payload.fieldReport || ''),
          delayReason: String(item.payload.delayReason || ''),
          evidenceBase64:
            typeof item.payload.evidenceBase64 === 'string'
              ? item.payload.evidenceBase64
              : null,
          evidenceFileName:
            typeof item.payload.evidenceFileName === 'string'
              ? item.payload.evidenceFileName
              : null,
          clientCreatedAtIso: item.createdAtIso,
        },
        item.clientSubmissionId
      );
      await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
      return true;
    }

    if (item.reportType === 'REPORT_ARCHIVE') {
      const report = item.payload.report as CompiledAutomaticReport | undefined;
      const filters = item.payload.filters as AnalyticsReportFilters | undefined;
      const generationMode =
        item.payload.generationMode === 'AUTOMATIC_DAILY' ? 'AUTOMATIC_DAILY' : 'ON_DEMAND';
      if (!report || !filters) {
        await updateQueueItemStatus(
          item.clientSubmissionId,
          'SYNC_FAILED',
          'Incomplete queued report payload.'
        );
        return false;
      }
      await archiveGeneratedReport(
        actor,
        report,
        filters,
        generationMode,
        item.clientSubmissionId
      );
      await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
      return true;
    }

    const pu = pollingUnits.find((p) => p.id === item.puId);
    if (!pu) {
      await updateQueueItemStatus(
        item.clientSubmissionId,
        'SYNC_FAILED',
        'Polling unit record is not yet loaded in active scope.'
      );
      return false;
    }

    if (item.reportType === 'CHECK_IN') {
      await submitCheckIn(
        actor,
        pu,
        {
          ...(item.payload as Parameters<typeof submitCheckIn>[2]),
          clientCreatedAtIso: item.createdAtIso,
        },
        item.clientSubmissionId
      );
    } else if (item.reportType === 'STATUS_UPDATE') {
      await updatePollingUnitStatus(
        actor,
        pu,
        item.payload.operationalStatus as PuOperationalStatus,
        String(item.payload.note || ''),
        item.clientSubmissionId
      );
    } else if (item.reportType === 'INCIDENT_REPORT') {
      await submitIncidentReport(
        actor,
        pu,
        {
          ...(item.payload as Parameters<typeof submitIncidentReport>[2]),
          clientCreatedAtIso: item.createdAtIso,
        },
        item.clientSubmissionId
      );
    } else if (item.reportType === 'RESULT_SUBMISSION') {
      const prev =
        (targetResultId
          ? existingResults.find((r) => r.id === targetResultId)
          : undefined) ||
        existingResults.find((r) => r.puId === pu.id) ||
        null;
      await submitPollingUnitResult(
        actor,
        pu,
        {
          ...(item.payload as Parameters<typeof submitPollingUnitResult>[2]),
          clientCreatedAtIso: item.createdAtIso,
        },
        prev,
        item.clientSubmissionId
      );
    }

    await updateQueueItemStatus(item.clientSubmissionId, 'SYNCED');
    return true;
  } catch (err) {
    await updateQueueItemStatus(
      item.clientSubmissionId,
      'SYNC_FAILED',
      err instanceof Error ? err.message : 'Unable to synchronize submission.'
    );
    return false;
  }
}

export async function flushOfflineQueue(
  actor: UserAccount,
  pollingUnits: PollingUnit[],
  existingResults: ResultSubmission[]
): Promise<{ syncedCount: number; failedCount: number }> {
  if (!navigator.onLine) {
    return { syncedCount: 0, failedCount: 0 };
  }

  if (activeQueueFlushPromise) {
    return activeQueueFlushPromise;
  }

  activeQueueFlushPromise = (async () => {
    const items: OfflineQueuedItem[] = await getQueuedItems(actor.uid);
    const pending = items
      .filter(
        (i) =>
          i.status === 'PENDING_SYNC' ||
          i.status === 'SYNC_FAILED' ||
          i.status === 'SAVED_LOCALLY' ||
          i.status === 'SYNCING'
      )
      .sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));

    let syncedCount = 0;
    let failedCount = 0;

    for (const item of pending) {
      const ok = await syncSingleQueuedItem(actor, item, pollingUnits, existingResults);
      if (ok) syncedCount += 1;
      else failedCount += 1;
    }

    return { syncedCount, failedCount };
  })();

  try {
    return await activeQueueFlushPromise;
  } finally {
    activeQueueFlushPromise = null;
  }
}

export type { Ward, LgaId };
