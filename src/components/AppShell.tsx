import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
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
  Home,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MapPin,
  Menu,
  PhoneCall,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  StickyNote,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { BatteryMonitor } from './BatteryMonitor';
import { PWAInstallButton } from './PWAInstallButton';
import {
  LGA_DEFINITIONS,
  UserRole,
  canAccessAnalyticsReports,
  canAccessSettings,
  canManageOperationsOfficers,
  canManageParties,
  canManageTestData,
  canManageUsers,
  canVerifyResults,
  canViewAuditLogs,
  canViewTasksModule,
  type LgaId,
  type UserAccount,
} from '../types/fdmis';
import { formatAccountIdentifier } from '../utils/phoneAuth';
import { RoleBadge } from './StatusBadge';

export type NavSectionId =
  | 'home'
  | 'overview'
  | 'wards'
  | 'polling_units'
  | 'field_ops'
  | 'notes'
  | 'incidents'
  | 'results'
  | 'verification'
  | 'party_management'
  | 'operations_officers'
  | 'task_ops'
  | 'timeline'
  | 'reports'
  | 'notifications'
  | 'emergency_assistance'
  | 'public_portal'
  | 'users'
  | 'data_management'
  | 'audit_logs'
  | 'settings';

export interface NavItem {
  id: NavSectionId;
  label: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
  visible: (role: UserRole) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    shortLabel: 'Home',
    icon: Home,
    visible: (role) => role !== UserRole.PENDING,
  },
  {
    id: 'overview',
    label: 'Situation Room',
    shortLabel: 'Room',
    icon: LayoutDashboard,
    visible: () => true,
  },
  {
    id: 'field_ops',
    label: 'Field Check-Ins & Sync',
    shortLabel: 'Field',
    icon: Radio,
    visible: () => true,
  },
  {
    id: 'notes',
    label: 'Notes & Messages',
    shortLabel: 'Notes',
    icon: StickyNote,
    visible: (role) => role !== UserRole.PENDING,
  },
  {
    id: 'incidents',
    label: 'Incidents & Alerts',
    shortLabel: 'Alerts',
    icon: AlertTriangle,
    visible: () => true,
  },
  {
    id: 'results',
    label: 'Results & EC8A',
    shortLabel: 'Results',
    icon: ClipboardCheck,
    visible: (role) => role !== UserRole.ORDINARY_USER && role !== UserRole.PENDING,
  },
  {
    id: 'verification',
    label: 'Verification Center',
    shortLabel: 'Verify',
    icon: FileCheck2,
    visible: (role) => canVerifyResults(role),
  },
  {
    id: 'party_management',
    label: 'Party Management',
    shortLabel: 'Parties',
    icon: Flag,
    visible: (role) => canManageParties(role),
  },
  {
    id: 'operations_officers',
    label: 'Operations Officers',
    shortLabel: 'Officers',
    icon: ShieldAlert,
    visible: (role) => canManageOperationsOfficers(role) || role === UserRole.OPERATIONS_OFFICER,
  },
  {
    id: 'task_ops',
    label: 'Task Assignment',
    shortLabel: 'Tasks',
    icon: ListTodo,
    visible: (role) => canViewTasksModule(role),
  },
  {
    id: 'timeline',
    label: 'Election Timeline',
    shortLabel: 'Timeline',
    icon: Clock,
    visible: () => true,
  },
  {
    id: 'wards',
    label: 'LGAs & Wards',
    shortLabel: 'Wards',
    icon: Building2,
    visible: () => true,
  },
  {
    id: 'polling_units',
    label: 'Polling Units',
    shortLabel: 'Units',
    icon: MapPin,
    visible: () => true,
  },
  {
    id: 'reports',
    label: 'Reports & Exports',
    shortLabel: 'Reports',
    icon: FileBarChart2,
    visible: (role) => canAccessAnalyticsReports(role),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    shortLabel: 'Alerts',
    icon: Bell,
    visible: () => true,
  },
  {
    id: 'emergency_assistance',
    label: 'Emergency Assistance',
    shortLabel: 'SOS',
    icon: PhoneCall,
    visible: (role) => role !== UserRole.PENDING,
  },
  {
    id: 'public_portal',
    label: 'Public Results View',
    shortLabel: 'Public',
    icon: Globe,
    visible: () => true,
  },
  {
    id: 'users',
    label: 'User & Access Control',
    shortLabel: 'Users',
    icon: Users,
    visible: (role) => canManageUsers(role) || role === UserRole.WARD_COORDINATOR,
  },
  {
    id: 'data_management',
    label: 'Data Management',
    shortLabel: 'Data',
    icon: Database,
    visible: (role) => canManageTestData(role),
  },
  {
    id: 'audit_logs',
    label: 'Audit Logs',
    shortLabel: 'Audit',
    icon: ClipboardList,
    visible: (role) => canViewAuditLogs(role),
  },
  {
    id: 'settings',
    label: 'Settings & Security',
    shortLabel: 'Settings',
    icon: Settings,
    visible: (role) => canAccessSettings(role),
  },
];

