import { describe, expect, it } from 'vitest';
import { orderQuadCorners, quadAspectRatio, quadCornerAnglePenalty } from '../math';

describe('quad math', () => {
  const quad = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 10, y: 0 },
    bottomRight: { x: 10, y: 20 },
    bottomLeft: { x: 0, y: 20 },
  };

  it('computes aspect ratio', () => {
    expect(quadAspectRatio(quad)).toBeCloseTo(0.5, 3);
  });

  it('rectangles have near-zero angle penalty', () => {
    expect(quadCornerAnglePenalty(quad)).toBeLessThan(0.01);
  });

  it('orders shuffled skewed corners into stable top/right/bottom/left positions', () => {
    const shuffled = [
      { x: 82, y: 518 }, // bottom-left
      { x: 396, y: 121 }, // top-right
      { x: 103, y: 206 }, // top-left
      { x: 374, y: 507 }, // bottom-right
    ];

    const ordered = orderQuadCorners(shuffled);
    expect(ordered.topLeft.x).toBeLessThan(ordered.topRight.x);
    expect(ordered.topLeft.y).toBeLessThan(ordered.bottomLeft.y);
    expect(ordered.topRight.y).toBeLessThan(ordered.bottomRight.y);
    expect(ordered.bottomLeft.x).toBeLessThan(ordered.bottomRight.x);
  });
});
