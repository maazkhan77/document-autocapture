import { describe, expect, it } from 'vitest';
import { pickGuidanceCode } from '../pipeline/quality';

describe('guidance priority', () => {
  it('returns not_found first when detection missing', () => {
    const guidance = pickGuidanceCode({
      detected: false,
      stable: false,
      minAreaFraction: 0.05,
    });
    expect(guidance).toBe('DOCUMENT_NOT_FOUND');
  });

  it('prioritizes brightness over glare and blur', () => {
    const guidance = pickGuidanceCode({
      detected: true,
      stable: true,
      minAreaFraction: 0.05,
      quality: {
        ok: false,
        brightness: { averageLuma: 20, ok: false },
        blur: { laplacianVariance: 5, ok: false },
        glare: { highlightRatio: 0.4, ok: false },
        area: { areaFraction: 0.4, ok: true },
      },
    });
    expect(guidance).toBe('TOO_DARK_OR_BRIGHT');
  });

  it('returns move_closer when stable and area is too small', () => {
    const guidance = pickGuidanceCode({
      detected: true,
      stable: true,
      areaFraction: 0.01,
      minAreaFraction: 0.05,
      quality: {
        ok: false,
        brightness: { averageLuma: 120, ok: true },
        blur: { laplacianVariance: 60, ok: true },
        glare: { highlightRatio: 0.0, ok: true },
        area: { areaFraction: 0.01, ok: false },
      },
    });
    expect(guidance).toBe('MOVE_CLOSER');
  });
});
