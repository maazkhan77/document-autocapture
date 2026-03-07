import { mergeEngineConfig } from './config';
import { clamp, maxCornerDisplacement, nowMs, pointDistance, quadAspectRatio } from './math';
import type {
  DetectionRejectionReason,
  DetectionResult,
  EngineConfig,
  FrameProcessResult,
  Quad,
  DetectionCandidate,
  ProposalSource,
} from './types';
import { proposeQuadCandidates } from './pipeline/detection';
import { detectWithOpenCV, isOpenCVReady } from './pipeline/opencv-detect';
import { blur3x3, rgbaToGrayscale, sobelEdges } from './pipeline/pixels';
import { confidenceFromQuality, pickGuidanceCode, runQualityChecks } from './pipeline/quality';
import { scoreCandidates } from './pipeline/scoring';
import { StabilityTracker } from './stability';

export interface FrameInput {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  nowMs?: number;
}

export interface Engine {
  readonly config: EngineConfig;
  processFrame(input: FrameInput): FrameProcessResult;
  resetStability(): void;
}

function pickPreferredCvCandidate(
  candidates: DetectionCandidate[],
): DetectionCandidate | undefined {
  const top = candidates[0];
  if (!top) {
    return undefined;
  }
  if (top.source === 'hough') {
    return top;
  }

  const hough = candidates.find((candidate) => candidate.source === 'hough');
  if (!hough) {
    return top;
  }

  const closeEnough = hough.score >= Math.max(0.5, top.score - 0.18);
  const houghHealthy =
    hough.metrics.cornerAngleCloseness >= 0.45 &&
    hough.metrics.borderPenalty <= 0.25 &&
    hough.metrics.areaFraction >= 0.08;
  return closeEnough && houghHealthy ? hough : top;
}

