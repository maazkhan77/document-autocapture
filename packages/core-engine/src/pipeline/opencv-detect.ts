/**
 * OpenCV.js document detection pipeline.
 *
 * Primary path: contour-based quad extraction.
 * Recovery path: Hough-line quad reconstruction (guarded by edge-density and contour confidence proxies).
 */

import type { DetectionCandidate, EngineConfig, Point, ProposalSource, Quad } from '../types';
import {
  maxCornerDisplacement,
  orderQuadCorners,
  quadArea,
  quadAspectRatio,
  quadCornerAnglePenalty,
  quadPerimeter,
  quadToPoints,
} from '../math';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const cv: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let opencvReady = false;
const EDGE_SUPPORT_MIN = 0.12;

interface ApproxMatLike {
  rows: number;
  data32S?: ArrayLike<number>;
  data32F?: ArrayLike<number>;
  delete: () => void;
}

interface ContourLike {
  delete: () => void;
}

interface ContourVectorLike {
  size: () => number;
  get: (index: number) => ContourLike;
}

interface HoughLineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angleRad: number;
}

interface HoughLinesMatLike {
  data32S?: ArrayLike<number>;
}

interface OpenCvDiagnostics {
  proposalSources: ProposalSource[];
  fallbackState: 'inactive' | 'armed' | 'active';
  edgeDensity: number;
}

export interface OpenCvDetectionOutput {
  candidates: DetectionCandidate[];
  gray: Uint8ClampedArray;
  blurred: Uint8ClampedArray;
  magnitude: Float32Array;
  diagnostics: OpenCvDiagnostics;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function quadEdgeLengths(quad: Quad): [number, number, number, number] {
  const a = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  const b = Math.hypot(
    quad.bottomRight.x - quad.topRight.x,
    quad.bottomRight.y - quad.topRight.y,
  );
  const c = Math.hypot(
    quad.bottomLeft.x - quad.bottomRight.x,
    quad.bottomLeft.y - quad.bottomRight.y,
  );
  const d = Math.hypot(quad.topLeft.x - quad.bottomLeft.x, quad.topLeft.y - quad.bottomLeft.y);
  return [a, b, c, d];
}

function readPointFromApprox(approx: ApproxMatLike, index: number): Point | undefined {
  if (approx.data32S && approx.data32S.length >= (index + 1) * 2) {
    return {
      x: approx.data32S[index * 2],
      y: approx.data32S[index * 2 + 1],
    };
  }
  if (approx.data32F && approx.data32F.length >= (index + 1) * 2) {
    return {
      x: approx.data32F[index * 2],
      y: approx.data32F[index * 2 + 1],
    };
  }
  return undefined;
}

function sampleEdgeSupport(
  edgeMap: ArrayLike<number>,
  width: number,
  height: number,
  quad: Quad,
  samplesPerEdge = 24,
): number {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let hits = 0;
  let total = 0;

  for (let edge = 0; edge < 4; edge += 1) {
    const start = points[edge];
    const end = points[(edge + 1) % 4];
    for (let i = 0; i <= samplesPerEdge; i += 1) {
      const t = i / samplesPerEdge;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t);
      total += 1;

      let found = false;
      for (let oy = -1; oy <= 1 && !found; oy += 1) {
        const sy = y + oy;
        if (sy < 0 || sy >= height) {
          continue;
        }
        for (let ox = -1; ox <= 1; ox += 1) {
          const sx = x + ox;
          if (sx < 0 || sx >= width) {
            continue;
          }
          if (edgeMap[sy * width + sx] > 0) {
            found = true;
            break;
          }
        }
      }

      if (found) {
        hits += 1;
      }
    }
  }

  return total > 0 ? hits / total : 0;
}

function computeEdgeDensity(edgeMap: ArrayLike<number>): number {
  let count = 0;
  for (let i = 0; i < edgeMap.length; i += 1) {
    if (edgeMap[i] > 0) {
      count += 1;
    }
  }
  return count / Math.max(1, edgeMap.length);
}

