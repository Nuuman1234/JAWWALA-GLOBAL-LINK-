import { useEffect, useRef, useState } from 'react';
import { Battery, BatteryCharging, BatteryLow, BatteryWarning } from 'lucide-react';

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  level: number;
  addEventListener: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
  removeEventListener: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

interface BatteryMonitorProps {
  onBatteryUpdate?: (levelPercent: number | null, charging: boolean | null) => void;
}

const PERSIST_THROTTLE_MS = 180_000;

export function BatteryMonitor({ onBatteryUpdate }: BatteryMonitorProps) {
  const [supported, setSupported] = useState<boolean>(true);
  const [levelPercent, setLevelPercent] = useState<number | null>(null);
  const [charging, setCharging] = useState<boolean | null>(null);

  const onUpdateRef = useRef(onBatteryUpdate);
  onUpdateRef.current = onBatteryUpdate;
  const lastPersistedRef = useRef<{
    level: number | null;
    charging: boolean | null;
    ts: number;
  }>({ level: null, charging: null, ts: 0 });

  useEffect(() => {
    const nav = typeof navigator !== 'undefined' ? (navigator as NavigatorWithBattery) : null;
    if (!nav || typeof nav.getBattery !== 'function') {
      setSupported(false);
      return;
    }

    let cancelled = false;
    let manager: BatteryManagerLike | null = null;

    const handleChange = () => {
      if (!manager || cancelled) return;
      const pct = Math.max(0, Math.min(100, Math.round(manager.level * 100)));
      const isCharging = Boolean(manager.charging);
      setLevelPercent(pct);
      setCharging(isCharging);

      const now = Date.now();
      const prev = lastPersistedRef.current;
      const delta = prev.level === null ? 100 : Math.abs(pct - prev.level);
      const chargingToggled = prev.charging !== isCharging;
      const elapsed = now - prev.ts;

      if (prev.ts === 0 || delta >= 3 || chargingToggled || elapsed >= PERSIST_THROTTLE_MS) {
        lastPersistedRef.current = { level: pct, charging: isCharging, ts: now };
        onUpdateRef.current?.(pct, isCharging);
      }
    };

    nav
      .getBattery()
      .then((bat) => {
        if (cancelled) return;
        manager = bat;
        setSupported(true);
        handleChange();
        bat.addEventListener('levelchange', handleChange);
        bat.addEventListener('chargingchange', handleChange);
      })
      .catch(() => {
        if (!cancelled) {
          setSupported(false);
        }
      });

    return () => {
      cancelled = true;
      if (manager) {
        manager.removeEventListener('levelchange', handleChange);
        manager.removeEventListener('chargingchange', handleChange);
      }
    };
  }, []);

  if (!supported || levelPercent === null) {
    return (
      <span
        title="Device Battery API unavailable in this browser"
        className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 whitespace-nowrap"
      >
        <Battery className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <span>N/A</span>
      </span>
    );
  }

  const isLow = levelPercent <= 20 && !charging;
  const isModerate = levelPercent <= 40 && !charging;

  const badgeTone = charging
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : isLow
      ? 'border-red-200 bg-red-50 text-red-900'
      : isModerate
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  const Icon = charging
    ? BatteryCharging
    : isLow
      ? BatteryWarning
      : isModerate
        ? BatteryLow
        : Battery;

  return (
    <span
      title={`Device battery: ${levelPercent}%${charging ? ' (Charging)' : ' (Discharging)'}`}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums whitespace-nowrap ${badgeTone}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{levelPercent}%</span>
      {charging ? <span className="hidden md:inline font-medium">· Charging</span> : null}
    </span>
  );
}
