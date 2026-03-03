import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';

function makeSyntheticDocumentFrame(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      rgba[idx] = 31;
      rgba[idx + 1] = 41;
      rgba[idx + 2] = 55;
      rgba[idx + 3] = 255;
    }
  }

  const left = Math.round(width * 0.14);
  const top = Math.round(height * 0.1);
  const docWidth = Math.round(width * 0.72);
  const docHeight = Math.round(height * 0.78);
  const right = Math.min(width - 1, left + docWidth);
  const bottom = Math.min(height - 1, top + docHeight);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const idx = (y * width + x) * 4;
      rgba[idx] = 215;
      rgba[idx + 1] = 221;
      rgba[idx + 2] = 230;
      rgba[idx + 3] = 255;
    }
  }

  for (let x = left; x <= right; x += 1) {
    const topIdx = (top * width + x) * 4;
    const bottomIdx = (bottom * width + x) * 4;
    rgba[topIdx] = 17;
    rgba[topIdx + 1] = 24;
    rgba[topIdx + 2] = 39;
    rgba[bottomIdx] = 17;
    rgba[bottomIdx + 1] = 24;
    rgba[bottomIdx + 2] = 39;
  }
  for (let y = top; y <= bottom; y += 1) {
    const leftIdx = (y * width + left) * 4;
    const rightIdx = (y * width + right) * 4;
    rgba[leftIdx] = 17;
    rgba[leftIdx + 1] = 24;
    rgba[leftIdx + 2] = 39;
    rgba[rightIdx] = 17;
    rgba[rightIdx + 1] = 24;
    rgba[rightIdx + 2] = 39;
  }

  const startY = top + 18;
  for (let line = 0; line < 10; line += 1) {
    const y = startY + line * Math.max(8, Math.floor((docHeight - 32) / 12));
    if (y >= bottom) {
      break;
    }
    for (let x = left + 20; x <= right - 20; x += 1) {
      const idx = (y * width + x) * 4;
      rgba[idx] = 148;
      rgba[idx + 1] = 163;
      rgba[idx + 2] = 184;
    }
  }

  return rgba;
}

describe('engine synthetic document', () => {
  it('finds a stable document candidate in a clean scene', () => {
    const width = 480;
    const height = 672;
    const rgba = makeSyntheticDocumentFrame(width, height);
    const engine = createEngine({ debug: true });

    let foundFrames = 0;
    let stableFrames = 0;
    let bestScore = 0;
    for (let i = 0; i < 30; i += 1) {
      const result = engine.processFrame({
        rgba,
        width,
        height,
        nowMs: i * 33,
      });
      if (result.detection.status === 'found' && result.detection.bestCandidate) {
        foundFrames += 1;
        bestScore = Math.max(bestScore, result.detection.bestCandidate.score);
      }
      if (result.stability?.stable) {
        stableFrames += 1;
      }
    }

    expect(foundFrames).toBeGreaterThan(10);
    expect(bestScore).toBeGreaterThan(0.55);
    expect(stableFrames).toBeGreaterThan(0);
  });
});
