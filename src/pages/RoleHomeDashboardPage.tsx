import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  Search,
  Shield,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  USER_ROLE_META,
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
  type SessionVerificationMode,
  type TimelineEvent,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import type { NavSectionId } from '../components/AppShell';
import {
  getRoleHomeCards,
  getRoleSummaryMetrics,
  resolveUserLocationScope,
  type CardTone,
  type RoleHomeDataset,
} from '../utils/roleHomeConfig';

interface RoleHomeDashboardPageProps {
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
  sessionMode?: SessionVerificationMode;
  lastServerVerifiedAtMs?: number | null;
  lastUpdatedAt: Date | null;
  pendingSyncCount: number;
  syncingCount: number;
  failedSyncCount: number;
  unreadNotificationCount: number;
  syncingNow: boolean;
  onManualSync: () => void;
  onNavigate: (section: NavSectionId) => void;
}

const ICON_SURFACE_BY_TONE: Record<CardTone, string> = {
  emerald: 'bg-white text-[#0b3b24] ring-1 ring-inset ring-stone-200/80',
  amber: 'bg-white text-amber-800 ring-1 ring-inset ring-stone-200/80',
  crimson: 'bg-white text-red-700 ring-1 ring-inset ring-stone-200/80',
  sky: 'bg-white text-sky-800 ring-1 ring-inset ring-stone-200/80',
  slate: 'bg-white text-slate-700 ring-1 ring-inset ring-stone-200/80',
};

const STAT_TEXT_BY_TONE: Record<CardTone, string> = {
  emerald: 'text-[#0b3b24]',
  amber: 'text-amber-800',
  crimson: 'text-red-700',
  sky: 'text-sky-800',
  slate: 'text-slate-600',
};

function getTimeGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function RoleHomeDashboardPage({
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
  sessionMode = 'online_verified',
  lastServerVerifiedAtMs = null,
  lastUpdatedAt,
  pendingSyncCount,
  syncingCount,
  failedSyncCount,
  unreadNotificationCount,
  syncingNow,
  onManualSync,
  onNavigate,
}: RoleHomeDashboardPageProps) {
  const [now, setNow] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const dataset: RoleHomeDataset = useMemo(
    () => ({
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
      pendingSyncCount,
      failedSyncCount,
      unreadNotificationCount,
      isOnline,
    }),
    [
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
      pendingSyncCount,
      failedSyncCount,
      unreadNotificationCount,
      isOnline,
    ]
  );

  const locationScope = useMemo(
    () => resolveUserLocationScope(user, wards, pollingUnits),
    [user, wards, pollingUnits]
  );

  const summaryMetrics = useMemo(
    () => getRoleSummaryMetrics(dataset, now.getTime()),
    [dataset, now]
  );

  const moduleCards = useMemo(
    () => getRoleHomeCards(dataset, now.getTime()),
    [dataset, now]
  );

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return moduleCards;
    return moduleCards.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.statText.toLowerCase().includes(q)
    );
  }, [moduleCards, searchQuery]);

  const roleMeta = USER_ROLE_META[user.role];
  const greeting = getTimeGreeting(now);
  const formattedDate = now.toLocaleDateString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const formattedSyncTime = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('en-NG', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not synced yet';

  const syncStatusSummary =
    syncingNow || syncingCount > 0
      ? 'Synchronizing records'
      : failedSyncCount > 0
        ? `${failedSyncCount} sync failed`
        : pendingSyncCount > 0
          ? `${pendingSyncCount} pending sync`
          : isOnline
            ? `Synced at ${formattedSyncTime}`
            : `Offline cache · Last sync ${formattedSyncTime}`;

  return (
    <div className="space-y-6">
      {/* Top Identity, Welcome & Live Connectivity Masthead */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            {/* Brand + Date line */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 font-display font-bold tracking-tight text-[#0b3b24]">
                <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>FDMIS 2027</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span>{formattedDate}</span>
              </span>
            </div>

            {/* Welcome heading */}
            <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl [text-wrap:balance]">
              {greeting}, {user.displayName}
            </h2>

            {/* Role + Assigned Geographic Scope (unboxed clean metadata) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-slate-600">
              <span className="font-semibold text-[#0b3b24]">{roleMeta.label}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-slate-600">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span>{locationScope.summaryLine}</span>
              </span>
            </div>
          </div>

          {/* Notification Bell + Manual Sync Controls */}
          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              aria-label={
                unreadNotificationCount > 0
                  ? `Open notifications, ${unreadNotificationCount} unread`
                  : 'Open notifications'
              }
              className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-700 transition-colors hover:border-[#0b3b24]/40 hover:bg-emerald-50/60 hover:text-[#0b3b24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3b24]"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadNotificationCount > 0 ? (
                <span className="ml-1.5 font-mono text-xs font-bold tabular-nums text-red-700">
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </span>
              ) : (
                <span className="ml-1.5 hidden text-xs font-medium text-slate-600 sm:inline">
                  Alerts
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onManualSync}
              disabled={syncingNow}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0b3b24] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#092f1d] active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3b24] focus-visible:ring-offset-2 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-4 w-4 ${syncingNow ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{syncingNow ? 'Syncing' : 'Sync Now'}</span>
            </button>
          </div>
        </div>

        {/* Connectivity & Synchronization Hairline Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!isOnline || sessionMode === 'offline_trusted' ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                <WifiOff className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                <span>Offline Mode · Local Trusted Session</span>
              </span>
            ) : sessionMode === 'revalidating' ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-sky-800">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700" aria-hidden="true" />
                <span>Online · Revalidating Session</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                <Wifi className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>Online · Server Verified</span>
              </span>
            )}
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-600 font-mono tabular-nums">
              {failedSyncCount > 0 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
              ) : pendingSyncCount > 0 ? (
                <Clock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              )}
              <span>{syncStatusSummary}</span>
            </span>
          </div>

          {!isOnline || sessionMode === 'offline_trusted' ? (
            <span className="text-slate-500">
              {lastServerVerifiedAtMs
                ? `Last server check ${new Date(lastServerVerifiedAtMs).toLocaleString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })} · Auto-revalidates on reconnect`
                : 'Cached local session · Auto-revalidates on reconnect'}
            </span>
          ) : null}
        </div>
      </section>

      {/* Compact Personalized Summary Cards (4 Role-Specific Metrics) */}
      <section aria-label="Key Operational Summary">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryMetrics.map((metric) => {
            const clickable = Boolean(metric.targetSection);
            const Wrapper = clickable ? 'button' : 'div';
            return (
              <Wrapper
                key={metric.key}
                type={clickable ? 'button' : undefined}
                onClick={
                  clickable && metric.targetSection
                    ? () => onNavigate(metric.targetSection!)
                    : undefined
                }
                className={`group flex flex-col justify-between rounded-[18px] border border-stone-200/90 bg-[#F8F8F6] p-3.5 text-left transition-all duration-150 sm:p-4 ${
                  clickable
                    ? 'hover:border-[#0b3b24]/40 hover:bg-white active:scale-[0.98] active:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3b24]'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-slate-500">
                    {metric.label}
                  </span>
                  {clickable ? (
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-[#0b3b24]"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <p
                  className={`mt-2 truncate font-display text-xl font-bold tracking-tight tabular-nums sm:text-2xl ${STAT_TEXT_BY_TONE[metric.tone]}`}
                >
                  {metric.value}
                </p>
                <p className="mt-1 truncate text-[11px] text-slate-500 sm:text-xs">
                  {metric.detail}
                </p>
              </Wrapper>
            );
          })}
        </div>
      </section>

      {/* Responsive Clickable Module Cards Grid (2 cols mobile, 3 cols tablet, 4-5 cols desktop) */}
      <section aria-label="Authorized Modules">
        <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 sm:text-lg">
              Operational Modules
            </h3>
            <p className="text-xs text-slate-500">
              Select a module card below to open its dedicated workspace.
            </p>
          </div>

          {moduleCards.length >= 10 ? (
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter modules..."
                aria-label="Filter authorized modules"
                className="min-h-[40px] w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0b3b24] focus:outline-none focus:ring-2 focus:ring-[#0b3b24]/15"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {filteredCards.length === 0 ? (
          <div className="rounded-[18px] border border-stone-200/90 bg-[#F8F8F6] px-6 py-10 text-center">
            <p className="text-sm font-semibold text-slate-800">
              No module matches "{searchQuery}"
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Clear the filter to view all {moduleCards.length} modules assigned to your role.
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-4 inline-flex min-h-[40px] items-center rounded-xl border border-stone-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-stone-50"
            >
              Show All Modules
            </button>
          </div>
        ) : (
          <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
            {filteredCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => onNavigate(card.sectionId)}
                  className="group flex h-full min-h-[152px] flex-col justify-between rounded-[18px] border border-stone-200/90 bg-[#F8F8F6] p-3.5 text-left shadow-none transition-all duration-150 hover:border-[#0b3b24]/40 hover:bg-white active:scale-[0.97] active:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3b24] focus-visible:ring-offset-2 sm:min-h-[168px] sm:p-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-105 ${ICON_SURFACE_BY_TONE[card.tone]}`}
                      >
                        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                      </div>
                      <ArrowUpRight
                        className="h-4 w-4 shrink-0 text-stone-400 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#0b3b24]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    </div>

                    <div className="space-y-1">
                      <h4 className="font-display text-sm font-semibold leading-snug text-slate-900 group-hover:text-[#0b3b24] sm:text-[15px]">
                        {card.title}
                      </h4>
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-600 sm:text-xs">
                        {card.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-stone-200/70 pt-2.5">
                    <p
                      className={`truncate font-mono text-[11px] font-semibold tabular-nums ${STAT_TEXT_BY_TONE[card.tone]}`}
                    >
                      {card.statText}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
