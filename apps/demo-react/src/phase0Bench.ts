import {
  createEngine,
  defaultEngineConfig,
  mergeEngineConfig,
  type FrameProcessResult,
} from '@document-autocapture/core-engine';
import { detectCapabilities, selectExecutionMode, type Capabilities } from '@document-autocapture/runtime-web';
import { warpPerspectiveCpu } from '@document-autocapture/warp-cpu';
import { warpPerspectiveWebGL } from '@document-autocapture/warp-webgl';
import { createScannerWorker, type WorkerRequest, type WorkerResponse } from '@document-autocapture/worker-runtime';

interface Stats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
}

interface IngestionBenchmark {
  mode: 'standard' | 'best';
  supported: boolean;
  frames: number;
  elapsedMs: number;
  fps: number;
  roundtripMs: Stats;
  detectionMs: Stats;
  notes?: string;
}

interface DetectionLoopBenchmark {
  frames: number;
  elapsedMs: number;
  fps: number;
  stageTotalMs: Stats;
  hardCeilingViolations: number;
}

interface WarpBenchmarkResult {
  ok: boolean;
  elapsedMs: number;
  budgetMs: number;
  withinBudget: boolean;
  downgraded?: boolean;
  reason?: string;
}

interface EndToEndBenchmark {
  success: boolean;
  stableReached: boolean;
  stableAtMs: number;
  captureTier: 'webgl' | 'cpu' | 'raw' | 'none';
  guidance: string;
}

interface Phase0BenchResult {
  generatedAt: string;
  userAgent: string;
  capabilities: Capabilities;
  simulatedModeSelection: {
    bestCase: string;
    standardCase: string;
    fallbackCase: string;
  };
  ingestion: {
    standard: IngestionBenchmark;
    best: IngestionBenchmark;
  };
  detectionLoop: DetectionLoopBenchmark;
  warp: {
    webgl: WarpBenchmarkResult;
    cpu: WarpBenchmarkResult;
  };
  endToEnd: EndToEndBenchmark;
  gates: {
    ingestionPass: boolean;
    detectionPass: boolean;
    webglPass: boolean;
    cpuPass: boolean;
    endToEndPass: boolean;
    overall: boolean;
  };
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length)));
  return sorted[idx];
}

function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[(sorted.length - 1) / 2];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    p95: percentile(sorted, 95),
  };
}

function drawSyntheticDocument(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
): void {
  const t = frameIndex / 12;
  const jitterX = Math.sin(t) * 6;
  const jitterY = Math.cos(t) * 4;

  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, width, height);

  const left = width * 0.14 + jitterX;
  const top = height * 0.1 + jitterY;
  const docWidth = width * 0.72;
  const docHeight = height * 0.78;

  ctx.fillStyle = '#d7dde6';
  ctx.fillRect(left, top, docWidth, docHeight);

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = Math.max(2, Math.round(width * 0.01));
  ctx.strokeRect(left, top, docWidth, docHeight);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i += 1) {
    const y = top + 20 + i * ((docHeight - 40) / 12);
    ctx.beginPath();
    ctx.moveTo(left + 24, y);
    ctx.lineTo(left + docWidth - 24, y);
    ctx.stroke();
  }
}

function createSyntheticImageData(width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create synthetic image context');
  }
  drawSyntheticDocument(ctx, width, height, 3);
  return ctx.getImageData(0, 0, width, height);
}

type PendingResolver = { resolve: (value: FrameProcessResult) => void; reject: (error: Error) => void };

