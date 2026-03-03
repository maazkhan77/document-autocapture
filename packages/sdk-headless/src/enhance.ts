import { createScannerWithFlavor, type ScannerConfig } from './flavors';

export function createScanner(config: ScannerConfig = {}) {
  return createScannerWithFlavor('enhance', config);
}

export * from './flavors';
