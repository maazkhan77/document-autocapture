import type { DetectionResult, QualityResult } from '@document-autocapture/core-engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QualityScoreSummary, TelemetrySample } from './types';

export function useStudioTelemetry(detection?: DetectionResult, quality?: QualityResult) {
  const [telemetry, setTelemetry] = useState<TelemetrySample[]>([]);
  const telemetryBufferRef = useRef<TelemetrySample[]>([]);

  useEffect(() => {
    if (!detection) {
      return;
    }
    const fps = detection.timings?.totalMs ? 1000 / Math.max(1, detection.timings.totalMs) : 0;
    const detectionScore = detection.bestCandidate?.score ?? 0;
    const qualityScore =
      quality && quality.ok
        ? 1
        : quality
          ? (quality.brightness.ok ? 0.25 : 0) +
            (quality.blur.ok ? 0.25 : 0) +
            (quality.glare.ok ? 0.25 : 0) +
            (quality.area.ok ? 0.25 : 0)
          : 0;
    const sample: TelemetrySample = {
      ts: Date.now(),
      fps,
      detectionScore,
      qualityScore,
    };
    telemetryBufferRef.current.push(sample);
    if (telemetryBufferRef.current.length > 640) {
      telemetryBufferRef.current = telemetryBufferRef.current.slice(-640);
    }
  }, [detection, quality]);

  useEffect(() => {
    const commitIntervalMs = 250;
    const timer = window.setInterval(() => {
      if (telemetryBufferRef.current.length === 0) {
        return;
      }
      const pending = telemetryBufferRef.current;
      telemetryBufferRef.current = [];
      setTelemetry((prev) => [...prev, ...pending].slice(-160));
    }, commitIntervalMs);
    return () => {
      window.clearInterval(timer);
      telemetryBufferRef.current = [];
    };
  }, []);

  const telemetrySummary = useMemo<QualityScoreSummary>(() => {
    if (telemetry.length === 0) {
      return {
        avgFps: 0,
        avgDetectionScore: 0,
        avgQualityScore: 0,
      };
    }
    const avgFps = telemetry.reduce((acc, sample) => acc + sample.fps, 0) / telemetry.length;
    const avgDetectionScore =
      telemetry.reduce((acc, sample) => acc + sample.detectionScore, 0) / telemetry.length;
    const avgQualityScore =
      telemetry.reduce((acc, sample) => acc + sample.qualityScore, 0) / telemetry.length;
    return {
      avgFps,
      avgDetectionScore,
      avgQualityScore,
    };
  }, [telemetry]);

  return {
    telemetry,
    telemetrySummary,
  };
}
