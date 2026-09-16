#!/usr/bin/env python3
"""10-line battery summary. Do not dump full batterystats to chat."""
import csv
import pathlib
import re
import sys
from datetime import datetime

evid = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
rows = []
p = evid / "battery.csv"
if p.exists():
    with p.open(encoding="utf-8", errors="replace") as f:
        r = csv.DictReader(f)
        rows = list(r)


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_utc(s):
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return None


def stats(phase_sub):
    vals = []
    for row in rows:
        if phase_sub not in (row.get("phase") or ""):
            continue
        n = fnum(row.get("current_now_uA"))
        if n is not None:
            vals.append(n)
    if not vals:
        return "n/a", "n/a"
    mean = sum(vals) / len(vals)
    peak = min(vals)  # discharge is negative; peak drain = most negative
    return f"{mean:.0f}", f"{peak:.0f}"


levels = [fnum(r.get("level")) for r in rows if fnum(r.get("level")) is not None]
temps = [fnum(r.get("temp_deci")) for r in rows if fnum(r.get("temp_deci")) is not None]
times = [parse_utc(r.get("utc")) for r in rows]
times = [t for t in times if t]
start_level = int(levels[0]) if levels else None
end_level = int(levels[-1]) if levels else None
delta = (
    (end_level - start_level)
    if start_level is not None and end_level is not None
    else None
)
wall_min = ((times[-1] - times[0]).total_seconds() / 60.0) if len(times) >= 2 else 0.0
on_s = 0.0
off_s = 0.0
for i, row in enumerate(rows[:-1]):
    t0 = parse_utc(row.get("utc"))
    t1 = parse_utc(rows[i + 1].get("utc"))
    if not t0 or not t1:
        continue
    dt = (t1 - t0).total_seconds()
    if row.get("screen_on") == "1":
        on_s += dt
    else:
        off_s += dt
pred = 0
for i in range(1, 21):
    tel = evid / f"turn-{i}-tel.txt"
    if not tel.exists():
        continue
    m = re.search(r'"tokensPredicted":(\d+)', tel.read_text(encoding="utf-8", errors="replace"))
    if m:
        pred += int(m.group(1))
n_off = sum(1 for r in rows if r.get("screen_on") == "0")
md, pd = stats("decode")
mi, pi = stats("idle")
mp, pp = stats("prewarm")
lines = [
    f"start_level={start_level}",
    f"end_level={end_level}",
    f"delta_pct={delta}",
    f"wall_min={wall_min:.1f}",
    f"decode_now_mean/peak={md}/{pd} idle={mi}/{pi} prewarm={mp}/{pp}",
    f"peak_temp_deci={int(max(temps)) if temps else 'n/a'}",
    f"tokensPredicted_sum={pred}",
    f"screen_on_min={on_s / 60.0:.1f} screen_off_min={off_s / 60.0:.1f} screen_off_samples={n_off}",
    "keep_awake: KEYCODE_WAKEUP+collapse+swipe every <=20s; screen is a drain line item",
    f"contaminated={'YES screen_on=0 samples' if n_off else 'no screen_off samples'}",
]
text = "\n".join(lines) + "\n"
(evid / "battery-summary.txt").write_text(text, encoding="utf-8")
print(text, end="")
