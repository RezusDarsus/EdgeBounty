"""Structured-data benchmarks (Phase 5): tabular classification and regression ONNX models."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

import validate_model


def linear_model(path: Path, w, b, out_dim):
    w = np.array(w, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    g = helper.make_graph(
        [helper.make_node("Gemm", ["x", "W", "B"], ["y"])],
        "lin",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, w.shape[0]])],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, out_dim])],
        [numpy_helper.from_array(w, "W"), numpy_helper.from_array(b, "B")],
    )
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)])
    m.ir_version = 9
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(path))


class TabularBenchmarkTest(unittest.TestCase):
    def test_regression_rmse_and_classification_f1(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            # y = 2*a + 3*b + 1 exactly
            linear_model(d / "reg" / "m.onnx", [[2.0], [3.0]], [1.0], 1)
            (d / "bench_r").mkdir()
            rows = [(a, b, 2 * a + 3 * b + 1) for a in range(5) for b in range(4)]
            (d / "bench_r" / "data.csv").write_text("a,b,target\n" + "\n".join(f"{a},{b},{y}" for a, b, y in rows))
            (d / "bench_r" / "benchmark.json").write_text(json.dumps({"id": "tab-reg", "version": 1, "task": "tabular_regression", "features": ["a", "b"]}))
            out = d / "o.json"
            validate_model.main(["--input", str(d / "reg"), "--output", str(out), "--benchmark", str(d / "bench_r")])
            bm = json.loads(out.read_text())["metrics"]["benchmark"]
            self.assertEqual(bm["samples"], 20)
            self.assertLess(bm["metrics"]["rmse"], 1e-4)

            # classify by sign of (a - b)
            linear_model(d / "cls" / "m.onnx", [[1.0, -1.0], [-1.0, 1.0]], [0.0, 0.0], 2)
            (d / "bench_c").mkdir()
            rows = [(a, b, 0 if a > b else 1) for a in range(6) for b in range(6) if a != b]
            (d / "bench_c" / "data.csv").write_text("a,b,target\n" + "\n".join(f"{a},{b},{y}" for a, b, y in rows))
            (d / "bench_c" / "benchmark.json").write_text(json.dumps({"id": "tab-cls", "version": 1, "task": "tabular_classification", "features": ["a", "b"]}))
            validate_model.main(["--input", str(d / "cls"), "--output", str(out), "--benchmark", str(d / "bench_c")])
            bm = json.loads(out.read_text())["metrics"]["benchmark"]
            self.assertEqual(bm["metrics"]["accuracy"], 1.0)
            self.assertEqual(bm["metrics"]["f1_macro"], 1.0)


if __name__ == "__main__":
    unittest.main()
