import { describe, expect, it } from 'vitest';
import { createDemoScannerConfig } from './scanner-config';

describe('createDemoScannerConfig', () => {
  it('returns normalized defaults for demo integrations', () => {
    const config = createDemoScannerConfig();
    expect(config.detectorMode).toBe('ml');
    expect(config.mlPipelineVersion).toBe('v2-graph');
    expect(config.mlModelId).toBe('doc-corner-v2');
    expect(config.captureMimeType).toBe('image/png');
    expect(config.warpValidationLevel).toBe('strict');
    expect(config.videoConstraints?.facingMode).toBe('environment');
  });

  it('applies overrides while preserving required defaults', () => {
    const config = createDemoScannerConfig({
      detectorMode: 'hybrid',
      mlRescueEnabled: false,
      detectionWidth: 640,
    });
    expect(config.detectorMode).toBe('hybrid');
    expect(config.mlRescueEnabled).toBe(false);
    expect(config.detectionWidth).toBe(640);
    expect(config.captureMimeType).toBe('image/png');
    expect(config.videoConstraints?.width).toEqual({ ideal: 1920 });
  });
});

