import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';
import AlgoRaceMiniMap, { AlgoRaceData } from './AlgoRaceMiniMap';
import { theme } from '../styles/theme';
type LatLng = { lat: number; lng: number };

export type NavLive = {
  distance_to_next_m: number;
  next_instruction: string;
  current_street: string;
  eta_remaining_s: number;
  remaining_distance_m: number;
  algorithm?: string;
  total_distance_m?: number;
  total_time_s?: number;
  sim_speedup: number;
  /** Multi-leg trip: current leg 1-based (e.g. 1 or 2), total legs */
  trip_leg?: number;
  trip_legs?: number;
};

type NavStep = {
  id: number;
  instruction: string;
  street: string;
  start_distance_m: number;
  end_distance_m: number;
  maneuver: string;
};

// Mirrors backend app/algorithm/router.py RouteResponse
type PivotNode = { id: string; lat: number; lng: number; type: string };
type RouteResponse = {
  path_coordinates: [number, number][]; // [lng, lat]
  snapped_start?: [number, number];
  snapped_end?: [number, number];
  algorithm?: string;
  destination?: string;

  execution_time_ms?: number;
  algorithm_time_ms?: number;
  total_time_ms?: number;

  total_distance_m?: number;
  total_time_s?: number;
  cum_distance_m?: number[];
  cum_time_s?: number[];
  steps?: NavStep[];
  pivots_identified?: PivotNode[];
  narrative?: string[];

  explored_coords?: [number, number][][];
  explored_count?: number;
  network_edges_coords?: [number, number][][];
};

type AlgoStats = {
  exec_ms: number;
  eta_s: number;
  dist_m: number;
};

const api = axios.create({
  // If you set VITE_API_BASE=http://127.0.0.1:8000, this will use it.
  // Otherwise it stays relative and works with the Vite proxy (/api -> backend).
  baseURL: (import.meta as any).env?.VITE_API_BASE || '',
});

function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLng = b[0] - a[0];
  const dLat = b[1] - a[1];
  const ang = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  return (ang + 360) % 360;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function findIndexByCumTime(cumTime: number[], t: number): number {
  // linear scan is fine at hackathon scale (<10k points)
  let i = 1;
  while (i < cumTime.length && cumTime[i] < t) i++;
  return i;
}

function computeNavLive(meta: {
  totalDist: number;
  totalTime: number;
  steps: NavStep[];
  algorithm?: string;
}, traveledM: number, simTimeS: number, simSpeedup: number): NavLive {
  const remainingDist = Math.max(0, meta.totalDist - traveledM);
  const etaRemaining = Math.max(0, meta.totalTime - simTimeS);

  let currentStreet = '--';
  let nextInstruction = 'Proceed';
  let distanceToNext = 0;

  const steps = meta.steps || [];
  if (steps.length) {
    const cur = steps.find((s) => traveledM >= s.start_distance_m && traveledM < s.end_distance_m) || steps[0];
    currentStreet = cur?.street || '--';

    const next =
      steps.find((s) => s.maneuver !== 'depart' && s.start_distance_m > traveledM) ||
      (remainingDist < 15 ? undefined : cur);

    if (!next) {
      nextInstruction = 'Arrive at destination';
      distanceToNext = 0;
    } else {
      nextInstruction = next.instruction;
      distanceToNext = Math.max(0, next.start_distance_m - traveledM);
    }
  }

  return {
    distance_to_next_m: distanceToNext,
    next_instruction: nextInstruction,
    current_street: currentStreet,
    eta_remaining_s: etaRemaining,
    remaining_distance_m: remainingDist,
    algorithm: meta.algorithm,
    total_distance_m: meta.totalDist,
    total_time_s: meta.totalTime,
    sim_speedup: simSpeedup,
  };
}

// Default center: Washington DC (DMV area)
const DEFAULT_CENTER = { lat: 38.9072, lng: -77.0369 };
// Transplant centers, blood banks, distribution
const HOWARD_UNIV_HOSPITAL = { lat: 38.9185, lng: -77.0195 };
const GEORGETOWN_UNIV_HOSPITAL = { lat: 38.9114, lng: -77.0726 };
const UNION_MARKET = { lat: 38.9086, lng: -76.9873 };
// Organ transport TTS phrases (ElevenLabs)
const ORGAN_TRANSPORT_PHRASE = "Unit 22, organ transport protocol initiated. Priority routing to transplant center. Maintain temperature integrity and sterile containment.";
const BLOOD_RUN_PHRASE = "Blood run confirmed. Standard medical logistics route active. Estimated arrival on schedule.";
const CARGO_ALERT_PHRASE = "Cargo alert. Vital organ integrity compromised. AI assistant rerouting. Priority escalation in progress.";

// Scenarios define mission context (scenario_type, metadata, start/stop) only. Telemetry/risk/alerts come from backend.
const SCENARIOS: Record<string, any> = {
  ORGAN_TRANSPORT: {
    title: 'ORGAN TRANSPORT // COLD-CHAIN ACTIVE',
    scenario_type: 'ORGAN',
    spokenPhrase: ORGAN_TRANSPORT_PHRASE,
    isRedAlert: false,
    start: DEFAULT_CENTER,
    end: HOWARD_UNIV_HOSPITAL,
    destName: 'Howard University Hospital — Transplant Center',
    donor_hospital: 'georgetown',
    recipient_hospital: 'howard university hospital',
    organ_type: 'liver',
    aiPrompt: 'Life-critical organ shipment en route. Cold-chain 2–8°C monitored. Lid sealed, battery nominal. Recommend continuous monitoring; ETA within safe window.',
    patientOnBoard: true,
  },
  BLOOD_RUN: {
    title: 'BLOOD PRODUCTS // ROUTINE',
    scenario_type: 'ROUTINE',
    spokenPhrase: BLOOD_RUN_PHRASE,
    isRedAlert: false,
    start: DEFAULT_CENTER,
    waypoints: [UNION_MARKET],
    end: GEORGETOWN_UNIV_HOSPITAL,
    destName: 'Union Market Distribution → Georgetown University Hospital',
    donor_hospital: 'union market',
    recipient_hospital: 'georgetown university hospital',
    organ_type: 'default',
    aiPrompt: 'Routine blood run. Standard medical logistics. Maintain cold chain.',
    patientOnBoard: false,
  },
  CARGO_ALERT: {
    title: 'CARGO ALERT // SEAL / TEMP RISK',
    scenario_type: 'LID_BREACH',
    spokenPhrase: CARGO_ALERT_PHRASE,
    isRedAlert: true,
    start: DEFAULT_CENTER,
    end: HOWARD_UNIV_HOSPITAL,
    destName: 'Howard University Hospital — Emergency Handoff',
    donor_hospital: 'georgetown',
    recipient_hospital: 'howard university hospital',
    organ_type: 'heart',
    aiPrompt: 'CRITICAL: Container seal compromised or temperature drift detected. Assess viability; consider backup transport or expedited handoff. Do not open lid until receiving facility ready.',
    patientOnBoard: true,
  },
};

// Transport mode display (from organ plan — no address input)
const MODE_ICON: Record<string, string> = { road: '🚗', air: '✈️', hybrid: '🔀' };

export type LiveMapHandle = { injectRoadblock: () => void };

type LiveMapProps = {
  activeScenario?: any;
  organPlan?: { transport_mode?: string; eta_total_s?: number; risk_status?: string; donor_hospital?: string; recipient_hospital?: string } | null;
  onNavUpdate?: (nav: NavLive) => void;
  onScenarioInject?: (s: any) => void;
  onScenarioClear?: () => void;
  showEtaPanel?: boolean;
  onEtaPanelChange?: (open: boolean) => void;
  /** Called when vehicle is stuck at roadblock for too long (true) or when reroute is applied (false) */
  onVehicleStuck?: (stuck: boolean) => void;
  /** When true, simulation is paused (ride stopped for assist / alert) */
  simPaused?: boolean;
  /** Called when reroute request starts (roadblock detour) */
  onRerouteStart?: () => void;
  /** Called when reroute is applied and vehicle resumes */
  onRerouteComplete?: () => void;
  /** Called when algorithm race panel is expanded or collapsed */
  onAlgoRaceExpandedChange?: (expanded: boolean) => void;
  /** Called when plane/air route mode starts (OUT OF STATE) */
  onAirRouteStart?: () => void;
  /** Called when plane/air route mode ends */
  onAirRouteEnd?: () => void;
};

