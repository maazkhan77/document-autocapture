import { createScannerWithFlavor, type ScannerConfig } from './flavors';

export function createScanner(config: ScannerConfig = {}) {
  return createScannerWithFlavor('core', config);
}

export * from './flavors';
