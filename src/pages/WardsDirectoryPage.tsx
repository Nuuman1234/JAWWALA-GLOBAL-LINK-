import { useMemo, useState, type FormEvent } from 'react';
import { BarChart3, Building2, Plus, UserCheck, X } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { ResultBarChart } from '../components/ResultBarChart';
import {
  AccountStatus,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  UserRole,
  VerificationStatus,
  getAuthorizedLgas,
  isIncidentActive,
  isPuReporting,
  type ApprovedPuResult,
  type IncidentReport,
  type LgaId,
  type PartyCode,
  type PartyConfig,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import {
  assignWardCoordinator,
  computeWardOperationsCoverage,
  createWard,
} from '../services/directoryService';
import { buildWardSummary, getCanonicalApprovedPuResults } from '../utils/aggregationEngine';

interface WardsDirectoryPageProps {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
  users: UserAccount[];
  incidents?: IncidentReport[];
  results?: ResultSubmission[];
  approvedPuResults?: ApprovedPuResult[];
  partyConfigs?: Partial<Record<PartyCode, PartyConfig | null>>;
  loading: boolean;
}

export function WardsDirectoryPage({
  user,
  wards,
  pollingUnits,
  users,
  incidents = [],
  results = [],
  approvedPuResults = [],
  partyConfigs = {},
  loading,
}: WardsDirectoryPageProps) {
  const authorizedLgas = getAuthorizedLgas(user);
  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [assigningWard, setAssigningWard] = useState<Ward | null>(null);
  const [chartWard, setChartWard] = useState<Ward | null>(null);
  const [selectedCoordUid, setSelectedCoordUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [newWardLga, setNewWardLga] = useState<LgaId>('funtua');
  const [newWardCode, setNewWardCode] = useState('');
  const [newWardName, setNewWardName] = useState('');
  const [newWardExpected, setNewWardExpected] = useState('20');

  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;

  const canonicalApproved = useMemo(
    () => getCanonicalApprovedPuResults(approvedPuResults, results),
    [approvedPuResults, results]
  );

  const opsCoverageByWard = useMemo(() => {
    const map = new Map<string, { activeCount: number; isCompliant: boolean }>();
    computeWardOperationsCoverage(wards, users, MIN_OPERATIONS_OFFICERS_PER_WARD).forEach(
      (item) => {
        map.set(item.wardId, {
          activeCount: item.activeCount,
          isCompliant: item.isCompliant,
        });
      }
    );
    return map;
  }, [wards, users]);

  const filteredWards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return wards.filter((w) => {
      if (lgaFilter !== 'all' && w.lgaId !== lgaFilter) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.wardCode.toLowerCase().includes(q) ||
        w.coordinatorName.toLowerCase().includes(q)
      );
    });
  }, [wards, lgaFilter, search]);

  const coordinatorCandidates = useMemo(() => {
    if (!assigningWard) return [];
    return users.filter(
      (u) =>
        u.status === AccountStatus.ACTIVE &&
        !u.sessionRevoked &&
        (u.role === UserRole.WARD_COORDINATOR ||
          u.role === UserRole.FUNTUA_SUPER_ADMIN ||
          u.role === UserRole.DANDUME_SUPER_ADMIN ||
          u.role === UserRole.FULL_CONTROL_ADMIN) &&
        (u.assignedLgaId === '' || u.assignedLgaId === assigningWard.lgaId)
    );
  }, [users, assigningWard]);

  const handleAddWard = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await createWard(user, {
        lgaId: newWardLga,
        wardCode: newWardCode,
        name: newWardName,
        expectedPollingUnits: Number(newWardExpected) || 0,
      });
      setFeedback({ type: 'ok', text: `Ward ${newWardName.trim()} created.` });
      setNewWardCode('');
      setNewWardName('');
      setShowAddModal(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to create ward.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAssignCoordinator = async (e: FormEvent) => {
    e.preventDefault();
    if (!assigningWard) return;
    setBusy(true);
    setFeedback(null);
    try {
      const coord = users.find((u) => u.uid === selectedCoordUid) || null;
      await assignWardCoordinator(user, assigningWard, coord);
      setFeedback({
        type: 'ok',
        text: coord
          ? `Assigned ${coord.displayName} to ${assigningWard.name} Ward.`
          : `Cleared coordinator for ${assigningWard.name} Ward.`,
      });
      setAssigningWard(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to assign coordinator.',
      });
    } finally {
      setBusy(false);
    }
  };

  const chartWardSummary = useMemo(() => {
    if (!chartWard) return null;
    return buildWardSummary(chartWard, canonicalApproved, pollingUnits, results);
  }, [chartWard, canonicalApproved, pollingUnits, results]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ward name, code, or coordinator..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none sm:max-w-xs"
          />

          {authorizedLgas.length > 1 ? (
            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['all', 'funtua', 'dandume'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setLgaFilter(opt)}
                  className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    lgaFilter === opt
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt === 'all' ? 'All LGAs' : LGA_DEFINITIONS[opt].shortName}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {isFullAdmin ? (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Ward</span>
          </button>
        ) : null}
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

      {/* Wards List */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading electoral wards...
        </div>
      ) : filteredWards.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="No electoral wards exist in this scope yet. The Full Control Admin can import the official 22-ward register from Polling Units or add a ward manually."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Ward</th>
                  <th className="px-4 py-3">LGA</th>
                  <th className="px-4 py-3 text-right">Polling Units</th>
                  <th className="px-4 py-3 text-right">Reporting</th>
                  <th className="px-4 py-3 text-right">Active Incidents</th>
                  <th className="px-4 py-3 text-right">Results (Ver/Sub)</th>
                  <th className="px-4 py-3">Verified Party Tallies</th>
                  <th className="px-4 py-3 text-right">Ops Officers</th>
                  <th className="px-4 py-3">Ward Coordinator</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredWards.map((ward) => {
                  const wardPus = pollingUnits.filter((p) => p.wardId === ward.id);
                  const loadedPus = wardPus.length;
                  const reportingPus = wardPus.filter((p) =>
                    isPuReporting(p.operationalStatus)
                  ).length;
                  const activeInc = incidents.filter(
                    (i) => i.wardId === ward.id && isIncidentActive(i.status)
                  ).length;
                  const wardResults = results.filter((r) => r.wardId === ward.id);
                  const verifiedResults = wardResults.filter(
                    (r) => r.verificationStatus === VerificationStatus.VERIFIED
                  ).length;
                  const wardSummary = buildWardSummary(ward, canonicalApproved, pollingUnits, results);

                  return (
                    <tr key={ward.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Building2 className="h-4 w-4 shrink-0 text-[#0b3b24]" aria-hidden="true" />
                          <div>
                            <p className="font-medium text-slate-900">{ward.name}</p>
                            <p className="font-mono text-xs text-slate-500">{ward.wardCode}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 whitespace-nowrap">
                        {LGA_DEFINITIONS[ward.lgaId]?.displayName || ward.lgaId}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                        {loadedPus} / {ward.expectedPollingUnits}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-700 tabular-nums">
                        {reportingPus}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                        <span className={activeInc > 0 ? 'font-semibold text-red-700' : 'text-slate-600'}>
                          {activeInc}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-700 tabular-nums">
                        {verifiedResults} / {wardResults.length}
                      </td>
                      <td className="px-4 py-3.5">
                        {wardSummary.verifiedPuCount > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums">
                            {wardSummary.standings.map((st) => (
                              <span
                                key={st.code}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-800"
                              >
                                <PartyLogo
                                  partyCode={st.code}
                                  partyConfig={partyConfigs[st.code]}
                                  size="xs"
                                />
                                <span>{st.code}:</span>
                                <strong>{st.votes.toLocaleString()}</strong>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No verified votes</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {(() => {
                          const cov = opsCoverageByWard.get(ward.id);
                          const count = cov?.activeCount ?? 0;
                          const ok = cov?.isCompliant ?? false;
                          return (
                            <span
                              className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                                ok
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                  : 'border-amber-200 bg-amber-50 text-amber-900'
                              }`}
                              title={`Active Operations Officers vs minimum ${MIN_OPERATIONS_OFFICERS_PER_WARD}`}
                            >
                              {count} / {MIN_OPERATIONS_OFFICERS_PER_WARD}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3.5">
                        {ward.coordinatorName ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-800">
                            <UserCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                            <span>{ward.coordinatorName}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setChartWard(ward)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                          >
                            <BarChart3 className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
                            <span>Chart</span>
                          </button>
                          {isFullAdmin ? (
                            <button
                              type="button"
                              onClick={() => {
                                setAssigningWard(ward);
                                setSelectedCoordUid(ward.coordinatorUid || '');
                              }}
                              className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                            >
                              Assign Coord
                            </button>
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

      {/* Ward Verified Chart Modal */}
      {chartWard && chartWardSummary ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {chartWard.name} Ward ({chartWard.wardCode}) ·{' '}
                  {LGA_DEFINITIONS[chartWard.lgaId]?.displayName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setChartWard(null)}
                aria-label="Close ward chart modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ResultBarChart
              title={`${chartWard.name} Ward Verified Result Summary`}
              subtitle={`Aggregated from ${chartWardSummary.verifiedPuCount} verified PU(s) out of ${chartWardSummary.expectedPuCount} in ward.`}
              summary={chartWardSummary}
              partyConfigs={partyConfigs}
            />
          </div>
        </div>
      ) : null}

      {/* Add Ward Modal */}
      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">Add Official Ward</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAddWard} className="mt-4 space-y-4">
              <div>
                <label htmlFor="ward-lga" className="block text-xs font-medium text-slate-700">
                  Local Government Area
                </label>
                <select
                  id="ward-lga"
                  value={newWardLga}
                  onChange={(e) => setNewWardLga(e.target.value as LgaId)}
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="funtua">Funtua LGA (20-14)</option>
                  <option value="dandume">Dandume LGA (20/07)</option>
                </select>
              </div>
              <div>
                <label htmlFor="ward-code" className="block text-xs font-medium text-slate-700">
                  Official Ward Code
                </label>
                <input
                  id="ward-code"
                  type="text"
                  required
                  value={newWardCode}
                  onChange={(e) => setNewWardCode(e.target.value)}
                  placeholder="e.g. 20-14-01"
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="ward-name" className="block text-xs font-medium text-slate-700">
                  Official Ward Name
                </label>
                <input
                  id="ward-name"
                  type="text"
                  required
                  value={newWardName}
                  onChange={(e) => setNewWardName(e.target.value)}
                  placeholder="e.g. DANDUTSE"
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="ward-expected" className="block text-xs font-medium text-slate-700">
                  Expected Polling Units
                </label>
                <input
                  id="ward-expected"
                  type="number"
                  min={0}
                  max={500}
                  value={newWardExpected}
                  onChange={(e) => setNewWardExpected(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
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
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {busy ? 'Saving...' : 'Save Ward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Assign Coordinator Modal */}
      {assigningWard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Assign Ward Coordinator · {assigningWard.name}
              </h3>
              <button
                type="button"
                onClick={() => setAssigningWard(null)}
                aria-label="Close modal"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAssignCoordinator} className="mt-4 space-y-4">
              <div>
                <label htmlFor="coord-select" className="block text-xs font-medium text-slate-700">
                  Select Authorized Coordinator
                </label>
                <select
                  id="coord-select"
                  value={selectedCoordUid}
                  onChange={(e) => setSelectedCoordUid(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="">Unassigned</option>
                  {coordinatorCandidates.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
                {coordinatorCandidates.length === 0 ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    No active Ward Coordinators are registered in{' '}
                    {LGA_DEFINITIONS[assigningWard.lgaId].shortName} yet. Approve a user in User
                    Management first.
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssigningWard(null)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {busy ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
