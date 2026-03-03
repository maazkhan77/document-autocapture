import { describe, expect, it } from 'vitest';
import { buildOpenCvContourFailureFixtures } from '../opencv-fixtures';
import { evaluateOpenCvRegression } from '../opencv-regression';
import { defaultThresholdProfile } from '../realclip-sim';
import { normalizeFrame, type NormalizedFrame } from '../realclip-shared';

function normalizeFixtures(): NormalizedFrame[] {
  const manifests = buildOpenCvContourFailureFixtures();
  const frames: NormalizedFrame[] = [];
  for (const manifest of manifests) {
    for (let i = 0; i < manifest.frames.length; i += 1) {
      frames.push(normalizeFrame(manifest, manifest.frames[i], i, manifest.tags ?? []));
    }
  }
  return frames;
}

describe('opencv regression fixtures', () => {
  it('produces contour-focused frames with stable evaluation output', () => {
    const frames = normalizeFixtures();
    const result = evaluateOpenCvRegression(frames, defaultThresholdProfile());

    expect(frames.length).toBeGreaterThan(40);
    expect(result.totals.contourFixtureFrames).toBeGreaterThan(0);
    expect(result.totals.documentFrames).toBeGreaterThan(0);
    expect(result.totals.nonDocumentFrames).toBeGreaterThan(0);
    expect(result.metrics.overall.totals.frames).toBe(frames.length);
    expect(typeof result.gates.overall).toBe('boolean');
  });
});