interface AppShellProps {
  user: UserAccount;
  activeSection: NavSectionId;
  onSelectSection: (id: NavSectionId) => void;
  canGoBack?: boolean;
  previousSectionLabel?: string | null;
  onGoBack?: () => void;
  onSignOut: () => Promise<void>;
  inactivityMinutes: number;
  isOnline: boolean;
  pendingSyncCount: number;
  syncingCount?: number;
  failedSyncCount?: number;
  criticalAlertCount: number;
  unreadNotificationCount?: number;
  lastUpdatedAt: Date | null;
  onManualSync: () => void;
  onBatteryUpdate?: (levelPercent: number | null, charging: boolean | null) => void;
  syncingNow?: boolean;
  children: ReactNode;
}

function formatAreaScope(user: UserAccount): string {
  if (user.role === UserRole.FULL_CONTROL_ADMIN) {
    return 'Funtua & Dandume LGAs';
  }
  if (user.role === UserRole.FUNTUA_SUPER_ADMIN) {
    return LGA_DEFINITIONS.funtua.displayName;
  }
  if (user.role === UserRole.DANDUME_SUPER_ADMIN) {
    return LGA_DEFINITIONS.dandume.displayName;
  }
  if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) return `Ward ${user.assignedWardId}`;
    if (user.assignedLgaId && user.assignedLgaId in LGA_DEFINITIONS) {
      return LGA_DEFINITIONS[user.assignedLgaId as LgaId].displayName;
    }
    return 'Funtua & Dandume (Constituency)';
  }
  if (user.role === UserRole.OPERATIONS_OFFICER || user.role === UserRole.WARD_COORDINATOR) {
    return user.assignedWardId ? `Ward ${user.assignedWardId}` : 'Assigned Ward';
  }
  if (user.role === UserRole.POLLING_UNIT_AGENT || user.role === UserRole.ORDINARY_USER) {
    return user.assignedPollingUnitId ? `PU ${user.assignedPollingUnitId}` : 'Assigned PU';
  }
  return 'Unassigned';
}

