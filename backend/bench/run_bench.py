"""
VitalPath AI Benchmark Runner
=============================

Creates repeatable performance measurements against the VitalPath AI routing endpoint:

    POST /api/algo/calculate

It writes JSONL (one JSON object per line) into docs/bench/ so you can:
- plot charts (boxplots, CDF, histograms)
- compare Dijkstra vs BM-SSSP
- commit PNGs into docs/figures/ for README eye-candy

Design goals:
- zero external dependencies (stdlib only; no requests needed)
- robust error capture
- easy to run from repo root on Windows/macOS/Linux

Typical usage (from repo root):
    python backend/bench/run_bench.py --trials 20 --warmups 3 --tag bench

Optional exploration (bigger payload):
    python backend/bench/run_bench.py --include-exploration --trials 5 --warmups 1 --tag exploration
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


DEFAULT_CASES = Path(__file__).resolve().parent / "bench_cases.json"


@dataclass
class BenchRow:
    ts: str
    run_id: str
    label: str
    scenario_type: str
    algorithm: str
    trial_idx: int

    ok: bool
    http_status: Optional[int]
    error: Optional[str]

    # Backend response timing fields (preferred)
    execution_time_ms: Optional[float]
    algorithm_time_ms: Optional[float]
    total_time_ms: Optional[float]

    # Client wall time around the request (fallback)
    wall_time_ms: float

    # Optional extras
    explored_count: Optional[int]
    total_distance_m: Optional[float]
    total_time_s: Optional[float]


def _utc_ts() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None


def _safe_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        return int(x)
    except Exception:
        return None


def _machine_info() -> Dict[str, Any]:
    return {
        "python": sys.version.replace("\n", " "),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_count": os.cpu_count(),
        "cwd": str(Path.cwd()),
    }


def _post_json(url: str, payload: Dict[str, Any], timeout_s: int) -> Tuple[int, Dict[str, Any], float]:
    """
    POST JSON payload, return (status_code, json_dict, wall_ms).

    Raises:
        urllib.error.HTTPError, urllib.error.URLError, ValueError (JSON parse), etc.
    """
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
        wall_ms = (time.perf_counter() - t0) * 1000.0
        status = getattr(resp, "status", 200)

    data = json.loads(raw.decode("utf-8"))
    return status, data, wall_ms


def main() -> int:
    ap = argparse.ArgumentParser(description="Run VitalPath AI routing benchmarks and write JSONL.")
    ap.add_argument("--api", default=None, help="API base, e.g. http://127.0.0.1:8000 (overrides cases file).")
    ap.add_argument("--endpoint", default=None, help="Full endpoint URL (overrides api + default path).")
    ap.add_argument("--cases", default=str(DEFAULT_CASES), help="Path to bench_cases.json")
    ap.add_argument("--out-dir", default="docs/bench", help="Output directory for JSONL + run metadata")
    ap.add_argument("--tag", default="bench", help="Filename tag (e.g. bench, exploration, coldstart)")
    ap.add_argument("--trials", type=int, default=20, help="Measured trials per case per algorithm")
    ap.add_argument("--warmups", type=int, default=3, help="Warmup requests per case per algorithm (not recorded)")
    ap.add_argument("--timeout", type=int, default=60, help="HTTP timeout seconds per request")
    ap.add_argument("--sleep-ms", type=int, default=60, help="Sleep between requests (ms) to reduce jitter")
    ap.add_argument(
        "--algorithms",
        default="dijkstra,bmsssp",
        help="Comma-separated algorithms (default: dijkstra,bmsssp)",
    )
    ap.add_argument(
        "--include-exploration",
        action="store_true",
        help="Request exploration payload. Slower and larger, but enables explored-vs-time plots.",
    )
    args = ap.parse_args()

    cases_path = Path(args.cases).resolve()
    if not cases_path.exists():
        print(f"[bench] cases file not found: {cases_path}", file=sys.stderr)
        return 2

    cfg = json.loads(cases_path.read_text(encoding="utf-8"))
    api_base = (args.api or cfg.get("api_base") or "http://127.0.0.1:8000").rstrip("/")
    endpoint = args.endpoint or (api_base + "/api/algo/calculate")

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_jsonl = out_dir / f"results_{args.tag}_{stamp}.jsonl"
    out_meta = out_dir / f"runmeta_{args.tag}_{stamp}.json"

    algorithms = [a.strip().lower() for a in args.algorithms.split(",") if a.strip()]
    cases = cfg.get("cases", [])

    meta = {
        "ts": _utc_ts(),
        "api_base": api_base,
        "endpoint": endpoint,
        "cases_file": str(cases_path),
        "cases": cases,
        "algorithms": algorithms,
        "params": {
            "trials": args.trials,
            "warmups": args.warmups,
            "timeout": args.timeout,
            "sleep_ms": args.sleep_ms,
            "include_exploration": bool(args.include_exploration),
        },
        "machine": _machine_info(),
    }
    out_meta.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"[bench] endpoint: {endpoint}")
    print(f"[bench] writing:  {out_jsonl}")
    print(f"[bench] metadata: {out_meta}")

    def sleep():
        if args.sleep_ms > 0:
            time.sleep(args.sleep_ms / 1000.0)

    with out_jsonl.open("w", encoding="utf-8") as f:
        for case in cases:
            label = str(case.get("label", "CASE"))
            scenario_type = str(case.get("scenario_type", "ROUTINE"))
            start = case.get("start")
            end = case.get("end")
            if not start or not end:
                print(f"[bench] skipping {label}: missing start/end")
                continue

            for algo in algorithms:
                # Warmups (not recorded)
                for _ in range(max(0, args.warmups)):
                    payload = {
                        "start": start,
                        "end": end,
                        "scenario_type": scenario_type,
                        "algorithm": algo,
                        "include_exploration": bool(args.include_exploration),
                    }
                    try:
                        _post_json(endpoint, payload, timeout_s=args.timeout)
                    except Exception:
                        pass
                    sleep()

                # Measured trials
                for t in range(max(1, args.trials)):
                    run_id = f"{label}::{algo}::{t}::{stamp}"
                    payload = {
                        "start": start,
                        "end": end,
                        "scenario_type": scenario_type,
                        "algorithm": algo,
                        "include_exploration": bool(args.include_exploration),
                    }

                    row = BenchRow(
                        ts=_utc_ts(),
                        run_id=run_id,
                        label=label,
                        scenario_type=scenario_type,
                        algorithm=algo,
                        trial_idx=t,
                        ok=False,
                        http_status=None,
                        error=None,
                        execution_time_ms=None,
                        algorithm_time_ms=None,
                        total_time_ms=None,
                        wall_time_ms=0.0,
                        explored_count=None,
                        total_distance_m=None,
                        total_time_s=None,
                    )

                    try:
                        status, data, wall_ms = _post_json(endpoint, payload, timeout_s=args.timeout)
                        row.http_status = status
                        row.wall_time_ms = wall_ms

                        row.execution_time_ms = _safe_float(data.get("execution_time_ms"))
                        row.algorithm_time_ms = _safe_float(data.get("algorithm_time_ms")) or row.execution_time_ms
                        row.total_time_ms = _safe_float(data.get("total_time_ms")) or wall_ms

                        row.explored_count = _safe_int(data.get("explored_count"))
                        row.total_distance_m = _safe_float(data.get("total_distance_m"))
                        row.total_time_s = _safe_float(data.get("total_time_s"))

                        row.ok = True

                    except urllib.error.HTTPError as e:
                        row.http_status = getattr(e, "code", None)
                        try:
                            body = e.read().decode("utf-8", errors="replace")
                        except Exception:
                            body = ""
                        row.error = f"HTTPError {row.http_status}: {body[:250]}"
                    except urllib.error.URLError as e:
                        row.error = f"URLError: {getattr(e, 'reason', e)}"
                    except Exception as e:
                        row.error = str(e)[:300]

                    f.write(json.dumps(asdict(row), ensure_ascii=False) + "\n")
                    f.flush()
                    sleep()

    print("[bench] done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
