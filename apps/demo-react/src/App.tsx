import { Suspense, lazy, useState } from 'react';
import { CornerAdjustModal } from '@docuscan/sdk-react';
import { CapturePanel } from './components/CapturePanel';
import { LiveCapturePanel } from './components/LiveCapturePanel';
import { useStudioController } from './useStudioController';

type SidebarTab = 'captures' | 'controls' | 'events' | 'insights';

const ControlPanel = lazy(() =>
  import('./components/ControlPanel').then((module) => ({ default: module.ControlPanel })),
);
const EventLogPanel = lazy(() =>
  import('./components/EventLogPanel').then((module) => ({ default: module.EventLogPanel })),
);
const PerformanceInsightsPanel = lazy(() =>
  import('./components/PerformanceInsightsPanel').then((module) => ({
    default: module.PerformanceInsightsPanel,
  })),
);
export function App() {
  const studio = useStudioController();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('captures');

  return (
    <main className="sota-shell">
      <header className="studio-bar">
        <div className="studio-brand">
          <h1>docuscan</h1>
          <p>Live scanner demo</p>
        </div>
        <div className="studio-status">
          <span className={`pill ${studio.isRunning ? 'pill-ok' : 'pill-muted'}`}>
            {studio.isRunning ? 'RUNNING' : 'STOPPED'}
          </span>
          <span className="pill pill-neutral">
            ENGINE {(studio.capabilities?.selectedMode ?? 'fallback').toUpperCase()}
          </span>
          <span className={`pill ${studio.stability?.stable ? 'pill-ok' : 'pill-warn'}`}>
            {studio.stability?.stable ? 'STABLE' : 'UNSTABLE'}
          </span>
        </div>
      </header>

      <section className="workspace-grid compact">
        <LiveCapturePanel studio={studio} />
        <aside className="sidebar-shell">
          <nav className="sidebar-tab-row" aria-label="Workspace tabs" role="tablist">
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'captures' ? 'active' : ''}`}
              onClick={() => setSidebarTab('captures')}
              role="tab"
              id="tab-captures"
              aria-selected={sidebarTab === 'captures'}
              aria-controls="panel-captures"
            >
              Captures
            </button>
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'controls' ? 'active' : ''}`}
              onClick={() => setSidebarTab('controls')}
              role="tab"
              id="tab-controls"
              aria-selected={sidebarTab === 'controls'}
              aria-controls="panel-controls"
            >
              Controls
            </button>
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'events' ? 'active' : ''}`}
              onClick={() => setSidebarTab('events')}
              role="tab"
              id="tab-events"
              aria-selected={sidebarTab === 'events'}
              aria-controls="panel-events"
            >
              Events
            </button>
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'insights' ? 'active' : ''}`}
              onClick={() => setSidebarTab('insights')}
              role="tab"
              id="tab-insights"
              aria-selected={sidebarTab === 'insights'}
              aria-controls="panel-insights"
            >
              Insights
            </button>
          </nav>

          <div className="sidebar-stage">
            {sidebarTab === 'captures' ? (
              <div id="panel-captures" role="tabpanel" aria-labelledby="tab-captures">
                <CapturePanel studio={studio} />
              </div>
            ) : null}
            {sidebarTab === 'controls' ? (
              <div id="panel-controls" role="tabpanel" aria-labelledby="tab-controls">
                <Suspense fallback={<div className="panel-load">Loading controls...</div>}>
                  <ControlPanel studio={studio} />
                </Suspense>
              </div>
            ) : null}
            {sidebarTab === 'events' ? (
              <div id="panel-events" role="tabpanel" aria-labelledby="tab-events">
                <Suspense fallback={<div className="panel-load">Loading events...</div>}>
                  <EventLogPanel studio={studio} />
                </Suspense>
              </div>
            ) : null}
            {sidebarTab === 'insights' ? (
              <div id="panel-insights" role="tabpanel" aria-labelledby="tab-insights">
                <Suspense fallback={<div className="panel-load">Loading insights...</div>}>
                  <PerformanceInsightsPanel studio={studio} />
                </Suspense>
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      {studio.activeCapture && studio.selectedPreviewUrl && studio.adjustOpen ? (
        <CornerAdjustModal
          key={`${studio.activeCapture.id}-${studio.selectedPreviewUrl}`}
          open={studio.adjustOpen}
          imageUrl={studio.activeCapture.imageUrl}
          initialQuad={studio.selectedInitialQuad}
          autoRefined={Boolean(studio.activeCapture.capture.postRefineApplied)}
          onClose={() => studio.setAdjustOpen(false)}
          onConfirm={studio.handleCornerConfirm}
        />
      ) : null}
    </main>
  );
}
