# Changelog

## 1.0.4 — Stability Patch

### Bug Fixes

- **Worker timeout**: Increased worker initialization timeout from 480 ms to 1 500 ms, eliminating `worker failed to load` errors on slower devices.
- **React frame dispatch**: Throttled frame dispatch to ~20 fps, fixing `Cannot read properties of undefined (reading 'payload')` TypeError.
- **ML false positives**: Tightened confidence thresholds and added edge-support rejection gate to reduce auto-capture of non-document objects (e.g. picture frames).
- **COCO disagreement**: Changed COCO-SSD hard veto (0.85) to a soft penalty gate at 0.65, preventing over-aggressive rejection of valid documents.
- **Memory leak — model disposal**: Worker now disposes TensorFlow.js and COCO-SSD models on session cleanup before termination.
- **Memory leak — OffscreenCanvas**: Explicitly close OffscreenCanvas instances on session stop to release GPU memory.
- **iOS Safari**: Added module-worker fallback (try `{ type: 'module' }`, catch → classic worker) for Safari versions < 17.4.

### UX Improvements

- **CornerAdjustModal**: Redesigned corner handles with larger orange circles, white L-bracket arms, and a dark overlay outside the detected quad for clearer visual feedback.
- **Demo guidance banner**: Added a prominent floating banner in the camera view showing human-readable guidance messages (e.g. "Point camera at a document", "Hold steady…").
