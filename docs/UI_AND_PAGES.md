# VitalPath AI — UI Setup and Documents by Page

This document describes the **UI layout of each page** and **which components (and documents) are included** where.

---

## 1. App shell (always visible after Welcome)

After the user clicks **Begin**, the following are always present unless the Welcome overlay is shown:

- **Header (top bar)**  
  - Left: Title “**Vital**Path // CARGO MONITOR” (Vital in red).  
  - Nav links: **Dashboard** (`#/`) and **AI Transparency** (`#/ai-transparency`). Active link has red highlight.  
  - Optional: “AUDIO_BLOCKED: CLICK HEADER TO UNLOCK” when TTS failed.  
  - Right: Live clock (24h), date, and **STANDBY** / **CARGO ALERT** button (toggles cargo-alert theme; also used to prime audio).

- **Backend banner (conditional)**  
  - Shown when backend is unreachable (ECONNREFUSED / 502–504).  
  - Message + command to start backend; dismiss button.

- **Full-screen grid overlay**  
  - Subtle grid at 5% opacity, full viewport, behind all content.

---

## 2. Welcome “page” (full-screen overlay)

**When:** `showWelcome === true` (initial load until user clicks **Begin**).

**Component:** `WelcomeScreen.tsx` only.

**Layout:**

- Full viewport, `z-index: 9999`, so it sits above header and main.
- **Background:** Dark radial gradient + red grid at 5% opacity.
- **Scanline:** CSS animation (red) across the screen.
- **Center content (Framer Motion):**
  - **Title:** “**Vital**Path AI” (Vital red, “Path AI” white).
  - **Subtitle:** “Automated Organ Transport Dashboard” (red, uppercase, letter-spacing).
  - **Mission lines:** “▸ Every Minute Counts.”, “▸ Every Organ Matters.”, “▸ Every Life Saved.” (last one emphasized).
  - **Begin** button (red border/glow, uppercase). Click sets `exiting`, then after 600 ms calls `onComplete()` so App sets `showWelcome = false`.
- **Bottom:** Red gradient line that animates in.

**Documents included:** None. All text is inline in `WelcomeScreen.tsx`. No markdown or docs from the repo are loaded.

---

## 3. Dashboard “page”

**When:** `currentView === 'dashboard'` (hash is `#/` or anything other than `#/ai-transparency`).

**Layout:** Single main area with a **12-column grid**, 3 columns of panels + map in the middle.

### 3.1 Left column (col-span-3)

Stack of three panels (vertical gap, scrollable if needed):

| Component            | File                    | Purpose |
|----------------------|-------------------------|--------|
| **MissionDetailsPanel** | `panels/MissionDetailsPanel.tsx` | Organ transport mission: donor, recipient, organ type, transport mode (road/air/hybrid), risk status, max safe time, ETA, optional trip progress bar. Collapsible. Shows “No active mission” when `plan` is null. |
| **AIAssistant**      | `panels/AIAssistant.tsx` | “Cargo Guardian” chat: user messages → Gemini; responses can be spoken via ElevenLabs. Exposes `speak(text)` and `injectSystemMessage(text, shouldSpeak)` via ref. Collapsible. Red border/glow; amber glow when `isRedAlert`. |
| **HospitalInfo**     | `panels/HospitalInfo.tsx` | “Receiving Facility”: static status (Cold-chain ready, Handoff team, OR/Transplant, Receiving dock, ETA window, Diversion). Collapsible. |

### 3.2 Center column (col-span-6)

**Single component:** `LiveMap` (`Map.tsx`) inside a **MapErrorBoundary**.

- **Map:** MapLibre GL map (OSM-style), vehicle marker, destination marker, route line (`vitalpath-route`), road-closure circles.
- **Top-left HUD:** Scenario title (or “SYSTEM IDLE”), coordinates, route total distance/ETA, route error text if any.
- **Top-right bar:** When no scenario: “Select a scenario to start”. When scenario/organ plan: transport mode icon + label, ETA, **▶ GO** (start sim), **FOLLOW**/FREE (camera), **✕** (cancel route when sim/routing).
- **Bottom-left:** **⚙ DEV** button. When opened (**✕ DEV**):
  - **Algorithm Comparison:** Dijkstra vs Duan-Mao (BM-SSSP) exec time, ETA, distance.
  - **Tactical Injections:** Buttons for ORGAN_TRANSPORT, BLOOD_RUN, CARGO_ALERT — each calls `onScenarioInject(scenario)`.
  - **Road Disruption:** “INJECT ROADBLOCK” (only when sim is running).
