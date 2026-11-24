import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Wifi,
} from 'lucide-react';
import { formatFirestoreTime, type OfflineQueuedItem } from '../types/fdmis';
import {
  clearSyncedQueueItems,
  deleteQueueItem,
  getOfflineStorageEstimate,
  type OfflineStorageEstimate,
} from '../services/offlineQueue';

interface SyncHealthPanelProps {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAtIso: string | null;
  queuedItems: OfflineQueuedItem[];
  serverTombstoneCount?: number;
  onManualSync: (force?: boolean) => Promise<void> | void;
  onRetryItem: (item: OfflineQueuedItem, force?: boolean) => Promise<void> | void;
  onRefreshQueue?: () => Promise<void> | void;
}

export const SyncHealthPanel: React.FC<SyncHealthPanelProps> = ({
  isOnline,
  isSyncing,
  lastSyncedAtIso,
  queuedItems,
  serverTombstoneCount = 0,
  onManualSync,
  onRetryItem,
  onRefreshQueue,
}) => {
  const [storage, setStorage] = useState<OfflineStorageEstimate>({
    usageBytes: 0,
    quotaBytes: 0,
    percentUsed: 0,
    persisted: false,
    supported: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOfflineStorageEstimate().then((est) => {
      if (active) setStorage(est);
    });
    return () => {
      active = false;
    };
  }, [queuedItems.length]);

  const pendingItems = queuedItems.filter(
    (i) => i.status === 'PENDING_SYNC' || i.status === 'SAVED_LOCALLY' || i.status === 'SYNCING'
  );
  const failedItems = queuedItems.filter(
    (i) => i.status === 'SYNC_FAILED' && i.conflictState !== 'CONFLICT_DETECTED'
  );
  const conflictItems = queuedItems.filter((i) => i.conflictState === 'CONFLICT_DETECTED');
  const syncedItems = queuedItems.filter((i) => i.status === 'SYNCED');

  const totalActionable = pendingItems.length + failedItems.length + conflictItems.length;
  const syncProgressPct =
    queuedItems.length > 0
      ? Math.round((syncedItems.length / queuedItems.length) * 100)
      : 100;

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  };

  const handleDiscardItem = async (item: OfflineQueuedItem) => {
    setBusyId(item.clientSubmissionId);
    setStatusMessage(null);
    try {
      await deleteQueueItem(item.clientSubmissionId);
      setStatusMessage(`Discarded local queued record (${item.reportType}). Server state preserved.`);
      if (onRefreshQueue) await onRefreshQueue();
    } finally {
      setBusyId(null);
    }
  };

  const handleClearSynced = async () => {
    const ownerUid = syncedItems[0]?.ownerUid || queuedItems[0]?.ownerUid;
    if (!ownerUid) return;
    setBusyId('CLEAR_SYNCED');
    try {
      await clearSyncedQueueItems(ownerUid);
      setStatusMessage('Cleared completed sync history entries from local cache.');
      if (onRefreshQueue) await onRefreshQueue();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="fdmis-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-emerald-700" />
            ) : (
              <CloudOff className="w-4 h-4 text-amber-700" />
            )}
            <h2 className="text-base font-bold text-slate-900">Offline Sync Health Centre</h2>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            {isOnline ? 'Online — ready for server synchronization' : 'Offline — all changes safely queued locally'} · Last sync:{' '}
            {lastSyncedAtIso ? formatFirestoreTime(lastSyncedAtIso) : 'Not yet synced this session'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!isOnline || isSyncing}
            onClick={() => onManualSync(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Synchronizing...' : 'Sync Now (Force Retry)'}
          </button>
          {syncedItems.length > 0 && (
            <button
              type="button"
              disabled={busyId === 'CLEAR_SYNCED'}
              onClick={handleClearSynced}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 whitespace-nowrap"
            >
              Clear Synced ({syncedItems.length})
            </button>
          )}
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/60 tabular-nums">
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Pending Upload</div>
          <div className="text-lg font-bold text-slate-900 mt-0.5">{pendingItems.length}</div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Failed (Backoff)</div>
          <div className="text-lg font-bold text-amber-700 mt-0.5">{failedItems.length}</div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Sync Conflicts</div>
          <div className="text-lg font-bold text-rose-700 mt-0.5">{conflictItems.length}</div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Synced (Local Log)</div>
          <div className="text-lg font-bold text-emerald-700 mt-0.5">{syncedItems.length}</div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Server Tombstones</div>
          <div className="text-lg font-bold text-slate-900 mt-0.5">{serverTombstoneCount}</div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
            <HardDrive className="w-3 h-3" /> Device Cache
          </div>
          <div className="text-sm font-bold text-slate-900 mt-1">
            {storage.supported
              ? `${formatBytes(storage.usageBytes)} (${storage.percentUsed}%)`
              : 'Available'}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {(isSyncing || totalActionable > 0) && (
        <div className="px-5 py-2.5 bg-white border-b border-slate-200">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-slate-700">
              {isSyncing
                ? 'Active synchronization in progress...'
                : `${totalActionable} record(s) awaiting synchronization or review`}
            </span>
            <span className="font-mono text-slate-600 tabular-nums">{syncProgressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all duration-300"
              style={{ width: `${syncProgressPct}%` }}
            />
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Conflicts Alert Section */}
      {conflictItems.length > 0 && (
        <div className="p-4 bg-rose-50/70 border-b border-rose-200 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
            <ShieldAlert className="w-4 h-4 text-rose-700" />
            Sync Conflicts Requiring Operator Decision ({conflictItems.length})
          </div>
          {conflictItems.map((item) => (
            <div
              key={item.clientSubmissionId}
              className="rounded-lg border border-rose-200 bg-white p-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-bold text-slate-900">
                  {item.reportType} · {item.puCode || item.lgaId || 'General'}
                </div>
                <p className="text-xs text-rose-800">
                  {item.conflictServerSummary || item.errorMessage || 'Server record changed before sync.'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Queued locally: {formatFirestoreTime(item.createdAtIso)} · Attempts: {item.retryCount || 0}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyId === item.clientSubmissionId}
                  onClick={() => handleDiscardItem(item)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 whitespace-nowrap"
                >
                  Keep Server &amp; Discard Local
                </button>
                <button
                  type="button"
                  disabled={!isOnline || isSyncing}
                  onClick={() => onRetryItem(item, true)}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 disabled:opacity-50 whitespace-nowrap"
                >
                  Force Retry
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending & Failed Queue Table */}
      <div className="p-4">
        {pendingItems.length === 0 && failedItems.length === 0 ? (
          <div className="py-5 text-center text-xs text-slate-600 flex flex-col items-center gap-1.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="font-semibold text-slate-800">All offline submissions are synchronized</span>
            <span>
              Server deletion tombstones ({serverTombstoneCount}) are actively enforced so deleted
              records cannot reappear from device storage.
            </span>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {[...failedItems, ...pendingItems].map((item) => (
              <div
                key={item.clientSubmissionId}
                className="rounded-lg border border-slate-200 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{item.reportType}</span>
                    <span className="font-mono text-[11px] text-slate-600">
                      {item.puCode || item.lgaId || 'Constituency'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        item.status === 'SYNC_FAILED'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-sky-50 text-sky-800 border border-sky-200'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Created {formatFirestoreTime(item.createdAtIso)} · Retries: {item.retryCount || 0}
                    {item.nextRetryAtIso && item.status === 'SYNC_FAILED'
                      ? ` · Next backoff retry: ${formatFirestoreTime(item.nextRetryAtIso)}`
                      : ''}
                  </p>
                  {item.errorMessage && (
                    <p className="text-[11px] text-amber-800 mt-0.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {item.errorMessage}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!isOnline || isSyncing}
                    onClick={() => onRetryItem(item, true)}
                    className="px-2.5 py-1 rounded-md bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    Retry Now
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.clientSubmissionId}
                    onClick={() => handleDiscardItem(item)}
                    className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200"
                    title="Discard queued record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
