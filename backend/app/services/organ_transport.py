"""
VitalPath organ transport planning: destination, transport mode, route, ETA, and AI risk input.

Automatically determines destination and transport mode from donor/recipient and organ type,
computes route and ETA, generates alerts if the organ might exceed safe transport time,
and prepares input for AI risk assessment. Designed for direct integration into VitalPath backend.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple, Literal

# ---------------------------------------------------------------------------
# Constants: organ-specific max safe transport time (cold ischemia, minutes)
# ---------------------------------------------------------------------------
ORGAN_MAX_SAFE_TIME_MINUTES: Dict[str, float] = {
    "heart": 240.0,      # ~4 h
    "lung": 360.0,       # ~6 h
    "liver": 720.0,      # ~12 h
    "kidney": 1440.0,    # ~24 h
    "pancreas": 720.0,   # ~12 h
    "intestine": 480.0,  # ~8 h
    "default": 720.0,    # 12 h fallback
}

TRANSPORT_MODES = Literal["road", "air", "hybrid"]
RISK_LEVELS = Literal["low", "medium", "high", "critical"]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class Point:
    """Lat/lng point (WGS84)."""
    lat: float
    lng: float


@dataclass
class RouteSegment:
    """Single segment of a route (road polyline or air leg)."""
    segment_type: Literal["road", "air"]
    coordinates: List[Tuple[float, float]]  # [(lng, lat), ...] for compatibility with frontend
    distance_m: float
    duration_s: float
    narrative: Optional[str] = None


@dataclass
class Route:
    """Full route: list of segments (road and/or air)."""
    segments: List[RouteSegment]
    total_distance_m: float
    total_duration_s: float
    path_coordinates: List[List[float]]  # [lng, lat] for frontend polyline


@dataclass
class OrganTransportPlan:
    """Output of plan_organ_transport."""
    route: Route
    transport_mode: TRANSPORT_MODES
    risk_status: RISK_LEVELS
    recommendation: str
    donor_coords: Point
    recipient_coords: Point
    max_safe_time_s: float
    eta_total_s: float
    alerts: List[Dict[str, Any]] = field(default_factory=list)
    ai_risk_input: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Placeholder: hospital coordinates lookup
# ---------------------------------------------------------------------------
def lookup_hospital_coords(hospital_name_or_code: str) -> Optional[Point]:
    """
    Map a hospital name or code to latitude/longitude.

    Implementation options:
    - In-memory lookup table (e.g. HOSPITAL_COORDS[code] = (lat, lng))
    - Geocoding API (Nominatim, Google, etc.) with caching
    - Database of transplant centers

    Returns None if not found; caller should handle missing coords.
    """
    # Placeholder: minimal lookup for demo (extend with real data or geocoding)
    _LOOKUP: Dict[str, Tuple[float, float]] = {
        "howard": (38.9185, -77.0195),
        "howard university hospital": (38.9185, -77.0195),
        "georgetown": (38.9114, -77.0726),
        "georgetown university hospital": (38.9114, -77.0726),
        "union market": (38.9086, -76.9873),
    }
    key = (hospital_name_or_code or "").strip().lower()
    if key in _LOOKUP:
        lat, lng = _LOOKUP[key]
        return Point(lat=lat, lng=lng)
    # TODO: call geocoding API or DB here
    return None


# ---------------------------------------------------------------------------
# Placeholder: road ETA estimation
# ---------------------------------------------------------------------------
def estimate_road_eta(origin: Point, destination: Point) -> Tuple[float, float]:
    """
    Estimate road travel distance (m) and duration (s) between two points.

    Implementation options:
    - OSRM / Valhalla / OpenRouteService HTTP API
    - OSMnx (as in app.algorithm.router) for same-region routing
    - Cached matrix for known hospital pairs

    Returns (distance_m, duration_s).
    """
    # Placeholder: haversine distance and assume 40 km/h average
    dist_m = _haversine_m((origin.lng, origin.lat), (destination.lng, destination.lat))
    avg_speed_ms = 40.0 * 1000.0 / 3600.0  # 40 km/h
    duration_s = dist_m / avg_speed_ms if avg_speed_ms > 0 else 0.0
    # TODO: call OSRM/OSMnx/compute_route here for real road ETA
    return (dist_m, duration_s)


def _haversine_m(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Distance in meters between (lng, lat) and (lng, lat)."""
    lng1, lat1 = a
    lng2, lat2 = b
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    x = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2.0 * r * math.asin(min(1.0, math.sqrt(x)))


