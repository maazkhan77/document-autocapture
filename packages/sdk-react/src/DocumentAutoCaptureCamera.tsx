import type { CaptureCompleteResult, CaptureResult, ScannerConfig } from 'js-document-autocapture';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDocumentAutoCapture } from './useDocumentAutoCapture';

type Quad = CaptureResult['quad'];

export interface DocumentAutoCaptureCameraProps extends ScannerConfig {
  className?: string;
  autoStart?: boolean;
  onCapture?: (capture: CaptureResult) => void;
  /** Fired when `maxCaptures` is reached with all collected captures. */
  onComplete?: (result: CaptureCompleteResult) => void;
}

function drawQuad(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
  width: number,
  height: number,
  strokeStyle: string,
): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = strokeStyle;
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
}

export function DocumentAutoCaptureCamera(props: DocumentAutoCaptureCameraProps) {
  const { className, autoStart = true, onCapture, onComplete, ...config } = props;
  const debugOverlayLevel = config.debugOverlay ?? config.debugOverlayLevel ?? 'basic';
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const videoNodeRef = useRef<HTMLVideoElement | null>(null);
  const emittedCaptureRef = useRef<CaptureResult | undefined>(undefined);
  const emittedCompleteRef = useRef<CaptureCompleteResult | undefined>(undefined);
  const {
    videoRef,
    start,
    stop,
    captureManual,
    isRunning,
    detection,
    guidance,
    lastCapture,
    error,
    stability,
    completeResult,
  } = useDocumentAutoCapture(config);

  const status = useMemo(() => {
    if (error) {
      return error.message;
    }
    if (guidance) {
      return guidance;
    }
    return isRunning ? 'DOCUMENT_NOT_FOUND' : 'Initializing...';
  }, [error, guidance, isRunning]);

  const setVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoNodeRef.current = node;
      videoRef(node);
    },
    [videoRef],
  );

  useEffect(() => {
    if (!autoStart) {
      return;
    }
    void start().catch(() => undefined);
    return () => {
      void stop();
    };
  }, [autoStart, start, stop]);

  useEffect(() => {
    if (!lastCapture || !onCapture) {
      return;
    }
    if (emittedCaptureRef.current === lastCapture) {
      return;
    }
    emittedCaptureRef.current = lastCapture;
    onCapture(lastCapture);
  }, [lastCapture, onCapture]);

  useEffect(() => {
    if (!completeResult || !onComplete) {
      return;
    }
    if (emittedCompleteRef.current === completeResult) {
      return;
    }
    emittedCompleteRef.current = completeResult;
    onComplete(completeResult);
  }, [completeResult, onComplete]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const videoWidth = videoNodeRef.current?.videoWidth ?? 0;
    const videoHeight = videoNodeRef.current?.videoHeight ?? 0;
    const width = config.detectionWidth ?? 480;
    const aspectRatio = videoWidth > 0 && videoHeight > 0 ? videoHeight / videoWidth : 1.4;
    canvas.width = width;
    canvas.height = Math.round(width * aspectRatio);

    if (debugOverlayLevel === 'off' || !detection?.bestCandidate) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (debugOverlayLevel === 'full') {
      for (const candidate of detection.candidates.slice(1, 4)) {
        drawQuad(ctx, candidate.quad, canvas.width, canvas.height, 'rgba(110, 193, 255, 0.45)');
      }
    }

    const quad = detection.bestCandidate.quad;
    drawQuad(ctx, quad, canvas.width, canvas.height, '#2ec4b6');
  }, [debugOverlayLevel, detection, config.detectionWidth]);

  const onManualCapture = async () => {
    await captureManual();
  };

  return (
    <div className={className} style={{ display: 'grid', gap: 12 }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 540 }}>
        <video
          ref={setVideoRef}
          style={{ width: '100%', borderRadius: 14, background: '#111' }}
          muted
          playsInline
          autoPlay
        />
        <canvas
          ref={overlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void start()} disabled={isRunning}>
          Start
        </button>
        <button type="button" onClick={() => void stop()} disabled={!isRunning}>
          Stop
        </button>
        <button type="button" onClick={() => void onManualCapture()} disabled={!isRunning}>
          Capture
        </button>
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>Guidance: {status}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        Detection: {detection?.status ?? 'idle'} | Source: {detection?.source ?? 'n/a'} |
        Candidates: {detection?.candidates.length ?? 0}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        Rejection: {detection?.rejectionReason ?? 'none'}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        Stable: {stability?.stable ? 'yes' : 'no'} | StableMs:{' '}
        {Math.round(stability?.stableMs ?? 0)}
      </div>
    </div>
  );
}
