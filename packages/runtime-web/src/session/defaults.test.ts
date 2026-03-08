import { describe, expect, it } from 'vitest';
import { buildScannerConfig, DEFAULT_SCANNER_CONFIG, resolveDetectorMode } from './defaults';

describe('resolveDetectorMode', () => {
  it('maps Detection values to DetectorMode', () => {
    expect(resolveDetectorMode('auto')).toBe('ml');
    expect(resolveDetectorMode('opencv')).toBe('cv');
    expect(resolveDetectorMode('ml')).toBe('ml');
    expect(resolveDetectorMode('hybrid')).toBe('hybrid');
  });

  it('defaults to ml for undefined', () => {
    expect(resolveDetectorMode(undefined)).toBe('ml');
  });
});

describe('DEFAULT_SCANNER_CONFIG', () => {
  it('has safe out-of-the-box defaults', () => {
    expect(DEFAULT_SCANNER_CONFIG.detection).toBe('auto');
    expect(DEFAULT_SCANNER_CONFIG.cocoSsd).toBe(true);
    expect(DEFAULT_SCANNER_CONFIG.debugOverlay).toBe('off');
    expect(DEFAULT_SCANNER_CONFIG.mlPipelineVersion).toBe('v2-graph');
    expect(DEFAULT_SCANNER_CONFIG.mlModelId).toBe('doc-corner-v2');
  });
});

describe('buildScannerConfig', () => {
  it('returns defaults when called with no overrides', () => {
    const config = buildScannerConfig();
    expect(config.detectorMode).toBe('ml');
    expect(config.cocoBookEnabled).toBe(true);
    expect(config.debugOverlayLevel).toBe('off');
    expect(config.mlFallbackEnabled).toBe(true);
    expect(config.mlPipelineVersion).toBe('v2-graph');
  });

  it('applies quality preset overrides', () => {
    const fast = buildScannerConfig({ quality: 'fast' });
    expect(fast.captureQuality).toBeLessThan(1);
    expect(fast.captureMimeType).toBe('image/jpeg');

    const high = buildScannerConfig({ quality: 'high' });
    expect(high.captureMimeType).toBe('image/png');
  });

  it('maps detection → detectorMode', () => {
    const opencv = buildScannerConfig({ detection: 'opencv' });
    expect(opencv.detectorMode).toBe('cv');
  });

  it('maps debugOverlay → debugOverlayLevel', () => {
    const full = buildScannerConfig({ debugOverlay: 'full' });
    expect(full.debugOverlayLevel).toBe('full');
  });

  it('maps postCaptureRefine boolean → postCaptureRefineMode', () => {
    const on = buildScannerConfig({ postCaptureRefine: true });
    expect(on.postCaptureRefineMode).toBe('safe');

    const off = buildScannerConfig({ postCaptureRefine: false });
    expect(off.postCaptureRefineMode).toBe('off');
  });

  it('maps cocoSsd → cocoBookEnabled', () => {
    const on = buildScannerConfig({ cocoSsd: true });
    expect(on.cocoBookEnabled).toBe(true);
  });

  it('maps mlFallback → mlFallbackEnabled', () => {
    const off = buildScannerConfig({ mlFallback: false });
    expect(off.mlFallbackEnabled).toBe(false);
  });

  it('user overrides always win over presets', () => {
    const config = buildScannerConfig({
      quality: 'fast',
      captureMimeType: 'image/png', // override fast preset's jpeg
    });
    expect(config.captureMimeType).toBe('image/png');
  });

  it('does not force fallback mode when webglWarp is false', () => {
    const config = buildScannerConfig({ webglWarp: false });
    expect(config.preferredMode).toBe('best');
  });

  it('preserves maxCaptures in built config', () => {
    const config = buildScannerConfig({ maxCaptures: 3 });
    expect(config.maxCaptures).toBe(3);
  });

  it('defaults maxCaptures to undefined (unlimited)', () => {
    const config = buildScannerConfig();
    expect(config.maxCaptures).toBeUndefined();
  });
});