# ---------------------------------------------------------------------------
# Placeholder: route computation
# ---------------------------------------------------------------------------
def compute_route(
    origin: Point,
    destination: Point,
    mode: TRANSPORT_MODES,
    air_speed_kmh: float = 400.0,
    last_mile_max_km: float = 50.0,
) -> Route:
    """
    Compute full route (road, air, or hybrid) between origin and destination.

    - Road: use shortest/fastest path (e.g. OpenStreetMap via OSRM or OSMnx).
    - Air: straight-line flight; optionally add last-mile road segment.
    - Hybrid: air leg to near destination, then road for last-mile.

    Returns Route with segments and path_coordinates for frontend.
    """
    if mode == "road":
        dist_m, dur_s = estimate_road_eta(origin, destination)
        coords = [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat],
        ]
        seg = RouteSegment(
            segment_type="road",
            coordinates=[(origin.lng, origin.lat), (destination.lng, destination.lat)],
            distance_m=dist_m,
            duration_s=dur_s,
            narrative="Road (placeholder polyline)",
        )
        return Route(
            segments=[seg],
            total_distance_m=dist_m,
            total_duration_s=dur_s,
            path_coordinates=coords,
        )

    # Air: straight line
    dist_m = _haversine_m((origin.lng, origin.lat), (destination.lng, destination.lat))
    speed_ms = air_speed_kmh * 1000.0 / 3600.0
    air_dur_s = dist_m / speed_ms if speed_ms > 0 else 0.0
    air_coords = [[origin.lng, origin.lat], [destination.lng, destination.lat]]

    if mode == "air":
        return Route(
            segments=[RouteSegment("air", [(origin.lng, origin.lat), (destination.lng, destination.lat)], dist_m, air_dur_s, "Air (direct)")],
            total_distance_m=dist_m,
            total_duration_s=air_dur_s,
            path_coordinates=air_coords,
        )

    # Hybrid: air + last-mile road (placeholder: we still use straight line for "road" last mile)
    last_mile_m = min(dist_m, last_mile_max_km * 1000.0)
    road_dur_s = last_mile_m / (40.0 * 1000.0 / 3600.0)
    air_dist = dist_m - last_mile_m
    air_dur_s = air_dist / speed_ms if speed_ms > 0 else 0.0
    # Simplified: one air segment, one road segment to same end point
    segments = [
        RouteSegment("air", [(origin.lng, origin.lat), (destination.lng, destination.lat)], air_dist, air_dur_s, "Air leg"),
        RouteSegment("road", [(destination.lng, destination.lat), (destination.lng, destination.lat)], last_mile_m, road_dur_s, "Last-mile road"),
    ]
    return Route(
        segments=segments,
        total_distance_m=dist_m,
        total_duration_s=air_dur_s + road_dur_s,
        path_coordinates=air_coords,
    )


# ---------------------------------------------------------------------------
# Placeholder: vehicle simulation (frontend can drive visualization)
# ---------------------------------------------------------------------------
def start_vehicle_sim(
    route: Route,
    current_time: datetime,
    callback: Optional[Callable[[float, Point, Dict[str, Any]], None]] = None,
) -> None:
    """
    Start or enqueue a vehicle simulation along the route.

    The frontend typically handles visualization; this can:
    - Push position/telemetry to a message queue or WebSocket
    - Update mission log with milestones
    - Invoke callback(elapsed_s, position, telemetry) at each tick

    Placeholder: no-op; integrate with real sim or event stream.
    """
    # TODO: drive elapsed time, interpolate position from route.path_coordinates and cum_time_s,
    #       call get_current_telemetry(), optionally ask_ai(), and callback or publish
    pass


