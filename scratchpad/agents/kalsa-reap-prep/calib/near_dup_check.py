#!/usr/bin/env python3
"""Containment check between the Kalsa calibration set and corpus/multi5.

The builder enforces exact 80-char normalized-window disjointness at stride
40; this catches the alignments that stride misses. For every calibration
row it computes CONTAINMENT — the fraction of the row's 80-char windows that
appear anywhere in a multi5 file — instead of the old Jaccard number, which
was structurally ~0 for a short row inside a long corpus (2026-09-30 review).
Fails (exit 1) if any row's containment exceeds 0.5.

Usage: near_dup_check.py <calib.jsonl> <multi5_dir>
"""

import json
import pathlib
import re
import sys

WINDOW = 80
ROW_FAIL = 0.5


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+", "", text.lower())


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    calib_path, multi5 = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

    corpus = {}   # lang -> set of every 80-char window (stride 1)
    for f in sorted(multi5.glob("*.txt")):
        t = norm(f.read_text(encoding="utf-8"))
        corpus[f.stem] = {t[i:i + WINDOW]
                          for i in range(max(0, len(t) - WINDOW + 1))}

    worst = ("none", 0.0)
    n_rows = 0
    for line in open(calib_path):
        row = json.loads(line)
        t = norm(" ".join(m["content"] for m in row["messages"]))
        wins = [t[i:i + WINDOW] for i in range(0, max(1, len(t) - WINDOW + 1), WINDOW // 2)]
        if len(wins) < 2:
            continue
        n_rows += 1
        for lang, winset in corpus.items():
            c = sum(1 for w in wins if w in winset) / len(wins)
            if c > worst[1]:
                worst = (lang, c)
            assert c <= ROW_FAIL, \
                f"calib row {row.get('id')}: containment {c:.0%} in multi5 {lang}"

    print(f"rows checked: {n_rows}; max row containment: {worst[1]:.4f} "
          f"({worst[0]}); fail above {ROW_FAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