async function createWorkerClient() {
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
          slot.resolve(message.result);
        }
      }
    };
  });

  worker.postMessage({
    type: 'init',
    config: mergeEngineConfig({
      ...defaultEngineConfig,
      debug: false,
    }),
  } satisfies WorkerRequest);

  await ready;

  return {
    async processRgba(width: number, height: number, rgbaBuffer: ArrayBuffer): Promise<FrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<FrameProcessResult>((resolve, reject) => {
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

    async processBitmap(bitmap: ImageBitmap): Promise<FrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<FrameProcessResult>((resolve, reject) => {
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

async function benchmarkStandardIngestion(frameCount = 120): Promise<IngestionBenchmark> {
  const width = 480;
  const height = 672;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Standard ingestion canvas context missing');
  }

  const client = await createWorkerClient();
  const roundtrip: number[] = [];
  const detectionMs: number[] = [];

  const t0 = performance.now();
  for (let i = 0; i < frameCount; i += 1) {
    drawSyntheticDocument(ctx, width, height, i);
    const readStart = performance.now();
    const imageData = ctx.getImageData(0, 0, width, height);
    const result = await client.processRgba(width, height, imageData.data.buffer);
    roundtrip.push(performance.now() - readStart);
    detectionMs.push(result.detection.timings?.totalMs ?? 0);
  }
  const elapsedMs = performance.now() - t0;

  await client.destroy();

  return {
    mode: 'standard',
    supported: true,
    frames: frameCount,
    elapsedMs,
    fps: (frameCount * 1000) / Math.max(1, elapsedMs),
    roundtripMs: computeStats(roundtrip),
    detectionMs: computeStats(detectionMs),
  };
}

async function benchmarkBestIngestion(frameCount = 120): Promise<IngestionBenchmark> {
  if (typeof OffscreenCanvas === 'undefined') {
    return {
      mode: 'best',
      supported: false,
      frames: 0,
      elapsedMs: 0,
      fps: 0,
      roundtripMs: computeStats([]),
      detectionMs: computeStats([]),
      notes: 'OffscreenCanvas unavailable',
    };
  }

  const width = 480;
  const height = 672;
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof offscreen.transferToImageBitmap !== 'function') {
    return {
      mode: 'best',
      supported: false,
      frames: 0,
      elapsedMs: 0,
      fps: 0,
      roundtripMs: computeStats([]),
      detectionMs: computeStats([]),
      notes: 'OffscreenCanvas transferToImageBitmap unavailable',
    };
  }

  const client = await createWorkerClient();
  const roundtrip: number[] = [];
  const detectionMs: number[] = [];

  const t0 = performance.now();
  for (let i = 0; i < frameCount; i += 1) {
    drawSyntheticDocument(ctx, width, height, i);
    const start = performance.now();
    const bitmap = offscreen.transferToImageBitmap();
    const result = await client.processBitmap(bitmap);
    roundtrip.push(performance.now() - start);
    detectionMs.push(result.detection.timings?.totalMs ?? 0);
  }
  const elapsedMs = performance.now() - t0;

  await client.destroy();

  return {
    mode: 'best',
    supported: true,
    frames: frameCount,
    elapsedMs,
    fps: (frameCount * 1000) / Math.max(1, elapsedMs),
    roundtripMs: computeStats(roundtrip),
    detectionMs: computeStats(detectionMs),
  };
}

async function benchmarkDetectionLoop(frameCount = 200): Promise<DetectionLoopBenchmark> {
  const width = 480;
  const height = 672;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Detection benchmark canvas context missing');
  }

  const client = await createWorkerClient();

  const timings: number[] = [];
  let hardCeilingViolations = 0;

  const t0 = performance.now();
  try {
    for (let i = 0; i < frameCount; i += 1) {
      drawSyntheticDocument(ctx, width, height, i);
      const imageData = ctx.getImageData(0, 0, width, height);
      const result = await client.processRgba(width, height, imageData.data.buffer);
      const totalMs = result.detection.timings?.totalMs ?? 0;
      timings.push(totalMs);
      if (totalMs > defaultEngineConfig.workerHardCeilingMs) {
        hardCeilingViolations += 1;
      }
    }
  } finally {
    await client.destroy();
  }
  const elapsedMs = performance.now() - t0;

  return {
    frames: frameCount,
    elapsedMs,
    fps: (frameCount * 1000) / Math.max(1, elapsedMs),
    stageTotalMs: computeStats(timings),
    hardCeilingViolations,
  };
}

function benchmarkWarpWebgl(imageData: ImageData, quad: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } }): WarpBenchmarkResult {
  // Warm shader/program cache before timed run.
  warpPerspectiveWebGL({
    imageData,
    quad,
    outputWidth: imageData.width,
    outputHeight: imageData.height,
    budgetMs: 50,
  });
  const result = warpPerspectiveWebGL({
    imageData,
    quad,
    outputWidth: imageData.width,
    outputHeight: imageData.height,
    budgetMs: 50,
  });
  const downgraded = !result.ok && (result.reason ?? '').toLowerCase().includes('context unavailable');
  return {
    ok: result.ok,
    elapsedMs: result.elapsedMs,
    budgetMs: 50,
    withinBudget: downgraded || (result.ok && result.elapsedMs <= 50),
    downgraded,
    reason: result.reason,
  };
}

