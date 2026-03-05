import {
  createScannerSession,
  type ScannerConfig,
  type ScannerSession,
} from '@document-autocapture/runtime-web';
import { defaultMlModelBaseUrl } from './model-base-url';

export function createScanner(config: Partial<ScannerConfig> = {}): ScannerSession {
  if (config.mlModelBaseUrl) {
    return createScannerSession(config);
  }
  return createScannerSession({
    ...config,
    mlModelBaseUrl: defaultMlModelBaseUrl(),
  });
}

export { createScannerWithFlavor, scannerFlavorDefaults, withScannerFlavor } from './flavors';
export type { ScannerFlavor } from './flavors';
export { detectCapabilities, selectExecutionMode } from '@document-autocapture/runtime-web';

export type {
  Capabilities,
  CaptureResult,
  ScannerConfig,
  ScannerEventMap,
  ScannerEventName,
  ScannerSession,
  WarpTierUsed,
} from '@document-autocapture/runtime-web';
