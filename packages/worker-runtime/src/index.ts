export type {
  CvFallbackReason,
  DetectorMode,
  MlPipelineVersion,
  WorkerDetectorConfig,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

export function createScannerWorker(): Worker {
  const workerUrl = new URL('./worker.js', import.meta.url);
  return new Worker(workerUrl, { type: 'module' });
}
