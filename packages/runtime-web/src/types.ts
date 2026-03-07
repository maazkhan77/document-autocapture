import type {
  DetectionResult,
  DetectorSource,
  EngineConfig,
  ExecutionMode,
  FrameProcessResult,
  GuidanceCode,
  QualityResult,
  Quad,
  StabilityResult,
} from '@document-autocapture/core-engine';

export interface Capabilities {
  workerSupported: boolean;
  offscreenCanvasSupported: boolean;
  offscreenTransferSupported: boolean;
  webglMainSupported: boolean;
  webglWorkerSupported: boolean;
  requestVideoFrameCallbackSupported: boolean;
  crossOriginIsolated: boolean;
  selectedMode: ExecutionMode;
}

export type WarpTierUsed = 'webgl' | 'cpu' | 'raw';
export type DetectorMode = 'cv' | 'hybrid' | 'ml';
export type DebugOverlayLevel = 'off' | 'basic' | 'full';
export type MlPipelineVersion = 'v1-heuristic' | 'v2-graph';
export type WarpValidationLevel = 'standard' | 'strict';
export type PostCaptureRefine = 'off' | 'safe';

/**
 * High-level detection strategy the SDK should use.
 *
 * - `'auto'`   – Probes device capabilities and picks the best strategy.
 * - `'opencv'` – OpenCV only (Hough + optional contour), no ML models loaded.
 * - `'ml'`     – ML-primary with a TF.js graph model; falls back to OpenCV.
 * - `'hybrid'` – OpenCV primary with ML fallback when OpenCV misses.
 */
export type Detection = 'auto' | 'opencv' | 'ml' | 'hybrid';

/**
 * Output quality preset.
 *
 * - `'fast'`     – Fastest capture, smaller output, JPEG.
 * - `'balanced'` – Good quality, sensible size, PNG.
 * - `'high'`     – Maximum resolution & quality, PNG.
 */
export type Quality = 'fast' | 'balanced' | 'high';

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  quad: Quad;
  sourceQuad?: Quad;
  refinedQuad?: Quad;
  postRefineApplied?: boolean;
  postRefineReason?: string;
  warpTierUsed: WarpTierUsed;
  warpRejected?: boolean;
  warpRejectionReason?: string;
  quality?: QualityResult;
  captureDecisionSource: 'auto' | 'manual';
  detectorSourceAtCapture: DetectorSource;
  elapsedMs: number;
}

export interface ScannerConfig extends Partial<EngineConfig> {
  // ── High-level API (recommended for most users) ─────────────────────

  /**
   * Detection strategy.
   *
   * - `'auto'` (default) – picks the best strategy for the current device.
   * - `'opencv'` – OpenCV only, no ML models.
   * - `'ml'` – ML-primary (TF.js graph model) with OpenCV fallback.
   * - `'hybrid'` – OpenCV primary, ML fallback when CV misses.
   */
  detection?: Detection;

  /**
   * Output quality preset.
   *
   * - `'fast'` – smaller output, JPEG, fewer stable frames.
   * - `'balanced'` (default) – good quality, PNG.
   * - `'high'` – max resolution & quality, PNG.
   */
  quality?: Quality;

  /** Enable ML fallback when OpenCV cannot find a document (hybrid / auto). Default: `true`. */
  mlFallback?: boolean;

  /** Enable COCO-SSD "book" detector for faster, more robust document detection. Downloads model from CDN (~5 MB) on first use. Default: `true`. */
  cocoSsd?: boolean;

  /** Use GPU (WebGL) for perspective warp when available. Default: `true`. */
  webglWarp?: boolean;

  /** Automatically capture when the document is stable. Default: `true`. */
  autoCapture?: boolean;

  /** Refine corner positions after capture. Default: `false`. */
  postCaptureRefine?: boolean;

  /** Debug logging to console. Default: `false`. */
  debug?: boolean;

  /** Debug overlay drawn on detection canvas. Default: `'off'`. */
  debugOverlay?: DebugOverlayLevel;

  // ── Video / capture ────────────────────────────────────────────────

  /** Custom `MediaTrackConstraints` for camera access. */
  videoConstraints?: MediaTrackConstraints;

  /** Attach an existing video element instead of creating one internally. */
  videoElement?: HTMLVideoElement;

