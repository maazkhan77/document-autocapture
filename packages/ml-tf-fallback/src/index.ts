import { clamp, orderQuadCorners, quadArea, quadPerimeter, quadToPoints, type Quad } from '@docuscan/core-engine';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface TfjsGraphModel {
  executeAsync: (input: any) => Promise<any | any[]>;
}

interface TfjsModule {
  ready: () => Promise<void>;
  setBackend: (backend: string) => Promise<boolean>;
  tensor3d: (values: Uint8ClampedArray, shape: [number, number, number], dtype: 'int32' | 'float32') => any;
  tidy: <T>(fn: () => T) => T;
  image: {
    resizeBilinear: (images: any, size: [number, number], alignCorners?: boolean) => any;
  };
  pad: (tensor: any, paddings: number[][], constantValue?: number) => any;
  dispose: (tensors: any | any[]) => void;
  loadGraphModel: (url: string) => Promise<TfjsGraphModel>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface TfjsTensorLike {
  data: () => Promise<ArrayLike<number>>;
}

interface TfjsBackendWasmModule {
  setWasmPaths: (pathMapOrPrefix: string | Record<string, string>) => void;
}

type TfjsBackendName = 'wasm' | 'cpu';

export interface MlQuadProviderConfig {
  modelId?: string;
  modelUrl?: string;
  modelBaseUrl?: string;
  wasmBaseUrl?: string;
  inputSize?: number;
  debug?: boolean;
}

export interface MlQuadInferenceInput {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MlQuadInferenceResult {
  quad: Quad;
  confidence: number;
  source: 'ml';
}

export interface MlQuadProviderDiagnostics {
  backend: string;
  modelLoaded: boolean;
  artifactUrl?: string;
  modelVersion?: string;
  decodeMode?: 'heuristic' | 'graph_coords_score_logit' | 'graph_coords_only' | 'graph_legacy_single_tensor';
  lastError?: string;
}

export interface MlQuadProvider {
  init(config?: MlQuadProviderConfig): Promise<void>;
  infer(input: MlQuadInferenceInput): Promise<MlQuadInferenceResult | undefined>;
  isReady(): boolean;
  getDiagnostics(): MlQuadProviderDiagnostics;
}

interface CornerArtifact {
  id?: string;
  kind?: string;
  version?: number;
  modelVersion?: string;
  inputSize?: number;
  inputNormalization?: 'zero_one' | 'imagenet';
  edgePercentile?: number;
  paddingRatio?: number;
  minAreaFraction?: number;
  maxAreaFraction?: number;
  minConfidence?: number;
  outputFormat?: 'coords_score_logit' | 'coords_only';
  scoreMode?: 'logit' | 'probability' | 'fixed';
  confidenceCalibration?: Partial<ConfidenceCalibration>;
  graphModelUrl?: string | null;
}

interface ConfidenceCalibration {
  base: number;
  scoreWeight: number;
  edgeWeight: number;
  sizeWeight: number;
  min: number;
  max: number;
}

interface DecodedModelOutputs {
  coords: number[];
  scoreRaw?: number;
  decodeMode: 'graph_coords_score_logit' | 'graph_coords_only' | 'graph_legacy_single_tensor';
}

interface LoadedCornerArtifact {
  modelVersion: string;
  inputSize: number;
  inputNormalization: 'zero_one' | 'imagenet';
  edgePercentile: number;
  paddingRatio: number;
  minAreaFraction: number;
  maxAreaFraction: number;
  minConfidence: number;
  outputFormat: 'coords_score_logit' | 'coords_only';
  scoreMode: 'logit' | 'probability' | 'fixed';
  confidenceCalibration: ConfidenceCalibration;
  graphModelUrl?: string | null;
}

interface LetterboxTransform {
  size: number;
  scaledWidth: number;
  scaledHeight: number;
  scale: number;
  padLeft: number;
  padTop: number;
}

function safeUrl(base: string, relative: string): string {
  const looksLikeFile = /\/[^/]+\.[^/]+(?:[?#].*)?$/.test(base);
  const normalizedBase = base.endsWith('/') || looksLikeFile ? base : `${base}/`;
  return new URL(relative, normalizedBase).toString();
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))));
  return sorted[index];
}

