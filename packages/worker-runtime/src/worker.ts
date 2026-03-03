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
let mlReady = false;
let mlDisabled = false;
let mlModelLoaded = false;
let mlInitTask: Promise<void> | undefined;
let mlWarned = false;
let mlHeuristicWarned = false;
let openCvWarned = false;
let mlStability = new StabilityTracker(engine.config);
let mlGrayBuffer: Uint8ClampedArray | undefined;
let mlInferenceUsed = false;
let mlRescueUsed = false;
let cvAttempted = false;
let cvFallbackReason: CvFallbackReason = 'none';
let mlRescueBuffer: Uint8ClampedArray | undefined;
let mlRescueCounter = 0;
let mlRescueDisabledWarned = false;
let mlRescueUnavailableWarned = false;

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
  mlStability.reset();
  fallbackTelemetryState = 'inactive';
  cvAttempted = false;
  cvFallbackReason = 'none';
  mlInferenceUsed = false;
  mlRescueUsed = false;
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
    })();
  }

  try {
    await mlInitTask;
  } catch (error) {
    mlReady = false;
    mlDisabled = true;
    mlModelLoaded = false;
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

async function tryMlRescueInference(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  reason: 'miss' | 'reject',
): Promise<Awaited<ReturnType<MlQuadProvider['infer']>> | undefined> {
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
  baseTimings?: Parameters<typeof createMlStageTimings>[1],
): FrameProcessResult {
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
    stabilityTracker: mlStability,
    grayBuffer: mlGrayBuffer,
    baseTimings,
    debugEnabled: Boolean(detectorConfig.debug),
  });
  mlGrayBuffer = fused.grayBuffer;
  return fused.result;
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
    mlStability.reset();
  }

  if (!currentState.active) {
    return patchFallbackState(cvResult, currentState.state);
  }

  await ensureMlProvider();
  if (!mlReady || !mlProvider) {
    cvFallbackReason = 'ml_unavailable';
    return patchFallbackState(cvResult, currentState.state);
  }

  const stride = Math.max(1, detectorConfig.mlFallbackFrameStride);
  if (detectorConfig.detectorMode === 'hybrid' && currentState.activeFrameCounter % stride !== 0) {
    return patchFallbackState(cvResult, 'active');
  }

  const mlStart = now();
  mlInferenceUsed = true;
  const mlPrediction = await mlProvider.infer({
    rgba,
    width,
    height,
  });
  const mlElapsedMs = now() - mlStart;

  if (!mlPrediction) {
    cvFallbackReason = 'ml_miss';
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
    cvResult.detection.timings,
  );

  if (!isCvDetectionFound(cvResult) || mlResult.detection.status === 'found') {
    return mlResult;
  }
  cvFallbackReason = 'ml_reject';
  return patchFallbackState(cvResult, 'active');
}

