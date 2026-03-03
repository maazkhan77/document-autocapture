import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScannerWorker } from './index';

describe('createScannerWorker', () => {
  const originalWorker = globalThis.Worker;

  afterEach(() => {
    if (originalWorker) {
      vi.stubGlobal('Worker', originalWorker);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('creates module worker pointing at worker.js', () => {
    const constructed: Array<{ url: URL; options: WorkerOptions }> = [];
    class WorkerMock {
      constructor(url: URL, options: WorkerOptions) {
        constructed.push({ url, options });
      }
    }

    vi.stubGlobal('Worker', WorkerMock as unknown as typeof Worker);
    createScannerWorker();

    expect(constructed).toHaveLength(1);
    expect(constructed[0].options.type).toBe('module');
    expect(constructed[0].url.pathname.endsWith('/worker.js')).toBe(true);
  });
});
