import { describe, expect, it } from 'vitest';
import { selectExecutionMode } from './capabilities';

describe('selectExecutionMode', () => {
  it('chooses best when full worker + offscreen + worker webgl are available', () => {
    const mode = selectExecutionMode({
      workerSupported: true,
      offscreenCanvasSupported: true,
      offscreenTransferSupported: true,
      webglMainSupported: true,
      webglWorkerSupported: true,
      requestVideoFrameCallbackSupported: true,
      crossOriginIsolated: false,
    });
    expect(mode).toBe('best');
  });

  it('chooses standard when worker exists but best-mode prerequisites are missing', () => {
    const mode = selectExecutionMode({
      workerSupported: true,
      offscreenCanvasSupported: false,
      offscreenTransferSupported: false,
      webglMainSupported: true,
      webglWorkerSupported: false,
      requestVideoFrameCallbackSupported: true,
      crossOriginIsolated: false,
    });
    expect(mode).toBe('standard');
  });

  it('falls back when worker is unavailable', () => {
    const mode = selectExecutionMode({
      workerSupported: false,
      offscreenCanvasSupported: false,
      offscreenTransferSupported: false,
      webglMainSupported: false,
      webglWorkerSupported: false,
      requestVideoFrameCallbackSupported: false,
      crossOriginIsolated: false,
    });
    expect(mode).toBe('fallback');
  });
});
