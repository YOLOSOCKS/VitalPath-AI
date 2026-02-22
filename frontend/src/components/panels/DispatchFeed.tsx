import React, { useState, useEffect, useRef } from 'react';

const ORGAN_TRANSPORT_LOGS = [
  { time: "00:00", sender: "DISPATCH", msg: "Organ shipment released from recovery. Cold-chain active." },
  { time: "00:01", sender: "SYSTEM", msg: "Route calculated to transplant center. ETA within safe window." },
  { time: "00:03", sender: "SYSTEM", msg: "Temperature 2–8°C. Lid sealed. Battery nominal." },
  { time: "00:05", sender: "DISPATCH", msg: "Traffic advisory: reroute active to maintain ETA." },
  { time: "00:08", sender: "RECEIVING", msg: "Transplant team notified. OR standing by." },
  { time: "00:10", sender: "SYSTEM", msg: "No shock events. Cargo viability within spec." },
  { time: "00:14", sender: "RECEIVING", msg: "Arrival instructions: use receiving dock, cold-chain handoff protocol." },
];

const BLOOD_RUN_PRE_PICKUP = [
  { time: "00:00", sender: "DISPATCH", msg: "Blood products ready for pickup at distribution." },
  { time: "00:01", sender: "SYSTEM", msg: "Route calculated to pickup: Union Market Distribution." },
  { time: "00:03", sender: "DISPATCH", msg: "Container pre-chilled. Seal verified." },
  { time: "00:05", sender: "SYSTEM", msg: "Traffic: moderate. ETA on schedule." },
];

const BLOOD_RUN_POST_PICKUP = [
  { time: "00:00", sender: "DISPATCH", msg: "Cargo loaded. Proceed to Georgetown University Hospital." },
  { time: "00:01", sender: "SYSTEM", msg: "Route recalculated. Cold-chain 2–8°C maintained." },
  { time: "00:04", sender: "SYSTEM", msg: "Temperature stable. No shock events." },
  { time: "00:07", sender: "RECEIVING", msg: "Blood bank notified. Handoff team ready." },
  { time: "00:10", sender: "SYSTEM", msg: "Battery sufficient for remaining leg. Seal intact." },
];

const CARGO_ALERT_LOGS = [
  { time: "00:00", sender: "SYSTEM", msg: "⚠ Alert: Temperature drift or seal compromise detected." },
  { time: "00:01", sender: "DISPATCH", msg: "Assess viability. Receiving facility notified." },
  { time: "00:03", sender: "SYSTEM", msg: "Recommend: do not open lid until handoff. Expedite if viable." },
  { time: "00:05", sender: "RECEIVING", msg: "Emergency handoff protocol activated. Stand by." },
  { time: "00:08", sender: "DISPATCH", msg: "Backup transport on standby if needed." },
];

const STANDBY_LOGS = [
  { time: "00:00", sender: "SYSTEM", msg: "System online. No active shipment." },
  { time: "00:03", sender: "SYSTEM", msg: "Road advisory: construction reported on Rhode Island Ave." },
  { time: "00:06", sender: "SYSTEM", msg: "Ready for next assignment." },
];

function getLogsForScenario(scenarioTitle?: string, patientOnBoard?: boolean) {
  if (!scenarioTitle) return STANDBY_LOGS;
  const t = scenarioTitle.toUpperCase();

  if (t.includes('ORGAN') || t.includes('COLD-CHAIN')) return ORGAN_TRANSPORT_LOGS;
  if (t.includes('CARGO ALERT') || t.includes('SEAL') || t.includes('TEMP RISK')) return CARGO_ALERT_LOGS;
  if (t.includes('BLOOD')) return patientOnBoard ? BLOOD_RUN_POST_PICKUP : BLOOD_RUN_PRE_PICKUP;

  return STANDBY_LOGS;
}

export default function DispatchFeed({ className, scenarioTitle, patientOnBoard, isOpen, onToggle }: { className?: string; scenarioTitle?: string; patientOnBoard?: boolean; isOpen?: boolean; onToggle?: () => void }) {
  const [logs, setLogs] = useState<typeof ORGAN_TRANSPORT_LOGS>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scenarioKeyRef = useRef<string | undefined>(undefined);
  const patientStatusRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (scenarioTitle !== scenarioKeyRef.current || patientOnBoard !== patientStatusRef.current) {
      scenarioKeyRef.current = scenarioTitle;
      patientStatusRef.current = patientOnBoard;
      setLogs([]);
    }

    const scenarioLogs = getLogsForScenario(scenarioTitle, patientOnBoard);
    let index = 0;
    const interval = setInterval(() => {
      if (index < scenarioLogs.length) {
        setLogs(prev => [...prev, {
          ...scenarioLogs[index],
          time: new Date().toLocaleTimeString([], { hour12: false })
        }]);
        index++;
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [scenarioTitle, patientOnBoard]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const open = isOpen ?? true;

  return (
    <div className={`bg-black/40 backdrop-blur-md border border-white/10 rounded-xl flex flex-col overflow-hidden transition-all duration-300 ${className} ${open ? 'min-h-0' : 'h-12 shrink-0'}`}>
      <div
        onClick={onToggle}
        className="h-12 shrink-0 p-3 text-cyan-400 font-mono text-sm tracking-widest uppercase border-b border-white/5 bg-white/5 flex justify-between items-center cursor-pointer hover:bg-white/5"
      >
        <span>TRANSPORT</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-green-500 animate-pulse">● LIVE</span>
          <span className="text-gray-500 text-[10px] font-mono">{open ? '▼' : '▲'}</span>
        </span>
      </div>

      {open && (
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 font-mono text-xs">
        {logs.length === 0 && (
          <div className="text-gray-600 italic">CONNECTING...</div>
        )}

        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 border-b border-white/5 pb-1">
            <span className="text-gray-500 shrink-0">[{log.time}]</span>
            <span className={`font-bold shrink-0 w-20 ${log.sender === "DISPATCH" ? "text-yellow-400" :
              log.sender === "SYSTEM" ? "text-cyan-400" :
                log.sender === "RECEIVING" ? "text-green-400" :
                  "text-orange-400"
            }`}>
              {log.sender}:
            </span>
            <span className="text-gray-300">{log.msg}</span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
