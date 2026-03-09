import type { Quad } from '@document-autocapture/core-engine';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TfjsGraphModel {
  execute?: (input: any) => any | any[];
  executeAsync: (input: any) => Promise<any | any[]>;
  dispose?: () => void;
}

export interface TfjsModule {
  ready: () => Promise<void>;
  setBackend: (backend: string) => Promise<boolean>;
  tensor3d: (
    values: Uint8ClampedArray,
    shape: [number, number, number],
    dtype: 'int32' | 'float32',
  ) => any;
  tidy: <T>(fn: () => T) => T;
  image: {
    resizeBilinear: (images: any, size: [number, number], alignCorners?: boolean) => any;
  };
  pad: (tensor: any, paddings: number[][], constantValue?: number) => any;
  dispose: (tensors: any | any[]) => void;
  loadGraphModel: (url: string) => Promise<TfjsGraphModel>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface TfjsTensorLike {
  data: () => Promise<ArrayLike<number>>;
}

export interface TfjsBackendWasmModule {
  setWasmPaths: (pathMapOrPrefix: string | Record<string, string>) => void;
}

export type TfjsBackendName = 'wasm' | 'cpu';

export interface MlQuadProviderConfig {
  modelId?: string;
  modelUrl?: string;
  modelBaseUrl?: string;
  wasmBaseUrl?: string;
  inputSize?: number;
  /** Maximum time in ms to wait for a single ML inference before aborting. Default: 5000. */
  inferenceTimeoutMs?: number;
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
  decodeMode?:
    | 'heuristic'
    | 'graph_coords_score_logit'
    | 'graph_coords_only'
    | 'graph_legacy_single_tensor';
  lastError?: string;
}

export interface MlQuadProvider {
  init(config?: MlQuadProviderConfig): Promise<void>;
  infer(input: MlQuadInferenceInput): Promise<MlQuadInferenceResult | undefined>;
  isReady(): boolean;
  getDiagnostics(): MlQuadProviderDiagnostics;
  dispose?(): void;
}

export interface CornerArtifact {
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

export interface ConfidenceCalibration {
  base: number;
  scoreWeight: number;
  edgeWeight: number;
  sizeWeight: number;
  min: number;
  max: number;
}

export interface DecodedModelOutputs {
  coords: number[];
  scoreRaw?: number;
  decodeMode: 'graph_coords_score_logit' | 'graph_coords_only' | 'graph_legacy_single_tensor';
}

export interface LoadedCornerArtifact {
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

export interface LetterboxTransform {
  size: number;
  scaledWidth: number;
  scaledHeight: number;
  scale: number;
  padLeft: number;
  padTop: number;
}
