import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { formatFirestoreTime, type AuditLog } from '../types/fdmis';

interface AuditLogsPageProps {
  logs: AuditLog[];
  loading: boolean;
}

export function AuditLogsPage({ logs, loading }: AuditLogsPageProps) {
  const [search, setSearch] = useState('');

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (log) =>
        log.action.toLowerCase().includes(q) ||
        log.actorName.toLowerCase().includes(q) ||
        log.actorEmail.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q)
    );
  }, [logs, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter audit trail by action, actor, or detail..."
          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none sm:max-w-sm"
        />
        <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
          {filteredLogs.length} immutable record{filteredLogs.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading protected audit logs...
        </div>
      ) : filteredLogs.length === 0 ? (
        <EmptyState
          title="No audit events recorded yet."
          description="Administrative actions, logins, directory imports, and emergency revocations appear here automatically."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {formatFirestoreTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <ClipboardList className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