- **Bottom-right (when algo race):** `AlgoRaceMiniMap` (exploration/path comparison).

Gradient overlays (top/bottom) are decorative only (no interaction).

**Documents included:** None. Map logic and labels are in `Map.tsx`; no docs from the repo are loaded.

### 3.3 Right column (col-span-3)

Two panels:

| Component        | File                  | Purpose |
|------------------|-----------------------|--------|
| **Navigation**   | `panels/Navigation.tsx` | Live nav: distance to next, next instruction (with arrow), current street, ETA, remaining km, “SIM x8”. Collapsible. Uses `navData` from Map’s `onNavUpdate`. Amber ETA styling when `activeScenario?.isRedAlert`. |
| **PatientVitals**| `panels/PatientVitals.tsx` | Cargo status: temperature, shock, lid seal, battery, elapsed time. “EN ROUTE TO PICKUP” for BLOOD_RUN before pickup; uses `scenarioData`/`patientOnBoard` when set. Calls `onCargoIssueChange(hasCargoIssue)` so App sets `isRedAlert`. Collapsible; can grow (`flex-1`). |

**Documents included:** None. All content is component logic and props.

---

## 4. AI Transparency “page”

**When:** `currentView === 'ai-transparency'` (hash `#/ai-transparency`).

**Component:** `AITransparency.tsx` only (under `pages/`).

**Layout:**

- Single scrollable column: `max-w-4xl mx-auto`, `p-6 md:p-8`, `overflow-y-auto`.
- **Sections (all inline JSX, no external files):**
  1. **Title:** “AI Transparency” + subtitle “How VitalPath AI works and what you should know”.
  2. **What VitalPath AI Does** — Description of monitoring life-critical cargo, sensor data, advisory-only disclaimer.
  3. **AI Limitations** — Bullets: hallucination, errors, human verification required.
  4. **Confidence Levels** — Explanation of confidence score; **ConfidenceBadge** examples (92% High, 55% Medium, 25% Low) via `ConfidenceBadge.tsx`.
  5. **Policy & Regulatory Awareness** — Interpretations for guidance only; verify with official sources.
  6. **How We Use AI** — Workflow: prompts, validation, human review.
  7. **Transparency Commitment** — Explainability and continuous improvement (red-bordered card).

**Documents included:** None. All copy is hardcoded in `AITransparency.tsx`. The **ConfidenceBadge** component is used for the example badges only.

---

## 5. Components not on any page (available but unused)

- **ScenarioInjector** (`components/dev/ScenarioInjector.tsx`) — Not imported in `App.tsx` or `Map.tsx`. Could be used to inject scenarios from a separate UI.
- **DispatchFeed** (`components/panels/DispatchFeed.tsx`) — Not imported in `App.tsx`. Could be used to show a dispatch/log feed.

---

## 6. Documents in the repo (not rendered in the UI)

No markdown or other doc files from the repo are loaded or displayed by the frontend. The following exist in the project for developers and stakeholders:

| Document | Location | Purpose |
|----------|----------|--------|
| **TECHNICAL_ARCHITECTURE.md** | `docs/` | Technical architecture, data flow, backend/frontend design. |
| **UI_AND_PAGES.md**         | `docs/` | This file — UI setup and which components/documents are on each page. |
| **HOW_IT_WORKS_LAYMAN.md**  | `docs/` | Layman’s explanation of how the app works. |
| **methodology.md**          | `docs/` | Methodology notes. |
| **bench/README.md**         | `docs/bench/` | Benchmark docs. |
| **bench/summary_results_*.md** | `docs/bench/` | Benchmark result summaries. |

Other files under `docs/` (e.g. notebooks, JSONL, runmeta) are data/analysis, not UI content.

---

## 7. Summary table

| Page / View   | Route / Condition   | Components included | Documents in UI |
|---------------|---------------------|----------------------|------------------|
| **Welcome**   | `showWelcome === true` | WelcomeScreen        | None             |
| **Dashboard** | `#/` (or hash ≠ `#/ai-transparency`) | Header, (optional backend banner), MissionDetailsPanel, AIAssistant, HospitalInfo, LiveMap (with DEV panel, AlgoRaceMiniMap), Navigation, PatientVitals | None             |
| **AI Transparency** | `#/ai-transparency` | AITransparency (sections + ConfidenceBadge) | None             |

So: **every “page” is built from React components and inline copy only. No markdown or other doc files from the repo are included in the UI.**
