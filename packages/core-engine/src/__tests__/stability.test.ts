import { describe, expect, it } from 'vitest';
import { defaultEngineConfig } from '../config';
import { StabilityTracker } from '../stability';

describe('stability tracker', () => {
  it('becomes stable after configured duration with low movement', () => {
    const tracker = new StabilityTracker({
      ...defaultEngineConfig,
      stabilityWindowMs: 100,
      movementThresholdPx: 10,
      minStableConfidence: 0.2,
    });

    const quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 10, y: 0 },
      bottomRight: { x: 10, y: 20 },
      bottomLeft: { x: 0, y: 20 },
    };

    tracker.update({ nowMs: 0, quad, confidence: 1 });
    const result = tracker.update({ nowMs: 150, quad, confidence: 1 });
    expect(result.stable).toBe(true);
  });
});
