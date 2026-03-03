import {
  createEngine,
  defaultEngineConfig,
  mergeEngineConfig,
  type DetectionResult,
  type DetectorSource,
  type EngineConfig,
  type ExecutionMode,
  type FrameProcessResult,
  type GuidanceCode,
  type Quad,
  quadAspectRatio,
} from '@docuscan/core-engine';
import { warpPerspectiveCpu } from '@docuscan/warp-cpu';
import { warpPerspectiveWebGL } from '@docuscan/warp-webgl';
import {
  createDocuscanWorker,
  type WorkerDetectorConfig,
  type WorkerRequest,
  type WorkerResponse,
} from '@docuscan/worker-runtime';
import { detectCapabilities, selectExecutionMode } from './capabilities';
import { sanitizeQuadForCapture, scaleQuadToCapture } from './capture-quad';
import { TypedEmitter } from './emitter';
import { refineQuadPostCapture } from './post-refine';
import { assessWarpOutput } from './warp-validation';
import type {
  Capabilities,
  CaptureResult,
  DetectorMode,
  ScannerConfig,
  ScannerEventMap,
  ScannerEventName,
  ScannerSession,
  WarpTierUsed,
} from './types';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const ENGINE_CONFIG_KEYS: Array<keyof EngineConfig> = Object.keys(defaultEngineConfig) as Array<
  keyof EngineConfig
>;

function toEngineConfig(config: Partial<ScannerConfig>): Partial<EngineConfig> {
  const engineConfig: Partial<EngineConfig> = {};
  for (const key of ENGINE_CONFIG_KEYS) {
    if (config[key] !== undefined) {
      engineConfig[key] = config[key] as never;
    }
  }
  return engineConfig;
}

function normalizeDetectorMode(value: unknown): DetectorMode {
  if (value === 'cv' || value === 'hybrid' || value === 'ml') {
    return value;
  }
  return 'hybrid';
}

function defaultOpenCvScriptUrl(): string {
  if (typeof window === 'undefined') {
    return '/opencv.js';
  }
  try {
    return new URL('opencv.js', window.location.href).toString();
  } catch {
    return '/opencv.js';
  }
}

