import { describe, expect, it } from 'vitest';
import { __cocoTestUtils } from './coco-provider';

describe('coco provider helpers', () => {
  it('keeps only book predictions above min score', () => {
    const picked = __cocoTestUtils.pickBestBookPrediction(
      [
        { class: 'person', score: 0.99, bbox: [0, 0, 50, 50] },
        { class: 'book', score: 0.44, bbox: [10, 10, 100, 100] },
        { class: 'book', score: 0.82, bbox: [12, 12, 80, 80] },
      ],
      0.45,
    );
    expect(picked?.class).toBe('book');
    expect(picked?.score).toBeCloseTo(0.82, 6);
  });

  it('converts bbox into clamped axis-aligned quad', () => {
    const quad = __cocoTestUtils.bboxToQuad([90, 90, 40, 40], 100, 100);
    expect(quad).toBeDefined();
    expect(quad?.topLeft.x).toBe(90);
    expect(quad?.topLeft.y).toBe(90);
    expect(quad?.bottomRight.x).toBe(99);
    expect(quad?.bottomRight.y).toBe(99);
  });

  it('rejects quads that violate geometry guards', () => {
    const tiny = __cocoTestUtils.bboxToQuad([10, 10, 8, 8], 200, 200);
    expect(tiny).toBeDefined();
    expect(
      __cocoTestUtils.passesGeometryGuards({
        quad: tiny!,
        frameWidth: 200,
        frameHeight: 200,
        minAreaFraction: 0.08,
        maxAreaFraction: 0.96,
        minAspectRatio: 0.6,
        maxAspectRatio: 1.9,
        edgeTouchMarginPx: 8,
      }),
    ).toBe(false);
  });
});
