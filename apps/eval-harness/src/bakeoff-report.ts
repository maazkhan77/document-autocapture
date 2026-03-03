import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CandidateId = 'candidate-a' | 'candidate-b' | 'candidate-c';

interface BakeoffBenchResult {
  generatedAt: string;
  candidate: {
    id: CandidateId;
    name: string;
    detectorMode: 'cv' | 'hybrid' | 'ml';
    description: string;
  };
  userAgent: string;
  capabilities: {
    selectedMode: string;
  };
  ingestion: {
    standard: {
      fps: number;
    };
  };
  detectionLoop: {
    fps: number;
  };
  detectionQuality: {
    iouAt085PassRate: number;
    falsePositiveRate: number;
  };
  endToEnd: {
    success: boolean;
    stableReached: boolean;
    stableAtMs: number;
    captureTier: string;
    detectorSourceAtLock?: 'cv' | 'ml' | 'none';
  };
  detectorTelemetry?: {
    sourceFrames: {
      cv: number;
      ml: number;
    };
    fallbackFrames: {
      inactive: number;
      armed: number;
      active: number;
    };
    fallbackTransitions: {
      entered: number;
      exited: number;
    };
    firstMlInferenceMs: number | null;
  };
  latency: {
    startupMs: number;
  };
  gates: {
    ingestionPass: boolean;
    detectionPass: boolean;
    qualityPass: boolean;
    webglPass: boolean;
    cpuPass: boolean;
    endToEndPass: boolean;
    overall: boolean;
  };
}

interface RunRecord {
  file: string;
  project: string;
  result: BakeoffBenchResult;
}

interface CandidateSummary {
  id: CandidateId;
  name: string;
  detectorMode: 'cv' | 'hybrid' | 'ml';
  runs: number;
  overallPassRate: number;
  lockPassRate: number;
  falsePositiveRate: number;
  autoCaptureWithin2sRate: number;
  medianStableMs: number;
  detectionFps: number;
  ingestionFps: number;
  mlFrameShare: number;
  fallbackEntryRate: number;
  score: number;
}