function toWorkerDetectorConfig(config: ScannerConfig): WorkerDetectorConfig {
  const pipelineVersion = config.mlPipelineVersion ?? 'v1-heuristic';
  const resolvedModelId =
    pipelineVersion === 'v2-graph'
      ? config.mlModelId && config.mlModelId !== 'doc-corner-v1'
        ? config.mlModelId
        : 'doc-corner-v2'
      : config.mlModelId ?? 'doc-corner-v1';
  return {
    detectorMode: normalizeDetectorMode(config.detectorMode),
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

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to Blob'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

class StartAbortedError extends Error {
  constructor() {
    super('Scanner start aborted');
    this.name = 'StartAbortedError';
  }
}

class ScannerSessionImpl implements ScannerSession {
  private config: ScannerConfig;

  private engineConfig: EngineConfig;

  private capabilities: Capabilities = {
    workerSupported: false,
    offscreenCanvasSupported: false,
    offscreenTransferSupported: false,
    webglMainSupported: false,
    webglWorkerSupported: false,
    requestVideoFrameCallbackSupported: false,
    crossOriginIsolated: false,
    selectedMode: 'fallback',
  };

  private executionMode: ExecutionMode = 'fallback';

  private video?: HTMLVideoElement;

  private stream?: MediaStream;

  private running = false;

  private frameBusy = false;

  private frameId = 0;

  private pendingFrames = new Map<
    number,
    { resolve: (result: FrameProcessResult) => void; reject: (error: Error) => void }
  >();

  private worker?: Worker;

  private workerReady = false;

  private startTask?: Promise<void>;

  private fallbackEngine = createEngine(defaultEngineConfig);

  private latestResult?: FrameProcessResult;

  private lastDetectionFrameWidth = 0;

  private lastDetectionFrameHeight = 0;

  private lastCaptureAt = 0;

  private autoCaptureStableStreak = 0;

  private debugFrameCount = 0;

  private lastWorkerTelemetry?: Extract<WorkerResponse, { type: 'frame-result' }>['telemetry'];

  private lastWarpRejectedReason?: string;

  private mlGraphUnavailableWarned = false;
  private autoCaptureCpuWarpWarned = false;

  private ingestionCanvas?: HTMLCanvasElement;

  private ingestionCtx?: CanvasRenderingContext2D;

  private bestIngestionCanvas?: OffscreenCanvas;

  private bestIngestionCtx?: OffscreenCanvasRenderingContext2D | null;

  private rafHandle = 0;

  private rvfcHandle = 0;

  private timeoutHandle = 0;

  private readonly emitter = new TypedEmitter<ScannerEventMap>();

  private lifecycleToken = 0;

  private assertLifecycleToken(token: number): void {
    if (token !== this.lifecycleToken) {
      throw new StartAbortedError();
    }
  }

  constructor(config?: ScannerConfig) {
    const userProvidedModelId = config?.mlModelId !== undefined;
    this.config = {
      preferredMode: 'best',
      autoCapture: true,
      autoCaptureMinAreaFraction: 0.14,
      autoCaptureCooldownMs: 1400,
      captureMimeType: 'image/png',
      captureQuality: 1,
      detectorMode: 'ml',
      debugOverlayLevel: 'full',
      autoCaptureConsecutiveStableFrames: 3,
      detectionWidth: 480,
      fallbackDetectionWidth: 320,
      fallbackFps: 9,
      confidenceThreshold: 0.42,
      minStableConfidence: 0.36,
      stabilityWindowMs: 320,
      emaAlpha: 0.25,
      movementThresholdRatio: 0.015,
      minAreaFraction: 0.08,
      maxAreaFraction: 0.96,
      minAspectRatio: 0.6,
      maxAspectRatio: 1.9,
      ambiguityScoreMargin: 0.04,
      edgeLowThreshold: 50,
      edgeHighThreshold: 150,
      blurVarianceMin: 24,
      brightnessMin: 45,
      brightnessMax: 215,
      glareRatioMax: 0.12,
      houghSecondaryEnabled: true,
      houghEdgeDensityMin: 0.005,
      houghEdgeDensityMax: 0.25,
      houghMinLineLengthDiagRatio: 0.12,
      houghMaxLineGapDiagRatio: 0.02,
      houghOrthogonalityMinDeg: 60,
      houghOrthogonalityMaxDeg: 120,
      mlFallbackEnabled: true,
      mlFallbackFrameStride: 5,
      mlFallbackTriggerConsecutiveMisses: 8,
      mlFallbackMinCvConfidence: 0.35,
      mlRescueEnabled: true,
      mlRescueFrameStride: 2,
      mlFallbackExitConsecutiveCvRecoveries: 3,
      mlFallbackReentryCooldownFrames: 10,
      mlPipelineVersion: 'v1-heuristic',
      mlModelId: 'doc-corner-v1',
      mlInputSize: 320,
      warpValidationLevel: 'standard',
      postCaptureRefine: 'off',
      opencvScriptUrl: defaultOpenCvScriptUrl(),
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      debug: false,
      ...config,
    };
    if (!userProvidedModelId) {
      this.config.mlModelId =
        this.config.mlPipelineVersion === 'v2-graph' ? 'doc-corner-v2' : 'doc-corner-v1';
    }
    this.config.detectorMode = normalizeDetectorMode(this.config.detectorMode);

    this.engineConfig = mergeEngineConfig(toEngineConfig(this.config));
    this.fallbackEngine = createEngine(this.engineConfig);
  }

  getCapabilities(): Capabilities {
    return this.capabilities;
  }

  on<K extends ScannerEventName>(event: K, handler: (payload: ScannerEventMap[K]) => void): () => void {
    return this.emitter.on(event, handler);
  }

  updateConfig(partial: Partial<ScannerConfig>): void {
    const mergedScoreWeights = {
      ...defaultEngineConfig.scoreWeights,
      ...(this.config.scoreWeights ?? {}),
      ...(partial.scoreWeights ?? {}),
    };

    this.config = {
      ...this.config,
      ...partial,
      detectorMode: normalizeDetectorMode(partial.detectorMode ?? this.config.detectorMode),
      scoreWeights: mergedScoreWeights,
    };
    if (partial.mlPipelineVersion !== undefined && partial.mlModelId === undefined) {
      this.config.mlModelId =
        partial.mlPipelineVersion === 'v2-graph' ? 'doc-corner-v2' : 'doc-corner-v1';
    }

    this.engineConfig = mergeEngineConfig(toEngineConfig(this.config));
    this.fallbackEngine = createEngine(this.engineConfig);

    if (this.worker) {
      const request: WorkerRequest = {
        type: 'update-config',
        config: this.engineConfig,
        detectorConfig: toWorkerDetectorConfig(this.config),
      };
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.emitter.emit(
          'error',
          error instanceof Error ? error : new Error('Failed to update worker config'),
        );
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (this.startTask) {
      return this.startTask;
    }
    const startToken = ++this.lifecycleToken;

    this.startTask = (async () => {
      try {
        if (
          typeof window !== 'undefined' &&
          !window.isSecureContext &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1'
        ) {
          throw new Error(
            'Camera access requires a secure context (HTTPS). Open this app via HTTPS or localhost.',
          );
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API unavailable in this browser/environment.');
        }

        const detected = await detectCapabilities();
        this.assertLifecycleToken(startToken);
        this.executionMode = this.resolveMode(detected);
        this.capabilities = {
          ...detected,
          selectedMode: this.executionMode,
        };
        if (this.config.debug) {
          console.warn('[docuscan] capabilities', this.capabilities);
        }
        this.emitter.emit('capabilities', this.capabilities);

        this.video = this.config.videoElement ?? document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.autoplay = true;

        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            ...(this.config.videoConstraints ?? {}),
          },
          audio: false,
        });
        this.assertLifecycleToken(startToken);

        this.video.srcObject = this.stream;
        await this.ensureVideoPlayback(this.video);
        this.assertLifecycleToken(startToken);

        this.ingestionCanvas = document.createElement('canvas');
        const ingestionCtx = this.ingestionCanvas.getContext('2d', {
          willReadFrequently: true,
        });
        if (!ingestionCtx) {
          throw new Error('Could not create ingestion canvas context');
        }
        this.ingestionCtx = ingestionCtx;

        if (this.executionMode !== 'fallback' && this.capabilities.workerSupported) {
          const workerDetectorConfig = toWorkerDetectorConfig(this.config);
          this.worker = (this.config.workerFactory ?? createDocuscanWorker)();
          this.workerReady = false;
          this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            this.onWorkerMessage(event.data);
          };
          this.worker.onerror = (event) => {
            this.downgradeToFallback(event.message || 'Worker failed to load');
          };
          try {
            this.worker.postMessage({
              type: 'init',
              config: this.engineConfig,
              detectorConfig: workerDetectorConfig,
              opencvScriptUrl: this.config.opencvScriptUrl,
            } satisfies WorkerRequest);
          } catch (error) {
            this.downgradeToFallback(
              error instanceof Error ? error.message : 'Worker init postMessage failed',
            );
          }
        }

        this.assertLifecycleToken(startToken);
        this.running = true;
        this.debugFrameCount = 0;
        this.mlGraphUnavailableWarned = false;
        if (this.config.debug) {
          const workerDetectorConfig = toWorkerDetectorConfig(this.config);
          console.warn(
            `[docuscan] Scanner started | mode=${this.executionMode} | ` +
              `detectorMode=${this.config.detectorMode} | autoCapture=${this.config.autoCapture} | ` +
              `detectionWidth=${this.config.detectionWidth ?? 480} | ` +
              `video=${this.video.videoWidth}x${this.video.videoHeight} | ` +
              `confidenceThreshold=${this.engineConfig.confidenceThreshold} | ` +
              `blurVarianceMin=${this.engineConfig.blurVarianceMin} | ` +
              `workerHardCeilingMs=${this.engineConfig.workerHardCeilingMs} | ` +
              `mlPipeline=${workerDetectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
              `mlModelId=${workerDetectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
              `mlInputSize=${workerDetectorConfig.mlInputSize ?? this.config.mlInputSize ?? 'auto'} | ` +
              `warpValidation=${this.config.warpValidationLevel ?? 'standard'} | ` +
              `postRefine=${this.config.postCaptureRefine ?? 'off'} | ` +
              `captureMime=${this.config.captureMimeType ?? 'image/png'} | ` +
              `mlFallback=${workerDetectorConfig.mlFallbackEnabled ? 'on' : 'off'} ` +
              `(stride=${workerDetectorConfig.mlFallbackFrameStride}, misses=${workerDetectorConfig.mlFallbackTriggerConsecutiveMisses}, minCv=${workerDetectorConfig.mlFallbackMinCvConfidence}) | ` +
              `mlRescue=${workerDetectorConfig.mlRescueEnabled ? 'on' : 'off'} ` +
              `(stride=${workerDetectorConfig.mlRescueFrameStride})`,
          );
        }
        this.scheduleNextFrame();
      } catch (error) {
        this.running = false;
        if (this.worker) {
          this.worker.terminate();
          this.worker = undefined;
        }
        this.workerReady = false;
        if (!(error instanceof StartAbortedError)) {
          this.rejectPendingFrames(error instanceof Error ? error : new Error('Scanner start failed'));
        }
        this.cleanupVideoStream();
        if (!(error instanceof StartAbortedError)) {
          throw error;
        }
      }
    })();

    try {
      await this.startTask;
    } finally {
      this.startTask = undefined;
    }
  }

  async stop(): Promise<void> {
    this.lifecycleToken += 1;
    this.running = false;
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    if (this.rvfcHandle && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
      this.rvfcHandle = 0;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = 0;
    }

    this.rejectPendingFrames(new Error('Scanner stopped'));
    this.bestIngestionCanvas = undefined;
    this.bestIngestionCtx = null;
    this.workerReady = false;
    this.lastWorkerTelemetry = undefined;
    this.autoCaptureStableStreak = 0;

    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
    this.cleanupVideoStream();
    this.ingestionCanvas = undefined;
    this.ingestionCtx = undefined;
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.emitter.clear();
  }

  async captureManual(): Promise<CaptureResult> {
    if (!this.video) {
      throw new Error('Scanner is not started');
    }
    const capture = await this.captureWithWarp('manual');
    this.emitter.emit('capture', capture);
    return capture;
  }

  private resolveMode(capabilities: Capabilities): ExecutionMode {
    const autoMode = selectExecutionMode(capabilities);
    if (!this.config.preferredMode) {
      return autoMode;
    }

    const preferred = this.config.preferredMode;
    const compatible =
      (preferred === 'best' && autoMode === 'best') ||
      (preferred === 'standard' && (autoMode === 'best' || autoMode === 'standard')) ||
      preferred === 'fallback';

    if (!compatible) {
      this.emitter.emit(
        'warning',
        `Preferred mode '${preferred}' unavailable, falling back to '${autoMode}'`,
      );
      return autoMode;
    }

    return preferred;
  }

  private createBlankFrame(width: number, height: number): FrameProcessResult {
    return this.fallbackEngine.processFrame({
      rgba: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      nowMs: now(),
    });
  }

  private fallbackProcessFromCurrentVideo(width: number, height: number): FrameProcessResult {
    if (!this.video || !this.ingestionCanvas || !this.ingestionCtx) {
      return this.createBlankFrame(width, height);
    }
    this.ingestionCanvas.width = width;
    this.ingestionCanvas.height = height;
    this.ingestionCtx.drawImage(this.video, 0, 0, width, height);
    const imageData = this.ingestionCtx.getImageData(0, 0, width, height);
    return this.fallbackEngine.processFrame({
      rgba: imageData.data,
      width,
      height,
      nowMs: now(),
    });
  }

  private rejectPendingFrames(error: Error): void {
    for (const [id, pending] of this.pendingFrames.entries()) {
      this.pendingFrames.delete(id);
      pending.reject(error);
    }
    this.frameBusy = false;
  }

  private async ensureVideoPlayback(video: HTMLVideoElement): Promise<void> {
    const attemptPlay = async (): Promise<boolean> => {
      try {
        await video.play();
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return false;
        }
        throw error;
      }
    };

    if (await attemptPlay()) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('error', onError);
      };
      const onLoadedData = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error('Video failed to load camera stream'));
      };
      video.addEventListener('loadeddata', onLoadedData, { once: true });
      video.addEventListener('error', onError, { once: true });
      window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      }, 1500);
    });

    await video.play();
  }

  private async ensureVideoFrameReady(video: HTMLVideoElement): Promise<void> {
    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('error', onError);
      };
      const onLoadedData = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error('Video frame unavailable for capture'));
      };
      video.addEventListener('loadeddata', onLoadedData, { once: true });
      video.addEventListener('error', onError, { once: true });
      window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      }, 1000);
    });
  }

  private cleanupVideoStream(): void {
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = undefined;
    }
  }

  private scheduleNextFrame(): void {
    if (!this.running || !this.video) {
      return;
    }

    if (this.executionMode === 'fallback') {
      const interval = Math.max(
        80,
        Math.round(1000 / (this.config.fallbackFps ?? defaultEngineConfig.fallbackFps)),
      );
      this.timeoutHandle = window.setTimeout(() => {
        void this.processFrame().finally(() => this.scheduleNextFrame());
      }, interval);
      return;
    }

    if (this.capabilities.requestVideoFrameCallbackSupported && this.video.requestVideoFrameCallback) {
      this.rvfcHandle = this.video.requestVideoFrameCallback(() => {
        void this.processFrame().finally(() => this.scheduleNextFrame());
      });
      return;
    }

    this.rafHandle = requestAnimationFrame(() => {
      void this.processFrame().finally(() => this.scheduleNextFrame());
    });
  }

  private async processFrame(): Promise<void> {
    if (!this.video || !this.ingestionCanvas || !this.ingestionCtx) {
      return;
    }

    if (this.frameBusy && this.executionMode !== 'fallback') {
      return;
    }

    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      return;
    }

    try {
      const requestedWidth = Number(this.config.detectionWidth ?? defaultEngineConfig.detectionWidth);
      const targetWidth = Math.max(240, Math.min(960, Number.isFinite(requestedWidth) ? Math.round(requestedWidth) : 480));
      const targetHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * targetWidth));
      this.lastDetectionFrameWidth = targetWidth;
      this.lastDetectionFrameHeight = targetHeight;

      const cvResult = await this.processCvFrame(targetWidth, targetHeight);
      this.onFrameResult(cvResult);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Frame processing failed');
      if (this.config.debug) {
        console.warn('[docuscan] processFrame error:', err.message);
      }
      this.emitter.emit('error', err);
    }
  }

  private async processCvFrame(targetWidth: number, targetHeight: number): Promise<FrameProcessResult> {
    if (!this.video || !this.ingestionCanvas || !this.ingestionCtx) {
      this.lastWorkerTelemetry = undefined;
      return this.createBlankFrame(targetWidth, targetHeight);
    }

    if (this.executionMode !== 'fallback' && this.worker && !this.workerReady) {
      this.lastWorkerTelemetry = undefined;
      return this.createBlankFrame(targetWidth, targetHeight);
    }

    if (this.executionMode === 'fallback' || !this.worker) {
      this.lastWorkerTelemetry = undefined;
      return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
    }

    const id = ++this.frameId;
    this.frameBusy = true;

    const promise = new Promise<FrameProcessResult>((resolve, reject) => {
      this.pendingFrames.set(id, { resolve, reject });
    });

    if (this.executionMode === 'best' && this.prepareBestIngestionCanvas(targetWidth, targetHeight)) {
      this.bestIngestionCtx?.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const bitmap = this.bestIngestionCanvas?.transferToImageBitmap();
      if (bitmap) {
        try {
          this.worker.postMessage(
            {
              type: 'process-image-bitmap',
              id,
              nowMs: now(),
              bitmap,
            } satisfies WorkerRequest,
            [bitmap],
          );
        } catch (error) {
          bitmap.close();
          this.frameBusy = false;
          this.pendingFrames.delete(id);
          this.emitter.emit(
            'error',
            error instanceof Error ? error : new Error('Best mode worker postMessage failed'),
          );
          return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
        }
      } else {
        this.frameBusy = false;
        this.pendingFrames.delete(id);
        this.emitter.emit('error', new Error('Best mode bitmap transfer failed'));
        return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
      }
    } else {
      this.ingestionCanvas.width = targetWidth;
      this.ingestionCanvas.height = targetHeight;
      this.ingestionCtx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const imageData = this.ingestionCtx.getImageData(0, 0, targetWidth, targetHeight);

      try {
        this.worker.postMessage(
          {
            type: 'process-frame',
            id,
            width: targetWidth,
            height: targetHeight,
            nowMs: now(),
            rgbaBuffer: imageData.data.buffer,
          } satisfies WorkerRequest,
          [imageData.data.buffer],
        );
      } catch (error) {
        this.frameBusy = false;
        this.pendingFrames.delete(id);
        this.emitter.emit(
          'error',
          error instanceof Error ? error : new Error('Worker frame postMessage failed'),
        );
        return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
      }
    }

    try {
      return await promise;
    } catch (error) {
      this.emitter.emit(
        'error',
        error instanceof Error ? error : new Error('Frame processing failed in worker'),
      );
      return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
    } finally {
      this.frameBusy = false;
    }
  }

  private prepareBestIngestionCanvas(width: number, height: number): boolean {
    if (typeof OffscreenCanvas === 'undefined') {
      return false;
    }

    if (!this.bestIngestionCanvas) {
      this.bestIngestionCanvas = new OffscreenCanvas(width, height);
      this.bestIngestionCtx = this.bestIngestionCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!this.bestIngestionCanvas || !this.bestIngestionCtx) {
      return false;
    }

    if (this.bestIngestionCanvas.width !== width) {
      this.bestIngestionCanvas.width = width;
    }
    if (this.bestIngestionCanvas.height !== height) {
      this.bestIngestionCanvas.height = height;
    }

    return true;
  }

  private onWorkerMessage(message: WorkerResponse): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      return;
    }

    if (message.type === 'warning') {
      this.emitter.emit('warning', message.message);
      return;
    }

    if (message.type === 'error') {
      const error = new Error(message.message);
      if (!this.workerReady) {
        this.downgradeToFallback(error.message);
      } else {
        this.emitter.emit('error', error);
      }
      if (typeof message.id === 'number') {
        const pending = this.pendingFrames.get(message.id);
        if (pending) {
          this.pendingFrames.delete(message.id);
          pending.reject(error);
        }
      } else {
        for (const [id, pending] of this.pendingFrames.entries()) {
          this.pendingFrames.delete(id);
          pending.reject(error);
        }
      }
      this.frameBusy = false;
      return;
    }

    if (message.type === 'frame-result') {
      this.lastWorkerTelemetry = message.telemetry;
      if (
        this.config.debug &&
        this.config.detectorMode === 'ml' &&
        message.telemetry?.mlReady &&
        !message.telemetry.mlModelLoaded &&
        !this.mlGraphUnavailableWarned
      ) {
        this.mlGraphUnavailableWarned = true;
        console.warn(
          '[docuscan] ML graph model is not loaded; detector is running heuristic ML. Set mlPipelineVersion=v2-graph and mlModelId=doc-corner-v2 to force graph loading.',
        );
      }
      if (
        this.config.debug &&
        this.config.detectorMode === 'ml' &&
        message.result.detection.source === 'cv'
      ) {
        const fallbackReason = message.telemetry?.cvFallbackReason ?? 'none';
        const mlRescue =
          (message.telemetry as { mlRescueUsed?: boolean } | undefined)?.mlRescueUsed ?? false;
        console.warn(
          `[docuscan] ML mode fell back to CV (reason=${fallbackReason}) ` +
            `cvAttempted=${message.telemetry?.cvAttempted ?? false} ` +
            `mlReady=${message.telemetry?.mlReady ?? false} ` +
            `mlLoaded=${message.telemetry?.mlModelLoaded ?? false} ` +
            `mlInfer=${message.telemetry?.mlInferenceUsed ?? false} ` +
            `mlRescue=${mlRescue}`,
        );
      }
      const pending = this.pendingFrames.get(message.id);
      if (pending) {
        this.pendingFrames.delete(message.id);
        pending.resolve(message.result);
      }
    }
  }

  private downgradeToFallback(reason: string): void {
    this.emitter.emit('error', new Error(reason));

    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }

    this.workerReady = false;
    this.rejectPendingFrames(new Error(reason));
    this.executionMode = 'fallback';
    this.capabilities = {
      ...this.capabilities,
      selectedMode: 'fallback',
    };
    this.emitter.emit('capabilities', this.capabilities);
  }

  private onFrameResult(result: FrameProcessResult): void {
    this.latestResult = result;
    this.debugFrameCount += 1;
    this.emitter.emit('frame', result);
    this.emitter.emit('detection', result.detection as DetectionResult);
    if (result.stability) {
      this.emitter.emit('stability', result.stability);
    }
    this.emitter.emit('guidance', result.guidance as GuidanceCode);

    const captureMinAreaFraction = Math.max(
      this.config.minAreaFraction ?? this.engineConfig.minAreaFraction,
      this.config.autoCaptureMinAreaFraction ?? 0.14,
    );
    const captureAreaFraction = result.detection.bestCandidate?.metrics.areaFraction ?? 0;
    const captureAreaReady = captureAreaFraction >= captureMinAreaFraction;
    const captureSource = result.detection.bestCandidate?.source ?? 'contour';
    const captureScore = result.detection.bestCandidate?.score ?? 0;
    const captureCorner = result.detection.bestCandidate?.metrics.cornerAngleCloseness ?? 0;
    const captureBorder = result.detection.bestCandidate?.metrics.borderPenalty ?? 1;
    const captureSourceReady =
      captureSource === 'ml'
        ? captureScore >= 0.45 && captureBorder <= 0.3
        : captureSource === 'hough'
          ? captureScore >= 0.58 && captureCorner >= 0.45 && captureBorder <= 0.24
          : captureScore >= 0.68 &&
            captureCorner >= 0.55 &&
            captureBorder <= 0.2 &&
            captureAreaFraction >= Math.max(captureMinAreaFraction, 0.16);

    const readyForCapture =
      this.config.autoCapture !== false &&
      result.detection.status === 'found' &&
      result.quality?.ok &&
      result.stability?.stable &&
      captureAreaReady &&
      captureSourceReady;

    if (readyForCapture) {
      this.autoCaptureStableStreak += 1;
    } else {
      this.autoCaptureStableStreak = 0;
    }

    if (this.config.debug && this.debugFrameCount % 30 === 0) {
      const det = result.detection;
      const q = result.quality;
      const s = result.stability;
      const best = det.bestCandidate;

      const detStatus = det.status;
      const detScore = best ? (best.score * 100).toFixed(1) + '%' : 'n/a';
      const detConfidence = best ? (best.confidence * 100).toFixed(1) + '%' : 'n/a';
      const detReject = det.rejectionReason ?? 'none';
      const detSource = det.source;
      const detCandidates = det.candidates.length;
      const telemetry = this.lastWorkerTelemetry;
      const cvFallbackReason = telemetry?.cvFallbackReason ?? 'none';
      const cvAttempted = telemetry?.cvAttempted ?? false;
      const mlRescue =
        (telemetry as { mlRescueUsed?: boolean } | undefined)?.mlRescueUsed ?? false;
      const mlTelemetry =
        telemetry
          ? ` cvAttempted=${cvAttempted} cvFallback=${cvFallbackReason} mlReady=${telemetry.mlReady} mlLoaded=${telemetry.mlModelLoaded} mlInfer=${telemetry.mlInferenceUsed} mlRescue=${mlRescue}`
          : '';
      const detTimings = det.timings
        ? `${det.timings.totalMs.toFixed(1)}ms (gray:${det.timings.grayscaleMs.toFixed(0)} blur:${det.timings.blurMs.toFixed(0)} edge:${det.timings.edgesMs.toFixed(0)} cand:${det.timings.candidateMs.toFixed(0)} score:${det.timings.scoringMs.toFixed(0)})`
        : 'n/a';

      const qOk = q ? (q.ok ? '✅' : '❌') : '⏳';
      const qBright = q ? `${q.brightness.ok ? '✅' : '❌'} luma=${q.brightness.averageLuma.toFixed(0)}` : 'n/a';
      const qBlur = q ? `${q.blur.ok ? '✅' : '❌'} var=${q.blur.laplacianVariance.toFixed(1)}` : 'n/a';
      const qGlare = q ? `${q.glare.ok ? '✅' : '❌'} ratio=${(q.glare.highlightRatio * 100).toFixed(1)}%` : 'n/a';
      const qArea = q ? `${q.area.ok ? '✅' : '❌'} frac=${(q.area.areaFraction * 100).toFixed(1)}%` : 'n/a';

      const sStable = s ? (s.stable ? '✅' : '❌') : 'n/a';
      const sMs = s ? `${s.stableMs.toFixed(0)}ms` : 'n/a';
      const sMovement = s ? s.cornerMovement.toFixed(2) : 'n/a';

      let gateBlock = 'READY';
      if (this.config.autoCapture === false) gateBlock = 'autoCapture=OFF';
      else if (det.status !== 'found') gateBlock = `detection=${detStatus} (${detReject})`;
      else if (!q) gateBlock = 'quality=pending';
      else if (!q.ok) {
        if (!q.brightness.ok) gateBlock = `quality:brightness FAIL (luma=${q.brightness.averageLuma.toFixed(0)})`;
        else if (!q.blur.ok) gateBlock = `quality:blur FAIL (var=${q.blur.laplacianVariance.toFixed(1)}, need≥${this.engineConfig.blurVarianceMin})`;
        else if (!q.glare.ok) gateBlock = `quality:glare FAIL (ratio=${(q.glare.highlightRatio * 100).toFixed(1)}%)`;
        else if (!q.area.ok) gateBlock = `quality:area FAIL (frac=${(q.area.areaFraction * 100).toFixed(1)}%)`;
        else gateBlock = 'quality=FAIL';
      } else if (!captureAreaReady) {
        gateBlock =
          `capture:area FAIL (frac=${(captureAreaFraction * 100).toFixed(1)}%, ` +
          `need≥${(captureMinAreaFraction * 100).toFixed(1)}%)`;
      } else if (!captureSourceReady) {
        gateBlock =
          `capture:source FAIL (src=${captureSource}, score=${(captureScore * 100).toFixed(1)}%, ` +
          `corner=${captureCorner.toFixed(2)}, border=${captureBorder.toFixed(2)})`;
      } else if (!s?.stable) gateBlock = `stability (${sMs}, movement=${sMovement})`;

      const requiredFrames = Math.max(1, Math.floor(this.config.autoCaptureConsecutiveStableFrames ?? 3));
      const cooldown = this.config.autoCaptureCooldownMs ?? 1400;
      const cooldownRemaining = Math.max(0, cooldown - (Date.now() - this.lastCaptureAt));

      console.warn(
        `[docuscan] frame#${this.debugFrameCount} | ` +
          `det: ${detStatus} score=${detScore} conf=${detConfidence} reject=${detReject} src=${detSource} cands=${detCandidates}` +
          `${mlTelemetry} | ` +
          `quality: ${qOk} bright=${qBright} blur=${qBlur} glare=${qGlare} area=${qArea} | ` +
          `stable: ${sStable} ${sMs} mvmt=${sMovement} | ` +
          `gate: ${gateBlock} streak=${this.autoCaptureStableStreak}/${requiredFrames} cooldown=${cooldownRemaining}ms | ` +
          `timing: ${detTimings}`,
      );

      if (best) {
        console.warn(
          `[docuscan]   candidate metrics: ` +
            `areaFrac=${(best.metrics.areaFraction * 100).toFixed(1)}% ` +
            `aspect=${best.metrics.aspectPlausibility.toFixed(2)} ` +
            `edgeContrast=${best.metrics.edgeContrast.toFixed(2)} ` +
            `homogeneity=${best.metrics.interiorHomogeneity.toFixed(2)} ` +
            `cornerAngle=${best.metrics.cornerAngleCloseness.toFixed(2)} ` +
            `border=${best.metrics.borderPenalty.toFixed(2)} ` +
            `convexity=${best.convexity.toFixed(2)} ` +
            `edgeStrength=${best.edgeStrength.toFixed(2)} ` +
            `source=${best.source ?? 'contour'}`,
        );
      }
    }

    if (!readyForCapture) {
      return;
    }

    const requiredStableFrames = Math.max(
      1,
      Math.floor(this.config.autoCaptureConsecutiveStableFrames ?? 3),
    );
    if (this.autoCaptureStableStreak < requiredStableFrames) {
      return;
    }

    const cooldown = this.config.autoCaptureCooldownMs ?? 1400;
    const current = Date.now();
    if (current - this.lastCaptureAt < cooldown) {
      return;
    }

    if (this.config.debug) {
      console.warn(
        `[docuscan] Auto-capture triggered | ` +
          `streak=${this.autoCaptureStableStreak} score=${((result.detection.bestCandidate?.score ?? 0) * 100).toFixed(1)}% ` +
          `src=${result.detection.source} guidance=${result.guidance}`,
      );
    }

    this.lastCaptureAt = current;
    this.autoCaptureStableStreak = 0;
    void this.captureWithWarp('auto')
      .then((capture) => {
        if (this.config.debug) {
          console.warn(
            `[docuscan] Capture complete: warp=${capture.warpTierUsed} ` +
              `${capture.warpRejected ? `reject=${capture.warpRejectionReason} ` : ''}` +
              `elapsed=${capture.elapsedMs.toFixed(0)}ms`,
          );
        }
        this.emitter.emit('capture', capture);
      })
      .catch((error) => {
        if (this.config.debug) {
          console.warn(`[docuscan] Capture failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        this.emitter.emit('error', error instanceof Error ? error : new Error('Auto-capture failed'));
      });
  }

  private async captureWithWarp(source: 'manual' | 'auto'): Promise<CaptureResult> {
    if (!this.video) {
      throw new Error('Scanner is not started');
    }
    this.lastWarpRejectedReason = undefined;
    await this.ensureVideoFrameReady(this.video);

    const t0 = now();
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) {
      throw new Error('Video stream not ready');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not create capture context');
    }
    ctx.drawImage(this.video, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const fullFrameQuad: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: width - 1, y: 0 },
      bottomRight: { x: width - 1, y: height - 1 },
      bottomLeft: { x: 0, y: height - 1 },
    };
    const bestCandidate = this.latestResult?.detection.bestCandidate;
    const bestSource = bestCandidate?.source ?? 'contour';
    const bestScore = bestCandidate?.score ?? 0;
    const bestArea = bestCandidate?.metrics.areaFraction ?? 0;
    const bestCorner = bestCandidate?.metrics.cornerAngleCloseness ?? 0;
    const bestBorder = bestCandidate?.metrics.borderPenalty ?? 1;
    const bestAspect = bestCandidate?.quad ? quadAspectRatio(bestCandidate.quad) : 0;
    const stableNow = Boolean(this.latestResult?.stability?.stable);
    const sourceReliableForWarp =
      bestSource === 'ml'
        ? bestScore >= 0.45 && bestArea >= 0.08 && bestBorder <= 0.3
        : bestSource === 'hough'
          ? stableNow &&
            bestScore >= 0.58 &&
            bestArea >= 0.12 &&
            bestCorner >= 0.45 &&
            bestBorder <= 0.24 &&
            bestAspect >= 0.55 &&
            bestAspect <= 1.8
          : stableNow &&
            bestScore >= 0.68 &&
            bestArea >= 0.16 &&
            bestCorner >= 0.55 &&
            bestBorder <= 0.2;
    const hasReliableDetection =
      this.latestResult?.detection.status === 'found' &&
      this.latestResult?.detection.rejectionReason === 'none' &&
      Boolean(bestCandidate) &&
      sourceReliableForWarp;
    const scaledQuad = hasReliableDetection
      ? scaleQuadToCapture(
          bestCandidate?.quad,
          this.lastDetectionFrameWidth,
          this.lastDetectionFrameHeight,
          width,
          height,
        )
      : fullFrameQuad;
    const sourceQuadOriginal = sanitizeQuadForCapture(scaledQuad, width, height);
    let sourceQuad = sourceQuadOriginal;

    const scoreInMediumBand = bestScore >= 0.5 && bestScore <= 0.78;
    const lowCornerConfidence = bestCorner < 0.68;
    const hasMildBorderPenalty = bestBorder > 0.08;
    const borderlineCapture =
      hasReliableDetection &&
      (scoreInMediumBand || lowCornerConfidence || hasMildBorderPenalty || bestSource === 'hough');
    const shouldRunPostRefine = this.config.postCaptureRefine === 'safe' && borderlineCapture;
    let postRefineApplied = false;
    let postRefineReason: string | undefined;
    let refinedQuad: Quad | undefined;
    if (shouldRunPostRefine) {
      const refineResult = refineQuadPostCapture({
        imageData,
        initialQuad: sourceQuadOriginal,
        budgetMs: 120,
        maxIterations: 2,
      });
      postRefineReason = refineResult.reason;
      if (refineResult.applied) {
        sourceQuad = sanitizeQuadForCapture(refineResult.quad, width, height);
        refinedQuad = sourceQuad;
        postRefineApplied = true;
      }

      if (this.config.debug) {
        console.warn(
          `[docuscan] post-refine | applied=${refineResult.applied} reason=${refineResult.reason} ` +
            `initialScore=${refineResult.initialScore.toFixed(2)} refinedScore=${refineResult.refinedScore.toFixed(2)} ` +
            `elapsed=${refineResult.elapsedMs.toFixed(1)}ms`,
        );
      }
    }

    const maxOutputWidth = Math.max(1, Math.min(this.config.outputMaxWidth ?? width, width));
    const maxOutputHeight = Math.max(1, Math.min(this.config.outputMaxHeight ?? height, height));
    const scale = Math.min(maxOutputWidth / width, maxOutputHeight / height, 1);
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const outputPixels = outWidth * outHeight;
    const cpuWarpBudgetMs =
      outputPixels >= 3_000_000 ? 320 : outputPixels >= 2_000_000 ? 260 : 220;

    const isHoughAutoCapture = source === 'auto' && bestSource === 'hough';
    interface WarpAttemptResult {
      tier: WarpTierUsed;
      outputCanvas: HTMLCanvasElement;
      rejectionReason?: string;
      rejectionStage?: 'webgl' | 'cpu';
      webglRecoveredOnCpu: boolean;
    }

    const validateWarpCanvas = (
      candidateCanvas: HTMLCanvasElement,
      candidateTier: 'webgl' | 'cpu',
    ): { accepted: boolean; validation?: ReturnType<typeof assessWarpOutput> } => {
      const candidateCtx = candidateCanvas.getContext('2d', { willReadFrequently: true });
      if (!candidateCtx) {
        return { accepted: false };
      }
      const candidateImageData = candidateCtx.getImageData(0, 0, candidateCanvas.width, candidateCanvas.height);
      const validation = assessWarpOutput({
        warpedImageData: candidateImageData,
        sourceImageData: imageData,
        isHoughAutoCapture,
        level: this.config.warpValidationLevel ?? 'standard',
        warpTier: candidateTier,
      });
      return { accepted: !validation.rejected, validation };
    };

    const attemptWarpForQuad = (candidateQuad: Quad): WarpAttemptResult => {
      let tier: WarpTierUsed = 'raw';
      let outputCanvas: HTMLCanvasElement = canvas;
      let rejectionReason: string | undefined;
      let rejectionStage: 'webgl' | 'cpu' | undefined;
      let webglRecoveredOnCpu = false;

      if (hasReliableDetection) {
        // Auto-capture prioritizes determinism over speed to avoid intermittent WebGL corruption artifacts.
        const preferCpuWarp = source === 'auto';
        if (preferCpuWarp && this.config.debug && !this.autoCaptureCpuWarpWarned) {
          this.autoCaptureCpuWarpWarned = true;
          console.warn('[docuscan] Auto-capture warp policy active: CPU-first (WebGL bypassed for stability).');
        }
        if (!preferCpuWarp) {
          const webglResult = warpPerspectiveWebGL({
            imageData,
            quad: candidateQuad,
            outputWidth: outWidth,
            outputHeight: outHeight,
            budgetMs: 50,
          });
          if (webglResult.ok && webglResult.canvas && webglResult.elapsedMs <= 50) {
            const webglSnapshot = document.createElement('canvas');
            webglSnapshot.width = outWidth;
            webglSnapshot.height = outHeight;
            const webglSnapshotCtx = webglSnapshot.getContext('2d', { willReadFrequently: true });
            if (webglSnapshotCtx) {
              webglSnapshotCtx.drawImage(
                webglResult.canvas,
                0,
                0,
                outWidth,
                outHeight,
                0,
                0,
                outWidth,
                outHeight,
              );
              const webglValidation = validateWarpCanvas(webglSnapshot, 'webgl');
              if (webglValidation.accepted) {
                tier = 'webgl';
                outputCanvas = webglSnapshot;
              } else if (webglValidation.validation) {
                rejectionReason = webglValidation.validation.reason;
                rejectionStage = 'webgl';
                if (this.config.debug) {
                  console.warn(
                    `[docuscan] WebGL warp rejected reason=${webglValidation.validation.reason} ` +
                      `(var=${webglValidation.validation.warpedStats.variance.toFixed(1)}, ` +
                      `range=${webglValidation.validation.warpedStats.dynamicRange.toFixed(1)}, ` +
                      `blockiness=${webglValidation.validation.integrity.blockiness.toFixed(2)}, ` +
                      `dominant=${(webglValidation.validation.integrity.dominantColorRatio * 100).toFixed(1)}%, ` +
                      `nearBlack=${(webglValidation.validation.integrity.nearBlackRatio * 100).toFixed(1)}%), trying CPU warp`,
                  );
                }
              }
            } else if (this.config.debug) {
              console.warn('[docuscan] Could not snapshot WebGL warp canvas; trying CPU warp');
            }
          }
        }

        if (tier === 'raw') {
          const cpuResult = warpPerspectiveCpu({
            imageData,
            quad: candidateQuad,
            outputWidth: outWidth,
            outputHeight: outHeight,
            budgetMs: cpuWarpBudgetMs,
          });
          if (cpuResult.ok && cpuResult.imageData && cpuResult.elapsedMs <= cpuWarpBudgetMs) {
            const cpuCanvas = document.createElement('canvas');
            cpuCanvas.width = outWidth;
            cpuCanvas.height = outHeight;
            const cpuCtx = cpuCanvas.getContext('2d');
            if (!cpuCtx) {
              throw new Error('Could not create CPU output canvas');
            }
            cpuCtx.putImageData(cpuResult.imageData, 0, 0);
            const cpuValidation = validateWarpCanvas(cpuCanvas, 'cpu');
            if (cpuValidation.accepted) {
              tier = 'cpu';
              outputCanvas = cpuCanvas;
              webglRecoveredOnCpu = rejectionStage === 'webgl';
            } else if (cpuValidation.validation) {
              rejectionReason = cpuValidation.validation.reason;
              rejectionStage = 'cpu';
              if (this.config.debug) {
                console.warn(
                  `[docuscan] CPU warp rejected reason=${cpuValidation.validation.reason} ` +
                    `(var=${cpuValidation.validation.warpedStats.variance.toFixed(1)}, ` +
                    `range=${cpuValidation.validation.warpedStats.dynamicRange.toFixed(1)}, ` +
                    `blockiness=${cpuValidation.validation.integrity.blockiness.toFixed(2)}, ` +
                    `dominant=${(cpuValidation.validation.integrity.dominantColorRatio * 100).toFixed(1)}%, ` +
                    `nearBlack=${(cpuValidation.validation.integrity.nearBlackRatio * 100).toFixed(1)}%), falling back to raw capture`,
                );
              }
            }
          }
        }
      }

      return {
        tier,
        outputCanvas,
        rejectionReason,
        rejectionStage,
        webglRecoveredOnCpu,
      };
    };

    let warpAttempt = attemptWarpForQuad(sourceQuad);
    if (warpAttempt.webglRecoveredOnCpu) {
      this.emitter.emit('warning', 'WebGL warp rejected; switched to CPU warp');
    }
    if (postRefineApplied && warpAttempt.tier === 'raw' && warpAttempt.rejectionReason) {
      if (this.config.debug) {
        console.warn(
          `[docuscan] post-refine fallback | refined quad failed warp validation (${warpAttempt.rejectionReason}), retrying original quad`,
        );
      }
      sourceQuad = sourceQuadOriginal;
      const originalAttempt = attemptWarpForQuad(sourceQuadOriginal);
      if (originalAttempt.webglRecoveredOnCpu) {
        this.emitter.emit('warning', 'WebGL warp rejected; switched to CPU warp');
      }
      warpAttempt = originalAttempt;
      postRefineApplied = false;
      postRefineReason = 'validation_reverted';
      refinedQuad = undefined;
    }

    let tier = warpAttempt.tier;
    let outputCanvas = warpAttempt.outputCanvas;
    const rejectionReason = warpAttempt.rejectionReason;
    const rejectionStage = warpAttempt.rejectionStage;

    if (now() - t0 > 500) {
      tier = 'raw';
      outputCanvas = canvas;
      sourceQuad = sourceQuadOriginal;
      if (postRefineApplied) {
        postRefineApplied = false;
        postRefineReason = 'timeout';
        refinedQuad = undefined;
      }
    }

    if (tier === 'raw') {
      this.lastWarpRejectedReason = rejectionReason;
      if (rejectionReason) {
        const stagePrefix = rejectionStage ? `${rejectionStage}:` : '';
        this.emitter.emit('warning', `Warp rejected: ${stagePrefix}${rejectionReason}; used raw capture`);
      }
    } else {
      this.lastWarpRejectedReason = undefined;
    }

    const blob = await canvasToBlob(
      outputCanvas,
      this.config.captureMimeType ?? 'image/jpeg',
      this.config.captureQuality,
    );
    const outputQuad: Quad =
      tier === 'raw'
        ? sourceQuad
        : {
            topLeft: { x: 0, y: 0 },
            topRight: { x: outputCanvas.width - 1, y: 0 },
            bottomRight: { x: outputCanvas.width - 1, y: outputCanvas.height - 1 },
            bottomLeft: { x: 0, y: outputCanvas.height - 1 },
          };

    return {
      blob,
      width: outputCanvas.width,
      height: outputCanvas.height,
      quad: outputQuad,
      sourceQuad,
      refinedQuad,
      postRefineApplied,
      postRefineReason,
      warpTierUsed: tier,
      warpRejected: Boolean(this.lastWarpRejectedReason),
      warpRejectionReason: this.lastWarpRejectedReason,
      quality: this.latestResult?.quality,
      source,
      captureDecisionSource: source,
      detectorSourceAtCapture: (this.latestResult?.detection.source ?? 'cv') as DetectorSource,
      elapsedMs: now() - t0,
    };
  }
}

export function createScannerSession(config?: ScannerConfig): ScannerSession {
  return new ScannerSessionImpl(config);
}
