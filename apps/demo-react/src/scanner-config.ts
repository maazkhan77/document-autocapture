import type { ScannerConfig } from 'js-document-autocapture';

const DEFAULT_VIDEO_CONSTRAINTS: NonNullable<ScannerConfig['videoConstraints']> = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  preferredMode: 'best',
  detectorMode: 'ml',
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  mlInputSize: 224,
  detectionWidth: 480,
  fallbackDetectionWidth: 320,
  fallbackFps: 9,
  mlFallbackEnabled: true,
  mlFallbackFrameStride: 5,
  mlFallbackTriggerConsecutiveMisses: 3,
  mlFallbackMinCvConfidence: 0.55,
  mlRescueEnabled: true,
  mlRescueFrameStride: 2,
  postCaptureRefine: 'safe',
  warpValidationLevel: 'strict',
  autoCapture: true,
  autoCaptureMinAreaFraction: 0.14,
  autoCaptureCooldownMs: 1400,
  autoCaptureConsecutiveStableFrames: 2,
  confidenceThreshold: 0.42,
  minStableConfidence: 0.36,
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
  debugOverlayLevel: 'basic',
  debug: true,
  videoConstraints: DEFAULT_VIDEO_CONSTRAINTS,
};

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

export function createDemoScannerConfig(overrides: Partial<ScannerConfig> = {}): ScannerConfig {
  return {
    ...DEFAULT_SCANNER_CONFIG,
    ...overrides,
    videoConstraints: overrides.videoConstraints ?? DEFAULT_VIDEO_CONSTRAINTS,
    opencvScriptUrl: overrides.opencvScriptUrl ?? defaultOpenCvScriptUrl(),
  };
}