function passFail(value: boolean): string {
  return value ? 'PASS' : 'FAIL';
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function median(values: number[]): number {
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

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function extractProjectName(fileName: string, candidateId: CandidateId): string {
  const base = fileName.replace(/\.json$/, '');
  const suffix = `-${candidateId}`;
  if (base.endsWith(suffix)) {
    return base.slice(0, base.length - suffix.length);
  }
  return base;
}

function isBakeoffResult(value: unknown): value is BakeoffBenchResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Partial<BakeoffBenchResult>;
  return Boolean(
    obj.candidate &&
      obj.candidate.id &&
      obj.gates &&
      obj.detectionQuality &&
      obj.endToEnd &&
      obj.ingestion &&
      obj.detectionLoop,
  );
}

function scoreCandidate(summary: Omit<CandidateSummary, 'score'>): number {
  const fpNorm = clamp(1 - summary.falsePositiveRate / 0.02);
  const stableNorm =
    summary.medianStableMs <= 0 ? 0 : clamp(1 - Math.max(0, summary.medianStableMs - 650) / 1350);
  const fpsNorm = clamp(summary.detectionFps / 25);
  const mlSharePenalty = summary.detectorMode === 'cv' ? 1 : clamp(1 - Math.max(0, summary.mlFrameShare - 0.35));
  const score =
    summary.lockPassRate * 35 +
    fpNorm * 25 +
    summary.autoCaptureWithin2sRate * 20 +
    stableNorm * 10 +
    summary.overallPassRate * 5 +
    fpsNorm * 3 +
    mlSharePenalty * 2;
  return Number(score.toFixed(2));
}

function summarizeCandidate(runs: RunRecord[]): CandidateSummary {
  const base = runs[0].result.candidate;
  const lockPassRate = mean(runs.map((run) => run.result.detectionQuality.iouAt085PassRate));
  const falsePositiveRate = mean(runs.map((run) => run.result.detectionQuality.falsePositiveRate));
  const autoCaptureWithin2sRate =
    runs.filter(
      (run) =>
        run.result.endToEnd.success &&
        run.result.endToEnd.stableReached &&
        run.result.endToEnd.stableAtMs > 0 &&
        run.result.endToEnd.stableAtMs <= 2000,
    ).length / Math.max(1, runs.length);
  const stableSamples = runs
    .map((run) => run.result.endToEnd.stableAtMs)
    .filter((value) => value > 0);
  const overallPassRate =
    runs.filter((run) => run.result.gates.overall).length / Math.max(1, runs.length);
  const detectionFps = mean(runs.map((run) => run.result.detectionLoop.fps));
  const ingestionFps = mean(runs.map((run) => run.result.ingestion.standard.fps));
  const mlFrameShare = mean(
    runs.map((run) => {
      const telemetry = run.result.detectorTelemetry;
      if (!telemetry) {
        return 0;
      }
      const total = telemetry.sourceFrames.cv + telemetry.sourceFrames.ml;
      return total > 0 ? telemetry.sourceFrames.ml / total : 0;
    }),
  );
  const fallbackEntryRate = mean(
    runs.map((run) => run.result.detectorTelemetry?.fallbackTransitions.entered ?? 0),
  );

  const candidate = {
    id: base.id,
    name: base.name,
    detectorMode: base.detectorMode,
    runs: runs.length,
    overallPassRate,
    lockPassRate,
    falsePositiveRate,
    autoCaptureWithin2sRate,
    medianStableMs: median(stableSamples),
    detectionFps,
    ingestionFps,
    mlFrameShare,
    fallbackEntryRate,
  };

  return {
    ...candidate,
    score: scoreCandidate(candidate),
  };
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..');
  const bakeoffDir = path.resolve(process.cwd(), 'output/bakeoff');
  const docsDir = path.resolve(root, 'docs');
  const reportPath = path.resolve(docsDir, 'bakeoff-report.md');
  const summaryPath = path.resolve(bakeoffDir, 'summary.json');

  await mkdir(bakeoffDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });

  const entries = (await readdir(bakeoffDir))
    .filter((file) => file.endsWith('.json') && file !== 'summary.json')
    .sort();
  if (entries.length === 0) {
    throw new Error(`No bakeoff artifacts found in ${bakeoffDir}`);
  }

  const runs: RunRecord[] = [];
  for (const file of entries) {
    const content = await readFile(path.resolve(bakeoffDir, file), 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!isBakeoffResult(parsed)) {
      throw new Error(`Invalid bakeoff artifact shape: ${file}`);
    }
    runs.push({
      file,
      project: extractProjectName(file, parsed.candidate.id),
      result: parsed,
    });
  }

  const grouped = new Map<CandidateId, RunRecord[]>();
  for (const run of runs) {
    const bucket = grouped.get(run.result.candidate.id) ?? [];
    bucket.push(run);
    grouped.set(run.result.candidate.id, bucket);
  }

  const ranking = Array.from(grouped.values())
    .map((candidateRuns) => summarizeCandidate(candidateRuns))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.overallPassRate !== a.overallPassRate) {
        return b.overallPassRate - a.overallPassRate;
      }
      if (b.lockPassRate !== a.lockPassRate) {
        return b.lockPassRate - a.lockPassRate;
      }
      return a.falsePositiveRate - b.falsePositiveRate;
    });

  const winner = ranking[0];
  const cvBaseline = ranking.find((item) => item.detectorMode === 'cv');
  const bestHybrid = ranking.find((item) => item.detectorMode === 'hybrid');
  const cvParityPass = cvBaseline
    ? cvBaseline.lockPassRate >= 0.85 && cvBaseline.falsePositiveRate <= 0.02
    : false;
  const hybridLockDelta = cvBaseline && bestHybrid ? bestHybrid.lockPassRate - cvBaseline.lockPassRate : 0;
  const hybridStableDeltaMs =
    cvBaseline && bestHybrid ? cvBaseline.medianStableMs - bestHybrid.medianStableMs : 0;
  const hybridAutoCaptureDelta =
    cvBaseline && bestHybrid ? bestHybrid.autoCaptureWithin2sRate - cvBaseline.autoCaptureWithin2sRate : 0;
  const hybridImprovementPass = cvBaseline && bestHybrid
    ? bestHybrid.lockPassRate >= cvBaseline.lockPassRate - 0.005 &&
      (hybridLockDelta >= 0.01 || hybridStableDeltaMs >= 120 || hybridAutoCaptureDelta >= 0.1)
    : false;

  const promoteWinnerBase =
    winner.overallPassRate >= 0.67 &&
    winner.lockPassRate >= 0.85 &&
    winner.falsePositiveRate <= 0.02 &&
    winner.autoCaptureWithin2sRate >= 0.85;
  const promoteWinner = promoteWinnerBase && cvParityPass && hybridImprovementPass;
  const rolloutVerdict = promoteWinner ? 'PROMOTE' : 'NO_GO';

  const lines: string[] = [];
  lines.push('# Document Auto Capture Bakeoff Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Artifacts analyzed: ${runs.length}`);
  lines.push('');
  lines.push('## Candidate Ranking');
  lines.push('');
  lines.push('| Rank | Candidate | Mode | Score | Overall Gate Pass | Lock (IoU>=0.85) | False Positive | Auto-capture <=2s | Median Stable | Detection FPS | ML Frame Share | Fallback Entries |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [index, item] of ranking.entries()) {
    lines.push(
      `| ${index + 1} | ${item.id} (${item.name}) | ${item.detectorMode} | ${item.score.toFixed(2)} | ${formatPct(item.overallPassRate)} | ${formatPct(item.lockPassRate)} | ${formatPct(item.falsePositiveRate)} | ${formatPct(item.autoCaptureWithin2sRate)} | ${formatMs(item.medianStableMs)} | ${item.detectionFps.toFixed(2)} | ${formatPct(item.mlFrameShare)} | ${item.fallbackEntryRate.toFixed(2)} |`,
    );
  }
  lines.push('');
  lines.push('## Regression Gates');
  lines.push('');
  lines.push(`- CV parity gate: **${passFail(cvParityPass)}**`);
  lines.push(`- Hybrid improvement gate (lock non-regression + meaningful UX gain): **${passFail(hybridImprovementPass)}**`);
  if (cvBaseline) {
    lines.push(
      `- CV baseline: lock=${formatPct(cvBaseline.lockPassRate)}, fp=${formatPct(cvBaseline.falsePositiveRate)}, stable=${formatMs(cvBaseline.medianStableMs)}`,
    );
  }
  if (bestHybrid) {
    lines.push(
      `- Best hybrid: lock=${formatPct(bestHybrid.lockPassRate)}, fp=${formatPct(bestHybrid.falsePositiveRate)}, stable=${formatMs(bestHybrid.medianStableMs)}`,
    );
    lines.push(
      `- Hybrid deltas vs CV: lock=${formatPct(hybridLockDelta)}, stable=${hybridStableDeltaMs.toFixed(2)}ms, auto<=2s=${formatPct(hybridAutoCaptureDelta)}`,
    );
  }
  lines.push('');
  lines.push('## Winner');
  lines.push('');
  lines.push(
    `Selected: **${winner.id} (${winner.name})** with score **${winner.score.toFixed(2)}** and overall gate pass ${formatPct(winner.overallPassRate)}.`,
  );
  lines.push(`Rollout verdict: **${rolloutVerdict}**`);
  if (!promoteWinner) {
    lines.push('- Reason: acceptance thresholds are not met; keep tuning and re-run bakeoff.');
  }
  lines.push('');
  lines.push('## Per-Run Matrix');
  lines.push('');
  lines.push('| Artifact | Project | Candidate | Selected Mode | Ingestion FPS | Detection FPS | IoU Pass Rate | False Positive | Stable (ms) | End-to-End | ML Share | Fallback Entries | Overall |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|');
  for (const run of runs) {
    const r = run.result;
    const telemetry = r.detectorTelemetry;
    const totalFrames = telemetry ? telemetry.sourceFrames.cv + telemetry.sourceFrames.ml : 0;
    const mlShare = telemetry && totalFrames > 0 ? telemetry.sourceFrames.ml / totalFrames : 0;
    const fallbackEntries = telemetry?.fallbackTransitions.entered ?? 0;
    lines.push(
      `| ${run.file} | ${run.project} | ${r.candidate.id} | ${r.capabilities.selectedMode} | ${r.ingestion.standard.fps.toFixed(2)} | ${r.detectionLoop.fps.toFixed(2)} | ${formatPct(r.detectionQuality.iouAt085PassRate)} | ${formatPct(r.detectionQuality.falsePositiveRate)} | ${formatMs(r.endToEnd.stableAtMs)} | ${passFail(r.endToEnd.success)} (${r.endToEnd.captureTier}) | ${formatPct(mlShare)} | ${fallbackEntries.toFixed(2)} | ${passFail(r.gates.overall)} |`,
    );
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This report uses synthetic scene benchmarks and should be followed by physical Android validation.');
  lines.push('');
  lines.push('## Raw Artifacts');
  lines.push('');
  for (const file of entries) {
    lines.push(`- apps/eval-harness/output/bakeoff/${file}`);
  }

  await writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        winner,
        ranking,
        rolloutVerdict,
        gateChecks: {
          cvParityPass,
          hybridImprovementPass,
          promoteWinnerBase,
        },
        runCount: runs.length,
      },
      null,
      2,
    ),
    'utf8',
  );

  process.stdout.write(`Wrote bakeoff report to ${reportPath}\n`);
  process.stdout.write(`Wrote bakeoff summary to ${summaryPath}\n`);
}

void main();
