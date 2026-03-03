import {
  clamp,
  defaultEngineConfig,
  lerp,
  maxCornerDisplacement,
  type DetectionRejectionReason,
  type Quad,
} from '@document-autocapture/core-engine';
import { mean, median, percentile, quadIoU, type NormalizedCandidate, type NormalizedFrame } from './realclip-shared';

export interface ThresholdProfile {
  confidenceThreshold: number;
  ambiguityScoreMargin: number;
  minStableConfidence: number;
  stabilityWindowMs: number;
  autoCaptureConsecutiveStableFrames: number;
  autoCaptureCooldownMs: number;
  movementThresholdRatio: number;
  emaAlpha: number;
  minAreaFraction: number;
  maxAreaFraction: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  edgeTouchLimit: number;
  brightnessMin: number;
  brightnessMax: number;
  blurVarianceMin: number;
  glareRatioMax: number;
}

export interface SimulationMetrics {
  totals: {
    frames: number;
    documentFrames: number;
    nonDocumentFrames: number;
    documentClips: number;
    nonDocumentClips: number;
  };
  detection: {
    lockPassRateAt085: number;
    falsePositiveRate: number;
    iouMean: number;
    iouP50: number;
    iouP90: number;
  };
  capture: {
    autoCaptureSuccessRate: number;
    autoCaptureWithin2sRate: number;
    medianCaptureLatencyMs: number;
    medianTimeToStableMs: number;
    p90TimeToStableMs: number;
    falseAutoCaptureCount: number;
  };
  perf: {
    fpsMean: number;
    fpsP50: number;
    fpsP10: number;
  };
  diagnostics: {
    detectorSourceStats: Record<string, number>;
    rejectionReasons: Record<string, number>;
    fallbackActiveFrames: number;
  };
  acceptance: {
    lockPass: boolean;
    falsePositivePass: boolean;
    autoCapturePass: boolean;
    autoCaptureWithin2sPass: boolean;
  };
  objectiveScore: number;
}

export interface TuningResult {
  baselineProfile: ThresholdProfile;
  tunedProfile: ThresholdProfile;
  baselineMetrics: SimulationMetrics;
  tunedMetrics: SimulationMetrics;
  evaluations: number;
  passes: number;
}

interface CandidateEval {
  candidate?: NormalizedCandidate;
  found: boolean;
  reason: DetectionRejectionReason;
  ambiguity: number;
}

interface ClipTemporalState {
  smoothed?: Quad;
  stableStartMs?: number;
  stableFrames: number;
  missFrames: number;
  lastCaptureMs?: number;
  firstDocumentMs?: number;
  firstStableMs?: number;
  captureMs?: number;
}

const EPSILON = 1e-9;

export function defaultThresholdProfile(): ThresholdProfile {
  return {
    confidenceThreshold: defaultEngineConfig.confidenceThreshold,
    ambiguityScoreMargin: defaultEngineConfig.ambiguityScoreMargin,
    minStableConfidence: defaultEngineConfig.minStableConfidence,
    stabilityWindowMs: defaultEngineConfig.stabilityWindowMs,
    autoCaptureConsecutiveStableFrames: 2,
    autoCaptureCooldownMs: 1400,
    movementThresholdRatio: defaultEngineConfig.movementThresholdRatio,
    emaAlpha: defaultEngineConfig.emaAlpha,
    minAreaFraction: defaultEngineConfig.minAreaFraction,
    maxAreaFraction: defaultEngineConfig.maxAreaFraction,
    minAspectRatio: defaultEngineConfig.minAspectRatio,
    maxAspectRatio: defaultEngineConfig.maxAspectRatio,
    edgeTouchLimit: 0.3,
    brightnessMin: defaultEngineConfig.brightnessMin,
    brightnessMax: defaultEngineConfig.brightnessMax,
    blurVarianceMin: defaultEngineConfig.blurVarianceMin,
    glareRatioMax: defaultEngineConfig.glareRatioMax,
  };
}

