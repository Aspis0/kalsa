#!/usr/bin/env python3
"""Per-turn heat for the in-app decode-hop session.

Window = the turn's send time to send + dur (the harness's own timestamps),
plus a 30 s tail. Heat = temperature area above the sample at send, divided
by the turn's tokensPredicted (prefill is the same NPU work in both arms).
"""

import csv
import json
import re
import statistics
import sys
from pathlib import Path

RAW = Path(sys.argv[1])
TAIL_S = 30


def samples():
    with (RAW / "device-out" / "samples.tsv").open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    for row in rows:
        row["t"] = int(row["epoch_ns"]) / 1e9
    return rows


def value(row, key):
    raw = row.get(key)
    if raw in (None, "", "NA"):
        return None
    number = float(raw)
    return number / 1000 if number > 1000 else number


def area(window, key, base):
    pts = [(r["t"], max(0.0, value(r, key) - base)) for r in window if value(r, key) is not None]
    return sum((t1 - t0) * (a + b) / 2 for (t0, a), (t1, b) in zip(pts, pts[1:]))


def peak(window, prefixes):
    keys = [k for k in window[0] if k.startswith(prefixes)]
    vals = [value(r, k) for r in window for k in keys if value(r, k) is not None]
    return max(vals) if vals else float("nan")


def tagged_json(path, tag):
    lines = [l for l in path.read_text(errors="replace").splitlines() if f"{tag} {{" in l]
    return json.loads(lines[-1].split(f"{tag} ", 1)[1]) if lines else {}


def main():
    rows = samples()
    per = {}
    print("turn\tarm\ttok_pred\tdecode_tok_s\thops\tcpu_tok\tnpu_tok\thop_ms\tbat_start\tbat_Cs_tok\tskin_Cs_tok\tpeak_cpu\tpeak_nsp\tpeak_gpu")
    for out in sorted(RAW.glob("hop-*-[0-9].out")):
        label = out.stem
        arm = label.split("-")[1]
        send = int((RAW / f"{label}-sendtime.txt").read_text().strip())
        dur = int(re.search(r"dur=(\d+)s", out.read_text()).group(1))
        tel = tagged_json(RAW / f"{label}-kalsa.txt", "KALSA_TELEMETRY")
        gov = tagged_json(RAW / f"{label}-kalsa.txt", "KALSA_GOVERNOR")
        base = [r for r in rows if r["t"] <= send][-1]
        window = [base] + [r for r in rows if send < r["t"] <= send + dur + TAIL_S]
        tokens = tel.get("tokensPredicted", 0) or 1
        bat = area(window, "hal_bat_C", value(base, "hal_bat_C")) / tokens
        skin = area(window, "skin_C", value(base, "skin_C")) / tokens
        per.setdefault(arm, []).append((tel.get("predictedPerSecond", float("nan")), bat, skin,
                                        peak(window, ("cpu-", "cpuss-")), peak(window, ("nspss-",))))
        print(f"{label}\t{arm}\t{tokens}\t{tel.get('predictedPerSecond', float('nan')):.2f}\t{gov.get('decode_hops')}\t"
              f"{gov.get('decode_tokens_cpu')}\t{gov.get('decode_tokens_npu')}\t{gov.get('decode_hop_commit_ms')}\t"
              f"{value(base, 'hal_bat_C'):.1f}\t{bat:.4f}\t{skin:.4f}\t{peak(window, ('cpu-', 'cpuss-')):.1f}\t"
              f"{peak(window, ('nspss-',)):.1f}\t{peak(window, ('gpuss-',)):.1f}")
    print("\narm\tn\tdecode_tok_s_med\tbat_Cs_tok_med (min-max)\tskin_Cs_tok_med\tpeak_cpu_med\tpeak_nsp_med")
    for arm, vals in sorted(per.items()):
        t, b, s, c, n = zip(*vals)
        print(f"{arm}\t{len(vals)}\t{statistics.median(t):.2f}\t{statistics.median(b):.4f} ({min(b):.4f}-{max(b):.4f})\t"
              f"{statistics.median(s):.4f}\t{statistics.median(c):.1f}\t{statistics.median(n):.1f}")


main()
