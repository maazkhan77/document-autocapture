import {
  nowMs,
  quadArea,
  quadAspectRatio,
  type Point,
  type Quad,
} from '@document-autocapture/core-engine';

type CornerName = keyof Quad;

export type PostRefineReason =
  | 'applied'
  | 'low_gain'
  | 'invalid_initial_quad'
  | 'invalid_refined_quad'
  | 'timeout';

export interface PostCaptureRefineParams {
  imageData: ImageData;
  initialQuad: Quad;
  budgetMs?: number;
  maxIterations?: number;
  searchRadiusPx?: number;
  searchStepPx?: number;
  edgeSamples?: number;
}

export interface PostCaptureRefineResult {
  quad: Quad;
  applied: boolean;
  reason: PostRefineReason;
  elapsedMs: number;
  initialScore: number;
  refinedScore: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneQuad(quad: Quad): Quad {
  return {
    topLeft: { ...quad.topLeft },
    topRight: { ...quad.topRight },
    bottomRight: { ...quad.bottomRight },
    bottomLeft: { ...quad.bottomLeft },
  };
}

function quadSelfIntersects(quad: Quad): boolean {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const ccw = (a: Point, b: Point, c: Point) =>
    (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  const intersects = (a: Point, b: Point, c: Point, d: Point) =>
    ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

  return (
    intersects(points[0], points[1], points[2], points[3]) ||
    intersects(points[1], points[2], points[3], points[0])
  );
}

function quadWithinBounds(quad: Quad, width: number, height: number): boolean {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  return points.every(
    (point) => point.x >= 0 && point.y >= 0 && point.x <= width - 1 && point.y <= height - 1,
  );
}

function validQuad(quad: Quad, width: number, height: number): boolean {
  if (!quadWithinBounds(quad, width, height)) {
    return false;
  }
  if (quadSelfIntersects(quad)) {
    return false;
  }
  const area = quadArea(quad);
  const areaFrac = area / Math.max(1, width * height);
  if (areaFrac < 0.02 || areaFrac > 0.98) {
    return false;
  }
  const aspect = quadAspectRatio(quad);
  if (!Number.isFinite(aspect) || aspect < 0.35 || aspect > 2.2) {
    return false;
  }
  return true;
}

function buildLumaAndGradient(imageData: ImageData): { luma: Float32Array; grad: Float32Array } {
  const { data, width, height } = imageData;
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const grad = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx = luma[idx + 1] - luma[idx - 1];
      const gy = luma[idx + width] - luma[idx - width];
      grad[idx] = Math.hypot(gx, gy);
    }
  }

  return { luma, grad };
}

function sampleGradient(
  grad: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const px = clamp(Math.round(x), 0, width - 1);
  const py = clamp(Math.round(y), 0, height - 1);
  return grad[py * width + px];
}

function scoreQuad(
  quad: Quad,
  grad: Float32Array,
  width: number,
  height: number,
  edgeSamples: number,
): number {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let edgeSum = 0;
  let edgeCount = 0;

  for (let edge = 0; edge < 4; edge += 1) {
    const start = points[edge];
    const end = points[(edge + 1) % 4];
    for (let i = 0; i <= edgeSamples; i += 1) {
      const t = i / edgeSamples;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t;
      edgeSum += sampleGradient(grad, width, height, x, y);
      edgeCount += 1;
    }
  }

  const cornerMean =
    (sampleGradient(grad, width, height, quad.topLeft.x, quad.topLeft.y) +
      sampleGradient(grad, width, height, quad.topRight.x, quad.topRight.y) +
      sampleGradient(grad, width, height, quad.bottomRight.x, quad.bottomRight.y) +
      sampleGradient(grad, width, height, quad.bottomLeft.x, quad.bottomLeft.y)) /
    4;
  const edgeMean = edgeSum / Math.max(1, edgeCount);

  const area = quadArea(quad) / Math.max(1, width * height);
  const aspect = quadAspectRatio(quad);
  const areaPenalty = Math.abs(area - 0.35);
  const aspectPenalty = Math.abs(aspect - 0.75);
  return edgeMean * 0.78 + cornerMean * 0.22 - areaPenalty * 30 - aspectPenalty * 6;
}

