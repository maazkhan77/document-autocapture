import { describe, expect, it } from 'vitest';
import { sanitizeQuadForCapture, scaleQuadToCapture } from './capture-quad';

describe('capture quad utilities', () => {
  it('scales preview quad into capture resolution', () => {
    const scaled = scaleQuadToCapture(
      {
        topLeft: { x: 48, y: 24 },
        topRight: { x: 432, y: 24 },
        bottomRight: { x: 432, y: 624 },
        bottomLeft: { x: 48, y: 624 },
      },
      480,
      672,
      960,
      1344,
    );

    expect(scaled.topLeft.x).toBe(96);
    expect(scaled.bottomRight.y).toBe(1248);
  });

  it('falls back to full-image quad when invalid area is provided', () => {
    const sanitized = sanitizeQuadForCapture(
      {
        topLeft: { x: 100, y: 100 },
        topRight: { x: 101, y: 100 },
        bottomRight: { x: 101, y: 101 },
        bottomLeft: { x: 100, y: 101 },
      },
      800,
      1200,
    );

    expect(sanitized.topLeft.x).toBe(0);
    expect(sanitized.bottomRight.x).toBe(799);
    expect(sanitized.bottomRight.y).toBe(1199);
  });

  it('orders corners to image top/bottom orientation to avoid upside-down warp', () => {
    const sanitized = sanitizeQuadForCapture(
      {
        topLeft: { x: 620, y: 1040 },
        topRight: { x: 180, y: 180 },
        bottomRight: { x: 130, y: 980 },
        bottomLeft: { x: 700, y: 240 },
      },
      800,
      1200,
    );

    expect(sanitized.topLeft.y).toBeLessThan(sanitized.bottomLeft.y);
    expect(sanitized.topRight.y).toBeLessThan(sanitized.bottomRight.y);
    expect(sanitized.topLeft.x).toBeLessThan(sanitized.topRight.x);
    expect(sanitized.bottomLeft.x).toBeLessThan(sanitized.bottomRight.x);
  });
});
