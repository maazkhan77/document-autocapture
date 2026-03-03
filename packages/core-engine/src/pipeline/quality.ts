import { boundingRect, clamp, quadArea } from '../math';
import type { EngineConfig, QualityResult, Quad } from '../types';
import { laplacianVariance } from './pixels';

interface QualityRoi {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function buildQualityRoi(quad: Quad, width: number, height: number): QualityRoi {
  const rect = boundingRect(quad);
  const rectWidth = Math.max(1, rect.maxX - rect.minX);
  const rectHeight = Math.max(1, rect.maxY - rect.minY);
  const margin = Math.round(clamp(Math.min(rectWidth, rectHeight) * 0.04, 4, 24));
  const minX = Math.max(0, Math.floor(rect.minX) - margin);
  const minY = Math.max(0, Math.floor(rect.minY) - margin);
  const maxX = Math.min(width - 1, Math.ceil(rect.maxX) + margin);
  const maxY = Math.min(height - 1, Math.ceil(rect.maxY) + margin);

  if (maxX - minX < 7 || maxY - minY < 7) {
    return {
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
    };
  }

  return { minX, minY, maxX, maxY };
}

function brightnessCheck(gray: Uint8ClampedArray, width: number, roi: QualityRoi, config: EngineConfig) {
  let sum = 0;
  let samples = 0;
  for (let y = roi.minY; y <= roi.maxY; y += 1) {
    const rowOffset = y * width;
    for (let x = roi.minX; x <= roi.maxX; x += 1) {
      sum += gray[rowOffset + x];
      samples += 1;
    }
  }
  const averageLuma = sum / Math.max(1, samples);
  const ok = averageLuma >= config.brightnessMin && averageLuma <= config.brightnessMax;
  return { averageLuma, ok };
}

function blurCheck(gray: Uint8ClampedArray, width: number, height: number, roi: QualityRoi, config: EngineConfig) {
  const minX = Math.max(1, roi.minX);
  const minY = Math.max(1, roi.minY);
  const maxX = Math.min(width - 2, roi.maxX);
  const maxY = Math.min(height - 2, roi.maxY);

  let laplacian = 0;
  if (maxX - minX >= 1 && maxY - minY >= 1) {
    let sum = 0;
    let sqSum = 0;
    let n = 0;
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      const rowAbove = (y - 1) * width;
      const rowBelow = (y + 1) * width;
      for (let x = minX; x <= maxX; x += 1) {
        const center = gray[row + x] * 4;
        const lap = center - gray[rowAbove + x] - gray[rowBelow + x] - gray[row + (x - 1)] - gray[row + (x + 1)];
        sum += lap;
        sqSum += lap * lap;
        n += 1;
      }
    }
    if (n > 0) {
      const mean = sum / n;
      laplacian = sqSum / n - mean * mean;
    }
  } else {
    // Fall back only when ROI is too small for a stable local variance estimate.
    laplacian = laplacianVariance(gray, width, height);
  }

  return {
    laplacianVariance: laplacian,
    ok: laplacian >= config.blurVarianceMin,
  };
}

function glareCheck(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  config: EngineConfig,
) {
  const rect = boundingRect(quad);
  const minX = Math.max(0, Math.floor(rect.minX));
  const minY = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(width - 1, Math.ceil(rect.maxX));
  const maxY = Math.min(height - 1, Math.ceil(rect.maxY));

  let glarePixels = 0;
  let sampled = 0;
  const step = 2;
  const lumaAt = (x: number, y: number) => {
    const safeX = clamp(x, minX, maxX);
    const safeY = clamp(y, minY, maxY);
    const idx = (safeY * width + safeX) * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];

      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const neighborLuma =
        (lumaAt(x - step, y) + lumaAt(x + step, y) + lumaAt(x, y - step) + lumaAt(x, y + step)) / 4;
      const localJump = luma - neighborLuma;
      const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);

      // Glare is a localized specular spike, not globally bright paper.
      if (luma > 248 && localJump > 18 && channelSpread < 20) {
        glarePixels += 1;
      }
      sampled += 1;
    }
  }

  const highlightRatio = glarePixels / Math.max(1, sampled);
  const isUniformlyBright = highlightRatio > 0.35;
  const glareDetected = !isUniformlyBright && highlightRatio > config.glareRatioMax;
  return {
    highlightRatio,
    ok: !glareDetected,
  };
}

function areaCheck(quad: Quad, width: number, height: number, config: EngineConfig) {
  const areaFraction = quadArea(quad) / Math.max(1, width * height);
  return {
    areaFraction,
    ok: areaFraction >= config.minAreaFraction && areaFraction <= config.maxAreaFraction,
  };
}

export function runQualityChecks(
  rgba: Uint8ClampedArray,
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  config: EngineConfig,
): QualityResult {
  const roi = buildQualityRoi(quad, width, height);
  const brightness = brightnessCheck(gray, width, roi, config);
  const blur = blurCheck(gray, width, height, roi, config);
  const glare = glareCheck(rgba, width, height, quad, config);
  const area = areaCheck(quad, width, height, config);

  return {
    brightness,
    blur,
    glare,
    area,
    ok: brightness.ok && blur.ok && glare.ok && area.ok,
  };
}

export function pickGuidanceCode(args: {
  detected: boolean;
  quality?: QualityResult;
  stable: boolean;
  areaFraction?: number;
  minAreaFraction: number;
  ambiguous?: boolean;
  rejectionReason?: import('../types').DetectionRejectionReason;
}): import('../types').GuidanceCode {
  if (args.ambiguous) {
    return 'HOLD_STEADY';
  }

  if (!args.detected) {
    return 'DOCUMENT_NOT_FOUND';
  }

  if (args.rejectionReason === 'edge_touch' || args.rejectionReason === 'aspect_invalid') {
    return 'HOLD_STEADY';
  }

  if (args.quality && !args.quality.brightness.ok) {
    return 'TOO_DARK_OR_BRIGHT';
  }
  if (args.quality && !args.quality.glare.ok) {
    return 'REDUCE_GLARE';
  }
  if (args.quality && !args.quality.blur.ok) {
    return 'TOO_BLURRY';
  }
  if (!args.stable) {
    return 'HOLD_STEADY';
  }

  const areaFraction = args.areaFraction ?? args.quality?.area.areaFraction ?? 0;
  if (areaFraction < args.minAreaFraction) {
    return 'MOVE_CLOSER';
  }

  return 'READY';
}

export function confidenceFromQuality(quality: QualityResult): number {
  const brightnessPenalty = quality.brightness.ok ? 1 : 0.6;
  const blurPenalty = quality.blur.ok ? 1 : 0.65;
  const glarePenalty = quality.glare.ok ? 1 : 0.7;
  const areaPenalty = quality.area.ok ? 1 : clamp(quality.area.areaFraction / 0.08, 0.3, 0.8);
  return clamp(brightnessPenalty * blurPenalty * glarePenalty * areaPenalty, 0, 1);
}
