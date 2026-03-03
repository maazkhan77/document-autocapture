# Real-Clip Benchmarking and Auto-Tuning

## Commands

```bash
pnpm --filter @docuscan/eval-harness build
pnpm --filter @docuscan/eval-harness realclip:ingest
pnpm --filter @docuscan/eval-harness realclip:tune
```

Or run the full pipeline:

```bash
pnpm realclip
```

## Inputs

- Default input directory: `datasets/real-clips`
- Supported formats:
  - single clip manifest per JSON file
  - bundle manifest (`datasetName + clips[]`)
- Optional external dataset adapters:
  - SmartDoc 2015 path via `DOCUSCAN_SMARTDOC_PATH=/abs/path/to/smartdoc/jsons`
  - MIDV path via `DOCUSCAN_MIDV_PATH=/abs/path/to/midv/jsons`

Example:

```bash
DOCUSCAN_SMARTDOC_PATH=/Users/me/data/smartdoc \
DOCUSCAN_MIDV_PATH=/Users/me/data/midv \
pnpm --filter @docuscan/eval-harness realclip:ingest
```

## Outputs

- Ingested dataset: `apps/eval-harness/output/realclip/ingested.json`
- Tuned thresholds: `apps/eval-harness/output/realclip/tuned-thresholds.json`
- Ingestion report: `docs/realclip-ingestion-report.md`
- Tuning report: `docs/realclip-autotune-report.md`

## Tuning strategy

- CV remains primary; ML is only considered under fallback policy.
- Coordinate-descent search explores threshold dimensions:
  - confidence, ambiguity, stability window, movement ratio
  - brightness/blur/glare gates
  - auto-capture stable-frame streak
  - ML fallback trigger/stride thresholds
- Objective prioritizes:
  - lock pass rate (`IoU >= 0.85`)
  - false positive suppression
  - capture success within 2s
  - stable capture behavior