function lerpQuad(from: Quad, to: Quad, alpha: number): Quad {
  return {
    topLeft: {
      x: lerp(from.topLeft.x, to.topLeft.x, alpha),
      y: lerp(from.topLeft.y, to.topLeft.y, alpha),
    },
    topRight: {
      x: lerp(from.topRight.x, to.topRight.x, alpha),
      y: lerp(from.topRight.y, to.topRight.y, alpha),
    },
    bottomRight: {
      x: lerp(from.bottomRight.x, to.bottomRight.x, alpha),
      y: lerp(from.bottomRight.y, to.bottomRight.y, alpha),
    },
    bottomLeft: {
      x: lerp(from.bottomLeft.x, to.bottomLeft.x, alpha),
      y: lerp(from.bottomLeft.y, to.bottomLeft.y, alpha),
    },
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let result = Math.imul(t ^ (t >>> 15), 1 | t);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function continuityScore(
  candidate: NormalizedCandidate,
  previous: Quad | undefined,
  width: number,
  height: number,
): number {
  if (!previous) {
    return 1;
  }
  const diagonal = Math.max(1, Math.hypot(width, height));
  const displacementRatio = maxCornerDisplacement(previous, candidate.quad) / diagonal;
  const movementScore = 1 - clamp(displacementRatio / 0.12, 0, 1);
  const overlap = quadIoU(previous, candidate.quad);
  return clamp(movementScore * 0.65 + overlap * 0.35, 0, 1);
}

function withAdjustedScore(candidate: NormalizedCandidate, adjustedScore: number): NormalizedCandidate {
  return {
    ...candidate,
    score: clamp(adjustedScore, 0, 1),
  };
}

function selectCvCandidates(frame: NormalizedFrame, state: ClipTemporalState): {
  primary?: NormalizedCandidate;
  secondScore: number;
} {
  const ranked = frame.cvCandidates
    .slice(0, 8)
    .map((candidate) => {
      const continuity = continuityScore(candidate, state.smoothed, frame.width, frame.height);
      const adjustedScore = candidate.score * 0.82 + continuity * 0.18;
      return withAdjustedScore(candidate, adjustedScore);
    })
    .sort((a, b) => b.score - a.score);

  return {
    primary: ranked[0],
    secondScore: ranked[1]?.score ?? 0,
  };
}

function scoreCandidate(
  candidate: NormalizedCandidate | undefined,
  secondScore: number,
  profile: ThresholdProfile,
): CandidateEval {
  if (!candidate) {
    return {
      candidate: undefined,
      found: false,
      reason: 'low_confidence',
      ambiguity: 0,
    };
  }

  const ambiguity = candidate.score - secondScore;
  if (candidate.score < profile.confidenceThreshold || ambiguity < profile.ambiguityScoreMargin) {
    return {
      candidate,
      found: false,
      reason: 'low_confidence',
      ambiguity,
    };
  }
  if (candidate.borderPenalty > profile.edgeTouchLimit) {
    return {
      candidate,
      found: false,
      reason: 'edge_touch',
      ambiguity,
    };
  }
  if (candidate.aspectRatio < profile.minAspectRatio || candidate.aspectRatio > profile.maxAspectRatio) {
    return {
      candidate,
      found: false,
      reason: 'aspect_invalid',
      ambiguity,
    };
  }
  if (candidate.areaFraction < profile.minAreaFraction || candidate.areaFraction > profile.maxAreaFraction) {
    return {
      candidate,
      found: false,
      reason: 'quality_fail',
      ambiguity,
    };
  }
  return {
    candidate,
    found: true,
    reason: 'none',
    ambiguity,
  };
}

function qualityOk(
  frame: NormalizedFrame,
  profile: ThresholdProfile,
): { ok: boolean; reason: DetectionRejectionReason } {
  const quality = frame.quality;
  const brightnessOk = quality.brightness >= profile.brightnessMin && quality.brightness <= profile.brightnessMax;
  if (!brightnessOk) {
    return { ok: false, reason: 'quality_fail' };
  }
  if (quality.blur < profile.blurVarianceMin) {
    return { ok: false, reason: 'quality_fail' };
  }
  if (quality.glare > profile.glareRatioMax) {
    return { ok: false, reason: 'quality_fail' };
  }
  return { ok: true, reason: 'none' };
}

function chooseCandidate(
  frame: NormalizedFrame,
  state: ClipTemporalState,
  profile: ThresholdProfile,
): CandidateEval & { source: 'cv'; fallbackActive: boolean } {
  const cvSelection = selectCvCandidates(frame, state);
  const cvEval = scoreCandidate(cvSelection.primary, cvSelection.secondScore, profile);
  return {
    ...cvEval,
    source: 'cv',
    fallbackActive: false,
  };
}

function initializeClipState(): ClipTemporalState {
  return {
    smoothed: undefined,
    stableStartMs: undefined,
    stableFrames: 0,
    missFrames: 0,
    lastCaptureMs: undefined,
    firstDocumentMs: undefined,
    firstStableMs: undefined,
    captureMs: undefined,
  };
}

function isBetter(metrics: SimulationMetrics, best: SimulationMetrics): boolean {
  if (metrics.objectiveScore > best.objectiveScore + EPSILON) {
    return true;
  }
  if (metrics.objectiveScore < best.objectiveScore - EPSILON) {
    return false;
  }
  if (metrics.detection.lockPassRateAt085 > best.detection.lockPassRateAt085 + EPSILON) {
    return true;
  }
  if (metrics.detection.lockPassRateAt085 < best.detection.lockPassRateAt085 - EPSILON) {
    return false;
  }
  if (metrics.detection.falsePositiveRate < best.detection.falsePositiveRate - EPSILON) {
    return true;
  }
  if (metrics.detection.falsePositiveRate > best.detection.falsePositiveRate + EPSILON) {
    return false;
  }
  return metrics.capture.autoCaptureWithin2sRate > best.capture.autoCaptureWithin2sRate + EPSILON;
}

function randomProfileAround(base: ThresholdProfile, random: () => number): ThresholdProfile {
  return {
    ...base,
    confidenceThreshold: Number((0.42 + random() * 0.2).toFixed(3)),
    ambiguityScoreMargin: Number((0.02 + random() * 0.12).toFixed(3)),
    minStableConfidence: Number((0.34 + random() * 0.24).toFixed(3)),
    stabilityWindowMs: Math.round(280 + random() * 620),
    autoCaptureConsecutiveStableFrames: Math.max(1, Math.min(5, Math.round(1 + random() * 4))),
    autoCaptureCooldownMs: Math.round(850 + random() * 1200),
    movementThresholdRatio: Number((0.008 + random() * 0.034).toFixed(4)),
    emaAlpha: Number((0.18 + random() * 0.2).toFixed(3)),
    brightnessMin: Math.round(30 + random() * 45),
    brightnessMax: Math.round(190 + random() * 55),
    blurVarianceMin: Math.round(15 + random() * 45),
    glareRatioMax: Number((0.05 + random() * 0.17).toFixed(3)),
  };
}

export function simulateDataset(frames: NormalizedFrame[], profile: ThresholdProfile): SimulationMetrics {
  const sorted = [...frames].sort((a, b) => {
    if (a.clipId === b.clipId) {
      return a.tsMs - b.tsMs;
    }
    return a.clipId.localeCompare(b.clipId);
  });

  const byClip = new Map<string, NormalizedFrame[]>();
  for (const frame of sorted) {
    const bucket = byClip.get(frame.clipId) ?? [];
    bucket.push(frame);
    byClip.set(frame.clipId, bucket);
  }

  const ious: number[] = [];
  const fpsSamples: number[] = [];
  const stableLatencies: number[] = [];
  const captureLatencies: number[] = [];
  const detectorSourceStats: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  let fallbackActiveFrames = 0;

  let documentFrames = 0;
  let nonDocumentFrames = 0;
  let lockPassCount = 0;
  let falsePositiveCount = 0;
  let falseAutoCaptureCount = 0;
  let documentClips = 0;
  let nonDocumentClips = 0;
  let captureSuccessCount = 0;
  let captureWithin2sCount = 0;

  for (const clipFrames of byClip.values()) {
    const clipHasDocument = clipFrames.some((frame) => frame.hasDocument);
    if (clipHasDocument) {
      documentClips += 1;
    } else {
      nonDocumentClips += 1;
    }

    const state = initializeClipState();

    for (const frame of clipFrames) {
      if (frame.hasDocument) {
        documentFrames += 1;
        if (state.firstDocumentMs === undefined) {
          state.firstDocumentMs = frame.tsMs;
        }
      } else {
        nonDocumentFrames += 1;
      }

      fpsSamples.push(1000 / Math.max(1, frame.detectionMs));

      const detection = chooseCandidate(frame, state, profile);
      if (detection.fallbackActive) {
        fallbackActiveFrames += 1;
      }
      detectorSourceStats[detection.source] = (detectorSourceStats[detection.source] ?? 0) + 1;

      const detectionFound = detection.found;
      const quality = qualityOk(frame, profile);
      const captureQualityPass = quality.ok;
      const captureEligible = detectionFound && captureQualityPass;
      let rejectionReason = detection.reason;
      if (detectionFound && !captureQualityPass) {
        rejectionReason = quality.reason;
      }
      rejectionReasons[rejectionReason] = (rejectionReasons[rejectionReason] ?? 0) + 1;

      if (frame.hasDocument) {
        if (detectionFound && detection.candidate && frame.groundTruth) {
          const iou = quadIoU(frame.groundTruth, detection.candidate.quad);
          ious.push(iou);
          if (iou >= 0.85) {
            lockPassCount += 1;
          }
        } else {
          ious.push(0);
        }
      } else if (detectionFound && detection.candidate) {
        falsePositiveCount += 1;
      }

      if (!detectionFound || !detection.candidate) {
        state.missFrames += 1;
        if (state.smoothed && state.missFrames <= 2) {
          state.stableFrames = Math.max(0, state.stableFrames - 1);
          continue;
        }
        state.missFrames = 0;
        state.smoothed = undefined;
        state.stableStartMs = undefined;
        state.stableFrames = 0;
        continue;
      }
      state.missFrames = 0;

      const previousSmoothed = state.smoothed;
      const nextSmoothed = previousSmoothed
        ? lerpQuad(previousSmoothed, detection.candidate.quad, profile.emaAlpha)
        : detection.candidate.quad;
      state.smoothed = nextSmoothed;

      const movementRatio =
        previousSmoothed === undefined
          ? 0
          : maxCornerDisplacement(previousSmoothed, nextSmoothed) /
            Math.max(1, Math.hypot(frame.width, frame.height));

      const stableCandidate =
        captureEligible &&
        detection.candidate.score >= profile.minStableConfidence &&
        (movementRatio <= profile.movementThresholdRatio || previousSmoothed === undefined);

      if (!stableCandidate) {
        if (captureEligible) {
          state.stableStartMs = frame.tsMs;
          state.stableFrames = 1;
        } else {
          state.stableStartMs = undefined;
          state.stableFrames = 0;
        }
        continue;
      }

      if (state.stableStartMs === undefined) {
        state.stableStartMs = frame.tsMs;
      }
      state.stableFrames += 1;
      const stableMs = frame.tsMs - state.stableStartMs;
      const stableReady = stableMs >= profile.stabilityWindowMs;

      if (frame.hasDocument && stableReady && state.firstStableMs === undefined) {
        state.firstStableMs = frame.tsMs;
      }

      const cooldownReady =
        state.lastCaptureMs === undefined ||
        frame.tsMs - state.lastCaptureMs >= profile.autoCaptureCooldownMs;
      const streakReady =
        state.stableFrames >= Math.max(1, Math.floor(profile.autoCaptureConsecutiveStableFrames));
      if (!stableReady || !cooldownReady || !streakReady) {
        continue;
      }

      state.lastCaptureMs = frame.tsMs;
      if (!frame.hasDocument) {
        falseAutoCaptureCount += 1;
        continue;
      }

      if (state.captureMs === undefined) {
        state.captureMs = frame.tsMs;
      }
    }

    if (clipHasDocument) {
      if (state.firstDocumentMs !== undefined && state.firstStableMs !== undefined) {
        stableLatencies.push(state.firstStableMs - state.firstDocumentMs);
      }
      if (state.firstDocumentMs !== undefined && state.captureMs !== undefined) {
        const latency = state.captureMs - state.firstDocumentMs;
        captureLatencies.push(latency);
        captureSuccessCount += 1;
        if (latency <= 2000) {
          captureWithin2sCount += 1;
        }
      }
    }
  }

  const lockPassRateAt085 = documentFrames === 0 ? 0 : lockPassCount / Math.max(1, documentFrames);
  const falsePositiveRate =
    nonDocumentFrames === 0 ? 0 : falsePositiveCount / Math.max(1, nonDocumentFrames);
  const autoCaptureSuccessRate =
    documentClips === 0 ? 0 : captureSuccessCount / Math.max(1, documentClips);
  const autoCaptureWithin2sRate =
    documentClips === 0 ? 0 : captureWithin2sCount / Math.max(1, documentClips);

  const fpNorm = clamp(1 - falsePositiveRate / 0.02, 0, 1);
  const stableNorm =
    stableLatencies.length === 0
      ? 0
      : clamp(1 - Math.max(0, median(stableLatencies) - 650) / 1500, 0, 1);
  const fpsNorm = clamp(percentile(fpsSamples, 10) / 8, 0, 1);
  const score =
    lockPassRateAt085 * 40 +
    fpNorm * 25 +
    autoCaptureWithin2sRate * 20 +
    autoCaptureSuccessRate * 10 +
    stableNorm * 3 +
    fpsNorm * 2;
  const penalty =
    (lockPassRateAt085 < 0.8 ? (0.8 - lockPassRateAt085) * 80 : 0) +
    (falsePositiveRate > 0.05 ? (falsePositiveRate - 0.05) * 120 : 0);
  const objectiveScore = Number((score - penalty).toFixed(4));

  return {
    totals: {
      frames: sorted.length,
      documentFrames,
      nonDocumentFrames,
      documentClips,
      nonDocumentClips,
    },
    detection: {
      lockPassRateAt085,
      falsePositiveRate,
      iouMean: mean(ious),
      iouP50: median(ious),
      iouP90: percentile(ious, 90),
    },
    capture: {
      autoCaptureSuccessRate,
      autoCaptureWithin2sRate,
      medianCaptureLatencyMs: median(captureLatencies),
      medianTimeToStableMs: median(stableLatencies),
      p90TimeToStableMs: percentile(stableLatencies, 90),
      falseAutoCaptureCount,
    },
    perf: {
      fpsMean: mean(fpsSamples),
      fpsP50: median(fpsSamples),
      fpsP10: percentile(fpsSamples, 10),
    },
    diagnostics: {
      detectorSourceStats,
      rejectionReasons,
      fallbackActiveFrames,
    },
    acceptance: {
      lockPass: lockPassRateAt085 >= 0.95,
      falsePositivePass: falsePositiveRate <= 0.02,
      autoCapturePass: autoCaptureSuccessRate >= 0.85,
      autoCaptureWithin2sPass: autoCaptureWithin2sRate >= 0.85,
    },
    objectiveScore,
  };
}

export function tuneThresholdProfile(
  frames: NormalizedFrame[],
  baseProfile: ThresholdProfile = defaultThresholdProfile(),
): TuningResult {
  const dimensions: Array<{ key: keyof ThresholdProfile; values: number[] }> = [
    { key: 'confidenceThreshold', values: [0.45, 0.48, 0.5, 0.52, 0.54, 0.55, 0.57, 0.59, 0.61] },
    { key: 'ambiguityScoreMargin', values: [0.04, 0.06, 0.08, 0.1, 0.12] },
    { key: 'minStableConfidence', values: [0.38, 0.42, 0.46, 0.5, 0.54] },
    { key: 'stabilityWindowMs', values: [350, 450, 550, 650, 750] },
    { key: 'movementThresholdRatio', values: [0.01, 0.015, 0.02, 0.025, 0.03, 0.035] },
    { key: 'brightnessMin', values: [35, 40, 45, 50, 55, 60] },
    { key: 'brightnessMax', values: [205, 210, 215, 220, 225, 230] },
    { key: 'blurVarianceMin', values: [24, 30, 35, 40, 46, 52] },
    { key: 'glareRatioMax', values: [0.06, 0.08, 0.1, 0.12, 0.14] },
    { key: 'autoCaptureConsecutiveStableFrames', values: [1, 2, 3, 4] },
    { key: 'autoCaptureCooldownMs', values: [900, 1100, 1300, 1400, 1500, 1700] },
    { key: 'emaAlpha', values: [0.2, 0.25, 0.3, 0.35] },
  ];

  let evaluations = 0;
  const baselineMetrics = simulateDataset(frames, baseProfile);
  evaluations += 1;
  let currentProfile = { ...baseProfile };
  let currentMetrics = baselineMetrics;
  let passes = 0;

  for (let pass = 0; pass < 3; pass += 1) {
    let improvedInPass = false;
    for (const dimension of dimensions) {
      let localBestProfile = currentProfile;
      let localBestMetrics = currentMetrics;

      for (const value of dimension.values) {
        if ((currentProfile[dimension.key] as number) === value) {
          continue;
        }
        const candidateProfile = {
          ...currentProfile,
          [dimension.key]: value,
        } as ThresholdProfile;
        const candidateMetrics = simulateDataset(frames, candidateProfile);
        evaluations += 1;
        if (isBetter(candidateMetrics, localBestMetrics)) {
          localBestProfile = candidateProfile;
          localBestMetrics = candidateMetrics;
        }
      }

      if (localBestProfile !== currentProfile) {
        currentProfile = localBestProfile;
        currentMetrics = localBestMetrics;
        improvedInPass = true;
      }
    }

    passes += 1;
    if (!improvedInPass) {
      break;
    }
  }

  const random = mulberry32(0xc0ffee42);
  for (let i = 0; i < 180; i += 1) {
    const candidateProfile = randomProfileAround(currentProfile, random);
    const candidateMetrics = simulateDataset(frames, candidateProfile);
    evaluations += 1;
    if (isBetter(candidateMetrics, currentMetrics)) {
      currentProfile = candidateProfile;
      currentMetrics = candidateMetrics;
    }
  }

  return {
    baselineProfile: baseProfile,
    tunedProfile: currentProfile,
    baselineMetrics,
    tunedMetrics: currentMetrics,
    evaluations,
    passes,
  };
}
