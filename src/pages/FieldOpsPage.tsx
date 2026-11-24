import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Battery,
  Camera,
  CheckCircle2,
  CloudOff,
  Compass,
  Radio,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PuStatusBadge } from '../components/StatusBadge';
import { SyncHealthPanel } from '../components/SyncHealthPanel';
import {
  PU_STATUS_META,
  PuOperationalStatus,
  canReviewIncidents,
  formatFirestoreTime,
  type AgentCheckIn,
  type OfflineQueuedItem,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
} from '../types/fdmis';
import {
  clearDraft,
  enqueueOfflineSubmission,
  getOrCreateDeviceRefId,
  loadDraft,
  saveDraft,
} from '../services/offlineQueue';
import {
  flushOfflineQueue,
  reviewCheckInException,
  submitCheckIn,
  updatePollingUnitStatus,
} from '../services/operationsService';
import { processEvidenceFile } from '../utils/evidenceCompression';

interface FieldOpsPageProps {
  user: UserAccount;
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  results: ResultSubmission[];
  queuedItems: OfflineQueuedItem[];
  isOnline: boolean;
  lastSyncedAtIso?: string | null;
  serverTombstoneCount?: number;
  onRetryQueueItem?: (item: OfflineQueuedItem, force?: boolean) => Promise<void> | void;
  onRefreshQueue?: () => Promise<void> | void;
}

const FIELD_STATUS_OPTIONS = [
  { value: 'ON_SITE_ACTIVE', label: 'On Site & Active' },
  { value: 'EN_ROUTE_TO_PU', label: 'En Route to Polling Unit' },
  { value: 'MATERIALS_MONITORING', label: 'Monitoring Materials Arrival' },
  { value: 'VOTING_MONITORING', label: 'Monitoring Accreditation / Voting' },
  { value: 'COUNTING_OBSERVATION', label: 'Observing Vote Counting' },
  { value: 'RELIEF_HANDOVER', label: 'Shift Handover / Relief' },
];

