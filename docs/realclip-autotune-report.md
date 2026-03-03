# Real Clip Threshold Auto-Tune Report

Generated: 2026-03-01T17:29:14.861Z
Input dataset: /Users/mukesh.shelke/Documents/New project/apps/eval-harness/output/realclip/ingested.json
Search evaluations: 239
Coordinate passes: 1

## Metrics (Baseline vs Tuned)

| Metric | Baseline | Tuned | Delta |
|---|---|---|---|
| Lock pass rate (IoU >= 0.85) | 98.25% | 98.25% | +0.00pp |
| False positive rate | 0.00% | 0.00% | +0.00pp |
| Auto-capture success | 100.00% | 100.00% | +0.00pp |
| Auto-capture within 2s | 100.00% | 100.00% | +0.00pp |
| Median time-to-stable | 693.0ms | 693.0ms | +0.00ms |
| P10 FPS | 46.26 FPS | 46.26 FPS | +0.00 |
| Objective score | 99.212 | 99.212 | +0.00 |

## Recommended Config Overrides

```json
{
  "confidenceThreshold": 0.42,
  "ambiguityScoreMargin": 0.04,
  "minStableConfidence": 0.36,
  "stabilityWindowMs": 320,
  "autoCaptureConsecutiveStableFrames": 2,
  "autoCaptureCooldownMs": 1400,
  "movementThresholdRatio": 0.015,
  "emaAlpha": 0.25,
  "minAreaFraction": 0.08,
  "maxAreaFraction": 0.88,
  "minAspectRatio": 0.6,
  "maxAspectRatio": 1.9,
  "edgeTouchLimit": 0.3,
  "brightnessMin": 45,
  "brightnessMax": 215,
  "blurVarianceMin": 24,
  "glareRatioMax": 0.12
}
```

## Acceptance

- Lock pass >=95%: PASS
- False positive <=2%: PASS
- Auto-capture success >=85%: PASS
- Auto-capture within 2s >=85%: PASS

## Detector Source Stats (Tuned)

- cv: 270
- fallbackActiveFrames: 0
