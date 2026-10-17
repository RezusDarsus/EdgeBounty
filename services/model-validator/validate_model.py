#!/usr/bin/env python3
"""EdgeBounty model validator.

Never executes user-supplied Python. Supported formats:
* ONNX - parsed with `onnx`, checked against an operator allow-list (default domain only, no
  custom ops, no external data), then executed with ONNX Runtime (CPU, bounded threads)
  inside the sandbox against a versioned benchmark.
* SafeTensors - header-only inspection (tensor names/dtypes/shapes, parameter count).
  Inference requires a pre-approved architecture loader and is reported as untested.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import struct
import sys
import time
from pathlib import Path

VERSION = "1.0.0"
MAX_MODEL_BYTES = 4 * 1024**3

# Standard ONNX operators accepted for execution. Anything else (custom domains, control
# flow with subgraphs, string/IO-ish ops) is rejected.
ALLOWED_OPS = {
    "Abs", "Add", "And", "ArgMax", "ArgMin", "AveragePool", "BatchNormalization", "Cast", "Ceil", "Clip",
    "Concat", "Constant", "ConstantOfShape", "Conv", "ConvTranspose", "Cos", "CumSum", "DepthToSpace",
    "Div", "Dropout", "Einsum", "Elu", "Equal", "Erf", "Exp", "Expand", "Flatten", "Floor", "Gather",
    "GatherElements", "GatherND", "Gelu", "Gemm", "GlobalAveragePool", "GlobalMaxPool", "Greater",
    "GreaterOrEqual", "GroupNormalization", "HardSigmoid", "HardSwish", "Identity", "InstanceNormalization",
    "LayerNormalization", "LeakyRelu", "Less", "LessOrEqual", "Log", "LogSoftmax", "LRN", "MatMul", "Max",
    "MaxPool", "Mean", "Min", "Mod", "Mul", "Neg", "NonZero", "Not", "Or", "Pad", "Pow", "PRelu",
    "Range", "Reciprocal", "ReduceL2", "ReduceMax", "ReduceMean", "ReduceMin", "ReduceProd", "ReduceSum",
    "Relu", "Reshape", "Resize", "Round", "ScatterND", "Selu", "Shape", "Sigmoid", "Sign", "Sin", "Size",
    "Slice", "Softmax", "Softplus", "Softsign", "SpaceToDepth", "Split", "Sqrt", "Squeeze", "Sub", "Sum",
    "Tanh", "Tile", "TopK", "Transpose", "Trilu", "Unsqueeze", "Upsample", "Where", "Xor",
}


def finding(sev, code, msg, files=None):
    return {"severity": sev, "code": code, "message": msg, "files": files or []}


def dims(t):
    out = []
    for d in t.type.tensor_type.shape.dim:
        out.append(d.dim_value if d.HasField("dim_value") else (d.dim_param or None))
    return out


def inspect_onnx(path: Path, findings: list) -> tuple[dict, object | None]:
    import onnx
    from onnx import TensorProto

    model = onnx.load(str(path), load_external_data=False)
    ext = [i.name for i in model.graph.initializer if i.data_location == TensorProto.EXTERNAL]
    if ext:
        findings.append(finding("confirmed", "external_data", "model references external tensor files; not supported", ext[:20]))
    try:
        onnx.checker.check_model(model)
    except Exception as e:  # noqa: BLE001
        findings.append(finding("confirmed", "invalid_onnx", f"onnx checker: {str(e)[:300]}"))
    ops = sorted({n.op_type for n in model.graph.node})
    domains = sorted({n.domain for n in model.graph.node if n.domain not in ("", "ai.onnx")})
    disallowed = sorted({n.op_type for n in model.graph.node if n.domain not in ("", "ai.onnx") or n.op_type not in ALLOWED_OPS})
    if domains:
        findings.append(finding("confirmed", "custom_operator_domain", f"custom operator domains are not allowed: {', '.join(domains)}"))
    if disallowed:
        findings.append(finding("confirmed", "disallowed_operators", f"operators outside the allow-list: {', '.join(disallowed)}"))
    opset = max((o.version for o in model.opset_import if o.domain in ("", "ai.onnx")), default=None)
    params = 0
    for init in model.graph.initializer:
        params += math.prod(init.dims) if init.dims else 1
    init_names = {i.name for i in model.graph.initializer}
    elem = {v: k for k, v in TensorProto.DataType.items()}
    meta = {
        "format": "onnx",
        "opset": opset,
        "operators": ops,
        "disallowedOperators": disallowed,
        "parameters": params,
        "inputs": [{"name": i.name, "shape": dims(i), "dtype": elem.get(i.type.tensor_type.elem_type, "?").lower()} for i in model.graph.input if i.name not in init_names],
        "outputs": [{"name": o.name, "shape": dims(o), "dtype": elem.get(o.type.tensor_type.elem_type, "?").lower()} for o in model.graph.output],
        "benchmark": None,
    }
    safe = not ext and not disallowed and not domains
    return meta, (model if safe else None)


def inspect_safetensors(path: Path, findings: list) -> dict:
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        if n > 100 * 1024 * 1024:
            raise ValueError("safetensors header too large")
        header = json.loads(f.read(n))
    params = 0
    tensors = []
    for name, t in header.items():
        if name == "__metadata__":
            continue
        params += math.prod(t["shape"]) if t["shape"] else 1
        tensors.append({"name": name, "shape": t["shape"], "dtype": t["dtype"].lower()})
    findings.append(finding("suspected", "inference_not_run", "SafeTensors weights were inspected (header only); inference requires an approved architecture loader"))
    return {"format": "safetensors", "opset": None, "operators": [], "disallowedOperators": [], "parameters": params, "inputs": tensors[:50], "outputs": [], "benchmark": None}


def session(model_path: Path, threads: int):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    return ort.InferenceSession(str(model_path), sess_options=so, providers=["CPUExecutionProvider"])


def percentile(xs, p):
    xs = sorted(xs)
    if not xs:
        return 0.0
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def classification_metrics(y_true, y_pred, n_classes):
    cm = [[0] * n_classes for _ in range(n_classes)]
    for t, p in zip(y_true, y_pred):
        cm[t][p] += 1
    acc = sum(cm[i][i] for i in range(n_classes)) / max(len(y_true), 1)
    precs, recs, f1s = [], [], []
    for c in range(n_classes):
        tp = cm[c][c]
        fp = sum(cm[r][c] for r in range(n_classes)) - tp
        fn = sum(cm[c]) - tp
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        precs.append(p)
        recs.append(r)
        f1s.append(2 * p * r / (p + r) if p + r else 0.0)
    return {"accuracy": acc, "precision_macro": sum(precs) / n_classes, "recall_macro": sum(recs) / n_classes, "f1_macro": sum(f1s) / n_classes}, cm


def run_image_classification(sess, bench: Path, spec: dict, budget):
    import numpy as np
    from PIL import Image

    classes = [l.strip() for l in (bench / "classes.txt").read_text(encoding="utf-8").splitlines() if l.strip()]
    with open(bench / "labels.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    h, w = spec.get("size", [224, 224])
    mean = np.array(spec.get("mean", [0.0, 0.0, 0.0]), dtype=np.float32)
    std = np.array(spec.get("std", [1.0, 1.0, 1.0]), dtype=np.float32)
    inp = sess.get_inputs()[0].name
    y_true, y_pred, lat = [], [], []
    for row in rows:
        if not budget():
            break
        with Image.open(bench / "images" / row["filename"]) as im:
            x = np.asarray(im.convert("RGB").resize((w, h)), dtype=np.float32) / float(spec.get("scale", 255.0))
        x = (x - mean) / std
        x = x.transpose(2, 0, 1)[None] if spec.get("layout", "NCHW") == "NCHW" else x[None]
        t = time.perf_counter()
        out = sess.run(None, {inp: x.astype(np.float32)})[0]
        lat.append((time.perf_counter() - t) * 1000)
        y_pred.append(int(np.argmax(out.reshape(-1))))
        y_true.append(classes.index(row["label"]))
    metrics, cm = classification_metrics(y_true, y_pred, len(classes))
    return metrics, cm, lat, len(y_true)


def run_tabular(sess, bench: Path, spec: dict, budget, task: str):
    import numpy as np

    with open(bench / "data.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    feats = spec["features"]
    inp = sess.get_inputs()[0].name
    y_true, y_pred, lat = [], [], []
    for row in rows:
        if not budget():
            break
        x = np.array([[float(row[f]) for f in feats]], dtype=np.float32)
        t = time.perf_counter()
        out = sess.run(None, {inp: x})[0]
        lat.append((time.perf_counter() - t) * 1000)
        if task == "tabular_regression":
            y_pred.append(float(np.asarray(out).reshape(-1)[0]))
            y_true.append(float(row["target"]))
        else:
            y_pred.append(int(np.argmax(np.asarray(out).reshape(-1))) if np.asarray(out).size > 1 else int(np.asarray(out).reshape(-1)[0]))
            y_true.append(int(row["target"]))
    if task == "tabular_regression":
        rmse = math.sqrt(sum((a - b) ** 2 for a, b in zip(y_true, y_pred)) / max(len(y_true), 1))
        return {"rmse": rmse}, None, lat, len(y_true)
    n = max(max(y_true, default=0), max(y_pred, default=0)) + 1
    m, cm = classification_metrics(y_true, y_pred, n)
    return m, cm, lat, len(y_true)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--benchmark")
    ap.add_argument("--max-items", type=int, default=100_000)
    ap.add_argument("--max-seconds", type=float, default=600)
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args(argv)
    started = time.monotonic()
    findings, limitations = [], []
    root = Path(args.input)
    models = [p for p in root.rglob("*") if p.suffix.lower() in (".onnx", ".safetensors")]
    if len(models) != 1:
        raise SystemExit(f"expected exactly one .onnx or .safetensors file, found {len(models)}")
    mp = models[0]
    if mp.stat().st_size > MAX_MODEL_BYTES:
        raise SystemExit("model exceeds maximum size")
    tools = [{"name": "edgebounty-model-validator", "version": VERSION}, {"name": "python", "version": sys.version.split()[0]}]
    deadline = time.monotonic() + args.max_seconds
    count = {"n": 0}
    truncated = {"v": False}

    def budget():
        if count["n"] >= args.max_items or time.monotonic() > deadline:
            truncated["v"] = True
            return False
        count["n"] += 1
        return True

    if mp.suffix.lower() == ".safetensors":
        meta = inspect_safetensors(mp, findings)
        limitations.append("SafeTensors inference requires a pre-approved architecture loader; performance is untested.")
    else:
        import onnx
        import onnxruntime as ort

        tools += [{"name": "onnx", "version": onnx.__version__}, {"name": "onnxruntime", "version": ort.__version__}]
        meta, safe = inspect_onnx(mp, findings)
        if safe is None:
            limitations.append("Model failed static safety checks and was not executed.")
        elif args.benchmark:
            bench = Path(args.benchmark)
            spec = json.loads((bench / "benchmark.json").read_text())
            sess = session(mp, args.threads)
            task = spec["task"]
            if task == "image_classification":
                metrics, cm, lat, n = run_image_classification(sess, bench, spec, budget)
            elif task in ("tabular_classification", "tabular_regression"):
                metrics, cm, lat, n = run_tabular(sess, bench, spec, budget, task)
            else:
                metrics, cm, lat, n = {}, None, [], 0
                limitations.append(f"benchmark task {task} is not supported by this validator version")
            meta["benchmark"] = {
                "id": spec["id"],
                "version": int(spec["version"]),
                "samples": n,
                "metrics": metrics,
                "confusionMatrix": cm,
                "latencyMsP50": round(percentile(lat, 0.5), 3),
                "latencyMsP95": round(percentile(lat, 0.95), 3),
                "hardware": f"cpu x{args.threads} threads (sandbox)",
            }
            limitations.append(f"Metrics are specific to benchmark {spec['id']} v{spec['version']}; they do not guarantee general model quality.")
        else:
            limitations.append("No benchmark supplied; only static inspection was performed.")
    if truncated["v"]:
        limitations.append(f"Benchmark stopped at the job budget after {count['n']} samples.")
    Path(args.output).write_text(json.dumps({
        "metrics": meta, "findings": findings, "limitations": limitations, "tools": tools,
        "truncated": truncated["v"], "elapsedMs": int((time.monotonic() - started) * 1000),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
