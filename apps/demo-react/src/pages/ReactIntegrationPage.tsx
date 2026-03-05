import { useDocumentAutoCapture } from 'react-document-autocapture';
import type { ScannerConfig } from 'js-document-autocapture';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { IntegrationShell } from './shared/IntegrationShell';
import { createDemoScannerConfig } from '../scanner-config';

interface IntegrationControlsState {
  graphMlEnabled: boolean;
  cocoBookEnabled: boolean;
  cocoMinScore: number;
  cvContourEnabled: boolean;
  houghSecondaryEnabled: boolean;
}

type ControlsAction = {
  type: 'patch';
  patch: Partial<IntegrationControlsState>;
};

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function parseControlsState(search: URLSearchParams): IntegrationControlsState {
  return {
    graphMlEnabled: search.get('graphMlEnabled') !== '0',
    cocoBookEnabled: search.get('cocoBookEnabled') !== '0',
    cocoMinScore: clampFloat(Number.parseFloat(search.get('cocoMinScore') ?? '0.45'), 0.05, 0.95, 0.45),
    cvContourEnabled: search.get('cvContourEnabled') === '1',
    houghSecondaryEnabled: search.get('houghSecondaryEnabled') !== '0',
  };
}

function controlsReducer(
  state: IntegrationControlsState,
  action: ControlsAction,
): IntegrationControlsState {
  switch (action.type) {
    case 'patch':
      return {
        ...state,
        ...action.patch,
      };
    default:
      return state;
  }
}

export function ReactIntegrationPage() {
  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const [controls, dispatch] = useReducer(controlsReducer, search, parseControlsState);

  const captureUrlRef = useRef<string | undefined>(undefined);
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string>('');

  const scannerConfig = useMemo<ScannerConfig>(
    () =>
      createDemoScannerConfig({
        detectorMode: 'ml',
        mlPipelineVersion: 'v2-graph',
        mlModelId: 'doc-corner-v2',
        graphMlEnabled: controls.graphMlEnabled,
        cocoBookEnabled: controls.cocoBookEnabled,
        cocoMinScore: controls.cocoMinScore,
        cocoUseAsPrimaryInMlMode: true,
        cvContourEnabled: controls.cvContourEnabled,
        houghSecondaryEnabled: controls.houghSecondaryEnabled,
        postCaptureRefine: 'safe',
        warpValidationLevel: 'strict',
        debugOverlayLevel: 'basic',
      }),
    [controls],
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('graphMlEnabled', controls.graphMlEnabled ? '1' : '0');
    params.set('cocoBookEnabled', controls.cocoBookEnabled ? '1' : '0');
    params.set('cocoMinScore', String(controls.cocoMinScore));
    params.set('cvContourEnabled', controls.cvContourEnabled ? '1' : '0');
    params.set('houghSecondaryEnabled', controls.houghSecondaryEnabled ? '1' : '0');

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  }, [controls]);

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
    graphMlEnabled: true,
    cocoBookEnabled: true,
    cocoMinScore: 0.45,
    cvContourEnabled: false,
    houghSecondaryEnabled: true,
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

          <div className="control-grid two">
            <label className="toggle">
              <input
                type="checkbox"
                checked={controls.graphMlEnabled}
                onChange={(event) => dispatch({ type: 'patch', patch: { graphMlEnabled: event.target.checked } })}
              />
              <span>Graph ML</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={controls.cocoBookEnabled}
                onChange={(event) => dispatch({ type: 'patch', patch: { cocoBookEnabled: event.target.checked } })}
              />
              <span>COCO book</span>
            </label>
          </div>

          <div className="control-group">
            <label htmlFor="react-coco-score">COCO min score</label>
            <input
              id="react-coco-score"
              type="range"
              min={0.05}
              max={0.95}
              step={0.01}
              value={controls.cocoMinScore}
              onChange={(event) => {
                dispatch({
                  type: 'patch',
                  patch: { cocoMinScore: clampFloat(Number(event.target.value), 0.05, 0.95, 0.45) },
                });
              }}
              disabled={!controls.cocoBookEnabled}
            />
          </div>

          <div className="control-grid two">
            <label className="toggle">
              <input
                type="checkbox"
                checked={controls.cvContourEnabled}
                onChange={(event) => dispatch({ type: 'patch', patch: { cvContourEnabled: event.target.checked } })}
              />
              <span>CV contour</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={controls.houghSecondaryEnabled}
                onChange={(event) => dispatch({ type: 'patch', patch: { houghSecondaryEnabled: event.target.checked } })}
              />
              <span>CV hough</span>
            </label>
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
