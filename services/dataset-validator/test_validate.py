import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

import validate


def make_img(path: Path, seed: int, size=(64, 64), shift=0):
    im = Image.new("RGB", size, (seed * 37 % 256, seed * 91 % 256, seed * 53 % 256))
    d = ImageDraw.Draw(im)
    d.rectangle([5 + shift + seed % 20, 5, 30 + seed % 20, 40 - seed % 10], fill=(255 - seed % 256, 10, 200))
    d.ellipse([20, 20 + seed % 15, 60, 60], fill=(seed % 256, 255, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)


def run(root: Path, *extra):
    out = root.parent / "out.json"
    prev = root.parent / "previews"
    validate.main(["--input", str(root), "--output", str(out), "--previews", str(prev), *extra])
    return json.loads(out.read_text()), prev


class DatasetValidatorTest(unittest.TestCase):
    def test_archive_input_is_preserved_and_expansion_respects_remaining_budget(self):
        with zipfile.ZipFile(self.root / "dataset.zip", "w") as archive:
            archive.writestr("data.csv", "category,value\nalpha,1\nbeta,2\n")
        before = (self.root / "dataset.zip").read_bytes()
        doc, _ = run(self.root, "--level", "L2")
        self.assertEqual((self.root / "dataset.zip").read_bytes(), before)
        self.assertEqual(doc["metrics"]["rows"], 2)
        findings = []
        self.assertFalse(validate.safe_extract(self.root / "dataset.zip", self.root.parent / "unpack", findings, remaining_bytes=1))
        self.assertEqual(findings[0]["code"], "archive_decompression_bomb")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "data"
        self.root.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_corrupt_duplicates_resolution_and_previews(self):
        for i in range(10):
            make_img(self.root / f"cars/{i}.png", i, size=(700, 700))
        for i in range(10, 20):
            make_img(self.root / f"bikes/{i}.png", i, size=(700, 700))
        (self.root / "cars/dup.png").write_bytes((self.root / "cars/1.png").read_bytes())
        (self.root / "cars/broken.png").write_bytes(b"\x89PNG\r\n\x1a\nnot really")
        make_img(self.root / "bikes/small.png", 3, size=(32, 32))
        doc, prev = run(self.root, "--level", "L2", "--min-width", "640", "--min-height", "640")
        m = doc["metrics"]
        self.assertEqual(m["dataFiles"], 23)
        self.assertEqual(m["corruptedFiles"], 1)
        self.assertEqual(m["readableFiles"], 22)
        self.assertEqual(m["exactDuplicates"], 1)
        self.assertEqual(m["belowResolution"], 1)
        self.assertEqual(m["labels"], {"cars": 11, "bikes": 11})
        codes = {f["code"] for f in doc["findings"]}
        self.assertTrue({"corrupted_images", "exact_duplicates", "below_min_resolution"} <= codes)
        self.assertTrue(doc["previews"])
        with Image.open(prev / doc["previews"][0]["file"]) as p:
            self.assertLessEqual(max(p.size), 256)

    def test_near_duplicates_detected_at_l2_only(self):
        make_img(self.root / "a.png", 5)
        im = Image.open(self.root / "a.png").convert("RGB")
        im.resize((63, 63)).resize((64, 64)).save(self.root / "b.jpg", quality=90)
        for i in range(20, 26):
            make_img(self.root / f"x{i}.png", i * 7)
        doc, _ = run(self.root, "--level", "L2")
        self.assertGreaterEqual(doc["metrics"]["nearDuplicates"], 1)
        doc1, _ = run(self.root, "--level", "L1")
        self.assertIsNone(doc1["metrics"]["nearDuplicates"])

    def test_zip_bomb_and_traversal_rejected(self):
        with zipfile.ZipFile(self.root / "bomb.zip", "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("zeros.bin", b"\0" * (50 * 1024 * 1024))
        with zipfile.ZipFile(self.root / "evil.zip", "w") as z:
            z.writestr("../../escape.txt", "x")
        doc, _ = run(self.root)
        codes = {f["code"] for f in doc["findings"]}
        self.assertIn("archive_decompression_bomb", codes)
        self.assertIn("archive_unsafe_path", codes)
        self.assertFalse((Path(self.tmp.name) / "escape.txt").exists())

    def test_safe_zip_is_expanded(self):
        make_img(self.root / "tmp.png", 1)
        with zipfile.ZipFile(self.root / "imgs.zip", "w") as z:
            z.write(self.root / "tmp.png", "inner/one.png")
        (self.root / "tmp.png").unlink()
        doc, _ = run(self.root)
        self.assertEqual(doc["metrics"]["readableFiles"], 1)

    def test_tabular_checks(self):
        (self.root / "t.csv").write_text("id,price,name\n1,2.5,a\n2,3,b\n2,3,b\n3,abc,\n4,,d\n")
        doc, prev = run(self.root)
        m = doc["metrics"]
        self.assertEqual(m["rows"], 5)
        self.assertEqual(m["duplicateRows"], 1)
        self.assertEqual(m["nullCells"], 2)
        cols = {c["name"]: c for c in m["columns"]}
        self.assertEqual(cols["id"]["type"], "int")
        self.assertEqual(cols["price"]["type"], "float")
        self.assertIn("invalid_data_type", {f["code"] for f in doc["findings"]})
        self.assertTrue((prev / "table_preview.json").exists())

    def test_yolo_annotations(self):
        (self.root / "classes.txt").write_text("car\nbike\n")
        make_img(self.root / "a.png", 1)
        (self.root / "a.txt").write_text("0 0.5 0.5 0.2 0.2\n")
        make_img(self.root / "b.png", 2)
        (self.root / "b.txt").write_text("7 0.5 1.5 0.2 0.2\n")
        make_img(self.root / "c.png", 3)
        doc, _ = run(self.root)
        m = doc["metrics"]
        self.assertEqual(m["labelIssues"], 2)  # out-of-range + missing annotation
        self.assertIn("missing_annotations", {f["code"] for f in doc["findings"]})

    def test_budget_truncates(self):
        for i in range(10):
            make_img(self.root / f"{i}.png", i)
        doc, _ = run(self.root, "--max-items", "4")
        self.assertTrue(doc["truncated"])
        self.assertEqual(doc["metrics"]["readableFiles"], 4)


if __name__ == "__main__":
    unittest.main()