export function AppShell({
  user,
  activeSection,
  onSelectSection,
  canGoBack = false,
  previousSectionLabel = null,
  onGoBack,
  onSignOut,
  inactivityMinutes,
  isOnline,
  pendingSyncCount,
  syncingCount = 0,
  failedSyncCount = 0,
  criticalAlertCount,
  unreadNotificationCount = 0,
  lastUpdatedAt,
  onManualSync,
  onBatteryUpdate,
  syncingNow = false,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const allowedItems = NAV_ITEMS.filter((item) => item.visible(user.role));
  const currentItem = allowedItems.find((i) => i.id === activeSection) || allowedItems[0];
  const mobileBottomItems = allowedItems.slice(0, 4);

  const handleNavigate = (id: NavSectionId) => {
    onSelectSection(id);
    setDrawerOpen(false);
  };

  const formattedSyncTime = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Connecting...';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Left Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex print:hidden">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
            <Shield className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            FDMIS 2027
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Primary Navigation">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeSection;
            const showCriticalBadge = item.id === 'incidents' && criticalAlertCount > 0;
            const showSyncBadge = item.id === 'field_ops' && pendingSyncCount > 0;
            const showNotifBadge = item.id === 'notifications' && unreadNotificationCount > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0b3b24] text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {showCriticalBadge ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                      active ? 'bg-red-500 text-white' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {criticalAlertCount}
                  </span>
                ) : showSyncBadge ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                      active ? 'bg-amber-400 text-slate-900' : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {pendingSyncCount}
                  </span>
                ) : showNotifBadge ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                      active ? 'bg-emerald-400 text-slate-950' : 'bg-emerald-100 text-[#0b3b24]'
                    }`}
                  >
                    {unreadNotificationCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{user.displayName}</p>
            <p className="truncate text-xs text-slate-500">{formatAccountIdentifier(user)}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <RoleBadge role={user.role} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Scope: <span className="font-medium text-slate-700">{formatAreaScope(user)}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Auto-lock: {inactivityMinutes} min
          </p>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="font-display text-base font-bold text-slate-900">FDMIS 2027</span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {allowedItems.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeSection;
                const showCriticalBadge = item.id === 'incidents' && criticalAlertCount > 0;
                const showNotifBadge = item.id === 'notifications' && unreadNotificationCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[#0b3b24] text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {showCriticalBadge ? (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                          active ? 'bg-red-500 text-white' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {criticalAlertCount}
                      </span>
                    ) : showNotifBadge ? (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                          active ? 'bg-emerald-400 text-slate-950' : 'bg-emerald-100 text-[#0b3b24]'
                        }`}
                      >
                        {unreadNotificationCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-slate-200 p-4">
              <p className="truncate text-sm font-semibold text-slate-900">{user.displayName}</p>
              <p className="truncate text-xs text-slate-500">{formatAccountIdentifier(user)}</p>
              <div className="mt-2">
                <RoleBadge role={user.role} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Scope: <span className="font-medium text-slate-700">{formatAreaScope(user)}</span>
              </p>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-[54px] items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:h-14 lg:px-8 print:hidden">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            {canGoBack && onGoBack ? (
              <button
                type="button"
                onClick={onGoBack}
                title={previousSectionLabel ? `Back to ${previousSectionLabel}` : 'Go Back'}
                aria-label={previousSectionLabel ? `Back to ${previousSectionLabel}` : 'Go Back'}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:border-[#0b3b24]/40 hover:bg-slate-100"
              >
                <ArrowLeft className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
                <span>Back</span>
                {previousSectionLabel ? (
                  <span className="hidden max-w-[140px] truncate font-normal text-slate-500 xl:inline">
                    · {previousSectionLabel}
                  </span>
                ) : null}
              </button>
            ) : null}
            {activeSection !== 'home' ? (
              <button
                type="button"
                onClick={() => handleNavigate('home')}
                title="Home Dashboard"
                aria-label="Home Dashboard"
                className="hidden sm:inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Home className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
                <span className="hidden md:inline">Home</span>
              </button>
            ) : null}
            <h1 className="truncate font-display text-base font-semibold text-slate-900 lg:text-lg">
              {currentItem?.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <BatteryMonitor onBatteryUpdate={onBatteryUpdate} />
            <PWAInstallButton compact />
            {!isOnline ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                <span>OFFLINE</span>
              </span>
            ) : (
              <span className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 whitespace-nowrap">
                <Wifi className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>ONLINE</span>
              </span>
            )}
            {syncingNow || syncingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-900 whitespace-nowrap">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700" aria-hidden="true" />
                <span>SYNCHRONIZING</span>
              </span>
            ) : failedSyncCount > 0 ? (
              <button
                type="button"
                onClick={isOnline ? onManualSync : () => handleNavigate('field_ops')}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-900 hover:bg-red-100 whitespace-nowrap"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
                <span>{failedSyncCount} SYNC FAILED</span>
              </button>
            ) : pendingSyncCount > 0 ? (
              <button
                type="button"
                onClick={isOnline ? onManualSync : () => handleNavigate('field_ops')}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900 hover:bg-amber-100 whitespace-nowrap"
              >
                <Clock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                <span>{pendingSyncCount} PENDING SYNCHRONIZATION</span>
              </button>
            ) : isOnline && lastUpdatedAt ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 whitespace-nowrap">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>SYNCHRONIZED</span>
              </span>
            ) : null}
            <button
              type="button"
              onClick={onManualSync}
              disabled={syncingNow}
              title="Refresh and synchronize records"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#0b3b24] ${syncingNow ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline font-mono tabular-nums">
                {formattedSyncTime}
              </span>
              <span className="sm:hidden">Sync</span>
            </button>
            <span className="hidden text-xs text-slate-600 xl:inline">
              {formatAreaScope(user)}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-10 print:p-0">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation (<= 4 items, compact 58px) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-20 grid h-[58px] border-t border-slate-200 bg-white/95 backdrop-blur-sm lg:hidden print:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileBottomItems.length}, minmax(0, 1fr))` }}
      >
        {mobileBottomItems.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeSection;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors ${
                active ? 'text-[#0b3b24]' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="truncate max-w-full">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
