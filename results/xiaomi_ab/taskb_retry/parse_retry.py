#!/usr/bin/env python3
"""Parse Task B retry logs. Engine .out is ground truth for t/s / majflt/tok."""
from __future__ import annotations

import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG = ROOT / "logs"


def grab(pat: str, text: str, default: str = "NA") -> str:
    m = re.search(pat, text, re.S)
    return m.group(1) if m else default


def parse_out(path: Path) -> dict:
    t = path.read_text(encoding="utf-8", errors="replace")
    return {
        "decode_tps": grab(r"generation: .*?\(([0-9.]+) tok/s\)", t),
        "s_per_tok": grab(r"generation: .*?([0-9.]+) s/token", t),
        "n_gen": grab(r"generation: ([0-9]+) tokens", t),
        "mib_per_tok": grab(r"\(([0-9.]+) MiB/token\)", t),
        "hit_pct": grab(r"moe-cache: ([0-9.]+)% hit", t),
        "ttft_s": grab(r"TTFT ([0-9.]+) s", t),
        "load_s": grab(r"model load ([0-9.]+) s", t),
        "compute_s": grab(r"compute ([0-9.]+) \+ cache", t),
        "flash_s": grab(r"flash I/O ([0-9.]+) s/token", t),
        "flash_mibs": grab(r"flash I/O [0-9.]+ s/token, ([0-9.]+) MiB/s", t),
        "cpu_occ": grab(r"([0-9.]+)% CPU occupancy", t),
        "eng_majflt_tok": grab(r"([0-9.]+) major faults/token", t),
        "drop_pct": grab(r"moe-drop: .*?\(([0-9.]+)%\)", t),
        "resident_mib": grab(r"resident ([0-9.]+) MiB", t),
    }


def mem_stats(path: Path) -> dict:
    if not path.exists():
        return {}
    rows = []
    with path.open(encoding="utf-8", errors="replace") as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                rows.append(int(row["memavail_kib"]))
            except (KeyError, ValueError):
                continue
    if not rows:
        return {}
    return {
        "ma_min": min(rows),
        "ma_max": max(rows),
        "ma_last": rows[-1],
        "n_samples": len(rows),
    }


def main() -> None:
    tags = [
        "t6_fact_o1",
        "t6_creative_o2",
        "t6_creative_o3",
        "t6_fact_o4",
        "t4_fact_ref",
        "t4_creative_ref",
    ]
    print(
        "tag,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,n_gen,"
        "compute_s,flash_s,flash_mibs,cpu_occ,eng_majflt_tok,drop_pct,"
        "resident_mib,ma_min_kib,ma_max_kib,n_samples"
    )
    for tag in tags:
        op = LOG / f"{tag}.out"
        if not op.exists():
            print(f"{tag},MISSING")
            continue
        d = parse_out(op)
        m = mem_stats(ROOT / "curves" / f"{tag}_mem.csv")
        print(
            ",".join(
                [
                    tag,
                    d["decode_tps"],
                    d["mib_per_tok"],
                    d["hit_pct"],
                    d["ttft_s"],
                    d["load_s"],
                    d["n_gen"],
                    d["compute_s"],
                    d["flash_s"],
                    d["flash_mibs"],
                    d["cpu_occ"],
                    d["eng_majflt_tok"],
                    d["drop_pct"],
                    d["resident_mib"],
                    str(m.get("ma_min", "")),
                    str(m.get("ma_max", "")),
                    str(m.get("n_samples", "")),
                ]
            )
        )


if __name__ == "__main__":
    main()
