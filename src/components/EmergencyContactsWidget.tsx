import { Phone, PhoneCall, ShieldAlert, Star } from 'lucide-react';
import {
  LGA_DEFINITIONS,
  sanitizeTelHref,
  type EmergencyContact,
  type LgaId,
} from '../types/fdmis';

interface EmergencyContactsWidgetProps {
  contacts: EmergencyContact[];
  onOpenDirectory?: () => void;
}

export function EmergencyContactsWidget({
  contacts,
  onOpenDirectory,
}: EmergencyContactsWidgetProps) {
  return (
    <section className="rounded-xl border border-red-200 bg-white p-5 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-700">
            <PhoneCall className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Emergency Assistance Numbers
            </h3>
            <p className="text-xs text-slate-500">
              Tap Call Now to open your phone dialer immediately for urgent field support
            </p>
          </div>
        </div>
        {onOpenDirectory ? (
          <button
            type="button"
            onClick={onOpenDirectory}
            className="text-xs font-medium text-[#0b3b24] hover:underline"
          >
            View all contacts
          </button>
        ) : null}
      </div>

      {contacts.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            No emergency assistance numbers have been configured for your scope yet. Authorized
            Super Admins can add contacts under Emergency Assistance.
          </span>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {contacts.slice(0, 6).map((c) => {
            const telHref = `tel:${sanitizeTelHref(c.phoneNumber)}`;
            return (
              <div
                key={c.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                  c.isPriority
                    ? 'border-red-200 bg-red-50/50'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-xs font-semibold text-slate-900">{c.name}</p>
                    {c.isPriority ? (
                      <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                        <Star className="h-2.5 w-2.5 fill-red-700 text-red-700" aria-hidden="true" />
                        <span>Priority</span>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600">
                    {c.roleLabel ? `${c.roleLabel} · ` : ''}
                    {c.scopeLgaId === 'all'
                      ? 'All Constituency'
                      : LGA_DEFINITIONS[c.scopeLgaId as LgaId]?.displayName || c.scopeLgaId}
                  </p>
                  <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    {c.phoneNumber}
                  </p>
                </div>

                <a
                  href={telHref}
                  className={`inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap ${
                    c.isPriority
                      ? 'bg-red-700 hover:bg-red-800'
                      : 'bg-[#0b3b24] hover:bg-[#115233]'
                  }`}
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Call Now</span>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
