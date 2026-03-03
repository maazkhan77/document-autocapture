import { clamp, polygonArea, quadArea, quadAspectRatio, quadToPoints, type Point, type Quad } from '@docuscan/core-engine';

export interface ClipCandidateMetrics {
  areaFraction?: number;
  aspectRatio?: number;
  borderPenalty?: number;
  edgeStrength?: number;
}

export interface ClipCandidateInput {
  quad?: Quad | null;
  score: number;
  source?: 'cv' | 'ml';
  metrics?: ClipCandidateMetrics;
}

export interface ClipQualityInput {
  brightness?: number;
  blur?: number;
  glare?: number;
}

export interface RealClipFrameInput {
  id: string;
  tsMs?: number;
  hasDocument: boolean;
  groundTruth?: Quad | null;
  cvCandidates?: ClipCandidateInput[];
  mlCandidate?: ClipCandidateInput | null;
  quality?: ClipQualityInput;
  detectionMs?: number;
}

export interface RealClipManifest {
  datasetName: string;
  clipId: string;
  width: number;
  height: number;
  frames: RealClipFrameInput[];
  tags?: string[];
  source?: string;
}

export interface RealClipBundle {
  datasetName: string;
  clips: RealClipManifest[];
}

export interface NormalizedCandidate {
  quad: Quad;
  score: number;
  source: 'cv' | 'ml';
  areaFraction: number;
  aspectRatio: number;
  borderPenalty: number;
  edgeStrength: number;
}

export interface NormalizedFrame {
  datasetName: string;
  clipId: string;
  width: number;
  height: number;
  frameId: string;
  tsMs: number;
  hasDocument: boolean;
  groundTruth?: Quad;
  cvCandidates: NormalizedCandidate[];
  mlCandidate?: NormalizedCandidate;
  quality: {
    brightness: number;
    blur: number;
    glare: number;
  };
  detectionMs: number;
  variant: 'base' | 'randomized';
  randomizedFrom?: string;
  tags: string[];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function polygonSignedArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return area / 2;
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
  const x4 = p4.x;
  const y4 = p4.y;

  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-8) {
    return { x: p2.x, y: p2.y };
  }

  const pre = x1 * y2 - y1 * x2;
  const post = x3 * y4 - y3 * x4;
  return {
    x: (pre * (x3 - x4) - (x1 - x2) * post) / den,
    y: (pre * (y3 - y4) - (y1 - y2) * post) / den,
  };
}

function isInside(point: Point, edgeStart: Point, edgeEnd: Point, orientation: 1 | -1): boolean {
  const cross =
    (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) -
    (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
  return orientation * cross >= -1e-8;
}

function intersectConvexPolygons(subject: Point[], clip: Point[]): Point[] {
  if (subject.length === 0 || clip.length === 0) {
    return [];
  }

  let output = [...subject];
  const orientation = polygonSignedArea(clip) >= 0 ? 1 : -1;

  for (let i = 0; i < clip.length; i += 1) {
    const cp1 = clip[i];
    const cp2 = clip[(i + 1) % clip.length];
    const input = [...output];
    output = [];

    if (input.length === 0) {
      break;
    }

    let s = input[input.length - 1];
    for (const e of input) {
      const eInside = isInside(e, cp1, cp2, orientation);
      const sInside = isInside(s, cp1, cp2, orientation);

      if (eInside) {
        if (!sInside) {
          output.push(lineIntersection(s, e, cp1, cp2));
        }
        output.push(e);
      } else if (sInside) {
        output.push(lineIntersection(s, e, cp1, cp2));
      }
      s = e;
    }
  }

  return output;
}

function estimateBorderPenalty(quad: Quad, width: number, height: number, margin = 8): number {
  const points = quadToPoints(quad);
  const touches = points.filter(
    (point) =>
      point.x <= margin ||
      point.y <= margin ||
      point.x >= width - 1 - margin ||
      point.y >= height - 1 - margin,
  ).length;
  return clamp(touches / 4, 0, 1);
}

function toQuad(value: unknown): Quad | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const quad = value as Partial<Quad>;
  if (
    !quad.topLeft ||
    !quad.topRight ||
    !quad.bottomRight ||
    !quad.bottomLeft ||
    typeof quad.topLeft.x !== 'number' ||
    typeof quad.topLeft.y !== 'number' ||
    typeof quad.topRight.x !== 'number' ||
    typeof quad.topRight.y !== 'number' ||
    typeof quad.bottomRight.x !== 'number' ||
    typeof quad.bottomRight.y !== 'number' ||
    typeof quad.bottomLeft.x !== 'number' ||
    typeof quad.bottomLeft.y !== 'number'
  ) {
    return undefined;
  }

  return {
    topLeft: { x: quad.topLeft.x, y: quad.topLeft.y },
    topRight: { x: quad.topRight.x, y: quad.topRight.y },
    bottomRight: { x: quad.bottomRight.x, y: quad.bottomRight.y },
    bottomLeft: { x: quad.bottomLeft.x, y: quad.bottomLeft.y },
  };
}

