# VitalPath AI — Technical Architecture & Design

This document describes the logic, data flow, and design of the VitalPath AI application (organ and critical medical cargo transport dashboard).

---

## 1. High-Level Architecture

- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS, Framer Motion, MapLibre GL JS, Axios.
- **Backend:** FastAPI (Python 3.10+), OSMnx/NetworkX for routing, Google Gemini for AI, ElevenLabs for TTS.
- **Communication:** All frontend API calls go through the Vite dev proxy: `/api/*` → `http://127.0.0.1:8000`. No CORS issues when using the proxy.

---

## 2. Frontend Structure

### 2.1 Entry and Routing

- **`main.tsx`** mounts the root `<App />`.
- **Hash-based routing:** `#/ai-transparency` shows the AI Transparency page; otherwise the dashboard is shown. `getCurrentView()` reads `window.location.hash`; `hashchange` updates `currentView` state.
- **`App.tsx`** is the single shell: it holds global state (welcome screen, scenario, nav data, organ plan, cargo alert, view) and composes the welcome screen, header, dashboard, or AI Transparency content.

### 2.2 Global State (App.tsx)

| State | Purpose |
|-------|--------|
| `showWelcome` | When true, full-screen WelcomeScreen is shown; "Begin" sets it false. |
| `isRedAlert` | Cargo alert mode: driven only by **PatientVitals** `onCargoIssueChange` (temp/lid/battery/shock), not by scenario. Toggles `body.red-alert` for yellow accent CSS. |
| `activeScenario` | Current scenario object (from Map DEV panel or ScenarioInjector): title, start/end/waypoints, donor_hospital, recipient_hospital, organ_type, aiPrompt, spokenPhrase, cargoTelemetry, patientOnBoard, etc. |
| `navData` | Live navigation data from Map: distance_to_next_m, next_instruction, current_street, eta_remaining_s, remaining_distance_m, sim_speedup. Passed to Navigation panel. |
| `organPlan` | Result of `POST /api/vitalpath/plan/organ-transport`: donor/recipient/organ, transport_mode, risk_status, recommendation, max_safe_time_s, eta_total_s, alerts. Passed to MissionDetailsPanel and Map. |
| `currentView` | `'dashboard'` or `'ai-transparency'`. |
| `backendUnreachable` | Set by Axios response interceptor on ECONNREFUSED / 502/503/504; shows banner to start backend. |
| `aiRef` | Ref to AIAssistant for `speak(text)` and `injectSystemMessage(text, shouldSpeak)`. |

### 2.3 Scenario Injection Flow

When the user selects a scenario (e.g. ORGAN_TRANSPORT, BLOOD_RUN, CARGO_ALERT) from the Map’s DEV panel or the ScenarioInjector overlay:

1. **`handleScenarioInject(scenario)`** in App:
   - Sets `activeScenario` to the chosen scenario.
   - If scenario has `donor_hospital` and `recipient_hospital`, calls **`POST /api/vitalpath/plan/organ-transport`** with donor, recipient, organ_type; response is stored in `organPlan`.
   - Gets **spoken phrase** as `scenario.spokenPhrase ?? scenario.aiPrompt`.
   - Calls **`aiRef.current.speak(phrase)`** → ElevenLabs TTS only (no static mp3). Then **`aiRef.current.injectSystemMessage(scenario.aiPrompt, false)`** to add the AI context message to the chat without speaking again.

2. **Map** receives `activeScenario` and `organPlan`. When `activeScenario` changes, a `useEffect` in Map:
   - Sets start/end (or first waypoint for multi-leg) and destination name.
   - Repositions the ambulance marker at scenario start and camera.
   - Calls **`fetchRoute(end, true)`** to load and auto-start the route.

3. **Cargo alert** is not set by scenario. It is set only when **PatientVitals** calls `onCargoIssueChange(true)` (bad temp, lid open, low battery, or high shock). App passes `setIsRedAlert` as `onCargoIssueChange` to PatientVitals.

---

## 3. Map Component (LiveMap)

**File:** `frontend/src/components/Map.tsx`

### 3.1 Responsibilities

- Render MapLibre map with OSM-style base, vehicle marker, destination marker, route line (`vitalpath-route` source), and road-closure circles.
- Geocode/autocomplete via **`GET /api/algo/geocode`** and **`GET /api/algo/autocomplete`** (Nominatim, DMV bounding box).
- Compute route via **`POST /api/algo/calculate`** with start, end, scenario_type, algorithm (dijkstra/bmsssp), optional blocked_edges.
- Run a **time-based simulation** along the route: requestAnimationFrame advances a “sim time” with speedup (e.g. 8×), interpolates position between polyline points, updates vehicle marker and remaining route line, computes current nav step and distance/ETA, and calls **`onNavUpdate(nav)`** for the Navigation panel.
- Multi-leg scenarios (e.g. BLOOD_RUN with waypoints): when the vehicle reaches a waypoint, it waits 5s then calls `fetchRoute` for the next waypoint or final end; for Blood Run it can call `onScenarioInject` with `patientOnBoard: true` after the first leg.
- **Roadblock injection:** user can add a roadblock; the sim is “frozen” at the roadblock index while a background reroute (with blocked_edges) is requested; when the new route is ready it is applied and the sim continues.
- **Algorithm Race:** optional second algorithm (e.g. BM-SSSP) can be run in parallel; AlgoRaceMiniMap shows exploration and path comparison.
- DEV panel: scenario buttons (ORGAN_TRANSPORT, BLOOD_RUN, CARGO_ALERT) and optional ETA/algo stats; clicking a scenario calls **`onScenarioInject(scenario)`** with the Map’s `SCENARIOS` entry.

