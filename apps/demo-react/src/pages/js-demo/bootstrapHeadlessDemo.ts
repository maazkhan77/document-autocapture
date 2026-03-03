import { createScanner } from 'js-document-autocapture';
import type { CaptureResult } from 'js-document-autocapture';
import { createDemoScannerConfig } from '../../scanner-config';

function createNode<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (textContent) {
    node.textContent = textContent;
  }
  return node;
}

function formatConfidence(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}

export function mount(container: HTMLElement): () => Promise<void> {
  const root = createNode('div', 'integration-demo-grid js-headless-root');
  const liveCard = createNode('section', 'integration-live-card');
  const outputCard = createNode('section', 'integration-output-card');
  const stage = createNode('div', 'integration-camera-stage');
  const video = createNode('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const actions = createNode('div', 'action-row');
  const startButton = createNode('button', 'btn btn-primary', 'Start');
  const stopButton = createNode('button', 'btn btn-ghost', 'Stop');
  const captureButton = createNode('button', 'btn btn-accent', 'Capture');

  const chipRow = createNode('div', 'integration-chip-row');
  const runningChip = createNode('span', 'pill pill-muted', 'STOPPED');
  const sourceChip = createNode('span', 'chip', 'Source n/a');
  const statusChip = createNode('span', 'chip', 'Status idle');
  const candidateChip = createNode('span', 'chip', 'Candidates 0');
  const confidenceChip = createNode('span', 'chip', 'Confidence n/a');
  const guidanceChip = createNode('span', 'chip', 'Guidance n/a');
  const fpsChip = createNode('span', 'chip', 'FPS 0');
  const warningLine = createNode('p', 'integration-note', 'Event stream active');

  const outputTitle = createNode('h3', undefined, 'Latest Capture');
  const preview = createNode('img', 'integration-capture-preview') as HTMLImageElement;
  preview.alt = 'Latest captured document';
  preview.hidden = true;
  const emptyState = createNode('div', 'empty-state', 'No capture yet. Start scanner and tap Capture.');
  const captureMeta = createNode('div', 'capture-meta');
  const decisionMeta = createNode('span', undefined, 'Decision: n/a');
  const detectorMeta = createNode('span', undefined, 'Detector: n/a');
  const warpMeta = createNode('span', undefined, 'Warp: n/a');
  const elapsedMeta = createNode('span', undefined, 'Elapsed: n/a');

  stage.append(video);
  actions.append(startButton, stopButton, captureButton);
  chipRow.append(runningChip, sourceChip, statusChip, candidateChip, confidenceChip, guidanceChip, fpsChip);
  liveCard.append(stage, actions, chipRow, warningLine);
  captureMeta.append(decisionMeta, detectorMeta, warpMeta, elapsedMeta);
  outputCard.append(outputTitle, preview, emptyState, captureMeta);
  root.append(liveCard, outputCard);
  container.replaceChildren(root);

  const scanner = createScanner(createDemoScannerConfig({
    detectorMode: 'ml',
    mlPipelineVersion: 'v2-graph',
    mlModelId: 'doc-corner-v2',
    postCaptureRefine: 'safe',
    warpValidationLevel: 'strict',
    debugOverlayLevel: 'basic',
    videoElement: video,
  }));

  let captureUrl: string | undefined;

  const renderCapture = (capture: CaptureResult): void => {
    if (captureUrl) {
      URL.revokeObjectURL(captureUrl);
    }
    captureUrl = URL.createObjectURL(capture.blob);
    preview.src = captureUrl;
    preview.hidden = false;
    emptyState.hidden = true;
    decisionMeta.textContent = `Decision: ${capture.captureDecisionSource}`;
    detectorMeta.textContent = `Detector: ${capture.detectorSourceAtCapture}`;
    warpMeta.textContent = `Warp: ${capture.warpTierUsed}`;
    elapsedMeta.textContent = `Elapsed: ${Math.round(capture.elapsedMs)}ms`;
  };

  const unsubscribers = [
    scanner.on('frame', (frame) => {
      const fps = frame.detection.timings?.totalMs
        ? Math.round(1000 / Math.max(1, frame.detection.timings.totalMs))
        : 0;
      fpsChip.textContent = `FPS ${fps}`;
    }),
    scanner.on('detection', (detection) => {
      sourceChip.textContent = `Source ${detection.source}`;
      statusChip.textContent = `Status ${detection.status}`;
      candidateChip.textContent = `Candidates ${detection.candidates.length}`;
      confidenceChip.textContent = `Confidence ${formatConfidence(detection.bestCandidate?.score)}`;
    }),
    scanner.on('guidance', (guidance) => {
      guidanceChip.textContent = `Guidance ${guidance}`;
    }),
    scanner.on('capture', (capture) => {
      renderCapture(capture);
      warningLine.textContent = 'Capture received';
    }),
    scanner.on('warning', (warning) => {
      warningLine.textContent = `Warning: ${warning}`;
    }),
    scanner.on('error', (error) => {
      warningLine.textContent = `Error: ${error.message}`;
    }),
  ];

  const setRunning = (running: boolean): void => {
    runningChip.textContent = running ? 'RUNNING' : 'STOPPED';
    runningChip.className = running ? 'pill pill-ok' : 'pill pill-muted';
  };

  const startScanner = async (): Promise<void> => {
    try {
      await scanner.start();
      setRunning(true);
      warningLine.textContent = 'Scanner running';
    } catch (error) {
      setRunning(false);
      warningLine.textContent = `Error: ${error instanceof Error ? error.message : 'Failed to start scanner'}`;
    }
  };

  const stopScanner = async (): Promise<void> => {
    try {
      await scanner.stop();
      setRunning(false);
      warningLine.textContent = 'Scanner stopped';
    } catch (error) {
      warningLine.textContent = `Error: ${error instanceof Error ? error.message : 'Failed to stop scanner'}`;
    }
  };

  const captureNow = async (): Promise<void> => {
    try {
      const capture = await scanner.captureManual();
      renderCapture(capture);
    } catch (error) {
      warningLine.textContent = `Error: ${error instanceof Error ? error.message : 'Manual capture failed'}`;
    }
  };

  startButton.onclick = () => {
    void startScanner();
  };
  stopButton.onclick = () => {
    void stopScanner();
  };
  captureButton.onclick = () => {
    void captureNow();
  };

  void startScanner();

  return async () => {
    startButton.onclick = null;
    stopButton.onclick = null;
    captureButton.onclick = null;
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    try {
      await scanner.stop();
    } catch {
      // Stop can fail if scanner was never started; destroy still proceeds.
    }
    await scanner.destroy();
    if (captureUrl) {
      URL.revokeObjectURL(captureUrl);
      captureUrl = undefined;
    }
    container.replaceChildren();
  };
}
