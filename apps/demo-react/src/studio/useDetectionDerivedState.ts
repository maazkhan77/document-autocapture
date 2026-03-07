import { useMemo } from 'react';
import type { useDocumentAutoCapture } from 'react-document-autocapture';

type SdkResult = ReturnType<typeof useDocumentAutoCapture>;

export function useDetectionDerivedState(
  detection: SdkResult['detection'],
  quality: SdkResult['quality'],
  stability: SdkResult['stability'],
  guidance: SdkResult['guidance'],
  error: SdkResult['error'],
  isRunning: boolean,
  autoCapture: boolean,
) {
  const statusLabel = useMemo(() => {
    if (error) {
      return `Error: ${error.message}`;
    }
    if (!isRunning) {
      return 'Idle';
    }
    return guidance ?? 'Initializing...';
  }, [error, guidance, isRunning]);

  const qualityScore = useMemo(() => {
    if (!quality) {
      return 0;
    }
    const brightnessBand = quality.brightness.ok ? 1 : 0.55;
    const blurBand = quality.blur.ok ? 1 : 0.55;
    const glareBand = quality.glare.ok ? 1 : 0.6;
    return Math.round(100 * brightnessBand * blurBand * glareBand);
  }, [quality]);

  const detectionScore = Math.round((detection?.bestCandidate?.score ?? 0) * 100);
  const detectionFps = detection?.timings?.totalMs
    ? Math.round(1000 / detection.timings.totalMs)
    : 0;

  const autoCaptureGateReason = useMemo(() => {
    if (!autoCapture) {
      return 'disabled';
    }
    if (detection?.status !== 'found') {
      return 'document_not_found';
    }
    if (!quality) {
      return 'quality_pending';
    }
    if (!quality.ok) {
      if (!quality.brightness.ok) {
        return 'quality_brightness';
      }
      if (!quality.glare.ok) {
        return 'quality_glare';
      }
      if (!quality.blur.ok) {
        return 'quality_blur';
      }
      if (!quality.area.ok) {
        return 'quality_area';
      }
      return 'quality_blocked';
    }
    if (!stability?.stable) {
      return 'hold_steady';
    }
    return 'ready';
  }, [autoCapture, detection?.status, quality, stability?.stable]);

  return {
    statusLabel,
    qualityScore,
    detectionScore,
    detectionFps,
    autoCaptureGateReason,
  };
}
