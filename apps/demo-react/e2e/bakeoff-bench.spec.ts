import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const candidates = ['candidate-a', 'candidate-b', 'candidate-c'] as const;

test.setTimeout(300000);

for (const candidate of candidates) {
  test(`bakeoff benchmark (${candidate})`, async ({ page }, testInfo) => {
    await page.goto(`http://127.0.0.1:4173/?bakeoff=1&candidate=${candidate}`);

    await page.waitForFunction(
      () => Boolean((window as { __DOCUSCAN_BAKEOFF__?: unknown }).__DOCUSCAN_BAKEOFF__),
      {
        timeout: 240000,
      },
    );

    const result = await page.evaluate(
      () => (window as { __DOCUSCAN_BAKEOFF__?: unknown }).__DOCUSCAN_BAKEOFF__,
    );
    expect(result).toBeTruthy();

    const outputDir = path.resolve(process.cwd(), '../eval-harness/output/bakeoff');
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.resolve(outputDir, `${testInfo.project.name}-${candidate}.json`);
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  });
}
