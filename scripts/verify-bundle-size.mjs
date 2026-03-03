import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.resolve(root, 'apps/demo-react/dist/assets');

const MAX_ANY_CHUNK_BYTES = 620 * 1024;
const MAX_INITIAL_BUNDLE_BYTES = 300 * 1024;

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function isInitialChunk(file) {
  return file.startsWith('index-') || file.startsWith('react-vendor-');
}

const files = (await readdir(assetsDir)).filter((name) => name.endsWith('.js')).sort();
if (files.length === 0) {
  throw new Error(`No JS chunks found in ${assetsDir}`);
}

const sizes = [];
for (const file of files) {
  const full = path.resolve(assetsDir, file);
  const info = await stat(full);
  sizes.push({ file, bytes: info.size });
}

const initial = sizes.filter((entry) => isInitialChunk(entry.file));
const initialBytes = initial.reduce((acc, entry) => acc + entry.bytes, 0);
const largest = sizes.reduce((best, entry) => (entry.bytes > best.bytes ? entry : best), sizes[0]);

const issues = [];
if (largest.bytes > MAX_ANY_CHUNK_BYTES) {
  issues.push(
    `Largest chunk ${largest.file} is ${formatKb(largest.bytes)} (limit ${formatKb(MAX_ANY_CHUNK_BYTES)})`,
  );
}
if (initialBytes > MAX_INITIAL_BUNDLE_BYTES) {
  issues.push(
    `Initial bundle is ${formatKb(initialBytes)} (limit ${formatKb(MAX_INITIAL_BUNDLE_BYTES)})`,
  );
}

process.stdout.write('Bundle size snapshot:\n');
for (const entry of sizes) {
  process.stdout.write(`- ${entry.file}: ${formatKb(entry.bytes)}\n`);
}
process.stdout.write(`Initial bundle total: ${formatKb(initialBytes)}\n`);
process.stdout.write(`Largest chunk: ${largest.file} (${formatKb(largest.bytes)})\n`);

if (issues.length > 0) {
  process.stderr.write('Bundle gate failed:\n');
  for (const issue of issues) {
    process.stderr.write(`- ${issue}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Bundle gates PASS.\n');
}