# ---------------------------------------------------------------------------
# Placeholder: create alert
# ---------------------------------------------------------------------------
def create_alert(
    alert_id: str,
    severity: str,
    title: str,
    message: str,
    suggested_action: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create an alert object for ETA/safe-time breach or other conditions.

    Can be appended to OrganTransportPlan.alerts and/or sent to
    app.services.alerts or mission log.
    """
    out: Dict[str, Any] = {
        "id": alert_id,
        "severity": severity,
        "title": title,
        "message": message,
    }
    if suggested_action:
        out["suggested_action"] = suggested_action
    if payload:
        out["payload"] = payload
    return out


# ---------------------------------------------------------------------------
# Placeholder: get current telemetry (for AI risk input)
# ---------------------------------------------------------------------------
def get_current_telemetry(
    mission_id: Optional[str] = None,
    elapsed_time_s: float = 0.0,
    scenario_type: str = "ORGAN",
) -> Dict[str, Any]:
    """
    Get current cargo telemetry (temperature, shock, lid, battery, elapsed).

    Should call app.services.telemetry.simulate_telemetry() when integrated,
    or read from live sensors. Returns a dict suitable for ask_ai() and
    risk evaluation.
    """
    try:
        from app.services.telemetry import simulate_telemetry
        t = simulate_telemetry(
            elapsed_time_s=elapsed_time_s,
            mission_id=mission_id,
            scenario_type=scenario_type,
        )
        return {
            "temperature_c": t.temperature_c,
            "shock_g": t.shock_g,
            "lid_closed": t.lid_closed,
            "battery_percent": t.battery_percent,
            "elapsed_time_s": t.elapsed_time_s,
            "timestamp_iso": t.timestamp_iso,
        }
    except Exception:
        # Fallback if telemetry module unavailable or fails
        return {
            "temperature_c": 5.0,
            "shock_g": 0.0,
            "lid_closed": True,
            "battery_percent": 90.0,
            "elapsed_time_s": elapsed_time_s,
            "timestamp_iso": None,
        }


# ---------------------------------------------------------------------------
# Placeholder: ask AI for risk / recommendation
# ---------------------------------------------------------------------------
def ask_ai(
    telemetry: Dict[str, Any],
    organ_type: str,
    transport_mode: str,
    eta_remaining_s: Optional[float] = None,
    max_safe_elapsed_s: Optional[float] = None,
) -> Tuple[str, str]:
    """
    Call AI (e.g. Gemini) for risk assessment and plain-language recommendation.

    Returns (risk_status, recommendation). When integrated, use
    app.services.gemini.get_risk_evaluate_response() or get_cargo_integrity_response().
    """
    # Placeholder: sync return; real impl is async (await get_risk_evaluate_response(...))
    # Prepare input for AI
    req = {
        "telemetry_summary": telemetry,
        "eta_remaining_s": eta_remaining_s,
        "max_safe_elapsed_s": max_safe_elapsed_s,
        "scenario_type": f"ORGAN_{organ_type.upper()}",
    }
    # TODO: await get_risk_evaluate_response(RiskEvaluateRequest(**req))
    return ("unknown", "AI recommendation placeholder; integrate with app.services.gemini.")


# ---------------------------------------------------------------------------
# Main planning function
# ---------------------------------------------------------------------------
def plan_organ_transport(
    donor_hospital: str,
    recipient_hospital: str,
    organ_type: str,
    current_time: Optional[datetime] = None,
) -> OrganTransportPlan:
    """
    Automatically determine destination, transport mode, route, ETA, and AI risk input
    for an organ shipment based on donor/recipient and organ type.

    Steps:
    a) Map donor and recipient to lat/lng (lookup or geocoding).
    b) Get organ-specific max safe transport time.
    c) Decide transport mode: road if road ETA < max safe time; else air or hybrid.
    d) Compute route (road / air / hybrid).
    e) Generate alerts if ETA exceeds max safe time.
    f) Prepare AI risk input (telemetry, route, mode, organ type).

    Returns OrganTransportPlan with route, transport_mode, risk_status, recommendation, alerts, ai_risk_input.
    """
    now = current_time or datetime.utcnow()
    donor = lookup_hospital_coords(donor_hospital)
    recipient = lookup_hospital_coords(recipient_hospital)

    if donor is None:
        raise ValueError(f"Donor hospital not found: {donor_hospital}")
    if recipient is None:
        raise ValueError(f"Recipient hospital not found: {recipient_hospital}")

    organ_key = (organ_type or "default").strip().lower()
    max_safe_min = ORGAN_MAX_SAFE_TIME_MINUTES.get(organ_key, ORGAN_MAX_SAFE_TIME_MINUTES["default"])
    max_safe_s = max_safe_min * 60.0

    # Road ETA for mode decision
    road_dist_m, road_dur_s = estimate_road_eta(donor, recipient)
    straight_m = _haversine_m((donor.lng, donor.lat), (recipient.lng, recipient.lat))
    air_speed_ms = 400.0 * 1000.0 / 3600.0
    air_dur_s = straight_m / air_speed_ms

    # Decide transport mode
    if road_dur_s <= max_safe_s:
        transport_mode: TRANSPORT_MODES = "road"
    else:
        # Prefer hybrid if distance is large (e.g. > 100 km) for last-mile accuracy
        if straight_m > 100_000 and road_dur_s > max_safe_s * 0.5:
            transport_mode = "hybrid"
        else:
            transport_mode = "air"

    route = compute_route(donor, recipient, transport_mode)
    eta_total_s = route.total_duration_s

    # Alerts if ETA exceeds max safe time
    alerts: List[Dict[str, Any]] = []
    if eta_total_s > max_safe_s:
        alerts.append(create_alert(
            "eta_exceeds_safe_time",
            "critical",
            "ETA exceeds safe transport window",
            f"Projected ETA {eta_total_s/60:.0f} min exceeds organ max safe time {max_safe_min:.0f} min. Consider air or hybrid.",
            suggested_action="Switch to air/hybrid or confirm with transplant center.",
            payload={"eta_s": eta_total_s, "max_safe_s": max_safe_s},
        ))

    # Risk status from time pressure
    if eta_total_s > max_safe_s:
        risk_status: RISK_LEVELS = "critical"
    elif eta_total_s > max_safe_s * 0.8:
        risk_status = "high"
    elif eta_total_s > max_safe_s * 0.5:
        risk_status = "medium"
    else:
        risk_status = "low"

    # Current telemetry and AI input
    telemetry = get_current_telemetry(
        mission_id=None,
        elapsed_time_s=0.0,
        scenario_type=f"ORGAN_{organ_type.upper()}",
    )
    ai_risk_input = {
        "organ_type": organ_type,
        "transport_mode": transport_mode,
        "donor": donor_hospital,
        "recipient": recipient_hospital,
        "telemetry": telemetry,
        "route_total_distance_m": route.total_distance_m,
        "route_total_duration_s": route.total_duration_s,
        "max_safe_elapsed_s": max_safe_s,
        "eta_remaining_s": eta_total_s,
        "current_time_iso": now.isoformat(),
    }

    risk_status_ai, recommendation = ask_ai(
        telemetry,
        organ_type,
        transport_mode,
        eta_remaining_s=eta_total_s,
        max_safe_elapsed_s=max_safe_s,
    )
    if risk_status_ai != "unknown":
        risk_status = risk_status_ai

    return OrganTransportPlan(
        route=route,
        transport_mode=transport_mode,
        risk_status=risk_status,
        recommendation=recommendation,
        donor_coords=donor,
        recipient_coords=recipient,
        max_safe_time_s=max_safe_s,
        eta_total_s=eta_total_s,
        alerts=alerts,
        ai_risk_input=ai_risk_input,
    )
