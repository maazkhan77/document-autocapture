import {
  borderPenalty,
  clamp,
  orderQuadCorners,
  polygonArea,
  quadArea,
  quadAspectRatio,
  quadCornerAnglePenalty,
  quadPerimeter,
} from '../math';
import type { DetectionCandidate, EngineConfig, Point, Quad } from '../types';
import { closeBinaryMap } from './pixels';

interface Component {
  pixels: number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
  boxArea: number;
  edgeDensity: number;
  perimeterCoverage: number;
}

function connectedComponents(
  edgeMap: Uint8ClampedArray,
  width: number,
  height: number,
  maxComponents: number,
): Component[] {
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const components: Component[] = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const seedIdx = y * width + x;
      if (visited[seedIdx] || edgeMap[seedIdx] === 0) {
        continue;
      }

      let ptr = 0;
      stack[ptr] = seedIdx;
      ptr += 1;
      visited[seedIdx] = 1;

      const pixels: number[] = [];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (ptr > 0) {
        ptr -= 1;
        const idx = stack[ptr];
        const cx = idx % width;
        const cy = Math.floor(idx / width);
        pixels.push(idx);

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
          if (ny < 1 || ny >= height - 1) continue;
          for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
            if (nx < 1 || nx >= width - 1) continue;
            const nIdx = ny * width + nx;
            if (!visited[nIdx] && edgeMap[nIdx] > 0) {
              visited[nIdx] = 1;
              stack[ptr] = nIdx;
              ptr += 1;
            }
          }
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const boxArea = boxWidth * boxHeight;
      if (boxArea < 128 || pixels.length < 48) {
        continue;
      }
      const perimeter = Math.max(1, 2 * (boxWidth + boxHeight));
      const edgeDensity = pixels.length / Math.max(1, boxArea);
      const perimeterCoverage = pixels.length / perimeter;

      components.push({
        pixels,
        minX,
        maxX,
        minY,
        maxY,
        area: pixels.length,
        boxArea,
        edgeDensity,
        perimeterCoverage,
      });
      if (components.length >= maxComponents) {
        return components;
      }
    }
  }

  return components;
}

function collectBoundaryPoints(
  component: Component,
  edgeMap: Uint8ClampedArray,
  width: number,
  height: number,
): Point[] {
  const points: Point[] = [];
  for (const idx of component.pixels) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const top = y === 0 || edgeMap[(y - 1) * width + x] === 0;
    const bottom = y === height - 1 || edgeMap[(y + 1) * width + x] === 0;
    const left = x === 0 || edgeMap[y * width + (x - 1)] === 0;
    const right = x === width - 1 || edgeMap[y * width + (x + 1)] === 0;
    if (top || bottom || left || right) {
      points.push({ x, y });
    }
  }
  return points;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) {
    return [...points];
  }
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: Point[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) {
    return [...points];
  }

  let maxDist = 0;
  let split = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      split = i;
    }
  }

  if (maxDist <= epsilon) {
    return [first, last];
  }

  const left = simplifyRdp(points.slice(0, split + 1), epsilon);
  const right = simplifyRdp(points.slice(split), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyClosedPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length <= 4) {
    return [...points];
  }
  const open = [...points, points[0]];
  const simplified = simplifyRdp(open, epsilon);
  if (simplified.length < 2) {
    return [...points];
  }
  const out = simplified.slice(0, -1);
  return out.length >= 3 ? out : [...points];
}

function minAreaRectFromHull(hull: Point[]): Point[] | undefined {
  if (hull.length < 3) {
    return undefined;
  }

  let bestArea = Number.POSITIVE_INFINITY;
  let bestCorners: Point[] | undefined;

  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of hull) {
      const rx = point.x * c + point.y * s;
      const ry = -point.x * s + point.y * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }

    const area = (maxX - minX) * (maxY - minY);
    if (area >= bestArea) {
      continue;
    }

    bestArea = area;
    const rotated: Point[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    bestCorners = rotated.map((point) => ({
      x: point.x * c - point.y * s,
      y: point.x * s + point.y * c,
    }));
  }

  return bestCorners;
}

function isConvex(points: Point[]): boolean {
  if (points.length < 4) {
    return false;
  }
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const c = cross(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length]);
    if (Math.abs(c) < 1e-6) {
      continue;
    }
    const nextSign = c > 0 ? 1 : -1;
    if (sign === 0) {
      sign = nextSign;
    } else if (sign !== nextSign) {
      return false;
    }
  }
  return true;
}

function pointsToQuad(raw: Point[]): Quad {
  return orderQuadCorners(raw);
}

