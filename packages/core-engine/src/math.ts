import type { Point, Quad } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function pointDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function quadToPoints(quad: Quad): Point[] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

function rotatePoints(points: Point[], startIndex: number): Point[] {
  const normalized = ((startIndex % points.length) + points.length) % points.length;
  return [...points.slice(normalized), ...points.slice(0, normalized)];
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Orders corners in image-space order (topLeft, topRight, bottomRight, bottomLeft)
 * even when input points are shuffled or heavily skewed.
 */
export function orderQuadCorners(points: Array<Point> | Quad): Quad {
  const pts = (Array.isArray(points) ? points : quadToPoints(points))
    .slice(0, 4)
    .map((point) => ({ x: point.x, y: point.y }));

  if (pts.length < 4) {
    throw new Error('orderQuadCorners requires 4 points');
  }

  const center = pts.reduce((acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }), {
    x: 0,
    y: 0,
  });

  // Angular sort creates a consistent cycle around centroid.
  const cycle = [...pts].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );

  // Start from visual top-left corner in image coordinates.
  const startIndex = cycle.reduce(
    (best, point, index, arr) => (point.x + point.y < arr[best].x + arr[best].y ? index : best),
    0,
  );
  let ordered = rotatePoints(cycle, startIndex);

  // Ensure second corner is top-right and not bottom-left.
  if (ordered[1].y > ordered[3].y) {
    ordered = [ordered[0], ordered[3], ordered[2], ordered[1]];
  }

  // Enforce clockwise winding in screen-space for stable homography input.
  if (orientation(ordered[0], ordered[1], ordered[2]) < 0) {
    ordered = [ordered[0], ordered[3], ordered[2], ordered[1]];
  }

  return {
    topLeft: ordered[0],
    topRight: ordered[1],
    bottomRight: ordered[2],
    bottomLeft: ordered[3],
  };
}

export function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

export function polygonPerimeter(points: Point[]): number {
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    perimeter += pointDistance(points[i], points[(i + 1) % points.length]);
  }
  return perimeter;
}

export function quadArea(quad: Quad): number {
  return polygonArea(quadToPoints(quad));
}

export function quadPerimeter(quad: Quad): number {
  return polygonPerimeter(quadToPoints(quad));
}

export function quadAspectRatio(quad: Quad): number {
  const topWidth = pointDistance(quad.topLeft, quad.topRight);
  const bottomWidth = pointDistance(quad.bottomLeft, quad.bottomRight);
  const leftHeight = pointDistance(quad.topLeft, quad.bottomLeft);
  const rightHeight = pointDistance(quad.topRight, quad.bottomRight);
  const width = (topWidth + bottomWidth) / 2;
  const height = (leftHeight + rightHeight) / 2;
  if (height === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return width / height;
}

function angle(a: Point, b: Point, c: Point): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) {
    return 0;
  }
  const cosine = clamp(dot / mag, -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function quadCornerAnglePenalty(quad: Quad): number {
  const points = quadToPoints(quad);
  const angles = [
    angle(points[3], points[0], points[1]),
    angle(points[0], points[1], points[2]),
    angle(points[1], points[2], points[3]),
    angle(points[2], points[3], points[0]),
  ];
  return angles.reduce((acc, current) => acc + Math.abs(current - 90), 0);
}

export function scaleQuad(quad: Quad, sx: number, sy: number): Quad {
  return {
    topLeft: { x: quad.topLeft.x * sx, y: quad.topLeft.y * sy },
    topRight: { x: quad.topRight.x * sx, y: quad.topRight.y * sy },
    bottomRight: { x: quad.bottomRight.x * sx, y: quad.bottomRight.y * sy },
    bottomLeft: { x: quad.bottomLeft.x * sx, y: quad.bottomLeft.y * sy },
  };
}

export function boundingRect(quad: Quad): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const pts = quadToPoints(quad);
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

export function maxCornerDisplacement(a: Quad, b: Quad): number {
  return Math.max(
    pointDistance(a.topLeft, b.topLeft),
    pointDistance(a.topRight, b.topRight),
    pointDistance(a.bottomRight, b.bottomRight),
    pointDistance(a.bottomLeft, b.bottomLeft),
  );
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(a[k][i]) > Math.abs(a[maxRow][i])) {
        maxRow = k;
      }
    }
    [a[i], a[maxRow]] = [a[maxRow], a[i]];
    const pivot = a[i][i];
    if (Math.abs(pivot) < 1e-8) {
      throw new Error('Singular matrix while solving homography');
    }
    for (let j = i; j <= n; j += 1) {
      a[i][j] /= pivot;
    }
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const factor = a[k][i];
      for (let j = i; j <= n; j += 1) {
        a[k][j] -= factor * a[i][j];
      }
    }
  }

  return a.map((row) => row[n]);
}

