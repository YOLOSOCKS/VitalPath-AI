import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import LiveMap from './components/Map';
import WelcomeScreen from './components/WelcomeScreen';
import AIAssistant from './components/panels/AIAssistant';
import PatientVitals from './components/panels/PatientVitals';
import Navigation from './components/panels/Navigation';
import HospitalInfo from './components/panels/HospitalInfo';
import { type OrganPlanSummary } from './components/panels/MissionDetailsPanel';
import MissionStatusCard from './components/MissionStatusCard';
import FloatingModule, { type ModuleSlot } from './components/FloatingModule';
import EventInjectionPanel, { type InjectedEvent, type ScenarioEventType } from './components/EventInjectionPanel';
import AITransparency from './pages/AITransparency';

const api = axios.create({ baseURL: (import.meta as any).env?.VITE_API_BASE || '' });

const TELEMETRY_POLL_MS = 5000;

// Error Boundary to catch LiveMap crashes
class MapErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('LiveMap crashed:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-red-950/50 text-white font-mono p-4">
          <div className="text-red-400 text-xl mb-2">⚠ MAP CRASH</div>
          <div className="text-sm text-gray-300 max-w-md break-all">{this.state.error?.message}</div>
          <div className="text-xs text-gray-500 mt-2 max-w-md break-all whitespace-pre-wrap">{this.state.error?.stack?.slice(0, 500)}</div>
          <button onClick={() => this.setState({ hasError: false, error: null })} className="mt-4 px-3 py-1 bg-red-600 rounded text-sm">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}


// Hash-based routing: #/ai-transparency shows AI Transparency page
const getCurrentView = () => window.location.hash === '#/ai-transparency' ? 'ai-transparency' : 'dashboard';

const MODULE_IDS: ModuleSlot[] = ['ai', 'hospital', 'nav', 'vitals'];
const MODULE_LABELS: Record<ModuleSlot, string> = { ai: 'AI Assistant', hospital: 'Receiving Facility', nav: 'Navigation', vitals: 'Cargo Status' };
const MODULE_ICONS: Record<ModuleSlot, string> = { ai: '◆', hospital: '▣', nav: '◈', vitals: '◇' };

type ModuleState = { open: boolean; minimized: boolean; collapsed: boolean };
const initialModuleState = (): Record<ModuleSlot, ModuleState> =>
  MODULE_IDS.reduce((acc, id) => ({ ...acc, [id]: { open: true, minimized: false, collapsed: false } }), {} as Record<ModuleSlot, ModuleState>);

// --- MAIN APPLICATION ---
function App() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [isRedAlert, setIsRedAlert] = useState(false);
  const [activeScenario, setActiveScenario] = useState<any>(null);
  const [navData, setNavData] = useState<any>(null);
  const [time, setTime] = useState(new Date());
  const [audioError, setAudioError] = useState(false);
  const [currentView, setCurrentView] = useState<'dashboard' | 'ai-transparency'>(getCurrentView);
  const [organPlan, setOrganPlan] = useState<OrganPlanSummary | null>(null);
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const [moduleState, setModuleState] = useState<Record<ModuleSlot, ModuleState>>(initialModuleState);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [welcomeKey, setWelcomeKey] = useState(0);
  const [rideStoppedForAssist, setRideStoppedForAssist] = useState(false);
  const aiRef = useRef<any>(null);
  const mapRef = useRef<{ injectRoadblock: () => void } | null>(null);

  // Backend-driven mission: scenario provides context; telemetry/risk/alerts from API
  const [scenarioType, setScenarioType] = useState<string>('ROUTINE');
  const [missionElapsedS, setMissionElapsedS] = useState<number>(0);
  const [backendTelemetry, setBackendTelemetry] = useState<{
    temperature_c: number;
    shock_g: number;
    lid_closed: boolean;
    battery_percent: number;
    elapsed_time_s: number;
  } | null>(null);
  const [backendRisk, setBackendRisk] = useState<any>(null);
  const [backendAlerts, setBackendAlerts] = useState<any[]>([]);
  const [activeScenarioEvents, setActiveScenarioEvents] = useState<InjectedEvent[]>([]);
  const missionElapsedRef = useRef(0);
  const organPlanRef = useRef(organPlan);
  const activeEventsRef = useRef<InjectedEvent[]>([]);
  const isAirScenarioRef = useRef(false);
  missionElapsedRef.current = missionElapsedS;
  organPlanRef.current = organPlan;
  activeEventsRef.current = activeScenarioEvents;

  const setModule = (id: ModuleSlot, patch: Partial<ModuleState>) => {
    setModuleState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  };
  const setAllModulesMinimized = (minimized: boolean) => {
    setModuleState((s) =>
      MODULE_IDS.reduce((next, id) => ({ ...next, [id]: { ...s[id], minimized } }), { ...s })
    );
  };
  const toggleModule = (id: ModuleSlot) => setModule(id, { minimized: !moduleState[id].minimized });
  const minimizedOrder = MODULE_IDS.filter((id) => moduleState[id].minimized);

  // Detect when backend is not running (proxy ECONNREFUSED → 502, or network error)
  useEffect(() => {
    const onRejected = (err: any) => {
      const status = err?.response?.status;
      const msg = err?.message ? String(err.message) : '';
      if (
        err?.code === 'ECONNREFUSED' ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('Network Error') ||
        status === 502 ||
        status === 503 ||
        status === 504
      ) {
        setBackendUnreachable(true);
      }
      return Promise.reject(err);
    };
    const id = api.interceptors.response.use((r) => r, onRejected);
    return () => api.interceptors.response.eject(id);
  }, []);

  useEffect(() => {
    const handler = () => setCurrentView(getCurrentView());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('red-alert', isRedAlert);
  }, [isRedAlert]);

  // When cargo alert turns on (button or telemetry), have the AI speak and show a message
  const prevRedAlertRef = useRef(false);
  useEffect(() => {
    if (isRedAlert && !prevRedAlertRef.current) {
      prevRedAlertRef.current = true;
      const cargoAlertMessage = 'Cargo alert. Vital organ integrity at risk. Check temperature, seal, and battery. Recommend expedited handoff or backup transport.';
      aiRef.current?.speak(cargoAlertMessage).catch(() => {});
      aiRef.current?.injectSystemMessage(cargoAlertMessage, false);
    }
    if (!isRedAlert) prevRedAlertRef.current = false;
  }, [isRedAlert]);

  const assistPhrase = ' Calling another transport for assistance.';

  // When live risk worsens (e.g. to high or critical), have the AI speak and show a message. Stop the ride unless this is the cargo-alert scenario.
  const prevRiskOverallRef = useRef<string | null>(null);
  useEffect(() => {
    const overall = backendRisk?.overall;
    if (overall !== 'high' && overall !== 'critical') {
      prevRiskOverallRef.current = overall ?? null;
      return;
    }
    const prev = prevRiskOverallRef.current;
    const isCargoAlertScenario = activeScenario?.title?.toUpperCase().includes('CARGO ALERT');
    const shouldStopRide = !isCargoAlertScenario; // stop for risk unless we're in the cargo-alert scenario
    if (overall === 'critical' && prev !== 'critical') {
      prevRiskOverallRef.current = 'critical';
      setIsRedAlert(true);
      if (shouldStopRide) setRideStoppedForAssist(true);
      const base = backendRisk?.recommendation || 'Cargo risk is critical. Stop and assess; consider backup transport or expedited handoff.';
      const msg = base + assistPhrase;
      aiRef.current?.speak(msg).catch(() => {});
      aiRef.current?.injectSystemMessage(`Risk critical: ${msg}`, false);
      return;
    }
    if (overall === 'high' && prev !== 'high' && prev !== 'critical') {
      prevRiskOverallRef.current = 'high';
      setIsRedAlert(true);
      if (shouldStopRide) setRideStoppedForAssist(true);
      const base = backendRisk?.recommendation || 'Cargo risk elevated. Monitor closely and prepare contingency.';
      const msg = base + assistPhrase;
      aiRef.current?.speak(msg).catch(() => {});
      aiRef.current?.injectSystemMessage(`Risk high: ${msg}`, false);
      return;
    }
    prevRiskOverallRef.current = overall ?? null;
  }, [backendRisk, activeScenario?.title]);

  // When ETA exceeds safe window (cold-chain at risk), AI announces and calls for backup transport
  const prevEtaAlertRef = useRef(false);
  useEffect(() => {
    const hasEtaAlert = Array.isArray(backendAlerts) && backendAlerts.some((a: any) => a.id === 'eta_exceeds_window');
    if (!hasEtaAlert) {
      prevEtaAlertRef.current = false;
      return;
    }
    if (prevEtaAlertRef.current) return;
    prevEtaAlertRef.current = true;
    setRideStoppedForAssist(true);
    setIsRedAlert(true);
    const alert = backendAlerts.find((a: any) => a.id === 'eta_exceeds_window');
    const base = alert?.message || 'ETA exceeds cold-chain safe window.';
    const msg = base + assistPhrase;
    aiRef.current?.speak(msg).catch(() => {});
    aiRef.current?.injectSystemMessage(msg, false);
  }, [backendAlerts]);

  // When vehicle is stuck at roadblock too long (no reroute yet), AI announces and calls for backup transport
  const [vehicleStuck, setVehicleStuck] = useState(false);
  const prevVehicleStuckRef = useRef(false);
  useEffect(() => {
    if (!vehicleStuck || prevVehicleStuckRef.current) return;
    prevVehicleStuckRef.current = true;
    setRideStoppedForAssist(true);
    setIsRedAlert(true);
    const msg = 'Vehicle stopped at roadblock; reroute delayed or unavailable.' + assistPhrase;
    aiRef.current?.speak(msg).catch(() => {});
    aiRef.current?.injectSystemMessage(msg, false);
  }, [vehicleStuck]);
  useEffect(() => {
    if (!vehicleStuck) {
      prevVehicleStuckRef.current = false;
      setRideStoppedForAssist(false); // resume ride when reroute is applied and vehicle unstuck
    }
  }, [vehicleStuck]);

  // Mission timer: elapsed seconds while scenario is active (stops when mission ends)
  useEffect(() => {
    if (!activeScenario) return;
    const t = setInterval(() => setMissionElapsedS((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [activeScenario]);

  // Backend polling: telemetry, risk, alerts every 5s; refetch immediately when injected events change so Cargo Status updates right away
  useEffect(() => {
    if (!activeScenario) {
      setBackendTelemetry(null);
      setBackendRisk(null);
      setBackendAlerts([]);
      return;
    }
    const fetchMissionData = () => {
      const elapsed = missionElapsedRef.current;
      const type = scenarioType;
      const plan = organPlanRef.current;
      const events = activeEventsRef.current;
      const activeEventsParam = events.length > 0 ? events.map((e) => e.type).join(',') : undefined;
      const etaRemaining = plan?.eta_total_s != null ? Math.max(0, (plan.eta_total_s ?? 0) - elapsed) : undefined;
      const maxSafe = plan?.max_safe_time_s;
      const commonParams = { elapsed_s: elapsed, scenario_type: type, ...(activeEventsParam && { active_events: activeEventsParam }) };
      api.get('/api/vitalpath/telemetry', { params: commonParams })
        .then((r) => setBackendTelemetry(r.data?.telemetry ?? null))
        .catch(() => setBackendTelemetry(null));
      api.get('/api/vitalpath/risk', {
        params: { ...commonParams, eta_remaining_s: etaRemaining ?? undefined, max_safe_elapsed_s: maxSafe },
      })
        .then((r) => setBackendRisk(r.data?.evaluation ?? null))
        .catch(() => setBackendRisk(null));
      api.get('/api/vitalpath/alerts', {
        params: { ...commonParams, eta_remaining_s: etaRemaining, max_safe_elapsed_s: maxSafe },
      })
        .then((r) => setBackendAlerts(Array.isArray(r.data?.alerts) ? r.data.alerts : []))
        .catch(() => setBackendAlerts([]));
    };
    fetchMissionData();
    const interval = setInterval(fetchMissionData, TELEMETRY_POLL_MS);
    return () => clearInterval(interval);
  }, [activeScenario, scenarioType, activeScenarioEvents]);

  const handleScenarioInject = (scenario: any) => {
    isAirScenarioRef.current = false;
    setActiveScenario(scenario);
    setScenarioType(scenario.scenario_type ?? ((scenario.title || 'ROUTINE').replace(/\s*\/\/.*$/, '').trim() || 'ROUTINE'));
    setMissionElapsedS(0);
    setBackendTelemetry(null);
    setBackendRisk(null);
    setBackendAlerts([]);
    setActiveScenarioEvents([]);
    setVehicleStuck(false);
    setRideStoppedForAssist(false);

    // Auto-fetch organ transport plan (donor/recipient/organ) so we show mission details and transport mode — no address input
    const donor = scenario.donor_hospital;
    const recipient = scenario.recipient_hospital;
    const organ = scenario.organ_type || 'liver';
    if (donor && recipient) {
      api.post('/api/vitalpath/plan/organ-transport', {
        donor_hospital: donor,
        recipient_hospital: recipient,
        organ_type: organ,
      })
        .then((res) => {
          const d = res.data;
          setOrganPlan({
            donor_hospital: donor,
            recipient_hospital: recipient,
            organ_type: organ,
            transport_mode: d.transport_mode || 'road',
            risk_status: d.risk_status || 'low',
            recommendation: d.recommendation || '',
            max_safe_time_s: d.max_safe_time_s ?? 0,
            eta_total_s: d.eta_total_s ?? 0,
            alerts: d.alerts || [],
          });
        })
        .catch(() => setOrganPlan(null));
    } else {
      setOrganPlan(null);
    }

    // AI speaks the scenario line (ElevenLabs TTS). Works even when AI panel is minimized.
    const phrase = scenario.spokenPhrase ?? scenario.aiPrompt;
    if (phrase) {
      if (aiRef.current?.speak) {
        aiRef.current.speak(phrase).catch((e: any) => {
          console.error('Voice playback failed:', e);
          setAudioError(true);
        });
      } else {
        // AI panel not mounted (e.g. minimized); play TTS via API so user still hears it
        api.post<Blob>('/api/ai/speak', { message: phrase, context: 'general' }, { responseType: 'blob' })
          .then((res) => {
            if (!res.data || (res.data as Blob).size === 0) return;
            const url = URL.createObjectURL(res.data);
            const audio = new Audio(url);
            audio.play().then(() => URL.revokeObjectURL(url)).catch(() => setAudioError(true));
          })
          .catch(() => setAudioError(true));
      }
    }
    if (aiRef.current) {
      aiRef.current.injectSystemMessage(scenario.aiPrompt, false);
    }
  };

  const handleScenarioClear = () => {
    isAirScenarioRef.current = false;
    setIsRedAlert(false);
    setRideStoppedForAssist(false);
    setActiveScenario(null);
    setOrganPlan(null);
    setScenarioType('ROUTINE');
    setMissionElapsedS(0);
    setBackendTelemetry(null);
    setBackendRisk(null);
    setBackendAlerts([]);
    setActiveScenarioEvents([]);
    setVehicleStuck(false);
  };

  const handleInjectScenarioEvent = (eventType: ScenarioEventType) => {
    setActiveScenarioEvents((prev) => [...prev, { type: eventType, atElapsed: missionElapsedS }]);
    api.post('/api/vitalpath/scenario/event', {
      scenario_type: scenarioType,
      elapsed_s: missionElapsedS,
      event_type: eventType,
    }).catch(() => {});
  };

  return (
    <div className="app-shell-bg w-screen h-screen overflow-hidden flex flex-col transition-all duration-700 relative">
      {/* Layered background: vignette + grid (no layout change) */}
      <div className="app-shell-vignette absolute inset-0 z-0 pointer-events-none" aria-hidden />
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.06]"
        style={{ backgroundImage: 'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        aria-hidden
      />

      {backendUnreachable && (
        <div className="absolute top-14 left-0 right-0 z-[100] flex items-center justify-between gap-4 bg-amber-950/95 border-b border-amber-500/50 px-4 py-2 text-amber-200 font-mono text-sm">
          <span>Backend not running — API calls will fail. Start it in a separate terminal:</span>
          <code className="bg-black/40 px-2 py-1 rounded text-amber-300 text-xs whitespace-nowrap">
            cd backend && uvicorn app.main:app --reload --port 8000
          </code>
          <button onClick={() => setBackendUnreachable(false)} className="text-amber-400 hover:text-white shrink-0" aria-label="Dismiss">✕</button>
        </div>
      )}

      {currentView === 'ai-transparency' ? (
        <>
          <header className="fixed top-0 left-0 right-0 h-12 z-[99] flex items-center justify-between px-4 bg-black/25 backdrop-blur-md border-b border-white/5">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight uppercase flex items-baseline">
                <span className="text-red-500 font-bold">Vital</span>
                <span className="text-white/90 ml-0.5">Path</span>
                <span className="text-white/50 text-xs font-normal tracking-widest ml-2">// AI TRANSPARENCY</span>
              </h1>
              <nav className="flex items-center gap-1 ml-2">
                <a href="#/" onClick={(e) => { e.preventDefault(); window.location.hash = ''; setCurrentView('dashboard'); }} className="px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider text-white/80 border border-white/20 bg-white/10 hover:bg-white/20 hover:text-white">Dashboard</a>
                <a href="#/ai-transparency" onClick={(e) => { e.preventDefault(); window.location.hash = '#/ai-transparency'; setCurrentView('ai-transparency'); }} className="px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider text-red-400 border border-red-500/50 bg-red-500/10 hover:bg-red-500/20">AI Transparency</a>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right font-mono tabular-nums text-[10px]">
                <div className="text-white">{time.toLocaleTimeString([], { hour12: false })}</div>
                <div className="text-gray-500 uppercase tracking-wider">{time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
            </div>
          </header>
          <main className="flex-1 min-h-0 flex flex-col relative z-10 pt-12">
            <AITransparency />
          </main>
        </>
      ) : (
        /* Map-centric dashboard: full-viewport map, overlay header, left control bar, floating modules */
        <div className="absolute inset-0 flex flex-col">
          {/* Map as primary canvas (full viewport) */}
          <div className="absolute inset-0 z-0">
            <MapErrorBoundary>
              <LiveMap
                ref={mapRef}
                activeScenario={activeScenario}
                organPlan={organPlan}
                onNavUpdate={setNavData}
                onScenarioInject={handleScenarioInject}
                onScenarioClear={handleScenarioClear}
                showEtaPanel={showDevPanel}
                onEtaPanelChange={setShowDevPanel}
                onVehicleStuck={setVehicleStuck}
                simPaused={rideStoppedForAssist}
                onRerouteStart={() => { aiRef.current?.speak?.('Rerouting due to roadblock. Calculating alternate route.').catch(() => {}); aiRef.current?.injectSystemMessage?.('Rerouting due to roadblock. Calculating alternate route.', false); }}
                onRerouteComplete={() => { aiRef.current?.speak?.('Reroute complete. Resuming to destination.').catch(() => {}); aiRef.current?.injectSystemMessage?.('Reroute complete. Resuming to destination.', false); }}
                onAlgoRaceExpandedChange={(expanded) => {
                  setAllModulesMinimized(expanded);
                }}
                onAirRouteStart={() => {
                  isAirScenarioRef.current = true;
                  setActiveScenario({ title: 'AIR TRANSPORT', scenario_type: 'ORGAN' });
                  setScenarioType('ORGAN');
                  setMissionElapsedS(0);
                  setBackendTelemetry(null);
                  setBackendRisk(null);
                  setBackendAlerts([]);
                  setActiveScenarioEvents([]);
                  setAllModulesMinimized(true);
                }}
                onAirRouteEnd={() => {
                  if (isAirScenarioRef.current) {
                    handleScenarioClear();
                  }
                  setAllModulesMinimized(false);
                }}
              />
            </MapErrorBoundary>
            <EventInjectionPanel
              missionActive={Boolean(activeScenario)}
              missionElapsedS={missionElapsedS}
              activeEvents={activeScenarioEvents}
              onInjectEvent={handleInjectScenarioEvent}
              onInjectRoadblock={() => mapRef.current?.injectRoadblock?.()}
              scenarioType={scenarioType}
            />
            <MissionStatusCard
              organPlan={organPlan}
              isRedAlert={isRedAlert}
              etaRemainingS={navData?.eta_remaining_s}
              tripProgressPercent={
                navData?.total_distance_m != null && navData.total_distance_m > 0
                  ? ((navData.total_distance_m - navData.remaining_distance_m) / navData.total_distance_m) * 100
                  : undefined
              }
              liveRisk={backendRisk}
              liveAlerts={backendAlerts}
            />
            <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
          </div>

          {/* Compact vertical control bar (left) - icons with minimized pills beside them */}
          <nav className="fixed left-0 top-0 bottom-0 w-14 z-[100] flex flex-col bg-black/30 backdrop-blur-md border-r border-white/10" aria-label="Module access">
            <div className="flex-1 flex flex-col items-center justify-center py-8 gap-6">
              {MODULE_IDS.map((id) => (
                <div key={id} className="relative flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => toggleModule(id)}
                    className={`w-11 h-11 flex items-center justify-center rounded-xl font-mono text-xl transition-all duration-200 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-red-500/50 ${!moduleState[id].minimized ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'text-white/80 hover:text-white border border-white/20'}`}
                    aria-label={MODULE_LABELS[id]}
                    aria-pressed={!moduleState[id].minimized}
                  >
                    {MODULE_ICONS[id]}
                  </button>
                  {moduleState[id].minimized && (
                    <button
                      type="button"
                      onClick={() => setModule(id, { minimized: false })}
                      className="absolute left-full ml-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/50 backdrop-blur-xl text-red-400 font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-black/70 hover:border-red-500/40 transition-all duration-200 shadow-lg whitespace-nowrap"
                      style={{ top: '50%', transform: 'translateY(-50%)' }}
                      aria-label={`Open ${MODULE_LABELS[id]}`}
                    >
                      {MODULE_LABELS[id]}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="shrink-0 pb-8 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDevPanel((prev) => !prev)}
                className={`w-11 h-11 flex items-center justify-center rounded-xl font-mono text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 ${showDevPanel ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'text-white/80 hover:text-white border border-white/20 hover:bg-white/10'}`}
                aria-label={showDevPanel ? 'Close dev panel' : 'Open dev panel'}
                title={showDevPanel ? 'Close dev panel' : 'Open dev panel'}
              >
                ⚙ DEV
              </button>
              <button
                type="button"
                onClick={() => { setWelcomeKey((k) => k + 1); setShowWelcome(true); }}
                className="w-11 h-11 flex items-center justify-center rounded-xl font-mono text-xl transition-all duration-200 hover:bg-white/10 text-white/80 hover:text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                aria-label="Back to welcome"
                title="Back to welcome"
              >
                ←
              </button>
            </div>
          </nav>

          {/* Lightweight overlay header - above map and HUD panel */}
          <header className={`fixed top-0 left-14 right-0 h-12 z-[99] app-shell-header flex items-center justify-between px-4 bg-black/25 backdrop-blur-md border-b ${isRedAlert ? 'border-amber-500/70' : 'border-white/5'}`}>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight uppercase flex items-baseline">
                <span className="text-red-500 font-bold">Vital</span>
                <span className="text-white/90 ml-0.5">Path</span>
                <span className="text-white/50 text-xs font-normal tracking-widest ml-2">// CARGO</span>
              </h1>
              <nav className="flex items-center gap-1 ml-2">
                <a href="#/" onClick={(e) => { e.preventDefault(); window.location.hash = ''; setCurrentView('dashboard'); }} className="px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider text-red-400 border border-red-500/50 bg-red-500/10 hover:bg-red-500/20">Dashboard</a>
                <a href="#/ai-transparency" onClick={(e) => { e.preventDefault(); window.location.hash = '#/ai-transparency'; setCurrentView('ai-transparency'); }} className="px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider text-white/60 border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white/80">AI Transparency</a>
              </nav>
              {audioError && <span className="px-2 py-0.5 bg-amber-900/40 border border-amber-500 rounded text-amber-400 text-[10px] font-mono">AUDIO_BLOCKED</span>}
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
              {navData?.trip_legs != null && navData.trip_legs > 1 && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400/90">
                  Trip {navData.trip_leg ?? 1}/{navData.trip_legs}
                </span>
              )}
              <span className="font-mono text-[10px] uppercase tracking-wider">
                <span className="text-gray-500">SHIPMENT // </span>
                <span className="text-white font-normal">
                  {organPlan?.donor_hospital && organPlan?.recipient_hospital
                    ? `${organPlan.donor_hospital}, ${organPlan.recipient_hospital}`
                    : '--, --'}
                </span>
              </span>
              <span className="text-gray-500 font-mono text-[10px] uppercase tracking-wider">ETA</span>
              <span className="text-red-400 font-mono text-sm font-bold tabular-nums">
                {navData?.eta_remaining_s != null && navData.eta_remaining_s >= 0
                  ? `${Math.floor(navData.eta_remaining_s / 60)}:${String(Math.floor(navData.eta_remaining_s % 60)).padStart(2, '0')}`
                  : organPlan?.eta_total_s != null
                    ? `${Math.floor(organPlan.eta_total_s / 60)}:${String(Math.floor(organPlan.eta_total_s % 60)).padStart(2, '0')}`
                    : '--:--'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right font-mono tabular-nums text-[10px]">
                <div className="text-white">{time.toLocaleTimeString([], { hour12: false })}</div>
                <div className="text-gray-500 uppercase tracking-wider">{time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <button
                onClick={() => { const silence = new Audio(); silence.play().catch(() => {}); setIsRedAlert(!isRedAlert); setAudioError(false); }}
                className={`app-shell-status-btn px-3 py-1.5 rounded border font-mono text-xs font-medium transition-all ${isRedAlert ? 'bg-amber-600 text-amber-50 border-amber-500/70 shadow-[0_0_14px_var(--alert-amber-rgba-20)]' : 'bg-[var(--standby-bg)] text-gray-300 border-[var(--standby-border)] hover:border-white/25'}`}
              >
                {isRedAlert ? '⚠ ALERT' : 'STANDBY'}
              </button>
            </div>
          </header>

          {rideStoppedForAssist && (
            <div className="fixed left-14 right-0 top-12 z-[98] flex items-center justify-center gap-3 px-4 py-2.5 bg-red-950/95 border-b border-red-500/50 text-red-200 font-mono text-sm">
              <span className="font-bold uppercase tracking-wider">Ride stopped — backup transport requested</span>
              <button
                type="button"
                onClick={() => {
                  setRideStoppedForAssist(false);
                  setMissionElapsedS(0);
                  setVehicleStuck(false);
                  setIsRedAlert(false);
                }}
                className="px-3 py-1.5 rounded border border-red-500/60 bg-red-900/60 hover:bg-red-800/80 font-mono text-xs uppercase tracking-wider"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setRideStoppedForAssist(false)}
                className="px-3 py-1.5 rounded border border-red-500/60 bg-red-900/60 hover:bg-red-800/80 font-mono text-xs uppercase tracking-wider"
              >
                Resume
              </button>
            </div>
          )}

          {/* Floating modules (docked slots, no overlap) */}
          <FloatingModule
            id="ai"
            title={MODULE_LABELS.ai}
            slot="ai"
            open={moduleState.ai.open}
            minimized={moduleState.ai.minimized}
            collapsed={moduleState.ai.collapsed}
            onClose={() => setModule('ai', { open: false })}
            onMinimize={() => setModule('ai', { minimized: true })}
            onCollapseToggle={() => setModule('ai', { collapsed: !moduleState.ai.collapsed })}
            onRestore={() => setModule('ai', { minimized: false })}
            minimizedIndex={minimizedOrder.indexOf('ai')}
          >
            <div className="p-3">
              <AIAssistant
                ref={aiRef}
                className={`w-full transition-all duration-500 border-red-500/30 shadow-[0_0_40px_rgba(239,68,68,0.2)] ${isRedAlert ? 'shadow-[0_0_60px_rgba(234,179,8,0.4)]' : ''}`}
              />
            </div>
          </FloatingModule>
          <FloatingModule
            id="hospital"
            title={MODULE_LABELS.hospital}
            slot="hospital"
            open={moduleState.hospital.open}
            minimized={moduleState.hospital.minimized}
            collapsed={moduleState.hospital.collapsed}
            onClose={() => setModule('hospital', { open: false })}
            onMinimize={() => setModule('hospital', { minimized: true })}
            onCollapseToggle={() => setModule('hospital', { collapsed: !moduleState.hospital.collapsed })}
            onRestore={() => setModule('hospital', { minimized: false })}
            minimizedIndex={minimizedOrder.indexOf('hospital')}
          >
            <div className="p-3">
              <HospitalInfo className="w-full" />
            </div>
          </FloatingModule>
          <FloatingModule
            id="nav"
            title={MODULE_LABELS.nav}
            slot="nav"
            open={moduleState.nav.open}
            minimized={moduleState.nav.minimized}
            collapsed={moduleState.nav.collapsed}
            onClose={() => setModule('nav', { open: false })}
            onMinimize={() => setModule('nav', { minimized: true })}
            onCollapseToggle={() => setModule('nav', { collapsed: !moduleState.nav.collapsed })}
            onRestore={() => setModule('nav', { minimized: false })}
            minimizedIndex={minimizedOrder.indexOf('nav')}
          >
            <div className="p-3">
              <Navigation className="w-full" activeScenario={activeScenario} navData={navData} />
            </div>
          </FloatingModule>
          <FloatingModule
            id="vitals"
            title={MODULE_LABELS.vitals}
            slot="vitals"
            open={moduleState.vitals.open}
            minimized={moduleState.vitals.minimized}
            collapsed={moduleState.vitals.collapsed}
            onClose={() => setModule('vitals', { open: false })}
            onMinimize={() => setModule('vitals', { minimized: true })}
            onCollapseToggle={() => setModule('vitals', { collapsed: !moduleState.vitals.collapsed })}
            onRestore={() => setModule('vitals', { minimized: false })}
            minimizedIndex={minimizedOrder.indexOf('vitals')}
          >
            <div className="p-3">
              <PatientVitals
                className="w-full min-h-0"
                telemetry={backendTelemetry}
                scenarioTitle={activeScenario?.title}
                patientOnBoard={activeScenario?.patientOnBoard}
                onCargoIssueChange={setIsRedAlert}
              />
            </div>
          </FloatingModule>
        </div>
      )}

      {/* Welcome overlay: render last so it stacks on top; key forces fresh mount when reopened */}
      {showWelcome && (
        <WelcomeScreen
          key={welcomeKey}
          onComplete={() => setShowWelcome(false)}
        />
      )}
    </div>
  );
}

export default App;