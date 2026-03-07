import {
  clamp,
  orderQuadCorners,
  quadArea,
  quadPerimeter,
  quadToPoints,
  type Quad,
} from '@document-autocapture/core-engine';
import type { ConfidenceCalibration, DecodedModelOutputs, LetterboxTransform } from './types.js';

// ── Timeout ──────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. Rejects with an Error if the timeout fires first.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0 || !Number.isFinite(ms)) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ML inference timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ── URL utilities ────────────────────────────────────────────────────────────

export function resolveBaseUrl(base: string): string {
  try {
    return new URL(base).toString();
  } catch {
    const maybeLocation = (globalThis as { location?: { href?: string; origin?: string } })
      .location;
    if (maybeLocation?.href) {
      try {
        return new URL(base, maybeLocation.href).toString();
      } catch {
        // Fall through to origin/import.meta fallback.
      }
    }
    if (maybeLocation?.origin) {
      try {
        return new URL(base, maybeLocation.origin).toString();
      } catch {
        // Fall through to import.meta fallback.
      }
    }
    return new URL(base, import.meta.url).toString();
  }
}

export function safeUrl(base: string, relative: string): string {
  const looksLikeFile = /\/[^/]+\.[^/]+(?:[?#].*)?$/.test(base);
  const normalizedBase = base.endsWith('/') || looksLikeFile ? base : `${base}/`;
  return new URL(relative, resolveBaseUrl(normalizedBase)).toString();
}

export function resolveModelUrl(modelId = 'doc-corner-v1', modelBaseUrl?: string): string {
  if (modelBaseUrl) {
    return safeUrl(modelBaseUrl, `${modelId}/artifact.json`);
  }
  return new URL(`../models/${modelId}/artifact.json`, import.meta.url).toString();
}

// ── Math / statistics ────────────────────────────────────────────────────────

export function percentile(values: number[], pct: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((pct / 100) * (sorted.length - 1))),
  );
  return sorted[index];
}

export function findBounds(
  profile: number[],
  threshold: number,
): { start: number; end: number } | undefined {
  if (profile.length < 4) {
    return undefined;
  }
  let start = 0;
  while (start < profile.length && profile[start] < threshold) {
    start += 1;
  }
  let end = profile.length - 1;
  while (end > start && profile[end] < threshold) {
    end -= 1;
  }
  if (end - start < Math.round(profile.length * 0.1)) {
    return undefined;
  }
  return { start, end };
}

export function sigmoid(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

// ── Quad geometry ────────────────────────────────────────────────────────────

export function isFiniteQuad(quad: Quad): boolean {
  const points = quadToPoints(quad);
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const ccw = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
  ) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}

export function isSelfIntersectingQuad(quad: Quad): boolean {
  const points = quadToPoints(quad);
  return (
    segmentsIntersect(points[0], points[1], points[2], points[3]) ||
    segmentsIntersect(points[1], points[2], points[3], points[0])
  );
}

export function calcAspectRatio(quad: Quad): number {
  const top = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  const bottom = Math.hypot(
    quad.bottomRight.x - quad.bottomLeft.x,
    quad.bottomRight.y - quad.bottomLeft.y,
  );
  const left = Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y);
  const right = Math.hypot(
    quad.bottomRight.x - quad.topRight.x,
    quad.bottomRight.y - quad.topRight.y,
  );
  const width = (top + bottom) * 0.5;
  const height = (left + right) * 0.5;
  if (height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return width / height;
}

export function sanitizeQuad(quad: Quad, width: number, height: number): Quad {
  const ordered = orderQuadCorners(quad);
  return {
    topLeft: {
      x: clamp(ordered.topLeft.x, 0, width - 1),
      y: clamp(ordered.topLeft.y, 0, height - 1),
    },
    topRight: {
      x: clamp(ordered.topRight.x, 0, width - 1),
      y: clamp(ordered.topRight.y, 0, height - 1),
    },
    bottomRight: {
      x: clamp(ordered.bottomRight.x, 0, width - 1),
      y: clamp(ordered.bottomRight.y, 0, height - 1),
    },
    bottomLeft: {
      x: clamp(ordered.bottomLeft.x, 0, width - 1),
      y: clamp(ordered.bottomLeft.y, 0, height - 1),
    },
  };
}

export function isValidQuadShape(
  quad: Quad,
  width: number,
  height: number,
  minAreaFraction: number,
  maxAreaFraction: number,
): boolean {
  if (!isFiniteQuad(quad)) {
    return false;
  }
  if (isSelfIntersectingQuad(quad)) {
    return false;
  }
  const areaFraction = quadArea(quad) / Math.max(1, width * height);
  if (areaFraction < minAreaFraction || areaFraction > maxAreaFraction) {
    return false;
  }
  const aspect = calcAspectRatio(quad);
  if (aspect < 0.4 || aspect > 3.0) {
    return false;
  }
  const perimeter = quadPerimeter(quad);
  if (!Number.isFinite(perimeter) || perimeter < 40) {
    return false;
  }
  const borderTouches = quadToPoints(quad).filter(
    (point) => point.x <= 1 || point.y <= 1 || point.x >= width - 2 || point.y >= height - 2,
  ).length;
  if (borderTouches > 2) {
    return false;
  }
  return true;
}

