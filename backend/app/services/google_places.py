import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(_backend_dir / ".env")

GOOGLE_MAPS_SERVER_KEY = os.getenv("GOOGLE_MAPS_SERVER_KEY")


def _require_key() -> str:
    if not GOOGLE_MAPS_SERVER_KEY:
        raise RuntimeError("Missing GOOGLE_MAPS_SERVER_KEY in backend/.env")
    return GOOGLE_MAPS_SERVER_KEY


def _place_details(place_id: str) -> Dict[str, Any]:
    key = _require_key()
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
    }
    r = requests.get(url, headers=headers, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(r.text)
    return r.json()


async def autocomplete_places(
    q: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_m: Optional[int] = None,
) -> List[Dict[str, Any]]:
    key = _require_key()
    url = "https://places.googleapis.com/v1/places:autocomplete"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
    }
    body: Dict[str, Any] = {
        "input": q,
        "regionCode": "US",
        "includedRegionCodes": ["US"],
    }
    if lat is not None and lng is not None:
        body["locationBias"] = {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": int(radius_m) if radius_m is not None else 50000,
            }
        }
    r = requests.post(url, headers=headers, json=body, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(r.text)
    data = r.json()

    results: List[Dict[str, Any]] = []
    for item in data.get("suggestions") or []:
        place_id = ((item.get("placePrediction") or {}).get("placeId") or "")
        if not place_id:
            continue
        details = _place_details(place_id)
        loc = details.get("location") or {}
        results.append(
            {
                "place_id": details.get("id") or place_id,
                "display_name": (details.get("displayName") or {}).get("text") or "",
                "address": details.get("formattedAddress") or "",
                "lat": loc.get("latitude"),
                "lng": loc.get("longitude"),
            }
        )
        if len(results) >= 5:
            break

    return results