function suppressFrameBorderEdges(
  edgeMap: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  margin: number,
): void {
  if (margin <= 0) {
    return;
  }
  const safeMargin = Math.min(Math.floor(margin), Math.floor(Math.min(width, height) / 2));
  if (safeMargin <= 0) {
    return;
  }
  for (let y = 0; y < height; y += 1) {
    const borderRow = y < safeMargin || y >= height - safeMargin;
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      if (borderRow || x < safeMargin || x >= width - safeMargin) {
        edgeMap[rowStart + x] = 0;
      }
    }
  }
}

function isHoughEdgeDensityAllowed(edgeDensity: number, config: EngineConfig): boolean {
  return edgeDensity >= config.houghEdgeDensityMin && edgeDensity <= config.houghEdgeDensityMax;
}

function shouldRunHoughFallback(
  contourCandidates: DetectionCandidate[],
  width: number,
  height: number,
  edgeDensity: number,
  config: EngineConfig,
): boolean {
  const contourTop = contourCandidates[0];
  const contourSecond = contourCandidates[1];
  const contourAmbiguousProxy =
    Boolean(contourTop && contourSecond) &&
    Math.abs(contourTop.area - contourSecond.area) / Math.max(1, contourTop.area) < 0.12;
  const contourWeakProxy =
    Boolean(contourTop) && (contourTop.edgeStrength < 0.28 || contourTop.convexity < 0.45);

  const frameArea = Math.max(1, width * height);
  const contourTinyProxy =
    Boolean(contourTop) &&
    contourTop.area / frameArea < Math.max(0.06, config.minAreaFraction * 0.9);

  const houghAllowedByDensity = isHoughEdgeDensityAllowed(edgeDensity, config);

  return (
    config.houghSecondaryEnabled &&
    houghAllowedByDensity &&
    (contourCandidates.length === 0 ||
      contourAmbiguousProxy ||
      contourWeakProxy ||
      contourTinyProxy)
  );
}

function dedupeCandidates(
  candidates: DetectionCandidate[],
  width: number,
  height: number,
): DetectionCandidate[] {
  const deduped: DetectionCandidate[] = [];
  const sorted = [...candidates].sort((a, b) => b.area - a.area);
  for (const candidate of sorted) {
    const centerX =
      (candidate.quad.topLeft.x +
        candidate.quad.topRight.x +
        candidate.quad.bottomRight.x +
        candidate.quad.bottomLeft.x) /
      4;
    const centerY =
      (candidate.quad.topLeft.y +
        candidate.quad.topRight.y +
        candidate.quad.bottomRight.y +
        candidate.quad.bottomLeft.y) /
      4;

    const duplicate = deduped.some((existing) => {
      const ex =
        (existing.quad.topLeft.x +
          existing.quad.topRight.x +
          existing.quad.bottomRight.x +
          existing.quad.bottomLeft.x) /
        4;
      const ey =
        (existing.quad.topLeft.y +
          existing.quad.topRight.y +
          existing.quad.bottomRight.y +
          existing.quad.bottomLeft.y) /
        4;
      const closeCenter = Math.abs(centerX - ex) < width * 0.065 && Math.abs(centerY - ey) < height * 0.065;
      const areaRatio = Math.abs(candidate.area - existing.area) / Math.max(1, Math.max(candidate.area, existing.area));
      const cornerDelta = maxCornerDisplacement(candidate.quad, existing.quad);
      const cornerNear = cornerDelta < Math.hypot(width, height) * 0.09;
      return (closeCenter && areaRatio < 0.3) || (cornerNear && areaRatio < 0.35);
    });

    if (!duplicate) {
      deduped.push(candidate);
    }
  }

  return deduped;
}

function borderPenalty(quad: Quad, width: number, height: number, margin: number): number {
  const borderTouches = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft].filter(
    (point) =>
      point.x <= margin ||
      point.y <= margin ||
      point.x >= width - 1 - margin ||
      point.y >= height - 1 - margin,
  ).length;
  return borderTouches / 4;
}

function quadIsSelfIntersecting(quad: Quad): boolean {
  const points = quadToPoints(quad);

  const ccw = (a: Point, b: Point, c: Point) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  const intersects = (a: Point, b: Point, c: Point, d: Point) =>
    ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

  return intersects(points[0], points[1], points[2], points[3]) || intersects(points[1], points[2], points[3], points[0]);
}

