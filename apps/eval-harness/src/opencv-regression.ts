import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOpenCvContourFailureFixtures } from './opencv-fixtures';
import { defaultThresholdProfile, simulateDataset, type SimulationMetrics, type ThresholdProfile } from './realclip-sim';
import { normalizeFrame, normalizeManifest, type NormalizedFrame, type RealClipManifest } from './realclip-shared';

interface TunedProfileArtifact {
  tunedProfile?: ThresholdProfile;
}

interface OpenCvRegressionGates {
  overallLockPass: boolean;
  overallFalsePositivePass: boolean;
  overallAutoCaptureWithin2sPass: boolean;
  contourLockPass: boolean;
  contourFalsePositivePass: boolean;
  contourAutoCapturePass: boolean;
  noDocumentFalsePositivePass: boolean;
  fpsPass: boolean;
  overall: boolean;
}

export interface OpenCvRegressionOutput {
  generatedAt: string;
  inputs: {
    realClipPath: string;
    externalFixturePath?: string;
    sourceFiles: string[];
    profileSource: string;
  };
  totals: {
    manifests: number;
    frames: number;
    realClipFrames: number;
    contourFixtureFrames: number;
    documentFrames: number;
    nonDocumentFrames: number;
  };
  metrics: {
    overall: SimulationMetrics;
    realClips: SimulationMetrics | null;
    contourFixtures: SimulationMetrics | null;
    nonDocument: SimulationMetrics | null;
  };
  gates: OpenCvRegressionGates;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function hasPath(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectJsonFiles(inputPath: string): Promise<string[]> {
  const stats = await stat(inputPath);
  if (stats.isFile()) {
    return [path.resolve(inputPath)];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Expected file or directory, got: ${inputPath}`);
  }

  const entries = await readdir(inputPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.resolve(inputPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(resolved)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(resolved);
    }
  }
  return files.sort();
}

async function readManifests(files: string[]): Promise<RealClipManifest[]> {
  const manifests: RealClipManifest[] = [];
  for (const file of files) {
    const input = await readFile(file, 'utf8');
    const parsed = JSON.parse(input) as unknown;
    manifests.push(...normalizeManifest(parsed, file));
  }
  return manifests;
}

function normalizeManifests(manifests: RealClipManifest[], extraTag: string): NormalizedFrame[] {
  const frames: NormalizedFrame[] = [];
  for (const manifest of manifests) {
    const tags = [...(manifest.tags ?? []), extraTag];
    for (let i = 0; i < manifest.frames.length; i += 1) {
      frames.push(normalizeFrame(manifest, manifest.frames[i], i, tags));
    }
  }
  return frames;
}

function hasTag(frame: NormalizedFrame, tag: string): boolean {
  return frame.tags.includes(tag);
}

function safeSimulate(frames: NormalizedFrame[], profile: ThresholdProfile): SimulationMetrics | null {
  if (frames.length === 0) {
    return null;
  }
  return simulateDataset(frames, profile);
}

function evaluateGates(metrics: {
  overall: SimulationMetrics;
  contourFixtures: SimulationMetrics | null;
  nonDocument: SimulationMetrics | null;
}): OpenCvRegressionGates {
  const contour = metrics.contourFixtures;
  const noDocument = metrics.nonDocument;

  const baseGates = {
    overallLockPass: metrics.overall.detection.lockPassRateAt085 >= 0.9,
    overallFalsePositivePass: metrics.overall.detection.falsePositiveRate <= 0.02,
    overallAutoCaptureWithin2sPass: metrics.overall.capture.autoCaptureWithin2sRate >= 0.8,
    contourLockPass: contour ? contour.detection.lockPassRateAt085 >= 0.82 : false,
    contourFalsePositivePass: contour ? contour.detection.falsePositiveRate <= 0.03 : false,
    contourAutoCapturePass: contour ? contour.capture.autoCaptureSuccessRate >= 0.65 : false,
    noDocumentFalsePositivePass: noDocument ? noDocument.detection.falsePositiveRate <= 0.01 : false,
    fpsPass: metrics.overall.perf.fpsP10 >= 8,
  };

  const overall = Object.values(baseGates).every((value) => value);
  return {
    ...baseGates,
    overall,
  };
}

export function evaluateOpenCvRegression(
  frames: NormalizedFrame[],
  profile: ThresholdProfile,
): Pick<OpenCvRegressionOutput, 'metrics' | 'totals' | 'gates'> {
  if (frames.length === 0) {
    throw new Error('OpenCV regression requires at least one frame.');
  }

  const realClipFrames = frames.filter((frame) => hasTag(frame, 'real-clip'));
  const contourFixtureFrames = frames.filter((frame) => hasTag(frame, 'contour-failure'));
  const nonDocumentFrames = frames.filter((frame) => !frame.hasDocument);
  const overall = simulateDataset(frames, profile);
  const realClips = safeSimulate(realClipFrames, profile);
  const contourFixtures = safeSimulate(contourFixtureFrames, profile);
  const nonDocument = safeSimulate(nonDocumentFrames, profile);
  const gates = evaluateGates({
    overall,
    contourFixtures,
    nonDocument,
  });

  return {
    totals: {
      manifests: new Set(frames.map((frame) => `${frame.datasetName}:${frame.clipId}`)).size,
      frames: frames.length,
      realClipFrames: realClipFrames.length,
      contourFixtureFrames: contourFixtureFrames.length,
      documentFrames: frames.filter((frame) => frame.hasDocument).length,
      nonDocumentFrames: nonDocumentFrames.length,
    },
    metrics: {
      overall,
      realClips,
      contourFixtures,
      nonDocument,
    },
    gates,
  };
}

async function resolveThresholdProfile(root: string): Promise<{ profile: ThresholdProfile; source: string }> {
  const tunedPath = path.resolve(root, 'apps/eval-harness/output/realclip/tuned-thresholds.json');
  if (!(await hasPath(tunedPath))) {
    return {
      profile: defaultThresholdProfile(),
      source: 'default-threshold-profile',
    };
  }

  try {
    const parsed = JSON.parse(await readFile(tunedPath, 'utf8')) as unknown;
    if (!isObject(parsed)) {
      throw new Error('invalid tuned-thresholds payload');
    }
    const maybeProfile = (parsed as TunedProfileArtifact).tunedProfile;
    if (!maybeProfile) {
      throw new Error('missing tunedProfile field');
    }
    return {
      profile: maybeProfile,
      source: path.resolve(tunedPath),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load tuned threshold profile: ${message}`);
  }
}

function renderMetricRow(name: string, metrics: SimulationMetrics | null): string {
  if (!metrics) {
    return `| ${name} | n/a | n/a | n/a | n/a | n/a |`;
  }
  return `| ${name} | ${(metrics.detection.lockPassRateAt085 * 100).toFixed(2)}% | ${(metrics.detection.falsePositiveRate * 100).toFixed(2)}% | ${(metrics.capture.autoCaptureWithin2sRate * 100).toFixed(2)}% | ${metrics.capture.medianTimeToStableMs.toFixed(1)}ms | ${metrics.perf.fpsP10.toFixed(2)} |`;
}

function toMarkdown(output: OpenCvRegressionOutput): string {
  const lines: string[] = [];
  lines.push('# OpenCV Regression Report');
  lines.push('');
  lines.push(`Generated: ${output.generatedAt}`);
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push(`- Real clip path: ${output.inputs.realClipPath}`);
  if (output.inputs.externalFixturePath) {
    lines.push(`- External fixture path: ${output.inputs.externalFixturePath}`);
  }
  lines.push(`- Threshold profile source: ${output.inputs.profileSource}`);
  lines.push(`- Source files: ${output.inputs.sourceFiles.length}`);
  lines.push('');
  lines.push('## Dataset Totals');
  lines.push('');
  lines.push(`- Manifests: ${output.totals.manifests}`);
  lines.push(`- Frames: ${output.totals.frames}`);
  lines.push(`- Real clip frames: ${output.totals.realClipFrames}`);
  lines.push(`- Contour fixture frames: ${output.totals.contourFixtureFrames}`);
  lines.push(`- Document frames: ${output.totals.documentFrames}`);
  lines.push(`- Non-document frames: ${output.totals.nonDocumentFrames}`);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Segment | Lock (IoU>=0.85) | False Positive | Auto-capture <=2s | Median Stable | P10 FPS |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  lines.push(renderMetricRow('Overall', output.metrics.overall));
  lines.push(renderMetricRow('Real clips', output.metrics.realClips));
  lines.push(renderMetricRow('Contour fixtures', output.metrics.contourFixtures));
  lines.push(renderMetricRow('Non-document', output.metrics.nonDocument));
  lines.push('');
  lines.push('## Gate Verdict');
  lines.push('');
  lines.push(`- overallLockPass: ${output.gates.overallLockPass ? 'PASS' : 'FAIL'}`);
  lines.push(`- overallFalsePositivePass: ${output.gates.overallFalsePositivePass ? 'PASS' : 'FAIL'}`);
  lines.push(
    `- overallAutoCaptureWithin2sPass: ${output.gates.overallAutoCaptureWithin2sPass ? 'PASS' : 'FAIL'}`,
  );
  lines.push(`- contourLockPass: ${output.gates.contourLockPass ? 'PASS' : 'FAIL'}`);
  lines.push(`- contourFalsePositivePass: ${output.gates.contourFalsePositivePass ? 'PASS' : 'FAIL'}`);
  lines.push(`- contourAutoCapturePass: ${output.gates.contourAutoCapturePass ? 'PASS' : 'FAIL'}`);
  lines.push(
    `- noDocumentFalsePositivePass: ${output.gates.noDocumentFalsePositivePass ? 'PASS' : 'FAIL'}`,
  );
  lines.push(`- fpsPass: ${output.gates.fpsPass ? 'PASS' : 'FAIL'}`);
  lines.push(`- overall: ${output.gates.overall ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Source Files');
  lines.push('');
  for (const source of output.inputs.sourceFiles) {
    lines.push(`- ${source}`);
  }
  return `${lines.join('\n')}\n`;
}

async function loadRegressionManifests(
  realClipPath: string,
  externalFixturePath?: string,
): Promise<{ manifests: RealClipManifest[]; sourceFiles: string[] }> {
  const manifests: RealClipManifest[] = [];
  const sourceFiles: string[] = [];

  const realClipFiles = await collectJsonFiles(realClipPath);
  const realClipManifests = await readManifests(realClipFiles);
  manifests.push(...realClipManifests);
  sourceFiles.push(...realClipFiles);

  const builtInFixtures = buildOpenCvContourFailureFixtures();
  manifests.push(...builtInFixtures);
  sourceFiles.push('builtin:opencv-contour-fixtures');

  if (externalFixturePath && (await hasPath(externalFixturePath))) {
    const fixtureFiles = await collectJsonFiles(externalFixturePath);
    const fixtureManifests = await readManifests(fixtureFiles);
    manifests.push(...fixtureManifests);
    sourceFiles.push(...fixtureFiles);
  }

  return { manifests, sourceFiles };
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..');
  const realClipPath = process.argv[2] ?? path.resolve(root, 'datasets/real-clips');
  const outputPath =
    process.argv[3] ?? path.resolve(process.cwd(), 'output/opencv-regression/latest.json');
  const externalFixturePathArg = process.argv[4] ?? process.env.DOCUSCAN_OPENCV_FIXTURE_PATH;
  const externalFixturePath = externalFixturePathArg
    ? path.resolve(externalFixturePathArg)
    : undefined;
  const reportPath = path.resolve(root, 'docs/opencv-regression-report.md');

  const { manifests, sourceFiles } = await loadRegressionManifests(realClipPath, externalFixturePath);
  const normalizedFrames: NormalizedFrame[] = [];
  for (const manifest of manifests) {
    const isFixture = (manifest.tags ?? []).includes('contour-failure');
    const extraTag = isFixture ? 'contour-fixture' : 'real-clip';
    normalizedFrames.push(...normalizeManifests([manifest], extraTag));
  }

  const { profile, source } = await resolveThresholdProfile(root);
  const evaluation = evaluateOpenCvRegression(normalizedFrames, profile);
  const output: OpenCvRegressionOutput = {
    generatedAt: new Date().toISOString(),
    inputs: {
      realClipPath: path.resolve(realClipPath),
      externalFixturePath,
      sourceFiles,
      profileSource: source,
    },
    ...evaluation,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
  await writeFile(reportPath, toMarkdown(output), 'utf8');

  process.stdout.write(`Wrote OpenCV regression output to ${outputPath}\n`);
  process.stdout.write(`Wrote OpenCV regression report to ${reportPath}\n`);
}

void main();
