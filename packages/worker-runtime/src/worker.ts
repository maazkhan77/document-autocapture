/// <reference lib="webworker" />

import {
  createEngine,
  type FrameProcessResult,
  setOpenCVReady,
  StabilityTracker,
} from '@document-autocapture/core-engine';
import {
  createTfjsMlQuadProvider,
  type MlQuadProvider,
} from '@document-autocapture/ml-tf-fallback';
import { createCocoQuadProvider, type CocoQuadProvider } from './coco-provider';
import { FallbackStateMachine } from './fallback-state';
import { buildMlRescueRgba } from './ml-rescue';
import type {
  CvFallbackReason,
  WorkerDetectorConfig,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import {
  createMlStageTimings,
  fuseMlResult as fuseMlResultHelper,
  isCvDetectionFound,
  patchFallbackState,
} from './worker-helpers';

let engine = createEngine();
let ingestCanvas: OffscreenCanvas | undefined;
let ingestCtx: OffscreenCanvasRenderingContext2D | null | undefined;
let openCvLoadTask: Promise<boolean> | undefined;
let configuredOpenCvScriptUrl = '/opencv.js';
let openCvRetryAfterMs = 0;
let cocoRetryAfterMs = 0;
let mlRetryAfterMs = 0;

const COCO_INIT_RETRY_COOLDOWN_MS = 5000;
const GRAPH_PROVIDER_TIMEOUT_MS = 1200;
const COCO_PROVIDER_TIMEOUT_MS = 2800;

interface OpenCvRuntime {
  Mat?: unknown;
  getBuildInformation?: () => string;
  onRuntimeInitialized?: (() => void) | null;
}

type WorkerGlobalWithOptionalImportScripts = Omit<WorkerGlobalScope, 'importScripts'> & {
  importScripts?: (...urls: (string | URL)[]) => void;
};

const defaultDetectorConfig: WorkerDetectorConfig = {
  detectorMode: 'ml',
  graphMlEnabled: true,
  cocoBookEnabled: true,
  cocoMinScore: 0.45,
  cocoUseAsPrimaryInMlMode: true,
  mlFallbackEnabled: true,
  mlFallbackFrameStride: 5,
  mlFallbackTriggerConsecutiveMisses: 8,
  mlFallbackMinCvConfidence: 0.35,
  mlRescueEnabled: true,
  mlRescueFrameStride: 2,
  mlFallbackExitConsecutiveCvRecoveries: 3,
  mlFallbackReentryCooldownFrames: 10,
  mlModelId: 'doc-corner-v1',
  mlModelUrl: undefined,
  mlModelBaseUrl: undefined,
  mlWasmBaseUrl: undefined,
  mlInputSize: 320,
  mlPipelineVersion: 'v1-heuristic',
  debug: false,
};

let detectorConfig: WorkerDetectorConfig = { ...defaultDetectorConfig };
let mlProvider: MlQuadProvider | undefined;
let cocoProvider: CocoQuadProvider | undefined;
let mlReady = false;
let mlDisabled = false;
let mlModelLoaded = false;
let cocoReady = false;
let mlInitTask: Promise<void> | undefined;
let cocoInitTask: Promise<void> | undefined;
let mlWarned = false;
let mlHeuristicWarned = false;
let cocoWarned = false;
let openCvWarned = false;
type MlProviderName = 'graph_v2' | 'graph_v1' | 'coco_book';

interface MlProviderStabilityTrackers {
  graph: StabilityTracker;
  coco: StabilityTracker;
}

function createMlStabilityTrackers(): MlProviderStabilityTrackers {
  return {
    graph: new StabilityTracker(engine.config),
    coco: new StabilityTracker(engine.config),
  };
}

function resetMlStabilityTrackers(trackers: MlProviderStabilityTrackers): void {
  trackers.graph.reset();
  trackers.coco.reset();
}

let mlStabilityByProvider = createMlStabilityTrackers();
let mlGrayBufferByProvider: Partial<Record<'graph' | 'coco', Uint8ClampedArray>> = {};
let mlInferenceUsed = false;
let mlRescueUsed = false;
let graphAttempted = false;
let cocoAttempted = false;
let cocoUsed = false;
let providerUsed: MlProviderName | 'cv_hough' | 'cv_contour' | undefined;
let providerRejectReason: string | undefined;
let cvAttempted = false;
let cvFallbackReason: CvFallbackReason = 'none';
let mlRescueBuffer: Uint8ClampedArray | undefined;
let mlRescueCounter = 0;
let mlRescueDisabledWarned = false;
let mlRescueUnavailableWarned = false;
let lastMlProviderUsed: MlProviderName | undefined;
let activeFrameToken = 0;

const fallbackStateMachine = new FallbackStateMachine();
let fallbackTelemetryState: 'inactive' | 'armed' | 'active' = 'inactive';

function ensureIngestCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!ingestCanvas) {
    ingestCanvas = new OffscreenCanvas(width, height);
    ingestCtx = ingestCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (!ingestCtx || !ingestCanvas) {
    throw new Error('OffscreenCanvas 2D context unavailable in worker');
  }

  if (ingestCanvas.width !== width) {
    ingestCanvas.width = width;
  }
  if (ingestCanvas.height !== height) {
    ingestCanvas.height = height;
  }

  return ingestCtx;
}

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

