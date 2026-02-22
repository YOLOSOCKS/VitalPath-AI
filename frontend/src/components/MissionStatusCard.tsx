import React, { useMemo, useState, useEffect } from 'react';
import type { OrganPlanSummary } from './panels/MissionDetailsPanel';
import MissionDetailsPanel from './panels/MissionDetailsPanel';

type MissionState = 'IDLE' | 'EN ROUTE' | 'ALERT' | 'CRITICAL';

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

const STATE_STYLES: Record<MissionState, { label: string; className: string }> = {
  IDLE: { label: 'IDLE', className: 'text-gray-400 border-gray-500/40 bg-gray-500/10' },
  'EN ROUTE': { label: 'EN ROUTE', className: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  ALERT: { label: 'ALERT', className: 'text-amber-400 border-amber-500/50 bg-amber-500/10' },
  CRITICAL: { label: 'CRITICAL', className: 'text-red-400 border-red-500/50 bg-red-500/10' },
};

export interface MissionStatusCardProps {
  organPlan: OrganPlanSummary | null;
  isRedAlert: boolean;
  etaRemainingS?: number | null;
  tripProgressPercent?: number;
  liveRisk?: any;
  liveAlerts?: any[] | null;
}

export default function MissionStatusCard({
  organPlan,
  isRedAlert,
  etaRemainingS,
  tripProgressPercent,
  liveRisk,
  liveAlerts,
}: MissionStatusCardProps) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [entered, setEntered] = useState(false);

  const missionState: MissionState = useMemo(() => {
    const risk = liveRisk?.overall ?? organPlan?.risk_status;
    if (risk === 'critical') return 'CRITICAL';
    if (isRedAlert) return 'ALERT';
    if (organPlan) return 'EN ROUTE';
    return 'IDLE';
  }, [organPlan, isRedAlert, liveRisk?.overall]);

  const stateStyle = STATE_STYLES[missionState];
  const etaDisplay =
    etaRemainingS != null && etaRemainingS >= 0
      ? formatEta(etaRemainingS)
      : organPlan?.eta_total_s != null
        ? formatEta(organPlan.eta_total_s)
        : '--:--';

  // Smooth enter: apply visible class after mount
  useEffect(() => {
    if (!overlayOpen) {
      setEntered(false);
      return;
    }
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, [overlayOpen]);

  // Escape to close
  useEffect(() => {
    if (!overlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlayOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlayOpen]);

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[2] flex flex-col items-center">
      {/* Expandable overlay: backdrop + panel anchored below card */}
      {overlayOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[3] bg-black/20 backdrop-blur-[2px] transition-opacity duration-200"
            style={{ opacity: entered ? 1 : 0 }}
            onClick={() => setOverlayOpen(false)}
            aria-label="Close mission summary"
          />
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 z-[4] mt-2 w-[320px] max-h-[70vh] overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all duration-200 ease-out pointer-events-auto"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? 'translate(-50%, 0)' : 'translate(-50%, -8px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <MissionDetailsPanel
              plan={organPlan}
              tripProgressPercent={tripProgressPercent}
              liveRisk={liveRisk}
              liveAlerts={liveAlerts}
              isOpen={true}
              onToggle={() => setOverlayOpen(false)}
              className="rounded-2xl"
            />
          </div>
        </>
      )}

      {/* Clickable status card */}
      <button
        type="button"
        onClick={() => setOverlayOpen(true)}
        className="w-[200px] text-left rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_4px_20px_rgba(0,0,0,0.35)] overflow-hidden transition-all duration-300 pointer-events-auto cursor-pointer hover:border-white/20 hover:bg-black/50 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:ring-offset-2 focus:ring-offset-transparent"
        aria-label="Mission status — click to open full summary"
      >
        <div className="px-3 py-2 border-b border-white/5">
          <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">Mission Status</span>
          <div className="mt-1">
            <span
              className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase transition-colors duration-300 ${stateStyle.className}`}
            >
              {stateStyle.label}
            </span>
          </div>
        </div>
        <div className="px-3 py-2 space-y-1.5 text-[10px] font-mono">
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 uppercase">Organ</span>
            <span className="text-white truncate capitalize">{organPlan?.organ_type ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 uppercase">Mode</span>
            <span className="text-red-300 capitalize">{organPlan?.transport_mode ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 uppercase">ETA</span>
            <span className="text-white tabular-nums font-semibold">{etaDisplay}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 uppercase">Risk</span>
            <span className={`capitalize font-semibold ${
              (liveRisk?.overall ?? organPlan?.risk_status) === 'critical' ? 'text-red-400' :
              (liveRisk?.overall ?? organPlan?.risk_status) === 'high' ? 'text-orange-400' :
              (liveRisk?.overall ?? organPlan?.risk_status) === 'medium' ? 'text-amber-400' :
              'text-emerald-400'
            }`}>
              {liveRisk?.overall ?? organPlan?.risk_status ?? '—'}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}
