import { afterEach, describe, expect, it, vi } from 'vitest';
import { warpPerspectiveWebGL } from './index';

describe('warpPerspectiveWebGL', () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    if (originalDocument) {
      vi.stubGlobal('document', originalDocument);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('returns graceful failure when document is unavailable', () => {
    vi.stubGlobal('document', undefined);
    const result = warpPerspectiveWebGL({
      imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData,
      quad: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 0, y: 0 },
        bottomRight: { x: 0, y: 0 },
        bottomLeft: { x: 0, y: 0 },
      },
      outputWidth: 10,
      outputHeight: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('requires browser document context');
  });

  it('rejects invalid output dimensions before warp', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => null }),
    });
    const result = warpPerspectiveWebGL({
      imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData,
      quad: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 0, y: 0 },
        bottomRight: { x: 0, y: 0 },
        bottomLeft: { x: 0, y: 0 },
      },
      outputWidth: 0,
      outputHeight: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Invalid output dimensions');
  });
});