export function computeHomography(src: Point[], dst: Point[]): number[] {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('Homography requires 4 source and 4 destination points');
  }

  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];

    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-8) {
    return { x: p.x, y: p.y };
  }
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

// ── Shared timing utility ────────────────────────────────────────────────

/**
 * High-resolution timer that falls back to `Date.now()` in environments
 * where `performance` is unavailable (e.g. some test runners).
 */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ── Border penalty ───────────────────────────────────────────────────────

/**
 * Fraction of quad corners that touch the frame border (within `margin` px).
 * Returns a value in [0, 1] (0 = no corners near border, 1 = all four).
 */
export function borderPenalty(quad: Quad, width: number, height: number, margin = 8): number {
  const points = quadToPoints(quad);
  const touches = points.filter(
    (p) =>
      p.x <= margin || p.y <= margin || p.x >= width - 1 - margin || p.y >= height - 1 - margin,
  ).length;
  return clamp(touches / 4, 0, 1);
}

// ── Polygon clipping (Sutherland-Hodgman) ────────────────────────────────

function polygonSignedArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return area / 2;
}

function clipIsInside(
  point: Point,
  edgeStart: Point,
  edgeEnd: Point,
  orientation: 1 | -1,
): boolean {
  const cross =
    (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) -
    (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
  return orientation * cross >= -1e-8;
}

function clipLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
  const x4 = p4.x;
  const y4 = p4.y;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-8) {
    return { x: p2.x, y: p2.y };
  }
  const pre = x1 * y2 - y1 * x2;
  const post = x3 * y4 - y3 * x4;
  return {
    x: (pre * (x3 - x4) - (x1 - x2) * post) / den,
    y: (pre * (y3 - y4) - (y1 - y2) * post) / den,
  };
}

/**
 * Compute the intersection of two convex polygons using
 * the Sutherland-Hodgman clipping algorithm.
 */
export function intersectConvexPolygons(subject: Point[], clip: Point[]): Point[] {
  if (subject.length === 0 || clip.length === 0) {
    return [];
  }
  let output = [...subject];
  const orientation = polygonSignedArea(clip) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length; i += 1) {
    const cp1 = clip[i];
    const cp2 = clip[(i + 1) % clip.length];
    const input = [...output];
    output = [];
    if (input.length === 0) {
      break;
    }
    let s = input[input.length - 1];
    for (const e of input) {
      const eInside = clipIsInside(e, cp1, cp2, orientation);
      const sInside = clipIsInside(s, cp1, cp2, orientation);
      if (eInside) {
        if (!sInside) {
          output.push(clipLineIntersection(s, e, cp1, cp2));
        }
        output.push(e);
      } else if (sInside) {
        output.push(clipLineIntersection(s, e, cp1, cp2));
      }
      s = e;
    }
  }
  return output;
}

/**
 * Intersection-over-Union for two quads, using Sutherland-Hodgman clipping.
 */
export function quadIoU(a: Quad, b: Quad): number {
  const polygonA = quadToPoints(a);
  const polygonB = quadToPoints(b);
  const intersectionPolygon = intersectConvexPolygons(polygonA, polygonB);
  const intersectionArea = polygonArea(intersectionPolygon);
  const areaA = polygonArea(polygonA);
  const areaB = polygonArea(polygonB);
  const union = Math.max(1e-6, areaA + areaB - intersectionArea);
  return intersectionArea / union;
}
