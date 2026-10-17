"""Builds a small labeled L3 benchmark set with known ground truth (synthetic, not customer data).

Usage (Windows, needs OpenCV; speech uses the built-in System.Speech voice):
    python scripts/benchmark/make-fixtures.py .data/benchmark
Then:
    npx tsx scripts/l3-benchmark.ts .data/benchmark
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

out = Path(sys.argv[1] if len(sys.argv) > 1 else ".data/benchmark")
rng = np.random.default_rng(20261018)
manifest = []


def add(path: Path, kind: str, task: str, label, relevant: bool, label_correct, group: str):
    manifest.append({"path": path.relative_to(out).as_posix(), "kind": kind, "task": task, "label": label, "relevant": relevant, "labelCorrect": label_correct, "group": group})


def shape_image(shape: str, color, seed: int, size=384):
    r = np.random.default_rng(seed)
    img = np.full((size, size, 3), 255, np.uint8)
    cx, cy, rad = int(r.integers(120, 264)), int(r.integers(120, 264)), int(r.integers(50, 100))
    if shape == "circle":
        cv2.circle(img, (cx, cy), rad, color, -1)
    else:
        cv2.rectangle(img, (cx - rad, cy - rad), (cx + rad, cy + rad), color, -1)
    return img


# ---- images: task "geometric shapes", labelled by folder
IMG_TASK = "Geometric shapes dataset: each image shows one filled circle or one filled square"
colors = [(0, 0, 255), (255, 0, 0), (0, 160, 0), (0, 200, 255)]
for i in range(16):
    shape = "circle" if i % 2 == 0 else "square"
    p = out / "images" / shape / f"{i:02d}.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), shape_image(shape, colors[i % 4], i))
    add(p, "image", IMG_TASK, shape, True, True, "image-relevance")
for i in range(4):  # mislabeled: a circle stored under square/ and vice versa
    actual = "circle" if i % 2 == 0 else "square"
    folder = "square" if actual == "circle" else "circle"
    p = out / "images" / folder / f"mis_{i:02d}.png"
    cv2.imwrite(str(p), shape_image(actual, colors[i % 4], 100 + i))
    add(p, "image", IMG_TASK, folder, True, False, "image-relevance")
for i in range(4):  # irrelevant: noise, text page, gradient, landscape-like bands
    p = out / "images" / ("circle" if i % 2 == 0 else "square") / f"junk_{i:02d}.png"
    if i == 0:
        img = rng.integers(0, 255, (384, 384, 3), dtype=np.uint8)
    elif i == 1:
        img = np.full((384, 384, 3), 255, np.uint8)
        for y in range(30, 370, 28):
            cv2.putText(img, "INVOICE 2026 total due", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 1)
    elif i == 2:
        img = np.tile(np.linspace(0, 255, 384, dtype=np.uint8), (384, 1))[:, :, None].repeat(3, 2)
    else:
        img = np.zeros((384, 384, 3), np.uint8)
        img[:180] = (235, 206, 135)
        img[180:] = (34, 139, 34)
    cv2.imwrite(str(p), img)
    add(p, "image", IMG_TASK, "circle" if i % 2 == 0 else "square", False, None, "image-relevance")

# ---- near-duplicate pairs for the embedding threshold
for i in range(6):
    base = shape_image("circle" if i % 2 == 0 else "square", colors[i % 4], 300 + i)
    a = out / "dup" / f"pair{i}_a.jpg"
    a.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(a), base, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if i < 3:  # near-duplicate: brightness shift + recompression + 2px shift
        b_img = np.clip(np.roll(base, 2, axis=1).astype(np.int16) + 12, 0, 255).astype(np.uint8)
        dup = True
    else:  # different image of the same class
        b_img = shape_image("circle" if i % 2 == 0 else "square", colors[(i + 1) % 4], 400 + i)
        dup = False
    b = out / "dup" / f"pair{i}_b.jpg"
    cv2.imwrite(str(b), b_img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    manifest.append({"pair": [a.relative_to(out).as_posix(), b.relative_to(out).as_posix()], "duplicate": dup, "group": "image-duplicates"})

# ---- audio: task "spoken weather reports", labelled by folder (rain / sun)
AUD_TASK = "Spoken weather reports in English; folder label says whether the report is about rain or sunshine"
speech = [
    ("rain", "Heavy rain is expected this afternoon, so bring an umbrella.", True, True),
    ("rain", "Showers and thunderstorms will continue through the night.", True, True),
    ("sun", "Tomorrow will be sunny and warm with clear blue skies.", True, True),
    ("sun", "Expect bright sunshine all weekend with no clouds at all.", True, True),
    ("sun", "Steady rain and flooding are likely along the coast tonight.", True, False),
    ("rain", "Add two cups of flour and stir the batter until smooth.", False, None),
    ("sun", "The quarterly revenue grew by twelve percent year over year.", False, None),
    ("rain", "Drizzle and light rain will clear by the morning.", True, True),
]
for i, (folder, text, relevant, correct) in enumerate(speech):
    p = out / "audio" / folder / f"clip{i}.wav"
    p.parent.mkdir(parents=True, exist_ok=True)
    ps = (
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); "
        f"$s.SetOutputToWaveFile('{p.resolve()}', $f); $s.Speak('{text}'); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    add(p, "audio", AUD_TASK, folder, relevant, correct, "audio-relevance")

# ---- video: task "a ball moving across the frame"
VID_TASK = "Short videos of a single red ball moving across the frame"
for i in range(6):
    relevant = i < 4
    p = out / "video" / f"v{i}.mp4"
    p.parent.mkdir(parents=True, exist_ok=True)
    w = cv2.VideoWriter(str(p), cv2.VideoWriter_fourcc(*"mp4v"), 6, (320, 240))
    for t in range(12):
        f = np.full((240, 320, 3), 255, np.uint8)
        if relevant:
            cv2.circle(f, (20 + t * 24 if i % 2 == 0 else 300 - t * 24, 120 + (i - 2) * 15), 18, (0, 0, 255), -1)
        elif i == 4:
            cv2.putText(f, f"SLIDE {t // 4 + 1}: AGENDA", (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        else:
            f[:] = rng.integers(0, 255, (240, 320, 3), dtype=np.uint8)
        w.write(f)
    w.release()
    add(p, "video", VID_TASK, None, relevant, None, "video-relevance")

(out / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(f"wrote {len(manifest)} entries to {out / 'manifest.json'}")
