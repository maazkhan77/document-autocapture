import { type DetectorSource, type FrameProcessResult, type Quad, quadAspectRatio } from '@document-autocapture/core-engine';
import { warpPerspectiveCpu } from '@document-autocapture/warp-cpu';
import { warpPerspectiveWebGL } from '@document-autocapture/warp-webgl';
import { sanitizeQuadForCapture, scaleQuadToCapture } from '../capture-quad';
import { refineQuadPostCapture } from '../post-refine';
import type { CaptureResult, ScannerConfig, WarpTierUsed } from '../types';
import { assessWarpOutput } from '../warp-validation';

interface CaptureWithWarpParams {
  video: HTMLVideoElement;
  latestResult?: FrameProcessResult;
  config: ScannerConfig;
  source: 'manual' | 'auto';
  lastDetectionFrameWidth: number;
  lastDetectionFrameHeight: number;
  nowMs: () => number;
  emitWarning: (message: string) => void;
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to Blob'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

function fullFrameQuad(width: number, height: number): Quad {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: width - 1, y: 0 },
    bottomRight: { x: width - 1, y: height - 1 },
    bottomLeft: { x: 0, y: height - 1 },
  };
}

export async function captureWithWarp(params: CaptureWithWarpParams): Promise<CaptureResult> {
  const {
    video,
    latestResult,
    config,
    source,
    lastDetectionFrameWidth,
    lastDetectionFrameHeight,
    nowMs,
    emitWarning,
  } = params;
  const t0 = nowMs();
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error('Video stream not ready');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not create capture context');
  }
  ctx.drawImage(video, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const bestCandidate = latestResult?.detection.bestCandidate;
  const bestSource = bestCandidate?.source ?? 'contour';
  const bestScore = bestCandidate?.score ?? 0;
  const bestArea = bestCandidate?.metrics.areaFraction ?? 0;
  const bestCorner = bestCandidate?.metrics.cornerAngleCloseness ?? 0;
  const bestBorder = bestCandidate?.metrics.borderPenalty ?? 1;
  const bestAspect = bestCandidate?.quad ? quadAspectRatio(bestCandidate.quad) : 0;
  const stableNow = Boolean(latestResult?.stability?.stable);
  const sourceReliableForWarp =
    bestSource === 'ml'
      ? bestScore >= 0.45 && bestArea >= 0.08 && bestBorder <= 0.3
      : bestSource === 'hough'
        ? stableNow &&
          bestScore >= 0.58 &&
          bestArea >= 0.12 &&
          bestCorner >= 0.45 &&
          bestBorder <= 0.24 &&
          bestAspect >= 0.55 &&
          bestAspect <= 1.8
        : stableNow &&
          bestScore >= 0.68 &&
          bestArea >= 0.16 &&
          bestCorner >= 0.55 &&
          bestBorder <= 0.2;
  const hasReliableDetection =
    latestResult?.detection.status === 'found' &&
    latestResult?.detection.rejectionReason === 'none' &&
    Boolean(bestCandidate) &&
    sourceReliableForWarp;
  const scaledQuad = hasReliableDetection
    ? scaleQuadToCapture(
        bestCandidate?.quad,
        lastDetectionFrameWidth,
        lastDetectionFrameHeight,
        width,
        height,
      )
    : fullFrameQuad(width, height);
  const sourceQuadOriginal = sanitizeQuadForCapture(scaledQuad, width, height);
  let sourceQuad = sourceQuadOriginal;

  const scoreInMediumBand = bestScore >= 0.5 && bestScore <= 0.78;
  const lowCornerConfidence = bestCorner < 0.68;
  const hasMildBorderPenalty = bestBorder > 0.08;
  const borderlineCapture =
    hasReliableDetection &&
    (scoreInMediumBand || lowCornerConfidence || hasMildBorderPenalty || bestSource === 'hough');
  const shouldRunPostRefine = config.postCaptureRefine === 'safe' && borderlineCapture;
  let postRefineApplied = false;
  let postRefineReason: string | undefined;
  let refinedQuad: Quad | undefined;
  if (shouldRunPostRefine) {
    const refineResult = refineQuadPostCapture({
      imageData,
      initialQuad: sourceQuadOriginal,
      budgetMs: 120,
      maxIterations: 2,
    });
    postRefineReason = refineResult.reason;
    if (refineResult.applied) {
      sourceQuad = sanitizeQuadForCapture(refineResult.quad, width, height);
      refinedQuad = sourceQuad;
      postRefineApplied = true;
    }

    if (config.debug) {
      console.warn(
        `[document-autocapture] post-refine | applied=${refineResult.applied} reason=${refineResult.reason} ` +
          `initialScore=${refineResult.initialScore.toFixed(2)} refinedScore=${refineResult.refinedScore.toFixed(2)} ` +
          `elapsed=${refineResult.elapsedMs.toFixed(1)}ms`,
      );
    }
  }

  const maxOutputWidth = Math.max(1, Math.min(config.outputMaxWidth ?? width, width));
  const maxOutputHeight = Math.max(1, Math.min(config.outputMaxHeight ?? height, height));
  const scale = Math.min(maxOutputWidth / width, maxOutputHeight / height, 1);
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const outputPixels = outWidth * outHeight;
  const cpuWarpBudgetMs = outputPixels >= 3_000_000 ? 320 : outputPixels >= 2_000_000 ? 260 : 220;

  const isHoughAutoCapture = source === 'auto' && bestSource === 'hough';
  interface WarpAttemptResult {
    tier: WarpTierUsed;
    outputCanvas: HTMLCanvasElement;
    rejectionReason?: string;
    rejectionStage?: 'webgl' | 'cpu';
    webglRecoveredOnCpu: boolean;
  }

  const validateWarpCanvas = (
    candidateCanvas: HTMLCanvasElement,
    candidateTier: 'webgl' | 'cpu',
  ): { accepted: boolean; validation?: ReturnType<typeof assessWarpOutput> } => {
    const candidateCtx = candidateCanvas.getContext('2d', { willReadFrequently: true });
    if (!candidateCtx) {
      return { accepted: false };
    }
    const candidateImageData = candidateCtx.getImageData(0, 0, candidateCanvas.width, candidateCanvas.height);
    const validation = assessWarpOutput({
      warpedImageData: candidateImageData,
      sourceImageData: imageData,
      isHoughAutoCapture,
      level: config.warpValidationLevel ?? 'standard',
      warpTier: candidateTier,
    });
    return { accepted: !validation.rejected, validation };
  };

  const attemptWarpForQuad = (candidateQuad: Quad): WarpAttemptResult => {
    let tier: WarpTierUsed = 'raw';
    let outputCanvas: HTMLCanvasElement = canvas;
    let rejectionReason: string | undefined;
    let rejectionStage: 'webgl' | 'cpu' | undefined;
    let webglRecoveredOnCpu = false;

    if (hasReliableDetection) {
      // Auto-capture prioritizes determinism over speed to avoid intermittent WebGL corruption artifacts.
      const preferCpuWarp = source === 'auto';
      if (preferCpuWarp && config.debug) {
        console.warn('[document-autocapture] Auto-capture warp policy active: CPU-first (WebGL bypassed for stability).');
      }
      if (!preferCpuWarp) {
        const webglResult = warpPerspectiveWebGL({
          imageData,
          quad: candidateQuad,
          outputWidth: outWidth,
          outputHeight: outHeight,
          budgetMs: 50,
        });
        if (webglResult.ok && webglResult.canvas && webglResult.elapsedMs <= 50) {
          const webglSnapshot = document.createElement('canvas');
          webglSnapshot.width = outWidth;
          webglSnapshot.height = outHeight;
          const webglSnapshotCtx = webglSnapshot.getContext('2d', { willReadFrequently: true });
          if (webglSnapshotCtx) {
            webglSnapshotCtx.drawImage(
              webglResult.canvas,
              0,
              0,
              outWidth,
              outHeight,
              0,
              0,
              outWidth,
              outHeight,
            );
            const webglValidation = validateWarpCanvas(webglSnapshot, 'webgl');
            if (webglValidation.accepted) {
              tier = 'webgl';
              outputCanvas = webglSnapshot;
            } else if (webglValidation.validation) {
              rejectionReason = webglValidation.validation.reason;
              rejectionStage = 'webgl';
              if (config.debug) {
                console.warn(
                  `[document-autocapture] WebGL warp rejected reason=${webglValidation.validation.reason} ` +
                    `(var=${webglValidation.validation.warpedStats.variance.toFixed(1)}, ` +
                    `range=${webglValidation.validation.warpedStats.dynamicRange.toFixed(1)}, ` +
                    `blockiness=${webglValidation.validation.integrity.blockiness.toFixed(2)}, ` +
                    `dominant=${(webglValidation.validation.integrity.dominantColorRatio * 100).toFixed(1)}%, ` +
                    `nearBlack=${(webglValidation.validation.integrity.nearBlackRatio * 100).toFixed(1)}%), trying CPU warp`,
                );
              }
            }
          } else if (config.debug) {
            console.warn('[document-autocapture] Could not snapshot WebGL warp canvas; trying CPU warp');
          }
        }
      }

      if (tier === 'raw') {
        const cpuResult = warpPerspectiveCpu({
          imageData,
          quad: candidateQuad,
          outputWidth: outWidth,
          outputHeight: outHeight,
          budgetMs: cpuWarpBudgetMs,
        });
        if (cpuResult.ok && cpuResult.imageData && cpuResult.elapsedMs <= cpuWarpBudgetMs) {
          const cpuCanvas = document.createElement('canvas');
          cpuCanvas.width = outWidth;
          cpuCanvas.height = outHeight;
          const cpuCtx = cpuCanvas.getContext('2d');
          if (!cpuCtx) {
            throw new Error('Could not create CPU output canvas');
          }
          cpuCtx.putImageData(cpuResult.imageData, 0, 0);
          const cpuValidation = validateWarpCanvas(cpuCanvas, 'cpu');
          if (cpuValidation.accepted) {
            tier = 'cpu';
            outputCanvas = cpuCanvas;
            webglRecoveredOnCpu = rejectionStage === 'webgl';
          } else if (cpuValidation.validation) {
            rejectionReason = cpuValidation.validation.reason;
            rejectionStage = 'cpu';
            if (config.debug) {
              console.warn(
                `[document-autocapture] CPU warp rejected reason=${cpuValidation.validation.reason} ` +
                  `(var=${cpuValidation.validation.warpedStats.variance.toFixed(1)}, ` +
                  `range=${cpuValidation.validation.warpedStats.dynamicRange.toFixed(1)}, ` +
                  `blockiness=${cpuValidation.validation.integrity.blockiness.toFixed(2)}, ` +
                  `dominant=${(cpuValidation.validation.integrity.dominantColorRatio * 100).toFixed(1)}%, ` +
                  `nearBlack=${(cpuValidation.validation.integrity.nearBlackRatio * 100).toFixed(1)}%), falling back to raw capture`,
              );
            }
          }
        }
      }
    }

    return {
      tier,
      outputCanvas,
      rejectionReason,
      rejectionStage,
      webglRecoveredOnCpu,
    };
  };

  let warpAttempt = attemptWarpForQuad(sourceQuad);
  if (warpAttempt.webglRecoveredOnCpu) {
    emitWarning('WebGL warp rejected; switched to CPU warp');
  }
  if (postRefineApplied && warpAttempt.tier === 'raw' && warpAttempt.rejectionReason) {
    if (config.debug) {
      console.warn(
        `[document-autocapture] post-refine fallback | refined quad failed warp validation (${warpAttempt.rejectionReason}), retrying original quad`,
      );
    }
    sourceQuad = sourceQuadOriginal;
    const originalAttempt = attemptWarpForQuad(sourceQuadOriginal);
    if (originalAttempt.webglRecoveredOnCpu) {
      emitWarning('WebGL warp rejected; switched to CPU warp');
    }
    warpAttempt = originalAttempt;
    postRefineApplied = false;
    postRefineReason = 'validation_reverted';
    refinedQuad = undefined;
  }

  let tier = warpAttempt.tier;
  let outputCanvas = warpAttempt.outputCanvas;
  const rejectionReason = warpAttempt.rejectionReason;
  const rejectionStage = warpAttempt.rejectionStage;

  if (nowMs() - t0 > 500) {
    tier = 'raw';
    outputCanvas = canvas;
    sourceQuad = sourceQuadOriginal;
    if (postRefineApplied) {
      postRefineApplied = false;
      postRefineReason = 'timeout';
      refinedQuad = undefined;
    }
  }

  if (tier === 'raw' && rejectionReason) {
    const stagePrefix = rejectionStage ? `${rejectionStage}:` : '';
    emitWarning(`Warp rejected: ${stagePrefix}${rejectionReason}; used raw capture`);
  }

  const blob = await canvasToBlob(
    outputCanvas,
    config.captureMimeType ?? 'image/jpeg',
    config.captureQuality,
  );
  const outputQuad: Quad =
    tier === 'raw'
      ? sourceQuad
      : {
          topLeft: { x: 0, y: 0 },
          topRight: { x: outputCanvas.width - 1, y: 0 },
          bottomRight: { x: outputCanvas.width - 1, y: outputCanvas.height - 1 },
          bottomLeft: { x: 0, y: outputCanvas.height - 1 },
        };

  return {
    blob,
    width: outputCanvas.width,
    height: outputCanvas.height,
    quad: outputQuad,
    sourceQuad,
    refinedQuad,
    postRefineApplied,
    postRefineReason,
    warpTierUsed: tier,
    warpRejected: Boolean(rejectionReason),
    warpRejectionReason: rejectionReason,
    quality: latestResult?.quality,
    source,
    captureDecisionSource: source,
    detectorSourceAtCapture: (latestResult?.detection.source ?? 'cv') as DetectorSource,
    elapsedMs: nowMs() - t0,
  };
}

