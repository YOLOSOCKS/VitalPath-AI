# How VitalPath Works — Plain-English Explanation

This document explains the **logic behind the app** in everyday language: what the system is for, how the pieces fit together, and what actually happens when you use it.

---

## What VitalPath Is (In One Sentence)

**VitalPath is an AI-powered “safety guardian” for life-critical medical shipments**—like organs, blood, or vaccines—that monitors sensor data from the cargo container (temperature, shock, whether the lid is sealed, battery level, and how long it’s been in transit) and helps transport teams see problems early, understand what’s wrong, and decide what to do next.

---

## The Big Picture: Three Main Parts

Think of the app as having three layers that work together:

1. **The dashboard (what you see)**  
   A single screen with a map in the middle and panels around it: live transport updates, cargo status (temperature, shock, seal, battery), turn-by-turn navigation to the destination, AI chat, and “receiving facility” info.

2. **The brain (the server/backend)**  
   A program running on your machine that:
   - Figures out driving routes on real roads
   - Simulates or uses real cargo sensor data (temperature, shock, lid, battery, time)
   - Runs the AI that answers questions and assesses “is this cargo still okay?”
   - Tracks mission events and can generate alerts (e.g. “temperature high” or “lid open”)

3. **The map and “trip”**  
   A simulated vehicle moving along a calculated route. You pick a destination (or a scenario like “Organ Transport”), the backend computes the best path, and the app animates the drive and updates navigation, ETA, and cargo status along the way.

So in plain terms: **you see a dashboard; the server does the routing, telemetry, and AI; and the map shows where the shipment is and where it’s going.**

---

## How the Logic Flows (Step by Step)

### 1. You Choose a “Mission”

- **Option A — Pick a scenario**  
  You click something like “Organ Transport,” “Blood Run,” or “Cargo Alert.”  
  Each scenario is a **preset**: it sets where the trip starts, where it ends (e.g. a hospital or distribution center), and what kind of cargo “story” we’re in (routine, time-critical, or “something’s wrong”).

- **Option B — Type a destination**  
  You type an address in the search box. The app asks the backend for address suggestions (autocomplete), you pick one, and that place becomes the destination.

**Logic in the backend:**  
- Address search uses a geocoding service (e.g. Nominatim with OpenStreetMap) so “123 Main St” turns into a latitude/longitude.  
- Scenarios are predefined in the frontend (start, end, and cargo “state”) and are just a quick way to load a full mission.

---

### 2. The App Asks for a Route

Once there’s a **start** and **end** (from the scenario or from your search), the frontend sends a request to the backend, like:

- “Here’s the start and end; use real roads and give me the best driving path.”

**Logic in the backend:**

- It loads **real road data** (from OpenStreetMap) for the area between start and end.
- It finds the **shortest (or fastest) path** along those roads—respecting one-ways and drive-only streets—using a pathfinding algorithm (e.g. Dijkstra, or a research algorithm like Duan–Mao BM-SSSP).
- It returns:
  - A **list of points** that form the path (the line you see on the map)
  - **Turn-by-turn steps** (e.g. “Turn left onto Main St”)
  - **Total distance and time** (ETA)
  - Optional extra data for the “algorithm race” demo (how much of the network was “explored” by the algorithm)

So the “logic” of **where to drive** is: real roads + shortest/fastest path = one continuous route the vehicle will follow.

---

### 3. The “Vehicle” Drives the Route (Simulation)

The frontend doesn’t use a real GPS. It **simulates** the trip:

- It has the full path and the time it should take (from the backend).
- A timer runs in the background, and the app moves the vehicle icon along the path in sync with that time (often sped up so a 20-minute trip takes a couple of minutes on screen).
- As the “vehicle” moves:
  - The **navigation panel** updates: “In 500 m, turn left onto Oak St,” and shows remaining distance and ETA.
  - The **map** can follow the vehicle (camera tracks the icon).
  - If you injected a **roadblock**, the app can ask the backend for a **new route** that avoids it and then “backs up” the vehicle to where the new route starts so it doesn’t jump through buildings.

