import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  ShieldAlert,
  StickyNote,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { BatteryMonitor } from './BatteryMonitor';
import { FdmisCrest } from './FdmisBrandMark';
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
  type SessionVerificationMode,
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
  sessionMode?: SessionVerificationMode;
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
  sessionMode = 'online_verified',
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [profileMenuOpen]);

  const allowedItems = NAV_ITEMS.filter((item) => item.visible(user.role));
  const currentItem = allowedItems.find((i) => i.id === activeSection) || allowedItems[0];
  const mobileBottomItems = allowedItems.slice(0, 4);
  const settingsAllowed = canAccessSettings(user.role);

  const handleNavigate = (id: NavSectionId) => {
    onSelectSection(id);
    setDrawerOpen(false);
    setProfileMenuOpen(false);
  };

  const formattedSyncTime = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : !isOnline || sessionMode === 'offline_trusted'
      ? 'Offline'
      : 'Syncing';

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-[#102B3F]">
      {/* Desktop Left Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200/90 bg-white lg:flex print:hidden">
        <div className="flex h-[58px] items-center gap-2 border-b border-slate-200/80 px-4">
          <FdmisCrest className="h-8 w-9 shrink-0" />
          <div className="h-6 w-px bg-slate-200" aria-hidden="true" />
          <div className="min-w-0 leading-none">
            <span className="block font-display text-base font-extrabold tracking-tight text-[#06452F]">
              FDMIS
            </span>
            <span className="mt-0.5 block truncate text-[10px] font-medium text-[#06452F]/80">
              Funtua-Dandume
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2.5" aria-label="Primary Navigation">
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
                className={`flex min-h-[38px] w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#06452F] text-white shadow-xs'
                    : 'text-[#102B3F]/80 hover:bg-[#F5F7FA] hover:text-[#06452F]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {showCriticalBadge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                      active ? 'bg-[#DC4C45] text-white' : 'bg-red-100 text-[#DC4C45]'
                    }`}
                  >
                    {criticalAlertCount}
                  </span>
                ) : showSyncBadge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                      active ? 'bg-amber-300 text-[#043B29]' : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {pendingSyncCount}
                  </span>
                ) : showNotifBadge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                      active ? 'bg-emerald-300 text-[#043B29]' : 'bg-[#DC4C45] text-white'
                    }`}
                  >
                    {unreadNotificationCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200/80 bg-[#FAFBFD] p-3.5">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-[#102B3F]">{user.displayName}</p>
            <p className="truncate text-[11px] text-slate-500">{formatAccountIdentifier(user)}</p>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RoleBadge role={user.role} />
          </div>
          <p className="mt-1.5 truncate text-[11px] text-slate-500">
            Scope: <span className="font-medium text-[#102B3F]">{formatAreaScope(user)}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400 tabular-nums">
            Auto-lock: {inactivityMinutes} min
          </p>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="mt-2.5 inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#102B3F] transition-colors hover:border-[#06452F]/30 hover:bg-[#F5F7FA]"
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
            className="fixed inset-0 bg-[#102B3F]/45 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
            <div className="flex h-[58px] items-center justify-between border-b border-slate-200 px-3.5">
              <div className="flex items-center gap-2">
                <FdmisCrest className="h-8 w-9 shrink-0" />
                <div className="h-6 w-px bg-slate-200" aria-hidden="true" />
                <div className="leading-none">
                  <span className="block font-display text-base font-extrabold tracking-tight text-[#06452F]">
                    FDMIS
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium text-[#06452F]/80">
                    Funtua-Dandume
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2.5">
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
                    className={`flex min-h-[40px] w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                      active
                        ? 'bg-[#06452F] text-white'
                        : 'text-[#102B3F]/85 hover:bg-[#F5F7FA]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {showCriticalBadge ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                          active ? 'bg-[#DC4C45] text-white' : 'bg-red-100 text-[#DC4C45]'
                        }`}
                      >
                        {criticalAlertCount}
                      </span>
                    ) : showNotifBadge ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                          active ? 'bg-emerald-300 text-[#043B29]' : 'bg-[#DC4C45] text-white'
                        }`}
                      >
                        {unreadNotificationCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-slate-200 bg-[#FAFBFD] p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <BatteryMonitor onBatteryUpdate={onBatteryUpdate} />
                <PWAInstallButton compact />
              </div>
              <p className="truncate text-xs font-bold text-[#102B3F]">{user.displayName}</p>
              <p className="truncate text-[11px] text-slate-500">{formatAccountIdentifier(user)}</p>
              <div className="mt-1.5">
                <RoleBadge role={user.role} />
              </div>
              <p className="mt-1.5 truncate text-[11px] text-slate-500">
                Scope: <span className="font-medium text-[#102B3F]">{formatAreaScope(user)}</span>
              </p>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="mt-2.5 inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:pl-60 print:pl-0">
        <header className="sticky top-0 z-20 flex h-[58px] items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-3 shadow-[0_1px_4px_rgba(16,43,63,0.03)] sm:px-5 lg:px-6 print:hidden">
          {/* Left Header Cluster */}
          <div className="flex min-w-0 items-center gap-2">
            {/* Forest-green rounded-xl mobile hamburger button */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#06452F] text-white shadow-xs transition-colors hover:bg-[#043B29] active:scale-95 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            {activeSection === 'home' ? (
              <>
                {/* Reference Image 1 Mobile/Tablet Institutional Brand Header */}
                <div className="flex min-w-0 items-center gap-2 lg:hidden">
                  <div className="h-7 w-px bg-slate-200" aria-hidden="true" />
                  <FdmisCrest className="h-9 w-10 shrink-0" />
                  <div className="h-7 w-px bg-slate-200" aria-hidden="true" />
                  <div className="min-w-0 leading-none">
                    <span className="block font-display text-[18px] font-extrabold tracking-tight text-[#06452F]">
                      FDMIS
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] font-medium text-[#06452F]/85">
                      Funtua-Dandume
                    </span>
                  </div>
                </div>
                {/* Desktop Title on Home */}
                <h1 className="hidden truncate font-display text-base font-bold text-[#102B3F] lg:block">
                  Home Dashboard
                </h1>
              </>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                {canGoBack && onGoBack ? (
                  <button
                    type="button"
                    onClick={onGoBack}
                    title={previousSectionLabel ? `Back to ${previousSectionLabel}` : 'Go Back'}
                    aria-label={previousSectionLabel ? `Back to ${previousSectionLabel}` : 'Go Back'}
                    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-[#F5F7FA] px-2.5 text-xs font-semibold text-[#102B3F] transition-colors hover:border-[#06452F]/40 hover:bg-emerald-50/50"
                  >
                    <ArrowLeft className="h-4 w-4 text-[#06452F]" aria-hidden="true" />
                    <span className="hidden sm:inline">Back</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleNavigate('home')}
                  title="Return to Home Dashboard"
                  aria-label="Return to Home Dashboard"
                  className="hidden sm:inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
                >
                  <Home className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                  <span className="hidden md:inline">Home</span>
                </button>
                <h1 className="truncate font-display text-sm font-bold text-[#102B3F] sm:text-base">
                  {currentItem?.label}
                </h1>
              </div>
            )}
          </div>

          {/* Right Header Cluster */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Desktop compact telemetry & sync controls */}
            <div className="hidden items-center gap-1.5 lg:flex">
              <BatteryMonitor onBatteryUpdate={onBatteryUpdate} />
              <PWAInstallButton compact />
              {!isOnline || sessionMode === 'offline_trusted' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 whitespace-nowrap">
                  <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Offline</span>
                </span>
              ) : sessionMode === 'revalidating' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900 whitespace-nowrap">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700" aria-hidden="true" />
                  <span>Verifying</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-[#168653] whitespace-nowrap">
                  <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Online</span>
                </span>
              )}

              {syncingNow || syncingCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900 whitespace-nowrap">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  <span>Syncing</span>
                </span>
              ) : failedSyncCount > 0 ? (
                <button
                  type="button"
                  onClick={isOnline ? onManualSync : () => handleNavigate('field_ops')}
                  className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-[#DC4C45] hover:bg-red-100 whitespace-nowrap"
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  <span>{failedSyncCount} Failed</span>
                </button>
              ) : pendingSyncCount > 0 ? (
                <button
                  type="button"
                  onClick={isOnline ? onManualSync : () => handleNavigate('field_ops')}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                >
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{pendingSyncCount} Pending</span>
                </button>
              ) : isOnline && lastUpdatedAt ? (
                <span className="hidden xl:inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-[#168653] whitespace-nowrap">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  <span>Synced</span>
                </span>
              ) : null}

              <button
                type="button"
                onClick={onManualSync}
                disabled={syncingNow}
                title="Refresh and synchronize records"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-[#F5F7FA] px-2.5 text-xs font-semibold text-[#102B3F] hover:border-[#06452F]/35 hover:bg-white disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#06452F] ${syncingNow ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="font-mono tabular-nums">{formattedSyncTime}</span>
              </button>
            </div>

            {/* Mobile compact offline/sync badge only when on sub-pages & offline/pending */}
            {activeSection !== 'home' && (!isOnline || pendingSyncCount > 0 || failedSyncCount > 0) ? (
              <button
                type="button"
                onClick={isOnline ? onManualSync : () => handleNavigate('field_ops')}
                aria-label="Sync status"
                className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-[10px] font-bold lg:hidden ${
                  failedSyncCount > 0
                    ? 'bg-red-100 text-[#DC4C45]'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {!isOnline ? (
                  <WifiOff className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <RefreshCw className={`h-3 w-3 ${syncingNow ? 'animate-spin' : ''}`} aria-hidden="true" />
                )}
                <span>{!isOnline ? 'Offline' : pendingSyncCount || failedSyncCount}</span>
              </button>
            ) : null}

            {/* Notification Bell with Red Unread Badge (Reference Image 1) */}
            <button
              type="button"
              onClick={() => handleNavigate('notifications')}
              aria-label={
                unreadNotificationCount > 0
                  ? `Notifications, ${unreadNotificationCount} unread`
                  : 'Notifications'
              }
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-[#102B3F] transition-colors hover:bg-[#F5F7FA] active:scale-95"
            >
              <Bell className="h-[21px] w-[21px]" strokeWidth={2} aria-hidden="true" />
              {unreadNotificationCount > 0 ? (
                <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC4C45] px-1 font-mono text-[10px] font-bold leading-none text-white ring-2 ring-white tabular-nums">
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </span>
              ) : null}
            </button>

            {/* Circular Profile Button & Account Popover (Reference Image 1) */}
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                aria-label="Account profile and sign out"
                aria-expanded={profileMenuOpen}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E8F1EC] text-[#06452F] transition-colors hover:bg-[#D7E9DF] active:scale-95"
              >
                <User className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
              </button>

              {profileMenuOpen ? (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl z-40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#102B3F]">{user.displayName}</p>
                    <p className="truncate text-xs text-slate-500">{formatAccountIdentifier(user)}</p>
                  </div>
                  <div className="mt-2">
                    <RoleBadge role={user.role} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Scope: <span className="font-semibold text-[#102B3F]">{formatAreaScope(user)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                    Auto-lock: {inactivityMinutes} min · {isOnline ? 'Online' : 'Offline'}
                  </p>

                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
                    {settingsAllowed ? (
                      <button
                        type="button"
                        onClick={() => handleNavigate('settings')}
                        className="flex min-h-[36px] w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
                      >
                        <Settings className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                        <span>Settings & Security</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        void onSignOut();
                      }}
                      className="flex min-h-[36px] w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#DC4C45] hover:bg-red-50"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-3 pb-20 sm:px-5 sm:py-4 lg:px-6 lg:py-5 lg:pb-8 print:p-0">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation (4 items, Reference Image 1 solid green capsule active pill) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-20 grid h-[64px] items-center gap-1 border-t border-slate-200/90 bg-white/98 px-2 py-1.5 shadow-[0_-4px_16px_rgba(16,43,63,0.06)] backdrop-blur-sm lg:hidden print:hidden"
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
              className={`flex h-full min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 text-[11px] font-semibold transition-all ${
                active
                  ? 'bg-[#06452F] text-white shadow-xs'
                  : 'text-[#102B3F]/70 hover:bg-[#F5F7FA] hover:text-[#06452F]'
              }`}
            >
              <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.2 : 1.85} aria-hidden="true" />
              <span className="max-w-full truncate leading-tight">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
