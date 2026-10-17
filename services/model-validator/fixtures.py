"""Builds small deterministic ONNX models and a benchmark for tests and demos.

Usage: python fixtures.py OUT_DIR
Creates OUT_DIR/model/red_blue.onnx, OUT_DIR/model_bad/custom_op.onnx and OUT_DIR/benchmark/.
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from PIL import Image


def red_blue_model(path: Path, accuracy_bias: float = 0.0):
    """8x8 RGB classifier: class 0 = 'red', class 1 = 'blue' (mean channel intensity)."""
    w = np.zeros((192, 2), dtype=np.float32)
    w[0:64, 0] = 1.0 / 64  # red channel -> class 0
    w[128:192, 1] = 1.0 / 64  # blue channel -> class 1
    b = np.array([accuracy_bias, 0.0], dtype=np.float32)
    nodes = [
        helper.make_node("Flatten", ["input"], ["flat"], axis=1),
        helper.make_node("Gemm", ["flat", "W", "B"], ["logits"]),
        helper.make_node("Softmax", ["logits"], ["probs"], axis=1),
    ]
    graph = helper.make_graph(
        nodes, "red_blue",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, 8, 8])],
        [helper.make_tensor_value_info("probs", TensorProto.FLOAT, [1, 2])],
        [numpy_helper.from_array(w, "W"), numpy_helper.from_array(b, "B")],
    )
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    m.ir_version = 9
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(path))


def custom_op_model(path: Path):
    node = helper.make_node("EvilOp", ["input"], ["out"], domain="com.attacker")
    graph = helper.make_graph(
        [node], "evil",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1])],
        [helper.make_tensor_value_info("out", TensorProto.FLOAT, [1])],
    )
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17), helper.make_opsetid("com.attacker", 1)])
    m.ir_version = 9
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(path))


def benchmark(dir: Path, n: int = 20):
    (dir / "images").mkdir(parents=True, exist_ok=True)
    rows = []
    rng = np.random.default_rng(7)
    for i in range(n):
        label = "red" if i % 2 == 0 else "blue"
        base = np.array([200, 30, 40] if label == "red" else [30, 40, 200], dtype=np.float32)
        px = np.clip(base + rng.normal(0, 25, (16, 16, 3)), 0, 255).astype(np.uint8)
        name = f"{i:03d}.png"
        Image.fromarray(px).save(dir / "images" / name)
        rows.append(f"{name},{label}")
    (dir / "labels.csv").write_text("filename,label\n" + "\n".join(rows) + "\n")
    (dir / "classes.txt").write_text("red\nblue\n")
    (dir / "benchmark.json").write_text(json.dumps({
        "id": "eb-redblue-cls", "version": 1, "task": "image_classification",
        "size": [8, 8], "scale": 255.0, "mean": [0, 0, 0], "std": [1, 1, 1], "layout": "NCHW",
        "license": "CC0-1.0", "methodology": "Synthetic colour-dominance images; argmax top-1.",
    }))


if __name__ == "__main__":
    out = Path(sys.argv[1])
    red_blue_model(out / "model" / "red_blue.onnx")
    custom_op_model(out / "model_bad" / "custom_op.onnx")
    benchmark(out / "benchmark")
    print(out)
