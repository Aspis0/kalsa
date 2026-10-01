#!/usr/bin/env python3
"""Build the moe-expert-usage-v3 segment corpus.

Twelve groups: ten languages from FLORES-200 dev+devtest (the same sentences in
every language, so topic is controlled across groups), plus CODE and MATH.
Each group contributes N_SEG segments; every segment is a self-contained text
block of roughly 250-400 tokens. Output: one segments file (with <<<SEG >>>
headers the instrument parses), a manifest CSV, and provenance extracts.
"""

import argparse
import csv
import json
import random
import sys
import sysconfig
from pathlib import Path

import pyarrow.parquet as pq

FLORES_LANGS = {
    "it": "ita_Latn", "fr": "fra_Latn", "es": "spa_Latn", "en": "eng_Latn",
    "zh": "zho_Hans", "de": "deu_Latn", "ja": "jpn_Jpan", "ko": "kor_Hang",
    "ru": "rus_Cyrl", "ar": "arb_Arab",
}

LICENSE_MARKERS = ("opyright", "icense", "GNU ", "Apache", "BSD ", "SPDX")

# sentences per FLORES segment, tuned so every group lands near ~10k tokens
SENTS_PER_LANG = {"en": 10, "zh": 10}


def flores_segments(flores_dir: Path, group: str, n_seg: int, sents_per_seg: int):
    """Evenly spaced non-overlapping blocks of consecutive sentences, dev then devtest."""
    code = FLORES_LANGS[group]
    lines = []
    for split, suffix in (("dev", "dev"), ("devtest", "devtest")):
        with open(flores_dir / split / f"{code}.{suffix}", encoding="utf-8") as f:
            lines.extend(ln.rstrip("\n") for ln in f)
    if len(lines) < n_seg * sents_per_seg:
        raise SystemExit(f"flores {group}: {len(lines)} lines too few for {n_seg} segments")
    step = len(lines) // n_seg
    if step < sents_per_seg:
        raise SystemExit(f"flores {group}: stride {step} overlaps segment size {sents_per_seg}")
    out = []
    for i in range(n_seg):
        start = i * step
        text = "\n".join(lines[start:start + sents_per_seg])
        out.append((text, f"{code}.dev+devtest lines {start}-{start + sents_per_seg - 1}"))
    return out


def math_segments(parquet_path: Path, n_seg: int, problems_per_seg: int, rng: random.Random):
    """GSM8K train word problems with worked solutions; <<...>> calculator annotations stripped."""
    table = pq.read_table(parquet_path)
    questions = table.column("question").to_pylist()
    answers = table.column("answer").to_pylist()
    order = list(range(len(questions)))
    rng.shuffle(order)
    need = n_seg * problems_per_seg
    picked = order[:need]
    cleaned = []
    for row in picked:
        q = " ".join(questions[row].split())
        a = "\n".join(
            " ".join(line.split())
            for line in answers[row].splitlines()
        ).replace("<<", " [calc: ").replace(">>", " ]")
        cleaned.append((row, f"Problem: {q}\nSolution: {a}"))
    out = []
    for i in range(n_seg):
        chunk = cleaned[i * problems_per_seg:(i + 1) * problems_per_seg]
        text = "\n\n".join(body for _, body in chunk)
        rows = ",".join(str(r) for r, _ in chunk)
        out.append((text, f"gsm8k train rows {rows}"))
    return out


def strip_leading_license(lines):
    """Drop a leading comment block only if it mentions a license; keep module docstrings."""
    start = 0
    block_end = 0
    for i, ln in enumerate(lines[:40]):
        s = ln.strip()
        if s.startswith("#") or s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            block_end = i + 1
            if any(m in s for m in LICENSE_MARKERS):
                start = block_end
        elif s:
            break
    return start


def collapse_blanks(lines):
    out = []
    for ln in lines:
        if ln.strip() == "" and (not out or out[-1].strip() == ""):
            continue
        out.append(ln)
    return out


