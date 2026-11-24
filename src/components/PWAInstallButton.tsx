import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { canInstall, isIOS, isInstalled, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || (!canInstall && !isIOS)) return null;

  const handleClick = async () => {
    if (canInstall) {
      await promptInstall();
    } else if (isIOS) {
      setShowIOSGuide((prev) => !prev);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`inline-flex items-center gap-1.5 rounded-md border border-emerald-700/30 bg-[#06452F]/10 font-medium text-[#06452F] transition-colors hover:bg-[#06452F]/15 whitespace-nowrap ${
          compact ? 'min-h-[34px] px-2.5 py-1 text-xs' : 'min-h-[40px] px-3.5 py-2 text-xs'
        }`}
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{compact ? 'Install App' : 'Install FDMIS App'}</span>
      </button>

      {showIOSGuide ? (
        <div
          role="dialog"
          aria-label="Install Instructions"
          className="absolute right-0 top-full z-40 mt-2 w-72 fdmis-surface p-3 sm:p-3.5 text-xs text-slate-700 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-slate-900">Install on Device</p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              aria-label="Dismiss install guide"
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-2 leading-relaxed">
            Tap <Share className="inline h-3.5 w-3.5 text-slate-700" aria-hidden="true" />{' '}
            <strong>Share</strong> in your browser toolbar, then select{' '}
            <strong>Add to Home Screen</strong> for full offline access.
          </p>
        </div>
      ) : null}
    </div>
  );
}
