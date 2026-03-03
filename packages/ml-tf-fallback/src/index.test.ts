import { describe, expect, it } from 'vitest';
import { __testUtils, resolveModelUrl } from './index';

describe('@document-autocapture/ml-tf-fallback letterbox mapping', () => {
  it('computes deterministic letterbox transform', () => {
    const transform = __testUtils.computeLetterboxTransform(1920, 1080, 320);
    expect(transform.scaledWidth).toBe(320);
    expect(transform.scaledHeight).toBe(180);
    expect(transform.padLeft).toBe(0);
    expect(transform.padTop).toBe(70);
  });

  it('maps padded model coordinates back into source frame bounds', () => {
    const transform = __testUtils.computeLetterboxTransform(1920, 1080, 320);
    const topLeft = __testUtils.mapLetterboxPointToFrame(0, 70, transform, 1920, 1080);
    const bottomRight = __testUtils.mapLetterboxPointToFrame(320, 250, transform, 1920, 1080);
    expect(topLeft.x).toBeCloseTo(0, 4);
    expect(topLeft.y).toBeCloseTo(0, 4);
    expect(bottomRight.x).toBeCloseTo(1919, 1);
    expect(bottomRight.y).toBeCloseTo(1079, 1);
  });

  it('resolves artifact URL from model base URL', () => {
    const url = resolveModelUrl('doc-corner-v1', 'https://cdn.example.com/models/');
    expect(url).toBe('https://cdn.example.com/models/doc-corner-v1/artifact.json');
  });

  it('resolves sibling model URL from artifact file URL', () => {
    const modelUrl = __testUtils.safeUrl(
      'https://cdn.example.com/models/doc-corner-v2/artifact.json',
      'model.json',
    );
    expect(modelUrl).toBe('https://cdn.example.com/models/doc-corner-v2/model.json');
  });

  it('resolves model URL from directory URL without trailing slash', () => {
    const modelUrl = __testUtils.safeUrl(
      'https://cdn.example.com/models/doc-corner-v2',
      'model.json',
    );
    expect(modelUrl).toBe('https://cdn.example.com/models/doc-corner-v2/model.json');
  });

  it('decodes multi-output graph values with coords + score logit', () => {
    const decoded = __testUtils.pickCoordsAndScoreFromValues(
      [
        [0.1, 0.2, 0.9, 0.2, 0.9, 0.8, 0.1, 0.8],
        [1.25],
      ],
      'coords_score_logit',
    );
    expect(decoded?.decodeMode).toBe('graph_coords_score_logit');
    expect(decoded?.coords).toHaveLength(8);
    expect(decoded?.scoreRaw).toBeCloseTo(1.25, 6);
  });

  it('keeps backward compatibility with coords-only decode', () => {
    const decoded = __testUtils.pickCoordsAndScoreFromValues(
      [[0.11, 0.12, 0.88, 0.13, 0.87, 0.84, 0.1, 0.82]],
      'coords_only',
    );
    expect(decoded?.decodeMode).toBe('graph_coords_only');
    expect(decoded?.coords[0]).toBeCloseTo(0.11, 6);
    expect(decoded?.scoreRaw).toBeUndefined();
  });

  it('applies sigmoid + confidence calibration deterministically', () => {
    const calibration = __testUtils.normalizeCalibration({
      base: 0.1,
      scoreWeight: 0.6,
      edgeWeight: 0.2,
      sizeWeight: 0.2,
      min: 0,
      max: 1,
    });
    const scoreProb = __testUtils.sigmoid(1.0);
    const confidence = __testUtils.computeCalibratedConfidence(scoreProb, 0.9, 0.8, calibration);
    expect(confidence).toBeGreaterThan(0.7);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});