  /** Provide a custom worker factory. */
  workerFactory?: () => Worker;

  /** MIME type for captured image blob. */
  captureMimeType?: string;

  /** JPEG quality (0-1) when using `image/jpeg`. */
  captureQuality?: number;

  /** Max output image width in px. */
  outputMaxWidth?: number;

  /** Max output image height in px. */
  outputMaxHeight?: number;

  /** How many consecutive stable frames before auto-capture fires. */
  autoCaptureConsecutiveStableFrames?: number;

  /** Minimum document-area fraction for auto-capture to trigger. */
  autoCaptureMinAreaFraction?: number;

  /** Cooldown in ms between auto-captures. */
  autoCaptureCooldownMs?: number;

  // ── Advanced / ML tuning ───────────────────────────────────────────

  /** Preferred execution mode. Normally auto-detected. */
  preferredMode?: ExecutionMode;

  /** URL for the OpenCV.js script. */
  opencvScriptUrl?: string;

  /** ML pipeline version. Default: `'v2-graph'`. */
  mlPipelineVersion?: MlPipelineVersion;

  /** ML model identifier. Default: resolved from `mlPipelineVersion`. */
  mlModelId?: string;

  /** Explicit ML model URL (overrides ID-based resolution). */
  mlModelUrl?: string;

  /** Base URL for ML model assets. */
  mlModelBaseUrl?: string;

  /** Base URL for TF.js WASM backend files. */
  mlWasmBaseUrl?: string;

  /** Input tensor size for the ML model. */
  mlInputSize?: number;

  /** Enable the TF.js graph-model provider in the worker. Default: `true`. */
  graphMlEnabled?: boolean;

  /** COCO-SSD minimum detection score (0-1). Default: `0.45`. */
  cocoMinScore?: number;

  /** Use COCO-SSD as the primary detector in ML mode. Default: `true`. */
  cocoUseAsPrimaryInMlMode?: boolean;

  /** Enable OpenCV contour detection. Default: `false`. */
  cvContourEnabled?: boolean;

  /** Enable ML rescue (re-run ML on CV fallback frames). Default: `true`. */
  mlRescueEnabled?: boolean;

  /** ML rescue frame stride. Default: `2`. */
  mlRescueFrameStride?: number;

  /** Warp validation strictness. Default: `'standard'`. */
  warpValidationLevel?: WarpValidationLevel;

  // ── ML fallback tuning (advanced) ──────────────────────────────────

  /** ML fallback frame stride. Default: `5`. */
  mlFallbackFrameStride?: number;

  /** Consecutive OpenCV misses before ML kicks in. Default: `8`. */
  mlFallbackTriggerConsecutiveMisses?: number;

  /** Minimum OpenCV confidence to keep using CV in hybrid mode. Default: `0.35`. */
  mlFallbackMinCvConfidence?: number;

  /** Consecutive CV recovery frames before exiting ML fallback. Default: `3`. */
  mlFallbackExitConsecutiveCvRecoveries?: number;

  /** Cooldown frames before re-entering ML fallback. Default: `10`. */
  mlFallbackReentryCooldownFrames?: number;

  // ── Internal (kept for runtime-web layer, not exposed in SDK docs) ──

  /** @internal */
  detectorMode?: DetectorMode;
  /** @internal */
  debugOverlayLevel?: DebugOverlayLevel;
  /** @internal */
  mlFallbackEnabled?: boolean;
  /** @internal */
  cocoBookEnabled?: boolean;
  /** @internal */
  postCaptureRefineMode?: PostCaptureRefine;
}

export interface ScannerEventMap {
  detection: DetectionResult;
  stability: StabilityResult;
  guidance: GuidanceCode;
  capture: CaptureResult;
  error: Error;
  warning: string;
  capabilities: Capabilities;
  frame: FrameProcessResult;
}

export type ScannerEventName = keyof ScannerEventMap;

export interface ScannerSession {
  getCapabilities(): Capabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  captureManual(): Promise<CaptureResult>;
  updateConfig(partial: Partial<ScannerConfig>): void;
  on<K extends ScannerEventName>(
    event: K,
    handler: (payload: ScannerEventMap[K]) => void,
  ): () => void;
  destroy(): Promise<void>;
}
