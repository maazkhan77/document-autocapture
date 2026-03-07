import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { quadIoU, type Point, type Quad } from '@document-autocapture/core-engine';

interface FrameRecord {
  id: string;
  hasDocument: boolean;
  groundTruth?: Quad;
  prediction?: Quad;
  detectionMs?: number;
  timeToStableMs?: number;
  autoCaptureSuccess?: boolean;
  rejectionReason?: 'blur' | 'brightness' | 'glare' | 'area' | 'none';
  detectorSource?: 'cv' | 'ml';
  fallbackActive?: boolean;
}

interface DatasetManifest {
  datasetName: string;
  frames: FrameRecord[];
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
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

function summarize(records: FrameRecord[]) {
  const documentFrames = records.filter((frame) => frame.hasDocument);
  const nondocumentFrames = records.filter((frame) => !frame.hasDocument);

  const ious: number[] = [];
  let trueDetections = 0;
  let falsePositives = 0;

  for (const frame of documentFrames) {
    if (frame.groundTruth && frame.prediction) {
      const iou = quadIoU(frame.groundTruth, frame.prediction);
      ious.push(iou);
      if (iou >= 0.85) {
        trueDetections += 1;
      }
    }
  }

  for (const frame of nondocumentFrames) {
    if (frame.prediction) {
      falsePositives += 1;
    }
  }

  const fpsSamples = records
    .map((frame) => frame.detectionMs)
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .map((ms) => 1000 / ms);

  const stableSamples = records
    .map((frame) => frame.timeToStableMs)
    .filter((value): value is number => typeof value === 'number');

  const autoCaptureAttempts = records.filter(
    (frame) => typeof frame.autoCaptureSuccess === 'boolean',
  ) as Array<FrameRecord & { autoCaptureSuccess: boolean }>;

  const rejections = records.reduce<Record<string, number>>((acc, frame) => {
    const reason = frame.rejectionReason ?? 'none';
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  const detectorSources = records.reduce<Record<string, number>>((acc, frame) => {
    const source = frame.detectorSource ?? 'cv';
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});

  const fallbackActivationCount = records.filter((frame) => frame.fallbackActive).length;

  return {
    totals: {
      frames: records.length,
      documentFrames: documentFrames.length,
      nonDocumentFrames: nondocumentFrames.length,
    },
    detectionIoU: {
      mean: mean(ious),
      p50: median(ious),
      p90: percentile(ious, 90),
      passRateAt085:
        documentFrames.length === 0 ? 0 : trueDetections / Math.max(1, documentFrames.length),
    },
    fps: {
      mean: mean(fpsSamples),
      p50: median(fpsSamples),
      p10: percentile(fpsSamples, 10),
    },
    timeToStable: {
      medianMs: median(stableSamples),
      p90Ms: percentile(stableSamples, 90),
    },
    falsePositiveRate:
      nondocumentFrames.length === 0 ? 0 : falsePositives / Math.max(1, nondocumentFrames.length),
    autoCaptureSuccessRate:
      autoCaptureAttempts.length === 0
        ? 0
        : autoCaptureAttempts.filter((f) => f.autoCaptureSuccess).length /
          autoCaptureAttempts.length,
    rejectionReasons: rejections,
    detectorSourceStats: detectorSources,
    fallbackActivationCount,
    acceptanceTargets: {
      iouPass: documentFrames.length > 0 ? trueDetections / documentFrames.length >= 0.8 : false,
      fpsTypicalPass: percentile(fpsSamples, 50) >= 15,
      fpsWorstPass: percentile(fpsSamples, 10) >= 8,
      medianStablePass: median(stableSamples) <= 1500,
      falsePositivePass:
        nondocumentFrames.length > 0 ? falsePositives / nondocumentFrames.length <= 0.05 : false,
      autoCapturePass:
        autoCaptureAttempts.length > 0
          ? autoCaptureAttempts.filter((f) => f.autoCaptureSuccess).length /
              autoCaptureAttempts.length >=
            0.7
          : false,
    },
  };
}

async function main() {
  const manifestPath =
    process.argv[2] ?? path.resolve(process.cwd(), '../../datasets/sample-manifest.json');
  const outputPath = process.argv[3] ?? path.resolve(process.cwd(), 'output/summary.json');

  const input = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(input) as DatasetManifest;
  const summary = summarize(manifest.frames);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        dataset: manifest.datasetName,
        generatedAt: new Date().toISOString(),
        summary,
      },
      null,
      2,
    ),
    'utf8',
  );

  process.stdout.write(`Wrote evaluation summary to ${outputPath}\n`);
}

void main();
