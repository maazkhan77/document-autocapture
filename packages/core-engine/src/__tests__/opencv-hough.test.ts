import { describe, expect, it } from 'vitest';
import { defaultEngineConfig } from '../config';
import { __opencvTestUtils } from '../pipeline/opencv-detect';
import type { DetectionCandidate } from '../types';
import type { Quad } from '../types';

describe('opencv hough helpers', () => {
  it('computes edge density and applies configured gate bounds', () => {
    const edgeMap = new Uint8ClampedArray(100);
    for (let i = 0; i < 12; i += 1) {
      edgeMap[i] = 255;
    }
    const density = __opencvTestUtils.computeEdgeDensity(edgeMap);
    expect(density).toBeCloseTo(0.12, 6);
    expect(__opencvTestUtils.isHoughEdgeDensityAllowed(density, defaultEngineConfig)).toBe(true);
    expect(__opencvTestUtils.isHoughEdgeDensityAllowed(0.001, defaultEngineConfig)).toBe(false);
    expect(__opencvTestUtils.isHoughEdgeDensityAllowed(0.4, defaultEngineConfig)).toBe(false);
  });

  it('validates orthogonality range for candidate quads', () => {
    const rect: Quad = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 110, y: 14 },
      bottomRight: { x: 108, y: 74 },
      bottomLeft: { x: 12, y: 70 },
    };
    const skewed: Quad = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 150, y: 15 },
      bottomRight: { x: 110, y: 45 },
      bottomLeft: { x: 0, y: 40 },
    };
    expect(
      __opencvTestUtils.hasOrthogonalShape(
        rect,
        defaultEngineConfig.houghOrthogonalityMinDeg,
        defaultEngineConfig.houghOrthogonalityMaxDeg,
      ),
    ).toBe(true);
    expect(
      __opencvTestUtils.hasOrthogonalShape(
        skewed,
        defaultEngineConfig.houghOrthogonalityMinDeg,
        defaultEngineConfig.houghOrthogonalityMaxDeg,
      ),
    ).toBe(false);
  });

  it('arms hough fallback when contour output is only a tiny fragment', () => {
    const tinyContour: DetectionCandidate = {
      quad: {
        topLeft: { x: 20, y: 20 },
        topRight: { x: 40, y: 20 },
        bottomRight: { x: 40, y: 40 },
        bottomLeft: { x: 20, y: 40 },
      },
      source: 'contour',
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
      area: 400,
      perimeter: 80,
      convexity: 0.96,
      edgeStrength: 0.94,
    };

    const shouldRun = __opencvTestUtils.shouldRunHoughFallback(
      [tinyContour],
      100,
      100,
      0.12,
      defaultEngineConfig,
    );
    expect(shouldRun).toBe(true);
  });

  it('disables contour collection when contourEnabled is false', () => {
    expect(__opencvTestUtils.shouldCollectContourCandidates(defaultEngineConfig)).toBe(false);
    expect(
      __opencvTestUtils.shouldCollectContourCandidates({
        ...defaultEngineConfig,
        contourEnabled: true,
      }),
    ).toBe(true);
  });
});
