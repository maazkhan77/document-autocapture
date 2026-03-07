import { borderPenalty, clamp, type Quad } from '@document-autocapture/core-engine';

type CocoBase = 'lite_mobilenet_v2' | 'mobilenet_v2' | 'mobilenet_v1';

interface CocoPrediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

interface CocoModelLike {
  detect: (input: ImageData, maxNumBoxes?: number, minScore?: number) => Promise<CocoPrediction[]>;
}

interface TfjsLike {
  ready: () => Promise<void>;
  getBackend: () => string;
  setBackend: (backend: string) => Promise<boolean>;
}

interface CocoSsdLike {
  load: (config?: { base?: CocoBase }) => Promise<CocoModelLike>;
}

export interface CocoQuadProviderConfig {
  modelBase?: CocoBase;
  debug?: boolean;
}

export interface CocoQuadInferenceInput {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  minScore: number;
  minAreaFraction: number;
  maxAreaFraction: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  edgeTouchMarginPx: number;
}

export interface CocoQuadInferenceResult {
  quad: Quad;
  confidence: number;
  source: 'ml';
}

export interface CocoQuadProviderDiagnostics {
  ready: boolean;
  backend?: string;
  modelBase: CocoBase;
  lastError?: string;
}

function bboxToQuad(
  bbox: [number, number, number, number],
  frameWidth: number,
  frameHeight: number,
): Quad | undefined {
  const [rawX, rawY, rawW, rawH] = bbox;
  if (
    !Number.isFinite(rawX) ||
    !Number.isFinite(rawY) ||
    !Number.isFinite(rawW) ||
    !Number.isFinite(rawH)
  ) {
    return undefined;
  }
  const x1 = clamp(rawX, 0, frameWidth - 1);
  const y1 = clamp(rawY, 0, frameHeight - 1);
  const x2 = clamp(rawX + rawW, 0, frameWidth - 1);
  const y2 = clamp(rawY + rawH, 0, frameHeight - 1);
  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }
  return {
    topLeft: { x: x1, y: y1 },
    topRight: { x: x2, y: y1 },
    bottomRight: { x: x2, y: y2 },
    bottomLeft: { x: x1, y: y2 },
  };
}

function pickBestBookPrediction(
  predictions: CocoPrediction[],
  minScore: number,
): CocoPrediction | undefined {
  return predictions
    .filter((prediction) => prediction.class === 'book' && prediction.score >= minScore)
    .sort((a, b) => b.score - a.score)[0];
}

