import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type BenchmarkChartsProps = {
  dTimesMs: number[];
  bTimesMs: number[];
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base];
  const b = sorted[Math.min(sorted.length - 1, base + 1)];
  return a + (b - a) * rest;
}

function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function buildHistogram(a: number[], b: number[], bins: number) {
  const all = [...a, ...b].filter((x) => Number.isFinite(x) && x >= 0);
  if (!all.length) return [];

  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1e-6, max - min);
  const width = span / bins;

  const countsA = new Array(bins).fill(0);
  const countsB = new Array(bins).fill(0);

  const add = (arr: number[], bucket: number[]) => {
    for (const v of arr) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
      bucket[idx] += 1;
    }
  };

  add(a, countsA);
  add(b, countsB);

  const label = (x: number) => (x < 1000 ? `${x.toFixed(0)}ms` : `${(x / 1000).toFixed(2)}s`);

  return countsA.map((_, i) => {
    const lo = min + i * width;
    const hi = lo + width;
    return { bin: `${label(lo)}–${label(hi)}`, d: countsA[i], b: countsB[i] };
  });
}

export default function AlgoBenchmarkCharts({ dTimesMs, bTimesMs }: BenchmarkChartsProps) {
  const data = useMemo(() => buildHistogram(dTimesMs, bTimesMs, 12), [dTimesMs, bTimesMs]);

  const summary = useMemo(() => {
    const d = [...dTimesMs].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    const b = [...bTimesMs].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);

    const mean = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN);
    return {
      dMean: mean(d),
      bMean: mean(b),
      dP50: quantile(d, 0.5),
      bP50: quantile(b, 0.5),
      dP90: quantile(d, 0.9),
      bP90: quantile(b, 0.9),
      n: Math.min(d.length, b.length),
    };
  }, [dTimesMs, bTimesMs]);

  if (!data.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] font-mono text-gray-300 mb-2">Benchmark distribution (exec time)</div>
        <div className="h-[180px] w-full">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="bin"
                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.72)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                interval={2}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.72)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
                width={34}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 11,
                }}
              />
              <Legend
                wrapperStyle={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.7)',
                }}
              />
              <Bar dataKey="d" name="Dijkstra" fill="#3B82F6" opacity={0.75} />
              <Bar dataKey="b" name="Duan–Mao" fill="#A855F7" opacity={0.75} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] font-mono text-gray-400 mt-1">
          N={summary.n} • Mean: D {fmt(summary.dMean)} | Duan {fmt(summary.bMean)} • P50: D {fmt(summary.dP50)} | Duan {fmt(summary.bP50)} • P90: D {fmt(summary.dP90)} | Duan {fmt(summary.bP90)}
        </div>
      </div>
    </div>
  );
}
