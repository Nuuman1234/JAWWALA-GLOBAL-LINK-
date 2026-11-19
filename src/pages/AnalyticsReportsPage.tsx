import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Printer,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AUTOMATIC_REPORT_LABELS,
  INCIDENT_CATEGORIES,
  LGA_DEFINITIONS,
  UserRole,
  VerificationStatus,
  formatFirestoreTime,
  type AgentCheckIn,
  type ApprovedPuResult,
  type AutomaticReportCategory,
  type GeneratedReportRecord,
  type IncidentReport,
  type LgaId,
  type OfflineQueuedItem,
  type OperationalNote,
  type OperationalTask,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  buildAutomaticReportData,
  computeAnalyticsDashboardMetrics,
  type AnalyticsDashboardMetrics,
  type AnalyticsReportFilters,
  type CompiledAutomaticReport,
} from '../utils/analyticsReportsEngine';
import { exportReportToExcel } from '../utils/reportDocumentExport';
import {
  archiveGeneratedReport,
  compileReportOffMainThread,
  computeMetricsOffMainThread,
  deleteArchivedReport,
  enqueueReportArchiveOffline,
  generateLargeReportPdfAsync,
} from '../services/reportArchiveService';
import { OfflineSyncBadge } from '../components/StatusBadge';

interface AnalyticsReportsPageProps {
  user: UserAccount;
  users: UserAccount[];
  wards: Ward[];
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  tasks: OperationalTask[];
  notes: OperationalNote[];
  generatedReports: GeneratedReportRecord[];
  queuedItems: OfflineQueuedItem[];
  isOnline: boolean;
  lastUpdatedAt: Date | null;
  syncingNow: boolean;
  onRetrySync: () => void;
}

const REPORT_CATEGORIES: AutomaticReportCategory[] = [
  'DAILY_SITUATION',
  'LGA_SUMMARY',
  'WARD_PERFORMANCE',
  'PU_COVERAGE',
  'AGENT_ACTIVITY',
  'OFFICER_PERFORMANCE',
  'ELECTION_INCIDENT',
  'TASK_COMPLETION',
  'FIELD_CHECKIN',
  'RESULTS_SUBMISSION_STATUS',
  'DATA_SYNCHRONIZATION',
  'OUTSTANDING_ACTIONS',
];

function isoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function AnalyticsReportsPage({
  user,
  users,
  wards,
  pollingUnits,
  checkIns,
  incidents,
  results,
  approvedPuResults,
  tasks,
  notes,
  generatedReports,
  queuedItems,
  isOnline,
  lastUpdatedAt,
  syncingNow,
  onRetrySync,
}: AnalyticsReportsPageProps) {
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;
  const lockedLga: 'all' | LgaId =
    user.role === UserRole.FUNTUA_SUPER_ADMIN
      ? 'funtua'
      : user.role === UserRole.DANDUME_SUPER_ADMIN
        ? 'dandume'
        : 'all';
  const lockedWard =
    user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER
      ? user.assignedWardId || 'all'
      : 'all';

  const [category, setCategory] = useState<AutomaticReportCategory>('DAILY_SITUATION');
  const [startDateIso, setStartDateIso] = useState('');
  const [endDateIso, setEndDateIso] = useState('');
  const [lgaId, setLgaId] = useState<'all' | LgaId>(lockedLga);
  const [wardId, setWardId] = useState<'all' | string>(lockedWard);
  const [puId, setPuId] = useState<'all' | string>('all');
  const [officerUid, setOfficerUid] = useState<'all' | string>('all');
  const [incidentCategory, setIncidentCategory] = useState<'all' | string>('all');
  const [submissionStatus, setSubmissionStatus] = useState<'all' | string>('all');

  const [archiving, setArchiving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfProgressPercent, setPdfProgressPercent] = useState<number | null>(null);
  const [compilingWorker, setCompilingWorker] = useState(false);
  const [deletingArchiveId, setDeletingArchiveId] = useState<string | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<GeneratedReportRecord | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const autoDailyArchivedRef = useRef(false);
  const pdfAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pdfAbortControllerRef.current?.abort();
    };
  }, []);

  const effectiveLga = lockedLga !== 'all' ? lockedLga : lgaId;
  const effectiveWard = lockedWard !== 'all' ? lockedWard : wardId;

  const filters: AnalyticsReportFilters = useMemo(
    () => ({
      startDateIso,
      endDateIso,
      lgaId: effectiveLga,
      wardId: effectiveWard,
      puId,
      officerUid,
      category,
      incidentCategory,
      submissionStatus,
    }),
    [
      startDateIso,
      endDateIso,
      effectiveLga,
      effectiveWard,
      puId,
      officerUid,
      category,
      incidentCategory,
      submissionStatus,
    ]
  );

  const dataset = useMemo(
    () => ({
      users,
      wards,
      pollingUnits,
      checkIns,
      incidents,
      results,
      approvedPuResults,
      tasks,
      notes,
      queuedItems,
    }),
    [users, wards, pollingUnits, checkIns, incidents, results, approvedPuResults, tasks, notes, queuedItems]
  );

  const [metrics, setMetrics] = useState<AnalyticsDashboardMetrics>(() =>
    computeAnalyticsDashboardMetrics(dataset, filters)
  );
  const [compiledReport, setCompiledReport] = useState<CompiledAutomaticReport>(() =>
    buildAutomaticReportData(dataset, filters)
  );

  // Offload report data processing to Web Worker so large datasets never block mobile UI thread
  useEffect(() => {
    const controller = new AbortController();
    setCompilingWorker(true);
    void Promise.all([
      computeMetricsOffMainThread(dataset, filters, controller.signal),
      compileReportOffMainThread(dataset, filters, controller.signal),
    ])
      .then(([nextMetrics, nextReport]) => {
        if (!controller.signal.aborted) {
          setMetrics(nextMetrics);
          setCompiledReport(nextReport);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMetrics(computeAnalyticsDashboardMetrics(dataset, filters));
          setCompiledReport(buildAutomaticReportData(dataset, filters));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCompilingWorker(false);
      });
    return () => controller.abort();
  }, [dataset, filters]);

  // Automatic daily situation report compilation & archival once per day when online for Full Admin
  useEffect(() => {
    if (
      !isFullAdmin ||
      !isOnline ||
      autoDailyArchivedRef.current ||
      (wards.length === 0 && pollingUnits.length === 0)
    ) {
      return;
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    const todaySlug = todayIso.replace(/-/g, '');
    const expectedDailyId = `daily_sitrep_${todaySlug}_all_all`;
    if (generatedReports.some((r) => r.id === expectedDailyId)) {
      autoDailyArchivedRef.current = true;
      return;
    }

    autoDailyArchivedRef.current = true;
    const dailyFilters: AnalyticsReportFilters = {
      startDateIso: todayIso,
      endDateIso: todayIso,
      lgaId: 'all',
      wardId: 'all',
      puId: 'all',
      officerUid: 'all',
      category: 'DAILY_SITUATION',
    };
    const dailyReport = buildAutomaticReportData(dataset, dailyFilters);
    void archiveGeneratedReport(user, dailyReport, dailyFilters, 'AUTOMATIC_DAILY').catch(() => {
      // Non-fatal background daily archive
    });
  }, [isFullAdmin, isOnline, wards.length, pollingUnits.length, generatedReports, dataset, user]);

  // Cascading filter dropdown options
  const availableWards = useMemo(
    () =>
      wards
        .filter((w) => effectiveLga === 'all' || w.lgaId === effectiveLga)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [wards, effectiveLga]
  );

  const availablePus = useMemo(
    () =>
      pollingUnits
        .filter(
          (p) =>
            (effectiveLga === 'all' || p.lgaId === effectiveLga) &&
            (effectiveWard === 'all' || p.wardId === effectiveWard)
        )
        .sort((a, b) => a.puCode.localeCompare(b.puCode)),
    [pollingUnits, effectiveLga, effectiveWard]
  );

  const availableOfficers = useMemo(
    () =>
      users
        .filter(
          (u) =>
            u.role === UserRole.OPERATIONS_OFFICER &&
            (effectiveLga === 'all' || u.assignedLgaId === effectiveLga) &&
            (effectiveWard === 'all' || u.assignedWardId === effectiveWard)
        )
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users, effectiveLga, effectiveWard]
  );

  const reportQueueItems = useMemo(
    () => queuedItems.filter((q) => q.reportType === 'REPORT_ARCHIVE'),
    [queuedItems]
  );

  const lastSyncedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleString('en-NG')
    : 'Not yet synchronized';

  const exportContext = useMemo(
    () => ({
      isLiveData: isOnline && Boolean(lastUpdatedAt),
      lastSyncedLabel,
      generatedByName: user.displayName,
    }),
    [isOnline, lastUpdatedAt, lastSyncedLabel, user.displayName]
  );

  const handleDownloadPdf = async () => {
    if (generatingPdf) return;
    setBanner(null);
    setGeneratingPdf(true);
    setPdfProgressPercent(0);
    const controller = new AbortController();
    pdfAbortControllerRef.current = controller;
    try {
      const result = await generateLargeReportPdfAsync(compiledReport, exportContext, {
        autoDownload: true,
        signal: controller.signal,
        onProgress: (p) => setPdfProgressPercent(p.percent),
      });
      setBanner({
        type: 'success',
        text: `Downloaded PDF report: ${result.fileName} (${result.pageCount} page${result.pageCount === 1 ? '' : 's'}${result.usedWebWorker ? ' · processed in background worker' : ''})`,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to generate PDF report.',
      });
    } finally {
      if (pdfAbortControllerRef.current === controller) {
        pdfAbortControllerRef.current = null;
      }
      setGeneratingPdf(false);
      setPdfProgressPercent(null);
    }
  };

  const handleCancelPdf = () => {
    pdfAbortControllerRef.current?.abort();
    setGeneratingPdf(false);
    setPdfProgressPercent(null);
  };

  const handleExportExcel = () => {
    setBanner(null);
    try {
      const fileName = exportReportToExcel(compiledReport, metrics.wardPerformance, exportContext);
      setBanner({ type: 'success', text: `Exported Excel workbook: ${fileName}` });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to generate Excel workbook.',
      });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleArchiveSnapshot = async () => {
    setArchiving(true);
    setBanner(null);
    try {
      if (!isOnline) {
        await enqueueReportArchiveOffline(user, compiledReport, filters, 'ON_DEMAND');
        setBanner({
          type: 'success',
          text: `${compiledReport.reportTitle} queued offline and will archive automatically when internet returns.`,
        });
      } else {
        await archiveGeneratedReport(user, compiledReport, filters, 'ON_DEMAND');
        setBanner({
          type: 'success',
          text: `${compiledReport.reportTitle} archived to the FDMIS reports repository.`,
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to archive report snapshot.',
      });
    } finally {
      setArchiving(false);
    }
  };

  const handleDeleteArchive = async (reportId: string) => {
    setDeletingArchiveId(reportId);
    setBanner(null);
    try {
      await deleteArchivedReport(user, reportId);
      if (selectedArchive?.id === reportId) setSelectedArchive(null);
      setBanner({ type: 'success', text: 'Archived report permanently deleted.' });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete archived report.',
      });
    } finally {
      setDeletingArchiveId(null);
    }
  };

  const activeIncidentsCount =
    metrics.incidentsByStatus.NEW +
    metrics.incidentsByStatus.UNDER_REVIEW +
    metrics.incidentsByStatus.ESCALATED;

  return (
    <div className="space-y-6">
      {/* Data Freshness Indicator — Never display cached offline data as live */}
      <section
        className={`flex flex-col gap-3 rounded-lg border px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between ${
          isOnline
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
            : 'border-amber-300 bg-amber-50 text-amber-950'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {isOnline ? (
            <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          )}
          <div>
            <p className="font-semibold uppercase tracking-wide">
              {isOnline
                ? 'LIVE DATABASE ANALYTICS'
                : 'OFFLINE CACHED SNAPSHOT — NOT LIVE DATA'}
            </p>
            <p className="mt-0.5 opacity-90">
              {isOnline
                ? `Compiled strictly from synchronized FDMIS database records. Last refreshed: ${lastSyncedLabel}.`
                : `Showing previously downloaded records last synchronized at ${lastSyncedLabel}. Analytics refresh automatically when internet returns.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetrySync}
          disabled={!isOnline || syncingNow}
          className="no-print inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md border border-current/20 bg-white/80 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
          <span>{syncingNow ? 'Refreshing...' : 'Refresh Data'}</span>
        </button>
      </section>

      {banner ? (
        <div
          className={`no-print flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss message"
            className="opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* FILTERS BAR */}
      <section className="no-print rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Report Scope & Filter Controls</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const today = isoDateDaysAgo(0);
                setStartDateIso(today);
                setEndDateIso(today);
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setStartDateIso(isoDateDaysAgo(6));
                setEndDateIso(isoDateDaysAgo(0));
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => {
                setStartDateIso('');
                setEndDateIso('');
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              All Dates
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Automatic Report Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AutomaticReportCategory)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            >
              {REPORT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {AUTOMATIC_REPORT_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Start Date
            </label>
            <input
              type="date"
              value={startDateIso}
              onChange={(e) => setStartDateIso(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              End Date
            </label>
            <input
              type="date"
              value={endDateIso}
              min={startDateIso || undefined}
              onChange={(e) => setEndDateIso(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              LGA
            </label>
            <select
              value={effectiveLga}
              disabled={lockedLga !== 'all'}
              onChange={(e) => {
                setLgaId(e.target.value as 'all' | LgaId);
                setWardId('all');
                setPuId('all');
                setOfficerUid('all');
              }}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none disabled:bg-slate-50"
            >
              <option value="all">Funtua & Dandume (All)</option>
              <option value="funtua">Funtua LGA</option>
              <option value="dandume">Dandume LGA</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Ward
            </label>
            <select
              value={effectiveWard}
              disabled={lockedWard !== 'all'}
              onChange={(e) => {
                setWardId(e.target.value);
                setPuId('all');
                setOfficerUid('all');
              }}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none disabled:bg-slate-50"
            >
              <option value="all">All Wards</option>
              {availableWards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({LGA_DEFINITIONS[w.lgaId]?.shortName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Polling Unit
            </label>
            <select
              value={puId}
              onChange={(e) => setPuId(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            >
              <option value="all">All Polling Units</option>
              {availablePus.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.puCode} — {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Operations Officer
            </label>
            <select
              value={officerUid}
              onChange={(e) => setOfficerUid(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            >
              <option value="all">All Operations Officers</option>
              {availableOfficers.map((o) => (
                <option key={o.uid} value={o.uid}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Incident Category
            </label>
            <select
              value={incidentCategory}
              onChange={(e) => setIncidentCategory(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            >
              <option value="all">All Incident Categories</option>
              {INCIDENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Submission / Verification Status
            </label>
            <select
              value={submissionStatus}
              onChange={(e) => setSubmissionStatus(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            >
              <option value="all">All Submission Statuses</option>
              {Object.values(VerificationStatus).map((st) => (
                <option key={st} value={st}>
                  {st.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ANALYTICS DASHBOARD KPIs */}
      <section data-print-board="true" className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
            <BarChart3 className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <span>Operational Analytics Dashboard</span>
          </h3>
          <span className="text-xs text-slate-500">{compiledReport.scopeLabel}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 print-grid-4">
          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Registered Agents</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {metrics.totalRegisteredAgents}
            </p>
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              {metrics.activeAgents} active · {metrics.inactiveAgents} inactive
            </p>
          </div>

          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Polling Units Reporting</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#0b3b24]">
              {metrics.reportingPollingUnits}
              <span className="text-sm font-normal text-slate-500">/{metrics.totalPollingUnits}</span>
            </p>
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              {metrics.reportingRatePercent}% · {metrics.nonReportingPollingUnits} non-reporting
            </p>
          </div>

          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Operations Officers</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {metrics.activeOperationsOfficers}
              <span className="text-sm font-normal text-slate-500">/{metrics.totalOperationsOfficers}</span>
            </p>
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              {metrics.compliantWardsCount} compliant · {metrics.understaffedWardsCount} understaffed wards
            </p>
          </div>

          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Field Tasks</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {metrics.tasksCompleted}
              <span className="text-sm font-normal text-slate-500">/{metrics.tasksTotal} done</span>
            </p>
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              {metrics.tasksOverdue} overdue · {metrics.tasksAwaitingReview} awaiting review
            </p>
          </div>

          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Election Incidents</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {metrics.incidentsTotal}
            </p>
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              {activeIncidentsCount} active · {metrics.criticalActiveIncidents} critical · {metrics.incidentsByStatus.RESOLVED + metrics.incidentsByStatus.CLOSED} resolved
            </p>
          </div>
        </div>

        {/* Officer Distribution by Ward & Incident Status Breakdown */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print-grid-2">
          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">
                Operations Officer Distribution by Ward
              </h4>
              <span className="text-xs text-slate-500">Target: 5 active / ward</span>
            </div>
            {metrics.wardOfficerDistribution.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No wards in active filter scope.</p>
            ) : (
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                {metrics.wardOfficerDistribution.map((w) => {
                  const pct = Math.min(100, Math.round((w.activeCount / w.minRequired) * 100));
                  return (
                    <div key={w.wardId} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="truncate font-medium text-slate-800">
                          {w.wardName} ({LGA_DEFINITIONS[w.lgaId]?.shortName})
                        </span>
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            w.isCompliant ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {w.activeCount}/{w.minRequired}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={w.isCompliant ? 'h-full bg-emerald-600' : 'h-full bg-amber-500'}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div data-print-card="true" className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-900">
              Incidents by Status & Verification Completeness
            </h4>
            <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-slate-500">New</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-slate-900">
                  {metrics.incidentsByStatus.NEW}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-slate-500">Under Review</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-amber-800">
                  {metrics.incidentsByStatus.UNDER_REVIEW}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-slate-500">Escalated</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-red-700">
                  {metrics.incidentsByStatus.ESCALATED}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-slate-500">Resolved / Closed</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-700">
                  {metrics.incidentsByStatus.RESOLVED + metrics.incidentsByStatus.CLOSED}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-slate-500">Verified Results</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-700">
                  {metrics.verifiedResultsCount}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-slate-500">Unverified Pending</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-amber-800">
                  {metrics.unverifiedResultsCount}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EXPORT ACTION BAR */}
      <section className="no-print flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{compiledReport.reportTitle}</p>
          <p className="text-xs text-slate-500">
            Period: {compiledReport.reportingPeriodLabel} · {compiledReport.rows.length} record(s)
            {compilingWorker ? ' · Updating dataset in background worker...' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={generatingPdf}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#0b3b24] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#082d1b] disabled:opacity-60 whitespace-nowrap"
          >
            {generatingPdf ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {generatingPdf
                ? `Generating PDF${pdfProgressPercent !== null ? ` (${pdfProgressPercent}%)` : '...'}`
                : 'Download PDF'}
            </span>
          </button>
          {generatingPdf ? (
            <button
              type="button"
              onClick={handleCancelPdf}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 whitespace-nowrap"
            >
              <X className="h-3.5 w-3.5" />
              <span>Cancel PDF</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-emerald-700/30 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-[#0b3b24] hover:bg-emerald-100 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            <span>Export Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span>Print Report</span>
          </button>
          <button
            type="button"
            disabled={archiving}
            onClick={() => void handleArchiveSnapshot()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            <span>{archiving ? 'Saving...' : isOnline ? 'Archive Snapshot' : 'Queue Archive Offline'}</span>
          </button>
        </div>
      </section>

      {/* PRINTABLE IN-APP REPORT VIEWER */}
      <section
        data-print-report="true"
        data-print-landscape={compiledReport.headers.length > 7 ? 'true' : 'false'}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        {/* Official Report Header (always visible on screen and styled crisply for print) */}
        <div className="print-only-header border-b-2 border-[#0b3b24] pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0b3b24]">
                {compiledReport.fdmisName}
              </p>
              <h3 className="mt-0.5 font-display text-xl font-bold text-slate-900">
                {compiledReport.reportTitle}
              </h3>
            </div>
            <div className="text-xs text-slate-600 sm:text-right">
              <p className="font-semibold text-slate-900">
                {isOnline ? 'Source: Live Database' : 'Source: Offline Cached Snapshot'}
              </p>
              <p>Generated: {new Date(compiledReport.generatedAtIso).toLocaleString('en-NG')}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>
              <strong>Reporting Period:</strong> {compiledReport.reportingPeriodLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong>Scope:</strong> {compiledReport.scopeLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong>Status:</strong> {compiledReport.dataStatus}
            </span>
          </div>
        </div>

        {/* Data Completeness / Unverified Warning */}
        <div
          className={`mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
            compiledReport.incompleteRecordsCount > 0 || compiledReport.unverifiedRecordsCount > 0
              ? 'border-amber-200 bg-amber-50 text-amber-950'
              : 'border-emerald-200 bg-emerald-50 text-emerald-950'
          }`}
        >
          {compiledReport.incompleteRecordsCount > 0 || compiledReport.unverifiedRecordsCount > 0 ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          )}
          <span>{compiledReport.dataCompletenessNotice}</span>
        </div>

        {/* Report Summary Metrics */}
        {compiledReport.summaryMetrics.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 print-grid-4">
            {compiledReport.summaryMetrics.map((m) => (
              <div
                key={m.label}
                data-print-card="true"
                className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5"
              >
                <p className="text-[11px] font-medium text-slate-500">{m.label}</p>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Detailed Report Table */}
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                {compiledReport.headers.map((header) => (
                  <th key={header} className="px-3 py-2.5 whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {compiledReport.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(1, compiledReport.headers.length)}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No matching records exist in the database for the selected filters. Zero values are never fabricated.
                  </td>
                </tr>
              ) : (
                compiledReport.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className="px-3 py-2 text-slate-800 whitespace-nowrap tabular-nums"
                      >
                        {String(cell ?? '')}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ARCHIVED & OFFLINE-ACCESSIBLE REPORTS */}
      <section className="no-print space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
              <span>Archived & Offline-Accessible Reports ({generatedReports.length})</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Previously compiled daily situation reports and saved snapshots remain viewable offline.
            </p>
          </div>
          {reportQueueItems.length > 0 ? (
            <button
              type="button"
              onClick={onRetrySync}
              disabled={!isOnline || syncingNow}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
              <span>Sync {reportQueueItems.length} Queued Archive(s)</span>
            </button>
          ) : null}
        </div>

        {reportQueueItems.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-3">
            {reportQueueItems.map((q) => (
              <div
                key={q.clientSubmissionId}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span className="font-medium text-slate-900">{q.summary}</span>
                <OfflineSyncBadge status={q.status} />
              </div>
            ))}
          </div>
        ) : null}

        {generatedReports.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            No archived report snapshots saved yet. Click "Archive Snapshot" above to save a permanent timestamped summary.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {generatedReports.slice(0, 15).map((rec) => (
              <div
                key={rec.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{rec.reportTitle}</span>
                    <span className="text-xs text-slate-500">
                      {rec.generationMode === 'AUTOMATIC_DAILY' ? 'Auto Daily' : 'On-Demand'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {rec.scopeLabel} · {rec.rowCount} row(s) · Compiled by {rec.generatedByName} ·{' '}
                    {formatFirestoreTime(rec.clientCreatedAtIso || rec.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedArchive(rec)}
                    className="min-h-[34px] rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Inspect Summary
                  </button>
                  {isFullAdmin ? (
                    <button
                      type="button"
                      disabled={deletingArchiveId === rec.id || !isOnline}
                      onClick={() => void handleDeleteArchive(rec.id)}
                      aria-label={`Delete archived report ${rec.reportTitle}`}
                      className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-md border border-slate-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ARCHIVED REPORT INSPECTOR MODAL */}
      {selectedArchive ? (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0b3b24]">
                  Archived Snapshot · {selectedArchive.generationMode === 'AUTOMATIC_DAILY' ? 'Automatic Daily' : 'On-Demand'}
                </p>
                <h4 className="mt-0.5 font-display text-lg font-bold text-slate-900">
                  {selectedArchive.reportTitle}
                </h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedArchive.scopeLabel} · {formatFirestoreTime(selectedArchive.clientCreatedAtIso || selectedArchive.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedArchive(null)}
                aria-label="Close archived report"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-700">
                <p className="font-semibold text-slate-900">{selectedArchive.dataStatus}</p>
                <p className="mt-1">{selectedArchive.dataCompletenessNotice}</p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(selectedArchive.summaryMetrics || {}).map(([k, v]) => (
                  <div key={k} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[11px] text-slate-500">{k}</p>
                    <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">{String(v)}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Records: {selectedArchive.rowCount}
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Prepared by {selectedArchive.generatedByName}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