function isCenterPlausible(quad: Quad, width: number, height: number): boolean {
  const cx = (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4;
  const cy = (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4;
  return cx >= width * 0.1 && cx <= width * 0.9 && cy >= height * 0.1 && cy <= height * 0.9;
}

interface GeometryGuardInput {
  quad: Quad;
  frameWidth: number;
  frameHeight: number;
  minAreaFraction: number;
  maxAreaFraction: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  edgeTouchMarginPx: number;
}

function passesGeometryGuards(input: GeometryGuardInput): boolean {
  const width = Math.max(1, input.quad.topRight.x - input.quad.topLeft.x);
  const height = Math.max(1, input.quad.bottomLeft.y - input.quad.topLeft.y);
  const areaFraction = (width * height) / Math.max(1, input.frameWidth * input.frameHeight);
  if (areaFraction < input.minAreaFraction || areaFraction > input.maxAreaFraction) {
    return false;
  }
  const aspect = width / height;
  if (aspect < input.minAspectRatio || aspect > input.maxAspectRatio) {
    return false;
  }
  const borderPenaltyVal = borderPenalty(
    input.quad,
    input.frameWidth,
    input.frameHeight,
    input.edgeTouchMarginPx,
  );
  if (borderPenaltyVal > 0.3) {
    return false;
  }
  return isCenterPlausible(input.quad, input.frameWidth, input.frameHeight);
}

export interface CocoQuadProvider {
  init(config?: CocoQuadProviderConfig): Promise<void>;
  infer(input: CocoQuadInferenceInput): Promise<CocoQuadInferenceResult | undefined>;
  isReady(): boolean;
  getDiagnostics(): CocoQuadProviderDiagnostics;
}

export function createCocoQuadProvider(): CocoQuadProvider {
  let tf: TfjsLike | undefined;
  let coco: CocoSsdLike | undefined;
  let model: CocoModelLike | undefined;
  let initTask: Promise<void> | undefined;
  let ready = false;
  let debug = false;
  let modelBase: CocoBase = 'lite_mobilenet_v2';
  let backend: string | undefined;
  let lastError: string | undefined;

  async function ensureReady(): Promise<void> {
    if (ready) {
      return;
    }
    if (!initTask) {
      initTask = (async () => {
        try {
          const tfjsModule = (await import('@tensorflow/tfjs')) as unknown as TfjsLike;
          tf = tfjsModule;
          await tf.ready();
          // Prefer WebGL when available in the worker; fallback to CPU.
          if (tf.getBackend() !== 'webgl') {
            try {
              await tf.setBackend('webgl');
              await tf.ready();
            } catch {
              try {
                await tf.setBackend('cpu');
                await tf.ready();
              } catch {
                // Keep whatever backend TFJS has if explicit selection fails.
              }
            }
          }
          backend = tf.getBackend();

          const cocoModule =
            (await import('@tensorflow-models/coco-ssd')) as unknown as CocoSsdLike;
          coco = cocoModule;
          model = await coco.load({ base: modelBase });
          ready = true;
          lastError = undefined;
          if (debug) {
            console.warn(
              `[document-autocapture:coco] initialized base=${modelBase} backend=${backend ?? 'unknown'}`,
            );
          }
        } catch (error) {
          ready = false;
          model = undefined;
          lastError = error instanceof Error ? error.message : 'COCO init failed';
          throw error;
        } finally {
          initTask = undefined;
        }
      })();
    }
    await initTask;
  }

  return {
    async init(config?: CocoQuadProviderConfig) {
      debug = Boolean(config?.debug);
      modelBase = config?.modelBase ?? modelBase;
      await ensureReady();
    },
    async infer(input: CocoQuadInferenceInput): Promise<CocoQuadInferenceResult | undefined> {
      await ensureReady();
      if (!ready || !model) {
        return undefined;
      }
      const imageData = new ImageData(new Uint8ClampedArray(input.rgba), input.width, input.height);
      const predictions = await model.detect(
        imageData,
        8,
        Math.max(0, Math.min(1, input.minScore)),
      );
      if (!predictions.length) {
        return undefined;
      }
      const bestBook = pickBestBookPrediction(predictions, input.minScore);
      if (!bestBook) {
        return undefined;
      }

      const quad = bboxToQuad(bestBook.bbox, input.width, input.height);
      if (!quad) {
        return undefined;
      }
      if (
        !passesGeometryGuards({
          quad,
          frameWidth: input.width,
          frameHeight: input.height,
          minAreaFraction: input.minAreaFraction,
          maxAreaFraction: input.maxAreaFraction,
          minAspectRatio: input.minAspectRatio,
          maxAspectRatio: input.maxAspectRatio,
          edgeTouchMarginPx: input.edgeTouchMarginPx,
        })
      ) {
        return undefined;
      }

      return {
        quad,
        confidence: clamp(bestBook.score, 0, 1),
        source: 'ml',
      };
    },
    isReady(): boolean {
      return ready;
    },
    getDiagnostics(): CocoQuadProviderDiagnostics {
      return {
        ready,
        backend,
        modelBase,
        lastError,
      };
    },
  };
}

export const __cocoTestUtils = {
  bboxToQuad,
  pickBestBookPrediction,
  calcBorderPenalty: borderPenalty,
  isCenterPlausible,
  passesGeometryGuards,
};
