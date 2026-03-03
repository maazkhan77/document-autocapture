import { clamp } from '@document-autocapture/core-engine';
import { percentileFromHistogram } from './worker-helpers';

export function buildMlRescueRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  previousBuffer?: Uint8ClampedArray,
): Uint8ClampedArray | undefined {
  const pixelCount = width * height;
  if (pixelCount <= 0) {
    return undefined;
  }

  let rescueBuffer = previousBuffer;
  if (!rescueBuffer || rescueBuffer.length !== rgba.length) {
    rescueBuffer = new Uint8ClampedArray(rgba.length);
  }

  const histogram = new Uint32Array(256);
  let sumLuma = 0;

  for (let i = 0; i < rgba.length; i += 4) {
    const luma = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    histogram[luma] += 1;
    sumLuma += luma;
  }

  const pLow = percentileFromHistogram(histogram, 0.03, pixelCount);
  const pHigh = percentileFromHistogram(histogram, 0.97, pixelCount);
  const spread = Math.max(1, pHigh - pLow);
  const avgLuma = sumLuma / Math.max(1, pixelCount);
  const lowContrast = spread < 80;
  const darkScene = avgLuma < 125;
  const highlightHeavy = pHigh > 245;

  if (!lowContrast && !darkScene && !highlightHeavy) {
    return undefined;
  }

  const scale = 220 / spread;
  const gamma = darkScene ? 0.84 : highlightHeavy ? 1.08 : 0.95;

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const normalized = clamp((luma - pLow) * scale + 14, 0, 255);
    const lifted = 255 * Math.pow(normalized / 255, gamma);
    const ratio = luma > 1 ? lifted / luma : 1;

    rescueBuffer[i] = clamp(Math.round(r * ratio), 0, 255);
    rescueBuffer[i + 1] = clamp(Math.round(g * ratio), 0, 255);
    rescueBuffer[i + 2] = clamp(Math.round(b * ratio), 0, 255);
    rescueBuffer[i + 3] = a;
  }

  return rescueBuffer;
}
