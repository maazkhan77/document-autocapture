import { useEffect, useMemo, useRef, useState } from 'react';
import { mount } from './js-demo/bootstrapHeadlessDemo';
import { IntegrationShell } from './shared/IntegrationShell';

let jsDemoLifecycleBarrier: Promise<void> = Promise.resolve();

export function JsIntegrationPage() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mountError, setMountError] = useState('');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }

    let cleanup: (() => Promise<void>) | undefined;
    let disposed = false;
    jsDemoLifecycleBarrier = jsDemoLifecycleBarrier.then(async () => {
      if (disposed) {
        return;
      }
      try {
        cleanup = mount(container);
        setMountError('');
      } catch (error) {
        setMountError(error instanceof Error ? error.message : 'Failed to mount JS demo');
      }
    });

    return () => {
      disposed = true;
      if (!cleanup) {
        return;
      }
      jsDemoLifecycleBarrier = jsDemoLifecycleBarrier
        .then(() => cleanup?.())
        .catch(() => undefined)
        .then(() => undefined);
    };
  }, []);

  const snippets = useMemo(
    () => [
      {
        title: 'Install',
        language: 'bash',
        code: 'pnpm add js-document-autocapture',
      },
      {
        title: 'Vanilla JS usage',
        language: 'ts',
        code: `import { createScanner } from 'js-document-autocapture';

const video = document.querySelector('video');
const scanner = createScanner({
  detectorMode: 'ml',
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  warpValidationLevel: 'strict',
  captureMimeType: 'image/png',
  videoElement: video,
});

scanner.on('detection', (d) => console.log(d.source, d.status));
scanner.on('capture', (capture) => console.log(capture.warpTierUsed));

await scanner.start();
// Later:
await scanner.captureManual();
await scanner.stop();
await scanner.destroy();`,
      },
    ],
    [],
  );

  return (
    <IntegrationShell
      title="Headless JS integration"
      subtitle="Route /js"
      description="This page is mounted through a plain imperative module using createScanner from js-document-autocapture."
      snippets={snippets}
    >
      {mountError ? (
        <p className="integration-note">Mount error: {mountError}</p>
      ) : (
        <p className="integration-note">Imperative scanner mount with full start/stop/capture lifecycle.</p>
      )}
      <div ref={mountRef} className="js-demo-mount" />
    </IntegrationShell>
  );
}
