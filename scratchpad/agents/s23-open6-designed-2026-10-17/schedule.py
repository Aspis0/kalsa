#!/usr/bin/env python3
"""Randomised run order for the designed S23 cell (OPEN 6). Run as: python3 -I schedule.py <out_dir>

Grid: length (short, long) x idle gap before the turn (0, 2, 5, 10 min) = 8 cells.
Two replicates of every cell = 16 turns, plus EXTRA third replicates of cells drawn by the seed = 20 turns.
The order is a seeded shuffle, so the gap is not confounded with time of session or battery drift.

Usage: schedule.py <out_dir>   writes schedule.tsv and schedule.json there. Same seed, same file, every run.
"""
import hashlib
import json
import os
import random
import sys

SEED = 20261017
LENGTHS = ["short", "long"]
GAPS_MIN = [0, 2, 5, 10]
REPLICATES = 2
EXTRA = 4
# Planning assumptions for the duration estimate only (seconds): a turn's generation, and fixed overhead per turn
# (new chat, typing with read-back, send, settle).
EST_GEN_S = {"short": 25, "long": 110}
EST_OVERHEAD_S = 60


def build():
    rng = random.Random(SEED)
    cells = [(length, gap) for length in LENGTHS for gap in GAPS_MIN]
    turns = [(length, gap, rep) for rep in range(1, REPLICATES + 1) for (length, gap) in cells]
    extra = rng.sample(cells, EXTRA)
    turns += [(length, gap, REPLICATES + 1) for (length, gap) in extra]
    rng.shuffle(turns)
    return [
        {"turn": i + 1, "length": length, "gap_min": gap, "replicate": rep}
        for i, (length, gap, rep) in enumerate(turns)
    ], extra


def main():
    out = sys.argv[1]
    turns, extra = build()
    tsv = "turn\tlength\tgap_min\treplicate\n" + "".join(
        f"{t['turn']}\t{t['length']}\t{t['gap_min']}\t{t['replicate']}\n" for t in turns
    )
    with open(os.path.join(out, "schedule.tsv"), "w") as fh:
        fh.write(tsv)
    est_s = sum(EST_GEN_S[t["length"]] + t["gap_min"] * 60 + EST_OVERHEAD_S for t in turns)
    doc = {
        "seed": SEED,
        "python": sys.version.split()[0],
        "grid": {"lengths": LENGTHS, "gaps_min": GAPS_MIN, "replicates": REPLICATES},
        "extra_third_replicates": [{"length": l, "gap_min": g} for (l, g) in extra],
        "turns": len(turns),
        "estimated_minutes": round(est_s / 60),
        "schedule_sha256": hashlib.sha256(tsv.encode()).hexdigest(),
        "order": turns,
    }
    with open(os.path.join(out, "schedule.json"), "w") as fh:
        json.dump(doc, fh, indent=2)
    print(tsv, end="")
    print(f"turns={len(turns)} seed={SEED} est_min={doc['estimated_minutes']} "
          f"sha256={doc['schedule_sha256'][:16]}")


if __name__ == "__main__":
    main()
