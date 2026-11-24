import { useMemo, useState } from 'react';
import { CheckCircle2, Globe, Lock, ShieldAlert } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { PartyLogo } from '../components/PartyLogo';
import { ResultBarChart } from '../components/ResultBarChart';
import {
  FIXED_PARTIES,
  LGA_DEFINITIONS,
  TOTAL_EXPECTED_POLLING_UNITS,
  formatFirestoreTime,
  type GlobalSettings,
  type LgaId,
  type PartyCode,
  type PartyConfig,
  type PublicVerifiedResult,
} from '../types/fdmis';
import { buildPartyStandings, type VoteTotalsSummary } from '../utils/aggregationEngine';

interface PublicPortalPageProps {
  publicResults: PublicVerifiedResult[];
  settings: GlobalSettings | null;
  partyConfigs: Record<PartyCode, PartyConfig | null>;
}

export function PublicPortalPage({
  publicResults,
  settings,
  partyConfigs,
}: PublicPortalPageProps) {
  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [search, setSearch] = useState('');

  const enabled = settings?.publicSummaryEnabled ?? false;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return publicResults.filter((r) => {
      if (lgaFilter !== 'all' && r.lgaId !== lgaFilter) return false;
      if (!q) return true;
      return (
        r.puCode.toLowerCase().includes(q) ||
        r.puName.toLowerCase().includes(q) ||
        r.wardName.toLowerCase().includes(q)
      );
    });
  }, [publicResults, lgaFilter, search]);

  const summary: VoteTotalsSummary = useMemo(() => {
    const totals = filtered.reduce(
      (acc, r) => ({
        apcVotes: acc.apcVotes + Number(r.apcVotes ?? 0),
        pdpVotes: acc.pdpVotes + Number(r.pdpVotes ?? 0),
        adcVotes: acc.adcVotes + Number(r.adcVotes ?? 0),
        othersVotes: acc.othersVotes + Number(r.othersVotes ?? 0),
        registeredVoters: acc.registeredVoters + r.registeredVoters,
        accreditedVoters: acc.accreditedVoters + r.accreditedVoters,
        validVotes: acc.validVotes + r.validVotes,
        rejectedVotes: acc.rejectedVotes + r.rejectedVotes,
        totalVotesCast: acc.totalVotesCast + r.totalVotesCast,
      }),
      {
        apcVotes: 0,
        pdpVotes: 0,
        adcVotes: 0,
        othersVotes: 0,
        registeredVoters: 0,
        accreditedVoters: 0,
        validVotes: 0,
        rejectedVotes: 0,
        totalVotesCast: 0,
      }
    );

    const expectedPuCount =
      lgaFilter === 'all'
        ? TOTAL_EXPECTED_POLLING_UNITS
        : LGA_DEFINITIONS[lgaFilter].expectedPollingUnits;

    return {
      verifiedPuCount: filtered.length,
      expectedPuCount,
      pendingSubmissionCount: 0,
      ...totals,
      standings: buildPartyStandings({
        apcVotes: totals.apcVotes,
        pdpVotes: totals.pdpVotes,
        adcVotes: totals.adcVotes,
        othersVotes: totals.othersVotes,
        validVotes: totals.validVotes,
      }),
    };
  }, [filtered, lgaFilter]);

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Sanitized Boundary Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-950">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-[#06452F]" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            Sanitized Public Information Portal (Verified Constituency Summary)
          </p>
          <p className="mt-0.5 text-emerald-900/90">
            Strictly isolated from internal Situation Room workflows. Only Polling Unit totals explicitly verified and approved for public release by the Full Control Admin are shown here—with zero agent identities, contact details, or internal review notes.
          </p>
        </div>
      </div>

      {/* Verification Disclaimer */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p>
          <strong>FDMIS Internally Verified:</strong> Public summary figures are internally verified records collated by FDMIS and are NOT officially declared INEC results.
        </p>
      </div>

      {!enabled ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">Public Information Portal is currently closed</p>
            <p className="mt-1 text-xs text-amber-900">
              The Full Control Admin can enable public publication in System Settings once verified results are ready for release.
            </p>
          </div>
        </div>
      ) : publicResults.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="No verified polling unit results have been approved for public display yet."
        />
      ) : (
        <>
          {/* Summary Totals */}
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-5">
            <div className="fdmis-surface p-3 sm:p-3.5">
              <p className="text-xs font-medium text-slate-500">Approved Polling Units</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#06452F] tabular-nums">
                {filtered.length}
              </p>
            </div>
            <div className="fdmis-surface p-3 sm:p-3.5">
              <p className="text-xs font-medium text-slate-500">Accredited Voters</p>
              <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {summary.accreditedVoters.toLocaleString()}
              </p>
            </div>
            <div className="fdmis-surface p-3 sm:p-3.5">
              <p className="text-xs font-medium text-slate-500">Valid Votes</p>
              <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {summary.validVotes.toLocaleString()}
              </p>
            </div>
            <div className="fdmis-surface p-3 sm:p-3.5">
              <p className="text-xs font-medium text-slate-500">Rejected Votes</p>
              <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {summary.rejectedVotes.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-xs font-medium text-emerald-900">Total Votes Cast</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#06452F] tabular-nums">
                {summary.totalVotesCast.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 fdmis-surface p-3 sm:p-3.5">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PU code, name, or ward..."
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm sm:max-w-xs"
              />
              <select
                aria-label="Filter public results by LGA"
                value={lgaFilter}
                onChange={(e) => setLgaFilter(e.target.value as 'all' | LgaId)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">All LGAs</option>
                <option value="funtua">Funtua LGA</option>
                <option value="dandume">Dandume LGA</option>
              </select>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>Admin-Verified Public Dataset</span>
            </span>
          </div>

          {/* Interactive Party Bar Chart */}
          <ResultBarChart
            title={
              lgaFilter === 'all'
                ? 'Public Constituency Tally'
                : `Public Tally — ${LGA_DEFINITIONS[lgaFilter].displayName}`
            }
            subtitle="Aggregated strictly from polling unit totals approved for public display"
            summary={summary}
            partyConfigs={partyConfigs}
            emptyMessage="No polling unit records match the current filter."
          />

          {/* Sanitized Table */}
          <div className="overflow-hidden fdmis-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="px-4 py-3">PU Code</th>
                    <th className="px-4 py-3">Polling Unit</th>
                    <th className="px-4 py-3">Ward · LGA</th>
                    {FIXED_PARTIES.map((party) => (
                      <th key={party.code} className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5" title={party.name}>
                          <PartyLogo
                            partyCode={party.code}
                            partyConfig={partyConfigs[party.code]}
                            size="xs"
                          />
                          <span>{party.code}</span>
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right">Accredited</th>
                    <th className="px-4 py-3 text-right">Valid</th>
                    <th className="px-4 py-3 text-right">Rejected</th>
                    <th className="px-4 py-3 text-right">Total Cast</th>
                    <th className="px-4 py-3">Verified At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {item.puCode}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-900">
                        {item.puName}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {item.wardName} · {LGA_DEFINITIONS[item.lgaId]?.shortName}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                        {(item.apcVotes ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                        {(item.pdpVotes ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                        {(item.adcVotes ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                        {(item.othersVotes ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {item.accreditedVoters.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {item.validVotes.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {item.rejectedVotes.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold text-[#06452F] tabular-nums">
                        {item.totalVotesCast.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {formatFirestoreTime(item.verifiedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
