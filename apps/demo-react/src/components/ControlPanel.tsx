import type { DebugOverlayLevel, DetectorMode } from '../app-logic';
import type { StudioController } from '../useStudioController';

interface ControlPanelProps {
  studio: StudioController;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ControlPanel({ studio }: ControlPanelProps) {
  const hybridControlsDisabled = studio.detectorMode !== 'hybrid';
  const rescueControlsDisabled = studio.detectorMode !== 'ml';

  return (
    <aside className="panel control-panel">
      <div className="panel-title-row">
        <h2>Detector Config</h2>
        <span className="chip">{studio.detectorMode.toUpperCase()}</span>
      </div>

      <div className="preset-row">
        <button type="button" className="btn btn-soft" onClick={() => studio.applyPreset('recommended')}>
          Apply Recommended
        </button>
      </div>

      <div className="control-grid two">
        <div className="control-group">
          <label htmlFor="detector-mode">Detector Mode</label>
          <select
            id="detector-mode"
            value={studio.detectorMode}
            onChange={(event) => studio.setDetectorMode(event.target.value as DetectorMode)}
          >
            <option value="cv">cv</option>
            <option value="hybrid">hybrid</option>
            <option value="ml">ml</option>
          </select>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={studio.autoCapture}
            onChange={(event) => studio.setAutoCapture(event.target.checked)}
          />
          <span>Auto capture</span>
        </label>
      </div>

      <div className="control-grid two">
        <label className="toggle">
          <input
            type="checkbox"
            checked={studio.mlFallbackEnabled}
            disabled={hybridControlsDisabled}
            onChange={(event) => studio.setMlFallbackEnabled(event.target.checked)}
          />
          <span>ML fallback</span>
        </label>
      </div>

      <div className="control-grid two">
        <label className="toggle">
          <input
            type="checkbox"
            checked={studio.mlRescueEnabled}
            disabled={rescueControlsDisabled}
            onChange={(event) => studio.setMlRescueEnabled(event.target.checked)}
          />
          <span>ML rescue</span>
        </label>
        <div className="control-group">
          <label htmlFor="ml-rescue-stride">Rescue stride</label>
          <input
            id="ml-rescue-stride"
            type="number"
            min={1}
            max={6}
            value={studio.mlRescueFrameStride}
            disabled={rescueControlsDisabled || !studio.mlRescueEnabled}
            onChange={(event) =>
              studio.setMlRescueFrameStride(clamp(Number(event.target.value) || 0, 1, 6))
            }
          />
        </div>
      </div>

      <div className="control-group">
        <label htmlFor="post-capture-refine">Post-capture refine</label>
        <select
          id="post-capture-refine"
          value={studio.postCaptureRefine}
          onChange={(event) => studio.setPostCaptureRefine(event.target.value as 'off' | 'safe')}
        >
          <option value="off">off</option>
          <option value="safe">safe</option>
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="overlay-level">Overlay</label>
        <select
          id="overlay-level"
          value={studio.debugOverlayLevel}
          onChange={(event) => studio.setDebugOverlayLevel(event.target.value as DebugOverlayLevel)}
        >
          <option value="off">off</option>
          <option value="basic">basic</option>
          <option value="full">full</option>
        </select>
      </div>

      <div className="control-grid two">
        <div className="control-group">
          <label htmlFor="ml-stride">ML Stride</label>
          <input
            id="ml-stride"
            type="number"
            min={1}
            max={10}
            value={studio.mlFallbackFrameStride}
            disabled={hybridControlsDisabled || !studio.mlFallbackEnabled}
            onChange={(event) =>
              studio.setMlFallbackFrameStride(clamp(Number(event.target.value) || 0, 1, 10))
            }
          />
        </div>
        <div className="control-group">
          <label htmlFor="ml-miss-trigger">ML Miss Trigger</label>
          <input
            id="ml-miss-trigger"
            type="number"
            min={1}
            max={20}
            value={studio.mlFallbackTriggerConsecutiveMisses}
            disabled={hybridControlsDisabled || !studio.mlFallbackEnabled}
            onChange={(event) =>
              studio.setMlFallbackTriggerConsecutiveMisses(clamp(Number(event.target.value) || 0, 1, 20))
            }
          />
        </div>
      </div>

      <div className="control-group">
        <label htmlFor="ml-min-cv">ML Min CV Confidence: {studio.mlFallbackMinCvConfidence.toFixed(2)}</label>
        <input
          id="ml-min-cv"
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          value={studio.mlFallbackMinCvConfidence}
          disabled={hybridControlsDisabled || !studio.mlFallbackEnabled}
          onChange={(event) => studio.setMlFallbackMinCvConfidence(Number(event.target.value))}
        />
      </div>

      <div className="control-group">
        <label htmlFor="detection-width">Detection Width: {studio.detectionWidth}px</label>
        <input
          id="detection-width"
          type="range"
          min={320}
          max={640}
          step={16}
          value={studio.detectionWidth}
          onChange={(event) => studio.setDetectionWidth(Number(event.target.value))}
        />
      </div>

      <div className="control-group">
        <label htmlFor="confidence-threshold">Confidence Threshold: {studio.confidenceThreshold.toFixed(2)}</label>
        <input
          id="confidence-threshold"
          type="range"
          min={0.2}
          max={0.7}
          step={0.01}
          value={studio.confidenceThreshold}
          onChange={(event) => studio.setConfidenceThreshold(Number(event.target.value))}
        />
      </div>

      <div className="control-group">
        <label htmlFor="min-stable-confidence">Min Stable Confidence: {studio.minStableConfidence.toFixed(2)}</label>
        <input
          id="min-stable-confidence"
          type="range"
          min={0.2}
          max={0.7}
          step={0.01}
          value={studio.minStableConfidence}
          onChange={(event) => studio.setMinStableConfidence(Number(event.target.value))}
        />
      </div>

      <div className="control-grid two">
        <div className="control-group">
          <label htmlFor="stability-window">Stability Window</label>
          <input
            id="stability-window"
            type="number"
            min={250}
            max={1500}
            value={studio.stabilityWindowMs}
            onChange={(event) =>
              studio.setStabilityWindowMs(clamp(Number(event.target.value) || 0, 250, 1500))
            }
          />
        </div>
        <div className="control-group">
          <label htmlFor="stable-frames">Stable Frames</label>
          <input
            id="stable-frames"
            type="number"
            min={1}
            max={6}
            value={studio.autoStableFrames}
            onChange={(event) => studio.setAutoStableFrames(clamp(Number(event.target.value) || 0, 1, 6))}
          />
        </div>
      </div>

      <div className="action-row">
        <button type="button" className="btn btn-soft" onClick={() => void studio.handleCopyConfig()}>
          Copy Config JSON
        </button>
        <button type="button" className="btn btn-soft" onClick={() => void studio.handleCopyShareUrl()}>
          Copy Share URL
        </button>
        <button type="button" className="btn btn-soft" onClick={studio.handleExportSession}>
          Export Session JSON
        </button>
        {studio.copyStatus ? <span className="copy-status">{studio.copyStatus}</span> : null}
      </div>

      <div className="shortcut-grid">
        <div>
          <span>Space</span>
          <strong>Manual capture</strong>
        </div>
        <div>
          <span>S</span>
          <strong>Start / Stop</strong>
        </div>
        <div>
          <span>C</span>
          <strong>Copy config</strong>
        </div>
      </div>

      <div className="diag-table">
        <div>
          <span>Detector</span>
          <strong>{studio.detectorMode}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>{studio.capabilities?.selectedMode ?? 'n/a'}</strong>
        </div>
        <div>
          <span>rVFC</span>
          <strong>{studio.capabilities?.requestVideoFrameCallbackSupported ? 'yes' : 'no'}</strong>
        </div>
        <div>
          <span>Worker</span>
          <strong>{studio.capabilities?.workerSupported ? 'yes' : 'no'}</strong>
        </div>
        <div>
          <span>WebGL main</span>
          <strong>{studio.capabilities?.webglMainSupported ? 'yes' : 'no'}</strong>
        </div>
        <div>
          <span>WebGL worker</span>
          <strong>{studio.capabilities?.webglWorkerSupported ? 'yes' : 'no'}</strong>
        </div>
        <div>
          <span>Stable ms</span>
          <strong>{Math.round(studio.stability?.stableMs ?? 0)}</strong>
        </div>
        <div>
          <span>Rejection</span>
          <strong>{studio.detection?.rejectionReason ?? 'none'}</strong>
        </div>
        <div>
          <span>Fallback state</span>
          <strong>{studio.detection?.debug?.fallbackState ?? 'inactive'}</strong>
        </div>
        <div>
          <span>Proposal src</span>
          <strong>{studio.detection?.debug?.proposalSources?.join(',') ?? 'n/a'}</strong>
        </div>
        <div>
          <span>Frame budget</span>
          <strong>{Math.round(studio.detection?.timings?.totalMs ?? 0)}ms</strong>
        </div>
      </div>
    </aside>
  );
}
