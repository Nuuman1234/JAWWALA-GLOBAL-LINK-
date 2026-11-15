import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  deleteSelectedTestData,
  type TestDeletionResult,
} from '../services/dataManagementService';
import {
  LGA_DEFINITIONS,
  canManageTestData,
  formatFirestoreTime,
  type AgentCheckIn,
  type ApprovedPuResult,
  type IncidentReport,
  type LgaId,
  type NotificationItem,
  type PollingUnit,
  type ReportAttachment,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
} from '../types/fdmis';

interface DataManagementPageProps {
  user: UserAccount;
  pollingUnits: PollingUnit[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  incidents: IncidentReport[];
  checkIns: AgentCheckIn[];
  notifications: NotificationItem[];
  timelineEvents: TimelineEvent[];
  reportAttachments: ReportAttachment[];
}

type CategoryKey =
  | 'results'
  | 'approvedResults'
  | 'incidents'
  | 'checkIns'
  | 'notifications'
  | 'timelineEvents'
  | 'attachments';

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  results: 'Result Submissions',
  approvedResults: 'Verified / Approved Election Results',
  incidents: 'Incidents & Alerts',
  checkIns: 'Agent Check-Ins & Attendance',
  notifications: 'Notifications',
  timelineEvents: 'Timeline & Report Activity Logs',
  attachments: 'Uploaded Evidence Attachments',
};

