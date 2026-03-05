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
  /** @deprecated Use captureDecisionSource instead. */
  source: 'manual' | 'auto';
  elapsedMs: number;
}

export interface ScannerConfig extends Partial<EngineConfig> {
  preferredMode?: ExecutionMode;
  debug?: boolean;
  autoCapture?: boolean;
  /**
   * Optional stricter area floor used only for auto-capture gating.
   * Detection guidance can still run with a lower minAreaFraction.
   */
  autoCaptureMinAreaFraction?: number;
  autoCaptureCooldownMs?: number;
  videoConstraints?: MediaTrackConstraints;
  videoElement?: HTMLVideoElement;
  workerFactory?: () => Worker;
  captureMimeType?: string;
  captureQuality?: number;
  outputMaxWidth?: number;
  outputMaxHeight?: number;
  detectorMode?: DetectorMode;
  debugOverlayLevel?: DebugOverlayLevel;
  autoCaptureConsecutiveStableFrames?: number;
  opencvScriptUrl?: string;
  mlFallbackEnabled?: boolean;
  mlFallbackFrameStride?: number;
  mlFallbackTriggerConsecutiveMisses?: number;
  mlFallbackMinCvConfidence?: number;
  mlFallbackExitConsecutiveCvRecoveries?: number;
  mlFallbackReentryCooldownFrames?: number;
  mlModelId?: string;
  mlModelUrl?: string;
  mlModelBaseUrl?: string;
  mlWasmBaseUrl?: string;
  mlInputSize?: number;
  mlPipelineVersion?: MlPipelineVersion;
  graphMlEnabled?: boolean;
  cocoBookEnabled?: boolean;
  cocoMinScore?: number;
  cocoUseAsPrimaryInMlMode?: boolean;
  cvContourEnabled?: boolean;
  mlRescueEnabled?: boolean;
  mlRescueFrameStride?: number;
  warpValidationLevel?: WarpValidationLevel;
  postCaptureRefine?: PostCaptureRefine;
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
  on<K extends ScannerEventName>(event: K, handler: (payload: ScannerEventMap[K]) => void): () => void;
  destroy(): Promise<void>;
}
