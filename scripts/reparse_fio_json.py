#!/usr/bin/env python3
"""Reparse fio job JSON files (strip leading warnings) into fio_runs.csv."""
import csv
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

jobs = Path.home() / "experiments/fio/jobs"
out = Path.home() / "experiments/results/fio_runs.csv"
rows = []

for jp in sorted(jobs.glob("fio-*.json")):
    raw = jp.read_text(errors="replace")
    i = raw.find("{")
    if i < 0:
        print("no json", jp.name)
        continue
    try:
        d = json.loads(raw[i:])
    except Exception as e:
        print("parse fail", jp.name, e)
        continue
    if not d.get("jobs"):
        print("no jobs", jp.name)
        continue
    j = d["jobs"][0]
    r = j.get("read", {})
    bw = r.get("bw")  # KiB/s
    iops = r.get("iops")
    lat = (r.get("lat_ns") or {}).get("mean")
    if lat is None:
        lat = (r.get("clat_ns") or {}).get("mean")
    p99 = None
    pct = (r.get("clat_ns") or {}).get("percentile") or (r.get("lat_ns") or {}).get("percentile") or {}
    for k in ("99.000000", "99.0", "99"):
        if k in pct:
            p99 = pct[k]
            break
    m = re.match(r"fio-([0-9]+[km])-qd(\d+)-r(\d+)-(\d+-\d+)", jp.stem)
    if not m:
        print("bad name", jp.name)
        continue
    bs, qd, rep = m.group(1), m.group(2), m.group(3)
    bw_mib = (float(bw) / 1024.0) if bw is not None else None
    lat_us = (float(lat) / 1000.0) if lat is not None else None
    p99_us = (float(p99) / 1000.0) if p99 is not None else None
    rows.append(
        {
            "run_id": jp.stem,
            "date": d.get("time", ""),
            "phase": "F2.1",
            "bs": bs,
            "iodepth": qd,
            "rep": rep,
            "size": "2G",
            "runtime_s": "20",
            "bw_kib_s": "" if bw is None else f"{float(bw):.3f}".rstrip("0").rstrip("."),
            "bw_mib_s": "" if bw_mib is None else f"{bw_mib:.3f}",
            "iops": "" if iops is None else f"{float(iops):.6f}".rstrip("0").rstrip("."),
            "lat_mean_us": "" if lat_us is None else f"{lat_us:.6f}".rstrip("0").rstrip("."),
            "lat_p99_us": "" if p99_us is None else f"{p99_us:.6f}".rstrip("0").rstrip("."),
            "batt_temp_start": "",
            "batt_temp_end": "",
            "plugged": "UNPLUGGED",
            "data_path": str(Path.home() / "experiments/fio/fio_randread.bin"),
            "notes": "F2.1 reparsed from json; direct=1; NO_SHM; materialized; psync",
        }
    )

fields = [
    "run_id",
    "date",
    "phase",
    "bs",
    "iodepth",
    "rep",
    "size",
    "runtime_s",
    "bw_kib_s",
    "bw_mib_s",
    "iops",
    "lat_mean_us",
    "lat_p99_us",
    "batt_temp_start",
    "batt_temp_end",
    "plugged",
    "data_path",
    "notes",
]
out.parent.mkdir(parents=True, exist_ok=True)
with out.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)
print("wrote", len(rows), "rows to", out)

g = defaultdict(list)
for r in rows:
    if r["bw_mib_s"]:
        g[(r["bs"], r["iodepth"])].append(float(r["bw_mib_s"]))
print("median bw_mib_s:")
for bs in ["4k", "16k", "64k", "256k", "1m"]:
    for qd in ["1", "4"]:
        vals = sorted(g.get((bs, qd), []))
        if not vals:
            print(f"  bs={bs:4s} qd={qd}  n=0  MISSING")
        else:
            med = statistics.median(vals)
            vs = ",".join(f"{v:.3f}" for v in vals)
            print(f"  bs={bs:4s} qd={qd}  n={len(vals)}  median={med:.3f}  vals={vs}")
