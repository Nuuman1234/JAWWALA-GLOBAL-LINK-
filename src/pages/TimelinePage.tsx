import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  Radio,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  LGA_DEFINITIONS,
  formatFirestoreTime,
  getAuthorizedLgas,
  type LgaId,
  type PollingUnit,
  type TimelineEvent,
  type UserAccount,
  type Ward,
} from '../types/fdmis';

interface TimelinePageProps {
  user: UserAccount;
  wards: Ward[];
  pollingUnits: PollingUnit[];
  events: TimelineEvent[];
}

const EVENT_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All Event Types' },
  { value: 'AGENT_CHECK_IN', label: 'Agent Check-Ins' },
  { value: 'PU_STATUS_UPDATE', label: 'PU Status Milestones' },
  { value: 'INCIDENT_REPORTED', label: 'Incidents Reported' },
  { value: 'INCIDENT_UPDATED', label: 'Incident Escalations & Updates' },
  { value: 'RESULT_SUBMITTED', label: 'Results Submitted' },
  { value: 'RESULT_RESUBMITTED', label: 'Results Resubmitted' },
  { value: 'RESULT_VERIFIED', label: 'Results Verified' },
];

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType.startsWith('INCIDENT')) {
    return <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden="true" />;
  }
  if (eventType === 'RESULT_VERIFIED') {
    return <FileCheck2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />;
  }
  if (eventType.startsWith('RESULT')) {
    return <CheckCircle2 className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />;
  }
  if (eventType === 'AGENT_CHECK_IN') {
    return <Radio className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />;
  }
  return <Clock className="h-4 w-4 text-slate-600" aria-hidden="true" />;
}

export function TimelinePage({
  user,
  wards,
  pollingUnits,
  events,
}: TimelinePageProps) {
  const authorizedLgas = getAuthorizedLgas(user);

  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>('all');
  const [wardFilter, setWardFilter] = useState<string>('all');
  const [puFilter, setPuFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const wardsInScope = useMemo(
    () => wards.filter((w) => lgaFilter === 'all' || w.lgaId === lgaFilter),
    [wards, lgaFilter]
  );

  const pusInScope = useMemo(
    () =>
      pollingUnits.filter(
        (p) =>
          (lgaFilter === 'all' || p.lgaId === lgaFilter) &&
          (wardFilter === 'all' || p.wardId === wardFilter)
      ),
    [pollingUnits, lgaFilter, wardFilter]
  );

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (lgaFilter !== 'all' && e.lgaId !== lgaFilter) return false;
      if (wardFilter !== 'all' && e.wardId !== wardFilter) return false;
      if (puFilter !== 'all' && e.puId !== puFilter) return false;
      if (typeFilter !== 'ALL' && e.eventType !== typeFilter) return false;
      return true;
    });
  }, [events, lgaFilter, wardFilter, puFilter, typeFilter]);

  return (
    <div className="space-y-5">
      {/* Filter Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {authorizedLgas.length > 1 ? (
              <select
                aria-label="Filter timeline by LGA"
                value={lgaFilter}
                onChange={(e) => {
                  setLgaFilter(e.target.value as 'all' | LgaId);
                  setWardFilter('all');
                  setPuFilter('all');
                }}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">All Areas</option>
                <option value="funtua">Funtua LGA</option>
                <option value="dandume">Dandume LGA</option>
              </select>
            ) : null}

            <select
              aria-label="Filter timeline by Ward"
              value={wardFilter}
              onChange={(e) => {
                setWardFilter(e.target.value);
                setPuFilter('all');
              }}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">All Wards ({wardsInScope.length})</option>
              {wardsInScope.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter timeline by Polling Unit"
              value={puFilter}
              onChange={(e) => setPuFilter(e.target.value)}
              className="min-h-[44px] max-w-xs rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">All Polling Units</option>
              {pusInScope.map((pu) => (
                <option key={pu.id} value={pu.id}>
                  {pu.puCode} · {pu.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter timeline by Event Type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredEvents.length} event{filteredEvents.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Feed */}
      {filteredEvents.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="Chronological agent check-ins, materials arrival updates, voting milestones, incidents, and verifications will stream here live."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {filteredEvents.map((ev) => (
            <div key={ev.id} className="flex items-start gap-3.5 p-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                <EventIcon eventType={ev.eventType} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{ev.title}</p>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {formatFirestoreTime(ev.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{ev.description}</p>
                <p className="mt-1.5 font-mono text-[11px] text-slate-500">
                  {ev.puCode ? `${ev.puCode} · ` : ''}
                  {ev.lgaId === 'funtua' || ev.lgaId === 'dandume'
                    ? LGA_DEFINITIONS[ev.lgaId].shortName
                    : ev.lgaId}{' '}
                  · Operator: {ev.actorName}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
