import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Battery,
  BatteryCharging,
  CheckCircle2,
  Eye,
  KeyRound,
  Lock,
  Plus,
  RotateCcw,
  ShieldAlert,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { AccountStatusBadge, RoleBadge } from '../components/StatusBadge';
import {
  AccountStatus,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  USER_ROLE_META,
  UserRole,
  canManageOperationsOfficers,
  formatFirestoreTime,
  type AgentCheckIn,
  type IncidentReport,
  type LgaId,
  type OperationalNote,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  assignOperationsOfficerToWard,
  computeWardOperationsCoverage,
  reactivateUser,
  revokeOrSuspendUser,
} from '../services/directoryService';
import {
  adminInitiateUserPasswordReset,
  provisionOperationsOfficerAccount,
} from '../services/authService';
import { formatAccountIdentifier } from '../utils/phoneAuth';

interface OperationsOfficersPageProps {
  currentUser: UserAccount;
  users: UserAccount[];
  wards: Ward[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  notes: OperationalNote[];
  isOnline: boolean;
  loading: boolean;
}

function renderBatteryCell(u: UserAccount) {
  if (typeof u.batteryLevel !== 'number') {
    return <span className="text-xs text-slate-400">N/A</span>;
  }
  const charging = Boolean(u.batteryCharging);
  const low = u.batteryLevel <= 20 && !charging;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
        charging
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : low
            ? 'border-red-200 bg-red-50 text-red-900'
            : 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      {charging ? (
        <BatteryCharging className="h-3 w-3 text-emerald-700" aria-hidden="true" />
      ) : (
        <Battery className="h-3 w-3 text-slate-600" aria-hidden="true" />
      )}
      <span>{u.batteryLevel}%</span>
    </span>
  );
}