async function processFrame(
  id: number,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  nowMs: number,
): Promise<void> {
  mlInferenceUsed = false;
  mlRescueUsed = false;
  cvAttempted = false;
  cvFallbackReason = 'none';
  let finalResult: FrameProcessResult;

  if (detectorConfig.detectorMode === 'ml' && !mlDisabled) {
    await ensureMlProvider();
    if (mlReady && mlProvider) {
      fallbackTelemetryState = 'active';
      const mlStart = now();
      mlInferenceUsed = true;
      const mlPrediction = await mlProvider.infer({
        rgba,
        width,
        height,
      });
      const mlElapsedMs = now() - mlStart;

      if (!mlPrediction) {
        const rescuePrediction = await tryMlRescueInference(rgba, width, height, 'miss');
        if (rescuePrediction) {
          finalResult = fuseMlResult(
            rescuePrediction.quad,
            rescuePrediction.confidence,
            rgba,
            width,
            height,
            nowMs,
            mlElapsedMs,
          );
        } else {
          cvFallbackReason = 'ml_miss';
          await ensureOpenCvForMlFallback();
          cvAttempted = true;
          const cvResult = engine.processFrame({
            rgba,
            width,
            height,
            nowMs,
          });
          finalResult = patchFallbackState(cvResult, 'active');
        }
      } else {
        const mlResult = fuseMlResult(
          mlPrediction.quad,
          mlPrediction.confidence,
          rgba,
          width,
          height,
          nowMs,
          mlElapsedMs,
        );
        if (mlResult.detection.status === 'found') {
          mlRescueCounter = 0;
          finalResult = mlResult;
        } else {
          const rescuePrediction = await tryMlRescueInference(rgba, width, height, 'reject');
          if (rescuePrediction) {
            const rescueResult = fuseMlResult(
              rescuePrediction.quad,
              rescuePrediction.confidence,
              rgba,
              width,
              height,
              nowMs,
              mlElapsedMs,
            );
            if (rescueResult.detection.status === 'found') {
              mlRescueCounter = 0;
              finalResult = rescueResult;
            } else {
              cvFallbackReason = 'ml_reject';
              await ensureOpenCvForMlFallback();
              cvAttempted = true;
              const cvResult = engine.processFrame({
                rgba,
                width,
                height,
                nowMs,
              });
              finalResult = isCvDetectionFound(cvResult) ? patchFallbackState(cvResult, 'active') : mlResult;
            }
          } else {
            cvFallbackReason = 'ml_reject';
            await ensureOpenCvForMlFallback();
            cvAttempted = true;
            const cvResult = engine.processFrame({
              rgba,
              width,
              height,
              nowMs,
            });
            finalResult = isCvDetectionFound(cvResult) ? patchFallbackState(cvResult, 'active') : mlResult;
          }
        }
      }
    } else {
      cvFallbackReason = 'ml_unavailable';
      fallbackTelemetryState = 'inactive';
      await ensureOpenCvForMlFallback();
      cvAttempted = true;
      const cvResult = engine.processFrame({
        rgba,
        width,
        height,
        nowMs,
      });
      finalResult = patchFallbackState(cvResult, 'inactive');
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
              `mlRescue=${detectorConfig.mlRescueEnabled ? 'on' : 'off'} ` +
              `(stride=${detectorConfig.mlRescueFrameStride}) | ` +
              `mlFallback=${detectorConfig.mlFallbackEnabled ? 'on' : 'off'} ` +
              `(stride=${detectorConfig.mlFallbackFrameStride}, misses=${detectorConfig.mlFallbackTriggerConsecutiveMisses}, minCv=${detectorConfig.mlFallbackMinCvConfidence})`,
          );
        }
        engine = createEngine(msg.config);
        mlStability = new StabilityTracker(engine.config);
        resetFallbackState();
        mlDisabled = false;
        mlReady = false;
        mlModelLoaded = false;
        mlInitTask = undefined;
        mlWarned = false;
        mlHeuristicWarned = false;
        mlRescueDisabledWarned = false;
        mlRescueUnavailableWarned = false;
        openCvWarned = false;
        openCvRetryAfterMs = 0;

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
        mlStability = new StabilityTracker(engine.config);
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
          mlRescueBuffer = undefined;
          mlRescueCounter = 0;
          mlInitTask = undefined;
          mlHeuristicWarned = false;
          mlRescueUnavailableWarned = false;
          if (detectorConfig.debug) {
            console.warn(
              `[document-autocapture:worker] ML provider reset after config update | ` +
                `mlPipeline=${detectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
                `mlModelId=${detectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
                `mlInputSize=${detectorConfig.mlInputSize ?? 320}`,
            );
          }
        }
        if (msg.detectorConfig?.mlRescueEnabled !== undefined) {
          mlRescueDisabledWarned = false;
        }
        return;
      }
      case 'reset-stability': {
        engine.resetStability();
        mlStability.reset();
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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handleMessage(event.data);
};
