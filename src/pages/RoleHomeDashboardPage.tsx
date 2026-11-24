import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  Shield,
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
import { NationalDomeBackdrop } from '../components/FdmisBrandMark';
import {
  getRoleHomeCards,
  getRoleSummaryMetrics,
  resolveUserLocationScope,
  type CardTint,
  type CardTone,
  type RoleHomeCardDef,
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

const FIELD_SECTION_IDS = new Set<NavSectionId>([
  'field_ops',
  'incidents',
  'polling_units',
  'wards',
  'operations_officers',
  'task_ops',
  'results',
  'verification',
  'notes',
]);

const TINT_CARD_CLASSES: Record<
  CardTint,
  {
    surface: string;
    icon: string;
    stat: string;
  }
> = {
  mint: {
    surface: 'bg-[#ECF8F1] border-[#D3ECDD] hover:border-[#168653]/45',
    icon: 'text-[#168653]',
    stat: 'text-[#06452F]',
  },
  sky: {
    surface: 'bg-[#ECF4FF] border-[#D2E4FD] hover:border-blue-500/45',
    icon: 'text-[#1D63DC]',
    stat: 'text-[#102B3F]',
  },
  amber: {
    surface: 'bg-[#FEF6E6] border-[#F8E2B8] hover:border-[#D99A32]/55',
    icon: 'text-[#168653]',
    stat: 'text-[#9A630A]',
  },
  violet: {
    surface: 'bg-[#F4EEFF] border-[#E3D5FC] hover:border-violet-500/45',
    icon: 'text-[#06452F]',
    stat: 'text-[#4C1D95]',
  },
  coral: {
    surface: 'bg-[#FEF0EE] border-[#FAD7D2] hover:border-[#DC4C45]/50',
    icon: 'text-[#DC4C45]',
    stat: 'text-[#B91C1C]',
  },
  slate: {
    surface: 'bg-[#F3F6FA] border-[#DCE4EE] hover:border-[#06452F]/35',
    icon: 'text-[#102B3F]',
    stat: 'text-[#102B3F]',
  },
};

function resolveCardTint(card: RoleHomeCardDef, index: number): CardTint {
  if (card.tint) return card.tint;
  if (card.sectionId === 'incidents' || card.sectionId === 'emergency_assistance') return 'coral';
  if (card.sectionId === 'polling_units' || card.sectionId === 'timeline') return 'sky';
  if (card.sectionId === 'verification' || card.sectionId === 'notifications') return 'amber';
  if (card.sectionId === 'task_ops' || card.sectionId === 'party_management') return 'violet';
  if (card.tone === 'crimson') return 'coral';
  if (card.tone === 'amber') return 'amber';
  if (card.tone === 'sky') return 'sky';
  if (card.tone === 'emerald') return 'mint';
  const fallbackCycle: CardTint[] = ['mint', 'sky', 'amber', 'violet', 'coral', 'slate'];
  return fallbackCycle[index % fallbackCycle.length];
}

function resolveMetricTint(tint: CardTint | undefined, tone: CardTone, index: number): CardTint {
  if (tint) return tint;
  if (tone === 'crimson') return 'coral';
  const cycle: CardTint[] = ['mint', 'sky', 'amber', 'violet'];
  return cycle[index % cycle.length];
}

function getTimeGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good Morning,';
  if (hour < 17) return 'Good Afternoon,';
  return 'Good Evening,';
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
  const [showSearch, setShowSearch] = useState(false);

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

  const { fieldCards, adminCards } = useMemo(() => {
    const field: RoleHomeCardDef[] = [];
    const admin: RoleHomeCardDef[] = [];
    for (const card of filteredCards) {
      const group = card.group ?? (FIELD_SECTION_IDS.has(card.sectionId) ? 'field' : 'admin');
      if (group === 'field') {
        field.push(card);
      } else {
        admin.push(card);
      }
    }
    // If a role only has a few cards total (e.g., Ordinary User / PU Agent), keep them unified cleanly
    if (field.length === 0 || (field.length + admin.length <= 9 && admin.length <= 4)) {
      return { fieldCards: filteredCards, adminCards: [] as RoleHomeCardDef[] };
    }
    return { fieldCards: field, adminCards: admin };
  }, [filteredCards]);

  const roleMeta = USER_ROLE_META[user.role];
  const greeting = getTimeGreeting(now);
  const formattedDate = now.toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const formattedSyncTime = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('en-NG', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const isOfflineMode = !isOnline || sessionMode === 'offline_trusted';

  const renderModuleCard = (card: RoleHomeCardDef, index: number) => {
    const Icon = card.icon;
    const tint = resolveCardTint(card, index);
    const palette = TINT_CARD_CLASSES[tint];
    return (
      <button
        key={card.key}
        type="button"
        onClick={() => onNavigate(card.sectionId)}
        className={`group flex h-full min-h-[106px] flex-col justify-between rounded-xl border p-2.5 text-left transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06452F] sm:min-h-[124px] sm:p-3.5 ${palette.surface}`}
      >
        <div className="flex items-start justify-between gap-1.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 shadow-[0_1px_2px_rgba(16,43,63,0.06)] sm:h-9 sm:w-9 ${palette.icon}`}>
            <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" strokeWidth={2} aria-hidden="true" />
          </div>
          <ChevronRight
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#102B3F]/40 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#06452F] sm:h-4 sm:w-4"
            aria-hidden="true"
          />
        </div>

        <div className="mt-2 min-w-0">
          <h4 className="line-clamp-2 font-display text-[11.5px] font-bold leading-tight text-[#102B3F] group-hover:text-[#06452F] sm:text-[13.5px]">
            {card.title}
          </h4>
          <p className="mt-0.5 hidden line-clamp-2 text-[11px] leading-snug text-slate-600 sm:block">
            {card.description}
          </p>
        </div>

        <p className={`mt-1.5 truncate font-mono text-[9.5px] font-semibold tabular-nums sm:text-[11px] ${palette.stat}`}>
          {card.statText}
        </p>
      </button>
    );
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Compact Forest-Green Welcome Hero Card (Matches Reference Image 1) */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#043B29] via-[#06452F] to-[#0D6242] p-4 text-white shadow-[0_6px_22px_rgba(4,59,41,0.18)] sm:p-5">
        <NationalDomeBackdrop className="pointer-events-none absolute -right-4 bottom-0 h-[112%] w-56 opacity-90 sm:right-0 sm:w-72" />

        <div className="relative z-10 flex flex-col gap-3">
          <div className="max-w-[76%] sm:max-w-[68%]">
            <p className="text-[15px] font-medium leading-snug text-emerald-50/95 sm:text-base">
              {greeting}
            </p>
            <h2 className="mt-0.5 truncate font-display text-[22px] font-extrabold leading-tight tracking-tight text-white sm:text-[26px]">
              {user.displayName}
            </h2>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-emerald-50/90 sm:text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                <Shield className="h-3.5 w-3.5 shrink-0 text-[#D8F5E3]" aria-hidden="true" />
                <span>{roleMeta.label}</span>
              </span>
              <span className="hidden text-emerald-200/60 sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="hidden truncate text-emerald-100/85 sm:inline">
                {locationScope.summaryLine}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-emerald-100/80 sm:hidden">
              {locationScope.summaryLine} · {formattedDate}
            </p>
          </div>

          {/* Status Pill + Sync Now Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {isOfflineMode ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-[11.5px] font-semibold text-amber-950 shadow-xs">
                  <WifiOff className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                  <span>Offline • Local Session</span>
                </span>
              ) : sessionMode === 'revalidating' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1.5 text-[11.5px] font-semibold text-sky-950 shadow-xs">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700" aria-hidden="true" />
                  <span>Online • Verifying</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#D8F5E3] px-3 py-1.5 text-[11.5px] font-semibold text-[#043B29] shadow-xs">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#168653]" aria-hidden="true" />
                  <span>Online • Server Verified</span>
                </span>
              )}

              {failedSyncCount > 0 ? (
                <button
                  type="button"
                  onClick={() => onNavigate('field_ops')}
                  className="inline-flex items-center gap-1 rounded-full bg-[#DC4C45] px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  <span>{failedSyncCount} Failed</span>
                </button>
              ) : pendingSyncCount > 0 ? (
                <button
                  type="button"
                  onClick={() => onNavigate('field_ops')}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-400/95 px-2.5 py-1 text-[11px] font-semibold text-[#043B29]"
                >
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{pendingSyncCount} Queued</span>
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onManualSync}
              disabled={syncingNow || syncingCount > 0}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-white/80 bg-[#043B29]/55 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-[2px] transition-colors hover:bg-white/15 active:scale-[0.98] disabled:opacity-65 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncingNow || syncingCount > 0 ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{syncingNow || syncingCount > 0 ? 'Syncing' : 'Sync Now'}</span>
            </button>
          </div>

          {isOfflineMode && lastServerVerifiedAtMs ? (
            <p className="text-[10.5px] text-emerald-100/80">
              Last verified{' '}
              {new Date(lastServerVerifiedAtMs).toLocaleString('en-NG', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · Auto-syncs on reconnect
            </p>
          ) : formattedSyncTime ? (
            <p className="hidden text-[11px] text-emerald-100/75 sm:block">
              {formattedDate} · Last synced {formattedSyncTime}
            </p>
          ) : null}
        </div>
      </section>

      {/* Key Metrics Section — Strictly 3 columns on mobile & tablet, 4 columns on desktop */}
      <section aria-label="Key Metrics" className="fdmis-surface p-3 sm:p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-[18px] w-[18px] shrink-0 text-[#06452F]" strokeWidth={2.4} aria-hidden="true" />
            <h3 className="font-display text-[15px] font-bold tracking-tight text-[#102B3F] sm:text-base">
              Key Metrics
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('overview')}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#06452F] transition-colors hover:bg-[#ECF8F1]"
          >
            <span>View All</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="fdmis-metrics-grid gap-2 sm:gap-3">
          {summaryMetrics.map((metric, idx) => {
            const clickable = Boolean(metric.targetSection);
            const Wrapper = clickable ? 'button' : 'div';
            const tint = resolveMetricTint(metric.tint, metric.tone, idx);
            const palette = TINT_CARD_CLASSES[tint];
            const MetricIcon = metric.icon ?? CheckCircle2;

            return (
              <Wrapper
                key={metric.key}
                type={clickable ? 'button' : undefined}
                onClick={
                  clickable && metric.targetSection
                    ? () => onNavigate(metric.targetSection!)
                    : undefined
                }
                className={`group flex min-w-0 flex-col justify-between rounded-xl border p-2.5 text-left transition-all duration-150 sm:p-3 ${palette.surface} ${
                  clickable
                    ? 'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06452F]'
                    : ''
                }`}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-full bg-white/85 shadow-[0_1px_2px_rgba(16,43,63,0.06)] sm:h-8 sm:w-8 ${palette.icon}`}>
                  <MetricIcon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" strokeWidth={2.2} aria-hidden="true" />
                </div>

                <p className="mt-2 truncate font-display text-xl font-extrabold leading-none tracking-tight text-[#102B3F] tabular-nums sm:text-2xl">
                  {metric.value}
                </p>

                <div className="mt-1.5 flex items-end justify-between gap-1">
                  <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-[#102B3F]/85 sm:text-xs">
                    {metric.label}
                  </span>
                  {clickable ? (
                    <ChevronRight
                      className="mb-0.5 h-3.5 w-3.5 shrink-0 text-[#102B3F]/45 transition-transform group-hover:translate-x-0.5 group-hover:text-[#06452F]"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <p className="mt-1 hidden truncate text-[10.5px] text-slate-600 sm:block">
                  {metric.detail}
                </p>
              </Wrapper>
            );
          })}
        </div>
      </section>

      {/* Field Operations Section — Strictly 3 equal-width cards per row on mobile, tablet & desktop */}
      <section aria-label="Field Operations" className="fdmis-surface p-3 sm:p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-[18px] w-[18px] shrink-0 text-[#06452F]" strokeWidth={2.4} aria-hidden="true" />
            <h3 className="font-display text-[15px] font-bold tracking-tight text-[#102B3F] sm:text-base">
              Field Operations
            </h3>
          </div>

          <div className="flex items-center gap-1.5">
            {moduleCards.length >= 8 ? (
              <button
                type="button"
                onClick={() => {
                  setShowSearch((v) => !v);
                  if (showSearch) setSearchQuery('');
                }}
                aria-label="Filter modules"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#06452F] transition-colors hover:bg-[#ECF8F1]"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Filter</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onNavigate('field_ops')}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#06452F] transition-colors hover:bg-[#ECF8F1]"
            >
              <span>More</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {showSearch ? (
          <div className="relative mb-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search your authorized modules..."
              aria-label="Filter authorized modules"
              className="min-h-[38px] w-full rounded-xl border border-slate-200 bg-[#F5F7FA] py-1.5 pl-9 pr-9 text-xs text-[#102B3F] placeholder:text-slate-400 focus:border-[#06452F] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        {filteredCards.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-[#F5F7FA] px-4 py-7 text-center">
            <p className="text-xs font-semibold text-[#102B3F]">
              No module matches "{searchQuery}"
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-2.5 inline-flex min-h-[34px] items-center rounded-xl bg-[#06452F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#043B29]"
            >
              Show All Modules
            </button>
          </div>
        ) : (
          <div className="fdmis-grid-3 auto-rows-fr gap-2 sm:gap-3">
            {fieldCards.map((card, index) => renderModuleCard(card, index))}
          </div>
        )}
      </section>

      {/* Governance & Administration Modules (3-column compact grid for roles with admin modules) */}
      {adminCards.length > 0 ? (
        <section aria-label="Governance & Administration" className="fdmis-surface p-3 sm:p-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="h-[18px] w-[18px] shrink-0 text-[#06452F]" strokeWidth={2.2} aria-hidden="true" />
              <h3 className="font-display text-[15px] font-bold tracking-tight text-[#102B3F] sm:text-base">
                Governance &amp; Administration
              </h3>
            </div>
            <span className="font-mono text-[11px] font-semibold text-slate-500 tabular-nums">
              {adminCards.length} modules
            </span>
          </div>

          <div className="fdmis-grid-3 auto-rows-fr gap-2 sm:gap-3">
            {adminCards.map((card, index) => renderModuleCard(card, index))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
