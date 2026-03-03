import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

test.setTimeout(240000);

test('phase0 feasibility benchmark', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:4173/?phase0bench=1');

  await page.waitForFunction(() => Boolean((window as { __DOCUSCAN_PHASE0__?: unknown }).__DOCUSCAN_PHASE0__), {
    timeout: 180000,
  });

  const result = await page.evaluate(() => (window as { __DOCUSCAN_PHASE0__?: unknown }).__DOCUSCAN_PHASE0__);
  expect(result).toBeTruthy();

  const outputDir = path.resolve(process.cwd(), '../eval-harness/output/phase0');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.resolve(outputDir, `${testInfo.project.name}.json`);

  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
});
