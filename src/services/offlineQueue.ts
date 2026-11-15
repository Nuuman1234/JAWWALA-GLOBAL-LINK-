import type {
  OfflineQueueStatus,
  OfflineQueuedItem,
  OfflineReportType,
  LgaId,
} from '../types/fdmis';

const DB_NAME = 'fdmis_offline_db';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const DRAFTS_STORE = 'drafts';
const LS_QUEUE_KEY = 'fdmis_offline_queue_v1';
const LS_DRAFTS_KEY = 'fdmis_offline_drafts_v1';

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((cb) => {
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLsQueue(): OfflineQueuedItem[] {
  try {
    const raw = localStorage.getItem(LS_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueuedItem[]) : [];
  } catch {
    return [];
  }
}

function writeLsQueue(items: OfflineQueuedItem[]): void {
  try {
    localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(items));
  } catch {
    // storage quota ignored
  }
}

export async function getQueuedItems(ownerUid: string): Promise<OfflineQueuedItem[]> {
  const db = await openDb();
  if (!db) {
    return readLsQueue()
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
      req.onerror = () => resolve(readLsQueue().filter((i) => i.ownerUid === ownerUid));
    } catch {
      resolve(readLsQueue().filter((i) => i.ownerUid === ownerUid));
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
  lgaId: LgaId;
  wardId: string;
  summary: string;
  payload: Record<string, unknown>;
  status?: OfflineQueueStatus;
}): Promise<OfflineQueuedItem> {
  const now = new Date().toISOString();
  const item: OfflineQueuedItem = {
    clientSubmissionId: input.clientSubmissionId || generateClientSubmissionId(input.reportType.toLowerCase()),
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
    createdAtIso: now,
    updatedAtIso: now,
  };

  const db = await openDb();
  if (!db) {
    const existing = readLsQueue().filter((i) => i.clientSubmissionId !== item.clientSubmissionId);
    writeLsQueue([item, ...existing]);
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
        const existing = readLsQueue().filter((i) => i.clientSubmissionId !== item.clientSubmissionId);
        writeLsQueue([item, ...existing]);
        notifyListeners();
        resolve(item);
      };
    } catch {
      const existing = readLsQueue().filter((i) => i.clientSubmissionId !== item.clientSubmissionId);
      writeLsQueue([item, ...existing]);
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
    const updated = readLsQueue().map((i) =>
      i.clientSubmissionId === clientSubmissionId
        ? { ...i, status, errorMessage, updatedAtIso: now }
        : i
    );
    writeLsQueue(updated);
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
          store.put({
            ...existing,
            status,
            errorMessage,
            updatedAtIso: now,
          });
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

export async function clearSyncedQueueItems(ownerUid: string): Promise<void> {
  const items = await getQueuedItems(ownerUid);
  const toDelete = items.filter((i) => i.status === 'SYNCED').map((i) => i.clientSubmissionId);
  if (toDelete.length === 0) return;

  const db = await openDb();
  if (!db) {
    writeLsQueue(readLsQueue().filter((i) => !toDelete.includes(i.clientSubmissionId)));
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

export async function saveDraft(key: string, data: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  const record = { key, data, updatedAtIso: new Date().toISOString() };
  if (!db) {
    try {
      const raw = localStorage.getItem(LS_DRAFTS_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      all[key] = record;
      localStorage.setItem(LS_DRAFTS_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
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
    try {
      const raw = localStorage.getItem(LS_DRAFTS_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, { data: T }>) : {};
      return all[key]?.data || null;
    } catch {
      return null;
    }
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
    try {
      const raw = localStorage.getItem(LS_DRAFTS_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      delete all[key];
      localStorage.setItem(LS_DRAFTS_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
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
