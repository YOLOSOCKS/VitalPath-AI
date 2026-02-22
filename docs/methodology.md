# Benchmark methodology (VitalPath AI)

This document explains how we produce the benchmark charts in `docs/figures/`.

## What we measure

The backend route response exposes three timing fields:

- `execution_time_ms` — kept for frontend compatibility; represents **pathfinding time**.
- `algorithm_time_ms` — optional; **pathfinding time** (preferred if present).
- `total_time_ms` — optional; end-to-end timing (may include snap/build overhead).

The benchmark runner also records:

- `wall_time_ms` — client wall clock around the HTTP request (fallback).
- `explored_count` — optional; number of explored edges (only when `include_exploration=true`).

Charts generally use:
- **Algorithm time** (`algorithm_time_ms` if present else `execution_time_ms`)
- **Total time** (`total_time_ms` if present else `wall_time_ms`)

## Warmup policy

The runner performs `--warmups` requests before recording trials.
Warmups reduce noise from:
- cold Python imports
- JIT/Node server warmup (BM-SSSP runner)
- OSMnx caching behavior

## Repeat counts

Default:
- `--trials 20` per (case × algorithm)
- `--warmups 3`

For exploration plotting:
- `--trials 5` and `--include-exploration` (payload is larger)

## Reproducibility

Each run writes:
- `docs/bench/results_*.jsonl` — rows of results
- `docs/bench/runmeta_*.json` — machine + parameters + cases

We recommend keeping result files **out of git** and committing only:
- charts in `docs/figures/`
- methodology
- scripts

## Notes & limitations

- Results are environment-dependent (CPU, OS, background load).
- Small graphs may not show asymptotic wins due to constant factors.
- Community geocoding / Overpass services may introduce variability; demos should use cached graphs.

## Safety / compliance disclaimer

VitalPath AI is a hackathon prototype. Benchmarks represent local engineering measurements and are **not** operational certifications.
