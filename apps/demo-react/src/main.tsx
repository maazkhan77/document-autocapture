import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as StudioApp } from './App';
import { JsIntegrationPage } from './pages/JsIntegrationPage';
import { ReactIntegrationPage } from './pages/ReactIntegrationPage';
import './styles.css';

declare global {
  interface Window {
    __DOCUMENT_AUTOCAPTURE_PHASE0__?: unknown;
    __DOCUMENT_AUTOCAPTURE_BAKEOFF__?: unknown;
  }
}

function renderApp(): void {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const routeNode =
    normalizedPath === '/react' ? (
      <ReactIntegrationPage />
    ) : normalizedPath === '/js' ? (
      <JsIntegrationPage />
    ) : (
      <StudioApp />
    );

  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      {routeNode}
    </React.StrictMode>,
  );
}

function renderBenchResult(result: unknown): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }
  const pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.font = '12px Menlo,monospace';
  pre.style.padding = '16px';
  pre.textContent = JSON.stringify(result, null, 2);
  root.replaceChildren(pre);
}

async function runPhase0BenchMode(): Promise<void> {
  const root = document.getElementById('root');
  if (root) {
    root.textContent = 'Running Phase-0 benchmark...';
    root.setAttribute('style', 'font:14px Menlo,monospace;padding:16px;');
  }

  try {
    const { runPhase0Bench } = await import('./phase0Bench');
    const result = await runPhase0Bench();
    window.__DOCUMENT_AUTOCAPTURE_PHASE0__ = result;
    renderBenchResult(result);
  } catch (error) {
    const benchError = {
      error: error instanceof Error ? error.message : 'Unknown benchmark failure',
    };
    window.__DOCUMENT_AUTOCAPTURE_PHASE0__ = benchError;
    renderBenchResult(benchError);
  }
}

async function runBakeoffBenchMode(candidateParam: string | null): Promise<void> {
  const root = document.getElementById('root');
  if (root) {
    const candidateLabel = candidateParam ?? 'candidate-a';
    root.textContent = `Running bakeoff benchmark (${candidateLabel})...`;
    root.setAttribute('style', 'font:14px Menlo,monospace;padding:16px;');
  }

  try {
    const { runBakeoffBench } = await import('./bakeoffBench');
    const result = await runBakeoffBench(candidateParam);
    window.__DOCUMENT_AUTOCAPTURE_BAKEOFF__ = result;
    renderBenchResult(result);
  } catch (error) {
    const benchError = {
      error: error instanceof Error ? error.message : 'Unknown bakeoff benchmark failure',
      candidate: candidateParam ?? 'candidate-a',
    };
    window.__DOCUMENT_AUTOCAPTURE_BAKEOFF__ = benchError;
    renderBenchResult(benchError);
  }
}

const search = new URLSearchParams(window.location.search);
if (search.get('phase0bench') === '1') {
  void runPhase0BenchMode();
} else if (search.get('bakeoff') === '1') {
  void runBakeoffBenchMode(search.get('candidate'));
} else {
  renderApp();
}
