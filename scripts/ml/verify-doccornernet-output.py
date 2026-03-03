#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path


def read_json(path: Path):
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def main() -> int:
    parser = argparse.ArgumentParser(description='Verify bundled doc-corner-v2 TFJS artifact contract and size budget.')
    parser.add_argument('--model-dir', required=True, help='Directory containing artifact.json and tfjs model files')
    parser.add_argument('--max-bytes', type=int, default=2_621_440, help='Maximum allowed total bytes for model.json + shards')
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    artifact_path = model_dir / 'artifact.json'
    model_json_path = model_dir / 'model.json'

    if not artifact_path.exists():
        raise FileNotFoundError(f'Missing artifact.json: {artifact_path}')
    if not model_json_path.exists():
        raise FileNotFoundError(f'Missing model.json: {model_json_path}')

    artifact = read_json(artifact_path)
    model_json = read_json(model_json_path)

    shard_paths = []
    for group in model_json.get('weightsManifest', []):
        for shard_rel in group.get('paths', []):
            shard = model_dir / shard_rel
            if not shard.exists():
                raise FileNotFoundError(f'Missing weight shard: {shard}')
            shard_paths.append(shard)

    signature = model_json.get('signature', {})
    outputs = signature.get('outputs', {})
    output_shapes = {}
    for name, meta in outputs.items():
        dims = [int(d.get('size', '-1')) for d in meta.get('tensorShape', {}).get('dim', [])]
        output_shapes[name] = dims

    has_coords = any(shape and shape[-1] == 8 for shape in output_shapes.values())
    has_score = any(shape and shape[-1] == 1 for shape in output_shapes.values())
    if not has_coords or not has_score:
        raise RuntimeError(f'Expected outputs with last dims 8 and 1, got: {output_shapes}')

    model_bytes = os.path.getsize(model_json_path)
    shard_bytes = sum(os.path.getsize(p) for p in shard_paths)
    total_bytes = model_bytes + shard_bytes

    if artifact.get('outputFormat') != 'coords_score_logit':
        raise RuntimeError(f"artifact.outputFormat must be 'coords_score_logit', got {artifact.get('outputFormat')}")
    if artifact.get('scoreMode') not in ('logit', 'probability', 'fixed'):
        raise RuntimeError(f"artifact.scoreMode invalid: {artifact.get('scoreMode')}")

    if total_bytes > args.max_bytes:
        raise RuntimeError(
            f'Model payload too large: {total_bytes} bytes > {args.max_bytes} bytes budget'
        )

    print(
        json.dumps(
            {
                'modelDir': str(model_dir),
                'artifactId': artifact.get('id'),
                'outputShapes': output_shapes,
                'modelBytes': model_bytes,
                'shardBytes': shard_bytes,
                'totalBytes': total_bytes,
                'maxBytes': args.max_bytes,
                'status': 'ok',
            },
            indent=2,
        )
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
