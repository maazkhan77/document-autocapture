import {
  defaultEngineConfig,
  mergeEngineConfig,
  polygonArea,
  quadToPoints,
  type EngineConfig,
  type FrameProcessResult,
  type Point,
  type Quad,
} from '@docuscan/core-engine';
import { detectCapabilities, selectExecutionMode, type Capabilities } from '@docuscan/runtime-web';
import { warpPerspectiveCpu } from '@docuscan/warp-cpu';
import { warpPerspectiveWebGL } from '@docuscan/warp-webgl';
import {
  createDocuscanWorker,
  type WorkerDetectorConfig,
  type WorkerRequest,
  type WorkerResponse,
} from '@docuscan/worker-runtime';

type CandidateId = 'candidate-a' | 'candidate-b' | 'candidate-c';
type WorkerFrameTelemetry = Extract<WorkerResponse, { type: 'frame-result' }>['telemetry'];

interface WorkerFrameProcessResult {
  result: FrameProcessResult;
  telemetry?: WorkerFrameTelemetry;
}

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
  detectorTelemetry: DetectorTelemetry;
}

interface DetectionQualityBenchmark {
  documentFrames: number;
  nonDocumentFrames: number;
  iouAt085PassRate: number;
  falsePositiveRate: number;
  iou: Stats;
  detectorTelemetry: DetectorTelemetry;
}

interface WarpBenchmarkResult {
  ok: boolean;
  elapsedMs: number;
  budgetMs: number;
  withinBudget: boolean;
  reason?: string;
}

interface EndToEndBenchmark {
  success: boolean;
  stableReached: boolean;
  stableAtMs: number;
  captureTier: 'webgl' | 'cpu' | 'raw' | 'none';
  guidance: string;
  detectorSourceAtLock: 'cv' | 'ml' | 'none';
  detectorTelemetry: DetectorTelemetry;
}

interface CandidateProfile {
  id: CandidateId;
  name: string;
  detectorMode: 'cv' | 'hybrid' | 'ml';
  description: string;
  engineOverrides: Partial<EngineConfig>;
  detectorConfig: Partial<WorkerDetectorConfig>;
}

interface DetectorTelemetry {
  sourceFrames: {
    cv: number;
    ml: number;
  };
  fallbackFrames: {
    inactive: number;
    armed: number;
    active: number;
  };
  fallbackTransitions: {
    entered: number;
    exited: number;
  };
  firstMlInferenceMs: number | null;
}

interface BakeoffBenchResult {
  generatedAt: string;
  candidate: {
    id: CandidateId;
    name: string;
    detectorMode: CandidateProfile['detectorMode'];
    description: string;
  };
  configSnapshot: EngineConfig;
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
  detectionQuality: DetectionQualityBenchmark;
  warp: {
    webgl: WarpBenchmarkResult;
    cpu: WarpBenchmarkResult;
  };
  endToEnd: EndToEndBenchmark;
  detectorTelemetry: DetectorTelemetry;
  latency: {
    startupMs: number;
  };
  gates: {
    ingestionPass: boolean;
    detectionPass: boolean;
    qualityPass: boolean;
    webglPass: boolean;
    cpuPass: boolean;
    endToEndPass: boolean;
    overall: boolean;
  };
}

