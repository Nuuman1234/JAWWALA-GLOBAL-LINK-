import type {
  LgaId,
  OfflinePruneReport,
  OfflineQueueStatus,
  OfflineQueuedItem,
  OfflineReportType,
  OperationalNote,
  PendingOfflineRegistration,
  UserAccount,
} from '../types/fdmis';

const DB_NAME = 'fdmis_offline_db';
const DB_VERSION = 3;
const QUEUE_STORE = 'queue';
const DRAFTS_STORE = 'drafts';
const SNAPSHOTS_STORE = 'snapshots';
const NOTES_STORE = 'notes';
const TOMBSTONES_STORE = 'tombstones';
const PENDING_REG_STORE = 'pending_registrations';

const LS_QUEUE_KEY = 'fdmis_offline_queue_v1';
const LS_DRAFTS_KEY = 'fdmis_offline_drafts_v1';
const LS_SNAPSHOTS_KEY = 'fdmis_offline_snapshots_v2';
const LS_NOTES_KEY = 'fdmis_offline_notes_v2';
const LS_TOMBSTONES_KEY = 'fdmis_deleted_tombstones_v2';
const LS_PENDING_REG_KEY = 'fdmis_pending_registrations_v1';
const LS_SESSION_PREFIX = 'fdmis_cached_session_v2_';

export const GLOBAL_SNAPSHOT_UID = 'global';

export const DEFAULT_PRUNE_TTLS = {
  snapshotTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days for volatile operational caches
  referenceSnapshotTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days for directory/party catalogs
  syncedQueueTtlMs: 24 * 60 * 60 * 1000, // 24 hours after sync
  stuckSyncingResetMs: 10 * 60 * 1000, // reset interrupted SYNCING after 10 minutes
  draftTtlMs: 14 * 24 * 60 * 60 * 1000, // 14 days for abandoned drafts
  tombstoneTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days retention for deleted record IDs
  pendingRegTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days for offline queued registrations
} as const;

const listeners = new Set<() => void>();
const noteListeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  });
}

function notifyNoteListeners() {
  noteListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeOfflineQueue(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function subscribeLocalNotes(callback: () => void): () => void {
  noteListeners.add(callback);
  return () => {
    noteListeners.delete(callback);
  };
}

export function generateClientSubmissionId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'clientSubmissionId' });
        }
        if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
          db.createObjectStore(DRAFTS_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
          db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(NOTES_STORE)) {
          db.createObjectStore(NOTES_STORE, { keyPath: 'clientNoteId' });
        }
        if (!db.objectStoreNames.contains(TOMBSTONES_STORE)) {
          db.createObjectStore(TOMBSTONES_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PENDING_REG_STORE)) {
          db.createObjectStore(PENDING_REG_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLs<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLs<T>(key: string, val: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // storage quota ignored
  }
}

// ---------- QUEUE OPERATIONS ----------

export async function getQueuedItems(ownerUid: string): Promise<OfflineQueuedItem[]> {
  const db = await openDb();
  if (!db) {
    return readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, [])
      .filter((i) => i.ownerUid === ownerUid)
      .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []) as OfflineQueuedItem[];
        resolve(
          all
            .filter((i) => i.ownerUid === ownerUid)
            .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
        );
      };
      req.onerror = () =>
        resolve(readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter((i) => i.ownerUid === ownerUid));
    } catch {
      resolve(readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter((i) => i.ownerUid === ownerUid));
    }
  });
}

export async function enqueueOfflineSubmission(input: {
  clientSubmissionId?: string;
  ownerUid: string;
  reportType: OfflineReportType;
  puId: string;
  puCode: string;
  puName: string;
  lgaId: LgaId | 'all';
  wardId: string;
  summary: string;
  payload: Record<string, unknown>;
  status?: OfflineQueueStatus;
}): Promise<OfflineQueuedItem> {
  const now = new Date().toISOString();
  const item: OfflineQueuedItem = {
    clientSubmissionId:
      input.clientSubmissionId || generateClientSubmissionId(input.reportType.toLowerCase()),
    ownerUid: input.ownerUid,
    reportType: input.reportType,
    puId: input.puId,
    puCode: input.puCode,
    puName: input.puName,
    lgaId: input.lgaId,
    wardId: input.wardId,
    summary: input.summary,
    payload: input.payload,
    status: input.status || 'PENDING_SYNC',
    retryCount: 0,
    createdAtIso: now,
    updatedAtIso: now,
  };

  const db = await openDb();
  if (!db) {
    const existing = readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter(
      (i) => i.clientSubmissionId !== item.clientSubmissionId
    );
    writeLs(LS_QUEUE_KEY, [item, ...existing]);
    notifyListeners();
    return item;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).put(item);
      tx.oncomplete = () => {
        notifyListeners();
        resolve(item);
      };
      tx.onerror = () => {
        const existing = readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter(
          (i) => i.clientSubmissionId !== item.clientSubmissionId
        );
        writeLs(LS_QUEUE_KEY, [item, ...existing]);
        notifyListeners();
        resolve(item);
      };
    } catch {
      const existing = readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter(
        (i) => i.clientSubmissionId !== item.clientSubmissionId
      );
      writeLs(LS_QUEUE_KEY, [item, ...existing]);
      notifyListeners();
      resolve(item);
    }
  });
}

