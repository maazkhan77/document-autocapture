export type DetectorMode = 'cv' | 'hybrid' | 'ml';
export type DebugOverlayLevel = 'off' | 'basic' | 'full';
export type PresetId = 'recommended';

interface PresetConfig {
  confidenceThreshold: number;
  minStableConfidence: number;
  stabilityWindowMs: number;
  autoStableFrames: number;
  detectionWidth: number;
  detectorMode: DetectorMode;
  graphMlEnabled: boolean;
  cocoBookEnabled: boolean;
  cocoMinScore: number;
  cocoUseAsPrimaryInMlMode: boolean;
  cvContourEnabled: boolean;
  houghSecondaryEnabled: boolean;
  mlFallbackEnabled: boolean;
  mlFallbackFrameStride: number;
  mlFallbackTriggerConsecutiveMisses: number;
  mlFallbackMinCvConfidence: number;
  mlRescueEnabled: boolean;
  mlRescueFrameStride: number;
  postCaptureRefine: 'off' | 'safe';
}

const PRESETS: Record<PresetId, PresetConfig> = {
  recommended: {
    confidenceThreshold: 0.42,
    minStableConfidence: 0.36,
    stabilityWindowMs: 320,
    autoStableFrames: 2,
    detectionWidth: 480,
    detectorMode: 'ml',
    graphMlEnabled: true,
    cocoBookEnabled: true,
    cocoMinScore: 0.45,
    cocoUseAsPrimaryInMlMode: true,
    cvContourEnabled: false,
    houghSecondaryEnabled: true,
    mlFallbackEnabled: true,
    mlFallbackFrameStride: 5,
    mlFallbackTriggerConsecutiveMisses: 3,
    mlFallbackMinCvConfidence: 0.55,
    mlRescueEnabled: true,
    mlRescueFrameStride: 2,
    postCaptureRefine: 'off',
  },
};

export function getPresetConfig(preset: PresetId): PresetConfig {
  return { ...PRESETS[preset] };
}

export function buildShareUrl(input: {
  currentSearch: string;
  origin: string;
  path: string;
  detectorMode: DetectorMode;
  autoCapture: boolean;
  debugOverlayLevel: DebugOverlayLevel;
  detectionWidth: number;
  graphMlEnabled: boolean;
  cocoBookEnabled: boolean;
  cocoMinScore: number;
  cocoUseAsPrimaryInMlMode: boolean;
  cvContourEnabled: boolean;
  houghSecondaryEnabled: boolean;
  mlFallbackEnabled: boolean;
  mlFallbackFrameStride: number;
  mlFallbackTriggerConsecutiveMisses: number;
  mlFallbackMinCvConfidence: number;
  mlRescueEnabled: boolean;
  mlRescueFrameStride: number;
  postCaptureRefine: 'off' | 'safe';
  mlPipelineVersion: 'v1-heuristic' | 'v2-graph';
  mlModelId: string;
  mlInputSize: number;
  warpValidationLevel: 'standard' | 'strict';
}): string {
  const params = new URLSearchParams(input.currentSearch);
  params.set('detectorMode', input.detectorMode);
  params.set('autoCapture', input.autoCapture ? '1' : '0');
  params.set('debugOverlayLevel', input.debugOverlayLevel);
  params.set('detectionWidth', String(input.detectionWidth));
  params.set('graphMlEnabled', input.graphMlEnabled ? '1' : '0');
  params.set('cocoBookEnabled', input.cocoBookEnabled ? '1' : '0');
  params.set('cocoMinScore', String(input.cocoMinScore));
  params.set('cocoUseAsPrimaryInMlMode', input.cocoUseAsPrimaryInMlMode ? '1' : '0');
  params.set('cvContourEnabled', input.cvContourEnabled ? '1' : '0');
  params.set('houghSecondaryEnabled', input.houghSecondaryEnabled ? '1' : '0');
  params.set('mlFallbackEnabled', input.mlFallbackEnabled ? '1' : '0');
  params.set('mlFallbackFrameStride', String(input.mlFallbackFrameStride));
  params.set(
    'mlFallbackTriggerConsecutiveMisses',
    String(input.mlFallbackTriggerConsecutiveMisses),
  );
  params.set('mlFallbackMinCvConfidence', String(input.mlFallbackMinCvConfidence));
  params.set('mlRescueEnabled', input.mlRescueEnabled ? '1' : '0');
  params.set('mlRescueFrameStride', String(input.mlRescueFrameStride));
  params.set('postCaptureRefine', input.postCaptureRefine);
  params.set('mlPipelineVersion', input.mlPipelineVersion);
  params.set('mlModelId', input.mlModelId);
  params.set('mlInputSize', String(input.mlInputSize));
  params.set('warpValidationLevel', input.warpValidationLevel);
  return `${input.origin}${input.path}?${params.toString()}`;
}
