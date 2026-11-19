import {
  AccountStatus,
  DEFAULT_OFFLINE_SESSION_MAX_DAYS,
  UserRole,
  type UserAccount,
} from '../types/fdmis';

/**
 * Cryptographically sealed Trusted Device Session manager for FDMIS offline reopening.
 *
 * Security model:
 * - A non-extractable AES-256-GCM CryptoKey is generated once per device installation
 *   and persisted in IndexedDB (equivalent to Android Keystore in Android WebView/PWA).
 * - Trusted sessions are ONLY established after a genuine online server authentication
 *   and active RBAC verification.
 * - Never stores plaintext passwords or raw Firebase Auth tokens.
 * - Every offline verification decrypts the AEAD ciphertext with Additional Authenticated
 *   Data (AAD) bound to uid + deviceId + envelope version, verifies account ACTIVE status,
 *   checks non-revocation, and enforces configurable offline-session expiry.
 * - Tampered, expired, or revoked sessions are immediately rejected and purged.
 */

const KEYSTORE_DB_NAME = 'fdmis_secure_keystore_v1';
const KEYSTORE_DB_VERSION = 1;
const KEY_STORE = 'device_keys';
const SESSION_STORE = 'trusted_sessions';
const DEVICE_KEY_ID = 'fdmis_device_aes_gcm_key_v1';
const DEVICE_ID_LS_KEY = 'fdmis_trusted_device_id_v1';
const ACTIVE_SESSION_RECORD_ID = 'active_trusted_session_v1';
const ENVELOPE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrustedSessionPayload {
  version: number;
  uid: string;
  deviceId: string;
  account: UserAccount;
  providerIds: string[];
  establishedAtMs: number;
  lastServerVerifiedAtMs: number;
  expiresAtMs: number;
  maxOfflineDays: number;
}

export interface EncryptedTrustedSessionRecord {
  id: string;
  version: number;
  uid: string;
  deviceId: string;
  ivBase64: string;
  ciphertextBase64: string;
  updatedAtMs: number;
}

export type TrustedSessionVerificationResult =
  | {
      valid: true;
      payload: TrustedSessionPayload;
    }
  | {
      valid: false;
      reason:
        | 'NO_TRUSTED_SESSION'
        | 'CRYPTO_UNAVAILABLE'
        | 'TAMPERED_OR_CORRUPT'
        | 'DEVICE_MISMATCH'
        | 'UID_MISMATCH'
        | 'EXPIRED'
        | 'INACTIVE_OR_REVOKED';
    };

// Memory fallback store strictly for non-IndexedDB environments (e.g., Node/tsx unit tests)
let memoryFallbackKey: CryptoKey | null = null;
const memoryFallbackSessions = new Map<string, EncryptedTrustedSessionRecord>();
let memoryFallbackDeviceId: string | null = null;

