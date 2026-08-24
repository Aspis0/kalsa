#!/usr/bin/env python3
"""Write MANIFEST.md with hashlib sha256 of pulled q46 files."""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "results" / "htp_smoke" / "s23_v73_lfm_bprime"


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
        "# LFM2.5-8B-A1B B-prime Q8_0-trunk HTP smoke (v73) S23 — MANIFEST",
        "",
        "REGISTRA+DICHIARA. First NPU smoke of a KEXP-class model that fits the S23.",
        "SHA256 Python hashlib PC-side (never Get-FileHash).",
        "",
        "## Pins",
        "",
        "| artifact | value | sha256 |",
        "|---|---|---|",
        "| llama-bench (kalsahtp) | /data/local/tmp/kalsahtp/llama-bench @3f545bec | 5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507 |",
        "| libggml-hexagon.so | kalsahtp | f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448 |",
        "| libggml-htp-v73.so | kalsahtp | c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5 |",
        "| LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf | /data/local/tmp/ 3580407296 B | 38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a |",
        "| env (a)(b) | GGML_HEXAGON_NDEV=1 VERBOSE=1 HOSTBUF unset (v73 llama-bench path) | |",
        "| env (c) | same binary; -ngl 0; HEXAGON_NDEV unset; HOSTBUF unset | |",
        "| invocation (a) | -p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 -v -o jsonl --load-mode none -fa on --ubatch-size 1024 | |",
        "| invocation (b) | -p 512 -n 128 -r 2 -ngl 99 -dev HTP0 -o jsonl --load-mode none -fa on --ubatch-size 1024 | |",
        "| invocation (c) | -p 512 -n 128 -r 2 -ngl 0 -o jsonl --load-mode none -fa on --ubatch-size 1024 | |",
        "| deletions | none (Marco B-prime 6509642624 B left on device) | |",
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
