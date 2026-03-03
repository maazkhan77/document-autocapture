import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestMidv, ingestSmartDoc } from '../external-datasets';

function repoPath(...segments: string[]): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..', ...segments);
}

describe('external dataset adapters', () => {
  it('ingests SmartDoc-style manifests', async () => {
    const smartdocDir = repoPath('datasets', 'smartdoc-sample');
    const manifests = await ingestSmartDoc(smartdocDir);
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].datasetName).toBe('smartdoc-2015');
    expect(manifests[0].frames.length).toBeGreaterThan(0);
  });

  it('ingests MIDV-style manifests', async () => {
    const midvDir = repoPath('datasets', 'midv-sample');
    const manifests = await ingestMidv(midvDir);
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    expect(manifests[0].datasetName).toBe('midv-500');
    expect(manifests[0].frames.length).toBeGreaterThan(0);
  });
});
