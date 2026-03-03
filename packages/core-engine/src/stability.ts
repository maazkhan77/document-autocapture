import { maxCornerDisplacement } from './math';
import type { EngineConfig, Quad, StabilityResult } from './types';

function smoothQuad(previous: Quad | undefined, current: Quad, alpha: number): Quad {
  if (!previous) {
    return current;
  }
  return {
    topLeft: {
      x: alpha * current.topLeft.x + (1 - alpha) * previous.topLeft.x,
      y: alpha * current.topLeft.y + (1 - alpha) * previous.topLeft.y,
    },
    topRight: {
      x: alpha * current.topRight.x + (1 - alpha) * previous.topRight.x,
      y: alpha * current.topRight.y + (1 - alpha) * previous.topRight.y,
    },
    bottomRight: {
      x: alpha * current.bottomRight.x + (1 - alpha) * previous.bottomRight.x,
      y: alpha * current.bottomRight.y + (1 - alpha) * previous.bottomRight.y,
    },
    bottomLeft: {
      x: alpha * current.bottomLeft.x + (1 - alpha) * previous.bottomLeft.x,
      y: alpha * current.bottomLeft.y + (1 - alpha) * previous.bottomLeft.y,
    },
  };
}

export class StabilityTracker {
  private previousSmoothed?: Quad;

  private stableSince: number | null = null;

  private accumulation = 0;

  constructor(private readonly config: EngineConfig) {}

  reset(): void {
    this.previousSmoothed = undefined;
    this.stableSince = null;
    this.accumulation = 0;
  }

  update(args: {
    nowMs: number;
    quad?: Quad;
    confidence: number;
    movementThresholdPx?: number;
  }): StabilityResult {
    if (!args.quad || args.confidence < this.config.minStableConfidence) {
      this.reset();
      return {
        stable: false,
        stableMs: 0,
        cornerMovement: Number.POSITIVE_INFINITY,
        confidenceAccumulation: 0,
      };
    }

    const smoothedQuad = smoothQuad(this.previousSmoothed, args.quad, this.config.emaAlpha);
    const movement = this.previousSmoothed
      ? maxCornerDisplacement(this.previousSmoothed, smoothedQuad)
      : Number.POSITIVE_INFINITY;

    const movementThreshold = args.movementThresholdPx ?? this.config.movementThresholdPx;
    if (movement <= movementThreshold || this.previousSmoothed === undefined) {
      if (this.stableSince === null) {
        this.stableSince = args.nowMs;
      }
      this.accumulation += args.confidence;
    } else {
      this.stableSince = args.nowMs;
      this.accumulation = args.confidence;
    }

    this.previousSmoothed = smoothedQuad;
    const stableMs = this.stableSince === null ? 0 : args.nowMs - this.stableSince;

    return {
      stable: stableMs >= this.config.stabilityWindowMs,
      stableMs,
      cornerMovement: Number.isFinite(movement) ? movement : 0,
      confidenceAccumulation: this.accumulation,
      smoothedQuad,
    };
  }
}
