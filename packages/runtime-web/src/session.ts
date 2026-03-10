import {
  createEngine,
  defaultEngineConfig,
  mergeEngineConfig,
  nowMs,
  type DetectionResult,
  type EngineConfig,
  type ExecutionMode,
  type FrameProcessResult,
  type GuidanceCode,
} from '@document-autocapture/core-engine';
import {
  createScannerWorker,
  type WorkerRequest,
  type WorkerResponse,
} from '@document-autocapture/worker-runtime';
import { detectCapabilities, selectExecutionMode } from './capabilities';
import { TypedEmitter } from './emitter';
import { cleanupGuidance } from './guidance';
import { captureWithWarp as runCaptureWithWarp } from './session/capture-pipeline';
import {
  toEngineConfig,
  toWorkerDetectorConfig,
  normalizeDetectorMode,
} from './session/config-mapper';
import { buildScannerConfig } from './session/defaults';
import { mergeVideoConstraints } from './session/constraint-utils';
import { evaluateAutoCaptureReadiness, logFrameDebug } from './session/frame-decision';
import {
  cleanupVideoStream,
  ensureVideoFrameReady,
  ensureVideoPlayback,
} from './session/video-media';
import { hasCurrentVideoFrame, waitForVideoLoadedData } from './video-readiness';
import type {
  Capabilities,
  CaptureCompleteResult,
  CaptureResult,
  ScannerConfig,
  ScannerEventMap,
  ScannerEventName,
  ScannerSession,
} from './types';

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
    {
      resolve: (result: FrameProcessResult) => void;
      reject: (error: Error) => void;
      timeoutHandle: number;
    }
  >();

  private worker?: Worker;

  private workerReady = false;

  private workerReadyTimeoutHandle = 0;

  private startTask?: Promise<void>;

  private fallbackEngine = createEngine(defaultEngineConfig);

  private latestResult?: FrameProcessResult;

  private lastDetectionFrameWidth = 0;

  private lastDetectionFrameHeight = 0;

  private lastCaptureAt = 0;

  private autoCaptureStableStreak = 0;

  private captureCountInternal = 0;

  private capturedResults: CaptureResult[] = [];

  private captureComplete = false;

  private debugFrameCount = 0;

  private lastWorkerTelemetry?: Extract<WorkerResponse, { type: 'frame-result' }>['telemetry'];

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
    this.config = buildScannerConfig(config);
    this.engineConfig = mergeEngineConfig(toEngineConfig(this.config));
    this.fallbackEngine = createEngine(this.engineConfig);
  }

  get captureCount(): number {
    return this.captureCountInternal;
  }

  getCapabilities(): Capabilities {
    return this.capabilities;
  }

  on<K extends ScannerEventName>(
    event: K,
    handler: (payload: ScannerEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  updateConfig(partial: Partial<ScannerConfig>): void {
    const hasVideoElementOverride = Object.prototype.hasOwnProperty.call(partial, 'videoElement');
    const nextVideoElement = hasVideoElementOverride ? partial.videoElement : undefined;
    const mergedScoreWeights = {
      ...defaultEngineConfig.scoreWeights,
      ...(this.config.scoreWeights ?? {}),
      ...(partial.scoreWeights ?? {}),
    };
    const mergedVideoConstraints = mergeVideoConstraints(
      this.config.videoConstraints,
      partial.videoConstraints,
    );

    this.config = {
      ...this.config,
      ...partial,
      detectorMode: normalizeDetectorMode(partial.detectorMode ?? this.config.detectorMode),
      scoreWeights: mergedScoreWeights,
      videoConstraints: mergedVideoConstraints,
    };
    if (partial.mlPipelineVersion !== undefined && partial.mlModelId === undefined) {
      this.config.mlModelId =
        partial.mlPipelineVersion === 'v2-graph' ? 'doc-corner-v2' : 'doc-corner-v1';
    }

    this.engineConfig = mergeEngineConfig(toEngineConfig(this.config));
    this.fallbackEngine = createEngine(this.engineConfig);

    if (nextVideoElement && nextVideoElement !== this.video) {
      nextVideoElement.muted = true;
      nextVideoElement.playsInline = true;
      nextVideoElement.autoplay = true;
      if (this.stream) {
        nextVideoElement.srcObject = this.stream;
      }
      this.video = nextVideoElement;
      if (this.running) {
        void this.ensureVideoPlayback(nextVideoElement).catch((error) => {
          this.emitter.emit(
            'error',
            error instanceof Error ? error : new Error('Failed to bind updated video element'),
          );
        });
      }
    }

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
          window.location.hostname !== '127.0.0.1' &&
          window.location.hostname !== '[::1]'
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
          console.warn('[document-autocapture] capabilities', this.capabilities);
        }
        this.emitter.emit('capabilities', this.capabilities);

        this.video = this.config.videoElement ?? document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.autoplay = true;

        this.stream = await navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode: 'environment',
              ...(this.config.videoConstraints ?? {}),
            },
            audio: false,
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              throw new Error(
                'Camera permission was denied. Please allow camera access and try again.',
              );
            }
            if (err instanceof DOMException && err.name === 'NotFoundError') {
              throw new Error('No camera found. Please connect a camera and try again.');
            }
            throw err;
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
          this.worker = (this.config.workerFactory ?? createScannerWorker)();
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

          // Timeout: if worker doesn't become ready within 8s, fall back.
          this.workerReadyTimeoutHandle = window.setTimeout(() => {
            if (!this.workerReady && this.worker) {
              this.downgradeToFallback(
                'Worker init timeout — falling back to main-thread processing',
              );
            }
          }, 8000);
        }

        this.assertLifecycleToken(startToken);
        this.running = true;
        this.debugFrameCount = 0;
        this.captureCountInternal = 0;
        this.capturedResults = [];
        this.captureComplete = false;
        this.mlGraphUnavailableWarned = false;
        if (this.config.debug) {
          const workerDetectorConfig = toWorkerDetectorConfig(this.config);
          console.warn(
            `[document-autocapture] Scanner started | mode=${this.executionMode} | ` +
              `detectorMode=${this.config.detectorMode} | autoCapture=${this.config.autoCapture} | ` +
              `detectionWidth=${this.config.detectionWidth ?? 480} | ` +
              `video=${this.video.videoWidth}x${this.video.videoHeight} | ` +
              `confidenceThreshold=${this.engineConfig.confidenceThreshold} | ` +
              `blurVarianceMin=${this.engineConfig.blurVarianceMin} | ` +
              `workerHardCeilingMs=${this.engineConfig.workerHardCeilingMs} | ` +
              `mlPipeline=${workerDetectorConfig.mlPipelineVersion ?? 'v1-heuristic'} | ` +
              `mlModelId=${workerDetectorConfig.mlModelId ?? 'doc-corner-v1'} | ` +
              `mlInputSize=${workerDetectorConfig.mlInputSize ?? this.config.mlInputSize ?? 'auto'} | ` +
              `graphMl=${workerDetectorConfig.graphMlEnabled ? 'on' : 'off'} | ` +
              `cocoBook=${workerDetectorConfig.cocoBookEnabled ? 'on' : 'off'} ` +
              `(everyFrame=on, minScore=${workerDetectorConfig.cocoMinScore.toFixed(2)}, primary=${workerDetectorConfig.cocoUseAsPrimaryInMlMode ? 'on' : 'off'}) | ` +
              `cvContour=${this.engineConfig.contourEnabled ? 'on' : 'off'} | ` +
              `hough=${this.engineConfig.houghSecondaryEnabled ? 'on' : 'off'} | ` +
              `warpValidation=${this.config.warpValidationLevel ?? 'standard'} | ` +
              `postRefine=${this.config.postCaptureRefineMode ?? 'off'} | ` +
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
          this.rejectPendingFrames(
            error instanceof Error ? error : new Error('Scanner start failed'),
          );
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
    if (this.workerReadyTimeoutHandle) {
      clearTimeout(this.workerReadyTimeoutHandle);
      this.workerReadyTimeoutHandle = 0;
    }
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
    if (this.bestIngestionCanvas && 'close' in this.bestIngestionCanvas) {
      try { (this.bestIngestionCanvas as OffscreenCanvas & { close(): void }).close(); } catch { /* ignore */ }
    }
    this.bestIngestionCanvas = undefined;
    this.bestIngestionCtx = null;
    this.workerReady = false;
    this.lastWorkerTelemetry = undefined;
    this.autoCaptureStableStreak = 0;

    if (this.worker) {
      const w = this.worker;
      this.worker = undefined;
      // Detach handlers so stale messages from the dying worker
      // cannot affect a new session started immediately after stop().
      w.onmessage = null;
      w.onerror = null;
      try { w.postMessage({ type: 'cleanup' }); } catch { /* ignore */ }
      // Give the worker time to process the cleanup message (dispose models)
      // before terminating. terminate() kills immediately and would discard
      // any queued messages, so the short delay is necessary.
      setTimeout(() => { try { w.terminate(); } catch { /* ignore */ } }, 50);
    }
    this.cleanupVideoStream();
    this.ingestionCanvas = undefined;
    this.ingestionCtx = undefined;
  }

  async destroy(): Promise<void> {
    await this.stop();
    cleanupGuidance();
    this.emitter.clear();
  }

  async captureManual(): Promise<CaptureResult> {
    if (!this.video) {
      throw new Error('Scanner is not started');
    }
    if (this.captureComplete) {
      throw new Error('Capture limit reached. Call start() to begin a new session.');
    }
    const capture = await this.captureWithWarp('manual');
    if (this.captureComplete) {
      // Auto-capture reached the limit while captureWithWarp was in-flight.
      return capture;
    }
    this.emitter.emit('capture', capture);
    this.recordCapture(capture);
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
      nowMs: nowMs(),
    });
  }

  private fallbackProcessFromCurrentVideo(width: number, height: number): FrameProcessResult {
    if (!this.video || !this.ingestionCanvas || !this.ingestionCtx) {
      return this.createBlankFrame(width, height);
    }
    this.ingestionCanvas.width = width;
    this.ingestionCanvas.height = height;
    try {
      this.ingestionCtx.drawImage(this.video, 0, 0, width, height);
    } catch {
      return this.createBlankFrame(width, height);
    }
    const imageData = this.ingestionCtx.getImageData(0, 0, width, height);
    return this.fallbackEngine.processFrame({
      rgba: imageData.data,
      width,
      height,
      nowMs: nowMs(),
    });
  }

  private rejectPendingFrames(error: Error): void {
    for (const [id, pending] of this.pendingFrames.entries()) {
      this.pendingFrames.delete(id);
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      pending.reject(error);
    }
    this.frameBusy = false;
  }

  private async ensureVideoPlayback(video: HTMLVideoElement): Promise<void> {
    return ensureVideoPlayback(video);
  }

  private async ensureVideoFrameReady(video: HTMLVideoElement): Promise<void> {
    return ensureVideoFrameReady(video);
  }

  private cleanupVideoStream(): void {
    cleanupVideoStream(this.video, this.stream);
    this.stream = undefined;
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

    if (
      this.capabilities.requestVideoFrameCallbackSupported &&
      this.video.requestVideoFrameCallback
    ) {
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
      const requestedWidth = Number(
        this.config.detectionWidth ?? defaultEngineConfig.detectionWidth,
      );
      const targetWidth = Math.max(
        240,
        Math.min(960, Number.isFinite(requestedWidth) ? Math.round(requestedWidth) : 480),
      );
      const targetHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * targetWidth));
      this.lastDetectionFrameWidth = targetWidth;
      this.lastDetectionFrameHeight = targetHeight;

      const cvResult = await this.processCvFrame(targetWidth, targetHeight);
      this.onFrameResult(cvResult);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Frame processing failed');
      if (this.config.debug) {
        console.warn('[document-autocapture] processFrame error:', err.message);
      }
      this.emitter.emit('error', err);
    }
  }

  private async processCvFrame(
    targetWidth: number,
    targetHeight: number,
  ): Promise<FrameProcessResult> {
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
    const workerFrameTimeoutMs = Math.max(
      1500,
      (this.engineConfig.workerHardCeilingMs ?? defaultEngineConfig.workerHardCeilingMs) * 18,
    );

    const promise = new Promise<FrameProcessResult>((resolve, reject) => {
      const timeoutHandle = window.setTimeout(() => {
        const pending = this.pendingFrames.get(id);
        if (!pending) {
          return;
        }
        this.pendingFrames.delete(id);
        pending.reject(new Error(`Worker frame timeout after ${workerFrameTimeoutMs}ms`));
      }, workerFrameTimeoutMs);
      this.pendingFrames.set(id, { resolve, reject, timeoutHandle });
    });

    if (
      this.executionMode === 'best' &&
      this.prepareBestIngestionCanvas(targetWidth, targetHeight)
    ) {
      this.bestIngestionCtx?.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const bitmap = this.bestIngestionCanvas?.transferToImageBitmap();
      if (bitmap) {
        try {
          this.worker.postMessage(
            {
              type: 'process-image-bitmap',
              id,
              nowMs: nowMs(),
              bitmap,
            } satisfies WorkerRequest,
            [bitmap],
          );
        } catch (error) {
          bitmap.close();
          this.frameBusy = false;
          const pending = this.pendingFrames.get(id);
          if (pending?.timeoutHandle) {
            clearTimeout(pending.timeoutHandle);
          }
          this.pendingFrames.delete(id);
          this.emitter.emit(
            'error',
            error instanceof Error ? error : new Error('Best mode worker postMessage failed'),
          );
          return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
        }
      } else {
        this.frameBusy = false;
        const pending = this.pendingFrames.get(id);
        if (pending?.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
        this.pendingFrames.delete(id);
        this.emitter.emit('error', new Error('Best mode bitmap transfer failed'));
        return this.fallbackProcessFromCurrentVideo(targetWidth, targetHeight);
      }
    } else {
      if (this.ingestionCanvas.width !== targetWidth) this.ingestionCanvas.width = targetWidth;
      if (this.ingestionCanvas.height !== targetHeight) this.ingestionCanvas.height = targetHeight;
      this.ingestionCtx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const imageData = this.ingestionCtx.getImageData(0, 0, targetWidth, targetHeight);

      try {
        this.worker.postMessage(
          {
            type: 'process-frame',
            id,
            width: targetWidth,
            height: targetHeight,
            nowMs: nowMs(),
            rgbaBuffer: imageData.data.buffer,
          } satisfies WorkerRequest,
          [imageData.data.buffer],
        );
      } catch (error) {
        this.frameBusy = false;
        const pending = this.pendingFrames.get(id);
        if (pending?.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
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
      this.bestIngestionCtx = this.bestIngestionCanvas.getContext('2d', {
        willReadFrequently: true,
      });
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
      if (this.workerReadyTimeoutHandle) {
        clearTimeout(this.workerReadyTimeoutHandle);
        this.workerReadyTimeoutHandle = 0;
      }
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
          if (pending.timeoutHandle) {
            clearTimeout(pending.timeoutHandle);
          }
          pending.reject(error);
        }
      } else {
        for (const [id, pending] of this.pendingFrames.entries()) {
          this.pendingFrames.delete(id);
          if (pending.timeoutHandle) {
            clearTimeout(pending.timeoutHandle);
          }
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
          '[document-autocapture] ML graph model is not loaded; detector is running heuristic ML. Set mlPipelineVersion=v2-graph and mlModelId=doc-corner-v2 to force graph loading.',
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
        const providerUsed =
          (message.telemetry as { providerUsed?: string } | undefined)?.providerUsed ?? 'n/a';
        const providerReject =
          (message.telemetry as { providerRejectReason?: string } | undefined)
            ?.providerRejectReason ?? 'none';
        console.warn(
          `[document-autocapture] ML mode fell back to CV (reason=${fallbackReason}) ` +
            `cvAttempted=${message.telemetry?.cvAttempted ?? false} ` +
            `mlReady=${message.telemetry?.mlReady ?? false} ` +
            `mlLoaded=${message.telemetry?.mlModelLoaded ?? false} ` +
            `mlInfer=${message.telemetry?.mlInferenceUsed ?? false} ` +
            `mlRescue=${mlRescue} ` +
            `provider=${providerUsed} reject=${providerReject} ` +
            `graphAttempted=${(message.telemetry as { graphAttempted?: boolean } | undefined)?.graphAttempted ?? false} ` +
            `cocoAttempted=${(message.telemetry as { cocoAttempted?: boolean } | undefined)?.cocoAttempted ?? false} ` +
            `cocoReady=${(message.telemetry as { cocoReady?: boolean } | undefined)?.cocoReady ?? false}`,
        );
      }
      const pending = this.pendingFrames.get(message.id);
      if (pending) {
        this.pendingFrames.delete(message.id);
        if (pending.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
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

    const readiness = evaluateAutoCaptureReadiness(this.config, this.engineConfig, result);
    const readyForCapture = readiness.readyForCapture && !this.captureComplete;

    if (readyForCapture) {
      this.autoCaptureStableStreak += 1;
    } else {
      this.autoCaptureStableStreak = 0;
    }

    if (this.config.debug && this.debugFrameCount % 30 === 0) {
      logFrameDebug({
        frameCount: this.debugFrameCount,
        result,
        telemetry: this.lastWorkerTelemetry,
        config: this.config,
        engineConfig: this.engineConfig,
        autoCaptureStableStreak: this.autoCaptureStableStreak,
        lastCaptureAt: this.lastCaptureAt,
      });
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
        `[document-autocapture] Auto-capture triggered | ` +
          `streak=${this.autoCaptureStableStreak} score=${((result.detection.bestCandidate?.score ?? 0) * 100).toFixed(1)}% ` +
          `src=${result.detection.source} guidance=${result.guidance}`,
      );
    }

    this.lastCaptureAt = current;
    this.autoCaptureStableStreak = 0;
    void this.captureWithWarp('auto')
      .then((capture) => {
        if (this.captureComplete) {
          return;
        }
        if (this.config.debug) {
          console.warn(
            `[document-autocapture] Capture complete: warp=${capture.warpTierUsed} ` +
              `${capture.warpRejected ? `reject=${capture.warpRejectionReason} ` : ''}` +
              `elapsed=${capture.elapsedMs.toFixed(0)}ms`,
          );
        }
        this.emitter.emit('capture', capture);
        this.recordCapture(capture);
      })
      .catch((error) => {
        if (this.config.debug) {
          console.warn(
            `[document-autocapture] Capture failed: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
        this.emitter.emit(
          'error',
          error instanceof Error ? error : new Error('Auto-capture failed'),
        );
      });
  }

  private recordCapture(capture: CaptureResult): void {
    this.captureCountInternal += 1;
    this.capturedResults.push(capture);
    const max = this.config.maxCaptures;
    if (max && max > 0 && this.captureCountInternal >= max) {
      this.captureComplete = true;
      const completeResult: CaptureCompleteResult = {
        totalCaptures: this.captureCountInternal,
        captures: [...this.capturedResults],
      };
      if (this.config.debug) {
        console.warn(
          `[document-autocapture] Capture limit reached (${this.captureCountInternal}/${max})`,
        );
      }
      this.emitter.emit('complete', completeResult);
    }
  }

  private async captureWithWarp(source: 'manual' | 'auto'): Promise<CaptureResult> {
    if (!this.video) {
      throw new Error('Scanner is not started');
    }
    await this.ensureVideoFrameReady(this.video);
    if (source === 'auto' && this.config.debug && !this.autoCaptureCpuWarpWarned) {
      this.autoCaptureCpuWarpWarned = true;
      console.warn(
        '[document-autocapture] Auto-capture warp policy active: CPU-first (WebGL bypassed for stability).',
      );
    }
    return runCaptureWithWarp({
      video: this.video,
      latestResult: this.latestResult,
      config: this.config,
      source,
      lastDetectionFrameWidth: this.lastDetectionFrameWidth,
      lastDetectionFrameHeight: this.lastDetectionFrameHeight,
      nowMs: nowMs,
      emitWarning: (message) => this.emitter.emit('warning', message),
    });
  }
}

export function createScannerSession(config?: ScannerConfig): ScannerSession {
  return new ScannerSessionImpl(config);
}
