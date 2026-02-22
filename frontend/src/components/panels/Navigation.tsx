import React, { useState, useEffect } from 'react';
import type { NavLive } from '../Map';

const glassCardBase = 'bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_4px_24px_rgba(0,0,0,0.28)] overflow-hidden';
const glassCardInner = 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]';
const panelTitleClass = 'text-red-400 font-mono text-sm font-bold tracking-widest uppercase drop-shadow-[0_0_8px_var(--primary-red-glow-rgba-20)]';

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function formatDistance(meters: number): { value: string; unit: string } {
  if (meters >= 1000) {
    return { value: (meters / 1000).toFixed(1), unit: 'km' };
  }
  return { value: Math.round(meters).toString(), unit: 'm' };
}

export default function Navigation({
  className,
  activeScenario,
  navData,
}: {
  className?: string;
  activeScenario?: any;
  navData?: NavLive | null;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isRedAlert, setRedAlert] = useState(false);

  useEffect(() => {
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    const check = () => setRedAlert(body.classList.contains('red-alert'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  const rawDistance = navData ? navData.distance_to_next_m : 0;
  const dist = formatDistance(rawDistance);
  const nextTurn = navData?.next_instruction || 'AWAITING ROUTE';
  const street = navData?.current_street || '--';
  const eta = navData ? formatEta(navData.eta_remaining_s) : '--:--';
  const remainingKm = navData ? (navData.remaining_distance_m / 1000).toFixed(2) : '--';
  const sim = navData ? `SIM x${navData.sim_speedup}` : '';

  const arrow =
    nextTurn.toUpperCase().includes('U-TURN') || nextTurn.toUpperCase().includes('U TURN')
      ? '⤴'
      : nextTurn.toUpperCase().includes('RIGHT')
        ? '↱'
        : nextTurn.toUpperCase().includes('LEFT')
          ? '↰'
          : '↑';

  const alertBorder = isRedAlert ? 'glass-mission-card--alert border-amber-500/50' : '';

  return (
    <div
      onClick={() => setIsOpen(!isOpen)}
      className={`glass-mission-card ${glassCardBase} ${glassCardInner} flex flex-col cursor-pointer transition-all duration-300 hover:bg-white/5 ${alertBorder} ${className} ${isOpen ? 'min-h-0' : 'h-12 shrink-0'}`}
    >
      <div className="h-12 shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className={panelTitleClass}>
          NAV // ROUTE TO DESTINATION
        </h2>
        <span className="text-gray-500 text-[10px] font-mono">{isOpen ? '▼' : '▲'}</span>
      </div>

      {isOpen && (
        <div className="p-5 flex flex-col justify-between flex-1 min-h-0 overflow-y-auto space-y-3">
          <div className="flex flex-col items-center justify-center my-2">
            <div className="text-4xl text-white font-bold tracking-tighter drop-shadow-[0_0_15px_rgba(0,240,255,0.3)]">
              {dist.value}
              <span className="text-lg text-gray-500 ml-1">{dist.unit}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="text-2xl text-red-400 font-bold">{arrow}</div>
              <div className="text-sm text-red-300 font-mono font-bold text-center max-w-[220px] leading-tight">
                {nextTurn}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex justify-between items-center">
              <div>
                <div className="text-[10px] text-gray-500 font-mono uppercase">Current Road</div>
                <div className="text-sm text-white font-mono font-bold">{street}</div>
                <div className="text-[9px] text-gray-500 font-mono mt-1">Remaining: {remainingKm} km</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-gray-500 font-mono">ETA</div>
                <div className={`text-xl font-mono font-bold ${activeScenario?.isRedAlert ? 'text-amber-400' : 'text-green-400'} animate-pulse`}>
                  {eta}
                </div>
                <div className="text-[9px] text-gray-500 font-mono mt-1">{sim}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
