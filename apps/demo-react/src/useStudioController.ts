import type { GuidanceCode, Quad } from '@document-autocapture/core-engine';
import { useDocumentAutoCapture } from 'react-document-autocapture';
import type { CaptureResult, ScannerConfig } from 'js-document-autocapture';
import { warpPerspectiveCpu } from '@document-autocapture/warp-cpu';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildShareUrl,
  getPresetConfig,
  type DebugOverlayLevel,
  type DetectorMode,
  type PresetId,
} from './app-logic';

interface CaptureEntry {
  id: string;
  capture: CaptureResult;
  imageUrl: string;
  adjustedUrl?: string;
}

interface EventItem {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface TelemetrySample {
  ts: number;
  fps: number;
  detectionScore: number;
  qualityScore: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawQuad(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
  stroke: string,
  lineWidth = 2.5,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
}

function fullImageQuad(width: number, height: number): Quad {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: width - 1, y: 0 },
    bottomRight: { x: width - 1, y: height - 1 },
    bottomLeft: { x: 0, y: height - 1 },
  };
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not create canvas context');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function computeImageDataLumaStats(imageData: ImageData, stride = 4): { variance: number; dynamicRange: number } {
  const data = imageData.data;
  const step = Math.max(1, Math.floor(stride));
  let count = 0;
  let mean = 0;
  let m2 = 0;
  let minLuma = 255;
  let maxLuma = 0;

  for (let i = 0; i < data.length; i += 4 * step) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count += 1;
    const delta = luma - mean;
    mean += delta / count;
    m2 += delta * (luma - mean);
    if (luma < minLuma) minLuma = luma;
    if (luma > maxLuma) maxLuma = luma;
  }

  return {
    variance: count > 1 ? m2 / (count - 1) : 0,
    dynamicRange: Math.max(0, maxLuma - minLuma),
  };
}

function appendLog(
  setEvents: Dispatch<SetStateAction<EventItem[]>>,
  level: EventItem['level'],
  message: string,
): void {
  const next: EventItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    level,
    message,
  };
  setEvents((prev) => [next, ...prev].slice(0, 40));
}

function parseNumberParam(
  search: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = search.get(key);
  const value = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, min, max);
}

function parseIntParam(
  search: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = search.get(key);
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(clamp(value, min, max));
}

function defaultOpenCvScriptUrl(): string {
  if (typeof window === 'undefined') {
    return '/opencv.js';
  }
  try {
    return new URL('opencv.js', window.location.href).toString();
  } catch {
    return '/opencv.js';
  }
}

function parseDetectorMode(value: string | null, fallback: DetectorMode): DetectorMode {
  if (value === 'cv' || value === 'hybrid' || value === 'ml') {
    return value;
  }
  return fallback;
}

function parseBooleanParam(search: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = search.get(key);
  if (raw === null) {
    return fallback;
  }
  return raw !== '0';
}

function parsePostCaptureRefine(
  search: URLSearchParams,
  fallback: 'off' | 'safe',
): 'off' | 'safe' {
  const raw = search.get('postCaptureRefine');
  if (raw === 'safe' || raw === 'off') {
    return raw;
  }
  return fallback;
}

