import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Database,
  FileBarChart2,
  FileCheck2,
  Flag,
  Globe,
  LayoutDashboard,
  ListTodo,
  MapPin,
  PhoneCall,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  StickyNote,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  AccountStatus,
  IncidentUrgency,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  TaskStatus,
  UserRole,
  VerificationStatus,
  formatFirestoreTime,
  getEffectiveTaskStatus,
  isIncidentActive,
  isPuReporting,
  type AgentCheckIn,
  type ApprovedPuResult,
  type AuditLog,
  type EmergencyContact,
  type GeneratedReportRecord,
  type IncidentReport,
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
import { formatAccountIdentifier } from '../utils/phoneAuth';
import { RoleBadge } from '../components/StatusBadge';
import type { NavSectionId } from '../components/AppShell';

interface FullAdminHomePageProps {
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
  isOnline: boolean;
  lastUpdatedAt: Date | null;
  pendingSyncCount: number;
  syncingCount: number;
  failedSyncCount: number;
  syncingNow: boolean;
  onManualSync: () => void;
  onNavigate: (section: NavSectionId) => void;
}

interface AdminModuleCardDef {
  id: NavSectionId;
  title: string;
  description: string;
  statText: string;
  accent?: 'critical' | 'warning' | 'emerald' | 'neutral';
  icon: typeof LayoutDashboard;
}