export async function updateQueueItemStatus(
  clientSubmissionId: string,
  status: OfflineQueueStatus,
  errorMessage?: string
): Promise<void> {
  const db = await openDb();
  const now = new Date().toISOString();

  if (!db) {
    const updated = readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).map((i) => {
      if (i.clientSubmissionId !== clientSubmissionId) return i;
      const nextRetry = status === 'SYNC_FAILED' ? (i.retryCount ?? 0) + 1 : i.retryCount ?? 0;
      const next: OfflineQueuedItem = {
        ...i,
        status,
        retryCount: nextRetry,
        updatedAtIso: now,
      };
      if (errorMessage) next.errorMessage = errorMessage;
      else delete next.errorMessage;
      return next;
    });
    writeLs(LS_QUEUE_KEY, updated);
    notifyListeners();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      const getReq = store.get(clientSubmissionId);
      getReq.onsuccess = () => {
        const existing = getReq.result as OfflineQueuedItem | undefined;
        if (existing) {
          const nextRetry =
            status === 'SYNC_FAILED' ? (existing.retryCount ?? 0) + 1 : existing.retryCount ?? 0;
          const next: OfflineQueuedItem = {
            ...existing,
            status,
            retryCount: nextRetry,
            updatedAtIso: now,
          };
          if (errorMessage) next.errorMessage = errorMessage;
          else delete next.errorMessage;
          store.put(next);
        }
      };
      tx.oncomplete = () => {
        notifyListeners();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteQueueItem(clientSubmissionId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    writeLs(
      LS_QUEUE_KEY,
      readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter(
        (i) => i.clientSubmissionId !== clientSubmissionId
      )
    );
    notifyListeners();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).delete(clientSubmissionId);
      tx.oncomplete = () => {
        notifyListeners();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearSyncedQueueItems(ownerUid: string): Promise<void> {
  const items = await getQueuedItems(ownerUid);
  const toDelete = items.filter((i) => i.status === 'SYNCED').map((i) => i.clientSubmissionId);
  if (toDelete.length === 0) return;

  const db = await openDb();
  if (!db) {
    writeLs(
      LS_QUEUE_KEY,
      readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []).filter(
        (i) => !toDelete.includes(i.clientSubmissionId)
      )
    );
    notifyListeners();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      toDelete.forEach((id) => store.delete(id));
      tx.oncomplete = () => {
        notifyListeners();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- DRAFTS OPERATIONS ----------

export async function saveDraft(key: string, data: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  const record = { key, data, updatedAtIso: new Date().toISOString() };
  if (!db) {
    const all = readLs<Record<string, unknown>>(LS_DRAFTS_KEY, {});
    all[key] = record;
    writeLs(LS_DRAFTS_KEY, all);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DRAFTS_STORE, 'readwrite');
      tx.objectStore(DRAFTS_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadDraft<T extends Record<string, unknown>>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    const all = readLs<Record<string, { data: T }>>(LS_DRAFTS_KEY, {});
    return all[key]?.data || null;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFTS_STORE, 'readonly');
      const req = tx.objectStore(DRAFTS_STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as { data?: T } | undefined;
        resolve(rec?.data ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function clearDraft(key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    const all = readLs<Record<string, unknown>>(LS_DRAFTS_KEY, {});
    delete all[key];
    writeLs(LS_DRAFTS_KEY, all);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DRAFTS_STORE, 'readwrite');
      tx.objectStore(DRAFTS_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- LOCAL NOTES STORE (OFFLINE-FIRST) ----------

export async function getLocalNotes(ownerUid: string): Promise<OperationalNote[]> {
  const db = await openDb();
  if (!db) {
    return readLs<OperationalNote[]>(LS_NOTES_KEY, []).filter(
      (n) => n.authorUid === ownerUid || n.lgaId !== undefined
    );
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const req = tx.objectStore(NOTES_STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []) as OperationalNote[];
        resolve(all);
      };
      req.onerror = () => resolve(readLs<OperationalNote[]>(LS_NOTES_KEY, []));
    } catch {
      resolve(readLs<OperationalNote[]>(LS_NOTES_KEY, []));
    }
  });
}

export async function saveLocalNote(note: OperationalNote): Promise<void> {
  const db = await openDb();
  if (!db) {
    const existing = readLs<OperationalNote[]>(LS_NOTES_KEY, []).filter(
      (n) => n.clientNoteId !== note.clientNoteId && n.id !== note.id
    );
    writeLs(LS_NOTES_KEY, [note, ...existing]);
    notifyNoteListeners();
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      tx.objectStore(NOTES_STORE).put(note);
      tx.oncomplete = () => {
        notifyNoteListeners();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteLocalNote(clientNoteId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    writeLs(
      LS_NOTES_KEY,
      readLs<OperationalNote[]>(LS_NOTES_KEY, []).filter(
        (n) => n.clientNoteId !== clientNoteId && n.id !== clientNoteId
      )
    );
    notifyNoteListeners();
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      tx.objectStore(NOTES_STORE).delete(clientNoteId);
      tx.oncomplete = () => {
        notifyNoteListeners();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function enqueueCoalescedNoteUpsert(input: {
  ownerUid: string;
  note: OperationalNote;
  puCode?: string;
  puName?: string;
}): Promise<OfflineQueuedItem> {
  const existingQueue = await getQueuedItems(input.ownerUid);
  const existingUpsert = existingQueue.find(
    (q) =>
      q.reportType === 'NOTE_UPSERT' &&
      (q.payload.clientNoteId === input.note.clientNoteId ||
        q.clientSubmissionId === `note_${input.note.clientNoteId}`)
  );

  const clientSubmissionId =
    existingUpsert?.clientSubmissionId || `note_up_${input.note.clientNoteId}`;

  return enqueueOfflineSubmission({
    clientSubmissionId,
    ownerUid: input.ownerUid,
    reportType: 'NOTE_UPSERT',
    puId: input.note.puId || '',
    puCode: input.puCode || '',
    puName: input.puName || 'Field Note',
    lgaId: input.note.lgaId,
    wardId: input.note.wardId || '',
    summary: `Note: ${input.note.title || input.note.content.slice(0, 60)}`,
    payload: {
      clientNoteId: input.note.clientNoteId,
      title: input.note.title,
      content: input.note.content,
      category: input.note.category,
      lgaId: input.note.lgaId,
      wardId: input.note.wardId,
      puId: input.note.puId,
      puCode: input.note.puCode || '',
      puName: input.note.puName || '',
      isPinned: input.note.isPinned,
      revision: input.note.revision,
      isTestData: Boolean(input.note.isTestData),
      updatedAtIso:
        typeof input.note.updatedAt === 'string'
          ? input.note.updatedAt
          : new Date().toISOString(),
    },
    status: 'PENDING_SYNC',
  });
}

// ---------- OFFLINE SESSION & COLLECTION SNAPSHOTS ----------

function serializeForCache(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const maybeTs = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        return maybeTs.toDate().toISOString();
      } catch {
        return null;
      }
    }
    if (typeof maybeTs.seconds === 'number' && Object.keys(value).length <= 2) {
      return new Date(maybeTs.seconds * 1000).toISOString();
    }
    if (Array.isArray(value)) {
      return value.map((item) => serializeForCache(item));
    }
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = serializeForCache(v);
    });
    return out;
  }
  return value;
}

export function saveCachedSession(account: UserAccount): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      `${LS_SESSION_PREFIX}${account.uid}`,
      JSON.stringify(serializeForCache(account))
    );
  } catch {
    // ignore quota errors
  }
}

export function loadCachedSession(uid: string): UserAccount | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${LS_SESSION_PREFIX}${uid}`);
    return raw ? (JSON.parse(raw) as UserAccount) : null;
  } catch {
    return null;
  }
}

export function clearCachedSession(uid?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (uid) {
      localStorage.removeItem(`${LS_SESSION_PREFIX}${uid}`);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_SESSION_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

export async function saveCollectionSnapshot<T>(
  uid: string,
  collectionKey: string,
  data: T
): Promise<void> {
  const key = `${uid}::${collectionKey}`;
  const serialized = serializeForCache(data) as T;
  const record = { key, uid, collectionKey, data: serialized, updatedAtIso: new Date().toISOString() };

  const db = await openDb();
  if (!db) {
    const all = readLs<Record<string, { data: unknown }>>(LS_SNAPSHOTS_KEY, {});
    all[key] = record;
    writeLs(LS_SNAPSHOTS_KEY, all);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadCollectionSnapshot<T>(
  uid: string,
  collectionKey: string
): Promise<T | null> {
  const key = `${uid}::${collectionKey}`;
  const db = await openDb();
  if (!db) {
    const all = readLs<Record<string, { data: T }>>(LS_SNAPSHOTS_KEY, {});
    return all[key]?.data ?? null;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOTS_STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as { data?: T } | undefined;
        resolve(rec?.data ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveGlobalSnapshot<T>(collectionKey: string, data: T): Promise<void> {
  return saveCollectionSnapshot(GLOBAL_SNAPSHOT_UID, collectionKey, data);
}

export async function loadGlobalSnapshot<T>(collectionKey: string): Promise<T | null> {
  return loadCollectionSnapshot<T>(GLOBAL_SNAPSHOT_UID, collectionKey);
}

export async function purgeAllUserSnapshots(uid?: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    if (!uid) {
      writeLs(LS_SNAPSHOTS_KEY, {});
      writeLs(LS_NOTES_KEY, []);
      writeLs(LS_DRAFTS_KEY, {});
    } else {
      const all = readLs<Record<string, { uid?: string }>>(LS_SNAPSHOTS_KEY, {});
      Object.keys(all).forEach((k) => {
        if (k.startsWith(`${uid}::`) || all[k]?.uid === uid) delete all[k];
      });
      writeLs(LS_SNAPSHOTS_KEY, all);
    }
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([SNAPSHOTS_STORE], 'readwrite');
      const store = tx.objectStore(SNAPSHOTS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as Array<{ key: string; uid?: string }>;
        rows.forEach((row) => {
          if (!uid || row.uid === uid || row.key.startsWith(`${uid}::`)) {
            store.delete(row.key);
          }
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- DELETION TOMBSTONES & COMPLETE LOCAL PURGE ----------

const OPERATIONAL_SNAPSHOT_KEYS = new Set([
  'results',
  'approvedPuResults',
  'aggregatedResults',
  'publicResults',
  'incidents',
  'checkIns',
  'notifications',
  'timelineEvents',
  'operationalNotes',
  'reportAttachments',
]);

export async function recordDeletedTombstones(ids: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Boolean(id && id.trim()))));
  if (uniqueIds.length === 0) return;

  const now = new Date().toISOString();
  const db = await openDb();
  if (!db) {
    const existing = readLs<Record<string, string>>(LS_TOMBSTONES_KEY, {});
    uniqueIds.forEach((id) => {
      existing[id] = now;
    });
    writeLs(LS_TOMBSTONES_KEY, existing);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TOMBSTONES_STORE, 'readwrite');
      const store = tx.objectStore(TOMBSTONES_STORE);
      uniqueIds.forEach((id) => store.put({ id, deletedAtIso: now }));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getDeletedTombstones(): Promise<Set<string>> {
  const db = await openDb();
  if (!db) {
    return new Set(Object.keys(readLs<Record<string, string>>(LS_TOMBSTONES_KEY, {})));
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(TOMBSTONES_STORE, 'readonly');
      const req = tx.objectStore(TOMBSTONES_STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as Array<{ id: string }>;
        resolve(new Set(rows.map((r) => r.id)));
      };
      req.onerror = () => resolve(new Set());
    } catch {
      resolve(new Set());
    }
  });
}

export async function clearTombstoneIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) {
    const existing = readLs<Record<string, string>>(LS_TOMBSTONES_KEY, {});
    ids.forEach((id) => delete existing[id]);
    writeLs(LS_TOMBSTONES_KEY, existing);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TOMBSTONES_STORE, 'readwrite');
      const store = tx.objectStore(TOMBSTONES_STORE);
      ids.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function purgeDeletedRecordsEverywhere(params: {
  ids: string[];
  puIdsForApproved?: string[];
  wipeAllOperational?: boolean;
}): Promise<void> {
  const idSet = new Set(params.ids.filter(Boolean));
  const approvedPuSet = new Set((params.puIdsForApproved || []).filter(Boolean));
  const allTombstoneIds = [...idSet, ...approvedPuSet];

  if (allTombstoneIds.length > 0) {
    await recordDeletedTombstones(allTombstoneIds);
  }

  const matchesDeletedQueueItem = (item: OfflineQueuedItem): boolean => {
    if (params.wipeAllOperational) return true;
    if (idSet.has(item.clientSubmissionId)) return true;
    const p = item.payload || {};
    if (typeof p.targetResultId === 'string' && idSet.has(p.targetResultId)) return true;
    if (typeof p.clientNoteId === 'string' && idSet.has(p.clientNoteId)) return true;
    if (item.reportType === 'RESULT_SUBMISSION' && approvedPuSet.has(item.puId)) return true;
    return false;
  };

  const matchesDeletedDraftKey = (key: string): boolean => {
    if (params.wipeAllOperational) {
      return (
        key.startsWith('result_') ||
        key.startsWith('incident_') ||
        key.startsWith('checkin_') ||
        key.startsWith('note_')
      );
    }
    for (const id of idSet) {
      if (key.includes(id)) return true;
    }
    for (const puId of approvedPuSet) {
      if (key === `result_${puId}`) return true;
    }
    return false;
  };

  // Update LS fallbacks cleanly even if IndexedDB is used
  const lsQ = readLs<OfflineQueuedItem[]>(LS_QUEUE_KEY, []);
  if (lsQ.length > 0) {
    writeLs(LS_QUEUE_KEY, lsQ.filter((item) => !matchesDeletedQueueItem(item)));
  }

  const lsNotes = readLs<OperationalNote[]>(LS_NOTES_KEY, []);
  if (lsNotes.length > 0) {
    writeLs(
      LS_NOTES_KEY,
      lsNotes.filter((n) => !params.wipeAllOperational && !idSet.has(n.id) && !idSet.has(n.clientNoteId))
    );
  }

  const lsDrafts = readLs<Record<string, unknown>>(LS_DRAFTS_KEY, {});
  Object.keys(lsDrafts).forEach((k) => {
    if (matchesDeletedDraftKey(k)) delete lsDrafts[k];
  });
  writeLs(LS_DRAFTS_KEY, lsDrafts);

  const filterSnapshotArray = (collectionKey: string, data: unknown): unknown => {
    if (!OPERATIONAL_SNAPSHOT_KEYS.has(collectionKey) || !Array.isArray(data)) return data;
    if (params.wipeAllOperational) return [];
    return data.filter((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return true;
      const rec = entry as Record<string, unknown>;
      const recId = typeof rec.id === 'string' ? rec.id : '';
      const recClientNoteId = typeof rec.clientNoteId === 'string' ? rec.clientNoteId : '';
      const recPuId = typeof rec.puId === 'string' ? rec.puId : '';
      const recSourceId =
        typeof rec.sourceSubmissionId === 'string' ? rec.sourceSubmissionId : '';

      if (recId && (idSet.has(recId) || approvedPuSet.has(recId))) return false;
      if (recClientNoteId && idSet.has(recClientNoteId)) return false;
      if (recSourceId && idSet.has(recSourceId)) return false;
      if (
        (collectionKey === 'approvedPuResults' || collectionKey === 'publicResults') &&
        recPuId &&
        approvedPuSet.has(recPuId)
      ) {
        return false;
      }
      return true;
    });
  };

  const lsSnaps = readLs<
    Record<string, { key?: string; uid?: string; collectionKey?: string; data?: unknown; updatedAtIso?: string }>
  >(LS_SNAPSHOTS_KEY, {});
  if (Object.keys(lsSnaps).length > 0) {
    Object.entries(lsSnaps).forEach(([k, snap]) => {
      const colKey = snap?.collectionKey || k.split('::')[1] || '';
      if (OPERATIONAL_SNAPSHOT_KEYS.has(colKey)) {
        lsSnaps[k] = {
          ...snap,
          data: filterSnapshotArray(colKey, snap?.data),
          updatedAtIso: new Date().toISOString(),
        };
      }
    });
    writeLs(LS_SNAPSHOTS_KEY, lsSnaps);
  }

  const db = await openDb();
  if (!db) {
    notifyListeners();
    notifyNoteListeners();
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(
        [QUEUE_STORE, DRAFTS_STORE, NOTES_STORE, SNAPSHOTS_STORE],
        'readwrite'
      );

      // 1. Purge queue store
      const qStore = tx.objectStore(QUEUE_STORE);
      const qReq = qStore.getAll();
      qReq.onsuccess = () => {
        const items = (qReq.result || []) as OfflineQueuedItem[];
        items.forEach((item) => {
          if (matchesDeletedQueueItem(item)) {
            qStore.delete(item.clientSubmissionId);
          }
        });
      };

      // 2. Purge drafts store
      const dStore = tx.objectStore(DRAFTS_STORE);
      const dReq = dStore.getAll();
      dReq.onsuccess = () => {
        const drafts = (dReq.result || []) as Array<{ key: string }>;
        drafts.forEach((d) => {
          if (matchesDeletedDraftKey(d.key)) {
            dStore.delete(d.key);
          }
        });
      };

      // 3. Purge local notes store
      const nStore = tx.objectStore(NOTES_STORE);
      const nReq = nStore.getAll();
      nReq.onsuccess = () => {
        const notes = (nReq.result || []) as OperationalNote[];
        notes.forEach((n) => {
          if (params.wipeAllOperational || idSet.has(n.id) || idSet.has(n.clientNoteId)) {
            nStore.delete(n.clientNoteId);
          }
        });
      };

      // 4. Purge matching items inside cached snapshots so old records/dates cannot reappear
      const sStore = tx.objectStore(SNAPSHOTS_STORE);
      const sReq = sStore.getAll();
      sReq.onsuccess = () => {
        const snapshots = (sReq.result || []) as Array<{
          key: string;
          uid: string;
          collectionKey: string;
          data: unknown;
          updatedAtIso: string;
        }>;
        snapshots.forEach((snap) => {
          if (!OPERATIONAL_SNAPSHOT_KEYS.has(snap.collectionKey)) return;
          if (!Array.isArray(snap.data)) return;

          if (params.wipeAllOperational) {
            sStore.put({
              ...snap,
              data: [],
              updatedAtIso: new Date().toISOString(),
            });
            return;
          }

          const filtered = snap.data.filter((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return true;
            const rec = entry as Record<string, unknown>;
            const recId = typeof rec.id === 'string' ? rec.id : '';
            const recClientNoteId =
              typeof rec.clientNoteId === 'string' ? rec.clientNoteId : '';
            const recPuId = typeof rec.puId === 'string' ? rec.puId : '';
            const recSourceId =
              typeof rec.sourceSubmissionId === 'string' ? rec.sourceSubmissionId : '';

            if (recId && (idSet.has(recId) || approvedPuSet.has(recId))) return false;
            if (recClientNoteId && idSet.has(recClientNoteId)) return false;
            if (recSourceId && idSet.has(recSourceId)) return false;
            if (
              (snap.collectionKey === 'approvedPuResults' ||
                snap.collectionKey === 'publicResults') &&
              recPuId &&
              approvedPuSet.has(recPuId)
            ) {
              return false;
            }
            return true;
          });

          sStore.put({
            ...snap,
            data: filtered,
            updatedAtIso: new Date().toISOString(),
          });
        });
      };

      tx.oncomplete = () => {
        notifyListeners();
        notifyNoteListeners();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- OFFLINE QUEUED REGISTRATIONS (PRE-VERIFICATION) ----------

export async function getPendingOfflineRegistrations(): Promise<PendingOfflineRegistration[]> {
  const db = await openDb();
  if (!db) {
    return readLs<PendingOfflineRegistration[]>(LS_PENDING_REG_KEY, []).sort((a, b) =>
      b.createdAtIso.localeCompare(a.createdAtIso)
    );
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PENDING_REG_STORE, 'readonly');
      const req = tx.objectStore(PENDING_REG_STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as PendingOfflineRegistration[];
        resolve(rows.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso)));
      };
      req.onerror = () => resolve(readLs<PendingOfflineRegistration[]>(LS_PENDING_REG_KEY, []));
    } catch {
      resolve(readLs<PendingOfflineRegistration[]>(LS_PENDING_REG_KEY, []));
    }
  });
}

export async function savePendingOfflineRegistration(
  record: PendingOfflineRegistration
): Promise<PendingOfflineRegistration> {
  const existing = readLs<PendingOfflineRegistration[]>(LS_PENDING_REG_KEY, []).filter(
    (r) => r.id !== record.id && r.phoneHash !== record.phoneHash
  );
  writeLs(LS_PENDING_REG_KEY, [record, ...existing]);

  const db = await openDb();
  if (!db) return record;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PENDING_REG_STORE, 'readwrite');
      tx.objectStore(PENDING_REG_STORE).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => resolve(record);
    } catch {
      resolve(record);
    }
  });
}

export async function updatePendingOfflineRegistrationStatus(
  id: string,
  status: PendingOfflineRegistration['status'],
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  const updatedLs = readLs<PendingOfflineRegistration[]>(LS_PENDING_REG_KEY, []).map((r) => {
    if (r.id !== id) return r;
    const next: PendingOfflineRegistration = { ...r, status, updatedAtIso: now };
    if (errorMessage) next.errorMessage = errorMessage;
    else delete next.errorMessage;
    return next;
  });
  writeLs(LS_PENDING_REG_KEY, updatedLs);

  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PENDING_REG_STORE, 'readwrite');
      const store = tx.objectStore(PENDING_REG_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result as PendingOfflineRegistration | undefined;
        if (rec) {
          const next: PendingOfflineRegistration = { ...rec, status, updatedAtIso: now };
          if (errorMessage) next.errorMessage = errorMessage;
          else delete next.errorMessage;
          store.put(next);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deletePendingOfflineRegistration(id: string): Promise<void> {
  writeLs(
    LS_PENDING_REG_KEY,
    readLs<PendingOfflineRegistration[]>(LS_PENDING_REG_KEY, []).filter((r) => r.id !== id)
  );
  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PENDING_REG_STORE, 'readwrite');
      tx.objectStore(PENDING_REG_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- PROACTIVE STARTUP CLEANUP UTILITY ----------

const REFERENCE_SNAPSHOT_KEYS = new Set([
  'wards',
  'pollingUnits',
  'puAssignments',
  'partyConfigs',
  'emergencyContacts',
  'locationCatalog',
]);

function parseIsoMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function isQueueItemOrphanedOrExpired(
  item: unknown,
  tombstones: Set<string>,
  nowMs: number,
  syncedQueueTtlMs: number
): { remove: boolean; resetToPending: boolean; updated?: OfflineQueuedItem } {
  if (!item || typeof item !== 'object') {
    return { remove: true, resetToPending: false };
  }
  const q = item as Partial<OfflineQueuedItem>;
  if (
    typeof q.clientSubmissionId !== 'string' ||
    !q.clientSubmissionId.trim() ||
    typeof q.ownerUid !== 'string' ||
    !q.ownerUid.trim() ||
    typeof q.reportType !== 'string' ||
    !q.payload ||
    typeof q.payload !== 'object'
  ) {
    return { remove: true, resetToPending: false };
  }

  const p = q.payload as Record<string, unknown>;
  if (
    tombstones.has(q.clientSubmissionId) ||
    (typeof p.id === 'string' && tombstones.has(p.id)) ||
    (typeof p.targetResultId === 'string' && tombstones.has(p.targetResultId)) ||
    (typeof p.sourceSubmissionId === 'string' && tombstones.has(p.sourceSubmissionId)) ||
    (typeof p.clientNoteId === 'string' && tombstones.has(p.clientNoteId))
  ) {
    return { remove: true, resetToPending: false };
  }

  const tsMs = parseIsoMs(q.updatedAtIso) ?? parseIsoMs(q.createdAtIso);
  if (q.status === 'SYNCED') {
    if (tsMs === null || nowMs - tsMs > syncedQueueTtlMs) {
      return { remove: true, resetToPending: false };
    }
  }

  if (q.status === 'SYNCING') {
    if (tsMs === null || nowMs - tsMs > DEFAULT_PRUNE_TTLS.stuckSyncingResetMs) {
      return {
        remove: false,
        resetToPending: true,
        updated: {
          ...(q as OfflineQueuedItem),
          status: 'PENDING_SYNC',
          updatedAtIso: new Date(nowMs).toISOString(),
        },
      };
    }
  }

  return { remove: false, resetToPending: false };
}

function isDraftOrphanedOrExpired(
  draft: unknown,
  fallbackKey: string,
  tombstones: Set<string>,
  nowMs: number,
  draftTtlMs: number
): boolean {
  if (!draft || typeof draft !== 'object') return true;
  const rec = draft as { key?: unknown; data?: unknown; updatedAtIso?: unknown };
  const key = typeof rec.key === 'string' ? rec.key : fallbackKey;
  if (!key || !key.trim()) return true;
  if (!rec.data || typeof rec.data !== 'object') return true;

  for (const deadId of tombstones) {
    if (deadId && key.includes(deadId)) return true;
  }

  const updatedMs = parseIsoMs(rec.updatedAtIso);
  if (updatedMs === null || nowMs - updatedMs > draftTtlMs) {
    return true;
  }
  return false;
}

function isNoteOrphaned(note: unknown, tombstones: Set<string>): boolean {
  if (!note || typeof note !== 'object') return true;
  const n = note as Partial<OperationalNote>;
  if (
    typeof n.clientNoteId !== 'string' ||
    !n.clientNoteId.trim() ||
    typeof n.authorUid !== 'string' ||
    !n.authorUid.trim() ||
    typeof n.content !== 'string'
  ) {
    return true;
  }
  if (tombstones.has(n.clientNoteId)) return true;
  if (typeof n.id === 'string' && n.id && tombstones.has(n.id)) return true;
  return false;
}

function pruneSnapshotRecord(
  snap: unknown,
  fallbackKey: string,
  tombstones: Set<string>,
  nowMs: number,
  snapshotTtlMs: number,
  referenceSnapshotTtlMs: number
): {
  remove: boolean;
  prunedEntries: number;
  updated?: {
    key: string;
    uid: string;
    collectionKey: string;
    data: unknown;
    updatedAtIso: string;
  };
} {
  if (!snap || typeof snap !== 'object') {
    return { remove: true, prunedEntries: 0 };
  }
  const s = snap as {
    key?: unknown;
    uid?: unknown;
    collectionKey?: unknown;
    data?: unknown;
    updatedAtIso?: unknown;
  };
  const key = typeof s.key === 'string' ? s.key : fallbackKey;
  const keyParts = key.split('::');
  const collectionKey =
    typeof s.collectionKey === 'string' && s.collectionKey.trim()
      ? s.collectionKey
      : keyParts[1] || '';
  const uid =
    typeof s.uid === 'string' && s.uid.trim() ? s.uid : keyParts[0] || '';

  if (!key || !uid || !collectionKey) {
    return { remove: true, prunedEntries: 0 };
  }

  const updatedMs = parseIsoMs(s.updatedAtIso);
  const ttl = REFERENCE_SNAPSHOT_KEYS.has(collectionKey) ? referenceSnapshotTtlMs : snapshotTtlMs;
  if (updatedMs === null || nowMs - updatedMs > ttl) {
    return { remove: true, prunedEntries: 0 };
  }

  if (OPERATIONAL_SNAPSHOT_KEYS.has(collectionKey) && Array.isArray(s.data) && tombstones.size > 0) {
    const checkPu = collectionKey === 'approvedPuResults' || collectionKey === 'publicResults';
    const nextData = s.data.filter((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return false;
      const rec = entry as Record<string, unknown>;
      const recId = typeof rec.id === 'string' ? rec.id : '';
      const recClientNoteId = typeof rec.clientNoteId === 'string' ? rec.clientNoteId : '';
      const recPuId = typeof rec.puId === 'string' ? rec.puId : '';
      const recSourceId = typeof rec.sourceSubmissionId === 'string' ? rec.sourceSubmissionId : '';

      if (recId && tombstones.has(recId)) return false;
      if (recClientNoteId && tombstones.has(recClientNoteId)) return false;
      if (recSourceId && tombstones.has(recSourceId)) return false;
      if (checkPu && recPuId && tombstones.has(recPuId)) return false;
      return true;
    });

    const removed = s.data.length - nextData.length;
    if (removed > 0) {
      return {
        remove: false,
        prunedEntries: removed,
        updated: {
          key,
          uid,
          collectionKey,
          data: nextData,
          updatedAtIso: typeof s.updatedAtIso === 'string' ? s.updatedAtIso : new Date(nowMs).toISOString(),
        },
      };
    }
  }

  return { remove: false, prunedEntries: 0 };
}

/**
 * Proactively prunes orphaned records and expired cache entries from IndexedDB
 * and localStorage fallbacks on application startup to prevent stale data recurrence.
 */
export async function pruneOfflineStorageOnStartup(options?: {
  nowMs?: number;
  snapshotTtlMs?: number;
  referenceSnapshotTtlMs?: number;
  syncedQueueTtlMs?: number;
  draftTtlMs?: number;
  tombstoneTtlMs?: number;
  pendingRegTtlMs?: number;
}): Promise<OfflinePruneReport> {
  const nowMs = options?.nowMs ?? Date.now();
  const snapshotTtlMs = options?.snapshotTtlMs ?? DEFAULT_PRUNE_TTLS.snapshotTtlMs;
  const referenceSnapshotTtlMs =
    options?.referenceSnapshotTtlMs ?? DEFAULT_PRUNE_TTLS.referenceSnapshotTtlMs;
  const syncedQueueTtlMs = options?.syncedQueueTtlMs ?? DEFAULT_PRUNE_TTLS.syncedQueueTtlMs;
  const draftTtlMs = options?.draftTtlMs ?? DEFAULT_PRUNE_TTLS.draftTtlMs;
  const tombstoneTtlMs = options?.tombstoneTtlMs ?? DEFAULT_PRUNE_TTLS.tombstoneTtlMs;
  const pendingRegTtlMs = options?.pendingRegTtlMs ?? DEFAULT_PRUNE_TTLS.pendingRegTtlMs;

  const report: OfflinePruneReport = {
    prunedQueueItems: 0,
    resetStuckSyncingItems: 0,
    prunedDrafts: 0,
    prunedNotes: 0,
    prunedSnapshots: 0,
    prunedSnapshotEntries: 0,
    prunedTombstones: 0,
    prunedPendingRegistrations: 0,
    ranAtIso: new Date(nowMs).toISOString(),
  };

  // 1. Gather all active + expired tombstones first so orphaned caches referencing deleted IDs are swept
  const lsTombstonesMap = readLs<Record<string, string>>(LS_TOMBSTONES_KEY, {});
  const allTombstones = new Set<string>(Object.keys(lsTombstonesMap));

  const db = await openDb();
  if (db) {
    const idbTombstones = await new Promise<Array<{ id: string; deletedAtIso?: string }>>((resolve) => {
      try {
        const tx = db.transaction(TOMBSTONES_STORE, 'readonly');
        const req = tx.objectStore(TOMBSTONES_STORE).getAll();
        req.onsuccess = () => resolve((req.result || []) as Array<{ id: string; deletedAtIso?: string }>);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    idbTombstones.forEach((t) => {
      if (t?.id) allTombstones.add(t.id);
    });
  }

  // 2. Clean localStorage fallback stores deterministically
  const lsQueue = readLs<unknown[]>(LS_QUEUE_KEY, []);
  if (Array.isArray(lsQueue) && lsQueue.length > 0) {
    const nextLsQueue: OfflineQueuedItem[] = [];
    lsQueue.forEach((item) => {
      const res = isQueueItemOrphanedOrExpired(item, allTombstones, nowMs, syncedQueueTtlMs);
      if (res.remove) {
        if (!db) report.prunedQueueItems += 1;
      } else if (res.resetToPending && res.updated) {
        if (!db) report.resetStuckSyncingItems += 1;
        nextLsQueue.push(res.updated);
      } else {
        nextLsQueue.push(item as OfflineQueuedItem);
      }
    });
    writeLs(LS_QUEUE_KEY, nextLsQueue);
  }

  const lsDrafts = readLs<Record<string, unknown>>(LS_DRAFTS_KEY, {});
  if (lsDrafts && typeof lsDrafts === 'object' && Object.keys(lsDrafts).length > 0) {
    const nextDrafts: Record<string, unknown> = {};
    Object.entries(lsDrafts).forEach(([k, val]) => {
      if (isDraftOrphanedOrExpired(val, k, allTombstones, nowMs, draftTtlMs)) {
        if (!db) report.prunedDrafts += 1;
      } else {
        nextDrafts[k] = val;
      }
    });
    writeLs(LS_DRAFTS_KEY, nextDrafts);
  }

  const lsNotes = readLs<unknown[]>(LS_NOTES_KEY, []);
  if (Array.isArray(lsNotes) && lsNotes.length > 0) {
    const nextNotes = lsNotes.filter((n) => {
      const dead = isNoteOrphaned(n, allTombstones);
      if (dead && !db) report.prunedNotes += 1;
      return !dead;
    });
    writeLs(LS_NOTES_KEY, nextNotes);
  }

  const lsSnaps = readLs<Record<string, unknown>>(LS_SNAPSHOTS_KEY, {});
  if (lsSnaps && typeof lsSnaps === 'object' && Object.keys(lsSnaps).length > 0) {
    const nextSnaps: Record<string, unknown> = {};
    Object.entries(lsSnaps).forEach(([k, val]) => {
      const res = pruneSnapshotRecord(
        val,
        k,
        allTombstones,
        nowMs,
        snapshotTtlMs,
        referenceSnapshotTtlMs
      );
      if (res.remove) {
        if (!db) report.prunedSnapshots += 1;
      } else if (res.updated) {
        if (!db) report.prunedSnapshotEntries += res.prunedEntries;
        nextSnaps[k] = res.updated;
      } else {
        nextSnaps[k] = val;
      }
    });
    writeLs(LS_SNAPSHOTS_KEY, nextSnaps);
  }

  const lsPendingRegs = readLs<unknown[]>(LS_PENDING_REG_KEY, []);
  if (Array.isArray(lsPendingRegs) && lsPendingRegs.length > 0) {
    const nextRegs = lsPendingRegs.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      const reg = r as Partial<PendingOfflineRegistration>;
      if (!reg.id || !reg.phoneHash || !reg.displayName) {
        if (!db) report.prunedPendingRegistrations += 1;
        return false;
      }
      const ts = parseIsoMs(reg.updatedAtIso) ?? parseIsoMs(reg.createdAtIso);
      if (reg.status === 'SYNCED' || ts === null || nowMs - ts > pendingRegTtlMs) {
        if (!db) report.prunedPendingRegistrations += 1;
        return false;
      }
      return true;
    });
    writeLs(LS_PENDING_REG_KEY, nextRegs);
  }

  // Expire stale tombstones from localStorage
  if (Object.keys(lsTombstonesMap).length > 0) {
    const nextTombstones: Record<string, string> = {};
    Object.entries(lsTombstonesMap).forEach(([id, iso]) => {
      const ts = parseIsoMs(iso);
      if (!id || ts === null || nowMs - ts > tombstoneTtlMs) {
        if (!db) report.prunedTombstones += 1;
      } else {
        nextTombstones[id] = iso;
      }
    });
    writeLs(LS_TOMBSTONES_KEY, nextTombstones);
  }

  if (!db) {
    if (report.prunedQueueItems > 0 || report.resetStuckSyncingItems > 0) notifyListeners();
    if (report.prunedNotes > 0) notifyNoteListeners();
    return report;
  }

  // 3. Proactively prune all IndexedDB object stores in a single readwrite transaction
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(
        [
          QUEUE_STORE,
          DRAFTS_STORE,
          NOTES_STORE,
          SNAPSHOTS_STORE,
          TOMBSTONES_STORE,
          PENDING_REG_STORE,
        ],
        'readwrite'
      );

      // Queue store
      const qStore = tx.objectStore(QUEUE_STORE);
      const qReq = qStore.getAll();
      qReq.onsuccess = () => {
        const rows = (qReq.result || []) as Array<Record<string, unknown>>;
        rows.forEach((row) => {
          const res = isQueueItemOrphanedOrExpired(row, allTombstones, nowMs, syncedQueueTtlMs);
          if (res.remove) {
            const pk = row.clientSubmissionId;
            if (typeof pk === 'string' && pk) qStore.delete(pk);
            report.prunedQueueItems += 1;
          } else if (res.resetToPending && res.updated) {
            qStore.put(res.updated);
            report.resetStuckSyncingItems += 1;
          }
        });
      };

      // Drafts store
      const dStore = tx.objectStore(DRAFTS_STORE);
      const dReq = dStore.getAll();
      dReq.onsuccess = () => {
        const rows = (dReq.result || []) as Array<Record<string, unknown>>;
        rows.forEach((row) => {
          const pk = typeof row.key === 'string' ? row.key : '';
          if (isDraftOrphanedOrExpired(row, pk, allTombstones, nowMs, draftTtlMs)) {
            if (pk) dStore.delete(pk);
            report.prunedDrafts += 1;
          }
        });
      };

      // Notes store
      const nStore = tx.objectStore(NOTES_STORE);
      const nReq = nStore.getAll();
      nReq.onsuccess = () => {
        const rows = (nReq.result || []) as Array<Record<string, unknown>>;
        rows.forEach((row) => {
          if (isNoteOrphaned(row, allTombstones)) {
            const pk = row.clientNoteId;
            if (typeof pk === 'string' && pk) nStore.delete(pk);
            report.prunedNotes += 1;
          }
        });
      };

      // Snapshots store
      const sStore = tx.objectStore(SNAPSHOTS_STORE);
      const sReq = sStore.getAll();
      sReq.onsuccess = () => {
        const rows = (sReq.result || []) as Array<Record<string, unknown>>;
        rows.forEach((row) => {
          const pk = typeof row.key === 'string' ? row.key : '';
          const res = pruneSnapshotRecord(
            row,
            pk,
            allTombstones,
            nowMs,
            snapshotTtlMs,
            referenceSnapshotTtlMs
          );
          if (res.remove) {
            if (pk) sStore.delete(pk);
            report.prunedSnapshots += 1;
          } else if (res.updated) {
            sStore.put(res.updated);
            report.prunedSnapshotEntries += res.prunedEntries;
          }
        });
      };

      // Pending offline registrations store
      const rStore = tx.objectStore(PENDING_REG_STORE);
      const rReq = rStore.getAll();
      rReq.onsuccess = () => {
        const rows = (rReq.result || []) as Array<Partial<PendingOfflineRegistration>>;
        rows.forEach((reg) => {
          const ts = parseIsoMs(reg.updatedAtIso) ?? parseIsoMs(reg.createdAtIso);
          const orphanedOrExpired =
            !reg.id ||
            !reg.phoneHash ||
            !reg.displayName ||
            reg.status === 'SYNCED' ||
            ts === null ||
            nowMs - ts > pendingRegTtlMs;
          if (orphanedOrExpired) {
            if (typeof reg.id === 'string' && reg.id) rStore.delete(reg.id);
            report.prunedPendingRegistrations += 1;
          }
        });
      };

      // Tombstones store (expire old deletion markers after cleaning dependent stores)
      const tStore = tx.objectStore(TOMBSTONES_STORE);
      const tReq = tStore.getAll();
      tReq.onsuccess = () => {
        const rows = (tReq.result || []) as Array<{ id?: unknown; deletedAtIso?: unknown }>;
        rows.forEach((row) => {
          const pk = typeof row.id === 'string' ? row.id : '';
          const ts = parseIsoMs(row.deletedAtIso);
          if (!pk || ts === null || nowMs - ts > tombstoneTtlMs) {
            if (pk) tStore.delete(pk);
            report.prunedTombstones += 1;
          }
        });
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  if (report.prunedQueueItems > 0 || report.resetStuckSyncingItems > 0) {
    notifyListeners();
  }
  if (report.prunedNotes > 0) {
    notifyNoteListeners();
  }
  return report;
}

