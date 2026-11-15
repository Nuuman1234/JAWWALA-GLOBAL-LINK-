import { useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  Pencil,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PuStatusBadge } from '../components/StatusBadge';
import {
  AccountStatus,
  LGA_DEFINITIONS,
  PU_STATUS_META,
  PuOperationalStatus,
  UserRole,
  canAssignFieldUsers,
  canCorrectMasterDirectory,
  getAuthorizedLgas,
  type DirectoryImportSummary,
  type LgaId,
  type PollingUnit,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  assignAgentToPollingUnit,
  controlledReassignPollingUnit,
  createPollingUnit,
  importOfficialDirectory,
} from '../services/directoryService';
import { correctMasterPollingUnit } from '../services/operationsService';
import type { PuAssignment } from '../types/fdmis';

interface PollingUnitsDirectoryPageProps {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
  users: UserAccount[];
  puAssignments: PuAssignment[];
  loading: boolean;
}

const PAGE_SIZE = 25;

export function PollingUnitsDirectoryPage({
  user,
  wards,
  pollingUnits,
  users,
  puAssignments,
  loading,
}: PollingUnitsDirectoryPageProps) {
  const authorizedLgas = getAuthorizedLgas(user);
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;
  const canAssign = canAssignFieldUsers(user.role);
  const canCorrectMaster = canCorrectMasterDirectory(user.role);

  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [wardFilter, setWardFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PuOperationalStatus>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<DirectoryImportSummary | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newPuLga, setNewPuLga] = useState<LgaId>('funtua');
  const [newPuWardId, setNewPuWardId] = useState('');
  const [newPuCode, setNewPuCode] = useState('');
  const [newPuName, setNewPuName] = useState('');
  const [newPuLocation, setNewPuLocation] = useState('');
  const [newPuRegVoters, setNewPuRegVoters] = useState('0');
  const [saving, setSaving] = useState(false);

  const [assigningPu, setAssigningPu] = useState<PollingUnit | null>(null);
  const [selectedAgentUid, setSelectedAgentUid] = useState('');
  const [reassignAuditReason, setReassignAuditReason] = useState('');

  const [correctingPu, setCorrectingPu] = useState<PollingUnit | null>(null);
  const [corrName, setCorrName] = useState('');
  const [corrLocation, setCorrLocation] = useState('');
  const [corrRegVoters, setCorrRegVoters] = useState('0');
  const [corrLat, setCorrLat] = useState('');
  const [corrLng, setCorrLng] = useState('');
  const [corrCoordsVerified, setCorrCoordsVerified] = useState(false);
  const [corrReason, setCorrReason] = useState('');

  const wardsInFilterLga = useMemo(() => {
    return wards.filter((w) => lgaFilter === 'all' || w.lgaId === lgaFilter);
  }, [wards, lgaFilter]);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pollingUnits.filter((pu) => {
      if (lgaFilter !== 'all' && pu.lgaId !== lgaFilter) return false;
      if (wardFilter !== 'all' && pu.wardId !== wardFilter) return false;
      if (statusFilter !== 'ALL' && pu.operationalStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        pu.puCode.toLowerCase().includes(q) ||
        pu.name.toLowerCase().includes(q) ||
        pu.wardName.toLowerCase().includes(q) ||
        pu.assignedAgentName.toLowerCase().includes(q)
      );
    });
  }, [pollingUnits, lgaFilter, wardFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedUnits = filteredUnits.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const agentCandidates = useMemo(() => {
    if (!assigningPu) return [];
    return users.filter(
      (u) =>
        u.status === AccountStatus.ACTIVE &&
        !u.sessionRevoked &&
        (u.role === UserRole.POLLING_UNIT_AGENT || u.role === UserRole.WARD_COORDINATOR) &&
        (u.assignedLgaId === '' || u.assignedLgaId === assigningPu.lgaId)
    );
  }, [users, assigningPu]);

  const handleImportOfficial = async () => {
    setImporting(true);
    setFeedback(null);
    try {
      const summary = await importOfficialDirectory(user);
      setImportSummary(summary);
      setFeedback({
        type: 'ok',
        text: `Official INEC directory verified in Firestore: ${summary.funtuaVerifiedInDatabase} Funtua PUs and ${summary.dandumeVerifiedInDatabase} Dandume PUs (${summary.totalVerifiedInDatabase} total).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Official directory import failed.',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleCreatePu = async (e: FormEvent) => {
    e.preventDefault();
    const ward = wards.find((w) => w.id === newPuWardId);
    if (!ward) {
      setFeedback({ type: 'err', text: 'Select a valid ward before saving.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await createPollingUnit(user, {
        lgaId: newPuLga,
        ward,
        puCode: newPuCode,
        name: newPuName,
        locationDescription: newPuLocation,
        registeredVoters: Number(newPuRegVoters) || 0,
      });
      setFeedback({ type: 'ok', text: `Polling unit ${newPuCode.toUpperCase()} added.` });
      setNewPuCode('');
      setNewPuName('');
      setNewPuLocation('');
      setShowAddModal(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create polling unit.',
      });
    } finally {
      setSaving(false);
    }
  };

  const activeLockForAssigningPu = useMemo(() => {
    if (!assigningPu) return null;
    return puAssignments.find((a) => a.puId === assigningPu.id) || null;
  }, [assigningPu, puAssignments]);

  const currentPuHolderUid =
    activeLockForAssigningPu?.agentUid || assigningPu?.assignedAgentUid || '';

  const needsControlledReassign = Boolean(
    assigningPu &&
      currentPuHolderUid &&
      selectedAgentUid &&
      selectedAgentUid !== currentPuHolderUid
  );

  const handleAssignAgent = async (e: FormEvent) => {
    e.preventDefault();
    if (!assigningPu) return;
    setSaving(true);
    setFeedback(null);
    try {
      const agent = users.find((u) => u.uid === selectedAgentUid) || null;
      if (needsControlledReassign && agent) {
        if (!isFullAdmin) {
          throw new Error(
            'This Polling Unit is already assigned. Unassign the current agent first or request Full Control Admin Controlled Reassignment.'
          );
        }
        await controlledReassignPollingUnit(user, assigningPu, agent, reassignAuditReason);
        setFeedback({
          type: 'ok',
          text: `Controlled reassignment completed: ${agent.displayName} assigned to ${assigningPu.puCode}.`,
        });
      } else {
        await assignAgentToPollingUnit(user, assigningPu, agent);
        setFeedback({
          type: 'ok',
          text: agent
            ? `Assigned ${agent.displayName} to ${assigningPu.puCode}.`
            : `Released agent assignment on ${assigningPu.puCode}.`,
        });
      }
      setAssigningPu(null);
      setReassignAuditReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to assign field agent.',
      });
    } finally {
      setSaving(false);
    }
  };

  const openMasterCorrection = (pu: PollingUnit) => {
    setCorrectingPu(pu);
    setCorrName(pu.name);
    setCorrLocation(pu.locationDescription);
    setCorrRegVoters(String(pu.registeredVoters ?? 0));
    setCorrLat(typeof pu.latitude === 'number' ? String(pu.latitude) : '');
    setCorrLng(typeof pu.longitude === 'number' ? String(pu.longitude) : '');
    setCorrCoordsVerified(Boolean(pu.coordinatesVerified));
    setCorrReason('');
  };

  const handleCorrectMasterPu = async (e: FormEvent) => {
    e.preventDefault();
    if (!correctingPu) return;
    const latNum = corrLat.trim() === '' ? null : Number(corrLat);
    const lngNum = corrLng.trim() === '' ? null : Number(corrLng);
    if (
      (latNum !== null && Number.isNaN(latNum)) ||
      (lngNum !== null && Number.isNaN(lngNum))
    ) {
      setFeedback({
        type: 'err',
        text: 'Coordinates must be valid decimal numbers or left empty.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await correctMasterPollingUnit(
        user,
        correctingPu,
        {
          name: corrName,
          locationDescription: corrLocation,
          registeredVoters: Number(corrRegVoters) || 0,
          latitude: latNum,
          longitude: lngNum,
          coordinatesVerified: Boolean(corrCoordsVerified && latNum !== null && lngNum !== null),
        },
        corrReason
      );
      setFeedback({
        type: 'ok',
        text: `Master record ${correctingPu.puCode} updated with immutable snapshot backup in directory_backups.`,
      });
      setCorrectingPu(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save master correction.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Official Directory Import Bar for Full Control Admin */}
      {isFullAdmin ? (
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Official INEC Polling Unit Register
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Verified constituency register: Funtua LGA (20-14 · 11 Wards · 298 PUs) and Dandume LGA (20/07 · 11 Wards · 177 PUs).
              Import is idempotent and never overwrites existing assignments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImportOfficial()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>
                {importing
                  ? 'Importing Directory...'
                  : pollingUnits.length >= 475
                    ? 'Verify / Sync Official Directory'
                    : 'Import Official Directory (475 PUs)'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add PU</span>
            </button>
          </div>
        </div>
      ) : null}

      {importSummary ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">
              Dataset {importSummary.datasetVersion} verified in Cloud Firestore
            </p>
            <p className="font-mono tabular-nums">
              Funtua: {importSummary.funtuaVerifiedInDatabase} / 298 · Dandume:{' '}
              {importSummary.dandumeVerifiedInDatabase} / 177 · Total:{' '}
              {importSummary.totalVerifiedInDatabase} / 475
            </p>
          </div>
        </div>
      ) : null}

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

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search PU code, name, ward, or agent..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none sm:max-w-xs"
          />

          {authorizedLgas.length > 1 ? (
            <select
              aria-label="Filter by LGA"
              value={lgaFilter}
              onChange={(e) => {
                setLgaFilter(e.target.value as 'all' | LgaId);
                setWardFilter('all');
                setPage(1);
              }}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            >
              <option value="all">All LGAs</option>
              <option value="funtua">Funtua LGA (20-14)</option>
              <option value="dandume">Dandume LGA (20/07)</option>
            </select>
          ) : null}

          <select
            aria-label="Filter by Ward"
            value={wardFilter}
            onChange={(e) => {
              setWardFilter(e.target.value);
              setPage(1);
            }}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
          >
            <option value="all">All Wards ({wardsInFilterLga.length})</option>
            {wardsInFilterLga.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.wardCode})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by Operational Status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'ALL' | PuOperationalStatus);
              setPage(1);
            }}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
          >
            <option value="ALL">All 13 Statuses</option>
            {Object.values(PuOperationalStatus).map((st) => (
              <option key={st} value={st}>
                {PU_STATUS_META[st].label}
              </option>
            ))}
          </select>
        </div>

        <p className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
          {filteredUnits.length} polling unit{filteredUnits.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* Table or Empty State */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading polling units...
        </div>
      ) : filteredUnits.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description={
            pollingUnits.length === 0
              ? 'No polling units have been imported or added yet. Never invent placeholder polling units—use the official register import or manual add workflow.'
              : 'No polling units match your current search or filter criteria.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">PU Code</th>
                  <th className="px-4 py-3">Polling Unit</th>
                  <th className="px-4 py-3">Ward · LGA</th>
                  <th className="px-4 py-3">Assigned Agent</th>
                  <th className="px-4 py-3">Operational Status</th>
                  {canAssign ? <th className="px-4 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedUnits.map((pu) => (
                  <tr key={pu.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                      {pu.puCode}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                        <div>
                          <p className="font-medium text-slate-900">{pu.name}</p>
                          <p className="text-xs text-slate-500">{pu.locationDescription}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                      {pu.wardName} · {LGA_DEFINITIONS[pu.lgaId]?.shortName}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {pu.assignedAgentName ? (
                        <span className="font-medium text-slate-900">{pu.assignedAgentName}</span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PuStatusBadge status={pu.operationalStatus} />
                    </td>
                    {canAssign || canCorrectMaster ? (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {canAssign ? (
                            <button
                              type="button"
                              onClick={() => {
                                setAssigningPu(pu);
                                setSelectedAgentUid(pu.assignedAgentUid || '');
                                setReassignAuditReason('');
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                            >
                              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Assign Agent</span>
                            </button>
                          ) : null}
                          {canCorrectMaster ? (
                            <button
                              type="button"
                              onClick={() => openMasterCorrection(pu)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Edit Master</span>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
              <span className="font-mono tabular-nums">
                Page {safePage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-3 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-3 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Add Polling Unit Modal */}
      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Add Polling Unit Record
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePu} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="pu-lga" className="block text-xs font-medium text-slate-700">
                  LGA
                </label>
                <select
                  id="pu-lga"
                  value={newPuLga}
                  onChange={(e) => {
                    setNewPuLga(e.target.value as LgaId);
                    setNewPuWardId('');
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="funtua">Funtua LGA (20-14)</option>
                  <option value="dandume">Dandume LGA (20/07)</option>
                </select>
              </div>
              <div>
                <label htmlFor="pu-ward" className="block text-xs font-medium text-slate-700">
                  Ward
                </label>
                <select
                  id="pu-ward"
                  required
                  value={newPuWardId}
                  onChange={(e) => setNewPuWardId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Select Ward...</option>
                  {wards
                    .filter((w) => w.lgaId === newPuLga)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.wardCode})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label htmlFor="pu-code" className="block text-xs font-medium text-slate-700">
                  Polling Unit Code
                </label>
                <input
                  id="pu-code"
                  type="text"
                  required
                  value={newPuCode}
                  onChange={(e) => setNewPuCode(e.target.value)}
                  placeholder="e.g. 20-14-01-033"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="pu-name" className="block text-xs font-medium text-slate-700">
                  Polling Unit Name
                </label>
                <input
                  id="pu-name"
                  type="text"
                  required
                  value={newPuName}
                  onChange={(e) => setNewPuName(e.target.value)}
                  placeholder="Official INEC Polling Unit Name"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="pu-loc" className="block text-xs font-medium text-slate-700">
                  Location Description
                </label>
                <input
                  id="pu-loc"
                  type="text"
                  value={newPuLocation}
                  onChange={(e) => setNewPuLocation(e.target.value)}
                  placeholder="School, mosque, or landmark description"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="pu-reg" className="block text-xs font-medium text-slate-700">
                  Registered Voters (Optional)
                </label>
                <input
                  id="pu-reg"
                  type="number"
                  min={0}
                  max={50000}
                  value={newPuRegVoters}
                  onChange={(e) => setNewPuRegVoters(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Create Polling Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Assign Agent Modal */}
      {assigningPu ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Assign Field Agent
                </h3>
                <p className="font-mono text-xs text-slate-500">
                  {assigningPu.puCode} · {assigningPu.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssigningPu(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAssignAgent} className="mt-4 space-y-4">
              {currentPuHolderUid ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                  Currently assigned to{' '}
                  <span className="font-semibold">
                    {activeLockForAssigningPu?.agentName || assigningPu.assignedAgentName}
                  </span>
                  . Selecting &quot;Unassigned&quot; releases the lock; selecting another agent requires{' '}
                  {isFullAdmin ? 'an audited Controlled Reassignment reason.' : 'Full Control Admin override.'}
                </div>
              ) : null}
              <div>
                <label htmlFor="agent-select" className="block text-xs font-medium text-slate-700">
                  Authorized Agent ({LGA_DEFINITIONS[assigningPu.lgaId].shortName})
                </label>
                <select
                  id="agent-select"
                  value={selectedAgentUid}
                  onChange={(e) => setSelectedAgentUid(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="">Unassigned (Release Lock)</option>
                  {agentCandidates.map((u) => {
                    const occupiedElsewhere =
                      u.assignedPollingUnitId && u.assignedPollingUnitId !== assigningPu.id;
                    return (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.email})
                        {occupiedElsewhere ? ` — Assigned: ${u.assignedPollingUnitId}` : ''}
                      </option>
                    );
                  })}
                </select>
                {agentCandidates.length === 0 ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    No active Polling Unit Agents found for {LGA_DEFINITIONS[assigningPu.lgaId].shortName}. Approve an operator in User &amp; Access Control first.
                  </p>
                ) : null}
              </div>

              {needsControlledReassign && isFullAdmin ? (
                <div>
                  <label htmlFor="pu-reassign-reason" className="block text-xs font-medium text-slate-700">
                    Controlled Reassignment Audit Reason (min 4 chars) *
                  </label>
                  <textarea
                    id="pu-reassign-reason"
                    required
                    minLength={4}
                    maxLength={400}
                    rows={2}
                    value={reassignAuditReason}
                    onChange={(e) => setReassignAuditReason(e.target.value)}
                    placeholder="Specify reason for replacing current assigned agent..."
                    className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm text-slate-900"
                  />
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssigningPu(null)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || (needsControlledReassign && !isFullAdmin)}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {saving ? 'Assigning...' : 'Save Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {/* Controlled Master PU Correction Modal (Full Control Admin only) */}
      {correctingPu ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Controlled Master PU Correction
                </h3>
                <p className="font-mono text-xs text-slate-500">
                  {correctingPu.puCode} · {correctingPu.wardName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCorrectingPu(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              Creates an immutable pre-change backup in <span className="font-mono">directory_backups</span> and records the correction reason in <span className="font-mono">audit_logs</span>. Never enter unverified coordinates.
            </p>
            <form onSubmit={handleCorrectMasterPu} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="corr-name" className="block text-xs font-medium text-slate-700">
                  Official Polling Unit Name
                </label>
                <input
                  id="corr-name"
                  type="text"
                  required
                  minLength={2}
                  value={corrName}
                  onChange={(e) => setCorrName(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="corr-loc" className="block text-xs font-medium text-slate-700">
                  Location Description
                </label>
                <input
                  id="corr-loc"
                  type="text"
                  value={corrLocation}
                  onChange={(e) => setCorrLocation(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="corr-reg" className="block text-xs font-medium text-slate-700">
                  Registered Voters (Official Register)
                </label>
                <input
                  id="corr-reg"
                  type="number"
                  min={0}
                  max={50000}
                  value={corrRegVoters}
                  onChange={(e) => setCorrRegVoters(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="corr-lat" className="block text-xs font-medium text-slate-700">
                    Verified Latitude (Optional)
                  </label>
                  <input
                    id="corr-lat"
                    type="text"
                    value={corrLat}
                    onChange={(e) => setCorrLat(e.target.value)}
                    placeholder="Leave blank if unverified"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="corr-lng" className="block text-xs font-medium text-slate-700">
                    Verified Longitude (Optional)
                  </label>
                  <input
                    id="corr-lng"
                    type="text"
                    value={corrLng}
                    onChange={(e) => setCorrLng(e.target.value)}
                    placeholder="Leave blank if unverified"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm font-mono"
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={corrCoordsVerified}
                  onChange={(e) => setCorrCoordsVerified(e.target.checked)}
                  className="h-4 w-4 accent-[#0b3b24]"
                />
                <span>Confirm field-verified coordinates</span>
              </label>
              <div>
                <label htmlFor="corr-reason" className="block text-xs font-medium text-slate-700">
                  Mandatory Audit Reason (min 5 chars)
                </label>
                <textarea
                  id="corr-reason"
                  required
                  minLength={5}
                  rows={2}
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Specify official INEC register correction or field verification basis..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCorrectingPu(null)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {saving ? 'Backing Up & Saving...' : 'Backup & Save Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
