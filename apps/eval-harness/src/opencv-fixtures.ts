import type { Quad } from '@document-autocapture/core-engine';
import type { ClipCandidateInput, RealClipFrameInput, RealClipManifest } from './realclip-shared';

function makeQuad(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  skewX = 0,
  skewY = 0,
): Quad {
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    topLeft: { x: centerX - halfW + skewX, y: centerY - halfH + skewY },
    topRight: { x: centerX + halfW + skewX, y: centerY - halfH - skewY },
    bottomRight: { x: centerX + halfW - skewX, y: centerY + halfH - skewY },
    bottomLeft: { x: centerX - halfW - skewX, y: centerY + halfH + skewY },
  };
}

function makeCandidate(
  quad: Quad,
  score: number,
  metrics: {
    areaFraction?: number;
    aspectRatio?: number;
    borderPenalty: number;
    edgeStrength: number;
  },
): ClipCandidateInput {
  return {
    quad,
    score,
    metrics,
  };
}

function docFrame(input: {
  id: string;
  tsMs: number;
  groundTruth: Quad;
  cvCandidates: ClipCandidateInput[];
  mlCandidate?: ClipCandidateInput | null;
  brightness?: number;
  blur?: number;
  glare?: number;
  detectionMs?: number;
}): RealClipFrameInput {
  return {
    id: input.id,
    tsMs: input.tsMs,
    hasDocument: true,
    groundTruth: input.groundTruth,
    cvCandidates: input.cvCandidates,
    mlCandidate: input.mlCandidate ?? null,
    quality: {
      brightness: input.brightness ?? 132,
      blur: input.blur ?? 44,
      glare: input.glare ?? 0.03,
    },
    detectionMs: input.detectionMs ?? 16,
  };
}

function noDocFrame(input: {
  id: string;
  tsMs: number;
  cvCandidates?: ClipCandidateInput[];
  mlCandidate?: ClipCandidateInput | null;
  brightness?: number;
  blur?: number;
  glare?: number;
  detectionMs?: number;
}): RealClipFrameInput {
  return {
    id: input.id,
    tsMs: input.tsMs,
    hasDocument: false,
    groundTruth: null,
    cvCandidates: input.cvCandidates ?? [],
    mlCandidate: input.mlCandidate ?? null,
    quality: {
      brightness: input.brightness ?? 124,
      blur: input.blur ?? 42,
      glare: input.glare ?? 0.04,
    },
    detectionMs: input.detectionMs ?? 17,
  };
}

function fragmentedEdgeClip(): RealClipManifest {
  const width = 480;
  const height = 672;
  const clipId = 'fixture-contour-fragmented-recovery';
  const target = makeQuad(240, 344, 302, 472, 10, 8);
  const distractor = makeQuad(330, 238, 154, 178, 5, 3);
  const frames: RealClipFrameInput[] = [];

  for (let i = 0; i < 24; i += 1) {
    const tsMs = i * 33;
    const jitter = (i % 3) - 1;
    const truth = makeQuad(240 + jitter * 1.2, 344 + jitter * 1.3, 302, 472, 10, 8);
    const recoveryScore = i < 5 ? 0.32 + i * 0.02 : 0.6 + Math.min(0.2, (i - 5) * 0.013);
    const cvCandidates: ClipCandidateInput[] = [
      makeCandidate(truth, recoveryScore, {
        areaFraction: 0.46,
        aspectRatio: 0.64,
        borderPenalty: 0.08,
        edgeStrength: i < 7 ? 0.33 : 0.72,
      }),
      makeCandidate(distractor, 0.22 + (i % 5) * 0.02, {
        areaFraction: 0.12,
        aspectRatio: 1.08,
        borderPenalty: 0.09,
        edgeStrength: 0.49,
      }),
    ];
    const mlCandidate =
      i < 5
        ? makeCandidate(target, 0.56 + i * 0.01, {
            areaFraction: 0.46,
            aspectRatio: 0.64,
            borderPenalty: 0.05,
            edgeStrength: 0.67,
          })
        : null;

    frames.push(
      docFrame({
        id: `${clipId}-f${String(i).padStart(3, '0')}`,
        tsMs,
        groundTruth: truth,
        cvCandidates,
        mlCandidate,
        brightness: 126 + (i % 4) * 2,
        blur: i < 6 ? 31 + i * 1.4 : 44 + (i % 3),
        glare: 0.03 + (i % 4) * 0.005,
        detectionMs: i < 5 ? 17.5 : 15.2,
      }),
    );
  }

  return {
    datasetName: 'opencv-contour-regression',
    clipId,
    width,
    height,
    source: 'fixture',
    tags: ['opencv-regression', 'contour-failure', 'fragmented-edges', 'cv-recovery'],
    frames,
  };
}

