# OpenCV Regression Benchmarking

## Goal

Guard OpenCV contour detection behavior against regressions using:

- real clip manifests (`datasets/real-clips`)
- contour-failure fixtures (built-in in harness, plus optional external fixture path)

## Commands

```bash
pnpm --filter @docuscan/eval-harness build
pnpm --filter @docuscan/eval-harness opencv:regression
```

Optional external fixture directory:

```bash
DOCUSCAN_OPENCV_FIXTURE_PATH=/abs/path/to/opencv-fixtures \
pnpm --filter @docuscan/eval-harness opencv:regression
```

## Outputs

- Regression output JSON:
  - `apps/eval-harness/output/opencv-regression/latest.json`
- Markdown report:
  - `docs/opencv-regression-report.md`

## Gate criteria

The OpenCV regression suite currently enforces:

- Overall lock pass (IoU >= 0.85) >= 90%
- Overall false positive <= 2%
- Overall auto-capture within 2s >= 80%
- Contour fixture lock pass >= 82%
- Contour fixture false positive <= 3%
- Contour fixture auto-capture success >= 65%
- No-document false positive <= 1%
- P10 FPS >= 8

`verify:gates` now fails if these gates fail.

## CI lock

CI runs `pnpm perf:gates:strict`, which includes:

1. Phase0 benchmark/report
2. Bakeoff benchmark/report
3. Real-clip ingest + auto-tune
4. OpenCV regression suite
5. Strict gate verification with physical Android report required

To satisfy strict verification, provide:

- `apps/eval-harness/output/physical-android/latest.json`

or set `DOCUSCAN_PHYSICAL_ANDROID_REPORT` to your report path.