export function FieldOpsPage({
  user,
  pollingUnits,
  checkIns,
  results,
  queuedItems,
  isOnline,
  lastSyncedAtIso = null,
  serverTombstoneCount = 0,
  onRetryQueueItem,
  onRefreshQueue,
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
  const [fieldStatus, setFieldStatus] = useState('ON_SITE_ACTIVE');
  const [batteryPercent, setBatteryPercent] = useState<number>(-1);
  const [deviceId] = useState<string>(() => getOrCreateDeviceRefId());
  const [captureGps, setCaptureGps] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(
    null
  );
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);

  const [reviewingExceptionId, setReviewingExceptionId] = useState<string | null>(null);
  const [exceptionReviewNote, setExceptionReviewNote] = useState('');
  const [savingExceptionReview, setSavingExceptionReview] = useState(false);

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
  const canReviewExceptions = canReviewIncidents(user.role);

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
    setGpsNotice('Capturing GPS coordinates & accuracy...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: acc,
        });
        setCaptureGps(true);
        setGpsNotice(
          `GPS verified: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}${acc !== null ? ` (±${acc}m)` : ''}`
        );
      },
      () => {
        setCaptureGps(false);
        setCoords(null);
        setGpsNotice('Location permission declined; check-in remains fully functional.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const processed = await processEvidenceFile(file);
      setPhotoBase64(processed.base64Data);
      setPhotoFileName(processed.fileName);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to process check-in photo.',
      });
    }
  };

  const selectedPu = useMemo(
    () => pollingUnits.find((p) => p.id === selectedPuId) || null,
    [pollingUnits, selectedPuId]
  );
  const statusPu = useMemo(
    () => pollingUnits.find((p) => p.id === statusPuId) || null,
    [pollingUnits, statusPuId]
  );

  const pendingLocationExceptions = useMemo(
    () =>
      checkIns.filter(
        (c) => c.locationExceptionFlag && (!c.exceptionReviewStatus || c.exceptionReviewStatus === 'PENDING_REVIEW')
      ),
    [checkIns]
  );

  const handleReviewException = async (
    chk: AgentCheckIn,
    decision: 'EXPLAINED' | 'CONFIRMED_EXCEPTION'
  ) => {
    setSavingExceptionReview(true);
    setFeedback(null);
    try {
      await reviewCheckInException(user, chk, decision, exceptionReviewNote);
      setReviewingExceptionId(null);
      setExceptionReviewNote('');
      setFeedback({
        type: 'ok',
        text: `Location review note saved for ${chk.puCode} (${chk.agentName}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save location exception review.',
      });
    } finally {
      setSavingExceptionReview(false);
    }
  };

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
      gpsAccuracyMeters: captureGps && coords ? coords.accuracy : null,
      deviceId,
      fieldStatus,
      photoBase64,
      photoFileName,
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
      setPhotoBase64(null);
      setPhotoFileName(null);
      setSubmittingCheckIn(false);
      setFeedback({
        type: 'warn',
        text: 'OFFLINE: GPS-tagged check-in saved locally as PENDING SYNCHRONIZATION and will transmit automatically when connectivity returns.',
      });
      return;
    }

    try {
      await submitCheckIn(user, selectedPu, payload);
      await clearDraft(`checkin_${user.uid}`);
      setComments('');
      setPhotoBase64(null);
      setPhotoFileName(null);
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
        text: 'OFFLINE: Polling unit status queued locally as PENDING SYNCHRONIZATION.',
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

  const handleManualSync = async (force?: boolean) => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await flushOfflineQueue(user, pollingUnits, results, { force });
      setFeedback({
        type: res.failedCount > 0 ? 'warn' : 'ok',
        text: `Sync complete: ${res.syncedCount} synchronized, ${res.failedCount} pending/failed.`,
      });
      if (onRefreshQueue) await onRefreshQueue();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
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
        <div className="grid grid-cols-1 gap-3.5 sm:gap-4 lg:grid-cols-2">
          {/* Election-Day Agent Check-In Form */}
          <section className="fdmis-surface p-4 sm:p-5">
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <label htmlFor="chk-field-status" className="block text-xs font-medium text-slate-700">
                    Field Assignment Status
                  </label>
                  <select
                    id="chk-field-status"
                    value={fieldStatus}
                    onChange={(e) => setFieldStatus(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    {FIELD_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="chk-comments" className="block text-xs font-medium text-slate-700">
                  Operational Arrival Comments
                </label>
                <textarea
                  id="chk-comments"
                  rows={2}
                  maxLength={500}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Presence confirmed, election officials & security status..."
                  className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
                />
              </div>

              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-700">
                    {gpsNotice ||
                      (coords
                        ? `GPS: ${coords.lat}, ${coords.lng}${coords.accuracy !== null ? ` (±${coords.accuracy}m)` : ''}`
                        : 'Attach GPS coordinates & accuracy (recommended for presence verification)')}
                  </span>
                  <button
                    type="button"
                    onClick={handleRequestLocation}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Capture GPS</span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                  <label className="inline-flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                    <Camera className="h-3.5 w-3.5 text-slate-500" />
                    <span>{photoFileName ? `Photo: ${photoFileName}` : 'Optional Arrival Photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoChange}
                      className="sr-only"
                    />
                  </label>
                  <span className="font-mono text-[11px] text-slate-500">Device: {deviceId}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingCheckIn}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#06452F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#043B29] disabled:opacity-60"
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
          <section className="fdmis-surface p-4 sm:p-5">
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
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-[#06452F] bg-white px-4 py-2.5 text-sm font-semibold text-[#06452F] hover:bg-emerald-50 disabled:opacity-60"
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

      {/* Module 10: Offline Sync Health Centre */}
      <SyncHealthPanel
        isOnline={isOnline}
        isSyncing={syncing}
        lastSyncedAtIso={lastSyncedAtIso}
        queuedItems={queuedItems}
        serverTombstoneCount={serverTombstoneCount}
        onManualSync={handleManualSync}
        onRetryItem={async (item, force) => {
          if (onRetryQueueItem) {
            await onRetryQueueItem(item, force);
          } else {
            await handleManualSync(true);
          }
        }}
        onRefreshQueue={onRefreshQueue}
      />

      {/* Admin Location Exception Review Queue (Strictly Neutral Administrative Review) */}
      {canReviewExceptions && pendingLocationExceptions.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Check-In Location Exceptions Pending Administrative Review ({pendingLocationExceptions.length})
              </h3>
              <p className="text-xs text-slate-700 mt-0.5">
                GPS readings differed by more than 1,000m from verified polling unit coordinates. This may
                reflect GPS drift, rural signal bounce, or check-in before reaching the site — please review
                neutrally with the officer.
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {pendingLocationExceptions.map((chk) => (
              <div
                key={chk.id}
                className="rounded-lg border border-amber-200 bg-white p-3.5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-mono font-bold text-slate-900">{chk.puCode}</span> ·{' '}
                    <span className="font-semibold text-slate-800">{chk.agentName}</span> ·{' '}
                    <span className="text-amber-800 font-semibold tabular-nums">
                      Distance: {chk.locationExceptionDistanceMeters?.toLocaleString()}m
                    </span>
                    {typeof chk.gpsAccuracyMeters === 'number' && (
                      <span className="text-slate-500"> (±{chk.gpsAccuracyMeters}m GPS accuracy)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewingExceptionId(reviewingExceptionId === chk.id ? null : chk.id);
                      setExceptionReviewNote('');
                    }}
                    className="px-2.5 py-1 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    {reviewingExceptionId === chk.id ? 'Close Review' : 'Record Review Note'}
                  </button>
                </div>

                {reviewingExceptionId === chk.id ? (
                  <div className="space-y-2 border-t border-slate-100 pt-2.5">
                    <textarea
                      rows={2}
                      value={exceptionReviewNote}
                      onChange={(e) => setExceptionReviewNote(e.target.value)}
                      placeholder="Enter administrative review note (e.g. confirmed officer at PU via phone; GPS drift caused by network tower)..."
                      className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={savingExceptionReview || exceptionReviewNote.trim().length < 3}
                        onClick={() => void handleReviewException(chk, 'EXPLAINED')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Mark Explained / Cleared
                      </button>
                      <button
                        type="button"
                        disabled={savingExceptionReview || exceptionReviewNote.trim().length < 3}
                        onClick={() => void handleReviewException(chk, 'CONFIRMED_EXCEPTION')}
                        className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        Log Follow-Up Required
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Live Check-Ins Log */}
      <section className="fdmis-surface overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Confirmed Agent &amp; Officer Check-Ins ({checkIns.length})
          </h3>
        </div>
        {checkIns.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No operational data has been submitted yet."
              description="Confirmed polling unit agent and officer arrivals will appear here in real time."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Polling Unit</th>
                  <th className="px-4 py-3">Personnel</th>
                  <th className="px-4 py-3">Arrival &amp; Status</th>
                  <th className="px-4 py-3">GPS / Device</th>
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
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-mono">{chk.arrivalTimeText}</div>
                      {chk.fieldStatus && (
                        <div className="text-[11px] text-slate-500">
                          {chk.fieldStatus.replace(/_/g, ' ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                      <div>
                        {typeof chk.latitude === 'number' && typeof chk.longitude === 'number'
                          ? `${chk.latitude.toFixed(4)}, ${chk.longitude.toFixed(4)}${typeof chk.gpsAccuracyMeters === 'number' ? ` (±${chk.gpsAccuracyMeters}m)` : ''}`
                          : 'No GPS'}
                      </div>
                      <div className="text-slate-400">
                        {chk.batteryPercent >= 0 ? `${chk.batteryPercent}% · ` : ''}
                        {chk.deviceId || chk.networkStatus}
                      </div>
                      {chk.locationExceptionFlag && (
                        <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-sans font-semibold text-amber-800 border border-amber-200">
                          Location review: {chk.locationExceptionDistanceMeters}m (
                          {chk.exceptionReviewStatus || 'PENDING'})
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div>{chk.comments || '—'}</div>
                      {chk.photoBase64 && (
                        <span className="mt-1 inline-block text-[11px] text-emerald-700 font-medium">
                          Photo attached
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                      <div>Orig: {formatFirestoreTime(chk.clientCreatedAtIso || chk.createdAt)}</div>
                      {chk.serverSyncedAt ? (
                        <div className="text-slate-400">
                          Sync: {formatFirestoreTime(chk.serverSyncedAt)}
                        </div>
                      ) : null}
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
