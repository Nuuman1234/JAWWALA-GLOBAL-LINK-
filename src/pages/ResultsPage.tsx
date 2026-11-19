import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileImage,
  History,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { ResultBarChart } from '../components/ResultBarChart';
import { OfflineSyncBadge, VerificationStatusBadge } from '../components/StatusBadge';
import {
  BVAS_STATUS_OPTIONS,
  FIXED_PARTIES,
  LGA_DEFINITIONS,
  UserRole,
  VerificationStatus,
  formatFirestoreTime,
  type ApprovedPuResult,
  type OfflineQueuedItem,
  type PartyCode,
  type PartyConfig,
  type PollingUnit,
  type ResultHistoryEntry,
  type ResultSubmission,
  type UserAccount,
} from '../types/fdmis';
import {
  getCanonicalApprovedPuResults,
  summarizeVoteTotals,
  validateResultFigures,
} from '../utils/aggregationEngine';
import { processEvidenceFile } from '../utils/evidenceCompression';
import {
  clearDraft,
  enqueueOfflineSubmission,
  loadDraft,
  saveDraft,
} from '../services/offlineQueue';
import {
  fetchResultHistory,
  submitPollingUnitResult,
} from '../services/operationsService';

interface ResultsPageProps {
  user: UserAccount;
  pollingUnits: PollingUnit[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  partyConfigs: Record<PartyCode, PartyConfig | null>;
  queuedItems?: OfflineQueuedItem[];
  isOnline: boolean;
  onRetrySync?: () => void;
  syncingNow?: boolean;
}

export function ResultsPage({
  user,
  pollingUnits,
  results,
  approvedPuResults,
  partyConfigs,
  queuedItems = [],
  isOnline,
  onRetrySync,
  syncingNow = false,
}: ResultsPageProps) {
  const isPuAgent = user.role === UserRole.POLLING_UNIT_AGENT;

  // Strictly scope selectable polling units for PU agents to their single assigned PU; Ordinary Users cannot submit results
  const selectablePus = useMemo(() => {
    if (user.role === UserRole.ORDINARY_USER) {
      return [];
    }
    if (isPuAgent) {
      return pollingUnits.filter((p) => p.id === user.assignedPollingUnitId);
    }
    return pollingUnits;
  }, [pollingUnits, isPuAgent, user.assignedPollingUnitId, user.role]);

  const defaultPuId =
    selectablePus.find((p) => p.id === user.assignedPollingUnitId)?.id ||
    selectablePus[0]?.id ||
    '';

  const [showForm, setShowForm] = useState(false);
  const [editingResult, setEditingResult] = useState<ResultSubmission | null>(null);

  const [puId, setPuId] = useState(defaultPuId);
  const [apcVotes, setApcVotes] = useState('0');
  const [pdpVotes, setPdpVotes] = useState('0');
  const [adcVotes, setAdcVotes] = useState('0');
  const [othersVotes, setOthersVotes] = useState('0');
  const [registeredVoters, setRegisteredVoters] = useState('0');
  const [accreditedVoters, setAccreditedVoters] = useState('0');
  const [validVotes, setValidVotes] = useState('0');
  const [rejectedVotes, setRejectedVotes] = useState('0');
  const [totalVotesCastInput, setTotalVotesCastInput] = useState('0');
  const [bvasStatus, setBvasStatus] = useState<string>(BVAS_STATUS_OPTIONS[0]);
  const [bvasNotes, setBvasNotes] = useState('');
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [ec8aBase64, setEc8aBase64] = useState<string | null>(null);
  const [ec8aFileName, setEc8aFileName] = useState<string | null>(null);

  const [reviewConfirmOpen, setReviewConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | VerificationStatus>('ALL');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [historyTarget, setHistoryTarget] = useState<ResultSubmission | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ResultHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const selectedPu = useMemo(
    () => selectablePus.find((p) => p.id === puId) || null,
    [selectablePus, puId]
  );

  useEffect(() => {
    if (isPuAgent) {
      setPuId(user.assignedPollingUnitId || '');
    } else if (!puId && defaultPuId) {
      setPuId(defaultPuId);
    }
  }, [isPuAgent, user.assignedPollingUnitId, puId, defaultPuId]);

  const draftKey = `result_draft_v2_${user.uid}`;

  useEffect(() => {
    if (editingResult) return;
    let active = true;
    void loadDraft<Record<string, string>>(draftKey).then((draft) => {
      if (!active || !draft) return;
      if (!isPuAgent && draft.puId) setPuId(draft.puId);
      if (draft.apcVotes !== undefined) setApcVotes(draft.apcVotes);
      if (draft.pdpVotes !== undefined) setPdpVotes(draft.pdpVotes);
      if (draft.adcVotes !== undefined) setAdcVotes(draft.adcVotes);
      if (draft.othersVotes !== undefined) setOthersVotes(draft.othersVotes);
      if (draft.registeredVoters !== undefined) setRegisteredVoters(draft.registeredVoters);
      if (draft.accreditedVoters !== undefined) setAccreditedVoters(draft.accreditedVoters);
      if (draft.validVotes !== undefined) setValidVotes(draft.validVotes);
      if (draft.rejectedVotes !== undefined) setRejectedVotes(draft.rejectedVotes);
      if (draft.totalVotesCastInput !== undefined) setTotalVotesCastInput(draft.totalVotesCastInput);
      if (draft.bvasStatus) setBvasStatus(draft.bvasStatus);
      if (draft.bvasNotes) setBvasNotes(draft.bvasNotes);
      if (draft.submissionNotes) setSubmissionNotes(draft.submissionNotes);
    });
    return () => {
      active = false;
    };
  }, [draftKey, editingResult, isPuAgent]);

  useEffect(() => {
    if (!showForm || editingResult) return;
    const t = window.setTimeout(() => {
      void saveDraft(draftKey, {
        puId,
        apcVotes,
        pdpVotes,
        adcVotes,
        othersVotes,
        registeredVoters,
        accreditedVoters,
        validVotes,
        rejectedVotes,
        totalVotesCastInput,
        bvasStatus,
        bvasNotes,
        submissionNotes,
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [
    showForm,
    editingResult,
    draftKey,
    puId,
    apcVotes,
    pdpVotes,
    adcVotes,
    othersVotes,
    registeredVoters,
    accreditedVoters,
    validVotes,
    rejectedVotes,
    totalVotesCastInput,
    bvasStatus,
    bvasNotes,
    submissionNotes,
  ]);

  const validation = useMemo(
    () =>
      validateResultFigures({
        apcVotes,
        pdpVotes,
        adcVotes,
        othersVotes,
        registeredVoters,
        accreditedVoters,
        validVotes,
        rejectedVotes,
        totalVotesCast: totalVotesCastInput,
      }),
    [
      apcVotes,
      pdpVotes,
      adcVotes,
      othersVotes,
      registeredVoters,
      accreditedVoters,
      validVotes,
      rejectedVotes,
      totalVotesCastInput,
    ]
  );

  const numericSnapshot = useMemo(
    () => ({
      apc: Math.floor(Number(apcVotes) || 0),
      pdp: Math.floor(Number(pdpVotes) || 0),
      adc: Math.floor(Number(adcVotes) || 0),
      others: Math.floor(Number(othersVotes) || 0),
      reg: Math.floor(Number(registeredVoters) || 0),
      acc: Math.floor(Number(accreditedVoters) || 0),
      valid: Math.floor(Number(validVotes) || 0),
      rej: Math.floor(Number(rejectedVotes) || 0),
      cast: Math.floor(Number(totalVotesCastInput) || 0),
    }),
    [
      apcVotes,
      pdpVotes,
      adcVotes,
      othersVotes,
      registeredVoters,
      accreditedVoters,
      validVotes,
      rejectedVotes,
      totalVotesCastInput,
    ]
  );

  const canonicalApproved = useMemo(
    () => getCanonicalApprovedPuResults(approvedPuResults, results),
    [approvedPuResults, results]
  );

  const scopeSummary = useMemo(() => {
    const pendingCount = results.filter(
      (r) =>
        r.verificationStatus === VerificationStatus.SUBMITTED ||
        r.verificationStatus === VerificationStatus.UNDER_REVIEW
    ).length;
    const expectedCount = selectablePus.length > 0 ? selectablePus.length : pollingUnits.length;
    return summarizeVoteTotals(canonicalApproved, expectedCount, pendingCount);
  }, [canonicalApproved, results, selectablePus.length, pollingUnits.length]);

  const openNewSubmission = () => {
    setEditingResult(null);
    const targetId = defaultPuId;
    setPuId(targetId);
    const pu = selectablePus.find((p) => p.id === targetId);
    setApcVotes('0');
    setPdpVotes('0');
    setAdcVotes('0');
    setOthersVotes('0');
    setRegisteredVoters(String(pu?.registeredVoters || 0));
    setAccreditedVoters('0');
    setValidVotes('0');
    setRejectedVotes('0');
    setTotalVotesCastInput('0');
    setBvasStatus(BVAS_STATUS_OPTIONS[0]);
    setBvasNotes('');
    setSubmissionNotes('');
    setEc8aBase64(null);
    setEc8aFileName(null);
    setReviewConfirmOpen(false);
    setFeedback(null);
    setShowForm(true);
  };

  const openReviseSubmission = (res: ResultSubmission) => {
    setEditingResult(res);
    setPuId(res.puId);
    setApcVotes(String(res.apcVotes ?? 0));
    setPdpVotes(String(res.pdpVotes ?? 0));
    setAdcVotes(String(res.adcVotes ?? 0));
    setOthersVotes(String(res.othersVotes ?? 0));
    setRegisteredVoters(String(res.registeredVoters));
    setAccreditedVoters(String(res.accreditedVoters));
    setValidVotes(String(res.validVotes));
    setRejectedVotes(String(res.rejectedVotes));
    setTotalVotesCastInput(String(res.totalVotesCast));
    setBvasStatus(res.bvasStatus || BVAS_STATUS_OPTIONS[0]);
    setBvasNotes(res.bvasNotes || '');
    setSubmissionNotes(res.submissionNotes || '');
    setEc8aBase64(res.ec8aImageBase64 || null);
    setEc8aFileName(res.ec8aFileName || null);
    setReviewConfirmOpen(false);
    setFeedback(null);
    setShowForm(true);
  };

  const handleEc8aChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const processed = await processEvidenceFile(file);
      setEc8aBase64(processed.base64Data);
      setEc8aFileName(processed.fileName);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to process Form EC8A image.',
      });
    }
  };

  const executeSubmit = async (asDraft: boolean) => {
    if (!selectedPu) {
      setFeedback({ type: 'err', text: 'Select a valid assigned polling unit first.' });
      return;
    }

    if (!validation.isValid) {
      setFeedback({ type: 'err', text: validation.errors[0] });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    const payload = {
      apcVotes: numericSnapshot.apc,
      pdpVotes: numericSnapshot.pdp,
      adcVotes: numericSnapshot.adc,
      othersVotes: numericSnapshot.others,
      registeredVoters: numericSnapshot.reg,
      accreditedVoters: numericSnapshot.acc,
      validVotes: numericSnapshot.valid,
      rejectedVotes: numericSnapshot.rej,
      totalVotesCast: numericSnapshot.cast,
      bvasStatus,
      bvasNotes,
      submissionNotes,
      ec8aImageBase64: ec8aBase64,
      ec8aFileName,
      targetResultId: editingResult?.id || undefined,
      asDraft,
    };

    const deterministicRevId = editingResult ? `res_rev_${editingResult.id}` : undefined;

    if (!isOnline) {
      await enqueueOfflineSubmission({
        clientSubmissionId: deterministicRevId,
        ownerUid: user.uid,
        reportType: 'RESULT_SUBMISSION',
        puId: selectedPu.id,
        puCode: selectedPu.puCode,
        puName: selectedPu.name,
        lgaId: selectedPu.lgaId,
        wardId: selectedPu.wardId,
        summary: `${asDraft ? 'Draft' : 'Result'} (APC ${numericSnapshot.apc}, PDP ${numericSnapshot.pdp}, ADC ${numericSnapshot.adc}, OTH ${numericSnapshot.others} · Total ${numericSnapshot.cast}) for ${selectedPu.puCode}`,
        payload,
        status: 'PENDING_SYNC',
      });
      if (!editingResult) {
        await clearDraft(draftKey);
      }
      setFeedback({
        type: 'ok',
        text: `Saved offline on this device. This ${asDraft ? 'draft' : 'result'} will synchronize automatically once internet connectivity returns.`,
      });
      setReviewConfirmOpen(false);
      setShowForm(false);
      setEditingResult(null);
      setSubmitting(false);
      return;
    }

    try {
      await submitPollingUnitResult(user, selectedPu, payload, editingResult);
      if (!editingResult) {
        await clearDraft(draftKey);
      }
      setFeedback({
        type: 'ok',
        text: asDraft
          ? `Result draft saved for ${selectedPu.puCode}.`
          : `Official result confirmed and recorded for ${selectedPu.puCode}.`,
      });
      setReviewConfirmOpen(false);
      setShowForm(false);
      setEditingResult(null);
    } catch (err) {
      if (!navigator.onLine) {
        await enqueueOfflineSubmission({
          clientSubmissionId: deterministicRevId,
          ownerUid: user.uid,
          reportType: 'RESULT_SUBMISSION',
          puId: selectedPu.id,
          puCode: selectedPu.puCode,
          puName: selectedPu.name,
          lgaId: selectedPu.lgaId,
          wardId: selectedPu.wardId,
          summary: `${asDraft ? 'Draft' : 'Result'} (Total ${numericSnapshot.cast}) for ${selectedPu.puCode}`,
          payload,
          status: 'PENDING_SYNC',
        });
        setFeedback({
          type: 'ok',
          text: 'Connection lost during transmission. Saved safely offline on this device and queued for automatic synchronization.',
        });
        setReviewConfirmOpen(false);
        setShowForm(false);
        setEditingResult(null);
      } else {
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to submit polling unit result.',
        });
        setReviewConfirmOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenReview = (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!selectedPu) {
      setFeedback({ type: 'err', text: 'Select a valid polling unit first.' });
      return;
    }
    if (!validation.isValid) {
      setFeedback({ type: 'err', text: validation.errors[0] });
      return;
    }
    setReviewConfirmOpen(true);
  };

  const openHistoryModal = async (res: ResultSubmission) => {
    setHistoryTarget(res);
    setHistoryEntries([]);
    setLoadingHistory(true);
    try {
      const entries = await fetchResultHistory(res.id);
      setHistoryEntries(entries);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load immutable revision history.',
      });
    } finally {
      setLoadingHistory(false);
    }
  };

  const queuedResults = useMemo(
    () =>
      queuedItems.filter(
        (item) => item.reportType === 'RESULT_SUBMISSION' && item.status !== 'SYNCED'
      ),
    [queuedItems]
  );

  const filteredResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (statusFilter !== 'ALL' && r.verificationStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        r.puCode.toLowerCase().includes(q) ||
        r.puName.toLowerCase().includes(q) ||
        r.wardName.toLowerCase().includes(q) ||
        r.submittedByName.toLowerCase().includes(q)
      );
    });
  }, [results, statusFilter, search]);

  const canRevise = (r: ResultSubmission) => {
    if (r.verificationStatus === VerificationStatus.VERIFIED) {
      return false;
    }
    const isEditableState =
      r.verificationStatus === VerificationStatus.DRAFT ||
      r.verificationStatus === VerificationStatus.REQUIRES_CORRECTION;
    return (
      (r.submittedByUid === user.uid && isEditableState) ||
      user.role === UserRole.FULL_CONTROL_ADMIN
    );
  };

  const partyInputValues: Record<PartyCode, { value: string; setter: (v: string) => void }> = {
    APC: { value: apcVotes, setter: setApcVotes },
    PDP: { value: pdpVotes, setter: setPdpVotes },
    ADC: { value: adcVotes, setter: setAdcVotes },
    OTHERS: { value: othersVotes, setter: setOthersVotes },
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Polling Unit Results &amp; Form EC8A Registry
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Strictly captures votes for the 4 fixed parties (APC, PDP, ADC, OTHERS), validates totals
            explicitly, and preserves an immutable audit &amp; revision log.
          </p>
        </div>
        {selectablePus.length > 0 ? (
          <button
            type="button"
            onClick={openNewSubmission}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Submit PU Result</span>
          </button>
        ) : null}
      </div>

      {/* PU Agent missing assignment advisory */}
      {isPuAgent && selectablePus.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">No Polling Unit Assigned to Your Account</p>
            <p className="mt-0.5">
              Polling Unit Agents can only submit results for their single assigned Polling Unit.
              Please contact your Ward Coordinator or Administrator to complete your Polling Unit
              assignment.
            </p>
          </div>
        </div>
      ) : null}

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

      {/* Verified Scope Chart */}
      <ResultBarChart
        title={
          isPuAgent
            ? 'Assigned Polling Unit Verified Result'
            : 'Verified Party Standings (Authorized Scope)'
        }
        subtitle={`Based strictly on ${scopeSummary.verifiedPuCount} verified polling unit(s) out of ${scopeSummary.expectedPuCount} in scope.`}
        summary={scopeSummary}
        partyConfigs={partyConfigs}
      />

      {/* Submission / Revision Form */}
      {showForm ? (
        <form
          onSubmit={handleOpenReview}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                {editingResult
                  ? `Revise Submission v${editingResult.version + 1} · ${editingResult.puCode}`
                  : 'New Polling Unit Result & Form EC8A Submission'}
              </h3>
              {editingResult?.reviewNote ? (
                <p className="mt-1 text-xs font-medium text-amber-800">
                  Reviewer Note: {editingResult.reviewNote}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingResult(null);
              }}
              aria-label="Close result form"
              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Polling Unit Selector */}
          <div>
            <label htmlFor="res-pu" className="block text-xs font-medium text-slate-700">
              {isPuAgent ? 'Assigned Polling Unit (Locked)' : 'Polling Unit *'}
            </label>
            <select
              id="res-pu"
              required
              disabled={Boolean(editingResult) || isPuAgent}
              value={puId}
              onChange={(e) => {
                const nextId = e.target.value;
                setPuId(nextId);
                const found = selectablePus.find((p) => p.id === nextId);
                if (found && found.registeredVoters > 0) {
                  setRegisteredVoters(String(found.registeredVoters));
                }
              }}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:bg-slate-100"
            >
              {selectablePus.map((pu) => (
                <option key={pu.id} value={pu.id}>
                  {pu.puCode} · {pu.name} ({pu.wardName})
                </option>
              ))}
            </select>
          </div>

          {/* Fixed 4 Political Parties Entry Grid */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Party Vote Entries (All 4 Required — Enter 0 Where Applicable)
              </p>
              <span className="font-mono text-xs font-semibold text-[#0b3b24] tabular-nums">
                Party Total: {validation.partySum.toLocaleString()}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {FIXED_PARTIES.map((party) => {
                const binding = partyInputValues[party.code];
                const cfg = partyConfigs[party.code];
                return (
                  <div
                    key={party.code}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <PartyLogo partyCode={party.code} partyConfig={cfg} size="md" />
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-bold text-slate-900">{party.code}</p>
                        <p className="truncate text-xs text-slate-600">{party.name}</p>
                      </div>
                    </div>
                    <div className="w-28 shrink-0">
                      <label htmlFor={`party-votes-${party.code}`} className="sr-only">
                        {party.code} votes
                      </label>
                      <input
                        id={`party-votes-${party.code}`}
                        type="number"
                        min={0}
                        max={50000}
                        step={1}
                        required
                        value={binding.value}
                        onChange={(e) => binding.setter(e.target.value)}
                        className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-[#0b3b24] focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Voter Accounting Fields */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="res-reg" className="block text-xs font-medium text-slate-700">
                Total Registered Voters *
              </label>
              <input
                id="res-reg"
                type="number"
                min={0}
                max={50000}
                step={1}
                required
                value={registeredVoters}
                onChange={(e) => setRegisteredVoters(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="res-acc" className="block text-xs font-medium text-slate-700">
                Total Accredited Voters (BVAS) *
              </label>
              <input
                id="res-acc"
                type="number"
                min={0}
                max={50000}
                step={1}
                required
                value={accreditedVoters}
                onChange={(e) => setAccreditedVoters(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="res-valid" className="block text-xs font-medium text-slate-700">
                  Total Valid Votes *
                </label>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Party Sum: {validation.partySum.toLocaleString()}
                </span>
              </div>
              <input
                id="res-valid"
                type="number"
                min={0}
                max={50000}
                step={1}
                required
                value={validVotes}
                onChange={(e) => setValidVotes(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="res-rej" className="block text-xs font-medium text-slate-700">
                Rejected / Void Votes *
              </label>
              <input
                id="res-rej"
                type="number"
                min={0}
                max={50000}
                step={1}
                required
                value={rejectedVotes}
                onChange={(e) => setRejectedVotes(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="res-cast" className="block text-xs font-medium text-slate-700">
                  Total Votes Cast *
                </label>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Valid+Rej: {(numericSnapshot.valid + numericSnapshot.rej).toLocaleString()}
                </span>
              </div>
              <input
                id="res-cast"
                type="number"
                min={0}
                max={50000}
                step={1}
                required
                value={totalVotesCastInput}
                onChange={(e) => setTotalVotesCastInput(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="res-bvas" className="block text-xs font-medium text-slate-700">
                BVAS Operational Status
              </label>
              <select
                id="res-bvas"
                value={bvasStatus}
                onChange={(e) => setBvasStatus(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {BVAS_STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Blocking Mathematical Errors */}
          {!validation.isValid ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3.5 text-xs text-red-950">
              <p className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="h-4 w-4 text-red-700" aria-hidden="true" />
                <span>Figure Validation Required Before Submission (Figures Are Not Auto-Modified)</span>
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                {validation.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Non-blocking Integrity Warnings */}
          {validation.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
                <span>Conflicting Figure Warning</span>
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                {validation.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="res-ec8a" className="block text-xs font-medium text-slate-700">
                Form EC8A Photograph or Document (Compressed)
              </label>
              <label className="mt-1 flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100">
                <FileImage className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span className="truncate">
                  {ec8aFileName ? `Attached: ${ec8aFileName}` : 'Upload Form EC8A Photo / PDF'}
                </span>
                <input
                  id="res-ec8a"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleEc8aChange}
                  className="sr-only"
                />
              </label>
            </div>

            <div>
              <label htmlFor="res-bvas-notes" className="block text-xs font-medium text-slate-700">
                BVAS Notes
              </label>
              <input
                id="res-bvas-notes"
                type="text"
                value={bvasNotes}
                onChange={(e) => setBvasNotes(e.target.value)}
                placeholder="Any BVAS sync, battery, or accreditation observation..."
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="res-sub-notes" className="block text-xs font-medium text-slate-700">
                Additional Remarks / Revision Notes
              </label>
              <input
                id="res-sub-notes"
                type="text"
                value={submissionNotes}
                onChange={(e) => setSubmissionNotes(e.target.value)}
                placeholder="Context for Verification Officers reviewing this sheet..."
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {!editingResult || editingResult.verificationStatus === VerificationStatus.DRAFT ? (
              <button
                type="button"
                disabled={submitting || !validation.isValid}
                onClick={() => void executeSubmit(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>{isOnline ? 'Save Draft' : 'Save Draft Offline'}</span>
              </button>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !validation.isValid}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>
                {!isOnline
                  ? 'Review & Queue Offline'
                  : editingResult
                    ? 'Review & Resubmit Result'
                    : 'Review & Confirm Submission'}
              </span>
            </button>
          </div>
        </form>
      ) : null}

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PU code, polling unit, ward, or agent..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm sm:max-w-xs"
          />
          <select
            aria-label="Filter by verification status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | VerificationStatus)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="ALL">All Statuses</option>
            {Object.values(VerificationStatus).map((st) => (
              <option key={st} value={st}>
                {st.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {filteredResults.length} submission{filteredResults.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Pending Offline Results Queue */}
      {queuedResults.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Pending Offline Result Submissions ({queuedResults.length})
              </h3>
              <p className="text-xs text-amber-900">
                Saved safely on this device. These polling unit results synchronize automatically once internet returns.
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
            {queuedResults.map((item) => (
              <div
                key={item.clientSubmissionId}
                className="flex flex-col justify-between gap-2 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">
                    {item.puCode} · {item.puName}
                  </p>
                  <p className="text-[11px] text-slate-600">{item.summary}</p>
                  <p className="text-[11px] text-slate-500">
                    Original Created: {formatFirestoreTime(item.createdAtIso)}
                    {item.syncedAtIso ? ` · Server Synced: ${formatFirestoreTime(item.syncedAtIso)}` : ''}
                  </p>
                  {item.errorMessage ? (
                    <p className="mt-0.5 text-[11px] text-red-700">{item.errorMessage}</p>
                  ) : null}
                </div>
                <OfflineSyncBadge status={item.status} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Results List */}
      {filteredResults.length === 0 && queuedResults.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="No polling unit results or Form EC8A sheets have been submitted in your authorized scope yet."
        />
      ) : filteredResults.length === 0 ? null : (
        <div className="space-y-3">
          {filteredResults.map((res) => {
            const partyScores: Record<PartyCode, number> = {
              APC: Number(res.apcVotes ?? 0),
              PDP: Number(res.pdpVotes ?? 0),
              ADC: Number(res.adcVotes ?? 0),
              OTHERS: Number(res.othersVotes ?? 0),
            };
            return (
              <div
                key={res.id}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#0b3b24]">
                        {res.puCode}
                      </span>
                      <VerificationStatusBadge status={res.verificationStatus} />
                      <span className="font-mono text-[11px] text-slate-500">
                        v{res.version}
                      </span>
                    </div>
                    <h3 className="mt-1 font-display text-sm font-semibold text-slate-900">
                      {res.puName}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {res.wardName} · {LGA_DEFINITIONS[res.lgaId]?.shortName} · Submitted by{' '}
                      {res.submittedByName} · Orig: {formatFirestoreTime(res.clientCreatedAtIso || res.createdAt)} · Synced:{' '}
                      {formatFirestoreTime(res.serverSyncedAt || res.updatedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openHistoryModal(res)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>History</span>
                    </button>
                    {canRevise(res) ? (
                      <button
                        type="button"
                        onClick={() => openReviseSubmission(res)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#0b3b24] px-3 py-1 text-xs font-medium text-[#0b3b24] hover:bg-emerald-50"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {res.verificationStatus === VerificationStatus.DRAFT
                            ? 'Complete Draft'
                            : 'Revise'}
                        </span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* 4 Fixed Party Vote Pills */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {FIXED_PARTIES.map((p) => (
                    <div
                      key={p.code}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <PartyLogo
                          partyCode={p.code}
                          partyConfig={partyConfigs[p.code]}
                          size="xs"
                        />
                        <span className="font-mono text-xs font-bold text-slate-900">{p.code}</span>
                      </div>
                      <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                        {partyScores[p.code].toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] text-slate-500">Registered</p>
                    <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {res.registeredVoters.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] text-slate-500">Accredited</p>
                    <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {res.accreditedVoters.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] text-slate-500">Valid Votes</p>
                    <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {res.validVotes.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] text-slate-500">Rejected</p>
                    <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {res.rejectedVotes.toLocaleString()}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 sm:col-span-1">
                    <p className="text-[11px] text-emerald-900">Total Cast</p>
                    <p className="font-mono text-sm font-bold text-[#0b3b24] tabular-nums">
                      {res.totalVotesCast.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    BVAS: <span className="font-medium text-slate-800">{res.bvasStatus}</span>
                    {res.bvasNotes ? ` · ${res.bvasNotes}` : ''}
                  </span>
                  {res.ec8aFileName ? (
                    <span className="font-mono text-[11px] text-emerald-800">
                      EC8A Attached: {res.ec8aFileName}
                    </span>
                  ) : (
                    <span className="text-amber-700">No EC8A attachment</span>
                  )}
                </div>

                {res.reviewNote ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <span className="font-semibold">
                      Verification Note ({res.reviewedByName || 'Reviewer'}):
                    </span>{' '}
                    {res.reviewNote}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Review & Confirm Submission Modal */}
      {reviewConfirmOpen && selectedPu ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Review &amp; Confirm PU Result
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedPu.puCode} · {selectedPu.name} ({selectedPu.wardName})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewConfirmOpen(false)}
                aria-label="Close confirmation modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="space-y-2">
                <p className="font-semibold uppercase tracking-wide text-slate-500">
                  Party Votes Summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {FIXED_PARTIES.map((p) => {
                    const score =
                      p.code === 'APC'
                        ? numericSnapshot.apc
                        : p.code === 'PDP'
                          ? numericSnapshot.pdp
                          : p.code === 'ADC'
                            ? numericSnapshot.adc
                            : numericSnapshot.others;
                    return (
                      <div
                        key={p.code}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <PartyLogo
                            partyCode={p.code}
                            partyConfig={partyConfigs[p.code]}
                            size="xs"
                          />
                          <span className="font-mono font-bold text-slate-900">{p.code}</span>
                        </div>
                        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {score.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p>
                  Registered:{' '}
                  <strong className="font-mono">{numericSnapshot.reg.toLocaleString()}</strong>
                </p>
                <p>
                  Accredited:{' '}
                  <strong className="font-mono">{numericSnapshot.acc.toLocaleString()}</strong>
                </p>
                <p>
                  Valid Votes:{' '}
                  <strong className="font-mono">{numericSnapshot.valid.toLocaleString()}</strong>
                </p>
                <p>
                  Rejected:{' '}
                  <strong className="font-mono">{numericSnapshot.rej.toLocaleString()}</strong>
                </p>
                <p className="col-span-2 font-semibold text-[#0b3b24]">
                  Total Votes Cast:{' '}
                  <span className="font-mono">{numericSnapshot.cast.toLocaleString()}</span>
                </p>
              </div>

              {validation.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
                  <p className="font-semibold">Warnings Attached:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {validation.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="text-slate-600">
                <p>
                  BVAS Status: <strong className="text-slate-800">{bvasStatus}</strong>
                </p>
                <p>
                  Form EC8A Attachment:{' '}
                  <strong className="text-slate-800">{ec8aFileName || 'None attached'}</strong>
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setReviewConfirmOpen(false)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Edit Figures
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void executeSubmit(false)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>
                  {submitting
                    ? 'Transmitting...'
                    : !isOnline
                      ? 'Confirm & Queue Offline'
                      : 'Confirm & Submit Result'}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Immutable Revision History Modal */}
      {historyTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Immutable Result Revision History · {historyTarget.puCode}
                </h3>
                <p className="text-xs text-slate-500">{historyTarget.puName}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryTarget(null)}
                aria-label="Close history modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loadingHistory ? (
                <p className="text-sm text-slate-500">Loading revision trail...</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-sm text-slate-500">No historical snapshots recorded.</p>
              ) : (
                historyEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-slate-900">
                        {entry.action} ({entry.previousStatus} -&gt; {entry.newStatus})
                      </span>
                      <span className="font-mono text-slate-500">
                        {formatFirestoreTime(entry.createdAt)}
                      </span>
                    </div>
                    {typeof entry.apcVotes === 'number' ? (
                      <p className="font-mono font-medium text-slate-800 tabular-nums">
                        APC: {entry.apcVotes} · PDP: {entry.pdpVotes ?? 0} · ADC:{' '}
                        {entry.adcVotes ?? 0} · OTHERS: {entry.othersVotes ?? 0}
                      </p>
                    ) : null}
                    <p className="font-mono text-slate-700 tabular-nums">
                      Reg: {entry.registeredVoters} · Acc: {entry.accreditedVoters} · Valid:{' '}
                      {entry.validVotes} · Rej: {entry.rejectedVotes} · Total:{' '}
                      {entry.totalVotesCast}
                    </p>
                    <p className="text-slate-600">
                      Actor: <span className="font-medium text-slate-800">{entry.actorName}</span>
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
