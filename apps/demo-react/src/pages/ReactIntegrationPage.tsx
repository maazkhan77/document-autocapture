import { useDocumentAutoCapture } from 'react-document-autocapture';
import type { ScannerConfig } from 'js-document-autocapture';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IntegrationShell } from './shared/IntegrationShell';
import { createDemoScannerConfig } from '../scanner-config';

export function ReactIntegrationPage() {
  const captureUrlRef = useRef<string | undefined>(undefined);
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string>('');

  const scannerConfig = useMemo<ScannerConfig>(
    () =>
      createDemoScannerConfig({
        detectorMode: 'ml',
        mlPipelineVersion: 'v2-graph',
        mlModelId: 'doc-corner-v2',
        postCaptureRefine: 'safe',
        warpValidationLevel: 'strict',
        debugOverlayLevel: 'basic',
      }),
    [],
  );

  const {
    videoRef,
    start,
    stop,
    captureManual,
    isRunning,
    detection,
    stability,
    guidance,
    quality,
    lastCapture,
    warning,
    error,
  } = useDocumentAutoCapture(scannerConfig);

  useEffect(() => {
    void start().catch(() => undefined);
    return () => {
      void stop();
    };
  }, [start, stop]);

  useEffect(() => {
    if (!lastCapture) {
      return;
    }
    const nextUrl = URL.createObjectURL(lastCapture.blob);
    if (captureUrlRef.current) {
      URL.revokeObjectURL(captureUrlRef.current);
    }
    captureUrlRef.current = nextUrl;
    setCapturePreviewUrl(nextUrl);
  }, [lastCapture]);

  useEffect(() => {
    return () => {
      if (captureUrlRef.current) {
        URL.revokeObjectURL(captureUrlRef.current);
      }
    };
  }, []);

  const snippets = useMemo(
    () => [
      {
        title: 'Install',
        language: 'bash',
        code: 'pnpm add react-document-autocapture js-document-autocapture',
      },
      {
        title: 'React usage',
        language: 'tsx',
        code: `import { useDocumentAutoCapture } from 'react-document-autocapture';

export function ScannerView() {
  const { videoRef, start, stop, captureManual, detection, guidance } = useDocumentAutoCapture({
    detectorMode: 'ml',
    mlPipelineVersion: 'v2-graph',
    mlModelId: 'doc-corner-v2',
    warpValidationLevel: 'strict',
    captureMimeType: 'image/png',
  });

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted />
      <button onClick={() => void start()}>Start</button>
      <button onClick={() => void stop()}>Stop</button>
      <button onClick={() => void captureManual()}>Capture</button>
      <p>{guidance} | {detection?.source ?? 'n/a'}</p>
    </>
  );
}`,
      },
    ],
    [],
  );

  return (
    <IntegrationShell
      title="React SDK integration"
      subtitle="Route /react"
      description="This page shows a direct React hook integration with live controls, scanner status, and capture output."
      snippets={snippets}
    >
      <div className="integration-demo-grid">
        <section className="integration-live-card">
          <div className="integration-camera-stage">
            <video ref={videoRef} autoPlay playsInline muted />
          </div>

          <div className="action-row">
            <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={isRunning}>
              Start
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void stop()} disabled={!isRunning}>
              Stop
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void captureManual()}
              disabled={!isRunning}
            >
              Capture
            </button>
          </div>

          <div className="integration-chip-row">
            <span className={`pill ${isRunning ? 'pill-ok' : 'pill-muted'}`}>
              {isRunning ? 'RUNNING' : 'STOPPED'}
            </span>
            <span className="chip">Guidance {guidance ?? 'n/a'}</span>
            <span className="chip">Source {detection?.source ?? 'n/a'}</span>
            <span className="chip">Status {detection?.status ?? 'idle'}</span>
            <span className="chip">Candidates {detection?.candidates.length ?? 0}</span>
            <span className="chip">Stable {stability?.stable ? 'yes' : 'no'}</span>
          </div>

          <p className="integration-note">
            {warning ? `Warning: ${warning}` : error ? `Error: ${error.message}` : 'Live React hook status stream'}
          </p>
        </section>

        <section className="integration-output-card">
          <h3>Latest Capture</h3>
          {capturePreviewUrl ? (
            <img src={capturePreviewUrl} alt="Latest captured document" className="integration-capture-preview" />
          ) : (
            <div className="empty-state">No capture yet. Start scanner and tap Capture.</div>
          )}
          <div className="capture-meta">
            <span>Decision: {lastCapture?.captureDecisionSource ?? 'n/a'}</span>
            <span>Detector: {lastCapture?.detectorSourceAtCapture ?? detection?.source ?? 'n/a'}</span>
            <span>Warp: {lastCapture?.warpTierUsed ?? 'n/a'}</span>
            <span>Quality: {quality?.ok ? 'ok' : 'pending'}</span>
          </div>
        </section>
      </div>
    </IntegrationShell>
  );
}
