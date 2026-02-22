import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Maximize2, Minimize2, X } from 'lucide-react';
import AlgoRaceCharts, { type TelemetryPoint } from './AlgoRaceCharts';
import AlgoBenchmarkCharts from './AlgoBenchmarkCharts';

export interface AlgoRaceData {
  dijkstraCoords: [number, number][];
  dijkstraExecMs: number;
  dijkstraExplored: [number, number][][];
  dijkstraTotalDistM?: number;
  dijkstraTotalTimeS?: number;
  dijkstraExploredCount?: number;

  bmssspCoords: [number, number][];
  bmssspExecMs: number;
  bmssspExplored: [number, number][][];
  bmssspTotalDistM?: number;
  bmssspTotalTimeS?: number;
  bmssspExploredCount?: number;

  closurePoints: [number, number][];

  // Optional: faint background network segments for the minimap (helps show "streets" even before animation)
  networkEdges?: [number, number][][];
}

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export type BenchmarkState = {
  running: boolean;
  trials: number;
  done: number;
  dTimesMs: number[];
  bTimesMs: number[];
  errorCount: number;
};

type Phase = 'loading' | 'exploring' | 'routing' | 'done';

export default function AlgoRaceMiniMap({
  data,
  visible,
  benchmark,
  onRunBenchmark,
  onExpandedChange,
}: {
  data: AlgoRaceData | null;
  visible: boolean;
  benchmark?: BenchmarkState | null;
  onRunBenchmark?: (trials?: number) => void;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const animRef = useRef<number | null>(null);
  const loopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  const phaseRef = useRef<Phase>('loading');

  const [phase, setPhase] = useState<Phase>('loading');
  const [dijkDone, setDijkDone] = useState(false);
  const [bmDone, setBmDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // Lightweight time-series for "terminal" charts in expanded view.
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const telemetryLastSampleMsRef = useRef<number>(0);

  const safeSetPhase = (p: Phase) => {
    if (phaseRef.current !== p) {
      phaseRef.current = p;
      setPhase(p);
    }
  };

  // Reset expansion when hidden; notify parent so other windows can restore
  useEffect(() => {
    if (!visible) {
      setExpanded(false);
      onExpandedChange?.(false);
    }
  }, [visible, onExpandedChange]);

  // Derived stats (safe even when data is null)
  const stats = useMemo(() => {
    if (!data) return null;

    const dExploredFull = data.dijkstraExploredCount ?? data.dijkstraExplored.length;
    const bExploredFull = data.bmssspExploredCount ?? data.bmssspExplored.length;

    const dExec = Math.max(1, Number(data.dijkstraExecMs || 0));
    const bExec = Math.max(1, Number(data.bmssspExecMs || 0));

    const maxExec = Math.max(dExec, bExec, 1);

    const dDistKm = (data.dijkstraTotalDistM ?? 0) / 1000;
    const bDistKm = (data.bmssspTotalDistM ?? 0) / 1000;

    const dEta = data.dijkstraTotalTimeS ?? 0;
    const bEta = data.bmssspTotalTimeS ?? 0;

    const delta = (dExec - bExec) / dExec; // + means bmsssp faster

    return {
      dExec,
      bExec,
      maxExec,
      dExploredFull,
      bExploredFull,
      dDistKm,
      bDistKm,
      dEta,
      bEta,
      delta,
    };
  }, [data]);

  // Initialize / destroy map
  useEffect(() => {
    if (!visible || !containerRef.current) return;

    setMapReady(false);

    // Clean up a previous map if any (defensive)
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const m = new maplibregl.Map({
      container: containerRef.current,
      // Slightly more detailed basemap than the old "nolabels" one.
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-77.0369, 38.9072], // DMV area (DC center)
      zoom: 12,
      interactive: false,
      attributionControl: false,
    });

    mapRef.current = m;

    m.on('load', () => {
      // Background network (faint)
      m.addSource('vitalpath-ai-network', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates: [] },
        },
      });
      m.addLayer({
        id: 'vitalpath-ai-network-lines',
        type: 'line',
        source: 'vitalpath-ai-network',
        paint: {
          'line-color': 'rgba(220, 220, 220, 0.18)',
          'line-width': 1,
        },
      });

      // Dijkstra explored edges
      m.addSource('dijkstra-explore', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates: [] },
        },
      });
      m.addLayer({
        id: 'dijkstra-explore-line',
        type: 'line',
        source: 'dijkstra-explore',
        paint: {
          'line-color': '#3B82F6',
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });

      // BMSSSP explored edges
      m.addSource('bmsssp-explore', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates: [] },
        },
      });
      m.addLayer({
        id: 'bmsssp-explore-line',
        type: 'line',
        source: 'bmsssp-explore',
        paint: {
          'line-color': '#A855F7',
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });

      // Dijkstra route
      m.addSource('dijkstra-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });
      m.addLayer({
        id: 'dijkstra-route-line',
        type: 'line',
        source: 'dijkstra-route',
        paint: {
          'line-color': '#3B82F6',
          'line-width': 4,
          'line-opacity': 1,
        },
      });

      // BMSSSP route
      m.addSource('bmsssp-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });
      m.addLayer({
        id: 'bmsssp-route-line',
        type: 'line',
        source: 'bmsssp-route',
        paint: {
          'line-color': '#A855F7',
          'line-width': 4,
          'line-opacity': 1,
        },
      });

      // Road closures
      m.addSource('closures', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: 'closures-circle',
        type: 'circle',
        source: 'closures',
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': 6,
          'circle-opacity': 0.85,
        },
      });

      safeSetPhase('loading');
      setMapReady(true);
    });

    return () => {
      // Cancel animation + loop
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;

      // Remove map instance
      try {
        m.remove();
      } catch {
        // ignore
      }
      mapRef.current = null;
      setMapReady(false);
    };
  }, [visible]);

  // Resize the existing map smoothly when expanding/collapsing
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    let raf: number | null = null;
    const t0 = performance.now();
    const tick = () => {
      if (!mapRef.current) return;
      mapRef.current.resize();
      if (performance.now() - t0 < 350) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [expanded]);

  // Fit bounds + set static layers whenever data changes
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapReady || !data) return;

    // Update closures
    const closureFeatures = (data.closurePoints || []).map((c) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: c },
    }));

    const closureSource = m.getSource('closures') as maplibregl.GeoJSONSource | undefined;
    if (closureSource) {
      closureSource.setData({ type: 'FeatureCollection', features: closureFeatures as any });
    }

    // Update faint network
    const net = (data.networkEdges || []) as any;
    const netSource = m.getSource('vitalpath-ai-network') as maplibregl.GeoJSONSource | undefined;
    if (netSource) {
      netSource.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: net },
      } as any);
    }

    // Fit bounds around both candidate paths
    const all = [...(data.dijkstraCoords || []), ...(data.bmssspCoords || [])];
    if (all.length >= 2) {
      const lons = all.map((p) => p[0]);
      const lats = all.map((p) => p[1]);
      const minLng = Math.min(...lons);
      const maxLng = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const bounds = new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
      m.fitBounds(bounds, {
        padding: expanded ? 80 : 30,
        duration: 650,
      });
    }

    // Clear any previous race drawings
    const clearMulti = (id: string) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates: [] },
        } as any);
      }
    };
    const clearLine = (id: string) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        } as any);
      }
    };

    clearMulti('dijkstra-explore');
    clearMulti('bmsssp-explore');
    clearLine('dijkstra-route');
    clearLine('bmsssp-route');

    setDijkDone(false);
    setBmDone(false);
    safeSetPhase('loading');
    setTelemetry([]);
    telemetryLastSampleMsRef.current = 0;
  }, [data, expanded]);

  // Animation loop (auto-repeats while visible)
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapReady || !data) return;

    // Cancel any existing animation
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
    loopTimeoutRef.current = null;

    const dijkExplored = data.dijkstraExplored || [];
    const bmExplored = data.bmssspExplored || [];

    const dijkRoute = data.dijkstraCoords || [];
    const bmRoute = data.bmssspCoords || [];

    // If an algorithm has no explored edges, skip exploration phase for that side.
    const dHasExplore = dijkExplored.length > 0;
    const bHasExplore = bmExplored.length > 0;

    const dExec = Math.max(1, Number(data.dijkstraExecMs || 0));
    const bExec = Math.max(1, Number(data.bmssspExecMs || 0));

    // Total animation time scaled by the *slower* algorithm, to keep the race readable.
    const totalAnim = clamp(Math.max(dExec, bExec) * 10, 4200, 14000);

    const dTotalAnim = totalAnim * (dExec / Math.max(dExec, bExec));
    const bTotalAnim = totalAnim * (bExec / Math.max(dExec, bExec));

    const explorePct = 0.40; // earlier route start = less "it starts late" feel

    const dExploreTime = dHasExplore ? dTotalAnim * explorePct : 0;
    const bExploreTime = bHasExplore ? bTotalAnim * explorePct : 0;

    const dRouteTime = dTotalAnim - dExploreTime;
    const bRouteTime = bTotalAnim - bExploreTime;

    const srcDExplore = () => m.getSource('dijkstra-explore') as maplibregl.GeoJSONSource | undefined;
    const srcBExplore = () => m.getSource('bmsssp-explore') as maplibregl.GeoJSONSource | undefined;
    const srcDRoute = () => m.getSource('dijkstra-route') as maplibregl.GeoJSONSource | undefined;
    const srcBRoute = () => m.getSource('bmsssp-route') as maplibregl.GeoJSONSource | undefined;

    const setExplore = (src: maplibregl.GeoJSONSource | undefined, segs: any[]) => {
      if (!src) return;
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: segs },
      } as any);
    };

    const setRoute = (src: maplibregl.GeoJSONSource | undefined, coords: any[]) => {
      if (!src) return;
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      } as any);
    };

    // Reset state
    setDijkDone(false);
    setBmDone(false);
    safeSetPhase('exploring');
    setTelemetry([]);
    telemetryLastSampleMsRef.current = 0;
    startTimeRef.current = performance.now();
    lastUpdateRef.current = 0;

    const updateEveryMs = expanded ? 33 : 66; // throttle for mini view
    const telemetryEveryMs = expanded ? 200 : 999999; // only sample telemetry in expanded mode

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;

      // Throttle expensive geojson updates
      if (elapsed - lastUpdateRef.current >= updateEveryMs) {
        lastUpdateRef.current = elapsed;

        // Track progress counts (for charts)
        let dExploreIdx = dHasExplore ? dijkExplored.length : 0;
        let bExploreIdx = bHasExplore ? bmExplored.length : 0;
        let dRouteIdx = 0;
        let bRouteIdx = 0;

        // Dijkstra
        if (elapsed < dExploreTime) {
          const t = dExploreTime > 0 ? elapsed / dExploreTime : 1;
          dExploreIdx = Math.floor(t * dijkExplored.length);
          setExplore(srcDExplore(), dijkExplored.slice(0, dExploreIdx));
        } else {
          // Exploration finished for Dijkstra
          if (!dijkDone) {
            setExplore(srcDExplore(), dHasExplore ? dijkExplored : []);
          }
          const tRoute = dRouteTime > 0 ? (elapsed - dExploreTime) / dRouteTime : 1;
          dRouteIdx = Math.floor(clamp(tRoute, 0, 1) * dijkRoute.length);
          setRoute(srcDRoute(), dijkRoute.slice(0, dRouteIdx));
        }

        // BMSSSP
        if (elapsed < bExploreTime) {
          const t = bExploreTime > 0 ? elapsed / bExploreTime : 1;
          bExploreIdx = Math.floor(t * bmExplored.length);
          setExplore(srcBExplore(), bmExplored.slice(0, bExploreIdx));
        } else {
          if (!bmDone) {
            setExplore(srcBExplore(), bHasExplore ? bmExplored : []);
          }
          const tRoute = bRouteTime > 0 ? (elapsed - bExploreTime) / bRouteTime : 1;
          bRouteIdx = Math.floor(clamp(tRoute, 0, 1) * bmRoute.length);
          setRoute(srcBRoute(), bmRoute.slice(0, bRouteIdx));
        }

        // Sample telemetry for charts (keep it light)
        if (elapsed - telemetryLastSampleMsRef.current >= telemetryEveryMs) {
          telemetryLastSampleMsRef.current = elapsed;
          const dRoutePct = dijkRoute.length > 0 ? clamp(dRouteIdx / Math.max(1, dijkRoute.length), 0, 1) : 0;
          const bRoutePct = bmRoute.length > 0 ? clamp(bRouteIdx / Math.max(1, bmRoute.length), 0, 1) : 0;
          const point: TelemetryPoint = {
            t: Math.round((elapsed / 1000) * 10) / 10,
            dExplored: dExploreIdx,
            bExplored: bExploreIdx,
            dRoutePct,
            bRoutePct,
          };
          setTelemetry((prev) => {
            const next = [...prev, point];
            return next.length > 140 ? next.slice(next.length - 140) : next;
          });
        }
      }

      // Phase tracking (only update when it changes)
      const allDone = elapsed >= Math.max(dTotalAnim, bTotalAnim);
      const inExplore = elapsed < Math.max(dExploreTime, bExploreTime);
      safeSetPhase(allDone ? 'done' : inExplore ? 'exploring' : 'routing');

      if (elapsed >= dTotalAnim) setDijkDone(true);
      if (elapsed >= bTotalAnim) setBmDone(true);

      if (!allDone) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        // Loop the race (judges love repeatability)
        loopTimeoutRef.current = setTimeout(() => {
          // Clear routes/explores and restart
          setExplore(srcDExplore(), []);
          setExplore(srcBExplore(), []);
          setRoute(srcDRoute(), []);
          setRoute(srcBRoute(), []);
          setDijkDone(false);
          setBmDone(false);
          safeSetPhase('exploring');
          setTelemetry([]);
          telemetryLastSampleMsRef.current = 0;
          startTimeRef.current = performance.now();
          lastUpdateRef.current = 0;
          animRef.current = requestAnimationFrame(tick);
        }, 1100);
      }
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    };
  }, [data, expanded]);

  if (!visible) return null;

  // Expanded view should be an overlapping panel (NOT full-screen) so judges can still see the live map + UI.
  const wrapperClass = expanded
    ? 'fixed right-6 top-24 z-[100] w-[min(1000px,60vw)] h-[min(720px,75vh)]'
    : 'absolute bottom-20 right-4 z-50';

  const shellClass = expanded
    ? 'w-full h-full'
    : 'w-64 h-40';

  const isLoading =
    !data ||
    ((data.dijkstraCoords?.length || 0) === 0 &&
      (data.bmssspCoords?.length || 0) === 0 &&
      (data.dijkstraExplored?.length || 0) === 0 &&
      (data.bmssspExplored?.length || 0) === 0);

  return (
    <div className={wrapperClass}>
      <div className={`relative ${shellClass} bg-black/85 backdrop-blur-xl border border-blue-500/20 rounded-lg shadow-[0_0_30px_rgba(59,130,246,0.20)] overflow-hidden transition-all duration-300`}>
        {/* Controls */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
          {!expanded ? (
            <button
              className="p-1 rounded border border-white/10 bg-black/60 hover:bg-black/80 text-gray-200"
              title="Expand (Bloomberg view)"
              onClick={() => {
                setExpanded(true);
                onExpandedChange?.(true);
              }}
            >
              <Maximize2 size={14} />
            </button>
          ) : (
            <>
              <button
                className="p-1 rounded border border-white/10 bg-black/60 hover:bg-black/80 text-gray-200"
                title="Minimize"
                onClick={() => {
                  setExpanded(false);
                  onExpandedChange?.(false);
                }}
              >
                <Minimize2 size={14} />
              </button>
              <button
                className="p-1 rounded border border-white/10 bg-black/60 hover:bg-black/80 text-gray-200"
                title="Close"
                onClick={() => {
                  setExpanded(false);
                  onExpandedChange?.(false);
                }}
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className={expanded ? 'grid grid-cols-12 w-full h-full' : 'w-full h-full'}>
          {/* Map */}
          <div className={expanded ? 'col-span-8 relative' : 'relative w-full h-full'}>
            <div ref={containerRef} className="absolute inset-0" />

            {/* Loading overlay (shows immediately while API requests are in-flight) */}
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <div className="px-3 py-2 rounded bg-black/70 border border-white/10 text-[10px] font-mono text-gray-200">
                  LOADING ROUTE RACE…
                </div>
              </div>
            )}

            {/* Mini overlay status */}
            <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-black/60 border border-white/10 text-[10px] font-mono text-blue-300">
              {mapReady ? phase.toUpperCase() : 'LOADING MAP…'}
            </div>

            {/* If data is still loading, show a subtle hint */}
            {!data && (
              <div className="absolute top-8 left-2 z-10 px-2 py-1 rounded bg-black/50 border border-white/10 text-[10px] font-mono text-gray-200">
                Loading race data…
              </div>
            )}

            {/* legend */}
            <div className="absolute bottom-2 left-2 z-10 text-[9px] font-mono text-gray-200 bg-black/60 border border-white/10 rounded px-2 py-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-[2px] bg-blue-400" /> DIJKSTRA
                <span className="inline-block w-3 h-[2px] bg-fuchsia-400 ml-2" /> DUAN–MAO
              </div>
            </div>

            {/* winner badges */}
            <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1">
              <div
                className={`px-2 py-1 rounded text-[9px] font-mono border ${dijkDone ? 'bg-blue-500/20 border-blue-400/40 text-blue-200' : 'bg-white/5 border-white/10 text-gray-400'}`}
              >
                DIJKSTRA {dijkDone ? '✓' : ''}
              </div>
              <div
                className={`px-2 py-1 rounded text-[9px] font-mono border ${bmDone ? 'bg-fuchsia-500/20 border-fuchsia-400/40 text-fuchsia-200' : 'bg-white/5 border-white/10 text-gray-400'}`}
              >
                DUAN–MAO {bmDone ? '✓' : ''}
              </div>
            </div>
          </div>

          {/* Bloomberg-style stats */}
          {expanded && stats && (
            <div className="col-span-4 border-l border-white/10 bg-black/70 p-3 flex flex-col gap-3 overflow-y-auto">
              <div>
                <div className="text-[10px] font-mono text-blue-400 uppercase tracking-wider">VitalPath AI Algo Terminal</div>
                <div className="text-[12px] font-mono text-gray-100">Routing Engine Race</div>
              </div>


              {/* KPI header row */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/10 bg-white/5 px-2 py-2">
                  <div className="text-[9px] font-mono text-gray-400">WINNER</div>
                  <div className="text-[12px] font-mono text-gray-100">
                    {stats.dExec <= stats.bExec ? <span className="text-blue-300">DIJKSTRA</span> : <span className="text-fuchsia-300">DUAN–MAO</span>}
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-white/5 px-2 py-2">
                  <div className="text-[9px] font-mono text-gray-400">SPEEDUP</div>
                  <div className="text-[12px] font-mono text-gray-100">
                    {(() => {
                      const fast = Math.min(stats.dExec, stats.bExec);
                      const slow = Math.max(stats.dExec, stats.bExec);
                      const who = stats.dExec <= stats.bExec ? 'Dijk' : 'Duan';
                      const ratio = slow / Math.max(1, fast);
                      return (
                        <span className="text-yellow-300">
                          {ratio.toFixed(2)}x <span className="text-gray-400">({who})</span>
                        </span>
                      );
                    })()}
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-white/5 px-2 py-2">
                  <div className="text-[9px] font-mono text-gray-400">EXPLORED Δ</div>
                  <div className="text-[12px] font-mono text-gray-100">
                    {(() => {
                      const d = Math.max(1, stats.dExploredFull);
                      const b = Math.max(1, stats.bExploredFull);
                      const pct = (1 - b / d) * 100;
                      const good = pct >= 0;
                      return (
                        <span className={good ? 'text-green-300' : 'text-red-300'}>
                          {good ? '-' : '+'}{Math.abs(pct).toFixed(0)}%
                        </span>
                      );
                    })()}
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-white/5 px-2 py-2">
                  <div className="text-[9px] font-mono text-gray-400">ETA Δ</div>
                  <div className="text-[12px] font-mono text-gray-100">
                    {(() => {
                      const d = stats.dEta || 0;
                      const b = stats.bEta || 0;
                      const delta = d - b; // + means Duan is faster
                      const good = delta >= 0;
                      const abs = Math.abs(delta);
                      const mm = Math.floor(abs / 60);
                      const ss = Math.floor(abs % 60);
                      const s = `${mm}:${ss.toString().padStart(2, '0')}`;
                      return <span className={good ? 'text-green-300' : 'text-red-300'}>{good ? '-' : '+'}{s}</span>;
                    })()}
                  </div>
                </div>
              </div>

              <div className="border-t border-white/10" />

              <div className="grid grid-cols-5 gap-2 text-[10px] font-mono">
                <div className="text-gray-400 col-span-2">METRIC</div>
                <div className="text-blue-300 text-center">DIJK</div>
                <div className="text-purple-300 text-center">DUAN</div>
                <div className="text-gray-400 text-center">Δ</div>

                <div className="text-gray-400 col-span-2">EXEC</div>
                <div className="text-blue-200 text-center">{fmtMs(stats.dExec)}</div>
                <div className="text-fuchsia-200 text-center">{fmtMs(stats.bExec)}</div>
                <div className="text-gray-200 text-center">{pct(stats.delta)}</div>

                <div className="text-gray-400 col-span-2">EXPLORED</div>
                <div className="text-blue-200 text-center">{stats.dExploredFull.toLocaleString()}</div>
                <div className="text-fuchsia-200 text-center">{stats.bExploredFull.toLocaleString()}</div>
                <div className="text-gray-200 text-center">—</div>

                <div className="text-gray-400 col-span-2">DIST</div>
                <div className="text-blue-200 text-center">{stats.dDistKm ? `${stats.dDistKm.toFixed(2)} km` : '—'}</div>
                <div className="text-fuchsia-200 text-center">{stats.bDistKm ? `${stats.bDistKm.toFixed(2)} km` : '—'}</div>
                <div className="text-gray-200 text-center">—</div>

                <div className="text-gray-400 col-span-2">ETA</div>
                <div className="text-blue-200 text-center">{stats.dEta ? formatEta(stats.dEta) : '—'}</div>
                <div className="text-fuchsia-200 text-center">{stats.bEta ? formatEta(stats.bEta) : '—'}</div>
                <div className="text-gray-200 text-center">—</div>
              </div>

              <div className="border-t border-white/10" />

              {/* Execution bar chart */}
              <div className="flex flex-col gap-2">
                <div className="text-[10px] font-mono text-gray-300">Execution (relative)</div>
                <div className="flex flex-col gap-2">
                  <div>
                    <div className="flex items-center justify-between text-[9px] font-mono text-blue-200">
                      <span>DIJKSTRA</span>
                      <span>{fmtMs(stats.dExec)}</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded">
                      <div
                        className="h-2 bg-blue-400/70 rounded"
                        style={{ width: `${(stats.dExec / stats.maxExec) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[9px] font-mono text-fuchsia-200">
                      <span>DUAN–MAO</span>
                      <span>{fmtMs(stats.bExec)}</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded">
                      <div
                        className="h-2 bg-fuchsia-400/70 rounded"
                        style={{ width: `${(stats.bExec / stats.maxExec) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/10" />


              {/* Benchmark mode */}
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono text-gray-300">Benchmark</div>
                <button
                  className="px-2 py-1 rounded border border-white/10 bg-black/60 hover:bg-black/80 text-[10px] font-mono text-yellow-200 disabled:opacity-50"
                  disabled={!onRunBenchmark || (benchmark?.running ?? false)}
                  onClick={() => onRunBenchmark?.(20)}
                  title="Run 20 trials (no exploration payload)"
                >
                  {(benchmark?.running ?? false) ? `RUNNING ${benchmark?.done ?? 0}/${benchmark?.trials ?? 20}` : 'RUN 20x'}
                </button>
              </div>

              {benchmark && !benchmark.running && (benchmark.dTimesMs.length > 2 || benchmark.bTimesMs.length > 2) && (
                <AlgoBenchmarkCharts dTimesMs={benchmark.dTimesMs} bTimesMs={benchmark.bTimesMs} />
              )}

              {benchmark && benchmark.running && (
                <div className="h-2 bg-white/10 rounded">
                  <div
                    className="h-2 bg-yellow-400/70 rounded"
                    style={{ width: `${Math.round(((benchmark.done || 0) / Math.max(1, benchmark.trials || 20)) * 100)}%` }}
                  />
                </div>
              )}

              <div className="border-t border-white/10" />

              {/* Eye-candy charts */}
              <AlgoRaceCharts telemetry={telemetry} dijkstraRoute={data.dijkstraCoords} bmssspRoute={data.bmssspCoords} />

              <div className="border-t border-white/10" />

              {/* Talking points for judges */}
              <div className="text-[10px] font-mono text-gray-200 leading-relaxed">
                <div className="text-blue-400 uppercase tracking-wider mb-1">Judge-friendly notes</div>
                <ul className="list-disc pl-4 space-y-1 text-gray-300">
                  <li>Dijkstra = gold-standard shortest path (priority queue based).</li>
                  <li>Duan–Mao (BM-SSSP) = optimized single-source shortest path tuned for large sparse graphs.</li>
                  <li>We animate explored edges (search footprint) + final route to show why the winner wins.</li>
                </ul>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
