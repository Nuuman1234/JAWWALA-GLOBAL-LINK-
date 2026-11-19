import {
  AUTOMATIC_REPORT_LABELS,
  AccountStatus,
  INCIDENT_STATUS_META,
  IncidentStatus,
  IncidentUrgency,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  PU_STATUS_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TaskStatus,
  UserRole,
  VERIFICATION_STATUS_META,
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
  type OfflineQueuedItem,
  type OperationalNote,
  type OperationalTask,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { getCanonicalApprovedPuResults } from './aggregationEngine';

export interface WardOperationsCoverageSummary {
  wardId: string;
  wardName: string;
  wardCode: string;
  lgaId: LgaId;
  activeCount: number;
  totalAssignedCount: number;
  minRequired: number;
  shortfall: number;
  isCompliant: boolean;
}

function computePureWardOperationsCoverage(
  wards: Ward[],
  users: UserAccount[],
  minRequired: number = MIN_OPERATIONS_OFFICERS_PER_WARD
): WardOperationsCoverageSummary[] {
  const officers = users.filter((u) => u.role === UserRole.OPERATIONS_OFFICER);
  return wards
    .map((w) => {
      const assigned = officers.filter((o) => o.assignedWardId === w.id);
      const activeCount = assigned.filter(
        (o) => o.status === AccountStatus.ACTIVE && !o.sessionRevoked
      ).length;
      const shortfall = Math.max(0, minRequired - activeCount);
      return {
        wardId: w.id,
        wardName: w.name,
        wardCode: w.wardCode,
        lgaId: w.lgaId,
        activeCount,
        totalAssignedCount: assigned.length,
        minRequired,
        shortfall,
        isCompliant: activeCount >= minRequired,
      };
    })
    .sort((a, b) => a.lgaId.localeCompare(b.lgaId) || a.wardName.localeCompare(b.wardName));
}

export const FDMIS_OFFICIAL_NAME = 'Funtua–Dandume Mandate Intelligence System (FDMIS)';

export interface AnalyticsReportFilters {
  startDateIso: string; // 'YYYY-MM-DD' or ''
  endDateIso: string; // 'YYYY-MM-DD' or ''
  lgaId: 'all' | LgaId;
  wardId: 'all' | string;
  puId: 'all' | string;
  officerUid: 'all' | string;
  incidentCategory?: 'all' | string;
  submissionStatus?: 'all' | string;
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
  queuedItems?: OfflineQueuedItem[];
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
  wardOfficerDistribution: WardOperationsCoverageSummary[];
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

  const wardOfficerDistribution = computePureWardOperationsCoverage(
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
    [IncidentStatus.DRAFT]: 0,
    [IncidentStatus.NEW]: 0,
    [IncidentStatus.SUBMITTED]: 0,
    [IncidentStatus.PENDING_REVIEW]: 0,
    [IncidentStatus.UNDER_REVIEW]: 0,
    [IncidentStatus.UNDER_INVESTIGATION]: 0,
    [IncidentStatus.VERIFIED]: 0,
    [IncidentStatus.UNVERIFIED]: 0,
    [IncidentStatus.REJECTED]: 0,
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
    const filteredIncidents = scopedIncidents.filter((inc) => {
      if (
        filters.incidentCategory &&
        filters.incidentCategory !== 'all' &&
        inc.category !== filters.incidentCategory
      ) {
        return false;
      }
      if (
        filters.submissionStatus &&
        filters.submissionStatus !== 'all' &&
        inc.status !== filters.submissionStatus
      ) {
        return false;
      }
      return true;
    });
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
    rows = filteredIncidents.map((inc) => [
      inc.puCode,
      inc.puName,
      wardNameMap.get(inc.wardId) || inc.wardId,
      LGA_DEFINITIONS[inc.lgaId]?.shortName || inc.lgaId,
      inc.category,
      inc.title,
      inc.urgency,
      INCIDENT_STATUS_META[inc.status]?.label || inc.status,
      inc.protectReporterIdentity ? 'Protected Reporter' : inc.reporterName,
      inc.escalatedTo || 'Not yet escalated',
      formatFirestoreTime(inc.clientCreatedAtIso || inc.createdAt),
      formatFirestoreTime(inc.serverSyncedAt || inc.createdAt),
    ]);
    summaryMetrics = [
      { label: 'Total Matching Incidents', value: filteredIncidents.length },
      { label: 'Verified Incidents', value: filteredIncidents.filter((i) => i.status === IncidentStatus.VERIFIED).length },
      { label: 'Escalated', value: filteredIncidents.filter((i) => i.status === IncidentStatus.ESCALATED).length },
      { label: 'Resolved / Closed', value: filteredIncidents.filter((i) => i.status === IncidentStatus.RESOLVED || i.status === IncidentStatus.CLOSED).length },
      { label: 'Active Critical Incidents', value: filteredIncidents.filter((i) => i.urgency === IncidentUrgency.CRITICAL && isIncidentActive(i.status)).length },
    ];
    dataStatus = rows.length === 0 ? 'No Incidents Recorded in Filter Window' : `${rows.length} Incident Record(s)`;
  } else if (filters.category === 'PU_COVERAGE') {
    const checkInByPu = new Map<string, AgentCheckIn>();
    scopedCheckIns.forEach((c) => {
      if (!checkInByPu.has(c.puId)) checkInByPu.set(c.puId, c);
    });
    const resultByPu = new Map<string, ResultSubmission>();
    scopedResults.forEach((r) => {
      if (!resultByPu.has(r.puId)) resultByPu.set(r.puId, r);
    });
    headers = [
      'PU Code',
      'Polling Unit',
      'Ward',
      'LGA',
      'Assigned Agent',
      'Operational Status',
      'GPS Coordinates',
      'Latest Check-In',
      'Result Status',
    ];
    rows = scopedPus.map((pu) => {
      const chk = checkInByPu.get(pu.id);
      const res = resultByPu.get(pu.id);
      return [
        pu.puCode,
        pu.name,
        pu.wardName,
        LGA_DEFINITIONS[pu.lgaId]?.shortName || pu.lgaId,
        pu.assignedAgentName || 'Unassigned',
        PU_STATUS_META[pu.operationalStatus]?.label || pu.operationalStatus,
        pu.coordinatesVerified && typeof pu.latitude === 'number' && typeof pu.longitude === 'number'
          ? `${pu.latitude.toFixed(5)}, ${pu.longitude.toFixed(5)}`
          : 'Data unavailable',
        chk ? `${chk.arrivalTimeText} (${chk.agentName})` : 'Not yet reported',
        res ? VERIFICATION_STATUS_META[res.verificationStatus]?.label || res.verificationStatus : 'Not yet reported',
      ];
    });
    const assignedCount = scopedPus.filter((p) => Boolean(p.assignedAgentUid)).length;
    const verifiedCoordCount = scopedPus.filter(
      (p) => p.coordinatesVerified && typeof p.latitude === 'number' && typeof p.longitude === 'number'
    ).length;
    summaryMetrics = [
      { label: 'Official Polling Units in Scope', value: scopedPus.length },
      { label: 'Assigned / Unassigned PUs', value: `${assignedCount} / ${scopedPus.length - assignedCount}` },
      { label: 'Reporting Polling Units', value: `${metrics.reportingPollingUnits} (${metrics.reportingRatePercent}%)` },
      { label: 'Verified GPS Coordinates', value: `${verifiedCoordCount} / ${scopedPus.length}` },
    ];
    dataStatus = `${rows.length} Polling Unit Coverage Record(s)`;
  } else if (filters.category === 'FIELD_CHECKIN') {
    headers = [
      'PU Code',
      'Polling Unit',
      'Ward',
      'LGA',
      'Officer / Agent',
      'Arrival Time',
      'GPS Coordinates',
      'Accuracy (m)',
      'Location Exception',
      'Network / Battery',
      'Device Ref',
      'Device Timestamp',
    ];
    rows = scopedCheckIns.map((chk) => [
      chk.puCode,
      chk.puName,
      wardNameMap.get(chk.wardId) || chk.wardId,
      LGA_DEFINITIONS[chk.lgaId]?.shortName || chk.lgaId,
      chk.agentName,
      chk.arrivalTimeText,
      typeof chk.latitude === 'number' && typeof chk.longitude === 'number'
        ? `${chk.latitude.toFixed(5)}, ${chk.longitude.toFixed(5)}`
        : 'Data unavailable',
      typeof chk.gpsAccuracyMeters === 'number' ? `${Math.round(chk.gpsAccuracyMeters)} m` : 'Data unavailable',
      chk.locationExceptionFlag
        ? `Flagged (${chk.locationExceptionDistanceMeters ?? '?'}m · ${chk.exceptionReviewStatus || 'PENDING_REVIEW'})`
        : 'Normal',
      `${chk.networkStatus} · ${chk.batteryPercent >= 0 ? `${chk.batteryPercent}%` : 'N/A'}`,
      chk.deviceId || 'Not recorded',
      formatFirestoreTime(chk.clientCreatedAtIso || chk.createdAt),
    ]);
    const gpsCount = scopedCheckIns.filter((c) => typeof c.latitude === 'number').length;
    const flaggedCount = scopedCheckIns.filter((c) => Boolean(c.locationExceptionFlag)).length;
    summaryMetrics = [
      { label: 'Total Check-Ins (Period)', value: scopedCheckIns.length },
      { label: 'Unique Polling Units Checked In', value: new Set(scopedCheckIns.map((c) => c.puId)).size },
      { label: 'GPS-Captured Check-Ins', value: gpsCount },
      { label: 'Location Exceptions Flagged', value: flaggedCount },
    ];
    dataStatus = rows.length === 0 ? 'No Field Check-Ins Recorded' : `${rows.length} Check-In Record(s)`;
  } else if (filters.category === 'RESULTS_SUBMISSION_STATUS') {
    const filteredResults = scopedResults.filter((r) => {
      if (
        filters.submissionStatus &&
        filters.submissionStatus !== 'all' &&
        r.verificationStatus !== filters.submissionStatus
      ) {
        return false;
      }
      return true;
    });
    headers = [
      'PU Code',
      'Polling Unit',
      'Ward',
      'LGA',
      'Election Category',
      'Verification Status',
      'Valid / Cast',
      'APC / PDP / ADC / OTH',
      'EC8A Sheet',
      'Discrepancy Flag',
      'Submitted By',
      'Reviewed By',
    ];
    rows = filteredResults.map((r) => [
      r.puCode,
      r.puName,
      r.wardName,
      LGA_DEFINITIONS[r.lgaId]?.shortName || r.lgaId,
      r.electionCategory || 'House of Representatives',
      VERIFICATION_STATUS_META[r.verificationStatus]?.label || r.verificationStatus,
      `${r.validVotes} / ${r.totalVotesCast}`,
      `${r.apcVotes ?? 0} / ${r.pdpVotes ?? 0} / ${r.adcVotes ?? 0} / ${r.othersVotes ?? 0}`,
      r.ec8aImageBase64 ? 'Attached' : 'Not attached',
      r.discrepancyFlag ? r.discrepancySummary || 'Flagged' : 'Clear',
      r.submittedByName,
      r.reviewedByName || 'Pending review',
    ]);
    summaryMetrics = [
      { label: 'Total Submissions in Scope', value: filteredResults.length },
      { label: 'FDMIS Verified', value: filteredResults.filter((r) => r.verificationStatus === VerificationStatus.VERIFIED).length },
      { label: 'Pending Verification / Under Review', value: filteredResults.filter((r) => r.verificationStatus === VerificationStatus.SUBMITTED || r.verificationStatus === VerificationStatus.PENDING_VERIFICATION || r.verificationStatus === VerificationStatus.UNDER_REVIEW).length },
      { label: 'Discrepancy / Correction Required', value: filteredResults.filter((r) => r.verificationStatus === VerificationStatus.DISCREPANCY_DETECTED || r.verificationStatus === VerificationStatus.REQUIRES_CORRECTION || Boolean(r.discrepancyFlag)).length },
    ];
    dataStatus = rows.length === 0 ? 'No Result Submissions in Scope' : `${rows.length} Result Submission Record(s)`;
  } else if (filters.category === 'DATA_SYNCHRONIZATION') {
    const queue = inputs.queuedItems || [];
    headers = [
      'Submission ID',
      'Record Type',
      'PU / Scope',
      'Summary',
      'Sync Status',
      'Retry Count',
      'Conflict State',
      'Created Offline At',
      'Error / Note',
    ];
    rows = queue.map((q) => [
      q.clientSubmissionId,
      q.reportType,
      q.puCode || q.lgaId,
      q.summary,
      q.status,
      q.retryCount ?? 0,
      q.conflictState || 'NONE',
      formatFirestoreTime(q.createdAtIso),
      q.errorMessage || '-',
    ]);
    const pending = queue.filter((q) => q.status === 'PENDING_SYNC' || q.status === 'SAVED_LOCALLY').length;
    const failed = queue.filter((q) => q.status === 'SYNC_FAILED').length;
    const synced = queue.filter((q) => q.status === 'SYNCED').length;
    summaryMetrics = [
      { label: 'Total Tracked Queue Items', value: queue.length },
      { label: 'Pending Offline Uploads', value: pending },
      { label: 'Failed Uploads Requiring Retry', value: failed },
      { label: 'Successfully Synced Items', value: synced },
    ];
    dataStatus = queue.length === 0 ? 'All Local Records Synchronized (Queue Empty)' : `${queue.length} Synchronization Record(s)`;
  } else if (filters.category === 'OUTSTANDING_ACTIONS') {
    const actionRows: (string | number)[][] = [];
    metrics.wardOfficerDistribution
      .filter((w) => !w.isCompliant)
      .forEach((w) => {
        actionRows.push([
          'Staffing Gap',
          `${w.wardName} (${LGA_DEFINITIONS[w.lgaId]?.shortName || w.lgaId})`,
          'HIGH',
          `Shortfall of ${w.shortfall} Operations Officer(s) (${w.activeCount}/${w.minRequired})`,
          'Admin / LGA Super Admin',
        ]);
      });
    scopedTasks
      .filter((t) => getEffectiveTaskStatus(t, nowMs) === TaskStatus.OVERDUE || t.status === TaskStatus.AWAITING_REVIEW)
      .forEach((t) => {
        const eff = getEffectiveTaskStatus(t, nowMs);
        actionRows.push([
          eff === TaskStatus.OVERDUE ? 'Overdue Task' : 'Task Review Pending',
          `${t.wardName} · ${t.title}`,
          t.priority,
          `Assigned to ${t.assignedOfficerName} · Due ${t.dueDateIso}`,
          eff === TaskStatus.OVERDUE ? t.assignedOfficerName : 'Full Control Admin',
        ]);
      });
    scopedIncidents
      .filter((i) => isIncidentActive(i.status))
      .forEach((i) => {
        actionRows.push([
          'Unresolved Incident',
          `${i.puCode} · ${i.title}`,
          i.urgency,
          `${i.category} (${INCIDENT_STATUS_META[i.status]?.label || i.status})`,
          i.escalatedTo || 'Situation Room Reviewer',
        ]);
      });
    scopedResults
      .filter(
        (r) =>
          r.verificationStatus === VerificationStatus.SUBMITTED ||
          r.verificationStatus === VerificationStatus.UNDER_REVIEW ||
          r.verificationStatus === VerificationStatus.DISCREPANCY_DETECTED ||
          r.verificationStatus === VerificationStatus.REQUIRES_CORRECTION
      )
      .forEach((r) => {
        actionRows.push([
          'Result Verification Pending',
          `${r.puCode} · ${r.puName}`,
          r.discrepancyFlag ? 'CRITICAL' : 'MEDIUM',
          `Status: ${VERIFICATION_STATUS_META[r.verificationStatus]?.label || r.verificationStatus}`,
          'Verification Officer / Admin',
        ]);
      });

    headers = ['Action Type', 'Location / Subject', 'Priority', 'Details', 'Responsible Role'];
    rows = actionRows;
    summaryMetrics = [
      { label: 'Total Outstanding Actions', value: actionRows.length },
      { label: 'Understaffed Wards (<5 Ops)', value: metrics.understaffedWardsCount },
      { label: 'Overdue Tasks', value: metrics.tasksOverdue },
      { label: 'Unresolved Incidents', value: scopedIncidents.filter((i) => isIncidentActive(i.status)).length },
      { label: 'Pending Result Verifications', value: metrics.unverifiedResultsCount },
    ];
    dataStatus =
      actionRows.length === 0
        ? 'No Outstanding Operational Actions Detected'
        : `${actionRows.length} Outstanding Action Item(s) Requiring Attention`;
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
        latestChk ? `${latestChk.arrivalTimeText} (${latestChk.networkStatus})` : 'Not yet reported',
        resCount,
        typeof agent.batteryLevel === 'number'
          ? `${agent.batteryLevel}%${agent.batteryCharging ? ' (Charging)' : ''}`
          : 'Data unavailable',
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
      const rate = oTasks.length > 0 ? `${Math.round((completed / oTasks.length) * 100)}%` : 'Data unavailable';
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
          : 'Data unavailable',
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
        t.delayReason || 'None reported',
        t.adminFeedback || 'Pending',
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
