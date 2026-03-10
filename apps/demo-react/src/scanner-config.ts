import type { ScannerConfig } from 'js-document-autocapture';

const DEFAULT_VIDEO_CONSTRAINTS: NonNullable<ScannerConfig['videoConstraints']> = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  // ── High-level API ──────────────────────────────────────────────────
  detection: 'ml',
  quality: 'balanced',
  cocoSsd: true,
  mlFallback: true,
  webglWarp: false,
  autoCapture: true,
  postCaptureRefine: true,
  debug: true,
  debugOverlay: 'basic',

  // ── Advanced tuning (demo-specific overrides) ───────────────────────
  detectorMode: 'ml',
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  mlInputSize: 224,
  graphMlEnabled: true,
  cocoMinScore: 0.45,
  cocoUseAsPrimaryInMlMode: true,
  cvContourEnabled: false,
  houghSecondaryEnabled: true,
  detectionWidth: 480,
  fallbackDetectionWidth: 320,
  fallbackFps: 9,
  mlFallbackFrameStride: 5,
  mlFallbackTriggerConsecutiveMisses: 3,
  mlFallbackMinCvConfidence: 0.55,
  mlRescueEnabled: true,
  mlRescueFrameStride: 2,
  warpValidationLevel: 'strict',
  autoCaptureMinAreaFraction: 0.14,
  autoCaptureCooldownMs: 1400,
  autoCaptureConsecutiveStableFrames: 2,
  confidenceThreshold: 0.5,
  minStableConfidence: 0.42,
  stabilityWindowMs: 320,
  emaAlpha: 0.25,
  movementThresholdRatio: 0.015,
  minAreaFraction: 0.08,
  maxAreaFraction: 0.96,
  minAspectRatio: 0.6,
  maxAspectRatio: 1.9,
  ambiguityScoreMargin: 0.04,
  edgeLowThreshold: 50,
  edgeHighThreshold: 150,
  blurVarianceMin: 24,
  brightnessMin: 45,
  brightnessMax: 215,
  glareRatioMax: 0.12,
  houghEdgeDensityMin: 0.005,
  houghEdgeDensityMax: 0.25,
  captureMimeType: 'image/png',
  captureQuality: 1,
  videoConstraints: DEFAULT_VIDEO_CONSTRAINTS,
};

function defaultMlModelBaseUrl(): string {
  if (typeof window === 'undefined') {
    return '/models/';
  }
  try {
    return new URL('/models/', window.location.origin).toString();
  } catch {
    return '/models/';
  }
}

function normalizeMlModelBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).toString();
  } catch {
    if (typeof window === 'undefined') {
      return value;
    }
    try {
      return new URL(value, window.location.origin).toString();
    } catch {
      return value;
    }
  }
}

export function defaultOpenCvScriptUrl(): string {
  if (typeof window === 'undefined') {
    return '/opencv.js';
  }
  try {
    return new URL('opencv.js', window.location.href).toString();
  } catch {
    return '/opencv.js';
  }
}

function isConstraintRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConstraintValue<T>(base: T | undefined, override: T | undefined): T | undefined {
  if (override === undefined) {
    return base;
  }
  if (isConstraintRecord(base) && isConstraintRecord(override)) {
    return { ...base, ...override } as T;
  }
  return override;
}

function mergeVideoConstraints(
  base: MediaTrackConstraints | undefined,
  override: MediaTrackConstraints | undefined,
): MediaTrackConstraints | undefined {
  if (!base && !override) {
    return undefined;
  }
  const safeBase = base ?? {};
  const safeOverride = override ?? {};
  return {
    ...safeBase,
    ...safeOverride,
    width: mergeConstraintValue(safeBase.width, safeOverride.width),
    height: mergeConstraintValue(safeBase.height, safeOverride.height),
    frameRate: mergeConstraintValue(safeBase.frameRate, safeOverride.frameRate),
    aspectRatio: mergeConstraintValue(safeBase.aspectRatio, safeOverride.aspectRatio),
  };
}

export function createDemoScannerConfig(overrides: Partial<ScannerConfig> = {}): ScannerConfig {
  const mergedVideoConstraints =
    mergeVideoConstraints(DEFAULT_VIDEO_CONSTRAINTS, overrides.videoConstraints) ??
    DEFAULT_VIDEO_CONSTRAINTS;
  return {
    ...DEFAULT_SCANNER_CONFIG,
    ...overrides,
    mlModelBaseUrl: normalizeMlModelBaseUrl(overrides.mlModelBaseUrl) ?? defaultMlModelBaseUrl(),
    videoConstraints: mergedVideoConstraints,
    opencvScriptUrl: overrides.opencvScriptUrl ?? defaultOpenCvScriptUrl(),
  };
}
