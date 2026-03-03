import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface Phase0Artifact {
  gates?: {
    overall?: boolean;
  };
}

interface BakeoffSummary {
  rolloutVerdict?: string;
  winner?: {
    overallPassRate?: number;
    lockPassRate?: number;
    falsePositiveRate?: number;
    autoCaptureWithin2sRate?: number;
  };
  gateChecks?: {
    cvParityPass?: boolean;
    hybridImprovementPass?: boolean;
    promoteWinnerBase?: boolean;
  };
}

interface RealclipTuneOutput {
  tunedMetrics?: {
    acceptance?: {
      lockPass?: boolean;
      falsePositivePass?: boolean;
      autoCapturePass?: boolean;
      autoCaptureWithin2sPass?: boolean;
    };
  };
}

interface OpenCvRegressionArtifact {
  gates?: {
    overall?: boolean;
    overallLockPass?: boolean;
    overallFalsePositivePass?: boolean;
    overallAutoCaptureWithin2sPass?: boolean;
    contourLockPass?: boolean;
    contourFalsePositivePass?: boolean;
    contourAutoCapturePass?: boolean;
    noDocumentFalsePositivePass?: boolean;
    fpsPass?: boolean;
  };
}

interface PhysicalAndroidArtifact {
  acceptance?: {
    overall?: boolean;
  };
  metrics?: {
    lockPassRate?: number;
    falsePositiveRate?: number;
    autoCaptureWithin2sRate?: number;
    medianTimeToStableMs?: number;
    p10Fps?: number;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

async function verifyPhase0(outputRoot: string): Promise<string[]> {
  const issues: string[] = [];
  const phase0Dir = path.resolve(outputRoot, 'phase0');
  const files = (await readdir(phase0Dir)).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) {
    issues.push(`No phase0 artifacts found at ${phase0Dir}`);
    return issues;
  }

  for (const file of files) {
    const parsed = (await readJson(path.resolve(phase0Dir, file))) as Phase0Artifact;
    if (!parsed.gates?.overall) {
      issues.push(`Phase0 gate failed for ${file}`);
    }
  }
  return issues;
}

async function verifyBakeoff(outputRoot: string): Promise<string[]> {
  const issues: string[] = [];
  const summaryPath = path.resolve(outputRoot, 'bakeoff', 'summary.json');
  const parsed = (await readJson(summaryPath)) as BakeoffSummary;
  if (parsed.rolloutVerdict !== 'PROMOTE') {
    issues.push(`Bakeoff rollout verdict is ${parsed.rolloutVerdict ?? 'unknown'} (expected PROMOTE)`);
  }

  const winner = parsed.winner;
  if (!winner) {
    issues.push('Bakeoff summary missing winner');
    return issues;
  }
  if ((winner.overallPassRate ?? 0) < 0.67) {
    issues.push(`Bakeoff winner overallPassRate=${winner.overallPassRate ?? 0} < 0.67`);
  }
  if ((winner.lockPassRate ?? 0) < 0.85) {
    issues.push(`Bakeoff winner lockPassRate=${winner.lockPassRate ?? 0} < 0.85`);
  }
  if ((winner.falsePositiveRate ?? 1) > 0.02) {
    issues.push(`Bakeoff winner falsePositiveRate=${winner.falsePositiveRate ?? 1} > 0.02`);
  }
  if ((winner.autoCaptureWithin2sRate ?? 0) < 0.85) {
    issues.push(
      `Bakeoff winner autoCaptureWithin2sRate=${winner.autoCaptureWithin2sRate ?? 0} < 0.85`,
    );
  }
  if (parsed.gateChecks?.cvParityPass === false) {
    issues.push('Bakeoff regression gate cvParityPass is false');
  }
  if (parsed.gateChecks?.hybridImprovementPass === false) {
    issues.push('Bakeoff regression gate hybridImprovementPass is false');
  }
  return issues;
}

async function verifyRealclip(outputRoot: string): Promise<string[]> {
  const issues: string[] = [];
  const tunedPath = path.resolve(outputRoot, 'realclip', 'tuned-thresholds.json');
  const parsed = (await readJson(tunedPath)) as RealclipTuneOutput;
  const acceptance = parsed.tunedMetrics?.acceptance;
  if (!acceptance) {
    issues.push('Realclip tuned output missing acceptance block');
    return issues;
  }
  if (!acceptance.lockPass) {
    issues.push('Realclip acceptance lockPass is false');
  }
  if (!acceptance.falsePositivePass) {
    issues.push('Realclip acceptance falsePositivePass is false');
  }
  if (!acceptance.autoCapturePass) {
    issues.push('Realclip acceptance autoCapturePass is false');
  }
  if (!acceptance.autoCaptureWithin2sPass) {
    issues.push('Realclip acceptance autoCaptureWithin2sPass is false');
  }
  return issues;
}

async function verifyOpenCvRegression(outputRoot: string): Promise<string[]> {
  const issues: string[] = [];
  const regressionPath = path.resolve(outputRoot, 'opencv-regression', 'latest.json');
  if (!(await hasFile(regressionPath))) {
    issues.push(`OpenCV regression report not found at ${regressionPath}`);
    return issues;
  }
  const parsed = (await readJson(regressionPath)) as OpenCvRegressionArtifact;
  const gates = parsed.gates;
  if (!gates) {
    issues.push('OpenCV regression output missing gates block');
    return issues;
  }

  if (!gates.overallLockPass) {
    issues.push('OpenCV regression gate overallLockPass is false');
  }
  if (!gates.overallFalsePositivePass) {
    issues.push('OpenCV regression gate overallFalsePositivePass is false');
  }
  if (!gates.overallAutoCaptureWithin2sPass) {
    issues.push('OpenCV regression gate overallAutoCaptureWithin2sPass is false');
  }
  if (!gates.contourLockPass) {
    issues.push('OpenCV regression gate contourLockPass is false');
  }
  if (!gates.contourFalsePositivePass) {
    issues.push('OpenCV regression gate contourFalsePositivePass is false');
  }
  if (!gates.contourAutoCapturePass) {
    issues.push('OpenCV regression gate contourAutoCapturePass is false');
  }
  if (!gates.noDocumentFalsePositivePass) {
    issues.push('OpenCV regression gate noDocumentFalsePositivePass is false');
  }
  if (!gates.fpsPass) {
    issues.push('OpenCV regression gate fpsPass is false');
  }
  if (!gates.overall) {
    issues.push('OpenCV regression overall gate is false');
  }
  return issues;
}

async function hasFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function verifyPhysicalAndroid(outputRoot: string): Promise<{ issues: string[]; checked: boolean }> {
  const issues: string[] = [];
  const requirePhysical = process.env.DOCUSCAN_REQUIRE_PHYSICAL_ANDROID === '1';
  const reportPath =
    process.env.DOCUSCAN_PHYSICAL_ANDROID_REPORT ??
    path.resolve(outputRoot, 'physical-android', 'latest.json');

  const exists = await hasFile(reportPath);
  if (!exists) {
    if (requirePhysical) {
      issues.push(`Physical Android report not found at ${reportPath}`);
      return { issues, checked: false };
    }
    return { issues, checked: false };
  }

  const parsed = (await readJson(reportPath)) as PhysicalAndroidArtifact;
  const metrics = parsed.metrics;
  if (!metrics) {
    issues.push(`Physical Android report missing metrics block: ${reportPath}`);
    return { issues, checked: true };
  }

  if ((metrics.lockPassRate ?? 0) < 0.95) {
    issues.push(`Physical Android lockPassRate=${metrics.lockPassRate ?? 0} < 0.95`);
  }
  if ((metrics.falsePositiveRate ?? 1) > 0.02) {
    issues.push(`Physical Android falsePositiveRate=${metrics.falsePositiveRate ?? 1} > 0.02`);
  }
  if ((metrics.autoCaptureWithin2sRate ?? 0) < 0.85) {
    issues.push(
      `Physical Android autoCaptureWithin2sRate=${metrics.autoCaptureWithin2sRate ?? 0} < 0.85`,
    );
  }
  if ((metrics.medianTimeToStableMs ?? Number.POSITIVE_INFINITY) > 1500) {
    issues.push(`Physical Android medianTimeToStableMs=${metrics.medianTimeToStableMs ?? 0} > 1500`);
  }
  if ((metrics.p10Fps ?? 0) < 8) {
    issues.push(`Physical Android p10Fps=${metrics.p10Fps ?? 0} < 8`);
  }
  if (parsed.acceptance?.overall === false) {
    issues.push('Physical Android acceptance.overall is false');
  }

  return { issues, checked: true };
}

async function main() {
  const outputRoot = path.resolve(process.cwd(), 'output');
  const issues: string[] = [];

  issues.push(...(await verifyPhase0(outputRoot)));
  issues.push(...(await verifyBakeoff(outputRoot)));
  issues.push(...(await verifyRealclip(outputRoot)));
  issues.push(...(await verifyOpenCvRegression(outputRoot)));
  const physicalResult = await verifyPhysicalAndroid(outputRoot);
  issues.push(...physicalResult.issues);

  if (issues.length > 0) {
    process.stderr.write('Gate verification failed:\n');
    for (const issue of issues) {
      process.stderr.write(`- ${issue}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (physicalResult.checked) {
    process.stdout.write(
      'All production gates PASS (phase0 + bakeoff + realclip + opencv-regression + physical-android).\n',
    );
    return;
  }
  process.stdout.write(
    'All production gates PASS (phase0 + bakeoff + realclip + opencv-regression). Physical Android gate not enforced.\n',
  );
}

void main().catch((error) => {
  const message =
    isObject(error) && typeof error.message === 'string' ? error.message : String(error);
  process.stderr.write(`Gate verification failed: ${message}\n`);
  process.exitCode = 1;
});
