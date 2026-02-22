# VitalPath AI Bench (Data Generator)

This folder contains a small benchmark runner for VitalPath AI.

It repeatedly calls the routing endpoint:
- `POST /api/algo/calculate`

and writes results to **JSONL** in `docs/bench/`.

## Start the backend first

From repo root:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Confirm backend is live:
- Docs: http://127.0.0.1:8000/docs

## Run a basic benchmark

From repo root:

```bash
python backend/bench/run_bench.py --trials 20 --warmups 3 --tag bench --out-dir docs/bench
```

Outputs:
- `docs/bench/results_bench_*.jsonl`
- `docs/bench/runmeta_bench_*.json`

## Optional: include exploration

This increases payload size but enables explored-vs-time plots:

```bash
python backend/bench/run_bench.py --include-exploration --trials 5 --warmups 1 --tag exploration --out-dir docs/bench
```
