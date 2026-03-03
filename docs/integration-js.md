# JavaScript Integration (`/js`)

This route demonstrates imperative usage with `js-document-autocapture` (no React hooks).

## What This Page Demonstrates

- imperative mount lifecycle
- event wiring: `frame`, `detection`, `guidance`, `capture`, `warning`, `error`
- explicit teardown: `stop()` then `destroy()`

## Run Locally

```bash
pnpm --filter @document-autocapture/demo-react dev
```

Open:

- `http://localhost:4173/js`

## Install

```bash
pnpm add js-document-autocapture
```

Note: `js-document-autocapture` is ESM-only. Use `import` syntax.

## Minimal Usage

```ts
import { createScanner } from 'js-document-autocapture';

const scanner = createScanner({
  videoElement: document.querySelector('video')!,
  detectorMode: 'ml',
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  warpValidationLevel: 'strict',
  captureMimeType: 'image/png',
});

await scanner.start();
```
