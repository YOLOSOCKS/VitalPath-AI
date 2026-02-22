import React from 'react';

// Organ Transport scenario data — spoken phrases use ElevenLabs TTS
const ORGAN_TRANSPORT_PHRASE = "Unit 22, organ transport protocol initiated. Priority routing to transplant center. Maintain temperature integrity and sterile containment.";
const CARGO_ALERT_PHRASE = "Cargo alert. Vital organ integrity compromised. AI assistant rerouting. Priority escalation in progress.";
const BLOOD_RUN_PHRASE = "Blood run confirmed. Standard medical logistics route active. Estimated arrival on schedule.";

// REAL-WORLD DMV AREA SCENARIO DATA
const SCENARIOS = {
  "CARDIAC_ARREST": {
    title: "CARDIAC ARREST // UNIT 992",
    isRedAlert: true,
    spokenPhrase: ORGAN_TRANSPORT_PHRASE,
    // Start: DC center
    start: { lat: 38.9072, lng: -77.0369 },
    // End: Howard University Hospital
    end: { lat: 38.9185, lng: -77.0195 },
    aiPrompt: "URGENT: 65yo Male, Cardiac Arrest. Route to Howard University Hospital immediately.",
    vitals: { hr: 0, bp: "0/0", o2: 45 },
  },
  "MVA_TRAUMA": {
    title: "MVA TRAUMA // CAPITOL HILL",
    isRedAlert: true,
    spokenPhrase: CARGO_ALERT_PHRASE,
    // Start: Union Station area
    start: { lat: 38.8977, lng: -77.0065 },
    // End: Georgetown University Hospital
    end: { lat: 38.9114, lng: -77.0726 },
    aiPrompt: "CRITICAL: Multi-vehicle accident on Capitol Hill. Multiple trauma patients. Route to Georgetown University Hospital. Avoid congestion using side-street pivots.",
    vitals: { hr: 115, bp: "90/60", o2: 92 },
  },
  "BLOOD_RUN": {
    title: "BLOOD RUN // ROUTINE",
    isRedAlert: false,
    spokenPhrase: BLOOD_RUN_PHRASE,
    start: { lat: 38.9072, lng: -77.0369 },
    end: { lat: 38.9185, lng: -77.0195 },
    aiPrompt: "Routine blood run. Standard medical logistics. Maintain cold chain.",
    vitals: { hr: 72, bp: "120/80", o2: 98 },
  },
};

export default function ScenarioInjector({ onInject }: { onInject: (s: any) => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 p-2 bg-black/90 border border-white/20 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <div className="px-3 py-1 text-[9px] text-cyan-500/50 font-mono font-bold tracking-widest border-r border-white/10 uppercase">
        Tactical Injections
      </div>

      <div className="flex gap-2 px-2">
        {Object.entries(SCENARIOS).map(([key, data]) => (
          <button
            key={key}
            onClick={() => onInject(data)}
            className={`px-4 py-1.5 text-[10px] font-mono font-bold rounded-lg border transition-all duration-300 transform hover:scale-105 active:scale-95 ${data.isRedAlert
              ? 'border-red-500/40 text-red-500 bg-red-500/5 hover:bg-red-500 hover:text-white shadow-[0_0_15px_rgba(239,68,68,0.2)]'
              : 'border-cyan-500/40 text-cyan-400 bg-cyan-500/5 hover:bg-cyan-500 hover:text-white shadow-[0_0_15px_rgba(0,240,255,0.2)]'
              }`}
          >
            {key.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="px-3 py-1 text-[8px] text-gray-500 font-mono italic animate-pulse">
        Ready for Uplink...
      </div>
    </div>
  );
}