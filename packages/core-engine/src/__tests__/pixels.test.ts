import { describe, expect, it } from 'vitest';
import { sobelEdges } from '../pipeline/pixels';

function buildStepImage(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const value = x < width / 2 ? 0 : 255;
      rgba[idx] = value;
      rgba[idx + 1] = value;
      rgba[idx + 2] = value;
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

describe('sobelEdges', () => {
  it('keeps strong edges above high threshold', () => {
    const width = 64;
    const height = 64;
    const rgba = buildStepImage(width, height);
    const gray = new Uint8ClampedArray(width * height);

    for (let i = 0; i < width * height; i += 1) {
      gray[i] = rgba[i * 4];
    }

    const edges = sobelEdges(gray, width, height, 30, 110);

    let edgePixels = 0;
    for (let i = 0; i < edges.edgeMap.length; i += 1) {
      if (edges.edgeMap[i] === 255) {
        edgePixels += 1;
      }
    }

    expect(edgePixels).toBeGreaterThan(0);
    expect(edges.edgeDensity).toBeGreaterThan(0);
  });
});