function approximateQuad(boundary: Point[]): Quad | undefined {
  const hull = convexHull(boundary);
  if (hull.length < 4) {
    return undefined;
  }

  const epsilonCandidates = [1, 2, 3, 4, 6, 8, 12, 16];
  for (const epsilon of epsilonCandidates) {
    const simplified = simplifyClosedPolygon(hull, epsilon);
    if (simplified.length === 4 && isConvex(simplified)) {
      return pointsToQuad(simplified);
    }
  }

  const minRect = minAreaRectFromHull(hull);
  if (!minRect || minRect.length !== 4) {
    return undefined;
  }
  return pointsToQuad(minRect);
}

function borderTouchRatio(points: Point[], width: number, height: number, margin: number): number {
  if (points.length === 0) {
    return 0;
  }
  const touches = points.filter(
    (point) =>
      point.x <= margin ||
      point.y <= margin ||
      point.x >= width - 1 - margin ||
      point.y >= height - 1 - margin,
  ).length;
  return touches / points.length;
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

function edgeSupportForQuad(
  boundary: Point[],
  quad: Quad,
  tolerancePx: number,
): { coverageRatio: number; minEdgeRatio: number } {
  if (boundary.length === 0) {
    return { coverageRatio: 0, minEdgeRatio: 0 };
  }

  const edges: Array<[Point, Point]> = [
    [quad.topLeft, quad.topRight],
    [quad.topRight, quad.bottomRight],
    [quad.bottomRight, quad.bottomLeft],
    [quad.bottomLeft, quad.topLeft],
  ];
  const edgeCounts = [0, 0, 0, 0];
  let supported = 0;

  for (const point of boundary) {
    let bestEdge = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < edges.length; i += 1) {
      const [a, b] = edges[i];
      const distance = pointToSegmentDistance(point, a, b);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEdge = i;
      }
    }
    if (bestEdge >= 0 && bestDistance <= tolerancePx) {
      supported += 1;
      edgeCounts[bestEdge] += 1;
    }
  }

  const coverageRatio = supported / boundary.length;
  const minEdgeRatio = Math.min(...edgeCounts) / boundary.length;
  return { coverageRatio, minEdgeRatio };
}

