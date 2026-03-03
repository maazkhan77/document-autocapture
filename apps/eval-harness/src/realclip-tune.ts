import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultThresholdProfile, tuneThresholdProfile, type ThresholdProfile } from './realclip-sim';
import type { NormalizedFrame } from './realclip-shared';

interface IngestedDatasetFile {
  generatedAt: string;
  sourceRoot: string;
  sourceFiles: string[];
  frames: NormalizedFrame[];
}

interface TuneOutputFile {
  generatedAt: string;
  inputDatasetPath: string;
  baselineProfile: ThresholdProfile;
  tunedProfile: ThresholdProfile;
  baselineMetrics: ReturnType<typeof tuneThresholdProfile>['baselineMetrics'];
  tunedMetrics: ReturnType<typeof tuneThresholdProfile>['tunedMetrics'];
  evaluations: number;
  passes: number;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function formatFps(value: number): string {
  return `${value.toFixed(2)} FPS`;
}

function delta(after: number, before: number, fraction = false): string {
  const diff = after - before;
  if (fraction) {
    return `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(2)}pp`;
  }
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`;
}

function renderReport(output: TuneOutputFile): string {
  const baseline = output.baselineMetrics;
  const tuned = output.tunedMetrics;
  const lines: string[] = [];
  lines.push('# Real Clip Threshold Auto-Tune Report');
  lines.push('');
  lines.push(`Generated: ${output.generatedAt}`);
  lines.push(`Input dataset: ${output.inputDatasetPath}`);
  lines.push(`Search evaluations: ${output.evaluations}`);
  lines.push(`Coordinate passes: ${output.passes}`);
  lines.push('');
  lines.push('## Metrics (Baseline vs Tuned)');
  lines.push('');
  lines.push('| Metric | Baseline | Tuned | Delta |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| Lock pass rate (IoU >= 0.85) | ${formatPct(baseline.detection.lockPassRateAt085)} | ${formatPct(tuned.detection.lockPassRateAt085)} | ${delta(tuned.detection.lockPassRateAt085, baseline.detection.lockPassRateAt085, true)} |`,
  );
  lines.push(
    `| False positive rate | ${formatPct(baseline.detection.falsePositiveRate)} | ${formatPct(tuned.detection.falsePositiveRate)} | ${delta(tuned.detection.falsePositiveRate, baseline.detection.falsePositiveRate, true)} |`,
  );
  lines.push(
    `| Auto-capture success | ${formatPct(baseline.capture.autoCaptureSuccessRate)} | ${formatPct(tuned.capture.autoCaptureSuccessRate)} | ${delta(tuned.capture.autoCaptureSuccessRate, baseline.capture.autoCaptureSuccessRate, true)} |`,
  );
  lines.push(
    `| Auto-capture within 2s | ${formatPct(baseline.capture.autoCaptureWithin2sRate)} | ${formatPct(tuned.capture.autoCaptureWithin2sRate)} | ${delta(tuned.capture.autoCaptureWithin2sRate, baseline.capture.autoCaptureWithin2sRate, true)} |`,
  );
  lines.push(
    `| Median time-to-stable | ${formatMs(baseline.capture.medianTimeToStableMs)} | ${formatMs(tuned.capture.medianTimeToStableMs)} | ${delta(tuned.capture.medianTimeToStableMs, baseline.capture.medianTimeToStableMs)}ms |`,
  );
  lines.push(
    `| P10 FPS | ${formatFps(baseline.perf.fpsP10)} | ${formatFps(tuned.perf.fpsP10)} | ${delta(tuned.perf.fpsP10, baseline.perf.fpsP10)} |`,
  );
  lines.push(
    `| Objective score | ${baseline.objectiveScore.toFixed(3)} | ${tuned.objectiveScore.toFixed(3)} | ${delta(tuned.objectiveScore, baseline.objectiveScore)} |`,
  );
  lines.push('');
  lines.push('## Recommended Config Overrides');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(output.tunedProfile, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Acceptance');
  lines.push('');
  lines.push(`- Lock pass >=95%: ${tuned.acceptance.lockPass ? 'PASS' : 'FAIL'}`);
  lines.push(`- False positive <=2%: ${tuned.acceptance.falsePositivePass ? 'PASS' : 'FAIL'}`);
  lines.push(`- Auto-capture success >=85%: ${tuned.acceptance.autoCapturePass ? 'PASS' : 'FAIL'}`);
  lines.push(`- Auto-capture within 2s >=85%: ${tuned.acceptance.autoCaptureWithin2sPass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Detector Source Stats (Tuned)');
  lines.push('');
  for (const [source, count] of Object.entries(tuned.diagnostics.detectorSourceStats).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`- ${source}: ${count}`);
  }
  lines.push(`- fallbackActiveFrames: ${tuned.diagnostics.fallbackActiveFrames}`);
  return `${lines.join('\n')}\n`;
}

async function loadIngestedDataset(filePath: string): Promise<IngestedDatasetFile> {
  const input = await readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid ingested dataset: ${filePath}`);
  }
  const dataset = parsed as Partial<IngestedDatasetFile>;
  if (!Array.isArray(dataset.frames)) {
    throw new Error(`Invalid ingested dataset frames at ${filePath}`);
  }
  return {
    generatedAt: typeof dataset.generatedAt === 'string' ? dataset.generatedAt : 'unknown',
    sourceRoot: typeof dataset.sourceRoot === 'string' ? dataset.sourceRoot : 'unknown',
    sourceFiles: Array.isArray(dataset.sourceFiles)
      ? dataset.sourceFiles.filter((item): item is string => typeof item === 'string')
      : [],
    frames: dataset.frames as NormalizedFrame[],
  };
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..');
  const inputPath = process.argv[2] ?? path.resolve(process.cwd(), 'output/realclip/ingested.json');
  const outputPath = process.argv[3] ?? path.resolve(process.cwd(), 'output/realclip/tuned-thresholds.json');
  const reportPath = path.resolve(root, 'docs/realclip-autotune-report.md');

  const dataset = await loadIngestedDataset(inputPath);
  if (dataset.frames.length === 0) {
    throw new Error(`No frames found in ingested dataset: ${inputPath}`);
  }

  const tuning = tuneThresholdProfile(dataset.frames, defaultThresholdProfile());
  const output: TuneOutputFile = {
    generatedAt: new Date().toISOString(),
    inputDatasetPath: path.resolve(inputPath),
    baselineProfile: tuning.baselineProfile,
    tunedProfile: tuning.tunedProfile,
    baselineMetrics: tuning.baselineMetrics,
    tunedMetrics: tuning.tunedMetrics,
    evaluations: tuning.evaluations,
    passes: tuning.passes,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
  await writeFile(reportPath, renderReport(output), 'utf8');

  process.stdout.write(`Wrote threshold tuning output to ${outputPath}\n`);
  process.stdout.write(`Wrote threshold tuning report to ${reportPath}\n`);
}

void main();
