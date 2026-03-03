# docuscan v1 architecture

## Runtime layers

1. `@docuscan/core-engine`
- Pure TypeScript detection pipeline and scoring logic.
- Stability tracking and quality checks.
- No browser API imports.

2. `@docuscan/worker-runtime`
- Worker message protocol.
- Off-main-thread frame processing via `core-engine`.

3. `@docuscan/runtime-web`
- Capability probes and mode selection (`best`, `standard`, `fallback`).
- Camera session orchestration and latest-frame-only scheduling.
- Best-mode ingestion path: main-thread OffscreenCanvas -> `transferToImageBitmap()` -> worker.
- Capture warp ladder orchestration: WebGL -> CPU -> raw.

4. `@docuscan/sdk-headless`
- Public headless API facade.

5. `@docuscan/sdk-react`
- React hooks/components:
  - `useDocuscan`
  - `DocuscanCamera`
  - `CornerAdjustModal`

## Warp ladder

- Tier 1 (`@docuscan/warp-webgl`): WebGL fragment shader with homography mapping.
- Tier 2 (`@docuscan/warp-cpu`): CPU perspective resampling with homography and bilinear sampling.
- Tier 3: Raw output fallback with detected quad metadata.

## Evaluation harness

- `apps/eval-harness` computes:
  - IoU distribution
  - FPS distribution
  - median time-to-stable
  - false-positive rate
  - auto-capture success rate
  - rejection reason distribution

- Sample manifest and output:
  - `datasets/sample-manifest.json`
  - `apps/eval-harness/output/summary.json`

## Notes

- v1 baseline is pure TS detection pipeline.
- WASM integration remains an explicit Phase 3 escape hatch if profiling misses budgets.
