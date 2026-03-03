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

export interface BenchmarkWorkerClient {
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

  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Worker init timeout'));
    }, 3000);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve();
        return;
      }

      if (message.type === 'error') {
        const error = new Error(message.message);
        if (typeof message.id === 'number') {
          const slot = pending.get(message.id);
          if (slot) {
            pending.delete(message.id);
            slot.reject(error);
          }
        } else {
          for (const [id, slot] of pending.entries()) {
            pending.delete(id);
            slot.reject(error);
          }
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

  await ready;

  return {
    async processRgba(width: number, height: number, rgbaBuffer: ArrayBuffer): Promise<WorkerFrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<WorkerFrameProcessResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });

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
      return promise;
    },

    async processBitmap(bitmap: ImageBitmap): Promise<WorkerFrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<WorkerFrameProcessResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });

      worker.postMessage(
        {
          type: 'process-image-bitmap',
          id,
          nowMs: performance.now(),
          bitmap,
        } satisfies WorkerRequest,
        [bitmap],
      );
      return promise;
    },

    async destroy(): Promise<void> {
      worker.terminate();
      pending.clear();
    },
  };
}
