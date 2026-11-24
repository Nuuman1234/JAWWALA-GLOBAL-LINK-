import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileKey2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  createEncryptedSystemBackup,
  executeControlledRecovery,
  verifyAndInspectBackupFile,
  type BackupCollectionName,
  type RecoveryExecutionResult,
  type VerifiedBackupPreview,
} from '../services/backupRecoveryService';
import {
  rebuildAggregatedResultsFromCanonical,
  scanDataIntegrity,
  type DataIntegrityScanReport,
} from '../services/dataManagementService';
import {
  formatFirestoreTime,
  type AgentCheckIn,
  type ApprovedPuResult,
  type DeletionTombstone,
  type IncidentReport,
  type PollingUnit,
  type ReportAttachment,
  type ResultSubmission,
  type SystemBackupRecord,
  type UserAccount,
} from '../types/fdmis';

interface DataIntegrityPanelProps {
  user: UserAccount;
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  incidents: IncidentReport[];
  checkIns: AgentCheckIn[];
  attachments: ReportAttachment[];
  pollingUnits: PollingUnit[];
  deletionTombstones: DeletionTombstone[];
}

export function DataIntegrityPanel({
  user,
  results,
  approvedPuResults,
  incidents,
  checkIns,
  attachments,
  pollingUnits,
  deletionTombstones,
}: DataIntegrityPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [scanReport, setScanReport] = useState<DataIntegrityScanReport | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleRunScan = async () => {
    setScanning(true);
    setFeedback(null);
    try {
      const report = await scanDataIntegrity({
        results,
        approvedPuResults,
        incidents,
        checkIns,
        attachments,
        pollingUnits,
      });
      setScanReport(report);
      setFeedback({
        type: 'ok',
        text: `Integrity scan completed (${formatFirestoreTime(report.scannedAtIso)}). Official Polling Unit count: ${pollingUnits.length} / 475.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to complete data integrity scan.',
      });
    } finally {
      setScanning(false);
    }
  };

  const handleRebuildAggregates = async () => {
    setRebuilding(true);
    setFeedback(null);
    try {
      const res = await rebuildAggregatedResultsFromCanonical(user);
      setFeedback({
        type: 'ok',
        text: `Successfully reconciled ${res.rebuiltBuckets} Ward/LGA/Constituency aggregate bucket(s) from canonical approved_pu_results.`,
      });
      await handleRunScan();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to rebuild aggregated results.',
      });
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="fdmis-surface p-3.5 sm:p-4 space-y-4">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Data Integrity Scanner &amp; Aggregate Reconciliation
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Verifies server deletion tombstones, duplicate active result submissions, orphaned
              attachments, and Ward/LGA/Constituency aggregate consistency without auto-deleting any
              valid record.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={scanning}
              onClick={() => void handleRunScan()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#06452F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#043B29] disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{scanning ? 'Scanning...' : 'Run Live Integrity Scan'}</span>
            </button>
            <button
              type="button"
              disabled={rebuilding}
              onClick={() => void handleRebuildAggregates()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              <Database className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
              <span>{rebuilding ? 'Reconciling...' : 'Reconcile Aggregates'}</span>
            </button>
          </div>
        </div>

        {feedback ? (
          <div
            className={`rounded-lg border px-4 py-3 text-xs ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {feedback.text}
          </div>
        ) : null}

        <div className="fdmis-metrics-grid gap-2 sm:gap-2.5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Official Polling Units</p>
            <p className="mt-1 font-mono text-xl font-bold text-[#06452F] tabular-nums">
              {pollingUnits.length} / 475
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Server Deletion Tombstones</p>
            <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
              {scanReport ? scanReport.serverTombstoneCount : deletionTombstones.length}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Duplicate PU Result Groups</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                (scanReport?.duplicateActiveResultGroups.length || 0) > 0
                  ? 'text-red-700'
                  : 'text-slate-900'
              }`}
            >
              {scanReport ? scanReport.duplicateActiveResultGroups.length : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Orphaned Attachments</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                (scanReport?.orphanedAttachmentIds.length || 0) > 0
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
            >
              {scanReport ? scanReport.orphanedAttachmentIds.length : '—'}
            </p>
          </div>
        </div>

        {scanReport ? (
          <div className="space-y-2.5 text-xs">
            {scanReport.aggregateDriftDetected ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
                <p className="font-semibold">Aggregate Total Drift Detected:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {scanReport.aggregateDriftDetails.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-950">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#06452F]" aria-hidden="true" />
                <span>
                  Ward, LGA, and Constituency aggregates match canonical approved_pu_results with
                  zero drift.
                </span>
              </div>
            )}

            {scanReport.duplicateActiveResultGroups.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-950">
                <p className="font-semibold">Duplicate Active Submissions Found:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px]">
                  {scanReport.duplicateActiveResultGroups.map((g) => (
                    <li key={g.puId}>
                      PU {g.puCode}: {g.submissionIds.length} active records ({g.submissionIds.join(', ')})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] text-slate-500">
              Stale PU operational status flags (PU marked active with zero remaining operational
              records): <strong className="font-mono">{scanReport.stalePuStatusCount}</strong>
            </p>
          </div>
        ) : null}
      </div>

      {/* Active Server Deletion Tombstones Log */}
      <div className="fdmis-surface p-3.5 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-display text-sm font-semibold text-slate-900">
            Active Server Deletion Tombstones ({deletionTombstones.length})
          </h4>
          <span className="font-mono text-[11px] text-slate-500">
            Enforced across Web &amp; Android APK offline sync
          </span>
        </div>
        {deletionTombstones.length === 0 ? (
          <p className="text-xs text-slate-500">
            No server deletion tombstones have been recorded yet. Permanently deleting records in
            Data Management automatically writes immutable tombstones here so deleted entries never
            return from offline devices or backups.
          </p>
        ) : (
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="px-3 py-2">Record ID</th>
                  <th className="px-3 py-2">Collection</th>
                  <th className="px-3 py-2">Deleted By</th>
                  <th className="px-3 py-2">Deleted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deletionTombstones.slice(0, 60).map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-900">{t.recordId}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {t.collectionName}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{t.deletedByEmail}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatFirestoreTime(t.deletedAtIso || t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

interface BackupRecoveryPanelProps {
  user: UserAccount;
  systemBackups: SystemBackupRecord[];
  deletionTombstones: DeletionTombstone[];
}

export function BackupRecoveryPanel({
  user,
  systemBackups,
  deletionTombstones,
}: BackupRecoveryPanelProps) {
  // Backup creation state
  const [backupLabel, setBackupLabel] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);

  // 7-Step Controlled Recovery Wizard state
  const [rawBackupContent, setRawBackupContent] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [decryptPassphrase, setDecryptPassphrase] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [preview, setPreview] = useState<VerifiedBackupPreview | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<BackupCollectionName[]>([]);
  const [preBackupPassphrase, setPreBackupPassphrase] = useState('');
  const [confirmPreBackupChecked, setConfirmPreBackupChecked] = useState(false);
  const [recoveryReason, setRecoveryReason] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [executingRecovery, setExecutingRecovery] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<RecoveryExecutionResult | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleCreateBackup = async (e: FormEvent) => {
    e.preventDefault();
    setCreatingBackup(true);
    setFeedback(null);
    try {
      const res = await createEncryptedSystemBackup(user, {
        backupType: 'MANUAL_ADMIN',
        label: backupLabel.trim() || `FDMIS Full Backup ${new Date().toISOString().slice(0, 10)}`,
        passphrase: backupPassphrase,
        autoDownload: true,
      });
      setBackupLabel('');
      setBackupPassphrase('');
      setFeedback({
        type: 'ok',
        text: `Encrypted AES-GCM-256 backup "${res.fileName}" created, SHA-256 verified (${res.record.sha256Checksum.slice(0, 14)}…), logged, and downloaded.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to create encrypted system backup.',
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null);
    setRecoveryResult(null);
    setFeedback(null);
    const text = await file.text();
    setRawBackupContent(text);
    setUploadedFileName(file.name);
  };

  const handleVerifyBackup = async (e: FormEvent) => {
    e.preventDefault();
    if (!rawBackupContent) {
      setFeedback({ type: 'err', text: 'Upload an encrypted .fdmis.json backup file first.' });
      return;
    }
    setInspecting(true);
    setFeedback(null);
    try {
      const verified = await verifyAndInspectBackupFile(rawBackupContent, decryptPassphrase);
      setPreview(verified);
      setSelectedCollections(Object.keys(verified.collections) as BackupCollectionName[]);
      setPreBackupPassphrase(decryptPassphrase);
      setFeedback({
        type: 'ok',
        text: `Backup verified (SHA-256 valid). ${verified.totalRecords} total record(s) found; ${verified.tombstonedSkippedCount} permanently deleted record(s) will be strictly skipped.`,
      });
    } catch (err) {
      setPreview(null);
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Backup verification failed.',
      });
    } finally {
      setInspecting(false);
    }
  };

  const toggleCollection = (col: BackupCollectionName) => {
    setSelectedCollections((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleExecuteRecovery = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    if (confirmPhrase.trim() !== 'RESTORE BACKUP') {
      setFeedback({ type: 'err', text: 'Type exact phrase "RESTORE BACKUP" to confirm.' });
      return;
    }
    if (!confirmPreBackupChecked) {
      setFeedback({
        type: 'err',
        text: 'Confirm automatic pre-restoration safety backup creation before proceeding.',
      });
      return;
    }
    setExecutingRecovery(true);
    setFeedback(null);
    try {
      const result = await executeControlledRecovery(user, preview, {
        selectedCollections,
        preRestorationPassphrase: preBackupPassphrase,
        confirmationReason: recoveryReason.trim() || 'Controlled admin recovery',
      });
      setRecoveryResult(result);
      setConfirmPhrase('');
      setFeedback({
        type: 'ok',
        text: `Controlled recovery completed: restored ${result.restoredCount} record(s), skipped ${result.skippedTombstonedCount} tombstoned deleted record(s). Pre-restoration safety backup ${result.preRestorationBackupId} downloaded.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Controlled recovery failed.',
      });
    } finally {
      setExecutingRecovery(false);
    }
  };

  return (
    <section className="space-y-3.5 sm:space-y-4">
      {feedback ? (
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Create Encrypted System Backup */}
      <form
        onSubmit={handleCreateBackup}
        className="fdmis-surface p-3.5 sm:p-4 space-y-4"
      >
        <div className="flex items-start gap-2.5 border-b border-slate-100 pb-3">
          <FileKey2 className="mt-0.5 h-5 w-5 shrink-0 text-[#06452F]" aria-hidden="true" />
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Create Encrypted Full System Backup (AES-GCM-256 + SHA-256)
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Snapshots all 17 operational collections with PBKDF2-SHA256 key derivation and SHA-256
              integrity checksum. Passphrase is never stored on the server.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="bkp-label" className="block text-xs font-medium text-slate-700">
              Backup Label
            </label>
            <input
              id="bkp-label"
              type="text"
              maxLength={140}
              value={backupLabel}
              onChange={(e) => setBackupLabel(e.target.value)}
              placeholder="e.g. Election Day 18:00 Constituency Snapshot"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
            />
          </div>
          <div>
            <label htmlFor="bkp-pass" className="block text-xs font-medium text-slate-700">
              Encryption Passphrase (min 8 characters) *
            </label>
            <input
              id="bkp-pass"
              type="password"
              required
              minLength={8}
              value={backupPassphrase}
              onChange={(e) => setBackupPassphrase(e.target.value)}
              placeholder="Strong admin passphrase (required to decrypt later)"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creatingBackup}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#043B29] disabled:opacity-60 whitespace-nowrap"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>{creatingBackup ? 'Encrypting & Downloading...' : 'Create Encrypted Backup'}</span>
          </button>
        </div>
      </form>

      {/* 7-Step Controlled Recovery Wizard */}
      <div className="fdmis-surface p-3.5 sm:p-4 space-y-4">
        <div className="flex items-start gap-2.5 border-b border-slate-100 pb-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              7-Step Controlled System Recovery Wizard
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Automatically creates a pre-restoration backup and skips all{' '}
              <strong className="font-mono">{deletionTombstones.length}</strong> server deletion
              tombstones so permanently deleted records are never resurrected.
            </p>
          </div>
        </div>

        {/* Steps 1 & 2: Upload & Verify */}
        <form onSubmit={handleVerifyBackup} className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="rec-file" className="block text-xs font-medium text-slate-700">
              Step 1 · Upload Encrypted Backup (.fdmis.json)
            </label>
            <label className="mt-1 flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100">
              <Upload className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span className="truncate">{uploadedFileName || 'Choose .fdmis.json file'}</span>
              <input
                id="rec-file"
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
          </div>
          <div>
            <label htmlFor="rec-pass" className="block text-xs font-medium text-slate-700">
              Step 2 · Decryption Passphrase
            </label>
            <input
              id="rec-pass"
              type="password"
              required
              minLength={8}
              value={decryptPassphrase}
              onChange={(e) => setDecryptPassphrase(e.target.value)}
              placeholder="Enter backup passphrase"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-xs"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={inspecting || !rawBackupContent}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-lg border border-[#06452F] bg-white px-4 text-xs font-semibold text-[#06452F] hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>{inspecting ? 'Verifying SHA-256...' : 'Decrypt & Verify Integrity'}</span>
            </button>
          </div>
        </form>

        {/* Steps 3-7: Preview, Select Collections, Confirm Pre-Backup & Execute */}
        {preview ? (
          <form
            onSubmit={handleExecuteRecovery}
            className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4"
          >
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
              <p className="font-semibold">
                Step 3 · Backup Verified: {preview.envelope.label} ({preview.envelope.backupId})
              </p>
              <p className="mt-0.5 font-mono text-[11px]">
                SHA-256: {preview.envelope.sha256Checksum.slice(0, 24)}… · Total Records:{' '}
                {preview.totalRecords} · Protected Tombstones Skipped:{' '}
                {preview.tombstonedSkippedCount}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-800">
                Step 4 · Select Collections to Restore ({selectedCollections.length} selected)
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {(Object.keys(preview.collections) as BackupCollectionName[]).map((col) => (
                  <label
                    key={col}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px]"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedCollections.includes(col)}
                        onChange={() => toggleCollection(col)}
                        className="h-3.5 w-3.5 accent-[#06452F]"
                      />
                      <span className="truncate font-mono text-slate-800">{col}</span>
                    </span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {preview.collections[col]?.length || 0}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="pre-pass" className="block text-xs font-medium text-slate-700">
                  Step 5 · Passphrase for Automatic Pre-Restoration Safety Backup *
                </label>
                <input
                  id="pre-pass"
                  type="password"
                  required
                  minLength={8}
                  value={preBackupPassphrase}
                  onChange={(e) => setPreBackupPassphrase(e.target.value)}
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                />
              </div>
              <div>
                <label htmlFor="rec-reason" className="block text-xs font-medium text-slate-700">
                  Audit Reason for Recovery *
                </label>
                <input
                  id="rec-reason"
                  type="text"
                  required
                  minLength={5}
                  value={recoveryReason}
                  onChange={(e) => setRecoveryReason(e.target.value)}
                  placeholder="Document why controlled restoration is being executed..."
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-800">
              <input
                type="checkbox"
                checked={confirmPreBackupChecked}
                onChange={(e) => setConfirmPreBackupChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#06452F]"
              />
              <span>
                I confirm that a fresh <strong>PRE_RESTORATION</strong> encrypted backup of current
                live data will be downloaded automatically before restoration begins, and all server
                deletion tombstones will remain strictly excluded.
              </span>
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex-1 sm:max-w-xs">
                <label htmlFor="rec-phrase" className="block text-xs font-semibold text-red-900">
                  Step 6 · Type <span className="font-mono">RESTORE BACKUP</span> to execute:
                </label>
                <input
                  id="rec-phrase"
                  type="text"
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  placeholder="RESTORE BACKUP"
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-red-300 bg-white px-3 font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={
                  executingRecovery ||
                  confirmPhrase.trim() !== 'RESTORE BACKUP' ||
                  !confirmPreBackupChecked ||
                  selectedCollections.length === 0
                }
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-red-700 px-5 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50 whitespace-nowrap"
              >
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                <span>
                  {executingRecovery ? 'Executing Step 7 Recovery...' : 'Step 7 · Execute Controlled Recovery'}
                </span>
              </button>
            </div>
          </form>
        ) : null}

        {recoveryResult ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950">
            <p className="font-semibold">
              Recovery Audit Summary ({formatFirestoreTime(recoveryResult.executedAtIso)})
            </p>
            <p className="mt-1 font-mono text-[11px]">
              Restored: {recoveryResult.restoredCount} · Skipped Tombstoned Deleted Records:{' '}
              {recoveryResult.skippedTombstonedCount} · Safety Pre-Backup:{' '}
              {recoveryResult.preRestorationBackupId}
            </p>
          </div>
        ) : null}
      </div>

      {/* System Backup Audit History */}
      <div className="fdmis-surface p-3.5 sm:p-4 space-y-3">
        <h4 className="font-display text-sm font-semibold text-slate-900">
          Backup Verification &amp; Audit History ({systemBackups.length})
        </h4>
        {systemBackups.length === 0 ? (
          <p className="text-xs text-slate-500">
            No encrypted system backups have been recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Label &amp; Type</th>
                  <th className="px-3 py-2">Algorithm · SHA-256</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {systemBackups.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatFirestoreTime(b.createdAtIso || b.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{b.label}</p>
                      <p className="font-mono text-[10px] text-slate-500">
                        {b.backupType} · {b.createdByName}
                      </p>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {b.encryptionAlgorithm} · {b.sha256Checksum ? `${b.sha256Checksum.slice(0, 14)}…` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-slate-700">
                      {(b.sizeBytes / 1024).toFixed(1)} KB
                    </td>
                    <td className="px-3 py-2">
                      {b.status === 'FAILED' ? (
                        <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-800">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          FAILED
                        </span>
                      ) : (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-900">
                          {b.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
