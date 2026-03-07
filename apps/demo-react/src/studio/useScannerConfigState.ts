import type { ScannerConfig } from 'js-document-autocapture';
import { useCallback, useMemo, useState } from 'react';
import {
  getPresetConfig,
  type DebugOverlayLevel,
  type DetectorMode,
  type PresetId,
} from '../app-logic';
import { createDemoScannerConfig, defaultOpenCvScriptUrl } from '../scanner-config';
import {
  parseBooleanParam,
  parseDebugOverlayLevel,
  parseDetectorMode,
  parseIntParam,
  parseNumberParam,
  parsePostCaptureRefine,
} from './helpers';

export function useScannerConfigState() {
  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const defaultPreset = useMemo(() => getPresetConfig('recommended'), []);

  const [detectorMode, setDetectorMode] = useState<DetectorMode>(
    parseDetectorMode(search.get('detectorMode'), defaultPreset.detectorMode),
  );
  const [debugOverlayLevel, setDebugOverlayLevel] = useState<DebugOverlayLevel>(
    parseDebugOverlayLevel(search.get('debugOverlayLevel')),
  );
  const [autoCapture, setAutoCapture] = useState(parseBooleanParam(search, 'autoCapture', true));
  const [detectionWidth, setDetectionWidth] = useState(
    parseIntParam(search, 'detectionWidth', defaultPreset.detectionWidth, 320, 640),
  );
  const [graphMlEnabled, setGraphMlEnabled] = useState(
    parseBooleanParam(search, 'graphMlEnabled', defaultPreset.graphMlEnabled),
  );
  const [cocoBookEnabled, setCocoBookEnabled] = useState(
    parseBooleanParam(search, 'cocoBookEnabled', defaultPreset.cocoBookEnabled),
  );
  const [cocoMinScore, setCocoMinScore] = useState(
    parseNumberParam(search, 'cocoMinScore', defaultPreset.cocoMinScore, 0.05, 0.95),
  );
  const [cocoUseAsPrimaryInMlMode, setCocoUseAsPrimaryInMlMode] = useState(
    parseBooleanParam(search, 'cocoUseAsPrimaryInMlMode', defaultPreset.cocoUseAsPrimaryInMlMode),
  );
  const [cvContourEnabled, setCvContourEnabled] = useState(
    parseBooleanParam(search, 'cvContourEnabled', defaultPreset.cvContourEnabled),
  );
  const [houghSecondaryEnabled, setHoughSecondaryEnabled] = useState(
    parseBooleanParam(search, 'houghSecondaryEnabled', defaultPreset.houghSecondaryEnabled),
  );
  const [confidenceThreshold, setConfidenceThreshold] = useState(
    parseNumberParam(search, 'confidenceThreshold', defaultPreset.confidenceThreshold, 0.2, 0.85),
  );
  const [minStableConfidence, setMinStableConfidence] = useState(
    parseNumberParam(search, 'minStableConfidence', defaultPreset.minStableConfidence, 0.2, 0.85),
  );
  const [stabilityWindowMs, setStabilityWindowMs] = useState(
    parseIntParam(search, 'stabilityWindowMs', defaultPreset.stabilityWindowMs, 250, 1500),
  );
  const [autoStableFrames, setAutoStableFrames] = useState(
    parseIntParam(
      search,
      'autoCaptureConsecutiveStableFrames',
      defaultPreset.autoStableFrames,
      1,
      6,
    ),
  );
  const [mlFallbackEnabled, setMlFallbackEnabled] = useState(
    parseBooleanParam(search, 'mlFallbackEnabled', defaultPreset.mlFallbackEnabled),
  );
  const [mlFallbackFrameStride, setMlFallbackFrameStride] = useState(
    parseIntParam(search, 'mlFallbackFrameStride', defaultPreset.mlFallbackFrameStride, 1, 10),
  );
  const [mlFallbackTriggerConsecutiveMisses, setMlFallbackTriggerConsecutiveMisses] = useState(
    parseIntParam(
      search,
      'mlFallbackTriggerConsecutiveMisses',
      defaultPreset.mlFallbackTriggerConsecutiveMisses,
      1,
      20,
    ),
  );
  const [mlFallbackMinCvConfidence, setMlFallbackMinCvConfidence] = useState(
    parseNumberParam(
      search,
      'mlFallbackMinCvConfidence',
      defaultPreset.mlFallbackMinCvConfidence,
      0.05,
      0.95,
    ),
  );
  const [mlRescueEnabled, setMlRescueEnabled] = useState(
    parseBooleanParam(search, 'mlRescueEnabled', defaultPreset.mlRescueEnabled),
  );
  const [mlRescueFrameStride, setMlRescueFrameStride] = useState(
    parseIntParam(search, 'mlRescueFrameStride', defaultPreset.mlRescueFrameStride, 1, 6),
  );
  const [postCaptureRefine, setPostCaptureRefine] = useState<'off' | 'safe'>(
    parsePostCaptureRefine(search, defaultPreset.postCaptureRefine),
  );

  const mlPipelineVersion =
    search.get('mlPipelineVersion') === 'v1-heuristic' ? 'v1-heuristic' : 'v2-graph';
  const warpValidationLevel =
    search.get('warpValidationLevel') === 'standard' ? 'standard' : 'strict';
  const mlModelId =
    search.get('mlModelId') ??
    (mlPipelineVersion === 'v2-graph' ? 'doc-corner-v2' : 'doc-corner-v1');
  const mlInputSize = parseIntParam(
    search,
    'mlInputSize',
    mlPipelineVersion === 'v2-graph' ? 224 : 320,
    128,
    640,
  );
  const debugEnabled = search.get('debug') !== '0';

  const scannerConfig = useMemo<ScannerConfig>(
    () =>
      createDemoScannerConfig({
        detectionWidth,
        detectorMode,
        graphMlEnabled,
        cocoBookEnabled,
        cocoMinScore,
        cocoUseAsPrimaryInMlMode,
        cvContourEnabled,
        houghSecondaryEnabled,
        mlFallbackEnabled,
        mlFallbackFrameStride,
        mlFallbackTriggerConsecutiveMisses,
        mlFallbackMinCvConfidence,
        mlRescueEnabled,
        mlRescueFrameStride,
        postCaptureRefineMode: postCaptureRefine,
        mlPipelineVersion,
        mlModelId,
        mlInputSize,
        warpValidationLevel,
        debugOverlay: debugOverlayLevel,
        autoCapture,
        autoCaptureConsecutiveStableFrames: autoStableFrames,
        confidenceThreshold,
        minStableConfidence,
        stabilityWindowMs,
        opencvScriptUrl: defaultOpenCvScriptUrl(),
        debug: debugEnabled,
      }),
    [
      detectionWidth,
      detectorMode,
      graphMlEnabled,
      cocoBookEnabled,
      cocoMinScore,
      cocoUseAsPrimaryInMlMode,
      cvContourEnabled,
      houghSecondaryEnabled,
      mlFallbackEnabled,
      mlFallbackFrameStride,
      mlFallbackTriggerConsecutiveMisses,
      mlFallbackMinCvConfidence,
      mlRescueEnabled,
      mlRescueFrameStride,
      postCaptureRefine,
      mlPipelineVersion,
      mlModelId,
      mlInputSize,
      warpValidationLevel,
      debugOverlayLevel,
      autoCapture,
      autoStableFrames,
      confidenceThreshold,
      minStableConfidence,
      stabilityWindowMs,
      debugEnabled,
    ],
  );

  const applyPreset = useCallback((preset: PresetId) => {
    const next = getPresetConfig(preset);
    setDetectorMode(next.detectorMode);
    setConfidenceThreshold(next.confidenceThreshold);
    setMinStableConfidence(next.minStableConfidence);
    setStabilityWindowMs(next.stabilityWindowMs);
    setAutoStableFrames(next.autoStableFrames);
    setDetectionWidth(next.detectionWidth);
    setGraphMlEnabled(next.graphMlEnabled);
    setCocoBookEnabled(next.cocoBookEnabled);
    setCocoMinScore(next.cocoMinScore);
    setCocoUseAsPrimaryInMlMode(next.cocoUseAsPrimaryInMlMode);
    setCvContourEnabled(next.cvContourEnabled);
    setHoughSecondaryEnabled(next.houghSecondaryEnabled);
    setMlFallbackEnabled(next.mlFallbackEnabled);
    setMlFallbackFrameStride(next.mlFallbackFrameStride);
    setMlFallbackTriggerConsecutiveMisses(next.mlFallbackTriggerConsecutiveMisses);
    setMlFallbackMinCvConfidence(next.mlFallbackMinCvConfidence);
    setMlRescueEnabled(next.mlRescueEnabled);
    setMlRescueFrameStride(next.mlRescueFrameStride);
    setPostCaptureRefine(next.postCaptureRefine);
  }, []);

  return {
    scannerConfig,
    applyPreset,
    // Individual state + setters for UI binding
    detectorMode,
    setDetectorMode,
    debugOverlayLevel,
    setDebugOverlayLevel,
    autoCapture,
    setAutoCapture,
    detectionWidth,
    setDetectionWidth,
    graphMlEnabled,
    setGraphMlEnabled,
    cocoBookEnabled,
    setCocoBookEnabled,
    cocoMinScore,
    setCocoMinScore,
    cocoUseAsPrimaryInMlMode,
    setCocoUseAsPrimaryInMlMode,
    cvContourEnabled,
    setCvContourEnabled,
    houghSecondaryEnabled,
    setHoughSecondaryEnabled,
    confidenceThreshold,
    setConfidenceThreshold,
    minStableConfidence,
    setMinStableConfidence,
    stabilityWindowMs,
    setStabilityWindowMs,
    autoStableFrames,
    setAutoStableFrames,
    mlFallbackEnabled,
    setMlFallbackEnabled,
    mlFallbackFrameStride,
    setMlFallbackFrameStride,
    mlFallbackTriggerConsecutiveMisses,
    setMlFallbackTriggerConsecutiveMisses,
    mlFallbackMinCvConfidence,
    setMlFallbackMinCvConfidence,
    mlRescueEnabled,
    setMlRescueEnabled,
    mlRescueFrameStride,
    setMlRescueFrameStride,
    postCaptureRefine,
    setPostCaptureRefine,
    // Derived URL constants (needed by share URL builder)
    mlPipelineVersion,
    warpValidationLevel,
    mlModelId,
    mlInputSize,
    debugEnabled,
  };
}

export type ScannerConfigState = ReturnType<typeof useScannerConfigState>;