function warn(message: string): void {
  post({
    type: 'warning',
    message,
  });
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isFrameTokenActive(frameToken: number): boolean {
  return frameToken === activeFrameToken;
}

async function withProviderTimeout<T>(
  providerName: string,
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle = 0;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = self.setTimeout(() => {
        reject(new Error(`${providerName} provider timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      self.clearTimeout(timeoutHandle);
    }
  }
}

function summarizeMlDiagnostics(diagnostics: ReturnType<MlQuadProvider['getDiagnostics']>): string {
  return [
    `pipeline=${detectorConfig.mlPipelineVersion ?? 'v1-heuristic'}`,
    `modelId=${detectorConfig.mlModelId ?? 'doc-corner-v1'}`,
    `modelLoaded=${diagnostics.modelLoaded}`,
    `modelVersion=${diagnostics.modelVersion ?? 'unknown'}`,
    `decodeMode=${diagnostics.decodeMode ?? 'unknown'}`,
    `backend=${diagnostics.backend}`,
    `artifact=${diagnostics.artifactUrl ?? 'n/a'}`,
    `lastError=${diagnostics.lastError ?? 'none'}`,
  ].join(' | ');
}

function getWorkerCv(): OpenCvRuntime | undefined {
  return (self as unknown as { cv?: OpenCvRuntime }).cv;
}

async function loadOpenCvScript(scriptUrl: string): Promise<void> {
  const workerSelf = self as unknown as WorkerGlobalWithOptionalImportScripts;
  let importScriptsError: unknown;
  if (typeof workerSelf.importScripts === 'function') {
    try {
      workerSelf.importScripts(scriptUrl);
      return;
    } catch (error) {
      importScriptsError = error;
    }
  }

  let source = '';
  try {
    const response = await fetch(scriptUrl, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenCV script from ${scriptUrl} (${response.status})`);
    }
    source = await response.text();
  } catch (error) {
    if (importScriptsError instanceof Error) {
      throw new Error(
        `OpenCV load failed via importScripts (${importScriptsError.message}) and fetch (${
          error instanceof Error ? error.message : 'unknown fetch error'
        })`,
      );
    }
    throw error instanceof Error ? error : new Error('OpenCV script fetch failed');
  }

  const hadOwnImportScripts = Object.prototype.hasOwnProperty.call(workerSelf, 'importScripts');
  const previousImportScripts = workerSelf.importScripts;

  if (typeof previousImportScripts !== 'function') {
    Object.defineProperty(workerSelf, 'importScripts', {
      configurable: true,
      writable: true,
      value: (...nestedUrls: (string | URL)[]) => {
        throw new Error(
          `importScripts unavailable in module worker while loading OpenCV (${nestedUrls.map((url) => String(url)).join(', ')})`,
        );
      },
    });
  }

  try {
    // Evaluate OpenCV as a classic script so it can attach `self.cv`.
    // eslint-disable-next-line no-new-func
    const evaluateScript = new Function(`${source}\n//# sourceURL=${scriptUrl}`) as () => void;
    evaluateScript.call(workerSelf);
  } finally {
    if (typeof previousImportScripts === 'function' || hadOwnImportScripts) {
      workerSelf.importScripts = previousImportScripts;
    } else {
      delete workerSelf.importScripts;
    }
  }
}

function mergeDetectorConfig(
  partial?: Partial<WorkerDetectorConfig>,
): WorkerDetectorConfig {
  if (!partial) {
    return detectorConfig;
  }
  const requestedPipelineVersion =
    partial.mlPipelineVersion ??
    detectorConfig.mlPipelineVersion ??
    defaultDetectorConfig.mlPipelineVersion;
  const inferredModelId =
    partial.mlModelId ??
    detectorConfig.mlModelId ??
    (requestedPipelineVersion === 'v2-graph' ? 'doc-corner-v2' : 'doc-corner-v1');
  detectorConfig = {
    ...detectorConfig,
    ...partial,
    detectorMode: partial.detectorMode ?? detectorConfig.detectorMode,
    graphMlEnabled: partial.graphMlEnabled ?? detectorConfig.graphMlEnabled,
    cocoBookEnabled: partial.cocoBookEnabled ?? detectorConfig.cocoBookEnabled,
    cocoMinScore: Math.max(0, Math.min(1, partial.cocoMinScore ?? detectorConfig.cocoMinScore)),
    cocoUseAsPrimaryInMlMode:
      partial.cocoUseAsPrimaryInMlMode ?? detectorConfig.cocoUseAsPrimaryInMlMode,
    mlFallbackFrameStride: Math.max(1, partial.mlFallbackFrameStride ?? detectorConfig.mlFallbackFrameStride),
    mlFallbackTriggerConsecutiveMisses: Math.max(
      1,
      partial.mlFallbackTriggerConsecutiveMisses ?? detectorConfig.mlFallbackTriggerConsecutiveMisses,
    ),
    mlFallbackMinCvConfidence: Math.max(
      0,
      Math.min(1, partial.mlFallbackMinCvConfidence ?? detectorConfig.mlFallbackMinCvConfidence),
    ),
    mlRescueEnabled: partial.mlRescueEnabled ?? detectorConfig.mlRescueEnabled,
    mlRescueFrameStride: Math.max(
      1,
      partial.mlRescueFrameStride ?? detectorConfig.mlRescueFrameStride,
    ),
    mlFallbackExitConsecutiveCvRecoveries: Math.max(
      1,
      partial.mlFallbackExitConsecutiveCvRecoveries ?? detectorConfig.mlFallbackExitConsecutiveCvRecoveries,
    ),
    mlFallbackReentryCooldownFrames: Math.max(
      0,
      partial.mlFallbackReentryCooldownFrames ?? detectorConfig.mlFallbackReentryCooldownFrames,
    ),
    mlInputSize: Math.max(128, Math.min(640, partial.mlInputSize ?? detectorConfig.mlInputSize ?? 320)),
    mlPipelineVersion: requestedPipelineVersion,
    mlModelId: inferredModelId,
  };
  return detectorConfig;
}

function resetFallbackState(): void {
  fallbackStateMachine.reset();
  resetMlStabilityTrackers(mlStabilityByProvider);
  mlGrayBufferByProvider = {};
  fallbackTelemetryState = 'inactive';
  cvAttempted = false;
  cvFallbackReason = 'none';
  mlInferenceUsed = false;
  mlRescueUsed = false;
  graphAttempted = false;
  cocoAttempted = false;
  cocoUsed = false;
  providerUsed = undefined;
  providerRejectReason = undefined;
  mlRescueCounter = 0;
}

async function waitForOpenCvRuntime(cvRuntime: OpenCvRuntime, timeoutMs: number): Promise<void> {
  if (typeof cvRuntime.getBuildInformation === 'function' || typeof cvRuntime.Mat !== 'undefined') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = self.setTimeout(() => {
      reject(new Error(`OpenCV runtime initialization timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const previous = cvRuntime.onRuntimeInitialized;
    cvRuntime.onRuntimeInitialized = () => {
      if (typeof previous === 'function') {
        try {
          previous();
        } catch {
          // Ignore callback errors from previously registered handlers.
        }
      }
      self.clearTimeout(timeoutHandle);
      resolve();
    };
  });
}

async function ensureOpenCv(scriptUrl: string, debug: boolean): Promise<boolean> {
  const currentTime = now();
  if (openCvRetryAfterMs > currentTime) {
    return false;
  }

  if (!openCvLoadTask) {
    openCvLoadTask = (async () => {
      const existing = getWorkerCv();
      if (!existing) {
        await loadOpenCvScript(scriptUrl);
      }

      const cvRuntime = getWorkerCv();
      if (!cvRuntime) {
        throw new Error(`OpenCV runtime not found after loading ${scriptUrl}`);
      }

      await waitForOpenCvRuntime(cvRuntime, 10000);
      setOpenCVReady();

      if (debug) {
        console.warn(`[document-autocapture:worker] OpenCV ready from ${scriptUrl}`);
      }
      openCvRetryAfterMs = 0;

      return true;
    })();
  }

  try {
    return await openCvLoadTask;
  } catch (error) {
    openCvLoadTask = undefined;
    if (!openCvWarned) {
      openCvWarned = true;
      warn(
        `[document-autocapture] OpenCV unavailable from ${scriptUrl}; using fallback detector. ${
          error instanceof Error ? error.message : 'init failed'
        }`,
      );
    }
    if (debug) {
      console.warn(
        `[document-autocapture:worker] Failed to initialize OpenCV from ${scriptUrl}. Falling back to simple pipeline.`,
        error,
      );
    }
    // Avoid hammering load/fetch paths on every ML->CV fallback frame after a failure.
    openCvRetryAfterMs = now() + 5000;
    return false;
  }
}

async function ensureOpenCvForMlFallback(): Promise<void> {
  if (detectorConfig.detectorMode !== 'ml') {
    return;
  }
  await ensureOpenCv(configuredOpenCvScriptUrl, Boolean(detectorConfig.debug));
}

async function ensureMlProvider(): Promise<void> {
  if (mlDisabled || mlReady) {
    return;
  }
  if (mlRetryAfterMs > now()) {
    return;
  }

  if (!mlInitTask) {
    mlInitTask = (async () => {
      if (!mlProvider) {
        mlProvider = createTfjsMlQuadProvider();
      }
      if (detectorConfig.debug) {
        console.warn(
          `[document-autocapture:worker] TFJS init | ` +
            `pipeline=${detectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
            `modelId=${detectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
            `modelUrl=${detectorConfig.mlModelUrl ?? 'n/a'} | ` +
            `modelBaseUrl=${detectorConfig.mlModelBaseUrl ?? 'n/a'} | ` +
            `wasmBaseUrl=${detectorConfig.mlWasmBaseUrl ?? 'n/a'} | ` +
            `inputSize=${detectorConfig.mlInputSize ?? 320}`,
        );
      }
      await mlProvider.init({
        modelId: detectorConfig.mlModelId,
        modelUrl: detectorConfig.mlModelUrl,
        modelBaseUrl: detectorConfig.mlModelBaseUrl,
        wasmBaseUrl: detectorConfig.mlWasmBaseUrl,
        inputSize: detectorConfig.mlInputSize,
        debug: detectorConfig.debug,
      });
      mlReady = true;
      const diagnostics = mlProvider.getDiagnostics();
      mlModelLoaded = diagnostics.modelLoaded;
      if (!diagnostics.modelLoaded && !mlHeuristicWarned) {
        mlHeuristicWarned = true;
        if (detectorConfig.mlPipelineVersion === 'v2-graph') {
          const reason = diagnostics.lastError ? ` reason=${diagnostics.lastError}` : '';
          warn(
            `[document-autocapture] ML v2 graph model unavailable, running heuristic fallback until graph model is loadable.${reason}`,
          );
        } else {
          warn('[document-autocapture] ML running in heuristic mode (no graph model loaded). Provide a graphModelUrl artifact for best accuracy.');
        }
      }
      if (detectorConfig.debug) {
        console.warn(`[document-autocapture:worker] TFJS fallback ready | ${summarizeMlDiagnostics(diagnostics)}`);
      }
      mlRetryAfterMs = 0;
    })();
  }

  try {
    await mlInitTask;
  } catch (error) {
    mlReady = false;
    mlDisabled = false;
    mlModelLoaded = false;
    mlInitTask = undefined;
    mlRetryAfterMs = now() + 5000;
    if (!mlWarned) {
      mlWarned = true;
      warn(
        `[document-autocapture] TFJS fallback unavailable, continuing in CV-only mode: ${
          error instanceof Error ? error.message : 'init failed'
        }`,
      );
    }
    if (detectorConfig.debug) {
      console.warn(
        `[document-autocapture:worker] TFJS init failed | ` +
          `pipeline=${detectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
          `modelId=${detectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
          `inputSize=${detectorConfig.mlInputSize ?? 320}`,
        error,
      );
    }
  }
}

async function ensureCocoProvider(): Promise<void> {
  if (cocoReady || !detectorConfig.cocoBookEnabled) {
    return;
  }
  if (cocoRetryAfterMs > now()) {
    return;
  }
  if (!cocoProvider) {
    cocoProvider = createCocoQuadProvider();
  }
  if (!cocoInitTask) {
    cocoInitTask = (async () => {
      try {
        await cocoProvider?.init({
          debug: detectorConfig.debug,
          modelBase: 'lite_mobilenet_v2',
        });
        cocoReady = Boolean(cocoProvider?.isReady());
        cocoRetryAfterMs = 0;
        if (detectorConfig.debug) {
          const diagnostics = cocoProvider?.getDiagnostics();
          console.warn(
            `[document-autocapture:worker] COCO ready | ` +
              `ready=${diagnostics?.ready ?? false} ` +
              `backend=${diagnostics?.backend ?? 'unknown'} ` +
              `modelBase=${diagnostics?.modelBase ?? 'lite_mobilenet_v2'}`,
          );
        }
      } catch (error) {
        cocoReady = false;
        cocoRetryAfterMs = now() + COCO_INIT_RETRY_COOLDOWN_MS;
        if (!cocoWarned) {
          cocoWarned = true;
          warn(
            `[document-autocapture] COCO provider unavailable, continuing without COCO: ${
              error instanceof Error ? error.message : 'init failed'
            }`,
          );
        }
        if (detectorConfig.debug) {
          console.warn('[document-autocapture:worker] COCO init failed', error);
        }
      } finally {
        cocoInitTask = undefined;
      }
    })();
  }
  await cocoInitTask;
}

async function tryMlRescueInference(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  reason: 'miss' | 'reject',
  frameToken: number,
): Promise<Awaited<ReturnType<MlQuadProvider['infer']>> | undefined> {
  if (!isFrameTokenActive(frameToken)) {
    return undefined;
  }
  if (!detectorConfig.mlRescueEnabled) {
    if (detectorConfig.debug && !mlRescueDisabledWarned) {
      mlRescueDisabledWarned = true;
      console.warn('[document-autocapture:worker] ML rescue disabled by config');
    }
    return undefined;
  }

  if (!mlReady || !mlProvider || mlDisabled || !mlModelLoaded) {
    if (detectorConfig.debug && !mlRescueUnavailableWarned) {
      mlRescueUnavailableWarned = true;
      console.warn(
        `[document-autocapture:worker] ML rescue unavailable | ` +
          `mlReady=${mlReady} mlDisabled=${mlDisabled} mlModelLoaded=${mlModelLoaded}`,
      );
    }
    return undefined;
  }
  mlRescueUnavailableWarned = false;

  mlRescueCounter += 1;
  const rescueStride = Math.max(1, detectorConfig.mlRescueFrameStride);
  if (mlRescueCounter % rescueStride !== 0) {
    return undefined;
  }

  const enhanced = buildMlRescueRgba(rgba, width, height, mlRescueBuffer);
  if (!enhanced) {
    return undefined;
  }
  mlRescueBuffer = enhanced;

  if (detectorConfig.debug) {
    console.warn(
      `[document-autocapture:worker] ML rescue attempt | reason=${reason} stride=${rescueStride} counter=${mlRescueCounter}`,
    );
  }

  const rescue = await mlProvider.infer({
    rgba: enhanced,
    width,
    height,
  });
  if (!isFrameTokenActive(frameToken)) {
    return undefined;
  }
  if (rescue) {
    mlRescueUsed = true;
    mlRescueCounter = 0;
    if (detectorConfig.debug) {
      console.warn(
        `[document-autocapture:worker] ML rescue inference recovered candidate (reason=${reason})`,
      );
    }
  } else if (detectorConfig.debug) {
    console.warn(`[document-autocapture:worker] ML rescue inference miss (reason=${reason})`);
  }
  return rescue;
}

function fuseMlResult(
  mlQuad: Parameters<typeof fuseMlResultHelper>[0]['mlQuad'],
  mlConfidence: number,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  nowMs: number,
  elapsedMs: number,
  stabilityTracker: StabilityTracker,
  providerKey: 'graph' | 'coco',
  baseTimings?: Parameters<typeof createMlStageTimings>[1],
  frameToken?: number,
): FrameProcessResult {
  const useSharedState = frameToken === undefined || isFrameTokenActive(frameToken);
  const fused = fuseMlResultHelper({
    mlQuad,
    mlConfidence,
    rgba,
    width,
    height,
    nowMs,
    elapsedMs,
    engineConfig: engine.config,
    minCvConfidence: detectorConfig.mlFallbackMinCvConfidence,
    stabilityTracker,
    grayBuffer: useSharedState ? mlGrayBufferByProvider[providerKey] : undefined,
    baseTimings,
    debugEnabled: Boolean(detectorConfig.debug),
  });
  if (useSharedState) {
    mlGrayBufferByProvider[providerKey] = fused.grayBuffer;
  }
  return fused.result;
}

interface MlProviderAttemptResult {
  name: MlProviderName;
  attempted: boolean;
  ready: boolean;
  status: 'found' | 'reject' | 'miss' | 'unavailable' | 'error';
  result?: FrameProcessResult;
  elapsedMs?: number;
  errorMessage?: string;
}

function providerForGraphModelLoaded(modelLoaded: boolean): 'graph_v2' | 'graph_v1' {
  return modelLoaded ? 'graph_v2' : 'graph_v1';
}

async function runGraphProvider(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  nowMs: number,
  frameToken: number,
): Promise<MlProviderAttemptResult> {
  if (!isFrameTokenActive(frameToken)) {
    return {
      name: providerForGraphModelLoaded(mlModelLoaded),
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }
  if (!detectorConfig.graphMlEnabled) {
    return {
      name: providerForGraphModelLoaded(mlModelLoaded),
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }

  await ensureMlProvider();
  if (!isFrameTokenActive(frameToken)) {
    return {
      name: providerForGraphModelLoaded(mlModelLoaded),
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }
  const graphName = providerForGraphModelLoaded(mlModelLoaded);
  if (!mlReady || !mlProvider || mlDisabled) {
    return {
      name: graphName,
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }

  graphAttempted = true;
  mlInferenceUsed = true;
  const startedAt = now();
  const prediction = await mlProvider.infer({
    rgba,
    width,
    height,
  });
  if (!isFrameTokenActive(frameToken)) {
    return {
      name: graphName,
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }
  const elapsedMs = now() - startedAt;

  if (!prediction) {
    const rescuePrediction = await tryMlRescueInference(rgba, width, height, 'miss', frameToken);
    if (!rescuePrediction) {
      return {
        name: graphName,
        attempted: true,
        ready: true,
        status: 'miss',
        elapsedMs,
      };
    }
    const rescueResult = fuseMlResult(
      rescuePrediction.quad,
      rescuePrediction.confidence,
      rgba,
      width,
      height,
      nowMs,
      elapsedMs,
      mlStabilityByProvider.graph,
      'graph',
      undefined,
      frameToken,
    );
    if (rescueResult.detection.status === 'found') {
      return {
        name: graphName,
        attempted: true,
        ready: true,
        status: 'found',
        result: rescueResult,
        elapsedMs,
      };
    }
    return {
      name: graphName,
      attempted: true,
      ready: true,
      status: 'reject',
      result: rescueResult,
      elapsedMs,
    };
  }

  const mlResult = fuseMlResult(
    prediction.quad,
    prediction.confidence,
    rgba,
    width,
    height,
    nowMs,
    elapsedMs,
    mlStabilityByProvider.graph,
    'graph',
    undefined,
    frameToken,
  );
  if (mlResult.detection.status === 'found') {
    return {
      name: graphName,
      attempted: true,
      ready: true,
      status: 'found',
      result: mlResult,
      elapsedMs,
    };
  }

  const rescuePrediction = await tryMlRescueInference(rgba, width, height, 'reject', frameToken);
  if (!rescuePrediction) {
    return {
      name: graphName,
      attempted: true,
      ready: true,
      status: 'reject',
      result: mlResult,
      elapsedMs,
    };
  }

  const rescueResult = fuseMlResult(
    rescuePrediction.quad,
    rescuePrediction.confidence,
    rgba,
    width,
    height,
    nowMs,
    elapsedMs,
    mlStabilityByProvider.graph,
    'graph',
    undefined,
    frameToken,
  );
  return {
    name: graphName,
    attempted: true,
    ready: true,
    status: rescueResult.detection.status === 'found' ? 'found' : 'reject',
    result: rescueResult,
    elapsedMs,
  };
}

async function runCocoProvider(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  nowMs: number,
  frameToken: number,
): Promise<MlProviderAttemptResult> {
  if (!isFrameTokenActive(frameToken)) {
    return {
      name: 'coco_book',
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }
  if (!detectorConfig.cocoBookEnabled) {
    return {
      name: 'coco_book',
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }

  await ensureCocoProvider();
  if (!isFrameTokenActive(frameToken)) {
    return {
      name: 'coco_book',
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }
  if (!cocoReady || !cocoProvider) {
    return {
      name: 'coco_book',
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }

  cocoAttempted = true;
  mlInferenceUsed = true;
  const startedAt = now();
  const prediction = await cocoProvider.infer({
    rgba,
    width,
    height,
    minScore: detectorConfig.cocoMinScore,
    minAreaFraction: Math.max(0.03, engine.config.minAreaFraction),
    maxAreaFraction: Math.min(0.98, engine.config.maxAreaFraction),
    minAspectRatio: engine.config.minAspectRatio,
    maxAspectRatio: engine.config.maxAspectRatio,
    edgeTouchMarginPx: engine.config.edgeTouchMarginPx,
  });
  if (!isFrameTokenActive(frameToken)) {
    return {
      name: 'coco_book',
      attempted: false,
      ready: false,
      status: 'unavailable',
    };
  }
  const elapsedMs = now() - startedAt;
  if (!prediction) {
    return {
      name: 'coco_book',
      attempted: true,
      ready: true,
      status: 'miss',
      elapsedMs,
    };
  }

  const cocoResult = fuseMlResult(
    prediction.quad,
    prediction.confidence,
    rgba,
    width,
    height,
    nowMs,
    elapsedMs,
    mlStabilityByProvider.coco,
    'coco',
    undefined,
    frameToken,
  );
  return {
    name: 'coco_book',
    attempted: true,
    ready: true,
    status: cocoResult.detection.status === 'found' ? 'found' : 'reject',
    result: cocoResult,
    elapsedMs,
  };
}

function pickWinningMlProvider(
  candidates: MlProviderAttemptResult[],
): MlProviderAttemptResult | undefined {
  const found = candidates.filter(
    (candidate) => candidate.status === 'found' && candidate.result,
  );
  if (!found.length) {
    return undefined;
  }
  found.sort((a, b) => {
    const scoreA = a.result?.detection.bestCandidate?.score ?? 0;
    const scoreB = b.result?.detection.bestCandidate?.score ?? 0;
    const scoreDiff = scoreB - scoreA;
    if (Math.abs(scoreDiff) > 0.03) {
      return scoreDiff;
    }

    if (lastMlProviderUsed && a.name === lastMlProviderUsed && b.name !== lastMlProviderUsed) {
      return -1;
    }
    if (lastMlProviderUsed && b.name === lastMlProviderUsed && a.name !== lastMlProviderUsed) {
      return 1;
    }

    if (detectorConfig.cocoUseAsPrimaryInMlMode) {
      if (a.name === 'coco_book' && b.name !== 'coco_book') return -1;
      if (b.name === 'coco_book' && a.name !== 'coco_book') return 1;
    } else {
      const aIsGraph = a.name === 'graph_v1' || a.name === 'graph_v2';
      const bIsGraph = b.name === 'graph_v1' || b.name === 'graph_v2';
      if (aIsGraph && !bIsGraph) return -1;
      if (bIsGraph && !aIsGraph) return 1;
    }

    const elapsedA = a.elapsedMs ?? Number.POSITIVE_INFINITY;
    const elapsedB = b.elapsedMs ?? Number.POSITIVE_INFINITY;
    return elapsedA - elapsedB;
  });
  return found[0];
}

async function applyDetectorMode(
  cvResult: FrameProcessResult,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  nowMs: number,
): Promise<FrameProcessResult> {
  if (detectorConfig.detectorMode === 'cv') {
    fallbackStateMachine.reset();
    fallbackTelemetryState = 'inactive';
    return patchFallbackState(cvResult, 'inactive');
  }

  if (mlDisabled) {
    fallbackStateMachine.reset();
    fallbackTelemetryState = 'inactive';
    return patchFallbackState(cvResult, 'inactive');
  }

  if (detectorConfig.detectorMode !== 'ml' && !detectorConfig.mlFallbackEnabled) {
    fallbackStateMachine.reset();
    fallbackTelemetryState = 'inactive';
    return patchFallbackState(cvResult, 'inactive');
  }

  const bestScore = cvResult.detection.bestCandidate?.score ?? 0;
  const cvFound = cvResult.detection.status === 'found';
  const currentState = fallbackStateMachine.step(
    {
      cvFound,
      cvScore: bestScore,
    },
    {
      mode: detectorConfig.detectorMode,
      mlFallbackEnabled: detectorConfig.mlFallbackEnabled,
      triggerMisses: detectorConfig.mlFallbackTriggerConsecutiveMisses,
      lowConfidenceThreshold: detectorConfig.mlFallbackMinCvConfidence,
      lowConfidenceFrames: detectorConfig.mlFallbackTriggerConsecutiveMisses,
      exitRecoveries: detectorConfig.mlFallbackExitConsecutiveCvRecoveries,
      reentryCooldownFrames: detectorConfig.mlFallbackReentryCooldownFrames,
      recoveryConfidence: Math.max(detectorConfig.mlFallbackMinCvConfidence + 0.1, 0.45),
    },
  );
  fallbackTelemetryState = currentState.state;

  if (currentState.exited) {
    resetMlStabilityTrackers(mlStabilityByProvider);
  }

  if (!currentState.active) {
    if (isCvDetectionFound(cvResult)) {
      providerUsed =
        cvResult.detection.bestCandidate?.source === 'hough'
          ? 'cv_hough'
          : cvResult.detection.bestCandidate?.source === 'contour'
            ? 'cv_contour'
            : providerUsed;
    }
    return patchFallbackState(cvResult, currentState.state);
  }

  if (!detectorConfig.graphMlEnabled) {
    cvFallbackReason = 'ml_unavailable';
    if (isCvDetectionFound(cvResult)) {
      providerUsed =
        cvResult.detection.bestCandidate?.source === 'hough'
          ? 'cv_hough'
          : cvResult.detection.bestCandidate?.source === 'contour'
            ? 'cv_contour'
            : providerUsed;
    }
    return patchFallbackState(cvResult, currentState.state);
  }

  await ensureMlProvider();
  if (!mlReady || !mlProvider) {
    cvFallbackReason = 'ml_unavailable';
    if (isCvDetectionFound(cvResult)) {
      providerUsed =
        cvResult.detection.bestCandidate?.source === 'hough'
          ? 'cv_hough'
          : cvResult.detection.bestCandidate?.source === 'contour'
            ? 'cv_contour'
            : providerUsed;
    }
    return patchFallbackState(cvResult, currentState.state);
  }

  const stride = Math.max(1, detectorConfig.mlFallbackFrameStride);
  if (detectorConfig.detectorMode === 'hybrid' && currentState.activeFrameCounter % stride !== 0) {
    return patchFallbackState(cvResult, 'active');
  }

  const mlStart = now();
  mlInferenceUsed = true;
  graphAttempted = true;
  const mlPrediction = await mlProvider.infer({
    rgba,
    width,
    height,
  });
  const mlElapsedMs = now() - mlStart;

  if (!mlPrediction) {
    cvFallbackReason = 'ml_miss';
    if (isCvDetectionFound(cvResult)) {
      providerUsed =
        cvResult.detection.bestCandidate?.source === 'hough'
          ? 'cv_hough'
          : cvResult.detection.bestCandidate?.source === 'contour'
            ? 'cv_contour'
            : providerUsed;
    }
    return patchFallbackState(cvResult, 'active');
  }

  const mlResult = fuseMlResult(
    mlPrediction.quad,
    mlPrediction.confidence,
    rgba,
    width,
    height,
    nowMs,
    mlElapsedMs,
    mlStabilityByProvider.graph,
    'graph',
    cvResult.detection.timings,
  );

  if (!isCvDetectionFound(cvResult) || mlResult.detection.status === 'found') {
    if (mlResult.detection.status === 'found') {
      providerUsed = providerForGraphModelLoaded(mlModelLoaded);
      lastMlProviderUsed = providerForGraphModelLoaded(mlModelLoaded);
    }
    return mlResult;
  }
  cvFallbackReason = 'ml_reject';
  providerRejectReason = mlResult.detection.rejectionReason ?? 'ml_reject';
  if (isCvDetectionFound(cvResult)) {
    providerUsed =
      cvResult.detection.bestCandidate?.source === 'hough'
        ? 'cv_hough'
        : cvResult.detection.bestCandidate?.source === 'contour'
          ? 'cv_contour'
          : providerUsed;
  }
  return patchFallbackState(cvResult, 'active');
}

async function processFrame(
  id: number,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  nowMs: number,
): Promise<void> {
  const frameToken = ++activeFrameToken;
  mlInferenceUsed = false;
  mlRescueUsed = false;
  graphAttempted = false;
  cocoAttempted = false;
  cocoUsed = false;
  providerUsed = undefined;
  providerRejectReason = undefined;
  cvAttempted = false;
  cvFallbackReason = 'none';
  if (!detectorConfig.cocoBookEnabled) {
    cocoReady = false;
    cocoRetryAfterMs = 0;
  }
  let finalResult: FrameProcessResult;

  if (detectorConfig.detectorMode === 'ml' && !mlDisabled) {
    fallbackTelemetryState = 'active';
    const providerTasks: Promise<MlProviderAttemptResult>[] = [];
    if (detectorConfig.graphMlEnabled) {
      providerTasks.push(
        withProviderTimeout(
          'graph',
          runGraphProvider(rgba, width, height, nowMs, frameToken),
          GRAPH_PROVIDER_TIMEOUT_MS,
        ),
      );
    }
    if (detectorConfig.cocoBookEnabled) {
      providerTasks.push(
        withProviderTimeout(
          'coco',
          runCocoProvider(rgba, width, height, nowMs, frameToken),
          COCO_PROVIDER_TIMEOUT_MS,
        ),
      );
    }

    const settled = await Promise.allSettled(providerTasks);
    const attempts: MlProviderAttemptResult[] = settled.map((entry, index) => {
      if (entry.status === 'fulfilled') {
        return entry.value;
      }
      const name: MlProviderName =
        providerTasks.length === 1
          ? detectorConfig.graphMlEnabled
            ? providerForGraphModelLoaded(mlModelLoaded)
            : 'coco_book'
          : index === 0
            ? providerForGraphModelLoaded(mlModelLoaded)
            : 'coco_book';
      return {
        name,
        attempted: true,
        ready: false,
        status: 'error',
        errorMessage: entry.reason instanceof Error ? entry.reason.message : 'provider failed',
      };
    });

    const winningProvider = pickWinningMlProvider(attempts);
    if (winningProvider?.result) {
      finalResult = winningProvider.result;
      providerUsed = winningProvider.name;
      cocoUsed = winningProvider.name === 'coco_book';
      if (winningProvider.name === 'graph_v1' || winningProvider.name === 'graph_v2') {
        mlRescueCounter = 0;
      }
      lastMlProviderUsed = winningProvider.name;
    } else {
      const hadReject = attempts.some((attempt) => attempt.status === 'reject');
      const hadAttempt = attempts.some((attempt) => attempt.attempted);
      const hadAvailableProvider = attempts.some((attempt) => attempt.ready);
      const hadError = attempts.some((attempt) => attempt.status === 'error');
      const hadMiss = attempts.some((attempt) => attempt.status === 'miss');
      const firstReject = attempts.find((attempt) => attempt.status === 'reject');
      const firstError = attempts.find((attempt) => attempt.status === 'error');
      providerRejectReason =
        firstReject?.result?.detection.rejectionReason ??
        firstError?.errorMessage ??
        'none';

      if (!hadAvailableProvider && !hadAttempt) {
        cvFallbackReason = 'ml_unavailable';
      } else if (hadReject) {
        cvFallbackReason = 'ml_reject';
      } else if (hadError && !hadMiss) {
        cvFallbackReason = 'ml_unavailable';
      } else {
        cvFallbackReason = 'ml_miss';
      }

      await ensureOpenCvForMlFallback();
      cvAttempted = true;
      const cvResult = engine.processFrame({
        rgba,
        width,
        height,
        nowMs,
      });
      if (isCvDetectionFound(cvResult)) {
        providerUsed =
          cvResult.detection.bestCandidate?.source === 'hough'
            ? 'cv_hough'
            : cvResult.detection.bestCandidate?.source === 'contour'
              ? 'cv_contour'
              : undefined;
      }
      finalResult = patchFallbackState(cvResult, 'active');
    }
  } else {
    if (detectorConfig.detectorMode === 'ml') {
      cvFallbackReason = 'ml_unavailable';
      fallbackTelemetryState = 'inactive';
      await ensureOpenCvForMlFallback();
    }
    cvAttempted = true;
    const cvResult = engine.processFrame({
      rgba,
      width,
      height,
      nowMs,
    });
    finalResult =
      detectorConfig.detectorMode === 'ml'
        ? patchFallbackState(cvResult, 'inactive')
        : await applyDetectorMode(cvResult, rgba, width, height, nowMs);
    if (detectorConfig.detectorMode !== 'ml' && isCvDetectionFound(finalResult)) {
      providerUsed =
        finalResult.detection.bestCandidate?.source === 'hough'
          ? 'cv_hough'
          : finalResult.detection.bestCandidate?.source === 'contour'
            ? 'cv_contour'
            : undefined;
    }
  }

  if (!providerUsed && finalResult.detection.source === 'cv' && isCvDetectionFound(finalResult)) {
    providerUsed =
      finalResult.detection.bestCandidate?.source === 'hough'
        ? 'cv_hough'
        : finalResult.detection.bestCandidate?.source === 'contour'
          ? 'cv_contour'
          : undefined;
  }

  post({
    type: 'frame-result',
    id,
    result: finalResult,
    telemetry: {
      detectorSource: finalResult.detection.source,
      fallbackState: fallbackTelemetryState,
      mlReady,
      mlDisabled,
      mlModelLoaded,
      mlInferenceUsed,
      mlRescueUsed,
      graphAttempted,
      cocoAttempted,
      cocoReady,
      cocoUsed,
      providerUsed,
      providerRejectReason,
      cvAttempted,
      cvFallbackReason,
    },
  });
}

async function handleMessage(msg: WorkerRequest): Promise<void> {
  try {
    switch (msg.type) {
      case 'init': {
        const debug = Boolean(msg.config?.debug || msg.detectorConfig?.debug);
        configuredOpenCvScriptUrl = msg.opencvScriptUrl ?? '/opencv.js';
        mergeDetectorConfig({ ...defaultDetectorConfig, ...msg.detectorConfig });
        if (detectorConfig.detectorMode === 'ml') {
          if (debug) {
            console.warn('[document-autocapture:worker] OpenCV lazy-load enabled for ML mode (loads on first CV fallback)');
          }
        } else {
          await ensureOpenCv(configuredOpenCvScriptUrl, debug);
        }
        if (debug) {
          console.warn(
            `[document-autocapture:worker] init config | ` +
              `detectorMode=${detectorConfig.detectorMode} | ` +
              `mlPipeline=${detectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
              `mlModelId=${detectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
              `mlInputSize=${detectorConfig.mlInputSize ?? 320} | ` +
              `graphMl=${detectorConfig.graphMlEnabled ? 'on' : 'off'} | ` +
              `cocoBook=${detectorConfig.cocoBookEnabled ? 'on' : 'off'} ` +
              `(everyFrame=on, minScore=${detectorConfig.cocoMinScore.toFixed(2)}, primary=${detectorConfig.cocoUseAsPrimaryInMlMode ? 'on' : 'off'}) | ` +
              `mlRescue=${detectorConfig.mlRescueEnabled ? 'on' : 'off'} ` +
              `(stride=${detectorConfig.mlRescueFrameStride}) | ` +
              `mlFallback=${detectorConfig.mlFallbackEnabled ? 'on' : 'off'} ` +
              `(stride=${detectorConfig.mlFallbackFrameStride}, misses=${detectorConfig.mlFallbackTriggerConsecutiveMisses}, minCv=${detectorConfig.mlFallbackMinCvConfidence})`,
          );
        }
        engine = createEngine(msg.config);
        mlStabilityByProvider = createMlStabilityTrackers();
        resetFallbackState();
        mlDisabled = false;
        mlReady = false;
        mlModelLoaded = false;
        cocoReady = false;
        mlInitTask = undefined;
        cocoInitTask = undefined;
        mlWarned = false;
        mlHeuristicWarned = false;
        cocoWarned = false;
        mlRescueDisabledWarned = false;
        mlRescueUnavailableWarned = false;
        openCvWarned = false;
        openCvRetryAfterMs = 0;
        cocoRetryAfterMs = 0;
        mlRetryAfterMs = 0;

        post({ type: 'ready' });
        return;
      }
      case 'update-config': {
        mergeDetectorConfig(msg.detectorConfig);
        if (msg.detectorConfig?.detectorMode && detectorConfig.detectorMode !== 'ml') {
          await ensureOpenCv(configuredOpenCvScriptUrl, Boolean(detectorConfig.debug));
        }
        engine = createEngine({
          ...engine.config,
          ...msg.config,
          scoreWeights: {
            ...engine.config.scoreWeights,
            ...(msg.config.scoreWeights ?? {}),
          },
        });
        mlStabilityByProvider = createMlStabilityTrackers();
        if (
          msg.detectorConfig?.mlModelId ||
          msg.detectorConfig?.mlModelUrl ||
          msg.detectorConfig?.mlModelBaseUrl ||
          msg.detectorConfig?.mlInputSize ||
          msg.detectorConfig?.mlWasmBaseUrl ||
          msg.detectorConfig?.mlPipelineVersion
        ) {
          mlDisabled = false;
          mlReady = false;
          mlModelLoaded = false;
          cocoReady = false;
          cocoRetryAfterMs = 0;
          mlRescueBuffer = undefined;
          mlRescueCounter = 0;
          mlInitTask = undefined;
          cocoInitTask = undefined;
          mlHeuristicWarned = false;
          mlRescueUnavailableWarned = false;
          cocoWarned = false;
          mlWarned = false;
          mlRetryAfterMs = 0;
          if (detectorConfig.debug) {
            console.warn(
              `[document-autocapture:worker] ML provider reset after config update | ` +
                `mlPipeline=${detectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
                `mlModelId=${detectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
                `mlInputSize=${detectorConfig.mlInputSize ?? 320} | ` +
                `graphMl=${detectorConfig.graphMlEnabled ? 'on' : 'off'} | ` +
                `cocoBook=${detectorConfig.cocoBookEnabled ? 'on' : 'off'} ` +
                `(everyFrame=on, minScore=${detectorConfig.cocoMinScore.toFixed(2)})`,
            );
          }
        }
        if (msg.detectorConfig?.mlRescueEnabled !== undefined) {
          mlRescueDisabledWarned = false;
        }
        if (msg.detectorConfig?.cocoBookEnabled !== undefined) {
          cocoRetryAfterMs = 0;
          if (!msg.detectorConfig.cocoBookEnabled) {
            cocoReady = false;
          }
        }
        return;
      }
      case 'reset-stability': {
        engine.resetStability();
        resetMlStabilityTrackers(mlStabilityByProvider);
        return;
      }
      case 'process-frame': {
        const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
        await processFrame(msg.id, rgba, msg.width, msg.height, msg.nowMs);
        return;
      }
      case 'process-image-bitmap': {
        const width = msg.bitmap.width;
        const height = msg.bitmap.height;
        try {
          const ctx = ensureIngestCanvas(width, height);
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(msg.bitmap, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          await processFrame(msg.id, imageData.data, width, height, msg.nowMs);
        } finally {
          msg.bitmap.close();
        }
        return;
      }
      default: {
        const unknown: never = msg;
        post({
          type: 'error',
          message: `Unknown worker message: ${JSON.stringify(unknown)}`,
        });
      }
    }
  } catch (error) {
    post({
      type: 'error',
      id: 'id' in msg ? msg.id : undefined,
      message: error instanceof Error ? error.message : 'Unknown worker error',
    });
  }
}

let messageQueue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  messageQueue = messageQueue
    .then(() => handleMessage(request))
    .catch((error) => {
      post({
        type: 'error',
        id: 'id' in request ? request.id : undefined,
        message:
          error instanceof Error
            ? error.message
            : 'Worker message queue failed',
      });
    });
};
