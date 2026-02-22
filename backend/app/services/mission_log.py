"""
VitalPath mission logging: in-memory store for simulation events and route lifecycle.
Frontend can POST events and GET log by mission_id; integrates with routing and alerts.
"""
import time
from typing import Optional, List, Any, Dict
from pydantic import BaseModel
from collections import defaultdict
import threading

# In-memory store: mission_id -> list of log entries (append-only)
_mission_logs: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
_lock = threading.Lock()


class MissionLogEntry(BaseModel):
    event_type: str
    message: str
    payload: Optional[Dict[str, Any]] = None
    timestamp_iso: Optional[str] = None


class MissionLogRequest(BaseModel):
    mission_id: str
    event_type: str
    message: str
    payload: Optional[Dict[str, Any]] = None


def append_log(mission_id: str, event_type: str, message: str, payload: Optional[Dict[str, Any]] = None) -> None:
    with _lock:
        entry = {
            "event_type": event_type,
            "message": message,
            "payload": payload or {},
            "timestamp_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ts": time.time(),
        }
        _mission_logs[mission_id].append(entry)


def get_log(mission_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    with _lock:
        entries = list(_mission_logs.get(mission_id, []))
    entries.sort(key=lambda e: e.get("ts", 0))
    return entries[-limit:] if limit else entries


def get_mission_ids() -> List[str]:
    with _lock:
        return list(_mission_logs.keys())
