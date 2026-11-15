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
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { NavSectionId } from '../components/AppShell';
import { EmergencyContactsWidget } from '../components/EmergencyContactsWidget';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { ResultBarChart } from '../components/ResultBarChart';
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
  PuOperationalStatus,
  TOTAL_EXPECTED_POLLING_UNITS,
  TOTAL_EXPECTED_WARDS,
  UserRole,
  VerificationStatus,
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
import {
  buildLgaSummary,
  getCanonicalApprovedPuResults,
  summarizeVoteTotals,
} from '../utils/aggregationEngine';

interface SituationRoomPageProps {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
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
  const isVerifier = user.role === UserRole.VERIFICATION_OFFICER;
  const isWardCoord = user.role === UserRole.WARD_COORDINATOR;
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;

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
      <div className="space-y-5">
        {/* Agent Assignment Card */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-medium text-slate-500">
                Polling Unit Agent Mobile Field Terminal
              </p>
              <h2 className="font-display text-lg font-bold text-slate-900">
                {user.displayName}
              </h2>
            </div>
            {assignedPu ? <PuStatusBadge status={assignedPu.operationalStatus} /> : null}
          </div>

          {assignedPu ? (
            <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs sm:grid-cols-3">
              <div>
                <p className="text-emerald-900/80">Assigned Polling Unit</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-[#0b3b24]">
                  {assignedPu.puCode}
                </p>
                <p className="font-medium text-slate-900">{assignedPu.name}</p>
              </div>
              <div>
                <p className="text-emerald-900/80">Ward &amp; LGA</p>
                <p className="mt-0.5 font-semibold text-slate-900">
                  {assignedPu.wardName} · {LGA_DEFINITIONS[assignedPu.lgaId]?.displayName}
                </p>
              </div>
              <div>
                <p className="text-emerald-900/80">Registered Voters</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                  {assignedPu.registeredVoters.toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
              <p className="font-semibold">No Polling Unit Assigned Yet</p>
              <p className="mt-1">
                Contact your Ward Coordinator or Administrator to lock your account to a Polling
                Unit before submitting check-ins or Form EC8A results.
              </p>
            </div>
          )}

          {/* Status Cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <p className="text-slate-500">Check-In Presence</p>
              <p className="mt-1 font-semibold text-slate-900">
                {myCheckIn ? `Checked In (${myCheckIn.arrivalTimeText})` : 'Not Checked In Yet'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <p className="text-slate-500">Form EC8A Submission</p>
              <div className="mt-1">
                {myResult ? (
                  <VerificationStatusBadge status={myResult.verificationStatus} />
                ) : (
                  <span className="font-semibold text-slate-700">Not Submitted</span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <p className="text-slate-500">Active PU Incidents</p>
              <p className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
                {myIncidents.length}
              </p>
            </div>
          </div>

          {myResult?.reviewNote ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950">
              <p className="font-semibold">
                Verification Reviewer Note ({myResult.reviewedByName || 'Verifier'}):
              </p>
              <p className="mt-0.5">{myResult.reviewNote}</p>
            </div>
          ) : null}

          {/* Big Mobile-First Touch Actions */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => onNavigate('field_ops')}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-3 text-sm font-semibold text-white hover:bg-[#115233]"
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
              <span>{myCheckIn ? 'Update PU Status' : 'Check In Now'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('results')}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-[#0b3b24] bg-white px-4 py-3 text-sm font-semibold text-[#0b3b24] hover:bg-emerald-50"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              <span>{myResult ? 'View / Revise Result' : 'Submit PU Result'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <span>Report Incident</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <Settings className="h-4 w-4 text-slate-600" aria-hidden="true" />
              <span>Settings &amp; Logout</span>
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
    isWardCoord
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
    <div className="space-y-6">
      {/* Scope Filter Bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {isVerifier
                ? 'Verification Officer Command Center · Form EC8A Review & Tally Control'
                : isWardCoord
                  ? `Ward Coordinator Dashboard · ${wards[0]?.name || user.assignedWardId || 'Assigned Ward'}`
                  : authorizedLgas.length === 1
                    ? `${LGA_DEFINITIONS[authorizedLgas[0]].displayName} (${LGA_DEFINITIONS[authorizedLgas[0]].lgaCode}) · Isolated Command View`
                    : 'Funtua–Dandume Federal Constituency · 2027 Election Cycle'}
            </p>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {isVerifier
                ? 'Verification Queue & Verified Tally Telemetry'
                : 'Live Situation Room Telemetry'}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {authorizedLgas.length > 1 ? (
              <select
                aria-label="Filter by Area"
                value={lgaFilter}
                onChange={(e) => {
                  setLgaFilter(e.target.value as 'all' | LgaId);
                  setWardFilter('all');
                  setPuFilter('all');
                }}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="all">All Areas (Funtua &amp; Dandume)</option>
                <option value="funtua">Funtua LGA (20-14)</option>
                <option value="dandume">Dandume LGA (20/07)</option>
              </select>
            ) : null}

            {!isWardCoord ? (
              <select
                aria-label="Filter by Ward"
                value={wardFilter}
                onChange={(e) => {
                  setWardFilter(e.target.value);
                  setPuFilter('all');
                }}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
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
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
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
        <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-800" aria-hidden="true" />
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Verification Queue Priorities
                </h3>
                <p className="text-xs text-slate-600">
                  {pendingVerificationCount} pending submission(s) awaiting side-by-side Form EC8A
                  verification, {correctionRequestedCount} awaiting agent correction, and{' '}
                  {verifiedResultsCount} FDMIS verified.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('verification')}
              className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-lg bg-[#0b3b24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115233]"
            >
              <span>Open Verification Center</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {/* Critical Incidents Spotlight */}
      {criticalIncidents.length > 0 ? (
        <section
          aria-label="Critical Incident Alerts"
          className="rounded-xl border border-red-300 bg-red-50 p-5"
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5 text-red-900">
              <AlertOctagon className="h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
              <h3 className="font-display text-base font-bold">
                {criticalIncidents.length} Critical Incident
                {criticalIncidents.length === 1 ? '' : 's'} Requiring Immediate Action
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-800 whitespace-nowrap"
            >
              <span>Open Incidents Console</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {criticalIncidents.slice(0, 4).map((inc) => (
              <div
                key={inc.id}
                className="rounded-lg border border-red-200 bg-white p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-800">{inc.puCode}</span>
                  <div className="flex items-center gap-1.5">
                    <IncidentUrgencyBadge urgency={inc.urgency} />
                    <IncidentStatusBadge status={inc.status} />
                  </div>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{inc.title}</p>
                <p className="mt-0.5 line-clamp-2 text-slate-600">{inc.description}</p>
                <p className="mt-1.5 text-slate-500">
                  {inc.puName} · {formatFirestoreTime(inc.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Real-Time KPI Matrix */}
      <section aria-label="Operational KPIs" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>LGAs &amp; Wards</span>
            <Building2 className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {authorizedLgas.length} · {loadingData ? '—' : filteredWards.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Target: {expectedWardsForView} ward{expectedWardsForView === 1 ? '' : 's'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Polling Units</span>
            <MapPin className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {loadingData ? '—' : filteredPus.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Expected register: {expectedPusForView}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>PUs Reporting / Not</span>
            <Radio className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {reportingPus} / {notReportingPus}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {filteredPus.length > 0
              ? `${Math.round((reportingPus / filteredPus.length) * 100)}% reporting`
              : 'Awaiting PU register'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Agents Assigned / In</span>
            <Users className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {agentsAssigned} / {uniqueCheckedInPus}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {filteredCheckIns.length} check-in logs
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Incidents</span>
            <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {activeIncidents.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {pendingIncidentReviews} pending review
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Critical Incidents</span>
            <AlertOctagon className="h-4 w-4 text-red-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {criticalIncidents.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">{filteredIncidents.length} total logged</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Results Submitted</span>
            <ClipboardCheck className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {submittedResultsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {underReviewResultsCount} under review
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Results Verified</span>
            <FileCheck2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-800 tabular-nums">
            {verifiedResultsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {filteredPus.length > 0
              ? `${Math.round((verifiedResultsCount / filteredPus.length) * 100)}% of loaded PUs`
              : '0% verified'}
          </p>
        </div>
      </section>

      {/* Interactive Verified Result Bar Chart & Standings Table */}
      <ResultBarChart
        title={chartScopeTitle}
        subtitle={`Real-time aggregation across ${chartSummary.verifiedPuCount} verified PU(s) out of ${chartSummary.expectedPuCount} in current view.`}
        summary={chartSummary}
        partyConfigs={partyConfigs}
      />

      {/* Full Control Admin Comparative Funtua vs Dandume Table */}
      {isFullAdmin && lgaFilter === 'all' && wardFilter === 'all' && puFilter === 'all' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                LGA-by-LGA Verified Tally Comparison
              </h3>
              <p className="text-xs text-slate-500">
                Live verified party vote distribution between Funtua LGA (20-14) and Dandume LGA (20/07)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('party_management')}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Flag className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
              <span>Manage Party Logos</span>
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="px-3.5 py-2.5">LGA</th>
                  <th className="px-3.5 py-2.5 text-right">Verified PUs</th>
                  {FIXED_PARTIES.map((p) => (
                    <th key={p.code} className="px-3.5 py-2.5 text-right">
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
                  <th className="px-3.5 py-2.5 text-right">Valid Votes</th>
                  <th className="px-3.5 py-2.5 text-right">Total Cast</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(['funtua', 'dandume'] as const).map((id) => {
                  const lgaSummary = buildLgaSummary(id, canonicalApproved, pollingUnits, results);
                  const def = LGA_DEFINITIONS[id];
                  return (
                    <tr key={id} className="hover:bg-slate-50/70">
                      <td className="px-3.5 py-3 font-medium text-slate-900">
                        {def.displayName} ({def.lgaCode})
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono tabular-nums">
                        {lgaSummary.verifiedPuCount} / {lgaSummary.expectedPuCount}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.apcVotes.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.pdpVotes.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.adcVotes.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-semibold tabular-nums">
                        {lgaSummary.othersVotes.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-semibold text-emerald-800 tabular-nums">
                        {lgaSummary.validVotes.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-bold text-[#0b3b24] tabular-nums">
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
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233]"
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
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Polling Unit Operational Progress
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Live status distribution across {filteredPus.length} loaded polling units
            </p>
            <div className="mt-4 space-y-3">
              {[
                {
                  label: 'Agent Checked In / Active Field Status',
                  count: reportingPus,
                  color: 'bg-[#0b3b24]',
                },
                {
                  label: 'Result Submitted (All Stages)',
                  count: filteredPus.filter(
                    (p) =>
                      p.operationalStatus === PuOperationalStatus.RESULT_SUBMITTED ||
                      p.operationalStatus === PuOperationalStatus.RESULT_UNDER_REVIEW ||
                      p.operationalStatus === PuOperationalStatus.RESULT_VERIFIED
                  ).length,
                  color: 'bg-emerald-700',
                },
                {
                  label: 'Result FDMIS Verified',
                  count: filteredPus.filter(
                    (p) => p.operationalStatus === PuOperationalStatus.RESULT_VERIFIED
                  ).length,
                  color: 'bg-emerald-600',
                },
                {
                  label: 'Incident Reported / Communication Lost',
                  count: filteredPus.filter(
                    (p) =>
                      p.operationalStatus === PuOperationalStatus.INCIDENT_REPORTED ||
                      p.operationalStatus === PuOperationalStatus.COMMUNICATION_LOST
                  ).length,
                  color: 'bg-red-600',
                },
              ].map((bar) => {
                const pct = Math.round((bar.count / filteredPus.length) * 100);
                return (
                  <div key={bar.label}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{bar.label}</span>
                      <span className="font-mono text-slate-800 tabular-nums">
                        {bar.count} ({pct}%)
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
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

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Scope Coverage &amp; Quick Actions
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Authorized registers and rapid operational navigation
            </p>
            <div className="mt-4 space-y-3">
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
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {def.displayName} ({def.lgaCode})
                      </span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {lgaPus.length} / {def.expectedPollingUnits} PUs
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-slate-600 tabular-nums">
                      <span>Checked In: {lgaCheckedIn}</span>
                      <span>Verified Results: {lgaVerified}</span>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate('field_ops')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0b3b24] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#115233]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Agent Check-In</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('incidents')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Report Incident</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('results')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Results &amp; EC8A</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('emergency_assistance')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
                >
                  <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Emergency Numbers</span>
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