def collect_code_files(roots, exts, max_bytes, min_chars):
    seen = set()
    files = []
    skip_parts = {"test", "tests", "site-packages", "idlelib", "turtledemo", "__pycache__", "lib2to3", "test-data"}
    for root in roots:
        for p in sorted(Path(root).rglob("*")):
            if p.suffix not in exts or not p.is_file():
                continue
            if any(part in skip_parts for part in p.parts):
                continue
            try:
                size = p.stat().st_size
            except OSError:
                continue
            if size > max_bytes or size < 3000:
                continue
            key = p.resolve()
            if key in seen:
                continue
            seen.add(key)
            files.append(p)
    return files


def code_segment_from_file(path: Path, target_chars: int, rng: random.Random):
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    start = strip_leading_license(lines)
    body = lines[start:]
    if sum(len(l) for l in body) < target_chars // 2:
        return None
    max_start = max(0, len(body) - 5)
    begin = rng.randint(0, max_start) if max_start > 0 else 0
    chunk, total = [], 0
    for ln in body[begin:]:
        chunk.append(ln)
        total += len(ln) + 1
        if total >= target_chars:
            break
    text = "\n".join(collapse_blanks(chunk))
    return text, f"{path} lines {start + begin + 1}-{start + begin + len(chunk)}"


def code_segments(stdlib_dir, engine_root, n_seg, target_chars, rng: random.Random):
    py_files = collect_code_files([stdlib_dir], {".py"}, max_bytes=200_000, min_chars=3000)
    cc_files = collect_code_files(
        [engine_root / "src", engine_root / "ggml" / "src", engine_root / "include"],
        {".c", ".cpp", ".h"}, max_bytes=400_000, min_chars=3000)
    rng.shuffle(py_files)
    rng.shuffle(cc_files)
    n_py = n_seg // 2
    picks = [(f, "python-stdlib") for f in py_files[:n_py]] + \
            [(f, "kalsallama-engine") for f in cc_files[:n_seg - n_py]]
    out = []
    for path, fam in picks:
        got = code_segment_from_file(path, target_chars, rng)
        if got is None:
            raise SystemExit(f"code segment too small: {path}")
        out.append(got)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flores-dir", required=True, type=Path)
    ap.add_argument("--gsm8k-parquet", required=True, type=Path)
    ap.add_argument("--engine-root", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--n-seg", type=int, default=40)
    ap.add_argument("--sents-per-seg", type=int, default=8)
    ap.add_argument("--problems-per-seg", type=int, default=2)
    ap.add_argument("--code-chars", type=int, default=2400)
    ap.add_argument("--seed", type=int, default=20261001)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    all_segs = []  # (group, source, text)
    for group in FLORES_LANGS:
        sents = SENTS_PER_LANG.get(group, args.sents_per_seg)
        for text, src in flores_segments(args.flores_dir, group, args.n_seg, sents):
            all_segs.append((group, src, text))
    for text, src in math_segments(args.gsm8k_parquet, args.n_seg, args.problems_per_seg, rng):
        all_segs.append(("math", src, text))
    stdlib = sysconfig.get_paths()["stdlib"]
    for text, src in code_segments(Path(stdlib), args.engine_root, args.n_seg, args.code_chars, rng):
        all_segs.append(("code", src, text))

    order = list(range(len(all_segs)))
    rng.shuffle(order)

    seg_path = out_dir / "segments.txt"
    man_path = out_dir / "manifest.csv"
    with open(seg_path, "w", encoding="utf-8") as f, open(man_path, "w", newline="", encoding="utf-8") as mf:
        w = csv.writer(mf)
        w.writerow(["idx", "group", "seg_id", "chars", "source"])
        for out_i, src_i in enumerate(order):
            group, source, text = all_segs[src_i]
            f.write(f"<<<SEG group={group} id={out_i} >>>\n")
            f.write(text)
            if not text.endswith("\n"):
                f.write("\n")
            w.writerow([out_i, group, out_i, len(text), source])

    print(f"segments={len(all_segs)} -> {seg_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
