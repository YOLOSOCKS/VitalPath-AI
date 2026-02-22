# Bench Figures (Docs)

This folder converts `docs/bench/results_*.jsonl` into PNGs stored in `docs/figures/`.

## Requirements
- Python 3.10+
- `matplotlib` (install if missing)

```bash
pip install matplotlib
```

## Generate figures
From repo root, pick the latest results file in `docs/bench/` and run:

```bash
python docs/bench/make_figures.py \
  --input docs/bench/results_bench_YYYYMMDD_HHMMSS.jsonl \
  --out docs/figures \
  --theme dark
```

Outputs (example):
- `docs/figures/latency_boxplot_algo_time.png`
- `docs/figures/latency_boxplot_total_time.png`
- `docs/figures/latency_cdf_algo_time.png`
- `docs/figures/speedup_hist.png`
- `docs/figures/explored_vs_algo_time.png` (only if explored_count exists)
- `docs/bench/summary_bench_YYYYMMDD_HHMMSS.md`

## Jupyter option
Open `docs/notebooks/bench_analysis.ipynb` and run all cells.