function angleAt(a: Point, b: Point, c: Point): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) {
    return 0;
  }
  const cosine = Math.max(-1, Math.min(1, dot / mag));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function hasOrthogonalShape(quad: Quad, minDeg: number, maxDeg: number): boolean {
  const points = quadToPoints(quad);
  const angles = [
    angleAt(points[3], points[0], points[1]),
    angleAt(points[0], points[1], points[2]),
    angleAt(points[1], points[2], points[3]),
    angleAt(points[2], points[3], points[0]),
  ];
  return angles.every((value) => value >= minDeg && value <= maxDeg);
}

function lineIntersection(a: HoughLineSegment, b: HoughLineSegment): Point | undefined {
  const den = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
  if (Math.abs(den) < 1e-8) {
    return undefined;
  }
  const pre = a.x1 * a.y2 - a.y1 * a.x2;
  const post = b.x1 * b.y2 - b.y1 * b.x2;
  return {
    x: (pre * (b.x1 - b.x2) - (a.x1 - a.x2) * post) / den,
    y: (pre * (b.y1 - b.y2) - (a.y1 - a.y2) * post) / den,
  };
}

function parseHoughLines(linesMat: HoughLinesMatLike): HoughLineSegment[] {
  const values = linesMat?.data32S as ArrayLike<number> | undefined;
  if (!values || values.length < 4) {
    return [];
  }
  const lines: HoughLineSegment[] = [];
  for (let i = 0; i + 3 < values.length; i += 4) {
    const x1 = values[i];
    const y1 = values[i + 1];
    const x2 = values[i + 2];
    const y2 = values[i + 3];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 1) {
      continue;
    }
    lines.push({
      x1,
      y1,
      x2,
      y2,
      length,
      angleRad: Math.atan2(dy, dx),
    });
  }
  return lines;
}

function normalizeLineOrientation(line: HoughLineSegment): HoughLineSegment {
  if (line.y1 > line.y2 || (line.y1 === line.y2 && line.x1 > line.x2)) {
    return {
      ...line,
      x1: line.x2,
      y1: line.y2,
      x2: line.x1,
      y2: line.y1,
      angleRad: Math.atan2(line.y1 - line.y2, line.x1 - line.x2),
    };
  }
  return line;
}

