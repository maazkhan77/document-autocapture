import { describe, expect, it } from 'vitest';
import { warpPerspectiveCpu } from './index';

const dummyImage = {
  width: 8,
  height: 8,
  data: new Uint8ClampedArray(8 * 8 * 4),
} as ImageData;

describe('warpPerspectiveCpu', () => {
  it('rejects invalid output dimensions', () => {
    const result = warpPerspectiveCpu({
      imageData: dummyImage,
      quad: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 7, y: 0 },
        bottomRight: { x: 7, y: 7 },
        bottomLeft: { x: 0, y: 7 },
      },
      outputWidth: 0,
      outputHeight: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Invalid output dimensions');
  });

  it('fails fast on degenerate quad homography', () => {
    const result = warpPerspectiveCpu({
      imageData: dummyImage,
      quad: {
        topLeft: { x: 1, y: 1 },
        topRight: { x: 1, y: 1 },
        bottomRight: { x: 1, y: 1 },
        bottomLeft: { x: 1, y: 1 },
      },
      outputWidth: 32,
      outputHeight: 32,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Singular matrix');
  });

  it('keeps identity orientation for corner colors', () => {
    if (typeof ImageData === 'undefined') {
      return;
    }

    const width = 4;
    const height = 4;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
      const idx = (y * width + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    };

    setPixel(0, 0, 255, 0, 0); // top-left red
    setPixel(width - 1, 0, 0, 255, 0); // top-right green
    setPixel(width - 1, height - 1, 0, 0, 255); // bottom-right blue
    setPixel(0, height - 1, 255, 255, 0); // bottom-left yellow

    const imageData = new ImageData(rgba, width, height);
    const result = warpPerspectiveCpu({
      imageData,
      quad: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: width - 1, y: 0 },
        bottomRight: { x: width - 1, y: height - 1 },
        bottomLeft: { x: 0, y: height - 1 },
      },
      outputWidth: width,
      outputHeight: height,
    });

    expect(result.ok).toBe(true);
    expect(result.imageData).toBeDefined();
    const out = result.imageData!.data;
    const pixel = (x: number, y: number) => out[(y * width + x) * 4];
    expect(pixel(0, 0)).toBeGreaterThan(200);
    expect(out[(0 * width + (width - 1)) * 4 + 1]).toBeGreaterThan(200);
    expect(out[((height - 1) * width + (width - 1)) * 4 + 2]).toBeGreaterThan(200);
    expect(out[((height - 1) * width + 0) * 4]).toBeGreaterThan(200);
    expect(out[((height - 1) * width + 0) * 4 + 1]).toBeGreaterThan(200);
  });
});