export function useStudioController() {
  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const defaultPreset = useMemo(() => getPresetConfig('recommended'), []);
  const [detectorMode, setDetectorMode] = useState<DetectorMode>(
    parseDetectorMode(search.get('detectorMode'), defaultPreset.detectorMode),
  );
  const [debugOverlayLevel, setDebugOverlayLevel] = useState<DebugOverlayLevel>(
    (search.get('debugOverlayLevel') as DebugOverlayLevel | null) ?? 'full',
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
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetrySample[]>([]);

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const videoRefObject = useRef<HTMLVideoElement | null>(null);
  const capturesRef = useRef<CaptureEntry[]>([]);
  const seenCaptureRef = useRef<CaptureResult | undefined>(undefined);
  const prevGuidanceRef = useRef<GuidanceCode | undefined>(undefined);
  const telemetryBufferRef = useRef<TelemetrySample[]>([]);

  const scannerConfig = useMemo<ScannerConfig>(
    () => ({
      preferredMode: 'best',
      detectionWidth,
      fallbackDetectionWidth: 320,
      fallbackFps: 9,
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
      autoCaptureMinAreaFraction: 0.14,
      autoCaptureCooldownMs: 1400,
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      opencvScriptUrl: defaultOpenCvScriptUrl(),
      autoCaptureConsecutiveStableFrames: autoStableFrames,
      confidenceThreshold,
      minStableConfidence,
      stabilityWindowMs,
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

  useEffect(() => {
    const previous = prevGuidanceRef.current;
    if (guidance && guidance !== previous) {
      appendLog(setEvents, 'info', `Guidance changed: ${guidance}`);
      prevGuidanceRef.current = guidance;
    }
  }, [guidance]);

  useEffect(() => {
    if (!detection) {
      return;
    }
    const fps = detection.timings?.totalMs ? 1000 / Math.max(1, detection.timings.totalMs) : 0;
    const detectionScore = detection.bestCandidate?.score ?? 0;
    const qualityScore =
      quality && quality.ok
        ? 1
        : quality
          ? (quality.brightness.ok ? 0.25 : 0) +
            (quality.blur.ok ? 0.25 : 0) +
            (quality.glare.ok ? 0.25 : 0) +
            (quality.area.ok ? 0.25 : 0)
          : 0;
    const sample: TelemetrySample = {
      ts: Date.now(),
      fps,
      detectionScore,
      qualityScore,
    };
    telemetryBufferRef.current.push(sample);
    if (telemetryBufferRef.current.length > 640) {
      telemetryBufferRef.current = telemetryBufferRef.current.slice(-640);
    }
  }, [detection, quality]);

  useEffect(() => {
    const commitIntervalMs = 250;
    const timer = window.setInterval(() => {
      if (telemetryBufferRef.current.length === 0) {
        return;
      }
      const pending = telemetryBufferRef.current;
      telemetryBufferRef.current = [];
      setTelemetry((prev) => [...prev, ...pending].slice(-160));
    }, commitIntervalMs);
    return () => {
      window.clearInterval(timer);
      telemetryBufferRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }
    appendLog(setEvents, 'error', error.message);
  }, [error]);

  useEffect(() => {
    if (!warning) {
      return;
    }
    appendLog(setEvents, 'warn', warning);
  }, [warning]);

  useEffect(() => {
    if (!lastCapture || seenCaptureRef.current === lastCapture) {
      return;
    }
    seenCaptureRef.current = lastCapture;
    const entry: CaptureEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      capture: lastCapture,
      imageUrl: URL.createObjectURL(lastCapture.blob),
    };
    appendLog(
      setEvents,
      'info',
      `Capture (${lastCapture.captureDecisionSource}, ${lastCapture.detectorSourceAtCapture}, warp=${lastCapture.warpTierUsed})`,
    );
    setCaptures((prev) => {
      const next = [entry, ...prev];
      if (next.length > 8) {
        for (const removed of next.slice(8)) {
          URL.revokeObjectURL(removed.imageUrl);
          if (removed.adjustedUrl) {
            URL.revokeObjectURL(removed.adjustedUrl);
          }
        }
      }
      return next.slice(0, 8);
    });
    setSelectedCaptureId(entry.id);
  }, [lastCapture]);

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  useEffect(() => {
    return () => {
      for (const entry of capturesRef.current) {
        URL.revokeObjectURL(entry.imageUrl);
        if (entry.adjustedUrl) {
          URL.revokeObjectURL(entry.adjustedUrl);
        }
      }
    };
  }, []);

  useEffect(() => {
    void start().catch((startError) => {
      appendLog(
        setEvents,
        'error',
        startError instanceof Error ? startError.message : 'Failed to start scanner',
      );
    });
    return () => {
      void stop();
    };
  }, [start, stop]);

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
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const videoWidth = videoRefObject.current?.videoWidth ?? 0;
    const videoHeight = videoRefObject.current?.videoHeight ?? 0;
    const width = detectionWidth;
    const aspectRatio = videoWidth > 0 && videoHeight > 0 ? videoHeight / videoWidth : 1.4;
    canvas.width = width;
    canvas.height = Math.round(width * aspectRatio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (debugOverlayLevel === 'off' || !detection) {
      return;
    }

    const primaryCandidate = detection.bestCandidate ?? detection.candidates[0];
    if (!primaryCandidate) {
      return;
    }

    if (debugOverlayLevel === 'full') {
      for (const candidate of detection.candidates.filter((candidate) => candidate !== primaryCandidate).slice(0, 4)) {
        drawQuad(ctx, candidate.quad, 'rgba(123, 97, 255, 0.35)', 1.6);
      }
    }

    const found = detection.status === 'found';
    const stable = found && Boolean(stability?.stable);
    const color = found ? (stable ? '#00e5a8' : '#ffaf46') : '#ff5b6e';
    drawQuad(ctx, primaryCandidate.quad, color, found ? 3 : 2.4);

    const score = primaryCandidate.score;
    const candidateSource = (primaryCandidate.source ?? detection.source ?? 'cv').toUpperCase();
    const label = found
      ? `${candidateSource} ${(score * 100).toFixed(1)}%`
      : `${candidateSource} ${(score * 100).toFixed(1)}% · ${detection.rejectionReason ?? 'rejected'}`;
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    const pad = 8;
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + pad * 2;
    const boxHeight = 22;
    const boxX = clamp(primaryCandidate.quad.topLeft.x, 4, canvas.width - boxWidth - 4);
    const boxY = clamp(primaryCandidate.quad.topLeft.y - 28, 4, canvas.height - boxHeight - 4);
    ctx.fillStyle = 'rgba(7, 10, 18, 0.76)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = color;
    ctx.fillText(label, boxX + pad, boxY + 15);
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

  const activeCapture = useMemo(
    () => captures.find((capture) => capture.id === selectedCaptureId) ?? captures[0],
    [captures, selectedCaptureId],
  );
  const latestCaptureDecisionSource =
    lastCapture?.captureDecisionSource ?? activeCapture?.capture.captureDecisionSource ?? 'n/a';

  const selectedPreviewUrl = activeCapture?.adjustedUrl ?? activeCapture?.imageUrl ?? '';
  const selectedInitialQuad = activeCapture?.capture.quad ?? fullImageQuad(1000, 1400);

  const handleManualCapture = useCallback(async () => {
    try {
      await captureManual();
    } catch (captureError) {
      appendLog(
        setEvents,
        'error',
        captureError instanceof Error ? captureError.message : 'Manual capture failed',
      );
    }
  }, [captureManual]);

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
    appendLog(setEvents, 'info', 'Session diagnostics exported');
  }, [scannerConfig, capabilities, isRunning, guidance, error, detection, stability, quality, captures, telemetry, events]);

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

  const handleCornerConfirm = useCallback(
    (quad: Quad) => {
      if (!activeCapture) {
        setAdjustOpen(false);
        return;
      }
      void (async () => {
        try {
          const imageData = await blobToImageData(activeCapture.capture.blob);
          const warped = warpPerspectiveCpu({
            imageData,
            quad,
            outputWidth: imageData.width,
            outputHeight: imageData.height,
            budgetMs: 500,
          });
          if (!warped.ok || !warped.imageData) {
            appendLog(setEvents, 'warn', 'Corner adjust warp failed; keeping original image');
            setAdjustOpen(false);
            return;
          }

          const warpedStats = computeImageDataLumaStats(warped.imageData, 4);
          const sourceStats = computeImageDataLumaStats(imageData, 8);
          const minExpectedVariance = Math.max(12, sourceStats.variance * 0.05);
          if (warpedStats.variance < minExpectedVariance || warpedStats.dynamicRange < 22) {
            appendLog(setEvents, 'warn', 'Corner adjustment looked invalid; keeping original image');
            setAdjustOpen(false);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = warped.imageData.width;
          canvas.height = warped.imageData.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Missing canvas context');
          }
          ctx.putImageData(warped.imageData, 0, 0);
          const requestedMimeType = scannerConfig.captureMimeType ?? 'image/png';
          const exportMimeType =
            requestedMimeType === 'image/png' || requestedMimeType === 'image/jpeg' || requestedMimeType === 'image/webp'
              ? requestedMimeType
              : 'image/png';
          const exportQuality =
            exportMimeType === 'image/png'
              ? undefined
              : clamp(scannerConfig.captureQuality ?? 1, 0.1, 1);
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((out) => {
              if (!out) {
                reject(new Error('Could not serialize adjusted image'));
                return;
              }
              resolve(out);
            }, exportMimeType, exportQuality);
          });
          const adjustedUrl = URL.createObjectURL(blob);
          setCaptures((prev) =>
            prev.map((entry) => {
              if (entry.id !== activeCapture.id) {
                return entry;
              }
              if (entry.adjustedUrl) {
                URL.revokeObjectURL(entry.adjustedUrl);
              }
              return { ...entry, adjustedUrl };
            }),
          );
          appendLog(setEvents, 'info', 'Corner adjustment applied');
        } catch (adjustError) {
          appendLog(
            setEvents,
            'error',
            adjustError instanceof Error ? adjustError.message : 'Corner adjustment failed',
          );
        } finally {
          setAdjustOpen(false);
        }
      })();
    },
    [activeCapture, scannerConfig.captureMimeType, scannerConfig.captureQuality],
  );

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

  const telemetrySummary = useMemo(() => {
    if (telemetry.length === 0) {
      return {
        avgFps: 0,
        avgDetectionScore: 0,
        avgQualityScore: 0,
      };
    }
    const avgFps = telemetry.reduce((acc, sample) => acc + sample.fps, 0) / telemetry.length;
    const avgDetectionScore =
      telemetry.reduce((acc, sample) => acc + sample.detectionScore, 0) / telemetry.length;
    const avgQualityScore =
      telemetry.reduce((acc, sample) => acc + sample.qualityScore, 0) / telemetry.length;
    return {
      avgFps,
      avgDetectionScore,
      avgQualityScore,
    };
  }, [telemetry]);

  const clearGallery = useCallback(() => {
    setCaptures((prev) => {
      for (const entry of prev) {
        URL.revokeObjectURL(entry.imageUrl);
        if (entry.adjustedUrl) {
          URL.revokeObjectURL(entry.adjustedUrl);
        }
      }
      return [];
    });
    setSelectedCaptureId('');
  }, []);

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
