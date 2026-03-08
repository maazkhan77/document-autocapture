import { describe, expect, it } from 'vitest';
import { assessWarpOutput } from './warp-validation';

function makeImageData(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): ImageData {
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

describe('warp validation', () => {
  it('rejects strict block-corruption patterns', () => {
    const source = makeImageData(64, 64, (x, y) => {
      const v = (x * 5 + y * 3) % 255;
      return [v, 255 - v, (v * 2) % 255];
    });
    const warped = makeImageData(64, 64, (x, y) => {
      const blockX = Math.floor(x / 8);
      const blockY = Math.floor(y / 8);
      const v = (blockX + blockY) % 2 === 0 ? 32 : 190;
      return [v, v, v];
    });

    const result = assessWarpOutput({
      warpedImageData: warped,
      sourceImageData: source,
      isHoughAutoCapture: false,
      level: 'strict',
    });

    expect(result.rejected).toBe(true);
    expect(result.reason).toBe('block_corruption');
  });

  it('rejects near-black out-of-bounds corruption', () => {
    const source = makeImageData(64, 64, (x, y) => {
      const v = (x + y) % 255;
      return [v, (v * 2) % 255, (v * 3) % 255];
    });
    const warped = makeImageData(64, 64, (x, y) => {
      const isDark = (x + y) % 5 !== 0;
      const v = isDark ? 0 : 45;
      return [v, v, v];
    });

    const result = assessWarpOutput({
      warpedImageData: warped,
      sourceImageData: source,
      isHoughAutoCapture: false,
      level: 'strict',
    });

    expect(result.rejected).toBe(true);
    expect(result.reason).toBe('out_of_bounds_black');
  });

  it('adds dedicated hough auto-risky rejection in strict mode', () => {
    const source = makeImageData(64, 64, (x, y) => {
      const v = (x * 7 + y * 11) % 255;
      return [v, (v * 2) % 255, (v * 3) % 255];
    });
    const warped = makeImageData(64, 64, (x) => {
      const blockX = Math.floor(x / 8);
      const v = blockX % 2 === 0 ? 70 : 130;
      return [v, v, v];
    });

    const result = assessWarpOutput({
      warpedImageData: warped,
      sourceImageData: source,
      isHoughAutoCapture: true,
      level: 'strict',
    });

    expect(result.rejected).toBe(true);
    expect(result.reason).toBe('hough_auto_risky');
  });
});
