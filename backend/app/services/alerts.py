"""
VitalPath scenario-driven alerts: rules that produce alerts from telemetry and mission state.
"""
from typing import Optional, List
from pydantic import BaseModel

from app.services.telemetry import TelemetryReading, TEMP_MIN_C, TEMP_MAX_C


class Alert(BaseModel):
    id: str
    scenario: str
    severity: str  # "info" | "warning" | "critical"
    title: str
    message: str
    suggested_action: Optional[str] = None


def evaluate_alerts(
    telemetry: Optional[TelemetryReading] = None,
    scenario_type: str = "ROUTINE",
    eta_remaining_s: Optional[float] = None,
    max_safe_elapsed_s: Optional[float] = None,
) -> List[Alert]:
    """Generate scenario-driven alerts from current telemetry and mission context."""
    alerts: List[Alert] = []
    t = telemetry

    if not t:
        return alerts

    # Temperature
    if t.temperature_c > TEMP_MAX_C:
        alerts.append(Alert(
            id="temp_high",
            scenario=scenario_type or "ROUTINE",
            severity="critical",
            title="Cold-chain temperature high",
            message=f"Container temperature {t.temperature_c}°C exceeds max {TEMP_MAX_C}°C.",
            suggested_action="Verify cooling; consider reducing ETA or handoff.",
        ))
    elif t.temperature_c < TEMP_MIN_C:
        alerts.append(Alert(
            id="temp_low",
            scenario=scenario_type or "ROUTINE",
            severity="warning",
            title="Cold-chain temperature low",
            message=f"Container temperature {t.temperature_c}°C below min {TEMP_MIN_C}°C.",
            suggested_action="Check for over-cooling or sensor drift.",
        ))

    # Lid
    if not t.lid_closed:
        alerts.append(Alert(
            id="lid_open",
            scenario=scenario_type or "ROUTINE",
            severity="critical",
            title="Container lid open",
            message="Lid sensor reports open; cargo integrity at risk.",
            suggested_action="Secure lid immediately; assess cargo.",
        ))

    # Shock
    if t.shock_g > 2.0:
        alerts.append(Alert(
            id="shock",
            scenario=scenario_type or "ROUTINE",
            severity="warning" if t.shock_g < 4.0 else "critical",
            title="Shock event",
            message=f"Shock {t.shock_g}g recorded.",
            suggested_action="Smooth driving; log for post-mission review.",
        ))

    # Battery
    if t.battery_percent < 15:
        alerts.append(Alert(
            id="battery_low",
            scenario=scenario_type or "ROUTINE",
            severity="critical" if t.battery_percent < 8 else "warning",
            title="Low battery",
            message=f"Backup/system battery at {t.battery_percent}%.",
            suggested_action="Replace or charge at next stop.",
        ))

    # Time window (if we have ETA and max safe elapsed)
    if max_safe_elapsed_s is not None and eta_remaining_s is not None:
        projected_total = t.elapsed_time_s + eta_remaining_s
        if projected_total > max_safe_elapsed_s:
            alerts.append(Alert(
                id="eta_exceeds_window",
                scenario=scenario_type or "ROUTINE",
                severity="critical",
                title="ETA exceeds safe window",
                message=f"Projected total time {projected_total/60:.0f} min exceeds cold-chain window {max_safe_elapsed_s/60:.0f} min.",
                suggested_action="Request ETA-aware reroute or arrange handoff.",
            ))

    return alerts
