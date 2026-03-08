import type { EngineConfig, FrameProcessResult } from '@document-autocapture/core-engine';
import type { ScannerConfig } from '../types';

interface WorkerFrameTelemetry {
  cvFallbackReason?: string;
  cvAttempted?: boolean;
  mlReady?: boolean;
  mlModelLoaded?: boolean;
  mlInferenceUsed?: boolean;
  mlRescueUsed?: boolean;
  graphAttempted?: boolean;
  cocoAttempted?: boolean;
  cocoReady?: boolean;
  cocoUsed?: boolean;
  providerUsed?: string;
  providerRejectReason?: string;
}

export interface AutoCaptureReadiness {
  readyForCapture: boolean;
  captureAreaReady: boolean;
  captureSourceReady: boolean;
  captureAreaFraction: number;
  captureMinAreaFraction: number;
  captureSource: string;
  captureScore: number;
  captureCorner: number;
  captureBorder: number;
}

export function evaluateAutoCaptureReadiness(
  config: ScannerConfig,
  engineConfig: EngineConfig,
  result: FrameProcessResult,
): AutoCaptureReadiness {
  const captureMinAreaFraction = Math.max(
    config.minAreaFraction ?? engineConfig.minAreaFraction,
    config.autoCaptureMinAreaFraction ?? 0.14,
  );
  const captureAreaFraction = result.detection.bestCandidate?.metrics.areaFraction ?? 0;
  const captureAreaReady = captureAreaFraction >= captureMinAreaFraction;
  const captureSource = result.detection.bestCandidate?.source ?? 'contour';
  const captureScore = result.detection.bestCandidate?.score ?? 0;
  const captureCorner = result.detection.bestCandidate?.metrics.cornerAngleCloseness ?? 0;
  const captureBorder = result.detection.bestCandidate?.metrics.borderPenalty ?? 1;
  const captureSourceReady =
    captureSource === 'ml'
      ? captureScore >= 0.45
      : captureSource === 'hough'
        ? captureScore >= 0.58 && captureCorner >= 0.45 && captureBorder <= 0.24
        : captureScore >= 0.68 &&
          captureCorner >= 0.55 &&
          captureBorder <= 0.2 &&
          captureAreaFraction >= Math.max(captureMinAreaFraction, 0.16);

  const readyForCapture =
    config.autoCapture !== false &&
    result.detection.status === 'found' &&
    Boolean(result.quality?.ok) &&
    Boolean(result.stability?.stable) &&
    captureAreaReady &&
    captureSourceReady;

  return {
    readyForCapture,
    captureAreaReady,
    captureSourceReady,
    captureAreaFraction,
    captureMinAreaFraction,
    captureSource,
    captureScore,
    captureCorner,
    captureBorder,
  };
}

interface LogFrameDebugParams {
  frameCount: number;
  result: FrameProcessResult;
  telemetry?: WorkerFrameTelemetry;
  config: ScannerConfig;
  engineConfig: EngineConfig;
  autoCaptureStableStreak: number;
  lastCaptureAt: number;
}

