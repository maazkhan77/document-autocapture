import type { EngineConfig } from './types';

export const defaultEngineConfig: EngineConfig = {
  detectionWidth: 480,
  fallbackDetectionWidth: 320,
  fallbackFps: 9,
  stabilityWindowMs: 320,
  emaAlpha: 0.25,
  minAreaFraction: 0.08,
  maxAreaFraction: 0.96,
  minAspectRatio: 0.6,
  maxAspectRatio: 1.9,
  confidenceThreshold: 0.42,
  movementThresholdPx: 0,
  movementThresholdRatio: 0.015,
  minStableConfidence: 0.36,
  edgeLowThreshold: 50,
  edgeHighThreshold: 150,
  blurVarianceMin: 24,
  brightnessMin: 45,
  brightnessMax: 215,
  glareRatioMax: 0.12,
  contourLimit: 64,
  candidateTopK: 24,
  minRectangularity: 0.72,
  edgeTouchMarginPx: 8,
  ambiguityScoreMargin: 0.04,
  identitySwitchThresholdPx: 46,
  detectionFrameBudgetMs: 25,
  workerHardCeilingMs: 80,
  contourEnabled: false,
  houghSecondaryEnabled: true,
  houghEdgeDensityMin: 0.005,
  houghEdgeDensityMax: 0.25,
  houghMinLineLengthDiagRatio: 0.12,
  houghMaxLineGapDiagRatio: 0.02,
  houghOrthogonalityMinDeg: 60,
  houghOrthogonalityMaxDeg: 120,
  scoreWeights: {
    areaFraction: 0.2,
    aspectPlausibility: 0.16,
    edgeContrast: 0.2,
    interiorHomogeneity: 0.18,
    cornerAngleCloseness: 0.16,
    borderPenalty: 0.1,
  },
  debug: false,
};

function normalizeScoreWeights(
  weights: EngineConfig['scoreWeights'],
): EngineConfig['scoreWeights'] {
  const sum =
    weights.areaFraction +
    weights.aspectPlausibility +
    weights.edgeContrast +
    weights.interiorHomogeneity +
    weights.cornerAngleCloseness +
    weights.borderPenalty;
  if (sum <= 0) {
    return defaultEngineConfig.scoreWeights;
  }
  if (Math.abs(sum - 1.0) < 0.001) {
    return weights;
  }
  return {
    areaFraction: weights.areaFraction / sum,
    aspectPlausibility: weights.aspectPlausibility / sum,
    edgeContrast: weights.edgeContrast / sum,
    interiorHomogeneity: weights.interiorHomogeneity / sum,
    cornerAngleCloseness: weights.cornerAngleCloseness / sum,
    borderPenalty: weights.borderPenalty / sum,
  };
}

export function mergeEngineConfig(override?: Partial<EngineConfig>): EngineConfig {
  if (!override) {
    return defaultEngineConfig;
  }
  const merged = {
    ...defaultEngineConfig,
    ...override,
    scoreWeights: {
      ...defaultEngineConfig.scoreWeights,
      ...(override.scoreWeights ?? {}),
    },
  };
  merged.scoreWeights = normalizeScoreWeights(merged.scoreWeights);
  return merged;
}
