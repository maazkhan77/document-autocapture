import type { GuidanceCode } from '@document-autocapture/core-engine';
import { useDocumentAutoCapture } from 'react-document-autocapture';
import type { ScannerConfig } from 'js-document-autocapture';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildShareUrl,
  getPresetConfig,
  type DebugOverlayLevel,
  type DetectorMode,
  type PresetId,
} from './app-logic';
import { createDemoScannerConfig, defaultOpenCvScriptUrl } from './scanner-config';
import {
  parseBooleanParam,
  parseDebugOverlayLevel,
  parseDetectorMode,
  parseIntParam,
  parseNumberParam,
  parsePostCaptureRefine,
} from './studio/helpers';
import { renderDetectionOverlay } from './studio/renderOverlay';
import { useCaptureGallery } from './studio/useCaptureGallery';
import { useEventLog } from './studio/useEventLog';
import { useStudioTelemetry } from './studio/useStudioTelemetry';

export function useStudioController() {
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
    parseIntParam(search, 'autoCaptureConsecutiveStableFrames', defaultPreset.autoStableFrames, 1, 6),
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
  const mlPipelineVersion = search.get('mlPipelineVersion') === 'v1-heuristic' ? 'v1-heuristic' : 'v2-graph';
  const warpValidationLevel = search.get('warpValidationLevel') === 'standard' ? 'standard' : 'strict';
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
  const [copyStatus, setCopyStatus] = useState('');
  const { events, setEvents, logEvent } = useEventLog();

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const videoRefObject = useRef<HTMLVideoElement | null>(null);
  const prevGuidanceRef = useRef<GuidanceCode | undefined>(undefined);

  const scannerConfig = useMemo<ScannerConfig>(
    () =>
      createDemoScannerConfig({
        detectionWidth,
        detectorMode,
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

  const {
    videoRef,
    start,
    stop,
    captureManual,
    isRunning,
    capabilities,
    detection,
    stability,
    quality,
    guidance,
    lastCapture,
    warning,
    error,
  } = useDocumentAutoCapture(scannerConfig);

  const { telemetry, telemetrySummary } = useStudioTelemetry(detection, quality);
  const {
    captures,
    selectedCaptureId,
    setSelectedCaptureId,
    adjustOpen,
    setAdjustOpen,
    activeCapture,
    latestCaptureDecisionSource,
    selectedPreviewUrl,
    selectedInitialQuad,
    handleCornerConfirm,
    clearGallery,
  } = useCaptureGallery({
    lastCapture,
    scannerConfig,
    logEvent,
  });

  useEffect(() => {
    const previous = prevGuidanceRef.current;
    if (guidance && guidance !== previous) {
      logEvent('info', `Guidance changed: ${guidance}`);
      prevGuidanceRef.current = guidance;
    }
  }, [guidance, logEvent]);

  useEffect(() => {
    if (!error) {
      return;
    }
    logEvent('error', error.message);
  }, [error, logEvent]);

  useEffect(() => {
    if (!warning) {
      return;
    }
    logEvent('warn', warning);
  }, [warning, logEvent]);

  useEffect(() => {
    void start().catch((startError) => {
      logEvent('error', startError instanceof Error ? startError.message : 'Failed to start scanner');
    });
    return () => {
      void stop();
    };
  }, [logEvent, start, stop]);

  const setVideoNode = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRefObject.current = node;
      videoRef(node);
    },
    [videoRef],
  );

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) {
      return;
    }
    renderDetectionOverlay({
      canvas,
      detectionWidth,
      videoWidth: videoRefObject.current?.videoWidth ?? 0,
      videoHeight: videoRefObject.current?.videoHeight ?? 0,
      debugOverlayLevel,
      detection,
      stability,
    });
  }, [detectionWidth, debugOverlayLevel, detection, stability]);

  const statusLabel = useMemo(() => {
    if (error) {
      return `Error: ${error.message}`;
    }
    if (!isRunning) {
      return 'Idle';
    }
    return guidance ?? 'Initializing...';
  }, [error, guidance, isRunning]);

  const handleManualCapture = useCallback(async () => {
    try {
      await captureManual();
    } catch (captureError) {
      logEvent('error', captureError instanceof Error ? captureError.message : 'Manual capture failed');
    }
  }, [captureManual, logEvent]);

  const handleCopyConfig = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(scannerConfig, null, 2));
      setCopyStatus('Copied config');
      window.setTimeout(() => setCopyStatus(''), 1200);
    } catch {
      setCopyStatus('Copy failed');
      window.setTimeout(() => setCopyStatus(''), 1200);
    }
  }, [scannerConfig]);

  const handleCopyShareUrl = useCallback(async () => {
    const url = buildShareUrl({
      currentSearch: window.location.search,
      origin: window.location.origin,
      path: window.location.pathname,
      detectorMode,
      autoCapture,
      debugOverlayLevel,
      detectionWidth,
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
    });
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('Copied share URL');
      window.setTimeout(() => setCopyStatus(''), 1200);
    } catch {
      setCopyStatus('Share copy failed');
      window.setTimeout(() => setCopyStatus(''), 1200);
    }
  }, [
    detectorMode,
    autoCapture,
    debugOverlayLevel,
    detectionWidth,
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
  ]);

  const handleExportSession = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      scannerConfig,
      capabilities,
      status: {
        isRunning,
        guidance,
        error: error?.message,
      },
      latest: {
        detection,
        stability,
        quality,
      },
      captures: captures.map((entry) => ({
        id: entry.id,
        captureDecisionSource: entry.capture.captureDecisionSource,
        detectorSourceAtCapture: entry.capture.detectorSourceAtCapture,
        warpTierUsed: entry.capture.warpTierUsed,
        elapsedMs: entry.capture.elapsedMs,
        hasAdjusted: Boolean(entry.adjustedUrl),
      })),
      telemetry,
      events,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `document-autocapture-session-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    logEvent('info', 'Session diagnostics exported');
  }, [scannerConfig, capabilities, isRunning, guidance, error, detection, stability, quality, captures, telemetry, events, logEvent]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        if (isRunning) {
          void handleManualCapture();
        }
        return;
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (isRunning) {
          void stop();
        } else {
          void start();
        }
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void handleCopyConfig();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isRunning, handleManualCapture, handleCopyConfig, start, stop]);

  const applyPreset = useCallback((preset: PresetId) => {
    const next = getPresetConfig(preset);
    setDetectorMode(next.detectorMode);
    setConfidenceThreshold(next.confidenceThreshold);
    setMinStableConfidence(next.minStableConfidence);
    setStabilityWindowMs(next.stabilityWindowMs);
    setAutoStableFrames(next.autoStableFrames);
    setDetectionWidth(next.detectionWidth);
    setMlFallbackEnabled(next.mlFallbackEnabled);
    setMlFallbackFrameStride(next.mlFallbackFrameStride);
    setMlFallbackTriggerConsecutiveMisses(next.mlFallbackTriggerConsecutiveMisses);
    setMlFallbackMinCvConfidence(next.mlFallbackMinCvConfidence);
    setMlRescueEnabled(next.mlRescueEnabled);
    setMlRescueFrameStride(next.mlRescueFrameStride);
    setPostCaptureRefine(next.postCaptureRefine);
  }, []);

  const qualityScore = useMemo(() => {
    if (!quality) {
      return 0;
    }
    const brightnessBand = quality.brightness.ok ? 1 : 0.55;
    const blurBand = quality.blur.ok ? 1 : 0.55;
    const glareBand = quality.glare.ok ? 1 : 0.6;
    return Math.round(100 * brightnessBand * blurBand * glareBand);
  }, [quality]);

  const detectionScore = Math.round((detection?.bestCandidate?.score ?? 0) * 100);
  const detectionFps = detection?.timings?.totalMs ? Math.round(1000 / detection.timings.totalMs) : 0;
  const autoCaptureGateReason = useMemo(() => {
    if (!autoCapture) {
      return 'disabled';
    }
    if (detection?.status !== 'found') {
      return 'document_not_found';
    }
    if (!quality) {
      return 'quality_pending';
    }
    if (!quality.ok) {
      if (!quality.brightness.ok) {
        return 'quality_brightness';
      }
      if (!quality.glare.ok) {
        return 'quality_glare';
      }
      if (!quality.blur.ok) {
        return 'quality_blur';
      }
      if (!quality.area.ok) {
        return 'quality_area';
      }
      return 'quality_blocked';
    }
    if (!stability?.stable) {
      return 'hold_steady';
    }
    return 'ready';
  }, [autoCapture, detection?.status, quality, stability?.stable]);


  return {
    overlayRef,
    setVideoNode,
    scannerConfig,
    detectorMode,
    setDetectorMode,
    debugOverlayLevel,
    setDebugOverlayLevel,
    autoCapture,
    setAutoCapture,
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
    detectionWidth,
    setDetectionWidth,
    confidenceThreshold,
    setConfidenceThreshold,
    minStableConfidence,
    setMinStableConfidence,
    stabilityWindowMs,
    setStabilityWindowMs,
    autoStableFrames,
    setAutoStableFrames,
    copyStatus,
    adjustOpen,
    setAdjustOpen,
    captures,
    selectedCaptureId,
    setSelectedCaptureId,
    events,
    setEvents,
    start,
    stop,
    isRunning,
    capabilities,
    detection,
    stability,
    quality,
    guidance,
    error,
    statusLabel,
    activeCapture,
    latestCaptureDecisionSource,
    selectedPreviewUrl,
    selectedInitialQuad,
    handleManualCapture,
    handleCopyConfig,
    handleCopyShareUrl,
    applyPreset,
    handleCornerConfirm,
    handleExportSession,
    clearGallery,
    qualityScore,
    detectionScore,
    detectionFps,
    autoCaptureGateReason,
    telemetry,
    telemetrySummary,
  };
}

export type StudioController = ReturnType<typeof useStudioController>;
