#!/usr/bin/env python3
"""EdgeBounty dataset validator.

Runs inside a sandbox (separate process / container with no network and no secrets).
Input: a directory of materialized dataset files. Output: a JSON document with metrics,
findings, previews and the limits of what was (not) checked.

Level 1 (technical, no ML): readability, corruption, dimensions, formats, exact duplicates,
annotation validity, tabular schema/nulls/duplicates/type violations, archive safety.
Level 2 (lightweight ML-free statistics): perceptual-hash near duplicates, brightness/aspect
outliers, nearest-centroid suspected label errors.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import sys
import time
import zipfile
import tempfile
import shutil
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sandbox runs `python -I`
import media  # noqa: E402

VERSION = "1.4.0"
IMAGE_EXT = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp", ".bmp": "bmp", ".gif": "gif", ".tif": "tiff", ".tiff": "tiff"}
TABULAR_EXT = {".csv", ".parquet", ".jsonl", ".ndjson"}
ANNOTATION_EXT = {".txt", ".json", ".xml"}
LABEL_FILES = {"labels.csv", "annotations.csv"}

# archive safety limits
MAX_ARCHIVE_ENTRIES = 200_000
MAX_ARCHIVE_TOTAL = 128 * 1024**2
MAX_ARCHIVE_RATIO = 200


class Budget:
    def __init__(self, max_items: int, max_seconds: float):
        self.max_items = max_items
        self.deadline = time.monotonic() + max_seconds
        self.items = 0
        self.truncated = False

    def take(self) -> bool:
        if self.items >= self.max_items or time.monotonic() > self.deadline:
            self.truncated = True
            return False
        self.items += 1
        return True


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(p: Path, root: Path) -> str:
    return p.relative_to(root).as_posix()


# ----------------------------------------------------------------------------- archives

def safe_extract(zpath: Path, dest: Path, findings: list, remaining_bytes=MAX_ARCHIVE_TOTAL) -> bool:
    try:
        with zipfile.ZipFile(zpath) as z:
            infos = z.infolist()
            if len(infos) > MAX_ARCHIVE_ENTRIES:
                findings.append(finding("confirmed", "archive_too_many_entries", f"{zpath.name}: {len(infos)} entries exceeds limit"))
                return False
            total = sum(i.file_size for i in infos)
            compressed = max(1, sum(i.compress_size for i in infos))
            if total > remaining_bytes or total / compressed > MAX_ARCHIVE_RATIO:
                findings.append(finding("confirmed", "archive_decompression_bomb", f"{zpath.name}: uncompressed {total} bytes (ratio {total / compressed:.0f}) exceeds limits"))
                return False
            for i in infos:
                name = i.filename.replace("\\", "/")
                if name.startswith("/") or ".." in name.split("/") or (i.external_attr >> 16) & 0o170000 == 0o120000:
                    findings.append(finding("confirmed", "archive_unsafe_path", f"{zpath.name}: unsafe entry {name!r}"))
                    return False
            dest.mkdir(parents=True, exist_ok=True)
            for i in infos:
                if i.is_dir():
                    continue
                target = (dest / i.filename).resolve()
                if not target.is_relative_to(dest.resolve()):
                    return False
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(i) as src, open(target, "wb") as out:
                    written = 0
                    for chunk in iter(lambda: src.read(1 << 20), b""):
                        written += len(chunk)
                        if written > i.file_size + 1024:  # lying header
                            findings.append(finding("confirmed", "archive_size_mismatch", f"{zpath.name}: entry larger than declared"))
                            return False
                        out.write(chunk)
        return True
    except zipfile.BadZipFile:
        findings.append(finding("confirmed", "archive_corrupted", f"{zpath.name}: not a valid zip archive"))
        return False


def finding(severity: str, code: str, message: str, files: list | None = None) -> dict:
    return {"severity": severity, "code": code, "message": message, "files": (files or [])[:200]}


# ----------------------------------------------------------------------------- images

def pixels(img):
    """Flat pixel sequence (Pillow >= 12 renamed getdata)."""
    f = getattr(img, "get_flattened_data", None)
    return list(f() if f else img.getdata())


def dhash(img, size: int = 8) -> int:
    g = img.convert("L").resize((size + 1, size))
    px = pixels(g)
    bits = 0
    for row in range(size):
        for col in range(size):
            left = px[row * (size + 1) + col]
            right = px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return bits


def color_hist(img, bins: int = 4) -> list[float]:
    small = img.convert("RGB").resize((32, 32))
    h = [0.0] * (bins**3)
    step = 256 // bins
    for r, g, b in pixels(small):
        h[(r // step) * bins * bins + (g // step) * bins + (b // step)] += 1
    n = sum(h) or 1
    return [v / n for v in h]


def near_duplicates(hashes: dict[str, int], exact_groups: set[str], threshold: int = 6) -> list[tuple[str, str]]:
    """Multi-index hashing: 8 bands of 8 bits; distance <= 7 guarantees a shared band."""
    bands: dict[tuple[int, int], list[str]] = defaultdict(list)
    for path, h in hashes.items():
        for b in range(8):
            bands[(b, (h >> (b * 8)) & 0xFF)].append(path)
    pairs = set()
    for members in bands.values():
        if len(members) > 2000:  # degenerate bucket (e.g. blank images): skip, reported as limitation
            continue
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b = members[i], members[j]
                if (hashes[a] ^ hashes[b]).bit_count() <= threshold:
                    pairs.add((min(a, b), max(a, b)))
    return sorted(p for p in pairs if not (p[0] in exact_groups and p[1] in exact_groups))


def load_labels(root: Path, images: list[str], findings: list) -> tuple[dict[str, str], int, int]:
    """Returns (image -> label), label issues, labeled files. Supports labels.csv, YOLO txt, folder-per-class."""
    labels: dict[str, str] = {}
    issues = 0
    for name in LABEL_FILES:
        for p in root.rglob(name):
            with open(p, newline="", encoding="utf-8", errors="replace") as f:
                for row in csv.DictReader(f):
                    fn = (row.get("filename") or row.get("file") or row.get("image") or "").strip()
                    lab = (row.get("label") or row.get("class") or "").strip()
                    if not fn or not lab:
                        issues += 1
                        continue
                    labels[fn] = lab
    if labels:
        by_name = {Path(i).name: i for i in images}
        mapped = {}
        for fn, lab in labels.items():
            key = fn if fn in images else by_name.get(Path(fn).name)
            if key is None:
                issues += 1
                findings.append(finding("confirmed", "label_for_missing_file", f"label references missing file {fn}"))
            else:
                mapped[key] = lab
        return mapped, issues, len(mapped)

    # YOLO: image.jpg + image.txt, optional classes.txt
    classes = None
    cf = next(iter(root.rglob("classes.txt")), None)
    if cf:
        classes = [l.strip() for l in cf.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
    yolo_found = 0
    bad_files = []
    for img in images:
        txt = (root / img).with_suffix(".txt")
        if not txt.exists():
            continue
        yolo_found += 1
        ok = True
        first_class = None
        for line in txt.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                cid = int(parts[0])
                coords = [float(x) for x in parts[1:5]]
                if len(coords) != 4 or any(c < 0 or c > 1 for c in coords) or coords[2] <= 0 or coords[3] <= 0:
                    ok = False
                if classes is not None and not (0 <= cid < len(classes)):
                    ok = False
                first_class = first_class if first_class is not None else cid
            except ValueError:
                ok = False
        if not ok:
            issues += 1
            bad_files.append(img)
        if first_class is not None:
            labels[img] = classes[first_class] if classes and 0 <= first_class < len(classes) else str(first_class)
    if yolo_found:
        if bad_files:
            findings.append(finding("confirmed", "malformed_yolo_annotations", f"{len(bad_files)} annotation files are malformed or out of range", bad_files))
        missing = [i for i in images if not (root / i).with_suffix(".txt").exists()]
        if missing:
            issues += len(missing)
            findings.append(finding("confirmed", "missing_annotations", f"{len(missing)} images have no annotation file", missing))
        return labels, issues, yolo_found

    # folder-per-class: class/image.jpg (only when there are >= 2 classes)
    parents = {i: Path(i).parent.as_posix() for i in images}
    distinct = {p for p in parents.values() if p not in ("", ".")}
    if len(distinct) >= 2 and all(p not in ("", ".") for p in parents.values()):
        return {i: Path(p).name for i, p in parents.items()}, 0, len(images)
    return {}, 0, 0


def analyze_images(root: Path, files: list[Path], level: str, args, budget: Budget, findings: list, out: dict):
    from PIL import Image, ImageDraw, ImageFile

    Image.MAX_IMAGE_PIXELS = 178_956_970  # PIL bomb guard (~ 13k x 13k)
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    readable, corrupted, below = [], [], []
    formats: Counter = Counter()
    min_w = min_h = None
    sha_groups: dict[str, list[str]] = defaultdict(list)
    phash: dict[str, int] = {}
    feats: dict[str, tuple[float, float]] = {}
    hists: dict[str, list[float]] = {}
    mismatched_ext = []
    for p in files:
        if not budget.take():
            break
        r = rel(p, root)
        sha_groups[sha256_file(p)].append(r)
        try:
            with Image.open(p) as im:
                im.verify()
            with Image.open(p) as im:
                im.load()
                fmt = (im.format or "").lower()
                fmt = "jpeg" if fmt == "jpg" else fmt
                if IMAGE_EXT.get(p.suffix.lower()) not in (fmt, None):
                    mismatched_ext.append(r)
                formats[fmt or "unknown"] += 1
                w, h = im.size
                min_w = w if min_w is None else min(min_w, w)
                min_h = h if min_h is None else min(min_h, h)
                if w < args.min_width or h < args.min_height:
                    below.append(r)
                readable.append(r)
                if level in ("L2", "L3"):
                    phash[r] = dhash(im)
                    g = im.convert("L").resize((16, 16))
                    feats[r] = (sum(pixels(g)) / 256.0, w / max(h, 1))
                    hists[r] = color_hist(im)
        except Exception as e:  # noqa: BLE001 - any decoder failure means unreadable
            corrupted.append(r)
    exact_dup_files = [paths for paths in sha_groups.values() if len(paths) > 1]
    exact_duplicates = sum(len(g) - 1 for g in exact_dup_files)
    if corrupted:
        findings.append(finding("confirmed", "corrupted_images", f"{len(corrupted)} files cannot be decoded", corrupted))
    if exact_duplicates:
        findings.append(finding("confirmed", "exact_duplicates", f"{exact_duplicates} exact duplicate files (SHA-256)", [p for g in exact_dup_files for p in g]))
    if below:
        findings.append(finding("confirmed", "below_min_resolution", f"{len(below)} images below {args.min_width}x{args.min_height}", below))
    if mismatched_ext:
        findings.append(finding("suspected", "extension_format_mismatch", f"{len(mismatched_ext)} files have an extension that does not match their content", mismatched_ext))

    labels, label_issues, labeled = load_labels(root, readable, findings)
    near = None
    outliers = None
    if level in ("L2", "L3") and readable:
        dup_members = {p for g in exact_dup_files for p in g}
        pairs = near_duplicates(phash, dup_members)
        near = len({b for _, b in pairs})
        if pairs:
            findings.append(finding("suspected", "near_duplicates", f"{len(pairs)} near-duplicate pairs (dHash Hamming <= 6)", [f"{a} ~ {b}" for a, b in pairs]))
        # brightness / aspect outliers (robust z-score via median absolute deviation)
        outl = []
        for idx in (0, 1):
            vals = sorted(f[idx] for f in feats.values())
            med = vals[len(vals) // 2]
            mad = sorted(abs(v - med) for v in vals)[len(vals) // 2] or 1e-9
            outl += [k for k, f in feats.items() if abs(f[idx] - med) / (1.4826 * mad) > 5]
        outliers = len(set(outl))
        if outliers:
            findings.append(finding("suspected", "statistical_outliers", f"{outliers} images are brightness/aspect outliers", sorted(set(outl))))
        # suspected label errors: image closer to another class centroid than its own (by a margin)
        if labels and len(set(labels.values())) >= 2:
            cent: dict[str, list[float]] = {}
            cnt: Counter = Counter()
            for k, lab in labels.items():
                if k in hists:
                    c = cent.setdefault(lab, [0.0] * len(hists[k]))
                    for i, v in enumerate(hists[k]):
                        c[i] += v
                    cnt[lab] += 1
            for lab in cent:
                cent[lab] = [v / cnt[lab] for v in cent[lab]]
            suspects = []
            for k, lab in labels.items():
                if k not in hists or cnt[lab] < 5:
                    continue
                d = {c: math.dist(hists[k], v) for c, v in cent.items()}
                best = min(d, key=d.get)
                if best != lab and d[best] * 1.5 < d[lab]:
                    suspects.append(k)
            if suspects:
                findings.append(finding("suspected", "suspected_label_errors", f"{len(suspects)} images look closer to another class (colour-histogram heuristic)", suspects))

    out.update(
        readableFiles=len(readable),
        corruptedFiles=len(corrupted),
        exactDuplicates=exact_duplicates,
        nearDuplicates=near,
        minWidth=min_w,
        minHeight=min_h,
        belowResolution=len(below) if (args.min_width or args.min_height) else 0,
        formats=dict(formats),
        labelIssues=label_issues if (labels or label_issues) else None,
        labeledFiles=labeled if (labels or label_issues) else None,
        labels=dict(Counter(labels.values())) if labels else None,
        outliers=outliers,
    )

    # controlled previews: few images, small, watermarked
    if args.previews and readable:
        prev_dir = Path(args.previews)
        prev_dir.mkdir(parents=True, exist_ok=True)
        step = max(1, len(readable) // args.preview_count)
        chosen = readable[::step][: args.preview_count]
        previews = []
        for i, r in enumerate(chosen):
            try:
                with Image.open(root / r) as im:
                    im = im.convert("RGB")
                    im.thumbnail((args.preview_max_px, args.preview_max_px))
                    d = ImageDraw.Draw(im)
                    w, h = im.size
                    for y in range(0, h, 40):
                        d.text((5, y), args.watermark, fill=(255, 255, 255))
                    d.text((5, h - 12), args.watermark, fill=(0, 0, 0))
                    name = f"preview_{i:02d}.jpg"
                    im.save(prev_dir / name, "JPEG", quality=60)
                    previews.append({"file": name, "kind": "image", "label": labels.get(r)})
            except Exception:  # noqa: BLE001
                continue
        out["_previews"] = previews

    # random sample for Level-3 AI review (seeded => reproducible), downscaled, not watermarked
    if args.sample_dir and args.sample_size > 0 and readable:
        import random

        sample_dir = Path(args.sample_dir)
        sample_dir.mkdir(parents=True, exist_ok=True)
        chosen = random.Random(args.seed).sample(readable, min(args.sample_size, len(readable)))
        samples = []
        for i, r in enumerate(chosen):
            try:
                with Image.open(root / r) as im:
                    im = im.convert("RGB")
                    im.thumbnail((512, 512))
                    name = f"sample_{i:04d}.jpg"
                    im.save(sample_dir / name, "JPEG", quality=85)
                    samples.append({"file": name, "source": r, "label": labels.get(r)})
            except Exception:  # noqa: BLE001
                continue
        out["_samples"] = samples


# ----------------------------------------------------------------------------- tabular

def infer_type(v: str) -> str:
    s = v.strip()
    if s == "":
        return "null"
    if s.lower() in ("true", "false"):
        return "bool"
    try:
        int(s)
        return "int"
    except ValueError:
        pass
    try:
        float(s)
        return "float"
    except ValueError:
        pass
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return "datetime"
    return "string"


def iter_rows(p: Path):
    suf = p.suffix.lower()
    if suf == ".csv":
        with open(p, newline="", encoding="utf-8", errors="replace") as f:
            header = next(csv.reader(f), None)
        if header is None:
            return [], iter(())

        def csv_rows():
            with open(p, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.reader(f)
                next(reader, None)
                yield from reader
        return header, csv_rows()
    if suf in (".jsonl", ".ndjson"):
        def gen():
            with open(p, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if line.strip():
                        yield json.loads(line)
        rows = gen()
        first = next(rows, None)
        if first is None:
            return [], iter(())
        header = list(first.keys())

        def all_rows():
            yield [none_to_empty(first.get(k)) for k in header]
            for r in rows:
                yield [none_to_empty(r.get(k)) for k in header]
        return header, all_rows()
    if suf == ".parquet":
        import pyarrow.parquet as pq

        t = pq.read_table(p)
        header = t.column_names
        cols = [t.column(c).to_pylist() for c in header]
        return header, ([none_to_empty(c[i]) for c in cols] for i in range(t.num_rows))
    raise ValueError(f"unsupported tabular file {p.name}")


def none_to_empty(v):
    return "" if v is None else str(v)


def analyze_tabular(root: Path, files: list[Path], budget: Budget, findings: list, out: dict, args):
    total_rows = 0
    dup_rows = 0
    null_cells = 0
    columns: dict[str, dict] = {}
    seen = set()
    sample_rows = []
    header_ref = None
    unreadable = []
    for p in files:
        try:
            header, rows = iter_rows(p)
        except Exception as e:  # noqa: BLE001
            unreadable.append(rel(p, root))
            continue
        if header_ref is None:
            header_ref = header
        elif header != header_ref:
            findings.append(finding("confirmed", "schema_mismatch", f"{rel(p, root)} has different columns than the first table"))
        for h in header:
            columns.setdefault(h, {"types": Counter(), "nulls": 0, "distinct": set()})
        try:
            for row in rows:
                if not budget.take():
                    break
                total_rows += 1
                key = hashlib.sha1("\x1f".join(row).encode()).digest()
                if key in seen:
                    dup_rows += 1
                else:
                    seen.add(key)
                if len(row) != len(header):
                    findings.append(finding("confirmed", "ragged_row", f"{rel(p, root)} row {total_rows} has {len(row)} fields, expected {len(header)}"))
                for h, v in zip(header, row):
                    t = infer_type(v)
                    c = columns[h]
                    if t == "null":
                        c["nulls"] += 1
                        null_cells += 1
                    else:
                        c["types"][t] += 1
                    if len(c["distinct"]) < 10_000:
                        c["distinct"].add(v)
                if len(sample_rows) < 20:
                    sample_rows.append(dict(zip(header, row)))
        except Exception as e:  # noqa: BLE001
            unreadable.append(rel(p, root))
    if unreadable:
        findings.append(finding("confirmed", "unreadable_tables", f"{len(unreadable)} tabular files could not be parsed", unreadable))
    col_out = []
    type_violations = 0
    for name, c in columns.items():
        types = c["types"]
        main = "string"
        if types:
            numeric = types.get("int", 0) + types.get("float", 0)
            other = max((v for t, v in types.items() if t not in ("int", "float")), default=0)
            if numeric and numeric >= other:
                main = "float" if types.get("float") else "int"
            else:
                main = types.most_common(1)[0][0]
            bad = sum(v for t, v in types.items() if t != main and not (main == "float" and t == "int"))
            if bad and main != "string":
                type_violations += bad
                findings.append(finding("confirmed", "invalid_data_type", f"column {name!r}: {bad} values are not {main}"))
        col_out.append({"name": name, "type": main, "nulls": c["nulls"], "distinct": len(c["distinct"])})
    if dup_rows:
        findings.append(finding("confirmed", "duplicate_rows", f"{dup_rows} duplicate rows"))
    out.update(rows=total_rows, columns=col_out, duplicateRows=dup_rows, nullCells=null_cells, readableFiles=len(files) - len(unreadable), corruptedFiles=len(unreadable))
    if args.previews:
        prev_dir = Path(args.previews)
        prev_dir.mkdir(parents=True, exist_ok=True)
        # limited safe sample: first rows, long strings truncated
        safe = [{k: (v[:64] + "…" if len(v) > 64 else v) for k, v in r.items()} for r in sample_rows[: args.preview_rows]]
        (prev_dir / "table_preview.json").write_text(json.dumps({"columns": col_out, "sample": safe, "rows": total_rows}, indent=1))
        out["_previews"] = [{"file": "table_preview.json", "kind": "table"}]


# ----------------------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--previews")
    ap.add_argument("--level", choices=["L1", "L2", "L3"], default="L1")
    ap.add_argument("--min-width", type=int, default=0)
    ap.add_argument("--min-height", type=int, default=0)
    ap.add_argument("--max-items", type=int, default=1_000_000)
    ap.add_argument("--max-seconds", type=float, default=600)
    ap.add_argument("--preview-count", type=int, default=8)
    ap.add_argument("--preview-max-px", type=int, default=256)
    ap.add_argument("--preview-rows", type=int, default=10)
    ap.add_argument("--watermark", default="EdgeBounty preview")
    ap.add_argument("--sample-dir")
    ap.add_argument("--sample-size", type=int, default=0)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args(argv)

    started = time.monotonic()
    root = Path(args.input).resolve()
    findings: list = []
    limitations: list[str] = []
    budget = Budget(args.max_items, args.max_seconds)

    # Docker mounts input read-only. Archive expansion belongs in bounded tmpfs scratch.
    scratch = None
    if list(root.rglob("*.zip")):
        scratch = tempfile.TemporaryDirectory(prefix="edgebounty-archives-")
        shutil.copytree(root, scratch.name, dirs_exist_ok=True)
        root = Path(scratch.name)
    remaining_archive_bytes = MAX_ARCHIVE_TOTAL
    for z in list(root.rglob("*.zip")):
        dest = z.with_suffix("")
        if safe_extract(z, dest, findings, remaining_archive_bytes):
            remaining_archive_bytes -= sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
        z.unlink()

    all_files = sorted(p for p in root.rglob("*") if p.is_file())
    images = [p for p in all_files if p.suffix.lower() in IMAGE_EXT]
    audio = [p for p in all_files if p.suffix.lower() in media.AUDIO_EXT]
    video = [p for p in all_files if p.suffix.lower() in media.VIDEO_EXT]
    tables = [p for p in all_files if p.suffix.lower() in TABULAR_EXT and p.name not in LABEL_FILES]
    data_files = images or audio or video or tables
    out: dict = {
        "totalFiles": len(all_files),
        "totalSize": sum(p.stat().st_size for p in all_files),
        "dataFiles": len(data_files),
        "readableFiles": 0,
        "corruptedFiles": 0,
        "exactDuplicates": 0,
        "nearDuplicates": None,
        "minWidth": None,
        "minHeight": None,
        "belowResolution": None,
        "formats": {},
        "labelIssues": None,
        "labeledFiles": None,
        "labels": None,
        "outliers": None,
        "rows": None,
        "columns": None,
        "duplicateRows": None,
        "nullCells": None,
        "relevance": None,
        "media": None,
    }
    if images:
        analyze_images(root, images, args.level, args, budget, findings, out)
        if args.level == "L1":
            limitations.append("Near-duplicate, outlier and label-consistency checks require Level 2.")
    elif audio or video:
        res = (media.analyze_audio if audio else media.analyze_video)(audio or video, lambda p: rel(p, root), budget, finding)
        findings.extend(res["findings"])
        sha_groups: dict = defaultdict(list)
        for r in res["readable"]:
            sha_groups[sha256_file(root / r)].append(r)
        dups = [g for g in sha_groups.values() if len(g) > 1]
        if dups:
            findings.append(finding("confirmed", "exact_duplicates", f"{sum(len(g) - 1 for g in dups)} exact duplicate files (SHA-256)", [p for g in dups for p in g]))
        out.update(readableFiles=len(res["readable"]), corruptedFiles=len(res["corrupted"]), exactDuplicates=sum(len(g) - 1 for g in dups), formats=dict(Counter(Path(r).suffix.lower().lstrip(".") for r in res["readable"])), media=res["media"])
        limitations.append("Audio/video checks are container- and signal-level; content relevance and codec-level decoding are not assessed.")
    elif tables:
        analyze_tabular(root, tables, budget, findings, out, args)
    else:
        limitations.append("No supported image or tabular files found; only file-level checks were run.")
    limitations.append("Relevance to the task is not assessed below Level 3 (AI review).")
    limitations.append("Licensing and provenance are not machine-verifiable; they require human review (Level 4).")
    if budget.truncated:
        limitations.append(f"Processing stopped at the job budget after {budget.items} items; results cover a prefix of the dataset.")
    previews = out.pop("_previews", [])
    samples = out.pop("_samples", [])
    doc = {
        "metrics": out,
        "findings": findings,
        "previews": previews,
        "samples": samples,
        "tools": [{"name": "edgebounty-dataset-validator", "version": VERSION}, {"name": "python", "version": sys.version.split()[0]}] + pil_version(),
        "limitations": limitations,
        "itemsProcessed": budget.items,
        "truncated": budget.truncated,
        "elapsedMs": int((time.monotonic() - started) * 1000),
    }
    Path(args.output).write_text(json.dumps(doc))
    if scratch is not None:
        scratch.cleanup()
    return 0


def pil_version():
    try:
        import PIL

        return [{"name": "pillow", "version": PIL.__version__}]
    except Exception:  # noqa: BLE001
        return []


if __name__ == "__main__":
    sys.exit(main())