function moveCorner(
  quad: Quad,
  corner: CornerName,
  x: number,
  y: number,
  width: number,
  height: number,
): Quad {
  const next = cloneQuad(quad);
  next[corner] = {
    x: clamp(x, 0, width - 1),
    y: clamp(y, 0, height - 1),
  };
  return next;
}

export function refineQuadPostCapture(params: PostCaptureRefineParams): PostCaptureRefineResult {
  const start = nowMs();
  const { imageData, initialQuad } = params;
  const width = imageData.width;
  const height = imageData.height;
  const budgetMs = Math.max(1, params.budgetMs ?? 120);
  const maxIterations = Math.max(1, Math.min(3, params.maxIterations ?? 2));
  const searchRadiusPx = Math.max(
    4,
    Math.min(42, params.searchRadiusPx ?? Math.round(Math.hypot(width, height) * 0.025)),
  );
  const searchStepPx = Math.max(1, Math.min(8, params.searchStepPx ?? 2));
  const edgeSamples = Math.max(8, Math.min(40, params.edgeSamples ?? 24));

  if (!validQuad(initialQuad, width, height)) {
    return {
      quad: cloneQuad(initialQuad),
      applied: false,
      reason: 'invalid_initial_quad',
      elapsedMs: nowMs() - start,
      initialScore: 0,
      refinedScore: 0,
    };
  }

  const { grad } = buildLumaAndGradient(imageData);
  let current = cloneQuad(initialQuad);
  let currentScore = scoreQuad(current, grad, width, height, edgeSamples);
  const initialScore = currentScore;
  const corners: CornerName[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    for (const corner of corners) {
      let bestQuad = current;
      let bestScore = currentScore;

      for (let dy = -searchRadiusPx; dy <= searchRadiusPx; dy += searchStepPx) {
        for (let dx = -searchRadiusPx; dx <= searchRadiusPx; dx += searchStepPx) {
          if (nowMs() - start > budgetMs) {
            return {
              quad: cloneQuad(current),
              applied: false,
              reason: 'timeout',
              elapsedMs: nowMs() - start,
              initialScore,
              refinedScore: currentScore,
            };
          }

          if (dx * dx + dy * dy > searchRadiusPx * searchRadiusPx) {
            continue;
          }

          const candidate = moveCorner(
            current,
            corner,
            current[corner].x + dx,
            current[corner].y + dy,
            width,
            height,
          );
          if (!validQuad(candidate, width, height)) {
            continue;
          }

          const candidateScore = scoreQuad(candidate, grad, width, height, edgeSamples);
          if (candidateScore > bestScore) {
            bestScore = candidateScore;
            bestQuad = candidate;
          }
        }
      }

      current = bestQuad;
      currentScore = bestScore;
    }
  }

  if (!validQuad(current, width, height)) {
    return {
      quad: cloneQuad(initialQuad),
      applied: false,
      reason: 'invalid_refined_quad',
      elapsedMs: nowMs() - start,
      initialScore,
      refinedScore: currentScore,
    };
  }

  const gain = currentScore - initialScore;
  const minGain = Math.max(8, Math.abs(initialScore) * 0.03);
  if (gain < minGain) {
    return {
      quad: cloneQuad(initialQuad),
      applied: false,
      reason: 'low_gain',
      elapsedMs: nowMs() - start,
      initialScore,
      refinedScore: currentScore,
    };
  }

  return {
    quad: current,
    applied: true,
    reason: 'applied',
    elapsedMs: nowMs() - start,
    initialScore,
    refinedScore: currentScore,
  };
}
