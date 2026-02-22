"""
VitalPath API: telemetry simulation, risk evaluation, mission logging, scenario-driven alerts, organ transport planning.
"""
from datetime import datetime
from typing import Optional, List, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.telemetry import simulate_telemetry, TelemetryReading
from app.services.risk import evaluate_risk, RiskEvaluation
from app.services.mission_log import append_log, get_log, get_mission_ids, MissionLogRequest
from app.services.alerts import evaluate_alerts, Alert
from app.services.organ_transport import plan_organ_transport, OrganTransportPlan

router = APIRouter()


# --- Request/response models ---
class TelemetryResponse(BaseModel):
    mission_id: Optional[str] = None
    telemetry: TelemetryReading


class RiskResponse(BaseModel):
    evaluation: RiskEvaluation


class MissionLogResponse(BaseModel):
    mission_id: str
    entries: List[dict]


class AlertsResponse(BaseModel):
    alerts: List[Alert]


def _parse_active_events(events_param: Optional[str]) -> List[str]:
    """Parse comma-separated active_events query param."""
    if not events_param or not events_param.strip():
        return []
    return [e.strip() for e in events_param.split(",") if e.strip()]


@router.get("/telemetry", response_model=TelemetryResponse)
async def get_telemetry(
    elapsed_s: float = Query(..., description="Elapsed time since mission start (seconds)"),
    mission_id: Optional[str] = Query(None),
    scenario_type: str = Query("ROUTINE", description="ROUTINE / ORGAN / CRITICAL / LID_BREACH etc."),
    seed: Optional[int] = Query(None),
    active_events: Optional[str] = Query(None, description="Comma-separated injected events: COOLING_FAILURE, BATTERY_DROP, ROUGH_TERRAIN, LID_BREACH, ROAD_CLOSURE, COMMUNICATION_LOSS"),
):
    """Simulate telemetry at given elapsed time for cargo (temperature, shock, lid, battery). Injected events modify output."""
    telemetry = simulate_telemetry(
        elapsed_time_s=elapsed_s,
        mission_id=mission_id,
        scenario_type=scenario_type,
        seed=seed,
        active_events=_parse_active_events(active_events),
    )
    return TelemetryResponse(mission_id=mission_id, telemetry=telemetry)


@router.get("/risk", response_model=RiskResponse)
async def get_risk(
    elapsed_s: float = Query(..., description="Elapsed time (seconds)"),
    eta_remaining_s: Optional[float] = Query(None),
    max_safe_elapsed_s: Optional[float] = Query(None, description="Cold-chain safe window in seconds"),
    scenario_type: str = Query("ROUTINE"),
    seed: Optional[int] = Query(None),
    active_events: Optional[str] = Query(None, description="Comma-separated injected scenario events"),
):
    """Real-time risk evaluation from simulated telemetry and optional ETA/window."""
    telemetry = simulate_telemetry(
        elapsed_s, scenario_type=scenario_type, seed=seed, active_events=_parse_active_events(active_events)
    )
    evaluation = evaluate_risk(
        telemetry=telemetry,
        eta_remaining_s=eta_remaining_s,
        max_safe_elapsed_s=max_safe_elapsed_s,
        scenario_type=scenario_type,
    )
    return RiskResponse(evaluation=evaluation)


@router.post("/mission/log", response_model=dict)
async def post_mission_log(req: MissionLogRequest):
    """Append a mission log entry (route_start, telemetry_alert, arrival, etc.)."""
    append_log(req.mission_id, req.event_type, req.message, req.payload)
    return {"ok": True, "mission_id": req.mission_id}


@router.get("/mission/log", response_model=MissionLogResponse)
async def get_mission_log(
    mission_id: str = Query(..., description="Mission ID"),
    limit: int = Query(200, le=500),
):
    """Get mission log entries for a mission."""
    entries = get_log(mission_id, limit=limit)
    return MissionLogResponse(mission_id=mission_id, entries=entries)