### 3.2 Key Data Structures

- **Route ref:** `routeRef.current` holds `{ coords, cumDist, cumTime, totalDist, totalTime, steps, algorithm }` from the last successful `/api/algo/calculate` response.
- **Navigation:** `computeNavLive(routeMeta, traveledM, simTimeS, speedup)` returns `NavLive`: distance_to_next_m, next_instruction, current_street, eta_remaining_s, remaining_distance_m, sim_speedup.
- **Scenarios:** `SCENARIOS` (Map.tsx) defines ORGAN_TRANSPORT, BLOOD_RUN, CARGO_ALERT with start/end/waypoints, donor/recipient, aiPrompt, spokenPhrase, cargoTelemetry, patientOnBoard.

---

## 4. Backend Structure

### 4.1 API Overview

| Area | Prefix | Purpose |
|------|--------|--------|
| Algorithm | `/api/algo` | Geocode, autocomplete, calculate route (Dijkstra or BM-SSSP on OSM graph). |
| VitalPath | `/api/vitalpath` | Telemetry simulation, risk evaluation, mission log, alerts, **organ transport plan**. |
| AI | (main.py) | Chat (Gemini), speak (ElevenLabs), cargo-integrity, risk-evaluate, status. |

### 4.2 Algorithm Router (`backend/app/algorithm/router.py`)

- **Geocode:** Nominatim search with rate limiting and DMV viewbox; returns lat, lng, display_name.
- **Autocomplete:** Same Nominatim, returns a list of results.
- **Calculate route:**
  - Loads OSM graph for a bbox around start/end via OSMnx (`_load_graph_cached`).
  - Snaps start/end to nearest graph nodes.
  - Optionally removes edges near `blocked_edges` points.
  - Chooses algorithm: **Dijkstra** (NetworkX) or **BM-SSSP** (Node runner in `backend/bmssp-runner/`). Env `VITALPATH_AI_ROUTE_ALGO` (default dijkstra).
  - Builds path polyline, cumulative distance/time arrays, and **nav steps** (maneuvers: turn left/right, continue onto street name) from edge metadata and bearing changes.
  - Scenario type affects speed multiplier (e.g. trauma/critical faster).
  - Returns path_coordinates, snapped_start/end, total_distance_m, total_time_s, cum_distance_m, cum_time_s, steps; optionally explored_coords and network_edges_coords for AlgoRace.

### 4.3 VitalPath Router (`backend/app/vitalpath/router.py`)

- **GET /telemetry:** Simulated cargo telemetry (temperature, shock, lid, battery) from `telemetry.simulate_telemetry(elapsed_s, scenario_type)`.
- **GET /risk:** Risk evaluation from telemetry + optional ETA/window; uses `risk.evaluate_risk`.
- **POST /mission/log,** **GET /mission/log,** **GET /mission/ids:** Mission log append and read.
- **GET /alerts:** Returns alerts from `alerts.evaluate_alerts`.
- **POST /plan/organ-transport:** Request body: donor_hospital, recipient_hospital, organ_type. Calls **`organ_transport.plan_organ_transport`** and returns serialized plan (transport_mode, risk_status, recommendation, max_safe_time_s, eta_total_s, alerts, etc.).

### 4.4 Organ Transport Plan (`backend/app/services/organ_transport.py`)

- **lookup_hospital_coords:** Resolves hospital name/code to lat/lng (hardcoded DMV hospitals or geocoding).
- **estimate_road_eta:** Haversine-based placeholder; can be replaced with OSM/OSRM.
- **compute_route:** Builds a Route (road/air/hybrid) with segments; road uses estimate_road_eta.
- **plan_organ_transport(donor, recipient, organ_type):**
  - Resolves donor/recipient coords.
  - Gets organ-specific max safe time (e.g. heart/liver limits).
  - Chooses transport_mode: road if road ETA ≤ max safe time; else air or hybrid.
  - Computes route and ETA.
  - Generates alerts if ETA exceeds max safe time; sets risk_status (critical/high/medium/low).
  - Returns OrganTransportPlan with transport_mode, risk_status, recommendation, max_safe_time_s, eta_total_s, alerts.

### 4.5 AI and Voice

