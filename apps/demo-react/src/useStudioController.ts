import type { GuidanceCode } from '@document-autocapture/core-engine';
import { useDocumentAutoCapture } from 'react-document-autocapture';
import { useCallback, useEffect, useRef } from 'react';
import { renderDetectionOverlay } from './studio/renderOverlay';
import { useCaptureGallery } from './studio/useCaptureGallery';
import { useDetectionDerivedState } from './studio/useDetectionDerivedState';
import { useEventLog } from './studio/useEventLog';
import { useScannerConfigState } from './studio/useScannerConfigState';
import { useStudioActions } from './studio/useStudioActions';
import { useStudioTelemetry } from './studio/useStudioTelemetry';

export function useStudioController() {
  // ── Scanner config state (20 parameters + presets) ─────────────────────────
  const configState = useScannerConfigState();
  const { scannerConfig, debugOverlayLevel, detectionWidth } = configState;

  // ── Event log ──────────────────────────────────────────────────────────────
  const { events, setEvents, logEvent } = useEventLog();

  // ── Refs ───────────────────────────────────────────────────────────────────
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const videoRefObject = useRef<HTMLVideoElement | null>(null);
  const prevGuidanceRef = useRef<GuidanceCode | undefined>(undefined);

  // ── SDK hook ───────────────────────────────────────────────────────────────
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

  // ── Telemetry & gallery ────────────────────────────────────────────────────
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

  // ── Derived detection state ────────────────────────────────────────────────
  const { statusLabel, qualityScore, detectionScore, detectionFps, autoCaptureGateReason } =
    useDetectionDerivedState(
      detection,
      quality,
      stability,
      guidance,
      error,
      isRunning,
      configState.autoCapture,
    );

  // ── Actions (capture, clipboard, export, keyboard) ─────────────────────────
  const {
    copyStatus,
    handleManualCapture,
    handleCopyConfig,
    handleCopyShareUrl,
    handleExportSession,
  } = useStudioActions({
    scannerConfig,
    configState,
    captureManual,
    start,
    stop,
    isRunning,
    capabilities,
    detection,
    stability,
    quality,
    guidance,
    error,
    captures,
    telemetry,
    events,
    logEvent,
  });

  // ── Logging side-effects ───────────────────────────────────────────────────
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

  // ── Auto-start ─────────────────────────────────────────────────────────────
  useEffect(() => {
    void start().catch((startError) => {
      logEvent(
        'error',
        startError instanceof Error ? startError.message : 'Failed to start scanner',
      );
    });
    return () => {
      void stop();
    };
  }, [logEvent, start, stop]);

  // ── Video ref wiring ───────────────────────────────────────────────────────
  const setVideoNode = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRefObject.current = node;
      videoRef(node);
    },
    [videoRef],
  );

  // ── Overlay rendering ──────────────────────────────────────────────────────
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

  return {
    overlayRef,
    setVideoNode,
    scannerConfig,
    detectorMode: configState.detectorMode,
    setDetectorMode: configState.setDetectorMode,
    debugOverlayLevel: configState.debugOverlayLevel,
    setDebugOverlayLevel: configState.setDebugOverlayLevel,
    autoCapture: configState.autoCapture,
    setAutoCapture: configState.setAutoCapture,
    graphMlEnabled: configState.graphMlEnabled,
    setGraphMlEnabled: configState.setGraphMlEnabled,
    cocoBookEnabled: configState.cocoBookEnabled,
    setCocoBookEnabled: configState.setCocoBookEnabled,
    cocoMinScore: configState.cocoMinScore,
    setCocoMinScore: configState.setCocoMinScore,
    cocoUseAsPrimaryInMlMode: configState.cocoUseAsPrimaryInMlMode,
    setCocoUseAsPrimaryInMlMode: configState.setCocoUseAsPrimaryInMlMode,
    cvContourEnabled: configState.cvContourEnabled,
    setCvContourEnabled: configState.setCvContourEnabled,
    houghSecondaryEnabled: configState.houghSecondaryEnabled,
    setHoughSecondaryEnabled: configState.setHoughSecondaryEnabled,
    mlFallbackEnabled: configState.mlFallbackEnabled,
    setMlFallbackEnabled: configState.setMlFallbackEnabled,
    mlFallbackFrameStride: configState.mlFallbackFrameStride,
    setMlFallbackFrameStride: configState.setMlFallbackFrameStride,
    mlFallbackTriggerConsecutiveMisses: configState.mlFallbackTriggerConsecutiveMisses,
    setMlFallbackTriggerConsecutiveMisses: configState.setMlFallbackTriggerConsecutiveMisses,
    mlFallbackMinCvConfidence: configState.mlFallbackMinCvConfidence,
    setMlFallbackMinCvConfidence: configState.setMlFallbackMinCvConfidence,
    mlRescueEnabled: configState.mlRescueEnabled,
    setMlRescueEnabled: configState.setMlRescueEnabled,
    mlRescueFrameStride: configState.mlRescueFrameStride,
    setMlRescueFrameStride: configState.setMlRescueFrameStride,
    postCaptureRefine: configState.postCaptureRefine,
    setPostCaptureRefine: configState.setPostCaptureRefine,
    detectionWidth: configState.detectionWidth,
    setDetectionWidth: configState.setDetectionWidth,
    confidenceThreshold: configState.confidenceThreshold,
    setConfidenceThreshold: configState.setConfidenceThreshold,
    minStableConfidence: configState.minStableConfidence,
    setMinStableConfidence: configState.setMinStableConfidence,
    stabilityWindowMs: configState.stabilityWindowMs,
    setStabilityWindowMs: configState.setStabilityWindowMs,
    autoStableFrames: configState.autoStableFrames,
    setAutoStableFrames: configState.setAutoStableFrames,
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
    applyPreset: configState.applyPreset,
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