function normalizeCandidate(
  value: unknown,
  width: number,
  height: number,
  source: 'cv' | 'ml',
): NormalizedCandidate | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const score = typeof value.score === 'number' ? clamp(value.score, 0, 1) : undefined;
  const quad = toQuad(value.quad);
  if (score === undefined || !quad) {
    return undefined;
  }
  const metrics = isObject(value.metrics) ? value.metrics : undefined;
  const areaFraction = typeof metrics?.areaFraction === 'number' ? metrics.areaFraction : quadArea(quad) / Math.max(1, width * height);
  const aspectRatio = typeof metrics?.aspectRatio === 'number' ? metrics.aspectRatio : quadAspectRatio(quad);
  const borderPenalty =
    typeof metrics?.borderPenalty === 'number'
      ? clamp(metrics.borderPenalty, 0, 1)
      : estimateBorderPenalty(quad, width, height);
  const edgeStrength =
    typeof metrics?.edgeStrength === 'number' ? clamp(metrics.edgeStrength, 0, 1) : 0.65;

  return {
    quad,
    score,
    source,
    areaFraction,
    aspectRatio,
    borderPenalty,
    edgeStrength,
  };
}

function normalizeQuality(value: unknown): { brightness: number; blur: number; glare: number } {
  const obj = isObject(value) ? value : {};
  const brightness = typeof obj.brightness === 'number' ? clamp(obj.brightness, 0, 255) : 140;
  const blur = typeof obj.blur === 'number' ? Math.max(0, obj.blur) : 45;
  const glare = typeof obj.glare === 'number' ? clamp(obj.glare, 0, 1) : 0.03;
  return { brightness, blur, glare };
}

export function normalizeFrame(
  manifest: RealClipManifest,
  frame: RealClipFrameInput,
  frameIndex: number,
  tags: string[],
): NormalizedFrame {
  const cvCandidates = Array.isArray(frame.cvCandidates)
    ? frame.cvCandidates
        .map((candidate) => normalizeCandidate(candidate, manifest.width, manifest.height, 'cv'))
        .filter((candidate): candidate is NormalizedCandidate => Boolean(candidate))
        .sort((a, b) => b.score - a.score)
    : [];
  const mlCandidate = frame.mlCandidate
    ? normalizeCandidate(frame.mlCandidate, manifest.width, manifest.height, 'ml')
    : undefined;

  return {
    datasetName: manifest.datasetName,
    clipId: manifest.clipId,
    width: manifest.width,
    height: manifest.height,
    frameId: frame.id,
    tsMs: typeof frame.tsMs === 'number' ? frame.tsMs : frameIndex * 33,
    hasDocument: Boolean(frame.hasDocument),
    groundTruth: frame.groundTruth ? toQuad(frame.groundTruth) : undefined,
    cvCandidates,
    mlCandidate,
    quality: normalizeQuality(frame.quality),
    detectionMs: typeof frame.detectionMs === 'number' && frame.detectionMs > 0 ? frame.detectionMs : 16.7,
    variant: 'base',
    tags,
  };
}

export function normalizeManifest(value: unknown, sourceFile = 'unknown'): RealClipManifest[] {
  if (!isObject(value)) {
    throw new Error(`Invalid manifest in ${sourceFile}: root is not an object`);
  }

  if (Array.isArray(value.clips)) {
    const datasetName = typeof value.datasetName === 'string' ? value.datasetName : 'real-clips';
    const clips = value.clips.map((clip, index) => {
      if (!isObject(clip)) {
        throw new Error(`Invalid clip at index ${index} in ${sourceFile}`);
      }
      const parsed = clip as Partial<RealClipManifest>;
      if (typeof parsed.clipId !== 'string' || typeof parsed.width !== 'number' || typeof parsed.height !== 'number' || !Array.isArray(parsed.frames)) {
        throw new Error(`Clip shape mismatch at index ${index} in ${sourceFile}`);
      }
      return {
        datasetName,
        clipId: parsed.clipId,
        width: parsed.width,
        height: parsed.height,
        frames: parsed.frames as RealClipFrameInput[],
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        source: typeof parsed.source === 'string' ? parsed.source : undefined,
      } satisfies RealClipManifest;
    });
    return clips;
  }

  const parsed = value as Partial<RealClipManifest>;
  if (
    typeof parsed.datasetName !== 'string' ||
    typeof parsed.clipId !== 'string' ||
    typeof parsed.width !== 'number' ||
    typeof parsed.height !== 'number' ||
    !Array.isArray(parsed.frames)
  ) {
    throw new Error(`Manifest shape mismatch in ${sourceFile}`);
  }
  return [
    {
      datasetName: parsed.datasetName,
      clipId: parsed.clipId,
      width: parsed.width,
      height: parsed.height,
      frames: parsed.frames as RealClipFrameInput[],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      source: typeof parsed.source === 'string' ? parsed.source : undefined,
    },
  ];
}

export function quadIoU(a: Quad, b: Quad): number {
  const polygonA = quadToPoints(a);
  const polygonB = quadToPoints(b);
  const intersectionPolygon = intersectConvexPolygons(polygonA, polygonB);
  const intersectionArea = polygonArea(intersectionPolygon);
  const areaA = polygonArea(polygonA);
  const areaB = polygonArea(polygonB);
  const union = Math.max(1e-6, areaA + areaB - intersectionArea);
  return intersectionArea / union;
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[index];
}
