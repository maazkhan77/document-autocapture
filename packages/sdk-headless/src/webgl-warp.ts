import { createScannerWithFlavor, type ScannerConfig } from './flavors';

export function createScanner(config: ScannerConfig = {}) {
  return createScannerWithFlavor('webgl-warp', config);
}

export * from './flavors';
