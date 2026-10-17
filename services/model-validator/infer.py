#!/usr/bin/env python3
"""Single-input inference trial for model listings (controlled preview).

The buyer never receives weights: they send one input, the sandbox runs the ONNX model and
returns only the top-k scores. Same static safety checks as the validator apply first.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

# the sandbox runs `python -I` (no implicit sys.path entries); add only our own code directory
sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_model  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--spec", required=True, help="JSON: size, scale, mean, std, layout, classes")
    ap.add_argument("--output", required=True)
    ap.add_argument("--top-k", type=int, default=3)
    a = ap.parse_args(argv)
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    models = [p for p in Path(a.model_dir).rglob("*.onnx")]
    if len(models) != 1:
        raise SystemExit("expected one .onnx model")
    findings = []
    _, safe = validate_model.inspect_onnx(models[0], findings)
    if safe is None:
        Path(a.output).write_text(json.dumps({"error": "model failed static safety checks", "findings": findings}))
        return 0
    from PIL import Image

    h, w = spec.get("size", [224, 224])
    with Image.open(a.input) as im:
        x = np.asarray(im.convert("RGB").resize((w, h)), dtype=np.float32) / float(spec.get("scale", 255.0))
    x = (x - np.array(spec.get("mean", [0, 0, 0]), dtype=np.float32)) / np.array(spec.get("std", [1, 1, 1]), dtype=np.float32)
    x = x.transpose(2, 0, 1)[None] if spec.get("layout", "NCHW") == "NCHW" else x[None]
    sess = validate_model.session(models[0], 1)
    out = np.asarray(sess.run(None, {sess.get_inputs()[0].name: x.astype(np.float32)})[0]).reshape(-1)
    classes = spec.get("classes") or [str(i) for i in range(out.size)]
    order = np.argsort(-out)[: a.top_k]
    Path(a.output).write_text(json.dumps({"top": [{"label": classes[i] if i < len(classes) else str(i), "score": round(float(out[i]), 6)} for i in order]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