function findBounds(profile: number[], threshold: number): { start: number; end: number } | undefined {
  if (profile.length < 4) {
    return undefined;
  }
  let start = 0;
  while (start < profile.length && profile[start] < threshold) {
    start += 1;
  }
  let end = profile.length - 1;
  while (end > start && profile[end] < threshold) {
    end -= 1;
  }
  if (end - start < Math.round(profile.length * 0.1)) {
    return undefined;
  }
  return { start, end };
}

function isFiniteQuad(quad: Quad): boolean {
  const points = quadToPoints(quad);
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const ccw = (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) =>
    (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}

function isSelfIntersectingQuad(quad: Quad): boolean {
  const points = quadToPoints(quad);
  return (
    segmentsIntersect(points[0], points[1], points[2], points[3]) ||
    segmentsIntersect(points[1], points[2], points[3], points[0])
  );
}

function calcAspectRatio(quad: Quad): number {
  const top = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  const bottom = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
  const left = Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y);
  const right = Math.hypot(quad.bottomRight.x - quad.topRight.x, quad.bottomRight.y - quad.topRight.y);
  const width = (top + bottom) * 0.5;
  const height = (left + right) * 0.5;
  if (height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return width / height;
}

function computeLetterboxTransform(width: number, height: number, size: number): LetterboxTransform {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safeSize = Math.max(8, size);
  const scale = Math.min(safeSize / safeWidth, safeSize / safeHeight);
  const scaledWidth = Math.max(1, Math.round(safeWidth * scale));
  const scaledHeight = Math.max(1, Math.round(safeHeight * scale));
  const padLeft = Math.max(0, Math.floor((safeSize - scaledWidth) / 2));
  const padTop = Math.max(0, Math.floor((safeSize - scaledHeight) / 2));
  return {
    size: safeSize,
    scaledWidth,
    scaledHeight,
    scale,
    padLeft,
    padTop,
  };
}

function mapLetterboxPointToFrame(
  x: number,
  y: number,
  transform: LetterboxTransform,
  width: number,
  height: number,
): { x: number; y: number } {
  const unpaddedX = (x - transform.padLeft) / Math.max(1e-6, transform.scale);
  const unpaddedY = (y - transform.padTop) / Math.max(1e-6, transform.scale);
  return {
    x: clamp(unpaddedX, 0, width - 1),
    y: clamp(unpaddedY, 0, height - 1),
  };
}

function sigmoid(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function normalizeCalibration(input?: Partial<ConfidenceCalibration>): ConfidenceCalibration {
  const calibration: ConfidenceCalibration = {
    base: 0.05,
    scoreWeight: 0.67,
    edgeWeight: 0.18,
    sizeWeight: 0.15,
    min: 0,
    max: 1,
  };
  if (!input) {
    return calibration;
  }
  calibration.base = clamp(input.base ?? calibration.base, -1, 1);
  calibration.scoreWeight = clamp(input.scoreWeight ?? calibration.scoreWeight, 0, 2);
  calibration.edgeWeight = clamp(input.edgeWeight ?? calibration.edgeWeight, 0, 2);
  calibration.sizeWeight = clamp(input.sizeWeight ?? calibration.sizeWeight, 0, 2);
  calibration.min = clamp(input.min ?? calibration.min, 0, 1);
  calibration.max = clamp(input.max ?? calibration.max, calibration.min, 1);
  return calibration;
}

function computeSizeConfidence(areaFraction: number, minAreaFraction: number, maxAreaFraction: number): number {
  if (areaFraction < minAreaFraction) {
    return clamp(areaFraction / Math.max(0.0001, minAreaFraction), 0, 1);
  }
  if (areaFraction > maxAreaFraction) {
    return clamp(maxAreaFraction / Math.max(0.0001, areaFraction), 0, 1);
  }
  return 1;
}

function estimateQuadEdgeSupport(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  threshold = 20,
): number {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let hits = 0;
  let total = 0;

  const luma = (x: number, y: number): number => {
    const sx = Math.max(0, Math.min(width - 1, x));
    const sy = Math.max(0, Math.min(height - 1, y));
    const idx = (sy * width + sx) * 4;
    return 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
  };

  for (let edge = 0; edge < 4; edge += 1) {
    const start = points[edge];
    const end = points[(edge + 1) % 4];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t);
      const gx = Math.abs(luma(x + 1, y) - luma(x - 1, y));
      const gy = Math.abs(luma(x, y + 1) - luma(x, y - 1));
      total += 1;
      if (gx + gy >= threshold) {
        hits += 1;
      }
    }
  }

  return clamp(hits / Math.max(1, total), 0, 1);
}

