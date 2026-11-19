import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Filter,
  Info,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import {
  LGA_DEFINITIONS,
  PU_STATUS_META,
  PuOperationalStatus,
  VerificationStatus,
  formatFirestoreTime,
  isIncidentActive,
  type AgentCheckIn,
  type IncidentReport,
  type LgaId,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';

interface SituationMapPanelProps {
  wards: Ward[];
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  users?: UserAccount[];
}

type MapCategoryFilter =
  | 'ALL'
  | 'ACTIVE_INCIDENTS'
  | 'VERIFIED_RESULTS'
  | 'PENDING_RESULTS'
  | 'MISSING_REPORTS'
  | 'CHECKED_IN'
  | 'UNASSIGNED';

type PuVisualStateKey =
  | 'INCIDENT_REPORTED'
  | 'VERIFIED'
  | 'RESULT_PENDING'
  | 'ACTIVE_VOTING'
  | 'CHECKED_IN'
  | 'AGENT_ASSIGNED'
  | 'UNASSIGNED'
  | 'NOT_REPORTED';

const STATE_VISUALS: Record<
  PuVisualStateKey,
  { label: string; dotClass: string; fillHex: string; badgeClass: string }
> = {
  INCIDENT_REPORTED: {
    label: 'Incident Reported',
    dotClass: 'bg-rose-600',
    fillHex: '#e11d48',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  VERIFIED: {
    label: 'Result Verified',
    dotClass: 'bg-emerald-600',
    fillHex: '#059669',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  RESULT_PENDING: {
    label: 'Result Submitted / Pending',
    dotClass: 'bg-amber-500',
    fillHex: '#d97706',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  ACTIVE_VOTING: {
    label: 'Materials / Voting Active',
    dotClass: 'bg-sky-600',
    fillHex: '#0284c7',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  CHECKED_IN: {
    label: 'Officer / Agent Checked In',
    dotClass: 'bg-teal-600',
    fillHex: '#0d9488',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  AGENT_ASSIGNED: {
    label: 'Agent Assigned (No Check-In)',
    dotClass: 'bg-indigo-500',
    fillHex: '#6366f1',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  UNASSIGNED: {
    label: 'Unassigned / Coverage Gap',
    dotClass: 'bg-slate-400',
    fillHex: '#94a3b8',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  NOT_REPORTED: {
    label: 'Not Yet Reported',
    dotClass: 'bg-slate-300',
    fillHex: '#cbd5e1',
    badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
  },
};

export const SituationMapPanel: React.FC<SituationMapPanelProps> = ({
  wards,
  pollingUnits,
  checkIns,
  incidents,
  results,
  users = [],
}) => {
  const [selectedLga, setSelectedLga] = useState<'all' | LgaId>('all');
  const [selectedWardId, setSelectedWardId] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<MapCategoryFilter>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'GEO_PLOT' | 'WARD_MATRIX' | 'UNCOORDINATED'>('GEO_PLOT');
  const [selectedPuId, setSelectedPuId] = useState<string | null>(null);

  const visibleWards = useMemo(
    () =>
      selectedLga === 'all'
        ? wards
        : wards.filter((w) => w.lgaId === selectedLga),
    [wards, selectedLga]
  );

  // Index records by PU ID
  const latestCheckInByPu = useMemo(() => {
    const map = new Map<string, AgentCheckIn>();
    for (const c of checkIns) {
      if (dateFilter) {
        const iso = c.clientCreatedAtIso || '';
        if (iso && !iso.startsWith(dateFilter)) continue;
      }
      if (!map.has(c.puId)) map.set(c.puId, c);
    }
    return map;
  }, [checkIns, dateFilter]);

  const incidentsByPu = useMemo(() => {
    const map = new Map<string, IncidentReport[]>();
    for (const inc of incidents) {
      if (dateFilter) {
        const iso = inc.clientCreatedAtIso || '';
        if (iso && !iso.startsWith(dateFilter)) continue;
      }
      const list = map.get(inc.puId) || [];
      list.push(inc);
      map.set(inc.puId, list);
    }
    return map;
  }, [incidents, dateFilter]);

  const latestResultByPu = useMemo(() => {
    const map = new Map<string, ResultSubmission>();
    for (const r of results) {
      if (dateFilter) {
        const iso = r.clientCreatedAtIso || '';
        if (iso && !iso.startsWith(dateFilter)) continue;
      }
      if (!map.has(r.puId)) map.set(r.puId, r);
    }
    return map;
  }, [results, dateFilter]);

  const assignedUsersByPu = useMemo(() => {
    const map = new Map<string, UserAccount>();
    for (const u of users) {
      if (u.assignedPollingUnitId) {
        map.set(u.assignedPollingUnitId, u);
      }
    }
    return map;
  }, [users]);

  const enrichedUnits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pollingUnits
      .filter((pu) => {
        if (selectedLga !== 'all' && pu.lgaId !== selectedLga) return false;
        if (selectedWardId !== 'all' && pu.wardId !== selectedWardId) return false;
        if (
          q &&
          !pu.puCode.toLowerCase().includes(q) &&
          !pu.name.toLowerCase().includes(q) &&
          !pu.wardName.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .map((pu) => {
        const checkIn = latestCheckInByPu.get(pu.id) || null;
        const puIncidents = incidentsByPu.get(pu.id) || [];
        const activeIncidents = puIncidents.filter((i) => isIncidentActive(i.status));
        const result = latestResultByPu.get(pu.id) || null;
        const assignedUser = assignedUsersByPu.get(pu.id) || null;
        const hasAssignedAgent = Boolean(pu.assignedAgentUid || assignedUser);

        let visualState: PuVisualStateKey = 'NOT_REPORTED';
        if (activeIncidents.length > 0 || pu.operationalStatus === PuOperationalStatus.INCIDENT_REPORTED) {
          visualState = 'INCIDENT_REPORTED';
        } else if (
          result?.verificationStatus === VerificationStatus.VERIFIED ||
          pu.operationalStatus === PuOperationalStatus.RESULT_VERIFIED
        ) {
          visualState = 'VERIFIED';
        } else if (
          result &&
          result.verificationStatus !== VerificationStatus.DRAFT
        ) {
          visualState = 'RESULT_PENDING';
        } else if (
          pu.operationalStatus === PuOperationalStatus.MATERIALS_ARRIVED ||
          pu.operationalStatus === PuOperationalStatus.VOTING_STARTED ||
          pu.operationalStatus === PuOperationalStatus.VOTING_IN_PROGRESS ||
          pu.operationalStatus === PuOperationalStatus.VOTING_COMPLETED ||
          pu.operationalStatus === PuOperationalStatus.COUNTING_STARTED
        ) {
          visualState = 'ACTIVE_VOTING';
        } else if (
          checkIn ||
          pu.operationalStatus === PuOperationalStatus.AGENT_CHECKED_IN
        ) {
          visualState = 'CHECKED_IN';
        } else if (hasAssignedAgent) {
          visualState = 'AGENT_ASSIGNED';
        } else {
          visualState = 'UNASSIGNED';
        }

        const hasVerifiedCoords =
          Boolean(pu.coordinatesVerified) &&
          typeof pu.latitude === 'number' &&
          typeof pu.longitude === 'number';
        const gpsCheckInCoords =
          typeof checkIn?.latitude === 'number' && typeof checkIn?.longitude === 'number'
            ? { lat: checkIn.latitude, lng: checkIn.longitude }
            : null;

        return {
          pu,
          checkIn,
          puIncidents,
          activeIncidents,
          result,
          assignedUser,
          hasAssignedAgent,
          visualState,
          hasVerifiedCoords,
          gpsCheckInCoords,
        };
      })
      .filter((item) => {
        if (categoryFilter === 'ACTIVE_INCIDENTS') return item.activeIncidents.length > 0;
        if (categoryFilter === 'VERIFIED_RESULTS') return item.visualState === 'VERIFIED';
        if (categoryFilter === 'PENDING_RESULTS') return item.visualState === 'RESULT_PENDING';
        if (categoryFilter === 'MISSING_REPORTS') return !item.result && !item.checkIn;
        if (categoryFilter === 'CHECKED_IN') return Boolean(item.checkIn);
        if (categoryFilter === 'UNASSIGNED') return !item.hasAssignedAgent;
        return true;
      });
  }, [
    pollingUnits,
    selectedLga,
    selectedWardId,
    searchQuery,
    latestCheckInByPu,
    incidentsByPu,
    latestResultByPu,
    assignedUsersByPu,
    categoryFilter,
  ]);

  // Verified GPS points (strictly real coordinates from PU master directory or real GPS check-in pins — never invented)
  const plottedPoints = useMemo(() => {
    const pts: Array<{
      puId: string;
      puCode: string;
      name: string;
      wardName: string;
      lat: number;
      lng: number;
      source: 'VERIFIED_PU' | 'GPS_CHECKIN';
      visualState: PuVisualStateKey;
    }> = [];

    for (const item of enrichedUnits) {
      if (item.hasVerifiedCoords && typeof item.pu.latitude === 'number' && typeof item.pu.longitude === 'number') {
        pts.push({
          puId: item.pu.id,
          puCode: item.pu.puCode,
          name: item.pu.name,
          wardName: item.pu.wardName,
          lat: item.pu.latitude,
          lng: item.pu.longitude,
          source: 'VERIFIED_PU',
          visualState: item.visualState,
        });
      } else if (item.gpsCheckInCoords) {
        pts.push({
          puId: item.pu.id,
          puCode: item.pu.puCode,
          name: item.pu.name,
          wardName: item.pu.wardName,
          lat: item.gpsCheckInCoords.lat,
          lng: item.gpsCheckInCoords.lng,
          source: 'GPS_CHECKIN',
          visualState: item.visualState,
        });
      }
    }
    return pts;
  }, [enrichedUnits]);

  const uncoordinatedUnits = useMemo(
    () => enrichedUnits.filter((item) => !item.hasVerifiedCoords && !item.gpsCheckInCoords),
    [enrichedUnits]
  );

  // Bounding box for SVG projection (only over actual real points)
  const geoBounds = useMemo(() => {
    if (plottedPoints.length === 0) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of plottedPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const latPad = Math.max(0.015, (maxLat - minLat) * 0.14);
    const lngPad = Math.max(0.015, (maxLng - minLng) * 0.14);
    return {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    };
  }, [plottedPoints]);

  const wardBreakdown = useMemo(() => {
    const byWard = new Map<string, typeof enrichedUnits>();
    for (const item of enrichedUnits) {
      const list = byWard.get(item.pu.wardId) || [];
      list.push(item);
      byWard.set(item.pu.wardId, list);
    }
    return visibleWards.map((w) => {
      const units = byWard.get(w.id) || [];
      return {
        ward: w,
        units,
        verified: units.filter((u) => u.visualState === 'VERIFIED').length,
        checkedIn: units.filter((u) => Boolean(u.checkIn)).length,
        incidents: units.filter((u) => u.activeIncidents.length > 0).length,
        unassigned: units.filter((u) => !u.hasAssignedAgent).length,
      };
    });
  }, [enrichedUnits, visibleWards]);

  const selectedUnit = useMemo(
    () => enrichedUnits.find((u) => u.pu.id === selectedPuId) || null,
    [enrichedUnits, selectedPuId]
  );

  const verifiedCoordsCount = enrichedUnits.filter((u) => u.hasVerifiedCoords).length;
  const gpsCheckInPinCount = plottedPoints.filter((p) => p.source === 'GPS_CHECKIN').length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-900">
              Live Election Situation Map &amp; Geographic Coverage
            </h2>
          </div>
          <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
            Showing {enrichedUnits.length} polling units · {verifiedCoordsCount} verified PU GPS coordinates ·{' '}
            {gpsCheckInPinCount} GPS field check-in pins · {uncoordinatedUnits.length} awaiting coordinate verification
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode('GEO_PLOT')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === 'GEO_PLOT'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            GPS Coordinate Map ({plottedPoints.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('WARD_MATRIX')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === 'WARD_MATRIX'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Ward Coverage Grid ({visibleWards.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('UNCOORDINATED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === 'UNCOORDINATED'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Uncoordinated PU Directory ({uncoordinatedUnits.length})
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search PU code, name, ward..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
          />
        </div>

        <select
          value={selectedLga}
          onChange={(e) => {
            setSelectedLga(e.target.value as 'all' | LgaId);
            setSelectedWardId('all');
          }}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
        >
          <option value="all">All LGAs (Funtua &amp; Dandume)</option>
          <option value="funtua">{LGA_DEFINITIONS.funtua.displayName}</option>
          <option value="dandume">{LGA_DEFINITIONS.dandume.displayName}</option>
        </select>

        <select
          value={selectedWardId}
          onChange={(e) => setSelectedWardId(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
        >
          <option value="all">All Wards ({visibleWards.length})</option>
          {visibleWards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.lgaId.toUpperCase()})
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as MapCategoryFilter)}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
        >
          <option value="ALL">All Operational States</option>
          <option value="ACTIVE_INCIDENTS">Active Incidents Only</option>
          <option value="VERIFIED_RESULTS">Verified Results Only</option>
          <option value="PENDING_RESULTS">Submitted / Pending Results</option>
          <option value="CHECKED_IN">Checked-In Units</option>
          <option value="MISSING_REPORTS">Not Yet Reported</option>
          <option value="UNASSIGNED">Unassigned / Coverage Gaps</option>
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter reports by date"
            className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
          />
          {(dateFilter || searchQuery || selectedLga !== 'all' || selectedWardId !== 'all' || categoryFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSelectedLga('all');
                setSelectedWardId('all');
                setCategoryFilter('ALL');
                setDateFilter('');
                setSearchQuery('');
              }}
              className="px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg bg-white whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-2.5 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600 bg-white">
        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
          <Filter className="w-3 h-3" /> Legend:
        </span>
        {(Object.keys(STATE_VISUALS) as PuVisualStateKey[]).map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${STATE_VISUALS[key].dotClass}`} />
            {STATE_VISUALS[key].label}
          </span>
        ))}
      </div>

      {/* Main Content + Detail Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        <div className="xl:col-span-2 p-4">
          {viewMode === 'GEO_PLOT' && (
            <div>
              {plottedPoints.length === 0 || !geoBounds ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-3">
                  <MapPin className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="max-w-lg mx-auto">
                    <h3 className="text-sm font-bold text-slate-900">
                      No Verified GPS Coordinates Plotted Yet
                    </h3>
                    <p className="text-xs text-slate-600 mt-1">
                      FDMIS strictly plots only verified Polling Unit GPS coordinates or live officer GPS
                      check-ins and never fabricates map locations. As officers submit GPS-verified
                      check-ins or administrators verify coordinates in Polling Units, pins appear
                      automatically on this coordinate canvas.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setViewMode('WARD_MATRIX')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 whitespace-nowrap"
                    >
                      Open Ward Coverage Grid
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('UNCOORDINATED')}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100 whitespace-nowrap"
                    >
                      Browse {uncoordinatedUnits.length} Uncoordinated PUs
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="relative rounded-xl border border-slate-200 bg-slate-900 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between text-[11px] text-slate-300 tabular-nums">
                      <span>
                        Constituency Verified Coordinate Canvas · Lat {geoBounds.minLat.toFixed(4)}° to{' '}
                        {geoBounds.maxLat.toFixed(4)}° · Lng {geoBounds.minLng.toFixed(4)}° to{' '}
                        {geoBounds.maxLng.toFixed(4)}°
                      </span>
                      <span>Click any marker to inspect Polling Unit</span>
                    </div>
                    <svg
                      viewBox="0 0 800 420"
                      className="w-full h-[360px] block select-none"
                      role="img"
                      aria-label="Funtua-Dandume verified polling unit GPS coordinate map"
                    >
                      {/* Subtle graticule */}
                      {[1, 2, 3, 4, 5].map((i) => (
                        <g key={i} stroke="#1e293b" strokeWidth="1">
                          <line x1={(800 / 6) * i} y1="0" x2={(800 / 6) * i} y2="420" />
                          <line x1="0" y1={(420 / 6) * i} x2="800" y2={(420 / 6) * i} />
                        </g>
                      ))}

                      {plottedPoints.map((pt) => {
                        const x =
                          40 +
                          ((pt.lng - geoBounds.minLng) / (geoBounds.maxLng - geoBounds.minLng)) *
                            720;
                        const y =
                          380 -
                          ((pt.lat - geoBounds.minLat) / (geoBounds.maxLat - geoBounds.minLat)) *
                            340;
                        const isSelected = selectedPuId === pt.puId;
                        const color = STATE_VISUALS[pt.visualState].fillHex;
                        return (
                          <g
                            key={pt.puId}
                            onClick={() => setSelectedPuId(pt.puId)}
                            className="cursor-pointer"
                          >
                            {isSelected && (
                              <circle
                                cx={x}
                                cy={y}
                                r={14}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth={2}
                              />
                            )}
                            <circle
                              cx={x}
                              cy={y}
                              r={isSelected ? 8 : 6}
                              fill={color}
                              stroke={pt.source === 'VERIFIED_PU' ? '#ffffff' : '#fde68a'}
                              strokeWidth={1.8}
                            />
                            <title>
                              {pt.puCode} — {pt.name} ({pt.wardName}) ·{' '}
                              {pt.source === 'VERIFIED_PU'
                                ? 'Verified PU Coordinates'
                                : 'GPS Check-In Location'}
                            </title>
                          </g>
                        );
                      })}
                    </svg>
                    <div className="px-3 py-2 bg-slate-800/80 border-t border-slate-700 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                      <span>White ring = Verified PU Coordinates · Gold ring = Live GPS Check-In Pin</span>
                      {uncoordinatedUnits.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setViewMode('UNCOORDINATED')}
                          className="text-emerald-300 hover:underline font-medium"
                        >
                          View {uncoordinatedUnits.length} PUs without verified GPS →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {viewMode === 'WARD_MATRIX' && (
            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              {wardBreakdown.map(({ ward, units, verified, checkedIn, incidents: incCount, unassigned }) => (
                <div
                  key={ward.id}
                  className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900">
                        {ward.name}{' '}
                        <span className="font-normal text-slate-500">
                          · {LGA_DEFINITIONS[ward.lgaId]?.displayName || ward.lgaId}
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-600 tabular-nums">
                        {units.length} PUs · {checkedIn} checked in · {verified} verified ·{' '}
                        {incCount} active incidents · {unassigned} unassigned
                      </p>
                    </div>
                  </div>
                  {units.length === 0 ? (
                    <p className="text-[11px] text-slate-500">No polling units match current filter.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {units.map((u) => (
                        <button
                          key={u.pu.id}
                          type="button"
                          onClick={() => setSelectedPuId(u.pu.id)}
                          title={`${u.pu.puCode} · ${u.pu.name} (${STATE_VISUALS[u.visualState].label})`}
                          className={`px-2 py-1 rounded-md text-[11px] font-mono font-medium border transition-colors ${
                            selectedPuId === u.pu.id
                              ? 'ring-2 ring-slate-900 border-slate-900 bg-white text-slate-900'
                              : STATE_VISUALS[u.visualState].badgeClass
                          }`}
                        >
                          {u.pu.puCode.split('/').slice(-1)[0] || u.pu.puCode}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {viewMode === 'UNCOORDINATED' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <span>
                  These polling units have official INEC/FDMIS records but do not yet have verified GPS
                  coordinates or a GPS check-in pin. Select any row to inspect operational status.
                </span>
              </div>
              <div className="max-h-[390px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {uncoordinatedUnits.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    All polling units in this filter have verified coordinates or GPS check-in pins.
                  </p>
                ) : (
                  uncoordinatedUnits.slice(0, 200).map((item) => (
                    <button
                      key={item.pu.id}
                      type="button"
                      onClick={() => setSelectedPuId(item.pu.id)}
                      className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors ${
                        selectedPuId === item.pu.id ? 'bg-emerald-50/70' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {item.pu.puCode}
                          </span>
                          <span className="text-xs text-slate-800 truncate">{item.pu.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.pu.wardName} · {LGA_DEFINITIONS[item.pu.lgaId]?.displayName}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-md border ${
                          STATE_VISUALS[item.visualState].badgeClass
                        }`}
                      >
                        {STATE_VISUALS[item.visualState].label}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {uncoordinatedUnits.length > 200 && (
                <p className="text-[11px] text-slate-500 text-right">
                  Showing first 200 of {uncoordinatedUnits.length} — refine search or ward filter to narrow down.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right Detail Panel */}
        <div className="p-4 bg-slate-50/40">
          {!selectedUnit ? (
            <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center p-4">
              <Navigation className="w-7 h-7 text-slate-300 mb-2" />
              <h3 className="text-sm font-bold text-slate-800">Polling Unit Inspector</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
                Select any GPS marker, Ward Grid cell, or Polling Unit directory entry to view full
                status, assigned personnel, check-ins, incidents, and verification progress.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs font-bold text-emerald-800">
                    {selectedUnit.pu.puCode}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                    {selectedUnit.pu.name}
                  </h3>
                  <p className="text-xs text-slate-600">
                    {selectedUnit.pu.wardName} ·{' '}
                    {LGA_DEFINITIONS[selectedUnit.pu.lgaId]?.displayName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPuId(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
                  aria-label="Close polling unit detail"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border ${
                    STATE_VISUALS[selectedUnit.visualState].badgeClass
                  }`}
                >
                  {STATE_VISUALS[selectedUnit.visualState].label}
                </span>
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-md border border-slate-200 bg-white text-slate-700">
                  {PU_STATUS_META[selectedUnit.pu.operationalStatus]?.label ||
                    selectedUnit.pu.operationalStatus}
                </span>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Coordinates</span>
                  <span className="font-mono text-slate-800 text-right">
                    {selectedUnit.hasVerifiedCoords
                      ? `${selectedUnit.pu.latitude?.toFixed(5)}, ${selectedUnit.pu.longitude?.toFixed(5)} (Verified)`
                      : selectedUnit.gpsCheckInCoords
                        ? `${selectedUnit.gpsCheckInCoords.lat.toFixed(5)}, ${selectedUnit.gpsCheckInCoords.lng.toFixed(5)} (Check-in)`
                        : 'Not yet verified'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Assigned Agent</span>
                  <span className="font-medium text-slate-900 text-right">
                    {selectedUnit.pu.assignedAgentName ||
                      selectedUnit.assignedUser?.displayName ||
                      'Unassigned'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Latest Check-In</span>
                  <span className="text-slate-800 text-right">
                    {selectedUnit.checkIn
                      ? `${selectedUnit.checkIn.agentName} · ${selectedUnit.checkIn.arrivalTimeText}`
                      : 'Not yet reported'}
                  </span>
                </div>
                {selectedUnit.checkIn?.locationExceptionFlag && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
                    Location review note: GPS reading was{' '}
                    {selectedUnit.checkIn.locationExceptionDistanceMeters}m from verified PU point (
                    {selectedUnit.checkIn.exceptionReviewStatus || 'PENDING_REVIEW'}).
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Active Incidents</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {selectedUnit.activeIncidents.length} active / {selectedUnit.puIncidents.length} total
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Result Status</span>
                  <span className="font-semibold text-slate-900">
                    {selectedUnit.result ? selectedUnit.result.verificationStatus : 'Not yet reported'}
                  </span>
                </div>
                {selectedUnit.result && (
                  <div className="pt-2 border-t border-slate-100 grid grid-cols-4 gap-1.5 text-center tabular-nums">
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[10px] text-slate-500">APC</div>
                      <div className="text-xs font-bold text-slate-900">{selectedUnit.result.apcVotes}</div>
                    </div>
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[10px] text-slate-500">PDP</div>
                      <div className="text-xs font-bold text-slate-900">{selectedUnit.result.pdpVotes}</div>
                    </div>
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[10px] text-slate-500">ADC</div>
                      <div className="text-xs font-bold text-slate-900">{selectedUnit.result.adcVotes}</div>
                    </div>
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[10px] text-slate-500">OTH</div>
                      <div className="text-xs font-bold text-slate-900">{selectedUnit.result.othersVotes}</div>
                    </div>
                  </div>
                )}
                <div className="flex justify-between gap-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                  <span>Last Updated</span>
                  <span>
                    {selectedUnit.pu.updatedAt
                      ? formatFirestoreTime(selectedUnit.pu.updatedAt)
                      : 'Not yet reported'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-slate-200 bg-white p-2">
                  <UserCheck className="w-3.5 h-3.5 text-teal-600 mx-auto" />
                  <div className="text-[10px] text-slate-500 mt-0.5">Presence</div>
                  <div className="text-xs font-bold text-slate-900">
                    {selectedUnit.checkIn ? 'Checked In' : 'Pending'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 mx-auto" />
                  <div className="text-[10px] text-slate-500 mt-0.5">Incidents</div>
                  <div className="text-xs font-bold text-slate-900 tabular-nums">
                    {selectedUnit.activeIncidents.length}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2">
                  {selectedUnit.visualState === 'VERIFIED' ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 mx-auto" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                  )}
                  <div className="text-[10px] text-slate-500 mt-0.5">EC8A</div>
                  <div className="text-xs font-bold text-slate-900">
                    {selectedUnit.result?.ec8aImageBase64 ? 'Attached' : 'None'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
