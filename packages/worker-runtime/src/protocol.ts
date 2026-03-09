import type { EngineConfig, FrameProcessResult } from '@document-autocapture/core-engine';

export type DetectorMode = 'cv' | 'hybrid' | 'ml';
export type MlPipelineVersion = 'v1-heuristic' | 'v2-graph';
export type CvFallbackReason = 'none' | 'ml_miss' | 'ml_reject' | 'ml_unavailable';

export interface WorkerDetectorConfig {
  detectorMode: DetectorMode;
  graphMlEnabled: boolean;
  cocoBookEnabled: boolean;
  cocoMinScore: number;
  cocoUseAsPrimaryInMlMode: boolean;
  mlFallbackEnabled: boolean;
  mlFallbackFrameStride: number;
  mlFallbackTriggerConsecutiveMisses: number;
  mlFallbackMinCvConfidence: number;
  mlRescueEnabled: boolean;
  mlRescueFrameStride: number;
  mlFallbackExitConsecutiveCvRecoveries: number;
  mlFallbackReentryCooldownFrames: number;
  mlModelId?: string;
  mlModelUrl?: string;
  mlModelBaseUrl?: string;
  mlWasmBaseUrl?: string;
  mlInputSize?: number;
  mlPipelineVersion?: MlPipelineVersion;
  graphProviderTimeoutMs?: number;
  cocoProviderTimeoutMs?: number;
  debug?: boolean;
}

export type WorkerInitMessage = {
  type: 'init';
  config?: Partial<EngineConfig>;
  detectorConfig?: Partial<WorkerDetectorConfig>;
  opencvScriptUrl?: string;
};

export type WorkerProcessFrameMessage = {
  type: 'process-frame';
  id: number;
  width: number;
  height: number;
  nowMs: number;
  rgbaBuffer: ArrayBuffer;
};

export type WorkerProcessBitmapMessage = {
  type: 'process-image-bitmap';
  id: number;
  nowMs: number;
  bitmap: ImageBitmap;
};

export type WorkerUpdateConfigMessage = {
  type: 'update-config';
  config: Partial<EngineConfig>;
  detectorConfig?: Partial<WorkerDetectorConfig>;
};

export type WorkerResetMessage = {
  type: 'reset-stability';
};

export type WorkerCleanupMessage = {
  type: 'cleanup';
};

export type WorkerRequest =
  | WorkerInitMessage
  | WorkerProcessFrameMessage
  | WorkerProcessBitmapMessage
  | WorkerUpdateConfigMessage
  | WorkerResetMessage
  | WorkerCleanupMessage;

export type WorkerReadyMessage = {
  type: 'ready';
};

export type WorkerFrameResultMessage = {
  type: 'frame-result';
  id: number;
  result: FrameProcessResult;
  telemetry?: {
    detectorSource: 'cv' | 'ml';
    fallbackState?: 'inactive' | 'armed' | 'active';
    mlReady: boolean;
    mlDisabled: boolean;
    mlModelLoaded: boolean;
    mlInferenceUsed: boolean;
    mlRescueUsed?: boolean;
    graphAttempted: boolean;
    cocoAttempted: boolean;
    cocoReady: boolean;
    cocoUsed: boolean;
    providerUsed?: 'graph_v2' | 'graph_v1' | 'coco_book' | 'cv_hough' | 'cv_contour';
    providerRejectReason?: string;
    cvAttempted: boolean;
    cvFallbackReason: CvFallbackReason;
    warpRejected?: boolean;
  };
};

export type WorkerErrorMessage = {
  type: 'error';
  id?: number;
  message: string;
};

export type WorkerWarningMessage = {
  type: 'warning';
  message: string;
};

export type WorkerResponse =
  | WorkerReadyMessage
  | WorkerFrameResultMessage
  | WorkerErrorMessage
  | WorkerWarningMessage;
