import json
import math
import struct
import tempfile
import unittest
import wave
from pathlib import Path

import validate


def write_wav(path: Path, seconds=0.5, sr=16000, amp=0.3, freq=440):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(struct.pack("<h", int(amp * 32767 * math.sin(2 * math.pi * freq * i / sr))) for i in range(int(seconds * sr)))
        w.writeframes(frames)


def box(typ: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + typ + payload


def write_mp4(path: Path, seconds=2, w=640, h=360):
    mvhd = bytes([0, 0, 0, 0]) + struct.pack(">IIII", 0, 0, 1000, seconds * 1000) + bytes(80)
    tkhd = bytes([0, 0, 0, 7]) + bytes(76) + struct.pack(">II", w << 16, h << 16)
    data = box(b"ftyp", b"isom" + bytes(4) + b"isom") + box(b"moov", box(b"mvhd", mvhd) + box(b"trak", box(b"tkhd", tkhd)))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def run(root: Path):
    out = root.parent / "o.json"
    validate.main(["--input", str(root), "--output", str(out)])
    return json.loads(out.read_text())


class MediaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "d"
        self.root.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_audio(self):
        write_wav(self.root / "a.wav")
        write_wav(self.root / "b.wav", amp=0.0)
        write_wav(self.root / "c.wav", sr=8000)
        (self.root / "d.wav").write_bytes(b"RIFF....WAVEjunk")
        doc = run(self.root)
        m = doc["metrics"]
        self.assertEqual(m["readableFiles"], 3)
        self.assertEqual(m["corruptedFiles"], 1)
        self.assertEqual(m["media"]["kind"], "audio")
        self.assertAlmostEqual(m["media"]["totalDurationSec"], 1.5, places=2)
        codes = {f["code"] for f in doc["findings"]}
        self.assertTrue({"corrupted_audio", "silent_audio", "mixed_sample_rates"} <= codes)

    def test_video(self):
        write_mp4(self.root / "v1.mp4")
        write_mp4(self.root / "v2.mp4", seconds=5, w=1920, h=1080)
        (self.root / "bad.mp4").write_bytes(b"\x00\x00\x00\x08free")
        doc = run(self.root)
        m = doc["metrics"]
        self.assertEqual(m["readableFiles"], 2)
        self.assertEqual(m["corruptedFiles"], 1)
        self.assertEqual(m["media"]["resolutions"], {"640x360": 1, "1920x1080": 1})
        self.assertAlmostEqual(m["media"]["totalDurationSec"], 7.0)
        self.assertIn("corrupted_video", {f["code"] for f in doc["findings"]})


if __name__ == "__main__":
    unittest.main()