@router.get("/mission/ids", response_model=List[str])
async def list_mission_ids():
    """List known mission IDs (for debugging/dashboards)."""
    return get_mission_ids()


@router.get("/alerts", response_model=AlertsResponse)
async def get_alerts(
    elapsed_s: float = Query(..., description="Elapsed time (seconds)"),
    scenario_type: str = Query("ROUTINE"),
    eta_remaining_s: Optional[float] = Query(None),
    max_safe_elapsed_s: Optional[float] = Query(None),
    seed: Optional[int] = Query(None),
    active_events: Optional[str] = Query(None, description="Comma-separated injected scenario events"),
):
    """Scenario-driven alerts from current simulated telemetry and time window."""
    telemetry = simulate_telemetry(
        elapsed_s, scenario_type=scenario_type, seed=seed, active_events=_parse_active_events(active_events)
    )
    alerts = evaluate_alerts(
        telemetry=telemetry,
        scenario_type=scenario_type,
        eta_remaining_s=eta_remaining_s,
        max_safe_elapsed_s=max_safe_elapsed_s,
    )
    return AlertsResponse(alerts=alerts)


# --- Scenario event injection (mid-mission disruptions) ---
class ScenarioEventRequest(BaseModel):
    scenario_type: str = "ROUTINE"
    elapsed_s: float = 0.0
    event_type: str  # e.g. COOLING_FAILURE, BATTERY_DROP, ROUGH_TERRAIN, LID_BREACH, ROAD_CLOSURE, COMMUNICATION_LOSS


@router.post("/scenario/event", response_model=dict)
async def post_scenario_event(req: ScenarioEventRequest) -> dict:
    """
    Record a scenario event injection (for logging/future use).
    Telemetry/risk/alerts are driven by frontend sending active_events on GET requests.
    """
    return {"ok": True, "event_type": req.event_type, "elapsed_s": req.elapsed_s, "scenario_type": req.scenario_type}


# --- Organ transport planning ---
class OrganTransportRequest(BaseModel):
    donor_hospital: str
    recipient_hospital: str
    organ_type: str = "liver"  # heart, lung, liver, kidney, pancreas, etc.
    current_time: Optional[datetime] = None


def _serialize_plan(plan: OrganTransportPlan) -> dict:
    """Convert OrganTransportPlan to JSON-serializable dict."""
    segments = []
    for s in plan.route.segments:
        segments.append({
            "segment_type": s.segment_type,
            "coordinates": list(s.coordinates),
            "distance_m": s.distance_m,
            "duration_s": s.duration_s,
            "narrative": s.narrative,
        })
    return {
        "route": {
            "segments": segments,
            "total_distance_m": plan.route.total_distance_m,
            "total_duration_s": plan.route.total_duration_s,
            "path_coordinates": plan.route.path_coordinates,
        },
        "transport_mode": plan.transport_mode,
        "risk_status": plan.risk_status,
        "recommendation": plan.recommendation,
        "donor_coords": {"lat": plan.donor_coords.lat, "lng": plan.donor_coords.lng},
        "recipient_coords": {"lat": plan.recipient_coords.lat, "lng": plan.recipient_coords.lng},
        "max_safe_time_s": plan.max_safe_time_s,
        "eta_total_s": plan.eta_total_s,
        "alerts": plan.alerts,
        "ai_risk_input": plan.ai_risk_input,
    }


@router.post("/plan/organ-transport")
async def post_plan_organ_transport(req: OrganTransportRequest) -> dict:
    """
    Plan organ transport: destination, transport mode (road/air/hybrid), route, ETA,
    and AI risk input. Alerts are included if ETA exceeds organ-specific safe time.
    """
    try:
        plan = plan_organ_transport(
            donor_hospital=req.donor_hospital,
            recipient_hospital=req.recipient_hospital,
            organ_type=req.organ_type,
            current_time=req.current_time,
        )
        return _serialize_plan(plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
