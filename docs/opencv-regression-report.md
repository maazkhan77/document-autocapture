# OpenCV Regression Report

Generated: 2026-03-08T14:38:26.525Z

## Inputs

- Real clip path: /Users/mukesh.shelke/Documents/New project/datasets/real-clips
- Threshold profile source: /Users/mukesh.shelke/Documents/New project/apps/eval-harness/output/realclip/tuned-thresholds.json
- Source files: 3

## Dataset Totals

- Manifests: 6
- Frames: 178
- Real clip frames: 90
- Contour fixture frames: 88
- Document frames: 138
- Non-document frames: 40

## Metrics

| Segment | Lock (IoU>=0.85) | False Positive | Auto-capture <=2s | Median Stable | P10 FPS |
|---|---:|---:|---:|---:|---:|
| Overall | 92.03% | 0.00% | 100.00% | 429.0ms | 48.97 |
| Real clips | 100.00% | 0.00% | 100.00% | 775.5ms | 47.85 |
| Contour fixtures | 82.26% | 0.00% | 100.00% | 429.0ms | 57.14 |
| Non-document | 0.00% | 0.00% | 0.00% | 0.0ms | 50.15 |

## Gate Verdict

- overallLockPass: PASS
- overallFalsePositivePass: PASS
- overallAutoCaptureWithin2sPass: PASS
- contourLockPass: PASS
- contourFalsePositivePass: PASS
- contourAutoCapturePass: PASS
- noDocumentFalsePositivePass: PASS
- fpsPass: PASS
- overall: PASS

## Source Files

- /Users/mukesh.shelke/Documents/New project/datasets/real-clips/clutter-shadow-seq-02.json
- /Users/mukesh.shelke/Documents/New project/datasets/real-clips/controlled-lab-seq-01.json
- builtin:opencv-contour-fixtures
