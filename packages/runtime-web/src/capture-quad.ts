import { quadArea, type Quad } from '@document-autocapture/core-engine';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeQuad(quad: Quad | undefined, width: number, height: number): Quad {
  return (
    quad ?? {
      topLeft: { x: 0, y: 0 },
      topRight: { x: width - 1, y: 0 },
      bottomRight: { x: width - 1, y: height - 1 },
      bottomLeft: { x: 0, y: height - 1 },
    }
  );
}

function orderQuadCorners(quad: Quad): Quad {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
    .map((point) => ({ x: point.x, y: point.y }));

  const center = points.reduce(
    (acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const cycle = [...points].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
  const startIndex = cycle.reduce(
    (best, point, index, arr) =>
      point.x + point.y < arr[best].x + arr[best].y ? index : best,
    0,
  );
  let ordered = [...cycle.slice(startIndex), ...cycle.slice(0, startIndex)];
  if (ordered[1].y > ordered[3].y) {
    ordered = [ordered[0], ordered[3], ordered[2], ordered[1]];
  }
  const winding =
    (ordered[1].x - ordered[0].x) * (ordered[2].y - ordered[0].y) -
    (ordered[1].y - ordered[0].y) * (ordered[2].x - ordered[0].x);
  if (winding < 0) {
    ordered = [ordered[0], ordered[3], ordered[2], ordered[1]];
  }
  return {
    topLeft: ordered[0],
    topRight: ordered[1],
    bottomRight: ordered[2],
    bottomLeft: ordered[3],
  };
}

export function scaleQuadToCapture(
  quad: Quad | undefined,
  detectWidth: number,
  detectHeight: number,
  captureWidth: number,
  captureHeight: number,
): Quad {
  const base = normalizeQuad(quad, captureWidth, captureHeight);
  if (!quad || detectWidth <= 0 || detectHeight <= 0) {
    return base;
  }

  const sx = captureWidth / detectWidth;
  const sy = captureHeight / detectHeight;
  const scalePoint = (x: number, y: number) => ({
    x: clamp(Math.round(x * sx), 0, captureWidth - 1),
    y: clamp(Math.round(y * sy), 0, captureHeight - 1),
  });

  return {
    topLeft: scalePoint(quad.topLeft.x, quad.topLeft.y),
    topRight: scalePoint(quad.topRight.x, quad.topRight.y),
    bottomRight: scalePoint(quad.bottomRight.x, quad.bottomRight.y),
    bottomLeft: scalePoint(quad.bottomLeft.x, quad.bottomLeft.y),
  };
}

export function sanitizeQuadForCapture(quad: Quad | undefined, width: number, height: number): Quad {
  const normalized = normalizeQuad(quad, width, height);
  const clamped: Quad = {
    topLeft: {
      x: clamp(Math.round(normalized.topLeft.x), 0, width - 1),
      y: clamp(Math.round(normalized.topLeft.y), 0, height - 1),
    },
    topRight: {
      x: clamp(Math.round(normalized.topRight.x), 0, width - 1),
      y: clamp(Math.round(normalized.topRight.y), 0, height - 1),
    },
    bottomRight: {
      x: clamp(Math.round(normalized.bottomRight.x), 0, width - 1),
      y: clamp(Math.round(normalized.bottomRight.y), 0, height - 1),
    },
    bottomLeft: {
      x: clamp(Math.round(normalized.bottomLeft.x), 0, width - 1),
      y: clamp(Math.round(normalized.bottomLeft.y), 0, height - 1),
    },
  };

  const ordered = orderQuadCorners(clamped);
  const area = quadArea(ordered);
  const minArea = Math.max(1, width * height * 0.01);
  if (area < minArea) {
    return normalizeQuad(undefined, width, height);
  }
  return ordered;
}