export function DataManagementPage({
  user,
  pollingUnits,
  results,
  approvedPuResults,
  incidents,
  checkIns,
  notifications,
  timelineEvents,
  reportAttachments,
}: DataManagementPageProps) {
  const authorized = canManageTestData(user.role);

  const [viewMode, setViewMode] = useState<'MARKED_TEST' | 'MANUAL_SELECTION'>('MARKED_TEST');
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('results');
  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');

  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [selectedApproved, setSelectedApproved] = useState<Set<string>>(new Set());
  const [selectedIncidents, setSelectedIncidents] = useState<Set<string>>(new Set());
  const [selectedCheckIns, setSelectedCheckIns] = useState<Set<string>>(new Set());
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());
  const [selectedTimeline, setSelectedTimeline] = useState<Set<string>>(new Set());
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());

  const [confirmModalMode, setConfirmModalMode] = useState<
    'SELECTED_TEST_RECORDS' | 'RESET_ALL_TEST_DATA' | null
  >(null);
  const [resetPhrase, setResetPhrase] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [lastSummary, setLastSummary] = useState<TestDeletionResult | null>(null);

  // Identify records explicitly marked as isTestData === true (never heuristic auto-classification)
  const markedTestResultIds = useMemo(
    () => new Set(results.filter((r) => r.isTestData === true).map((r) => r.id)),
    [results]
  );

  const markedApprovedResults = useMemo(
    () =>
      approvedPuResults.filter((a) => markedTestResultIds.has(a.sourceSubmissionId)),
    [approvedPuResults, markedTestResultIds]
  );

  const markedResults = useMemo(
    () => results.filter((r) => r.isTestData === true),
    [results]
  );
  const markedIncidents = useMemo(
    () => incidents.filter((i) => i.isTestData === true),
    [incidents]
  );
  const markedCheckIns = useMemo(
    () => checkIns.filter((c) => c.isTestData === true),
    [checkIns]
  );
  const markedNotifications = useMemo(
    () => notifications.filter((n) => n.isTestData === true),
    [notifications]
  );
  const markedTimeline = useMemo(
    () => timelineEvents.filter((t) => t.isTestData === true),
    [timelineEvents]
  );
  const markedIncidentIdSet = useMemo(
    () => new Set(markedIncidents.map((i) => i.id)),
    [markedIncidents]
  );
  const markedAttachments = useMemo(
    () =>
      reportAttachments.filter(
        (att) =>
          markedTestResultIds.has(att.reportId) || markedIncidentIdSet.has(att.reportId)
      ),
    [reportAttachments, markedTestResultIds, markedIncidentIdSet]
  );

  const totalMarkedCount =
    markedResults.length +
    markedApprovedResults.length +
    markedIncidents.length +
    markedCheckIns.length +
    markedNotifications.length +
    markedTimeline.length +
    markedAttachments.length;

  const totalSelectedCount =
    selectedResults.size +
    selectedApproved.size +
    selectedIncidents.size +
    selectedCheckIns.size +
    selectedNotifications.size +
    selectedTimeline.size +
    selectedAttachments.size;

  if (!authorized) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        Access Restricted: Only authorized Full Control Administrators can access Data Management and
        test record deletion.
      </div>
    );
  }

  const toggleId = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearAllSelections = () => {
    setSelectedResults(new Set());
    setSelectedApproved(new Set());
    setSelectedIncidents(new Set());
    setSelectedCheckIns(new Set());
    setSelectedNotifications(new Set());
    setSelectedTimeline(new Set());
    setSelectedAttachments(new Set());
  };

  const previewItems = useMemo(() => {
    const useMarked = confirmModalMode === 'RESET_ALL_TEST_DATA';
    const rIds = useMarked ? new Set(markedResults.map((r) => r.id)) : selectedResults;
    const aIds = useMarked ? new Set(markedApprovedResults.map((a) => a.puId)) : selectedApproved;
    const iIds = useMarked ? new Set(markedIncidents.map((i) => i.id)) : selectedIncidents;
    const cIds = useMarked ? new Set(markedCheckIns.map((c) => c.id)) : selectedCheckIns;
    const nIds = useMarked
      ? new Set(markedNotifications.map((n) => n.id))
      : selectedNotifications;
    const tIds = useMarked ? new Set(markedTimeline.map((t) => t.id)) : selectedTimeline;
    const attIds = useMarked
      ? new Set(markedAttachments.map((att) => att.id))
      : selectedAttachments;

    // Include cascading approved results and evidence attachments derived from selected results/incidents
    const effectiveApprovedIds = new Set(aIds);
    approvedPuResults.forEach((a) => {
      if (rIds.has(a.sourceSubmissionId)) effectiveApprovedIds.add(a.puId);
    });

    const effectiveAttachmentIds = new Set(attIds);
    reportAttachments.forEach((att) => {
      if (rIds.has(att.reportId) || iIds.has(att.reportId)) {
        effectiveAttachmentIds.add(att.id);
      }
    });

    const lines: Array<{ category: string; label: string; detail: string }> = [];
    results
      .filter((r) => rIds.has(r.id))
      .forEach((r) =>
        lines.push({
          category: 'Result Submission',
          label: `${r.puCode} · ${r.puName}`,
          detail: `Cast: ${r.totalVotesCast} · Status: ${r.verificationStatus}`,
        })
      );
    approvedPuResults
      .filter((a) => effectiveApprovedIds.has(a.puId))
      .forEach((a) =>
        lines.push({
          category: 'Verified Election Result',
          label: `${a.puCode} · ${a.puName}`,
          detail: `Reverses aggregated totals (APC ${a.apcVotes}, PDP ${a.pdpVotes}, ADC ${a.adcVotes}, OTHERS ${a.othersVotes})`,
        })
      );
    incidents
      .filter((i) => iIds.has(i.id))
      .forEach((i) =>
        lines.push({
          category: 'Incident Report',
          label: `${i.puCode} · ${i.title}`,
          detail: `${i.category} (${i.urgency})`,
        })
      );
    checkIns
      .filter((c) => cIds.has(c.id))
      .forEach((c) =>
        lines.push({
          category: 'Agent Check-In',
          label: `${c.puCode} · ${c.agentName}`,
          detail: `Arrived ${c.arrivalTimeText}`,
        })
      );
    notifications
      .filter((n) => nIds.has(n.id))
      .forEach((n) =>
        lines.push({
          category: 'Notification',
          label: n.title,
          detail: `Scope: ${n.targetLgaId}`,
        })
      );
    timelineEvents
      .filter((t) => tIds.has(t.id))
      .forEach((t) =>
        lines.push({
          category: 'Timeline / Activity Log',
          label: t.title,
          detail: t.puCode || t.lgaId || 'General',
        })
      );
    reportAttachments
      .filter((att) => effectiveAttachmentIds.has(att.id))
      .forEach((att) =>
        lines.push({
          category: 'Uploaded Evidence',
          label: att.fileName,
          detail: `${att.reportType} · ${(att.sizeBytes / 1024).toFixed(1)} KB`,
        })
      );

    return {
      rIds: Array.from(rIds),
      aIds: Array.from(effectiveApprovedIds),
      iIds: Array.from(iIds),
      cIds: Array.from(cIds),
      nIds: Array.from(nIds),
      tIds: Array.from(tIds),
      attIds: Array.from(effectiveAttachmentIds),
      lines,
    };
  }, [
    confirmModalMode,
    markedResults,
    markedApprovedResults,
    markedIncidents,
    markedCheckIns,
    markedNotifications,
    markedTimeline,
    markedAttachments,
    selectedResults,
    selectedApproved,
    selectedIncidents,
    selectedCheckIns,
    selectedNotifications,
    selectedTimeline,
    selectedAttachments,
    approvedPuResults,
    reportAttachments,
    results,
    incidents,
    checkIns,
    notifications,
    timelineEvents,
  ]);

  const handleConfirmDeletion = async () => {
    if (!confirmModalMode) return;
    if (confirmModalMode === 'RESET_ALL_TEST_DATA' && resetPhrase.trim() !== 'RESET TEST DATA') {
      return;
    }

    setDeleting(true);
    setFeedback(null);
    try {
      const outcome = await deleteSelectedTestData(
        user,
        {
          resultSubmissionIds: previewItems.rIds,
          approvedPuResultIds: previewItems.aIds,
          incidentIds: previewItems.iIds,
          checkInIds: previewItems.cIds,
          notificationIds: previewItems.nIds,
          timelineEventIds: previewItems.tIds,
          reportAttachmentIds: previewItems.attIds,
        },
        {
          mode: confirmModalMode,
          results,
          approvedPuResults,
          incidents,
          checkIns,
          notifications,
          timelineEvents,
          attachments: reportAttachments,
          pollingUnits,
        }
      );

      clearAllSelections();
      setConfirmModalMode(null);
      setResetPhrase('');
      setLastSummary(outcome);
      setFeedback({
        type: 'ok',
        text: `Deleted ${outcome.totalDeleted} selected/test record(s) safely and logged the activity in the audit trail.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to delete selected test records.',
      });
    } finally {
      setDeleting(false);
    }
  };

  // Filtered datasets for display depending on viewMode & lgaFilter
  const matchLga = (lgaId?: string) => lgaFilter === 'all' || lgaId === lgaFilter;

  const shownResults = (viewMode === 'MARKED_TEST' ? markedResults : results).filter((r) =>
    matchLga(r.lgaId)
  );
  const shownApproved = (
    viewMode === 'MARKED_TEST' ? markedApprovedResults : approvedPuResults
  ).filter((a) => matchLga(a.lgaId));
  const shownIncidents = (viewMode === 'MARKED_TEST' ? markedIncidents : incidents).filter((i) =>
    matchLga(i.lgaId)
  );
  const shownCheckIns = (viewMode === 'MARKED_TEST' ? markedCheckIns : checkIns).filter((c) =>
    matchLga(c.lgaId)
  );
  const shownNotifications = (
    viewMode === 'MARKED_TEST' ? markedNotifications : notifications
  ).filter((n) => lgaFilter === 'all' || n.targetLgaId === lgaFilter || n.targetLgaId === 'all');
  const shownTimeline = (
    viewMode === 'MARKED_TEST' ? markedTimeline : timelineEvents
  ).filter((t) => lgaFilter === 'all' || t.lgaId === lgaFilter);
  const shownAttachments = (
    viewMode === 'MARKED_TEST' ? markedAttachments : reportAttachments
  ).filter((att) => matchLga(att.lgaId));

  const categoryCounts: Record<CategoryKey, number> = {
    results: shownResults.length,
    approvedResults: shownApproved.length,
    incidents: shownIncidents.length,
    checkIns: shownCheckIns.length,
    notifications: shownNotifications.length,
    timelineEvents: shownTimeline.length,
    attachments: shownAttachments.length,
  };

  const selectAllVisibleInCategory = () => {
    if (activeCategory === 'results') {
      setSelectedResults(new Set(shownResults.map((r) => r.id)));
    } else if (activeCategory === 'approvedResults') {
      setSelectedApproved(new Set(shownApproved.map((a) => a.puId)));
    } else if (activeCategory === 'incidents') {
      setSelectedIncidents(new Set(shownIncidents.map((i) => i.id)));
    } else if (activeCategory === 'checkIns') {
      setSelectedCheckIns(new Set(shownCheckIns.map((c) => c.id)));
    } else if (activeCategory === 'notifications') {
      setSelectedNotifications(new Set(shownNotifications.map((n) => n.id)));
    } else if (activeCategory === 'timelineEvents') {
      setSelectedTimeline(new Set(shownTimeline.map((t) => t.id)));
    } else if (activeCategory === 'attachments') {
      setSelectedAttachments(new Set(shownAttachments.map((att) => att.id)));
    }
  };

  return (
    <div className="space-y-5">
      {/* Preservation & Integrity Banner */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 space-y-3">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
              <Database className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Data Management &amp; Test Data Deletion
              </h2>
              <p className="mt-0.5 text-xs text-slate-700">
                Safely inspect and delete explicitly marked test records or individually selected
                pre-launch drill entries. Polling unit directories, wards, user accounts, roles,
                system settings, and audit logs are strictly preserved.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={totalMarkedCount === 0}
            onClick={() => {
              setResetPhrase('');
              setConfirmModalMode('RESET_ALL_TEST_DATA');
            }}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Reset Test Data ({totalMarkedCount})</span>
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-white px-3.5 py-2.5 text-xs text-slate-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0b3b24]" aria-hidden="true" />
          <span>
            <strong>Zero Auto-Classification Guarantee:</strong> Existing records are never
            automatically classified as test data. Deletion applies strictly to records flagged{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
              isTestData = true
            </code>{' '}
            or rows you explicitly check below.
          </span>
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

      {lastSummary ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
          <div className="flex items-center gap-2 font-semibold text-[#0b3b24]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>
              Last Cleanup Recorded in Audit Log ({lastSummary.executedAtIso})
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-slate-600">
            Total deleted: {lastSummary.totalDeleted} · Results: {lastSummary.deletedResults} ·
            Approved Results: {lastSummary.deletedApprovedResults} · Incidents:{' '}
            {lastSummary.deletedIncidents} · Check-Ins: {lastSummary.deletedCheckIns} ·
            Notifications: {lastSummary.deletedNotifications} · Timeline:{' '}
            {lastSummary.deletedTimelineEvents} · Evidence: {lastSummary.deletedEvidenceAttachments}
          </p>
        </div>
      ) : null}

      {/* Mode Switcher & Selection Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('MARKED_TEST')}
              className={`min-h-[40px] rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
                viewMode === 'MARKED_TEST'
                  ? 'border-[#0b3b24] bg-[#0b3b24] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Marked Test Records Only ({totalMarkedCount})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('MANUAL_SELECTION')}
              className={`min-h-[40px] rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
                viewMode === 'MANUAL_SELECTION'
                  ? 'border-[#0b3b24] bg-[#0b3b24] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Manual Selection Across Records
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter records by LGA"
              value={lgaFilter}
              onChange={(e) => setLgaFilter(e.target.value as 'all' | LgaId)}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
            >
              <option value="all">All LGAs</option>
              <option value="funtua">Funtua LGA</option>
              <option value="dandume">Dandume LGA</option>
            </select>

            <button
              type="button"
              onClick={selectAllVisibleInCategory}
              disabled={categoryCounts[activeCategory] === 0}
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Select Visible in Tab
            </button>

            <button
              type="button"
              onClick={clearAllSelections}
              disabled={totalSelectedCount === 0}
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Clear Selection
            </button>

            <button
              type="button"
              disabled={totalSelectedCount === 0}
              onClick={() => setConfirmModalMode('SELECTED_TEST_RECORDS')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Delete Selected ({totalSelectedCount})</span>
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((key) => {
            const active = activeCategory === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveCategory(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[#0b3b24] bg-emerald-50 text-[#0b3b24]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {CATEGORY_LABELS[key]} ({categoryCounts[key]})
              </button>
            );
          })}
        </div>
      </div>

      {/* Category Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {categoryCounts[activeCategory] === 0 ? (
          <div className="p-6">
            <EmptyState
              title={
                viewMode === 'MARKED_TEST'
                  ? `No marked test records found in ${CATEGORY_LABELS[activeCategory]}.`
                  : `No operational records found in ${CATEGORY_LABELS[activeCategory]}.`
              }
              description={
                viewMode === 'MARKED_TEST'
                  ? 'Records without isTestData=true remain protected unless you switch to Manual Selection.'
                  : 'No records exist for this category and LGA filter.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="w-10 px-4 py-3">Select</th>
                  <th className="px-4 py-3">Record Identifier</th>
                  <th className="px-4 py-3">Scope / Details</th>
                  <th className="px-4 py-3">Flag</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeCategory === 'results'
                  ? shownResults.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select result ${r.puCode}`}
                            checked={selectedResults.has(r.id)}
                            onChange={() => toggleId(setSelectedResults, r.id)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <span className="font-mono font-semibold">{r.puCode}</span> · {r.puName}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {r.wardName} · APC {r.apcVotes ?? 0} / PDP {r.pdpVotes ?? 0} / ADC{' '}
                          {r.adcVotes ?? 0} / OTH {r.othersVotes ?? 0} · {r.verificationStatus}
                        </td>
                        <td className="px-4 py-3">
                          {r.isTestData ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              TEST RECORD
                            </span>
                          ) : (
                            <span className="text-slate-500">Operational</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(r.updatedAt)}
                        </td>
                      </tr>
                    ))
                  : null}

                {activeCategory === 'approvedResults'
                  ? shownApproved.map((a) => (
                      <tr key={a.puId} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select verified result ${a.puCode}`}
                            checked={selectedApproved.has(a.puId)}
                            onChange={() => toggleId(setSelectedApproved, a.puId)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <span className="font-mono font-semibold">{a.puCode}</span> · {a.puName}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {a.wardName} · Cast: {a.totalVotesCast} · Approved by {a.approvedByName}
                        </td>
                        <td className="px-4 py-3">
                          {markedTestResultIds.has(a.sourceSubmissionId) ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              LINKED TO TEST
                            </span>
                          ) : (
                            <span className="text-slate-500">Verified Tally</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(a.approvedAt)}
                        </td>
                      </tr>
                    ))
                  : null}

                {activeCategory === 'incidents'
                  ? shownIncidents.map((i) => (
                      <tr key={i.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select incident ${i.title}`}
                            checked={selectedIncidents.has(i.id)}
                            onChange={() => toggleId(setSelectedIncidents, i.id)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{i.title}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {i.puCode} · {i.category} · {i.urgency} ({i.status})
                        </td>
                        <td className="px-4 py-3">
                          {i.isTestData ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              TEST RECORD
                            </span>
                          ) : (
                            <span className="text-slate-500">Operational</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(i.createdAt)}
                        </td>
                      </tr>
                    ))
                  : null}

                {activeCategory === 'checkIns'
                  ? shownCheckIns.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select check-in ${c.puCode}`}
                            checked={selectedCheckIns.has(c.id)}
                            onChange={() => toggleId(setSelectedCheckIns, c.id)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <span className="font-mono font-semibold">{c.puCode}</span> · {c.agentName}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {c.puName} · Arrival: {c.arrivalTimeText}
                        </td>
                        <td className="px-4 py-3">
                          {c.isTestData ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              TEST RECORD
                            </span>
                          ) : (
                            <span className="text-slate-500">Operational</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(c.createdAt)}
                        </td>
                      </tr>
                    ))
                  : null}

                {activeCategory === 'notifications'
                  ? shownNotifications.map((n) => (
                      <tr key={n.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select notification ${n.title}`}
                            checked={selectedNotifications.has(n.id)}
                            onChange={() => toggleId(setSelectedNotifications, n.id)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{n.title}</td>
                        <td className="px-4 py-3 text-slate-600">
                          Scope: {n.targetLgaId} · {n.body.slice(0, 80)}
                        </td>
                        <td className="px-4 py-3">
                          {n.isTestData ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              TEST RECORD
                            </span>
                          ) : (
                            <span className="text-slate-500">Operational</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(n.createdAt)}
                        </td>
                      </tr>
                    ))
                  : null}

                {activeCategory === 'timelineEvents'
                  ? shownTimeline.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select timeline event ${t.title}`}
                            checked={selectedTimeline.has(t.id)}
                            onChange={() => toggleId(setSelectedTimeline, t.id)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{t.title}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {t.puCode ||
                            (t.lgaId && t.lgaId in LGA_DEFINITIONS
                              ? LGA_DEFINITIONS[t.lgaId as LgaId].shortName
                              : t.lgaId)}{' '}
                          · {t.actorName}
                        </td>
                        <td className="px-4 py-3">
                          {t.isTestData ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              TEST RECORD
                            </span>
                          ) : (
                            <span className="text-slate-500">Operational</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(t.createdAt)}
                        </td>
                      </tr>
                    ))
                  : null}

                {activeCategory === 'attachments'
                  ? shownAttachments.map((att) => (
                      <tr key={att.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select evidence ${att.fileName}`}
                            checked={selectedAttachments.has(att.id)}
                            onChange={() => toggleId(setSelectedAttachments, att.id)}
                            className="h-4 w-4 accent-red-700"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{att.fileName}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {att.reportType} · {(att.sizeBytes / 1024).toFixed(1)} KB · Report{' '}
                          <span className="font-mono">{att.reportId}</span>
                        </td>
                        <td className="px-4 py-3">
                          {markedTestResultIds.has(att.reportId) ||
                          markedIncidentIdSet.has(att.reportId) ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                              LINKED TO TEST
                            </span>
                          ) : (
                            <span className="text-slate-500">Evidence</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {formatFirestoreTime(att.createdAt)}
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal Showing Exact Affected Records */}
      {confirmModalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2.5 text-red-800">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                <h3 className="font-display text-base font-bold">
                  {confirmModalMode === 'RESET_ALL_TEST_DATA'
                    ? 'Confirm Reset Test Data'
                    : 'Confirm Selected Record Deletion'}
                </h3>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmModalMode(null)}
                aria-label="Close confirmation dialog"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-xs">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-red-950">
                <p className="font-semibold">
                  Affected Records Summary ({previewItems.lines.length} total record(s) will be
                  permanently deleted):
                </p>
                <p className="mt-1 font-mono text-[11px]">
                  Result Submissions: {previewItems.rIds.length} · Approved Results:{' '}
                  {previewItems.aIds.length} · Incidents: {previewItems.iIds.length} · Check-Ins:{' '}
                  {previewItems.cIds.length} · Notifications: {previewItems.nIds.length} ·
                  Timeline/Reports: {previewItems.tIds.length} · Evidence Attachments:{' '}
                  {previewItems.attIds.length}
                </p>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
                <strong>Strictly Preserved:</strong> All 475 Polling Unit directory records, 22
                Wards, User &amp; Admin accounts, roles, system settings, and immutable audit logs
                will remain untouched. Any linked approved results will atomically recalculate Ward,
                LGA, and Constituency totals.
              </div>

              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Record</th>
                      <th className="px-3 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewItems.lines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                          {line.category}
                        </td>
                        <td className="px-3 py-2 text-slate-900">{line.label}</td>
                        <td className="px-3 py-2 text-slate-600">{line.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {confirmModalMode === 'RESET_ALL_TEST_DATA' ? (
                <div>
                  <label htmlFor="reset-phrase" className="block text-xs font-semibold text-slate-800">
                    Type <span className="font-mono text-red-800">RESET TEST DATA</span> to confirm:
                  </label>
                  <input
                    id="reset-phrase"
                    type="text"
                    value={resetPhrase}
                    onChange={(e) => setResetPhrase(e.target.value)}
                    placeholder="RESET TEST DATA"
                    className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                  />
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmModalMode(null)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  deleting ||
                  previewItems.lines.length === 0 ||
                  (confirmModalMode === 'RESET_ALL_TEST_DATA' &&
                    resetPhrase.trim() !== 'RESET TEST DATA')
                }
                onClick={() => void handleConfirmDeletion()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>
                  {deleting
                    ? 'Deleting Records...'
                    : `Confirm Delete (${previewItems.lines.length})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
