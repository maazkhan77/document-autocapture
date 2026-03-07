import {
  createEngine,
  defaultEngineConfig,
  mergeEngineConfig,
} from '@document-autocapture/core-engine';
import {
  detectCapabilities,
  selectExecutionMode,
  type Capabilities,
} from '@document-autocapture/runtime-web';
import { warpPerspectiveCpu } from '@document-autocapture/warp-cpu';
import { warpPerspectiveWebGL } from '@document-autocapture/warp-webgl';
import { computeStats, type Stats } from './bench/shared/stats';
import { createBenchmarkWorkerClient } from './bench/shared/worker-client';
import { drawSyntheticDocument } from './bench/shared/synthetic-scene';

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

  const client = await createBenchmarkWorkerClient({
    engineConfig: mergeEngineConfig({
      ...defaultEngineConfig,
      debug: false,
    }),
  });
  const roundtrip: number[] = [];
  const detectionMs: number[] = [];

  const t0 = performance.now();
  for (let i = 0; i < frameCount; i += 1) {
    drawSyntheticDocument(ctx, width, height, i);
    const readStart = performance.now();
    const imageData = ctx.getImageData(0, 0, width, height);
    const frame = await client.processRgba(width, height, imageData.data.buffer);
    const result = frame.result;
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

  const client = await createBenchmarkWorkerClient({
    engineConfig: mergeEngineConfig({
      ...defaultEngineConfig,
      debug: false,
    }),
  });
  const roundtrip: number[] = [];
  const detectionMs: number[] = [];

  const t0 = performance.now();
  for (let i = 0; i < frameCount; i += 1) {
    drawSyntheticDocument(ctx, width, height, i);
    const start = performance.now();
    const bitmap = offscreen.transferToImageBitmap();
    const frame = await client.processBitmap(bitmap);
    const result = frame.result;
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

  const client = await createBenchmarkWorkerClient({
    engineConfig: mergeEngineConfig({
      ...defaultEngineConfig,
      debug: false,
    }),
  });

  const timings: number[] = [];
  let hardCeilingViolations = 0;

  const t0 = performance.now();
  try {
    for (let i = 0; i < frameCount; i += 1) {
      drawSyntheticDocument(ctx, width, height, i);
      const imageData = ctx.getImageData(0, 0, width, height);
      const frame = await client.processRgba(width, height, imageData.data.buffer);
      const result = frame.result;
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

function benchmarkWarpWebgl(
  imageData: ImageData,
  quad: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  },
): WarpBenchmarkResult {
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
  const downgraded =
    !result.ok && (result.reason ?? '').toLowerCase().includes('context unavailable');
  return {
    ok: result.ok,
    elapsedMs: result.elapsedMs,
    budgetMs: 50,
    withinBudget: downgraded || (result.ok && result.elapsedMs <= 50),
    downgraded,
    reason: result.reason,
  };
}

function benchmarkWarpCpu(
  imageData: ImageData,
  quad: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  },
): WarpBenchmarkResult {
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
  let bestCandidate = undefined as ReturnType<
    typeof engine.processFrame
  >['detection']['bestCandidate'];
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
    bottomRight: {
      x: bestCandidate.quad.bottomRight.x * sx,
      y: bestCandidate.quad.bottomRight.y * sy,
    },
    bottomLeft: {
      x: bestCandidate.quad.bottomLeft.x * sx,
      y: bestCandidate.quad.bottomLeft.y * sy,
    },
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
