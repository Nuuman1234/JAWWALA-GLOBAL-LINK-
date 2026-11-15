import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Battery,
  CheckCircle2,
  CloudOff,
  Compass,
  Radio,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { OfflineSyncBadge, PuStatusBadge } from '../components/StatusBadge';
import {
  PU_STATUS_META,
  PuOperationalStatus,
  formatFirestoreTime,
  type AgentCheckIn,
  type OfflineQueuedItem,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
} from '../types/fdmis';
import {
  clearDraft,
  clearSyncedQueueItems,
  enqueueOfflineSubmission,
  loadDraft,
  saveDraft,
} from '../services/offlineQueue';
import {
  flushOfflineQueue,
  submitCheckIn,
  updatePollingUnitStatus,
} from '../services/operationsService';

interface FieldOpsPageProps {
  user: UserAccount;
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  results: ResultSubmission[];
  queuedItems: OfflineQueuedItem[];
  isOnline: boolean;
}

export function FieldOpsPage({
  user,
  pollingUnits,
  checkIns,
  results,
  queuedItems,
  isOnline,
}: FieldOpsPageProps) {
  const defaultPuId =
    pollingUnits.find((p) => p.id === user.assignedPollingUnitId)?.id ||
    pollingUnits[0]?.id ||
    '';

  const [selectedPuId, setSelectedPuId] = useState(defaultPuId);
  const [arrivalTimeText, setArrivalTimeText] = useState(() =>
    new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
  );
  const [comments, setComments] = useState('');
  const [batteryPercent, setBatteryPercent] = useState<number>(-1);
  const [captureGps, setCaptureGps] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);

  const [statusPuId, setStatusPuId] = useState(defaultPuId);
  const [nextPuStatus, setNextPuStatus] = useState<PuOperationalStatus>(
    PuOperationalStatus.MATERIALS_ARRIVED
  );
  const [statusNote, setStatusNote] = useState('');

  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [submittingStatus, setSubmittingStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );

  // Keep selected PU synced when list loads
  useEffect(() => {
    if (!selectedPuId && pollingUnits.length > 0) {
      const assigned = pollingUnits.find((p) => p.id === user.assignedPollingUnitId);
      setSelectedPuId(assigned?.id || pollingUnits[0].id);
      setStatusPuId(assigned?.id || pollingUnits[0].id);
    }
  }, [pollingUnits, selectedPuId, user.assignedPollingUnitId]);

  // Restore saved check-in draft
  useEffect(() => {
    void loadDraft<{ selectedPuId?: string; arrivalTimeText?: string; comments?: string }>(
      `checkin_${user.uid}`
    ).then((draft) => {
      if (draft) {
        if (draft.selectedPuId) setSelectedPuId(draft.selectedPuId);
        if (draft.arrivalTimeText) setArrivalTimeText(draft.arrivalTimeText);
        if (draft.comments) setComments(draft.comments);
      }
    });
  }, [user.uid]);

  // Auto-save check-in draft locally
  useEffect(() => {
    void saveDraft(`checkin_${user.uid}`, {
      selectedPuId,
      arrivalTimeText,
      comments,
    });
  }, [user.uid, selectedPuId, arrivalTimeText, comments]);

  // Optional browser Battery API detection (non-blocking)
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((bat) => setBatteryPercent(Math.round(bat.level * 100)))
        .catch(() => setBatteryPercent(-1));
    }
  }, []);

  const handleRequestLocation = () => {
    if (!navigator.geolocation) {
      setGpsNotice('Browser geolocation unavailable; check-in proceeds without coordinates.');
      return;
    }
    setGpsNotice('Requesting optional location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        });
        setCaptureGps(true);
        setGpsNotice('Coarse location attached (optional).');
      },
      () => {
        setCaptureGps(false);
        setCoords(null);
        setGpsNotice('Location permission declined; check-in remains fully functional.');
      },
      { timeout: 6000, maximumAge: 60000 }
    );
  };

  const selectedPu = useMemo(
    () => pollingUnits.find((p) => p.id === selectedPuId) || null,
    [pollingUnits, selectedPuId]
  );
  const statusPu = useMemo(
    () => pollingUnits.find((p) => p.id === statusPuId) || null,
    [pollingUnits, statusPuId]
  );

  const handleCheckInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPu) {
      setFeedback({ type: 'err', text: 'Select a valid polling unit first.' });
      return;
    }
    setSubmittingCheckIn(true);
    setFeedback(null);

    const payload = {
      arrivalTimeText: arrivalTimeText.trim() || new Date().toLocaleTimeString(),
      comments: comments.trim(),
      batteryPercent,
      networkStatus: isOnline ? 'Online (Browser)' : 'Offline (Queued)',
      latitude: captureGps && coords ? coords.lat : null,
      longitude: captureGps && coords ? coords.lng : null,
      isTestData: false,
    };

    if (!isOnline) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'CHECK_IN',
        puId: selectedPu.id,
        puCode: selectedPu.puCode,
        puName: selectedPu.name,
        lgaId: selectedPu.lgaId,
        wardId: selectedPu.wardId,
        summary: `Check-in at ${selectedPu.puCode} (${payload.arrivalTimeText})`,
        payload,
        status: 'PENDING_SYNC',
      });
      await clearDraft(`checkin_${user.uid}`);
      setComments('');
      setSubmittingCheckIn(false);
      setFeedback({
        type: 'warn',
        text: 'Device is offline. Check-in saved locally as Pending Sync and will transmit automatically when connectivity returns.',
      });
      return;
    }

    try {
      await submitCheckIn(user, selectedPu, payload);
      await clearDraft(`checkin_${user.uid}`);
      setComments('');
      setFeedback({
        type: 'ok',
        text: `Check-in confirmed by server for ${selectedPu.puCode} (${selectedPu.name}).`,
      });
    } catch (err) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'CHECK_IN',
        puId: selectedPu.id,
        puCode: selectedPu.puCode,
        puName: selectedPu.name,
        lgaId: selectedPu.lgaId,
        wardId: selectedPu.wardId,
        summary: `Check-in at ${selectedPu.puCode} (${payload.arrivalTimeText})`,
        payload,
        status: 'SYNC_FAILED',
      });
      setFeedback({
        type: 'warn',
        text: `Server receipt not confirmed (${err instanceof Error ? err.message : 'network error'}). Saved in offline queue for retry.`,
      });
    } finally {
      setSubmittingCheckIn(false);
    }
  };

  const handleStatusSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!statusPu) {
      setFeedback({ type: 'err', text: 'Select a valid polling unit.' });
      return;
    }
    setSubmittingStatus(true);
    setFeedback(null);

    if (!isOnline) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'STATUS_UPDATE',
        puId: statusPu.id,
        puCode: statusPu.puCode,
        puName: statusPu.name,
        lgaId: statusPu.lgaId,
        wardId: statusPu.wardId,
        summary: `Status ${PU_STATUS_META[nextPuStatus].label} at ${statusPu.puCode}`,
        payload: { operationalStatus: nextPuStatus, note: statusNote.trim() },
        status: 'PENDING_SYNC',
      });
      setStatusNote('');
      setSubmittingStatus(false);
      setFeedback({
        type: 'warn',
        text: 'Offline: Polling unit status queued locally as Pending Sync.',
      });
      return;
    }

    try {
      await updatePollingUnitStatus(user, statusPu, nextPuStatus, statusNote);
      setStatusNote('');
      setFeedback({
        type: 'ok',
        text: `Polling unit ${statusPu.puCode} status confirmed as ${PU_STATUS_META[nextPuStatus].label}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update polling unit status.',
      });
    } finally {
      setSubmittingStatus(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await flushOfflineQueue(user, pollingUnits, results);
      setFeedback({
        type: res.failedCount > 0 ? 'warn' : 'ok',
        text: `Sync complete: ${res.syncedCount} confirmed by Firestore, ${res.failedCount} failed.`,
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : feedback.type === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {pollingUnits.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="No polling units are assigned or imported in your scope yet. An authorized administrator must import or assign your polling unit before field check-ins can be logged."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Election-Day Agent Check-In Form */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Election-Day Agent Check-In
                </h2>
                <p className="text-xs text-slate-500">
                  Drafts auto-save locally; queues safely when offline
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Battery className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="font-mono tabular-nums">
                    {batteryPercent >= 0 ? `${batteryPercent}%` : 'N/A'}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1">
                  {isOnline ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <CloudOff className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                  )}
                </span>
              </div>
            </div>

            <form onSubmit={handleCheckInSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="chk-pu" className="block text-xs font-medium text-slate-700">
                  Polling Unit *
                </label>
                <select
                  id="chk-pu"
                  required
                  value={selectedPuId}
                  onChange={(e) => setSelectedPuId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  {pollingUnits.map((pu) => (
                    <option key={pu.id} value={pu.id}>
                      {pu.puCode} · {pu.name} ({pu.wardName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="chk-time" className="block text-xs font-medium text-slate-700">
                  Confirmed Arrival Time *
                </label>
                <input
                  id="chk-time"
                  type="text"
                  required
                  maxLength={64}
                  value={arrivalTimeText}
                  onChange={(e) => setArrivalTimeText(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm font-mono"
                />
              </div>

              <div>
                <label htmlFor="chk-comments" className="block text-xs font-medium text-slate-700">
                  Operational Arrival Comments
                </label>
                <textarea
                  id="chk-comments"
                  rows={3}
                  maxLength={500}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Presence confirmed, election officials & security status..."
                  className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <span className="text-slate-600">
                  {gpsNotice ||
                    (coords
                      ? `Location attached: ${coords.lat}, ${coords.lng}`
                      : 'Optional location telemetry (never blocks check-in)')}
                </span>
                <button
                  type="button"
                  onClick={handleRequestLocation}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100"
                >
                  <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Attach Location</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={submittingCheckIn}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>
                  {submittingCheckIn
                    ? 'Transmitting...'
                    : isOnline
                      ? 'Confirm Arrival Check-In'
                      : 'Queue Check-In Offline'}
                </span>
              </button>
            </form>
          </section>

          {/* Polling Unit Operational Status Progression */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Update Polling Unit Operational Status
              </h2>
              <p className="text-xs text-slate-500">
                Track all 13 election-day stages from Materials Arrived through Counting &amp; Verification
              </p>
            </div>

            <form onSubmit={handleStatusSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="st-pu" className="block text-xs font-medium text-slate-700">
                  Polling Unit *
                </label>
                <select
                  id="st-pu"
                  required
                  value={statusPuId}
                  onChange={(e) => setStatusPuId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  {pollingUnits.map((pu) => (
                    <option key={pu.id} value={pu.id}>
                      {pu.puCode} · {pu.name}
                    </option>
                  ))}
                </select>
              </div>

              {statusPu ? (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-600">Current Status</span>
                  <PuStatusBadge status={statusPu.operationalStatus} />
                </div>
              ) : null}

              <div>
                <label htmlFor="st-next" className="block text-xs font-medium text-slate-700">
                  New Operational Status *
                </label>
                <select
                  id="st-next"
                  value={nextPuStatus}
                  onChange={(e) => setNextPuStatus(e.target.value as PuOperationalStatus)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  {Object.values(PuOperationalStatus).map((st) => (
                    <option key={st} value={st}>
                      {PU_STATUS_META[st].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="st-note" className="block text-xs font-medium text-slate-700">
                  Milestone Note (Optional)
                </label>
                <textarea
                  id="st-note"
                  rows={2}
                  maxLength={400}
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="e.g. INEC sensitive materials arrived with security escort at 08:15"
                  className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submittingStatus}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-[#0b3b24] bg-white px-4 py-2.5 text-sm font-semibold text-[#0b3b24] hover:bg-emerald-50 disabled:opacity-60"
              >
                <Radio className="h-4 w-4" aria-hidden="true" />
                <span>
                  {submittingStatus
                    ? 'Updating...'
                    : isOnline
                      ? 'Submit Status Update'
                      : 'Queue Status Offline'}
                </span>
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Offline Sync Queue */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Offline Sync Queue (Deduplicated)
            </h3>
            <p className="text-xs text-slate-500">
              Reports saved locally while offline use unique clientSubmissionIds and sync automatically on reconnect.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isOnline || syncing || queuedItems.length === 0}
              onClick={() => void handleManualSync()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0b3b24] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#115233] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{syncing ? 'Syncing...' : 'Sync Pending Reports'}</span>
            </button>
            {queuedItems.some((q) => q.status === 'SYNCED') ? (
              <button
                type="button"
                onClick={() => void clearSyncedQueueItems(user.uid)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear Synced</span>
              </button>
            ) : null}
          </div>
        </div>

        {queuedItems.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            No locally queued reports pending synchronization.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {queuedItems.map((item) => (
              <div
                key={item.clientSubmissionId}
                className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.summary}</p>
                  <p className="font-mono text-xs text-slate-500">
                    {item.reportType} · {item.clientSubmissionId}
                  </p>
                  {item.errorMessage ? (
                    <p className="mt-0.5 text-xs text-red-700">{item.errorMessage}</p>
                  ) : null}
                </div>
                <OfflineSyncBadge status={item.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Check-Ins Log */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Confirmed Agent Check-Ins ({checkIns.length})
          </h3>
        </div>
        {checkIns.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No operational data has been submitted yet."
              description="Confirmed polling unit agent arrivals will appear here in real time."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Polling Unit</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Arrival Time</th>
                  <th className="px-4 py-3">Device / Net</th>
                  <th className="px-4 py-3">Comments</th>
                  <th className="px-4 py-3">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {checkIns.slice(0, 50).map((chk) => (
                  <tr key={chk.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-slate-800">{chk.puCode}</p>
                      <p className="text-xs text-slate-600">{chk.puName}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {chk.agentName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {chk.arrivalTimeText}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {chk.batteryPercent >= 0 ? `${chk.batteryPercent}% · ` : ''}
                      {chk.networkStatus}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {chk.comments || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {formatFirestoreTime(chk.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
