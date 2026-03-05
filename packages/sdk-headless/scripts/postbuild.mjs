import { cp, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const sourceModelsDir = path.resolve(packageRoot, '../ml-tf-fallback/models');
const outputModelsDir = path.resolve(packageRoot, 'dist/models');
const workerEntryPath = path.resolve(packageRoot, 'dist/worker.entry.js');
const workerPath = path.resolve(packageRoot, 'dist/worker.js');

try {
  await stat(workerEntryPath);
  await rm(workerPath, { force: true });
  await rename(workerEntryPath, workerPath);
} catch {
  // worker entry name did not need normalization.
}

await rm(outputModelsDir, { recursive: true, force: true });
await cp(sourceModelsDir, outputModelsDir, { recursive: true });