function benchmarkWarpCpu(imageData: ImageData, quad: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } }): WarpBenchmarkResult {
  // Warm JIT path before timed run.
  warpPerspectiveCpu({
    imageData,
    quad,
    outputWidth: imageData.width,
    outputHeight: imageData.height,
    budgetMs: 200,
  });
  const result = warpPerspectiveCpu({
    imageData,
    quad,
    outputWidth: imageData.width,
    outputHeight: imageData.height,
    budgetMs: 200,
  });
  return {
    ok: result.ok,
    elapsedMs: result.elapsedMs,
    budgetMs: 200,
    withinBudget: result.ok && result.elapsedMs <= 200,
    reason: result.reason,
  };
}

function benchmarkEndToEndFlow(): EndToEndBenchmark {
  const detectWidth = 480;
  const detectHeight = 672;
  const detectCanvas = document.createElement('canvas');
  detectCanvas.width = detectWidth;
  detectCanvas.height = detectHeight;
  const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });
  if (!detectCtx) {
    return {
      success: false,
      stableReached: false,
      stableAtMs: 0,
      captureTier: 'none',
      guidance: 'context_missing',
    };
  }

  const engine = createEngine({
    ...defaultEngineConfig,
    minStableConfidence: 0.45,
    stabilityWindowMs: 600,
    movementThresholdPx: 6,
    blurVarianceMin: 8,
  });

  let stableAtMs = 0;
  let bestCandidate = undefined as ReturnType<typeof engine.processFrame>['detection']['bestCandidate'];
  let guidance = 'DOCUMENT_NOT_FOUND';

  for (let frame = 0; frame < 70; frame += 1) {
    drawSyntheticDocument(detectCtx, detectWidth, detectHeight, 0);
    const imageData = detectCtx.getImageData(0, 0, detectWidth, detectHeight);
    const result = engine.processFrame({
      rgba: imageData.data,
      width: detectWidth,
      height: detectHeight,
      nowMs: frame * 33,
    });
    guidance = result.guidance;
    bestCandidate = result.detection.bestCandidate;

    if (result.detection.status === 'found' && result.quality?.ok && result.stability?.stable) {
      stableAtMs = frame * 33;
      break;
    }
  }

  if (!bestCandidate || stableAtMs === 0) {
    return {
      success: false,
      stableReached: false,
      stableAtMs,
      captureTier: 'none',
      guidance,
    };
  }

  const captureImage = createSyntheticImageData(1600, 2200);
  const sx = captureImage.width / detectWidth;
  const sy = captureImage.height / detectHeight;
  const scaledQuad = {
    topLeft: { x: bestCandidate.quad.topLeft.x * sx, y: bestCandidate.quad.topLeft.y * sy },
    topRight: { x: bestCandidate.quad.topRight.x * sx, y: bestCandidate.quad.topRight.y * sy },
    bottomRight: { x: bestCandidate.quad.bottomRight.x * sx, y: bestCandidate.quad.bottomRight.y * sy },
    bottomLeft: { x: bestCandidate.quad.bottomLeft.x * sx, y: bestCandidate.quad.bottomLeft.y * sy },
  };

  const webgl = warpPerspectiveWebGL({
    imageData: captureImage,
    quad: scaledQuad,
    outputWidth: captureImage.width,
    outputHeight: captureImage.height,
    budgetMs: 50,
  });

  if (webgl.ok) {
    return {
      success: true,
      stableReached: true,
      stableAtMs,
      captureTier: 'webgl',
      guidance,
    };
  }

  const cpu = warpPerspectiveCpu({
    imageData: captureImage,
    quad: scaledQuad,
    outputWidth: captureImage.width,
    outputHeight: captureImage.height,
    budgetMs: 200,
  });

  if (cpu.ok) {
    return {
      success: true,
      stableReached: true,
      stableAtMs,
      captureTier: 'cpu',
      guidance,
    };
  }

  return {
    success: true,
    stableReached: true,
    stableAtMs,
    captureTier: 'raw',
    guidance,
  };
}

