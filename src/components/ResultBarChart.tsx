import { useState } from 'react';
import { BarChart3, ShieldCheck } from 'lucide-react';
import type { PartyCode, PartyConfig } from '../types/fdmis';
import type { VoteTotalsSummary } from '../utils/aggregationEngine';
import { PartyLogo } from './PartyLogo';

interface ResultBarChartProps {
  title: string;
  subtitle?: string;
  summary: VoteTotalsSummary;
  partyConfigs: Partial<Record<PartyCode, PartyConfig | null>>;
  emptyMessage?: string;
}

export function ResultBarChart({
  title,
  subtitle,
  summary,
  partyConfigs,
  emptyMessage = 'No verified polling unit results have been approved for this scope yet.',
}: ResultBarChartProps) {
  const [layoutMode, setLayoutMode] = useState<'horizontal' | 'vertical'>('horizontal');
  const [activeParty, setActiveParty] = useState<PartyCode | null>(null);

  const hasVerifiedData = summary.verifiedPuCount > 0;
  const maxVotes = Math.max(1, ...summary.standings.map((s) => s.votes));
  const selectedStanding =
    summary.standings.find((s) => s.code === activeParty) || null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <h3 className="font-display text-base font-semibold text-slate-900">{title}</h3>
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
              <ShieldCheck className="h-3 w-3 text-emerald-700" aria-hidden="true" />
              <span>FDMIS Internally Verified</span>
            </span>
          </div>
          {subtitle ? <p className="mt-1 text-xs text-slate-600">{subtitle}</p> : null}
        </div>

        {hasVerifiedData ? (
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setLayoutMode('horizontal')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                layoutMode === 'horizontal'
                  ? 'bg-[#0b3b24] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Horizontal
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('vertical')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                layoutMode === 'vertical'
                  ? 'bg-[#0b3b24] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Columns
            </button>
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Disclaimer: Figures aggregated strictly from verified FDMIS polling unit submissions and are
        not officially declared INEC results.
      </p>

      {!hasVerifiedData ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">{emptyMessage}</p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Verified PUs: 0 / {summary.expectedPuCount} · Pending Verification:{' '}
            {summary.pendingSubmissionCount}
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Interactive Bar Chart */}
          <div className="xl:col-span-7">
            {layoutMode === 'horizontal' ? (
              <div className="space-y-3.5">
                {summary.standings.map((party) => {
                  const widthPct =
                    summary.validVotes > 0
                      ? Math.max(party.votes > 0 ? 3 : 0, (party.votes / maxVotes) * 100)
                      : 0;
                  const isFocused = activeParty === party.code;
                  return (
                    <button
                      key={party.code}
                      type="button"
                      onClick={() =>
                        setActiveParty((prev) => (prev === party.code ? null : party.code))
                      }
                      className={`block w-full rounded-lg border p-3 text-left transition-colors ${
                        isFocused
                          ? 'border-[#0b3b24] bg-emerald-50/40'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <PartyLogo
                            partyCode={party.code}
                            partyConfig={partyConfigs[party.code]}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {party.code}
                              </span>
                              {party.rank > 0 ? (
                                <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                                  #{party.rank}
                                </span>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-slate-600">{party.name}</p>
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                            {party.votes.toLocaleString()}
                          </p>
                          <p className="font-mono text-[11px] font-medium text-slate-600 tabular-nums">
                            {party.percentage.toFixed(2)}%
                          </p>
                        </div>
                      </div>

                      <div
                        className="mt-2.5 h-3.5 w-full overflow-hidden rounded-full bg-slate-200"
                        role="progressbar"
                        aria-valuenow={party.percentage}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${party.code} ${party.name} votes`}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: party.barColor,
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid h-64 grid-cols-4 items-end gap-4 border-b border-slate-300 pb-3">
                  {summary.standings.map((party) => {
                    const heightPct =
                      summary.validVotes > 0
                        ? Math.max(party.votes > 0 ? 6 : 2, (party.votes / maxVotes) * 100)
                        : 2;
                    return (
                      <button
                        key={party.code}
                        type="button"
                        onClick={() =>
                          setActiveParty((prev) => (prev === party.code ? null : party.code))
                        }
                        className="flex h-full flex-col items-center justify-end gap-1.5 text-center focus:outline-none"
                      >
                        <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                          {party.votes.toLocaleString()}
                        </span>
                        <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                          {party.percentage.toFixed(1)}%
                        </span>
                        <div className="flex w-full flex-1 items-end justify-center px-2">
                          <div
                            className="w-full max-w-[56px] rounded-t-lg transition-all duration-500"
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: party.barColor,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-3 text-center">
                  {summary.standings.map((party) => (
                    <div key={party.code} className="flex flex-col items-center gap-1">
                      <PartyLogo
                        partyCode={party.code}
                        partyConfig={partyConfigs[party.code]}
                        size="sm"
                      />
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {party.code}
                      </span>
                      <span className="line-clamp-1 text-[11px] text-slate-600">{party.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedStanding ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
                <span className="font-semibold text-slate-900">
                  {selectedStanding.code} ({selectedStanding.name}):
                </span>{' '}
                {selectedStanding.votes.toLocaleString()} valid votes ({selectedStanding.percentage.toFixed(2)}% of{' '}
                {summary.validVotes.toLocaleString()} valid votes across{' '}
                {summary.verifiedPuCount.toLocaleString()} verified polling units).
              </div>
            ) : null}
          </div>

          {/* Numerical Summary Table Alongside Chart */}
          <div className="xl:col-span-5">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Party</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Votes</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Share</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {summary.standings.map((party) => (
                    <tr key={party.code} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <PartyLogo
                            partyCode={party.code}
                            partyConfig={partyConfigs[party.code]}
                            size="xs"
                          />
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-slate-900">{party.code}</p>
                            <p className="truncate text-[11px] text-slate-500">{party.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {party.votes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums">
                        {party.percentage.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums">
                        {party.rank > 0 ? `#${party.rank}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-3">
              <div>
                <p className="text-slate-500">Registered Voters</p>
                <p className="font-mono font-semibold text-slate-900 tabular-nums">
                  {summary.registeredVoters.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Accredited Voters</p>
                <p className="font-mono font-semibold text-slate-900 tabular-nums">
                  {summary.accreditedVoters.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Total Valid Votes</p>
                <p className="font-mono font-semibold text-emerald-800 tabular-nums">
                  {summary.validVotes.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Rejected Votes</p>
                <p className="font-mono font-semibold text-red-700 tabular-nums">
                  {summary.rejectedVotes.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Total Votes Cast</p>
                <p className="font-mono font-semibold text-slate-900 tabular-nums">
                  {summary.totalVotesCast.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Verified Coverage</p>
                <p className="font-mono font-semibold text-slate-900 tabular-nums">
                  {summary.verifiedPuCount.toLocaleString()} / {summary.expectedPuCount.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
