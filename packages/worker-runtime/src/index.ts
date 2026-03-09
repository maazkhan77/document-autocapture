export type {
  CvFallbackReason,
  DetectorMode,
  MlPipelineVersion,
  WorkerDetectorConfig,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

export function createScannerWorker(): Worker {
  try {
    return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    // Safari <17.4 does not support module workers; fall back to classic worker.
    return new Worker(new URL('./worker.js', import.meta.url));
  }
}
