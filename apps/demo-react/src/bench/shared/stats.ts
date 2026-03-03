export interface Stats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length)));
  return sorted[idx];
}

export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[(sorted.length - 1) / 2];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    p95: percentile(sorted, 95),
  };
}
