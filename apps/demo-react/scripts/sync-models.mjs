import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const sourceModelsDir = path.resolve(appRoot, '../../packages/ml-tf-fallback/models');
const publicModelsDir = path.resolve(appRoot, 'public/models');

await rm(publicModelsDir, { recursive: true, force: true });
await cp(sourceModelsDir, publicModelsDir, { recursive: true });
