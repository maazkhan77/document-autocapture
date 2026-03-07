import {
  borderPenalty,
  clamp,
  confidenceFromQuality,
  pickGuidanceCode,
  quadArea,
  rgbaToGrayscale,
  runQualityChecks,
  StabilityTracker,
  type DetectionCandidate,
  type DetectionDebugStageTimings,
  type DetectionRejectionReason,
  type EngineConfig,
  type FrameProcessResult,
  type Quad,
} from '@document-autocapture/core-engine';

export function patchFallbackState(
  result: FrameProcessResult,
  state: 'inactive' | 'armed' | 'active',
): FrameProcessResult {
  const debug = result.detection.debug;
  if (!debug) {
    return result;
  }
  return {
    ...result,
    detection: {
      ...result.detection,
      debug: {
        ...debug,
        fallbackState: state,
      },
    },
  };
}

export function isCvDetectionFound(result: FrameProcessResult): boolean {
  return (
    result.detection.status === 'found' &&
    result.detection.rejectionReason === 'none' &&
    Boolean(result.detection.bestCandidate)
  );
}

export function createMlStageTimings(
  elapsedMs: number,
  base?: DetectionDebugStageTimings,
): DetectionDebugStageTimings {
  if (base) {
    return base;
  }
  const clamped = Math.max(0, elapsedMs);
  return {
    grayscaleMs: 0,
    blurMs: 0,
    edgesMs: 0,
    candidateMs: clamped,
    scoringMs: 0,
    totalMs: clamped,
  };
}

export function calcAspect(quad: Quad): number {
  const top = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  const bottom = Math.hypot(
    quad.bottomRight.x - quad.bottomLeft.x,
    quad.bottomRight.y - quad.bottomLeft.y,
  );
  const left = Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y);
  const right = Math.hypot(
    quad.bottomRight.x - quad.topRight.x,
    quad.bottomRight.y - quad.topRight.y,
  );
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  if (height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return width / height;
}

/** @deprecated Use `borderPenalty` from `@document-autocapture/core-engine` directly. */
export const calcBorderPenalty = borderPenalty;

export function sampleMlEdgeSupport(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  threshold = 20,
): number {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let hits = 0;
  let total = 0;

  const luma = (x: number, y: number): number => {
    const sx = Math.max(0, Math.min(width - 1, x));
    const sy = Math.max(0, Math.min(height - 1, y));
    const idx = (sy * width + sx) * 4;
    return 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
  };

  for (let edge = 0; edge < 4; edge += 1) {
    const start = points[edge];
    const end = points[(edge + 1) % 4];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t);
      const gx = Math.abs(luma(x + 1, y) - luma(x - 1, y));
      const gy = Math.abs(luma(x, y + 1) - luma(x, y - 1));
      total += 1;
      if (gx + gy >= threshold) {
        hits += 1;
      }
    }
  }

  return hits / Math.max(1, total);
}

export function percentileFromHistogram(
  histogram: Uint32Array,
  percentile: number,
  total: number,
): number {
  if (total <= 0) {
    return 0;
  }
  const target = Math.max(0, Math.min(1, percentile)) * total;
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= target) {
      return i;
    }
  }
  return histogram.length - 1;
}

export interface FuseMlResultParams {
  mlQuad: Quad;
  mlConfidence: number;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  nowMs: number;
  elapsedMs: number;
  engineConfig: EngineConfig;
  minCvConfidence: number;
  stabilityTracker: StabilityTracker;
  grayBuffer?: Uint8ClampedArray;
  baseTimings?: DetectionDebugStageTimings;
  debugEnabled: boolean;
}

export interface FuseMlResultOutput {
  result: FrameProcessResult;
  grayBuffer?: Uint8ClampedArray;
}

