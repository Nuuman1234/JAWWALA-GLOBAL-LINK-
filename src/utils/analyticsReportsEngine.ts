import {
  AUTOMATIC_REPORT_LABELS,
  AccountStatus,
  IncidentStatus,
  IncidentUrgency,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  PU_STATUS_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TaskStatus,
  UserRole,
  VerificationStatus,
  formatFirestoreTime,
  getEffectiveTaskStatus,
  isIncidentActive,
  isPuReporting,
  type AgentCheckIn,
  type ApprovedPuResult,
  type AutomaticReportCategory,
  type FirestoreTime,
  type IncidentReport,
  type LgaId,
  type OperationalNote,
  type OperationalTask,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  computeWardOperationsCoverage,
  type WardOperationsCoverageItem,
} from '../services/directoryService';
import { getCanonicalApprovedPuResults } from './aggregationEngine';

export const FDMIS_OFFICIAL_NAME = 'Funtua–Dandume Mandate Intelligence System (FDMIS)';

export interface AnalyticsReportFilters {
  startDateIso: string; // 'YYYY-MM-DD' or ''
  endDateIso: string; // 'YYYY-MM-DD' or ''
  lgaId: 'all' | LgaId;
  wardId: 'all' | string;
  puId: 'all' | string;
  officerUid: 'all' | string;
  category: AutomaticReportCategory;
}

export interface AnalyticsDatasetInputs {
  users: UserAccount[];
  wards: Ward[];
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  tasks: OperationalTask[];
  notes: OperationalNote[];
}

export interface WardPerformanceRow {
  wardId: string;
  wardName: string;
  wardCode: string;
  lgaId: LgaId;
  lgaShortName: string;
  totalPollingUnits: number;
  reportingPollingUnits: number;
  nonReportingPollingUnits: number;
  reportingRatePercent: number;
  registeredAgents: number;
  activeAgents: number;
  checkedInPollingUnits: number;
  operationsOfficersCount: number;
  officerTarget: number;
  officersCompliant: boolean;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksOverdue: number;
  incidentsTotal: number;
  activeIncidents: number;
  verifiedResultsCount: number;
  unverifiedResultsCount: number;
  completenessStatus: 'COMPLETE' | 'INCOMPLETE_DATA' | 'UNVERIFIED_PENDING';
}

export interface AnalyticsDashboardMetrics {
  totalRegisteredAgents: number;
  activeAgents: number;
  inactiveAgents: number;
  checkedInAgents: number;
  totalPollingUnits: number;
  reportingPollingUnits: number;
  nonReportingPollingUnits: number;
  reportingRatePercent: number;
  totalOperationsOfficers: number;
  activeOperationsOfficers: number;
  compliantWardsCount: number;
  understaffedWardsCount: number;
  wardOfficerDistribution: WardOperationsCoverageItem[];
  tasksTotal: number;
  tasksAssigned: number;
  tasksAcknowledged: number;
  tasksInProgress: number;
  tasksAwaitingReview: number;
  tasksRevisionRequired: number;
  tasksCompleted: number;
  tasksOverdue: number;
  incidentsTotal: number;
  incidentsByStatus: Record<IncidentStatus, number>;
  criticalActiveIncidents: number;
  verifiedResultsCount: number;
  unverifiedResultsCount: number;
  wardPerformance: WardPerformanceRow[];
}

export interface CompiledAutomaticReport {
  fdmisName: string;
  reportCategory: AutomaticReportCategory;
  reportTitle: string;
  reportingPeriodStartIso: string;
  reportingPeriodEndIso: string;
  reportingPeriodLabel: string;
  generatedAtIso: string;
  scopeLabel: string;
  dataStatus: string;
  dataCompletenessNotice: string;
  incompleteRecordsCount: number;
  unverifiedRecordsCount: number;
  summaryMetrics: Array<{ label: string; value: string | number }>;
  summaryMetricsMap: Record<string, number | string>;
  headers: string[];
  rows: (string | number)[][];
}