function computeCalibratedConfidence(
  scoreProb: number,
  edgeSupport: number,
  sizeConfidence: number,
  calibration: ConfidenceCalibration,
): number {
  const raw =
    calibration.base +
    calibration.scoreWeight * clamp(scoreProb, 0, 1) +
    calibration.edgeWeight * clamp(edgeSupport, 0, 1) +
    calibration.sizeWeight * clamp(sizeConfidence, 0, 1);
  return clamp(raw, calibration.min, calibration.max);
}

function pickCoordsAndScoreFromValues(
  valueSets: number[][],
  outputFormat: 'coords_score_logit' | 'coords_only',
): DecodedModelOutputs | undefined {
  const coordsCandidates = valueSets.filter((values) => values.length >= 8);
  if (coordsCandidates.length === 0) {
    return undefined;
  }

  if (outputFormat === 'coords_score_logit') {
    const coords = coordsCandidates.find((values) => values.length === 8) ?? coordsCandidates[0];
    const scoreValues =
      valueSets.find((values) => values.length === 1) ??
      valueSets.find((values) => values.length > 8 && values.length < 32);
    return {
      coords: coords.slice(0, 8),
      scoreRaw: scoreValues ? Number(scoreValues[0] ?? 0) : undefined,
      decodeMode: 'graph_coords_score_logit',
    };
  }

  const coords = coordsCandidates.find((values) => values.length === 8) ?? coordsCandidates[0];
  return {
    coords: coords.slice(0, 8),
    decodeMode: 'graph_coords_only',
  };
}

function sanitizeQuad(quad: Quad, width: number, height: number): Quad {
  const ordered = orderQuadCorners(quad);
  return {
    topLeft: {
      x: clamp(ordered.topLeft.x, 0, width - 1),
      y: clamp(ordered.topLeft.y, 0, height - 1),
    },
    topRight: {
      x: clamp(ordered.topRight.x, 0, width - 1),
      y: clamp(ordered.topRight.y, 0, height - 1),
    },
    bottomRight: {
      x: clamp(ordered.bottomRight.x, 0, width - 1),
      y: clamp(ordered.bottomRight.y, 0, height - 1),
    },
    bottomLeft: {
      x: clamp(ordered.bottomLeft.x, 0, width - 1),
      y: clamp(ordered.bottomLeft.y, 0, height - 1),
    },
  };
}

function isValidQuadShape(quad: Quad, width: number, height: number, minAreaFraction: number, maxAreaFraction: number): boolean {
  if (!isFiniteQuad(quad)) {
    return false;
  }
  if (isSelfIntersectingQuad(quad)) {
    return false;
  }
  const areaFraction = quadArea(quad) / Math.max(1, width * height);
  if (areaFraction < minAreaFraction || areaFraction > maxAreaFraction) {
    return false;
  }
  const aspect = calcAspectRatio(quad);
  if (aspect < 0.4 || aspect > 3.0) {
    return false;
  }
  const perimeter = quadPerimeter(quad);
  if (!Number.isFinite(perimeter) || perimeter < 40) {
    return false;
  }
  const borderTouches = quadToPoints(quad).filter(
    (point) => point.x <= 1 || point.y <= 1 || point.x >= width - 2 || point.y >= height - 2,
  ).length;
  if (borderTouches > 2) {
    return false;
  }
  return true;
}

export function resolveModelUrl(modelId = 'doc-corner-v1', modelBaseUrl?: string): string {
  if (modelBaseUrl) {
    return safeUrl(modelBaseUrl, `${modelId}/artifact.json`);
  }
  return new URL(`../models/${modelId}/artifact.json`, import.meta.url).toString();
}

