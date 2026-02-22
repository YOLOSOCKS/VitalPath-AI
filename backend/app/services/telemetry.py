"""
VitalPath telemetry simulation: temperature, shock, lid, battery, elapsed time.
Designed for organ/critical medical transport cold-chain and container monitoring.
Supports scenario event injection (COOLING_FAILURE, BATTERY_DROP, ROUGH_TERRAIN, LID_BREACH, etc.).
"""
import time
import random
from typing import Optional, List
from pydantic import BaseModel


class TelemetryReading(BaseModel):
    """Single telemetry snapshot for cargo container / transport unit."""
    temperature_c: float
    shock_g: float
    lid_closed: bool
    battery_percent: float
    elapsed_time_s: float
    timestamp_iso: Optional[str] = None


# Default cold-chain bounds (organ transport)
TEMP_MIN_C = 2.0
TEMP_MAX_C = 8.0
BATTERY_DRAIN_PER_HOUR = 8.0  # percent
SHOCK_BASELINE_G = 0.0
SHOCK_SPIKE_PROB = 0.02  # chance per sample of a small spike

# Event types that can be injected mid-mission (frontend sends as active_events)
EVENT_COOLING_FAILURE = "COOLING_FAILURE"
EVENT_BATTERY_DROP = "BATTERY_DROP"
EVENT_ROUGH_TERRAIN = "ROUGH_TERRAIN"
EVENT_LID_BREACH = "LID_BREACH"
EVENT_ROAD_CLOSURE = "ROAD_CLOSURE"
EVENT_COMMUNICATION_LOSS = "COMMUNICATION_LOSS"


def simulate_telemetry(
    elapsed_time_s: float,
    mission_id: Optional[str] = None,
    scenario_type: str = "ROUTINE",
    seed: Optional[int] = None,
    active_events: Optional[List[str]] = None,
) -> TelemetryReading:
    """
    Simulate telemetry at a given elapsed time (from mission start).
    - Temperature drifts within cold-chain range with minor noise.
    - Shock has rare spikes (potholes, braking).
    - Lid stays closed unless scenario or LID_BREACH event.
    - Battery drains over time with small variance.
    - active_events: list of injected event types (e.g. COOLING_FAILURE, BATTERY_DROP) that modify output.
    """
    if seed is not None:
        rng = random.Random(seed + int(elapsed_time_s))
    else:
        rng = random.Random()

    events = [e.strip().upper() for e in (active_events or []) if e and isinstance(e, str)]

    # Temperature: nominal 4–6°C with drift and noise
    base_temp = 5.0
    drift = (elapsed_time_s / 3600.0) * 0.3  # slight warming over hours
    noise = rng.gauss(0, 0.2)
    temp = max(TEMP_MIN_C, min(TEMP_MAX_C, base_temp + drift + noise))
    if EVENT_COOLING_FAILURE in events:
        temp = min(TEMP_MAX_C + 0.5, round(rng.uniform(7.2, 8.5), 2))  # cold-chain breach

    # Shock: mostly 0, occasional small spikes; ROUGH_TERRAIN forces spike
    shock = SHOCK_BASELINE_G
    if EVENT_ROUGH_TERRAIN in events:
        shock = round(rng.uniform(2.5, 4.2), 2)
    elif rng.random() < SHOCK_SPIKE_PROB:
        shock = round(rng.uniform(0.5, 2.5), 2)

    # Lid: closed unless scenario or event says LID_BREACH
    lid_closed = "LID_BREACH" not in (scenario_type or "").upper() and EVENT_LID_BREACH not in events

    # Battery: linear drain + noise; BATTERY_DROP forces low
    hours = elapsed_time_s / 3600.0
    drain = hours * BATTERY_DRAIN_PER_HOUR
    noise_b = rng.gauss(0, 1.0)
    battery = max(0.0, min(100.0, 100.0 - drain + noise_b))
    if EVENT_BATTERY_DROP in events:
        battery = round(rng.uniform(8.0, 18.0), 1)

    return TelemetryReading(
        temperature_c=round(temp, 2),
        shock_g=shock,
        lid_closed=lid_closed,
        battery_percent=round(battery, 1),
        elapsed_time_s=round(elapsed_time_s, 1),
        timestamp_iso=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )
