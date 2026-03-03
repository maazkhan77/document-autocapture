import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clamp, type Quad } from '@document-autocapture/core-engine';
import { ingestMidv, ingestSmartDoc } from './external-datasets';
import {
  normalizeFrame,
  normalizeManifest,
  type NormalizedCandidate,
  type NormalizedFrame,
  type RealClipManifest,
} from './realclip-shared';

interface IngestOptions {
  variantsPerFrame: number;
  maxCornerJitterPx: number;
  scoreJitter: number;
  brightnessJitter: number;
  blurJitterRatio: number;
  glareJitter: number;
}

interface IngestOutput {
  generatedAt: string;
  sourceRoot: string;
  sourceFiles: string[];
  options: IngestOptions;
  summary: {
    clips: number;
    baseFrames: number;
    randomizedFrames: number;
    totalFrames: number;
    documentFrames: number;
    nonDocumentFrames: number;
    byDataset: Record<string, { clips: number; frames: number }>;
  };
  frames: NormalizedFrame[];
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function jitter(value: number, amount: number, random: () => number): number {
  return value + (random() * 2 - 1) * amount;
}

function clampQuad(quad: Quad, width: number, height: number): Quad {
  const clampX = (x: number) => clamp(x, 0, width - 1);
  const clampY = (y: number) => clamp(y, 0, height - 1);
  return {
    topLeft: { x: clampX(quad.topLeft.x), y: clampY(quad.topLeft.y) },
    topRight: { x: clampX(quad.topRight.x), y: clampY(quad.topRight.y) },
    bottomRight: { x: clampX(quad.bottomRight.x), y: clampY(quad.bottomRight.y) },
    bottomLeft: { x: clampX(quad.bottomLeft.x), y: clampY(quad.bottomLeft.y) },
  };
}

function jitterCandidate(
  candidate: NormalizedCandidate,
  frame: NormalizedFrame,
  options: IngestOptions,
  random: () => number,
): NormalizedCandidate {
  const jitteredQuad = clampQuad(
    {
      topLeft: {
        x: jitter(candidate.quad.topLeft.x, options.maxCornerJitterPx, random),
        y: jitter(candidate.quad.topLeft.y, options.maxCornerJitterPx, random),
      },
      topRight: {
        x: jitter(candidate.quad.topRight.x, options.maxCornerJitterPx, random),
        y: jitter(candidate.quad.topRight.y, options.maxCornerJitterPx, random),
      },
      bottomRight: {
        x: jitter(candidate.quad.bottomRight.x, options.maxCornerJitterPx, random),
        y: jitter(candidate.quad.bottomRight.y, options.maxCornerJitterPx, random),
      },
      bottomLeft: {
        x: jitter(candidate.quad.bottomLeft.x, options.maxCornerJitterPx, random),
        y: jitter(candidate.quad.bottomLeft.y, options.maxCornerJitterPx, random),
      },
    },
    frame.width,
    frame.height,
  );

  const score = clamp(
    candidate.score * (1 + jitter(0, options.scoreJitter, random)),
    0,
    1,
  );

  return {
    ...candidate,
    quad: jitteredQuad,
    score,
    borderPenalty: clamp(candidate.borderPenalty + jitter(0, 0.08, random), 0, 1),
    edgeStrength: clamp(candidate.edgeStrength + jitter(0, 0.12, random), 0, 1),
  };
}

function jitterFrame(
  frame: NormalizedFrame,
  variantIndex: number,
  options: IngestOptions,
): NormalizedFrame {
  const random = mulberry32(hashString(`${frame.clipId}:${frame.frameId}:${variantIndex}`));
  const cvCandidates = frame.cvCandidates.map((candidate) =>
    jitterCandidate(candidate, frame, options, random),
  );
  cvCandidates.sort((a, b) => b.score - a.score);
  const mlCandidate = frame.mlCandidate
    ? jitterCandidate(frame.mlCandidate, frame, options, random)
    : undefined;

  return {
    ...frame,
    clipId: `${frame.clipId}#rand${variantIndex + 1}`,
    frameId: `${frame.frameId}#rand${variantIndex + 1}`,
    cvCandidates,
    mlCandidate,
    detectionMs: Math.max(4, frame.detectionMs * (1 + jitter(0, 0.22, random))),
    quality: {
      brightness: clamp(
        frame.quality.brightness + jitter(0, options.brightnessJitter, random),
        0,
        255,
      ),
      blur: Math.max(
        0,
        frame.quality.blur * (1 + jitter(0, options.blurJitterRatio, random)),
      ),
      glare: clamp(frame.quality.glare + jitter(0, options.glareJitter, random), 0, 1),
    },
    variant: 'randomized',
    randomizedFrom: frame.frameId,
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
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path.resolve(inputPath, entry.name));
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await collectJsonFiles(path.resolve(inputPath, entry.name));
      files.push(...nested);
    }
  }
  return files.sort();
}

async function readManifests(files: string[]): Promise<RealClipManifest[]> {
  const manifests: RealClipManifest[] = [];
  for (const file of files) {
    const input = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(input);
    manifests.push(...normalizeManifest(parsed, file));
  }
  return manifests;
}

