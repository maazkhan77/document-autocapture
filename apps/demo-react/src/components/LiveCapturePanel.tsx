import type { StudioController } from '../useStudioController';

interface LiveCapturePanelProps {
  studio: StudioController;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function qualityClass(ok: boolean | undefined): string {
  if (ok === undefined) {
    return 'pending';
  }
  return ok ? 'ok' : 'warn';
}

function formatQualityNumber(value: number | undefined): string {
  if (value === undefined) {
    return '--';
  }
  return String(Math.round(value));
}

function formatQualityPercent(value: number | undefined): string {
  if (value === undefined) {
    return '--';
  }
  return formatPct(value);
}

export function LiveCapturePanel({ studio }: LiveCapturePanelProps) {
  return (
    <article className="panel camera-panel">
      <div className="panel-title-row">
        <h2>Live Capture</h2>
        <div className="inline-metrics">
          <span>FPS {studio.detectionFps || '--'}</span>
          <span>Score {studio.detectionScore}%</span>
          <span>Quality {studio.quality ? `${studio.qualityScore}%` : '--'}</span>
          <span>ML {studio.detection?.debug?.fallbackState ?? 'inactive'}</span>
        </div>
      </div>

      <div className="camera-stage">
        <video ref={studio.setVideoNode} muted playsInline autoPlay />
        <canvas ref={studio.overlayRef} />
        <div className="hud-strip">
          <span>{studio.statusLabel}</span>
          <span>Source {studio.detection?.source ?? 'n/a'}</span>
          <span>Candidates {studio.detection?.candidates.length ?? 0}</span>
          <span>Mode {studio.detectorMode}</span>
        </div>
      </div>

      <div className="action-row">
        <button type="button" className="btn btn-primary" onClick={() => void studio.start()} disabled={studio.isRunning}>
          Start
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void studio.stop()} disabled={!studio.isRunning}>
          Stop
        </button>
        <button type="button" className="btn btn-accent" onClick={() => void studio.handleManualCapture()} disabled={!studio.isRunning}>
          Capture
        </button>
        <button type="button" className="btn btn-ghost" onClick={studio.clearGallery}>
          Clear Gallery
        </button>
      </div>

      <div className="quality-grid">
        <div className={`stat-card ${qualityClass(studio.quality?.brightness.ok)}`}>
          <h3>Brightness</h3>
          <p>{formatQualityNumber(studio.quality?.brightness.averageLuma)}</p>
        </div>
        <div className={`stat-card ${qualityClass(studio.quality?.blur.ok)}`}>
          <h3>Blur</h3>
          <p>{formatQualityNumber(studio.quality?.blur.laplacianVariance)}</p>
        </div>
        <div className={`stat-card ${qualityClass(studio.quality?.glare.ok)}`}>
          <h3>Glare</h3>
          <p>{formatQualityPercent(studio.quality?.glare.highlightRatio)}</p>
        </div>
        <div className={`stat-card ${qualityClass(studio.quality?.area.ok)}`}>
          <h3>Area</h3>
          <p>{formatQualityPercent(studio.quality?.area.areaFraction)}</p>
        </div>
      </div>

      <div className="compat-lines" aria-live="polite">
        <div>Detection: {studio.detection?.status ?? 'idle'}</div>
        <div>Auto gate: {studio.autoCaptureGateReason}</div>
        <div>Decision: {studio.latestCaptureDecisionSource}</div>
        <div>Stable: {studio.stability?.stable ? 'yes' : 'no'}</div>
        <div>Proposal: {studio.detection?.debug?.proposalSources?.join(',') ?? 'n/a'}</div>
      </div>
    </article>
  );
}