function getSubtleCrypto(): SubtleCrypto | null {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

function getRandomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i += 1) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return arr;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function generateDeviceId(): string {
  if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.randomUUID === 'function') {
    return `dev_${globalThis.crypto.randomUUID()}`;
  }
  const bytes = getRandomBytes(16);
  return `dev_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function getOrCreateDeviceId(): string {
  if (typeof localStorage !== 'undefined') {
    try {
      const existing = localStorage.getItem(DEVICE_ID_LS_KEY);
      if (existing && existing.startsWith('dev_') && existing.length >= 16) {
        return existing;
      }
      const created = generateDeviceId();
      localStorage.setItem(DEVICE_ID_LS_KEY, created);
      return created;
    } catch {
      // Fall through to memory fallback
    }
  }
  if (!memoryFallbackDeviceId) {
    memoryFallbackDeviceId = generateDeviceId();
  }
  return memoryFallbackDeviceId;
}

function openKeystoreDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(KEYSTORE_DB_NAME, KEYSTORE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getOrCreateDeviceCryptoKey(): Promise<CryptoKey | null> {
  const subtle = getSubtleCrypto();
  if (!subtle) return null;

  const db = await openKeystoreDb();
  if (!db) {
    if (!memoryFallbackKey) {
      memoryFallbackKey = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // Non-extractable key
        ['encrypt', 'decrypt']
      );
    }
    return memoryFallbackKey;
  }

  const existing = await new Promise<CryptoKey | null>((resolve) => {
    try {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const req = tx.objectStore(KEY_STORE).get(DEVICE_KEY_ID);
      req.onsuccess = () => {
        const row = req.result as { id: string; key?: CryptoKey } | undefined;
        resolve(row?.key ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  if (existing) return existing;

  const generated = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // Non-extractable: protects key material inside WebView/browser keystore
    ['encrypt', 'decrypt']
  );

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put({ id: DEVICE_KEY_ID, key: generated, createdAtMs: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  return generated;
}

async function saveEncryptedRecord(record: EncryptedTrustedSessionRecord): Promise<void> {
  const db = await openKeystoreDb();
  if (!db) {
    memoryFallbackSessions.set(record.id, record);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function loadEncryptedRecord(): Promise<EncryptedTrustedSessionRecord | null> {
  const db = await openKeystoreDb();
  if (!db) {
    return memoryFallbackSessions.get(ACTIVE_SESSION_RECORD_ID) ?? null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SESSION_STORE, 'readonly');
      const req = tx.objectStore(SESSION_STORE).get(ACTIVE_SESSION_RECORD_ID);
      req.onsuccess = () =>
        resolve((req.result as EncryptedTrustedSessionRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function clearTrustedDeviceSession(expectedUid?: string): Promise<void> {
  const db = await openKeystoreDb();
  if (!db) {
    if (expectedUid) {
      const existing = memoryFallbackSessions.get(ACTIVE_SESSION_RECORD_ID);
      if (existing && existing.uid !== expectedUid) return;
    }
    memoryFallbackSessions.delete(ACTIVE_SESSION_RECORD_ID);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      const store = tx.objectStore(SESSION_STORE);
      if (expectedUid) {
        const getReq = store.get(ACTIVE_SESSION_RECORD_ID);
        getReq.onsuccess = () => {
          const existing = getReq.result as EncryptedTrustedSessionRecord | undefined;
          if (!existing || existing.uid === expectedUid) {
            store.delete(ACTIVE_SESSION_RECORD_ID);
          }
        };
      } else {
        store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Strips non-serializable Firestore Timestamp objects and sensitive transient fields
 * so only minimal, clean profile metadata is sealed into the encrypted offline envelope.
 */
function sanitizeAccountForTrustedEnvelope(account: UserAccount): UserAccount {
  const toIsoOrNull = (val: unknown): string | null => {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (val instanceof Date) return val.toISOString();
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().toISOString();
    }
    if (typeof (val as { seconds?: number }).seconds === 'number') {
      return new Date((val as { seconds: number }).seconds * 1000).toISOString();
    }
    return null;
  };

  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    phone: account.phone ?? null,
    authMethod: account.authMethod,
    role: account.role,
    status: account.status,
    assignedLgaId: account.assignedLgaId || '',
    assignedWardId: account.assignedWardId || '',
    assignedPollingUnitId: account.assignedPollingUnitId || '',
    requestedLgaId: account.requestedLgaId ?? null,
    requestedWardId: account.requestedWardId ?? null,
    requestedWardName: account.requestedWardName ?? null,
    requestedPollingUnitId: account.requestedPollingUnitId ?? null,
    requestedPollingUnitCode: account.requestedPollingUnitCode ?? null,
    requestedPollingUnitName: account.requestedPollingUnitName ?? null,
    sessionRevoked: Boolean(account.sessionRevoked),
    revokedReason: account.revokedReason ?? null,
    batteryLevel: account.batteryLevel ?? null,
    batteryCharging: account.batteryCharging ?? null,
    batteryUpdatedAt: toIsoOrNull(account.batteryUpdatedAt),
    lastPasswordChangedAt: toIsoOrNull(account.lastPasswordChangedAt),
    lastLoginAt: toIsoOrNull(account.lastLoginAt),
    createdAt: toIsoOrNull(account.createdAt),
    updatedAt: toIsoOrNull(account.updatedAt),
  };
}

function buildAad(uid: string, deviceId: string, version: number): Uint8Array {
  return new TextEncoder().encode(`FDMIS_TRUSTED_SESSION|v${version}|${uid}|${deviceId}`);
}

/**
 * Establishes or refreshes the encrypted trusted-device session.
 * MUST ONLY be called after a genuine online server authentication & active RBAC verification.
 */
export async function establishTrustedDeviceSession(
  account: UserAccount,
  options?: {
    providerIds?: string[];
    maxOfflineDays?: number;
    nowMs?: number;
  }
): Promise<TrustedSessionPayload | null> {
  if (
    !account.uid ||
    account.status !== AccountStatus.ACTIVE ||
    account.sessionRevoked ||
    account.role === UserRole.PENDING
  ) {
    await clearTrustedDeviceSession(account.uid);
    return null;
  }

  const subtle = getSubtleCrypto();
  const key = await getOrCreateDeviceCryptoKey();
  if (!subtle || !key) return null;

  const nowMs = options?.nowMs ?? Date.now();
  const maxOfflineDays = Math.max(
    1,
    Math.min(30, Math.floor(options?.maxOfflineDays ?? DEFAULT_OFFLINE_SESSION_MAX_DAYS))
  );
  const deviceId = getOrCreateDeviceId();

  // Preserve original establishedAtMs if refreshing the same user's trusted session
  let establishedAtMs = nowMs;
  const prev = await verifyTrustedDeviceSession(account.uid, nowMs);
  if (prev.valid) {
    establishedAtMs = prev.payload.establishedAtMs;
  }

  const payload: TrustedSessionPayload = {
    version: ENVELOPE_VERSION,
    uid: account.uid,
    deviceId,
    account: sanitizeAccountForTrustedEnvelope(account),
    providerIds: options?.providerIds ? [...options.providerIds] : [],
    establishedAtMs,
    lastServerVerifiedAtMs: nowMs,
    expiresAtMs: nowMs + maxOfflineDays * DAY_MS,
    maxOfflineDays,
  };

  const iv = getRandomBytes(12);
  const aad = buildAad(payload.uid, deviceId, ENVELOPE_VERSION);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
    key,
    encoded
  );

  const record: EncryptedTrustedSessionRecord = {
    id: ACTIVE_SESSION_RECORD_ID,
    version: ENVELOPE_VERSION,
    uid: payload.uid,
    deviceId,
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAtMs: nowMs,
  };

  await saveEncryptedRecord(record);
  return payload;
}

/**
 * Cryptographically verifies the locally stored trusted-device session.
 * Rejects & purges tampered, expired, mismatched, or revoked sessions.
 */
export async function verifyTrustedDeviceSession(
  expectedUid?: string,
  nowMs: number = Date.now()
): Promise<TrustedSessionVerificationResult> {
  const record = await loadEncryptedRecord();
  if (!record) {
    return { valid: false, reason: 'NO_TRUSTED_SESSION' };
  }

  const currentDeviceId = getOrCreateDeviceId();
  if (record.deviceId !== currentDeviceId) {
    await clearTrustedDeviceSession();
    return { valid: false, reason: 'DEVICE_MISMATCH' };
  }

  if (expectedUid && record.uid !== expectedUid) {
    return { valid: false, reason: 'UID_MISMATCH' };
  }

  const subtle = getSubtleCrypto();
  const key = await getOrCreateDeviceCryptoKey();
  if (!subtle || !key) {
    return { valid: false, reason: 'CRYPTO_UNAVAILABLE' };
  }

  try {
    const iv = base64ToBytes(record.ivBase64);
    const ciphertext = base64ToBytes(record.ciphertextBase64);
    const aad = buildAad(record.uid, record.deviceId, record.version);

    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as TrustedSessionPayload;

    if (
      !parsed ||
      parsed.version !== ENVELOPE_VERSION ||
      parsed.uid !== record.uid ||
      parsed.deviceId !== currentDeviceId ||
      !parsed.account ||
      parsed.account.uid !== record.uid
    ) {
      await clearTrustedDeviceSession();
      return { valid: false, reason: 'TAMPERED_OR_CORRUPT' };
    }

    if (
      parsed.account.status !== AccountStatus.ACTIVE ||
      parsed.account.sessionRevoked ||
      parsed.account.role === UserRole.PENDING
    ) {
      await clearTrustedDeviceSession(parsed.uid);
      return { valid: false, reason: 'INACTIVE_OR_REVOKED' };
    }

    if (typeof parsed.expiresAtMs !== 'number' || nowMs > parsed.expiresAtMs) {
      await clearTrustedDeviceSession(parsed.uid);
      return { valid: false, reason: 'EXPIRED' };
    }

    return { valid: true, payload: parsed };
  } catch {
    // AEAD authentication tag mismatch or corrupted ciphertext -> purge immediately
    await clearTrustedDeviceSession();
    return { valid: false, reason: 'TAMPERED_OR_CORRUPT' };
  }
}

/**
 * Helper strictly for testing/diagnostics: mutates the in-memory ciphertext to verify
 * AEAD tamper detection in automated tests.
 */
export function __tamperMemoryTrustedSessionForTest(): boolean {
  const existing = memoryFallbackSessions.get(ACTIVE_SESSION_RECORD_ID);
  if (!existing) return false;
  const bytes = base64ToBytes(existing.ciphertextBase64);
  if (bytes.length === 0) return false;
  bytes[0] = bytes[0] ^ 0xff;
  memoryFallbackSessions.set(ACTIVE_SESSION_RECORD_ID, {
    ...existing,
    ciphertextBase64: bytesToBase64(bytes),
  });
  return true;
}