class TfjsCornerProvider implements MlQuadProvider {
  private tf?: TfjsModule;

  private model: TfjsGraphModel | undefined;

  private ready = false;

  private artifact: LoadedCornerArtifact = {
    modelVersion: 'doc-corner-v1',
    inputSize: 320,
    inputNormalization: 'zero_one',
    edgePercentile: 62,
    paddingRatio: 0.04,
    minAreaFraction: 0.05,
    maxAreaFraction: 0.96,
    minConfidence: 0.12,
    outputFormat: 'coords_only',
    scoreMode: 'fixed',
    confidenceCalibration: normalizeCalibration(undefined),
    graphModelUrl: undefined,
  };

  private diagnostics: MlQuadProviderDiagnostics = {
    backend: 'uninitialized',
    modelLoaded: false,
    modelVersion: 'doc-corner-v1',
    decodeMode: 'heuristic',
  };

  private config: MlQuadProviderConfig = {};

  private async initBackend(tf: TfjsModule, config: MlQuadProviderConfig): Promise<TfjsBackendName> {
    if (!config.wasmBaseUrl) {
      const cpuReady = await tf.setBackend('cpu');
      if (!cpuReady) {
        throw new Error('tf.setBackend("cpu") returned false');
      }
      await tf.ready();
      return 'cpu';
    }

    try {
      const wasm = (await import('@tensorflow/tfjs-backend-wasm')) as unknown as TfjsBackendWasmModule;
      if (config.wasmBaseUrl) {
        wasm.setWasmPaths(config.wasmBaseUrl);
      }
      const wasmReady = await tf.setBackend('wasm');
      if (!wasmReady) {
        throw new Error('tf.setBackend("wasm") returned false');
      }
      await tf.ready();
      return 'wasm';
    } catch (wasmError) {
      const cpuReady = await tf.setBackend('cpu');
      if (!cpuReady) {
        throw new Error(
          `Failed to initialize TFJS backends (wasm + cpu): ${
            wasmError instanceof Error ? wasmError.message : 'unknown wasm error'
          }`,
        );
      }
      await tf.ready();
      if (config.debug) {
        console.warn('[docuscan:ml] WASM backend unavailable, using CPU backend', wasmError);
      }
      return 'cpu';
    }
  }

