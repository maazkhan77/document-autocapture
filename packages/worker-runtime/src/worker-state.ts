import type { StabilityTracker } from '@document-autocapture/core-engine';
import type { CvFallbackReason } from './protocol';

export type { CvFallbackReason };

/**
 * Per-frame telemetry flags that get reset at the start of each `processFrame`.
 * Grouping these into a single object makes the reset explicit and auditable.
 */
export interface FrameTelemetry {
  mlInferenceUsed: boolean;
  mlRescueUsed: boolean;
  graphAttempted: boolean;
  cocoAttempted: boolean;
  cocoUsed: boolean;
  providerUsed: MlProviderName | 'cv_hough' | 'cv_contour' | undefined;
  providerRejectReason: string | undefined;
  cvAttempted: boolean;
  cvFallbackReason: CvFallbackReason;
}

export type MlProviderName = 'graph_v2' | 'graph_v1' | 'coco_book';

export interface MlProviderStabilityTrackers {
  graph: StabilityTracker;
  coco: StabilityTracker;
}

/**
 * Returns a fresh `FrameTelemetry` with all flags at their default values.
 */
export function createFrameTelemetry(): FrameTelemetry {
  return {
    mlInferenceUsed: false,
    mlRescueUsed: false,
    graphAttempted: false,
    cocoAttempted: false,
    cocoUsed: false,
    providerUsed: undefined,
    providerRejectReason: undefined,
    cvAttempted: false,
    cvFallbackReason: 'none',
  };
}

/**
 * Reset an existing telemetry object in-place (avoids allocation).
 */
export function resetFrameTelemetry(t: FrameTelemetry): void {
  t.mlInferenceUsed = false;
  t.mlRescueUsed = false;
  t.graphAttempted = false;
  t.cocoAttempted = false;
  t.cocoUsed = false;
  t.providerUsed = undefined;
  t.providerRejectReason = undefined;
  t.cvAttempted = false;
  t.cvFallbackReason = 'none';
}
