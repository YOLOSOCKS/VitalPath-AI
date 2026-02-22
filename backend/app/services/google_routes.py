import os
from pathlib import Path
from typing import Any, Dict, List

import requests
from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(_backend_dir / ".env")

GOOGLE_MAPS_SERVER_KEY = os.getenv("GOOGLE_MAPS_SERVER_KEY")


def _require_key() -> str:
    if not GOOGLE_MAPS_SERVER_KEY:
        raise RuntimeError("Missing GOOGLE_MAPS_SERVER_KEY in backend/.env")
    return GOOGLE_MAPS_SERVER_KEY


def _decode_polyline(encoded: str) -> List[Dict[str, float]]:
    if not encoded:
        return []
    index = 0
    lat = 0
    lng = 0
    coords: List[Dict[str, float]] = []
    length = len(encoded)

    while index < length:
        result = 0
        shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        delta_lat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += delta_lat

        result = 0
        shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        delta_lng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += delta_lng

        coords.append({"lat": lat / 1e5, "lng": lng / 1e5})

    return coords


async def compute_route(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
    traffic: bool = True,
) -> Dict[str, Any]:
    key = _require_key()
    url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": (
            "routes.duration,routes.distanceMeters,"
            "routes.polyline.encodedPolyline,"
            "routes.legs.steps.navigationInstruction,"
            "routes.legs.steps.distanceMeters"
        ),
    }
    body = {
        "origin": {"location": {"latLng": {"latitude": from_lat, "longitude": from_lng}}},
        "destination": {"location": {"latLng": {"latitude": to_lat, "longitude": to_lng}}},
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE" if traffic else "TRAFFIC_UNAWARE",
    }
    r = requests.post(url, headers=headers, json=body, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(r.text)
    data = r.json()
    routes = data.get("routes") or []
    if not routes:
        return {"path_coordinates": [], "total_distance_m": 0, "total_time_s": 0, "steps": []}

    route0 = routes[0]
    encoded = (route0.get("polyline") or {}).get("encodedPolyline", "")
    legs = route0.get("legs") or []
    leg0 = legs[0] if legs else {}
    steps_out = []
    for step in leg0.get("steps") or []:
        instruction = (step.get("navigationInstruction") or {}).get("instructions") or ""
        steps_out.append({"instruction": instruction, "distance_m": step.get("distanceMeters")})

    duration_s = 0
    duration_raw = route0.get("duration")
    if isinstance(duration_raw, str) and duration_raw.endswith("s"):
        try:
            duration_s = int(float(duration_raw[:-1]))
        except ValueError:
            duration_s = 0

    return {
        "path_coordinates": _decode_polyline(encoded),
        "total_distance_m": route0.get("distanceMeters") or 0,
        "total_time_s": duration_s,
        "steps": steps_out,
    }
