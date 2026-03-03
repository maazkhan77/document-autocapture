import type { Quad } from '@docuscan/core-engine';
import { describe, expect, it } from 'vitest';
import { refineQuadPostCapture } from './post-refine';

function makeImageData(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = pixel(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height } as unknown as ImageData;
}

describe('post-capture refine', () => {
  it('returns unchanged quad on invalid initial geometry', () => {
    const imageData = makeImageData(120, 90, (x, y) => {
      const v = (x * 3 + y * 7) % 255;
      return [v, v, v];
    });
    const invalidQuad: Quad = {
      topLeft: { x: 20, y: 20 },
      topRight: { x: 20, y: 20 },
      bottomRight: { x: 20, y: 20 },
      bottomLeft: { x: 20, y: 20 },
    };

    const result = refineQuadPostCapture({
      imageData,
      initialQuad: invalidQuad,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('invalid_initial_quad');
    expect(result.quad).toEqual(invalidQuad);
  });

  it('returns unchanged quad on timeout budget', () => {
    const imageData = makeImageData(240, 180, (x, y) => {
      const frame = x > 40 && x < 200 && y > 30 && y < 150;
      const v = frame ? 220 : 30;
      return [v, v, v];
    });
    const initialQuad: Quad = {
      topLeft: { x: 48, y: 34 },
      topRight: { x: 192, y: 40 },
      bottomRight: { x: 197, y: 146 },
      bottomLeft: { x: 42, y: 141 },
    };

    const result = refineQuadPostCapture({
      imageData,
      initialQuad,
      budgetMs: 1,
      maxIterations: 3,
      searchRadiusPx: 40,
      searchStepPx: 1,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(result.quad).toEqual(initialQuad);
  });
});
