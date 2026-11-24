import { useMemo, useState } from 'react';
import { ClipboardList, ShieldAlert, ShieldCheck } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { formatFirestoreTime, type AuditLog } from '../types/fdmis';

interface AuditLogsPageProps {
  logs: AuditLog[];
  loading: boolean;
}

type AuditCategory =
  | 'ALL'
  | 'AUTH_SECURITY'
  | 'RESULTS_VERIFICATION'
  | 'INCIDENTS_EMERGENCY'
  | 'DELETION_BACKUP'
  | 'DIRECTORY_ADMIN';

function classifyAuditAction(action: string, entity: string): AuditCategory {
  const a = action.toUpperCase();
  const e = entity.toLowerCase();
  if (
    a.includes('LOGIN') ||
    a.includes('PASSWORD') ||
    a.includes('REVOKE') ||
    a.includes('SUSPEND') ||
    a.includes('ROLE') ||
    a.includes('SESSION') ||
    a.includes('SECURITY')
  ) {
    return 'AUTH_SECURITY';
  }
  if (a.includes('DELETE') || a.includes('BACKUP') || a.includes('RESTORE') || a.includes('AGGREGATES')) {
    return 'DELETION_BACKUP';
  }
  if (a.includes('RESULT') || e.includes('result')) {
    return 'RESULTS_VERIFICATION';
  }
  if (a.includes('INCIDENT') || a.includes('EMERGENCY') || a.includes('ESCALATION')) {
    return 'INCIDENTS_EMERGENCY';
  }
  return 'DIRECTORY_ADMIN';
}

