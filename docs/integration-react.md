# React Integration (`/react`)

This route shows production-style integration with `react-document-autocapture`.

## What This Page Demonstrates

- live camera preview
- start / stop / capture actions
- real-time guidance and source status
- latest capture preview
- copyable install and usage snippets

## Run Locally

```bash
pnpm --filter @document-autocapture/demo-react dev
```

Open:

- `http://localhost:4173/react`

## Install

```bash
pnpm add react-document-autocapture js-document-autocapture
```

## Minimal Hook Usage

```tsx
import { useDocumentAutoCapture } from 'react-document-autocapture';

const { videoRef, start, stop, captureManual, detection, guidance } = useDocumentAutoCapture({
  detectorMode: 'ml',
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  warpValidationLevel: 'strict',
  captureMimeType: 'image/png',
});
```