- **Gemini (`backend/app/services/gemini.py`):**
  - **Chat:** `get_ai_response` uses system instruction: organ/cold-chain/cargo focus; returns bullet-style response.
  - **Cargo integrity:** `get_cargo_integrity_response` takes temperature, shock, lid, battery, elapsed time, scenario; returns AI assessment and integrity_status (critical/high/medium/low).
  - **Risk evaluate:** `get_risk_evaluate_response` takes telemetry summary, ETA, max_safe_elapsed_s; returns AI recommendation and risk_level.
  - **Status:** `get_gemini_status` returns whether the key is loaded (no key value exposed). Used by frontend to show “no key” state.
- **Voice (`backend/app/services/voice.py`):**
  - **generate_voice_stream(text):** Sends text to ElevenLabs TTS API; returns MP3 bytes or None. Uses a fixed voice ID and voice_settings (stability 0.5). Frontend uses this for **all** spoken lines (no static mp3).
- **Main.py:**
  - **POST /api/ai/chat** → `get_ai_response`.
  - **POST /api/ai/speak** → `generate_voice_stream`; returns `audio/mpeg` or JSON error.
  - **POST /api/ai/cargo-integrity** → `get_cargo_integrity_response`.
  - **POST /api/ai/risk-evaluate** → `get_risk_evaluate_response`.
  - **GET /api/ai/status** → `get_gemini_status`.

---

## 5. Panel Components

- **Navigation:** Displays current nav from `navData`: distance to next, next instruction, current street, ETA, remaining km. Uses `activeScenario?.isRedAlert` for amber ETA styling in cargo alert.
- **PatientVitals (Cargo Status):** Shows temperature, shock, lid seal, battery, elapsed time; derives `hasCargoIssue` from thresholds (e.g. temp 2–8°C, lid closed, battery ≥50%, shock ≤2). Calls **`onCargoIssueChange(hasCargoIssue)`** so App can set `isRedAlert`. For BLOOD_RUN before pickup shows “EN ROUTE TO PICKUP”; after pickup uses scenario `cargoTelemetry`.
- **HospitalInfo (Receiving Facility):** Static “receiving facility” status (cold-chain ready, handoff team, OR ready, etc.).
- **MissionDetailsPanel:** Shows organ plan when present: donor, recipient, organ, transport mode, risk, max safe time, ETA; optional progress bar. Can show “No active mission” when no plan.
- **AIAssistant (Cargo Guardian):** Chat UI; exposes `speak(text)` and `injectSystemMessage(text, shouldSpeak)` via ref. User messages sent to **POST /api/ai/chat**; AI responses can be spoken via **POST /api/ai/speak** (ElevenLabs). Playback uses Web Audio API gain for volume; fallback to browser speechSynthesis only when ElevenLabs fails. No static mp3.
- **DispatchFeed:** Optional log view (e.g. transport events); can be driven by scenario or mission log.

---

## 6. Theming and UX

- **Default theme:** Red accents (text-red-400, border-red-500, etc.) on dark background across header, panels, map HUD, and welcome screen.
- **Cargo alert theme:** When `isRedAlert` is true, `body.red-alert` in `index.css` overrides red to yellow/amber (e.g. text, borders, shadows). Header “STANDBY” becomes “CARGO ALERT” with amber button styling; Cargo Guardian panel gets amber glow.
- **Welcome screen:** Red grid, red scanline, “Vital” in red and “Path AI” in white, mission lines (“Every Minute Counts.”, etc.), Begin button. No logo; no static audio.

---

## 7. Data Flow Summary

1. User clicks **Begin** on welcome screen → `showWelcome` false → dashboard visible.
2. User selects a **scenario** (Map DEV or ScenarioInjector) → `handleScenarioInject` → `activeScenario` set, organ plan fetched, TTS speaks `spokenPhrase`, AI message injected; Map’s effect runs → route fetched and sim started.
3. Map **simulation** runs: each frame advances sim time, interpolates position, updates marker and route line, calls `onNavUpdate` → Navigation and (if present) other consumers get live nav.
4. **Cargo Status** (PatientVitals) computes `hasCargoIssue` from telemetry; when it becomes true, App sets `isRedAlert` → yellow theme and “CARGO ALERT” in header.
5. User can type in **Cargo Guardian** → chat sent to Gemini; response shown and optionally spoken via ElevenLabs. Scenario phrases are only ever spoken through ElevenLabs (no static mp3).

---

## 8. Configuration

- **Frontend:** `VITE_API_BASE` can override API base URL (default '' uses relative `/api` and thus the Vite proxy).
- **Backend:** `.env` in backend (or cwd) with `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`; optional `VITALPATH_AI_ROUTE_ALGO`, `VITALPATH_AI_MAX_EXPLORATION_SEGS`, `VITALPATH_AI_MAX_NETWORK_SEGS`, `VITALPATH_AI_COORD_ROUND_DIGITS`.
- **Vite:** `server.proxy` forwards `/api` to `http://127.0.0.1:8000`.

This architecture keeps routing and map logic in the frontend Map and backend algorithm/vitalpath layers, AI and voice in Gemini and ElevenLabs, and cargo alert driven purely by PatientVitals telemetry.
