#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORK_DIR="${DOC_CORNER_WORK_DIR:-/tmp/doccorner-v2-build}"
VENV_DIR="${DOC_CORNER_VENV_DIR:-$WORK_DIR/.venv}"
MODEL_DIR="$ROOT_DIR/packages/ml-tf-fallback/models/doc-corner-v2"
UPSTREAM_REF="${DOC_CORNER_UPSTREAM_REF:-main}"

mkdir -p "$WORK_DIR"

if [[ ! -d "$VENV_DIR" ]]; then
  python3.11 -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip >/dev/null

if [[ "$(uname -s)" == "Darwin" ]]; then
  python -m pip install tensorflow-macos==2.16.2 tensorflowjs==4.22.0 >/dev/null
else
  python -m pip install tensorflow-cpu==2.16.1 tensorflowjs==4.22.0 >/dev/null
fi

curl -sL "https://raw.githubusercontent.com/mapo80/DocCornerNet-CoordClass/${UPSTREAM_REF}/model.py" -o "$WORK_DIR/model.py"
curl -sL "https://raw.githubusercontent.com/mapo80/DocCornerNet-CoordClass/${UPSTREAM_REF}/checkpoints/mobilenetv2_224_best/config.json" -o "$WORK_DIR/config.json"
curl -sL "https://raw.githubusercontent.com/mapo80/DocCornerNet-CoordClass/${UPSTREAM_REF}/checkpoints/mobilenetv2_224_best/best_model.weights.h5" -o "$WORK_DIR/best_model.weights.h5"

export DOC_CORNER_WORK_DIR="$WORK_DIR"
python - <<'PY'
import json
import os
import shutil
import sys
from pathlib import Path

repo = Path(os.environ.get("DOC_CORNER_WORK_DIR", "/tmp/doccorner-v2-build"))
sys.path.insert(0, str(repo))
import model as m

with (repo / "config.json").open("r", encoding="utf-8") as f:
    cfg = json.load(f)

train = m.create_model(
    backbone=cfg.get("backbone", "mobilenetv2"),
    alpha=float(cfg.get("alpha", 0.35)),
    fpn_ch=int(cfg.get("fpn_ch", 32)),
    simcc_ch=int(cfg.get("simcc_ch", 96)),
    img_size=int(cfg.get("img_size", 224)),
    num_bins=int(cfg.get("num_bins", 224)),
    tau=float(cfg.get("tau", 1.0)),
    backbone_weights=None,
    backbone_minimalistic=bool(cfg.get("backbone_minimalistic", False)),
    backbone_include_preprocessing=bool(cfg.get("backbone_include_preprocessing", False)),
)
train.load_weights(str(repo / "best_model.weights.h5"))
inference = m.create_inference_model(train)

saved_model_dir = repo / "saved_model"
if saved_model_dir.exists():
    shutil.rmtree(saved_model_dir)
inference.export(str(saved_model_dir))
PY

rm -rf "$WORK_DIR/tfjs_graph"
mkdir -p "$WORK_DIR/tfjs_graph"
tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  --signature_name=serving_default \
  --saved_model_tags=serve \
  "$WORK_DIR/saved_model" \
  "$WORK_DIR/tfjs_graph"

mkdir -p "$MODEL_DIR"
cp "$WORK_DIR/tfjs_graph/model.json" "$MODEL_DIR/model.json"
cp "$WORK_DIR/tfjs_graph/"*.bin "$MODEL_DIR/"

python "$ROOT_DIR/scripts/ml/verify-doccornernet-output.py" --model-dir "$MODEL_DIR"

echo "doc-corner-v2 conversion complete: $MODEL_DIR"
