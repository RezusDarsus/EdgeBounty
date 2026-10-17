import json
import struct
import tempfile
import unittest
from pathlib import Path

import fixtures
import validate_model


class ModelValidatorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        fixtures.red_blue_model(self.d / "m" / "model.onnx")
        fixtures.custom_op_model(self.d / "bad" / "evil.onnx")
        fixtures.benchmark(self.d / "bench")

    def tearDown(self):
        self.tmp.cleanup()

    def run_v(self, inp, *extra):
        out = self.d / "out.json"
        validate_model.main(["--input", str(inp), "--output", str(out), *extra])
        return json.loads(out.read_text())

    def test_benchmark_metrics_are_reproducible(self):
        a = self.run_v(self.d / "m", "--benchmark", str(self.d / "bench"))
        b = self.run_v(self.d / "m", "--benchmark", str(self.d / "bench"))
        bm = a["metrics"]["benchmark"]
        self.assertEqual(bm["samples"], 20)
        self.assertEqual(bm["metrics"]["accuracy"], 1.0)
        self.assertEqual(bm["metrics"], b["metrics"]["benchmark"]["metrics"])
        self.assertEqual(bm["confusionMatrix"], [[10, 0], [0, 10]])
        self.assertEqual(a["metrics"]["disallowedOperators"], [])
        self.assertEqual(a["metrics"]["parameters"], 192 * 2 + 2)

    def test_custom_operator_never_executed(self):
        doc = self.run_v(self.d / "bad", "--benchmark", str(self.d / "bench"))
        self.assertIn("EvilOp", doc["metrics"]["disallowedOperators"])
        self.assertIsNone(doc["metrics"]["benchmark"])
        self.assertIn("custom_operator_domain", {f["code"] for f in doc["findings"]})

    def test_budget_truncation(self):
        doc = self.run_v(self.d / "m", "--benchmark", str(self.d / "bench"), "--max-items", "5")
        self.assertTrue(doc["truncated"])
        self.assertEqual(doc["metrics"]["benchmark"]["samples"], 5)

    def test_safetensors_header_only(self):
        header = json.dumps({"w": {"dtype": "F32", "shape": [3, 4], "data_offsets": [0, 48]}}).encode()
        p = self.d / "st" / "m.safetensors"
        p.parent.mkdir()
        p.write_bytes(struct.pack("<Q", len(header)) + header + b"\0" * 48)
        doc = self.run_v(p.parent)
        self.assertEqual(doc["metrics"]["format"], "safetensors")
        self.assertEqual(doc["metrics"]["parameters"], 12)
        self.assertIsNone(doc["metrics"]["benchmark"])


if __name__ == "__main__":
    unittest.main()
