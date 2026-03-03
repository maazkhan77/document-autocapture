# docuscan monorepo

Phase-0-first implementation scaffold for the browser document auto-capture SDK.

## Quick start

```bash
pnpm install
pnpm build
pnpm dev
```

## Demo routes

- `http://localhost:4173/` -> studio demo
- `http://localhost:4173/react` -> React SDK integration demo
- `http://localhost:4173/js` -> vanilla JS headless integration demo

Integration docs:

- `/Users/mukesh.shelke/Documents/New project/docs/integration-react.md`
- `/Users/mukesh.shelke/Documents/New project/docs/integration-js.md`

## Validation commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm harness
pnpm phase0
pnpm realclip
pnpm opencv:regression
pnpm ml:model:size
pnpm no-onnx
pnpm --filter @docuscan/eval-harness verify:gates
# strict mode when physical Android artifact is available:
# DOCUSCAN_REQUIRE_PHYSICAL_ANDROID=1 \
# DOCUSCAN_PHYSICAL_ANDROID_REPORT=apps/eval-harness/output/physical-android/latest.json \
# pnpm --filter @docuscan/eval-harness verify:gates
```

E2E smoke tests (Chromium/Firefox) require Playwright browsers:

```bash
pnpm exec playwright install
pnpm --filter @docuscan/demo-react e2e
```

## Android Camera Testing (Secure Context Required)

Camera APIs require a secure origin on mobile browsers.

This often fails on:
- `http://<your-local-ip>:4173`

Use one of these:

1. HTTPS tunnel (recommended for real phone testing):
```bash
pnpm --filter @docuscan/demo-react dev -- --host 0.0.0.0 --port 4173
npx cloudflared tunnel --url http://127.0.0.1:4173
```
Open the generated `https://...trycloudflare.com` URL on Android.

2. Localhost on desktop browser:
- `http://localhost:4173` (works on your laptop browser, not remote phone)

If scanner start fails, runtime now emits:
- `Camera access requires a secure context (HTTPS). Open this app via HTTPS or localhost.`

Phase 0 feasibility artifacts are generated at:

- `apps/eval-harness/output/phase0/*.json`
- `docs/phase0-feasibility-report.md`

Real-clip ingestion and threshold auto-tuning artifacts are generated at:

- `apps/eval-harness/output/realclip/ingested.json`
- `apps/eval-harness/output/realclip/tuned-thresholds.json`
- `docs/realclip-ingestion-report.md`
- `docs/realclip-autotune-report.md`

OpenCV regression artifacts are generated at:

- `apps/eval-harness/output/opencv-regression/latest.json`
- `docs/opencv-regression-report.md`

Physical Android validation artifact expected by strict CI gate:

- `apps/eval-harness/output/physical-android/latest.json`

## Release and npm publish

- Run full release validation:
  - `pnpm release:verify`
- Run package publish dry-run:
  - `pnpm publish:dry-run`
- Publish all SDK packages:
  - `pnpm publish:npm`

Detailed runbook:
- `/Users/mukesh.shelke/Documents/New project/docs/npm-publish-procedure.md`

Frontend UX research notes:
- `/Users/mukesh.shelke/Documents/New project/docs/frontend-ux-research.md`

## Workspace packages

- `@docuscan/core-engine`
- `@docuscan/runtime-web`
- `@docuscan/worker-runtime`
- `@docuscan/warp-webgl`
- `@docuscan/warp-cpu`
- `@docuscan/sdk-headless`
- `@docuscan/sdk-react`
- `@docuscan/demo-react`
- `@docuscan/eval-harness`

## SDK flavors (`@docuscan/sdk-headless`)

```ts
import { createScanner } from '@docuscan/sdk-headless';
import { createScanner as createCoreScanner } from '@docuscan/sdk-headless/core';
import { createScanner as createWebglScanner } from '@docuscan/sdk-headless/webgl-warp';
import { createScanner as createEnhancedScanner } from '@docuscan/sdk-headless/enhance';
import { createScanner as createHybridCornerScanner } from '@docuscan/sdk-headless/hybrid-corner';
import { createScanner as createLegacyAliasScanner } from '@docuscan/sdk-headless/ml-fallback';
import { createScanner as createMlPrimaryV2BetaScanner } from '@docuscan/sdk-headless/ml-primary-v2-beta';
```

- `core`: default OpenCV/CV profile.
- `webgl-warp`: OpenCV/CV profile with `preferredMode='best'` for worker+WebGL capable environments.
- `enhance`: higher-quality capture profile with hybrid fallback defaults.
- `hybrid-corner`: preferred production profile (`detectorMode='hybrid'`) with TFJS corner fallback.
- `ml-fallback`: deprecated alias of `hybrid-corner` (kept for backwards compatibility).
- `ml-primary-v2-beta`: staged rollout profile (`detectorMode='ml'`, `mlPipelineVersion='v2-graph'`, strict warp validation).

### Runtime note

- Runtime supports `detectorMode: 'cv' | 'hybrid' | 'ml'`.
- OpenCV remains primary; Hough is recovery-only; TFJS corner fallback is lazy-loaded in worker mode.
- In `detectorMode='ml'`, ML runs first and CV/Hough are only used when ML misses/rejects or ML is unavailable (reported via fallback telemetry).
- Alternate non-TFJS ML runtimes are unsupported and blocked by repository guard (`pnpm no-onnx`).
- OpenCV worker bootstrap can be overridden with `opencvScriptUrl` (default `/opencv.js`).
- Ensure your app serves `opencv.js` at the configured path; otherwise runtime falls back to the built-in non-OpenCV detector path.
- Model licensing/attribution for bundled `doc-corner-v2`: `/Users/mukesh.shelke/Documents/New project/docs/ml-model-attribution.md`.

OpenCV regression guide:
- `/Users/mukesh.shelke/Documents/New project/docs/opencv-regression-benchmarking.md`
