import type { ExecutionMode } from '@document-autocapture/core-engine';
import type { Capabilities } from './types';

async function probeWorkerWebglSupport(timeoutMs = 1200): Promise<boolean> {
  if (typeof Worker === 'undefined') {
    return false;
  }

  const script = `
self.onmessage = () => {
  try {
    if (typeof OffscreenCanvas === 'undefined') {
      self.postMessage({ ok: false });
      return;
    }
    const canvas = new OffscreenCanvas(64, 64);
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    self.postMessage({ ok: !!gl });
  } catch (_) {
    self.postMessage({ ok: false });
  }
};
`;

  const blob = new Blob([script], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(false);
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<{ ok: boolean }>) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(Boolean(event.data?.ok));
    };

    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(false);
    };

    worker.postMessage({});
  });
}

function probeOffscreenTransfer(): { supported: boolean; transferSupported: boolean } {
  if (typeof document === 'undefined') {
    return { supported: false, transferSupported: false };
  }

  const canvas = document.createElement('canvas');
  const supported = typeof (globalThis as Window & typeof globalThis).OffscreenCanvas !== 'undefined';
  if (!supported || typeof canvas.transferControlToOffscreen !== 'function') {
    return { supported, transferSupported: false };
  }

  try {
    const offscreen = canvas.transferControlToOffscreen();
    return { supported, transferSupported: Boolean(offscreen) };
  } catch {
    return { supported, transferSupported: false };
  }
}

function probeMainThreadWebgl(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  return Boolean(gl);
}

function probeRvfc(): boolean {
  if (typeof HTMLVideoElement === 'undefined') {
    return false;
  }
  return typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function';
}

export function selectExecutionMode(capabilities: Omit<Capabilities, 'selectedMode'>): ExecutionMode {
  if (
    capabilities.workerSupported &&
    capabilities.offscreenTransferSupported &&
    capabilities.webglWorkerSupported
  ) {
    return 'best';
  }
  if (capabilities.workerSupported) {
    return 'standard';
  }
  return 'fallback';
}

export async function detectCapabilities(): Promise<Capabilities> {
  const workerSupported = typeof Worker !== 'undefined';
  const offscreenResult = probeOffscreenTransfer();
  const webglMainSupported = probeMainThreadWebgl();
  const requestVideoFrameCallbackSupported = probeRvfc();
  const crossOriginIsolated = Boolean(globalThis.crossOriginIsolated);
  const webglWorkerSupported = await probeWorkerWebglSupport();

  const provisional = {
    workerSupported,
    offscreenCanvasSupported: offscreenResult.supported,
    offscreenTransferSupported: offscreenResult.transferSupported,
    webglMainSupported,
    webglWorkerSupported,
    requestVideoFrameCallbackSupported,
    crossOriginIsolated,
  };

  const selectedMode = selectExecutionMode(provisional);

  return {
    ...provisional,
    selectedMode,
  };
}