export function OperationsOfficersPage({
  currentUser,
  users,
  wards,
  checkIns,
  incidents,
  notes,
  isOnline,
  loading,
}: OperationsOfficersPageProps) {
  const canManage = canManageOperationsOfficers(currentUser.role);
  const isFullAdmin = currentUser.role === UserRole.FULL_CONTROL_ADMIN;

  const [lgaFilter, setLgaFilter] = useState<'ALL' | LgaId>('ALL');
  const [wardFilter, setWardFilter] = useState<string>('ALL');
  const [coverageFilter, setCoverageFilter] = useState<'ALL' | 'UNDERSTAFFED' | 'COMPLIANT'>('ALL');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Create new officer modal (Full Admin only)
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newLgaId, setNewLgaId] = useState<LgaId>('funtua');
  const [newWardId, setNewWardId] = useState('');

  // Promote / reassign existing user modal
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTargetUid, setAssignTargetUid] = useState('');
  const [assignLgaId, setAssignLgaId] = useState<LgaId>(
    currentUser.role === UserRole.DANDUME_SUPER_ADMIN ? 'dandume' : 'funtua'
  );
  const [assignWardId, setAssignWardId] = useState('');

  // Suspend officer modal
  const [suspendingOfficer, setSuspendingOfficer] = useState<UserAccount | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Inspect officer modal
  const [inspectingOfficer, setInspectingOfficer] = useState<UserAccount | null>(null);

  const wardById = useMemo(() => {
    const map = new Map<string, Ward>();
    wards.forEach((w) => map.set(w.id, w));
    return map;
  }, [wards]);

  const wardCoverage = useMemo(
    () => computeWardOperationsCoverage(wards, users, MIN_OPERATIONS_OFFICERS_PER_WARD),
    [wards, users]
  );

  const filteredCoverage = useMemo(() => {
    return wardCoverage.filter((item) => {
      if (lgaFilter !== 'ALL' && item.lgaId !== lgaFilter) return false;
      if (wardFilter !== 'ALL' && item.wardId !== wardFilter) return false;
      if (coverageFilter === 'UNDERSTAFFED' && item.isCompliant) return false;
      if (coverageFilter === 'COMPLIANT' && !item.isCompliant) return false;
      return true;
    });
  }, [wardCoverage, lgaFilter, wardFilter, coverageFilter]);

  const operationsOfficers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => u.role === UserRole.OPERATIONS_OFFICER)
      .filter((u) => {
        if (lgaFilter !== 'ALL' && u.assignedLgaId !== lgaFilter) return false;
        if (wardFilter !== 'ALL' && u.assignedWardId !== wardFilter) return false;
        if (!q) return true;
        const w = wardById.get(u.assignedWardId);
        return (
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q) ||
          (w?.name || '').toLowerCase().includes(q) ||
          (w?.wardCode || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [users, lgaFilter, wardFilter, search, wardById]);

  const metrics = useMemo(() => {
    const totalActive = wardCoverage.reduce((acc, w) => acc + w.activeCount, 0);
    const compliantWards = wardCoverage.filter((w) => w.isCompliant).length;
    const understaffedWards = wardCoverage.length - compliantWards;
    const remainingVacancies = wardCoverage.reduce((acc, w) => acc + w.vacancyCount, 0);
    return {
      totalActive,
      compliantWards,
      understaffedWards,
      remainingVacancies,
    };
  }, [wardCoverage]);

  const eligibleUsersForPromotion = useMemo(() => {
    return users
      .filter((u) => u.role !== UserRole.FULL_CONTROL_ADMIN)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [users]);

  const createModalWards = useMemo(
    () => wards.filter((w) => w.lgaId === newLgaId).sort((a, b) => a.name.localeCompare(b.name)),
    [wards, newLgaId]
  );

  const assignModalWards = useMemo(
    () => wards.filter((w) => w.lgaId === assignLgaId).sort((a, b) => a.name.localeCompare(b.name)),
    [wards, assignLgaId]
  );

  const filterDropdownWards = useMemo(() => {
    return wards
      .filter((w) => lgaFilter === 'ALL' || w.lgaId === lgaFilter)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [wards, lgaFilter]);

  const openAssignForWard = (lgaId: LgaId, wardId: string, presetUid = '') => {
    setAssignTargetUid(presetUid);
    setAssignLgaId(lgaId);
    setAssignWardId(wardId);
    setAssignOpen(true);
  };

  const openCreateForWard = (lgaId: LgaId, wardId: string) => {
    setNewLgaId(lgaId);
    setNewWardId(wardId);
    setCreateOpen(true);
  };

  const handleCreateOfficer = async (e: FormEvent) => {
    e.preventDefault();
    const targetWard = wardById.get(newWardId);
    if (!targetWard) {
      setFeedback({ type: 'err', text: 'Select a valid Ward from the list.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const created = await provisionOperationsOfficerAccount(currentUser, {
        fullName: newName,
        email: newEmail,
        phone: newPhone,
        password: newPassword,
        lgaId: newLgaId,
        wardId: targetWard.id,
        wardName: targetWard.name,
      });
      setFeedback({
        type: 'ok',
        text: `Operations Officer ${created.displayName} created and assigned to ${targetWard.name} Ward.`,
      });
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewPassword('');
      setCreateOpen(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to create Operations Officer account.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAssignExisting = async (e: FormEvent) => {
    e.preventDefault();
    const targetUser = users.find((u) => u.uid === assignTargetUid);
    const targetWard = wardById.get(assignWardId);
    if (!targetUser || !targetWard) {
      setFeedback({ type: 'err', text: 'Select both a registered user and target Ward.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await assignOperationsOfficerToWard(currentUser, targetUser, assignLgaId, targetWard.id);
      setFeedback({
        type: 'ok',
        text: `Assigned ${targetUser.displayName} as Operations Officer for ${targetWard.name} (${LGA_DEFINITIONS[assignLgaId].shortName}).`,
      });
      setAssignOpen(false);
      setAssignTargetUid('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to assign Operations Officer.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSuspendOfficer = async (e: FormEvent) => {
    e.preventDefault();
    if (!suspendingOfficer) return;
    setBusy(true);
    setFeedback(null);
    try {
      await revokeOrSuspendUser(currentUser, suspendingOfficer, suspendReason);
      setFeedback({
        type: 'ok',
        text: `Suspended Operations Officer ${suspendingOfficer.displayName}.`,
      });
      setSuspendingOfficer(null);
      setSuspendReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Suspension failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReactivateOfficer = async (officer: UserAccount) => {
    setBusy(true);
    setFeedback(null);
    try {
      await reactivateUser(currentUser, officer);
      setFeedback({
        type: 'ok',
        text: `Reactivated Operations Officer ${officer.displayName}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Reactivation failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerPasswordReset = async (officer: UserAccount) => {
    setBusy(true);
    setFeedback(null);
    try {
      const sentTo = await adminInitiateUserPasswordReset(currentUser, officer);
      setFeedback({
        type: 'ok',
        text: `Sent real password reset link to ${sentTo} for ${officer.displayName}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to send password reset email.',
      });
    } finally {
      setBusy(false);
    }
  };

  const inspectedActivity = useMemo(() => {
    if (!inspectingOfficer) return null;
    const officerCheckIns = checkIns.filter((c) => c.agentUid === inspectingOfficer.uid);
    const officerIncidents = incidents.filter((i) => i.reporterUid === inspectingOfficer.uid);
    const officerNotes = notes.filter((n) => n.authorUid === inspectingOfficer.uid);
    return {
      checkIns: officerCheckIns,
      incidents: officerIncidents,
      notes: officerNotes,
    };
  }, [inspectingOfficer, checkIns, incidents, notes]);

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-[#0b3b24]" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              Operations Officers Management
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Minimum {MIN_OPERATIONS_OFFICERS_PER_WARD} active Operations Officers required per Ward across all {wards.length || 22} constituency wards. Additional officers above {MIN_OPERATIONS_OFFICERS_PER_WARD} are allowed where operational demand requires.
          </p>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isFullAdmin ? (
              <button
                type="button"
                disabled={!isOnline}
                onClick={() => openCreateForWard('funtua', createModalWards[0]?.id || '')}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[#0b3b24] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115233] disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                <span>Create Officer</span>
              </button>
            ) : null}
            <button
              type="button"
              disabled={!isOnline}
              onClick={() => openAssignForWard(assignLgaId, assignModalWards[0]?.id || '')}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <Plus className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
              <span>Assign Existing User</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Active Operations Officers</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {metrics.totalActive}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-xs font-medium text-emerald-900">Compliant Wards (&ge; 5)</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-900">
            {metrics.compliantWards} / {wardCoverage.length || 22}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-xs font-medium text-amber-900">Wards Below Minimum (&lt; 5)</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-900">
            {metrics.understaffedWards}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Minimum Slots Remaining</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {metrics.remainingVacancies}
          </p>
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

      {/* Filter Bar */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search officer name, email, phone, ward..."
          className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
        />

        <select
          value={lgaFilter}
          onChange={(e) => {
            setLgaFilter(e.target.value as 'ALL' | LgaId);
            setWardFilter('ALL');
          }}
          className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="ALL">All LGAs (Funtua &amp; Dandume)</option>
          <option value="funtua">Funtua LGA (20-14)</option>
          <option value="dandume">Dandume LGA (20/07)</option>
        </select>

        <select
          value={wardFilter}
          onChange={(e) => setWardFilter(e.target.value)}
          className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="ALL">All Wards ({filterDropdownWards.length})</option>
          {filterDropdownWards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.wardCode})
            </option>
          ))}
        </select>

        <select
          value={coverageFilter}
          onChange={(e) =>
            setCoverageFilter(e.target.value as 'ALL' | 'UNDERSTAFFED' | 'COMPLIANT')
          }
          className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="ALL">All Ward Coverage</option>
          <option value="UNDERSTAFFED">Understaffed Wards (&lt; 5)</option>
          <option value="COMPLIANT">Compliant Wards (&ge; 5)</option>
        </select>
      </div>

      {/* Ward Staffing Coverage Grid */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Ward Operations Officer Coverage ({filteredCoverage.length} Wards)
          </h3>
          <span className="text-xs text-slate-500">Target minimum: 5 active officers per ward</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCoverage.map((item) => (
            <div
              key={item.wardId}
              className={`flex flex-col justify-between rounded-xl border p-4 ${
                item.isCompliant
                  ? 'border-emerald-200 bg-white'
                  : 'border-amber-300 bg-amber-50/40'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.wardName}</p>
                    <p className="text-xs text-slate-500">
                      {LGA_DEFINITIONS[item.lgaId]?.shortName} · Code {item.wardCode}
                    </p>
                  </div>
                  {item.isCompliant ? (
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{item.activeCount}/5</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-2 py-0.5 font-mono text-xs font-semibold text-amber-900">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{item.activeCount}/5</span>
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-600">
                  {item.isCompliant
                    ? `Minimum staffing met (${item.activeCount} active officers).`
                    : `${item.vacancyCount} vacancy slot${item.vacancyCount === 1 ? '' : 's'} remaining to reach 5.`}
                  {item.suspendedCount > 0 ? ` (${item.suspendedCount} suspended)` : ''}
                </p>
              </div>

              {canManage ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2.5">
                  <button
                    type="button"
                    disabled={!isOnline}
                    onClick={() => openAssignForWard(item.lgaId, item.wardId)}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <UserCheck className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
                    <span>Assign User</span>
                  </button>
                  {isFullAdmin ? (
                    <button
                      type="button"
                      disabled={!isOnline}
                      onClick={() => openCreateForWard(item.lgaId, item.wardId)}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>New Officer</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Operations Officers Roster */}
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-900">
          Assigned Operations Officers ({operationsOfficers.length})
        </h3>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading Operations Officers roster...
          </div>
        ) : operationsOfficers.length === 0 ? (
          <EmptyState
            title="No Operations Officers found"
            description="No Operations Officers match the selected ward, LGA, or search filter."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="px-4 py-3">Officer</th>
                    <th className="px-4 py-3">Assigned Ward</th>
                    <th className="px-4 py-3">Battery</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Registered</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operationsOfficers.map((officer) => {
                    const ward = wardById.get(officer.assignedWardId);
                    return (
                      <tr key={officer.uid} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-900">{officer.displayName}</p>
                          <p className="text-xs text-slate-500">
                            {formatAccountIdentifier(officer)}
                            {officer.phone && officer.email && !officer.email.endsWith('@fdmis.local')
                              ? ` · ${officer.phone}`
                              : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-700">
                          <p className="font-medium text-slate-900">
                            {ward?.name || officer.assignedWardId || 'Unassigned'}
                          </p>
                          <p className="text-slate-500">
                            {LGA_DEFINITIONS[officer.assignedLgaId as LgaId]?.shortName ||
                              officer.assignedLgaId}
                            {ward?.wardCode ? ` · ${ward.wardCode}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">{renderBatteryCell(officer)}</td>
                        <td className="px-4 py-3.5">
                          <AccountStatusBadge status={officer.status} />
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {formatFirestoreTime(officer.createdAt)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setInspectingOfficer(officer)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Inspect</span>
                            </button>

                            {canManage ? (
                              <>
                                <button
                                  type="button"
                                  disabled={!isOnline}
                                  onClick={() =>
                                    openAssignForWard(
                                      (officer.assignedLgaId as LgaId) || 'funtua',
                                      officer.assignedWardId,
                                      officer.uid
                                    )
                                  }
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  <span>Reassign</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || !isOnline}
                                  onClick={() => void handleTriggerPasswordReset(officer)}
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Reset PW</span>
                                </button>
                                {officer.status !== AccountStatus.SUSPENDED && !officer.sessionRevoked ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSuspendingOfficer(officer);
                                      setSuspendReason('');
                                    }}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                                  >
                                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Suspend</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleReactivateOfficer(officer)}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Reactivate</span>
                                  </button>
                                )}
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Modal: Create Brand New Operations Officer (Full Control Admin) */}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Create Operations Officer Account
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOfficer} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="ops-new-name" className="block text-xs font-medium text-slate-700">
                  Full Name *
                </label>
                <input
                  id="ops-new-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={110}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ops-new-email" className="block text-xs font-medium text-slate-700">
                    Email Address *
                  </label>
                  <input
                    id="ops-new-email"
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="officer@example.com"
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="ops-new-phone" className="block text-xs font-medium text-slate-700">
                    Phone Number *
                  </label>
                  <input
                    id="ops-new-phone"
                    type="tel"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="0803 123 4567"
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ops-new-pw" className="block text-xs font-medium text-slate-700">
                  Initial Password (One-way Hashed) *
                </label>
                <input
                  id="ops-new-pw"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 chars with letters & numbers"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ops-new-lga" className="block text-xs font-medium text-slate-700">
                    LGA *
                  </label>
                  <select
                    id="ops-new-lga"
                    value={newLgaId}
                    onChange={(e) => {
                      const next = e.target.value as LgaId;
                      setNewLgaId(next);
                      setNewWardId('');
                    }}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="funtua">Funtua LGA</option>
                    <option value="dandume">Dandume LGA</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ops-new-ward" className="block text-xs font-medium text-slate-700">
                    Assigned Ward *
                  </label>
                  <select
                    id="ops-new-ward"
                    required
                    value={newWardId}
                    onChange={(e) => setNewWardId(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Select Ward...</option>
                    {createModalWards.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.wardCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="min-h-[42px] rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] rounded-lg bg-[#0b3b24] px-4 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {busy ? 'Provisioning...' : 'Create Officer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Assign / Promote Existing User to Operations Officer */}
      {assignOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Assign Operations Officer to Ward
              </h3>
              <button
                type="button"
                onClick={() => setAssignOpen(false)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAssignExisting} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="ops-pick-user" className="block text-xs font-medium text-slate-700">
                  Select Registered User *
                </label>
                <select
                  id="ops-pick-user"
                  required
                  value={assignTargetUid}
                  onChange={(e) => setAssignTargetUid(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Choose user account...</option>
                  {eligibleUsersForPromotion.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.displayName} ({formatAccountIdentifier(u)}) — {USER_ROLE_META[u.role].shortLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ops-assign-lga" className="block text-xs font-medium text-slate-700">
                    LGA *
                  </label>
                  <select
                    id="ops-assign-lga"
                    disabled={!isFullAdmin}
                    value={assignLgaId}
                    onChange={(e) => {
                      setAssignLgaId(e.target.value as LgaId);
                      setAssignWardId('');
                    }}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                  >
                    <option value="funtua">Funtua LGA</option>
                    <option value="dandume">Dandume LGA</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ops-assign-ward" className="block text-xs font-medium text-slate-700">
                    Ward *
                  </label>
                  <select
                    id="ops-assign-ward"
                    required
                    value={assignWardId}
                    onChange={(e) => setAssignWardId(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Select Ward...</option>
                    {assignModalWards.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.wardCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignOpen(false)}
                  className="min-h-[42px] rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] rounded-lg bg-[#0b3b24] px-4 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {busy ? 'Assigning...' : 'Assign Officer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Suspend Officer */}
      {suspendingOfficer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6">
            <h3 className="font-display text-base font-semibold text-amber-900">
              Suspend Operations Officer
            </h3>
            <p className="mt-2 text-xs text-slate-600">
              Revokes active sessions for <span className="font-semibold">{suspendingOfficer.displayName}</span> and opens a slot in their ward coverage count.
            </p>
            <form onSubmit={handleSuspendOfficer} className="mt-4 space-y-3.5">
              <textarea
                required
                minLength={4}
                maxLength={300}
                rows={3}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Reason for suspension (logged in audit trail)..."
                className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSuspendingOfficer(null)}
                  className="min-h-[42px] rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800"
                >
                  {busy ? 'Suspending...' : 'Confirm Suspend'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Inspect Officer Registration & Activity */}
      {inspectingOfficer && inspectedActivity ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {inspectingOfficer.displayName}
                </h3>
                <p className="text-xs text-slate-500">
                  {inspectingOfficer.email} · {inspectingOfficer.phone || 'No phone'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingOfficer(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <RoleBadge role={inspectingOfficer.role} />
                <AccountStatusBadge status={inspectingOfficer.status} />
                {renderBatteryCell(inspectingOfficer)}
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-slate-500">Registered At</p>
                  <p className="font-mono font-medium text-slate-900">
                    {formatFirestoreTime(inspectingOfficer.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Last Login</p>
                  <p className="font-mono font-medium text-slate-900">
                    {formatFirestoreTime(inspectingOfficer.lastLoginAt)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <p className="font-mono text-lg font-bold text-slate-900">
                    {inspectedActivity.checkIns.length}
                  </p>
                  <p className="text-[11px] text-slate-500">Check-Ins</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <p className="font-mono text-lg font-bold text-slate-900">
                    {inspectedActivity.incidents.length}
                  </p>
                  <p className="text-[11px] text-slate-500">Incidents</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <p className="font-mono text-lg font-bold text-slate-900">
                    {inspectedActivity.notes.length}
                  </p>
                  <p className="text-[11px] text-slate-500">Notes</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
