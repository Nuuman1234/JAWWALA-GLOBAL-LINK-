import { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Flag,
  MapPin,
  PhoneCall,
  Radio,
  Settings,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  Users,
} from 'lucide-react';
import type { NavSectionId } from '../components/AppShell';
import { EmergencyContactsWidget } from '../components/EmergencyContactsWidget';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { ResultBarChart } from '../components/ResultBarChart';
import { SituationMapPanel } from '../components/SituationMapPanel';
import { WhatsAppGroupCard } from '../components/WhatsAppGroupCard';
import {
  IncidentStatusBadge,
  IncidentUrgencyBadge,
  PuStatusBadge,
  VerificationStatusBadge,
} from '../components/StatusBadge';
import {
  FIXED_PARTIES,
  IncidentUrgency,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  PuOperationalStatus,
  TOTAL_EXPECTED_POLLING_UNITS,
  TOTAL_EXPECTED_WARDS,
  UserRole,
  VerificationStatus,
  canManageOperationsOfficers,
  formatFirestoreTime,
  getAuthorizedLgas,
  isIncidentActive,
  isPuReporting,
  type AgentCheckIn,
  type AggregatedResult,
  type ApprovedPuResult,
  type EmergencyContact,
  type GlobalSettings,
  type IncidentReport,
  type LgaId,
  type PartyCode,
  type PartyConfig,
  type PollingUnit,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { computeWardOperationsCoverage } from '../services/directoryService';
import {
  buildLgaSummary,
  getCanonicalApprovedPuResults,
  summarizeVoteTotals,
} from '../utils/aggregationEngine';

interface SituationRoomPageProps {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
  users?: UserAccount[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  aggregatedResults: AggregatedResult[];
  partyConfigs: Record<PartyCode, PartyConfig | null>;
  emergencyContacts: EmergencyContact[];
  settings: GlobalSettings | null;
  loadingData: boolean;
  onNavigate: (section: NavSectionId) => void;
}

export function SituationRoomPage({
  user,
  wards,
  pollingUnits,
  users = [],
  checkIns,
  incidents,
  results,
  approvedPuResults,
  aggregatedResults: _aggregatedResults,
  partyConfigs,
  emergencyContacts,
  settings,
  loadingData,
  onNavigate,
}: SituationRoomPageProps) {
  const authorizedLgas = getAuthorizedLgas(user);
  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [wardFilter, setWardFilter] = useState<string>('all');
  const [puFilter, setPuFilter] = useState<string>('all');

  const isPuAgent = user.role === UserRole.POLLING_UNIT_AGENT;
  const isOrdinaryUser = user.role === UserRole.ORDINARY_USER;
  const isOpsOfficer = user.role === UserRole.OPERATIONS_OFFICER;
  const isVerifier = user.role === UserRole.VERIFICATION_OFFICER;
  const isWardCoord = user.role === UserRole.WARD_COORDINATOR;
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;
  const canViewOpsCoverage = canManageOperationsOfficers(user.role);

  const opsCoverageSummary = useMemo(() => {
    if (!canViewOpsCoverage || wards.length === 0) return null;
    const coverage = computeWardOperationsCoverage(
      wards,
      users,
      MIN_OPERATIONS_OFFICERS_PER_WARD
    );
    const compliantWards = coverage.filter((c) => c.isCompliant).length;
    const vacantWards = coverage.length - compliantWards;
    const totalVacancies = coverage.reduce((sum, c) => sum + c.vacancyCount, 0);
    const totalActiveOfficers = coverage.reduce((sum, c) => sum + c.activeCount, 0);
    return {
      totalWards: coverage.length,
      compliantWards,
      vacantWards,
      totalVacancies,
      totalActiveOfficers,
    };
  }, [canViewOpsCoverage, wards, users]);

  const scopedWards = useMemo(() => {
    return wards.filter((w) => lgaFilter === 'all' || w.lgaId === lgaFilter);
  }, [wards, lgaFilter]);

  const scopedPusForSelector = useMemo(() => {
    return pollingUnits.filter((pu) => {
      if (lgaFilter !== 'all' && pu.lgaId !== lgaFilter) return false;
      if (wardFilter !== 'all' && pu.wardId !== wardFilter) return false;
      return true;
    });
  }, [pollingUnits, lgaFilter, wardFilter]);

  const filteredPus = useMemo(() => {
    return scopedPusForSelector.filter((pu) => puFilter === 'all' || pu.id === puFilter);
  }, [scopedPusForSelector, puFilter]);

  const filteredWards = useMemo(() => {
    return scopedWards.filter((w) => wardFilter === 'all' || w.id === wardFilter);
  }, [scopedWards, wardFilter]);

  const matchesArea = (item: { lgaId: string; wardId: string; puId: string }) => {
    if (lgaFilter !== 'all' && item.lgaId !== lgaFilter) return false;
    if (wardFilter !== 'all' && item.wardId !== wardFilter) return false;
    if (puFilter !== 'all' && item.puId !== puFilter) return false;
    return true;
  };

  const filteredCheckIns = useMemo(
    () => checkIns.filter(matchesArea),
    [checkIns, lgaFilter, wardFilter, puFilter]
  );
  const filteredIncidents = useMemo(
    () => incidents.filter(matchesArea),
    [incidents, lgaFilter, wardFilter, puFilter]
  );
  const filteredResults = useMemo(
    () => results.filter(matchesArea),
    [results, lgaFilter, wardFilter, puFilter]
  );

  const canonicalApproved = useMemo(
    () => getCanonicalApprovedPuResults(approvedPuResults, results),
    [approvedPuResults, results]
  );

  const filteredApproved = useMemo(
    () => canonicalApproved.filter(matchesArea),
    [canonicalApproved, lgaFilter, wardFilter, puFilter]
  );

  const expectedPusForView = useMemo(() => {
    if (puFilter !== 'all') return 1;
    if (wardFilter !== 'all') {
      const w = wards.find((item) => item.id === wardFilter);
      return filteredPus.length > 0 ? filteredPus.length : w?.expectedPollingUnits || 0;
    }
    if (filteredPus.length > 0) return filteredPus.length;
    if (lgaFilter !== 'all') return LGA_DEFINITIONS[lgaFilter].expectedPollingUnits;
    if (isFullAdmin) return TOTAL_EXPECTED_POLLING_UNITS;
    return authorizedLgas.reduce(
      (sum, id) => sum + LGA_DEFINITIONS[id].expectedPollingUnits,
      0
    );
  }, [puFilter, wardFilter, lgaFilter, wards, filteredPus.length, isFullAdmin, authorizedLgas]);

  const pendingVerificationCount = useMemo(
    () =>
      filteredResults.filter(
        (r) =>
          r.verificationStatus === VerificationStatus.SUBMITTED ||
          r.verificationStatus === VerificationStatus.UNDER_REVIEW
      ).length,
    [filteredResults]
  );

  const chartSummary = useMemo(
    () => summarizeVoteTotals(filteredApproved, expectedPusForView, pendingVerificationCount),
    [filteredApproved, expectedPusForView, pendingVerificationCount]
  );

  const chartScopeTitle = useMemo(() => {
    if (puFilter !== 'all') {
      const pu = pollingUnits.find((p) => p.id === puFilter);
      return pu ? `Polling Unit Result · ${pu.puCode} (${pu.name})` : 'Polling Unit Verified Result';
    }
    if (wardFilter !== 'all') {
      const w = wards.find((item) => item.id === wardFilter);
      return w ? `Ward Result Summary · ${w.name}` : 'Ward Verified Result Summary';
    }
    if (lgaFilter !== 'all') {
      return `${LGA_DEFINITIONS[lgaFilter].displayName} Verified Result Summary`;
    }
    if (authorizedLgas.length === 1) {
      return `${LGA_DEFINITIONS[authorizedLgas[0]].displayName} Verified Result Summary`;
    }
    return 'Constituency Verified Result Summary (Funtua & Dandume)';
  }, [puFilter, wardFilter, lgaFilter, pollingUnits, wards, authorizedLgas]);

  // --- DEDICATED ORDINARY USER FIELD VIEW ---
  if (isOrdinaryUser) {
    const assignedPu =
      pollingUnits.find((p) => p.id === user.assignedPollingUnitId) || pollingUnits[0] || null;
    const myCheckIn = checkIns.find((c) => c.puId === (assignedPu?.id || user.assignedPollingUnitId));
    const myActiveIncidents = incidents.filter((i) => isIncidentActive(i.status));

    return (
      <div className="space-y-3.5 sm:space-y-4">
        <section className="fdmis-surface p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <p className="text-[11px] font-medium text-slate-500">
                FDMIS Ordinary User Field Terminal · Works Offline
              </p>
              <h2 className="font-display text-base font-bold text-[#102B3F] sm:text-lg">
                {user.displayName}
              </h2>
            </div>
            {assignedPu ? <PuStatusBadge status={assignedPu.operationalStatus} /> : null}
          </div>

          {assignedPu ? (
            <div className="grid gap-2.5 rounded-xl border border-emerald-200 bg-[#ECF8F1] p-3 text-xs sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-[#06452F]/80">Registered Polling Unit</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-[#06452F]">
                  {assignedPu.puCode}
                </p>
                <p className="font-medium text-[#102B3F]">{assignedPu.name}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#06452F]/80">Ward &amp; LGA</p>
                <p className="mt-0.5 font-semibold text-[#102B3F]">
                  {assignedPu.wardName} · {LGA_DEFINITIONS[assignedPu.lgaId]?.displayName}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#06452F]/80">Account Role</p>
                <p className="mt-0.5 font-semibold text-[#102B3F]">
                  Ordinary User (Location-Scoped)
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-[#F5F7FA] p-3 text-xs text-slate-700">
              <p className="font-semibold text-[#102B3F]">Registered Location Scope</p>
              <p className="mt-1">
                {user.assignedLgaId
                  ? `${LGA_DEFINITIONS[user.assignedLgaId as LgaId]?.displayName || user.assignedLgaId}`
                  : 'Constituency'}{' '}
                {user.requestedWardName ? `· ${user.requestedWardName}` : ''}
                {user.requestedPollingUnitCode ? ` · ${user.requestedPollingUnitCode}` : ''}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-slate-200 bg-[#F5F7FA] p-3 text-xs">
              <p className="text-[11px] text-slate-500">Latest Check-In</p>
              <p className="mt-1 font-semibold text-[#102B3F]">
                {myCheckIn ? `Logged (${myCheckIn.arrivalTimeText})` : 'No Check-In Recorded Yet'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#F5F7FA] p-3 text-xs">
              <p className="text-[11px] text-slate-500">Active Incidents in Location</p>
              <p className="mt-1 font-mono text-base font-bold text-[#102B3F] tabular-nums">
                {myActiveIncidents.length}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => onNavigate('field_ops')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[#06452F] px-3 py-2 text-xs font-semibold text-white hover:bg-[#043B29]"
            >
              <Radio className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Field Check-In</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('notes')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[#06452F] bg-white px-3 py-2 text-xs font-semibold text-[#06452F] hover:bg-[#ECF8F1]"
            >
              <StickyNote className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Notes &amp; Messages</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#D99A32]" aria-hidden="true" />
              <span>Report Incident</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
            >
              <Settings className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>
        </section>

        <EmergencyContactsWidget
          contacts={emergencyContacts}
          onOpenDirectory={() => onNavigate('emergency_assistance')}
        />

        <WhatsAppGroupCard settings={settings} compact />
      </div>
    );
  }

  // --- DEDICATED POLLING UNIT AGENT MOBILE-FIRST VIEW ---
  if (isPuAgent) {
    const assignedPu =
      pollingUnits.find((p) => p.id === user.assignedPollingUnitId) || pollingUnits[0] || null;
    const myCheckIn = checkIns.find((c) => c.puId === (assignedPu?.id || user.assignedPollingUnitId));
    const myResult = results.find((r) => r.puId === (assignedPu?.id || user.assignedPollingUnitId));
    const myApproved = canonicalApproved.filter(
      (a) => a.puId === (assignedPu?.id || user.assignedPollingUnitId)
    );
    const myIncidents = incidents.filter((i) => isIncidentActive(i.status));
    const myPuSummary = summarizeVoteTotals(myApproved, assignedPu ? 1 : 0, myResult && myResult.verificationStatus === VerificationStatus.SUBMITTED ? 1 : 0);

    return (
      <div className="space-y-3.5 sm:space-y-4">
        {/* Agent Assignment Card */}
        <section className="fdmis-surface p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <p className="text-[11px] font-medium text-slate-500">
                Polling Unit Agent Mobile Field Terminal
              </p>
              <h2 className="font-display text-base font-bold text-[#102B3F] sm:text-lg">
                {user.displayName}
              </h2>
            </div>
            {assignedPu ? <PuStatusBadge status={assignedPu.operationalStatus} /> : null}
          </div>

          {assignedPu ? (
            <div className="grid gap-2.5 rounded-xl border border-emerald-200 bg-[#ECF8F1] p-3 text-xs sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-[#06452F]/80">Assigned Polling Unit</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-[#06452F]">
                  {assignedPu.puCode}
                </p>
                <p className="font-medium text-[#102B3F]">{assignedPu.name}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#06452F]/80">Ward &amp; LGA</p>
                <p className="mt-0.5 font-semibold text-[#102B3F]">
                  {assignedPu.wardName} · {LGA_DEFINITIONS[assignedPu.lgaId]?.displayName}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#06452F]/80">Registered Voters</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-[#102B3F] tabular-nums">
                  {assignedPu.registeredVoters.toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              <p className="font-semibold">No Polling Unit Assigned Yet</p>
              <p className="mt-1">
                Contact your Ward Coordinator or Administrator to lock your account to a Polling
                Unit before submitting check-ins or Form EC8A results.
              </p>
            </div>
          )}

          {/* Status Cards — 3 columns */}
          <div className="fdmis-grid-3 gap-2">
            <div className="rounded-xl border border-[#D3ECDD] bg-[#ECF8F1] p-2.5 text-xs">
              <p className="text-[10.5px] font-medium text-slate-600">Check-In</p>
              <p className="mt-1 truncate font-semibold text-[#102B3F]">
                {myCheckIn ? myCheckIn.arrivalTimeText : 'Not Checked In'}
              </p>
            </div>
            <div className="rounded-xl border border-[#D2E4FD] bg-[#ECF4FF] p-2.5 text-xs">
              <p className="text-[10.5px] font-medium text-slate-600">Form EC8A</p>
              <div className="mt-1">
                {myResult ? (
                  <VerificationStatusBadge status={myResult.verificationStatus} />
                ) : (
                  <span className="font-semibold text-[#102B3F]">Not Submitted</span>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-[#FAD7D2] bg-[#FEF0EE] p-2.5 text-xs">
              <p className="text-[10.5px] font-medium text-slate-600">Incidents</p>
              <p className="mt-1 font-mono text-base font-bold text-[#102B3F] tabular-nums">
                {myIncidents.length}
              </p>
            </div>
          </div>

          {myResult?.reviewNote ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              <p className="font-semibold">
                Verification Reviewer Note ({myResult.reviewedByName || 'Verifier'}):
              </p>
              <p className="mt-0.5">{myResult.reviewNote}</p>
            </div>
          ) : null}

          {/* Compact Touch Actions */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => onNavigate('field_ops')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[#06452F] px-3 py-2 text-xs font-semibold text-white hover:bg-[#043B29]"
            >
              <Radio className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{myCheckIn ? 'Update Status' : 'Check In Now'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('results')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[#06452F] bg-white px-3 py-2 text-xs font-semibold text-[#06452F] hover:bg-[#ECF8F1]"
            >
              <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{myResult ? 'View Result' : 'Submit Result'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#D99A32]" aria-hidden="true" />
              <span>Report Incident</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
            >
              <Settings className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>
        </section>

        <EmergencyContactsWidget
          contacts={emergencyContacts}
          onOpenDirectory={() => onNavigate('emergency_assistance')}
        />

        <WhatsAppGroupCard settings={settings} compact />

        <ResultBarChart
          title="Assigned Polling Unit Verified Totals"
          subtitle={
            assignedPu
              ? `${assignedPu.puCode} · ${assignedPu.name}`
              : 'Waiting for Polling Unit assignment'
          }
          summary={myPuSummary}
          partyConfigs={partyConfigs}
          emptyMessage="Your polling unit result has not been FDMIS verified yet."
        />
      </div>
    );
  }

  // Real operational KPIs for Supervisor / Verifier / Admin Dashboards
  const reportingPus = filteredPus.filter((p) => isPuReporting(p.operationalStatus)).length;
  const notReportingPus = Math.max(0, filteredPus.length - reportingPus);
  const agentsAssigned = filteredPus.filter((p) => Boolean(p.assignedAgentUid)).length;
  const uniqueCheckedInPus = new Set(filteredCheckIns.map((c) => c.puId)).size;

  const activeIncidents = filteredIncidents.filter((i) => isIncidentActive(i.status));
  const criticalIncidents = activeIncidents.filter(
    (i) => i.urgency === IncidentUrgency.CRITICAL
  );
  const pendingIncidentReviews = filteredIncidents.filter(
    (i) => i.status === 'NEW' || i.status === 'UNDER_REVIEW'
  ).length;

  const submittedResultsCount = filteredResults.filter(
    (r) => r.verificationStatus !== VerificationStatus.DRAFT
  ).length;
  const underReviewResultsCount = filteredResults.filter(
    (r) => r.verificationStatus === VerificationStatus.UNDER_REVIEW
  ).length;
  const verifiedResultsCount = filteredResults.filter(
    (r) => r.verificationStatus === VerificationStatus.VERIFIED
  ).length;
  const correctionRequestedCount = filteredResults.filter(
    (r) => r.verificationStatus === VerificationStatus.REQUIRES_CORRECTION
  ).length;

  const expectedWardsForView =
    isWardCoord || isOpsOfficer
      ? 1
      : lgaFilter === 'all'
        ? isFullAdmin
          ? TOTAL_EXPECTED_WARDS
          : authorizedLgas.length * 11
        : LGA_DEFINITIONS[lgaFilter].expectedWards;

  const hasAnyRealData =
    filteredWards.length > 0 ||
    filteredPus.length > 0 ||
    filteredCheckIns.length > 0 ||
    filteredIncidents.length > 0 ||
    filteredResults.length > 0;

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Scope Filter Bar */}
      <section className="fdmis-surface p-3.5 sm:p-4">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-medium text-slate-500">
              {isVerifier
                ? 'Verification Officer Command Center · Form EC8A Review & Tally Control'
                : isOpsOfficer
                  ? `Ward Operations Officer Desk · ${wards[0]?.name || user.assignedWardId || 'Assigned Ward'}`
                  : isWardCoord
                    ? `Ward Coordinator Dashboard · ${wards[0]?.name || user.assignedWardId || 'Assigned Ward'}`
                    : authorizedLgas.length === 1
                      ? `${LGA_DEFINITIONS[authorizedLgas[0]].displayName} (${LGA_DEFINITIONS[authorizedLgas[0]].lgaCode}) · Isolated Command View`
                      : 'Funtua–Dandume Federal Constituency · 2027 Election Cycle'}
            </p>
            <h2 className="font-display text-base font-bold text-[#102B3F] sm:text-lg">
              {isVerifier
                ? 'Verification Queue & Verified Tally Telemetry'
                : isOpsOfficer
                  ? 'Ward Operations & Field Coordination'
                  : 'Live Situation Room Telemetry'}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {authorizedLgas.length > 1 ? (
              <select
                aria-label="Filter by Area"
                value={lgaFilter}
                onChange={(e) => {
                  setLgaFilter(e.target.value as 'all' | LgaId);
                  setWardFilter('all');
                  setPuFilter('all');
                }}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-[#F5F7FA] px-2.5 text-xs font-medium text-[#102B3F] focus:border-[#06452F] focus:bg-white focus:outline-none"
              >
                <option value="all">All Areas (Funtua &amp; Dandume)</option>
                <option value="funtua">Funtua LGA (20-14)</option>
                <option value="dandume">Dandume LGA (20/07)</option>
              </select>
            ) : null}

            {!isWardCoord && !isOpsOfficer ? (
              <select
                aria-label="Filter by Ward"
                value={wardFilter}
                onChange={(e) => {
                  setWardFilter(e.target.value);
                  setPuFilter('all');
                }}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-[#F5F7FA] px-2.5 text-xs font-medium text-[#102B3F] focus:border-[#06452F] focus:bg-white focus:outline-none"
              >
                <option value="all">All Wards ({scopedWards.length})</option>
                {scopedWards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.wardCode})
                  </option>
                ))}
              </select>
            ) : null}

            <select
              aria-label="Filter by Polling Unit"
              value={puFilter}
              onChange={(e) => setPuFilter(e.target.value)}
              className="min-h-[38px] rounded-xl border border-slate-200 bg-[#F5F7FA] px-2.5 text-xs font-medium text-[#102B3F] focus:border-[#06452F] focus:bg-white focus:outline-none"
            >
              <option value="all">All Polling Units ({scopedPusForSelector.length})</option>
              {scopedPusForSelector.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.puCode} · {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Role-Specific Command Strip for Verification Officers */}
      {isVerifier ? (
        <section className="rounded-2xl border border-[#D2E4FD] bg-[#ECF4FF] p-3.5 sm:p-4">
          <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#1D63DC]" aria-hidden="true" />
              <div>
                <h3 className="font-display text-sm font-bold text-[#102B3F]">
                  Verification Queue Priorities
                </h3>
                <p className="text-xs text-slate-600">
                  {pendingVerificationCount} pending submission(s) awaiting Form EC8A review,{' '}
                  {correctionRequestedCount} awaiting correction, and {verifiedResultsCount} verified.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('verification')}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-[#06452F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#043B29]"
            >
              <span>Open Verification Center</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {/* Operations Officers Ward Coverage Banner (Admins) */}
      {opsCoverageSummary ? (
        <section
          className={`rounded-2xl border p-3.5 sm:p-4 ${
            opsCoverageSummary.vacantWards > 0
              ? 'border-[#F8E2B8] bg-[#FEF6E6]'
              : 'border-[#D3ECDD] bg-[#ECF8F1]'
          }`}
        >
          <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5">
              <ShieldAlert
                className={`mt-0.5 h-5 w-5 shrink-0 ${
                  opsCoverageSummary.vacantWards > 0 ? 'text-[#D99A32]' : 'text-[#06452F]'
                }`}
                aria-hidden="true"
              />
              <div>
                <h3 className="font-display text-sm font-bold text-[#102B3F]">
                  Ward Operations Officers Coverage (Min {MIN_OPERATIONS_OFFICERS_PER_WARD} per Ward)
                </h3>
                <p className="text-xs text-slate-700">
                  <span className="font-mono font-semibold tabular-nums">
                    {opsCoverageSummary.compliantWards} / {opsCoverageSummary.totalWards}
                  </span>{' '}
                  wards compliant ·{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {opsCoverageSummary.totalActiveOfficers}
                  </span>{' '}
                  active officer{opsCoverageSummary.totalActiveOfficers === 1 ? '' : 's'}
                  {opsCoverageSummary.totalVacancies > 0
                    ? ` · ${opsCoverageSummary.totalVacancies} slot${opsCoverageSummary.totalVacancies === 1 ? '' : 's'} needed across ${opsCoverageSummary.vacantWards} ward${opsCoverageSummary.vacantWards === 1 ? '' : 's'}`
                    : ' · All wards meet minimum coverage'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('operations_officers')}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-[#06452F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#043B29] whitespace-nowrap"
            >
              <span>Manage Officers</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {/* Critical Incidents Spotlight */}
      {criticalIncidents.length > 0 ? (
        <section
          aria-label="Critical Incident Alerts"
          className="rounded-2xl border border-[#FAD7D2] bg-[#FEF0EE] p-3.5 sm:p-4"
        >
          <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-[#991B1B]">
              <AlertOctagon className="h-5 w-5 shrink-0 text-[#DC4C45]" aria-hidden="true" />
              <h3 className="font-display text-sm font-bold sm:text-base">
                {criticalIncidents.length} Critical Incident
                {criticalIncidents.length === 1 ? '' : 's'} Requiring Immediate Action
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#DC4C45] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
            >
              <span>Incidents Console</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {criticalIncidents.slice(0, 4).map((inc) => (
              <div
                key={inc.id}
                className="rounded-xl border border-red-200 bg-white p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="font-mono font-semibold text-[#102B3F]">{inc.puCode}</span>
                  <div className="flex items-center gap-1.5">
                    <IncidentUrgencyBadge urgency={inc.urgency} />
                    <IncidentStatusBadge status={inc.status} />
                  </div>
                </div>
                <p className="mt-1 text-xs font-bold text-[#102B3F] sm:text-sm">{inc.title}</p>
                <p className="mt-0.5 line-clamp-2 text-slate-600">{inc.description}</p>
                <p className="mt-1 font-mono text-[10.5px] text-slate-500">
                  {inc.puName} · Orig: {formatFirestoreTime(inc.clientCreatedAtIso || inc.createdAt)}
                  {inc.serverSyncedAt ? ` · Synced: ${formatFirestoreTime(inc.serverSyncedAt)}` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Real-Time KPI Matrix — 3 cols on mobile/tablet, 4 cols on desktop */}
      <section aria-label="Operational KPIs" className="fdmis-surface p-3 sm:p-4">
        <div className="fdmis-metrics-grid gap-2 sm:gap-3">
          <div className="rounded-xl border border-[#D3ECDD] bg-[#ECF8F1] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">LGAs &amp; Wards</span>
              <Building2 className="h-3.5 w-3.5 shrink-0 text-[#06452F]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#102B3F] tabular-nums sm:text-2xl">
              {authorizedLgas.length} · {loadingData ? '—' : filteredWards.length}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              Target: {expectedWardsForView} ward{expectedWardsForView === 1 ? '' : 's'}
            </p>
          </div>

          <div className="rounded-xl border border-[#D2E4FD] bg-[#ECF4FF] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">Polling Units</span>
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#1D63DC]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#102B3F] tabular-nums sm:text-2xl">
              {loadingData ? '—' : filteredPus.length}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              Register: {expectedPusForView}
            </p>
          </div>

          <div className="rounded-xl border border-[#F8E2B8] bg-[#FEF6E6] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">PUs Reporting</span>
              <Radio className="h-3.5 w-3.5 shrink-0 text-[#168653]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#102B3F] tabular-nums sm:text-2xl">
              {reportingPus}/{notReportingPus}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              {filteredPus.length > 0
                ? `${Math.round((reportingPus / filteredPus.length) * 100)}% reporting`
                : 'Awaiting register'}
            </p>
          </div>

          <div className="rounded-xl border border-[#E3D5FC] bg-[#F4EEFF] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">Agents In</span>
              <Users className="h-3.5 w-3.5 shrink-0 text-[#06452F]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#102B3F] tabular-nums sm:text-2xl">
              {agentsAssigned}/{uniqueCheckedInPus}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              {filteredCheckIns.length} check-ins
            </p>
          </div>

          <div className="rounded-xl border border-[#F8E2B8] bg-[#FEF6E6] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">Active Alerts</span>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#D99A32]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#102B3F] tabular-nums sm:text-2xl">
              {activeIncidents.length}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              {pendingIncidentReviews} pending review
            </p>
          </div>

          <div className="rounded-xl border border-[#FAD7D2] bg-[#FEF0EE] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">Critical</span>
              <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-[#DC4C45]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#DC4C45] tabular-nums sm:text-2xl">
              {criticalIncidents.length}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 sm:text-xs">
              {filteredIncidents.length} total logged
            </p>
          </div>

          <div className="rounded-xl border border-[#D2E4FD] bg-[#ECF4FF] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">Submitted</span>
              <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-[#06452F]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#102B3F] tabular-nums sm:text-2xl">
              {submittedResultsCount}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              {underReviewResultsCount} under review
            </p>
          </div>

          <div className="rounded-xl border border-[#D3ECDD] bg-[#ECF8F1] p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600">
              <span className="truncate">Verified</span>
              <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-[#168653]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-[#168653] tabular-nums sm:text-2xl">
              {verifiedResultsCount}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500 tabular-nums sm:text-xs">
              {filteredPus.length > 0
                ? `${Math.round((verifiedResultsCount / filteredPus.length) * 100)}% verified`
                : '0% verified'}
            </p>
          </div>
        </div>
      </section>

      {/* Module 1: Live Election Situation Map & Geographic Coverage */}
      {pollingUnits.length > 0 ? (
        <SituationMapPanel
          wards={wards}
          pollingUnits={pollingUnits}
          checkIns={checkIns}
          incidents={incidents}
          results={results}
          users={users}
        />
      ) : null}

      {/* Interactive Verified Result Bar Chart & Standings Table */}
      <ResultBarChart
        title={chartScopeTitle}
        subtitle={`Real-time aggregation across ${chartSummary.verifiedPuCount} verified PU(s) out of ${chartSummary.expectedPuCount} in current view.`}
        summary={chartSummary}
        partyConfigs={partyConfigs}
      />

      {/* Full Control Admin Comparative Funtua vs Dandume Table */}
      {isFullAdmin && lgaFilter === 'all' && wardFilter === 'all' && puFilter === 'all' ? (
        <section className="fdmis-surface p-3.5 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div>
              <h3 className="font-display text-sm font-bold text-[#102B3F]">
                LGA-by-LGA Verified Tally Comparison
              </h3>
              <p className="text-xs text-slate-500">
                Live verified party vote distribution between Funtua LGA (20-14) and Dandume LGA (20/07)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('party_management')}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
            >
              <Flag className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
              <span>Manage Party Logos</span>
            </button>
          </div>
          <div className="mt-2.5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F5F7FA] font-semibold text-slate-600">
                  <th className="px-3 py-2">LGA</th>
                  <th className="px-3 py-2 text-right">Verified PUs</th>
                  {FIXED_PARTIES.map((p) => (
                    <th key={p.code} className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <PartyLogo
                          partyCode={p.code}
                          partyConfig={partyConfigs[p.code]}
                          size="xs"
                        />
                        <span>{p.code}</span>
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Valid Votes</th>
                  <th className="px-3 py-2 text-right">Total Cast</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(['funtua', 'dandume'] as const).map((id) => {
                  const lgaSummary = buildLgaSummary(id, canonicalApproved, pollingUnits, results);
                  const def = LGA_DEFINITIONS[id];
                  return (
                    <tr key={id} className="hover:bg-[#F5F7FA]/70">
                      <td className="px-3 py-2.5 font-semibold text-[#102B3F]">
                        {def.displayName} ({def.lgaCode})
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {lgaSummary.verifiedPuCount} / {lgaSummary.expectedPuCount}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.apcVotes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.pdpVotes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.adcVotes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.othersVotes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#168653] tabular-nums">
                        {lgaSummary.validVotes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-[#06452F] tabular-nums">
                        {lgaSummary.totalVotesCast.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Empty State or Real Data Progress Bars */}
      {!loadingData && !hasAnyRealData ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description={
            isFullAdmin
              ? 'No wards, polling units, field check-ins, incidents, or results exist yet. Import the official 475-PU INEC directory or start field operations.'
              : 'No operational reports or polling units have been recorded in your authorized area yet.'
          }
          action={
            isFullAdmin ? (
              <button
                type="button"
                onClick={() => onNavigate('polling_units')}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#043B29]"
              >
                <span>Import Official Polling Units</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : undefined
          }
        />
      ) : null}

      {/* Real-Data-Only Progress Breakdown */}
      {filteredPus.length > 0 ? (
        <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <div className="fdmis-surface p-3.5 sm:p-4">
            <h3 className="font-display text-sm font-bold text-[#102B3F]">
              Polling Unit Operational Progress
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Live status distribution across {filteredPus.length} loaded polling units
            </p>
            <div className="mt-3 space-y-2.5">
              {[
                {
                  label: 'Agent Checked In / Active Field Status',
                  count: reportingPus,
                  color: 'bg-[#06452F]',
                },
                {
                  label: 'Result Submitted (All Stages)',
                  count: filteredPus.filter(
                    (p) =>
                      p.operationalStatus === PuOperationalStatus.RESULT_SUBMITTED ||
                      p.operationalStatus === PuOperationalStatus.RESULT_UNDER_REVIEW ||
                      p.operationalStatus === PuOperationalStatus.RESULT_VERIFIED
                  ).length,
                  color: 'bg-[#168653]',
                },
                {
                  label: 'Result FDMIS Verified',
                  count: filteredPus.filter(
                    (p) => p.operationalStatus === PuOperationalStatus.RESULT_VERIFIED
                  ).length,
                  color: 'bg-emerald-500',
                },
                {
                  label: 'Incident Reported / Communication Lost',
                  count: filteredPus.filter(
                    (p) =>
                      p.operationalStatus === PuOperationalStatus.INCIDENT_REPORTED ||
                      p.operationalStatus === PuOperationalStatus.COMMUNICATION_LOST
                  ).length,
                  color: 'bg-[#DC4C45]',
                },
              ].map((bar) => {
                const pct = Math.round((bar.count / filteredPus.length) * 100);
                return (
                  <div key={bar.label}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{bar.label}</span>
                      <span className="font-mono font-semibold text-[#102B3F] tabular-nums">
                        {bar.count} ({pct}%)
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${bar.color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="fdmis-surface p-3.5 sm:p-4">
            <h3 className="font-display text-sm font-bold text-[#102B3F]">
              Scope Coverage &amp; Quick Actions
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Authorized registers and rapid operational navigation
            </p>
            <div className="mt-3 space-y-2.5">
              {authorizedLgas.map((id) => {
                const def = LGA_DEFINITIONS[id];
                const lgaPus = pollingUnits.filter((p) => p.lgaId === id);
                const lgaCheckedIn = new Set(
                  checkIns.filter((c) => c.lgaId === id).map((c) => c.puId)
                ).size;
                const lgaVerified = results.filter(
                  (r) => r.lgaId === id && r.verificationStatus === VerificationStatus.VERIFIED
                ).length;
                return (
                  <div
                    key={id}
                    className="rounded-xl border border-slate-200 bg-[#F5F7FA] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#102B3F]">
                        {def.displayName} ({def.lgaCode})
                      </span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {lgaPus.length} / {def.expectedPollingUnits} PUs
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-4 text-slate-600 tabular-nums">
                      <span>Checked In: {lgaCheckedIn}</span>
                      <span>Verified Results: {lgaVerified}</span>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('field_ops')}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#06452F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#043B29]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Agent Check-In</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('incidents')}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-[#D99A32]" aria-hidden="true" />
                  <span>Report Incident</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('notes')}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
                >
                  <StickyNote className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                  <span>Notes</span>
                </button>
                {canViewOpsCoverage || isOpsOfficer ? (
                  <button
                    type="button"
                    onClick={() => onNavigate('operations_officers')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                    <span>Officers</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onNavigate('results')}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-[#F5F7FA]"
                >
                  <ClipboardCheck className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                  <span>Results</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('emergency_assistance')}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[#FAD7D2] bg-[#FEF0EE] px-3 py-1.5 text-xs font-semibold text-[#B91C1C] hover:bg-red-100"
                >
                  <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>SOS</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <WhatsAppGroupCard settings={settings} compact />
    </div>
  );
}
