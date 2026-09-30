#!/usr/bin/env python3
"""Containment check: no calibration row may be contained in the gate corpus.

The 2026-09-30 review replaced the old Jaccard-vs-corpus number: a short row
inside a large corpus has Jaccard ~0 by construction, while its containment
(the fraction of the row's 80-char normalized windows found in the corpus)
goes to 1 when the row is really in there. Every hit of an 80-char window at
ANY alignment counts; a row fails at containment > ROW_FAIL. Rows are the
same objects the calibration builder writes ({"messages": [...]}).

Usage: check_holdout_disjoint.py <calib.jsonl> <corpus_dir>
"""

import json
import pathlib
import re
import sys

WINDOW = 80
ROW_FAIL = 0.5


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+", "", text.lower())


def row_windows(row: dict):
    t = norm(" ".join(m["content"] for m in row["messages"]))
    return [t[i:i + WINDOW] for i in range(0, max(1, len(t) - WINDOW + 1), WINDOW // 2)]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    calib_path, corpus_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    # corpus may be flat (<lang>.txt) or per-document (<lang>/<doc>.txt)
    corpora = {}
    for f in sorted(corpus_dir.glob("*.txt")):
        corpora[f.stem] = norm(f.read_text(encoding="utf-8"))
    for f in sorted(corpus_dir.glob("*/*.txt")):
        corpora.setdefault(f.parent.name, "")
        corpora[f.parent.name] += "\n" + f.read_text(encoding="utf-8")

    worst = ("none", 0.0)
    n_rows = 0
    for line in open(calib_path):
        row = json.loads(line)
        wins = row_windows(row)
        if len(wins) < 2:
            continue
        n_rows += 1
        for lang, blob in corpora.items():
            hits = sum(1 for w in wins if w in blob)
            c = hits / len(wins)
            if c > worst[1]:
                worst = (lang, c)
            assert c <= ROW_FAIL, \
                f"calib row {row.get('id')} contained {c:.0%} in corpus {lang}"
    print(f"rows checked: {n_rows}; max row containment: {worst[1]:.4f} "
          f"({worst[0]}); fail above {ROW_FAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
