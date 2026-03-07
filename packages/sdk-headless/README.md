<div align="center">

# js-document-autocapture

**The free, open-source document auto-capture SDK for the browser.**

Detect, capture, and perspective-correct documents directly in the browser — powered by ML with computer-vision fallback. No watermarks. No server uploads. No hidden costs.

[![npm version](https://img.shields.io/npm/v/js-document-autocapture?color=0470FF&label=npm)](https://www.npmjs.com/package/js-document-autocapture)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/js-document-autocapture)

[Live Demo](https://doc-autocapture.iammaaz.in) · [React Version](https://www.npmjs.com/package/react-document-autocapture) · [Report Bug](https://github.com/maazkhan77/document-autocapture/issues)

</div>

---

## Why js-document-autocapture?

Most document-capture SDKs lock you into expensive licenses, server-side processing, or watermarked outputs. **This SDK is different:**

|                            | js-document-autocapture                           | Others                         |
| -------------------------- | ------------------------------------------------- | ------------------------------ |
| **Price**                  | Free forever (MIT)                                | $$$+ per month                 |
| **Privacy**                | 100% client-side — images never leave the browser | Cloud upload required          |
| **Watermarks**             | None                                              | Often watermarked on free tier |
| **Dependencies**           | Zero runtime deps — single ESM bundle             | Heavy vendor lock-in           |
| **ML detection**           | Built-in ML + OpenCV fallback                     | One approach only              |
| **Perspective correction** | GPU-accelerated (WebGL) with CPU auto-fallback    | Varies                         |

> **Using React?** Check out [`react-document-autocapture`](https://www.npmjs.com/package/react-document-autocapture) — ready-made hooks and components built on top of this SDK.

---

## Features

- **ML-first detection** with OpenCV/Hough fallback for difficult scenes
- **Automatic capture** when the document is stable, well-framed, and passes quality gates
- **Perspective correction** via GPU (WebGL) or CPU warp with strict validation
- **Manual corner adjustment** support via quad coordinates in the capture result
- **Event-driven API** — subscribe to `frame`, `detection`, `guidance`, `capture`, `warning`, `error`
- **Quality presets** — `fast`, `balanced`, or `high` to control resolution, format, and stability
- **Zero runtime dependencies** — all internals are bundled into a single ESM entry
- **Fully typed** — complete TypeScript definitions included

---

## Install

```bash
npm install js-document-autocapture
```

```bash
# or with yarn / pnpm
yarn add js-document-autocapture
pnpm add js-document-autocapture
```

> ESM-only. Use `import`, not `require`.

---

## Quick Start

```ts
import { createScanner } from 'js-document-autocapture';

const video = document.querySelector('video');

const scanner = createScanner({
  videoElement: video,
  autoCapture: true,
});

scanner.on('capture', (result) => {
  console.log(result.width, result.height, result.warpTierUsed);
  // result.imageData  — raw ImageData
  // result.dataUrl    — base64 data URL
  // result.quad       — detected corner coordinates
});

scanner.on('guidance', (code) => {
  // 'DOCUMENT_NOT_FOUND' | 'MOVE_CLOSER' | 'HOLD_STEADY' | 'CAPTURING' | ...
  document.getElementById('hint').textContent = code;
});

await scanner.start();
```

That's it — three steps: create, listen, start.

---

## Configuration

```ts
const scanner = createScanner({
  // --- High-level controls ---
  detection: 'auto', // 'auto' | 'opencv' | 'ml' | 'hybrid'
  quality: 'balanced', // 'fast' | 'balanced' | 'high'
  autoCapture: true, // enable automatic capture on stable detection
  webglWarp: true, // use GPU warp when available (CPU fallback automatic)
  mlFallback: true, // allow ML fallback when OpenCV misses
  cocoSsd: true, // COCO-SSD "book" detector for faster document finding
  postCaptureRefine: true, // enable safe post-capture corner refinement
  debug: false, // enable debug logging
  debugOverlay: 'off', // 'off' | 'basic' | 'full'

  // --- Required for camera ---
  videoElement: video, // the <video> element to use
});
```

### Quality Presets

| Preset     | Max Resolution | Format | JPEG Quality | Stability Frames |
| ---------- | -------------- | ------ | ------------ | ---------------- |
| `fast`     | 1024 px        | JPEG   | 0.85         | 2                |
| `balanced` | 1920 px        | PNG    | 0.92         | 3                |
| `high`     | 2048 px        | PNG    | 0.95         | 2                |

Preset values are defaults — any explicit field you set takes precedence.

### Detection Modes

The SDK offers four detection strategies. Choose the one that best fits your use case:

| Mode     | Strategy                                            | Latency    | Accuracy    | Best For                                   |
| -------- | --------------------------------------------------- | ---------- | ----------- | ------------------------------------------ |
| `auto`   | ML-first + OpenCV fallback + COCO-SSD (recommended) | Low–Medium | **Highest** | General use — adapts to the scene          |
| `ml`     | ML graph model only, no OpenCV fallback             | Low        | High        | Clean backgrounds, controlled environments |
| `opencv` | OpenCV Hough line detection only, no ML models      | **Lowest** | Moderate    | Low-end devices, no ML bundle desired      |
| `hybrid` | OpenCV primary + ML fallback when CV misses         | Medium     | High        | Challenging lighting, busy backgrounds     |

#### How Detection Works

```
Frame → [COCO-SSD "book" detector] ──→ coarse document region (fast, ~5–15 ms)
      → [ML graph model]           ──→ precise 4-corner quad  (accurate, ~20–40 ms)
      → [OpenCV / Hough]           ──→ line-based quad         (no model needed)
```

In `auto` mode (default), all enabled providers run **in parallel** each frame. The engine picks the highest-confidence result:

1. **COCO-SSD** detects a rectangular "book"-class object as a coarse document proxy — very fast on WebGL.
2. **ML graph model** (`doc-corner-v2`) predicts precise corner keypoints for perspective correction.
3. **OpenCV / Hough** acts as the safety net when ML misses or isn't loaded yet.

#### COCO-SSD — Object-Level Detection

COCO-SSD is **enabled by default** (`cocoSsd: true`). It downloads a lightweight MobileNetV2 model (~5 MB) from the TensorFlow CDN on first use and runs inference via WebGL (with CPU fallback).

**Why it matters:**

- **Faster first-frame detection** — COCO-SSD often finds the document within 1–2 frames, before the ML graph model has warmed up.
- **Robustness in clutter** — object-level detection is less sensitive to shadows, glare, and busy backgrounds than edge-based methods.
- **Parallel execution** — runs alongside the graph model at zero extra frame cost.

**Tuning options:**

```ts
const scanner = createScanner({
  cocoSsd: true, // enable/disable (default: true)
  cocoMinScore: 0.45, // minimum confidence threshold (0–1)
  cocoUseAsPrimaryInMlMode: true, // use COCO result as primary when ML is selected
});
```

> **Bandwidth note:** The COCO-SSD model is fetched once from the TensorFlow CDN and cached by the browser. If your application requires **zero external network requests**, set `cocoSsd: false` to disable it.

#### Accuracy vs Speed Comparison

| Provider                     | Model Size       | First Inference | Per-Frame (WebGL) | Corner Precision  | Works Without GPU |
| ---------------------------- | ---------------- | --------------- | ----------------- | ----------------- | ----------------- |
| **ML graph** (doc-corner-v2) | 2.0 MB (bundled) | ~80–120 ms      | ~20–40 ms         | **Sub-pixel**     | Yes (WASM)        |
| **COCO-SSD** (MobileNetV2)   | ~5 MB (CDN)      | ~150–250 ms     | ~5–15 ms          | Bounding-box      | Yes (CPU)         |
| **OpenCV / Hough**           | ~4 MB (bundled)  | ~30–50 ms       | ~8–20 ms          | Line-intersection | Yes               |

_Timings measured on a mid-range laptop (M1 MacBook Air). Mobile devices may be 1.5–3× slower._

#### Choosing the Right Mode

- **`auto`** (default) — Start here. The SDK combines all available providers, picks the best quad each frame, and gracefully degrades on weaker hardware. This gives you both the speed of COCO-SSD and the precision of the ML graph model.
- **`ml`** — Use when you know the user has a capable device and want maximum corner accuracy without OpenCV overhead.
- **`opencv`** — Use when you want the smallest possible bundle or need to avoid any ML model downloads (set `cocoSsd: false` too).
- **`hybrid`** — Use when OpenCV works well for most of your documents but you need ML as a backup for tricky cases.

---

## Events

```ts
scanner.on('frame', (frame) => {
  // Fires every processed frame
  // frame.detection — candidate quads, best match, source ('ml' | 'opencv')
  // frame.stability — { stable, stableMs }
  // frame.quality   — quality gate results
  // frame.guidance  — guidance code string
});

scanner.on('detection', (detection) => {
  // detection.bestCandidate — top quad with score
  // detection.candidates    — all candidate quads
  // detection.source        — 'ml' | 'opencv'
  // detection.status        — 'found' | 'not_found' | 'rejected'
});

scanner.on('capture', (result) => {
  // result.imageData    — ImageData pixels
  // result.dataUrl      — base64 string
  // result.width        — output width
  // result.height       — output height
  // result.quad         — corner coordinates (topLeft, topRight, bottomRight, bottomLeft)
  // result.warpTierUsed — 'webgl' | 'cpu' | 'raw'
  // result.mimeType     — 'image/png' or 'image/jpeg'
});

scanner.on('guidance', (code) => {
  /* guidance code string */
});
scanner.on('warning', (message) => {
  /* non-fatal warning */
});
scanner.on('error', (error) => {
  /* Error object */
});
scanner.on('capabilities', (caps) => {
  /* browser capability report */
});
```

---

## Session Control

```ts
await scanner.start(); // start camera + detection loop
await scanner.stop(); // stop detection, release camera
await scanner.destroy(); // full teardown, release all resources
const result = await scanner.capture(); // trigger manual capture
scanner.updateConfig({ quality: 'high' }); // update config at runtime
const caps = scanner.getCapabilities(); // { webgl, offscreen, worker, ... }
```

---

## Utility Exports

```ts
import { detectCapabilities, selectExecutionMode } from 'js-document-autocapture';

// Check what the current browser supports
const caps = await detectCapabilities();
// caps.webgl, caps.offscreenCanvas, caps.webWorker, ...

// Get recommended execution mode for the environment
const mode = selectExecutionMode(caps);
// 'worker-gpu' | 'worker-cpu' | 'main-cpu' | ...
```

---

## Type Exports

```ts
import type {
  ScannerConfig,
  ScannerSession,
  CaptureResult,
  Detection, // 'auto' | 'opencv' | 'ml' | 'hybrid'
  Quality, // 'fast' | 'balanced' | 'high'
  Capabilities,
  ScannerEventMap,
  ScannerEventName,
  WarpTierUsed, // 'webgl' | 'cpu' | 'raw'
} from 'js-document-autocapture';
```

---

## Security & Privacy

Your users' data stays with your users. Period.

- **100% client-side processing** — no images, frames, or metadata are ever transmitted to any server
- **No telemetry, no analytics, no tracking** — the SDK phones home to absolutely nobody
- **Minimal external requests** — COCO-SSD (`cocoSsd: true` by default) fetches a ~5 MB model from the TensorFlow CDN once and caches it. All other ML models and OpenCV modules are bundled. Set `cocoSsd: false` for zero network requests
- **Open source & auditable** — every line of code is available for inspection under the MIT license
- **Zero runtime dependencies** — no transitive supply-chain risk; what you install is what you get

This makes `js-document-autocapture` ideal for applications handling sensitive documents such as identity cards, passports, medical records, financial statements, and legal paperwork — where data residency and compliance (GDPR, HIPAA, SOC 2) are non-negotiable.

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

| Package                                                                                  | Description                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`react-document-autocapture`](https://www.npmjs.com/package/react-document-autocapture) | React hooks & components built on this SDK — drop-in `<DocumentAutoCaptureCamera />`, `useDocumentAutoCapture` hook, and `<CornerAdjustModal />` |

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
