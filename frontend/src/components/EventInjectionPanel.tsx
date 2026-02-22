import React, { useState, useCallback } from 'react';

const glassCardBase =
  'bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_4px_24px_rgba(0,0,0,0.28)] overflow-hidden';

export type ScenarioEventType =
  | 'COOLING_FAILURE'
  | 'BATTERY_DROP'
  | 'ROUGH_TERRAIN'
  | 'LID_BREACH'
  | 'COMMUNICATION_LOSS';

export interface InjectedEvent {
  type: ScenarioEventType;
  atElapsed: number;
}

const EVENT_BUTTONS: { type: ScenarioEventType; label: string; title: string }[] = [
  { type: 'COOLING_FAILURE', label: 'Cooling failure', title: 'Cold-chain cooling failure (temp rise)' },
  { type: 'BATTERY_DROP', label: 'Battery drop', title: 'Power / battery drop' },
  { type: 'ROUGH_TERRAIN', label: 'Rough terrain', title: 'Rough terrain (shock spike)' },
  { type: 'LID_BREACH', label: 'Lid breach', title: 'Container lid breach' },
  { type: 'COMMUNICATION_LOSS', label: 'Comms loss', title: 'Communication loss' },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface EventInjectionPanelProps {
  missionActive: boolean;
  missionElapsedS: number;
  activeEvents: InjectedEvent[];
  onInjectEvent: (eventType: ScenarioEventType) => void;
  onInjectRoadblock?: () => void;
  scenarioType?: string;
}

export default function EventInjectionPanel({
  missionActive,
  missionElapsedS,
  activeEvents,
  onInjectEvent,
  onInjectRoadblock,
}: EventInjectionPanelProps) {
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [lastInjectTime, setLastInjectTime] = useState<number>(0);
  const DEBOUNCE_MS = 800;

  const handleInject = useCallback(
    (type: ScenarioEventType) => {
      if (!missionActive) return;
      const now = Date.now();
      if (now - lastInjectTime < DEBOUNCE_MS) return;
      setLastInjectTime(now);
      onInjectEvent(type);
      const label = EVENT_BUTTONS.find((b) => b.type === type)?.label ?? type;
      setConfirmMessage(`"${label}" injected`);
      setTimeout(() => setConfirmMessage(null), 2500);
    },
    [missionActive, onInjectEvent, lastInjectTime]
  );

  const handleRoadblock = useCallback(() => {
    if (!missionActive || !onInjectRoadblock) return;
    const now = Date.now();
    if (now - lastInjectTime < DEBOUNCE_MS) return;
    setLastInjectTime(now);
    onInjectRoadblock();
    setConfirmMessage('Road block injected');
    setTimeout(() => setConfirmMessage(null), 2500);
  }, [missionActive, onInjectRoadblock, lastInjectTime]);
  if (!missionActive) return null;

  return (
    <div
      className={`${glassCardBase} absolute bottom-4 left-1/2 -translate-x-1/2 z-[2] w-[280px] max-h-[50vh] flex flex-col pointer-events-auto`}
      aria-label="Scenario event injection"
    >
      <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-white/5">
        <h3 className="text-red-400 font-mono text-xs font-bold tracking-widest uppercase">
          Event injection
        </h3>
      </div>
      <div className="p-3 flex flex-col gap-3 overflow-y-auto">
        {confirmMessage && (
          <div className="px-2 py-1.5 rounded bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono animate-pulse">
            {confirmMessage}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {EVENT_BUTTONS.map(({ type, label, title }) => (
            <button
              key={type}
              type="button"
              onClick={() => handleInject(type)}
              title={title}
              className="px-2 py-1.5 rounded-lg border border-amber-500/30 bg-amber-950/30 text-amber-200 font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-amber-500/20 hover:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
            >
              {label}
            </button>
          ))}
          {onInjectRoadblock && (
            <button
              type="button"
              onClick={handleRoadblock}
              title="Inject a roadblock ahead of the ambulance on the current route"
              className="px-2 py-1.5 rounded-lg border border-orange-500/40 bg-orange-950/30 text-orange-200 font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-orange-500/20 hover:border-orange-500/50 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
            >
              🚧 Road block
            </button>
          )}
        </div>
        {activeEvents.length > 0 && (
          <div className="border-t border-white/10 pt-2 space-y-1">
            <div className="text-[9px] text-gray-500 font-mono uppercase">Active events</div>
            <ul className="space-y-1 max-h-24 overflow-y-auto">
              {activeEvents.map((evt, i) => (
                <li
                  key={`${evt.type}-${evt.atElapsed}-${i}`}
                  className="flex justify-between items-center text-[10px] font-mono text-amber-200/90"
                >
                  <span className="capitalize">
                    {(EVENT_BUTTONS.find((b) => b.type === evt.type)?.label ?? evt.type).toLowerCase()}
                  </span>
                  <span className="text-gray-500 tabular-nums">+{formatElapsed(evt.atElapsed)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
