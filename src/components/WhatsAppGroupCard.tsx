import { ExternalLink, MessageCircle } from 'lucide-react';
import { resolveWhatsAppGroupConfig, type GlobalSettings } from '../types/fdmis';

interface WhatsAppGroupCardProps {
  settings: GlobalSettings | null;
  compact?: boolean;
}

export function WhatsAppGroupCard({ settings, compact = false }: WhatsAppGroupCardProps) {
  const { enabled, groupName, inviteUrl } = resolveWhatsAppGroupConfig(settings);

  if (!enabled || !inviteUrl) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border border-emerald-200 bg-emerald-50/70 ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#06452F] text-white">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Official Situation Room WhatsApp Group
              </h3>
              <span className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                Free Direct Channel
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-700">
              Group: <strong className="text-[#06452F]">{groupName}</strong> · Direct authenticated
              team coordination across Android and desktop WhatsApp without paid gateway credentials.
            </p>
          </div>
        </div>

        <a
          href={inviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#06452F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#043B29] whitespace-nowrap"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          <span>Join FDMIS WhatsApp Group</span>
          <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
