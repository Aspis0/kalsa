#!/usr/bin/env python3
"""Calibration v2 source readers: v1 rows, web documents, GSM8K train, code chunks.

Every HF download is pinned to the revision recorded here (the licence table in
calib-v2/SOURCES.md matches these pins). Code chunks walk files sequentially and
carry `label:relative/path#L<first>-L<last>` as their source, so every row's
provenance is exact. Licence headers are stripped from chunk starts (v3 recipe).
"""

import json
import pathlib
import subprocess

from datasets import load_dataset

HOME = pathlib.Path.home()
LAB = HOME / "Projects/kalsa-moe-experiments"
V1_JSONL = HOME / "kalsa-models/reap-calib/kalsa-reap-calib.jsonl"
QWEN36_META = HOME / "kalsa-models/reap-calib/qwen36-meta"
ENGINE_ROOT = HOME / "Projects/kalsallama"
# the Mac's default python3 = 3.14.6, Homebrew python@3.14 (PSF-2.0 licence);
# /opt/homebrew/opt/python is a symlink to this same Frameworks directory
STDLIB_DIR = pathlib.Path(
    "/opt/homebrew/opt/python@3.14/Frameworks/Python.framework/Versions/3.14/lib/python3.14")

FINEWEB2_REV = "af9c13333eb981300149d5ca60a8e9d659b276b9"  # HuggingFaceFW/fineweb-2
FINEWEB_REV = "9bb295ddab0e05d785b879661af7260fed5140fc"   # HuggingFaceFW/fineweb
GSM8K_REV = "740312add88f781978c0658806c59bc2815b9866"

MIN_CHARS, MAX_CHARS = 200, 12_000
MIN_LANG_SCORE = 0.90
CHUNK_CHARS = 4_000
# v3 build_corpus.py's skip list plus .git (repo-wide walks need it)
SKIP_PARTS = {"test", "tests", "site-packages", "idlelib", "turtledemo",
              "__pycache__", "lib2to3", "test-data", ".git"}
LICENSE_MARKERS = ("opyright", "icense", "GNU ", "Apache", "BSD ", "SPDX")


def engine_commit() -> str:
    return subprocess.run(["git", "-C", str(ENGINE_ROOT), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()


def v1_rows() -> list[dict]:
    with open(V1_JSONL, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def web_docs(config: str):
    """Yield (text, source_label) web documents. Non-English configs are FineWeb-2
    language subsets; 'en' uses FineWeb sample-10BT (FineWeb-2 has no English)."""
    if config == "en":
        repo, cfg = "HuggingFaceFW/fineweb", "sample-10BT"
        rev, label = FINEWEB_REV, "HuggingFaceFW/fineweb sample-10BT"
    else:
        repo, cfg = "HuggingFaceFW/fineweb-2", config
        rev, label = FINEWEB2_REV, f"HuggingFaceFW/fineweb-2 {config}"
    ds = load_dataset(repo, cfg, split="train", streaming=True, revision=rev)
    for r in ds:
        if (r.get("language_score") or 0.0) < MIN_LANG_SCORE:
            continue
        text = r["text"]
        if len(text) < MIN_CHARS or len(text) > MAX_CHARS:
            continue
        yield text, label


def gsm8k_train(seed: int):
    """All of GSM8K train, seeded-shuffled (problems + FULL worked solutions; the
    test split is an eval set and is never touched here)."""
    ds = load_dataset("openai/gsm8k", "main", split="train", revision=GSM8K_REV)
    ds = ds.shuffle(seed=seed)
    for r in ds:
        yield {"messages": [{"role": "user", "content": r["question"]},
                            {"role": "assistant", "content": r["answer"]}],
               "source": "openai/gsm8k main (train)", "license": "mit",
               "source_revision": GSM8K_REV}


def _strip_leading_license(lines: list[str]) -> int:
    """Drop a leading comment block only if it mentions a license; keep docstrings."""
    start = block_end = 0
    for i, ln in enumerate(lines[:40]):
        s = ln.strip()
        if s.startswith("#") or s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            block_end = i + 1
            if any(m in s for m in LICENSE_MARKERS):
                start = block_end
        elif s:
            break
    return start


def _chunks_of_file(p: pathlib.Path, label_root: pathlib.Path, label: str):
    try:
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return
    start = _strip_leading_license(lines)
    body = lines[start:]
    i = 0
    while i < len(body):
        j, total = i, 0
        while j < len(body) and total < CHUNK_CHARS:
            total += len(body[j]) + 1
            j += 1
        if total >= CHUNK_CHARS // 2:
            yield ("\n".join(body[i:j]),
                   f"{label}:{p.relative_to(label_root)}#L{start + i + 1}-L{start + j}")
        i = j  # sequential, non-overlapping


def _collect(roots, exts, label_root, label):
    seen = set()
    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            if p.suffix not in exts or not p.is_file():
                continue
            if any(part in SKIP_PARTS for part in p.parts):
                continue
            try:
                size = p.stat().st_size
            except OSError:
                continue
            if size < 3000 or size > 400_000 or p.resolve() in seen:
                continue
            seen.add(p.resolve())
            yield from _chunks_of_file(p, label_root, label)


def code_chunks():
    """Round-robin merger of the three code sources, so no single one fills the
    domain alone: kalsallama engine C/C++, kalsallama Python, CPython stdlib."""
    cc = _collect([ENGINE_ROOT / "src", ENGINE_ROOT / "ggml/src", ENGINE_ROOT / "include"],
                  {".c", ".cpp", ".cc", ".h", ".hpp"}, ENGINE_ROOT, "kalsallama-engine")
    eng_py = _collect([ENGINE_ROOT], {".py"}, ENGINE_ROOT, "kalsallama-python")
    stdlib = _collect([STDLIB_DIR], {".py"}, STDLIB_DIR, "cpython-stdlib")
    streams = [list(s) for s in (cc, eng_py, stdlib)]
    for k in range(max(len(s) for s in streams)):
        s = streams[k % 3]
        if k // 3 < len(s):
            yield s[k // 3]
