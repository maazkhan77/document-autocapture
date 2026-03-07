import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Recursively collect all `.json` files from a path.
 * If `inputPath` is a file, returns it directly.
 * Uses case-insensitive extension check for cross-platform compatibility.
 */
export async function collectJsonFiles(inputPath: string): Promise<string[]> {
  const stats = await stat(inputPath);
  if (stats.isFile()) {
    return [path.resolve(inputPath)];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Input path is neither file nor directory: ${inputPath}`);
  }

  const entries = await readdir(inputPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.resolve(inputPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonFiles(full);
      files.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files.sort();
}