function borderTouchClip(): RealClipManifest {
  const width = 480;
  const height = 672;
  const clipId = 'fixture-contour-border-touch';
  const edgeDoc = makeQuad(160, 342, 320, 470, -10, 8);
  const saferQuad = makeQuad(206, 346, 300, 450, 7, 5);
  const frames: RealClipFrameInput[] = [];

  for (let i = 0; i < 20; i += 1) {
    const tsMs = i * 33;
    const primaryScore = i < 8 ? 0.62 + (i % 3) * 0.014 : 0.66 + (i % 4) * 0.012;
    const fallbackScore = 0.47 + (i % 5) * 0.016;
    const borderPenalty = i < 8 ? 0.38 : 0.24;

    frames.push(
      docFrame({
        id: `${clipId}-f${String(i).padStart(3, '0')}`,
        tsMs,
        groundTruth: edgeDoc,
        cvCandidates: [
          makeCandidate(edgeDoc, primaryScore, {
            areaFraction: 0.44,
            aspectRatio: 0.68,
            borderPenalty,
            edgeStrength: 0.71,
          }),
          makeCandidate(saferQuad, fallbackScore, {
            areaFraction: 0.41,
            aspectRatio: 0.66,
            borderPenalty: 0.13,
            edgeStrength: 0.62,
          }),
        ],
        mlCandidate: makeCandidate(saferQuad, 0.48 + (i % 6) * 0.02, {
          areaFraction: 0.35,
          aspectRatio: 0.58,
          borderPenalty: 0.12,
          edgeStrength: 0.59,
        }),
        brightness: 136,
        blur: 46 - (i % 3),
        glare: 0.025 + (i % 4) * 0.006,
        detectionMs: 15.8,
      }),
    );
  }

  return {
    datasetName: 'opencv-contour-regression',
    clipId,
    width,
    height,
    source: 'fixture',
    tags: ['opencv-regression', 'contour-failure', 'border-touch', 'ambiguity'],
    frames,
  };
}

function ambiguityClip(): RealClipManifest {
  const width = 480;
  const height = 672;
  const clipId = 'fixture-contour-ambiguity-clutter';
  const doc = makeQuad(248, 338, 284, 454, 9, 7);
  const clutter = makeQuad(250, 330, 296, 462, -22, 16);
  const frames: RealClipFrameInput[] = [];

  for (let i = 0; i < 18; i += 1) {
    const tsMs = i * 33;
    const docScore = i < 3 ? 0.57 + (i % 2) * 0.01 : 0.69 + (i % 3) * 0.013;
    const clutterScore = i < 3 ? 0.54 + (i % 2) * 0.012 : 0.37 + (i % 2) * 0.01;
    frames.push(
      docFrame({
        id: `${clipId}-f${String(i).padStart(3, '0')}`,
        tsMs,
        groundTruth: doc,
        cvCandidates: [
          makeCandidate(doc, docScore, {
            areaFraction: 0.43,
            aspectRatio: 0.62,
            borderPenalty: 0.1,
            edgeStrength: 0.68,
          }),
          makeCandidate(clutter, clutterScore, {
            areaFraction: 0.45,
            aspectRatio: 0.67,
            borderPenalty: 0.11,
            edgeStrength: 0.66,
          }),
        ],
        mlCandidate: i < 10
          ? makeCandidate(doc, 0.6 + (i % 4) * 0.012, {
              areaFraction: 0.43,
              aspectRatio: 0.62,
              borderPenalty: 0.08,
              edgeStrength: 0.72,
            })
          : null,
        brightness: 118 + (i % 6) * 4,
        blur: 40 + (i % 4) * 2.4,
        glare: 0.03 + (i % 5) * 0.007,
        detectionMs: 16.9,
      }),
    );
  }

  return {
    datasetName: 'opencv-contour-regression',
    clipId,
    width,
    height,
    source: 'fixture',
    tags: ['opencv-regression', 'contour-failure', 'clutter', 'ambiguity'],
    frames,
  };
}

function noDocumentNoiseClip(): RealClipManifest {
  const width = 480;
  const height = 672;
  const clipId = 'fixture-no-document-noise';
  const noiseA = makeQuad(166, 198, 166, 142, 4, 4);
  const noiseB = makeQuad(356, 426, 154, 168, -7, 8);
  const frames: RealClipFrameInput[] = [];

  for (let i = 0; i < 26; i += 1) {
    const tsMs = i * 33;
    frames.push(
      noDocFrame({
        id: `${clipId}-f${String(i).padStart(3, '0')}`,
        tsMs,
        cvCandidates: [
          makeCandidate(noiseA, 0.09 + (i % 4) * 0.025, {
            areaFraction: 0.11,
            aspectRatio: 1.15,
            borderPenalty: 0.26,
            edgeStrength: 0.45,
          }),
          makeCandidate(noiseB, 0.07 + (i % 5) * 0.02, {
            areaFraction: 0.09,
            aspectRatio: 0.91,
            borderPenalty: 0.22,
            edgeStrength: 0.41,
          }),
        ],
        mlCandidate: i % 6 === 0
          ? makeCandidate(noiseA, 0.18, {
              areaFraction: 0.11,
              aspectRatio: 1.15,
              borderPenalty: 0.24,
              edgeStrength: 0.39,
            })
          : null,
        brightness: 104 + (i % 7) * 5,
        blur: 42 - (i % 3) * 2.2,
        glare: 0.02 + (i % 5) * 0.01,
        detectionMs: 14.8 + (i % 4) * 0.9,
      }),
    );
  }

  return {
    datasetName: 'opencv-contour-regression',
    clipId,
    width,
    height,
    source: 'fixture',
    tags: ['opencv-regression', 'contour-failure', 'no-document', 'false-positive-guard'],
    frames,
  };
}

export function buildOpenCvContourFailureFixtures(): RealClipManifest[] {
  return [fragmentedEdgeClip(), borderTouchClip(), ambiguityClip(), noDocumentNoiseClip()];
}
