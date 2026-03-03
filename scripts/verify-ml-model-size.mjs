import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const modelDir = path.resolve(rootDir, 'packages/ml-tf-fallback/models/doc-corner-v2');
const maxBytes = Number.parseInt(process.env.DOCUMENT_AUTOCAPTURE_ML_MODEL_MAX_BYTES ?? '2621440', 10);

const artifactPath = path.join(modelDir, 'artifact.json');
const modelJsonPath = path.join(modelDir, 'model.json');

if (!fs.existsSync(artifactPath)) {
  throw new Error(`Missing artifact.json at ${artifactPath}`);
}
if (!fs.existsSync(modelJsonPath)) {
  throw new Error(`Missing model.json at ${modelJsonPath}`);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

if (artifact.outputFormat !== 'coords_score_logit') {
  throw new Error(`doc-corner-v2 artifact.outputFormat must be coords_score_logit, got ${artifact.outputFormat}`);
}

const shardPaths = [];
for (const group of modelJson.weightsManifest ?? []) {
  for (const relPath of group.paths ?? []) {
    const shard = path.join(modelDir, relPath);
    if (!fs.existsSync(shard)) {
      throw new Error(`Missing weight shard ${shard}`);
    }
    shardPaths.push(shard);
  }
}

const modelBytes = fs.statSync(modelJsonPath).size;
const shardBytes = shardPaths.reduce((acc, p) => acc + fs.statSync(p).size, 0);
const totalBytes = modelBytes + shardBytes;

if (totalBytes > maxBytes) {
  throw new Error(`doc-corner-v2 payload too large: ${totalBytes} bytes > ${maxBytes} byte budget`);
}

console.log(
  JSON.stringify(
    {
      modelDir,
      modelBytes,
      shardBytes,
      totalBytes,
      maxBytes,
      status: 'ok',
    },
    null,
    2,
  ),
);
