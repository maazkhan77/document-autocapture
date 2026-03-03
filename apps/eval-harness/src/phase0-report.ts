import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Phase0BenchResult {
  generatedAt: string;
  userAgent: string;
  capabilities: {
    selectedMode: string;
  };
  ingestion: {
    standard: {
      supported: boolean;
      fps: number;
      roundtripMs: { median: number; p95: number };
      detectionMs: { median: number; p95: number };
    };
    best: {
      supported: boolean;
      fps: number;
      roundtripMs: { median: number; p95: number };
      detectionMs: { median: number; p95: number };
      notes?: string;
    };
  };
  detectionLoop: {
    fps: number;
    stageTotalMs: { median: number; p95: number; max: number };
    hardCeilingViolations: number;
  };
  warp: {
    webgl: {
      ok: boolean;
      elapsedMs: number;
      withinBudget: boolean;
      downgraded?: boolean;
      reason?: string;
    };
    cpu: { ok: boolean; elapsedMs: number; withinBudget: boolean; reason?: string };
  };
  endToEnd: {
    success: boolean;
    stableReached: boolean;
    stableAtMs: number;
    captureTier: string;
    guidance: string;
  };
  gates: {
    ingestionPass: boolean;
    detectionPass: boolean;
    webglPass: boolean;
    cpuPass: boolean;
    endToEndPass: boolean;
    overall: boolean;
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatFps(value: number): string {
  return `${value.toFixed(2)} FPS`;
}

function passFail(value: boolean): string {
  return value ? 'PASS' : 'FAIL';
}

function browserLabel(projectName: string): string {
  if (projectName === 'chromium') {
    return 'Chrome Desktop (Playwright Chromium)';
  }
  if (projectName === 'firefox') {
    return 'Firefox Desktop (Playwright Firefox)';
  }
  if (projectName === 'chromium-android-emulated') {
    return 'Chrome Android (Emulated Pixel 7)';
  }
  return projectName;
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..');
  const phase0Dir = path.resolve(process.cwd(), 'output/phase0');
  const docsDir = path.resolve(root, 'docs');
  const reportPath = path.resolve(docsDir, 'phase0-feasibility-report.md');

  await mkdir(phase0Dir, { recursive: true });
  await mkdir(docsDir, { recursive: true });

  const entries = (await readdir(phase0Dir)).filter((file) => file.endsWith('.json')).sort();
  if (entries.length === 0) {
    throw new Error(`No phase0 benchmark artifacts found in ${phase0Dir}`);
  }

  const parsed = await Promise.all(
    entries.map(async (file) => {
      const content = await readFile(path.resolve(phase0Dir, file), 'utf8');
      return {
        project: file.replace(/\.json$/, ''),
        result: JSON.parse(content) as Phase0BenchResult,
      };
    }),
  );

  const lines: string[] = [];
  lines.push('# Phase 0 Feasibility Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Environment Matrix');
  lines.push('');
  lines.push('| Target | Project | Selected mode | User agent |');
  lines.push('|---|---|---|---|');
  for (const item of parsed) {
    lines.push(
      `| ${browserLabel(item.project)} | ${item.project} | ${item.result.capabilities.selectedMode} | ${item.result.userAgent.replaceAll('|', '\\|')} |`,
    );
  }
  lines.push('');

  lines.push('## Prototype Results');
  lines.push('');
  for (const item of parsed) {
    const result = item.result;
    lines.push(`### ${browserLabel(item.project)}`);
    lines.push('');
    lines.push('1. Frame ingestion throughput');
    lines.push(`- Standard: ${formatFps(result.ingestion.standard.fps)} (median roundtrip ${formatMs(result.ingestion.standard.roundtripMs.median)})`);
    if (result.ingestion.best.supported) {
      lines.push(`- Best (ImageBitmap): ${formatFps(result.ingestion.best.fps)} (median roundtrip ${formatMs(result.ingestion.best.roundtripMs.median)})`);
    } else {
      lines.push(`- Best (ImageBitmap): not supported (${result.ingestion.best.notes ?? 'unknown reason'})`);
    }
    lines.push('2. Detection loop prototype');
    lines.push(
      `- Detection: ${formatFps(result.detectionLoop.fps)}, median ${formatMs(result.detectionLoop.stageTotalMs.median)}, p95 ${formatMs(result.detectionLoop.stageTotalMs.p95)}, hard ceiling violations ${result.detectionLoop.hardCeilingViolations}`,
    );
    lines.push('3. Worker pipeline mode selection');
    lines.push(`- Selected mode: ${result.capabilities.selectedMode}`);
    lines.push('4. WebGL perspective warp prototype');
    lines.push(
      `- Result: ${passFail(result.warp.webgl.ok)}; elapsed ${formatMs(result.warp.webgl.elapsedMs)}; within 50ms budget: ${passFail(result.warp.webgl.withinBudget)}${result.warp.webgl.downgraded ? ' (downgraded path accepted)' : ''}${result.warp.webgl.reason ? ` (${result.warp.webgl.reason})` : ''}`,
    );
    lines.push('5. CPU piecewise-affine warp prototype');
    lines.push(
      `- Result: ${passFail(result.warp.cpu.ok)}; elapsed ${formatMs(result.warp.cpu.elapsedMs)}; within 200ms budget: ${passFail(result.warp.cpu.withinBudget)}${result.warp.cpu.reason ? ` (${result.warp.cpu.reason})` : ''}`,
    );
    lines.push('6. End-to-end capture flow');
    lines.push(
      `- stable=${result.endToEnd.stableReached}, stableAt=${result.endToEnd.stableAtMs}ms, captureTier=${result.endToEnd.captureTier}, guidance=${result.endToEnd.guidance}, success=${result.endToEnd.success}`,
    );
    lines.push('');
  }

  lines.push('## Pass/Fail Gate');
  lines.push('');
  lines.push('| Target | Ingestion >=20 FPS | Detection budget | WebGL <50ms | CPU <200ms | End-to-end | Overall |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const item of parsed) {
    const gate = item.result.gates;
    lines.push(
      `| ${browserLabel(item.project)} | ${passFail(gate.ingestionPass)} | ${passFail(gate.detectionPass)} | ${passFail(gate.webglPass)} | ${passFail(gate.cpuPass)} | ${passFail(gate.endToEndPass)} | ${passFail(gate.overall)} |`,
    );
  }

  lines.push('');
  lines.push('## Blocking Issues and Downgrades');
  lines.push('');
  lines.push('- Chrome Android physical-device validation is still required; emulation results are provisional only.');
  lines.push('- Any FAIL row above must be resolved before advancing from Phase 0.');
  lines.push('');
  lines.push('## Raw Benchmark Artifacts');
  lines.push('');
  for (const file of entries) {
    lines.push(`- apps/eval-harness/output/phase0/${file}`);
  }

  await writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`Wrote phase0 feasibility report to ${reportPath}\n`);
}

void main();