export function fuseMlResult({
  mlQuad,
  mlConfidence,
  rgba,
  width,
  height,
  nowMs,
  elapsedMs,
  engineConfig,
  minCvConfidence,
  stabilityTracker,
  grayBuffer,
  baseTimings,
  debugEnabled,
}: FuseMlResultParams): FuseMlResultOutput {
  const area = quadArea(mlQuad);
  const areaFraction = area / Math.max(1, width * height);
  const aspect = calcAspect(mlQuad);
  const borderPenaltyVal = borderPenalty(mlQuad, width, height, engineConfig.edgeTouchMarginPx);
  const edgeSupport = sampleMlEdgeSupport(rgba, width, height, mlQuad);

  let rejectionReason: DetectionRejectionReason = 'none';
  const mlConfidenceGate = Math.min(engineConfig.confidenceThreshold, minCvConfidence);
  if (mlConfidence < mlConfidenceGate) {
    rejectionReason = 'low_confidence';
  } else if (borderPenaltyVal > 0.3) {
    rejectionReason = 'edge_touch';
  } else if (aspect < engineConfig.minAspectRatio || aspect > engineConfig.maxAspectRatio) {
    rejectionReason = 'aspect_invalid';
  }

  const nextGrayBuffer = rgbaToGrayscale(rgba, width, height, grayBuffer);
  const mlQualityConfig: EngineConfig = {
    ...engineConfig,
    minAreaFraction: Math.max(0.04, Math.min(engineConfig.minAreaFraction, 0.06)),
  };
  const quality = runQualityChecks(rgba, nextGrayBuffer, width, height, mlQuad, mlQualityConfig);
  if (!quality.ok) {
    rejectionReason = 'quality_fail';
  }

  const qualityConfidence = confidenceFromQuality(quality);
  const dynamicMovementThresholdPx = Math.max(
    engineConfig.movementThresholdPx,
    engineConfig.movementThresholdRatio * Math.hypot(width, height),
  );

  const stability = stabilityTracker.update({
    nowMs,
    quad: rejectionReason === 'none' ? mlQuad : undefined,
    confidence: mlConfidence * qualityConfidence,
    movementThresholdPx: dynamicMovementThresholdPx,
  });

  const candidate: DetectionCandidate = {
    quad: mlQuad,
    source: 'ml',
    score: mlConfidence,
    confidence: mlConfidence,
    metrics: {
      areaFraction,
      aspectPlausibility: clamp(1 - Math.abs(aspect - 1) / 1.8, 0, 1),
      edgeContrast: edgeSupport,
      interiorHomogeneity: 0.5,
      cornerAngleCloseness: 0.8,
      borderPenalty: borderPenaltyVal,
    },
    area,
    perimeter:
      Math.hypot(mlQuad.topRight.x - mlQuad.topLeft.x, mlQuad.topRight.y - mlQuad.topLeft.y) +
      Math.hypot(
        mlQuad.bottomRight.x - mlQuad.topRight.x,
        mlQuad.bottomRight.y - mlQuad.topRight.y,
      ) +
      Math.hypot(
        mlQuad.bottomLeft.x - mlQuad.bottomRight.x,
        mlQuad.bottomLeft.y - mlQuad.bottomRight.y,
      ) +
      Math.hypot(mlQuad.topLeft.x - mlQuad.bottomLeft.x, mlQuad.topLeft.y - mlQuad.bottomLeft.y),
    convexity: 0.9,
    edgeStrength: edgeSupport,
  };

  const timings = createMlStageTimings(elapsedMs, baseTimings);
  const detected = rejectionReason === 'none';
  const guidance = pickGuidanceCode({
    detected,
    quality,
    stable: stability.stable,
    areaFraction,
    minAreaFraction: mlQualityConfig.minAreaFraction,
    ambiguous: false,
    rejectionReason,
  });

  return {
    result: {
      detection: {
        source: 'ml',
        status: detected ? 'found' : 'not_found',
        bestCandidate: detected ? candidate : undefined,
        candidates: detected ? [candidate] : [],
        rejectionReason,
        timings,
        debug: debugEnabled
          ? {
              candidateCount: detected ? 1 : 0,
              topScores: detected ? [candidate.score] : [],
              bestScore: detected ? candidate.score : 0,
              secondBestScore: 0,
              ambiguityMargin: detected ? candidate.score : 0,
              proposalSources: ['ml'],
              fallbackState: 'active',
              stageMs: timings,
            }
          : undefined,
      },
      quality,
      stability,
      guidance,
    },
    grayBuffer: nextGrayBuffer,
  };
}
