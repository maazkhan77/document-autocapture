import { useState } from 'react';
import type { StudioController } from '../useStudioController';

interface CapturePanelProps {
  studio: StudioController;
}

export function CapturePanel({ studio }: CapturePanelProps) {
  const [compareRatio, setCompareRatio] = useState(0.5);

  return (
    <article className="panel capture-panel">
      <div className="panel-title-row">
        <h2>Capture Output</h2>
        {studio.activeCapture ? (
          <button type="button" className="btn btn-soft" onClick={() => studio.setAdjustOpen(true)}>
            Adjust Corners
          </button>
        ) : null}
      </div>

      {studio.selectedPreviewUrl ? (
        <img src={studio.selectedPreviewUrl} alt="capture" className="capture-preview" />
      ) : (
        <div className="empty-state">No capture yet. Use auto-capture or manual capture to collect outputs.</div>
      )}

      {studio.activeCapture?.adjustedUrl ? (
        <div className="adjusted-block">
          <h3>Adjusted Output</h3>
          <div className="compare-stage">
            <img src={studio.activeCapture.imageUrl} alt="original" className="capture-preview adjusted-preview base" />
            <img
              src={studio.activeCapture.adjustedUrl}
              alt="adjusted"
              className="capture-preview adjusted-preview overlay"
              style={{
                clipPath: `inset(0 ${(1 - compareRatio) * 100}% 0 0)`,
              }}
            />
            <div className="compare-labels">
              <span>Original</span>
              <span>Adjusted</span>
            </div>
          </div>
          <label className="compare-slider">
            <span>Compare</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(compareRatio * 100)}
              onChange={(event) => setCompareRatio(Number(event.target.value) / 100)}
            />
          </label>
        </div>
      ) : null}

      {studio.activeCapture ? (
        <div className="capture-meta">
          <span>Warp: {studio.activeCapture.capture.warpTierUsed}</span>
          <span>Capture Mode: {studio.activeCapture.capture.captureDecisionSource}</span>
          <span>Detector: {studio.activeCapture.capture.detectorSourceAtCapture}</span>
          <span>Elapsed: {Math.round(studio.activeCapture.capture.elapsedMs)}ms</span>
        </div>
      ) : null}

      <div className="thumb-strip">
        {studio.captures.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={`thumb ${entry.id === studio.activeCapture?.id ? 'active' : ''}`}
            onClick={() => studio.setSelectedCaptureId(entry.id)}
          >
            <img src={entry.adjustedUrl ?? entry.imageUrl} alt={entry.id} />
          </button>
        ))}
      </div>
    </article>
  );
}
