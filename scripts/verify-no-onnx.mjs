import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.next',
  '.cache',
]);
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.html',
]);
const BLOCKED_PATTERNS = [
  { label: 'onnxruntime', regex: /\bonnxruntime\b/i },
  { label: 'onnx', regex: /\bonnx\b/i },
  { label: 'ort.', regex: /\bort\./i },
];

function isAllowedTokenContext(source, index) {
  const start = Math.max(0, index - 32);
  const end = Math.min(source.length, index + 32);
  const context = source.slice(start, end).toLowerCase();
  return context.includes('no-onnx') || context.includes('verify-no-onnx');
}

function normalizePath(inputPath) {
  return inputPath.split(path.sep).join('/');
}

function parseAllowlist() {
  const raw = process.env.DOCUSCAN_NO_ONNX_ALLOWLIST ?? '';
  const allowlist = new Set([normalizePath(path.resolve(ROOT, 'scripts/verify-no-onnx.mjs'))]);
  for (const item of raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    allowlist.add(normalizePath(path.resolve(ROOT, item)));
  }
  return allowlist;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await listFiles(abs)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    files.push(abs);
  }
  return files;
}

function findLine(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

async function main() {
  const allowlist = parseAllowlist();
  const files = await listFiles(ROOT);
  const violations = [];

  for (const file of files) {
    if (allowlist.has(normalizePath(file))) {
      continue;
    }
    const text = await readFile(file, 'utf8');
    for (const pattern of BLOCKED_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'ig');
      let match = regex.exec(text);
      while (match) {
        if (match.index !== undefined && !isAllowedTokenContext(text, match.index)) {
          const rel = normalizePath(path.relative(ROOT, file));
          violations.push({
            file: rel,
            line: findLine(text, match.index),
            token: pattern.label,
          });
          break;
        }
        match = regex.exec(text);
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('No-ONNX guard failed. Found blocked tokens:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation.file}:${violation.line} (${violation.token})\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('No-ONNX guard PASS: no ONNX/ORT references found.\n');
}

void main().catch((error) => {
  process.stderr.write(
    `No-ONNX guard failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
