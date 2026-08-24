#!/usr/bin/env python3
"""Write MANIFEST.md with hashlib sha256 of pulled q48 files."""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "results" / "htp_probe" / "s23_v73_olmoe_q40"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(8 * 1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main() -> None:
    rows = []
    for p in sorted(DEST.rglob("*")):
        if not p.is_file():
            continue
        if p.name == "MANIFEST.md":
            continue
        rel = p.relative_to(DEST).as_posix()
        digest = sha256_file(p)
        rows.append((rel, p.stat().st_size, digest))
    lines = [
        "# OLMoE all-Q4_0 experts-on-NPU probe (v73) S23 — MANIFEST",
        "",
        "REGISTRA+DICHIARA. First attempt at MoE experts on the Qualcomm NPU.",
        "SHA256 Python hashlib PC-side (never Get-FileHash).",
        "",
        "## Pins",
        "",
        "| artifact | value | sha256 |",
        "|---|---|---|",
        "| llama-bench (kalsahtp) | /data/local/tmp/kalsahtp/llama-bench @3f545bec | 5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507 |",
        "| libggml-hexagon.so | kalsahtp | f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448 |",
        "| libggml-htp-v73.so | kalsahtp | c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5 |",
        "| OLMoE-1B-7B-0924-Instruct-Q4_0.gguf | /data/local/tmp/ 3928037856 B | 43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500 |",
        "| env (a) | GGML_HEXAGON_NDEV=1 VERBOSE=1 HOSTBUF unset (v73 llama-bench path) | |",
        "| invocation (a) | -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 | |",
        "| (b)(c) | skipped: (a) rc=134, empty jsonl | |",
        "| deletions | none | |",
        "",
        "## Pulled files",
        "",
        "| path | bytes | sha256 |",
        "|---|---:|---|",
    ]
    for rel, nbytes, digest in rows:
        lines.append(f"| {rel} | {nbytes} | {digest} |")
    lines.append("")
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "MANIFEST.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {DEST / 'MANIFEST.md'} n_files={len(rows)}")


if __name__ == "__main__":
    main()
