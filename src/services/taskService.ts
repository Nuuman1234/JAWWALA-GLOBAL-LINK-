import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
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
import {
  TaskPriority,
  TaskStatus,
  UserRole,
  canManageTasks,
  type LgaId,
  type OfflineQueuedItem,
  type OperationalTask,
  type TaskUpdateEntry,
  type TaskUpdateEntryType,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { toValidDocId } from './officialDirectory';
import {
  enqueueOfflineSubmission,
  generateClientSubmissionId,
  purgeDeletedRecordsEverywhere,
} from './offlineQueue';

function requireAuthUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated user session required.');
  return uid;
}

function toTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof (val as { seconds?: number }).seconds === 'number') {
    return (val as { seconds: number }).seconds * 1000;
  }
  return 0;
}

async function logTaskAudit(
  actor: UserAccount,
  action: string,
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
      affectedEntity: 'operational_tasks',
      affectedId: affectedId.slice(0, 128),
      details: details.slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log fallback
  }
}

async function addTaskNotification(
  actor: UserAccount,
  input: {
    title: string;
    body: string;
    type: string;
    targetLgaId: string;
    targetWardId: string;
    isCritical: boolean;
    deterministicId?: string;
  }
): Promise<void> {
  try {
    const ref = input.deterministicId
      ? doc(db, 'notifications', toValidDocId(input.deterministicId))
      : doc(collection(db, 'notifications'));
    if (input.deterministicId) {
      const existing = await getDoc(ref);
      if (existing.exists()) return;
    }
    await setDoc(ref, {
      title: input.title.slice(0, 160),
      body: input.body.slice(0, 1000),
      type: input.type.slice(0, 64),
      targetLgaId: input.targetLgaId.slice(0, 32),
      targetWardId: input.targetWardId.slice(0, 128),
      isCritical: input.isCritical,
      isTestData: false,
      createdByUid: actor.uid,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal notification mirror
  }
}

async function addTaskTimelineEvent(
  actor: UserAccount,
  input: {
    eventType: string;
    title: string;
    description: string;
    lgaId: string;
    wardId: string;
    deterministicEventId?: string;
  }
): Promise<void> {
  try {
    const ref = input.deterministicEventId
      ? doc(db, 'timeline_events', toValidDocId(input.deterministicEventId))
      : doc(collection(db, 'timeline_events'));
    if (input.deterministicEventId) {
      const existing = await getDoc(ref);
      if (existing.exists()) return;
    }
    await setDoc(ref, {
      eventType: input.eventType.slice(0, 64),
      title: input.title.slice(0, 160),
      description: input.description.slice(0, 600),
      lgaId: input.lgaId.slice(0, 32),
      wardId: input.wardId.slice(0, 128),
      puId: '',
      puCode: 'WARD-TASK',
      actorUid: actor.uid,
      actorName: actor.displayName.slice(0, 120),
      isTestData: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal timeline mirror
  }
}

export function observeOperationalTasks(
  user: UserAccount,
  onData: (items: OperationalTask[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'operational_tasks');
  let q: Query | null = null;

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    q = base;
  } else if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'funtua'));
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    q = query(base, where('lgaId', '==', 'dandume'));
  } else if (user.role === UserRole.OPERATIONS_OFFICER) {
    q = query(base, where('assignedOfficerUid', '==', user.uid));
  }

  if (!q) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<OperationalTask, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.updatedAt || b.createdAt) - toTimestampMs(a.updatedAt || a.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'operational_tasks');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function observeTaskUpdates(
  taskId: string,
  onData: (items: TaskUpdateEntry[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  if (!taskId) {
    onData([]);
    return () => {};
  }
  const q = query(
    collection(db, 'operational_tasks', taskId, 'updates'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<TaskUpdateEntry, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `operational_tasks/${taskId}/updates`);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export interface CreateOperationalTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  lgaId: LgaId;
  ward: Ward;
  officer: UserAccount;
  startDateIso: string;
  dueDateIso: string;
  clientCreatedAtIso?: string;
}

export async function createOperationalTask(
  actor: UserAccount,
  input: CreateOperationalTaskInput,
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();
  if (!canManageTasks(actor.role)) {
    throw new Error('Only Full Control Admin can create and assign field operations tasks.');
  }

  const cleanTitle = input.title.trim().slice(0, 160);
  const cleanDescription = input.description.trim().slice(0, 2000);
  if (cleanTitle.length < 3 || cleanDescription.length < 5) {
    throw new Error('Task title (min 3 chars) and description (min 5 chars) are required.');
  }
  if (!input.startDateIso || !input.dueDateIso) {
    throw new Error('Both start date and completion deadline are required.');
  }
  if (Date.parse(input.dueDateIso) < Date.parse(input.startDateIso)) {
    throw new Error('Completion deadline must be on or after the task start date.');
  }

  const clientSubmissionId =
    existingClientSubmissionId || generateClientSubmissionId('task');
  const docId = toValidDocId(clientSubmissionId);
  const ref = doc(db, 'operational_tasks', docId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `operational_tasks/${docId}`);
  }

  const clientCreatedAtIso = (input.clientCreatedAtIso || new Date().toISOString()).slice(0, 64);

  const payload = {
    title: cleanTitle,
    description: cleanDescription,
    priority: input.priority,
    status: TaskStatus.ASSIGNED,
    lgaId: input.lgaId,
    wardId: input.ward.id,
    wardName: input.ward.name.slice(0, 120),
    assignedOfficerUid: input.officer.uid,
    assignedOfficerName: input.officer.displayName.slice(0, 120),
    assignedByUid: uid,
    assignedByName: actor.displayName.slice(0, 120),
    startDateIso: input.startDateIso.slice(0, 40),
    dueDateIso: input.dueDateIso.slice(0, 40),
    progressPercent: 0,
    acknowledgedAtIso: '',
    submittedForReviewAtIso: '',
    completedAtIso: '',
    latestFieldReport: '',
    delayReason: '',
    adminFeedback: '',
    updateRequestedAtIso: '',
    updateRequestNote: '',
    reviewedByUid: '',
    reviewedByName: '',
    clientSubmissionId: docId,
    clientCreatedAtIso,
    serverSyncedAt: serverTimestamp(),
    isTestData: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `operational_tasks/${docId}`);
  }

  const initUpdateId = toValidDocId(`init_${docId}`);
  try {
    await setDoc(doc(db, 'operational_tasks', docId, 'updates', initUpdateId), {
      taskId: docId,
      entryType: 'STATUS_CHANGE' as TaskUpdateEntryType,
      statusSnapshot: TaskStatus.ASSIGNED,
      progressPercent: 0,
      summary: `Task assigned to ${input.officer.displayName} (${input.ward.name} Ward). Priority: ${input.priority}. Deadline: ${input.dueDateIso}.`,
      delayReason: '',
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorRole: actor.role,
      clientSubmissionId: initUpdateId,
      clientCreatedAtIso,
      serverSyncedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Supplementary history entry
  }

  await addTaskNotification(actor, {
    title: `Task Assigned: ${cleanTitle}`,
    body: `Assigned to ${input.officer.displayName} in ${input.ward.name} Ward (Priority: ${input.priority}, Due: ${input.dueDateIso}).`,
    type: 'TASK_ASSIGNED',
    targetLgaId: input.lgaId,
    targetWardId: input.ward.id,
    isCritical: input.priority === TaskPriority.CRITICAL,
    deterministicId: `notif_task_${docId}`,
  });

  await addTaskTimelineEvent(actor, {
    eventType: 'TASK_ASSIGNED',
    title: `Task Assigned · ${input.ward.name}`,
    description: `"${cleanTitle}" assigned to ${input.officer.displayName} (${input.priority}).`,
    lgaId: input.lgaId,
    wardId: input.ward.id,
    deterministicEventId: `tl_task_${docId}`,
  });

  await logTaskAudit(
    actor,
    'OPERATIONAL_TASK_CREATED',
    docId,
    `Assigned task "${cleanTitle}" (${input.priority}) to ${input.officer.displayName} in ${input.ward.name} (${input.lgaId}).`
  );

  return docId;
}

export interface OfficerTaskUpdateInput {
  nextStatus: TaskStatus.ACKNOWLEDGED | TaskStatus.IN_PROGRESS | TaskStatus.AWAITING_REVIEW;
  progressPercent: number;
  fieldReport: string;
  delayReason?: string;
  evidenceBase64?: string | null;
  evidenceFileName?: string | null;
  clientCreatedAtIso?: string;
}

export async function submitOfficerTaskUpdate(
  actor: UserAccount,
  task: OperationalTask,
  input: OfficerTaskUpdateInput,
  existingClientSubmissionId?: string
): Promise<string> {
  const uid = requireAuthUid();
  if (
    actor.role !== UserRole.FULL_CONTROL_ADMIN &&
    task.assignedOfficerUid !== uid
  ) {
    throw new Error('Only the assigned Operations Officer can submit field updates for this task.');
  }
  if (
    task.status === TaskStatus.APPROVED_COMPLETED &&
    actor.role !== UserRole.FULL_CONTROL_ADMIN
  ) {
    throw new Error('This task has already been approved and completed.');
  }

  const cleanReport = input.fieldReport.trim().slice(0, 2000);
  const cleanDelay = (input.delayReason || '').trim().slice(0, 1000);
  const clampedProgress = Math.max(0, Math.min(100, Math.round(input.progressPercent)));

  if (
    input.nextStatus === TaskStatus.AWAITING_REVIEW &&
    cleanReport.length < 5
  ) {
    throw new Error('Enter a field completion report (at least 5 characters) before submitting for review.');
  }

  const clientSubmissionId =
    existingClientSubmissionId || generateClientSubmissionId('taskupd');
  const updateDocId = toValidDocId(clientSubmissionId);
  const clientCreatedAtIso = (input.clientCreatedAtIso || new Date().toISOString()).slice(0, 64);

  const updateRef = doc(db, 'operational_tasks', task.id, 'updates', updateDocId);
  try {
    const existingUpdate = await getDoc(updateRef);
    if (existingUpdate.exists()) {
      return updateDocId;
    }
  } catch {
    // Proceed to write
  }

  const taskPatch: Record<string, unknown> = {
    status: input.nextStatus,
    progressPercent:
      input.nextStatus === TaskStatus.AWAITING_REVIEW
        ? Math.max(clampedProgress, 100)
        : clampedProgress,
    latestFieldReport: cleanReport || task.latestFieldReport || '',
    delayReason: cleanDelay,
    serverSyncedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (
    input.nextStatus === TaskStatus.ACKNOWLEDGED ||
    (!task.acknowledgedAtIso &&
      (input.nextStatus === TaskStatus.IN_PROGRESS ||
        input.nextStatus === TaskStatus.AWAITING_REVIEW))
  ) {
    taskPatch.acknowledgedAtIso = task.acknowledgedAtIso || clientCreatedAtIso;
  }

  if (input.nextStatus === TaskStatus.AWAITING_REVIEW) {
    taskPatch.submittedForReviewAtIso = clientCreatedAtIso;
  }

  if (input.evidenceBase64) {
    taskPatch.evidenceBase64 = input.evidenceBase64;
    taskPatch.evidenceFileName = (input.evidenceFileName || 'task_evidence.jpg').slice(0, 120);
  }

  try {
    await updateDoc(doc(db, 'operational_tasks', task.id), taskPatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `operational_tasks/${task.id}`);
  }

  const entryType: TaskUpdateEntryType =
    input.nextStatus === TaskStatus.AWAITING_REVIEW
      ? 'FIELD_REPORT'
      : input.nextStatus === TaskStatus.ACKNOWLEDGED
        ? 'STATUS_CHANGE'
        : 'OFFICER_PROGRESS';

  const summaryText =
    cleanReport ||
    (input.nextStatus === TaskStatus.ACKNOWLEDGED
      ? `Assignment acknowledged by ${actor.displayName}.`
      : `Progress updated to ${clampedProgress}%.`);

  const entryPayload: Record<string, unknown> = {
    taskId: task.id,
    entryType,
    statusSnapshot: input.nextStatus,
    progressPercent:
      input.nextStatus === TaskStatus.AWAITING_REVIEW
        ? Math.max(clampedProgress, 100)
        : clampedProgress,
    summary: summaryText.slice(0, 2000),
    delayReason: cleanDelay,
    actorUid: uid,
    actorName: actor.displayName.slice(0, 120),
    actorRole: actor.role,
    clientSubmissionId: updateDocId,
    clientCreatedAtIso,
    serverSyncedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  if (input.evidenceBase64) {
    entryPayload.evidenceBase64 = input.evidenceBase64;
    entryPayload.evidenceFileName = (input.evidenceFileName || 'task_evidence.jpg').slice(0, 120);
  }

  try {
    await setDoc(updateRef, entryPayload);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `operational_tasks/${task.id}/updates/${updateDocId}`
    );
  }

  if (input.nextStatus === TaskStatus.AWAITING_REVIEW) {
    await addTaskNotification(actor, {
      title: `Task Submitted for Review: ${task.title}`,
      body: `${actor.displayName} submitted a field report for "${task.title}" (${task.wardName} Ward).`,
      type: 'TASK_AWAITING_REVIEW',
      targetLgaId: task.lgaId,
      targetWardId: task.wardId,
      isCritical: false,
      deterministicId: `notif_rev_${updateDocId}`,
    });
  }

  await logTaskAudit(
    actor,
    'OPERATIONAL_TASK_OFFICER_UPDATED',
    task.id,
    `Officer ${actor.displayName} set task "${task.title}" to ${input.nextStatus} (${clampedProgress}%).`
  );

  return updateDocId;
}

export async function requestOfficerFieldUpdate(
  actor: UserAccount,
  task: OperationalTask,
  requestNote: string
): Promise<void> {
  const uid = requireAuthUid();
  if (!canManageTasks(actor.role)) {
    throw new Error('Only Full Control Admin can request field updates on tasks.');
  }

  const cleanNote =
    requestNote.trim().slice(0, 600) ||
    'Please provide an immediate field progress report and current status update.';
  const nowIso = new Date().toISOString();

  try {
    await updateDoc(doc(db, 'operational_tasks', task.id), {
      updateRequestedAtIso: nowIso,
      updateRequestNote: cleanNote,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `operational_tasks/${task.id}`);
  }

  const updateDocId = toValidDocId(generateClientSubmissionId('req'));
  try {
    await setDoc(doc(db, 'operational_tasks', task.id, 'updates', updateDocId), {
      taskId: task.id,
      entryType: 'UPDATE_REQUEST' as TaskUpdateEntryType,
      statusSnapshot: task.status,
      progressPercent: task.progressPercent,
      summary: `Field update requested by Full Admin: ${cleanNote}`,
      delayReason: '',
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorRole: actor.role,
      clientSubmissionId: updateDocId,
      clientCreatedAtIso: nowIso,
      serverSyncedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal
  }

  await addTaskNotification(actor, {
    title: `Field Update Requested: ${task.title}`,
    body: `Full Admin requested an update from ${task.assignedOfficerName} (${task.wardName}): ${cleanNote}`,
    type: 'TASK_UPDATE_REQUEST',
    targetLgaId: task.lgaId,
    targetWardId: task.wardId,
    isCritical: task.priority === TaskPriority.CRITICAL,
  });

  await logTaskAudit(
    actor,
    'OPERATIONAL_TASK_UPDATE_REQUESTED',
    task.id,
    `Requested field update on "${task.title}" from ${task.assignedOfficerName}: ${cleanNote}`
  );
}

export async function reviewTaskSubmission(
  actor: UserAccount,
  task: OperationalTask,
  decision: 'APPROVE' | 'REJECT_REVISION' | 'MARK_OVERDUE',
  feedback: string
): Promise<void> {
  const uid = requireAuthUid();
  if (!canManageTasks(actor.role)) {
    throw new Error('Only Full Control Admin can approve, reject, or request corrections on tasks.');
  }

  const cleanFeedback = feedback.trim().slice(0, 1500);
  if (decision === 'REJECT_REVISION' && cleanFeedback.length < 4) {
    throw new Error('Provide clear correction instructions (min 4 characters) when requesting revisions.');
  }

  const nowIso = new Date().toISOString();
  const nextStatus =
    decision === 'APPROVE'
      ? TaskStatus.APPROVED_COMPLETED
      : decision === 'MARK_OVERDUE'
        ? TaskStatus.OVERDUE
        : TaskStatus.REVISION_REQUIRED;

  const patch: Record<string, unknown> = {
    status: nextStatus,
    adminFeedback: cleanFeedback || (decision === 'APPROVE' ? 'Approved and completed.' : ''),
    reviewedByUid: uid,
    reviewedByName: actor.displayName.slice(0, 120),
    updatedAt: serverTimestamp(),
  };

  if (decision === 'APPROVE') {
    patch.progressPercent = 100;
    patch.completedAtIso = nowIso;
  }

  try {
    await updateDoc(doc(db, 'operational_tasks', task.id), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `operational_tasks/${task.id}`);
  }

  const updateDocId = toValidDocId(generateClientSubmissionId('admrev'));
  try {
    await setDoc(doc(db, 'operational_tasks', task.id, 'updates', updateDocId), {
      taskId: task.id,
      entryType: 'ADMIN_REVIEW' as TaskUpdateEntryType,
      statusSnapshot: nextStatus,
      progressPercent: decision === 'APPROVE' ? 100 : task.progressPercent,
      summary:
        decision === 'APPROVE'
          ? `Approved & Completed by ${actor.displayName}.${cleanFeedback ? ` Feedback: ${cleanFeedback}` : ''}`
          : decision === 'MARK_OVERDUE'
            ? `Marked Overdue by ${actor.displayName}.${cleanFeedback ? ` Note: ${cleanFeedback}` : ''}`
            : `Revision Required by ${actor.displayName}: ${cleanFeedback}`,
      delayReason: '',
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorRole: actor.role,
      clientSubmissionId: updateDocId,
      clientCreatedAtIso: nowIso,
      serverSyncedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal
  }

  await addTaskNotification(actor, {
    title:
      decision === 'APPROVE'
        ? `Task Approved: ${task.title}`
        : decision === 'MARK_OVERDUE'
          ? `Task Marked Overdue: ${task.title}`
          : `Revision Required: ${task.title}`,
    body: `${task.assignedOfficerName} (${task.wardName}): ${cleanFeedback || nextStatus}`,
    type: 'TASK_REVIEWED',
    targetLgaId: task.lgaId,
    targetWardId: task.wardId,
    isCritical: decision === 'MARK_OVERDUE',
  });

  await logTaskAudit(
    actor,
    `OPERATIONAL_TASK_${decision}`,
    task.id,
    `Admin ${actor.displayName} set "${task.title}" to ${nextStatus}. Feedback: ${cleanFeedback || 'None'}`
  );
}

export async function deleteOperationalTask(
  actor: UserAccount,
  task: OperationalTask
): Promise<void> {
  requireAuthUid();
  if (!canManageTasks(actor.role)) {
    throw new Error('Only Full Control Admin can permanently delete operational tasks.');
  }

  try {
    const updatesSnap = await getDocs(collection(db, 'operational_tasks', task.id, 'updates'));
    if (!updatesSnap.empty) {
      const batch = writeBatch(db);
      updatesSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'operational_tasks', task.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `operational_tasks/${task.id}`);
  }

  await purgeDeletedRecordsEverywhere({ ids: [task.id, task.clientSubmissionId] });

  await logTaskAudit(
    actor,
    'OPERATIONAL_TASK_DELETED',
    task.id,
    `Permanently deleted task "${task.title}" (${task.wardName} Ward).`
  );
}

// --- OFFLINE QUEUE HELPERS FOR TASKS ---

export async function enqueueTaskCreateOffline(
  actor: UserAccount,
  input: {
    title: string;
    description: string;
    priority: TaskPriority;
    lgaId: LgaId;
    wardId: string;
    wardName: string;
    assignedOfficerUid: string;
    assignedOfficerName: string;
    startDateIso: string;
    dueDateIso: string;
  }
): Promise<OfflineQueuedItem> {
  return enqueueOfflineSubmission({
    ownerUid: actor.uid,
    reportType: 'TASK_CREATE',
    puId: '',
    puCode: 'TASK',
    puName: `${input.wardName} Ward`,
    lgaId: input.lgaId,
    wardId: input.wardId,
    summary: `Assign Task: ${input.title.slice(0, 70)} -> ${input.assignedOfficerName}`,
    payload: { ...input },
    status: 'PENDING_SYNC',
  });
}

export async function enqueueOfficerTaskUpdateOffline(
  actor: UserAccount,
  task: OperationalTask,
  input: OfficerTaskUpdateInput
): Promise<OfflineQueuedItem> {
  return enqueueOfflineSubmission({
    ownerUid: actor.uid,
    reportType: 'TASK_OFFICER_UPDATE',
    puId: '',
    puCode: task.id.slice(0, 18),
    puName: task.title.slice(0, 80),
    lgaId: task.lgaId,
    wardId: task.wardId,
    summary: `Task Update (${input.nextStatus}, ${Math.round(input.progressPercent)}%): ${task.title.slice(0, 60)}`,
    payload: {
      taskId: task.id,
      nextStatus: input.nextStatus,
      progressPercent: Math.round(input.progressPercent),
      fieldReport: input.fieldReport,
      delayReason: input.delayReason || '',
      evidenceBase64: input.evidenceBase64 || null,
      evidenceFileName: input.evidenceFileName || null,
    },
    status: 'PENDING_SYNC',
  });
}
