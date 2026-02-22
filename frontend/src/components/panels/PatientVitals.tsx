import React, { useState, useEffect } from 'react';

const glassCardBase = 'bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_4px_24px_rgba(0,0,0,0.28)] overflow-hidden';
const glassCardInner = 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]';
const panelTitleClass = 'text-red-400 font-mono text-sm font-bold tracking-widest uppercase drop-shadow-[0_0_8px_var(--primary-red-glow-rgba-20)]';

/** Cargo telemetry from backend GET /api/vitalpath/telemetry — single source of truth */
export interface CargoTelemetry {
  temperature_c: number;
  shock_g: number;
  lid_closed: boolean;
  battery_percent: number;
  elapsed_time_s: number;
}

export default function PatientVitals({
  className,
  telemetry,
  scenarioTitle,
  patientOnBoard,
  onCargoIssueChange,
}: {
  className?: string;
  /** Backend telemetry; polled from API while mission is active. No local simulation. */
  telemetry: CargoTelemetry | null;
  scenarioTitle?: string;
  patientOnBoard?: boolean;
  /** Called when cargo indicates an issue (temp/seal/shock/battery); drives cargo alert in App */
  onCargoIssueChange?: (hasIssue: boolean) => void;
}) {
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

  const hasCargo = Boolean(scenarioTitle);
  const isEnRouteToPickup = scenarioTitle?.toUpperCase().includes('BLOOD') && !patientOnBoard;

  const temp = telemetry?.temperature_c ?? 4.5;
  const shock = telemetry?.shock_g ?? 0;
  const lidOk = telemetry?.lid_closed ?? true;
  const battery = telemetry?.battery_percent ?? 88;
  const elapsed = telemetry?.elapsed_time_s ?? 0;

  const tempOk = temp >= 2 && temp <= 8;
  const batteryOk = battery >= 50;
  const shockOk = shock <= 2;
  const hasCargoIssue = hasCargo && !isEnRouteToPickup && (!tempOk || !lidOk || !batteryOk || !shockOk);

  useEffect(() => {
    onCargoIssueChange?.(hasCargoIssue);
  }, [hasCargoIssue, onCargoIssueChange]);

  const alertBorder = isRedAlert ? 'glass-mission-card--alert border-amber-500/50' : '';

  return (
    <div className={`glass-mission-card ${glassCardBase} ${glassCardInner} flex flex-col ${alertBorder} ${className}`}>
      <div className="h-12 shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className={panelTitleClass}>Cargo Status</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-mono">{hasCargo ? 'LIVE' : 'NO SHIPMENT'}</span>
          <div className={`w-2 h-2 rounded-full ${!hasCargo ? 'bg-gray-500' : tempOk && lidOk ? 'bg-green-500' : 'bg-amber-500'}`} />
        </div>
      </div>

      <div className="p-5 flex flex-col flex-1 min-h-0 overflow-y-auto space-y-4">
        {!scenarioTitle && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <div className="text-gray-600 text-3xl mb-3">📦</div>
            <div className="text-gray-400 font-mono text-sm tracking-wider uppercase mb-1">NO ACTIVE SHIPMENT</div>
            <div className="text-gray-600 font-mono text-[10px] tracking-wide">AWAITING ASSIGNMENT</div>
          </div>
        )}

        {isEnRouteToPickup && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <div className="text-red-600 text-3xl mb-3 animate-pulse">📍</div>
            <div className="text-red-500 font-mono text-sm tracking-wider uppercase mb-1">EN ROUTE TO PICKUP</div>
            <div className="text-red-600/70 font-mono text-[10px] tracking-wide">Telemetry after cargo loaded</div>
          </div>
        )}

        {hasCargo && !isEnRouteToPickup && (
          <>
            {telemetry == null ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                <div className="text-red-500/60 text-2xl mb-2 animate-pulse">⟳</div>
                <div className="text-gray-400 font-mono text-xs uppercase tracking-wider">Loading telemetry…</div>
              </div>
            ) : (
              <>
                {!tempOk || !lidOk ? (
                  <div className="mb-3 px-3 py-1.5 bg-amber-950/40 border border-amber-500/50 rounded-lg">
                    <div className="text-amber-400 text-[10px] font-mono font-bold tracking-wider text-center">
                      Check temperature or seal — risk flagged
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div className={`border p-2 rounded ${tempOk ? 'bg-white/5 border-white/10' : 'bg-amber-950/20 border-amber-500/40'}`}>
                    <div className="text-gray-400 text-[10px] font-mono">Temperature</div>
                    <div className={`text-2xl font-mono font-bold ${tempOk ? 'text-green-400' : 'text-amber-400'}`}>{temp.toFixed(1)}°C</div>
                    <div className="text-[9px] text-gray-500">Cold-chain 2–8°C</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 p-2 rounded">
                    <div className="text-gray-400 text-[10px] font-mono">Shock</div>
                    <div className={`text-2xl font-mono font-bold ${shock > 2 ? 'text-amber-400' : 'text-red-400'}`}>{shock.toFixed(2)}g</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 p-2 rounded">
                    <div className="text-gray-400 text-[10px] font-mono">Lid seal</div>
                    <div className={`text-lg font-mono font-bold ${lidOk ? 'text-green-400' : 'text-red-400'}`}>{lidOk ? 'Sealed' : 'Open'}</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 p-2 rounded">
                    <div className="text-gray-400 text-[10px] font-mono">Battery</div>
                    <div className="text-2xl text-red-400 font-mono font-bold">{battery}%</div>
                  </div>
                </div>

                <div className="bg-white/5 p-3 rounded-xl border border-white/10 flex justify-between items-center">
                  <div>
                    <div className="text-gray-400 text-[10px] font-mono">Elapsed (transport)</div>
                    <div className="text-lg text-white font-mono">
                      {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-gray-500">Viability</div>
                    <div className={`text-xs font-mono font-bold ${tempOk && lidOk && shock <= 2 ? 'text-green-400' : 'text-amber-400'}`}>
                      {tempOk && lidOk && shock <= 2 ? 'Within spec' : 'Check'}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
