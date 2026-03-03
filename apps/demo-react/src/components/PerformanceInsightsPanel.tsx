import { useMemo } from 'react';
import type { StudioController } from '../useStudioController';

interface PerformanceInsightsPanelProps {
  studio: StudioController;
}

function buildLine(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
): string {
  if (values.length === 0) {
    return '';
  }
  const span = Math.max(1e-6, max - min);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const normalized = (value - min) / span;
      const y = height - normalized * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function PerformanceInsightsPanel({ studio }: PerformanceInsightsPanelProps) {
  const chartWidth = 360;
  const chartHeight = 120;
  const chartModel = useMemo(() => {
    const detectionSeries = studio.telemetry.map((sample) => sample.detectionScore * 100);
    const qualitySeries = studio.telemetry.map((sample) => sample.qualityScore * 100);
    const fpsSeries = studio.telemetry.map((sample) => sample.fps);

    const minFps = Math.min(...fpsSeries, 0);
    const maxFps = Math.max(...fpsSeries, 1);

    return {
      detectionLine: buildLine(detectionSeries, chartWidth, chartHeight, 0, 100),
      qualityLine: buildLine(qualitySeries, chartWidth, chartHeight, 0, 100),
      fpsLine: buildLine(fpsSeries, chartWidth, chartHeight, minFps, maxFps),
    };
  }, [chartHeight, chartWidth, studio.telemetry]);

  return (
    <article className="panel insight-panel">
      <div className="panel-title-row">
        <h2>Performance Insights</h2>
        <span className="chip">Luxury Telemetry</span>
      </div>

      <div className="insight-grid">
        <div className="stat-card ok">
          <h3>AVG FPS</h3>
          <p>{studio.telemetrySummary.avgFps.toFixed(1)}</p>
        </div>
        <div className="stat-card ok">
          <h3>AVG Score</h3>
          <p>{Math.round(studio.telemetrySummary.avgDetectionScore * 100)}%</p>
        </div>
        <div className="stat-card ok">
          <h3>AVG Quality</h3>
          <p>{Math.round(studio.telemetrySummary.avgQualityScore * 100)}%</p>
        </div>
      </div>

      <div className="sparkline-wrap">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="sparkline" role="img" aria-label="Telemetry trends">
          <polyline points={chartModel.fpsLine} fill="none" stroke="rgba(89, 180, 255, 0.95)" strokeWidth="2" />
          <polyline
            points={chartModel.detectionLine}
            fill="none"
            stroke="rgba(34, 212, 168, 0.92)"
            strokeWidth="2"
          />
          <polyline
            points={chartModel.qualityLine}
            fill="none"
            stroke="rgba(255, 181, 71, 0.95)"
            strokeWidth="2"
          />
        </svg>
        <div className="sparkline-legend">
          <span>FPS</span>
          <span>Detection</span>
          <span>Quality</span>
        </div>
      </div>
    </article>
  );
}
