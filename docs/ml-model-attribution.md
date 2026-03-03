# ML Model Attribution

## Bundled model

- Model ID: `doc-corner-v2`
- Package path: `packages/ml-tf-fallback/models/doc-corner-v2`
- Runtime format: TFJS Graph Model (`model.json` + weight shard)
- Converted on: 2026-03-03

## Upstream source

- Repository: https://github.com/mapo80/DocCornerNet-CoordClass
- Commit: `d877dc382c4ec56299d2b2662b979581bae9c8cd`
- Checkpoint source path:
  - `checkpoints/mobilenetv2_224_best/best_model.weights.h5`
  - `checkpoints/mobilenetv2_224_best/config.json`
- License: MIT

## Model card summary

- Backbone: MobileNetV2 (alpha `0.35`)
- Input size: `224x224`
- Inference outputs:
  - `coords` (`[B, 8]` normalized corners)
  - `score_logit` (`[B, 1]` document presence logit)
- Intended use: document corner proposal for camera auto-capture.

## Conversion notes

- Training model reconstructed from upstream `model.py` + config.
- Weights loaded from `.weights.h5` checkpoint.
- Inference model exported as TensorFlow SavedModel (`serve` signature).
- SavedModel converted to TFJS GraphModel with `tensorflowjs_converter`.

## License text (MIT)

Copyright (c) mapo80

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
