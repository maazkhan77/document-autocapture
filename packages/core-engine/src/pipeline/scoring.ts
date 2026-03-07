import {
  borderPenalty,
  boundingRect,
  clamp,
  quadArea,
  quadAspectRatio,
  quadCornerAnglePenalty,
  quadToPoints,
} from '../math';
import type { DetectionCandidate, EngineConfig, Quad } from '../types';
import { sampleGridStdDev } from './pixels';

function normalizeRange(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return clamp((value - min) / (max - min), 0, 1);
}

function edgeContrastScore(magnitude: Float32Array, width: number, quad: Quad): number {
  const points = quadToPoints(quad);
  const samplesPerEdge = 16;
  let sum = 0;
  let n = 0;

  for (let e = 0; e < 4; e += 1) {
    const a = points[e];
    const b = points[(e + 1) % 4];
    for (let i = 0; i <= samplesPerEdge; i += 1) {
      const t = i / samplesPerEdge;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      const idx = y * width + x;
      if (idx >= 0 && idx < magnitude.length) {
        sum += magnitude[idx];
        n += 1;
      }
    }
  }

  if (n === 0) {
    return 0;
  }
  // With OpenCV dilated edge maps, values are binary (0 or 255).
  // Use a wider range so the average along a true document edge (~180-255) maps to high scores.
  return normalizeRange(sum / n, 10, 200);
}

function homogeneityScore(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
): number {
  const rect = boundingRect(quad);
  const stddev = sampleGridStdDev(
    gray,
    width,
    height,
    Math.round(rect.minX),
    Math.round(rect.minY),
    Math.round(rect.maxX),
    Math.round(rect.maxY),
  );
  return 1 - normalizeRange(stddev, 10, 85);
}

function aspectPlausibility(aspectRatio: number, min: number, max: number): number {
  if (aspectRatio < min || aspectRatio > max) {
    return 0;
  }
  const midpoint = (min + max) / 2;
  const halfRange = (max - min) / 2;
  const closeness = clamp(1 - Math.abs(aspectRatio - midpoint) / Math.max(0.0001, halfRange), 0, 1);
  return 0.35 + 0.65 * closeness;
}

function angleScore(quad: Quad): number {
  const penalty = quadCornerAnglePenalty(quad);
  return 1 - normalizeRange(penalty, 0, 120);
}

function centerScore(quad: Quad, width: number, height: number): number {
  const rect = boundingRect(quad);
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  const dx = cx - width / 2;
  const dy = cy - height / 2;
  const normalizedDistance = Math.hypot(dx / Math.max(1, width), dy / Math.max(1, height));
  return 1 - clamp(normalizedDistance * 2.2, 0, 1);
}

function interiorEdgeDensity(
  magnitude: Float32Array,
  width: number,
  height: number,
  quad: Quad,
): number {
  const rect = boundingRect(quad);
  const spanX = Math.max(0, rect.maxX - rect.minX);
  const spanY = Math.max(0, rect.maxY - rect.minY);
  const insetX = Math.max(2, Math.round(spanX * 0.14));
  const insetY = Math.max(2, Math.round(spanY * 0.14));

  const minX = clamp(Math.round(rect.minX + insetX), 0, Math.max(0, width - 1));
  const maxX = clamp(Math.round(rect.maxX - insetX), 0, Math.max(0, width - 1));
  const minY = clamp(Math.round(rect.minY + insetY), 0, Math.max(0, height - 1));
  const maxY = clamp(Math.round(rect.maxY - insetY), 0, Math.max(0, height - 1));

  if (maxX <= minX || maxY <= minY) {
    return 0;
  }

  let edgePixels = 0;
  let samples = 0;
  for (let y = minY; y <= maxY; y += 1) {
    const rowOffset = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      samples += 1;
      if (magnitude[rowOffset + x] > 0) {
        edgePixels += 1;
      }
    }
  }

  return samples > 0 ? edgePixels / samples : 0;
}