export function estimateQuadEdgeSupport(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  threshold = 20,
): number {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let hits = 0;
  let total = 0;

  const luma = (x: number, y: number): number => {
    const sx = Math.max(0, Math.min(width - 1, x));
    const sy = Math.max(0, Math.min(height - 1, y));
    const idx = (sy * width + sx) * 4;
    return 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
  };

  for (let edge = 0; edge < 4; edge += 1) {
    const start = points[edge];
    const end = points[(edge + 1) % 4];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t);
      const gx = Math.abs(luma(x + 1, y) - luma(x - 1, y));
      const gy = Math.abs(luma(x, y + 1) - luma(x, y - 1));
      total += 1;
      if (gx + gy >= threshold) {
        hits += 1;
      }
    }
  }

  return clamp(hits / Math.max(1, total), 0, 1);
}

// ── Letterbox transform ──────────────────────────────────────────────────────

export function computeLetterboxTransform(
  width: number,
  height: number,
  size: number,
): LetterboxTransform {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safeSize = Math.max(8, size);
  const scale = Math.min(safeSize / safeWidth, safeSize / safeHeight);
  const scaledWidth = Math.max(1, Math.round(safeWidth * scale));
  const scaledHeight = Math.max(1, Math.round(safeHeight * scale));
  const padLeft = Math.max(0, Math.floor((safeSize - scaledWidth) / 2));
  const padTop = Math.max(0, Math.floor((safeSize - scaledHeight) / 2));
  return {
    size: safeSize,
    scaledWidth,
    scaledHeight,
    scale,
    padLeft,
    padTop,
  };
}

export function mapLetterboxPointToFrame(
  x: number,
  y: number,
  transform: LetterboxTransform,
  width: number,
  height: number,
): { x: number; y: number } {
  const unpaddedX = (x - transform.padLeft) / Math.max(1e-6, transform.scale);
  const unpaddedY = (y - transform.padTop) / Math.max(1e-6, transform.scale);
  return {
    x: clamp(unpaddedX, 0, width - 1),
    y: clamp(unpaddedY, 0, height - 1),
  };
}

// ── Confidence calibration ───────────────────────────────────────────────────

export function normalizeCalibration(
  input?: Partial<ConfidenceCalibration>,
): ConfidenceCalibration {
  const calibration: ConfidenceCalibration = {
    base: 0.05,
    scoreWeight: 0.67,
    edgeWeight: 0.18,
    sizeWeight: 0.15,
    min: 0,
    max: 1,
  };
  if (!input) {
    return calibration;
  }
  calibration.base = clamp(input.base ?? calibration.base, -1, 1);
  calibration.scoreWeight = clamp(input.scoreWeight ?? calibration.scoreWeight, 0, 2);
  calibration.edgeWeight = clamp(input.edgeWeight ?? calibration.edgeWeight, 0, 2);
  calibration.sizeWeight = clamp(input.sizeWeight ?? calibration.sizeWeight, 0, 2);
  calibration.min = clamp(input.min ?? calibration.min, 0, 1);
  calibration.max = clamp(input.max ?? calibration.max, calibration.min, 1);
  return calibration;
}

export function computeSizeConfidence(
  areaFraction: number,
  minAreaFraction: number,
  maxAreaFraction: number,
): number {
  if (areaFraction < minAreaFraction) {
    return clamp(areaFraction / Math.max(0.0001, minAreaFraction), 0, 1);
  }
  if (areaFraction > maxAreaFraction) {
    return clamp(maxAreaFraction / Math.max(0.0001, areaFraction), 0, 1);
  }
  return 1;
}

export function computeCalibratedConfidence(
  scoreProb: number,
  edgeSupport: number,
  sizeConfidence: number,
  calibration: ConfidenceCalibration,
): number {
  const raw =
    calibration.base +
    calibration.scoreWeight * clamp(scoreProb, 0, 1) +
    calibration.edgeWeight * clamp(edgeSupport, 0, 1) +
    calibration.sizeWeight * clamp(sizeConfidence, 0, 1);
  return clamp(raw, calibration.min, calibration.max);
}

// ── Model output decoding ────────────────────────────────────────────────────

export function pickCoordsAndScoreFromValues(
  valueSets: number[][],
  outputFormat: 'coords_score_logit' | 'coords_only',
): DecodedModelOutputs | undefined {
  const coordsCandidates = valueSets.filter((values) => values.length >= 8);
  if (coordsCandidates.length === 0) {
    return undefined;
  }

  if (outputFormat === 'coords_score_logit') {
    const coords = coordsCandidates.find((values) => values.length === 8) ?? coordsCandidates[0];
    const scoreValues =
      valueSets.find((values) => values.length === 1) ??
      valueSets.find((values) => values.length > 8 && values.length < 32);
    return {
      coords: coords.slice(0, 8),
      scoreRaw: scoreValues ? Number(scoreValues[0] ?? 0) : undefined,
      decodeMode: 'graph_coords_score_logit',
    };
  }

  const coords = coordsCandidates.find((values) => values.length === 8) ?? coordsCandidates[0];
  return {
    coords: coords.slice(0, 8),
    decodeMode: 'graph_coords_only',
  };
}
