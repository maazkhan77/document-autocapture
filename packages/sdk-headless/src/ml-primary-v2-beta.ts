import { createScannerWithFlavor, type ScannerConfig } from './flavors';

export function createScanner(config: ScannerConfig = {}) {
  return createScannerWithFlavor('ml-primary-v2-beta', config);
}

export * from './flavors';
