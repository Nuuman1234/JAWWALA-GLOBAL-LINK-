import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCheck2,
  Globe,
  History,
  Lock,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { VerificationStatusBadge } from '../components/StatusBadge';
import {
  FIXED_PARTIES,
  LGA_DEFINITIONS,
  UserRole,
  VerificationStatus,
  canApprovePublicResults,
  formatFirestoreTime,
  getAuthorizedLgas,
  type LgaId,
  type PartyCode,
  type PartyConfig,
  type ResultHistoryEntry,
  type ResultSubmission,
  type UserAccount,
} from '../types/fdmis';
import { analyzeResultDiscrepancies } from '../utils/aggregationEngine';
import {
  fetchResultHistory,
  reviewResultSubmission,
} from '../services/operationsService';

interface VerificationCenterPageProps {
  user: UserAccount;
  results: ResultSubmission[];
  partyConfigs: Record<PartyCode, PartyConfig | null>;
}

export function VerificationCenterPage({
  user,
  results,
  partyConfigs,
}: VerificationCenterPageProps) {
  const authorizedLgas = getAuthorizedLgas(user);
  const canPublishPublic = canApprovePublicResults(user.role);
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;

  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | VerificationStatus>('ALL');
  const [search, setSearch] = useState('');

  const [reviewTarget, setReviewTarget] = useState<ResultSubmission | null>(null);
  const [decision, setDecision] = useState<VerificationStatus>(VerificationStatus.VERIFIED);
  const [reviewNote, setReviewNote] = useState('');
  const [approvePublic, setApprovePublic] = useState(false);
  const [history, setHistory] = useState<ResultHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Assisted EC8A Figure Cross-Check UI state (strictly human-confirmed, never auto-edits figures)
  const [ec8aZoom, setEc8aZoom] = useState<1 | 1.5 | 2>(1);
  const [highContrastEc8a, setHighContrastEc8a] = useState(false);
  const [assistedChecks, setAssistedChecks] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (lgaFilter !== 'all' && r.lgaId !== lgaFilter) return false;
      if (statusFilter !== 'ALL' && r.verificationStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        r.puCode.toLowerCase().includes(q) ||
        r.puName.toLowerCase().includes(q) ||
        r.wardName.toLowerCase().includes(q) ||
        r.submittedByName.toLowerCase().includes(q)
      );
    });
  }, [results, lgaFilter, statusFilter, search]);

  const counts = useMemo(() => {
    return {
      awaiting: results.filter(
        (r) =>
          r.verificationStatus === VerificationStatus.SUBMITTED ||
          r.verificationStatus === VerificationStatus.PENDING_VERIFICATION ||
          r.verificationStatus === VerificationStatus.UNDER_REVIEW ||
          r.verificationStatus === VerificationStatus.DISCREPANCY_DETECTED
      ).length,
      discrepancies: results.filter(
        (r) =>
          r.verificationStatus === VerificationStatus.DISCREPANCY_DETECTED ||
          Boolean(r.discrepancyFlag)
      ).length,
      verified: results.filter((r) => r.verificationStatus === VerificationStatus.VERIFIED).length,
      correction: results.filter(
        (r) => r.verificationStatus === VerificationStatus.REQUIRES_CORRECTION
      ).length,
      publicApproved: results.filter((r) => r.publiclyApproved).length,
    };
  }, [results]);

  const reviewDiscrepancy = useMemo(
    () => (reviewTarget ? analyzeResultDiscrepancies(reviewTarget, results) : null),
    [reviewTarget, results]
  );

  const openReviewModal = async (sub: ResultSubmission) => {
    setReviewTarget(sub);
    setEc8aZoom(1);
    setHighContrastEc8a(false);
    setAssistedChecks({});
    const isSelfSubmitted = sub.submittedByUid === user.uid;
    setDecision(
      sub.verificationStatus === VerificationStatus.SUBMITTED ||
        sub.verificationStatus === VerificationStatus.PENDING_VERIFICATION
        ? isSelfSubmitted
          ? VerificationStatus.UNDER_REVIEW
          : VerificationStatus.VERIFIED
        : sub.verificationStatus
    );
    setReviewNote(sub.reviewNote || '');
    setApprovePublic(sub.publiclyApproved);
    setFeedback(null);
    setLoadingHistory(true);
    try {
      const hist = await fetchResultHistory(sub.id);
      setHistory(hist);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const isSelfSubmission = Boolean(reviewTarget && reviewTarget.submittedByUid === user.uid);
  const isLockedVerified = Boolean(
    reviewTarget && reviewTarget.verificationStatus === VerificationStatus.VERIFIED && !isFullAdmin
  );

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    if (isLockedVerified) {
      setFeedback({
        type: 'err',
        text: 'This result is already FDMIS Verified and locked. Only Full Control Admin can modify or reverse an approved result.',
      });
      return;
    }
    if (decision === VerificationStatus.VERIFIED && isSelfSubmission) {
      setFeedback({
        type: 'err',
        text: 'Self-approval is prohibited: a verifier cannot approve a result they submitted.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await reviewResultSubmission(
        user,
        reviewTarget,
        decision,
        reviewNote,
        approvePublic && decision === VerificationStatus.VERIFIED
      );
      setFeedback({
        type: 'ok',
        text: `Recorded ${decision.replace(/_/g, ' ')} decision for ${reviewTarget.puCode}. Ward, LGA, and Constituency aggregations synchronized.`,
      });
      setReviewTarget(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save verification decision.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Verification Disclaimer Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#06452F]" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            FDMIS Internally Verified Workflow — Independent of Official INEC Declaration
          </p>
          <p className="mt-0.5 text-emerald-900/90">
            Approved Polling Unit sheets atomically update Ward, LGA, and Constituency totals. Self-approval
            is disabled, and approved sheets are locked against routine edits.
          </p>
        </div>
      </div>

      {/* Queue KPI Strip */}
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-5">
        <div className="fdmis-surface p-3 sm:p-3.5">
          <p className="text-xs font-medium text-slate-500">Awaiting Review</p>
          <p className="mt-1 font-mono text-2xl font-bold text-amber-800 tabular-nums">
            {counts.awaiting}
          </p>
        </div>
        <div className="fdmis-surface p-3 sm:p-3.5">
          <p className="text-xs font-medium text-slate-500">Discrepancies Flagged</p>
          <p
            className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
              counts.discrepancies > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {counts.discrepancies}
          </p>
        </div>
        <div className="fdmis-surface p-3 sm:p-3.5">
          <p className="text-xs font-medium text-slate-500">FDMIS Verified</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#06452F] tabular-nums">
            {counts.verified}
          </p>
        </div>
        <div className="fdmis-surface p-3 sm:p-3.5">
          <p className="text-xs font-medium text-slate-500">Returned for Correction</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {counts.correction}
          </p>
        </div>
        <div className="fdmis-surface p-3 sm:p-3.5">
          <p className="text-xs font-medium text-slate-500">Approved for Public View</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {counts.publicApproved}
          </p>
        </div>
      </div>

      {feedback ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 fdmis-surface p-3 sm:p-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PU code, name, ward, or agent..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm sm:max-w-xs"
          />
          {authorizedLgas.length > 1 ? (
            <select
              aria-label="Filter LGA"
              value={lgaFilter}
              onChange={(e) => setLgaFilter(e.target.value as 'all' | LgaId)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">All LGAs</option>
              <option value="funtua">Funtua LGA</option>
              <option value="dandume">Dandume LGA</option>
            </select>
          ) : null}
          <select
            aria-label="Filter status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | VerificationStatus)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="ALL">All Verification States</option>
            {Object.values(VerificationStatus).map((st) => (
              <option key={st} value={st}>
                {st.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {filtered.length} record{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Queue Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="Submitted polling unit results and Form EC8A sheets will appear here for side-by-side verification."
        />
      ) : (
        <div className="overflow-hidden fdmis-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Polling Unit</th>
                  <th className="px-4 py-3">Ward · LGA</th>
                  <th className="px-4 py-3">4-Party Breakdown</th>
                  <th className="px-4 py-3 text-right">Accredited</th>
                  <th className="px-4 py-3 text-right">Total Cast</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Public</th>
                  <th className="px-4 py-3 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((sub) => {
                  const anomaly =
                    (sub.accreditedVoters > sub.registeredVoters && sub.registeredVoters > 0) ||
                    (sub.totalVotesCast > sub.accreditedVoters && sub.accreditedVoters > 0);
                  const scores: Record<PartyCode, number> = {
                    APC: Number(sub.apcVotes ?? 0),
                    PDP: Number(sub.pdpVotes ?? 0),
                    ADC: Number(sub.adcVotes ?? 0),
                    OTHERS: Number(sub.othersVotes ?? 0),
                  };
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-slate-900">
                          {sub.puCode}
                        </p>
                        <p className="text-xs text-slate-600">{sub.puName}</p>
                        {anomaly ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            <span>Check Figure Consistency</span>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                        {sub.wardName} · {LGA_DEFINITIONS[sub.lgaId]?.shortName}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {FIXED_PARTIES.map((p) => (
                            <span
                              key={p.code}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-800 tabular-nums"
                            >
                              <PartyLogo
                                partyCode={p.code}
                                partyConfig={partyConfigs[p.code]}
                                size="xs"
                              />
                              <span>{p.code}:</span>
                              <strong>{scores[p.code]}</strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-800 tabular-nums">
                        {sub.accreditedVoters.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {sub.totalVotesCast.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <VerificationStatusBadge status={sub.verificationStatus} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {sub.publiclyApproved ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Published</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">Internal Only</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void openReviewModal(sub)}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Inspect &amp; Verify</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Side-by-Side Verification Modal */}
      {reviewTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto fdmis-surface p-4 sm:p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Side-by-Side Verification · {reviewTarget.puCode}
                </h3>
                <p className="text-xs text-slate-500">
                  {reviewTarget.puName} ({reviewTarget.wardName} ·{' '}
                  {LGA_DEFINITIONS[reviewTarget.lgaId]?.displayName}) · Submitted by{' '}
                  {reviewTarget.submittedByName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                aria-label="Close verification modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-3.5 sm:gap-4 lg:grid-cols-2">
              {/* Left: Form EC8A Evidence Preview + Human-Confirmed Assisted Cross-Check */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Form EC8A Evidence Sheet
                  </p>
                  {reviewTarget.ec8aImageBase64?.startsWith('data:image/') ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setEc8aZoom((z) => (z === 1 ? 1.5 : z === 1.5 ? 2 : 1))
                        }
                        className="inline-flex min-h-[28px] items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <ZoomIn className="h-3 w-3" aria-hidden="true" />
                        <span>Zoom {ec8aZoom}x</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setHighContrastEc8a((v) => !v)}
                        className={`min-h-[28px] rounded border px-2 text-[11px] font-medium whitespace-nowrap ${
                          highContrastEc8a
                            ? 'border-[#06452F] bg-[#06452F] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        High Contrast
                      </button>
                    </div>
                  ) : null}
                </div>

                {reviewTarget.ec8aImageBase64 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {reviewTarget.ec8aImageBase64.startsWith('data:image/') ? (
                      <div className="max-h-[380px] overflow-auto rounded-lg bg-white">
                        <img
                          src={reviewTarget.ec8aImageBase64}
                          alt={`Form EC8A for ${reviewTarget.puCode}`}
                          className={`mx-auto rounded-lg object-contain transition-transform ${
                            highContrastEc8a ? 'contrast-150 saturate-0' : ''
                          } ${
                            ec8aZoom === 2
                              ? 'w-[200%] max-w-none'
                              : ec8aZoom === 1.5
                                ? 'w-[150%] max-w-none'
                                : 'max-h-[380px] w-full'
                          }`}
                        />
                      </div>
                    ) : (
                      <div className="p-4 text-xs text-slate-700">
                        <p className="font-medium">Attached Document: {reviewTarget.ec8aFileName}</p>
                        <a
                          href={reviewTarget.ec8aImageBase64}
                          download={reviewTarget.ec8aFileName || 'ec8a-document'}
                          className="mt-2 inline-block font-medium text-[#06452F] underline"
                        >
                          Download Document
                        </a>
                      </div>
                    )}
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      File: {reviewTarget.ec8aFileName || 'ec8a.jpg'}
                    </p>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                    No Form EC8A photo or document was attached to this submission.
                  </div>
                )}

                {/* Assisted EC8A Figure Cross-Check (Human-Confirmed Only) */}
                <div className="fdmis-surface p-3.5 space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <Sparkles className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                    <span>Assisted EC8A Figure Cross-Check (Human Confirmed)</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Tick each field after visually matching the scanned EC8A sheet. Figures are never altered automatically.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    {[
                      { k: 'apc', label: `APC: ${Number(reviewTarget.apcVotes ?? 0).toLocaleString()}` },
                      { k: 'pdp', label: `PDP: ${Number(reviewTarget.pdpVotes ?? 0).toLocaleString()}` },
                      { k: 'adc', label: `ADC: ${Number(reviewTarget.adcVotes ?? 0).toLocaleString()}` },
                      { k: 'oth', label: `OTHERS: ${Number(reviewTarget.othersVotes ?? 0).toLocaleString()}` },
                      { k: 'val', label: `Valid: ${reviewTarget.validVotes.toLocaleString()}` },
                      { k: 'rej', label: `Rejected: ${reviewTarget.rejectedVotes.toLocaleString()}` },
                      { k: 'tot', label: `Total Cast: ${reviewTarget.totalVotesCast.toLocaleString()}` },
                      { k: 'sig', label: 'Presiding Officer Stamp / Sign' },
                    ].map((row) => (
                      <label
                        key={row.k}
                        className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(assistedChecks[row.k])}
                          onChange={(e) =>
                            setAssistedChecks((prev) => ({ ...prev, [row.k]: e.target.checked }))
                          }
                          className="h-3.5 w-3.5 accent-[#06452F]"
                        />
                        <span className="truncate">{row.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Revision History Snapshot */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Immutable Revision Trail</span>
                  </p>
                  <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                    {loadingHistory ? (
                      <p className="text-xs text-slate-500">Loading history...</p>
                    ) : history.length === 0 ? (
                      <p className="text-xs text-slate-500">No history entries.</p>
                    ) : (
                      history.map((h) => (
                        <div key={h.id} className="rounded border border-slate-200 bg-white p-2 text-[11px]">
                          <p className="font-mono font-semibold text-slate-800">
                            {h.action} · {formatFirestoreTime(h.createdAt)}
                          </p>
                          {typeof h.apcVotes === 'number' ? (
                            <p className="font-mono font-medium text-slate-700 tabular-nums">
                              APC {h.apcVotes} | PDP {h.pdpVotes ?? 0} | ADC {h.adcVotes ?? 0} | OTH{' '}
                              {h.othersVotes ?? 0}
                            </p>
                          ) : null}
                          <p className="font-mono text-slate-600 tabular-nums">
                            Valid {h.validVotes} | Rej {h.rejectedVotes} | Total {h.totalVotesCast}
                          </p>
                          <p className="text-slate-600">
                            {h.actorName}: {h.note}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Figures & Decision Form */}
              <form onSubmit={handleReviewSubmit} className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Party Scores &amp; Voter Verification
                </p>

                {/* 4 Fixed Party Votes */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  {FIXED_PARTIES.map((p) => {
                    const voteCount =
                      p.code === 'APC'
                        ? Number(reviewTarget.apcVotes ?? 0)
                        : p.code === 'PDP'
                          ? Number(reviewTarget.pdpVotes ?? 0)
                          : p.code === 'ADC'
                            ? Number(reviewTarget.adcVotes ?? 0)
                            : Number(reviewTarget.othersVotes ?? 0);
                    return (
                      <div
                        key={p.code}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <PartyLogo
                            partyCode={p.code}
                            partyConfig={partyConfigs[p.code]}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-slate-900">{p.code}</p>
                            <p className="truncate text-[10px] text-slate-500">{p.name}</p>
                          </div>
                        </div>
                        <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                          {voteCount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Voter Figures */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">Registered Voters</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {reviewTarget.registeredVoters.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">Accredited Voters</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {reviewTarget.accreditedVoters.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">Valid Votes</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {reviewTarget.validVotes.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">Rejected Votes</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {reviewTarget.rejectedVotes.toLocaleString()}
                    </p>
                  </div>
                  <div className="col-span-2 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <span className="font-semibold text-emerald-950">Total Votes Cast</span>
                    <span className="font-mono text-lg font-bold text-[#06452F] tabular-nums">
                      {reviewTarget.totalVotesCast.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-xs">
                  <p>
                    <span className="font-semibold text-slate-700">BVAS Status:</span>{' '}
                    {reviewTarget.bvasStatus}
                  </p>
                  {reviewTarget.bvasNotes ? (
                    <p>
                      <span className="font-semibold text-slate-700">BVAS Notes:</span>{' '}
                      {reviewTarget.bvasNotes}
                    </p>
                  ) : null}
                  {reviewTarget.submissionNotes ? (
                    <p>
                      <span className="font-semibold text-slate-700">Agent Notes:</span>{' '}
                      {reviewTarget.submissionNotes}
                    </p>
                  ) : null}
                </div>

                {/* Automated Discrepancy & Duplicate Detection Alert */}
                {reviewDiscrepancy && reviewDiscrepancy.hasDiscrepancy ? (
                  <div
                    className={`rounded-lg border p-3 text-xs ${
                      reviewDiscrepancy.severity === 'CRITICAL'
                        ? 'border-red-300 bg-red-50 text-red-950'
                        : 'border-amber-300 bg-amber-50 text-amber-950'
                    }`}
                  >
                    <p className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Automated Discrepancy Engine ({reviewDiscrepancy.severity})
                      </span>
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {reviewDiscrepancy.flags.map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Self-approval block alert */}
                {isSelfSubmission ? (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-950">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                    <span>
                      <strong>Self-Approval Prohibited:</strong> You submitted this polling unit
                      result, so another authorized verifier must approve it.
                    </span>
                  </div>
                ) : null}

                {/* Locked Verified Banner */}
                {isLockedVerified ? (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#06452F]" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">
                        FDMIS Internally Verified &amp; Locked (Not Officially Declared INEC Result)
                      </p>
                      <p className="mt-0.5">
                        Approved by {reviewTarget.reviewedByName} on{' '}
                        {formatFirestoreTime(reviewTarget.reviewedAt || reviewTarget.updatedAt)}.
                        Only the Full Control Admin can execute an audited override or reversal.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {reviewTarget.verificationStatus === VerificationStatus.VERIFIED && isFullAdmin ? (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                        <span>
                          <strong>Audited Full Control Admin Override:</strong> Reversing or altering
                          an approved sheet atomically recalculates Ward, LGA, and Constituency totals.
                        </span>
                      </div>
                    ) : null}

                    {/* Quick Action Decision Selector */}
                    <div>
                      <p className="mb-1.5 block text-xs font-medium text-slate-700">
                        Verification Decision *
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          {
                            id: VerificationStatus.VERIFIED,
                            label: 'Approve Result',
                            icon: CheckCircle2,
                            disabled: isSelfSubmission,
                          },
                          {
                            id: VerificationStatus.DISCREPANCY_DETECTED,
                            label: 'Flag Discrepancy',
                            icon: AlertTriangle,
                            disabled: false,
                          },
                          {
                            id: VerificationStatus.REQUIRES_CORRECTION,
                            label: 'Request Correction',
                            icon: RotateCcw,
                            disabled: false,
                          },
                          {
                            id: VerificationStatus.CORRECTED,
                            label: 'Mark Corrected',
                            icon: FileCheck2,
                            disabled: false,
                          },
                          {
                            id: VerificationStatus.UNDER_REVIEW,
                            label: 'Under Review',
                            icon: Eye,
                            disabled: false,
                          },
                          {
                            id: VerificationStatus.REJECTED,
                            label: 'Reject Result',
                            icon: XCircle,
                            disabled: false,
                          },
                        ].map((opt) => {
                          const Icon = opt.icon;
                          const selected = decision === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={opt.disabled}
                              onClick={() => setDecision(opt.id)}
                              className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap ${
                                selected
                                  ? opt.id === VerificationStatus.VERIFIED
                                    ? 'border-[#06452F] bg-[#06452F] text-white'
                                    : opt.id === VerificationStatus.REJECTED ||
                                        opt.id === VerificationStatus.DISCREPANCY_DETECTED
                                      ? 'border-red-700 bg-red-700 text-white'
                                      : 'border-amber-600 bg-amber-600 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="ver-note" className="block text-xs font-medium text-slate-700">
                        Mandatory Review Reason / Note (min 3 chars) *
                      </label>
                      <textarea
                        id="ver-note"
                        required
                        minLength={3}
                        rows={3}
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="Document verification check against Form EC8A and BVAS figures..."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>

                    {canPublishPublic && decision === VerificationStatus.VERIFIED ? (
                      <label className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-950">
                        <input
                          type="checkbox"
                          checked={approvePublic}
                          onChange={(e) => setApprovePublic(e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-[#06452F]"
                        />
                        <span>
                          <span className="font-semibold">
                            Approve for Public Information Portal
                          </span>
                          <span className="block text-emerald-900/80">
                            Publishes only sanitized polling unit totals—zero agent PII or internal
                            notes.
                          </span>
                        </span>
                      </label>
                    ) : null}

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setReviewTarget(null)}
                        className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={
                          saving || (decision === VerificationStatus.VERIFIED && isSelfSubmission)
                        }
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-sm font-medium text-white hover:bg-[#043B29] disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>{saving ? 'Recording...' : 'Confirm Decision'}</span>
                      </button>
                    </div>
                  </>
                )}
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
