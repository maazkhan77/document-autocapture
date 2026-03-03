import type { EngineConfig, FrameProcessResult } from '@document-autocapture/core-engine';
import {
  createScannerWorker,
  type WorkerDetectorConfig,
  type WorkerRequest,
  type WorkerResponse,
} from '@document-autocapture/worker-runtime';

export type WorkerFrameTelemetry = Extract<WorkerResponse, { type: 'frame-result' }>['telemetry'];

export interface WorkerFrameProcessResult {
  result: FrameProcessResult;
  telemetry?: WorkerFrameTelemetry;
}

type PendingResolver = {
  resolve: (value: WorkerFrameProcessResult) => void;
  reject: (error: Error) => void;
};

interface BenchmarkWorkerClient {
  processRgba(width: number, height: number, rgbaBuffer: ArrayBuffer): Promise<WorkerFrameProcessResult>;
  processBitmap(bitmap: ImageBitmap): Promise<WorkerFrameProcessResult>;
  destroy(): Promise<void>;
}

interface CreateBenchmarkWorkerClientOptions {
  engineConfig: EngineConfig;
  detectorConfig?: Partial<WorkerDetectorConfig>;
}

export async function createBenchmarkWorkerClient(
  options: CreateBenchmarkWorkerClientOptions,
): Promise<BenchmarkWorkerClient> {
  const worker = createScannerWorker();
  let frameId = 0;
  const pending = new Map<number, PendingResolver>();
  let readySettled = false;

  const rejectPending = (error: Error) => {
    for (const [id, slot] of pending.entries()) {
      pending.delete(id);
      slot.reject(error);
    }
  };

  const ready = new Promise<void>((resolve, reject) => {
    const settleReady = (fn: () => void) => {
      if (readySettled) {
        return;
      }
      readySettled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = window.setTimeout(() => {
      settleReady(() => reject(new Error('Worker init timeout')));
    }, 3000);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') {
        settleReady(resolve);
        return;
      }

      if (message.type === 'error') {
        const error = new Error(message.message);
        if (!readySettled) {
          rejectPending(error);
          settleReady(() => reject(error));
          return;
        }
        if (typeof message.id === 'number') {
          const slot = pending.get(message.id);
          if (slot) {
            pending.delete(message.id);
            slot.reject(error);
          }
        } else {
          rejectPending(error);
        }
        return;
      }

      if (message.type === 'frame-result') {
        const slot = pending.get(message.id);
        if (slot) {
          pending.delete(message.id);
          slot.resolve({
            result: message.result,
            telemetry: message.telemetry,
          });
        }
      }
    };
  });

  worker.postMessage({
    type: 'init',
    config: options.engineConfig,
    detectorConfig: options.detectorConfig,
  } satisfies WorkerRequest);

  try {
    await ready;
  } catch (error) {
    worker.terminate();
    throw error;
  }

  return {
    async processRgba(width: number, height: number, rgbaBuffer: ArrayBuffer): Promise<WorkerFrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<WorkerFrameProcessResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });

      try {
        worker.postMessage(
          {
            type: 'process-frame',
            id,
            width,
            height,
            nowMs: performance.now(),
            rgbaBuffer,
          } satisfies WorkerRequest,
          [rgbaBuffer],
        );
      } catch (error) {
        pending.delete(id);
        throw error instanceof Error ? error : new Error('Failed to post RGBA frame to worker');
      }
      return promise;
    },

    async processBitmap(bitmap: ImageBitmap): Promise<WorkerFrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<WorkerFrameProcessResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });

      try {
        worker.postMessage(
          {
            type: 'process-image-bitmap',
            id,
            nowMs: performance.now(),
            bitmap,
          } satisfies WorkerRequest,
          [bitmap],
        );
      } catch (error) {
        pending.delete(id);
        throw error instanceof Error ? error : new Error('Failed to post bitmap frame to worker');
      }
      return promise;
    },

    async destroy(): Promise<void> {
      rejectPending(new Error('Benchmark worker client destroyed'));
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    },
  };
}
