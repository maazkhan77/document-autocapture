import { describe, expect, it } from 'vitest';
import { defaultEngineConfig } from '../config';
import { runQualityChecks } from '../pipeline/quality';

describe('quality checks', () => {
  it('accepts balanced frame and quad', () => {
    const width = 20;
    const height = 20;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const gray = new Uint8ClampedArray(width * height);

    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = 128;
      rgba[i * 4 + 1] = 128;
      rgba[i * 4 + 2] = 128;
      rgba[i * 4 + 3] = 255;
      gray[i] = 128;
    }

    const quad = {
      topLeft: { x: 2, y: 2 },
      topRight: { x: 18, y: 2 },
      bottomRight: { x: 18, y: 18 },
      bottomLeft: { x: 2, y: 18 },
    };

    const result = runQualityChecks(rgba, gray, width, height, quad, defaultEngineConfig);
    expect(result.brightness.ok).toBe(true);
    expect(result.area.ok).toBe(true);
  });

  it('uses quad ROI for brightness instead of full frame average', () => {
    const width = 40;
    const height = 40;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const gray = new Uint8ClampedArray(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const inside = x >= 10 && x <= 30 && y >= 10 && y <= 30;
        const value = inside ? 140 : 20;
        gray[index] = value;
        rgba[index * 4] = value;
        rgba[index * 4 + 1] = value;
        rgba[index * 4 + 2] = value;
        rgba[index * 4 + 3] = 255;
      }
    }

    const quad = {
      topLeft: { x: 12, y: 12 },
      topRight: { x: 28, y: 12 },
      bottomRight: { x: 28, y: 28 },
      bottomLeft: { x: 12, y: 28 },
    };

    const result = runQualityChecks(rgba, gray, width, height, quad, defaultEngineConfig);
    expect(result.brightness.averageLuma).toBeGreaterThan(100);
    expect(result.brightness.ok).toBe(true);
  });

  it('uses quad ROI for blur checks', () => {
    const width = 48;
    const height = 48;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const gray = new Uint8ClampedArray(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const inRoi = x >= 14 && x <= 34 && y >= 14 && y <= 34;
        const value = inRoi && (x + y) % 2 === 0 ? 245 : 30;
        gray[index] = value;
        rgba[index * 4] = value;
        rgba[index * 4 + 1] = value;
        rgba[index * 4 + 2] = value;
        rgba[index * 4 + 3] = 255;
      }
    }

    const quad = {
      topLeft: { x: 16, y: 16 },
      topRight: { x: 32, y: 16 },
      bottomRight: { x: 32, y: 32 },
      bottomLeft: { x: 16, y: 32 },
    };

    const result = runQualityChecks(rgba, gray, width, height, quad, defaultEngineConfig);
    expect(result.blur.laplacianVariance).toBeGreaterThan(defaultEngineConfig.blurVarianceMin);
    expect(result.blur.ok).toBe(true);
  });
});
