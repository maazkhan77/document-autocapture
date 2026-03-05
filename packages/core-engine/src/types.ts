export type ExecutionMode = 'best' | 'standard' | 'fallback';
export type DetectorSource = 'cv' | 'ml';
export type ProposalSource = 'contour' | 'hough' | 'ml' | 'coco';
export type FallbackState = 'inactive' | 'armed' | 'active';
export type DetectionRejectionReason =
  | 'none'
  | 'low_confidence'
  | 'edge_touch'
  | 'aspect_invalid'
  | 'quality_fail';

export interface Point {
  x: number;
  y: number;
}

export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface DetectionMetrics {
  areaFraction: number;
  aspectPlausibility: number;
  edgeContrast: number;
  interiorHomogeneity: number;
  cornerAngleCloseness: number;
  borderPenalty: number;
}

export interface DetectionCandidate {
  quad: Quad;
  score: number;
  confidence: number;
  source?: ProposalSource;
  metrics: DetectionMetrics;
  area: number;
  perimeter: number;
  convexity: number;
  edgeStrength: number;
}

export type DetectionStatus = 'found' | 'not_found';

export interface DetectionDebugStageTimings {
  grayscaleMs: number;
  blurMs: number;
  edgesMs: number;
  candidateMs: number;
  scoringMs: number;
  totalMs: number;
}

export interface DetectionDebugInfo {
  candidateCount: number;
  topScores: number[];
  ambiguityMargin: number;
  bestScore: number;
  secondBestScore: number;
  proposalSources: ProposalSource[];
  fallbackState?: FallbackState;
  edgeDensity?: number;
  stageMs: DetectionDebugStageTimings;
}

export interface DetectionResult {
  status: DetectionStatus;
  source: DetectorSource;
  bestCandidate?: DetectionCandidate;
  candidates: DetectionCandidate[];
  rejectionReason?: DetectionRejectionReason;
  debug?: DetectionDebugInfo;
  timings?: DetectionDebugStageTimings;
}

export interface BrightnessResult {
  averageLuma: number;
  ok: boolean;
}

export interface BlurResult {
  laplacianVariance: number;
  ok: boolean;
}

export interface GlareResult {
  highlightRatio: number;
  ok: boolean;
}

export interface AreaResult {
  areaFraction: number;
  ok: boolean;
}

export interface QualityResult {
  brightness: BrightnessResult;
  blur: BlurResult;
  glare: GlareResult;
  area: AreaResult;
  ok: boolean;
}

export type GuidanceCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'TOO_DARK_OR_BRIGHT'
  | 'REDUCE_GLARE'
  | 'TOO_BLURRY'
  | 'HOLD_STEADY'
  | 'MOVE_CLOSER'
  | 'READY';

export interface StabilityResult {
  stable: boolean;
  stableMs: number;
  cornerMovement: number;
  confidenceAccumulation: number;
  smoothedQuad?: Quad;
}

export interface FrameProcessResult {
  detection: DetectionResult;
  quality?: QualityResult;
  stability?: StabilityResult;
  guidance: GuidanceCode;
}

export interface DetectionScoreWeights {
  areaFraction: number;
  aspectPlausibility: number;
  edgeContrast: number;
  interiorHomogeneity: number;
  cornerAngleCloseness: number;
  borderPenalty: number;
}

export interface EngineConfig {
  detectionWidth: number;
  fallbackDetectionWidth: number;
  fallbackFps: number;
  stabilityWindowMs: number;
  emaAlpha: number;
  minAreaFraction: number;
  maxAreaFraction: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  confidenceThreshold: number;
  movementThresholdPx: number;
  movementThresholdRatio: number;
  minStableConfidence: number;
  edgeLowThreshold: number;
  edgeHighThreshold: number;
  blurVarianceMin: number;
  brightnessMin: number;
  brightnessMax: number;
  glareRatioMax: number;
  contourLimit: number;
  candidateTopK: number;
  minRectangularity: number;
  edgeTouchMarginPx: number;
  ambiguityScoreMargin: number;
  identitySwitchThresholdPx: number;
  detectionFrameBudgetMs: number;
  workerHardCeilingMs: number;
  contourEnabled: boolean;
  houghSecondaryEnabled: boolean;
  houghEdgeDensityMin: number;
  houghEdgeDensityMax: number;
  houghMinLineLengthDiagRatio: number;
  houghMaxLineGapDiagRatio: number;
  houghOrthogonalityMinDeg: number;
  houghOrthogonalityMaxDeg: number;
  scoreWeights: DetectionScoreWeights;
  debug: boolean;
}