const CANDIDATES: Record<CandidateId, CandidateProfile> = {
  'candidate-a': {
    id: 'candidate-a',
    name: 'CV-only Hardened',
    detectorMode: 'cv',
    description: 'Primary CV path only; deterministic baseline.',
    engineOverrides: {
      confidenceThreshold: 0.55,
      minStableConfidence: 0.5,
      stabilityWindowMs: 650,
    },
    detectorConfig: {
      detectorMode: 'cv',
      mlFallbackEnabled: false,
    },
  },
  'candidate-b': {
    id: 'candidate-b',
    name: 'Hybrid Corner Fallback',
    detectorMode: 'hybrid',
    description: 'Contour-first CV with guarded TFJS corner fallback.',
    engineOverrides: {
      confidenceThreshold: 0.52,
      minStableConfidence: 0.46,
      stabilityWindowMs: 520,
    },
    detectorConfig: {
      detectorMode: 'hybrid',
      mlFallbackEnabled: true,
      mlFallbackFrameStride: 5,
      mlFallbackTriggerConsecutiveMisses: 8,
      mlFallbackMinCvConfidence: 0.35,
      mlFallbackExitConsecutiveCvRecoveries: 3,
      mlFallbackReentryCooldownFrames: 10,
      mlModelId: 'doc-corner-v1',
      mlInputSize: 320,
    },
  },
  'candidate-c': {
    id: 'candidate-c',
    name: 'Hybrid Strict Quality',
    detectorMode: 'hybrid',
    description: 'Hybrid fallback with stricter quality rejection profile.',
    engineOverrides: {
      confidenceThreshold: 0.53,
      minStableConfidence: 0.48,
      stabilityWindowMs: 680,
      glareRatioMax: 0.09,
    },
    detectorConfig: {
      detectorMode: 'hybrid',
      mlFallbackEnabled: true,
      mlFallbackFrameStride: 5,
      mlFallbackTriggerConsecutiveMisses: 8,
      mlFallbackMinCvConfidence: 0.35,
      mlFallbackExitConsecutiveCvRecoveries: 3,
      mlFallbackReentryCooldownFrames: 10,
      mlModelId: 'doc-corner-v1',
      mlInputSize: 320,
    },
  },
};

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

function createDetectorTelemetry(): DetectorTelemetry {
  return {
    sourceFrames: {
      cv: 0,
      ml: 0,
    },
    fallbackFrames: {
      inactive: 0,
      armed: 0,
      active: 0,
    },
    fallbackTransitions: {
      entered: 0,
      exited: 0,
    },
    firstMlInferenceMs: null,
  };
}

function mergeDetectorTelemetry(base: DetectorTelemetry, next: DetectorTelemetry): DetectorTelemetry {
  const firstMlInferenceMs =
    base.firstMlInferenceMs === null
      ? next.firstMlInferenceMs
      : next.firstMlInferenceMs === null
        ? base.firstMlInferenceMs
        : Math.min(base.firstMlInferenceMs, next.firstMlInferenceMs);
  return {
    sourceFrames: {
      cv: base.sourceFrames.cv + next.sourceFrames.cv,
      ml: base.sourceFrames.ml + next.sourceFrames.ml,
    },
    fallbackFrames: {
      inactive: base.fallbackFrames.inactive + next.fallbackFrames.inactive,
      armed: base.fallbackFrames.armed + next.fallbackFrames.armed,
      active: base.fallbackFrames.active + next.fallbackFrames.active,
    },
    fallbackTransitions: {
      entered: base.fallbackTransitions.entered + next.fallbackTransitions.entered,
      exited: base.fallbackTransitions.exited + next.fallbackTransitions.exited,
    },
    firstMlInferenceMs,
  };
}

function collectDetectorTelemetry(
  results: WorkerFrameProcessResult[],
  startedAtMs: number,
  frameTimestampsMs: number[],
): DetectorTelemetry {
  const telemetry = createDetectorTelemetry();
  let prevFallback: 'inactive' | 'armed' | 'active' | undefined;
  for (let index = 0; index < results.length; index += 1) {
    const frameResult = results[index];
    const result = frameResult.result;
    const detectionSource = frameResult.telemetry?.detectorSource ?? (result.detection.source === 'ml' ? 'ml' : 'cv');
    telemetry.sourceFrames[detectionSource] += 1;

    const fallbackState = frameResult.telemetry?.fallbackState ?? result.detection.debug?.fallbackState ?? 'inactive';
    telemetry.fallbackFrames[fallbackState] += 1;
    if (prevFallback !== undefined) {
      if (prevFallback !== 'active' && fallbackState === 'active') {
        telemetry.fallbackTransitions.entered += 1;
      } else if (prevFallback === 'active' && fallbackState !== 'active') {
        telemetry.fallbackTransitions.exited += 1;
      }
    }
    prevFallback = fallbackState;

    if (detectionSource === 'ml' && telemetry.firstMlInferenceMs === null) {
      const ts = frameTimestampsMs[index] ?? startedAtMs;
      telemetry.firstMlInferenceMs = Math.max(0, ts - startedAtMs);
    }
  }
  return telemetry;
}

