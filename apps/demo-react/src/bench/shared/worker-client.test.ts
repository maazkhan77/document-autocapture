import { defaultEngineConfig } from '@document-autocapture/core-engine';
import type { WorkerRequest, WorkerResponse } from '@document-autocapture/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBenchmarkWorkerClient } from './worker-client';

type InitMode = 'ready' | 'error';

let initMode: InitMode = 'ready';
let activeMockWorker: MockWorker | undefined;

class MockWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly terminate = vi.fn();
  throwOnProcessPost = false;

  readonly postMessage = vi.fn((message: WorkerRequest) => {
    if (message.type === 'init') {
      if (initMode === 'error') {
        this.emit({ type: 'error', message: 'init failed' });
      } else {
        this.emit({ type: 'ready' });
      }
      return;
    }

    if (this.throwOnProcessPost) {
      throw new Error('post failed');
    }
  });

  emit(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
}

vi.mock('@document-autocapture/worker-runtime', () => ({
  createScannerWorker: () => {
    activeMockWorker = new MockWorker();
    return activeMockWorker as unknown as Worker;
  },
}));

describe('createBenchmarkWorkerClient', () => {
  beforeEach(() => {
    initMode = 'ready';
    activeMockWorker = undefined;
    (globalThis as { window?: unknown }).window = globalThis;
  });

  it('rejects fast when worker init fails and terminates worker', async () => {
    initMode = 'error';
    await expect(
      createBenchmarkWorkerClient({
        engineConfig: defaultEngineConfig,
      }),
    ).rejects.toThrow('init failed');
    expect(activeMockWorker?.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects pending frame promises on destroy', async () => {
    const client = await createBenchmarkWorkerClient({
      engineConfig: defaultEngineConfig,
    });

    const pending = client.processRgba(2, 2, new ArrayBuffer(16));
    await client.destroy();

    await expect(pending).rejects.toThrow('Benchmark worker client destroyed');
    expect(activeMockWorker?.terminate).toHaveBeenCalledTimes(1);
  });

  it('removes pending slot when frame postMessage throws', async () => {
    const client = await createBenchmarkWorkerClient({
      engineConfig: defaultEngineConfig,
    });
    if (!activeMockWorker) {
      throw new Error('Mock worker missing');
    }
    activeMockWorker.throwOnProcessPost = true;

    await expect(client.processRgba(2, 2, new ArrayBuffer(16))).rejects.toThrow('post failed');
    await client.destroy();
  });
});
