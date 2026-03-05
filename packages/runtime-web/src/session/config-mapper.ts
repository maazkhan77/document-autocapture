import { defaultEngineConfig, type EngineConfig } from '@document-autocapture/core-engine';
import type { WorkerDetectorConfig } from '@document-autocapture/worker-runtime';
import type { DetectorMode, ScannerConfig } from '../types';

const ENGINE_CONFIG_KEYS: Array<keyof EngineConfig> = Object.keys(defaultEngineConfig) as Array<
  keyof EngineConfig
>;

export function toEngineConfig(config: Partial<ScannerConfig>): Partial<EngineConfig> {
  const engineConfig: Partial<EngineConfig> = {};
  for (const key of ENGINE_CONFIG_KEYS) {
    if (config[key] !== undefined) {
      engineConfig[key] = config[key] as never;
    }
  }
  if (config.cvContourEnabled !== undefined) {
    engineConfig.contourEnabled = config.cvContourEnabled;
  }
  return engineConfig;
}

export function normalizeDetectorMode(value: unknown): DetectorMode {
  if (value === 'cv' || value === 'hybrid' || value === 'ml') {
    return value;
  }
  return 'hybrid';
}

export function toWorkerDetectorConfig(config: ScannerConfig): WorkerDetectorConfig {
  const pipelineVersion = config.mlPipelineVersion ?? 'v1-heuristic';
  const resolvedModelId =
    pipelineVersion === 'v2-graph'
      ? config.mlModelId && config.mlModelId !== 'doc-corner-v1'
        ? config.mlModelId
        : 'doc-corner-v2'
      : config.mlModelId ?? 'doc-corner-v1';
  return {
    detectorMode: normalizeDetectorMode(config.detectorMode),
    graphMlEnabled: config.graphMlEnabled !== false,
    cocoBookEnabled: config.cocoBookEnabled !== false,
    cocoMinScore: Math.max(0, Math.min(1, config.cocoMinScore ?? 0.45)),
    cocoUseAsPrimaryInMlMode: config.cocoUseAsPrimaryInMlMode !== false,
    mlFallbackEnabled: config.mlFallbackEnabled !== false,
    mlFallbackFrameStride: Math.max(1, Math.floor(config.mlFallbackFrameStride ?? 5)),
    mlFallbackTriggerConsecutiveMisses: Math.max(
      1,
      Math.floor(config.mlFallbackTriggerConsecutiveMisses ?? 8),
    ),
    mlFallbackMinCvConfidence: Math.max(0, Math.min(1, config.mlFallbackMinCvConfidence ?? 0.35)),
    mlRescueEnabled: config.mlRescueEnabled !== false,
    mlRescueFrameStride: Math.max(1, Math.floor(config.mlRescueFrameStride ?? 2)),
    mlFallbackExitConsecutiveCvRecoveries: Math.max(
      1,
      Math.floor(config.mlFallbackExitConsecutiveCvRecoveries ?? 3),
    ),
    mlFallbackReentryCooldownFrames: Math.max(
      0,
      Math.floor(config.mlFallbackReentryCooldownFrames ?? 10),
    ),
    mlModelId: resolvedModelId,
    mlModelUrl: config.mlModelUrl,
    mlModelBaseUrl: config.mlModelBaseUrl,
    mlWasmBaseUrl: config.mlWasmBaseUrl,
    mlInputSize: config.mlInputSize,
    mlPipelineVersion: pipelineVersion,
    debug: config.debug,
  };
}
