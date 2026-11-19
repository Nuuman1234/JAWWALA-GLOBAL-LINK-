import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  UserRole,
  type LgaId,
  type OperationalNote,
  type OperationalNoteCategory,
  type UserAccount,
} from '../types/fdmis';
import { toValidDocId } from './officialDirectory';
import {
  deleteLocalNote,
  deleteQueueItem,
  enqueueCoalescedNoteUpsert,
  enqueueOfflineSubmission,
  generateClientSubmissionId,
  getDeletedTombstones,
  getLocalNotes,
  getQueuedItems,
  purgeDeletedRecordsEverywhere,
  saveLocalNote,
} from './offlineQueue';

function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('network') ||
    msg.includes('unavailable') ||
    msg.includes('failed to get document') ||
    msg.includes('deadline-exceeded')
  );
}

function buildNotesQuery(user: UserAccount): Query | null {
  const base = collection(db, 'operational_notes');
  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    return base;
  }
  if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    return query(base, where('lgaId', 'in', ['all', 'funtua']));
  }
  if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    return query(base, where('lgaId', 'in', ['all', 'dandume']));
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
  return query(base, where('authorUid', '==', user.uid));
}

function noteSortTimeMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') {
    const t = new Date(val).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof (val as { seconds?: number }).seconds === 'number') {
    return (val as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function sortAndDedupeNotes(
  serverNotes: OperationalNote[],
  localNotes: OperationalNote[],
  tombstones: Set<string>,
  queuedDeletes: Set<string>,
  queuedStatusByNoteId: Map<string, { status: OperationalNote['syncState']; error?: string }>
): OperationalNote[] {
  const byId = new Map<string, OperationalNote>();

  for (const sNote of serverNotes) {
    const key = sNote.clientNoteId || sNote.id;
    if (tombstones.has(key) || tombstones.has(sNote.id) || queuedDeletes.has(key)) continue;
    const queueMeta = queuedStatusByNoteId.get(key);
    byId.set(key, {
      ...sNote,
      clientNoteId: key,
      syncState: queueMeta?.status || 'SYNCED',
      syncError: queueMeta?.error,
    });
  }

  for (const lNote of localNotes) {
    const key = lNote.clientNoteId || lNote.id;
    if (tombstones.has(key) || queuedDeletes.has(key)) continue;
    const queueMeta = queuedStatusByNoteId.get(key);
    const existing = byId.get(key);
    if (!existing || lNote.revision >= existing.revision || queueMeta?.status) {
      byId.set(key, {
        ...lNote,
        clientNoteId: key,
        syncState: queueMeta?.status || lNote.syncState || 'SYNCED',
        syncError: queueMeta?.error || lNote.syncError,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
      return a.isPinned ? -1 : 1;
    }
    return (
      noteSortTimeMs(b.updatedAt || b.createdAt) -
      noteSortTimeMs(a.updatedAt || a.createdAt)
    );
  });
}

export function observeOperationalNotes(
  user: UserAccount,
  onData: (items: OperationalNote[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = buildNotesQuery(user);
  if (!q) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    q,
    (snap) => {
      void (async () => {
        const tombstones = await getDeletedTombstones();
        const serverItems = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<OperationalNote, 'id'>),
          }))
          .filter((n) => !tombstones.has(n.id) && !tombstones.has(n.clientNoteId));
        onData(serverItems);
      })();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'operational_notes');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export interface NoteUpsertInput {
  clientNoteId?: string;
  title: string;
  content: string;
  category: OperationalNoteCategory;
  lgaId: 'all' | LgaId;
  wardId: string;
  puId: string;
  puCode: string;
  puName: string;
  isPinned: boolean;
  isTestData?: boolean;
  existingRevision?: number;
  existingCreatedAt?: OperationalNote['createdAt'];
}

export async function syncNoteUpsertToFirestore(
  actor: UserAccount,
  note: OperationalNote
): Promise<void> {
  const uid = auth.currentUser?.uid || actor.uid;
  const docId = toValidDocId(note.clientNoteId || note.id);
  const ref = doc(db, 'operational_notes', docId);
  const existingSnap = await getDoc(ref);

  const cleanTitle = note.title.trim().slice(0, 120);
  const cleanContent = note.content.trim().slice(0, 1000);
  if (cleanContent.length < 1) {
    throw new Error('Note message cannot be empty.');
  }

  const clientCreatedAtIso = (
    note.clientCreatedAtIso ||
    (typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString())
  ).slice(0, 64);

  if (existingSnap.exists()) {
    const existing = existingSnap.data() as OperationalNote;
    const nextRevision = Math.max(Number(note.revision) || 1, (Number(existing.revision) || 1));
    await setDoc(ref, {
      clientNoteId: docId,
      title: cleanTitle,
      content: cleanContent,
      category: note.category,
      lgaId: existing.lgaId || note.lgaId,
      wardId: existing.wardId ?? note.wardId,
      puId: existing.puId ?? note.puId,
      puCode: existing.puCode ?? note.puCode,
      puName: existing.puName ?? note.puName,
      authorUid: existing.authorUid,
      authorName: existing.authorName,
      isPinned: Boolean(note.isPinned),
      isTestData: Boolean(existing.isTestData ?? note.isTestData),
      revision: nextRevision,
      clientCreatedAtIso: existing.clientCreatedAtIso || clientCreatedAtIso,
      serverSyncedAt: serverTimestamp(),
      createdAt: existing.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      clientNoteId: docId,
      title: cleanTitle,
      content: cleanContent,
      category: note.category,
      lgaId: note.lgaId,
      wardId: note.wardId.slice(0, 128),
      puId: note.puId.slice(0, 128),
      puCode: note.puCode.slice(0, 40),
      puName: note.puName.slice(0, 160),
      authorUid: uid,
      authorName: actor.displayName.slice(0, 120),
      isPinned: Boolean(note.isPinned),
      isTestData: Boolean(note.isTestData),
      revision: Math.max(1, Math.floor(note.revision || 1)),
      clientCreatedAtIso,
      serverSyncedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function saveOperationalNote(
  actor: UserAccount,
  input: NoteUpsertInput
): Promise<{ note: OperationalNote; mode: 'synced' | 'offline' }> {
  const cleanContent = input.content.trim().slice(0, 1000);
  if (cleanContent.length < 1) {
    throw new Error('Enter at least 1 character for the note or message.');
  }
  const cleanTitle = input.title.trim().slice(0, 120);
  const clientNoteId = toValidDocId(
    input.clientNoteId || generateClientSubmissionId('note')
  );
  const nowIso = new Date().toISOString();
  const nextRevision = input.existingRevision ? input.existingRevision + 1 : 1;

  const localNote: OperationalNote = {
    id: clientNoteId,
    clientNoteId,
    title: cleanTitle,
    content: cleanContent,
    category: input.category,
    lgaId: input.lgaId,
    wardId: input.wardId.slice(0, 128),
    puId: input.puId.slice(0, 128),
    puCode: input.puCode.slice(0, 40),
    puName: input.puName.slice(0, 160),
    authorUid: actor.uid,
    authorName: actor.displayName.slice(0, 120),
    isPinned: Boolean(input.isPinned),
    isTestData: Boolean(input.isTestData),
    revision: nextRevision,
    clientCreatedAtIso:
      typeof input.existingCreatedAt === 'string' ? input.existingCreatedAt : nowIso,
    createdAt: input.existingCreatedAt || nowIso,
    updatedAt: nowIso,
    syncState: 'PENDING_SYNC',
  };

  // Persist locally first so offline access is immediate and durable across app restarts
  await saveLocalNote(localNote);

  if (!navigator.onLine || !auth.currentUser) {
    await enqueueCoalescedNoteUpsert({
      ownerUid: actor.uid,
      note: localNote,
      puCode: localNote.puCode,
      puName: localNote.puName || 'Operational Note',
    });
    return { note: localNote, mode: 'offline' };
  }

  try {
    await syncNoteUpsertToFirestore(actor, localNote);
    const syncedNote: OperationalNote = { ...localNote, syncState: 'SYNCED' };
    await saveLocalNote(syncedNote);
    // Remove any previously queued upsert for the same clientNoteId so no duplicate sync happens
    await deleteQueueItem(`note_up_${clientNoteId}`);
    return { note: syncedNote, mode: 'synced' };
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      await enqueueCoalescedNoteUpsert({
        ownerUid: actor.uid,
        note: localNote,
        puCode: localNote.puCode,
        puName: localNote.puName || 'Operational Note',
      });
      return { note: localNote, mode: 'offline' };
    }
    const failedNote: OperationalNote = {
      ...localNote,
      syncState: 'SYNC_FAILED',
      syncError: err instanceof Error ? err.message : 'Unable to save note.',
    };
    await saveLocalNote(failedNote);
    throw err;
  }
}

export async function syncNoteDeleteToFirestore(clientNoteId: string): Promise<void> {
  const docId = toValidDocId(clientNoteId);
  const ref = doc(db, 'operational_notes', docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await deleteDoc(ref);
}

export async function deleteOperationalNote(
  actor: UserAccount,
  note: OperationalNote
): Promise<'deleted' | 'queued_offline'> {
  const docId = toValidDocId(note.clientNoteId || note.id);

  // Permanently clear local copy + drafts + snapshots + add tombstone immediately
  await deleteLocalNote(docId);
  await deleteQueueItem(`note_up_${docId}`);
  await purgeDeletedRecordsEverywhere({ ids: [docId, note.id] });

  if (!navigator.onLine || !auth.currentUser) {
    await enqueueOfflineSubmission({
      clientSubmissionId: `note_del_${docId}`,
      ownerUid: actor.uid,
      reportType: 'NOTE_DELETE',
      puId: note.puId || '',
      puCode: note.puCode || '',
      puName: note.puName || 'Operational Note',
      lgaId: note.lgaId,
      wardId: note.wardId || '',
      summary: `Delete Note: ${note.title || note.content.slice(0, 50)}`,
      payload: {
        clientNoteId: docId,
      },
      status: 'PENDING_SYNC',
    });
    return 'queued_offline';
  }

  try {
    await syncNoteDeleteToFirestore(docId);
    await deleteQueueItem(`note_del_${docId}`);
    return 'deleted';
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      await enqueueOfflineSubmission({
        clientSubmissionId: `note_del_${docId}`,
        ownerUid: actor.uid,
        reportType: 'NOTE_DELETE',
        puId: note.puId || '',
        puCode: note.puCode || '',
        puName: note.puName || 'Operational Note',
        lgaId: note.lgaId,
        wardId: note.wardId || '',
        summary: `Delete Note: ${note.title || note.content.slice(0, 50)}`,
        payload: {
          clientNoteId: docId,
        },
        status: 'PENDING_SYNC',
      });
      return 'queued_offline';
    }
    handleFirestoreError(err, OperationType.DELETE, `operational_notes/${docId}`);
  }
}

export async function buildMergedOperationalNotes(
  actorUid: string,
  serverNotes: OperationalNote[]
): Promise<OperationalNote[]> {
  const [localNotes, tombstones, queueItems] = await Promise.all([
    getLocalNotes(actorUid),
    getDeletedTombstones(),
    getQueuedItems(actorUid),
  ]);

  const queuedDeletes = new Set<string>();
  const queuedStatusByNoteId = new Map<
    string,
    { status: OperationalNote['syncState']; error?: string }
  >();

  queueItems.forEach((item) => {
    const cid = typeof item.payload?.clientNoteId === 'string' ? item.payload.clientNoteId : '';
    if (!cid) return;
    if (item.reportType === 'NOTE_DELETE') {
      queuedDeletes.add(cid);
    } else if (item.reportType === 'NOTE_UPSERT') {
      queuedStatusByNoteId.set(cid, {
        status: item.status,
        error: item.errorMessage,
      });
    }
  });

  return sortAndDedupeNotes(
    serverNotes,
    localNotes,
    tombstones,
    queuedDeletes,
    queuedStatusByNoteId
  );
}
