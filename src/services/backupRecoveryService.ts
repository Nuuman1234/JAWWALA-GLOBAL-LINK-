import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  UserRole,
  type SystemBackupRecord,
  type UserAccount,
} from '../types/fdmis';
import { fetchServerTombstoneIdSet } from './dataManagementService';
import { toValidDocId } from './officialDirectory';

const BACKUP_COLLECTIONS = [
  'wards',
  'polling_units',
  'pu_assignments',
  'party_configs',
  'check_ins',
  'incidents',
  'result_submissions',
  'approved_pu_results',
  'aggregated_results',
  'operational_tasks',
  'operational_notes',
  'notifications',
  'timeline_events',
  'emergency_contacts',
  'emergency_reports',
  'escalation_rules',
  'generated_reports',
] as const;

export type BackupCollectionName = (typeof BACKUP_COLLECTIONS)[number];

export interface EncryptedBackupEnvelope {
  format: 'FDMIS_ENCRYPTED_BACKUP_V1';
  backupId: string;
  backupType: SystemBackupRecord['backupType'];
  label: string;
  createdAtIso: string;
  createdByUid: string;
  createdByName: string;
  encryptionAlgorithm: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256-120000';
  saltHex: string;
  ivHex: string;
  sha256Checksum: string;
  recordCounts: Record<string, number>;
  ciphertextBase64: string;
}

export interface VerifiedBackupPreview {
  envelope: EncryptedBackupEnvelope;
  integrityValid: boolean;
  totalRecords: number;
  collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>>;
  tombstonedSkippedCount: number;
}

export interface RecoveryExecutionResult {
  preRestorationBackupId: string;
  restoredCount: number;
  skippedTombstonedCount: number;
  restoredByCollection: Record<string, number>;
  executedAtIso: string;
}

function requireAdmin(actor: UserAccount): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated user session required.');
  if (actor.role !== UserRole.FULL_CONTROL_ADMIN) {
    throw new Error('Only Full Control Admin can manage system backups and recovery.');
  }
  return uid;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function serializeFirestoreValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return { __fdmisDateIso: val.toISOString() };
  if (typeof val === 'object') {
    const maybeTs = val as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        return { __fdmisDateIso: maybeTs.toDate().toISOString() };
      } catch {
        return null;
      }
    }
    if (Array.isArray(val)) return val.map(serializeFirestoreValue);
    const out: Record<string, unknown> = {};
    Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = serializeFirestoreValue(v);
    });
    return out;
  }
  return val;
}

function deserializeFirestoreValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map(deserializeFirestoreValue);
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (typeof rec.__fdmisDateIso === 'string' && Object.keys(rec).length === 1) {
      const d = new Date(rec.__fdmisDateIso);
      return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    const out: Record<string, unknown> = {};
    Object.entries(rec).forEach(([k, v]) => {
      out[k] = deserializeFirestoreValue(v);
    });
    return out;
  }
  return val;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(passphrase);
  const baseKey = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function observeSystemBackups(
  user: UserAccount,
  onData: (backups: SystemBackupRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (user.role !== UserRole.FULL_CONTROL_ADMIN) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'system_backups'),
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<SystemBackupRecord, 'id'>) }))
        .sort((a, b) => (b.createdAtIso || '').localeCompare(a.createdAtIso || ''));
      onData(items);
    },
    (error) => {
      if (onError) onError(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

/**
 * Creates a full AES-GCM-256 encrypted, SHA-256 verified FDMIS database backup bundle,
 * logs metadata to Firestore `system_backups` and `audit_logs`, and optionally downloads the file.
 */
export async function createEncryptedSystemBackup(
  actor: UserAccount,
  options: {
    backupType: SystemBackupRecord['backupType'];
    label: string;
    passphrase: string;
    autoDownload?: boolean;
  }
): Promise<{ record: SystemBackupRecord; envelope: EncryptedBackupEnvelope; fileName: string }> {
  const uid = requireAdmin(actor);
  if (options.passphrase.trim().length < 8) {
    throw new Error('Backup encryption passphrase must be at least 8 characters.');
  }

  const backupId = toValidDocId(`bkp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const createdAtIso = new Date().toISOString();
  const collectionsPayload: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {};
  const recordCounts: Record<string, number> = {};

  try {
    for (const colName of BACKUP_COLLECTIONS) {
      const snap = await getDocs(collection(db, colName));
      const docs = snap.docs.map((d) => ({
        id: d.id,
        data: serializeFirestoreValue(d.data()) as Record<string, unknown>,
      }));
      collectionsPayload[colName] = docs;
      recordCounts[colName] = docs.length;
    }

    const plaintextJson = JSON.stringify({
      version: 1,
      backupId,
      createdAtIso,
      collections: collectionsPayload,
    });
    const sha256Checksum = await sha256Hex(plaintextJson);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveAesKey(options.passphrase.trim(), salt);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      new TextEncoder().encode(plaintextJson)
    );
    const ciphertextBase64 = bytesToBase64(new Uint8Array(cipherBuf));

    const envelope: EncryptedBackupEnvelope = {
      format: 'FDMIS_ENCRYPTED_BACKUP_V1',
      backupId,
      backupType: options.backupType,
      label: options.label.trim().slice(0, 140) || `FDMIS Backup ${createdAtIso.slice(0, 10)}`,
      createdAtIso,
      createdByUid: uid,
      createdByName: actor.displayName.slice(0, 120),
      encryptionAlgorithm: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA256-120000',
      saltHex: bytesToHex(salt),
      ivHex: bytesToHex(iv),
      sha256Checksum,
      recordCounts,
      ciphertextBase64,
    };

    const envelopeJson = JSON.stringify(envelope, null, 2);
    const sizeBytes = new TextEncoder().encode(envelopeJson).length;

    const metadataDoc: Omit<SystemBackupRecord, 'id'> = {
      backupType: envelope.backupType,
      label: envelope.label,
      encryptionAlgorithm: 'AES-GCM-256',
      sha256Checksum,
      sizeBytes,
      recordCounts,
      status: 'VERIFIED',
      createdByUid: uid,
      createdByName: actor.displayName.slice(0, 120),
      createdAtIso,
      createdAt: serverTimestamp() as unknown as SystemBackupRecord['createdAt'],
    };

    await setDoc(doc(db, 'system_backups', backupId), metadataDoc);

    await setDoc(doc(collection(db, 'audit_logs')), {
      actorUid: uid,
      actorName: actor.displayName.slice(0, 120),
      actorEmail: actor.email.slice(0, 200),
      actorRole: actor.role,
      action: 'SYSTEM_BACKUP_CREATED',
      affectedEntity: 'system_backups',
      affectedId: backupId,
      details: `Created ${envelope.backupType} encrypted backup "${envelope.label}" (${sizeBytes.toLocaleString()} bytes, SHA-256 ${sha256Checksum.slice(0, 16)}...).`,
      createdAt: serverTimestamp(),
    });

    const fileName = `fdmis_backup_${createdAtIso.slice(0, 10)}_${backupId.slice(-6)}.fdmis.json`;
    if (options.autoDownload !== false && typeof document !== 'undefined') {
      const blob = new Blob([envelopeJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return {
      record: { id: backupId, ...metadataDoc },
      envelope,
      fileName,
    };
  } catch (error) {
    try {
      await setDoc(doc(db, 'system_backups', backupId), {
        backupType: options.backupType,
        label: options.label.trim().slice(0, 140) || 'Failed Backup Attempt',
        encryptionAlgorithm: 'AES-GCM-256',
        sha256Checksum: '',
        sizeBytes: 0,
        recordCounts,
        status: 'FAILED',
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        createdByUid: uid,
        createdByName: actor.displayName.slice(0, 120),
        createdAtIso,
        createdAt: serverTimestamp(),
      });
    } catch {
      // ignore secondary log failure
    }
    handleFirestoreError(error, OperationType.WRITE, `system_backups/${backupId}`);
  }
}

/**
 * Steps 1-3 of the 7-Step Recovery Workflow:
 * Parses an encrypted backup file, decrypts with the passphrase, verifies SHA-256 integrity,
 * and previews exact record counts and how many permanently deleted (tombstoned) records will be skipped.
 */
export async function verifyAndInspectBackupFile(
  fileContent: string,
  passphrase: string
): Promise<VerifiedBackupPreview> {
  let envelope: EncryptedBackupEnvelope;
  try {
    envelope = JSON.parse(fileContent) as EncryptedBackupEnvelope;
  } catch {
    throw new Error('Selected file is not a valid FDMIS backup JSON file.');
  }
  if (envelope.format !== 'FDMIS_ENCRYPTED_BACKUP_V1' || !envelope.ciphertextBase64) {
    throw new Error('Unsupported backup format. Expected FDMIS_ENCRYPTED_BACKUP_V1.');
  }

  let plaintextJson = '';
  try {
    const salt = hexToBytes(envelope.saltHex);
    const iv = hexToBytes(envelope.ivHex);
    const cipherBytes = base64ToBytes(envelope.ciphertextBase64);
    const key = await deriveAesKey(passphrase.trim(), salt);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      new Uint8Array(cipherBytes)
    );
    plaintextJson = new TextDecoder().decode(plainBuf);
  } catch {
    throw new Error('Decryption failed. Verify your backup passphrase and ensure the file is intact.');
  }

  const computedHash = await sha256Hex(plaintextJson);
  const integrityValid = computedHash === envelope.sha256Checksum;
  if (!integrityValid) {
    throw new Error('Backup integrity check failed: SHA-256 checksum mismatch.');
  }

  const parsed = JSON.parse(plaintextJson) as {
    collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>>;
  };

  const serverTombstones = await fetchServerTombstoneIdSet();
  let totalRecords = 0;
  let tombstonedSkippedCount = 0;
  Object.values(parsed.collections || {}).forEach((docs) => {
    totalRecords += docs.length;
    docs.forEach((d) => {
      if (serverTombstones.has(d.id)) tombstonedSkippedCount += 1;
    });
  });

  return {
    envelope,
    integrityValid,
    totalRecords,
    collections: parsed.collections || {},
    tombstonedSkippedCount,
  };
}

/**
 * Steps 4-7 of the 7-Step Recovery Workflow:
 * 4. Automatically creates a safety PRE_RESTORATION backup before touching live data.
 * 5. Requires explicit admin confirmation (caller enforces UI confirmation phrase).
 * 6. Restores selected collections while STRICTLY SKIPPING any record present in
 *    `deletion_tombstones` so permanently deleted records are NEVER resurrected.
 * 7. Records the entire recovery operation in immutable `audit_logs`.
 */
export async function executeControlledRecovery(
  actor: UserAccount,
  preview: VerifiedBackupPreview,
  options: {
    selectedCollections: BackupCollectionName[];
    preRestorationPassphrase: string;
    confirmationReason: string;
  }
): Promise<RecoveryExecutionResult> {
  const uid = requireAdmin(actor);
  if (!preview.integrityValid) {
    throw new Error('Cannot restore a backup that failed SHA-256 integrity verification.');
  }
  if (options.selectedCollections.length === 0) {
    throw new Error('Select at least one collection to restore.');
  }

  // Step 4: Create safety pre-restoration backup before making any changes
  const preBackup = await createEncryptedSystemBackup(actor, {
    backupType: 'PRE_RESTORATION',
    label: `Pre-Restoration Safety Snapshot (${preview.envelope.backupId})`,
    passphrase: options.preRestorationPassphrase,
    autoDownload: true,
  });

  // Step 6: Fetch authoritative server deletion tombstones so deleted data is NEVER resurrected
  const serverTombstones = await fetchServerTombstoneIdSet();
  let restoredCount = 0;
  let skippedTombstonedCount = 0;
  const restoredByCollection: Record<string, number> = {};

  for (const colName of options.selectedCollections) {
    const docs = preview.collections[colName] || [];
    const eligible = docs.filter((item) => {
      if (serverTombstones.has(item.id)) {
        skippedTombstonedCount += 1;
        return false;
      }
      const clientSubId =
        typeof item.data?.clientSubmissionId === 'string' ? item.data.clientSubmissionId : '';
      if (clientSubId && serverTombstones.has(clientSubId)) {
        skippedTombstonedCount += 1;
        return false;
      }
      return true;
    });

    const CHUNK = 350;
    for (let i = 0; i < eligible.length; i += CHUNK) {
      const batch = writeBatch(db);
      eligible.slice(i, i + CHUNK).forEach((item) => {
        const cleanData = deserializeFirestoreValue(item.data) as Record<string, unknown>;
        batch.set(doc(db, colName, item.id), cleanData, { merge: true });
      });
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, colName);
      }
    }
    restoredByCollection[colName] = eligible.length;
    restoredCount += eligible.length;
  }

  const executedAtIso = new Date().toISOString();

  // Step 7: Record recovery in immutable audit_logs
  await setDoc(doc(collection(db, 'audit_logs')), {
    actorUid: uid,
    actorName: actor.displayName.slice(0, 120),
    actorEmail: actor.email.slice(0, 200),
    actorRole: actor.role,
    action: 'SYSTEM_BACKUP_RESTORED',
    affectedEntity: 'system_backups',
    affectedId: preview.envelope.backupId,
    details:
      `[${executedAtIso}] Restored ${restoredCount} record(s) from backup ${preview.envelope.backupId} ` +
      `(${options.selectedCollections.join(', ')}). Skipped ${skippedTombstonedCount} tombstoned deleted record(s). ` +
      `Safety pre-backup: ${preBackup.record.id}. Reason: ${options.confirmationReason.slice(0, 240)}`,
    createdAt: serverTimestamp(),
  });

  return {
    preRestorationBackupId: preBackup.record.id,
    restoredCount,
    skippedTombstonedCount,
    restoredByCollection,
    executedAtIso,
  };
}
