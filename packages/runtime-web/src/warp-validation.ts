import type { WarpValidationLevel } from './types';

export interface LumaStats {
  variance: number;
  dynamicRange: number;
}

export interface WarpIntegrityStats extends LumaStats {
  dominantColorRatio: number;
  blockiness: number;
  nearBlackRatio: number;
}

export type WarpRejectionReason =
  | 'degenerate_luma'
  | 'webgl_risky'
  | 'block_corruption'
  | 'out_of_bounds_black'
  | 'hough_auto_risky';

export interface WarpValidationResult {
  rejected: boolean;
  reason?: WarpRejectionReason;
  warpedStats: LumaStats;
  sourceStats: LumaStats;
  integrity: WarpIntegrityStats;
}

export function computeLumaStats(imageData: ImageData, stride = 4): LumaStats {
  const data = imageData.data;
  const step = Math.max(1, Math.floor(stride));
  let count = 0;
  let mean = 0;
  let m2 = 0;
  let minLuma = 255;
  let maxLuma = 0;

  for (let i = 0; i < data.length; i += 4 * step) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count += 1;
    const delta = luma - mean;
    mean += delta / count;
    m2 += delta * (luma - mean);
    if (luma < minLuma) minLuma = luma;
    if (luma > maxLuma) maxLuma = luma;
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  return {
    variance,
    dynamicRange: Math.max(0, maxLuma - minLuma),
  };
}

export function computeWarpIntegrityStats(imageData: ImageData, stride = 2): WarpIntegrityStats {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const step = Math.max(1, Math.floor(stride));
  const blockSize = 8;

  const palette = new Uint32Array(4096);
  let maxPaletteBin = 0;

  let count = 0;
  let mean = 0;
  let m2 = 0;
  let minLuma = 255;
  let maxLuma = 0;

  let boundaryDiff = 0;
  let boundarySamples = 0;
  let interiorDiff = 0;
  let interiorSamples = 0;
  let nearBlack = 0;

  const lumaAt = (x: number, y: number): number => {
    const idx = (y * width + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      count += 1;
      const delta = luma - mean;
      mean += delta / count;
      m2 += delta * (luma - mean);
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;
      if (luma <= 10) {
        nearBlack += 1;
      }

      const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const nextBinCount = ++palette[bin];
      if (nextBinCount > maxPaletteBin) {
        maxPaletteBin = nextBinCount;
      }

      if (x - step >= 0) {
        const leftLuma = lumaAt(x - step, y);
        const diff = Math.abs(luma - leftLuma);
        if (x % blockSize === 0) {
          boundaryDiff += diff;
          boundarySamples += 1;
        } else {
          interiorDiff += diff;
          interiorSamples += 1;
        }
      }

      if (y - step >= 0) {
        const topLuma = lumaAt(x, y - step);
        const diff = Math.abs(luma - topLuma);
        if (y % blockSize === 0) {
          boundaryDiff += diff;
          boundarySamples += 1;
        } else {
          interiorDiff += diff;
          interiorSamples += 1;
        }
      }
    }
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  const dynamicRange = Math.max(0, maxLuma - minLuma);
  const dominantColorRatio = count > 0 ? maxPaletteBin / count : 1;
  const boundaryAvg = boundaryDiff / Math.max(1, boundarySamples);
  const interiorAvg = interiorDiff / Math.max(1, interiorSamples);
  const blockiness = (boundaryAvg + 1) / (interiorAvg + 1);
  const nearBlackRatio = count > 0 ? nearBlack / count : 0;

  return {
    variance,
    dynamicRange,
    dominantColorRatio,
    blockiness,
    nearBlackRatio,
  };
}

export function assessWarpOutput(params: {
  warpedImageData: ImageData;
  sourceImageData: ImageData;
  isHoughAutoCapture: boolean;
  level: WarpValidationLevel;
  warpTier?: 'cpu';
}): WarpValidationResult {
  const { warpedImageData, sourceImageData, isHoughAutoCapture, level } = params;
  const warpedStats = computeLumaStats(warpedImageData, 4);
  const sourceStats = computeLumaStats(sourceImageData, 8);
  const integrity = computeWarpIntegrityStats(warpedImageData, 2);

  const strict = level === 'strict';
  const minExpectedVariance = Math.max(strict ? 18 : 12, sourceStats.variance * (strict ? 0.08 : 0.05));
  if (warpedStats.variance < minExpectedVariance || warpedStats.dynamicRange < (strict ? 28 : 22)) {
    return {
      rejected: true,
      reason: 'degenerate_luma',
      warpedStats,
      sourceStats,
      integrity,
    };
  }

  const houghAutoTooRisky =
    isHoughAutoCapture &&
    (integrity.blockiness > (strict ? 1.45 : 1.65) ||
      integrity.dominantColorRatio > (strict ? 0.2 : 0.24) ||
      integrity.nearBlackRatio > (strict ? 0.3 : 0.36) ||
      integrity.dynamicRange < (strict ? 34 : 28));
  if (houghAutoTooRisky) {
    return {
      rejected: true,
      reason: 'hough_auto_risky',
      warpedStats,
      sourceStats,
      integrity,
    };
  }

  const blockCorruption =
    integrity.blockiness > (strict ? 1.75 : 2.1) &&
    (integrity.dominantColorRatio > (strict ? 0.28 : 0.34) || integrity.dynamicRange < (strict ? 42 : 34));
  if (blockCorruption) {
    return {
      rejected: true,
      reason: 'block_corruption',
      warpedStats,
      sourceStats,
      integrity,
    };
  }

  const outOfBoundsBlack =
    integrity.nearBlackRatio > (strict ? 0.24 : 0.32) && integrity.dynamicRange < (strict ? 52 : 44);
  if (outOfBoundsBlack) {
    return {
      rejected: true,
      reason: 'out_of_bounds_black',
      warpedStats,
      sourceStats,
      integrity,
    };
  }

  return {
    rejected: false,
    warpedStats,
    sourceStats,
    integrity,
  };
}