  async init(config: MlQuadProviderConfig = {}): Promise<void> {
    this.config = config;
    this.ready = false;
    this.model = undefined;
    this.diagnostics = {
      backend: 'initializing',
      modelLoaded: false,
      modelVersion: this.artifact.modelVersion,
      decodeMode: 'heuristic',
    };

    try {
      const tf = (await import('@tensorflow/tfjs')) as unknown as TfjsModule;
      this.tf = tf;
      this.diagnostics.backend = await this.initBackend(tf, config);

      const artifactUrl = config.modelUrl ?? resolveModelUrl(config.modelId ?? 'doc-corner-v1', config.modelBaseUrl);
      this.diagnostics.artifactUrl = artifactUrl;
      await this.loadArtifact(artifactUrl);
      this.diagnostics.modelVersion = this.artifact.modelVersion;

      if (this.artifact.graphModelUrl) {
        const modelUrl = this.artifact.graphModelUrl.startsWith('http')
          ? this.artifact.graphModelUrl
          : safeUrl(artifactUrl, this.artifact.graphModelUrl);
        try {
          this.model = await tf.loadGraphModel(modelUrl);
          this.diagnostics.modelLoaded = true;
          this.diagnostics.decodeMode =
            this.artifact.outputFormat === 'coords_score_logit'
              ? 'graph_coords_score_logit'
              : this.artifact.outputFormat === 'coords_only'
                ? 'graph_coords_only'
                : 'graph_legacy_single_tensor';
        } catch (error) {
          this.model = undefined;
          this.diagnostics.modelLoaded = false;
          this.diagnostics.decodeMode = 'heuristic';
          this.diagnostics.lastError =
            error instanceof Error ? `Graph model load failed: ${error.message}` : 'Graph model load failed';
        }
      }

      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.diagnostics.backend = 'failed';
      this.diagnostics.lastError = error instanceof Error ? error.message : 'TFJS initialization failed';
      throw error instanceof Error ? error : new Error('TFJS initialization failed');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  getDiagnostics(): MlQuadProviderDiagnostics {
    return { ...this.diagnostics };
  }

  async infer(input: MlQuadInferenceInput): Promise<MlQuadInferenceResult | undefined> {
    if (!this.ready || !this.tf) {
      return undefined;
    }

    if (this.model) {
      const modelResult = await this.inferWithModel(input);
      if (modelResult) {
        return modelResult;
      }
    }

    return this.inferHeuristic(input);
  }

  private async loadArtifact(url: string): Promise<void> {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) {
        throw new Error(`artifact fetch failed (${response.status})`);
      }
      const artifact = (await response.json()) as CornerArtifact;
      this.artifact = {
        modelVersion: artifact.modelVersion ?? artifact.id ?? this.artifact.modelVersion,
        inputSize: Math.max(128, Math.min(640, Math.round(artifact.inputSize ?? this.artifact.inputSize))),
        inputNormalization: artifact.inputNormalization === 'imagenet' ? 'imagenet' : 'zero_one',
        edgePercentile: clamp(artifact.edgePercentile ?? this.artifact.edgePercentile, 20, 95),
        paddingRatio: clamp(artifact.paddingRatio ?? this.artifact.paddingRatio, 0, 0.2),
        minAreaFraction: clamp(artifact.minAreaFraction ?? this.artifact.minAreaFraction, 0.01, 0.6),
        maxAreaFraction: clamp(artifact.maxAreaFraction ?? this.artifact.maxAreaFraction, 0.4, 0.99),
        minConfidence: clamp(artifact.minConfidence ?? this.artifact.minConfidence, 0, 1),
        outputFormat: artifact.outputFormat === 'coords_score_logit' ? 'coords_score_logit' : 'coords_only',
        scoreMode:
          artifact.scoreMode === 'logit' || artifact.scoreMode === 'probability' || artifact.scoreMode === 'fixed'
            ? artifact.scoreMode
            : artifact.outputFormat === 'coords_score_logit'
              ? 'logit'
              : 'fixed',
        confidenceCalibration: normalizeCalibration(artifact.confidenceCalibration),
        graphModelUrl: artifact.graphModelUrl ?? undefined,
      };
      this.diagnostics.modelVersion = this.artifact.modelVersion;
    } catch (error) {
      if (this.config.debug) {
        console.warn('[docuscan:ml] fallback artifact load failed, using defaults', error);
      }
      this.diagnostics.lastError = error instanceof Error ? error.message : 'Artifact load failed';
    }
  }

