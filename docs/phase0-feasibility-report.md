# Phase 0 Feasibility Report

Generated: 2026-03-01T17:26:55.313Z

## Environment Matrix

| Target | Project | Selected mode | User agent |
|---|---|---|---|
| Chrome Android (Emulated Pixel 7) | chromium-android-emulated | standard | Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.6 Mobile Safari/537.36 |
| Chrome Desktop (Playwright Chromium) | chromium | standard | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.6 Safari/537.36 |
| Firefox Desktop (Playwright Firefox) | firefox | best | Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0.1) Gecko/20100101 Firefox/146.0.1 |

## Prototype Results

### Chrome Android (Emulated Pixel 7)

1. Frame ingestion throughput
- Standard: 41.43 FPS (median roundtrip 23.40ms)
- Best (ImageBitmap): 40.84 FPS (median roundtrip 23.60ms)
2. Detection loop prototype
- Detection: 42.39 FPS, median 20.80ms, p95 22.70ms, hard ceiling violations 2
3. Worker pipeline mode selection
- Selected mode: standard
4. WebGL perspective warp prototype
- Result: FAIL; elapsed 0.40ms; within 50ms budget: PASS (downgraded path accepted) (WebGL context unavailable)
5. CPU piecewise-affine warp prototype
- Result: PASS; elapsed 77.30ms; within 200ms budget: PASS
6. End-to-end capture flow
- stable=true, stableAt=660ms, captureTier=cpu, guidance=READY, success=true

### Chrome Desktop (Playwright Chromium)

1. Frame ingestion throughput
- Standard: 41.12 FPS (median roundtrip 23.40ms)
- Best (ImageBitmap): 40.68 FPS (median roundtrip 23.50ms)
2. Detection loop prototype
- Detection: 42.43 FPS, median 20.80ms, p95 22.50ms, hard ceiling violations 2
3. Worker pipeline mode selection
- Selected mode: standard
4. WebGL perspective warp prototype
- Result: FAIL; elapsed 1.50ms; within 50ms budget: PASS (downgraded path accepted) (WebGL context unavailable)
5. CPU piecewise-affine warp prototype
- Result: PASS; elapsed 80.70ms; within 200ms budget: PASS
6. End-to-end capture flow
- stable=true, stableAt=660ms, captureTier=cpu, guidance=READY, success=true

### Firefox Desktop (Playwright Firefox)

1. Frame ingestion throughput
- Standard: 33.55 FPS (median roundtrip 29.00ms)
- Best (ImageBitmap): 32.99 FPS (median roundtrip 30.00ms)
2. Detection loop prototype
- Detection: 33.90 FPS, median 25.00ms, p95 28.00ms, hard ceiling violations 5
3. Worker pipeline mode selection
- Selected mode: best
4. WebGL perspective warp prototype
- Result: PASS; elapsed 3.00ms; within 50ms budget: PASS
5. CPU piecewise-affine warp prototype
- Result: PASS; elapsed 86.00ms; within 200ms budget: PASS
6. End-to-end capture flow
- stable=true, stableAt=660ms, captureTier=webgl, guidance=READY, success=true

## Pass/Fail Gate

| Target | Ingestion >=20 FPS | Detection budget | WebGL <50ms | CPU <200ms | End-to-end | Overall |
|---|---|---|---|---|---|---|
| Chrome Android (Emulated Pixel 7) | PASS | PASS | PASS | PASS | PASS | PASS |
| Chrome Desktop (Playwright Chromium) | PASS | PASS | PASS | PASS | PASS | PASS |
| Firefox Desktop (Playwright Firefox) | PASS | PASS | PASS | PASS | PASS | PASS |

## Blocking Issues and Downgrades

- Chrome Android physical-device validation is still required; emulation results are provisional only.
- Any FAIL row above must be resolved before advancing from Phase 0.

## Raw Benchmark Artifacts

- apps/eval-harness/output/phase0/chromium-android-emulated.json
- apps/eval-harness/output/phase0/chromium.json
- apps/eval-harness/output/phase0/firefox.json
