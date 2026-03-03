import { describe, expect, it } from 'vitest';
import { createScanner } from './index';

describe('@docuscan/sdk-headless exports', () => {
  it('creates scanner session with required API surface', async () => {
    const scanner = createScanner();
    expect(typeof scanner.getCapabilities).toBe('function');
    expect(typeof scanner.start).toBe('function');
    expect(typeof scanner.stop).toBe('function');
    expect(typeof scanner.captureManual).toBe('function');
    expect(typeof scanner.updateConfig).toBe('function');
    expect(typeof scanner.on).toBe('function');
    expect(typeof scanner.destroy).toBe('function');

    const capabilities = scanner.getCapabilities();
    expect(capabilities.selectedMode).toBe('fallback');
    await scanner.destroy();
  });
});
