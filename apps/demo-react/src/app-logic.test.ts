import { describe, expect, it } from 'vitest';
import { buildShareUrl, getPresetConfig } from './app-logic';

describe('demo app logic', () => {
  it('provides deterministic preset configs', () => {
    const recommended = getPresetConfig('recommended');
    expect(recommended.confidenceThreshold).toBe(0.42);
    expect(recommended.minStableConfidence).toBe(0.36);
    expect(recommended.stabilityWindowMs).toBe(320);
    expect(recommended.autoStableFrames).toBe(2);
    expect(recommended.detectionWidth).toBe(480);
    expect(recommended.detectorMode).toBe('ml');
    expect(recommended.mlFallbackEnabled).toBe(true);
    expect(recommended.mlFallbackFrameStride).toBe(5);
    expect(recommended.mlFallbackTriggerConsecutiveMisses).toBe(3);
    expect(recommended.mlFallbackMinCvConfidence).toBe(0.55);
    expect(recommended.mlRescueEnabled).toBe(true);
    expect(recommended.mlRescueFrameStride).toBe(2);
    expect(recommended.postCaptureRefine).toBe('off');
  });

  it('builds share URL with scanner controls encoded', () => {
    const url = buildShareUrl({
      currentSearch: '?foo=1',
      origin: 'https://example.com',
      path: '/scan',
      detectorMode: 'hybrid',
      autoCapture: true,
      debugOverlayLevel: 'full',
      detectionWidth: 480,
      mlFallbackEnabled: true,
      mlFallbackFrameStride: 5,
      mlFallbackTriggerConsecutiveMisses: 8,
      mlFallbackMinCvConfidence: 0.35,
      mlRescueEnabled: true,
      mlRescueFrameStride: 2,
      postCaptureRefine: 'safe',
      mlPipelineVersion: 'v2-graph',
      mlModelId: 'doc-corner-v2',
      mlInputSize: 224,
      warpValidationLevel: 'strict',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('foo')).toBe('1');
    expect(parsed.searchParams.get('detectorMode')).toBe('hybrid');
    expect(parsed.searchParams.get('autoCapture')).toBe('1');
    expect(parsed.searchParams.get('debugOverlayLevel')).toBe('full');
    expect(parsed.searchParams.get('detectionWidth')).toBe('480');
    expect(parsed.searchParams.get('mlFallbackEnabled')).toBe('1');
    expect(parsed.searchParams.get('mlFallbackFrameStride')).toBe('5');
    expect(parsed.searchParams.get('mlFallbackTriggerConsecutiveMisses')).toBe('8');
    expect(parsed.searchParams.get('mlFallbackMinCvConfidence')).toBe('0.35');
    expect(parsed.searchParams.get('mlRescueEnabled')).toBe('1');
    expect(parsed.searchParams.get('mlRescueFrameStride')).toBe('2');
    expect(parsed.searchParams.get('postCaptureRefine')).toBe('safe');
    expect(parsed.searchParams.get('mlPipelineVersion')).toBe('v2-graph');
    expect(parsed.searchParams.get('mlModelId')).toBe('doc-corner-v2');
    expect(parsed.searchParams.get('mlInputSize')).toBe('224');
    expect(parsed.searchParams.get('warpValidationLevel')).toBe('strict');
  });
});