export function FullAdminHomePage({
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
  notifications,
  emergencyContacts,
  generatedReports,
  reportAttachments,
  auditLogs,
  isOnline,
  lastUpdatedAt,
  pendingSyncCount,
  syncingCount,
  failedSyncCount,
  syncingNow,
  onManualSync,
  onNavigate,
}: FullAdminHomePageProps) {
  const [now, setNow] = useState(() => new Date());
  const [moduleSearch, setModuleSearch] = useState('');

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const summary = useMemo(() => {
    const nowMs = now.getTime();
    const totalLgas = 2;
    const totalWards = wards.length;
    const totalPollingUnits = pollingUnits.length;
    const reportingPus = pollingUnits.filter((p) => isPuReporting(p.operationalStatus)).length;
    const reportingPct =
      totalPollingUnits > 0 ? Math.round((reportingPus / totalPollingUnits) * 100) : 0;

    const registeredAgents = users.filter((u) => u.role === UserRole.POLLING_UNIT_AGENT);
    const activeAgents = registeredAgents.filter(
      (u) => u.status === AccountStatus.ACTIVE && !u.sessionRevoked
    ).length;

    const opsOfficers = users.filter((u) => u.role === UserRole.OPERATIONS_OFFICER);
    const activeOpsOfficers = opsOfficers.filter(
      (u) => u.status === AccountStatus.ACTIVE && !u.sessionRevoked
    ).length;

    const wardCoverage = computeWardOperationsCoverage(
      wards,
      users,
      MIN_OPERATIONS_OFFICERS_PER_WARD
    );
    const compliantWards = wardCoverage.filter((w) => w.isCompliant).length;
    const understaffedWards = wardCoverage.length - compliantWards;

    const activeIncidents = incidents.filter((i) => isIncidentActive(i.status));
    const criticalIncidents = activeIncidents.filter(
      (i) => i.urgency === IncidentUrgency.CRITICAL
    );

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
    tasks.forEach((t) => {
      const eff = getEffectiveTaskStatus(t, nowMs);
      if (eff === TaskStatus.APPROVED_COMPLETED) {
        completedTasks += 1;
      } else if (eff === TaskStatus.OVERDUE) {
        overdueTasks += 1;
        pendingTasks += 1;
      } else {
        pendingTasks += 1;
      }
    });

    const pendingUsers = users.filter((u) => u.status === AccountStatus.PENDING_APPROVAL).length;
    const configuredParties = Object.values(partyConfigs).filter(Boolean).length;

    return {
      totalLgas,
      totalWards,
      totalPollingUnits,
      reportingPus,
      reportingPct,
      registeredAgentsCount: registeredAgents.length,
      activeAgents,
      opsOfficersCount: opsOfficers.length,
      activeOpsOfficers,
      compliantWards,
      understaffedWards,
      activeIncidentsCount: activeIncidents.length,
      criticalIncidentsCount: criticalIncidents.length,
      resultsSubmitted,
      resultsVerified,
      pendingVerification,
      pendingTasks,
      overdueTasks,
      completedTasks,
      pendingUsers,
      configuredParties,
    };
  }, [wards, pollingUnits, users, incidents, results, approvedPuResults, tasks, partyConfigs, now]);

  const moduleCards: AdminModuleCardDef[] = useMemo(
    () => [
      {
        id: 'overview',
        title: 'Situation Room',
        description: 'Live constituency command overview, verified vote tallies, and ward readiness.',
        statText: `${summary.reportingPus}/${summary.totalPollingUnits} PUs reporting (${summary.reportingPct}%)`,
        accent: 'emerald',
        icon: LayoutDashboard,
      },
      {
        id: 'field_ops',
        title: 'Field Check-Ins & Sync',
        description: 'Monitor agent check-ins, arrival logs, battery health, and offline sync queue.',
        statText: `${checkIns.length} check-ins · ${pendingSyncCount} queued`,
        accent: pendingSyncCount > 0 ? 'warning' : 'neutral',
        icon: Radio,
      },
      {
        id: 'notes',
        title: 'Notes & Messages',
        description: 'Create, pin, and synchronize operational field notes across wards and LGAs.',
        statText: `${notes.length} operational note${notes.length === 1 ? '' : 's'}`,
        icon: StickyNote,
      },
      {
        id: 'incidents',
        title: 'Incidents & Alerts',
        description: 'Review, triage, escalate, and resolve election day field incidents.',
        statText: `${summary.activeIncidentsCount} active · ${summary.criticalIncidentsCount} critical`,
        accent: summary.criticalIncidentsCount > 0 ? 'critical' : summary.activeIncidentsCount > 0 ? 'warning' : 'neutral',
        icon: AlertTriangle,
      },
      {
        id: 'results',
        title: 'Results & EC8A',
        description: 'Inspect polling unit result submissions, vote totals, and EC8A evidence sheets.',
        statText: `${summary.resultsSubmitted} submitted · ${summary.resultsVerified} verified`,
        accent: 'emerald',
        icon: ClipboardCheck,
      },
      {
        id: 'verification',
        title: 'Verification Center',
        description: 'Audit EC8A figures, approve verified PU results, or return for correction.',
        statText: `${summary.pendingVerification} pending review`,
        accent: summary.pendingVerification > 0 ? 'warning' : 'neutral',
        icon: FileCheck2,
      },
      {
        id: 'party_management',
        title: 'Party Management',
        description: 'Manage official party symbols, acronyms, and display settings for tallies.',
        statText: `${summary.configuredParties} configured part${summary.configuredParties === 1 ? 'y' : 'ies'}`,
        icon: Flag,
      },
      {
        id: 'operations_officers',
        title: 'Operations Officers',
        description: 'Oversee ward Operations Officers and enforce 5-officer minimum ward coverage.',
        statText: `${summary.activeOpsOfficers} active · ${summary.understaffedWards} wards understaffed`,
        accent: summary.understaffedWards > 0 ? 'warning' : 'emerald',
        icon: ShieldAlert,
      },
      {
        id: 'task_ops',
        title: 'Task Assignment',
        description: 'Assign ward tasks to Operations Officers, track deadlines, and review field reports.',
        statText: `${summary.pendingTasks} pending · ${summary.overdueTasks} overdue`,
        accent: summary.overdueTasks > 0 ? 'critical' : summary.pendingTasks > 0 ? 'warning' : 'emerald',
        icon: ListTodo,
      },
      {
        id: 'timeline',
        title: 'Election Timeline',
        description: 'Chronological operational stream of check-ins, incidents, tasks, and results.',
        statText: `${timelineEvents.length} recorded event${timelineEvents.length === 1 ? '' : 's'}`,
        icon: Clock,
      },
      {
        id: 'wards',
        title: 'LGAs & Wards',
        description: 'Manage Funtua & Dandume LGAs, ward registries, and ward-level reporting rates.',
        statText: `${summary.totalLgas} LGAs · ${summary.totalWards} wards`,
        icon: Building2,
      },
      {
        id: 'polling_units',
        title: 'Polling Units',
        description: 'Inspect master polling unit directory, voter rolls, and agent assignments.',
        statText: `${summary.totalPollingUnits} official polling units`,
        icon: MapPin,
      },
      {
        id: 'reports',
        title: 'Reports & Exports',
        description: 'Automatic daily reports, KPI analytics, PDF/Excel workbooks, and printable exports.',
        statText: `7 auto reports · ${generatedReports.length} archived`,
        accent: 'emerald',
        icon: FileBarChart2,
      },
      {
        id: 'notifications',
        title: 'Notifications',
        description: 'Broadcast constituency directives and review live operational alerts.',
        statText: `${notifications.length} alert${notifications.length === 1 ? '' : 's'} logged`,
        icon: Bell,
      },
      {
        id: 'emergency_assistance',
        title: 'Emergency Assistance',
        description: 'Verified emergency hotlines, rapid response units, and ward escalation contacts.',
        statText: `${emergencyContacts.length} emergency contact${emergencyContacts.length === 1 ? '' : 's'}`,
        icon: PhoneCall,
      },
      {
        id: 'public_portal',
        title: 'Public Results View',
        description: 'Preview verified, publicly approved polling unit tallies for constituency release.',
        statText: `${publicResults.length} publicly approved PU${publicResults.length === 1 ? '' : 's'}`,
        icon: Globe,
      },
      {
        id: 'users',
        title: 'User & Access Control',
        description: 'Approve accounts, assign roles, manage LGA/ward scopes, and reset passwords.',
        statText: `${users.length} users · ${summary.pendingUsers} pending approval`,
        accent: summary.pendingUsers > 0 ? 'warning' : 'neutral',
        icon: Users,
      },
      {
        id: 'data_management',
        title: 'Data Management',
        description: 'Preview exports, customize columns, manage attachments, and purge test records.',
        statText: `${reportAttachments.length} attachment${reportAttachments.length === 1 ? '' : 's'} · ${results.length + incidents.length} records`,
        icon: Database,
      },
      {
        id: 'audit_logs',
        title: 'Audit Logs',
        description: 'Inspect immutable administrative, security, and verification audit trail entries.',
        statText: `${auditLogs.length} audit log entr${auditLogs.length === 1 ? 'y' : 'ies'}`,
        icon: ClipboardList,
      },
      {
        id: 'settings',
        title: 'Settings & Security',
        description: 'Configure session auto-lock, publication locks, and constituency security controls.',
        statText: 'System controls & security policy',
        icon: Settings,
      },
    ],
    [
      summary,
      checkIns.length,
      pendingSyncCount,
      notes.length,
      timelineEvents.length,
      generatedReports.length,
      notifications.length,
      emergencyContacts.length,
      publicResults.length,
      users.length,
      reportAttachments.length,
      results.length,
      incidents.length,
      auditLogs.length,
    ]
  );

  const visibleCards = useMemo(() => {
    const q = moduleSearch.trim().toLowerCase();
    if (!q) return moduleCards;
    return moduleCards.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.statText.toLowerCase().includes(q)
    );
  }, [moduleCards, moduleSearch]);

  const latestAlerts = useMemo(() => {
    const critInc = incidents
      .filter((i) => i.urgency === IncidentUrgency.CRITICAL && isIncidentActive(i.status))
      .slice(0, 3)
      .map((i) => ({
        id: `inc_${i.id}`,
        isCritical: true,
        title: `CRITICAL INCIDENT · ${i.puCode}: ${i.title}`,
        time: formatFirestoreTime(i.clientCreatedAtIso || i.createdAt),
        target: 'incidents' as NavSectionId,
      }));
    const recentNotifs = notifications.slice(0, 3).map((n) => ({
      id: `notif_${n.id}`,
      isCritical: n.isCritical,
      title: n.title,
      time: formatFirestoreTime(n.createdAt),
      target: 'notifications' as NavSectionId,
    }));
    return [...critInc, ...recentNotifs].slice(0, 4);
  }, [incidents, notifications]);

  const syncStatusLabel =
    syncingNow || syncingCount > 0
      ? 'SYNCHRONIZING'
      : failedSyncCount > 0
        ? `SYNC FAILED (${failedSyncCount})`
        : pendingSyncCount > 0
          ? `PENDING SYNCHRONIZATION (${pendingSyncCount})`
          : isOnline && lastUpdatedAt
            ? 'SYNCHRONIZED'
            : 'OFFLINE CACHE';

  const formattedDateTime = now.toLocaleString('en-NG', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lastSyncTimeLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Awaiting connection';

  return (
    <div className="space-y-6">
      {/* TOP COMMAND MASTHEAD — FDMIS 2027 Branding, Admin Info, Live Date/Time, Online/Sync Status */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
              <Shield className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#0b3b24]">
                FDMIS 2027 · Full Control Admin Command Home
              </p>
              <h2 className="mt-0.5 font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                Funtua–Dandume Mandate Intelligence System
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                <span className="font-semibold text-slate-900">{user.displayName}</span>
                <span aria-hidden="true">·</span>
                <span>{formatAccountIdentifier(user)}</span>
                <span aria-hidden="true">·</span>
                <RoleBadge role={user.role} />
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-700">{formattedDateTime}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {isOnline ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                  <Wifi className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  <span>ONLINE · LIVE DATA</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                  <WifiOff className="h-4 w-4 text-amber-700" aria-hidden="true" />
                  <span>OFFLINE · CACHED SNAPSHOT</span>
                </span>
              )}
              <span className="text-slate-300" aria-hidden="true">|</span>
              <span
                className={`font-semibold ${
                  failedSyncCount > 0
                    ? 'text-red-700'
                    : pendingSyncCount > 0
                      ? 'text-amber-800'
                      : 'text-slate-700'
                }`}
              >
                {syncStatusLabel}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="font-mono tabular-nums">Last sync: {lastSyncTimeLabel}</span>
              <button
                type="button"
                onClick={onManualSync}
                disabled={syncingNow}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#0b3b24] ${syncingNow ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncingNow ? 'Synchronizing...' : 'Sync Now'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Offline Cache Distinction Notice */}
        {!isOnline ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              <strong>Offline Cached Mode:</strong> Statistics below reflect the most recent cached database snapshot (last synced {lastSyncTimeLabel}). All previously downloaded modules remain accessible and queued updates will synchronize automatically upon reconnect.
            </span>
          </div>
        ) : null}

        {/* Notifications & Emergency Alerts Strip */}
        {latestAlerts.length > 0 ? (
          <div className="mt-4 border-t border-slate-100 pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Active Emergency Alerts & Recent Notifications
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => onNavigate('incidents')}
                  className="font-medium text-red-700 hover:underline"
                >
                  Incidents ({summary.activeIncidentsCount})
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('notifications')}
                  className="font-medium text-[#0b3b24] hover:underline"
                >
                  All Notifications ({notifications.length})
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {latestAlerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => onNavigate(alert.target)}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    alert.isCritical
                      ? 'border-red-200 bg-red-50/80 text-red-950 hover:bg-red-100/70'
                      : 'border-slate-200 bg-slate-50/70 text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {alert.isCritical ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-700" aria-hidden="true" />
                    ) : (
                      <Bell className="h-3.5 w-3.5 shrink-0 text-[#0b3b24]" aria-hidden="true" />
                    )}
                    <span className="truncate font-medium">{alert.title}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">{alert.time}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* 12 LIVE OPERATIONAL SUMMARY CARDS */}
      <section aria-label="Operational Summary">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-slate-700">
            Constituency Operational Summary
          </h3>
          <span className="text-xs text-slate-500">
            {isOnline ? 'Live Firestore Database' : `Cached Snapshot (${lastSyncTimeLabel})`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <button
            type="button"
            onClick={() => onNavigate('wards')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Total LGAs</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {summary.totalLgas}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Funtua & Dandume</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('wards')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Total Wards</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {summary.totalWards}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Constituency registry</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('polling_units')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Total Polling Units</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {summary.totalPollingUnits}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Official INEC master</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('users')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Registered Agents</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {summary.registeredAgentsCount}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {summary.activeAgents} active
            </p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('operations_officers')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Active Ops Officers</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#0b3b24]">
              {summary.activeOpsOfficers}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              of {summary.opsOfficersCount} total
            </p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('operations_officers')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Ward Staffing</p>
            <p
              className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                summary.understaffedWards > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {summary.compliantWards}/{summary.totalWards}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Wards with ≥5 officers</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('overview')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">PUs Reporting</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#0b3b24]">
              {summary.reportingPus}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {summary.reportingPct}% of {summary.totalPollingUnits}
            </p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Active Incidents</p>
            <p
              className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                summary.criticalIncidentsCount > 0
                  ? 'text-red-700'
                  : summary.activeIncidentsCount > 0
                    ? 'text-amber-700'
                    : 'text-slate-900'
              }`}
            >
              {summary.activeIncidentsCount}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {summary.criticalIncidentsCount} critical
            </p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('results')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Results Submitted</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {summary.resultsSubmitted}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {summary.pendingVerification} awaiting review
            </p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('verification')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Results Verified</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
              {summary.resultsVerified}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">FDMIS approved</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('task_ops')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Pending Tasks</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
              {summary.pendingTasks}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {summary.completedTasks} completed
            </p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('task_ops')}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-[#0b3b24]/40"
          >
            <p className="text-[11px] font-medium text-slate-500">Overdue Tasks</p>
            <p
              className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                summary.overdueTasks > 0 ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {summary.overdueTasks}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Past deadline</p>
          </button>
        </div>
      </section>

      {/* 20 CLICKABLE FULL ADMIN MODULE CARDS */}
      <section aria-label="Full Admin Modules">
        <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Full Admin Command Modules ({moduleCards.length})
            </h3>
            <p className="text-xs text-slate-500">
              Select any module card to open its dedicated operational page. Use Back at any time to return cleanly.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              placeholder="Filter modules..."
              className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleCards.map((card) => {
            const Icon = card.icon;
            const statColor =
              card.accent === 'critical'
                ? 'text-red-700'
                : card.accent === 'warning'
                  ? 'text-amber-800'
                  : card.accent === 'emerald'
                    ? 'text-[#0b3b24]'
                    : 'text-slate-700';

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className="group flex min-h-[146px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-[#0b3b24] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b3b24]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[#0b3b24] transition-colors group-hover:border-[#0b3b24] group-hover:bg-[#0b3b24] group-hover:text-white">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <ArrowRight
                      className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#0b3b24]"
                      aria-hidden="true"
                    />
                  </div>

                  <h4 className="mt-3 font-display text-sm font-bold text-slate-900 group-hover:text-[#0b3b24]">
                    {card.title}
                  </h4>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                    {card.description}
                  </p>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-2.5">
                  <p className={`truncate font-mono text-xs font-semibold tabular-nums ${statColor}`}>
                    {card.statText}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {visibleCards.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-center text-xs text-slate-500">
            No modules match "{moduleSearch}".
          </div>
        ) : null}
      </section>

      {/* Quiet Sync & Integrity Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
          <span>All statistics compiled strictly from authenticated FDMIS records.</span>
        </span>
        <span className="font-mono tabular-nums">
          Scope: Funtua & Dandume Federal Constituency
        </span>
      </footer>
    </div>
  );
}