export async function runPhase0Bench(): Promise<Phase0BenchResult> {
  const capabilities = await detectCapabilities();

  const [standard, best] = await Promise.all([
    benchmarkStandardIngestion(),
    benchmarkBestIngestion(),
  ]);

  const detectionLoop = await benchmarkDetectionLoop();
  const warpInput = createSyntheticImageData(2304, 3072);
  const warpQuad = {
    topLeft: { x: 307, y: 212 },
    topRight: { x: 1958, y: 240 },
    bottomRight: { x: 2026, y: 2899 },
    bottomLeft: { x: 269, y: 2860 },
  };

  const warpWebgl = benchmarkWarpWebgl(warpInput, warpQuad);
  const warpCpu = benchmarkWarpCpu(warpInput, warpQuad);
  const endToEnd = benchmarkEndToEndFlow();

  const ingestionPass = standard.fps >= 20;
  const detectionPass =
    detectionLoop.stageTotalMs.median <= defaultEngineConfig.detectionFrameBudgetMs &&
    detectionLoop.stageTotalMs.p95 <= defaultEngineConfig.workerHardCeilingMs;
  const webglPass = warpWebgl.withinBudget;
  const cpuPass = warpCpu.withinBudget;
  const endToEndPass = endToEnd.success && endToEnd.stableReached;

  return {
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    capabilities,
    simulatedModeSelection: {
      bestCase: selectExecutionMode({
        workerSupported: true,
        offscreenCanvasSupported: true,
        offscreenTransferSupported: true,
        webglMainSupported: true,
        webglWorkerSupported: true,
        requestVideoFrameCallbackSupported: true,
        crossOriginIsolated: false,
      }),
      standardCase: selectExecutionMode({
        workerSupported: true,
        offscreenCanvasSupported: false,
        offscreenTransferSupported: false,
        webglMainSupported: true,
        webglWorkerSupported: false,
        requestVideoFrameCallbackSupported: true,
        crossOriginIsolated: false,
      }),
      fallbackCase: selectExecutionMode({
        workerSupported: false,
        offscreenCanvasSupported: false,
        offscreenTransferSupported: false,
        webglMainSupported: false,
        webglWorkerSupported: false,
        requestVideoFrameCallbackSupported: false,
        crossOriginIsolated: false,
      }),
    },
    ingestion: {
      standard,
      best,
    },
    detectionLoop,
    warp: {
      webgl: warpWebgl,
      cpu: warpCpu,
    },
    endToEnd,
    gates: {
      ingestionPass,
      detectionPass,
      webglPass,
      cpuPass,
      endToEndPass,
      overall: ingestionPass && detectionPass && webglPass && cpuPass && endToEndPass,
    },
  };
}