export function scoreCandidates(
  candidates: DetectionCandidate[],
  gray: Uint8ClampedArray,
  magnitude: Float32Array,
  width: number,
  height: number,
  config: EngineConfig,
): DetectionCandidate[] {
  const frameArea = width * height;
  const weights = config.scoreWeights;
  const minScorableAreaFraction = Math.max(0.05, config.minAreaFraction);
  const minHoughScorableAreaFraction = Math.max(minScorableAreaFraction, 0.08);

  const scored = candidates
    .map((candidate) => {
      const areaFraction = quadArea(candidate.quad) / frameArea;
      const aspect = quadAspectRatio(candidate.quad);
      const aspectScore = aspectPlausibility(aspect, config.minAspectRatio, config.maxAspectRatio);
      const edgeScore = edgeContrastScore(magnitude, width, candidate.quad);
      const homogeneity = homogeneityScore(gray, width, height, candidate.quad);
      const corner = angleScore(candidate.quad);
      const border = borderPenalty(candidate.quad, width, height);
      const center = centerScore(candidate.quad, width, height);
      const edgeSupport = clamp(candidate.edgeStrength, 0, 1);
      const interiorDensity = interiorEdgeDensity(magnitude, width, height, candidate.quad);

      if (areaFraction < minScorableAreaFraction || areaFraction > config.maxAreaFraction) {
        return {
          ...candidate,
          score: 0,
          confidence: 0,
          metrics: {
            areaFraction,
            aspectPlausibility: aspectScore,
            edgeContrast: edgeScore,
            interiorHomogeneity: homogeneity,
            cornerAngleCloseness: corner,
            borderPenalty: border,
          },
        };
      }

      if (candidate.source === 'hough' && areaFraction < minHoughScorableAreaFraction) {
        return {
          ...candidate,
          score: 0,
          confidence: 0,
          metrics: {
            areaFraction,
            aspectPlausibility: aspectScore,
            edgeContrast: edgeScore,
            interiorHomogeneity: homogeneity,
            cornerAngleCloseness: corner,
            borderPenalty: border,
          },
        };
      }

      const areaScore =
        areaFraction >= config.minAreaFraction && areaFraction <= config.maxAreaFraction
          ? clamp(1 - Math.abs(areaFraction - 0.45) * 1.2, 0.1, 1)
          : 0;

      const scoreRaw =
        weights.areaFraction * areaScore +
        weights.aspectPlausibility * aspectScore +
        weights.edgeContrast * edgeScore +
        weights.interiorHomogeneity * homogeneity +
        weights.cornerAngleCloseness * corner +
        weights.borderPenalty * (1 - border);

      let score = clamp(scoreRaw, 0, 1);

      // --- Penalty layer (simplified: one center bonus, one shape penalty) ---
      // Center bonus: gently prefer centered documents
      score *= 0.85 + 0.15 * center;

      // Shape penalty: single worst-metric gate instead of multiplicative stack.
      // This prevents multiple small penalties from cascading to near-zero.
      const shapePenalty = Math.min(
        corner < 0.3 ? 0.25 : 1,
        border > 0.5 ? 0.2 : border > 0.25 ? clamp(1 - (border - 0.25) * 1.5, 0.4, 1) : 1,
        edgeSupport < 0.15 ? 0.4 : clamp(0.7 + 0.3 * edgeSupport, 0.6, 1),
        clamp(0.65 + 0.35 * candidate.convexity, 0.65, 1),
      );
      score *= shapePenalty;

      // Hough-specific: require interior texture as proof of document content
      if (candidate.source === 'hough') {
        const interiorTextureSupport = normalizeRange(interiorDensity, 0.012, 0.09);
        score *= clamp(0.4 + 0.6 * interiorTextureSupport, 0.25, 1);
        if (homogeneity > 0.78 || homogeneity < 0.5) {
          score *= 0.75;
        }
        if (areaFraction > 0.65) {
          score *= clamp(1 - (areaFraction - 0.65) * 2.5, 0.3, 1);
        }
      }

      return {
        ...candidate,
        score,
        // Confidence is normalized once in engine after temporal blending.
        confidence: 0,
        metrics: {
          areaFraction,
          aspectPlausibility: aspectScore,
          edgeContrast: edgeScore,
          interiorHomogeneity: homogeneity,
          cornerAngleCloseness: corner,
          borderPenalty: border,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  if (config.debug && scored.length > 0) {
    const top = scored
      .slice(0, 3)
      .map(
        (c) =>
          `score=${c.score.toFixed(3)} area=${c.metrics.areaFraction.toFixed(3)} ` +
          `aspect=${c.metrics.aspectPlausibility.toFixed(2)} edge=${c.metrics.edgeContrast.toFixed(2)} ` +
          `homo=${c.metrics.interiorHomogeneity.toFixed(2)} corner=${c.metrics.cornerAngleCloseness.toFixed(2)} ` +
          `border=${c.metrics.borderPenalty.toFixed(2)} convex=${c.convexity.toFixed(2)} edgeStr=${c.edgeStrength.toFixed(2)} src=${c.source ?? 'contour'}`,
      );
    console.warn(`[document-autocapture:scoring] ${scored.length} candidates | ${top.join(' | ')}`);
  }

  return scored;
}
