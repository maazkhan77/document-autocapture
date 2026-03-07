export type {
  CvFallbackReason,
  DetectorMode,
  MlPipelineVersion,
  WorkerDetectorConfig,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

export function createScannerWorker(): Worker {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}
