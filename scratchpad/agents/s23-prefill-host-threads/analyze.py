#!/usr/bin/env python3
"""Per-arm decode heat for the sustained S23 session (1 Hz samples).

Same metric as s23-backend-hopping-heat's 9-arm repeat: temperature area above
the arm's start sample, from START to TAIL_END (decode + 90 s tail), divided
by the decoded tokens. Battery = HAL BAT, skin = HAL SKIN.
"""

import csv
import re
import statistics
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
TOKENS = 1024


def samples():
    with (OUT / "samples.tsv").open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    for row in rows:
        row["t"] = int(row["epoch_ns"]) / 1e9
    return rows


def markers():
    events = {}
    for line in (OUT / "markers.tsv").read_text().splitlines():
        cols = line.split("\t", 2)
        if len(cols) == 3:
            events[cols[1]] = (float(cols[0]), cols[2])
    return events


def value(row, key):
    raw = row.get(key)
    if raw in (None, "", "NA"):
        return None
    number = float(raw)
    return number / 1000 if number > 1000 else number


def area(window, key, base):
    points = [(r["t"], max(0.0, value(r, key) - base)) for r in window if value(r, key) is not None]
    return sum((t1 - t0) * (v0 + v1) / 2 for (t0, v0), (t1, v1) in zip(points, points[1:]))


def peak(window, prefixes):
    keys = [k for k in window[0] if k.startswith(prefixes)]
    vals = [value(r, k) for r in window for k in keys if value(r, k) is not None]
    return max(vals) if vals else float("nan")


def speed(tag):
    text = (OUT / f"{tag}.log").read_text(errors="replace")
    match = re.search(r"\|\s*pp1024\s*\|\s*([0-9.]+)", text)
    return float(match.group(1)) if match else float("nan"), "EXIT=0" in text


def main():
    rows, events = samples(), markers()
    arms = sorted((t, name[len("START_"):]) for name, (t, _) in events.items() if name.startswith("START_P-"))
    print("order\ttag\ttok_s\texit0\tbat_start\tbat_Cs_tok\tskin_start\tskin_Cs_tok\tpeak_cpu\tpeak_gpu\tpeak_nsp")
    per = {}
    for i, (start, tag) in enumerate(arms, 1):
        end = events.get("TAIL_END_" + tag, events.get("END_" + tag, (start, "")))[0]
        base = [r for r in rows if r["t"] <= start][-1]
        window = [base] + [r for r in rows if start < r["t"] <= end]
        tps, ok = speed(tag)
        bat = area(window, "hal_bat_C", value(base, "hal_bat_C")) / TOKENS
        skin = area(window, "skin_C", value(base, "skin_C")) / TOKENS
        backend = tag.split("-")[1]
        per.setdefault(backend, []).append((tps, bat, skin))
        print(f"{i}\t{tag}\t{tps:.2f}\t{ok}\t{value(base, 'hal_bat_C'):.1f}\t{bat:.4f}\t{value(base, 'skin_C'):.1f}\t{skin:.4f}\t"
              f"{peak(window, ('cpu-', 'cpuss-')):.1f}\t{peak(window, ('gpuss-',)):.1f}\t{peak(window, ('nspss-',)):.1f}")
    print("\nbackend\tn\ttok_s_med\tbat_Cs_tok_med (min-max)\tskin_Cs_tok_med (min-max)")
    for backend, vals in sorted(per.items()):
        t, b, s = zip(*vals)
        print(f"{backend}\t{len(vals)}\t{statistics.median(t):.2f}\t{statistics.median(b):.4f} ({min(b):.4f}-{max(b):.4f})\t"
              f"{statistics.median(s):.4f} ({min(s):.4f}-{max(s):.4f})")


main()
