#!/usr/bin/env python3
"""Final eval-overlap check over the built calib-v2 domain files.

Independent of the builder: reloads every ban set (FLORES dev+devtest, GSM8K
test, HumanEval, HumanEval+, MBPP test, corpus/postcutoff, corpus/multi5), then
reports, per domain x ban set, rows with ANY 13-gram overlap or an exact
normalized full-text match. The builder already drops such rows, so a non-zero
cell means the built files and the ban lists disagree — exit 1 on any hit.

Usage: eval_overlap_check.py <calib_v2_dir>
"""

import json
import pathlib
import sys

import evalsets

DOMAINS = ("it", "fr", "es", "en", "zh", "code", "math")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    calib_dir = pathlib.Path(sys.argv[1])
    bans = evalsets.load_all()

    counts = {d: {n: 0 for n in bans.names} for d in DOMAINS}
    rows_total = {}
    for dom in DOMAINS:
        path = calib_dir / f"{dom}.jsonl"
        if not path.exists():
            print(f"FAIL: missing {path}", file=sys.stderr)
            return 2
        n = 0
        for line in open(path, encoding="utf-8"):
            row = json.loads(line)
            n += 1
            text = " ".join(m["content"] for m in row["messages"])
            for name in bans.hits(text):
                counts[dom][name] += 1
        rows_total[dom] = n

    header = "domain  rows  " + "  ".join(f"{n:>11s}" for n in bans.names)
    print(header)
    for dom in DOMAINS:
        cells = "  ".join(f"{counts[dom][n]:11d}" for n in bans.names)
        print(f"{dom:6s} {rows_total[dom]:5d}  {cells}")

    total_hits = sum(sum(v.values()) for v in counts.values())
    grams = {n: len(bs) for n, bs in bans.gram_sets.items()}
    print("\nban-set sizes (13-gram sets): "
          + ", ".join(f"{n}={grams[n]}" for n in bans.names))
    if total_hits:
        print(f"FAIL: {total_hits} calib rows overlap an eval set", file=sys.stderr)
        return 1
    print("OK: zero exact / 13-gram overlap between calib-v2 and every eval set")
    return 0


if __name__ == "__main__":
    sys.exit(main())