function collectHoughCandidates(
  linesMat: HoughLinesMatLike,
  edgeMap: ArrayLike<number>,
  width: number,
  height: number,
  config: EngineConfig,
): DetectionCandidate[] {
  const frameArea = width * height;
  const proposalMinAreaFraction = Math.max(config.minAreaFraction, 0.08);
  const proposalMaxAreaFraction = Math.min(config.maxAreaFraction, 0.78);
  const minPerimeterFraction = 0.3;
  const framePerimeter = 2 * (width + height);
  const minShortSide = Math.min(width, height) * 0.2;
  const parsed = parseHoughLines(linesMat).map(normalizeLineOrientation);
  if (parsed.length < 4) {
    return [];
  }

  const horizontals = parsed
    .filter((line) => {
      const absAngle = Math.abs((line.angleRad * 180) / Math.PI);
      return absAngle <= 30 || absAngle >= 150;
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);

  const verticals = parsed
    .filter((line) => {
      const absAngle = Math.abs((line.angleRad * 180) / Math.PI);
      return absAngle >= 60 && absAngle <= 120;
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);

  if (horizontals.length < 2 || verticals.length < 2) {
    return [];
  }

  const minHorizontalSeparation = height * 0.12;
  const minVerticalSeparation = width * 0.12;
  const candidates: DetectionCandidate[] = [];

  let combinations = 0;
  for (let i = 0; i < horizontals.length; i += 1) {
    for (let j = i + 1; j < horizontals.length; j += 1) {
      const top = horizontals[i];
      const bottom = horizontals[j];
      const topY = (top.y1 + top.y2) / 2;
      const bottomY = (bottom.y1 + bottom.y2) / 2;
      if (Math.abs(topY - bottomY) < minHorizontalSeparation) {
        continue;
      }

      for (let k = 0; k < verticals.length; k += 1) {
        for (let m = k + 1; m < verticals.length; m += 1) {
          const left = verticals[k];
          const right = verticals[m];
          const leftX = (left.x1 + left.x2) / 2;
          const rightX = (right.x1 + right.x2) / 2;
          if (Math.abs(leftX - rightX) < minVerticalSeparation) {
            continue;
          }

          combinations += 1;
          if (combinations > 220) {
            break;
          }

          const p1 = lineIntersection(top, left);
          const p2 = lineIntersection(top, right);
          const p3 = lineIntersection(bottom, right);
          const p4 = lineIntersection(bottom, left);
          if (!p1 || !p2 || !p3 || !p4) {
            continue;
          }

          const quad = orderQuadCorners([p1, p2, p3, p4]);
          if (quadIsSelfIntersecting(quad)) {
            continue;
          }
          if (!hasOrthogonalShape(quad, config.houghOrthogonalityMinDeg, config.houghOrthogonalityMaxDeg)) {
            continue;
          }

          const area = quadArea(quad);
          if (!Number.isFinite(area) || area <= 0) {
            continue;
          }

          const areaFraction = area / frameArea;
          if (areaFraction < proposalMinAreaFraction || areaFraction > proposalMaxAreaFraction) {
            continue;
          }

          const aspect = quadAspectRatio(quad);
          if (aspect < config.minAspectRatio || aspect > config.maxAspectRatio) {
            continue;
          }

          const edgeLengths = quadEdgeLengths(quad);
          const shortSide = Math.min(...edgeLengths);
          const quadPerim = edgeLengths[0] + edgeLengths[1] + edgeLengths[2] + edgeLengths[3];
          const perimFraction = quadPerim / framePerimeter;
          if (shortSide < minShortSide || perimFraction < minPerimeterFraction) {
            continue;
          }

          const border = borderPenalty(quad, width, height, config.edgeTouchMarginPx);
          if (border >= 0.5) {
            continue;
          }

          const edgeSupport = sampleEdgeSupport(edgeMap, width, height, quad, 28);
          if (edgeSupport < EDGE_SUPPORT_MIN) {
            continue;
          }

          const cornerPenalty = quadCornerAnglePenalty(quad);
          const convexity = clamp01(1 - cornerPenalty / 360);

          candidates.push({
            quad,
            source: 'hough',
            score: 0,
            confidence: 0,
            metrics: {
              areaFraction,
              aspectPlausibility: aspect,
              edgeContrast: 0,
              interiorHomogeneity: 0,
              cornerAngleCloseness: 0,
              borderPenalty: border,
            },
            area,
            perimeter: quadPerim,
            convexity,
            edgeStrength: edgeSupport,
          });
        }
      }
    }
  }

  return dedupeCandidates(candidates, width, height);
}

function collectContourCandidates(
  contours: ContourVectorLike,
  edgeMap: ArrayLike<number>,
  width: number,
  height: number,
  config: EngineConfig,
  source: ProposalSource,
): DetectionCandidate[] {
  const frameArea = width * height;
  const proposalMinAreaFraction = Math.min(config.minAreaFraction, 0.015);
  const proposalMaxAreaFraction = Math.max(config.maxAreaFraction, 0.97);
  // Minimum perimeter relative to frame: reject tiny high-edge-density contours (barcodes, QR codes)
  const minPerimeterFraction = 0.27; // Must span at least 27% of frame perimeter
  const minShortSide = Math.min(width, height) * 0.18;
  const framePerimeter = 2 * (width + height);
  const candidates: DetectionCandidate[] = [];
  const numContours = contours.size();

  for (let i = 0; i < numContours; i += 1) {
    const contour = contours.get(i);
    try {
      const contourArea = Math.abs(cv.contourArea(contour));
      if (!Number.isFinite(contourArea) || contourArea <= 0) {
        continue;
      }

      const perimeter = cv.arcLength(contour, true);
      if (!Number.isFinite(perimeter) || perimeter <= 0) {
        continue;
      }

      let approxQuad: ApproxMatLike | undefined;
      const epsFactors = [0.015, 0.02, 0.03, 0.04];
      for (const factor of epsFactors) {
        const approx = new cv.Mat() as ApproxMatLike;
        cv.approxPolyDP(contour, approx, factor * perimeter, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          approxQuad = approx;
          break;
        }
        approx.delete();
      }

      if (!approxQuad) {
        continue;
      }

      const points: Point[] = [];
      for (let j = 0; j < 4; j += 1) {
        const point = readPointFromApprox(approxQuad, j);
        if (!point) {
          break;
        }
        points.push(point);
      }
      approxQuad.delete();
      if (points.length !== 4) {
        continue;
      }

      const quad = orderQuadCorners(points) as Quad;
      if (quadIsSelfIntersecting(quad)) {
        continue;
      }

      const area = quadArea(quad);
      if (area <= 0) {
        continue;
      }

      const areaFraction = area / frameArea;
      if (areaFraction < proposalMinAreaFraction || areaFraction > proposalMaxAreaFraction) {
        continue;
      }

      // Reject barcode/QR-code-sized contours: they have small perimeters relative to frame.
      // Use quad perimeter (4-point approx) rather than contour perimeter (jagged edges inflate it).
      const edgeLengths = quadEdgeLengths(quad);
      const shortSide = Math.min(...edgeLengths);
      const quadPerim = edgeLengths[0] + edgeLengths[1] + edgeLengths[2] + edgeLengths[3];
      const perimFraction = quadPerim / framePerimeter;
      if (shortSide < minShortSide || perimFraction < minPerimeterFraction) {
        continue;
      }

      const aspect = quadAspectRatio(quad);
      if (aspect < config.minAspectRatio || aspect > config.maxAspectRatio) {
        continue;
      }

      const hull = new cv.Mat();
      cv.convexHull(contour, hull);
      const hullArea = Math.abs(cv.contourArea(hull));
      hull.delete();
      const convexity = hullArea > 0 ? clamp01(contourArea / hullArea) : 0;

      const rectangularity = clamp01(contourArea / Math.max(1, area));
      if (rectangularity < config.minRectangularity) {
        continue;
      }

      const border = borderPenalty(quad, width, height, config.edgeTouchMarginPx);
      if (border > 0.5) {
        continue;
      }
      const edgeSupport = sampleEdgeSupport(edgeMap, width, height, quad);
      if (edgeSupport < EDGE_SUPPORT_MIN) {
        continue;
      }

      candidates.push({
        quad,
        source,
        score: 0,
        confidence: 0,
        metrics: {
          areaFraction,
          aspectPlausibility: aspect,
          edgeContrast: 0,
          interiorHomogeneity: 0,
          cornerAngleCloseness: 0,
          borderPenalty: border,
        },
        area,
        perimeter: quadPerimeter(quad),
        convexity: clamp01((convexity + rectangularity) * 0.5),
        edgeStrength: edgeSupport,
      });
    } finally {
      contour.delete();
    }
  }

  return dedupeCandidates(candidates, width, height);
}

export function isOpenCVReady(): boolean {
  return opencvReady && typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined';
}

export function setOpenCVReady(): void {
  opencvReady = true;
}

export function detectWithOpenCV(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  config: EngineConfig,
): OpenCvDetectionOutput {
  const mats: Array<{ delete: () => void }> = [];

  try {
    const src = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
    mats.push(src);

    const gray = new cv.Mat();
    mats.push(gray);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const blurred = new cv.Mat();
    mats.push(blurred);
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0);

    const edges = new cv.Mat();
    mats.push(edges);
    cv.Canny(blurred, edges, config.edgeLowThreshold ?? 50, config.edgeHighThreshold ?? 150);

    // Morphological CLOSE (dilate→erode) bridges gaps in card borders,
    // then a small dilation ensures contour connectivity.
    const closeKernel = cv.Mat.ones(5, 5, cv.CV_8U);
    mats.push(closeKernel);
    const closed = new cv.Mat();
    mats.push(closed);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, closeKernel);

    const dilated = new cv.Mat();
    mats.push(dilated);
    const dilateKernel = cv.Mat.ones(3, 3, cv.CV_8U);
    mats.push(dilateKernel);
    cv.dilate(closed, dilated, dilateKernel);

    const borderMargin = Math.max(2, config.edgeTouchMarginPx ?? 8);
    suppressFrameBorderEdges(edges.data as Uint8Array, width, height, borderMargin);
    suppressFrameBorderEdges(dilated.data as Uint8Array, width, height, borderMargin);

    const contours = new cv.MatVector();
    mats.push(contours);
    const hierarchy = new cv.Mat();
    mats.push(hierarchy);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const rawEdgeMap = edges.data as ArrayLike<number>;
    const edgeMap = dilated.data as ArrayLike<number>;
    // Use pre-dilation density for hough gating; dilated maps overstate density.
    const edgeDensity = computeEdgeDensity(rawEdgeMap);

    let contourCandidates = collectContourCandidates(contours, edgeMap, width, height, config, 'contour');

    if (contourCandidates.length === 0) {
      const adaptive = new cv.Mat();
      mats.push(adaptive);
      cv.adaptiveThreshold(
        gray,
        adaptive,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        31,
        11,
      );

      const inverted = new cv.Mat();
      mats.push(inverted);
      cv.bitwise_not(adaptive, inverted);

      const fallbackMask = new cv.Mat();
      mats.push(fallbackMask);
      const fallbackKernel = cv.Mat.ones(3, 3, cv.CV_8U);
      mats.push(fallbackKernel);
      cv.morphologyEx(inverted, fallbackMask, cv.MORPH_CLOSE, fallbackKernel);

      const fallbackContours = new cv.MatVector();
      mats.push(fallbackContours);
      const fallbackHierarchy = new cv.Mat();
      mats.push(fallbackHierarchy);
      cv.findContours(
        fallbackMask,
        fallbackContours,
        fallbackHierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE,
      );

      contourCandidates = collectContourCandidates(
        fallbackContours,
        fallbackMask.data as ArrayLike<number>,
        width,
        height,
        config,
        'contour',
      );
    }

    const shouldRunHough = shouldRunHoughFallback(
      contourCandidates,
      width,
      height,
      edgeDensity,
      config,
    );

    let houghCandidates: DetectionCandidate[] = [];
    let fallbackState: 'inactive' | 'armed' | 'active' = 'inactive';

    if (shouldRunHough) {
      fallbackState = 'armed';
      const lines = new cv.Mat();
      mats.push(lines);
      const diag = Math.hypot(width, height);
      const minLineLength = Math.max(18, Math.round(config.houghMinLineLengthDiagRatio * diag));
      const maxLineGap = Math.max(4, Math.round(config.houghMaxLineGapDiagRatio * diag));
      cv.HoughLinesP(dilated, lines, 1, Math.PI / 180, 70, minLineLength, maxLineGap);
      houghCandidates = collectHoughCandidates(lines, edgeMap, width, height, config);
      if (houghCandidates.length > 0) {
        fallbackState = 'active';
      }
    }

    const merged = dedupeCandidates([...contourCandidates, ...houghCandidates], width, height)
      .sort((a, b) => b.area - a.area)
      .slice(0, config.candidateTopK || 24);

    const grayData = new Uint8ClampedArray(width * height);
    const blurredData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < grayData.length; i += 1) {
      grayData[i] = gray.data[i];
      blurredData[i] = blurred.data[i];
    }

    const magnitudeData = new Float32Array(width * height);
    for (let i = 0; i < magnitudeData.length; i += 1) {
      magnitudeData[i] = dilated.data[i] > 0 ? 255 : 0;
    }

    const proposalSources = Array.from(new Set(merged.map((candidate) => candidate.source ?? 'contour')));

    if (config.debug) {
      console.warn(
        `[document-autocapture:opencv] candidates=${merged.length} sources=${proposalSources.join(',') || 'none'} ` +
          `edgeDensity=${edgeDensity.toFixed(3)} houghState=${fallbackState}`,
      );
    }

    return {
      candidates: merged,
      gray: grayData,
      blurred: blurredData,
      magnitude: magnitudeData,
      diagnostics: {
        proposalSources,
        fallbackState,
        edgeDensity,
      },
    };
  } finally {
    for (const mat of mats) {
      try {
        mat.delete();
      } catch {
        // no-op
      }
    }
  }
}

export const __opencvTestUtils = {
  computeEdgeDensity,
  isHoughEdgeDensityAllowed,
  shouldRunHoughFallback,
  hasOrthogonalShape,
};
