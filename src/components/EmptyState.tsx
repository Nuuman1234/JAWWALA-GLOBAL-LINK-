import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  title = 'No operational data has been submitted yet.',
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center shadow-[0_2px_8px_rgba(16,43,63,0.03)]">
      <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-[#F5F7FA] text-[#06452F]">
        <Inbox className="h-4.5 w-4.5" aria-hidden="true" />
      </div>
      <h3 className="font-display text-sm font-semibold text-[#102B3F]">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-slate-600">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
