# Docuscan Bakeoff Report

Generated: 2026-03-01T17:29:12.123Z
Artifacts analyzed: 9

## Candidate Ranking

| Rank | Candidate | Mode | Score | Overall Gate Pass | Lock (IoU>=0.85) | False Positive | Auto-capture <=2s | Median Stable | Detection FPS | ML Frame Share | Fallback Entries |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | candidate-b (Hybrid Corner Fallback) | hybrid | 98.54 | 100.0% | 98.1% | 0.0% | 100.0% | 759.00ms | 39.56 | 0.4% | 1.00 |
| 2 | candidate-a (CV-only Hardened) | cv | 97.26 | 100.0% | 98.0% | 0.0% | 100.0% | 924.00ms | 39.19 | 0.0% | 0.00 |
| 3 | candidate-c (Hybrid Strict Quality) | hybrid | 97.22 | 100.0% | 99.3% | 0.0% | 100.0% | 990.00ms | 39.34 | 0.4% | 1.00 |

## Regression Gates

- CV parity gate: **PASS**
- Hybrid improvement gate (lock non-regression + meaningful UX gain): **PASS**
- CV baseline: lock=98.0%, fp=0.0%, stable=924.00ms
- Best hybrid: lock=98.1%, fp=0.0%, stable=759.00ms
- Hybrid deltas vs CV: lock=0.2%, stable=165.00ms, auto<=2s=0.0%

## Winner

Selected: **candidate-b (Hybrid Corner Fallback)** with score **98.54** and overall gate pass 100.0%.
Rollout verdict: **PROMOTE**

## Per-Run Matrix

| Artifact | Project | Candidate | Selected Mode | Ingestion FPS | Detection FPS | IoU Pass Rate | False Positive | Stable (ms) | End-to-End | ML Share | Fallback Entries | Overall |
|---|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| chromium-android-emulated-candidate-a.json | chromium-android-emulated | candidate-a | standard | 41.60 | 42.18 | 98.9% | 0.0% | 924.00ms | PASS (cpu) | 0.0% | 0.00 | PASS |
| chromium-android-emulated-candidate-b.json | chromium-android-emulated | candidate-b | standard | 41.50 | 42.25 | 98.3% | 0.0% | 759.00ms | PASS (cpu) | 0.4% | 1.00 | PASS |
| chromium-android-emulated-candidate-c.json | chromium-android-emulated | candidate-c | standard | 41.39 | 42.35 | 99.4% | 0.0% | 990.00ms | PASS (cpu) | 0.4% | 1.00 | PASS |
| chromium-candidate-a.json | chromium | candidate-a | standard | 41.97 | 41.94 | 97.8% | 0.0% | 957.00ms | PASS (cpu) | 0.0% | 0.00 | PASS |
| chromium-candidate-b.json | chromium | candidate-b | standard | 42.17 | 42.82 | 97.8% | 0.0% | 759.00ms | PASS (cpu) | 0.4% | 1.00 | PASS |
| chromium-candidate-c.json | chromium | candidate-c | standard | 41.54 | 42.15 | 98.9% | 0.0% | 990.00ms | PASS (cpu) | 0.4% | 1.00 | PASS |
| firefox-candidate-a.json | firefox | candidate-a | best | 33.59 | 33.44 | 97.2% | 0.0% | 792.00ms | PASS (webgl) | 0.0% | 0.00 | PASS |
| firefox-candidate-b.json | firefox | candidate-b | best | 33.69 | 33.61 | 98.3% | 0.0% | 627.00ms | PASS (webgl) | 0.4% | 1.00 | PASS |
| firefox-candidate-c.json | firefox | candidate-c | best | 33.63 | 33.53 | 99.4% | 0.0% | 825.00ms | PASS (webgl) | 0.4% | 1.00 | PASS |

## Notes

- This report uses synthetic scene benchmarks and should be followed by physical Android validation.

## Raw Artifacts

- apps/eval-harness/output/bakeoff/chromium-android-emulated-candidate-a.json
- apps/eval-harness/output/bakeoff/chromium-android-emulated-candidate-b.json
- apps/eval-harness/output/bakeoff/chromium-android-emulated-candidate-c.json
- apps/eval-harness/output/bakeoff/chromium-candidate-a.json
- apps/eval-harness/output/bakeoff/chromium-candidate-b.json
- apps/eval-harness/output/bakeoff/chromium-candidate-c.json
- apps/eval-harness/output/bakeoff/firefox-candidate-a.json
- apps/eval-harness/output/bakeoff/firefox-candidate-b.json
- apps/eval-harness/output/bakeoff/firefox-candidate-c.json
