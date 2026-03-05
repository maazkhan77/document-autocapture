import {
  createScannerSession,
  type Capabilities,
  detectCapabilities,
  selectExecutionMode,
  type ScannerConfig,
  type ScannerEventMap,
  type ScannerEventName,
  type ScannerSession,
  type WarpTierUsed,
} from '@document-autocapture/runtime-web';
import { defaultMlModelBaseUrl } from './model-base-url';

export type ScannerFlavor =
  | 'core'
  | 'webgl-warp'
  | 'enhance'
  | 'hybrid-corner'
  | 'ml-fallback'
  | 'ml-primary-v2-beta';

type FlavorConfigMap = Record<ScannerFlavor, Partial<ScannerConfig>>;
const DEPRECATED_ALIAS_MAP: Partial<Record<ScannerFlavor, ScannerFlavor>> = {
  'ml-fallback': 'hybrid-corner',
};

export const scannerFlavorDefaults: FlavorConfigMap = {
  core: {
    detectorMode: 'cv',
    debugOverlayLevel: 'off',
  },
  'webgl-warp': {
    detectorMode: 'cv',
    preferredMode: 'best',
    debugOverlayLevel: 'off',
  },
  enhance: {
    detectorMode: 'hybrid',
    outputMaxWidth: 2048,
    outputMaxHeight: 2048,
    captureQuality: 0.95,
    autoCaptureConsecutiveStableFrames: 2,
  },
  'hybrid-corner': {
    detectorMode: 'hybrid',
    mlFallbackEnabled: true,
    mlFallbackFrameStride: 5,
    mlFallbackTriggerConsecutiveMisses: 8,
    mlFallbackMinCvConfidence: 0.35,
    mlFallbackExitConsecutiveCvRecoveries: 3,
    mlFallbackReentryCooldownFrames: 10,
    debugOverlayLevel: 'basic',
  },
  // Deprecated alias kept for backwards compatibility.
  'ml-fallback': {
    detectorMode: 'hybrid',
    mlFallbackEnabled: true,
    mlFallbackFrameStride: 5,
    mlFallbackTriggerConsecutiveMisses: 8,
    mlFallbackMinCvConfidence: 0.35,
    mlFallbackExitConsecutiveCvRecoveries: 3,
    mlFallbackReentryCooldownFrames: 10,
    debugOverlayLevel: 'basic',
  },
  'ml-primary-v2-beta': {
    detectorMode: 'ml',
    mlPipelineVersion: 'v2-graph',
    mlModelId: 'doc-corner-v2',
    warpValidationLevel: 'strict',
    mlFallbackEnabled: true,
    mlFallbackFrameStride: 1,
    mlFallbackTriggerConsecutiveMisses: 3,
    mlFallbackMinCvConfidence: 0.55,
    autoCaptureConsecutiveStableFrames: 2,
    debugOverlayLevel: 'basic',
  },
};

export function withScannerFlavor(flavor: ScannerFlavor, config: ScannerConfig = {}): ScannerConfig {
  const resolvedFlavor = DEPRECATED_ALIAS_MAP[flavor] ?? flavor;
  const base = scannerFlavorDefaults[resolvedFlavor];
  return {
    ...base,
    ...config,
  };
}

export function createScannerWithFlavor(flavor: ScannerFlavor, config: ScannerConfig = {}): ScannerSession {
  const flavoredConfig = withScannerFlavor(flavor, config);
  if (flavoredConfig.mlModelBaseUrl) {
    return createScannerSession(flavoredConfig);
  }
  return createScannerSession({
    ...flavoredConfig,
    mlModelBaseUrl: defaultMlModelBaseUrl(),
  });
}

export {
  detectCapabilities,
  selectExecutionMode,
};

export type {
  Capabilities,
  ScannerConfig,
  ScannerEventMap,
  ScannerEventName,
  ScannerSession,
  WarpTierUsed,
};