export function proposeQuadCandidates(
  edgeMap: Uint8ClampedArray,
  width: number,
  height: number,
  config: EngineConfig,
): DetectionCandidate[] {
  // Keep proposal-stage area bounds permissive; hard acceptance happens later
  // in scoring + quality gates using configured thresholds.
  const proposalMinAreaFraction = Math.min(config.minAreaFraction, 0.015);
  const proposalMaxAreaFraction = Math.max(config.maxAreaFraction, 0.97);

  // Step 1: Zero out edge pixels near the frame border. On webcam footage,
  // frame borders produce dense edge noise. If we close the raw edge map,
  // this noise bridges with document edges creating one frame-spanning blob.
  // By zeroing border pixels first, closing only connects interior edges
  // (the actual document card) without merging them into frame noise.
  const margin = config.edgeTouchMarginPx || 8;
  const interior = new Uint8ClampedArray(edgeMap.length);
  for (let y = 0; y < height; y++) {
    if (y < margin || y >= height - margin) continue; // skip top/bottom rows
    for (let x = 0; x < width; x++) {
      if (x < margin || x >= width - margin) continue; // skip left/right cols
      interior[y * width + x] = edgeMap[y * width + x];
    }
  }

  // Step 2: Morphological closing bridges fragmented document edges into
  // a single connected component. With border noise removed, this produces
  // document-shaped components rather than one mega-blob.
  const closed = closeBinaryMap(interior, width, height, 1);
  const components = connectedComponents(closed, width, height, config.contourLimit);
  const frameArea = width * height;

  // Diagnostic counters for debugging
  let rejBox = 0,
    rejBoundary = 0,
    rejQuad = 0;
  let rejArea = 0,
    rejAreaFrac = 0,
    rejAspect = 0,
    rejEdgeTouch = 0,
    rejCornerBorder = 0;
  let rejRect = 0,
    rejAngle = 0,
    rejCenter = 0;

  const proposals = components
    .map((component) => {
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      // Skip tiny components
      if (boxWidth < 10 || boxHeight < 10) {
        rejBox++;
        return undefined;
      }
      // Skip components whose bounding box covers >90% of frame —
      // these are always the "entire frame" blob, never a real document.
      const boxAreaFrac = (boxWidth * boxHeight) / frameArea;
      if (boxAreaFrac > 0.97) {
        rejBox++;
        return undefined;
      }

      const boundary = collectBoundaryPoints(component, closed, width, height);
      if (boundary.length < 12) {
        rejBoundary++;
        return undefined;
      }

      const quad = approximateQuad(boundary);
      if (!quad) {
        rejQuad++;
        return undefined;
      }

      const area = quadArea(quad);
      if (area <= 0) {
        rejArea++;
        return undefined;
      }

      const areaFraction = area / frameArea;
      const aspectRatio = quadAspectRatio(quad);
      const hull = convexHull(boundary);
      const hullArea = polygonArea(hull);
      const rectangularity = area / Math.max(1, hullArea);
      const edgeTouch = borderTouchRatio(boundary, width, height, config.edgeTouchMarginPx);
      const cornerBorder = borderPenalty(quad, width, height, config.edgeTouchMarginPx);
      const anglePenalty = quadCornerAnglePenalty(quad);
      const centerX = (component.minX + component.maxX) / 2;
      const centerY = (component.minY + component.maxY) / 2;
      const centerDistanceNorm =
        Math.hypot(centerX - width / 2, centerY - height / 2) / Math.hypot(width, height);
      const edgeSupport = edgeSupportForQuad(
        boundary,
        quad,
        Math.max(4, Math.round(Math.min(width, height) * 0.02)),
      );

      if (areaFraction < proposalMinAreaFraction || areaFraction > proposalMaxAreaFraction) {
        rejAreaFrac++;
        return undefined;
      }
      if (aspectRatio < config.minAspectRatio || aspectRatio > config.maxAspectRatio) {
        rejAspect++;
        return undefined;
      }
      if (edgeTouch > 0.5) {
        rejEdgeTouch++;
        return undefined;
      }
      if (cornerBorder > 0.25) {
        rejCornerBorder++;
        return undefined;
      }
      if (rectangularity < config.minRectangularity) {
        rejRect++;
        return undefined;
      }
      if (anglePenalty > 250) {
        rejAngle++;
        return undefined;
      }
      // NOTE: edgeSupport pre-filter removed — on webcam footage with hand-held
      // documents, edges are too sparse/noisy to reliably pass coverage checks.
      // Edge support is still computed and used in the scoring metrics below.
      if (centerDistanceNorm > 0.45 && areaFraction < 0.03) {
        rejCenter++;
        return undefined;
      }

      return {
        quad,
        score: 0,
        confidence: 0,
        metrics: {
          areaFraction,
          aspectPlausibility: 0,
          edgeContrast: 0,
          interiorHomogeneity: 0,
          cornerAngleCloseness: 0,
          borderPenalty: clamp(edgeTouch, 0, 1),
        },
        area,
        perimeter: quadPerimeter(quad),
        convexity: clamp(rectangularity, 0, 1),
        edgeStrength: clamp(edgeSupport.coverageRatio, 0, 1),
      } satisfies DetectionCandidate;
    })
    .filter((candidate): candidate is DetectionCandidate => Boolean(candidate));

  // Diagnostic log — prints only when 0 candidates survive
  if (config.debug && proposals.length === 0 && components.length > 0) {
    const total = components.length;
    console.warn(
      `[document-autocapture:detection] 0/${total} components passed | ` +
        `rej: box=${rejBox} boundary=${rejBoundary} ` +
        `quad=${rejQuad} area=${rejArea} areaFrac=${rejAreaFrac} aspect=${rejAspect} ` +
        `edgeTouch=${rejEdgeTouch} cornerBorder=${rejCornerBorder} ` +
        `rect=${rejRect} angle=${rejAngle} center=${rejCenter}`,
    );
  }

  const deduped: DetectionCandidate[] = [];
  const sorted = proposals.sort((a, b) => b.area - a.area);
  for (const candidate of sorted) {
    const centerX =
      (candidate.quad.topLeft.x +
        candidate.quad.topRight.x +
        candidate.quad.bottomLeft.x +
        candidate.quad.bottomRight.x) /
      4;
    const centerY =
      (candidate.quad.topLeft.y +
        candidate.quad.topRight.y +
        candidate.quad.bottomLeft.y +
        candidate.quad.bottomRight.y) /
      4;
    const isDuplicate = deduped.some((existing) => {
      const ex =
        (existing.quad.topLeft.x +
          existing.quad.topRight.x +
          existing.quad.bottomLeft.x +
          existing.quad.bottomRight.x) /
        4;
      const ey =
        (existing.quad.topLeft.y +
          existing.quad.topRight.y +
          existing.quad.bottomLeft.y +
          existing.quad.bottomRight.y) /
        4;
      const closeCenter =
        Math.abs(centerX - ex) < width * 0.04 && Math.abs(centerY - ey) < height * 0.04;
      const areaRatio =
        Math.abs(candidate.area - existing.area) / Math.max(candidate.area, existing.area);
      return closeCenter && areaRatio < 0.18;
    });
    if (!isDuplicate) {
      deduped.push(candidate);
    }
  }

  return deduped.sort((a, b) => b.area - a.area).slice(0, config.candidateTopK);
}
