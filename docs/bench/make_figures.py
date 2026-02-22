"""
VitalPath AI Bench Figure Generator
----------------------------

Reads JSONL output produced by `backend/bench/run_bench.py` and writes charts into docs/figures/.

Usage:
  python docs/bench/make_figures.py --input docs/bench/results_bench_*.jsonl --out docs/figures --theme dark

Outputs:
- latency_boxplot_algo_time.png
- latency_boxplot_total_time.png
- latency_cdf_algo_time.png
- speedup_hist.png
- explored_vs_algo_time.png (if explored_count exists)
- summary_*.md (quick stats + embed snippets)
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import matplotlib.pyplot as plt


# Neon-on-black palette (pairs well with your terminal UI)
COLORS = {
    "dijkstra": "#3B82F6",  # bright blue
    "bmsssp": "#A855F7",    # bright purple
    "grid": "#334155",      # slate
    "text": "#E2E8F0",      # light
    "muted": "#94A3B8",     # muted light
    "bg": "#0B1020",        # deep navy/black
}


@dataclass
class Row:
    label: str
    scenario_type: str
    algorithm: str
    trial_idx: int
    ok: bool

    algorithm_time_ms: Optional[float]
    execution_time_ms: Optional[float]
    total_time_ms: Optional[float]
    wall_time_ms: float

    explored_count: Optional[int]
    total_distance_m: Optional[float]
    total_time_s: Optional[float]


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


def load_rows(jsonl_path: Path) -> List[Row]:
    rows: List[Row] = []
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        rows.append(
            Row(
                label=str(d.get("label", "")),
                scenario_type=str(d.get("scenario_type", "")),
                algorithm=str(d.get("algorithm", "")),
                trial_idx=int(d.get("trial_idx", -1)),
                ok=bool(d.get("ok", False)),
                algorithm_time_ms=_safe_float(d.get("algorithm_time_ms")),
                execution_time_ms=_safe_float(d.get("execution_time_ms")),
                total_time_ms=_safe_float(d.get("total_time_ms")),
                wall_time_ms=float(d.get("wall_time_ms", 0.0) or 0.0),
                explored_count=_safe_int(d.get("explored_count")),
                total_distance_m=_safe_float(d.get("total_distance_m")),
                total_time_s=_safe_float(d.get("total_time_s")),
            )
        )
    return rows


def find_latest_results(bench_dir: Path, prefix: str = "results_") -> Optional[Path]:
    if not bench_dir.exists():
        return None
    files = sorted(bench_dir.glob(f"{prefix}*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def _pick_algo_time_ms(r: Row) -> Optional[float]:
    return r.algorithm_time_ms or r.execution_time_ms


def _pick_total_time_ms(r: Row) -> Optional[float]:
    return r.total_time_ms or (r.wall_time_ms if r.wall_time_ms > 0 else None)


def _theme_axes(ax, theme: str):
    if theme == "dark":
        ax.set_facecolor(COLORS["bg"])
        ax.figure.set_facecolor(COLORS["bg"])
        ax.tick_params(colors=COLORS["text"])
        for spine in ax.spines.values():
            spine.set_color(COLORS["grid"])
        ax.yaxis.label.set_color(COLORS["text"])
        ax.xaxis.label.set_color(COLORS["text"])
        ax.title.set_color(COLORS["text"])
        ax.grid(True, color=COLORS["grid"], alpha=0.35)
    else:
        ax.grid(True, alpha=0.25)


def _save(fig, out_path: Path, theme: str):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if theme == "dark":
        fig.savefig(out_path, dpi=160, bbox_inches="tight", facecolor=COLORS["bg"])
    else:
        fig.savefig(out_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def _stats(xs: List[float]) -> Dict[str, float]:
    xs = sorted(xs)
    if not xs:
        return {}
    def pct(p: float) -> float:
        if len(xs) == 1:
            return xs[0]
        k = (len(xs) - 1) * p
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return xs[int(k)]
        return xs[f] * (c - k) + xs[c] * (k - f)

    return {
        "n": float(len(xs)),
        "mean": float(statistics.fmean(xs)),
        "stdev": float(statistics.pstdev(xs)) if len(xs) > 1 else 0.0,
        "p50": float(pct(0.50)),
        "p90": float(pct(0.90)),
        "p99": float(pct(0.99)),
        "min": float(xs[0]),
        "max": float(xs[-1]),
    }


def latency_boxplot(rows: List[Row], out_dir: Path, theme: str, use_total: bool):
    label = "total_time" if use_total else "algo_time"
    title = "Total latency (ms)" if use_total else "Algorithm latency (ms)"

    by_algo: Dict[str, List[float]] = {"dijkstra": [], "bmsssp": []}
    for r in rows:
        if not r.ok:
            continue
        v = _pick_total_time_ms(r) if use_total else _pick_algo_time_ms(r)
        if v is None:
            continue
        if r.algorithm in by_algo:
            by_algo[r.algorithm].append(v)

    fig, ax = plt.subplots(figsize=(7.8, 4.2))
    _theme_axes(ax, theme)

    data = [by_algo["dijkstra"], by_algo["bmsssp"]]
    bp = ax.boxplot(data, labels=["Dijkstra", "BM-SSSP"], patch_artist=True)

    if theme == "dark":
        # Color the boxes
        for patch, c in zip(bp["boxes"], [COLORS["dijkstra"], COLORS["bmsssp"]]):
            patch.set_facecolor(c)
            patch.set_alpha(0.5)
            patch.set_edgecolor(COLORS["text"])
        for elem in ["whiskers", "caps", "medians"]:
            for item in bp[elem]:
                item.set_color(COLORS["text"])
        for flier in bp["fliers"]:
            flier.set_markeredgecolor(COLORS["muted"])
            flier.set_alpha(0.6)

    ax.set_title(title)
    ax.set_ylabel("ms")

    out_path = out_dir / f"latency_boxplot_{label}.png"
    _save(fig, out_path, theme)


def latency_cdf(rows: List[Row], out_dir: Path, theme: str):
    by_algo: Dict[str, List[float]] = {"dijkstra": [], "bmsssp": []}
    for r in rows:
        if not r.ok:
            continue
        v = _pick_algo_time_ms(r)
        if v is None:
            continue
        if r.algorithm in by_algo:
            by_algo[r.algorithm].append(v)

    fig, ax = plt.subplots(figsize=(7.8, 4.2))
    _theme_axes(ax, theme)

    for algo in ["dijkstra", "bmsssp"]:
        xs = sorted(by_algo[algo])
        if not xs:
            continue
        ys = [(i + 1) / len(xs) for i in range(len(xs))]
        ax.plot(xs, ys, linewidth=2.2, label=algo.upper(), color=COLORS[algo])

    ax.set_title("Algorithm latency CDF (lower is better)")
    ax.set_xlabel("ms")
    ax.set_ylabel("CDF")
    ax.legend(loc="lower right", frameon=False)

    out_path = out_dir / "latency_cdf_algo_time.png"
    _save(fig, out_path, theme)


def speedup_hist(rows: List[Row], out_dir: Path, theme: str):
    """
    Computes speedup ratios by matching runs on (label, scenario_type, trial_idx).
    ratio = dijkstra_time / bmsssp_time
    """
    key = lambda r: (r.label, r.scenario_type, r.trial_idx)
    d_map: Dict[Tuple[str, str, int], float] = {}
    b_map: Dict[Tuple[str, str, int], float] = {}

    for r in rows:
        if not r.ok:
            continue
        v = _pick_algo_time_ms(r)
        if v is None:
            continue
        if r.algorithm == "dijkstra":
            d_map[key(r)] = v
        elif r.algorithm == "bmsssp":
            b_map[key(r)] = v

    ratios: List[float] = []
    for k, dv in d_map.items():
        bv = b_map.get(k)
        if bv and bv > 0:
            ratios.append(dv / bv)

    if not ratios:
        return

    fig, ax = plt.subplots(figsize=(7.8, 4.2))
    _theme_axes(ax, theme)

    ax.hist(ratios, bins=16, color=COLORS["text"] if theme != "dark" else "#22C55E", alpha=0.8)
    ax.axvline(1.0, linestyle="--", linewidth=1.6, color=COLORS["muted"] if theme == "dark" else "gray")
    ax.set_title("Speedup ratio (Dijkstra / BM-SSSP)")
    ax.set_xlabel("× ( > 1 means BM-SSSP faster )")
    ax.set_ylabel("count")

    out_path = out_dir / "speedup_hist.png"
    _save(fig, out_path, theme)


def explored_vs_algo_time(rows: List[Row], out_dir: Path, theme: str):
    pts: Dict[str, List[Tuple[int, float]]] = {"dijkstra": [], "bmsssp": []}
    for r in rows:
        if not r.ok:
            continue
        if r.explored_count is None:
            continue
        v = _pick_algo_time_ms(r)
        if v is None:
            continue
        if r.algorithm in pts:
            pts[r.algorithm].append((r.explored_count, v))

    if not pts["dijkstra"] and not pts["bmsssp"]:
        return

    fig, ax = plt.subplots(figsize=(7.8, 4.2))
    _theme_axes(ax, theme)

    for algo in ["dijkstra", "bmsssp"]:
        xs = [p[0] for p in pts[algo]]
        ys = [p[1] for p in pts[algo]]
        if xs:
            ax.scatter(xs, ys, s=26, alpha=0.85, color=COLORS[algo], label=algo.upper())

    ax.set_title("Exploration footprint vs algorithm time")
    ax.set_xlabel("explored_count (edges)")
    ax.set_ylabel("algorithm time (ms)")
    ax.legend(loc="upper left", frameon=False)

    out_path = out_dir / "explored_vs_algo_time.png"
    _save(fig, out_path, theme)


def write_summary(rows: List[Row], out_md: Path, figures_dir: Path):
    # Collect stats per algo
    by_algo: Dict[str, List[float]] = {"dijkstra": [], "bmsssp": []}
    by_algo_total: Dict[str, List[float]] = {"dijkstra": [], "bmsssp": []}

    for r in rows:
        if not r.ok:
            continue
        a = r.algorithm
        if a not in by_algo:
            continue
        v = _pick_algo_time_ms(r)
        vt = _pick_total_time_ms(r)
        if v is not None:
            by_algo[a].append(v)
        if vt is not None:
            by_algo_total[a].append(vt)

    d_stats = _stats(by_algo["dijkstra"])
    b_stats = _stats(by_algo["bmsssp"])
    d_stats_t = _stats(by_algo_total["dijkstra"])
    b_stats_t = _stats(by_algo_total["bmsssp"])

    def fmt(s: Dict[str, float], k: str) -> str:
        return f"{s.get(k, float('nan')):.2f}" if k in s else "—"

    md = []
    md.append("# Benchmark summary\n")
    md.append("## Algorithm time (ms)\n")
    md.append("| Algo | n | mean | p50 | p90 | p99 | min | max |\n")
    md.append("|---|---:|---:|---:|---:|---:|---:|---:|\n")
    for name, st in [("Dijkstra", d_stats), ("BM-SSSP", b_stats)]:
        md.append(
            f"| {name} | {int(st.get('n', 0))} | {fmt(st,'mean')} | {fmt(st,'p50')} | {fmt(st,'p90')} | {fmt(st,'p99')} | {fmt(st,'min')} | {fmt(st,'max')} |\n"
        )

    md.append("\n## Total time (ms)\n")
    md.append("| Algo | n | mean | p50 | p90 | p99 | min | max |\n")
    md.append("|---|---:|---:|---:|---:|---:|---:|---:|\n")
    for name, st in [("Dijkstra", d_stats_t), ("BM-SSSP", b_stats_t)]:
        md.append(
            f"| {name} | {int(st.get('n', 0))} | {fmt(st,'mean')} | {fmt(st,'p50')} | {fmt(st,'p90')} | {fmt(st,'p99')} | {fmt(st,'min')} | {fmt(st,'max')} |\n"
        )

    md.append("\n## Figures\n")
    for fn in [
        "latency_boxplot_algo_time.png",
        "latency_boxplot_total_time.png",
        "latency_cdf_algo_time.png",
        "speedup_hist.png",
        "explored_vs_algo_time.png",
    ]:
        p = figures_dir / fn
        if p.exists():
            md.append(f"### {fn}\n\n![]({p.as_posix()})\n\n")

    out_md.write_text("".join(md), encoding="utf-8")


def generate_all(jsonl_path: Path, out_dir: Path, theme: str) -> Path:
    rows = [r for r in load_rows(jsonl_path) if r.ok]
    out_dir.mkdir(parents=True, exist_ok=True)

    latency_boxplot(rows, out_dir, theme=theme, use_total=False)
    latency_boxplot(rows, out_dir, theme=theme, use_total=True)
    latency_cdf(rows, out_dir, theme=theme)
    speedup_hist(rows, out_dir, theme=theme)
    explored_vs_algo_time(rows, out_dir, theme=theme)

    # Write summary next to input, but referencing the figures
    summary_name = f"summary_{jsonl_path.stem}.md"
    summary_path = jsonl_path.parent / summary_name
    write_summary(rows, summary_path, figures_dir=out_dir)
    return summary_path


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate benchmark figures for VitalPath AI.")
    ap.add_argument("--input", required=False, help="Path to JSONL results file")
    ap.add_argument("--out", default="docs/figures", help="Output directory for PNG figures")
    ap.add_argument("--theme", choices=["dark", "light"], default="dark", help="Plot theme")
    ap.add_argument("--bench-dir", default="docs/bench", help="Directory to search for latest results if --input not given")
    args = ap.parse_args()

    out_dir = Path(args.out).resolve()
    if args.input:
        jsonl = Path(args.input).resolve()
    else:
        latest = find_latest_results(Path(args.bench_dir).resolve())
        if not latest:
            print("[fig] No results_*.jsonl found. Run backend/bench/run_bench.py first.")
            return 2
        jsonl = latest

    if not jsonl.exists():
        print(f"[fig] input not found: {jsonl}")
        return 2

    summary = generate_all(jsonl, out_dir=out_dir, theme=args.theme)
    print(f"[fig] wrote figures to: {out_dir}")
    print(f"[fig] wrote summary: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
