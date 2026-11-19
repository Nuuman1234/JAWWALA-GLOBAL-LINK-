import {
  AlertTriangle,
  Bell,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Database,
  FileBarChart2,
  FileCheck2,
  Flag,
  Globe,
  ListTodo,
  MapPin,
  PhoneCall,
  Radio,
  Settings,
  ShieldAlert,
  StickyNote,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  AccountStatus,
  IncidentUrgency,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  PU_STATUS_META,
  TaskStatus,
  UserRole,
  VerificationStatus,
  getEffectiveTaskStatus,
  isIncidentActive,
  isPuReporting,
  type AgentCheckIn,
  type ApprovedPuResult,
  type AuditLog,
  type EmergencyContact,
  type FirestoreTime,
  type GeneratedReportRecord,
  type IncidentReport,
  type LgaId,
  type NotificationItem,
  type OperationalNote,
  type OperationalTask,
  type PartyCode,
  type PartyConfig,
  type PollingUnit,
  type PublicVerifiedResult,
  type ReportAttachment,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { computeWardOperationsCoverage } from '../services/directoryService';
import type { NavSectionId } from '../components/AppShell';
import { isSectionAllowedForRole } from '../hooks/useNavigationHistory';

export type CardTone = 'emerald' | 'amber' | 'crimson' | 'slate' | 'sky';

export interface RoleHomeCardDef {
  key: string;
  sectionId: NavSectionId;
  title: string;
  description: string;
  statText: string;
  tone: CardTone;
  icon: LucideIcon;
}

export interface RoleSummaryMetric {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: CardTone;
  targetSection?: NavSectionId;
}

export interface ResolvedLocationScope {
  lgaLabel: string | null;
  wardLabel: string | null;
  pollingUnitLabel: string | null;
  summaryLine: string;
}

export interface RoleHomeDataset {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
  users: UserAccount[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  publicResults: PublicVerifiedResult[];
  partyConfigs: Record<PartyCode, PartyConfig | null>;
  tasks: OperationalTask[];
  notes: OperationalNote[];
  timelineEvents: TimelineEvent[];
  notifications: NotificationItem[];
  emergencyContacts: EmergencyContact[];
  generatedReports: GeneratedReportRecord[];
  reportAttachments: ReportAttachment[];
  auditLogs: AuditLog[];
  pendingSyncCount: number;
  failedSyncCount: number;
  unreadNotificationCount: number;
  isOnline: boolean;
}

export function extractTimestampMs(ts: FirestoreTime): number {
  if (!ts) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof (ts as { seconds?: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function countUnreadNotifications(
  notifications: NotificationItem[],
  lastSeenMs: number
): number {
  if (notifications.length === 0) return 0;
  if (!lastSeenMs || lastSeenMs <= 0) {
    return notifications.length;
  }
  return notifications.filter((n) => {
    const createdMs = extractTimestampMs(n.createdAt);
    return createdMs === 0 || createdMs > lastSeenMs;
  }).length;
}

export function resolveUserLocationScope(
  user: UserAccount,
  wards: Ward[],
  pollingUnits: PollingUnit[]
): ResolvedLocationScope {
  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    return {
      lgaLabel: 'Funtua & Dandume LGAs',
      wardLabel: null,
      pollingUnitLabel: null,
      summaryLine: 'Funtua & Dandume Federal Constituency',
    };
  }

  let lgaId: LgaId | null = null;
  if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    lgaId = 'funtua';
  } else if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    lgaId = 'dandume';
  } else if (user.assignedLgaId === 'funtua' || user.assignedLgaId === 'dandume') {
    lgaId = user.assignedLgaId;
  } else if (user.requestedLgaId === 'funtua' || user.requestedLgaId === 'dandume') {
    lgaId = user.requestedLgaId;
  }

  const lgaLabel = lgaId ? LGA_DEFINITIONS[lgaId].displayName : null;

  const matchedWard = user.assignedWardId
    ? wards.find((w) => w.id === user.assignedWardId)
    : undefined;
  const wardLabel = matchedWard
    ? `${matchedWard.name} Ward`
    : user.requestedWardName
      ? `${user.requestedWardName} Ward`
      : user.assignedWardId
        ? `Ward ${user.assignedWardId}`
        : null;

  const matchedPu = user.assignedPollingUnitId
    ? pollingUnits.find((p) => p.id === user.assignedPollingUnitId)
    : undefined;
  const pollingUnitLabel = matchedPu
    ? `${matchedPu.puCode} · ${matchedPu.name}`
    : user.requestedPollingUnitCode && user.requestedPollingUnitName
      ? `${user.requestedPollingUnitCode} · ${user.requestedPollingUnitName}`
      : user.assignedPollingUnitId
        ? `PU ${user.assignedPollingUnitId}`
        : null;

  const parts = [lgaLabel, wardLabel, pollingUnitLabel].filter((p): p is string => Boolean(p));
  if (parts.length === 0) {
    if (user.role === UserRole.VERIFICATION_OFFICER) {
      return {
        lgaLabel: 'Funtua & Dandume LGAs',
        wardLabel: null,
        pollingUnitLabel: null,
        summaryLine: 'Funtua & Dandume Constituency Verification',
      };
    }
    return {
      lgaLabel: null,
      wardLabel: null,
      pollingUnitLabel: null,
      summaryLine: 'FDMIS Constituency Access',
    };
  }

  return {
    lgaLabel,
    wardLabel,
    pollingUnitLabel,
    summaryLine: parts.join(' · '),
  };
}

interface ComputedRoleStats {
  totalWards: number;
  totalPus: number;
  reportingPus: number;
  reportingPct: number;
  registeredAgents: number;
  activeAgents: number;
  opsOfficers: number;
  activeOpsOfficers: number;
  compliantWards: number;
  understaffedWards: number;
  activeIncidents: number;
  criticalIncidents: number;
  resultsSubmitted: number;
  resultsVerified: number;
  pendingVerification: number;
  totalTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  completedTasks: number;
  myTasksTotal: number;
  myPendingTasks: number;
  myOverdueTasks: number;
  myCheckInsCount: number;
  myResultsCount: number;
  myIncidentsCount: number;
  myAssignedPu: PollingUnit | null;
  pendingUsers: number;
  configuredParties: number;
  notesCount: number;
  timelineCount: number;
  publicResultsCount: number;
  reportsCount: number;
  attachmentsCount: number;
  auditLogsCount: number;
  emergencyContactsCount: number;
}

function computeStats(data: RoleHomeDataset, nowMs: number): ComputedRoleStats {
  const {
    user,
    wards,
    pollingUnits,
    users,
    checkIns,
    incidents,
    results,
    approvedPuResults,
    publicResults,
    partyConfigs,
    tasks,
    notes,
    timelineEvents,
    emergencyContacts,
    generatedReports,
    reportAttachments,
    auditLogs,
  } = data;

  const totalWards = wards.length;
  const totalPus = pollingUnits.length;
  const reportingPus = pollingUnits.filter((p) => isPuReporting(p.operationalStatus)).length;
  const reportingPct = totalPus > 0 ? Math.round((reportingPus / totalPus) * 100) : 0;

  const agentUsers = users.filter((u) => u.role === UserRole.POLLING_UNIT_AGENT);
  const activeAgents = agentUsers.filter(
    (u) => u.status === AccountStatus.ACTIVE && !u.sessionRevoked
  ).length;

  const officerUsers = users.filter((u) => u.role === UserRole.OPERATIONS_OFFICER);
  const activeOpsOfficers = officerUsers.filter(
    (u) => u.status === AccountStatus.ACTIVE && !u.sessionRevoked
  ).length;

  const coverage = computeWardOperationsCoverage(wards, users, MIN_OPERATIONS_OFFICERS_PER_WARD);
  const compliantWards = coverage.filter((w) => w.isCompliant).length;
  const understaffedWards = Math.max(0, coverage.length - compliantWards);

  const activeIncidentsList = incidents.filter((i) => isIncidentActive(i.status));
  const criticalIncidents = activeIncidentsList.filter(
    (i) => i.urgency === IncidentUrgency.CRITICAL
  ).length;

  const resultsSubmitted = results.length;
  const resultsVerified = approvedPuResults.length;
  const pendingVerification = results.filter(
    (r) =>
      r.verificationStatus === VerificationStatus.SUBMITTED ||
      r.verificationStatus === VerificationStatus.UNDER_REVIEW
  ).length;

  let pendingTasks = 0;
  let overdueTasks = 0;
  let completedTasks = 0;
  let myTasksTotal = 0;
  let myPendingTasks = 0;
  let myOverdueTasks = 0;

  tasks.forEach((t) => {
    const eff = getEffectiveTaskStatus(t, nowMs);
    const isMine = t.assignedOfficerUid === user.uid;
    if (isMine) myTasksTotal += 1;

    if (eff === TaskStatus.APPROVED_COMPLETED) {
      completedTasks += 1;
    } else if (eff === TaskStatus.OVERDUE) {
      overdueTasks += 1;
      pendingTasks += 1;
      if (isMine) {
        myOverdueTasks += 1;
        myPendingTasks += 1;
      }
    } else {
      pendingTasks += 1;
      if (isMine) myPendingTasks += 1;
    }
  });

  const myCheckInsCount = checkIns.filter((c) => c.agentUid === user.uid).length;
  const myResultsCount = results.filter((r) => r.submittedByUid === user.uid).length;
  const myIncidentsCount = incidents.filter((i) => i.reporterUid === user.uid).length;
  const myAssignedPu =
    (user.assignedPollingUnitId
      ? pollingUnits.find((p) => p.id === user.assignedPollingUnitId)
      : pollingUnits.find((p) => p.assignedAgentUid === user.uid)) || null;

  const pendingUsers = users.filter((u) => u.status === AccountStatus.PENDING_APPROVAL).length;
  const configuredParties = Object.values(partyConfigs).filter(
    (p) => Boolean(p && p.storageMode !== 'none' && p.logoUrl && !p.logoUrl.startsWith('blob:'))
  ).length;

  return {
    totalWards,
    totalPus,
    reportingPus,
    reportingPct,
    registeredAgents: agentUsers.length,
    activeAgents,
    opsOfficers: officerUsers.length,
    activeOpsOfficers,
    compliantWards,
    understaffedWards,
    activeIncidents: activeIncidentsList.length,
    criticalIncidents,
    resultsSubmitted,
    resultsVerified,
    pendingVerification,
    totalTasks: tasks.length,
    pendingTasks,
    overdueTasks,
    completedTasks,
    myTasksTotal,
    myPendingTasks,
    myOverdueTasks,
    myCheckInsCount,
    myResultsCount,
    myIncidentsCount,
    myAssignedPu,
    pendingUsers,
    configuredParties,
    notesCount: notes.length,
    timelineCount: timelineEvents.length,
    publicResultsCount: publicResults.length,
    reportsCount: generatedReports.length,
    attachmentsCount: reportAttachments.length,
    auditLogsCount: auditLogs.length,
    emergencyContactsCount: emergencyContacts.length,
  };
}

export function getRoleSummaryMetrics(
  data: RoleHomeDataset,
  nowMs: number = Date.now()
): RoleSummaryMetric[] {
  const s = computeStats(data, nowMs);
  const { user, pendingSyncCount, failedSyncCount, unreadNotificationCount, isOnline } = data;

  const syncMetric: RoleSummaryMetric = {
    key: 'sync_status',
    label: 'Sync Queue',
    value: failedSyncCount > 0 ? `${failedSyncCount} Failed` : `${pendingSyncCount}`,
    detail:
      failedSyncCount > 0
        ? 'Needs retry on reconnect'
        : pendingSyncCount > 0
          ? 'Pending synchronization'
          : isOnline
            ? 'All records synchronized'
            : 'Saved offline locally',
    tone: failedSyncCount > 0 ? 'crimson' : pendingSyncCount > 0 ? 'amber' : 'emerald',
    targetSection: 'field_ops',
  };

  switch (user.role) {
    case UserRole.FULL_CONTROL_ADMIN:
      return [
        {
          key: 'pending_tasks',
          label: 'Pending Tasks',
          value: String(s.pendingTasks),
          detail:
            s.overdueTasks > 0
              ? `${s.overdueTasks} overdue · ${s.completedTasks} approved`
              : `${s.completedTasks} approved of ${s.totalTasks}`,
          tone: s.overdueTasks > 0 ? 'crimson' : s.pendingTasks > 0 ? 'amber' : 'emerald',
          targetSection: 'task_ops',
        },
        {
          key: 'active_incidents',
          label: 'Active Incidents',
          value: String(s.activeIncidents),
          detail:
            s.criticalIncidents > 0
              ? `${s.criticalIncidents} critical require action`
              : 'No critical escalations',
          tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
          targetSection: 'incidents',
        },
        {
          key: 'verification_queue',
          label: 'Pending Verification',
          value: String(s.pendingVerification),
          detail: `${s.resultsVerified} verified · ${s.resultsSubmitted} submitted`,
          tone: s.pendingVerification > 0 ? 'amber' : 'emerald',
          targetSection: 'verification',
        },
        {
          key: 'ward_staffing',
          label: 'Ward Staffing',
          value: `${s.compliantWards}/${s.totalWards}`,
          detail:
            s.understaffedWards > 0
              ? `${s.understaffedWards} ward${s.understaffedWards === 1 ? '' : 's'} below 5 officers`
              : `${s.activeOpsOfficers} active ops officers`,
          tone: s.understaffedWards > 0 ? 'amber' : 'emerald',
          targetSection: 'operations_officers',
        },
      ];

    case UserRole.FUNTUA_SUPER_ADMIN:
    case UserRole.DANDUME_SUPER_ADMIN:
      return [
        {
          key: 'lga_reporting',
          label: 'Reporting Progress',
          value: `${s.reportingPct}%`,
          detail: `${s.reportingPus} of ${s.totalPus} PUs reporting`,
          tone: s.reportingPct >= 80 ? 'emerald' : 'sky',
          targetSection: 'polling_units',
        },
        {
          key: 'lga_incidents',
          label: 'Active Incidents',
          value: String(s.activeIncidents),
          detail:
            s.criticalIncidents > 0
              ? `${s.criticalIncidents} critical in LGA`
              : 'No critical alerts',
          tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
          targetSection: 'incidents',
        },
        {
          key: 'lga_verification',
          label: 'Results Queue',
          value: String(s.pendingVerification),
          detail: `${s.resultsVerified} verified · ${s.resultsSubmitted} submitted`,
          tone: s.pendingVerification > 0 ? 'amber' : 'emerald',
          targetSection: 'verification',
        },
        {
          key: 'lga_officers',
          label: 'Assigned Officers',
          value: String(s.activeOpsOfficers),
          detail: `${s.compliantWards}/${s.totalWards} wards meet target`,
          tone: s.understaffedWards > 0 ? 'amber' : 'emerald',
          targetSection: 'operations_officers',
        },
      ];

    case UserRole.VERIFICATION_OFFICER:
      return [
        {
          key: 'ver_pending',
          label: 'Awaiting Verification',
          value: String(s.pendingVerification),
          detail: 'EC8A sheets in queue',
          tone: s.pendingVerification > 0 ? 'amber' : 'emerald',
          targetSection: 'verification',
        },
        {
          key: 'ver_approved',
          label: 'Verified Results',
          value: String(s.resultsVerified),
          detail: `Of ${s.resultsSubmitted} total submissions`,
          tone: 'emerald',
          targetSection: 'results',
        },
        {
          key: 'ver_reporting',
          label: 'PU Reporting',
          value: `${s.reportingPct}%`,
          detail: `${s.reportingPus}/${s.totalPus} units active`,
          tone: 'sky',
          targetSection: 'polling_units',
        },
        {
          key: 'ver_notifs',
          label: 'Unread Alerts',
          value: String(unreadNotificationCount),
          detail: `${data.notifications.length} total notifications`,
          tone: unreadNotificationCount > 0 ? 'amber' : 'slate',
          targetSection: 'notifications',
        },
      ];

    case UserRole.WARD_COORDINATOR:
      return [
        {
          key: 'ward_reporting',
          label: 'Ward Reporting',
          value: `${s.reportingPct}%`,
          detail: `${s.reportingPus}/${s.totalPus} PUs reporting`,
          tone: s.reportingPct >= 80 ? 'emerald' : 'sky',
          targetSection: 'polling_units',
        },
        {
          key: 'ward_incidents',
          label: 'Ward Incidents',
          value: String(s.activeIncidents),
          detail:
            s.criticalIncidents > 0 ? `${s.criticalIncidents} critical alerts` : 'Within normal status',
          tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
          targetSection: 'incidents',
        },
        {
          key: 'ward_results',
          label: 'Results Submitted',
          value: String(s.resultsSubmitted),
          detail: `${s.resultsVerified} verified in ward`,
          tone: 'emerald',
          targetSection: 'results',
        },
        syncMetric,
      ];

    case UserRole.OPERATIONS_OFFICER:
      return [
        {
          key: 'officer_tasks',
          label: 'Pending Tasks',
          value: String(s.myPendingTasks),
          detail:
            s.myOverdueTasks > 0
              ? `${s.myOverdueTasks} overdue · ${s.myTasksTotal} assigned`
              : `${s.myTasksTotal} total assigned`,
          tone: s.myOverdueTasks > 0 ? 'crimson' : s.myPendingTasks > 0 ? 'amber' : 'emerald',
          targetSection: 'task_ops',
        },
        {
          key: 'officer_pus',
          label: 'Ward Progress',
          value: `${s.reportingPct}%`,
          detail: `${s.reportingPus}/${s.totalPus} PUs reporting`,
          tone: 'sky',
          targetSection: 'polling_units',
        },
        {
          key: 'officer_incidents',
          label: 'Active Incidents',
          value: String(s.activeIncidents),
          detail:
            s.criticalIncidents > 0 ? `${s.criticalIncidents} critical alerts` : 'No critical escalations',
          tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
          targetSection: 'incidents',
        },
        syncMetric,
      ];

    case UserRole.POLLING_UNIT_AGENT: {
      const puStatusLabel = s.myAssignedPu
        ? PU_STATUS_META[s.myAssignedPu.operationalStatus]?.label || 'Assigned'
        : 'Not Assigned';
      return [
        {
          key: 'agent_pu_status',
          label: 'Polling Unit Status',
          value: puStatusLabel,
          detail: s.myAssignedPu ? s.myAssignedPu.puCode : 'Contact coordinator',
          tone: s.myAssignedPu && isPuReporting(s.myAssignedPu.operationalStatus) ? 'emerald' : 'sky',
          targetSection: 'polling_units',
        },
        {
          key: 'agent_submissions',
          label: 'My Submissions',
          value: String(s.myResultsCount + s.myCheckInsCount),
          detail: `${s.myCheckInsCount} check-ins · ${s.myResultsCount} results`,
          tone: 'emerald',
          targetSection: 'results',
        },
        syncMetric,
        {
          key: 'agent_notifs',
          label: 'Unread Alerts',
          value: String(unreadNotificationCount),
          detail: `${data.notifications.length} notifications received`,
          tone: unreadNotificationCount > 0 ? 'amber' : 'slate',
          targetSection: 'notifications',
        },
      ];
    }

    case UserRole.ORDINARY_USER:
    default:
      return [
        {
          key: 'user_public_results',
          label: 'Verified Public Results',
          value: String(s.publicResultsCount),
          detail: 'Approved constituency tallies',
          tone: 'emerald',
          targetSection: 'public_portal',
        },
        {
          key: 'user_notifs',
          label: 'Unread Notifications',
          value: String(unreadNotificationCount),
          detail: `${data.notifications.length} total alerts`,
          tone: unreadNotificationCount > 0 ? 'amber' : 'slate',
          targetSection: 'notifications',
        },
        {
          key: 'user_announcements',
          label: 'Recent Activity',
          value: String(s.timelineCount),
          detail: 'Official election timeline updates',
          tone: 'sky',
          targetSection: 'timeline',
        },
        syncMetric,
      ];
  }
}

/**
 * Returns the personalized, role-authorized clickable module cards for the Home dashboard.
 * STRICT RULE: 'overview' (Situation Room) is NEVER included in any role's Home card grid —
 * Situation Room stays strictly separate in the hamburger/sidebar navigation menu.
 * Every returned card is also verified against existing role permissions.
 */
export function getRoleHomeCards(
  data: RoleHomeDataset,
  nowMs: number = Date.now()
): RoleHomeCardDef[] {
  const s = computeStats(data, nowMs);
  const { user, pendingSyncCount, notifications, checkIns } = data;
  let cards: RoleHomeCardDef[] = [];

  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    cards = [
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-Ins & Sync',
        description: 'Agent arrival logs, device status, and offline synchronization queue.',
        statText: `${checkIns.length} check-ins · ${pendingSyncCount} queued`,
        tone: pendingSyncCount > 0 ? 'amber' : 'emerald',
        icon: Radio,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Operational field notes, handover briefs, and ward communications.',
        statText: `${s.notesCount} saved note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Incidents & Alerts',
        description: 'Triage, escalate, and resolve election day field incidents.',
        statText: `${s.activeIncidents} active · ${s.criticalIncidents} critical`,
        tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
        icon: AlertTriangle,
      },
      {
        key: 'results',
        sectionId: 'results',
        title: 'Results & EC8A',
        description: 'Inspect polling unit vote submissions and Form EC8A sheets.',
        statText: `${s.resultsSubmitted} submitted · ${s.resultsVerified} verified`,
        tone: 'emerald',
        icon: ClipboardCheck,
      },
      {
        key: 'verification',
        sectionId: 'verification',
        title: 'Verification Center',
        description: 'Approve, reject, or request corrections on submitted results.',
        statText: `${s.pendingVerification} awaiting review`,
        tone: s.pendingVerification > 0 ? 'amber' : 'emerald',
        icon: FileCheck2,
      },
      {
        key: 'party_management',
        sectionId: 'party_management',
        title: 'Party Management',
        description: 'Official APC, PDP, ADC, and Others emblems and metadata.',
        statText: `${s.configuredParties}/4 parties configured`,
        tone: 'slate',
        icon: Flag,
      },
      {
        key: 'operations_officers',
        sectionId: 'operations_officers',
        title: 'Operations Officers',
        description: 'Assign ward officers and monitor the 5-per-ward staffing target.',
        statText: `${s.activeOpsOfficers} active · ${s.compliantWards}/${s.totalWards} wards`,
        tone: s.understaffedWards > 0 ? 'amber' : 'emerald',
        icon: ShieldAlert,
      },
      {
        key: 'task_ops',
        sectionId: 'task_ops',
        title: 'Task Assignment',
        description: 'Assign ward field tasks, review officer reports, and track deadlines.',
        statText: `${s.pendingTasks} open · ${s.overdueTasks} overdue`,
        tone: s.overdueTasks > 0 ? 'crimson' : s.pendingTasks > 0 ? 'amber' : 'emerald',
        icon: ListTodo,
      },
      {
        key: 'timeline',
        sectionId: 'timeline',
        title: 'Election Timeline',
        description: 'Chronological operational milestones across Funtua & Dandume.',
        statText: `${s.timelineCount} timeline event${s.timelineCount === 1 ? '' : 's'}`,
        tone: 'sky',
        icon: Clock,
      },
      {
        key: 'wards',
        sectionId: 'wards',
        title: 'LGAs & Wards',
        description: 'Manage Funtua & Dandume LGAs, 22 electoral wards, and readiness.',
        statText: `2 LGAs · ${s.totalWards} wards`,
        tone: 'emerald',
        icon: Building2,
      },
      {
        key: 'polling_units',
        sectionId: 'polling_units',
        title: 'Polling Units',
        description: 'Official polling unit directory, agent coverage, and status.',
        statText: `${s.reportingPus}/${s.totalPus} reporting (${s.reportingPct}%)`,
        tone: 'sky',
        icon: MapPin,
      },
      {
        key: 'reports',
        sectionId: 'reports',
        title: 'Reports & Exports',
        description: 'Automated situation reports, analytics, PDF, Excel, and CSV exports.',
        statText: `${s.reportsCount} archived · 7 auto reports`,
        tone: 'emerald',
        icon: FileBarChart2,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'Broadcast operational alerts and inspect alert delivery logs.',
        statText: `${data.unreadNotificationCount} unread · ${notifications.length} total`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Rapid-dial emergency contacts and official Situation Room desk.',
        statText: `${s.emergencyContactsCount} verified contact${s.emergencyContactsCount === 1 ? '' : 's'}`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'public_portal',
        sectionId: 'public_portal',
        title: 'Public Results View',
        description: 'Preview verified constituency totals approved for public release.',
        statText: `${s.publicResultsCount} published tally record${s.publicResultsCount === 1 ? '' : 's'}`,
        tone: 'emerald',
        icon: Globe,
      },
      {
        key: 'users',
        sectionId: 'users',
        title: 'User & Access Control',
        description: 'Approve accounts, assign roles, reset passwords, and manage access.',
        statText: `${data.users.length} accounts · ${s.pendingUsers} pending`,
        tone: s.pendingUsers > 0 ? 'amber' : 'slate',
        icon: Users,
      },
      {
        key: 'data_management',
        sectionId: 'data_management',
        title: 'Data Management',
        description: 'Column-filtered exports, record cleanup, and permanent deletion.',
        statText: `${s.attachmentsCount} file${s.attachmentsCount === 1 ? '' : 's'} stored`,
        tone: 'slate',
        icon: Database,
      },
      {
        key: 'audit_logs',
        sectionId: 'audit_logs',
        title: 'Audit Logs',
        description: 'Immutable trail of administrative actions, verifications, and logins.',
        statText: `${s.auditLogsCount} audit event${s.auditLogsCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: ClipboardList,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'Settings & Security',
        description: 'Session auto-lock, WhatsApp room link, and security controls.',
        statText: 'System & account security',
        tone: 'slate',
        icon: Settings,
      },
    ];
  } else if (
    user.role === UserRole.FUNTUA_SUPER_ADMIN ||
    user.role === UserRole.DANDUME_SUPER_ADMIN
  ) {
    const lgaShort = user.role === UserRole.FUNTUA_SUPER_ADMIN ? 'Funtua' : 'Dandume';
    cards = [
      {
        key: 'wards',
        sectionId: 'wards',
        title: 'Wards Management',
        description: `Review ${lgaShort} LGA electoral wards, coordinators, and readiness.`,
        statText: `${s.totalWards} wards · ${s.compliantWards} staffed`,
        tone: 'emerald',
        icon: Building2,
      },
      {
        key: 'polling_units',
        sectionId: 'polling_units',
        title: 'Polling Units',
        description: `Track ${lgaShort} polling unit reporting and agent assignments.`,
        statText: `${s.reportingPus}/${s.totalPus} reporting (${s.reportingPct}%)`,
        tone: 'sky',
        icon: MapPin,
      },
      {
        key: 'operations_officers',
        sectionId: 'operations_officers',
        title: 'Operations Officers',
        description: `Manage ${lgaShort} ward operations officers and coverage gaps.`,
        statText: `${s.activeOpsOfficers} active · ${s.understaffedWards} understaffed`,
        tone: s.understaffedWards > 0 ? 'amber' : 'emerald',
        icon: ShieldAlert,
      },
      {
        key: 'users',
        sectionId: 'users',
        title: 'Agent Management',
        description: `Approve ${lgaShort} agents, assign units, and review accounts.`,
        statText: `${s.activeAgents} active agents · ${s.pendingUsers} pending`,
        tone: s.pendingUsers > 0 ? 'amber' : 'slate',
        icon: Users,
      },
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-Ins',
        description: 'Monitor agent check-ins, arrival timestamps, and sync queue.',
        statText: `${checkIns.length} check-ins · ${pendingSyncCount} queued`,
        tone: pendingSyncCount > 0 ? 'amber' : 'emerald',
        icon: Radio,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Incidents & Alerts',
        description: `Review, triage, and escalate active ${lgaShort} field incidents.`,
        statText: `${s.activeIncidents} active · ${s.criticalIncidents} critical`,
        tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
        icon: AlertTriangle,
      },
      {
        key: 'results',
        sectionId: 'results',
        title: 'Results Monitoring',
        description: `Inspect ${lgaShort} Form EC8A submissions and unit vote counts.`,
        statText: `${s.resultsSubmitted} submitted · ${s.resultsVerified} verified`,
        tone: 'emerald',
        icon: ClipboardCheck,
      },
      {
        key: 'verification',
        sectionId: 'verification',
        title: 'Verification Center',
        description: `Verify submitted ${lgaShort} polling unit results and EC8A sheets.`,
        statText: `${s.pendingVerification} pending review`,
        tone: s.pendingVerification > 0 ? 'amber' : 'emerald',
        icon: FileCheck2,
      },
      {
        key: 'task_ops',
        sectionId: 'task_ops',
        title: 'Task Management',
        description: `Monitor ward operations tasks and officer submissions in ${lgaShort}.`,
        statText: `${s.pendingTasks} open · ${s.overdueTasks} overdue`,
        tone: s.overdueTasks > 0 ? 'crimson' : 'sky',
        icon: ListTodo,
      },
      {
        key: 'reports',
        sectionId: 'reports',
        title: 'LGA Reports',
        description: `Generate ${lgaShort} analytics reports and PDF/Excel/CSV exports.`,
        statText: `${s.reportsCount} archived · live exports`,
        tone: 'emerald',
        icon: FileBarChart2,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Record and share LGA operational notes offline or online.',
        statText: `${s.notesCount} saved note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'Send LGA updates and review incoming operational broadcasts.',
        statText: `${data.unreadNotificationCount} unread · ${notifications.length} total`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Verified emergency hotline directory and escalation contacts.',
        statText: `${s.emergencyContactsCount} contact${s.emergencyContactsCount === 1 ? '' : 's'} ready`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'Account & Preferences',
        description: 'Manage alert preferences and session security settings.',
        statText: `${lgaShort} LGA scope`,
        tone: 'slate',
        icon: Settings,
      },
    ];
  } else if (user.role === UserRole.VERIFICATION_OFFICER) {
    cards = [
      {
        key: 'verification',
        sectionId: 'verification',
        title: 'Verification Center',
        description: 'Review Form EC8A uploads, approve results, or request corrections.',
        statText: `${s.pendingVerification} pending review`,
        tone: s.pendingVerification > 0 ? 'amber' : 'emerald',
        icon: FileCheck2,
      },
      {
        key: 'results',
        sectionId: 'results',
        title: 'Results & EC8A',
        description: 'Inspect submitted polling unit tallies and verified totals.',
        statText: `${s.resultsSubmitted} submitted · ${s.resultsVerified} verified`,
        tone: 'emerald',
        icon: ClipboardCheck,
      },
      {
        key: 'reports',
        sectionId: 'reports',
        title: 'Reports & Exports',
        description: 'Generate verification and performance reports in PDF or Excel.',
        statText: `${s.reportsCount} archived reports`,
        tone: 'sky',
        icon: FileBarChart2,
      },
      {
        key: 'polling_units',
        sectionId: 'polling_units',
        title: 'Polling Units',
        description: 'Inspect polling unit reporting progress within your scope.',
        statText: `${s.reportingPus}/${s.totalPus} reporting`,
        tone: 'sky',
        icon: MapPin,
      },
      {
        key: 'wards',
        sectionId: 'wards',
        title: 'LGAs & Wards',
        description: 'Browse ward breakdowns and verification completion rates.',
        statText: `${s.totalWards} ward${s.totalWards === 1 ? '' : 's'} in scope`,
        tone: 'emerald',
        icon: Building2,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Incidents & Alerts',
        description: 'Monitor field incidents affecting result collation or transmission.',
        statText: `${s.activeIncidents} active incident${s.activeIncidents === 1 ? '' : 's'}`,
        tone: s.criticalIncidents > 0 ? 'crimson' : 'slate',
        icon: AlertTriangle,
      },
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-Ins',
        description: 'Check field arrival telemetry and local sync queue.',
        statText: `${checkIns.length} check-ins`,
        tone: 'slate',
        icon: Radio,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Log verification queries and operational handover notes.',
        statText: `${s.notesCount} note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'Read urgent alerts and administrative notices.',
        statText: `${data.unreadNotificationCount} unread`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Direct emergency phone lines and support desk.',
        statText: `${s.emergencyContactsCount} contacts`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'public_portal',
        sectionId: 'public_portal',
        title: 'Public Results View',
        description: 'View constituency verified totals published to the portal.',
        statText: `${s.publicResultsCount} public records`,
        tone: 'emerald',
        icon: Globe,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'Settings & Security',
        description: 'Notification preferences and account security controls.',
        statText: 'Account preferences',
        tone: 'slate',
        icon: Settings,
      },
    ];
  } else if (user.role === UserRole.WARD_COORDINATOR) {
    cards = [
      {
        key: 'wards',
        sectionId: 'wards',
        title: 'My Ward Overview',
        description: 'Ward summary, staffing coverage, and verified ward collation status.',
        statText: `${s.totalWards} ward · ${s.reportingPct}% reporting`,
        tone: 'emerald',
        icon: Building2,
      },
      {
        key: 'polling_units',
        sectionId: 'polling_units',
        title: 'Polling Units',
        description: 'Track every polling unit in your assigned ward in real time.',
        statText: `${s.reportingPus}/${s.totalPus} reporting`,
        tone: 'sky',
        icon: MapPin,
      },
      {
        key: 'users',
        sectionId: 'users',
        title: 'Polling Unit Agents',
        description: 'Review assigned ward agents and polling unit staffing coverage.',
        statText: `${s.activeAgents} active agent${s.activeAgents === 1 ? '' : 's'}`,
        tone: 'emerald',
        icon: Users,
      },
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-Ins',
        description: 'Log check-ins and monitor ward agent arrivals and sync queue.',
        statText: `${checkIns.length} check-ins · ${pendingSyncCount} queued`,
        tone: pendingSyncCount > 0 ? 'amber' : 'emerald',
        icon: Radio,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Incident Reporting',
        description: 'Report, review, and escalate field incidents within your ward.',
        statText: `${s.activeIncidents} active · ${s.criticalIncidents} critical`,
        tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
        icon: AlertTriangle,
      },
      {
        key: 'results',
        sectionId: 'results',
        title: 'Results & EC8A',
        description: 'Track polling unit result entries and Form EC8A evidence.',
        statText: `${s.resultsSubmitted} submitted · ${s.resultsVerified} verified`,
        tone: 'emerald',
        icon: ClipboardCheck,
      },
      {
        key: 'reports',
        sectionId: 'reports',
        title: 'Ward Reports',
        description: 'Generate ward performance summaries and export PDF/Excel files.',
        statText: `${s.reportsCount} saved · live reports`,
        tone: 'sky',
        icon: FileBarChart2,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Save ward field observations and synchronize updates offline.',
        statText: `${s.notesCount} ward note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'timeline',
        sectionId: 'timeline',
        title: 'Election Timeline',
        description: 'Chronological ward activity feed and election milestones.',
        statText: `${s.timelineCount} event${s.timelineCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: Clock,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'View official announcements and operational alerts.',
        statText: `${data.unreadNotificationCount} unread · ${notifications.length} total`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Rapid-dial emergency contacts and Situation Room support.',
        statText: `${s.emergencyContactsCount} verified contacts`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'Account Settings',
        description: 'Manage notification preferences and session security.',
        statText: 'Preferences & security',
        tone: 'slate',
        icon: Settings,
      },
    ];
  } else if (user.role === UserRole.OPERATIONS_OFFICER) {
    cards = [
      {
        key: 'task_ops',
        sectionId: 'task_ops',
        title: 'My Assigned Tasks',
        description: 'Acknowledge assignments, update progress, and upload field reports.',
        statText: `${s.myPendingTasks} open · ${s.myOverdueTasks} overdue`,
        tone: s.myOverdueTasks > 0 ? 'crimson' : s.myPendingTasks > 0 ? 'amber' : 'emerald',
        icon: ListTodo,
      },
      {
        key: 'wards',
        sectionId: 'wards',
        title: 'My Ward',
        description: 'View ward details, reporting status, and officer coverage.',
        statText: `${s.totalWards} ward · ${s.reportingPct}% reporting`,
        tone: 'emerald',
        icon: Building2,
      },
      {
        key: 'polling_units',
        sectionId: 'polling_units',
        title: 'Assigned Polling Units',
        description: 'Monitor polling units in your assigned ward offline or online.',
        statText: `${s.reportingPus}/${s.totalPus} reporting`,
        tone: 'sky',
        icon: MapPin,
      },
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-Ins',
        description: 'Submit field check-ins and track queued offline uploads.',
        statText: `${checkIns.length} check-ins · ${pendingSyncCount} queued`,
        tone: pendingSyncCount > 0 ? 'amber' : 'emerald',
        icon: Radio,
      },
      {
        key: 'reports',
        sectionId: 'reports',
        title: 'Field Reports',
        description: 'View ward analytics reports and export offline-ready summaries.',
        statText: `${s.reportsCount} archived · live view`,
        tone: 'sky',
        icon: FileBarChart2,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Incidents & Alerts',
        description: 'Report and escalate field incidents across your assigned ward.',
        statText: `${s.activeIncidents} active · ${s.criticalIncidents} critical`,
        tone: s.criticalIncidents > 0 ? 'crimson' : s.activeIncidents > 0 ? 'amber' : 'emerald',
        icon: AlertTriangle,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Record field observations, handover notes, and quick updates.',
        statText: `${s.notesCount} saved note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'timeline',
        sectionId: 'timeline',
        title: 'Activity History',
        description: 'Chronological log of check-ins, incidents, and election updates.',
        statText: `${s.timelineCount} event${s.timelineCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: Clock,
      },
      {
        key: 'operations_officers',
        sectionId: 'operations_officers',
        title: 'Ward Operations Team',
        description: 'View colleague Operations Officers assigned to your ward.',
        statText: `${s.activeOpsOfficers} active officer${s.activeOpsOfficers === 1 ? '' : 's'}`,
        tone: 'emerald',
        icon: ShieldAlert,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'Read administrative broadcasts and task alerts.',
        statText: `${data.unreadNotificationCount} unread · ${notifications.length} total`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Immediate emergency contacts and Situation Room desk.',
        statText: `${s.emergencyContactsCount} verified contacts`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'Account Settings',
        description: 'Alert preferences and account security controls.',
        statText: 'Profile & security',
        tone: 'slate',
        icon: Settings,
      },
    ];
  } else if (user.role === UserRole.POLLING_UNIT_AGENT) {
    const puStatus = s.myAssignedPu
      ? PU_STATUS_META[s.myAssignedPu.operationalStatus]?.label || 'Assigned'
      : 'Pending assignment';
    cards = [
      {
        key: 'polling_units',
        sectionId: 'polling_units',
        title: 'My Polling Unit',
        description: 'View your assigned polling unit details, code, and status.',
        statText: s.myAssignedPu ? `${s.myAssignedPu.puCode} · ${puStatus}` : puStatus,
        tone: 'emerald',
        icon: MapPin,
      },
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-In',
        description: 'Log arrival, material delivery, voting status, and offline sync.',
        statText: `${s.myCheckInsCount} logged · ${pendingSyncCount} queued`,
        tone: pendingSyncCount > 0 ? 'amber' : 'emerald',
        icon: Radio,
      },
      {
        key: 'results',
        sectionId: 'results',
        title: 'Submit Results & EC8A',
        description: 'Enter polling unit vote tallies and attach Form EC8A photo evidence.',
        statText: `${s.myResultsCount} submitted · ${s.resultsVerified} verified`,
        tone: 'emerald',
        icon: ClipboardCheck,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Report Incident',
        description: 'Flag urgent delays, BVAS faults, or security issues immediately.',
        statText: `${s.myIncidentsCount} reported · ${s.activeIncidents} active`,
        tone: s.criticalIncidents > 0 ? 'crimson' : 'amber',
        icon: AlertTriangle,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Save short field observations offline and sync automatically.',
        statText: `${s.notesCount} saved note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'timeline',
        sectionId: 'timeline',
        title: 'My Submission History',
        description: 'Track chronological check-ins, results, and incident timestamps.',
        statText: `${s.timelineCount} recorded event${s.timelineCount === 1 ? '' : 's'}`,
        tone: 'sky',
        icon: Clock,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'Read official Situation Room directives and alerts.',
        statText: `${data.unreadNotificationCount} unread · ${notifications.length} total`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'One-tap access to verified emergency response numbers.',
        statText: `${s.emergencyContactsCount} verified contacts`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'public_portal',
        sectionId: 'public_portal',
        title: 'Public Results',
        description: 'View officially verified constituency tallies.',
        statText: `${s.publicResultsCount} published records`,
        tone: 'emerald',
        icon: Globe,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'Account Settings',
        description: 'Manage your profile preferences and session security.',
        statText: 'Profile & alerts',
        tone: 'slate',
        icon: Settings,
      },
    ];
  } else {
    // UserRole.ORDINARY_USER (and safe fallback for any other authorized non-pending user)
    cards = [
      {
        key: 'public_portal',
        sectionId: 'public_portal',
        title: 'Public Results',
        description: 'View officially verified Funtua & Dandume election tallies.',
        statText: `${s.publicResultsCount} verified record${s.publicResultsCount === 1 ? '' : 's'}`,
        tone: 'emerald',
        icon: Globe,
      },
      {
        key: 'timeline',
        sectionId: 'timeline',
        title: 'Public Announcements',
        description: 'Follow chronological election day milestones and updates.',
        statText: `${s.timelineCount} update${s.timelineCount === 1 ? '' : 's'}`,
        tone: 'sky',
        icon: Clock,
      },
      {
        key: 'notifications',
        sectionId: 'notifications',
        title: 'Notifications',
        description: 'Review official notices and constituency broadcasts.',
        statText: `${data.unreadNotificationCount} unread · ${notifications.length} total`,
        tone: data.unreadNotificationCount > 0 ? 'amber' : 'slate',
        icon: Bell,
      },
      {
        key: 'emergency_assistance',
        sectionId: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Verified emergency hotlines and rapid response contacts.',
        statText: `${s.emergencyContactsCount} contact${s.emergencyContactsCount === 1 ? '' : 's'} ready`,
        tone: 'crimson',
        icon: PhoneCall,
      },
      {
        key: 'field_ops',
        sectionId: 'field_ops',
        title: 'Field Check-In',
        description: 'Log location check-ins for your registered polling unit.',
        statText: `${s.myCheckInsCount} logged · ${pendingSyncCount} queued`,
        tone: pendingSyncCount > 0 ? 'amber' : 'emerald',
        icon: Radio,
      },
      {
        key: 'incidents',
        sectionId: 'incidents',
        title: 'Report Incident',
        description: 'Submit field observations or urgent incident alerts.',
        statText: `${s.myIncidentsCount} reported`,
        tone: 'amber',
        icon: AlertTriangle,
      },
      {
        key: 'notes',
        sectionId: 'notes',
        title: 'Notes & Messages',
        description: 'Save short operational notes offline with auto-sync.',
        statText: `${s.notesCount} note${s.notesCount === 1 ? '' : 's'}`,
        tone: 'slate',
        icon: StickyNote,
      },
      {
        key: 'settings',
        sectionId: 'settings',
        title: 'My Profile & Settings',
        description: 'View your account details, alert preferences, and security.',
        statText: 'Account & security',
        tone: 'slate',
        icon: UserCheck,
      },
    ];
  }

  // Final defense-in-depth guard:
  // 1) Never allow Situation Room ('overview') or 'home' itself inside the Home card grid.
  // 2) Never show any module not permitted for the user's existing role.
  return cards.filter(
    (card) =>
      card.sectionId !== 'overview' &&
      card.sectionId !== 'home' &&
      isSectionAllowedForRole(card.sectionId, user.role)
  );
}
