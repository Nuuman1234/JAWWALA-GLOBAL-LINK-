import { useMemo, useState } from 'react';
import { Download, FileBarChart2, Printer, ShieldAlert } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { ResultBarChart } from '../components/ResultBarChart';
import {
  FIXED_PARTY_MAP,
  LGA_DEFINITIONS,
  PU_STATUS_META,
  TOTAL_EXPECTED_POLLING_UNITS,
  UserRole,
  VerificationStatus,
  formatFirestoreTime,
  getAuthorizedLgas,
  isIncidentActive,
  isPuReporting,
  type AgentCheckIn,
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
  buildWardSummary,
  getCanonicalApprovedPuResults,
  summarizeVoteTotals,
} from '../utils/aggregationEngine';
import { downloadStructuredCsv } from '../utils/reportsExport';

type ReportType =
  | 'VERIFIED_PARTY_SUMMARY'
  | 'AGENT_DEPLOYMENT'
  | 'PU_STATUS'
  | 'INCIDENTS'
  | 'RESULT_PROGRESS'
  | 'WARD_LGA_SUMMARY';

interface ReportsCenterPageProps {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  partyConfigs: Record<PartyCode, PartyConfig | null>;
}

const REPORT_LABELS: Record<ReportType, string> = {
  VERIFIED_PARTY_SUMMARY: 'Verified Party Results Summary (Ward / LGA / Constituency)',
  RESULT_PROGRESS: 'Result Submission & Verification Progress Report',
  WARD_LGA_SUMMARY: 'Ward & LGA Operational Summary Report',
  AGENT_DEPLOYMENT: 'Agent Deployment & Check-In Report',
  PU_STATUS: 'Polling Unit Operational Status Report',
  INCIDENTS: 'Election-Day Incidents & Escalations Report',
};

const PARTY_HEADER_MAP: Record<string, PartyCode> = {
  APC: 'APC',
  PDP: 'PDP',
  ADC: 'ADC',
  OTHERS: 'OTHERS',
};

const INTERNAL_VERIFICATION_DISCLAIMER =
  'FDMIS Internally Verified — These figures represent internally verified operational records within FDMIS and are NOT officially declared INEC results.';

