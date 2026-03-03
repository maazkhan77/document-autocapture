# Document Auto Capture Architecture

## Public Packages

1. `js-document-autocapture`
- Framework-agnostic scanner API
- Event-driven runtime (`frame`, `detection`, `guidance`, `capture`)
- ML-first + CV fallback orchestration

2. `react-document-autocapture`
- React hook and UI primitives:
  - `useDocumentAutoCapture`
  - `DocumentAutoCaptureCamera`
  - `CornerAdjustModal`

## Internal Workspace Packages (Not Published Directly)

- `@document-autocapture/core-engine`
- `@document-autocapture/runtime-web`
- `@document-autocapture/worker-runtime`
- `@document-autocapture/warp-cpu`
- `@document-autocapture/warp-webgl`
- `@document-autocapture/ml-tf-fallback`

## Runtime Flow

1. Camera frame ingestion
2. ML-first quad proposal (`doc-corner-v2` path)
3. CV/Hough fallback on ML miss/reject
4. Scoring + quality gates
5. Stability gate
6. Auto/manual capture
7. Warp ladder (CPU-first policy with strict validation)

## Quality and Safety

- strict warp validation to reject corrupted outputs
- raw fallback when warp quality is risky
- optional post-capture refinement path
- explicit fallback telemetry for debugging
