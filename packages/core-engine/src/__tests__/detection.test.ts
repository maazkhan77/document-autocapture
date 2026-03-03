import { describe, expect, it } from 'vitest';
import { defaultEngineConfig } from '../config';
import { proposeQuadCandidates } from '../pipeline/detection';

function drawRectEdges(
  edgeMap: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  for (let x = left; x <= right; x += 1) {
    edgeMap[top * width + x] = 255;
    edgeMap[bottom * width + x] = 255;
  }
  for (let y = top; y <= bottom; y += 1) {
    edgeMap[y * width + left] = 255;
    edgeMap[y * width + right] = 255;
  }
}

describe('quad proposal detection', () => {
  it('extracts candidates from contour edges', () => {
    const width = 180;
    const height = 240;
    const edgeMap = new Uint8ClampedArray(width * height);
    drawRectEdges(edgeMap, width, 30, 30, 150, 204);

    const candidates = proposeQuadCandidates(edgeMap, width, height, defaultEngineConfig);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].metrics.areaFraction).toBeGreaterThan(0.2);
  });

  it('rejects contours that hug the frame border', () => {
    const width = 180;
    const height = 240;
    const edgeMap = new Uint8ClampedArray(width * height);
    drawRectEdges(edgeMap, width, 0, 0, 170, 220);

    const candidates = proposeQuadCandidates(edgeMap, width, height, defaultEngineConfig);
    expect(candidates.length).toBe(0);
  });
});
