import { clamp, quadArea } from '@document-autocapture/core-engine';
import type {
  CornerArtifact,
  LoadedCornerArtifact,
  MlQuadInferenceInput,
  MlQuadInferenceResult,
  MlQuadProvider,
  MlQuadProviderConfig,
  MlQuadProviderDiagnostics,
  TfjsBackendName,
  TfjsBackendWasmModule,
  TfjsGraphModel,
  TfjsModule,
  TfjsTensorLike,
} from './types.js';
import {
  computeCalibratedConfidence,
  computeLetterboxTransform,
  computeSizeConfidence,
  estimateQuadEdgeSupport,
  findBounds,
  isValidQuadShape,
  mapLetterboxPointToFrame,
  normalizeCalibration,
  percentile,
  pickCoordsAndScoreFromValues,
  resolveModelUrl,
  sanitizeQuad,
  sigmoid,
  withTimeout,
  safeUrl,
} from './helpers.js';

// Re-export public API types and the standalone resolveModelUrl helper
export type {
  MlQuadProviderConfig,
  MlQuadInferenceInput,
  MlQuadInferenceResult,
  MlQuadProviderDiagnostics,
  MlQuadProvider,
} from './types.js';
export { resolveModelUrl } from './helpers.js';

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

  private async initBackend(
    tf: TfjsModule,
    config: MlQuadProviderConfig,
  ): Promise<TfjsBackendName> {
    if (!config.wasmBaseUrl) {
      const cpuReady = await tf.setBackend('cpu');
      if (!cpuReady) {
        throw new Error('tf.setBackend("cpu") returned false');
      }
      await tf.ready();
      return 'cpu';
    }

    try {
      const wasm =
        (await import('@tensorflow/tfjs-backend-wasm')) as unknown as TfjsBackendWasmModule;
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
        console.warn(
          '[document-autocapture:ml] WASM backend unavailable, using CPU backend',
          wasmError,
        );
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

      const artifactUrl =
        config.modelUrl ?? resolveModelUrl(config.modelId ?? 'doc-corner-v1', config.modelBaseUrl);
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
            error instanceof Error
              ? `Graph model load failed: ${error.message}`
              : 'Graph model load failed';
        }
      }

      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.diagnostics.backend = 'failed';
      this.diagnostics.lastError =
        error instanceof Error ? error.message : 'TFJS initialization failed';
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
      const timeoutMs = this.config.inferenceTimeoutMs ?? 5000;
      const modelResult = await withTimeout(this.inferWithModel(input), timeoutMs).catch((err) => {
        if (this.config.debug) {
          console.warn('[document-autocapture:ml] inference timed out or failed', err);
        }
        this.diagnostics.lastError = err instanceof Error ? err.message : 'Inference timeout';
        return undefined;
      });
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
        inputSize: Math.max(
          128,
          Math.min(640, Math.round(artifact.inputSize ?? this.artifact.inputSize)),
        ),
        inputNormalization: artifact.inputNormalization === 'imagenet' ? 'imagenet' : 'zero_one',
        edgePercentile: clamp(artifact.edgePercentile ?? this.artifact.edgePercentile, 20, 95),
        paddingRatio: clamp(artifact.paddingRatio ?? this.artifact.paddingRatio, 0, 0.2),
        minAreaFraction: clamp(
          artifact.minAreaFraction ?? this.artifact.minAreaFraction,
          0.01,
          0.6,
        ),
        maxAreaFraction: clamp(
          artifact.maxAreaFraction ?? this.artifact.maxAreaFraction,
          0.4,
          0.99,
        ),
        minConfidence: clamp(artifact.minConfidence ?? this.artifact.minConfidence, 0, 1),
        outputFormat:
          artifact.outputFormat === 'coords_score_logit' ? 'coords_score_logit' : 'coords_only',
        scoreMode:
          artifact.scoreMode === 'logit' ||
          artifact.scoreMode === 'probability' ||
          artifact.scoreMode === 'fixed'
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
        console.warn(
          '[document-autocapture:ml] fallback artifact load failed, using defaults',
          error,
        );
      }
      this.diagnostics.lastError = error instanceof Error ? error.message : 'Artifact load failed';
    }
  }

  private async inferWithModel(
    input: MlQuadInferenceInput,
  ): Promise<MlQuadInferenceResult | undefined> {
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

      let output: unknown;
      if (typeof this.model.execute === 'function') {
        try {
          output = this.model.execute(tensor);
          if (output instanceof Promise) {
            output = await output;
          }
        } catch {
          output = await this.model.executeAsync(tensor);
        }
      } else {
        output = await this.model.executeAsync(tensor);
      }
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
          const raw = Array.from((await tensorValue.data()) as ArrayLike<number>, (value) =>
            Number(value),
          );
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
          topLeft: mapLetterboxPointToFrame(
            decode(decoded.coords[0]),
            decode(decoded.coords[1]),
            letterbox,
            input.width,
            input.height,
          ),
          topRight: mapLetterboxPointToFrame(
            decode(decoded.coords[2]),
            decode(decoded.coords[3]),
            letterbox,
            input.width,
            input.height,
          ),
          bottomRight: mapLetterboxPointToFrame(
            decode(decoded.coords[4]),
            decode(decoded.coords[5]),
            letterbox,
            input.width,
            input.height,
          ),
          bottomLeft: mapLetterboxPointToFrame(
            decode(decoded.coords[6]),
            decode(decoded.coords[7]),
            letterbox,
            input.width,
            input.height,
          ),
        },
        input.width,
        input.height,
      );

      if (
        !isValidQuadShape(
          quad,
          input.width,
          input.height,
          this.artifact.minAreaFraction,
          this.artifact.maxAreaFraction,
        )
      ) {
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
        error instanceof Error
          ? `Model inference failed: ${error.message}`
          : 'Model inference failed';
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
      const dxPad = this.tf!.pad(dx, [
        [0, 0],
        [0, 0],
        [0, 1],
        [0, 0],
      ]);
      const dyPad = this.tf!.pad(dy, [
        [0, 0],
        [0, 1],
        [0, 0],
        [0, 0],
      ]);
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

    if (
      !isValidQuadShape(
        quad,
        input.width,
        input.height,
        this.artifact.minAreaFraction,
        this.artifact.maxAreaFraction,
      )
    ) {
      return undefined;
    }

    const areaFraction = quadArea(quad) / Math.max(1, input.width * input.height);
    const sizeConfidence =
      areaFraction < this.artifact.minAreaFraction
        ? areaFraction / Math.max(0.0001, this.artifact.minAreaFraction)
        : areaFraction > this.artifact.maxAreaFraction
          ? this.artifact.maxAreaFraction / Math.max(0.0001, areaFraction)
          : 1;
    const edgeConfidence = clamp(edgeMean / 28, 0, 1);
    const confidence = clamp(0.45 + edgeConfidence * 0.5, 0, 1) * clamp(sizeConfidence, 0, 1);

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
