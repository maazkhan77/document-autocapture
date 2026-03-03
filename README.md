# React Document Auto Capture + JavaScript Document Auto Capture

Free, no watermark, lightweight, fast, and accurate browser document auto-capture.

This monorepo powers two public npm packages:

- `react-document-autocapture`
- `js-document-autocapture`

`js-document-autocapture` is ESM-first (use `import`, not CommonJS `require`).

## Why This SDK

- Free to use with no watermark overlays
- Runs fully in the browser with local processing
- Lightweight setup for React and vanilla JS apps
- ML-first detection with CV fallback for hard scenes
- Built-in auto-capture, strict warp validation, and manual corner adjust

## Install

```bash
pnpm add react-document-autocapture js-document-autocapture
```

If you only need vanilla JS:

```bash
pnpm add js-document-autocapture
```

## Quick Start (React)

```tsx
import { useDocumentAutoCapture } from 'react-document-autocapture';

export function CaptureWidget() {
  const { videoRef, start, stop, captureManual, guidance, detection } = useDocumentAutoCapture({
    detectorMode: 'ml',
    mlPipelineVersion: 'v2-graph',
    mlModelId: 'doc-corner-v2',
    warpValidationLevel: 'strict',
    captureMimeType: 'image/png',
    autoCapture: true,
  });

  return (
    <div>
      <video ref={videoRef} autoPlay muted playsInline style={{ width: 420 }} />
      <button onClick={() => void start()}>Start</button>
      <button onClick={() => void stop()}>Stop</button>
      <button onClick={() => void captureManual()}>Capture</button>
      <p>{guidance}</p>
      <p>{detection?.source}</p>
    </div>
  );
}
```

## Quick Start (JavaScript)

```ts
import { createScanner } from 'js-document-autocapture';

const video = document.querySelector('video');

const scanner = createScanner({
  videoElement: video,
  detectorMode: 'ml',
  mlPipelineVersion: 'v2-graph',
  mlModelId: 'doc-corner-v2',
  warpValidationLevel: 'strict',
  captureMimeType: 'image/png',
  autoCapture: true,
});

scanner.on('capture', (capture) => {
  console.log('captured', capture.width, capture.height, capture.warpTierUsed);
});

await scanner.start();
```

## High-Intent Keywords

### React document autocapture
Use `react-document-autocapture` to add camera preview, guidance, and capture controls in React with minimal code.

### JavaScript document autocapture
Use `js-document-autocapture` for framework-agnostic browser integrations with direct session and event APIs.

### Browser document scanner
This SDK is designed for in-browser scanning workflows with perspective correction and quality gates.

### Web document scanner
Works in modern web apps with worker mode, ML detection, and fallback CV processing.

### Auto document capture
Supports automatic capture triggers based on detection confidence, stability, and quality checks.

### ID card scanner SDK
Handles cards and paper-like documents with corner-based capture and correction.

### Webcam document scanner
Built for live camera feeds from desktop and mobile browsers (secure context required).

### Document scanner SDK
Production-oriented architecture with test coverage, evaluation harness, and publish workflow.

## Product Claims (What You Get)

- No watermark added to captured output
- Free and open workflow for developers
- Lightweight integration path for React and JS
- Fast runtime with worker support and CV/ML pipeline
- Accurate document capture with strict warp validation

## Demo Routes

Run the demo app:

```bash
pnpm install
pnpm build
pnpm dev
```

Open:

- `http://localhost:4173/` - Studio
- `http://localhost:4173/react` - React integration demo
- `http://localhost:4173/js` - Vanilla JS integration demo

## Monorepo Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm harness
pnpm phase0
pnpm bakeoff
pnpm realclip
pnpm opencv:regression
pnpm brand:check
pnpm release:verify
```

## Package Publish

Only two public packages are published:

1. `js-document-autocapture`
2. `react-document-autocapture`

Dry run:

```bash
pnpm publish:dry-run
```

Publish:

```bash
pnpm publish:npm
```

Detailed runbook:

- `/Users/mukesh.shelke/Documents/New project/docs/npm-publish-procedure.md`

## Migration (Hard Cut)

Legacy scoped SDK names were removed with no compatibility alias.

## Internal Architecture

Internal runtime packages stay workspace-only under `@document-autocapture/*`.

- `/Users/mukesh.shelke/Documents/New project/docs/architecture.md`

Integration docs:

- `/Users/mukesh.shelke/Documents/New project/docs/integration-react.md`
- `/Users/mukesh.shelke/Documents/New project/docs/integration-js.md`
