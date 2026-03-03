export {
  createScannerSession as createScanner,
  detectCapabilities,
  selectExecutionMode,
} from '@document-autocapture/runtime-web';

export { createScannerWithFlavor, scannerFlavorDefaults, withScannerFlavor } from './flavors';
export type { ScannerFlavor } from './flavors';

export type {
  Capabilities,
  CaptureResult,
  ScannerConfig,
  ScannerEventMap,
  ScannerEventName,
  ScannerSession,
  WarpTierUsed,
} from '@document-autocapture/runtime-web';
