<div align="center">

# react-document-autocapture

**React hooks & components for browser-native document auto-capture.**

Drop-in camera component, powerful hook API, and corner-adjust modal — all running 100% client-side. No watermarks. No server uploads. No hidden costs.

[![npm version](https://img.shields.io/npm/v/react-document-autocapture?color=0470FF&label=npm)](https://www.npmjs.com/package/react-document-autocapture)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 18 & 19](https://img.shields.io/badge/React-18%20%7C%2019-61DAFB?logo=react&logoColor=white)](https://react.dev)

[Live Demo](https://doc-autocapture.iammaaz.in) · [Vanilla JS Version](https://www.npmjs.com/package/js-document-autocapture) · [Report Bug](https://github.com/maazkhan77/document-autocapture/issues)

</div>

---

## Why react-document-autocapture?

Most document-capture solutions require expensive licenses, cloud processing, or produce watermarked outputs. **This package is different:**

|                            | react-document-autocapture                        | Others                         |
| -------------------------- | ------------------------------------------------- | ------------------------------ |
| **Price**                  | Free forever (MIT)                                | $$$+ per month                 |
| **Privacy**                | 100% client-side — images never leave the browser | Cloud upload required          |
| **Watermarks**             | None                                              | Often watermarked on free tier |
| **React-native DX**        | Hooks + components, not imperative wrappers       | Thin wrappers over vanilla JS  |
| **ML detection**           | Built-in ML + OpenCV fallback                     | One approach only              |
| **Perspective correction** | GPU-accelerated (WebGL) with CPU auto-fallback    | Varies                         |

> **Not using React?** The core engine is available as [`js-document-autocapture`](https://www.npmjs.com/package/js-document-autocapture) — a framework-agnostic vanilla JS SDK with zero dependencies.

---

## Features

- **`useDocumentAutoCapture` hook** — full scanner lifecycle in one hook
- **`<DocumentAutoCaptureCamera />`** — drop-in component with camera preview, guidance overlay, and controls
- **`<CornerAdjustModal />`** — drag-to-adjust corner editor for captured documents
- **ML-first detection** with OpenCV fallback, GPU warp, and quality gates
- **React 18 & 19** compatible
- **Fully typed** — complete TypeScript definitions included
- **Zero config** — works out of the box with sensible defaults

---

## Install

```bash
npm install react-document-autocapture js-document-autocapture
```

```bash
# or with yarn / pnpm
yarn add react-document-autocapture js-document-autocapture
pnpm add react-document-autocapture js-document-autocapture
```

**Peer dependencies:** `react` and `react-dom` (^18.0.0 or ^19.0.0).

---

## Quick Start — Hook

The hook gives you full control over the scanner lifecycle with reactive state:

```tsx
import { useDocumentAutoCapture } from 'react-document-autocapture';

function CaptureWidget() {
  const { videoRef, start, stop, captureManual, isRunning, detection, guidance, lastCapture } =
    useDocumentAutoCapture({
      autoCapture: true,
      quality: 'balanced',
    });

  return (
    <div>
      <video ref={videoRef} autoPlay muted playsInline style={{ width: 420 }} />
      <button onClick={() => void start()}>Start</button>
      <button onClick={() => void stop()}>Stop</button>
      <button onClick={() => void captureManual()}>Capture</button>
      <p>{guidance ?? 'Ready'}</p>
      {lastCapture && (
        <img
          src={URL.createObjectURL(lastCapture.blob)}
          alt="Captured document"
          style={{ maxWidth: 320 }}
        />
      )}
    </div>
  );
}
```

## Quick Start — Drop-in Component

For the fastest integration, use the pre-built component — video preview, status display, debug overlay, and capture handling out of the box:

```tsx
import { DocumentAutoCaptureCamera } from 'react-document-autocapture';

function App() {
  return (
    <DocumentAutoCaptureCamera
      autoCapture={true}
      quality="balanced"
      debugOverlay="basic"
      onCapture={(result) => {
        console.log('Captured!', result.width, result.height, result.warpTierUsed);
      }}
    />
  );
}
```

---

## API Reference

### `useDocumentAutoCapture(config?)`

Main hook. Accepts all [`ScannerConfig`](#configuration) fields.

**Returns:**

| Field             | Type                                       | Description                                                  |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `videoRef`        | `(node: HTMLVideoElement \| null) => void` | Ref callback — attach to your `<video>` element              |
| `start()`         | `() => Promise<void>`                      | Start camera + detection loop                                |
| `stop()`          | `() => Promise<void>`                      | Stop detection, release camera                               |
| `captureManual()` | `() => Promise<CaptureResult>`             | Trigger manual capture                                       |
| `isRunning`       | `boolean`                                  | Whether the scanner is actively running                      |
| `detection`       | `DetectionResult \| undefined`             | Current frame detection (quads, scores, source)              |
| `stability`       | `StabilityResult \| undefined`             | `{ stable: boolean, stableMs: number }`                      |
| `quality`         | `QualityResult \| undefined`               | Quality gate results for current frame                       |
| `guidance`        | `string \| undefined`                      | Guidance code: `'DOCUMENT_NOT_FOUND'`, `'HOLD_STEADY'`, etc. |
| `lastCapture`     | `CaptureResult \| undefined`               | Most recent capture result                                   |
| `capabilities`    | `Capabilities \| undefined`                | Browser capability report                                    |
| `frame`           | `FrameProcessResult \| undefined`          | Full frame payload (includes all above)                      |
| `warning`         | `string \| undefined`                      | Latest non-fatal warning                                     |
| `error`           | `Error \| undefined`                       | Latest error                                                 |

### `<DocumentAutoCaptureCamera />`

Pre-built component with video preview, debug overlay, action buttons, and status display.

**Props** — extends `ScannerConfig`:

| Prop                          | Type                              | Default   | Description                       |
| ----------------------------- | --------------------------------- | --------- | --------------------------------- |
| `autoStart`                   | `boolean`                         | `true`    | Start scanning on mount           |
| `onCapture`                   | `(result: CaptureResult) => void` | —         | Called on each successful capture |
| `className`                   | `string`                          | —         | CSS class for the container       |
| `debugOverlay`                | `'off' \| 'basic' \| 'full'`      | `'basic'` | Corner overlay on video           |
| _...all ScannerConfig fields_ |                                   |           | Passed to the underlying scanner  |

### `<CornerAdjustModal />`

Modal for manually adjusting detected document corners after capture.

**Props:**

| Prop          | Type                   | Description                                                      |
| ------------- | ---------------------- | ---------------------------------------------------------------- |
| `open`        | `boolean`              | Show/hide the modal                                              |
| `imageUrl`    | `string`               | Image to display (use `URL.createObjectURL(captureResult.blob)`) |
| `initialQuad` | `Quad`                 | Initial corner positions from capture                            |
| `autoRefined` | `boolean`              | Whether corners were auto-refined                                |
| `onClose`     | `() => void`           | Called when user dismisses                                       |
| `onConfirm`   | `(quad: Quad) => void` | Called with adjusted corners                                     |

---

## Configuration

All `ScannerConfig` fields can be passed to the hook or component:

```tsx
useDocumentAutoCapture({
  detection: 'auto', // 'auto' | 'opencv' | 'ml' | 'hybrid'
  quality: 'balanced', // 'fast' | 'balanced' | 'high'
  autoCapture: true, // auto-capture on stable detection
  webglWarp: true, // prefer GPU warp
  mlFallback: true, // ML fallback when OpenCV misses
  cocoSsd: true, // COCO-SSD "book" detector for faster document finding
  postCaptureRefine: true, // post-capture corner refinement
  debug: false, // debug logging
  debugOverlay: 'basic', // 'off' | 'basic' | 'full'
});
```

### Quality Presets

| Preset     | Max Resolution | Format | Stability Frames |
| ---------- | -------------- | ------ | ---------------- |
| `fast`     | 1024 px        | JPEG   | 2                |
| `balanced` | 1920 px        | PNG    | 3                |
| `high`     | 2048 px        | PNG    | 2                |

---

## CaptureResult

```ts
interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  quad: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
  warpTierUsed: 'webgl' | 'cpu' | 'raw';
  captureDecisionSource: 'auto' | 'manual';
  elapsedMs: number;
}
```

---

## Type Exports

```ts
import type {
  ScannerConfig,
  CaptureResult,
  Detection,
  Quality,
  Capabilities,
  ScannerEventMap,
  ScannerSession,
  WarpTierUsed,
} from 'react-document-autocapture';
```

All types are re-exported from `js-document-autocapture`.

---

## Security & Privacy

Your users' data stays with your users. Period.

- **100% client-side processing** — no images, frames, or metadata are ever transmitted to any server
- **No telemetry, no analytics, no tracking** — the SDK phones home to absolutely nobody
- **Minimal external requests** — COCO-SSD (`cocoSsd: true` by default) fetches a ~5 MB model from the TensorFlow CDN once and caches it. All other ML models and OpenCV modules are bundled. Set `cocoSsd: false` for zero network requests
- **Open source & auditable** — every line of code is available for inspection under the MIT license
- **Zero transitive dependencies** — no supply-chain risk from hidden third-party packages

This makes `react-document-autocapture` ideal for applications handling sensitive documents such as identity cards, passports, medical records, financial statements, and legal paperwork — where data residency and compliance (GDPR, HIPAA, SOC 2) are non-negotiable.

---

## Browser Support

Modern browsers with ES2020+ support:

| Browser        | Version |
| -------------- | ------- |
| Chrome / Edge  | 90+     |
| Firefox        | 90+     |
| Safari         | 15+     |
| Chrome Android | 90+     |

**Requires:** Web Workers, Canvas API  
**Recommended:** WebGL (GPU-accelerated warp) — falls back to CPU automatically

---

## Related Packages

| Package                                                                            | Description                                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`js-document-autocapture`](https://www.npmjs.com/package/js-document-autocapture) | Framework-agnostic vanilla JS SDK — use this if you're working with Vue, Angular, Svelte, or plain JavaScript |

---

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/maazkhan77/document-autocapture/issues).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Author

**Built and maintained by [Maaz Khan](https://github.com/maazkhan77)**

---

## License

[MIT](./LICENSE) — free for personal and commercial use.