So the “logic” of **movement** is: path + time = position along the path; the UI updates that position many times per second and refreshes navigation and map.

---

### 4. Cargo “Sensors” (Telemetry)

The app needs to show **cargo status**: temperature, shock, lid, battery, and how long the shipment has been in transit.

- In a **real** system, those would come from physical sensors in the container and be sent to the server.
- In **this** app, the backend can **simulate** that data:
  - You give it “elapsed time” (and optionally a scenario type like “Organ” or “Routine”).
  - It returns numbers that look like sensor readings: temperature in a cold-chain range (e.g. 2–8°C), small shock values, “lid closed” or “lid open,” and battery draining slowly over time.

**Logic in the backend:**

- Temperature: kept in a safe band with small random drift.
- Shock: usually zero, with rare small spikes (like bumps in the road).
- Lid: “closed” unless the scenario says there’s a breach (e.g. “Cargo Alert”).
- Battery: goes down slowly over time with a bit of randomness.

The **frontend** then shows these in the “Container Telemetry” and “Cargo Status” panels. So the “logic” of **cargo numbers** is: scenario + elapsed time → simulated sensor values → displayed on the dashboard.

---

### 5. Alerts (When Something’s Wrong)

The backend has **alert rules** that look at the same telemetry (temperature, shock, lid, battery, and sometimes ETA vs. “max safe time”):

- Temperature too high or too low for cold chain → **alert**
- Lid open → **alert**
- Big shock → **alert**
- Battery very low → **alert**
- If we know “max safe transport time” and ETA would exceed it → **alert**

So the “logic” of **alerts** is: **if (sensor or time is out of safe range) then create an alert and suggest an action** (e.g. “Verify cooling” or “Secure lid”).

The frontend can show these in the transport feed or in the AI panel when the AI summarizes risk.

---

### 6. The AI (What It Does and How It Fits)

The AI has three roles in the app:

**A) Chat (general questions)**  
- You type something like “Is the cargo still okay?” or “What should I do?”  
- The frontend sends your message to the backend.  
- The backend calls an AI (e.g. Google’s Gemini), which is given a short “system” instruction like: “You are VitalPath AI, an assistant for organ and critical medical transport. Be concise; use bullet points.”  
- The AI replies based on that role and your question. The reply is shown in the chat and can optionally be read aloud (text-to-speech).

**B) Cargo integrity**  
- The backend can send the AI **current telemetry** (temperature, shock, lid, battery, elapsed time, scenario).  
- The AI is asked: “Given this data, is the cargo still viable? What’s the risk level and what should we do?”  
- The backend then returns both the AI’s text answer and a simple **status** (e.g. low/medium/high/critical) derived from the answer.  
- So the “logic” here is: **telemetry in → AI interprets viability and risk → status + recommendation out.**

**C) Risk evaluation**  
- Similar idea: the backend sends a **summary** of telemetry plus optional ETA and “max safe time.”  
- The AI evaluates overall risk and gives a short recommendation.  
- The backend again turns that into a **risk level** (e.g. low/medium/high/critical).

So in all cases, the **logic** is: **your question or sensor data goes to the AI; the AI answers in plain language (and sometimes we turn that into a simple label like “critical”); the app shows that to the user.**

---

### 7. Mission Log (Who Did What, When)

The backend keeps a simple **mission log** in memory:

- The frontend (or another client) can **post** events like: “Route started,” “Temperature alert,” “Arrived at destination.”
- Each event has a mission ID, type, message, and timestamp.
- You can **get** the list of events for a mission (e.g. for a “Transport log” or “Live updates” panel).

So the “logic” is: **events are appended to a list per mission; later we read that list to show the timeline of the shipment.**

---

## How the Frontend and Backend Talk (In Simple Terms)

