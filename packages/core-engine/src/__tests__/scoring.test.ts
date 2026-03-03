import { describe, expect, it } from 'vitest';
import { mergeEngineConfig } from '../config';
import type { DetectionCandidate, ProposalSource, Quad } from '../types';
import { scoreCandidates } from '../pipeline/scoring';

function makeQuad(left: number, top: number, right: number, bottom: number): Quad {
  return {
    topLeft: { x: left, y: top },
    topRight: { x: right, y: top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: left, y: bottom },
  };
}

function makeCandidate(quad: Quad, source: ProposalSource = 'contour'): DetectionCandidate {
  const width = quad.topRight.x - quad.topLeft.x;
  const height = quad.bottomLeft.y - quad.topLeft.y;
  return {
    quad,
    source,
    score: 0,
    confidence: 0,
    metrics: {
      areaFraction: 0,
      aspectPlausibility: 0,
      edgeContrast: 0,
      interiorHomogeneity: 0,
      cornerAngleCloseness: 0,
      borderPenalty: 0,
    },
    area: Math.abs(width * height),
    perimeter: Math.abs(width * 2) + Math.abs(height * 2),
    convexity: 1,
    edgeStrength: 1,
  };
}

function paintBorderEdges(
  magnitude: Float32Array,
  width: number,
  quad: Quad,
): void {
  const left = Math.round(quad.topLeft.x);
  const right = Math.round(quad.topRight.x);
  const top = Math.round(quad.topLeft.y);
  const bottom = Math.round(quad.bottomLeft.y);

  for (let x = left; x <= right; x += 1) {
    magnitude[top * width + x] = 255;
    magnitude[bottom * width + x] = 255;
  }
  for (let y = top; y <= bottom; y += 1) {
    magnitude[y * width + left] = 255;
    magnitude[y * width + right] = 255;
  }
}

describe('candidate scoring area gates', () => {
  const width = 100;
  const height = 100;
  const gray = new Uint8ClampedArray(width * height).fill(128);
  const magnitude = new Float32Array(width * height).fill(255);

  it('hard-rejects candidates smaller than configured minimum area', () => {
    const config = mergeEngineConfig({ minAreaFraction: 0.08 });
    const tiny = makeCandidate(makeQuad(10, 10, 40, 30), 'contour'); // 0.06 area fraction
    const scored = scoreCandidates([tiny], gray, magnitude, width, height, config);

    expect(scored[0]?.score ?? -1).toBe(0);
  });

  it('keeps contour candidates above minimum area scorable', () => {
    const config = mergeEngineConfig({ minAreaFraction: 0.08 });
    const valid = makeCandidate(makeQuad(10, 10, 50, 35), 'contour'); // 0.10 area fraction
    const scored = scoreCandidates([valid], gray, magnitude, width, height, config);

    expect(scored[0]?.score ?? 0).toBeGreaterThan(0);
  });

  it('applies stricter minimum area floor to hough candidates', () => {
    const config = mergeEngineConfig({ minAreaFraction: 0.05 });
    const sameQuad = makeQuad(10, 10, 40, 30); // 0.06 area fraction
    const contour = makeCandidate(sameQuad, 'contour');
    const hough = makeCandidate(sameQuad, 'hough');
    const scored = scoreCandidates([contour, hough], gray, magnitude, width, height, config);

    const scoredContour = scored.find((candidate) => candidate.source === 'contour');
    const scoredHough = scored.find((candidate) => candidate.source === 'hough');
    expect(scoredContour?.score ?? 0).toBeGreaterThan(0);
    expect(scoredHough?.score ?? -1).toBe(0);
  });

  it('penalizes hough candidates that only have border edges with empty interior', () => {
    const config = mergeEngineConfig({ minAreaFraction: 0.05 });
    const quad = makeQuad(10, 10, 50, 35); // 0.10 area fraction
    const contour = makeCandidate(quad, 'contour');
    const hough = makeCandidate(quad, 'hough');
    const sparseMagnitude = new Float32Array(width * height).fill(0);
    paintBorderEdges(sparseMagnitude, width, quad);

    const scored = scoreCandidates([contour, hough], gray, sparseMagnitude, width, height, config);
    const scoredContour = scored.find((candidate) => candidate.source === 'contour');
    const scoredHough = scored.find((candidate) => candidate.source === 'hough');

    expect(scoredContour?.score ?? 0).toBeGreaterThan(0);
    expect(scoredHough?.score ?? 1).toBeLessThan((scoredContour?.score ?? 0) * 0.8);
  });

  it('penalizes oversized hough candidates to avoid background frame lock-on', () => {
    const config = mergeEngineConfig({ minAreaFraction: 0.08 });
    const largeQuad = makeQuad(5, 5, 95, 95); // area fraction ~0.81
    const mediumQuad = makeQuad(20, 20, 70, 50); // area fraction ~0.15
    const largeHough = makeCandidate(largeQuad, 'hough');
    const mediumHough = makeCandidate(mediumQuad, 'hough');

    const scored = scoreCandidates([largeHough, mediumHough], gray, magnitude, width, height, config);
    const scoredLarge = scored.find((candidate) => candidate.quad.topLeft.x === 5);
    const scoredMedium = scored.find((candidate) => candidate.quad.topLeft.x === 20);

    expect(scoredLarge?.score ?? 1).toBeLessThan((scoredMedium?.score ?? 0) * 0.6);
  });
});
