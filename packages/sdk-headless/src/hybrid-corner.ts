import { createScannerWithFlavor, type ScannerConfig } from './flavors';

export function createScanner(config: ScannerConfig = {}) {
  return createScannerWithFlavor('hybrid-corner', config);
}

export * from './flavors';
