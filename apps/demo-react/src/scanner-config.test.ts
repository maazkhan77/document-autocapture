import { describe, expect, it } from 'vitest';
import { createDemoScannerConfig } from './scanner-config';

describe('createDemoScannerConfig', () => {
  it('returns normalized defaults for demo integrations', () => {
    const config = createDemoScannerConfig();
    expect(config.detectorMode).toBe('ml');
    expect(config.mlPipelineVersion).toBe('v2-graph');
    expect(config.mlModelId).toBe('doc-corner-v2');
    expect(config.graphMlEnabled).toBe(true);
    expect(config.cocoBookEnabled).toBe(true);
    expect(config.cocoMinScore).toBe(0.45);
    expect(config.cvContourEnabled).toBe(false);
    expect(config.houghSecondaryEnabled).toBe(true);
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

  it('deep-merges video constraint overrides without mutating defaults', () => {
    const customized = createDemoScannerConfig({
      videoConstraints: {
        width: { ideal: 1280 },
        frameRate: { ideal: 30 },
      },
    });
    expect(customized.videoConstraints?.facingMode).toBe('environment');
    expect(customized.videoConstraints?.width).toEqual({ ideal: 1280 });
    expect(customized.videoConstraints?.height).toEqual({ ideal: 1080 });
    expect(customized.videoConstraints?.frameRate).toEqual({ ideal: 30 });

    const freshDefaults = createDemoScannerConfig();
    expect(freshDefaults.videoConstraints?.width).toEqual({ ideal: 1920 });
    expect(freshDefaults.videoConstraints?.height).toEqual({ ideal: 1080 });
  });
});