- The **frontend** (the screen you see) runs in your browser.
- The **backend** runs as a separate program (e.g. on your computer or a server).
- They talk over **HTTP** (like opening a web page, but in the background):
  - “Get address suggestions for this text” → backend returns a list of places.
  - “Get a route from A to B” → backend returns the path, time, and turn-by-turn steps.
  - “Get telemetry for this elapsed time” → backend returns temperature, shock, lid, battery.
  - “Send this message to the AI” → backend calls the AI and returns the reply.
  - “Evaluate cargo integrity with this data” → backend asks the AI and returns status + text.

So the “logic” of **communication** is: **frontend sends a request (with the right parameters); backend does the work (routing, telemetry, AI, alerts); backend sends back a response; frontend updates the screen.**

---

## One Complete Example: “Organ Transport”

Here’s how the logic fits together for one scenario:

1. You click **“Organ Transport.”**
2. **Frontend** loads the scenario: start = some point in DC, end = Howard University Hospital, cargo type = organ, cold-chain.
3. **Frontend** calls the backend: “Give me a route from start to end.”
4. **Backend** loads the road network, computes the shortest path, returns the path + ETA + turn-by-turn steps.
5. **Frontend** draws the route on the map and starts the **drive simulation**: the vehicle icon moves along the path, and the navigation panel shows “In X m, turn left…,” ETA, etc.
6. **Frontend** may ask the backend for **telemetry** (e.g. every few seconds or when you open the cargo panel): “What are temperature, shock, lid, battery at elapsed time T?” Backend returns simulated values; frontend shows them in “Container Telemetry” and “Cargo Status.”
7. If you type **“Is the cargo still viable?”** in the AI panel, the frontend sends that (and maybe current telemetry) to the backend; the backend asks the AI; the AI answers; you see the answer and optionally hear it.
8. **Alerts** (if any) are computed on the backend from the same telemetry and can be shown in the transport feed or via the AI.
9. When the vehicle **reaches the destination** in the simulation, the app can log “Arrived” and show that the run is complete.

So end-to-end: **scenario → route request → path + ETA → simulated drive + telemetry + AI + alerts → arrival.** That’s the core logic of the app.

---

## Summary Table

| What you see / do        | What the logic actually does                                                                 |
|--------------------------|------------------------------------------------------------------------------------------------|
| Pick a scenario          | Frontend sets start, end, and cargo “story”; then asks backend for a route.                    |
| Search an address        | Frontend asks backend for suggestions; backend uses geocoding; you pick one as destination.  |
| Route on the map         | Backend gets roads from OpenStreetMap, runs pathfinding, returns path + time + steps.          |
| Vehicle moving           | Frontend advances position along that path over time (simulated, often sped up).              |
| Turn-by-turn / ETA       | Computed from that same path and current position (how far left, how much time left).          |
| Temperature, shock, etc. | Backend simulates sensor data from elapsed time and scenario; frontend displays it.           |
| Alerts                   | Backend compares telemetry (and maybe ETA) to safe ranges; generates alerts + suggestions.   |
| AI chat                  | Your message → backend → AI (with a “VitalPath cargo” role) → reply back to you.               |
| “Is cargo viable?”       | Telemetry → backend → AI → viability text + status (e.g. low/medium/high/critical).            |
| Roadblock / reroute      | You add a block; frontend asks for a new route avoiding it; vehicle “backs up” then follows.  |

---

## In the Shortest Possible Terms

- **Map + route:** The backend uses real roads and a shortest-path algorithm to decide *how* to drive from A to B; the frontend draws that and moves a dot along it.
- **Cargo numbers:** The backend pretends to be sensors (temperature, shock, lid, battery, time) so the app can show “live” cargo status; in production those would be real sensors.
- **AI:** You or the app send questions or data to the backend; the backend asks an AI “given this, what’s the risk and what should we do?” and returns the answer.
- **Alerts:** The backend checks those same numbers against simple rules (too hot? lid open? battery dead?) and creates alerts with suggested actions.

So the “logic” of the app is: **route the trip, simulate the drive and the sensors, watch for bad numbers, and use AI to explain risk and next steps in plain language.**
