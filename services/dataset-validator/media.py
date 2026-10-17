"""Audio and video technical checks (Phase 5). Pure standard library + numpy; no decoders executed.

Audio: WAV (PCM) via `wave` - channels, sample rate, duration, silence (RMS), clipping.
Video: MP4/MOV container parsing (ISO BMFF boxes) - ftyp/moov presence, duration (mvhd),
track count and declared resolution (tkhd). Codec-level decoding is out of scope and reported
as a limitation.
"""
from __future__ import annotations

import struct
import wave
from collections import Counter
from pathlib import Path

AUDIO_EXT = {".wav", ".wave"}
VIDEO_EXT = {".mp4", ".mov", ".m4v"}


def analyze_audio(files: list[Path], rel, budget, finding) -> dict:
    import numpy as np

    readable, corrupted, silent, clipped = [], [], [], []
    rates: Counter = Counter()
    chans: Counter = Counter()
    durations = []
    for p in files:
        if not budget.take():
            break
        r = rel(p)
        try:
            with wave.open(str(p), "rb") as w:
                n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
                if sr <= 0 or n <= 0:
                    raise ValueError("empty")
                raw = w.readframes(min(n, sr * 30))  # analyse at most 30 s per file
            dtype = {1: np.uint8, 2: np.int16, 4: np.int32}.get(sw)
            if dtype is None:
                raise ValueError("unsupported sample width")
            x = np.frombuffer(raw, dtype=dtype).astype(np.float64)
            if sw == 1:
                x -= 128
            full = float({1: 128, 2: 32768, 4: 2**31}[sw])
            rms = float(np.sqrt(np.mean(x**2))) / full if x.size else 0.0
            if rms < 1e-4:
                silent.append(r)
            if x.size and float(np.mean(np.abs(x) >= full * 0.999)) > 0.01:
                clipped.append(r)
            rates[str(sr)] += 1
            chans[str(ch)] += 1
            durations.append(n / sr)
            readable.append(r)
        except Exception:  # noqa: BLE001 - any parse failure = unreadable
            corrupted.append(r)
    findings = []
    if corrupted:
        findings.append(finding("confirmed", "corrupted_audio", f"{len(corrupted)} audio files cannot be parsed as PCM WAV", corrupted))
    if silent:
        findings.append(finding("suspected", "silent_audio", f"{len(silent)} audio files are (near) silent", silent))
    if clipped:
        findings.append(finding("suspected", "clipped_audio", f"{len(clipped)} audio files show heavy clipping", clipped))
    if len(rates) > 1:
        findings.append(finding("suspected", "mixed_sample_rates", f"sample rates vary: {dict(rates)}"))
    return {
        "readable": readable,
        "corrupted": corrupted,
        "findings": findings,
        "media": {"kind": "audio", "totalDurationSec": round(sum(durations), 3), "minDurationSec": round(min(durations), 3) if durations else None, "sampleRates": dict(rates), "channels": dict(chans), "silent": len(silent)},
    }


def _boxes(buf: bytes, start: int, end: int):
    o = start
    while o + 8 <= end:
        size, typ = struct.unpack(">I4s", buf[o : o + 8])
        hdr = 8
        if size == 1:
            if o + 16 > end:
                return
            size = struct.unpack(">Q", buf[o + 8 : o + 16])[0]
            hdr = 16
        elif size == 0:
            size = end - o
        if size < hdr or o + size > end:
            raise ValueError("box overruns container")
        yield typ.decode("latin1"), o + hdr, o + size
        o += size


def parse_mp4(data: bytes) -> dict:
    top = list(_boxes(data, 0, len(data)))
    if not top or top[0][0] != "ftyp":
        raise ValueError("missing ftyp")
    moov = next((b for b in top if b[0] == "moov"), None)
    if not moov:
        raise ValueError("missing moov")
    duration = None
    tracks = []
    for typ, s, e in _boxes(data, moov[1], moov[2]):
        if typ == "mvhd":
            v = data[s]
            if v == 1:
                ts, dur = struct.unpack(">IQ", data[s + 20 : s + 32])
            else:
                ts, dur = struct.unpack(">II", data[s + 12 : s + 20])
            duration = dur / ts if ts else None
        elif typ == "trak":
            for t2, s2, e2 in _boxes(data, s, e):
                if t2 == "tkhd":
                    v = data[s2]
                    off = s2 + (92 if v == 1 else 80)
                    w, h = struct.unpack(">II", data[off : off + 8])
                    tracks.append({"width": w >> 16, "height": h >> 16})
    return {"durationSec": duration, "tracks": tracks}


def analyze_video(files: list[Path], rel, budget, finding, max_header_bytes: int = 64 * 1024 * 1024) -> dict:
    readable, corrupted, no_video = [], [], []
    durations = []
    res: Counter = Counter()
    for p in files:
        if not budget.take():
            break
        r = rel(p)
        try:
            with open(p, "rb") as f:
                data = f.read(max_header_bytes)
            info = parse_mp4(data)
            vt = [t for t in info["tracks"] if t["width"] and t["height"]]
            if not vt:
                no_video.append(r)
            else:
                res[f"{vt[0]['width']}x{vt[0]['height']}"] += 1
            if info["durationSec"] is not None:
                durations.append(info["durationSec"])
            readable.append(r)
        except Exception:  # noqa: BLE001
            corrupted.append(r)
    findings = []
    if corrupted:
        findings.append(finding("confirmed", "corrupted_video", f"{len(corrupted)} video files have an invalid MP4/MOV container", corrupted))
    if no_video:
        findings.append(finding("suspected", "no_video_track", f"{len(no_video)} files have no video track with a resolution", no_video))
    return {
        "readable": readable,
        "corrupted": corrupted,
        "findings": findings,
        "media": {"kind": "video", "totalDurationSec": round(sum(durations), 3), "minDurationSec": round(min(durations), 3) if durations else None, "resolutions": dict(res)},
    }
