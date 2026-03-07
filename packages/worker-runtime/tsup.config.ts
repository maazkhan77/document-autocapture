import { defineConfig } from 'tsup';

export default defineConfig([
  // Main entry: exports createScannerWorker + types. External workspace deps.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: true,
    splitting: false,
    clean: true,
  },
  // Worker entry: self-contained bundle with workspace deps inlined.
  // Dynamic imports (tfjs, coco-ssd) are kept external so browser resolves them at runtime.
  {
    entry: { worker: 'src/worker.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: false,
    splitting: false,
    noExternal: [
      '@document-autocapture/core-engine',
      '@document-autocapture/ml-tf-fallback',
    ],
  },
]);
