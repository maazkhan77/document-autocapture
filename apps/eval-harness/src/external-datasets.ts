import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ClipCandidateInput,
  RealClipFrameInput,
  RealClipManifest,
} from './realclip-shared';

interface BasicFrameLike {
  id?: unknown;
  frame?: unknown;
  frameId?: unknown;
  index?: unknown;
  timestampMs?: unknown;
  tsMs?: unknown;
  hasDocument?: unknown;
  document_present?: unknown;
  quad?: unknown;
  corners?: unknown;
  points?: unknown;
  groundTruth?: unknown;
  brightness?: unknown;
  blur?: unknown;
  glare?: unknown;
  detectionMs?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') {
      return true;
    }
    if (value === '0' || value.toLowerCase() === 'false') {
      return false;
    }
  }
  return undefined;
}

function normalizePoint(value: unknown): { x: number; y: number } | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = asNumber(value[0]);
    const y = asNumber(value[1]);
    if (x !== undefined && y !== undefined) {
      return { x, y };
    }
  }
  if (isObject(value)) {
    const x = asNumber(value.x);
    const y = asNumber(value.y);
    if (x !== undefined && y !== undefined) {
      return { x, y };
    }
  }
  return undefined;
}

function normalizeQuad(value: unknown) {
  if (isObject(value)) {
    const topLeft = normalizePoint(value.topLeft);
    const topRight = normalizePoint(value.topRight);
    const bottomRight = normalizePoint(value.bottomRight);
    const bottomLeft = normalizePoint(value.bottomLeft);
    if (topLeft && topRight && bottomRight && bottomLeft) {
      return { topLeft, topRight, bottomRight, bottomLeft };
    }
  }

  if (Array.isArray(value) && value.length >= 4) {
    const p0 = normalizePoint(value[0]);
    const p1 = normalizePoint(value[1]);
    const p2 = normalizePoint(value[2]);
    const p3 = normalizePoint(value[3]);
    if (p0 && p1 && p2 && p3) {
      return {
        topLeft: p0,
        topRight: p1,
        bottomRight: p2,
        bottomLeft: p3,
      };
    }
  }

  return undefined;
}

function toFrameCandidate(frame: BasicFrameLike): ClipCandidateInput[] {
  const quad =
    normalizeQuad(frame.quad) ??
    normalizeQuad(frame.corners) ??
    normalizeQuad(frame.points);
  if (!quad) {
    return [];
  }
  return [
    {
      score: 0.9,
      quad,
      source: 'cv',
    },
  ];
}

function normalizeFrame(
  frame: BasicFrameLike,
  index: number,
): RealClipFrameInput {
  const frameId =
    asString(frame.id) ??
    asString(frame.frameId) ??
    asString(frame.frame) ??
    asString(frame.index) ??
    `frame-${index + 1}`;

  const groundTruth =
    normalizeQuad(frame.groundTruth) ??
    normalizeQuad(frame.quad) ??
    normalizeQuad(frame.corners) ??
    normalizeQuad(frame.points);

  const hasDocument =
    asBool(frame.hasDocument) ??
    asBool(frame.document_present) ??
    Boolean(groundTruth);

  const detectionMs = asNumber(frame.detectionMs);
  const brightness = asNumber(frame.brightness);
  const blur = asNumber(frame.blur);
  const glare = asNumber(frame.glare);
  const candidates = toFrameCandidate(frame);

  return {
    id: frameId,
    tsMs: asNumber(frame.timestampMs) ?? asNumber(frame.tsMs) ?? index * 33,
    hasDocument,
    groundTruth,
    cvCandidates: candidates,
    quality:
      brightness !== undefined || blur !== undefined || glare !== undefined
        ? {
            brightness,
            blur,
            glare,
          }
        : undefined,
    detectionMs: detectionMs ?? 16.7,
  };
}

async function collectJsonFiles(inputPath: string): Promise<string[]> {
  const stats = await stat(inputPath);
  if (stats.isFile()) {
    return [path.resolve(inputPath)];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Input path is neither file nor directory: ${inputPath}`);
  }

  const entries = await readdir(inputPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.resolve(inputPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonFiles(full);
      files.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files.sort();
}

function parseClipLike(
  raw: unknown,
  defaults: { datasetName: string; clipId: string; width: number; height: number },
): RealClipManifest | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const width = asNumber(raw.width) ?? asNumber(raw.frameWidth) ?? defaults.width;
  const height = asNumber(raw.height) ?? asNumber(raw.frameHeight) ?? defaults.height;
  if (!width || !height || width <= 0 || height <= 0) {
    return undefined;
  }

  const frameArray =
    (Array.isArray(raw.frames) ? raw.frames : undefined) ??
    (Array.isArray(raw.annotations) ? raw.annotations : undefined) ??
    (Array.isArray(raw.groundTruth) ? raw.groundTruth : undefined);
  if (!frameArray) {
    return undefined;
  }

  const clipId = asString(raw.clipId) ?? asString(raw.videoId) ?? defaults.clipId;
  const datasetName = asString(raw.datasetName) ?? defaults.datasetName;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  const frames = frameArray
    .map((frame, index) => {
      if (!isObject(frame)) {
        return undefined;
      }
      return normalizeFrame(frame as BasicFrameLike, index);
    })
    .filter((frame): frame is RealClipFrameInput => Boolean(frame));

  if (frames.length === 0) {
    return undefined;
  }

  return {
    datasetName,
    clipId,
    width,
    height,
    frames,
    tags,
  };
}

async function parseDatasetFiles(
  inputPath: string,
  datasetName: string,
  defaults: { width: number; height: number },
): Promise<RealClipManifest[]> {
  const files = await collectJsonFiles(inputPath);
  const manifests: RealClipManifest[] = [];

  for (const file of files) {
    const input = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(input);
    const fallbackClipId = path.basename(file, path.extname(file));

    if (isObject(parsed) && Array.isArray(parsed.clips)) {
      const clips = parsed.clips
        .map((clip, index) =>
          parseClipLike(clip, {
            datasetName,
            clipId: `${fallbackClipId}-${index + 1}`,
            width: defaults.width,
            height: defaults.height,
          }),
        )
        .filter((clip): clip is RealClipManifest => Boolean(clip));
      manifests.push(...clips);
      continue;
    }

    const single = parseClipLike(parsed, {
      datasetName,
      clipId: fallbackClipId,
      width: defaults.width,
      height: defaults.height,
    });
    if (single) {
      manifests.push(single);
    }
  }

  return manifests;
}

export async function ingestSmartDoc(inputPath: string): Promise<RealClipManifest[]> {
  return parseDatasetFiles(inputPath, 'smartdoc-2015', {
    width: 1920,
    height: 1080,
  });
}

export async function ingestMidv(inputPath: string): Promise<RealClipManifest[]> {
  return parseDatasetFiles(inputPath, 'midv-500', {
    width: 1280,
    height: 720,
  });
}