export function ReportsCenterPage({
  user,
  wards,
  pollingUnits,
  checkIns,
  incidents,
  results,
  approvedPuResults,
  partyConfigs,
}: ReportsCenterPageProps) {
  const authorizedLgas = getAuthorizedLgas(user);

  const [reportType, setReportType] = useState<ReportType>('VERIFIED_PARTY_SUMMARY');
  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [wardFilter, setWardFilter] = useState<string>('all');

  const wardsInScope = useMemo(
    () => wards.filter((w) => lgaFilter === 'all' || w.lgaId === lgaFilter),
    [wards, lgaFilter]
  );

  const scopeLabel = useMemo(() => {
    if (wardFilter !== 'all') {
      const w = wards.find((item) => item.id === wardFilter);
      if (w) return `${w.name} Ward (${LGA_DEFINITIONS[w.lgaId]?.shortName})`;
    }
    if (lgaFilter !== 'all') {
      return LGA_DEFINITIONS[lgaFilter].displayName;
    }
    if (user.role === UserRole.WARD_COORDINATOR && wards[0]) {
      return `${wards[0].name} Ward`;
    }
    if (user.role === UserRole.VERIFICATION_OFFICER && user.assignedWardId && wards[0]) {
      return `${wards[0].name} Ward`;
    }
    return authorizedLgas.length > 1
      ? 'Funtua & Dandume Federal Constituency'
      : LGA_DEFINITIONS[authorizedLgas[0] || 'funtua'].displayName;
  }, [wardFilter, lgaFilter, wards, user.role, user.assignedWardId, authorizedLgas]);

  const scopedPus = useMemo(
    () =>
      pollingUnits.filter(
        (p) =>
          (lgaFilter === 'all' || p.lgaId === lgaFilter) &&
          (wardFilter === 'all' || p.wardId === wardFilter)
      ),
    [pollingUnits, lgaFilter, wardFilter]
  );

  const scopedIncidents = useMemo(
    () =>
      incidents.filter(
        (i) =>
          (lgaFilter === 'all' || i.lgaId === lgaFilter) &&
          (wardFilter === 'all' || i.wardId === wardFilter)
      ),
    [incidents, lgaFilter, wardFilter]
  );

  const scopedResults = useMemo(
    () =>
      results.filter(
        (r) =>
          (lgaFilter === 'all' || r.lgaId === lgaFilter) &&
          (wardFilter === 'all' || r.wardId === wardFilter)
      ),
    [results, lgaFilter, wardFilter]
  );

  const canonicalApproved = useMemo(
    () => getCanonicalApprovedPuResults(approvedPuResults, results),
    [approvedPuResults, results]
  );

  const scopedApproved = useMemo(
    () =>
      canonicalApproved.filter(
        (a) =>
          (lgaFilter === 'all' || a.lgaId === lgaFilter) &&
          (wardFilter === 'all' || a.wardId === wardFilter)
      ),
    [canonicalApproved, lgaFilter, wardFilter]
  );

  const scopedPartySummary = useMemo(() => {
    const expected =
      scopedPus.length > 0
        ? scopedPus.length
        : lgaFilter !== 'all'
          ? LGA_DEFINITIONS[lgaFilter].expectedPollingUnits
          : authorizedLgas.length === 1
            ? LGA_DEFINITIONS[authorizedLgas[0]].expectedPollingUnits
            : TOTAL_EXPECTED_POLLING_UNITS;

    const pendingCount = scopedResults.filter(
      (r) =>
        r.verificationStatus === VerificationStatus.SUBMITTED ||
        r.verificationStatus === VerificationStatus.UNDER_REVIEW
    ).length;

    return summarizeVoteTotals(scopedApproved, expected, pendingCount);
  }, [scopedPus.length, lgaFilter, authorizedLgas, scopedResults, scopedApproved]);

  const reportTable = useMemo(() => {
    const checkInByPu = new Map<string, AgentCheckIn>();
    checkIns.forEach((c) => {
      if (!checkInByPu.has(c.puId)) checkInByPu.set(c.puId, c);
    });

    if (reportType === 'VERIFIED_PARTY_SUMMARY') {
      const filteredWards = wards.filter(
        (w) =>
          (lgaFilter === 'all' || w.lgaId === lgaFilter) &&
          (wardFilter === 'all' || w.id === wardFilter)
      );
      const headers = [
        'Ward',
        'LGA',
        'Verified PUs',
        'Expected PUs',
        'APC',
        'PDP',
        'ADC',
        'OTHERS',
        'Valid Votes',
        'Rejected',
        'Total Cast',
      ];
      const rows: (string | number)[][] = filteredWards.map((w) => {
        const summary = buildWardSummary(w, canonicalApproved, pollingUnits, results);
        return [
          w.name,
          LGA_DEFINITIONS[w.lgaId]?.shortName || w.lgaId,
          summary.verifiedPuCount,
          summary.expectedPuCount,
          summary.apcVotes,
          summary.pdpVotes,
          summary.adcVotes,
          summary.othersVotes,
          summary.validVotes,
          summary.rejectedVotes,
          summary.totalVotesCast,
        ];
      });

      if (rows.length > 1 || (rows.length === 0 && scopedApproved.length > 0)) {
        rows.push([
          `TOTAL (${scopeLabel})`,
          lgaFilter === 'all'
            ? authorizedLgas.length > 1
              ? 'Constituency'
              : LGA_DEFINITIONS[authorizedLgas[0] || 'funtua'].shortName
            : LGA_DEFINITIONS[lgaFilter].shortName,
          scopedPartySummary.verifiedPuCount,
          scopedPartySummary.expectedPuCount,
          scopedPartySummary.apcVotes,
          scopedPartySummary.pdpVotes,
          scopedPartySummary.adcVotes,
          scopedPartySummary.othersVotes,
          scopedPartySummary.validVotes,
          scopedPartySummary.rejectedVotes,
          scopedPartySummary.totalVotesCast,
        ]);
      }

      return {
        headers,
        rows,
        dataStatus:
          scopedPartySummary.verifiedPuCount === 0
            ? 'No Verified Results Yet'
            : `FDMIS Internally Verified (${scopedPartySummary.verifiedPuCount} of ${scopedPartySummary.expectedPuCount} PUs)`,
      };
    }

    if (reportType === 'AGENT_DEPLOYMENT') {
      const headers = [
        'PU Code',
        'Polling Unit',
        'Ward',
        'LGA',
        'Assigned Agent',
        'Check-In Status',
        'Arrival Time',
        'Network',
      ];
      const rows = scopedPus.map((pu) => {
        const chk = checkInByPu.get(pu.id);
        return [
          pu.puCode,
          pu.name,
          pu.wardName,
          LGA_DEFINITIONS[pu.lgaId]?.shortName || pu.lgaId,
          pu.assignedAgentName || 'Unassigned',
          chk ? 'Checked In' : pu.assignedAgentUid ? 'Assigned / Pending Check-In' : 'Unassigned',
          chk ? chk.arrivalTimeText : '-',
          chk ? chk.networkStatus : '-',
        ];
      });
      return {
        headers,
        rows,
        dataStatus:
          rows.length === 0
            ? 'Empty'
            : checkIns.length > 0
              ? 'Live Field Telemetry'
              : 'Directory Ready (No Check-Ins Yet)',
      };
    }

    if (reportType === 'PU_STATUS') {
      const headers = ['PU Code', 'Polling Unit', 'Ward', 'LGA', 'Status', 'Assigned Agent'];
      const rows = scopedPus.map((pu) => [
        pu.puCode,
        pu.name,
        pu.wardName,
        LGA_DEFINITIONS[pu.lgaId]?.shortName || pu.lgaId,
        PU_STATUS_META[pu.operationalStatus]?.label || pu.operationalStatus,
        pu.assignedAgentName || 'Unassigned',
      ]);
      return {
        headers,
        rows,
        dataStatus: rows.length === 0 ? 'Empty' : 'Live Operational Directory',
      };
    }

    if (reportType === 'INCIDENTS') {
      const headers = [
        'PU Code',
        'Polling Unit',
        'Category',
        'Title',
        'Urgency',
        'Workflow Status',
        'Reported By',
        'Timestamp',
      ];
      const rows = scopedIncidents.map((inc) => [
        inc.puCode,
        inc.puName,
        inc.category,
        inc.title,
        inc.urgency,
        inc.status,
        inc.reporterName,
        formatFirestoreTime(inc.createdAt),
      ]);
      return {
        headers,
        rows,
        dataStatus: rows.length === 0 ? 'Empty (No Incidents)' : 'Live Incident Register',
      };
    }

    if (reportType === 'RESULT_PROGRESS') {
      const headers = [
        'PU Code',
        'Polling Unit',
        'Ward',
        'APC',
        'PDP',
        'ADC',
        'OTHERS',
        'Registered',
        'Accredited',
        'Valid Votes',
        'Rejected Votes',
        'Total Cast',
        'Verification Status',
        'Public Approval',
      ];
      const rows = scopedResults.map((res) => [
        res.puCode,
        res.puName,
        res.wardName,
        res.apcVotes ?? 0,
        res.pdpVotes ?? 0,
        res.adcVotes ?? 0,
        res.othersVotes ?? 0,
        res.registeredVoters,
        res.accreditedVoters,
        res.validVotes,
        res.rejectedVotes,
        res.totalVotesCast,
        res.verificationStatus,
        res.publiclyApproved ? 'Publicly Approved' : 'Internal Only',
      ]);
      const allVerified =
        scopedResults.length > 0 &&
        scopedResults.every((r) => r.verificationStatus === VerificationStatus.VERIFIED);
      return {
        headers,
        rows,
        dataStatus:
          rows.length === 0
            ? 'Empty'
            : allVerified
              ? '100% FDMIS Internally Verified'
              : 'Mixed (Verified & Unverified)',
      };
    }

    // WARD_LGA_SUMMARY
    const filteredWards = wards.filter(
      (w) =>
        (lgaFilter === 'all' || w.lgaId === lgaFilter) &&
        (wardFilter === 'all' || w.id === wardFilter)
    );
    const headers = [
      'Ward',
      'LGA',
      'Total PUs',
      'Reporting PUs',
      'Assigned Agents',
      'Active Incidents',
      'Results Submitted',
      'Results Verified',
    ];
    const rows = filteredWards.map((w) => {
      const wPus = scopedPus.filter((p) => p.wardId === w.id);
      const wInc = scopedIncidents.filter(
        (i) => i.wardId === w.id && isIncidentActive(i.status)
      );
      const wRes = scopedResults.filter((r) => r.wardId === w.id);
      return [
        w.name,
        LGA_DEFINITIONS[w.lgaId]?.shortName || w.lgaId,
        wPus.length,
        wPus.filter((p) => isPuReporting(p.operationalStatus)).length,
        wPus.filter((p) => Boolean(p.assignedAgentUid)).length,
        wInc.length,
        wRes.length,
        wRes.filter((r) => r.verificationStatus === VerificationStatus.VERIFIED).length,
      ];
    });
    return {
      headers,
      rows,
      dataStatus: rows.length === 0 ? 'Empty' : 'Live Ward Aggregation',
    };
  }, [
    reportType,
    scopedPus,
    scopedIncidents,
    scopedResults,
    scopedApproved,
    scopedPartySummary,
    canonicalApproved,
    pollingUnits,
    results,
    checkIns,
    wards,
    lgaFilter,
    wardFilter,
    scopeLabel,
    authorizedLgas,
  ]);

  const showResultDisclaimer =
    reportType === 'VERIFIED_PARTY_SUMMARY' || reportType === 'RESULT_PROGRESS';

  const handleDownloadCsv = () => {
    downloadStructuredCsv({
      fileName: `fdmis_${reportType.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`,
      reportTitle: REPORT_LABELS[reportType],
      scopeLabel,
      dataStatus: reportTable.dataStatus,
      disclaimer: showResultDisclaimer ? INTERNAL_VERIFICATION_DISCLAIMER : undefined,
      headers: reportTable.headers,
      rows: reportTable.rows,
    });
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Controls (hidden on print) */}
      <div className="fdmis-surface p-3.5 sm:p-4 space-y-4 print:hidden">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <FileBarChart2 className="h-5 w-5 text-[#06452F]" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Reports &amp; Exports Center
              </h2>
              <p className="text-xs text-slate-500">
                Structured CSV downloads and printable PDF situation reports from verified operational records
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={reportTable.rows.length === 0}
              onClick={handleDownloadCsv}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-sm font-medium text-white hover:bg-[#043B29] disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              disabled={reportTable.rows.length === 0}
              onClick={() => window.print()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>Print / Save PDF</span>
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="rep-type" className="block text-xs font-medium text-slate-700">
              Report Type
            </label>
            <select
              id="rep-type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              {(Object.keys(REPORT_LABELS) as ReportType[]).map((key) => (
                <option key={key} value={key}>
                  {REPORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {authorizedLgas.length > 1 ? (
            <div>
              <label htmlFor="rep-lga" className="block text-xs font-medium text-slate-700">
                LGA Scope
              </label>
              <select
                id="rep-lga"
                value={lgaFilter}
                onChange={(e) => {
                  setLgaFilter(e.target.value as 'all' | LgaId);
                  setWardFilter('all');
                }}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">All Constituency LGAs</option>
                <option value="funtua">Funtua LGA (20-14)</option>
                <option value="dandume">Dandume LGA (20/07)</option>
              </select>
            </div>
          ) : null}

          <div>
            <label htmlFor="rep-ward" className="block text-xs font-medium text-slate-700">
              Ward Filter
            </label>
            <select
              id="rep-ward"
              value={wardFilter}
              onChange={(e) => setWardFilter(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">All Wards ({wardsInScope.length})</option>
              {wardsInScope.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Verified Party Results Bar Chart Preview */}
      {reportType === 'VERIFIED_PARTY_SUMMARY' ? (
        <ResultBarChart
          title={`Verified Party Tally — ${scopeLabel}`}
          subtitle="Aggregated strictly from verified polling unit result sheets"
          summary={scopedPartySummary}
          partyConfigs={partyConfigs}
          emptyMessage="No verified polling unit results exist in this scope yet."
        />
      ) : null}

      {/* Report Preview / Printable Sheet */}
      {reportTable.rows.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="No matching records exist for this report and geographical scope yet."
        />
      ) : (
        <div className="fdmis-surface overflow-hidden print:border-0">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 space-y-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                {REPORT_LABELS[reportType]}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                <span>
                  Scope: <strong className="text-slate-800">{scopeLabel}</strong>
                </span>
                <span>
                  Status: <strong className="text-slate-800">{reportTable.dataStatus}</strong>
                </span>
                <span className="font-mono tabular-nums">
                  Generated: {new Date().toLocaleString('en-NG')}
                </span>
                <span className="font-mono tabular-nums">Rows: {reportTable.rows.length}</span>
              </div>
            </div>

            {showResultDisclaimer ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                <span>{INTERNAL_VERIFICATION_DISCLAIMER}</span>
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  {reportTable.headers.map((h) => {
                    const partyCode = PARTY_HEADER_MAP[h];
                    if (partyCode) {
                      const partyMeta = FIXED_PARTY_MAP[partyCode];
                      return (
                        <th key={h} className="px-3.5 py-2.5 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5" title={partyMeta.name}>
                            <PartyLogo
                              partyCode={partyCode}
                              partyConfig={partyConfigs[partyCode]}
                              size="xs"
                            />
                            <span>{partyCode}</span>
                          </div>
                        </th>
                      );
                    }
                    return (
                      <th key={h} className="px-3.5 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportTable.rows.map((row, idx) => {
                  const isTotalRow =
                    reportType === 'VERIFIED_PARTY_SUMMARY' &&
                    typeof row[0] === 'string' &&
                    row[0].startsWith('TOTAL (');
                  return (
                    <tr
                      key={idx}
                      className={
                        isTotalRow
                          ? 'bg-emerald-50/70 font-semibold text-slate-900'
                          : 'hover:bg-slate-50/70'
                      }
                    >
                      {row.map((cell, cIdx) => {
                        const isNumeric = typeof cell === 'number';
                        return (
                          <td
                            key={cIdx}
                            className={`px-3.5 py-2.5 ${
                              isNumeric ? 'font-mono tabular-nums text-slate-900' : 'text-slate-800'
                            }`}
                          >
                            {isNumeric ? cell.toLocaleString() : String(cell ?? '')}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
