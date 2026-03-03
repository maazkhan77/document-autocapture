import { describe, expect, it } from 'vitest';
import { defaultThresholdProfile, simulateDataset, tuneThresholdProfile } from '../realclip-sim';
import type { NormalizedFrame } from '../realclip-shared';

function makeFrame(
  clipId: string,
  frameId: string,
  tsMs: number,
  hasDocument: boolean,
  score: number,
): NormalizedFrame {
  const width = 480;
  const height = 672;
  const quad = {
    topLeft: { x: 72, y: 64 },
    topRight: { x: 412, y: 66 },
    bottomRight: { x: 410, y: 604 },
    bottomLeft: { x: 70, y: 600 },
  };

  return {
    datasetName: 'unit',
    clipId,
    width,
    height,
    frameId,
    tsMs,
    hasDocument,
    groundTruth: hasDocument ? quad : undefined,
    cvCandidates: hasDocument
      ? [
          {
            quad,
            score,
            source: 'cv',
            areaFraction: 0.58,
            aspectRatio: 0.63,
            borderPenalty: 0.05,
            edgeStrength: 0.72,
          },
        ]
      : [],
    mlCandidate: hasDocument
      ? {
          quad,
          score: Math.min(1, score + 0.05),
          source: 'ml',
          areaFraction: 0.58,
          aspectRatio: 0.63,
          borderPenalty: 0.03,
          edgeStrength: 0.78,
        }
      : undefined,
    quality: {
      brightness: 132,
      blur: 48,
      glare: 0.03,
    },
    detectionMs: 14,
    variant: 'base',
    tags: [],
  };
}

describe('realclip simulation and tuning', () => {
  it('tunes thresholds without regressing objective score', () => {
    const frames: NormalizedFrame[] = [];
    for (let i = 0; i < 20; i += 1) {
      frames.push(makeFrame('clip-a', `a-${i}`, i * 33, i >= 3, i >= 6 ? 0.62 : 0.5));
    }
    for (let i = 0; i < 12; i += 1) {
      frames.push(makeFrame('clip-b', `b-${i}`, i * 33, false, 0.22));
    }

    const baseline = simulateDataset(frames, defaultThresholdProfile());
    const tuned = tuneThresholdProfile(frames, defaultThresholdProfile());

    expect(tuned.evaluations).toBeGreaterThan(1);
    expect(tuned.tunedMetrics.objectiveScore).toBeGreaterThanOrEqual(baseline.objectiveScore);
  });
});