export function createEngine(config?: Partial<EngineConfig>): Engine {
  const finalConfig = mergeEngineConfig(config);
  const stability = new StabilityTracker(finalConfig);
  let previousCenter: { x: number; y: number } | undefined;
  let consecutiveNotFoundFrames = 0;

  const reusable = {
    gray: undefined as Uint8ClampedArray | undefined,
    blurred: undefined as Uint8ClampedArray | undefined,
  };

  const quadCenter = (quad: Quad) => ({
    x: (quad.topLeft.x + quad.topRight.x + quad.bottomLeft.x + quad.bottomRight.x) / 4,
    y: (quad.topLeft.y + quad.topRight.y + quad.bottomLeft.y + quad.bottomRight.y) / 4,
  });

  return {
    config: finalConfig,
    processFrame(input: FrameInput): FrameProcessResult {
      const t0 = nowMs();
      let grayMs = 0;
      let blurMs = 0;
      let edgeMs = 0;
      let candidateMs = 0;
      let rawCandidates: DetectionCandidate[] = [];
      let magnitudeMap: Float32Array;
      let proposalSources: ProposalSource[] = [];
      let fallbackState: 'inactive' | 'armed' | 'active' = 'inactive';
      let edgeDensity = 0;

      if (isOpenCVReady()) {
        const cvStart = nowMs();
        const opencvResult = detectWithOpenCV(input.rgba, input.width, input.height, finalConfig);
        reusable.gray = opencvResult.gray;
        reusable.blurred = opencvResult.blurred;
        magnitudeMap = opencvResult.magnitude;
        rawCandidates = opencvResult.candidates;
        proposalSources = opencvResult.diagnostics.proposalSources;
        fallbackState = opencvResult.diagnostics.fallbackState;
        edgeDensity = opencvResult.diagnostics.edgeDensity;
        candidateMs = nowMs() - cvStart;
      } else {
        const grayStart = nowMs();
        reusable.gray = rgbaToGrayscale(input.rgba, input.width, input.height, reusable.gray);
        grayMs = nowMs() - grayStart;

        const blurStart = nowMs();
        reusable.blurred = blur3x3(reusable.gray, input.width, input.height, reusable.blurred);
        blurMs = nowMs() - blurStart;

        const edgeStart = nowMs();
        const edgeResult = sobelEdges(
          reusable.blurred,
          input.width,
          input.height,
          finalConfig.edgeLowThreshold,
          finalConfig.edgeHighThreshold,
        );
        edgeMs = nowMs() - edgeStart;
        magnitudeMap = edgeResult.magnitude;

        const candidateStart = nowMs();
        rawCandidates = proposeQuadCandidates(
          edgeResult.edgeMap,
          input.width,
          input.height,
          finalConfig,
        );
        proposalSources = ['contour'];
        edgeDensity =
          edgeResult.edgeMap.reduce((acc, value) => acc + (value > 0 ? 1 : 0), 0) /
          Math.max(1, edgeResult.edgeMap.length);
        candidateMs = nowMs() - candidateStart;
      }

      const scoringStart = nowMs();
      const scoredCandidatesRaw = scoreCandidates(
        rawCandidates,
        reusable.blurred!,
        magnitudeMap,
        input.width,
        input.height,
        finalConfig,
      );

      const frameDiagonal = Math.hypot(input.width, input.height);
      const scoredCandidates = scoredCandidatesRaw
        .map((candidate) => {
          if (!previousCenter) {
            return {
              ...candidate,
              confidence: clamp(candidate.score, 0, 1),
            };
          }
          const center = quadCenter(candidate.quad);
          const distance = pointDistance(previousCenter, center);
          const continuity = 1 - clamp(distance / Math.max(1, frameDiagonal * 0.35), 0, 1);
          const blendedScore = candidate.score * 0.85 + continuity * 0.15;
          return {
            ...candidate,
            score: blendedScore,
            confidence: clamp(blendedScore, 0, 1),
          };
        })
        .sort((a, b) => b.score - a.score);
      const scoringMs = nowMs() - scoringStart;

      const bestCandidate = pickPreferredCvCandidate(scoredCandidates);
      const secondCandidate = scoredCandidates.find((candidate) => candidate !== bestCandidate);
      const bestScore = bestCandidate?.score ?? 0;
      const secondScore = secondCandidate?.score ?? 0;
      const bestAspectRatio = bestCandidate ? quadAspectRatio(bestCandidate.quad) : 0;
      const ambiguityMargin = bestScore - secondScore;
      const ambiguous = Boolean(
        bestCandidate &&
        secondCandidate &&
        ambiguityMargin < finalConfig.ambiguityScoreMargin &&
        (() => {
          const bestCenter = quadCenter(bestCandidate.quad);
          const secondCenter = quadCenter(secondCandidate.quad);
          const centerDistance = pointDistance(bestCenter, secondCenter);
          const cornerDistance = maxCornerDisplacement(bestCandidate.quad, secondCandidate.quad);
          const areaDistance = Math.abs(
            bestCandidate.metrics.areaFraction - secondCandidate.metrics.areaFraction,
          );
          const diag = Math.hypot(input.width, input.height);
          const materiallyDifferentCenter = centerDistance > diag * 0.05;
          const materiallyDifferentCorners = cornerDistance > diag * 0.1;
          const materiallyDifferentArea = areaDistance > 0.08;
          if (materiallyDifferentCenter || materiallyDifferentCorners) {
            return true;
          }
          // Ignore nested/similar proposals that differ mostly by scale.
          return materiallyDifferentArea && centerDistance > diag * 0.02;
        })(),
      );

      let rejectionReason: DetectionRejectionReason = 'none';
      const houghConfidenceFloor = Math.min(0.72, finalConfig.confidenceThreshold + 0.14);
      const requiredScore =
        bestCandidate?.source === 'hough' ? houghConfidenceFloor : finalConfig.confidenceThreshold;
      const houghLikelyBackground =
        bestCandidate?.source === 'hough' &&
        ((bestCandidate.metrics.areaFraction < 0.12 &&
          bestCandidate.metrics.cornerAngleCloseness < 0.45) ||
          (bestCandidate.metrics.areaFraction < 0.2 &&
            bestCandidate.metrics.interiorHomogeneity > 0.72) ||
          (bestCandidate.metrics.areaFraction > 0.35 &&
            bestCandidate.metrics.cornerAngleCloseness < 0.55 &&
            bestCandidate.metrics.interiorHomogeneity < 0.6) ||
          (bestCandidate.metrics.areaFraction > 0.22 &&
            bestCandidate.metrics.aspectPlausibility < 0.45 &&
            bestCandidate.metrics.cornerAngleCloseness < 0.5) ||
          (bestCandidate.metrics.areaFraction > 0.55 &&
            bestCandidate.metrics.interiorHomogeneity < 0.62));

      if (!bestCandidate || bestScore < requiredScore || ambiguous || houghLikelyBackground) {
        rejectionReason = 'low_confidence';
      } else if (bestCandidate.metrics.borderPenalty > 0.25) {
        rejectionReason = 'edge_touch';
      } else if (
        bestAspectRatio < finalConfig.minAspectRatio ||
        bestAspectRatio > finalConfig.maxAspectRatio
      ) {
        rejectionReason = 'aspect_invalid';
      }

      const detectionFound = rejectionReason === 'none';

      const detection: DetectionResult = {
        status: detectionFound ? 'found' : 'not_found',
        source: 'cv',
        bestCandidate: detectionFound ? bestCandidate : undefined,
        candidates: scoredCandidates,
        rejectionReason,
        timings: {
          grayscaleMs: grayMs,
          blurMs,
          edgesMs: edgeMs,
          candidateMs,
          scoringMs,
          totalMs: nowMs() - t0,
        },
        debug: finalConfig.debug
          ? {
              candidateCount: scoredCandidates.length,
              topScores: scoredCandidates.slice(0, 4).map((candidate) => candidate.score),
              ambiguityMargin,
              bestScore,
              secondBestScore: secondScore,
              proposalSources,
              fallbackState,
              edgeDensity,
              stageMs: {
                grayscaleMs: grayMs,
                blurMs,
                edgesMs: edgeMs,
                candidateMs,
                scoringMs,
                totalMs: nowMs() - t0,
              },
            }
          : undefined,
      };

      const frameNowMs = input.nowMs ?? nowMs();
      const quality =
        detection.status === 'found' && detection.bestCandidate
          ? runQualityChecks(
              input.rgba,
              reusable.gray!,
              input.width,
              input.height,
              detection.bestCandidate.quad,
              finalConfig,
            )
          : undefined;

      if (quality && !quality.ok) {
        detection.rejectionReason = 'quality_fail';
      }

      const currentCenter = bestCandidate ? quadCenter(bestCandidate.quad) : undefined;
      const identitySwitched =
        detectionFound &&
        currentCenter !== undefined &&
        previousCenter !== undefined &&
        pointDistance(previousCenter, currentCenter) > finalConfig.identitySwitchThresholdPx;
      const scoreCollapsed =
        detectionFound &&
        Boolean(bestCandidate) &&
        (bestCandidate?.score ?? 0) < finalConfig.minStableConfidence;
      if (identitySwitched || scoreCollapsed) {
        stability.reset();
      }

      const qualityConfidence = quality ? confidenceFromQuality(quality) : 1;
      const dynamicMovementThresholdPx = Math.max(
        finalConfig.movementThresholdPx,
        finalConfig.movementThresholdRatio * Math.hypot(input.width, input.height),
      );
      const stabilityResult = stability.update({
        nowMs: frameNowMs,
        quad: detection.bestCandidate?.quad,
        confidence: (detection.bestCandidate?.confidence ?? 0) * qualityConfidence,
        movementThresholdPx: dynamicMovementThresholdPx,
      });
      if (detectionFound && currentCenter) {
        previousCenter = currentCenter;
        consecutiveNotFoundFrames = 0;
      } else {
        consecutiveNotFoundFrames += 1;
        if (consecutiveNotFoundFrames >= 10) {
          previousCenter = undefined;
          consecutiveNotFoundFrames = 0;
        }
      }

      if (
        !finalConfig.debug &&
        detection.timings &&
        detection.timings.totalMs > finalConfig.workerHardCeilingMs
      ) {
        stability.reset();
        previousCenter = undefined;
        return {
          detection: {
            status: 'not_found',
            source: 'cv',
            candidates: [],
            rejectionReason: 'low_confidence',
            timings: detection.timings,
          },
          quality,
          stability: stabilityResult,
          guidance: 'DOCUMENT_NOT_FOUND',
        };
      }

      const guidance = pickGuidanceCode({
        detected: detection.status === 'found',
        quality,
        stable: stabilityResult.stable,
        areaFraction: detection.bestCandidate?.metrics.areaFraction,
        minAreaFraction: finalConfig.minAreaFraction,
        ambiguous,
        rejectionReason: detection.rejectionReason,
      });

      return {
        detection,
        quality,
        stability: stabilityResult,
        guidance,
      };
    },
    resetStability(): void {
      stability.reset();
    },
  };
}