  private async inferWithModel(input: MlQuadInferenceInput): Promise<MlQuadInferenceResult | undefined> {
    if (!this.tf || !this.model) {
      return undefined;
    }

    try {
      const size = this.artifact.inputSize;
      const letterbox = computeLetterboxTransform(input.width, input.height, size);
      const tensor = this.tf.tidy(() => {
        const src = this.tf!.tensor3d(input.rgba, [input.height, input.width, 4], 'int32');
        const rgb01 = src.slice([0, 0, 0], [input.height, input.width, 3]).toFloat().div(255);
        const normalized =
          this.artifact.inputNormalization === 'imagenet'
            ? rgb01.sub([0.485, 0.456, 0.406]).div([0.229, 0.224, 0.225])
            : rgb01;
        const resized = this.tf!.image.resizeBilinear(
          normalized.expandDims(0),
          [letterbox.scaledHeight, letterbox.scaledWidth],
          true,
        );
        const padBottom = Math.max(0, size - letterbox.scaledHeight - letterbox.padTop);
        const padRight = Math.max(0, size - letterbox.scaledWidth - letterbox.padLeft);
        return this.tf!.pad(
          resized,
          [
            [0, 0],
            [letterbox.padTop, padBottom],
            [letterbox.padLeft, padRight],
            [0, 0],
          ],
          0,
        );
      });

      const output = await this.model.executeAsync(tensor);
      this.tf.dispose(tensor);

      const outputTensors: TfjsTensorLike[] = Array.isArray(output)
        ? (output as TfjsTensorLike[])
        : output && typeof output === 'object'
          ? (Object.values(output as Record<string, unknown>) as TfjsTensorLike[])
          : output
            ? [output as TfjsTensorLike]
            : [];
      if (outputTensors.length === 0) {
        return undefined;
      }

      const valuesByTensor = await Promise.all(
        outputTensors.map(async (tensorValue) => {
          const raw = Array.from((await tensorValue.data()) as ArrayLike<number>, (value) => Number(value));
          return raw;
        }),
      );
      this.tf.dispose(outputTensors);

      let decoded = pickCoordsAndScoreFromValues(valuesByTensor, this.artifact.outputFormat);
      if (!decoded && valuesByTensor[0]?.length >= 8) {
        decoded = {
          coords: valuesByTensor[0].slice(0, 8),
          scoreRaw: valuesByTensor[0].length > 8 ? Number(valuesByTensor[0][8]) : undefined,
          decodeMode: 'graph_legacy_single_tensor',
        };
      }
      if (!decoded) {
        return undefined;
      }
      this.diagnostics.decodeMode = decoded.decodeMode;

      const maxValue = Math.max(...decoded.coords.map((value) => Math.abs(value)));
      const normalizedCoords = maxValue <= 1.5;

      const decode = (value: number): number => {
        if (normalizedCoords) {
          return value * size;
        }
        return value;
      };

      const quad = sanitizeQuad(
        {
          topLeft: mapLetterboxPointToFrame(decode(decoded.coords[0]), decode(decoded.coords[1]), letterbox, input.width, input.height),
          topRight: mapLetterboxPointToFrame(decode(decoded.coords[2]), decode(decoded.coords[3]), letterbox, input.width, input.height),
          bottomRight: mapLetterboxPointToFrame(decode(decoded.coords[4]), decode(decoded.coords[5]), letterbox, input.width, input.height),
          bottomLeft: mapLetterboxPointToFrame(decode(decoded.coords[6]), decode(decoded.coords[7]), letterbox, input.width, input.height),
        },
        input.width,
        input.height,
      );

      if (!isValidQuadShape(quad, input.width, input.height, this.artifact.minAreaFraction, this.artifact.maxAreaFraction)) {
        return undefined;
      }

      const areaFraction = quadArea(quad) / Math.max(1, input.width * input.height);
      const sizeConfidence = computeSizeConfidence(
        areaFraction,
        this.artifact.minAreaFraction,
        this.artifact.maxAreaFraction,
      );
      const edgeSupport = estimateQuadEdgeSupport(input.rgba, input.width, input.height, quad);
      let scoreProb = 1;
      if (this.artifact.scoreMode === 'logit') {
        scoreProb = sigmoid(Number(decoded.scoreRaw ?? 0));
      } else if (this.artifact.scoreMode === 'probability') {
        scoreProb = clamp(Number(decoded.scoreRaw ?? 0), 0, 1);
      } else if (this.artifact.scoreMode === 'fixed') {
        scoreProb = decoded.scoreRaw === undefined ? 1 : clamp(Number(decoded.scoreRaw), 0, 1);
      }
      const confidence = computeCalibratedConfidence(
        scoreProb,
        edgeSupport,
        sizeConfidence,
        this.artifact.confidenceCalibration,
      );
      if (confidence < this.artifact.minConfidence) {
        return undefined;
      }

      return {
        quad,
        confidence,
        source: 'ml',
      };
    } catch (error) {
      this.diagnostics.lastError =
        error instanceof Error ? `Model inference failed: ${error.message}` : 'Model inference failed';
      return undefined;
    }
  }