export function logFrameDebug({
  frameCount,
  result,
  telemetry,
  config,
  engineConfig,
  autoCaptureStableStreak,
  lastCaptureAt,
}: LogFrameDebugParams): void {
  const det = result.detection;
  const q = result.quality;
  const s = result.stability;
  const best = det.bestCandidate;

  const detStatus = det.status;
  const detScore = best ? (best.score * 100).toFixed(1) + '%' : 'n/a';
  const detConfidence = best ? (best.confidence * 100).toFixed(1) + '%' : 'n/a';
  const detReject = det.rejectionReason ?? 'none';
  const detSource = det.source;
  const detCandidates = det.candidates.length;
  const cvFallbackReason = telemetry?.cvFallbackReason ?? 'none';
  const cvAttempted = telemetry?.cvAttempted ?? false;
  const mlRescue = telemetry?.mlRescueUsed ?? false;
  const mlTelemetry =
    telemetry
      ? ` cvAttempted=${cvAttempted} cvFallback=${cvFallbackReason} mlReady=${telemetry.mlReady} mlLoaded=${telemetry.mlModelLoaded} mlInfer=${telemetry.mlInferenceUsed} mlRescue=${mlRescue} graph=${telemetry.graphAttempted} coco=${telemetry.cocoAttempted} cocoReady=${telemetry.cocoReady} cocoUsed=${telemetry.cocoUsed} provider=${telemetry.providerUsed ?? 'n/a'} reject=${telemetry.providerRejectReason ?? 'none'}`
      : '';
  const detTimings = det.timings
    ? `${det.timings.totalMs.toFixed(1)}ms (gray:${det.timings.grayscaleMs.toFixed(0)} blur:${det.timings.blurMs.toFixed(0)} edge:${det.timings.edgesMs.toFixed(0)} cand:${det.timings.candidateMs.toFixed(0)} score:${det.timings.scoringMs.toFixed(0)})`
    : 'n/a';

  const qOk = q ? (q.ok ? '✅' : '❌') : '⏳';
  const qBright = q ? `${q.brightness.ok ? '✅' : '❌'} luma=${q.brightness.averageLuma.toFixed(0)}` : 'n/a';
  const qBlur = q ? `${q.blur.ok ? '✅' : '❌'} var=${q.blur.laplacianVariance.toFixed(1)}` : 'n/a';
  const qGlare = q ? `${q.glare.ok ? '✅' : '❌'} ratio=${(q.glare.highlightRatio * 100).toFixed(1)}%` : 'n/a';
  const qArea = q ? `${q.area.ok ? '✅' : '❌'} frac=${(q.area.areaFraction * 100).toFixed(1)}%` : 'n/a';

  const sStable = s ? (s.stable ? '✅' : '❌') : 'n/a';
  const sMs = s ? `${s.stableMs.toFixed(0)}ms` : 'n/a';
  const sMovement = s ? s.cornerMovement.toFixed(2) : 'n/a';

  const readiness = evaluateAutoCaptureReadiness(config, engineConfig, result);

  let gateBlock = 'READY';
  if (config.autoCapture === false) gateBlock = 'autoCapture=OFF';
  else if (det.status !== 'found') gateBlock = `detection=${detStatus} (${detReject})`;
  else if (!q) gateBlock = 'quality=pending';
  else if (!q.ok) {
    if (!q.brightness.ok) gateBlock = `quality:brightness FAIL (luma=${q.brightness.averageLuma.toFixed(0)})`;
    else if (!q.blur.ok) gateBlock = `quality:blur FAIL (var=${q.blur.laplacianVariance.toFixed(1)}, need≥${engineConfig.blurVarianceMin})`;
    else if (!q.glare.ok) gateBlock = `quality:glare FAIL (ratio=${(q.glare.highlightRatio * 100).toFixed(1)}%)`;
    else if (!q.area.ok) gateBlock = `quality:area FAIL (frac=${(q.area.areaFraction * 100).toFixed(1)}%)`;
    else gateBlock = 'quality=FAIL';
  } else if (!readiness.captureAreaReady) {
    gateBlock =
      `capture:area FAIL (frac=${(readiness.captureAreaFraction * 100).toFixed(1)}%, ` +
      `need≥${(readiness.captureMinAreaFraction * 100).toFixed(1)}%)`;
  } else if (!readiness.captureSourceReady) {
    gateBlock =
      `capture:source FAIL (src=${readiness.captureSource}, score=${(readiness.captureScore * 100).toFixed(1)}%, ` +
      `corner=${readiness.captureCorner.toFixed(2)}, border=${readiness.captureBorder.toFixed(2)})`;
  } else if (!s?.stable) gateBlock = `stability (${sMs}, movement=${sMovement})`;

  const requiredFrames = Math.max(1, Math.floor(config.autoCaptureConsecutiveStableFrames ?? 3));
  const cooldown = config.autoCaptureCooldownMs ?? 1400;
  const cooldownRemaining = Math.max(0, cooldown - (Date.now() - lastCaptureAt));

  console.warn(
    `[document-autocapture] frame#${frameCount} | ` +
      `det: ${detStatus} score=${detScore} conf=${detConfidence} reject=${detReject} src=${detSource} cands=${detCandidates}` +
      `${mlTelemetry} | ` +
      `quality: ${qOk} bright=${qBright} blur=${qBlur} glare=${qGlare} area=${qArea} | ` +
      `stable: ${sStable} ${sMs} mvmt=${sMovement} | ` +
      `gate: ${gateBlock} streak=${autoCaptureStableStreak}/${requiredFrames} cooldown=${cooldownRemaining}ms | ` +
      `timing: ${detTimings}`,
  );

  if (best) {
    console.warn(
      `[document-autocapture]   candidate metrics: ` +
        `areaFrac=${(best.metrics.areaFraction * 100).toFixed(1)}% ` +
        `aspect=${best.metrics.aspectPlausibility.toFixed(2)} ` +
        `edgeContrast=${best.metrics.edgeContrast.toFixed(2)} ` +
        `homogeneity=${best.metrics.interiorHomogeneity.toFixed(2)} ` +
        `cornerAngle=${best.metrics.cornerAngleCloseness.toFixed(2)} ` +
        `border=${best.metrics.borderPenalty.toFixed(2)} ` +
        `convexity=${best.convexity.toFixed(2)} ` +
        `edgeStrength=${best.edgeStrength.toFixed(2)} ` +
        `source=${best.source ?? 'contour'}`,
    );
  }
}