export function extractTimeMs(ts: FirestoreTime | string | undefined): number | null {
  if (!ts) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts.getTime();
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    const d = (ts as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (typeof (ts as { seconds?: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return null;
}

export function isWithinDateRange(
  ts: FirestoreTime | string | undefined,
  startDateIso: string,
  endDateIso: string
): boolean {
  if (!startDateIso && !endDateIso) return true;
  const ms = extractTimeMs(ts);
  if (ms === null) return false;
  if (startDateIso) {
    const startMs = Date.parse(`${startDateIso}T00:00:00.000Z`);
    if (!Number.isNaN(startMs) && ms < startMs) return false;
  }
  if (endDateIso) {
    const endMs = Date.parse(`${endDateIso}T23:59:59.999Z`);
    if (!Number.isNaN(endMs) && ms > endMs) return false;
  }
  return true;
}

export function formatReportingPeriod(startDateIso: string, endDateIso: string): string {
  if (startDateIso && endDateIso) {
    if (startDateIso === endDateIso) return startDateIso;
    return `${startDateIso} to ${endDateIso}`;
  }
  if (startDateIso) return `From ${startDateIso}`;
  if (endDateIso) return `Up to ${endDateIso}`;
  return 'All Recorded Operational Dates';
}

export function computeScopeLabel(
  filters: AnalyticsReportFilters,
  wards: Ward[],
  pollingUnits: PollingUnit[],
  users: UserAccount[]
): string {
  const parts: string[] = [];
  if (filters.lgaId === 'all') {
    parts.push('Funtua & Dandume LGAs');
  } else {
    parts.push(LGA_DEFINITIONS[filters.lgaId]?.displayName || filters.lgaId);
  }
  if (filters.wardId !== 'all') {
    const w = wards.find((x) => x.id === filters.wardId);
    parts.push(w ? `${w.name} Ward` : `Ward ${filters.wardId}`);
  }
  if (filters.puId !== 'all') {
    const p = pollingUnits.find((x) => x.id === filters.puId);
    parts.push(p ? `PU ${p.puCode}` : `PU ${filters.puId}`);
  }
  if (filters.officerUid !== 'all') {
    const o = users.find((x) => x.uid === filters.officerUid);
    parts.push(o ? `Officer: ${o.displayName}` : 'Selected Officer');
  }
  return parts.join(' · ');
}

export function computeAnalyticsDashboardMetrics(
  inputs: AnalyticsDatasetInputs,
  filters: Pick<
    AnalyticsReportFilters,
    'startDateIso' | 'endDateIso' | 'lgaId' | 'wardId' | 'puId' | 'officerUid'
  >,
  nowMs: number = Date.now()
): AnalyticsDashboardMetrics {
  const scopedWards = inputs.wards.filter(
    (w) =>
      (filters.lgaId === 'all' || w.lgaId === filters.lgaId) &&
      (filters.wardId === 'all' || w.id === filters.wardId)
  );
  const scopedWardIds = new Set(scopedWards.map((w) => w.id));

  const scopedPus = inputs.pollingUnits.filter(
    (p) =>
      (filters.lgaId === 'all' || p.lgaId === filters.lgaId) &&
      (filters.wardId === 'all' || p.wardId === filters.wardId) &&
      (filters.puId === 'all' || p.id === filters.puId)
  );

  const scopedAgents = inputs.users.filter((u) => {
    if (u.role !== UserRole.POLLING_UNIT_AGENT) return false;
    if (filters.lgaId !== 'all' && u.assignedLgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && u.assignedWardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && u.assignedPollingUnitId !== filters.puId) return false;
    return true;
  });

  const scopedOfficers = inputs.users.filter((u) => {
    if (u.role !== UserRole.OPERATIONS_OFFICER) return false;
    if (filters.lgaId !== 'all' && u.assignedLgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && u.assignedWardId !== filters.wardId) return false;
    if (filters.officerUid !== 'all' && u.uid !== filters.officerUid) return false;
    return true;
  });

  const scopedCheckIns = inputs.checkIns.filter((c) => {
    if (filters.lgaId !== 'all' && c.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && c.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && c.puId !== filters.puId) return false;
    if (filters.officerUid !== 'all' && c.agentUid !== filters.officerUid) return false;
    return isWithinDateRange(c.clientCreatedAtIso || c.createdAt, filters.startDateIso, filters.endDateIso);
  });

  const scopedIncidents = inputs.incidents.filter((i) => {
    if (filters.lgaId !== 'all' && i.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && i.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && i.puId !== filters.puId) return false;
    if (filters.officerUid !== 'all' && i.reporterUid !== filters.officerUid) return false;
    return isWithinDateRange(i.clientCreatedAtIso || i.createdAt, filters.startDateIso, filters.endDateIso);
  });

  const scopedResults = inputs.results.filter((r) => {
    if (filters.lgaId !== 'all' && r.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && r.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && r.puId !== filters.puId) return false;
    if (filters.officerUid !== 'all' && r.submittedByUid !== filters.officerUid) return false;
    return isWithinDateRange(
      r.clientCreatedAtIso || r.updatedAt || r.createdAt,
      filters.startDateIso,
      filters.endDateIso
    );
  });

  const canonicalApproved = getCanonicalApprovedPuResults(
    inputs.approvedPuResults,
    inputs.results
  ).filter((a) => {
    if (filters.lgaId !== 'all' && a.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && a.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && a.puId !== filters.puId) return false;
    return isWithinDateRange(a.approvedAt || a.updatedAt, filters.startDateIso, filters.endDateIso);
  });

  const scopedTasks = inputs.tasks.filter((t) => {
    if (filters.lgaId !== 'all' && t.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && t.wardId !== filters.wardId) return false;
    if (filters.officerUid !== 'all' && t.assignedOfficerUid !== filters.officerUid) return false;
    return isWithinDateRange(
      t.clientCreatedAtIso || t.createdAt || t.startDateIso,
      filters.startDateIso,
      filters.endDateIso
    );
  });

  const activeAgents = scopedAgents.filter(
    (a) => a.status === AccountStatus.ACTIVE && !a.sessionRevoked
  ).length;
  const inactiveAgents = scopedAgents.length - activeAgents;
  const checkedInAgentUids = new Set(scopedCheckIns.map((c) => c.agentUid));
  const checkedInAgents = scopedAgents.filter((a) => checkedInAgentUids.has(a.uid)).length;

  const reportingPollingUnits = scopedPus.filter((p) => isPuReporting(p.operationalStatus)).length;
  const nonReportingPollingUnits = Math.max(0, scopedPus.length - reportingPollingUnits);
  const reportingRatePercent =
    scopedPus.length > 0 ? Math.round((reportingPollingUnits / scopedPus.length) * 100) : 0;

  const wardOfficerDistribution = computeWardOperationsCoverage(
    scopedWards,
    inputs.users,
    MIN_OPERATIONS_OFFICERS_PER_WARD
  );
  const activeOperationsOfficers = scopedOfficers.filter(
    (o) => o.status === AccountStatus.ACTIVE && !o.sessionRevoked
  ).length;
  const compliantWardsCount = wardOfficerDistribution.filter((w) => w.isCompliant).length;
  const understaffedWardsCount = wardOfficerDistribution.length - compliantWardsCount;

  let tasksAssigned = 0;
  let tasksAcknowledged = 0;
  let tasksInProgress = 0;
  let tasksAwaitingReview = 0;
  let tasksRevisionRequired = 0;
  let tasksCompleted = 0;
  let tasksOverdue = 0;

  scopedTasks.forEach((t) => {
    const eff = getEffectiveTaskStatus(t, nowMs);
    if (eff === TaskStatus.ASSIGNED) tasksAssigned += 1;
    else if (eff === TaskStatus.ACKNOWLEDGED) tasksAcknowledged += 1;
    else if (eff === TaskStatus.IN_PROGRESS) tasksInProgress += 1;
    else if (eff === TaskStatus.AWAITING_REVIEW) tasksAwaitingReview += 1;
    else if (eff === TaskStatus.REVISION_REQUIRED) tasksRevisionRequired += 1;
    else if (eff === TaskStatus.APPROVED_COMPLETED) tasksCompleted += 1;
    else if (eff === TaskStatus.OVERDUE) tasksOverdue += 1;
  });

  const incidentsByStatus: Record<IncidentStatus, number> = {
    [IncidentStatus.NEW]: 0,
    [IncidentStatus.UNDER_REVIEW]: 0,
    [IncidentStatus.ESCALATED]: 0,
    [IncidentStatus.RESOLVED]: 0,
    [IncidentStatus.CLOSED]: 0,
  };
  let criticalActiveIncidents = 0;
  scopedIncidents.forEach((inc) => {
    incidentsByStatus[inc.status] = (incidentsByStatus[inc.status] || 0) + 1;
    if (inc.urgency === IncidentUrgency.CRITICAL && isIncidentActive(inc.status)) {
      criticalActiveIncidents += 1;
    }
  });

  const verifiedResultsCount = canonicalApproved.length;
  const unverifiedResultsCount = scopedResults.filter(
    (r) => r.verificationStatus !== VerificationStatus.VERIFIED
  ).length;

  const coverageByWard = new Map(wardOfficerDistribution.map((c) => [c.wardId, c]));

  const wardPerformance: WardPerformanceRow[] = scopedWards
    .filter((w) => scopedWardIds.has(w.id))
    .map((w) => {
      const wPus = scopedPus.filter((p) => p.wardId === w.id);
      const wReporting = wPus.filter((p) => isPuReporting(p.operationalStatus)).length;
      const wNonReporting = Math.max(0, wPus.length - wReporting);
      const wAgents = scopedAgents.filter((a) => a.assignedWardId === w.id);
      const wActiveAgents = wAgents.filter(
        (a) => a.status === AccountStatus.ACTIVE && !a.sessionRevoked
      ).length;
      const wCheckedInPus = new Set(
        scopedCheckIns.filter((c) => c.wardId === w.id).map((c) => c.puId)
      ).size;
      const cov = coverageByWard.get(w.id);
      const wTasks = scopedTasks.filter((t) => t.wardId === w.id);
      const wTasksCompleted = wTasks.filter(
        (t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.APPROVED_COMPLETED
      ).length;
      const wTasksOverdue = wTasks.filter(
        (t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.OVERDUE
      ).length;
      const wInc = scopedIncidents.filter((i) => i.wardId === w.id);
      const wActiveInc = wInc.filter((i) => isIncidentActive(i.status)).length;
      const wVerified = canonicalApproved.filter((a) => a.wardId === w.id).length;
      const wUnverified = scopedResults.filter(
        (r) => r.wardId === w.id && r.verificationStatus !== VerificationStatus.VERIFIED
      ).length;

      let completenessStatus: WardPerformanceRow['completenessStatus'] = 'COMPLETE';
      if (wUnverified > 0) completenessStatus = 'UNVERIFIED_PENDING';
      if (wPus.length === 0 || wNonReporting > 0 || (cov ? !cov.isCompliant : true)) {
        completenessStatus = 'INCOMPLETE_DATA';
      }

      return {
        wardId: w.id,
        wardName: w.name,
        wardCode: w.wardCode,
        lgaId: w.lgaId,
        lgaShortName: LGA_DEFINITIONS[w.lgaId]?.shortName || w.lgaId,
        totalPollingUnits: wPus.length,
        reportingPollingUnits: wReporting,
        nonReportingPollingUnits: wNonReporting,
        reportingRatePercent: wPus.length > 0 ? Math.round((wReporting / wPus.length) * 100) : 0,
        registeredAgents: wAgents.length,
        activeAgents: wActiveAgents,
        checkedInPollingUnits: wCheckedInPus,
        operationsOfficersCount: cov?.activeCount ?? 0,
        officerTarget: MIN_OPERATIONS_OFFICERS_PER_WARD,
        officersCompliant: Boolean(cov?.isCompliant),
        tasksAssigned: wTasks.length,
        tasksCompleted: wTasksCompleted,
        tasksOverdue: wTasksOverdue,
        incidentsTotal: wInc.length,
        activeIncidents: wActiveInc,
        verifiedResultsCount: wVerified,
        unverifiedResultsCount: wUnverified,
        completenessStatus,
      };
    })
    .sort((a, b) => a.lgaShortName.localeCompare(b.lgaShortName) || a.wardName.localeCompare(b.wardName));

  return {
    totalRegisteredAgents: scopedAgents.length,
    activeAgents,
    inactiveAgents,
    checkedInAgents,
    totalPollingUnits: scopedPus.length,
    reportingPollingUnits,
    nonReportingPollingUnits,
    reportingRatePercent,
    totalOperationsOfficers: scopedOfficers.length,
    activeOperationsOfficers,
    compliantWardsCount,
    understaffedWardsCount,
    wardOfficerDistribution,
    tasksTotal: scopedTasks.length,
    tasksAssigned,
    tasksAcknowledged,
    tasksInProgress,
    tasksAwaitingReview,
    tasksRevisionRequired,
    tasksCompleted,
    tasksOverdue,
    incidentsTotal: scopedIncidents.length,
    incidentsByStatus,
    criticalActiveIncidents,
    verifiedResultsCount,
    unverifiedResultsCount,
    wardPerformance,
  };
}

export function buildAutomaticReportData(
  inputs: AnalyticsDatasetInputs,
  filters: AnalyticsReportFilters,
  nowMs: number = Date.now()
): CompiledAutomaticReport {
  const metrics = computeAnalyticsDashboardMetrics(inputs, filters, nowMs);
  const scopeLabel = computeScopeLabel(filters, inputs.wards, inputs.pollingUnits, inputs.users);
  const generatedAtIso = new Date(nowMs).toISOString();
  const reportingPeriodLabel = formatReportingPeriod(filters.startDateIso, filters.endDateIso);
  const reportTitle = AUTOMATIC_REPORT_LABELS[filters.category];

  const scopedPus = inputs.pollingUnits.filter(
    (p) =>
      (filters.lgaId === 'all' || p.lgaId === filters.lgaId) &&
      (filters.wardId === 'all' || p.wardId === filters.wardId) &&
      (filters.puId === 'all' || p.id === filters.puId)
  );
  const scopedIncidents = inputs.incidents.filter((i) => {
    if (filters.lgaId !== 'all' && i.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && i.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && i.puId !== filters.puId) return false;
    if (filters.officerUid !== 'all' && i.reporterUid !== filters.officerUid) return false;
    return isWithinDateRange(i.clientCreatedAtIso || i.createdAt, filters.startDateIso, filters.endDateIso);
  });
  const scopedCheckIns = inputs.checkIns.filter((c) => {
    if (filters.lgaId !== 'all' && c.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && c.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && c.puId !== filters.puId) return false;
    if (filters.officerUid !== 'all' && c.agentUid !== filters.officerUid) return false;
    return isWithinDateRange(c.clientCreatedAtIso || c.createdAt, filters.startDateIso, filters.endDateIso);
  });
  const scopedResults = inputs.results.filter((r) => {
    if (filters.lgaId !== 'all' && r.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && r.wardId !== filters.wardId) return false;
    if (filters.puId !== 'all' && r.puId !== filters.puId) return false;
    if (filters.officerUid !== 'all' && r.submittedByUid !== filters.officerUid) return false;
    return isWithinDateRange(
      r.clientCreatedAtIso || r.updatedAt || r.createdAt,
      filters.startDateIso,
      filters.endDateIso
    );
  });
  const scopedTasks = inputs.tasks.filter((t) => {
    if (filters.lgaId !== 'all' && t.lgaId !== filters.lgaId) return false;
    if (filters.wardId !== 'all' && t.wardId !== filters.wardId) return false;
    if (filters.officerUid !== 'all' && t.assignedOfficerUid !== filters.officerUid) return false;
    return isWithinDateRange(
      t.clientCreatedAtIso || t.createdAt || t.startDateIso,
      filters.startDateIso,
      filters.endDateIso
    );
  });

  const wardNameMap = new Map(inputs.wards.map((w) => [w.id, w.name]));
  const puById = new Map(inputs.pollingUnits.map((p) => [p.id, p]));

  const incompleteRecordsCount =
    metrics.nonReportingPollingUnits + metrics.understaffedWardsCount;
  const unverifiedRecordsCount = metrics.unverifiedResultsCount;

  const completenessWarnings: string[] = [];
  if (metrics.nonReportingPollingUnits > 0) {
    completenessWarnings.push(
      `${metrics.nonReportingPollingUnits} of ${metrics.totalPollingUnits} polling unit(s) have not yet reported.`
    );
  }
  if (metrics.unverifiedResultsCount > 0) {
    completenessWarnings.push(
      `${metrics.unverifiedResultsCount} result submission(s) remain unverified and are excluded from verified tallies.`
    );
  }
  if (metrics.understaffedWardsCount > 0) {
    completenessWarnings.push(
      `${metrics.understaffedWardsCount} ward(s) have fewer than ${MIN_OPERATIONS_OFFICERS_PER_WARD} active Operations Officers.`
    );
  }
  if (metrics.tasksOverdue > 0) {
    completenessWarnings.push(`${metrics.tasksOverdue} assigned field task(s) are overdue.`);
  }

  const dataCompletenessNotice =
    completenessWarnings.length > 0
      ? `Incomplete / Pending Data Identified: ${completenessWarnings.join(' ')} Missing records are shown as actual zero counts; no estimates are generated.`
      : 'All scoped records verified and complete within the active operational database.';

  let headers: string[] = [];
  let rows: (string | number)[][] = [];
  let summaryMetrics: Array<{ label: string; value: string | number }> = [];
  let dataStatus = 'Live Database Compilation';

  if (filters.category === 'DAILY_SITUATION') {
    headers = [
      'Ward',
      'LGA',
      'Reporting PUs',
      'Non-Reporting PUs',
      'Check-Ins',
      'Ops Officers (/5)',
      'Tasks Completed / Total',
      'Overdue Tasks',
      'Active Incidents',
      'Verified Results',
      'Unverified Results',
      'Data Completeness',
    ];
    rows = metrics.wardPerformance.map((wp) => [
      wp.wardName,
      wp.lgaShortName,
      `${wp.reportingPollingUnits} / ${wp.totalPollingUnits}`,
      wp.nonReportingPollingUnits,
      wp.checkedInPollingUnits,
      `${wp.operationsOfficersCount} / ${wp.officerTarget}`,
      `${wp.tasksCompleted} / ${wp.tasksAssigned}`,
      wp.tasksOverdue,
      wp.activeIncidents,
      wp.verifiedResultsCount,
      wp.unverifiedResultsCount,
      wp.completenessStatus === 'COMPLETE'
        ? 'Complete'
        : wp.completenessStatus === 'UNVERIFIED_PENDING'
          ? 'Unverified Reports Pending'
          : 'Incomplete Data',
    ]);
    summaryMetrics = [
      { label: 'Reporting Polling Units', value: `${metrics.reportingPollingUnits} / ${metrics.totalPollingUnits} (${metrics.reportingRatePercent}%)` },
      { label: 'Active Agents / Registered', value: `${metrics.activeAgents} / ${metrics.totalRegisteredAgents}` },
      { label: 'Active Ops Officers', value: metrics.activeOperationsOfficers },
      { label: 'Compliant Wards (>=5 Officers)', value: `${metrics.compliantWardsCount} / ${metrics.wardOfficerDistribution.length}` },
      { label: 'Tasks Completed / Overdue', value: `${metrics.tasksCompleted} completed · ${metrics.tasksOverdue} overdue` },
      { label: 'Active Incidents (Critical)', value: `${metrics.incidentsTotal - metrics.incidentsByStatus.RESOLVED - metrics.incidentsByStatus.CLOSED} (${metrics.criticalActiveIncidents} critical)` },
      { label: 'Verified / Unverified Results', value: `${metrics.verifiedResultsCount} verified · ${metrics.unverifiedResultsCount} unverified` },
    ];
    dataStatus =
      incompleteRecordsCount > 0 || unverifiedRecordsCount > 0
        ? 'Automatic Daily Compilation — Incomplete/Unverified Items Flagged'
        : 'Automatic Daily Compilation — Complete';
  } else if (filters.category === 'WARD_PERFORMANCE') {
    headers = [
      'Ward Code',
      'Ward Name',
      'LGA',
      'Total PUs',
      'Reporting PUs',
      'Reporting %',
      'Active Agents',
      'Ops Officers',
      'Staffing Compliance',
      'Tasks Done / Total',
      'Overdue Tasks',
      'Active Incidents',
      'Verified Results',
      'Unverified Results',
    ];
    rows = metrics.wardPerformance.map((wp) => [
      wp.wardCode,
      wp.wardName,
      wp.lgaShortName,
      wp.totalPollingUnits,
      wp.reportingPollingUnits,
      `${wp.reportingRatePercent}%`,
      `${wp.activeAgents} / ${wp.registeredAgents}`,
      `${wp.operationsOfficersCount} / ${wp.officerTarget}`,
      wp.officersCompliant ? 'Compliant' : `Shortfall (-${wp.officerTarget - wp.operationsOfficersCount})`,
      `${wp.tasksCompleted} / ${wp.tasksAssigned}`,
      wp.tasksOverdue,
      wp.activeIncidents,
      wp.verifiedResultsCount,
      wp.unverifiedResultsCount,
    ]);
    summaryMetrics = [
      { label: 'Wards Evaluated', value: metrics.wardPerformance.length },
      { label: 'Compliant Wards (>=5 Officers)', value: metrics.compliantWardsCount },
      { label: 'Understaffed Wards (<5)', value: metrics.understaffedWardsCount },
      { label: 'Overall PU Reporting Rate', value: `${metrics.reportingRatePercent}%` },
    ];
    dataStatus = `${rows.length} Ward(s) Evaluated from Live Records`;
  } else if (filters.category === 'LGA_SUMMARY') {
    const targetLgas: LgaId[] =
      filters.lgaId === 'all' ? ['funtua', 'dandume'] : [filters.lgaId];
    headers = [
      'LGA',
      'LGA Code',
      'Wards',
      'Compliant Wards (>=5 Ops)',
      'Total PUs',
      'Reporting PUs',
      'Non-Reporting PUs',
      'Active Agents',
      'Active Ops Officers',
      'Tasks Assigned',
      'Tasks Completed',
      'Tasks Overdue',
      'Total Incidents',
      'Verified Results',
      'Unverified Results',
    ];
    rows = targetLgas.map((lga) => {
      const m = computeAnalyticsDashboardMetrics(
        inputs,
        { ...filters, lgaId: lga, wardId: 'all', puId: 'all' },
        nowMs
      );
      return [
        LGA_DEFINITIONS[lga].displayName,
        LGA_DEFINITIONS[lga].lgaCode,
        m.wardPerformance.length,
        `${m.compliantWardsCount} / ${m.wardOfficerDistribution.length}`,
        m.totalPollingUnits,
        m.reportingPollingUnits,
        m.nonReportingPollingUnits,
        `${m.activeAgents} / ${m.totalRegisteredAgents}`,
        m.activeOperationsOfficers,
        m.tasksTotal,
        m.tasksCompleted,
        m.tasksOverdue,
        m.incidentsTotal,
        m.verifiedResultsCount,
        m.unverifiedResultsCount,
      ];
    });
    summaryMetrics = [
      { label: 'Total Polling Units', value: metrics.totalPollingUnits },
      { label: 'Reporting / Non-Reporting PUs', value: `${metrics.reportingPollingUnits} / ${metrics.nonReportingPollingUnits}` },
      { label: 'Active Ops Officers', value: metrics.activeOperationsOfficers },
      { label: 'Verified / Unverified Results', value: `${metrics.verifiedResultsCount} / ${metrics.unverifiedResultsCount}` },
    ];
    dataStatus = `${rows.length} LGA Summary Row(s) Compiled`;
  } else if (filters.category === 'ELECTION_INCIDENT') {
    headers = [
      'PU Code',
      'Polling Unit',
      'Ward',
      'LGA',
      'Category',
      'Title',
      'Urgency',
      'Status',
      'Reported By',
      'Escalated To',
      'Original Timestamp',
      'Server Synced',
    ];
    rows = scopedIncidents.map((inc) => [
      inc.puCode,
      inc.puName,
      wardNameMap.get(inc.wardId) || inc.wardId,
      LGA_DEFINITIONS[inc.lgaId]?.shortName || inc.lgaId,
      inc.category,
      inc.title,
      inc.urgency,
      inc.status,
      inc.reporterName,
      inc.escalatedTo || '-',
      formatFirestoreTime(inc.clientCreatedAtIso || inc.createdAt),
      formatFirestoreTime(inc.serverSyncedAt || inc.createdAt),
    ]);
    summaryMetrics = [
      { label: 'Total Incidents', value: metrics.incidentsTotal },
      { label: 'New / Under Review', value: `${metrics.incidentsByStatus.NEW} / ${metrics.incidentsByStatus.UNDER_REVIEW}` },
      { label: 'Escalated', value: metrics.incidentsByStatus.ESCALATED },
      { label: 'Resolved / Closed', value: metrics.incidentsByStatus.RESOLVED + metrics.incidentsByStatus.CLOSED },
      { label: 'Active Critical Incidents', value: metrics.criticalActiveIncidents },
    ];
    dataStatus = rows.length === 0 ? 'No Incidents Recorded in Filter Window' : `${rows.length} Incident Record(s)`;
  } else if (filters.category === 'AGENT_ACTIVITY') {
    const scopedAgents = inputs.users.filter((u) => {
      if (u.role !== UserRole.POLLING_UNIT_AGENT) return false;
      if (filters.lgaId !== 'all' && u.assignedLgaId !== filters.lgaId) return false;
      if (filters.wardId !== 'all' && u.assignedWardId !== filters.wardId) return false;
      if (filters.puId !== 'all' && u.assignedPollingUnitId !== filters.puId) return false;
      return true;
    });
    const latestCheckInByAgent = new Map<string, AgentCheckIn>();
    scopedCheckIns.forEach((c) => {
      if (!latestCheckInByAgent.has(c.agentUid)) latestCheckInByAgent.set(c.agentUid, c);
    });
    headers = [
      'Agent Name',
      'Account Status',
      'LGA',
      'Ward',
      'Assigned PU',
      'PU Status',
      'Check-Ins',
      'Last Arrival / Network',
      'Results Submitted',
      'Battery',
    ];
    rows = scopedAgents.map((agent) => {
      const pu = puById.get(agent.assignedPollingUnitId);
      const chkCount = scopedCheckIns.filter((c) => c.agentUid === agent.uid).length;
      const latestChk = latestCheckInByAgent.get(agent.uid);
      const resCount = scopedResults.filter((r) => r.submittedByUid === agent.uid).length;
      const statusLabel =
        agent.status === AccountStatus.ACTIVE && !agent.sessionRevoked
          ? 'Active'
          : agent.status === AccountStatus.SUSPENDED || agent.sessionRevoked
            ? 'Inactive / Suspended'
            : 'Pending Approval';
      return [
        agent.displayName,
        statusLabel,
        LGA_DEFINITIONS[agent.assignedLgaId as LgaId]?.shortName || agent.assignedLgaId || 'Unassigned',
        wardNameMap.get(agent.assignedWardId) || agent.assignedWardId || 'Unassigned',
        pu ? `${pu.puCode} — ${pu.name}` : 'Unassigned',
        pu ? PU_STATUS_META[pu.operationalStatus]?.label || pu.operationalStatus : 'No PU',
        chkCount,
        latestChk ? `${latestChk.arrivalTimeText} (${latestChk.networkStatus})` : 'No Check-In',
        resCount,
        typeof agent.batteryLevel === 'number'
          ? `${agent.batteryLevel}%${agent.batteryCharging ? ' (Charging)' : ''}`
          : 'Not Reported',
      ];
    });
    summaryMetrics = [
      { label: 'Total Registered Agents', value: metrics.totalRegisteredAgents },
      { label: 'Active Agents', value: metrics.activeAgents },
      { label: 'Inactive / Pending Agents', value: metrics.inactiveAgents },
      { label: 'Agents Checked In (Period)', value: metrics.checkedInAgents },
      { label: 'Scoped Polling Units', value: scopedPus.length },
    ];
    dataStatus = rows.length === 0 ? 'No Registered Agents in Scope' : `${rows.length} Agent Record(s)`;
  } else if (filters.category === 'OFFICER_PERFORMANCE') {
    const scopedOfficers = inputs.users.filter((u) => {
      if (u.role !== UserRole.OPERATIONS_OFFICER) return false;
      if (filters.lgaId !== 'all' && u.assignedLgaId !== filters.lgaId) return false;
      if (filters.wardId !== 'all' && u.assignedWardId !== filters.wardId) return false;
      if (filters.officerUid !== 'all' && u.uid !== filters.officerUid) return false;
      return true;
    });
    headers = [
      'Operations Officer',
      'Status',
      'LGA',
      'Assigned Ward',
      'Tasks Assigned',
      'Completed',
      'Awaiting Review',
      'Revision Required',
      'Overdue',
      'Completion Rate',
      'Incidents Filed',
      'Field Notes',
      'Battery',
    ];
    rows = scopedOfficers.map((off) => {
      const oTasks = scopedTasks.filter((t) => t.assignedOfficerUid === off.uid);
      const completed = oTasks.filter(
        (t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.APPROVED_COMPLETED
      ).length;
      const awaiting = oTasks.filter(
        (t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.AWAITING_REVIEW
      ).length;
      const revReq = oTasks.filter(
        (t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.REVISION_REQUIRED
      ).length;
      const overdue = oTasks.filter(
        (t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.OVERDUE
      ).length;
      const rate = oTasks.length > 0 ? `${Math.round((completed / oTasks.length) * 100)}%` : 'N/A';
      const incCount = scopedIncidents.filter((i) => i.reporterUid === off.uid).length;
      const noteCount = inputs.notes.filter(
        (n) =>
          n.authorUid === off.uid &&
          isWithinDateRange(n.clientCreatedAtIso || n.createdAt, filters.startDateIso, filters.endDateIso)
      ).length;
      return [
        off.displayName,
        off.status === AccountStatus.ACTIVE && !off.sessionRevoked ? 'Active' : off.status,
        LGA_DEFINITIONS[off.assignedLgaId as LgaId]?.shortName || off.assignedLgaId || '-',
        wardNameMap.get(off.assignedWardId) || off.assignedWardId || 'Unassigned',
        oTasks.length,
        completed,
        awaiting,
        revReq,
        overdue,
        rate,
        incCount,
        noteCount,
        typeof off.batteryLevel === 'number'
          ? `${off.batteryLevel}%${off.batteryCharging ? ' (Charging)' : ''}`
          : 'Not Reported',
      ];
    });
    summaryMetrics = [
      { label: 'Registered Operations Officers', value: metrics.totalOperationsOfficers },
      { label: 'Active Officers', value: metrics.activeOperationsOfficers },
      { label: 'Compliant Wards (>=5)', value: `${metrics.compliantWardsCount} / ${metrics.wardOfficerDistribution.length}` },
      { label: 'Tasks Completed / Total', value: `${metrics.tasksCompleted} / ${metrics.tasksTotal}` },
    ];
    dataStatus = rows.length === 0 ? 'No Operations Officers in Scope' : `${rows.length} Officer Performance Record(s)`;
  } else {
    // TASK_COMPLETION
    headers = [
      'Task Title',
      'LGA',
      'Ward',
      'Assigned Officer',
      'Priority',
      'Effective Status',
      'Progress %',
      'Start Date',
      'Deadline',
      'Delay / Challenges',
      'Admin Review Feedback',
      'Assigned By',
    ];
    rows = scopedTasks.map((t) => {
      const eff = getEffectiveTaskStatus(t, nowMs);
      return [
        t.title,
        LGA_DEFINITIONS[t.lgaId]?.shortName || t.lgaId,
        t.wardName,
        t.assignedOfficerName,
        TASK_PRIORITY_META[t.priority]?.label || t.priority,
        TASK_STATUS_META[eff]?.label || eff,
        `${t.progressPercent}%`,
        t.startDateIso,
        t.dueDateIso,
        t.delayReason || '-',
        t.adminFeedback || '-',
        t.assignedByName,
      ];
    });
    summaryMetrics = [
      { label: 'Total Tasks', value: metrics.tasksTotal },
      { label: 'Approved / Completed', value: metrics.tasksCompleted },
      { label: 'Awaiting Review', value: metrics.tasksAwaitingReview },
      { label: 'In Progress / Acknowledged', value: metrics.tasksInProgress + metrics.tasksAcknowledged },
      { label: 'Revision Required', value: metrics.tasksRevisionRequired },
      { label: 'Overdue Tasks', value: metrics.tasksOverdue },
    ];
    dataStatus = rows.length === 0 ? 'No Tasks Assigned in Scope' : `${rows.length} Operational Task Record(s)`;
  }

  const summaryMetricsMap: Record<string, number | string> = {};
  summaryMetrics.forEach((m) => {
    summaryMetricsMap[m.label] = m.value;
  });

  return {
    fdmisName: FDMIS_OFFICIAL_NAME,
    reportCategory: filters.category,
    reportTitle,
    reportingPeriodStartIso: filters.startDateIso,
    reportingPeriodEndIso: filters.endDateIso,
    reportingPeriodLabel,
    generatedAtIso,
    scopeLabel,
    dataStatus,
    dataCompletenessNotice,
    incompleteRecordsCount,
    unverifiedRecordsCount,
    summaryMetrics,
    summaryMetricsMap,
    headers,
    rows,
  };
}
