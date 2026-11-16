import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { AccountStatusBadge, RoleBadge } from '../components/StatusBadge';
import {
  AccountStatus,
  LGA_DEFINITIONS,
  USER_ROLE_META,
  UserRole,
  canDeleteUsers,
  canManageUsers,
  formatFirestoreTime,
  type PasswordResetRequest,
  type PollingUnit,
  type PuAssignment,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  approvePasswordResetRequest,
  controlledReassignPollingUnit,
  permanentlyDeleteUser,
  reactivateUser,
  rejectPasswordResetRequest,
  revokeOrSuspendUser,
  updateUserRoleAndScope,
} from '../services/directoryService';
import { formatAccountIdentifier } from '../utils/phoneAuth';

interface UserAccessControlPageProps {
  currentUser: UserAccount;
  users: UserAccount[];
  wards: Ward[];
  pollingUnits: PollingUnit[];
  puAssignments: PuAssignment[];
  passwordResetRequests?: PasswordResetRequest[];
  loading: boolean;
}

export function UserAccessControlPage({
  currentUser,
  users,
  wards,
  pollingUnits,
  puAssignments,
  passwordResetRequests = [],
  loading,
}: UserAccessControlPageProps) {
  const canEdit = canManageUsers(currentUser.role);
  const isFullAdmin = currentUser.role === UserRole.FULL_CONTROL_ADMIN;
  const canDelete = canDeleteUsers(currentUser.role);

  const [statusFilter, setStatusFilter] = useState<'ALL' | AccountStatus>('ALL');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editRole, setEditRole] = useState<UserRole>(UserRole.PENDING);
  const [editStatus, setEditStatus] = useState<AccountStatus>(AccountStatus.PENDING_APPROVAL);
  const [editLga, setEditLga] = useState<string>('');
  const [editWard, setEditWard] = useState<string>('');
  const [editPu, setEditPu] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const [revokingUser, setRevokingUser] = useState<UserAccount | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const [deletingUser, setDeletingUser] = useState<UserAccount | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignPuId, setReassignPuId] = useState('');
  const [reassignAgentUid, setReassignAgentUid] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const [issuedPinInfo, setIssuedPinInfo] = useState<{
    applicantName: string;
    maskedPhone: string;
    resetPin: string;
  } | null>(null);
  const [copiedPin, setCopiedPin] = useState(false);
  const [rejectingReq, setRejectingReq] = useState<PasswordResetRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [users, statusFilter, search]);

  const availableRoles: UserRole[] = useMemo(() => {
    if (isFullAdmin) {
      return [
        UserRole.FULL_CONTROL_ADMIN,
        UserRole.FUNTUA_SUPER_ADMIN,
        UserRole.DANDUME_SUPER_ADMIN,
        UserRole.VERIFICATION_OFFICER,
        UserRole.WARD_COORDINATOR,
        UserRole.POLLING_UNIT_AGENT,
        UserRole.PENDING,
      ];
    }
    return [
      UserRole.VERIFICATION_OFFICER,
      UserRole.WARD_COORDINATOR,
      UserRole.POLLING_UNIT_AGENT,
      UserRole.PENDING,
    ];
  }, [isFullAdmin]);

  const occupiedPuSetForEditing = useMemo(() => {
    const set = new Set<string>();
    const targetUid = editingUser?.uid || '';
    puAssignments.forEach((a) => {
      if (a.agentUid && a.agentUid !== targetUid) set.add(a.puId);
    });
    pollingUnits.forEach((p) => {
      if (p.assignedAgentUid && p.assignedAgentUid !== targetUid) set.add(p.id);
    });
    return set;
  }, [puAssignments, pollingUnits, editingUser]);

  const openEditModal = (u: UserAccount) => {
    setEditingUser(u);
    setEditRole(u.role);
    setEditStatus(u.status);

    let nextLga = u.assignedLgaId || '';
    if (currentUser.role === UserRole.FUNTUA_SUPER_ADMIN) {
      nextLga = 'funtua';
    } else if (currentUser.role === UserRole.DANDUME_SUPER_ADMIN) {
      nextLga = 'dandume';
    } else if (!nextLga) {
      if (u.requestedLgaId) {
        nextLga = u.requestedLgaId;
      } else if (u.role !== UserRole.VERIFICATION_OFFICER) {
        nextLga = 'funtua';
      }
    }
    setEditLga(nextLga);

    const nextWard = u.assignedWardId || (!u.assignedLgaId && u.requestedWardId ? u.requestedWardId : '');
    setEditWard(nextWard);

    if (u.assignedPollingUnitId) {
      setEditPu(u.assignedPollingUnitId);
    } else if (u.requestedPollingUnitId) {
      const occupiedByOther =
        puAssignments.some((a) => a.puId === u.requestedPollingUnitId && a.agentUid && a.agentUid !== u.uid) ||
        pollingUnits.some(
          (p) => p.id === u.requestedPollingUnitId && p.assignedAgentUid && p.assignedAgentUid !== u.uid
        );
      setEditPu(occupiedByOther ? '' : u.requestedPollingUnitId);
    } else {
      setEditPu('');
    }
  };

  const handleSaveRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (
      editRole === UserRole.POLLING_UNIT_AGENT &&
      editStatus === AccountStatus.ACTIVE &&
      (!editLga || !editWard || !editPu)
    ) {
      setFeedback({
        type: 'err',
        text: 'Select 1. LGA, 2. Ward, and 3. Available Polling Unit for an active Polling Unit Agent.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      await updateUserRoleAndScope(currentUser, editingUser, {
        role: editRole,
        status: editStatus,
        assignedLgaId: editLga,
        assignedWardId: editWard,
        assignedPollingUnitId: editPu,
      });
      setFeedback({
        type: 'ok',
        text: `Updated role and geographic scope for ${editingUser.displayName}.`,
      });
      setEditingUser(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update user role.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (e: FormEvent) => {
    e.preventDefault();
    if (!revokingUser) return;
    setBusy(true);
    setFeedback(null);
    try {
      await revokeOrSuspendUser(currentUser, revokingUser, revokeReason);
      setFeedback({
        type: 'ok',
        text: `Suspended ${revokingUser.displayName} and revoked active sessions (PU assignment preserved).`,
      });
      setRevokingUser(null);
      setRevokeReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Emergency revocation failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async (target: UserAccount) => {
    setBusy(true);
    setFeedback(null);
    try {
      await reactivateUser(currentUser, target);
      setFeedback({
        type: 'ok',
        text: `Reactivated ${target.displayName} and cleared session revocation flag.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to reactivate account.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePermanentDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (!deletingUser) return;
    setBusy(true);
    setFeedback(null);
    try {
      await permanentlyDeleteUser(currentUser, deletingUser, deleteReason);
      setFeedback({
        type: 'ok',
        text: `Permanently deleted ${deletingUser.displayName}. Any assigned Polling Unit lock has been released while historical submissions remain preserved.`,
      });
      setDeletingUser(null);
      setDeleteReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Permanent user deletion failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleControlledReassign = async (e: FormEvent) => {
    e.preventDefault();
    const pu = pollingUnits.find((p) => p.id === reassignPuId);
    const agent = users.find((u) => u.uid === reassignAgentUid);
    if (!pu || !agent) {
      setFeedback({ type: 'err', text: 'Select both a Polling Unit and a target operator.' });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      await controlledReassignPollingUnit(currentUser, pu, agent, reassignReason);
      setFeedback({
        type: 'ok',
        text: `Controlled reassignment completed: ${agent.displayName} is now locked to ${pu.puCode} (${pu.name}).`,
      });
      setReassignModalOpen(false);
      setReassignPuId('');
      setReassignAgentUid('');
      setReassignReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Controlled reassignment failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveReset = async (req: PasswordResetRequest) => {
    setBusy(true);
    setFeedback(null);
    setCopiedPin(false);
    try {
      const res = await approvePasswordResetRequest(currentUser, req);
      setIssuedPinInfo({
        applicantName: req.applicantName,
        maskedPhone: res.maskedPhone,
        resetPin: res.resetPin,
      });
      setFeedback({
        type: 'ok',
        text: `Issued one-time password Reset PIN for ${req.applicantName} (${res.maskedPhone}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to approve password reset request.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRejectReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!rejectingReq) return;
    setBusy(true);
    setFeedback(null);
    try {
      await rejectPasswordResetRequest(currentUser, rejectingReq, rejectReason);
      setFeedback({
        type: 'ok',
        text: `Rejected password reset request for ${rejectingReq.applicantName}.`,
      });
      setRejectingReq(null);
      setRejectReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to reject password reset request.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPin = async (pin: string) => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopiedPin(true);
      window.setTimeout(() => setCopiedPin(false), 2500);
    } catch {
      // Clipboard API restricted
    }
  };

  const scopedWards = useMemo(() => {
    if (!editLga) return [];
    return wards.filter((w) => w.lgaId === editLga);
  }, [wards, editLga]);

  const wardAllPus = useMemo(() => {
    if (!editLga || !editWard) return [];
    return pollingUnits.filter((p) => p.lgaId === editLga && p.wardId === editWard);
  }, [pollingUnits, editLga, editWard]);

  const availableWardPus = useMemo(() => {
    return wardAllPus.filter((p) => !occupiedPuSetForEditing.has(p.id));
  }, [wardAllPus, occupiedPuSetForEditing]);

  const occupiedCountInWard = wardAllPus.length - availableWardPus.length;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search operator name, phone, email, or role..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none sm:max-w-xs"
          />

          {isFullAdmin ? (
            <button
              type="button"
              onClick={() => {
                setReassignModalOpen(true);
                setReassignReason('');
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <ArrowLeftRight className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
              <span>Controlled PU Reassignment</span>
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: 'ALL', label: 'All' },
              { id: AccountStatus.PENDING_APPROVAL, label: 'Pending' },
              { id: AccountStatus.ACTIVE, label: 'Active' },
              { id: AccountStatus.SUSPENDED, label: 'Suspended' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
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

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading operator directory...
        </div>
      ) : filteredUsers.length === 0 ? (
        <EmptyState
          title="No matching operator accounts"
          description="No registered users match the selected status filter or search query in your authorized scope."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Geographic Scope</th>
                  <th className="px-4 py-3">Last Login</th>
                  {canEdit ? <th className="px-4 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const canModifyTarget =
                    canEdit && (isFullAdmin || u.role !== UserRole.FULL_CONTROL_ADMIN);
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-slate-900">{u.displayName}</p>
                        <p className="text-xs text-slate-500">{formatAccountIdentifier(u)}</p>
                        {u.status === AccountStatus.PENDING_APPROVAL && u.requestedLgaId ? (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-800">
                            Requested: {u.requestedLgaId.toUpperCase()}
                            {u.requestedWardName ? ` · ${u.requestedWardName}` : ''}
                            {u.requestedPollingUnitCode ? ` · ${u.requestedPollingUnitCode}` : ''}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-4 py-3.5">
                        <AccountStatusBadge status={u.status} />
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-700">
                        {u.role === UserRole.FULL_CONTROL_ADMIN
                          ? 'Funtua & Dandume (Full)'
                          : u.role === UserRole.VERIFICATION_OFFICER && !u.assignedLgaId
                            ? 'Constituency-wide Verification'
                            : u.assignedLgaId
                              ? `${LGA_DEFINITIONS[u.assignedLgaId as 'funtua' | 'dandume']?.shortName || u.assignedLgaId}${u.assignedWardId ? ` · ${u.assignedWardId}` : ''}${u.assignedPollingUnitId ? ` · ${u.assignedPollingUnitId}` : ''}`
                              : 'Unassigned'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatFirestoreTime(u.lastLoginAt)}
                      </td>
                      {canEdit ? (
                        <td className="px-4 py-3.5 text-right">
                          {canModifyTarget ? (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditModal(u)}
                                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                              >
                                <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Role &amp; Scope</span>
                              </button>
                              {u.uid !== currentUser.uid &&
                              u.status !== AccountStatus.SUSPENDED &&
                              !u.sessionRevoked ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRevokingUser(u);
                                    setRevokeReason('');
                                  }}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                                >
                                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Suspend</span>
                                </button>
                              ) : null}
                              {(u.status === AccountStatus.SUSPENDED || u.sessionRevoked) &&
                              u.uid !== currentUser.uid ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleReactivate(u)}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Reactivate</span>
                                </button>
                              ) : null}
                              {canDelete && u.uid !== currentUser.uid ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeletingUser(u);
                                    setDeleteReason('');
                                  }}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 whitespace-nowrap"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Delete</span>
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Protected</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Role & Scope Assignment Modal */}
      {editingUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Assign Role &amp; Area Scope
                </h3>
                <p className="text-xs text-slate-500">
                  {editingUser.displayName} · {formatAccountIdentifier(editingUser)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveRole} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="edit-role" className="block text-xs font-medium text-slate-700">
                  Role
                </label>
                <select
                  id="edit-role"
                  disabled={editingUser.uid === currentUser.uid}
                  value={editRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as UserRole;
                    setEditRole(nextRole);
                    if (nextRole === UserRole.FUNTUA_SUPER_ADMIN) {
                      setEditLga('funtua');
                      setEditWard('');
                      setEditPu('');
                    } else if (nextRole === UserRole.DANDUME_SUPER_ADMIN) {
                      setEditLga('dandume');
                      setEditWard('');
                      setEditPu('');
                    } else if (nextRole === UserRole.VERIFICATION_OFFICER) {
                      if (!isFullAdmin) {
                        setEditLga(
                          currentUser.role === UserRole.FUNTUA_SUPER_ADMIN ? 'funtua' : 'dandume'
                        );
                      }
                      setEditPu('');
                    } else if (nextRole === UserRole.POLLING_UNIT_AGENT && !editLga) {
                      setEditLga(
                        currentUser.role === UserRole.DANDUME_SUPER_ADMIN ? 'dandume' : 'funtua'
                      );
                    }
                    if (nextRole !== UserRole.PENDING && editStatus === AccountStatus.PENDING_APPROVAL) {
                      setEditStatus(AccountStatus.ACTIVE);
                    }
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {USER_ROLE_META[r].label}
                    </option>
                  ))}
                </select>
                {editingUser.uid === currentUser.uid ? (
                  <p className="mt-1 text-[11px] text-amber-800">
                    Self-role modification is blocked by security policy.
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="edit-status" className="block text-xs font-medium text-slate-700">
                  Account Status
                </label>
                <select
                  id="edit-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as AccountStatus)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value={AccountStatus.ACTIVE}>Active</option>
                  <option value={AccountStatus.PENDING_APPROVAL}>Pending Approval</option>
                  <option value={AccountStatus.SUSPENDED}>Suspended / Revoked</option>
                </select>
              </div>

              {editRole !== UserRole.FULL_CONTROL_ADMIN && editRole !== UserRole.PENDING ? (
                <div>
                  <label htmlFor="edit-lga" className="block text-xs font-medium text-slate-700">
                    {editRole === UserRole.POLLING_UNIT_AGENT
                      ? '1. Select LGA *'
                      : 'Assigned LGA'}
                  </label>
                  <select
                    id="edit-lga"
                    disabled={
                      !isFullAdmin ||
                      editRole === UserRole.FUNTUA_SUPER_ADMIN ||
                      editRole === UserRole.DANDUME_SUPER_ADMIN
                    }
                    value={editLga}
                    onChange={(e) => {
                      setEditLga(e.target.value);
                      setEditWard('');
                      setEditPu('');
                    }}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                  >
                    {editRole === UserRole.VERIFICATION_OFFICER && isFullAdmin ? (
                      <option value="">Constituency-wide (Both LGAs)</option>
                    ) : null}
                    <option value="funtua">Funtua LGA (20-14)</option>
                    <option value="dandume">Dandume LGA (20/07)</option>
                  </select>
                </div>
              ) : null}

              {(editRole === UserRole.WARD_COORDINATOR ||
                editRole === UserRole.POLLING_UNIT_AGENT ||
                (editRole === UserRole.VERIFICATION_OFFICER && Boolean(editLga))) ? (
                <div>
                  <label htmlFor="edit-ward" className="block text-xs font-medium text-slate-700">
                    {editRole === UserRole.POLLING_UNIT_AGENT
                      ? '2. Select Ward *'
                      : editRole === UserRole.VERIFICATION_OFFICER
                        ? 'Assigned Ward (Optional)'
                        : 'Assigned Ward'}
                  </label>
                  <select
                    id="edit-ward"
                    disabled={!editLga}
                    value={editWard}
                    onChange={(e) => {
                      setEditWard(e.target.value);
                      setEditPu('');
                    }}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                  >
                    <option value="">
                      {editRole === UserRole.VERIFICATION_OFFICER
                        ? 'All Wards in Selected LGA'
                        : 'Select Ward...'}
                    </option>
                    {scopedWards.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.wardCode})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {editRole === UserRole.POLLING_UNIT_AGENT ? (
                <div>
                  <label htmlFor="edit-pu" className="block text-xs font-medium text-slate-700">
                    3. Select Available Polling Unit *
                  </label>
                  <select
                    id="edit-pu"
                    disabled={!editLga || !editWard}
                    value={editPu}
                    onChange={(e) => setEditPu(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                  >
                    <option value="">
                      {!editWard
                        ? 'Select a Ward first...'
                        : availableWardPus.length === 0
                          ? 'No unassigned Polling Units left in this Ward'
                          : `Select Available PU (${availableWardPus.length} open)...`}
                    </option>
                    {availableWardPus.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.puCode} · {p.name}
                      </option>
                    ))}
                  </select>
                  {editWard ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Unique 1-to-1 lock active: {availableWardPus.length} available,{' '}
                      {occupiedCountInWard} already assigned and hidden from selection.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {busy ? 'Saving...' : 'Save Authorization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Suspend / Emergency Revocation Modal (Preserves PU Assignment) */}
      {revokingUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-amber-900">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold">
                  Suspend &amp; Revoke Session
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRevokingUser(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              Immediately revokes active sessions and suspends{' '}
              <span className="font-semibold text-slate-900">{revokingUser.displayName}</span> (
              {formatAccountIdentifier(revokingUser)}). Their Polling Unit assignment and historical
              election records remain preserved.
            </p>
            <form onSubmit={handleRevoke} className="mt-4 space-y-4">
              <div>
                <label htmlFor="revoke-reason" className="block text-xs font-medium text-slate-700">
                  Suspension Reason (Logged in Audit Trail) *
                </label>
                <textarea
                  id="revoke-reason"
                  required
                  minLength={4}
                  maxLength={300}
                  rows={3}
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Field device reported lost/stolen at polling unit"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRevokingUser(null)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                >
                  {busy ? 'Suspending...' : 'Suspend Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Permanent Deletion Modal (Full Control Admin Only) */}
      {deletingUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-red-800">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold">
                  Permanently Delete Operator
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-950">
              Permanently removes{' '}
              <span className="font-semibold">{deletingUser.displayName}</span> (
              {formatAccountIdentifier(deletingUser)}) and releases any assigned Polling Unit lock (
              <span className="font-mono">
                {deletingUser.assignedPollingUnitId || 'none'}
              </span>
              ) so another agent can be assigned. All historical check-ins, incident reports, result
              submissions, and audit logs remain intact.
            </div>
            <form onSubmit={handlePermanentDelete} className="mt-4 space-y-4">
              <div>
                <label htmlFor="delete-reason" className="block text-xs font-medium text-slate-700">
                  Mandatory Deletion Audit Reason (min 4 chars) *
                </label>
                <textarea
                  id="delete-reason"
                  required
                  minLength={4}
                  maxLength={300}
                  rows={2}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Specify reason for permanent user removal..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 focus:border-red-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingUser(null)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {busy ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Controlled PU Reassignment Modal (Full Control Admin Only) */}
      {reassignModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-[#0b3b24]">
                <ArrowLeftRight className="h-5 w-5" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Controlled Polling Unit Reassignment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReassignModalOpen(false)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Atomically transfers a Polling Unit lock from its current agent to a replacement
              operator and records the transfer in audit logs.
            </p>
            <form onSubmit={handleControlledReassign} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="re-pu" className="block text-xs font-medium text-slate-700">
                  Target Polling Unit *
                </label>
                <select
                  id="re-pu"
                  required
                  value={reassignPuId}
                  onChange={(e) => setReassignPuId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Select Polling Unit...</option>
                  {pollingUnits.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.puCode} · {p.name} ({p.wardName})
                      {p.assignedAgentName ? ` — Current: ${p.assignedAgentName}` : ' — Unassigned'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="re-agent" className="block text-xs font-medium text-slate-700">
                  New Assigned Agent *
                </label>
                <select
                  id="re-agent"
                  required
                  value={reassignAgentUid}
                  onChange={(e) => setReassignAgentUid(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Select Operator...</option>
                  {users
                    .filter((u) => !u.sessionRevoked && u.role !== UserRole.FULL_CONTROL_ADMIN)
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({formatAccountIdentifier(u)}) — {USER_ROLE_META[u.role].shortLabel}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label htmlFor="re-reason" className="block text-xs font-medium text-slate-700">
                  Audit Reason (min 4 chars) *
                </label>
                <textarea
                  id="re-reason"
                  required
                  minLength={4}
                  maxLength={400}
                  rows={2}
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  placeholder="Specify reason for transferring PU assignment..."
                  className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReassignModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {busy ? 'Transferring...' : 'Execute Reassignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Password Recovery Requests Panel */}
      {canEdit ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Password Recovery Requests
                </h2>
                <p className="text-xs text-slate-600">
                  Verify operator identity before issuing a one-time Reset PIN. Completed resets
                  require role and area scope re-activation above.
                </p>
              </div>
            </div>
            <span className="text-xs font-medium text-slate-600">
              {passwordResetRequests.filter((r) => r.status === 'PENDING').length} pending review
            </span>
          </div>

          {passwordResetRequests.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No password recovery requests submitted in your authorized scope.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {passwordResetRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{req.applicantName}</span>
                      <span className="font-mono text-slate-600">{req.maskedPhone}</span>
                      {req.recoveryKeyMatched ? (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          <span>Recovery Key Verified</span>
                        </span>
                      ) : null}
                      <span
                        className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                          req.status === 'PENDING'
                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : req.status === 'APPROVED'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                              : req.status === 'COMPLETED'
                                ? 'border-slate-200 bg-slate-100 text-slate-700'
                                : 'border-red-200 bg-red-50 text-red-900'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      {req.lgaId ? req.lgaId.toUpperCase() : 'LGA Unspecified'}
                      {req.wardName ? ` · ${req.wardName}` : ''}
                      {req.puCode ? ` · ${req.puCode}` : ''} · Submitted{' '}
                      {formatFirestoreTime(req.createdAt)}
                    </p>
                    {req.reviewerNote ? (
                      <p className="text-slate-500">Note: {req.reviewerNote}</p>
                    ) : null}
                  </div>

                  {req.status === 'PENDING' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleApproveReset(req)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0b3b24] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Approve &amp; Issue Reset PIN</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRejectingReq(req);
                          setRejectReason('');
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-60"
                      >
                        <span>Reject</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* One-Time Issued Reset PIN Modal */}
      {issuedPinInfo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-emerald-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-[#0b3b24]">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  One-Time Reset PIN Issued
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIssuedPinInfo(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              Share this single-use PIN securely with{' '}
              <span className="font-semibold text-slate-900">{issuedPinInfo.applicantName}</span> (
              {issuedPinInfo.maskedPhone}). It is displayed once and hashed in the database. After
              completing the reset, re-approve the operator&apos;s Role &amp; Scope under the
              Pending tab.
            </p>
            <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
              <span className="font-mono text-base font-bold tracking-wider text-slate-900">
                {issuedPinInfo.resetPin}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyPin(issuedPinInfo.resetPin)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copiedPin ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setIssuedPinInfo(null)}
                className="min-h-[42px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reject Password Recovery Modal */}
      {rejectingReq ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Reject Recovery Request
              </h3>
              <button
                type="button"
                onClick={() => setRejectingReq(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-600">
              Rejecting recovery for{' '}
              <span className="font-semibold text-slate-900">{rejectingReq.applicantName}</span> (
              {rejectingReq.maskedPhone}).
            </p>
            <form onSubmit={handleRejectReset} className="mt-4 space-y-4">
              <div>
                <label htmlFor="reject-reason" className="block text-xs font-medium text-slate-700">
                  Rejection Reason (min 4 chars) *
                </label>
                <textarea
                  id="reject-reason"
                  required
                  minLength={4}
                  maxLength={300}
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Specify reason for rejecting recovery request..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingReq(null)}
                  className="min-h-[42px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {busy ? 'Rejecting...' : 'Reject Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
