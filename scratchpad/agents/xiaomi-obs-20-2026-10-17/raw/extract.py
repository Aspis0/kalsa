#!/usr/bin/env python3
"""Build raw/observations.jsonl for the xiaomi-obs-20 cell from a pulled file.

The app appends every completion to files/governor/observations.jsonl and never
truncates it, so the pull contains three vintages:

  * 8 rows from the 2026-10-15 scripted campaign (APK aa789620, binding 861a3cc3)
  * 2 rows from the owner's own use later that day (one of them TAKING PLUGGED)
  * this cell's normal-use rows (binding d4754cb5)

`wall` is SystemClock.uptimeMillis() - boot-relative, excludes deep sleep, and is
NOT comparable to /proc/uptime (the overnight doze makes them drift apart by
hours), so the session boundary is a wall[] threshold taken from the first row of
this cell, not a wall-clock conversion. Usage:

    python3 extract.py <pulled.jsonl> <out.jsonl> [boundary_wall0_ms]
"""
import json
import sys

# First row written by this cell (turn 1, 2026-10-17 00:36) was wall[0]=382479542.
# Anything below that wall clock is a pre-existing row.
DEFAULT_BOUNDARY = 380_000_000


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    boundary = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_BOUNDARY

    rows, dropped = [], []
    for lineno, line in enumerate(open(src), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        try:
            wall0 = row["wall"][0]
        except (KeyError, TypeError, IndexError):
            dropped.append((lineno, row, "no wall pair"))
            continue
        if wall0 < boundary:
            dropped.append((lineno, row, "pre-session"))
        else:
            rows.append(row)

    keep = [r for r in rows if r.get("plugged") == 0 and r.get("gap") != 1]
    keep.sort(key=lambda r: r["wall"][0])

    with open(dst, "w") as out:
        for r in keep:
            out.write(json.dumps(r) + "\n")

    print(f"source lines      : {sum(1 for l in open(src) if l.strip())}")
    print(f"pre-session rows  : {sum(1 for _, _, why in dropped if why == 'pre-session')}")
    print(f"this-session rows : {len(rows)}")
    print(f"plugged rows dropped: {sum(1 for r in rows if r.get('plugged') != 0)}")
    print(f"gap rows dropped  : {sum(1 for r in rows if r.get('gap') == 1)}")
    print(f"written (unplugged, non-gap): {len(keep)} -> {dst}")
    print()
    print(f"{'#':>3} {'t':>2} {'rd':>2} {'pred_n':>7} {'wall_s':>8} {'min':>6} {'state':>5} "
          f"{'plug':>4} {'lvl':>3} {'batt':>5} {'gap':>3}")
    for i, r in enumerate(keep):
        mins = (r["wall"][1] - r["wall"][0]) / 60000.0
        print(f"{i:>3} {str(r.get('t')):>2} {r.get('round', 0):>2} {r.get('pred_n'):>7} "
              f"{r['wall'][0] / 1000:>8.0f} {mins:>6.2f} {str(r.get('state')):>5} "
              f"{r.get('plugged'):>4} {r.get('level'):>3} {r.get('batt'):>5} {r.get('gap'):>3}")
    return 0 if len(keep) >= 20 else 1


if __name__ == "__main__":
    sys.exit(main())