  private inferHeuristic(input: MlQuadInferenceInput): MlQuadInferenceResult | undefined {
    if (!this.tf) {
      return undefined;
    }
    this.diagnostics.decodeMode = 'heuristic';

    const size = this.artifact.inputSize;

    const packed = this.tf.tidy(() => {
      const src = this.tf!.tensor3d(input.rgba, [input.height, input.width, 4], 'int32');
      const rgb = src.slice([0, 0, 0], [input.height, input.width, 3]).toFloat();
      const gray = rgb
        .slice([0, 0, 0], [input.height, input.width, 1])
        .mul(0.299)
        .add(rgb.slice([0, 0, 1], [input.height, input.width, 1]).mul(0.587))
        .add(rgb.slice([0, 0, 2], [input.height, input.width, 1]).mul(0.114));

      const resized = this.tf!.image.resizeBilinear(gray.expandDims(0), [size, size], true);

      const left = resized.slice([0, 0, 0, 0], [1, size, size - 1, 1]);
      const right = resized.slice([0, 0, 1, 0], [1, size, size - 1, 1]);
      const top = resized.slice([0, 0, 0, 0], [1, size - 1, size, 1]);
      const bottom = resized.slice([0, 1, 0, 0], [1, size - 1, size, 1]);

      const dx = right.sub(left).abs();
      const dy = bottom.sub(top).abs();
      const dxPad = this.tf!.pad(dx, [[0, 0], [0, 0], [0, 1], [0, 0]]);
      const dyPad = this.tf!.pad(dy, [[0, 0], [0, 1], [0, 0], [0, 0]]);
      const edges = dxPad.add(dyPad);

      const xProfile = edges.mean([0, 1, 3]);
      const yProfile = edges.mean([0, 2, 3]);
      const edgeMean = edges.mean();

      return { xProfile, yProfile, edgeMean };
    });

    const xVals = Array.from(packed.xProfile.dataSync() as Float32Array);
    const yVals = Array.from(packed.yProfile.dataSync() as Float32Array);
    const edgeMean = Number((packed.edgeMean.dataSync() as Float32Array)[0] ?? 0);
    this.tf.dispose([packed.xProfile, packed.yProfile, packed.edgeMean]);

    const xThreshold = percentile(xVals, this.artifact.edgePercentile);
    const yThreshold = percentile(yVals, this.artifact.edgePercentile);

    const xBounds = findBounds(xVals, xThreshold);
    const yBounds = findBounds(yVals, yThreshold);
    if (!xBounds || !yBounds) {
      return undefined;
    }

    const sx = input.width / size;
    const sy = input.height / size;
    const padPx = this.artifact.paddingRatio * Math.min(input.width, input.height);

    const left = clamp(xBounds.start * sx - padPx, 0, input.width - 1);
    const right = clamp((xBounds.end + 1) * sx + padPx, 0, input.width - 1);
    const top = clamp(yBounds.start * sy - padPx, 0, input.height - 1);
    const bottom = clamp((yBounds.end + 1) * sy + padPx, 0, input.height - 1);

    const quad = sanitizeQuad(
      {
        topLeft: { x: left, y: top },
        topRight: { x: right, y: top },
        bottomRight: { x: right, y: bottom },
        bottomLeft: { x: left, y: bottom },
      },
      input.width,
      input.height,
    );

    if (!isValidQuadShape(quad, input.width, input.height, this.artifact.minAreaFraction, this.artifact.maxAreaFraction)) {
      return undefined;
    }

    const areaFraction = quadArea(quad) / Math.max(1, input.width * input.height);
    const sizeConfidence = areaFraction < this.artifact.minAreaFraction
      ? areaFraction / Math.max(0.0001, this.artifact.minAreaFraction)
      : areaFraction > this.artifact.maxAreaFraction
        ? this.artifact.maxAreaFraction / Math.max(0.0001, areaFraction)
        : 1;
    const edgeConfidence = clamp(edgeMean / 28, 0, 1);
    const confidence = clamp(0.45 + edgeConfidence * 0.50, 0, 1) * clamp(sizeConfidence, 0, 1);

    if (confidence < this.artifact.minConfidence) {
      return undefined;
    }

    return {
      quad,
      confidence,
      source: 'ml',
    };
  }
}

export function createTfjsMlQuadProvider(): MlQuadProvider {
  return new TfjsCornerProvider();
}

export const __testUtils = {
  computeLetterboxTransform,
  mapLetterboxPointToFrame,
  sigmoid,
  normalizeCalibration,
  computeSizeConfidence,
  computeCalibratedConfidence,
  pickCoordsAndScoreFromValues,
  safeUrl,
};
