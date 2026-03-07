import { describe, expect, it } from 'vitest';
import { normalizeConfig, deepRecordEqual } from './config-utils';

describe('config-utils', () => {
  it('compares shallow records recursively for nested objects', () => {
    const left = {
      detectorMode: 'cv',
      scoreWeights: {
        areaFraction: 0.2,
      },
    };
    const right = {
      detectorMode: 'cv',
      scoreWeights: {
        areaFraction: 0.2,
      },
    };
    expect(deepRecordEqual(left, right)).toBe(true);
  });

  it('detects changes in nested values', () => {
    const left = {
      detectorMode: 'cv',
      scoreWeights: {
        areaFraction: 0.2,
      },
    };
    const right = {
      detectorMode: 'cv',
      scoreWeights: {
        areaFraction: 0.21,
      },
    };
    expect(deepRecordEqual(left, right)).toBe(false);
  });

  it('normalizes undefined config to empty object', () => {
    expect(normalizeConfig(undefined)).toEqual({});
  });
});
