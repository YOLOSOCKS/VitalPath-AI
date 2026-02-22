import os
import json
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from pydantic import BaseModel
from typing import Optional, Any, Dict
import anyio

# Load .env from several possible locations (backend dir, cwd, cwd/backend; also .env.txt on Windows)
_backend_dir = Path(__file__).resolve().parent.parent.parent
_candidates = [
    _backend_dir / ".env",
    _backend_dir / ".env.txt",
    Path.cwd() / ".env",
    Path.cwd() / ".env.txt",
    Path.cwd() / "backend" / ".env",
    Path.cwd() / "backend" / ".env.txt",
]
_env_path_used = None
for _p in _candidates:
    if _p.exists():
        load_dotenv(_p)
        if _env_path_used is None:
            _env_path_used = _p
if _env_path_used is None:
    load_dotenv()  # fallback: search cwd and parents
    _env_path_used = _backend_dir / ".env"  # for status display only

# Support both variable names; strip quotes, whitespace, and BOM (Windows)
_raw = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
API_KEY = _raw.strip().strip('"').strip("'").replace("\ufeff", "").strip() or None

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_TIMEOUT_S = float(os.getenv("GEMINI_TIMEOUT_S", "12"))

# Initialize the modern client
client = genai.Client(api_key=API_KEY) if API_KEY else None


def get_gemini_status() -> dict:
    """For debugging: report whether Gemini is configured (no key value exposed)."""
    return {
        "gemini_configured": client is not None,
        "key_length": len(API_KEY) if API_KEY else 0,
        "env_file_exists": _env_path_used.exists() if _env_path_used else False,
        "env_path": str(_env_path_used) if _env_path_used else "none",
        "cwd": str(Path.cwd()),
        "model": GEMINI_MODEL,
    }


class ChatRequest(BaseModel):
    message: str
    context: str = "general"


async def _generate_with_timeout(prompt: str, system_instruction: str) -> str:
    def _call():
        return client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={"system_instruction": system_instruction},
        )

    try:
        with anyio.fail_after(GEMINI_TIMEOUT_S):
            response = await anyio.to_thread.run_sync(_call)
        return response.text or ""
    except (anyio.exceptions.TimeoutError, TimeoutError):
        return "GEMINI TIMEOUT: Response took too long."
    except Exception as e:
        return f"GEMINI ERROR: {str(e)}"


async def get_ai_response(request: ChatRequest):
    if not client:
        return {"response": "Cargo Guardian needs a Gemini API key."}

    try:
        text = await _generate_with_timeout(
            request.message,
            (
                "You are VitalPath AI for organ and critical medical cargo transport. "
                "Respond only with short, action-oriented commands. Use imperative sentences like: 'Check container temp.', 'Adjust route.', 'Verify lid seal.' "
                "No long explanations, no extra context, no bullet lists. One or two brief commands per response. Cold-chain, cargo viability, and next steps only."
            ),
        )
        return {"response": text}
    except Exception as e:
        return {"response": f"GEMINI ERROR: {str(e)}"}


# --- VitalPath: Cargo integrity & risk AI ---
class CargoIntegrityRequest(BaseModel):
    temperature_c: float
    shock_g: float
    lid_closed: bool
    battery_percent: float
    elapsed_time_s: float
    scenario_type: str = "ROUTINE"
    optional_notes: Optional[str] = None


class RiskEvaluateRequest(BaseModel):
    telemetry_summary: Dict[str, Any]
    eta_remaining_s: Optional[float] = None
    max_safe_elapsed_s: Optional[float] = None
    scenario_type: str = "ROUTINE"


def _derive_status(text: str, keys: tuple = ("critical", "high", "medium", "low")) -> str:
    t = (text or "").lower()
    for k in keys:
        if k in t:
            return k
    return "unknown"


async def get_cargo_integrity_response(req: CargoIntegrityRequest):
    """AI assessment of cargo (organ) integrity from current telemetry."""
    if not client:
        return {"response": "[SIMULATION] No Gemini Key found.", "integrity_status": "unknown"}

    prompt = (
        "Assess cargo (organ/critical medical) integrity for transport. "
        "Given: temperature %.1f°C, shock %.2fg, lid %s, battery %.0f%%, elapsed %.0f s, scenario %s. %s\n"
        "Reply in 2–4 short bullets: viability risk level (low/medium/high/critical), main concerns, and one recommended action."
    ) % (
        req.temperature_c,
        req.shock_g,
        "closed" if req.lid_closed else "OPEN",
        req.battery_percent,
        req.elapsed_time_s,
        req.scenario_type,
        f"Notes: {req.optional_notes}" if req.optional_notes else "",
    )
    try:
        text = (await _generate_with_timeout(
            prompt,
            "You are VitalPath cargo integrity advisor. Cold-chain 2–8°C; minimal shock; lid must stay closed. Be concise.",
        )).strip()
        status = _derive_status(text)
        return {"response": text, "integrity_status": status}
    except Exception as e:
        return {"response": f"GEMINI ERROR: {str(e)}", "integrity_status": "error"}


async def get_risk_evaluate_response(req: RiskEvaluateRequest):
    """AI real-time risk evaluation and recommendation from telemetry + ETA."""
    if not client:
        return {"response": "[SIMULATION] No Gemini Key found.", "risk_level": "unknown"}

    prompt = (
        "Real-time risk evaluation for organ/critical medical transport. "
        "Telemetry: %s. ETA remaining: %s s. Max safe elapsed: %s s. Scenario: %s. "
        "Reply in 2–4 bullets: overall risk (low/medium/high/critical), key factors, and one clear recommendation."
    ) % (
        json.dumps(req.telemetry_summary),
        str(req.eta_remaining_s) if req.eta_remaining_s is not None else "N/A",
        str(req.max_safe_elapsed_s) if req.max_safe_elapsed_s is not None else "N/A",
        req.scenario_type,
    )
    try:
        text = (await _generate_with_timeout(
            prompt,
            "You are VitalPath risk advisor. Consider cold-chain, shock, lid, battery, and time windows. Be concise.",
        )).strip()
        risk_level = _derive_status(text)
        return {"response": text, "risk_level": risk_level}
    except Exception as e:
        return {"response": f"GEMINI ERROR: {str(e)}", "risk_level": "error"}