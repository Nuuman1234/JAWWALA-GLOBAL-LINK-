import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  FileImage,
  Plus,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  IncidentStatusBadge,
  IncidentUrgencyBadge,
  OfflineSyncBadge,
} from '../components/StatusBadge';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_STATUS_META,
  INCIDENT_URGENCY_META,
  IncidentStatus,
  IncidentUrgency,
  LGA_DEFINITIONS,
  canReviewIncidents,
  formatFirestoreTime,
  type IncidentReport,
  type OfflineQueuedItem,
  type PollingUnit,
  type UserAccount,
} from '../types/fdmis';
import { processEvidenceFile } from '../utils/evidenceCompression';
import {
  clearDraft,
  enqueueOfflineSubmission,
  loadDraft,
  saveDraft,
} from '../services/offlineQueue';
import {
  submitIncidentReport,
  updateIncidentWorkflow,
} from '../services/operationsService';

interface IncidentsPageProps {
  user: UserAccount;
  pollingUnits: PollingUnit[];
  incidents: IncidentReport[];
  queuedItems?: OfflineQueuedItem[];
  isOnline: boolean;
  onRetrySync?: () => void;
  syncingNow?: boolean;
}

export function IncidentsPage({
  user,
  pollingUnits,
  incidents,
  queuedItems = [],
  isOnline,
  onRetrySync,
  syncingNow = false,
}: IncidentsPageProps) {
  const canReview = canReviewIncidents(user.role);

  const [showForm, setShowForm] = useState(false);
  const [puId, setPuId] = useState(
    pollingUnits.find((p) => p.id === user.assignedPollingUnitId)?.id ||
      pollingUnits[0]?.id ||
      ''
  );
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(INCIDENT_CATEGORIES[0]);
  const [urgency, setUrgency] = useState<IncidentUrgency>(IncidentUrgency.MEDIUM);
  const [description, setDescription] = useState('');
  const [evidenceBase64, setEvidenceBase64] = useState<string | null>(null);
  const [evidenceFileName, setEvidenceFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [urgencyFilter, setUrgencyFilter] = useState<'ALL' | IncidentUrgency>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | IncidentStatus>('ALL');
  const [search, setSearch] = useState('');

  const [selectedIncident, setSelectedIncident] = useState<IncidentReport | null>(null);
  const [reviewStatus, setReviewStatus] = useState<IncidentStatus>(IncidentStatus.UNDER_REVIEW);
  const [reviewUrgency, setReviewUrgency] = useState<IncidentUrgency>(IncidentUrgency.MEDIUM);
  const [reviewNotes, setReviewNotes] = useState('');
  const [escalatedTo, setEscalatedTo] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!puId && pollingUnits.length > 0) {
      setPuId(
        pollingUnits.find((p) => p.id === user.assignedPollingUnitId)?.id || pollingUnits[0].id
      );
    }
  }, [pollingUnits, puId, user.assignedPollingUnitId]);

  useEffect(() => {
    void loadDraft<{ title?: string; category?: string; urgency?: IncidentUrgency; description?: string }>(
      `incident_${user.uid}`
    ).then((draft) => {
      if (draft) {
        if (draft.title) setTitle(draft.title);
        if (draft.category) setCategory(draft.category);
        if (draft.urgency) setUrgency(draft.urgency);
        if (draft.description) setDescription(draft.description);
      }
    });
  }, [user.uid]);

  useEffect(() => {
    if (title || description) {
      void saveDraft(`incident_${user.uid}`, { title, category, urgency, description });
    }
  }, [user.uid, title, category, urgency, description]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const processed = await processEvidenceFile(file);
      setEvidenceBase64(processed.base64Data);
      setEvidenceFileName(processed.fileName);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to process evidence file.',
      });
    }
  };

  const handleSubmitIncident = async (e: FormEvent) => {
    e.preventDefault();
    const pu = pollingUnits.find((p) => p.id === puId);
    if (!pu) {
      setFeedback({ type: 'err', text: 'Select a valid polling unit.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    const payload = {
      title: title.trim(),
      category,
      description: description.trim(),
      urgency,
      evidenceBase64,
      evidenceFileName,
      isTestData: false,
    };

    if (!isOnline) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'INCIDENT_REPORT',
        puId: pu.id,
        puCode: pu.puCode,
        puName: pu.name,
        lgaId: pu.lgaId,
        wardId: pu.wardId,
        summary: `[${urgency}] ${payload.title} (${pu.puCode})`,
        payload,
        status: 'PENDING_SYNC',
      });
      await clearDraft(`incident_${user.uid}`);
      setTitle('');
      setDescription('');
      setEvidenceBase64(null);
      setEvidenceFileName(null);
      setShowForm(false);
      setSubmitting(false);
      setFeedback({
        type: 'warn',
        text: 'Offline: Incident queued locally as Pending Sync and will transmit automatically upon reconnection.',
      });
      return;
    }

    try {
      await submitIncidentReport(user, pu, payload);
      await clearDraft(`incident_${user.uid}`);
      setTitle('');
      setDescription('');
      setEvidenceBase64(null);
      setEvidenceFileName(null);
      setShowForm(false);
      setFeedback({
        type: 'ok',
        text: `Incident report submitted to Situation Room for ${pu.puCode}.`,
      });
    } catch (err) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'INCIDENT_REPORT',
        puId: pu.id,
        puCode: pu.puCode,
        puName: pu.name,
        lgaId: pu.lgaId,
        wardId: pu.wardId,
        summary: `[${urgency}] ${payload.title} (${pu.puCode})`,
        payload,
        status: 'SYNC_FAILED',
      });
      setFeedback({
        type: 'warn',
        text: `Could not confirm server receipt (${err instanceof Error ? err.message : 'network error'}). Queued offline for retry.`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openIncidentModal = (inc: IncidentReport) => {
    setSelectedIncident(inc);
    setReviewStatus(inc.status);
    setReviewUrgency(inc.urgency);
    setReviewNotes(inc.internalNotes || '');
    setEscalatedTo(inc.escalatedTo || '');
  };

  const handleSaveReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedIncident) return;
    setSavingReview(true);
    setFeedback(null);
    try {
      await updateIncidentWorkflow(user, selectedIncident, {
        status: reviewStatus,
        urgency: reviewUrgency,
        internalNotes: reviewNotes,
        escalatedTo,
      });
      setFeedback({
        type: 'ok',
        text: `Incident "${selectedIncident.title}" updated to ${INCIDENT_STATUS_META[reviewStatus].label}.`,
      });
      setSelectedIncident(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update incident.',
      });
    } finally {
      setSavingReview(false);
    }
  };

  const queuedIncidents = useMemo(
    () =>
      queuedItems.filter(
        (item) => item.reportType === 'INCIDENT_REPORT' && item.status !== 'SYNCED'
      ),
    [queuedItems]
  );

  const filteredIncidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incidents.filter((inc) => {
      if (urgencyFilter !== 'ALL' && inc.urgency !== urgencyFilter) return false;
      if (statusFilter !== 'ALL' && inc.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inc.title.toLowerCase().includes(q) ||
        inc.category.toLowerCase().includes(q) ||
        inc.puCode.toLowerCase().includes(q) ||
        inc.puName.toLowerCase().includes(q)
      );
    });
  }, [incidents, urgencyFilter, statusFilter, search]);

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search incident title, category, or PU..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm sm:max-w-xs"
          />
          <select
            aria-label="Filter by Urgency"
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value as 'ALL' | IncidentUrgency)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="ALL">All Urgencies</option>
            {Object.values(IncidentUrgency).map((u) => (
              <option key={u} value={u}>
                {INCIDENT_URGENCY_META[u].label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | IncidentStatus)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="ALL">All Statuses</option>
            {Object.values(IncidentStatus).map((s) => (
              <option key={s} value={s}>
                {INCIDENT_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={pollingUnits.length === 0}
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{showForm ? 'Hide Report Form' : 'Report Incident'}</span>
        </button>
      </div>

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

      {/* Incident Submission Form */}
      {showForm ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Submit Structured Incident Report
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Critical incidents trigger immediate Situation Room alerts. Evidence is compressed automatically for low-bandwidth delivery.
          </p>

          <form onSubmit={handleSubmitIncident} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="inc-pu" className="block text-xs font-medium text-slate-700">
                Polling Unit *
              </label>
              <select
                id="inc-pu"
                required
                value={puId}
                onChange={(e) => setPuId(e.target.value)}
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
              <label htmlFor="inc-cat" className="block text-xs font-medium text-slate-700">
                Incident Category *
              </label>
              <select
                id="inc-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {INCIDENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="inc-title" className="block text-xs font-medium text-slate-700">
                Incident Title *
              </label>
              <input
                id="inc-title"
                type="text"
                required
                minLength={3}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief factual headline of the incident"
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="inc-urg" className="block text-xs font-medium text-slate-700">
                Urgency Level *
              </label>
              <select
                id="inc-urg"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as IncidentUrgency)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {Object.values(IncidentUrgency).map((u) => (
                  <option key={u} value={u}>
                    {INCIDENT_URGENCY_META[u].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="inc-desc" className="block text-xs font-medium text-slate-700">
                Detailed Observation *
              </label>
              <textarea
                id="inc-desc"
                rows={3}
                required
                minLength={5}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened, officials involved, and immediate impact..."
                className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="inc-evidence" className="block text-xs font-medium text-slate-700">
                Optional Evidence Photo / Document (Compressed automatically)
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <input
                  id="inc-evidence"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700"
                />
                {evidenceFileName ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                    <FileImage className="h-4 w-4" aria-hidden="true" />
                    <span>{evidenceFileName} attached</span>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-5 py-2 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <span>
                  {submitting
                    ? 'Submitting...'
                    : isOnline
                      ? 'Submit Incident Report'
                      : 'Queue Incident Offline'}
                </span>
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Pending Offline Incidents Queue */}
      {queuedIncidents.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Pending Offline Incident Reports ({queuedIncidents.length})
              </h3>
              <p className="text-xs text-amber-900">
                Saved safely on this device. These reports sync automatically once connectivity is available.
              </p>
            </div>
            {onRetrySync ? (
              <button
                type="button"
                disabled={!isOnline || syncingNow}
                onClick={onRetrySync}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncingNow ? 'Syncing...' : 'Retry Sync'}</span>
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-amber-200/70 rounded-lg border border-amber-200 bg-white">
            {queuedIncidents.map((item) => {
              const titleText = String(item.payload?.title || item.summary);
              const categoryText = String(item.payload?.category || 'Incident');
              return (
                <div
                  key={item.clientSubmissionId}
                  className="flex flex-col justify-between gap-2 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900">{titleText}</p>
                    <p className="text-[11px] text-slate-600">
                      {item.puCode} · {item.puName} · {categoryText} · Queued{' '}
                      {formatFirestoreTime(item.createdAtIso)}
                    </p>
                    {item.errorMessage ? (
                      <p className="mt-0.5 text-[11px] text-red-700">{item.errorMessage}</p>
                    ) : null}
                  </div>
                  <OfflineSyncBadge status={item.status} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Incidents List */}
      {filteredIncidents.length === 0 && queuedIncidents.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description={
            incidents.length === 0
              ? 'No election-day incidents have been reported in your authorized scope.'
              : 'No incidents match your selected urgency, status, or search filter.'
          }
        />
      ) : filteredIncidents.length === 0 ? null : (
        <div className="space-y-3">
          {filteredIncidents.map((inc) => (
            <article
              key={inc.id}
              className={`rounded-xl border bg-white p-5 ${
                inc.urgency === IncidentUrgency.CRITICAL
                  ? 'border-red-300'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-800">{inc.puCode}</span>
                    <span aria-hidden="true">·</span>
                    <span>{LGA_DEFINITIONS[inc.lgaId]?.shortName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{inc.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{formatFirestoreTime(inc.createdAt)}</span>
                  </div>
                  <h3 className="mt-1.5 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
                    {inc.urgency === IncidentUrgency.CRITICAL ? (
                      <AlertOctagon className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                    ) : null}
                    <span>{inc.title}</span>
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">{inc.description}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {inc.puName} · Reported by {inc.reporterName}
                    {inc.escalatedTo ? ` · Escalated to: ${inc.escalatedTo}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <IncidentUrgencyBadge urgency={inc.urgency} />
                  <IncidentStatusBadge status={inc.status} />
                  <button
                    type="button"
                    onClick={() => openIncidentModal(inc)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{canReview ? 'Review / Escalate' : 'Inspect'}</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Incident Review & Escalation Modal */}
      {selectedIncident ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="font-mono text-xs text-slate-500">
                  {selectedIncident.puCode} · {selectedIncident.puName}
                </p>
                <h3 className="mt-0.5 font-display text-base font-semibold text-slate-900">
                  {selectedIncident.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <p>{selectedIncident.description}</p>
              {selectedIncident.evidenceBase64 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-600">
                    Attached Evidence: {selectedIncident.evidenceFileName || 'evidence'}
                  </p>
                  {selectedIncident.evidenceBase64.startsWith('data:image/') ? (
                    <img
                      src={selectedIncident.evidenceBase64}
                      alt={selectedIncident.title}
                      className="max-h-64 w-full rounded object-contain"
                    />
                  ) : (
                    <a
                      href={selectedIncident.evidenceBase64}
                      download={selectedIncident.evidenceFileName || 'evidence.pdf'}
                      className="text-xs font-medium text-[#0b3b24] underline"
                    >
                      Download Attached Document
                    </a>
                  )}
                </div>
              ) : null}
            </div>

            {canReview ? (
              <form onSubmit={handleSaveReview} className="mt-5 space-y-3.5 border-t border-slate-100 pt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="rev-st" className="block text-xs font-medium text-slate-700">
                      Workflow Status
                    </label>
                    <select
                      id="rev-st"
                      value={reviewStatus}
                      onChange={(e) => setReviewStatus(e.target.value as IncidentStatus)}
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {Object.values(IncidentStatus).map((s) => (
                        <option key={s} value={s}>
                          {INCIDENT_STATUS_META[s].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="rev-urg" className="block text-xs font-medium text-slate-700">
                      Urgency Level
                    </label>
                    <select
                      id="rev-urg"
                      value={reviewUrgency}
                      onChange={(e) => setReviewUrgency(e.target.value as IncidentUrgency)}
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {Object.values(IncidentUrgency).map((u) => (
                        <option key={u} value={u}>
                          {INCIDENT_URGENCY_META[u].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="rev-esc" className="block text-xs font-medium text-slate-700">
                    Escalated To (Optional)
                  </label>
                  <input
                    id="rev-esc"
                    type="text"
                    maxLength={120}
                    value={escalatedTo}
                    onChange={(e) => setEscalatedTo(e.target.value)}
                    placeholder="e.g. Funtua Situation Room Desk / Security Liaison"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="rev-notes" className="block text-xs font-medium text-slate-700">
                    Internal Review Notes (Hidden from Public)
                  </label>
                  <textarea
                    id="rev-notes"
                    rows={3}
                    maxLength={1500}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIncident(null)}
                    className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={savingReview}
                    className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                  >
                    {savingReview ? 'Saving...' : 'Update Incident Workflow'}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
