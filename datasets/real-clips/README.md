# Real Clip Manifests

These manifests are clip-level annotations for benchmarking and threshold tuning.

## File shape

Each JSON file can be either:

1. A single clip manifest:

```json
{
  "datasetName": "realclip-controlled-v1",
  "clipId": "controlled-lab-seq-01",
  "width": 480,
  "height": 672,
  "source": "pixel7-chrome",
  "tags": ["well-lit", "plain-bg", "single-doc"],
  "frames": [
    {
      "id": "controlled-lab-seq-01-f000",
      "tsMs": 0,
      "hasDocument": false,
      "groundTruth": null,
      "cvCandidates": [],
      "mlCandidate": null,
      "quality": { "brightness": 128, "blur": 42, "glare": 0.03 },
      "detectionMs": 14.6
    }
  ]
}
```

2. A bundle with multiple clips:

```json
{
  "datasetName": "realclip-batch",
  "clips": [/* same clip objects as above */]
}
```

## Notes

- `groundTruth` should be populated for document-present frames.
- `cvCandidates` should be sorted by confidence when possible.
- `mlCandidate` is optional and used by hybrid fallback simulation.
- `quality` values are scalar signals from runtime logging:
  - `brightness`: average luma in `[0, 255]`
  - `blur`: Laplacian variance proxy
  - `glare`: ratio in `[0, 1]`
