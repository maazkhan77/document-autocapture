import { describe, expect, it } from 'vitest';
import type { ScannerConfig } from '../types';
import { normalizeDetectorMode, toWorkerDetectorConfig } from './config-mapper';

describe('session config mapper', () => {
  it('normalizes detector mode values', () => {
    expect(normalizeDetectorMode('cv')).toBe('cv');
    expect(normalizeDetectorMode('hybrid')).toBe('hybrid');
    expect(normalizeDetectorMode('ml')).toBe('ml');
    expect(normalizeDetectorMode('unknown')).toBe('hybrid');
  });

  it('maps scanner config to worker detector config with v2 defaults', () => {
    const scannerConfig: ScannerConfig = {
      detectorMode: 'ml',
      mlPipelineVersion: 'v2-graph',
      mlModelId: 'doc-corner-v2',
      mlRescueEnabled: false,
      mlRescueFrameStride: 4,
      mlFallbackEnabled: true,
      mlFallbackFrameStride: 6,
      mlFallbackTriggerConsecutiveMisses: 5,
      mlFallbackMinCvConfidence: 0.6,
    };

    const mapped = toWorkerDetectorConfig(scannerConfig);
    expect(mapped.detectorMode).toBe('ml');
    expect(mapped.mlPipelineVersion).toBe('v2-graph');
    expect(mapped.mlModelId).toBe('doc-corner-v2');
    expect(mapped.mlFallbackFrameStride).toBe(6);
    expect(mapped.mlFallbackTriggerConsecutiveMisses).toBe(5);
    expect(mapped.mlFallbackMinCvConfidence).toBe(0.6);
    expect(mapped.mlRescueEnabled).toBe(false);
    expect(mapped.mlRescueFrameStride).toBe(4);
  });
});