function buildSummary(frames: NormalizedFrame[]) {
  const baseFrames = frames.filter((frame) => frame.variant === 'base').length;
  const randomizedFrames = frames.length - baseFrames;
  const documentFrames = frames.filter((frame) => frame.hasDocument).length;
  const byDataset = frames.reduce<Record<string, { clips: Set<string>; frames: number }>>((acc, frame) => {
    const bucket =
      acc[frame.datasetName] ??
      (() => {
        const initial = { clips: new Set<string>(), frames: 0 };
        acc[frame.datasetName] = initial;
        return initial;
      })();
    bucket.clips.add(frame.clipId);
    bucket.frames += 1;
    return acc;
  }, {});

  const normalizedByDataset = Object.fromEntries(
    Object.entries(byDataset).map(([dataset, value]) => [
      dataset,
      {
        clips: value.clips.size,
        frames: value.frames,
      },
    ]),
  );

  return {
    clips: new Set(frames.map((frame) => frame.clipId)).size,
    baseFrames,
    randomizedFrames,
    totalFrames: frames.length,
    documentFrames,
    nonDocumentFrames: frames.length - documentFrames,
    byDataset: normalizedByDataset,
  };
}

function parseOptions(): IngestOptions {
  const variantsArg = Number.parseInt(process.argv[4] ?? '', 10);
  const envVariants = Number.parseInt(process.env.DOCUMENT_AUTOCAPTURE_RANDOM_VARIANTS ?? '', 10);
  const variantsPerFrame = Number.isFinite(variantsArg)
    ? variantsArg
    : Number.isFinite(envVariants)
      ? envVariants
      : 2;

  return {
    variantsPerFrame: clamp(variantsPerFrame, 0, 6),
    maxCornerJitterPx: 6,
    scoreJitter: 0.2,
    brightnessJitter: 22,
    blurJitterRatio: 0.35,
    glareJitter: 0.05,
  };
}

function toMarkdown(output: IngestOutput): string {
  const lines: string[] = [];
  lines.push('# Real Clip Ingestion Report');
  lines.push('');
  lines.push(`Generated: ${output.generatedAt}`);
  lines.push('');
  lines.push('## Input');
  lines.push('');
  lines.push(`- Source root: ${output.sourceRoot}`);
  lines.push(`- Source files: ${output.sourceFiles.length}`);
  lines.push(`- Randomized variants per base frame: ${output.options.variantsPerFrame}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Clips: ${output.summary.clips}`);
  lines.push(`- Base frames: ${output.summary.baseFrames}`);
  lines.push(`- Randomized frames: ${output.summary.randomizedFrames}`);
  lines.push(`- Total frames: ${output.summary.totalFrames}`);
  lines.push(`- Document frames: ${output.summary.documentFrames}`);
  lines.push(`- Non-document frames: ${output.summary.nonDocumentFrames}`);
  lines.push('');
  lines.push('## Dataset Breakdown');
  lines.push('');
  for (const [dataset, stats] of Object.entries(output.summary.byDataset).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`- ${dataset}: clips=${stats.clips}, frames=${stats.frames}`);
  }
  lines.push('');
  lines.push('## Source Files');
  lines.push('');
  for (const file of output.sourceFiles) {
    lines.push(`- ${file}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..');
  const sourcePath = process.argv[2] ?? path.resolve(root, 'datasets/real-clips');
  const outputPath = process.argv[3] ?? path.resolve(process.cwd(), 'output/realclip/ingested.json');
  const reportPath = path.resolve(root, 'docs/realclip-ingestion-report.md');
  const smartDocPath = process.env.DOCUMENT_AUTOCAPTURE_SMARTDOC_PATH;
  const midvPath = process.env.DOCUMENT_AUTOCAPTURE_MIDV_PATH;
  const options = parseOptions();

  const files: string[] = [];
  const manifests: RealClipManifest[] = [];

  try {
    const primaryFiles = await collectJsonFiles(sourcePath);
    files.push(...primaryFiles);
    if (primaryFiles.length > 0) {
      const primaryManifests = await readManifests(primaryFiles);
      manifests.push(...primaryManifests);
    }
  } catch (error) {
    throw new Error(
      `Failed to load primary real-clip dataset from ${sourcePath}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  if (smartDocPath) {
    const smartdocManifests = await ingestSmartDoc(path.resolve(smartDocPath));
    manifests.push(...smartdocManifests);
    files.push(`adapter:smartdoc:${path.resolve(smartDocPath)}`);
  }

  if (midvPath) {
    const midvManifests = await ingestMidv(path.resolve(midvPath));
    manifests.push(...midvManifests);
    files.push(`adapter:midv:${path.resolve(midvPath)}`);
  }

  if (manifests.length === 0) {
    throw new Error(
      `No manifests loaded. Checked real-clips at ${sourcePath}${
        smartDocPath ? `, SmartDoc at ${smartDocPath}` : ''
      }${midvPath ? `, MIDV at ${midvPath}` : ''}`,
    );
  }
  const frames: NormalizedFrame[] = [];
  for (const manifest of manifests) {
    const tags = manifest.tags ?? [];
    const normalized = manifest.frames.map((frame, frameIndex) =>
      normalizeFrame(manifest, frame, frameIndex, tags),
    );
    frames.push(...normalized);

    for (const frame of normalized) {
      for (let variantIndex = 0; variantIndex < options.variantsPerFrame; variantIndex += 1) {
        frames.push(jitterFrame(frame, variantIndex, options));
      }
    }
  }

  const output: IngestOutput = {
    generatedAt: new Date().toISOString(),
    sourceRoot: path.resolve(sourcePath),
    sourceFiles: files,
    options,
    summary: buildSummary(frames),
    frames,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
  await writeFile(reportPath, toMarkdown(output), 'utf8');

  process.stdout.write(`Wrote ingested real-clip dataset to ${outputPath}\n`);
  process.stdout.write(`Wrote ingestion report to ${reportPath}\n`);
}

void main();