function toMs(ts: AuditLog['createdAt']): number {
  if (!ts) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return Number.isNaN(p) ? 0 : p;
  }
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof (ts as { seconds?: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function AuditLogsPage({ logs, loading }: AuditLogsPageProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AuditCategory>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const availableRoles = useMemo(
    () => Array.from(new Set(logs.map((l) => l.actorRole).filter(Boolean))).sort(),
    [logs]
  );

  const availableEntities = useMemo(
    () => Array.from(new Set(logs.map((l) => l.affectedEntity).filter(Boolean))).sort(),
    [logs]
  );

  // Module 8: Security & High-Sensitivity Activity Summary (strictly from real immutable logs)
  const securitySummary = useMemo(() => {
    let revocations = 0;
    let roleChanges = 0;
    let passwordEvents = 0;
    let deletionBackupEvents = 0;
    for (const l of logs) {
      const a = l.action.toUpperCase();
      if (a.includes('REVOKE') || a.includes('SUSPEND')) revocations += 1;
      if (a.includes('ROLE') || a.includes('ADMIN') || a.includes('PROMOTE')) roleChanges += 1;
      if (a.includes('PASSWORD')) passwordEvents += 1;
      if (a.includes('DELETE') || a.includes('BACKUP') || a.includes('RESTORE')) {
        deletionBackupEvents += 1;
      }
    }
    return { revocations, roleChanges, passwordEvents, deletionBackupEvents };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const startMs = startDate ? Date.parse(`${startDate}T00:00:00`) : 0;
    const endMs = endDate ? Date.parse(`${endDate}T23:59:59.999`) : 0;

    return logs.filter((log) => {
      if (category !== 'ALL' && classifyAuditAction(log.action, log.affectedEntity) !== category) {
        return false;
      }
      if (roleFilter !== 'ALL' && log.actorRole !== roleFilter) return false;
      if (entityFilter !== 'ALL' && log.affectedEntity !== entityFilter) return false;

      if (startMs || endMs) {
        const ms = toMs(log.createdAt);
        if (startMs && ms < startMs) return false;
        if (endMs && ms > endMs) return false;
      }

      if (!q) return true;
      return (
        log.action.toLowerCase().includes(q) ||
        log.actorName.toLowerCase().includes(q) ||
        log.actorEmail.toLowerCase().includes(q) ||
        log.affectedEntity.toLowerCase().includes(q) ||
        log.affectedId.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q)
      );
    });
  }, [logs, search, category, roleFilter, entityFilter, startDate, endDate]);

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Module 8: Security & High-Sensitivity Activity Monitoring Strip */}
      <section className="fdmis-surface p-3 sm:p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#06452F]" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Audit Trail &amp; Security Monitoring
            </h2>
          </div>
          <span className="font-mono text-[11px] text-slate-500">
            Immutable append-only Firestore audit_logs
          </span>
        </div>

        <div className="fdmis-metrics-grid gap-2 sm:gap-2.5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Revocations / Suspensions</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                securitySummary.revocations > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {securitySummary.revocations}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Role / Privilege Changes</p>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
              {securitySummary.roleChanges}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Password &amp; Reset Events</p>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
              {securitySummary.passwordEvents}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Deletions / Backup / Recovery</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                securitySummary.deletionBackupEvents > 0 ? 'text-amber-800' : 'text-slate-900'
              }`}
            >
              {securitySummary.deletionBackupEvents}
            </p>
          </div>
        </div>
      </section>

      {/* Advanced Filters Bar */}
      <div className="space-y-3 fdmis-surface p-3 sm:p-3.5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, actor, target ID, or details..."
            className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
          />

          <select
            aria-label="Filter by audit category"
            value={category}
            onChange={(e) => setCategory(e.target.value as AuditCategory)}
            className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800"
          >
            <option value="ALL">All Categories</option>
            <option value="AUTH_SECURITY">Auth, Roles &amp; Security</option>
            <option value="RESULTS_VERIFICATION">Results &amp; Verification</option>
            <option value="INCIDENTS_EMERGENCY">Incidents &amp; Emergency</option>
            <option value="DELETION_BACKUP">Deletions, Backups &amp; Recovery</option>
            <option value="DIRECTORY_ADMIN">Directory &amp; Admin</option>
          </select>

          <select
            aria-label="Filter by actor role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800"
          >
            <option value="ALL">All Actor Roles</option>
            {availableRoles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by affected collection"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800"
          >
            <option value="ALL">All Entities</option>
            {availableEntities.map((ent) => (
              <option key={ent} value={ent}>
                {ent}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <label className="inline-flex items-center gap-1.5">
              <span>From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-h-[36px] rounded-lg border border-slate-300 px-2 text-xs"
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span>To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="min-h-[36px] rounded-lg border border-slate-300 px-2 text-xs"
              />
            </label>
            {category !== 'ALL' || roleFilter !== 'ALL' || entityFilter !== 'ALL' || startDate || endDate || search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCategory('ALL');
                  setRoleFilter('ALL');
                  setEntityFilter('ALL');
                  setStartDate('');
                  setEndDate('');
                }}
                className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset Filters
              </button>
            ) : null}
          </div>

          <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {filteredLogs.length} immutable record{filteredLogs.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="fdmis-surface p-8 text-center text-sm text-slate-500">
          Loading protected audit logs...
        </div>
      ) : filteredLogs.length === 0 ? (
        <EmptyState
          title="No matching audit events found."
          description="Administrative actions, logins, directory imports, backups, deletions, and emergency revocations appear here automatically."
        />
      ) : (
        <div className="overflow-hidden fdmis-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log) => {
                  const isSensitive =
                    log.action.includes('DELETE') ||
                    log.action.includes('REVOKE') ||
                    log.action.includes('SUSPEND') ||
                    log.action.includes('RESTORE');
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatFirestoreTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold whitespace-nowrap ${
                            isSensitive ? 'text-red-800' : 'text-slate-900'
                          }`}
                        >
                          {isSensitive ? (
                            <ShieldAlert className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
                          ) : (
                            <ClipboardList className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
                          )}
                          <span>{log.action}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="font-medium text-slate-900">{log.actorName}</p>
                        <p className="text-slate-500">{log.actorRole}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {log.affectedEntity}/{log.affectedId}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{log.details}</td>
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
