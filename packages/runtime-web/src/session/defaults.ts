import type { Detection, Quality, ScannerConfig } from '../types';
import { defaultOpenCvScriptUrl, mergeVideoConstraints } from './constraint-utils';
import { normalizeDetectorMode } from './config-mapper';

/**
 * Default video constraints applied when the user does not provide their own.
 */
const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

// ── Quality presets ──────────────────────────────────────────────────

interface QualityPreset {
  outputMaxWidth: number;
  outputMaxHeight: number;
  captureQuality: number;
  captureMimeType: string;
  autoCaptureConsecutiveStableFrames: number;
}

const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  fast: {
    outputMaxWidth: 1024,
    outputMaxHeight: 1024,
    captureQuality: 0.85,
    captureMimeType: 'image/jpeg',
    autoCaptureConsecutiveStableFrames: 2,
  },
  balanced: {
    outputMaxWidth: 1920,
    outputMaxHeight: 1920,
    captureQuality: 0.92,
    captureMimeType: 'image/png',
    autoCaptureConsecutiveStableFrames: 3,
  },
  high: {
    outputMaxWidth: 2048,
    outputMaxHeight: 2048,
    captureQuality: 0.95,
    captureMimeType: 'image/png',
    autoCaptureConsecutiveStableFrames: 2,
  },
};

// ── Detection strategy → internal detectorMode mapping ───────────────

export function resolveDetectorMode(detection: Detection | undefined): 'cv' | 'hybrid' | 'ml' {
  switch (detection) {
    case 'opencv':
      return 'cv';
    case 'ml':
      return 'ml';
    case 'hybrid':
      return 'hybrid';
    case 'auto':
    default:
      // 'auto' defaults to 'ml' which is the smartest all-round option;
      // the runtime will further downgrade based on capabilities.
      return 'ml';
  }
}

/**
 * The default scanner configuration values. These are merged with user-provided
 * overrides in the `ScannerSessionImpl` constructor.
 *
 * **Key changes from legacy defaults:**
 * - `detection` defaults to `'auto'` (maps to `detectorMode: 'ml'`).
 * - `debugOverlay` / `debugOverlayLevel` default to `'off'`.
 * - `cocoSsd` / `cocoBookEnabled` default to `true` (downloads ~5 MB from CDN on first use).
 * - `mlPipelineVersion` defaults to `'v2-graph'`.
 * - `postCaptureRefine` defaults to `false` / `'off'`.
 */
export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  // ── High-level ──
  detection: 'auto',
  quality: 'balanced',
  mlFallback: true,
  cocoSsd: true,
  webglWarp: true,
  autoCapture: true,
  postCaptureRefine: false,
  debug: false,
  debugOverlay: 'off',

  // ── Video / capture (filled by quality preset in buildScannerConfig) ──
  captureMimeType: 'image/png',
  captureQuality: 0.92,
  outputMaxWidth: 1920,
  outputMaxHeight: 1920,
  autoCaptureConsecutiveStableFrames: 3,
  autoCaptureMinAreaFraction: 0.14,
  autoCaptureCooldownMs: 1400,

  // ── Execution ──
  preferredMode: 'best',

  // ── Engine tuning ──
  detectionWidth: 480,
  fallbackDetectionWidth: 320,
  fallbackFps: 9,
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
  houghSecondaryEnabled: true,
  houghEdgeDensityMin: 0.005,
  houghEdgeDensityMax: 0.25,
  houghMinLineLengthDiagRatio: 0.12,
  houghMaxLineGapDiagRatio: 0.02,
  houghOrthogonalityMinDeg: 60,
  houghOrthogonalityMaxDeg: 120,

  // ── ML ──
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  mlInputSize: 224,
  graphMlEnabled: true,
  mlRescueEnabled: true,
  mlRescueFrameStride: 2,

  // ── ML fallback tuning ──
  mlFallbackFrameStride: 5,
  mlFallbackTriggerConsecutiveMisses: 8,
  mlFallbackMinCvConfidence: 0.35,
  mlFallbackExitConsecutiveCvRecoveries: 3,
  mlFallbackReentryCooldownFrames: 10,

  // ── COCO ──
  cocoMinScore: 0.45,
  cocoUseAsPrimaryInMlMode: true,

  // ── Other ──
  cvContourEnabled: false,
  warpValidationLevel: 'standard',
  opencvScriptUrl: defaultOpenCvScriptUrl(),
};

/**
 * Merges a user-provided partial config with the defaults.
 *
 * 1. Resolves high-level fields (`detection`, `quality`, `cocoSsd`, etc.)
 *    into their internal equivalents (`detectorMode`, `cocoBookEnabled`, etc.).
 * 2. Deep-merges `videoConstraints`.
 * 3. Auto-resolves `mlModelId` from `mlPipelineVersion` when not explicit.
 */
export function buildScannerConfig(userConfig?: ScannerConfig): ScannerConfig {
  // Start with defaults
  const merged: ScannerConfig = {
    ...DEFAULT_SCANNER_CONFIG,
    ...userConfig,
    videoConstraints: mergeVideoConstraints(
      DEFAULT_VIDEO_CONSTRAINTS,
      userConfig?.videoConstraints,
    ),
  };

  // ── Apply quality preset ──
  const qualityPreset = QUALITY_PRESETS[merged.quality ?? 'balanced'];
  // Only apply preset values when the user didn't explicitly override them
  if (userConfig?.outputMaxWidth === undefined)
    merged.outputMaxWidth = qualityPreset.outputMaxWidth;
  if (userConfig?.outputMaxHeight === undefined)
    merged.outputMaxHeight = qualityPreset.outputMaxHeight;
  if (userConfig?.captureQuality === undefined)
    merged.captureQuality = qualityPreset.captureQuality;
  if (userConfig?.captureMimeType === undefined)
    merged.captureMimeType = qualityPreset.captureMimeType;
  if (userConfig?.autoCaptureConsecutiveStableFrames === undefined) {
    merged.autoCaptureConsecutiveStableFrames = qualityPreset.autoCaptureConsecutiveStableFrames;
  }

  // ── Resolve high-level → internal fields ──

  // detection → detectorMode
  merged.detectorMode = normalizeDetectorMode(
    userConfig?.detectorMode ?? resolveDetectorMode(merged.detection),
  );

  // debugOverlay → debugOverlayLevel
  merged.debugOverlayLevel = merged.debugOverlay ?? merged.debugOverlayLevel ?? 'off';

  // mlFallback → mlFallbackEnabled
  merged.mlFallbackEnabled = merged.mlFallback ?? merged.mlFallbackEnabled ?? true;

  // cocoSsd → cocoBookEnabled
  merged.cocoBookEnabled = merged.cocoSsd ?? merged.cocoBookEnabled ?? true;

  // webglWarp → preferredMode (when explicitly false, force CPU warp via fallback mode)
  if (merged.webglWarp === false && userConfig?.preferredMode === undefined) {
    merged.preferredMode = 'fallback';
  }

  // postCaptureRefine (boolean) → postCaptureRefineMode
  if (typeof merged.postCaptureRefine === 'boolean') {
    merged.postCaptureRefineMode = merged.postCaptureRefine ? 'safe' : 'off';
  } else {
    merged.postCaptureRefineMode = merged.postCaptureRefineMode ?? 'off';
  }

  // ── Auto-resolve model ID from pipeline version ──
  const userProvidedModelId = userConfig?.mlModelId !== undefined;
  if (!userProvidedModelId) {
    merged.mlModelId = merged.mlPipelineVersion === 'v2-graph' ? 'doc-corner-v2' : 'doc-corner-v1';
  }

  return merged;
}
