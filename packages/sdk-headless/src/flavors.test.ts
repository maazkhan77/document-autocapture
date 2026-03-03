import { describe, expect, it } from 'vitest';
import { createScanner as createCoreScanner } from './core';
import { createScanner as createEnhancedScanner } from './enhance';
import { createScannerWithFlavor, scannerFlavorDefaults, withScannerFlavor } from './flavors';
import { createScanner as createHybridCornerScanner } from './hybrid-corner';
import { createScanner as createMlFallbackScanner } from './ml-fallback';
import { createScanner as createMlPrimaryV2BetaScanner } from './ml-primary-v2-beta';
import { createScanner as createWebglWarpScanner } from './webgl-warp';

describe('@docuscan/sdk-headless flavor defaults', () => {
  it('provides locked default profiles', () => {
    expect(scannerFlavorDefaults['webgl-warp'].preferredMode).toBe('best');
    expect(scannerFlavorDefaults.enhance.outputMaxWidth).toBe(2048);
    expect(scannerFlavorDefaults['hybrid-corner'].detectorMode).toBe('hybrid');
    expect(scannerFlavorDefaults['ml-fallback'].detectorMode).toBe('hybrid');
    expect(scannerFlavorDefaults['ml-primary-v2-beta'].detectorMode).toBe('ml');
    expect(scannerFlavorDefaults['ml-primary-v2-beta'].mlPipelineVersion).toBe('v2-graph');
    expect(scannerFlavorDefaults['ml-primary-v2-beta'].warpValidationLevel).toBe('strict');
  });

  it('merges user overrides with flavor defaults', () => {
    const merged = withScannerFlavor('core', {
      debugOverlayLevel: 'full',
    });

    expect(merged.detectorMode).toBe('cv');
    expect(merged.debugOverlayLevel).toBe('full');
  });
});

describe('@docuscan/sdk-headless flavor entrypoints', () => {
  it('creates scanner sessions for all flavor entrypoints', async () => {
    const scanners = [
      createScannerWithFlavor('core'),
      createCoreScanner(),
      createWebglWarpScanner(),
      createEnhancedScanner(),
      createHybridCornerScanner(),
      createMlFallbackScanner(),
      createMlPrimaryV2BetaScanner(),
    ];

    for (const scanner of scanners) {
      expect(typeof scanner.captureManual).toBe('function');
      expect(typeof scanner.updateConfig).toBe('function');
      await scanner.destroy();
    }
  });

  it('routes ml-fallback alias to hybrid-corner defaults', () => {
    const legacy = withScannerFlavor('ml-fallback');
    const preferred = withScannerFlavor('hybrid-corner');
    expect(legacy.detectorMode).toBe(preferred.detectorMode);
    expect(legacy.mlFallbackEnabled).toBe(preferred.mlFallbackEnabled);
    expect(legacy.mlFallbackFrameStride).toBe(preferred.mlFallbackFrameStride);
    expect(legacy.mlFallbackTriggerConsecutiveMisses).toBe(preferred.mlFallbackTriggerConsecutiveMisses);
  });

  it('applies v2 beta defaults with ML-first + strict warp validation', () => {
    const v2 = withScannerFlavor('ml-primary-v2-beta');
    expect(v2.detectorMode).toBe('ml');
    expect(v2.mlPipelineVersion).toBe('v2-graph');
    expect(v2.mlModelId).toBe('doc-corner-v2');
    expect(v2.warpValidationLevel).toBe('strict');
  });
});
