"""
VitalPath real-time risk evaluation from telemetry, ETA, and scenario.
"""
from typing import Optional, List
from pydantic import BaseModel

from app.services.telemetry import TelemetryReading, TEMP_MIN_C, TEMP_MAX_C


class RiskFactor(BaseModel):
    name: str
    severity: str  # "low" | "medium" | "high" | "critical"
    description: str
    value: Optional[float] = None


class RiskEvaluation(BaseModel):
    overall: str  # "low" | "medium" | "high" | "critical"
    score: float  # 0–100, higher = riskier
    factors: List[RiskFactor]
    recommendation: Optional[str] = None


def evaluate_risk(
    telemetry: Optional[TelemetryReading] = None,
    eta_remaining_s: Optional[float] = None,
    max_safe_elapsed_s: Optional[float] = None,
    scenario_type: str = "ROUTINE",
) -> RiskEvaluation:
    """
    Real-time risk from cargo telemetry, time remaining, and cold-chain window.
    """
    factors: List[RiskFactor] = []
    score = 0.0

    if telemetry:
        # Temperature out of range
        if telemetry.temperature_c < TEMP_MIN_C or telemetry.temperature_c > TEMP_MAX_C:
            severity = "critical" if abs(telemetry.temperature_c - 5.0) > 3.0 else "high"
            factors.append(RiskFactor(
                name="temperature",
                severity=severity,
                description=f"Temperature {telemetry.temperature_c}°C outside cold-chain {TEMP_MIN_C}–{TEMP_MAX_C}°C",
                value=telemetry.temperature_c,
            ))
            score += 40.0 if severity == "critical" else 25.0

        # Lid open
        if not telemetry.lid_closed:
            factors.append(RiskFactor(
                name="lid",
                severity="critical",
                description="Container lid open; integrity compromised",
            ))
            score += 35.0

        # High shock
        if telemetry.shock_g > 2.0:
            factors.append(RiskFactor(
                name="shock",
                severity="high" if telemetry.shock_g < 4.0 else "critical",
                description=f"Shock event {telemetry.shock_g}g detected",
                value=telemetry.shock_g,
            ))
            score += min(30.0, telemetry.shock_g * 8.0)

        # Low battery
        if telemetry.battery_percent < 20:
            factors.append(RiskFactor(
                name="battery",
                severity="critical" if telemetry.battery_percent < 10 else "high",
                description=f"Battery at {telemetry.battery_percent}%",
                value=telemetry.battery_percent,
            ))
            score += 25.0 if telemetry.battery_percent < 10 else 15.0

    # ETA / elapsed vs safe window
    if max_safe_elapsed_s is not None and telemetry is not None:
        if telemetry.elapsed_time_s > max_safe_elapsed_s:
            factors.append(RiskFactor(
                name="cold_chain_window",
                severity="critical",
                description=f"Elapsed {telemetry.elapsed_time_s/60:.0f} min exceeds safe window {max_safe_elapsed_s/60:.0f} min",
                value=telemetry.elapsed_time_s,
            ))
            score += 30.0
        elif eta_remaining_s is not None and (telemetry.elapsed_time_s + eta_remaining_s) > max_safe_elapsed_s:
            factors.append(RiskFactor(
                name="eta_window",
                severity="high",
                description="ETA would exceed cold-chain window; consider reroute or handoff",
                value=eta_remaining_s,
            ))
            score += 20.0

    # Scenario severity modifier
    if "CARDIAC" in (scenario_type or "").upper() or "CRITICAL" in (scenario_type or "").upper():
        factors.append(RiskFactor(
            name="scenario",
            severity="medium",
            description="Critical/organ scenario; time-sensitive",
        ))
        score += 5.0

    score = min(100.0, score)
    if score >= 60:
        overall = "critical"
        recommendation = "Stop and assess cargo; consider backup transport or handoff."
    elif score >= 35:
        overall = "high"
        recommendation = "Monitor closely; prepare contingency."
    elif score >= 15:
        overall = "medium"
        recommendation = "Continue with increased vigilance."
    else:
        overall = "low"
        recommendation = "Parameters nominal; maintain course."

    return RiskEvaluation(
        overall=overall,
        score=round(score, 1),
        factors=factors,
        recommendation=recommendation,
    )