const STUCK_THRESHOLD_MS = 45000; // only declare "vehicle stuck" / stop ride after 45s at roadblock with no reroute

const LiveMap = forwardRef<LiveMapHandle, LiveMapProps>(function LiveMap({
  activeScenario,
  organPlan,
  onNavUpdate,
  onScenarioInject,
  onScenarioClear,
  showEtaPanel: showEtaPanelProp,
  onEtaPanelChange,
  onVehicleStuck,
  simPaused = false,
  onRerouteStart,
  onRerouteComplete,
  onAlgoRaceExpandedChange,
  onAirRouteStart,
  onAirRouteEnd,
}, ref) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ambulanceMarker = useRef<maplibregl.Marker | null>(null);
  const vehicleElRef = useRef<HTMLDivElement | null>(null);
  const destMarker = useRef<maplibregl.Marker | null>(null);


  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [currentPos, setCurrentPos] = useState<[number, number] | null>(null);

  // Live routing inputs
  const [destQuery, setDestQuery] = useState('');
  const [endPoint, setEndPoint] = useState<LatLng | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [activeWaypointIdx, setActiveWaypointIdx] = useState<number>(-1); // -1 = direct to end, 0+ = targeting waypoint i

  // Algorithm comparison
  const algoRef = useRef<'dijkstra' | 'bmsssp'>('dijkstra');
  const [algoStats, setAlgoStats] = useState<{ dijkstra?: AlgoStats; bmsssp?: AlgoStats }>({});
  const [showEtaPanelLocal, setShowEtaPanelLocal] = useState(false);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const showEtaPanel = showEtaPanelProp ?? showEtaPanelLocal;
  const setShowEtaPanel = onEtaPanelChange ? (v: boolean) => onEtaPanelChange(v) : setShowEtaPanelLocal;

  // UI feedback
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeReady, setRouteReady] = useState(false);  // route loaded, waiting for GO
  const [simRunning, setSimRunning] = useState(false);   // animation is in progress

  // Algorithm Race Mini-Map
  const [algoRaceData, setAlgoRaceData] = useState<AlgoRaceData | null>(null);

  const [showAlgoRace, setShowAlgoRace] = useState(false);
  const algoRaceReqIdRef = useRef(0);
  // Dynamic Roadblock Injection
  const [activeRoadblocks, setActiveRoadblocks] = useState<[number, number][]>([]);
  const [isRerouting, setIsRerouting] = useState(false);
  const roadblocksRef = useRef<[number, number][]>([]);
  const rerouteIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Hard-freeze flag: when true, ambulance does NOT advance past stop index
  const stoppedAtRoadblock = useRef(false);
  const roadblockStopIdx = useRef<number | null>(null); // route index where to stop
  // Pending reroute: stored here until ambulance reaches the roadblock, then applied
  const pendingRerouteRef = useRef<{ coords: [number, number][]; cumDist: number[]; cumTime: number[]; totalDist: number; totalTime: number; steps: NavStep[]; algorithm: string } | null>(null);
  const freezeStartRef = useRef<number | null>(null);
  const stuckReportedRef = useRef(false);
  const onVehicleStuckRef = useRef(onVehicleStuck);
  onVehicleStuckRef.current = onVehicleStuck;
  const simPausedRef = useRef(simPaused);
  simPausedRef.current = simPaused;
  const onRerouteStartRef = useRef(onRerouteStart);
  onRerouteStartRef.current = onRerouteStart;
  const onRerouteCompleteRef = useRef(onRerouteComplete);
  onRerouteCompleteRef.current = onRerouteComplete;
  const onAirRouteStartRef = useRef(onAirRouteStart);
  onAirRouteStartRef.current = onAirRouteStart;
  const onAirRouteEndRef = useRef(onAirRouteEnd);
  onAirRouteEndRef.current = onAirRouteEnd;

  useEffect(() => {
    simPausedRef.current = simPaused;
  }, [simPaused]);

  // When dev panel opens (from nav or in-map), fetch algo stats once; when it closes, hide algo race
  const prevShowEtaPanelRef = useRef(false);
  const buildVehicleSvg = (color: string, glow: string, mode: 'road' | 'air') => {
    if (mode === 'air') {
      return `
        <span class="map-vehicle-pulse-ring" style="position:absolute;width:68px;height:68px;margin-left:0;margin-top:0;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;border:2px solid ${glow};opacity:0.45;animation:map-vehicle-pulse 1.1s ease-in-out infinite;pointer-events:none"></span>
        <svg width="52" height="52" viewBox="0 0 512 512" style="filter: drop-shadow(0 0 20px ${glow}); position:relative; z-index:1">
          <path d="M480 192H365.71L260.61 8.07C257.79 3.11 252.57 0 246.87 0h-33.75c-5.7 0-10.92 3.11-13.74 8.07L114.29 192H0v64l128 32v96l-32 32v32l96-32 96 32v-32l-32-32v-96l128-32v-64z" fill="${color}"/>
        </svg>
      `;
    }
    return `
      <span class="map-vehicle-pulse-ring" style="position:absolute;width:56px;height:56px;margin-left:0;margin-top:0;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;border:2px solid ${color};opacity:0.35;animation:map-vehicle-pulse 2s ease-in-out infinite;pointer-events:none"></span>
      <svg id="veh" width="40" height="40" viewBox="0 0 64 64" style="filter: drop-shadow(0 0 10px ${color}); position:relative; z-index:1">
        <rect x="8" y="18" width="48" height="26" rx="6" fill="#1e293b" stroke="${color}" stroke-width="2"/>
        <path d="M44 18 L56 18 Q58 18 58 20 L58 38 L44 38 Z" fill="#0f172a" stroke="${color}" stroke-width="1.5"/>
        <path d="M46 22 L54 22 Q55 22 55 23 L55 32 L46 32 Z" fill="#38bdf8" opacity="0.5"/>
        <rect x="20" y="29" width="12" height="3" rx="1" fill="${color}"/>
        <rect x="24.5" y="25" width="3" height="11" rx="1" fill="${color}"/>
        <rect x="24" y="13" width="8" height="6" rx="2" fill="${color}" opacity="0.9"/>
        <rect x="24" y="13" width="8" height="6" rx="2" fill="${color}" opacity="0.5">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite"/>
        </rect>
        <circle cx="18" cy="44" r="5" fill="#334155" stroke="${color}" stroke-width="1.5"/>
        <circle cx="18" cy="44" r="2" fill="${color}"/>
        <circle cx="46" cy="44" r="5" fill="#334155" stroke="${color}" stroke-width="1.5"/>
        <circle cx="46" cy="44" r="2" fill="${color}"/>
      </svg>
    `;
  };

  const setVehicleMarkerMode = (mode: 'road' | 'air') => {
    if (!vehicleElRef.current) return;
    const color = mode === 'air' ? '#7c3aed' : theme.colors.primaryRedGlow;
    const glow = mode === 'air' ? '#c084fc' : theme.colors.primaryRedGlow;
    vehicleElRef.current.style.width = mode === 'air' ? '48px' : '40px';
    vehicleElRef.current.style.height = mode === 'air' ? '48px' : '40px';
    vehicleElRef.current.innerHTML = buildVehicleSvg(color, glow, mode);
  };

  useEffect(() => {
    if (showEtaPanel && !prevShowEtaPanelRef.current) fetchBothAlgoStats();
    if (!showEtaPanel) setShowAlgoRace(false);
    prevShowEtaPanelRef.current = showEtaPanel;
  }, [showEtaPanel]);

  // Escape closes dev panel (same as Mission Status overlay)
  useEffect(() => {
    if (!showEtaPanel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEtaPanel(false);
        setShowAlgoRace(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showEtaPanel]);

  // Apply a queued reroute: swap it into routeRef and unfreeze the ambulance
  const applyPendingReroute = () => {
    const pending = pendingRerouteRef.current;
    if (!pending) return;
    routeRef.current = pending;
    startTimeRef.current = performance.now();
    pendingRerouteRef.current = null;
    stoppedAtRoadblock.current = false;
    roadblockStopIdx.current = null;
    freezeStartRef.current = null;
    stuckReportedRef.current = false;
    onVehicleStuckRef.current?.(false);
    onRerouteCompleteRef.current?.();
    // Update the route line on the map
    const src = map.current?.getSource('vitalpath-route') as any;
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pending.coords } }],
      });
    }
  };

  // Autocomplete
  type Suggestion = { lat: number; lng: number; display_name: string; place_id?: string };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [outOfStateMode, setOutOfStateMode] = useState(false);
  const [outOfStateMiles, setOutOfStateMiles] = useState<{ total: number; remaining: number } | null>(null);
  const vehicleModeRef = useRef<'road' | 'air'>('road');

  // Animation refs
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const followRef = useRef<boolean>(true);
  const smoothBearingRef = useRef<number | null>(null);
  const scenarioRef = useRef<any>(null);
  const onNavUpdateRef = useRef<typeof onNavUpdate>(onNavUpdate);
  const routeAbortRef = useRef<AbortController | null>(null);
  const prevScenarioRef = useRef<any>(null);
  const prevScenarioTitleRef = useRef<string | undefined>(undefined);
  const prevPatientStatusRef = useRef<boolean | undefined>(undefined);
  const activeWaypointIdxRef = useRef(activeWaypointIdx);

  // Route meta ref (provided by backend)
  const routeRef = useRef<{
    coords: [number, number][];
    cumDist: number[];
    cumTime: number[];
    totalDist: number;
    totalTime: number;
    steps: NavStep[];
    algorithm?: string;
  } | null>(null);

  useEffect(() => {
    followRef.current = isFollowing;
  }, [isFollowing]);
  useEffect(() => {
    scenarioRef.current = activeScenario;
  }, [activeScenario]);
  useEffect(() => {
    onNavUpdateRef.current = onNavUpdate;
  }, [onNavUpdate]);

  // Sync activeWaypointIdx to ref for animation loop access without restarts
  useEffect(() => {
    activeWaypointIdxRef.current = activeWaypointIdx;
  }, [activeWaypointIdx]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: 16,
      pitch: 70,
    });

    // Vehicle marker with pulsing ring (theme red)
    const el = document.createElement('div');
    el.className = 'ambulance-marker';
    el.style.cssText = 'position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;will-change:transform';
    const red = theme.colors.primaryRedGlow;
    el.innerHTML = buildVehicleSvg(red, red, 'road');
    vehicleElRef.current = el;
    ambulanceMarker.current = new maplibregl.Marker({ element: el }).setLngLat([DEFAULT_CENTER.lng, DEFAULT_CENTER.lat]).addTo(map.current);


    map.current.on('load', () => {
      map.current?.addSource('vitalpath-route', {        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Route glow (wider, translucent) then main line (thicker + solid)
      map.current?.addLayer({
        id: 'vitalpath-route-glow',
        type: 'line',
        source: 'vitalpath-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 14, 'line-color': theme.colors.primaryRedGlow, 'line-opacity': 0.22 },
      });
      map.current?.addLayer({
        id: 'vitalpath-route-line',
        type: 'line',
        source: 'vitalpath-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 8, 'line-color': theme.colors.primaryRedGlow, 'line-opacity': 0.92 },
      });

      // Road closure markers source: outer ring + inner circle for distinct look
      map.current?.addSource('road-closures', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.current?.addLayer({
        id: 'road-closures-circle-outer',
        type: 'circle',
        source: 'road-closures',
        paint: {
          'circle-radius': 14,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': theme.colors.roadblockCircle,
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.95,
        },
      });
      map.current?.addLayer({
        id: 'road-closures-circle',
        type: 'circle',
        source: 'road-closures',
        paint: {
          'circle-radius': 10,
          'circle-color': theme.colors.roadblockCircle,
          'circle-stroke-color': theme.colors.textPrimary,
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      });
      map.current?.addLayer({
        id: 'road-closures-label',
        type: 'symbol',
        source: 'road-closures',
        layout: {
          'text-field': '✕',
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': theme.colors.textPrimary,
        },
      });

      // Don't auto-route on load — wait for user to search a destination

      // Defer 3D buildings so they don't block the initial animation
      setTimeout(() => {
        const style = map.current?.getStyle();
        if (!style) return;
        const sources = style.sources || {};
        const buildingSource = sources['openmaptiles'] ? 'openmaptiles' : (sources['carto'] ? 'carto' : null);

        if (buildingSource) {
          const labelLayerId = style.layers?.find(
            (layer) => layer.type === 'symbol' && layer.layout && (layer.layout as any)['text-field']
          )?.id;

          map.current?.addLayer(
            {
              id: '3d-buildings',
              source: buildingSource,
              'source-layer': 'building',
              type: 'fill-extrusion',
              minzoom: 15,
              paint: {
                'fill-extrusion-color': '#333',
                'fill-extrusion-height': ['get', 'render_height'],
                'fill-extrusion-base': ['get', 'render_min_height'],
                'fill-extrusion-opacity': 0.6,
              },
            },
            labelLayerId
          );
        }
      }, 1000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-route on scenario change (auto-start for dispatch scenarios)
  useEffect(() => {
    if (!map.current?.loaded()) return;

    // Clear old roadblocks on new scenario
    setActiveRoadblocks([]);
    roadblocksRef.current = [];
    stoppedAtRoadblock.current = false;
    roadblockStopIdx.current = null;

    pendingRerouteRef.current = null;
    if (rerouteIntervalRef.current) { clearInterval(rerouteIntervalRef.current); rerouteIntervalRef.current = null; }
    // Prevent full reset if this is just a status update (e.g. patient pickup)
    if (activeScenario?.title === prevScenarioTitleRef.current && activeScenario?.patientOnBoard !== prevPatientStatusRef.current) {
      prevPatientStatusRef.current = activeScenario?.patientOnBoard;
      return;
    }
    prevScenarioTitleRef.current = activeScenario?.title;
    prevPatientStatusRef.current = activeScenario?.patientOnBoard;

    // Clear road closure markers
    const closureSrc = map.current?.getSource('road-closures') as any;
    if (closureSrc) closureSrc.setData({ type: 'FeatureCollection', features: [] });

    // Trigger algorithm race mini-map for red alert scenarios
    if (activeScenario?.isRedAlert) {
      fetchAlgoRace(activeScenario);
    } else {
      setShowAlgoRace(false);
      setAlgoRaceData(null);
    }

    if (activeScenario?.end) {
      // --- Full cleanup of any previous route/animation ---
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      if (routeAbortRef.current) {
        routeAbortRef.current.abort();
        routeAbortRef.current = null;
      }
      routeRef.current = null;
      setSimRunning(false);
      setRouteReady(false);
      setRouteCoordinates([]);
      if (destMarker.current) { destMarker.current.remove(); destMarker.current = null; }
      const routeSrc = map.current?.getSource('vitalpath-route') as any;      if (routeSrc) routeSrc.setData({ type: 'FeatureCollection', features: [] });
      // --- End cleanup ---

      // Determine invalid/initial sequence
      setActiveWaypointIdx(activeScenario.waypoints ? 0 : -1);

      let targetPos = activeScenario.end;
      if (activeScenario.waypoints && activeScenario.waypoints.length > 0) {
        targetPos = activeScenario.waypoints[0];
      }

      const end = { lat: targetPos.lat, lng: targetPos.lng };
      setEndPoint(end);
      // Show destination name in search bar
      if (activeScenario.destName) setDestQuery(activeScenario.destName);
      // Use scenario start position for ambulance
      if (activeScenario.start && ambulanceMarker.current) {
        const startLng = activeScenario.start.lng;
        const startLat = activeScenario.start.lat;
        ambulanceMarker.current.setLngLat([startLng, startLat]);
        // Move camera to start position and re-enable following
        map.current?.jumpTo({ center: [startLng, startLat], zoom: 16, pitch: 70 });
        setIsFollowing(true);
        vehicleModeRef.current = 'road';
        setVehicleMarkerMode('road');
        setOutOfStateMode(false);
        onAirRouteEndRef.current?.();
        setOutOfStateMiles(null);
        smoothBearingRef.current = null;
      }
      fetchRoute(end, true);  // auto-start without pre-set closures
      return;
    }

    // Don't fetch if there's no destination
    if (endPoint) {
      fetchRoute(undefined, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScenario]);

  const fetchRoute = async (endOverride?: LatLng, autoStart = false, blockedEdges?: number[][]) => {
    try {
      setIsRouting(true);
      setRouteError(null);
      setRouteReady(false);

      // Stop any running animation
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }

      const cur = ambulanceMarker.current?.getLngLat();
      const start = cur ? { lat: cur.lat, lng: cur.lng } : { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };

      const destination = endOverride ?? endPoint;
      if (!destination) {
        setRouteError('Please enter a destination first.');
        setIsRouting(false);
        return;
      }

      // Create abort controller for this route request
      if (routeAbortRef.current) routeAbortRef.current.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      const requestBody: any = {
        start,
        end: destination,
        scenario_type: activeScenario?.title || 'ROUTINE',
        algorithm: algoRef.current,
      };
      if (blockedEdges && blockedEdges.length > 0) {
        requestBody.blocked_edges = blockedEdges;
      }

      const res = await api.post<RouteResponse>('/api/algo/calculate', requestBody, { signal: controller.signal });

      const coords = (res.data?.path_coordinates || []) as [number, number][];
      const cumDist = (res.data?.cum_distance_m || []) as number[];
      const cumTime = (res.data?.cum_time_s || []) as number[];
      const totalDist = Number(res.data?.total_distance_m ?? (cumDist.length ? cumDist[cumDist.length - 1] : 0));
      const totalTime = Number(res.data?.total_time_s ?? (cumTime.length ? cumTime[cumTime.length - 1] : 0));
      const steps = (res.data?.steps || []) as NavStep[];

      if (!coords.length || !cumDist.length || !cumTime.length) {
        throw new Error('Route meta missing (coords/cumDist/cumTime). Check backend /calculate response.');
      }

      // Put the marker ON the road network (snapped) so it's not inside buildings.
      const snapped = res.data.snapped_start;
      if (snapped && ambulanceMarker.current) {
        ambulanceMarker.current.setLngLat(snapped);
      } else if (ambulanceMarker.current) {
        ambulanceMarker.current.setLngLat(coords[0]);
      }
      // Store comparison stats for the current algorithm
      const statsEntry: AlgoStats = {
        exec_ms: Number(res.data.execution_time_ms ?? 0),
        eta_s: totalTime,
        dist_m: totalDist,
      };
      setAlgoStats((prev) => ({ ...prev, [algoRef.current]: statsEntry }));

      routeRef.current = {
        coords,
        cumDist,
        cumTime,
        totalDist,
        totalTime,
        steps,
        algorithm: res.data.algorithm,
      };
      if (vehicleModeRef.current === 'air') {
        const totalMiles = totalDist / 1609.34;
        setOutOfStateMiles({
          total: Number.isFinite(totalMiles) ? totalMiles : 0,
          remaining: Number.isFinite(totalMiles) ? totalMiles : 0,
        });
      }

      // Place a red pin at the destination
      if (map.current) {
        if (destMarker.current) destMarker.current.remove();
        const destEl = document.createElement('div');
        destEl.style.width = '32px';
        destEl.style.height = '32px';
        destEl.style.display = 'flex';
        destEl.style.alignItems = 'center';
        destEl.style.justifyContent = 'center';
        destEl.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${theme.colors.primaryRedGlow}" stroke="white" stroke-width="1.2"/>
            <circle cx="12" cy="9" r="2.5" fill="white"/>
          </svg>
        `;
        const destCoord = res.data.snapped_end || coords[coords.length - 1];
        destMarker.current = new maplibregl.Marker({ element: destEl, anchor: 'bottom' })
          .setLngLat(destCoord)
          .addTo(map.current);
      }

      // Draw route line on map (but don't start animation yet)
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        ],
      };
      const src = map.current?.getSource('vitalpath-route') as any;
      if (src) src.setData(geojson);

      // Center camera on the route
      map.current?.jumpTo({ center: (snapped || coords[0]) as any });

      // Push an initial nav state (shows distance/ETA in HUD before animation starts)
      const simSpeedup = 8;
      const initialNav = computeNavLive(
        { totalDist, totalTime, steps, algorithm: res.data.algorithm },
        0,
        0,
        simSpeedup
      );
      const scInit = scenarioRef.current;
      const numWp = scInit?.waypoints?.length ?? 0;
      if (numWp > 0) {
        initialNav.trip_legs = numWp + 1;
        initialNav.trip_leg = activeWaypointIdxRef.current < 0 ? numWp + 1 : activeWaypointIdxRef.current + 1;
      }
      onNavUpdateRef.current?.(initialNav);

      // If autoStart (e.g. dispatch scenario), begin animation immediately
      if (autoStart) {
        setRouteCoordinates(coords);
      } else {
        setRouteReady(true);  // enable GO button, wait for user click
      }    } catch (e: any) {
      // Ignore aborted requests
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return;
      console.error('Route fetch failed', e);
      setRouteError(
        e?.response?.data?.detail ||
        e?.message ||
        'Route fetch failed. Is the backend running on http://127.0.0.1:8000 ?'
      );
    } finally {
      setIsRouting(false);
    }
  };

  const startAnimation = () => {
    if (!routeRef.current) return;
    setRouteReady(false);
    setSimRunning(true);
    setRouteCoordinates(routeRef.current.coords);  // triggers the animation useEffect
  };

  const cancelRoute = () => {
    // Abort any in-flight route calculation
    if (routeAbortRef.current) {
      routeAbortRef.current.abort();
      routeAbortRef.current = null;
    }

    // Stop animation
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    // Clear all route state
    setRouteCoordinates([]);
    setRouteReady(false);
    setSimRunning(false);
    setIsRouting(false);
    setDestQuery('');
    setEndPoint(null);
    setActiveWaypointIdx(-1);
    setRouteError(null);
    setSuggestions([]);
    setShowSuggestions(false);
    routeRef.current = null;
    // Return to standby mode
    onScenarioClear?.();
    // Clear roadblock state
    setActiveRoadblocks([]);
    roadblocksRef.current = [];
    stoppedAtRoadblock.current = false;
    roadblockStopIdx.current = null;
    if (rerouteIntervalRef.current) { clearInterval(rerouteIntervalRef.current); rerouteIntervalRef.current = null; }

    // Clear destination marker
    if (destMarker.current) { destMarker.current.remove(); destMarker.current = null; }

    // Clear the route line from the map
    const src = map.current?.getSource('vitalpath-route') as any;    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  };

  // Fetch stats for both algorithms (for comparison panel)
  const fetchBothAlgoStats = async () => {
    const cur = ambulanceMarker.current?.getLngLat();
    const start = cur ? { lat: cur.lat, lng: cur.lng } : { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };
    const end = endPoint ?? (activeScenario?.end ? { lat: activeScenario.end.lat, lng: activeScenario.end.lng } : null);
    if (!end) {
      setAlgoStats({});
      return;
    }
    setIsFetchingStats(true);
    const body = {
      start,
      end,
      scenario_type: activeScenario?.title || 'ROUTINE',
    };
    try {
      const [dRes, bRes] = await Promise.all([
        api.post<RouteResponse>('/api/algo/calculate', { ...body, algorithm: 'dijkstra' }),
        api.post<RouteResponse>('/api/algo/calculate', { ...body, algorithm: 'bmsssp' }),
      ]);
      setAlgoStats({
        dijkstra: {
          exec_ms: Number(dRes.data.execution_time_ms ?? 0),
          eta_s: Number(dRes.data.total_time_s ?? 0),
          dist_m: Number(dRes.data.total_distance_m ?? 0),
        },
        bmsssp: {
          exec_ms: Number(bRes.data.execution_time_ms ?? 0),
          eta_s: Number(bRes.data.total_time_s ?? 0),
          dist_m: Number(bRes.data.total_distance_m ?? 0),
        },
      });
    } catch (e) {
      console.error('Failed to fetch comparison stats', e);
    } finally {
      setIsFetchingStats(false);
    }
  };

  // Fetch both algorithms with exploration data for the algorithm race mini-map
  // Howard University Hospital — target for cardiac arrest algo race
  const ALGO_RACE_TARGET = HOWARD_UNIV_HOSPITAL;

  const fetchAlgoRace = async (scenario: any) => {
    // Guards against stale responses if the user flips scenarios quickly.
    const reqId = ++algoRaceReqIdRef.current;

    // Show the panel immediately (so it *feels* fast) and then stream in results.
    setShowAlgoRace(true);
    setAlgoRaceData({
      dijkstraCoords: [],
      dijkstraExecMs: 0,
      dijkstraExplored: [],
      bmssspCoords: [],
      bmssspExecMs: 0,
      bmssspExplored: [],
      closurePoints: [],
      networkEdges: [],
    });

    // Always use the scenario's fixed start so paths are deterministic
    const start = scenario.start || DEFAULT_CENTER;
    const end = ALGO_RACE_TARGET;

    const body = {
      start,
      end,
      scenario_type: scenario.title || 'ROUTINE',
      include_exploration: true,
    };

    const dP = api.post<RouteResponse>('/api/algo/calculate', { ...body, algorithm: 'dijkstra' });
    const bP = api.post<RouteResponse>('/api/algo/calculate', { ...body, algorithm: 'bmsssp' });

    dP
      .then((dijkRes) => {
        if (algoRaceReqIdRef.current !== reqId) return;
        setAlgoRaceData((prev) => ({
          ...(prev || {
            dijkstraCoords: [],
            dijkstraExecMs: 0,
            dijkstraExplored: [],
            bmssspCoords: [],
            bmssspExecMs: 0,
            bmssspExplored: [],
            closurePoints: [],
            networkEdges: [],
          }),
          dijkstraCoords: dijkRes.data.path_coordinates || [],
          dijkstraExecMs: Number(dijkRes.data.execution_time_ms ?? 0),
          dijkstraExplored: dijkRes.data.explored_coords || [],
          dijkstraExploredCount: dijkRes.data.explored_count ?? (dijkRes.data.explored_coords?.length || 0),
          dijkstraTotalDistM: Number(dijkRes.data.total_distance_m ?? 0),
          dijkstraTotalTimeS: Number(dijkRes.data.total_time_s ?? 0),
          networkEdges: (prev?.networkEdges && prev.networkEdges.length) ? prev.networkEdges : (dijkRes.data.network_edges_coords || []),
        }));

        setAlgoStats((prevStats) => ({
          ...prevStats,
          dijkstra: {
            exec_ms: Number(dijkRes.data.execution_time_ms ?? 0),
            eta_s: Number(dijkRes.data.total_time_s ?? 0),
            dist_m: Number(dijkRes.data.total_distance_m ?? 0),
          },
        }));
      })
      .catch((e) => {
        console.error('AlgoRace dijkstra failed', e);
      });

    bP
      .then((bmssspRes) => {
        if (algoRaceReqIdRef.current !== reqId) return;
        setAlgoRaceData((prev) => ({
          ...(prev || {
            dijkstraCoords: [],
            dijkstraExecMs: 0,
            dijkstraExplored: [],
            bmssspCoords: [],
            bmssspExecMs: 0,
            bmssspExplored: [],
            closurePoints: [],
            networkEdges: [],
          }),
          bmssspCoords: bmssspRes.data.path_coordinates || [],
          bmssspExecMs: Number(bmssspRes.data.execution_time_ms ?? 0),
          bmssspExplored: bmssspRes.data.explored_coords || [],
          bmssspExploredCount: bmssspRes.data.explored_count ?? (bmssspRes.data.explored_coords?.length || 0),
          bmssspTotalDistM: Number(bmssspRes.data.total_distance_m ?? 0),
          bmssspTotalTimeS: Number(bmssspRes.data.total_time_s ?? 0),
          networkEdges: (prev?.networkEdges && prev.networkEdges.length) ? prev.networkEdges : (bmssspRes.data.network_edges_coords || []),
        }));

        setAlgoStats((prevStats) => ({
          ...prevStats,
          bmsssp: {
            exec_ms: Number(bmssspRes.data.execution_time_ms ?? 0),
            eta_s: Number(bmssspRes.data.total_time_s ?? 0),
            dist_m: Number(bmssspRes.data.total_distance_m ?? 0),
          },
        }));
      })
      .catch((e) => {
        console.error('AlgoRace bmsssp failed', e);
      });

    // If BOTH fail, hide the widget (otherwise keep it and show whatever we got).
    const results = await Promise.allSettled([dP, bP]);
    if (algoRaceReqIdRef.current !== reqId) return;
    const anyOk = results.some((r) => r.status === 'fulfilled');
    if (!anyOk) setShowAlgoRace(false);
  };

  // Background reroute: fetch a new route without stopping the animation.
  // Seamlessly swaps routeRef so the ambulance continues on the new path.
  const bgRerouteRef = useRef<AbortController | null>(null);
  const backgroundReroute = async (dest: LatLng, blockedEdges: number[][]) => {
    // Abort any previous background reroute in-flight
    if (bgRerouteRef.current) bgRerouteRef.current.abort();
    const controller = new AbortController();
    bgRerouteRef.current = controller;
    setIsRerouting(true);
    onRerouteStartRef.current?.();

    try {
      const cur = ambulanceMarker.current?.getLngLat();
      if (!cur) {
        setIsRerouting(false);
        return;
      }
      const start = { lat: cur.lat, lng: cur.lng };

      const requestBody: any = {
        start,
        end: dest,
        scenario_type: activeScenario?.title || 'ROUTINE',
        algorithm: algoRef.current,
      };
      if (blockedEdges.length > 0) requestBody.blocked_edges = blockedEdges;

      const res = await api.post<RouteResponse>('/api/algo/calculate', requestBody, { signal: controller.signal });

      const coords = (res.data?.path_coordinates || []) as [number, number][];
      const cumDist = (res.data?.cum_distance_m || []) as number[];
      const cumTime = (res.data?.cum_time_s || []) as number[];
      const totalDist = Number(res.data?.total_distance_m ?? 0);
      const totalTime = Number(res.data?.total_time_s ?? 0);
      const steps = (res.data?.steps || []) as NavStep[];

      if (!coords.length || !cumDist.length || !cumTime.length) {
        setIsRerouting(false);
        return;
      }

      // --- SMOOTH TRANSITION: Backtracking Logic ---
      // If the backend snaps the new start to a different road (e.g. previous intersection),
      // we must drive *back* along the old route to get there, rather than cutting through buildings.
      const m = routeRef.current;
      let stopPos: [number, number] = [cur.lng, cur.lat];
      let stopI = 0;
      if (m && roadblockStopIdx.current !== null) {
        stopI = Math.min(roadblockStopIdx.current, m.coords.length - 1);
        stopPos = m.coords[stopI];
      } else if (m) {
        stopI = clamp(findIndexByCumTime(m.cumTime, (performance.now() - startTimeRef.current) / 1000 * 8), 0, m.coords.length - 1);
        stopPos = m.coords[stopI];
      }

      const firstRoutePoint = coords[0];
      const dx = firstRoutePoint[0] - stopPos[0];
      const dy = firstRoutePoint[1] - stopPos[1];
      const gapDeg = Math.sqrt(dx * dx + dy * dy);
      const gapM = gapDeg * 111000;

      let transitionCoords: [number, number][] = [];
      let transitionDistM = 0;

      // Smart Backtracking: if gap is large (>10m) and we have route history, find path back
      if (gapM > 10 && m && stopI > 0) {
        // Search backwards in old route for a point close to firstRoutePoint
        let bestBackI = -1;
        let bestBackDist = Infinity;
        // Search back up to 50 points (approx 500-1000m)
        for (let k = stopI; k >= Math.max(0, stopI - 50); k--) {
          const p = m.coords[k];
          const d = Math.sqrt(Math.pow(p[0] - firstRoutePoint[0], 2) + Math.pow(p[1] - firstRoutePoint[1], 2)) * 111000;
          if (d < 20) { // Found a point within 20m of the new start
            bestBackI = k;
            bestBackDist = d;
            break;
          }
        }

        if (bestBackI !== -1) {
          // Found path back! Extract segment from stopI down to bestBackI
          // This segment represents driving BACKWARDS to the intersection
          const segment = m.coords.slice(bestBackI, stopI + 1).reverse();
          transitionCoords = segment;
          transitionDistM = (m.cumDist[stopI] - m.cumDist[bestBackI]);
        } else {
          // Fallback: straight line
          transitionCoords = [stopPos, firstRoutePoint];
          transitionDistM = gapM;
        }
      } else {
        // Gap small or no history: simple step
        transitionCoords = [stopPos];
        transitionDistM = gapM;
      }

      // Transition time: assume ~30 km/h (8.33 m/s) for maneuvering provided it's not instant
      const transitionTimeS = Math.max(2, transitionDistM / 8.33);

      // Prepend transition (backtracking) coords
      // Note: transitionCoords includes start (stopPos) and end (near firstRoutePoint)
      // We start cumDist/Time accumulation from 0
      const finalCoords = [...transitionCoords, ...coords];

      // Rebuild arrays
      const finalCumDist: number[] = [0];
      const finalCumTime: number[] = [0];

      // 1. Add transition segment metrics
      for (let k = 1; k < transitionCoords.length; k++) {
        const p0 = transitionCoords[k - 1];
        const p1 = transitionCoords[k];
        const d = Math.sqrt(Math.pow(p0[0] - p1[0], 2) + Math.pow(p0[1] - p1[1], 2)) * 111000;
        finalCumDist.push(finalCumDist[finalCumDist.length - 1] + d);
        // Time distr: total transition time spread by distance
        finalCumTime.push(finalCumTime[finalCumTime.length - 1] + (d / transitionDistM) * transitionTimeS);
      }
      // Ensure the last point of transition sets the base for the new route
      const baseDist = finalCumDist[finalCumDist.length - 1];
      const baseTime = finalCumTime[finalCumTime.length - 1];

      // 2. Add new route metrics
      // cumDist[0] is 0, so we just add base + d
      for (let k = 0; k < cumDist.length; k++) {
        // coords[0] is redundant if we already have it from transition, but let's keep it simple
        // actually, transition ends at 'near' firstRoutePoint.
        // Let's just append the new route arrays offset by base
        if (k === 0) continue; // skip 0 because it largely duplicates end of transition
        finalCumDist.push(baseDist + cumDist[k]);
        finalCumTime.push(baseTime + cumTime[k]);
      }

      // Fix up coords duplication
      // transitionCoords last point might be slightly diff from coords[0], but close enough.
      // We won't de-dupe strictly to avoid complex array slicing logic, the visual micro-jump <20m is fine.

      const finalTotalDist = finalCumDist[finalCumDist.length - 1];
      const finalTotalTime = finalCumTime[finalCumTime.length - 1];

      // Normalize cumTime to constant speed: this prevents jarring speed changes
      // between the backtracking transition and the new route's varying road speeds.
      // Visual speed = totalDist / totalTime applied uniformly across all segments.
      if (finalTotalDist > 0 && finalTotalTime > 0) {
        const constantSpeed = finalTotalDist / finalTotalTime; // m/s
        for (let k = 1; k < finalCumTime.length; k++) {
          finalCumTime[k] = finalCumDist[k] / constantSpeed;
        }
      }

      // QUEUE the reroute — don't apply it yet.
      // The animation tick will apply it when the ambulance reaches the roadblock.
      pendingRerouteRef.current = {
        coords: finalCoords,
        cumDist: finalCumDist,
        cumTime: finalCumTime,
        totalDist: finalTotalDist,
        totalTime: finalTotalTime,
        steps,
        algorithm: res.data.algorithm || 'dijkstra',
      };
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return;
      console.warn('Background reroute failed (ambulance continues on current route)', e?.message);
    } finally {
      setIsRerouting(false);
    }
  };

  // Inject a roadblock ahead of the ambulance on the current route
  const injectRoadblock = () => {
    if (!routeRef.current || !ambulanceMarker.current) return;
    const curLngLat = ambulanceMarker.current.getLngLat();
    const coords = routeRef.current.coords;
    const cumDist = routeRef.current.cumDist;

    // Find the closest point on the route to the ambulance
    let minD = Infinity, closestIdx = 0;
    for (let i = 0; i < coords.length; i++) {
      const dx = coords[i][0] - curLngLat.lng;
      const dy = coords[i][1] - curLngLat.lat;
      const d = dx * dx + dy * dy;
      if (d < minD) { minD = d; closestIdx = i; }
    }

    // Pick a point ~600m ahead on the route
    const targetDist = (cumDist[closestIdx] || 0) + 600;
    let aheadIdx = closestIdx;
    for (let i = closestIdx; i < cumDist.length; i++) {
      if (cumDist[i] >= targetDist) { aheadIdx = i; break; }
      aheadIdx = i;
    }
    // Don't place too close to the end
    if (aheadIdx >= coords.length - 5) aheadIdx = Math.max(closestIdx + 1, coords.length - 10);

    const blockCoord: [number, number] = [coords[aheadIdx][1], coords[aheadIdx][0]]; // [lat, lng]

    // Calculate stop point: a few route points BEFORE the roadblock
    const stopIdx = Math.max(closestIdx + 1, aheadIdx - 5);
    roadblockStopIdx.current = stopIdx;
    // FREEZE the ambulance immediately — it must not pass the stop point
    stoppedAtRoadblock.current = true;

    setActiveRoadblocks(prev => {
      const updated = [...prev, blockCoord];
      roadblocksRef.current = updated;

      // Draw markers on the main map
      const closureSrc = map.current?.getSource('road-closures') as any;
      if (closureSrc) {
        const features = updated.map(([lat, lng]) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [lng, lat] },
        }));
        closureSrc.setData({ type: 'FeatureCollection', features });
      }

      // Immediately reroute in background (ambulance will stop at roadblock while waiting)
      const dest = endPoint || (activeScenario?.end ? { lat: activeScenario.end.lat, lng: activeScenario.end.lng } : null);
      if (dest) backgroundReroute(dest, updated);

      return updated;
    });
  };

  useImperativeHandle(ref, () => ({ injectRoadblock }), [activeScenario, endPoint]);

  const handleGeocode = async (queryOverride?: string, autoStart = false) => {
    const query = queryOverride ?? destQuery;
    if (!query.trim()) return;
    try {
      setIsRouting(true);
      setRouteError(null);

      // Use autocomplete endpoint and take the first result
      const res = await api.get('/api/algo/autocomplete', { params: { q: query.trim() } });
      const results = res.data?.results || [];
      if (!results.length) {
        setRouteError('No addresses found. Try a more specific query.');
        setIsRouting(false);
        return;
      }
      const top = results[0];
      setDestQuery(top.display_name);
      const end = { lat: top.lat, lng: top.lng };
      setEndPoint(end);
      if (outOfStateMode) {
        onAirRouteStartRef.current?.(); // ensure windows minimize when plane ride begins
        vehicleModeRef.current = 'air';
        setIsFollowing(true);
        await fetchRoute(end, true); // auto-start for worldwide air request
      } else {
        await fetchRoute(end, autoStart); // loads route, enables GO
      }
    } catch (e: any) {
      console.error('Geocode failed', e);
      setRouteError(
        e?.response?.data?.detail ||
        e?.message ||
        'Geocode failed. Try a more specific address.'
      );
      setIsRouting(false);
    }
  };

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    // Cancel any previous in-flight autocomplete request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await api.get('/api/algo/autocomplete', {
        params: { q: query.trim() },        signal: controller.signal,
      });
      const results = res.data?.results || [];
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (err: any) {
      // Ignore aborted requests (user kept typing)
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  const onInputChange = (value: string) => {
    setDestQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Google Places can handle faster lookups
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 350);
  };

  const handleSelectSuggestion = async (s: Suggestion) => {
    setDestQuery(s.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
    const end = { lat: s.lat, lng: s.lng };
    setEndPoint(end);
    if (outOfStateMode) {
      onAirRouteStartRef.current?.(); // ensure windows minimize when plane ride begins
      vehicleModeRef.current = 'air';
      setIsFollowing(true);
      await fetchRoute(end, true); // auto-start for worldwide air request
    } else {
      await fetchRoute(end); // loads route, enables GO — does NOT start animation
    }
  };

  useEffect(() => {
    const onAiDispatch = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const location = detail.location as string | undefined;
      if (!location) return;
      cancelRoute();
      setOutOfStateMode(false);
      onAirRouteEndRef.current?.();
      setOutOfStateMiles(null);
      vehicleModeRef.current = 'road';
      setIsFollowing(true);
      setDestQuery(location);
      handleGeocode(location, true);
    };
    window.addEventListener('vitalpath:ai-dispatch', onAiDispatch as EventListener);
    return () => window.removeEventListener('vitalpath:ai-dispatch', onAiDispatch as EventListener);
  }, []);

  // Realistic GPS-like animation: drive the marker using backend's cum_time_s (and a speedup factor for demo).
  useEffect(() => {
    if (!routeCoordinates.length) return;

    // stop previous animation
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    const meta = routeRef.current;
    if (!meta) return;

    startTimeRef.current = performance.now();

    // start at first point
    setCurrentPos(meta.coords[0]);
    setSimRunning(true);

    const SIM_SPEEDUP = 8; // demo speed multiplier: increases how fast the vehicle progresses along the real route timebase
    const tick = () => {
      if (simPausedRef.current) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }
      const m = routeRef.current;
      if (!m || !ambulanceMarker.current || !map.current) return;

      const elapsedS = (performance.now() - startTimeRef.current) / 1000;
      const totalTime = m.totalTime || m.cumTime[m.cumTime.length - 1];
      const speed = vehicleModeRef.current === 'air'
        ? (totalTime > 0 ? Math.max(1, totalTime / 12) : SIM_SPEEDUP)
        : SIM_SPEEDUP;
      const simTimeS = elapsedS * speed;

        if (simTimeS >= totalTime) {
        const end = m.coords[m.coords.length - 1];
        ambulanceMarker.current.setLngLat(end);
        setCurrentPos(end);
        setSimRunning(false);
        // Return to standby mode
        onScenarioClear?.();
        // Clear auto-reroute on arrival
        if (rerouteIntervalRef.current) { clearInterval(rerouteIntervalRef.current); rerouteIntervalRef.current = null; }
        // Clear the route line — trip is done
        const src = map.current?.getSource('vitalpath-route') as any;        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        // final nav push
        const finalNav = computeNavLive(
          { totalDist: m.totalDist, totalTime, steps: m.steps, algorithm: m.algorithm },
          m.totalDist,
          totalTime,
          speed
        );
        const scFinal = scenarioRef.current;
        const numWpFinal = scFinal?.waypoints?.length ?? 0;
        if (numWpFinal > 0) {
          finalNav.trip_legs = numWpFinal + 1;
          finalNav.trip_leg = activeWaypointIdxRef.current < 0 ? numWpFinal + 1 : activeWaypointIdxRef.current + 1;
        }
        onNavUpdateRef.current?.(finalNav);

        // Check for waypoints logic
        const sc = scenarioRef.current;
        const currentIdx = activeWaypointIdxRef.current; // access via ref to avoid stale closure or effect restarts

        if (sc && sc.waypoints && currentIdx >= 0) {
          // Arrived at a waypoint. Wait 5s then go to next.
          setTimeout(() => {
// If this is multi-leg (e.g. Blood Run pickup) and we just finished the first leg,
            // update the scenario state to 'patientOnBoard' (cargo onboard) BEFORE routing to destination.
            if (sc.title && sc.title.includes('BLOOD') && currentIdx === 0 && onScenarioInject) {
              onScenarioInject({ ...sc, patientOnBoard: true });
            }

            const nextIdx = currentIdx + 1;
            if (nextIdx < sc.waypoints.length) {
              // Go to next waypoint
              setActiveWaypointIdx(nextIdx);
              const nextPt = sc.waypoints[nextIdx];
              setEndPoint(nextPt);
              fetchRoute(nextPt, true);
            } else {
              // Done with waypoints, go to final End
              setActiveWaypointIdx(-1); // -1 means final leg
              const finalEnd = sc.end;
              setEndPoint(finalEnd);
              fetchRoute(finalEnd, true);
            }
          }, 5000); // 5s wait
        }

        return;
      }

      const i = clamp(findIndexByCumTime(m.cumTime, simTimeS), 1, m.cumTime.length - 1);
      const t0 = m.cumTime[i - 1];
      const t1 = m.cumTime[i];
      const frac = t1 === t0 ? 0 : (simTimeS - t0) / (t1 - t0);

      const a = m.coords[i - 1];
      const b = m.coords[i];
      let pos: [number, number] = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];

      // --- ROADBLOCK HARD FREEZE ---
      // If stoppedAtRoadblock is set, clamp the ambulance at the stop point
      if (stoppedAtRoadblock.current && roadblockStopIdx.current !== null) {
        const stopI = Math.min(roadblockStopIdx.current, m.coords.length - 1);
        // Don't advance past the stop index
        if (i >= stopI) {
          pos = m.coords[stopI];
          ambulanceMarker.current.setLngLat(pos);
          setCurrentPos(pos);

          // Check if a pending reroute is ready to apply
          if (pendingRerouteRef.current) {
            applyPendingReroute();
            // Immediately re-center camera on the ambulance so it doesn't get left behind
            if (followRef.current && map.current) {
              map.current.jumpTo({ center: pos as any });
            }
          } else {
            // Freeze the sim clock at this point so it resumes correctly after reroute
            if (freezeStartRef.current == null) freezeStartRef.current = performance.now();
            const stopTime = m.cumTime[stopI] || 0;
            startTimeRef.current = performance.now() - (stopTime / SIM_SPEEDUP) * 1000;
            // If stuck too long with no reroute, notify so AI can announce backup transport
            if (!stuckReportedRef.current && freezeStartRef.current != null && (performance.now() - freezeStartRef.current) >= STUCK_THRESHOLD_MS) {
              stuckReportedRef.current = true;
              onVehicleStuckRef.current?.(true);
            }
          }
          animRef.current = requestAnimationFrame(tick);
          return;
        }
      }

      ambulanceMarker.current.setLngLat(pos);
      setCurrentPos(pos);
      freezeStartRef.current = null; // not frozen, so reset so next roadblock gets a fresh 15s

      // Trim the route line: only show the path A of the vehicle
      const remainingCoords: [number, number][] = [pos, ...m.coords.slice(i)];
      const src = map.current?.getSource('vitalpath-route') as any;      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: remainingCoords },
          }],
        });
      }

      // traveled distance for nav
      const d0 = m.cumDist[i - 1];
      const d1 = m.cumDist[i];
      const traveledM = d0 + (d1 - d0) * frac;

      // update nav panel via callback
      const nav = computeNavLive(
        { totalDist: m.totalDist, totalTime, steps: m.steps, algorithm: m.algorithm },
        traveledM,
        simTimeS,
        speed
      );
      const sc = scenarioRef.current;
      const numWaypoints = sc?.waypoints?.length ?? 0;
      if (numWaypoints > 0) {
        nav.trip_legs = numWaypoints + 1;
        nav.trip_leg = activeWaypointIdxRef.current < 0 ? numWaypoints + 1 : activeWaypointIdxRef.current + 1;
      }
      onNavUpdateRef.current?.(nav);
      if (vehicleModeRef.current === 'air') {
        const totalMiles = (nav.total_distance_m || 0) / 1609.34;
        const remainingMiles = nav.remaining_distance_m / 1609.34;
        setOutOfStateMiles({
          total: Number.isFinite(totalMiles) ? totalMiles : 0,
          remaining: Number.isFinite(remainingMiles) ? remainingMiles : 0,
        });
      }

      const rawBrg = bearingDeg(a, b);

      // Smooth bearing: exponential interpolation to avoid snappy rotation
      if (smoothBearingRef.current === null) {
        smoothBearingRef.current = rawBrg;
      } else {
        // Shortest-angle lerp
        let delta = rawBrg - smoothBearingRef.current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        smoothBearingRef.current += delta * 0.15; // lower = smoother (0.15 = very smooth)
      }
      const brg = smoothBearingRef.current;

      // Dynamic zoom/pitch for turn-awareness
      const BASE_ZOOM = 15;
      const TURN_ZOOM = 16;
      const TURN_DIST_THRESHOLD = 100; // start zooming in 100m before turn

      let targetZoom = BASE_ZOOM;
      const isApproachingTurn =
        nav.distance_to_next_m < TURN_DIST_THRESHOLD &&
        (nav.next_instruction.toLowerCase().includes('turn') || nav.next_instruction.toLowerCase().includes('onto'));

      if (isApproachingTurn) {
        const factor = 1 - (nav.distance_to_next_m / TURN_DIST_THRESHOLD);
        targetZoom = BASE_ZOOM + (TURN_ZOOM - BASE_ZOOM) * factor;
      }

      if (vehicleModeRef.current === 'air') {
        // Keep the plane centered at all times, even at high speed.
        map.current.jumpTo({
          center: pos as any,
          zoom: 5.5,
          bearing: 0,
          pitch: 0,
        });
      } else if (followRef.current) {
        map.current.easeTo({
          center: pos,
          bearing: brg,
          zoom: targetZoom,
          duration: 200,
          easing: (x) => x,
          essential: true,
        });
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
      animRef.current = null;
    };
    // Removed activeScenario and activeWaypointIdx from deps so animation doesn't restart/reset position on status updates
  }, [routeCoordinates]);

  return (
    <div className="w-full h-full relative">
      <style>{`
        @keyframes map-vehicle-pulse {
          0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.35; }
          50% { transform: translate(-50%,-50%) scale(1.15); opacity: 0.2; }
        }
      `}</style>
      <div ref={mapContainer} className="w-full h-full rounded-2xl overflow-hidden border border-white/10" />
      {/* Soft top/bottom gradients for depth */}
      <div className="absolute inset-x-0 top-0 h-28 pointer-events-none z-[1] bg-gradient-to-b from-black/50 via-black/10 to-transparent rounded-t-2xl" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-28 pointer-events-none z-[1] bg-gradient-to-t from-black/50 via-black/10 to-transparent rounded-b-2xl" aria-hidden />

      {/* Rerouting indicator (roadblock detour in progress) */}
      {isRerouting && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[2] pointer-events-none flex items-center gap-2 px-4 py-2.5 rounded-xl bg-black/60 backdrop-blur-sm border border-orange-500/40 text-orange-300 font-mono text-sm font-bold uppercase tracking-wider shadow-lg">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse" aria-hidden />
          Rerouting…
        </div>
      )}

      {/* Dev: backdrop (same as Mission Status) when panel open */}
      {showEtaPanel && (
        <button
          type="button"
          className="fixed inset-0 z-[44] bg-black/20 backdrop-blur-[2px] transition-opacity duration-200"
          onClick={() => {
            setShowEtaPanel(false);
            setShowAlgoRace(false);
          }}
          aria-label="Close dev panel"
        />
      )}

      {/* Dev panel: stays centered at ~39%; button is moved in (left) */}
      {showEtaPanel && (
        <div
          className="absolute bottom-4 left-[39%] -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
          aria-hidden
        >
          <div
            className="map-hud-panel bg-black/40 backdrop-blur-xl p-4 rounded-xl border border-white/10 min-w-[300px] flex flex-col gap-3 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] z-[45] pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Algorithm Comparison */}
            <div>
              <div className="text-[10px] text-red-400 font-mono font-bold uppercase tracking-wider mb-2">Algorithm Comparison</div>              {isFetchingStats ? (
                <div className="text-[9px] text-gray-400 font-mono animate-pulse">Fetching both routes...</div>
              ) : (
                <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
                  <div className="text-gray-500"></div>
                  <div className="text-red-300 text-center">DIJKSTRA</div>
                  <div className="text-purple-300 text-center">DUAN-MAO</div>

                  <div className="text-gray-500">EXEC</div>
                  <div className="text-red-200 text-center">{algoStats.dijkstra ? `${algoStats.dijkstra.exec_ms.toFixed(0)}ms` : '—'}</div>
                  <div className="text-purple-200 text-center">{algoStats.bmsssp ? `${algoStats.bmsssp.exec_ms.toFixed(0)}ms` : '—'}</div>

                  <div className="text-gray-500">ETA</div>
                  <div className="text-red-200 text-center">{algoStats.dijkstra ? formatEta(algoStats.dijkstra.eta_s) : '—'}</div>
                  <div className="text-purple-200 text-center">{algoStats.bmsssp ? formatEta(algoStats.bmsssp.eta_s) : '—'}</div>

                  <div className="text-gray-500">DIST</div>
                  <div className="text-red-200 text-center">{algoStats.dijkstra ? `${(algoStats.dijkstra.dist_m / 1000).toFixed(2)}km` : '—'}</div>                  <div className="text-purple-200 text-center">{algoStats.bmsssp ? `${(algoStats.bmsssp.dist_m / 1000).toFixed(2)}km` : '—'}</div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-white/10" />

            {/* Tactical Injections */}
            <div>
              <div className="text-[10px] text-red-500/60 font-mono font-bold uppercase tracking-wider mb-2">Tactical Injections</div>
              <div className="flex flex-col gap-1.5">
                {Object.entries(SCENARIOS).map(([key, data]) => {
                  const isOrganTransport = key === 'ORGAN_TRANSPORT';
                  const btnClass = isOrganTransport
                    ? 'border-blue-400 text-blue-300 bg-blue-500/20 hover:bg-blue-500/40 hover:text-white hover:border-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                    : data.isRedAlert
                      ? 'border-amber-500/40 text-amber-500 bg-amber-500/5 hover:bg-amber-500 hover:text-black hover:border-amber-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]'
                      : 'border-red-500/40 text-red-400 bg-red-500/5 hover:bg-red-500 hover:text-white shadow-[0_0_15px_var(--primary-red-glow-rgba-15)]';                  return (
                    <button
                      key={key}
                      onClick={() => {
                        onScenarioInject?.({ ...data });
                        if (data.isRedAlert) fetchAlgoRace(data);
                      }}
                      className={`w-full text-left px-3 py-2 text-[10px] font-mono font-bold rounded-lg border transition-all duration-300 hover:scale-[1.02] active:scale-95 ${btnClass}`}
                    >
                      {key.replace(/_/g, ' ')}
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    onAirRouteStartRef.current?.(); // close windows first, before any other state changes
                    setOutOfStateMode(true);
                    setIsFollowing(true);
                    vehicleModeRef.current = 'air';
                    setVehicleMarkerMode('air');
                    smoothBearingRef.current = null;
                    setOutOfStateMiles(null);
                    onScenarioClear?.();
                    cancelRoute();
                  }}
                  className="w-full text-left px-3 py-2 text-[10px] font-mono font-bold rounded-lg border transition-all duration-300 hover:scale-[1.02] active:scale-95 border-purple-500/50 text-purple-300 bg-purple-500/10 hover:bg-purple-500 hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.25)]"
                >
                  OUT OF STATE REQUEST
                </button>
                {outOfStateMode && (
                  <div className="mt-1 rounded-lg border border-purple-500/30 bg-purple-950/20 p-2">
                    <div className="text-[9px] text-purple-300 font-mono uppercase tracking-wider mb-1">Worldwide Destination</div>
                    <div className="mb-2 inline-flex items-center gap-2 text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-purple-500/40 bg-purple-500/10 text-purple-200">
                      ✈ AIR ROUTE ACTIVE
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={destQuery}
                        onChange={(e) => onInputChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleGeocode(); }}
                        placeholder="Enter any address worldwide..."
                        className="flex-1 bg-transparent border border-purple-500/30 rounded px-2 py-1 text-[10px] font-mono text-purple-100 placeholder-purple-400/40 focus:outline-none focus:ring-1 focus:ring-purple-400/60"
                      />
                      <button
                        onClick={() => {
                          vehicleModeRef.current = 'air';
                          handleGeocode();
                        }}
                        disabled={isRouting}
                        className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded border transition-all ${
                          isRouting
                            ? 'border-purple-500/20 text-purple-400/40 bg-purple-500/10'
                            : 'border-purple-500/60 text-purple-200 bg-purple-500/20 hover:bg-purple-500 hover:text-white'
                        }`}
                      >
                        REQUEST
                      </button>
                    </div>
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="mt-2 max-h-32 overflow-y-auto border border-purple-500/20 rounded bg-black/50">
                        {suggestions.map((s, idx) => (
                          <button
                            key={`${s.display_name}-${idx}`}
                            onClick={() => handleSelectSuggestion(s)}
                            className="w-full text-left px-2 py-1 text-[10px] text-purple-100 hover:bg-purple-500/20"
                          >
                            {s.display_name}
                          </button>
                        ))}
                      </div>
                    )}
                    {outOfStateMiles && (
                      <div className="mt-2 text-[9px] font-mono text-purple-200/80">
                        <div>Total: {outOfStateMiles.total.toFixed(1)} mi</div>
                        <div>Remaining: {outOfStateMiles.remaining.toFixed(1)} mi</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/10" />
          </div>
        </div>
      )}

      {/* Algorithm Race Mini-Map (bottom-right) */}
      <AlgoRaceMiniMap data={algoRaceData} visible={showAlgoRace} onExpandedChange={onAlgoRaceExpandedChange} />
    </div>
  );
});

export default LiveMap;