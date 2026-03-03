# Document Auto Capture v2 Enhanced PRD - Remaining Production Plan

Generated: 2026-02-28
Source PRD: /Users/mukesh.shelke/Downloads/document-autocapture_prd_v_2_enhanced.md

## 1) Current Baseline (Concrete)

1. Build quality gates are green:
- `pnpm typecheck` PASS
- `pnpm lint` PASS
- `pnpm test` PASS
- `pnpm build` PASS
- `pnpm e2e` PASS (Chromium, Firefox, chromium-android-emulated)

2. P1/P2/P3 status:
- P1 test coverage gap closed for previously untested critical packages.
- P2 Vite chunk warning resolved in build output (manual chunking + deferred TFJS backend load).
- P3 maintainability risk reduced: `App.tsx` refactored from 777 -> 38 lines and split into focused components.

3. Updated benchmark/report status:
- Phase 0 is now PASS across benchmark matrix in CI browser targets.
  - Reference: /Users/mukesh.shelke/Documents/New project/docs/phase0-feasibility-report.md
- Bakeoff verdict is now PROMOTE.
  - Reference: /Users/mukesh.shelke/Documents/New project/docs/bakeoff-report.md
- Real-clip auto-tune is PASS for lock/FP/auto-capture targets.
  - Reference: /Users/mukesh.shelke/Documents/New project/docs/realclip-autotune-report.md

## 2) PRD Gap Matrix (Remaining)

1. Phase 3 hardening and deterministic performance:
- Remaining gap: physical Android validation still missing (emulation is provisional).

2. Phase 4 packaging and productization:
- Status: package flavor entrypoints are implemented in `js-document-autocapture` exports.

3. CI release gates:
- Remaining gap: none for synthetic gates (phase0/bakeoff/realclip + size now enforced).
- Remaining enhancement: wire collected physical-device artifacts into strict gate mode in CI.

## 3) Execution Plan to Reach Production

### Milestone A - Close Phase 0 Hard Failures (P0 Blocker) ✅

1. Warp ladder conformance work:
- Optimize `@document-autocapture/warp-cpu` to consistently meet `<200ms` in benchmark harness.
- Add fast-path downsampled pre-warp fallback when full-res CPU budget will exceed threshold.
- Add deterministic budget guardrails and explicit bailout reason fields.

2. WebGL warp robustness:
- Add runtime fallback reason taxonomy: `context_unavailable`, `compile_fail`, `budget_exceeded`.
- Ensure standard mode always attempts main-thread WebGL first where available.
- Add benchmark fixture for WebGL warm/cold timings.

3. Exit gate:
- `docs/phase0-feasibility-report.md` must show PASS for all Phase 0 rows on Chromium desktop, Firefox desktop, and Android target run.

### Milestone B - Reliability Gate Promotion (Bakeoff NO_GO -> PROMOTE) ✅

1. Firefox-specific reliability tuning:
- Tune confidence/margin/stability defaults for Firefox frame cadence.
- Add browser-specific calibration profile in runtime config (without API break).

2. Hybrid fallback behavior tightening:
- Keep CV primary but retune fallback entry/exit counters from real-clip distributions.
- Add detector-source oscillation guard (prevents CV/ML thrash).

3. Exit gate:
- `docs/bakeoff-report.md` must show `Rollout verdict: PROMOTE`.

### Milestone C - Real Dataset Adapters and Acceptance Automation ✅ (ingest adapters + gate verifier)

1. Add dataset adapters:
- SmartDoc 2015 ingest adapter.
- MIDV-500 ingest adapter.
- Unified normalized schema into `apps/eval-harness`.

2. Add nightly and PR checks:
- Run harness summary + threshold verdict artifact generation.
- Fail CI when lock/FP/auto-capture gates regress past configured bounds.

3. Exit gate:
- Dataset runs produce reproducible metrics artifacts for SmartDoc + MIDV + project clips.

### Milestone D - Packaging and Bundle Governance ✅ (size gate + CI enforcement)

1. Build flavors and exports:
- Define official package entrypoints:
  - `js-document-autocapture/core`
  - `js-document-autocapture/webgl-warp`
  - `js-document-autocapture/enhance`
  - `js-document-autocapture/hybrid-corner` (preferred)
  - `js-document-autocapture/ml-fallback` (deprecated alias of `hybrid-corner`)
- Document flavor tradeoffs and default recommendation.

2. Bundle governance:
- Add size reports per flavor.
- Add CI threshold checks and per-PR diff budgets.

3. Exit gate:
- Budget checks enforced in CI and documented in README/release notes.

### Milestone F - Runtime Policy Enforcement (TFJS-only Fallback)

1. Repository guard:
- Add `scripts/verify-no-onnx.mjs` and `pnpm no-onnx`.
- Fail release verification when blocked alternate-runtime tokens appear in source/config.

2. Architecture lock:
- OpenCV contour-first detector remains primary.
- Hough remains guarded recovery path.
- TFJS corner model remains the only supported ML fallback backend.

3. Exit gate:
- `pnpm no-onnx` PASS in local and CI release verification.

### Milestone E - Production Readiness and Release

1. Physical Android validation:
- Run full acceptance suite on at least one mid-range Android reference device.
- Capture artifacts for FPS percentiles, time-to-stable, and false positives.

2. Release controls:
- Keep `0.x` prereleases while tuning.
- Promote `1.0.0` only when all PRD gates are green on dataset + device runs.

3. Exit gate:
- Ship checklist complete with linked artifacts in `docs/` and CI green.

## 4) Immediate Next Sprint Backlog (Ordered)

1. Physical Android benchmark + acceptance artifact capture.
2. Enable strict physical-device gate mode in CI after artifact publication.

## 5) Definition of Done for 1.0.0

1. Phase 0 report fully PASS.
2. Bakeoff verdict PROMOTE.
3. Real-clip + SmartDoc + MIDV acceptance thresholds green.
4. Physical Android run evidence stored in repo artifacts/docs.
5. CI enforces quality + E2E + perf + size gates.

## 6) ML v2 Staged Rollout (Current)

1. Beta flavor:
- Use `js-document-autocapture/ml-primary-v2-beta`.
- Defaults: `detectorMode='ml'`, `mlPipelineVersion='v2-graph'`, `mlModelId='doc-corner-v2'`, `warpValidationLevel='strict'`.

2. Runtime behavior:
- ML runs first on every frame in ML mode.
- CV/Hough run only when ML misses/rejects or is unavailable.
- Worker telemetry exposes `cvFallbackReason` (`ml_miss` | `ml_reject` | `ml_unavailable`) to debug source changes.

3. Capture hardening:
- Strict warp validation rejects suspicious Hough auto-warps with structured reasons:
  - `degenerate_luma`
  - `block_corruption`
  - `out_of_bounds_black`
  - `hough_auto_risky`
- Rejected warps always fall back to raw capture.

4. Promotion criteria:
- Zero colored-block saved captures across stress suite.
- Stable ML-accepted detection ratio improvement vs v1 heuristic baseline.
- Keep `doc-corner-v1` heuristic path available for one release cycle as rollback.