function drawSyntheticDocument(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
): Quad {
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

  return {
    topLeft: { x: left, y: top },
    topRight: { x: left + docWidth, y: top },
    bottomRight: { x: left + docWidth, y: top + docHeight },
    bottomLeft: { x: left, y: top + docHeight },
  };
}

function drawNonDocumentScene(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
): void {
  ctx.fillStyle = '#151b24';
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 24; i += 1) {
    const seed = frameIndex * 17 + i * 13;
    const x = (seed * 19) % width;
    const y = (seed * 31) % height;
    const w = 20 + ((seed * 7) % 80);
    const h = 20 + ((seed * 11) % 90);
    const alpha = 0.15 + ((seed % 40) / 100);
    ctx.fillStyle = `rgba(115, 157, 206, ${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, Math.min(w, width - x), Math.min(h, height - y));
  }

  ctx.strokeStyle = 'rgba(230, 230, 230, 0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i += 1) {
    const x1 = ((frameIndex + i * 29) * 37) % width;
    const y1 = ((frameIndex + i * 11) * 23) % height;
    const x2 = ((frameIndex + i * 7) * 17) % width;
    const y2 = ((frameIndex + i * 5) * 41) % height;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
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

function polygonSignedArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return area / 2;
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
  const x4 = p4.x;
  const y4 = p4.y;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-8) {
    return { x: p2.x, y: p2.y };
  }

  const pre = x1 * y2 - y1 * x2;
  const post = x3 * y4 - y3 * x4;
  return {
    x: (pre * (x3 - x4) - (x1 - x2) * post) / den,
    y: (pre * (y3 - y4) - (y1 - y2) * post) / den,
  };
}

function isInside(point: Point, edgeStart: Point, edgeEnd: Point, orientation: 1 | -1): boolean {
  const cross =
    (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) -
    (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
  return orientation * cross >= -1e-8;
}

function intersectConvexPolygons(subject: Point[], clip: Point[]): Point[] {
  if (subject.length === 0 || clip.length === 0) {
    return [];
  }

  let output = [...subject];
  const orientation = polygonSignedArea(clip) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length; i += 1) {
    const cp1 = clip[i];
    const cp2 = clip[(i + 1) % clip.length];
    const input = [...output];
    output = [];
    if (input.length === 0) {
      break;
    }

    let s = input[input.length - 1];
    for (const e of input) {
      const eInside = isInside(e, cp1, cp2, orientation);
      const sInside = isInside(s, cp1, cp2, orientation);
      if (eInside) {
        if (!sInside) {
          output.push(lineIntersection(s, e, cp1, cp2));
        }
        output.push(e);
      } else if (sInside) {
        output.push(lineIntersection(s, e, cp1, cp2));
      }
      s = e;
    }
  }

  return output;
}

function quadIoU(a: Quad, b: Quad): number {
  const polygonA = quadToPoints(a);
  const polygonB = quadToPoints(b);
  const intersectionPolygon = intersectConvexPolygons(polygonA, polygonB);
  const intersectionArea = polygonArea(intersectionPolygon);
  const areaA = polygonArea(polygonA);
  const areaB = polygonArea(polygonB);
  const union = Math.max(1e-6, areaA + areaB - intersectionArea);
  return intersectionArea / union;
}

type PendingResolver = { resolve: (value: WorkerFrameProcessResult) => void; reject: (error: Error) => void };

async function createWorkerClient(
  engineConfig: EngineConfig,
  detectorConfig?: Partial<WorkerDetectorConfig>,
) {
  const worker = createDocuscanWorker();
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
          slot.resolve({
            result: message.result,
            telemetry: message.telemetry,
          });
        }
        return;
      }
      if (message.type === 'warning') {
        return;
      }
    };
  });

  worker.postMessage({
    type: 'init',
    config: engineConfig,
    detectorConfig,
  } satisfies WorkerRequest);
  await ready;

  return {
    async processRgba(width: number, height: number, rgbaBuffer: ArrayBuffer): Promise<WorkerFrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<WorkerFrameProcessResult>((resolve, reject) => {
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

    async processBitmap(bitmap: ImageBitmap): Promise<WorkerFrameProcessResult> {
      const id = ++frameId;
      const promise = new Promise<WorkerFrameProcessResult>((resolve, reject) => {
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

async function benchmarkStandardIngestion(
  engineConfig: EngineConfig,
  detectorConfig: Partial<WorkerDetectorConfig>,
  frameCount = 120,
): Promise<IngestionBenchmark> {
  const width = 480;
  const height = 672;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Standard ingestion canvas context missing');
  }

  const client = await createWorkerClient(engineConfig, detectorConfig);
  const roundtrip: number[] = [];
  const detectionMs: number[] = [];

  const t0 = performance.now();
  for (let i = 0; i < frameCount; i += 1) {
    drawSyntheticDocument(ctx, width, height, i);
    const readStart = performance.now();
    const imageData = ctx.getImageData(0, 0, width, height);
    const frameResult = await client.processRgba(width, height, imageData.data.buffer);
    const result = frameResult.result;
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

async function benchmarkBestIngestion(
  engineConfig: EngineConfig,
  detectorConfig: Partial<WorkerDetectorConfig>,
  frameCount = 120,
): Promise<IngestionBenchmark> {
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

  const client = await createWorkerClient(engineConfig, detectorConfig);
  const roundtrip: number[] = [];
  const detectionMs: number[] = [];
  const t0 = performance.now();

  for (let i = 0; i < frameCount; i += 1) {
    drawSyntheticDocument(ctx, width, height, i);
    const start = performance.now();
    const bitmap = offscreen.transferToImageBitmap();
    const frameResult = await client.processBitmap(bitmap);
    const result = frameResult.result;
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

async function benchmarkDetectionLoop(
  engineConfig: EngineConfig,
  detectorConfig: Partial<WorkerDetectorConfig>,
  frameCount = 220,
): Promise<DetectionLoopBenchmark> {
  const width = 480;
  const height = 672;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Detection benchmark canvas context missing');
  }

  const client = await createWorkerClient({
    ...engineConfig,
    debug: false,
  }, detectorConfig);

  const timings: number[] = [];
  const frameResults: WorkerFrameProcessResult[] = [];
  const frameTimestampsMs: number[] = [];
  let hardCeilingViolations = 0;
  const t0 = performance.now();
  try {
    for (let i = 0; i < frameCount; i += 1) {
      drawSyntheticDocument(ctx, width, height, i);
      const imageData = ctx.getImageData(0, 0, width, height);
      const frameResult = await client.processRgba(width, height, imageData.data.buffer);
      frameResults.push(frameResult);
      frameTimestampsMs.push(performance.now());
      const result = frameResult.result;
      const totalMs = result.detection.timings?.totalMs ?? 0;
      timings.push(totalMs);
      if (totalMs > engineConfig.workerHardCeilingMs) {
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
    detectorTelemetry: collectDetectorTelemetry(frameResults, t0, frameTimestampsMs),
  };
}

async function benchmarkDetectionQuality(
  engineConfig: EngineConfig,
  detectorConfig: Partial<WorkerDetectorConfig>,
  documentFrames = 180,
  nonDocumentFrames = 90,
): Promise<DetectionQualityBenchmark> {
  const width = 480;
  const height = 672;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Detection quality canvas context missing');
  }

  const client = await createWorkerClient({
    ...engineConfig,
    debug: false,
  }, detectorConfig);
  const ious: number[] = [];
  const frameResults: WorkerFrameProcessResult[] = [];
  const frameTimestampsMs: number[] = [];
  let iouPass = 0;
  let falsePositives = 0;
  const t0 = performance.now();

  try {
    for (let frame = 0; frame < documentFrames; frame += 1) {
      const groundTruth = drawSyntheticDocument(ctx, width, height, frame);
      const imageData = ctx.getImageData(0, 0, width, height);
      const frameResult = await client.processRgba(width, height, imageData.data.buffer);
      frameResults.push(frameResult);
      frameTimestampsMs.push(performance.now());
      const result = frameResult.result;
      if (result.detection.status === 'found' && result.detection.bestCandidate) {
        const iou = quadIoU(groundTruth, result.detection.bestCandidate.quad);
        ious.push(iou);
        if (iou >= 0.85) {
          iouPass += 1;
        }
      } else {
        ious.push(0);
      }
    }

    for (let frame = 0; frame < nonDocumentFrames; frame += 1) {
      drawNonDocumentScene(ctx, width, height, frame);
      const imageData = ctx.getImageData(0, 0, width, height);
      const frameResult = await client.processRgba(width, height, imageData.data.buffer);
      frameResults.push(frameResult);
      frameTimestampsMs.push(performance.now());
      const result = frameResult.result;
      if (result.detection.status === 'found') {
        falsePositives += 1;
      }
    }
  } finally {
    await client.destroy();
  }

  return {
    documentFrames,
    nonDocumentFrames,
    iouAt085PassRate: iouPass / Math.max(1, documentFrames),
    falsePositiveRate: falsePositives / Math.max(1, nonDocumentFrames),
    iou: computeStats(ious),
    detectorTelemetry: collectDetectorTelemetry(frameResults, t0, frameTimestampsMs),
  };
}

function benchmarkWarpWebgl(imageData: ImageData, quad: Quad): WarpBenchmarkResult {
  const result = warpPerspectiveWebGL({
    imageData,
    quad,
    outputWidth: imageData.width,
    outputHeight: imageData.height,
    budgetMs: 50,
  });
  return {
    ok: result.ok,
    elapsedMs: result.elapsedMs,
    budgetMs: 50,
    withinBudget: result.ok && result.elapsedMs <= 50,
    reason: result.reason,
  };
}

function benchmarkWarpCpu(imageData: ImageData, quad: Quad): WarpBenchmarkResult {
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

async function benchmarkEndToEndFlow(
  engineConfig: EngineConfig,
  detectorConfig: Partial<WorkerDetectorConfig>,
): Promise<EndToEndBenchmark> {
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
      detectorSourceAtLock: 'none',
      detectorTelemetry: createDetectorTelemetry(),
    };
  }

  const client = await createWorkerClient({
    ...engineConfig,
    debug: false,
  }, detectorConfig);
  let stableAtMs = 0;
  let detectorSourceAtLock: 'cv' | 'ml' | 'none' = 'none';
  let bestCandidate = undefined as FrameProcessResult['detection']['bestCandidate'];
  let guidance = 'DOCUMENT_NOT_FOUND';
  const frameResults: WorkerFrameProcessResult[] = [];
  const frameTimestampsMs: number[] = [];
  const t0 = performance.now();
  try {
    for (let frame = 0; frame < 80; frame += 1) {
      drawSyntheticDocument(detectCtx, detectWidth, detectHeight, frame);
      const imageData = detectCtx.getImageData(0, 0, detectWidth, detectHeight);
      const frameResult = await client.processRgba(detectWidth, detectHeight, imageData.data.buffer);
      frameResults.push(frameResult);
      frameTimestampsMs.push(performance.now());
      const result = frameResult.result;
      guidance = result.guidance;
      bestCandidate = result.detection.bestCandidate;
      if (result.detection.status === 'found' && result.quality?.ok && result.stability?.stable) {
        stableAtMs = frame * 33;
        detectorSourceAtLock = result.detection.source;
        break;
      }
    }
  } finally {
    await client.destroy();
  }

  if (!bestCandidate || stableAtMs === 0) {
    return {
      success: false,
      stableReached: false,
      stableAtMs,
      captureTier: 'none',
      guidance,
      detectorSourceAtLock: 'none',
      detectorTelemetry: collectDetectorTelemetry(frameResults, t0, frameTimestampsMs),
    };
  }

  const captureImage = createSyntheticImageData(1600, 2200);
  const sx = captureImage.width / detectWidth;
  const sy = captureImage.height / detectHeight;
  const scaledQuad: Quad = {
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
      detectorSourceAtLock,
      detectorTelemetry: collectDetectorTelemetry(frameResults, t0, frameTimestampsMs),
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
      detectorSourceAtLock,
      detectorTelemetry: collectDetectorTelemetry(frameResults, t0, frameTimestampsMs),
    };
  }

  return {
    success: true,
    stableReached: true,
    stableAtMs,
    captureTier: 'raw',
    guidance,
    detectorSourceAtLock,
    detectorTelemetry: collectDetectorTelemetry(frameResults, t0, frameTimestampsMs),
  };
}

function resolveCandidateProfile(candidateParam?: string | null): CandidateProfile {
  const normalized = (candidateParam ?? '').toLowerCase() as CandidateId;
  if (normalized in CANDIDATES) {
    return CANDIDATES[normalized];
  }
  return CANDIDATES['candidate-a'];
}

export async function runBakeoffBench(candidateParam?: string | null): Promise<BakeoffBenchResult> {
  const startupStart = performance.now();
  const candidate = resolveCandidateProfile(candidateParam);
  const engineConfig = mergeEngineConfig({
    ...defaultEngineConfig,
    ...candidate.engineOverrides,
    debug: false,
  });

  const capabilities = await detectCapabilities();
  const startupMs = performance.now() - startupStart;
  const [standard, best] = await Promise.all([
    benchmarkStandardIngestion(engineConfig, candidate.detectorConfig),
    benchmarkBestIngestion(engineConfig, candidate.detectorConfig),
  ]);

  const [detectionLoop, detectionQuality] = await Promise.all([
    benchmarkDetectionLoop(engineConfig, candidate.detectorConfig),
    benchmarkDetectionQuality(engineConfig, candidate.detectorConfig),
  ]);
  const warpInput = createSyntheticImageData(1600, 2200);
  const warpQuad: Quad = {
    topLeft: { x: 190, y: 140 },
    topRight: { x: 1400, y: 175 },
    bottomRight: { x: 1460, y: 2050 },
    bottomLeft: { x: 155, y: 2010 },
  };
  const warpWebgl = benchmarkWarpWebgl(warpInput, warpQuad);
  const warpCpu = benchmarkWarpCpu(warpInput, warpQuad);
  const endToEnd = await benchmarkEndToEndFlow(engineConfig, candidate.detectorConfig);
  const detectorTelemetry = mergeDetectorTelemetry(
    mergeDetectorTelemetry(detectionLoop.detectorTelemetry, detectionQuality.detectorTelemetry),
    endToEnd.detectorTelemetry,
  );

  const ingestionPass = standard.fps >= 20;
  const detectionPass =
    detectionLoop.stageTotalMs.median <= engineConfig.detectionFrameBudgetMs &&
    detectionLoop.stageTotalMs.p95 <= engineConfig.workerHardCeilingMs;
  const qualityPass =
    detectionQuality.iouAt085PassRate >= 0.85 && detectionQuality.falsePositiveRate <= 0.02;
  const webglPass = !capabilities.webglMainSupported || warpWebgl.withinBudget;
  const cpuPass = warpCpu.withinBudget;
  const endToEndPass = endToEnd.success && endToEnd.stableReached && endToEnd.stableAtMs <= 2000;

  return {
    generatedAt: new Date().toISOString(),
    candidate: {
      id: candidate.id,
      name: candidate.name,
      detectorMode: candidate.detectorMode,
      description: candidate.description,
    },
    configSnapshot: engineConfig,
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
    detectionQuality,
    warp: {
      webgl: warpWebgl,
      cpu: warpCpu,
    },
    endToEnd,
    detectorTelemetry,
    latency: {
      startupMs,
    },
    gates: {
      ingestionPass,
      detectionPass,
      qualityPass,
      webglPass,
      cpuPass,
      endToEndPass,
      overall:
        ingestionPass &&
        detectionPass &&
        qualityPass &&
        webglPass &&
        cpuPass &&
        endToEndPass,
    },
  };
}
