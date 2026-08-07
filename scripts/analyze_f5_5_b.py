#!/usr/bin/env python3
"""Reparse F5.5-B metrics and emit quality comparison material."""
from __future__ import annotations

import csv
import re
import statistics as st
from collections import defaultdict
from pathlib import Path

BASE = Path("results/f5.5/b")
ORDER = [
    "short",
    "f45_1_esplicativo",
    "f45_2_scrittura",
    "f45_3_istruzioni",
    "f45_4_codice",
    "f45_5_ragionamento",
    "long_conversational_it",
    "d1_long",
]


def parse_meta(path: Path) -> dict:
    d: dict = {}
    text = path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        if line.startswith("prompt="):
            m = re.search(r"prompt=(\S+)\s+k=(\d+)", line)
            if m:
                d["prompt"] = m.group(1)
                d["k"] = int(m.group(2))
        if line.startswith("cache_hit="):
            m = re.search(r"cache_hit=([0-9.]+)", line)
            if m:
                d["cache_hit_meta"] = float(m.group(1))
            m = re.search(r"read_mib=([0-9.]+)", line)
            if m:
                d["read_mib_meta"] = float(m.group(1))
        if line.startswith("n_prompt="):
            m = re.search(r"n_prompt=([0-9]+)", line)
            if m:
                d["n_prompt"] = int(m.group(1))
            m = re.search(r"tokens=([0-9]+)", line)
            if m:
                d["tokens"] = int(m.group(1))
            m = re.search(r"gen_chars=([0-9]+)", line)
            if m:
                d["gen_chars_meta"] = int(m.group(1))
        if line.startswith("cache_mb="):
            m = re.search(r"cache_mb=([0-9]+)", line)
            if m:
                d["cache_mb"] = int(m.group(1))
            m = re.search(r"ubatch=([0-9]+)", line)
            if m:
                d["ubatch"] = int(m.group(1))
        if line.startswith("stopped="):
            d["stopped"] = line.split("=", 1)[1].strip()
        if line.startswith("rc="):
            m = re.search(r"rc=([0-9-]+)", line)
            if m:
                d["rc"] = int(m.group(1))
            m = re.search(r"elapsed_s=([0-9]+)", line)
            if m:
                d["elapsed_s"] = int(m.group(1))
        if "n_expert_used_hdr=" in line:
            m = re.search(r"n_expert_used_hdr=(\S+)", line)
            if m:
                d["n_expert_used_hdr"] = m.group(1)
        if line.startswith("die_start="):
            m = re.search(r"die_max=([0-9.]+)", line)
            if m:
                d["die_max"] = float(m.group(1))
    return d


def parse_perf(cell: str) -> dict:
    out: dict = {}
    for side in (".stdout", ".stderr"):
        p = BASE / f"{cell}{side}"
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"read\s+([0-9.]+)\s+MiB\s+\(([0-9.]+)\s+MiB/token\)", t)
        if m:
            out["read_mib"] = float(m.group(1))
            out["mib_tok"] = float(m.group(2))
        m = re.search(r"moe-cache:\s+([0-9.]+)%\s+hit", t)
        if m:
            out["cache_hit"] = float(m.group(1))
        m = re.search(r"generation:\s+(\d+)\s+tokens", t)
        if m:
            out["tokens"] = int(m.group(1))
        m = re.search(r"prefill:\s+(\d+)\s+tokens", t)
        if m:
            out["n_prompt"] = int(m.group(1))
    mcp = BASE / f"{cell}.metrics.csv"
    if mcp.exists():
        head = "\n".join(mcp.read_text(encoding="utf-8", errors="replace").splitlines()[:6])
        m = re.search(r"n_expert_used=(\d+)", head)
        if m:
            out["n_expert_used"] = int(m.group(1))
        m = re.search(r"n_ubatch=(\d+)", head)
        if m:
            out["ubatch"] = int(m.group(1))
        m = re.search(r"cache_mb=(\d+)", head)
        if m:
            out["cache_mb"] = int(m.group(1))
    return out


def main() -> None:
    rows = []
    for meta in sorted(BASE.glob("*.meta")):
        cell = meta.stem
        d = parse_meta(meta)
        perf = parse_perf(cell)
        genp = BASE / f"{cell}.gen.txt"
        gen = genp.read_text(encoding="utf-8", errors="replace") if genp.exists() else ""
        prompt = d.get("prompt", cell.rsplit("-k", 1)[0])
        k = int(d.get("k", cell.rsplit("-k", 1)[-1]))
        tokens = perf.get("tokens", d.get("tokens", 0))
        read = perf.get("read_mib", d.get("read_mib_meta"))
        mib = perf.get("mib_tok")
        if mib is None and read and tokens:
            mib = round(float(read) / max(int(tokens), 1), 3)
        hit = perf.get("cache_hit", d.get("cache_hit_meta"))
        n_prompt = perf.get("n_prompt", d.get("n_prompt", 0))
        rows.append(
            {
                "cell": cell,
                "prompt": prompt,
                "k": k,
                "n_prompt": n_prompt,
                "tokens": tokens,
                "cache_hit": hit,
                "mib_tok": mib,
                "read_mib": read,
                "cache_mb": perf.get("cache_mb", d.get("cache_mb")),
                "ubatch": perf.get("ubatch", d.get("ubatch")),
                "n_expert_used": perf.get("n_expert_used"),
                "gen_chars": len(gen),
                "gen": gen,
                "stopped": d.get("stopped", "?"),
                "die_max": d.get("die_max"),
                "elapsed_s": d.get("elapsed_s"),
            }
        )

    out_csv = BASE / "cells_fixed.csv"
    fields = [
        "cell",
        "prompt",
        "k",
        "n_prompt",
        "tokens",
        "cache_hit",
        "mib_tok",
        "read_mib",
        "cache_mb",
        "ubatch",
        "n_expert_used",
        "gen_chars",
        "stopped",
        "die_max",
        "elapsed_s",
    ]
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fields})

    print("prompt | k | hit% | mib_tok | n_prompt | tokens | gen_chars | n_expert | die_max")
    print("-" * 100)
    for r in sorted(
        rows,
        key=lambda x: (
            ORDER.index(x["prompt"]) if x["prompt"] in ORDER else 99,
            -x["k"],
        ),
    ):
        print(
            f"{r['prompt']:24s} | {r['k']:2d} | {r['cache_hit']:5.1f} | {r['mib_tok']:7.2f} | "
            f"{r['n_prompt']:4d} | {r['tokens']:4d} | {r['gen_chars']:4d} | "
            f"{r['n_expert_used']} | {r.get('die_max')}"
        )

    byk: dict[int, list] = defaultdict(list)
    for r in rows:
        byk[r["k"]].append(r)
    print("\n=== means by k (all prompts) ===")
    for k in sorted(byk):
        hits = [r["cache_hit"] for r in byk[k] if r["cache_hit"] is not None]
        mibs = [r["mib_tok"] for r in byk[k] if r["mib_tok"] is not None]
        print(
            f"k={k}: n={len(byk[k])} hit mean={st.mean(hits):.1f} med={st.median(hits):.1f}  "
            f"mib_tok mean={st.mean(mibs):.2f} med={st.median(mibs):.2f}"
        )

    # pairwise diffs k8 vs others
    print("\n=== pairwise text diffs (k8 vs kN) ===")
    for p in ORDER:
        refs = {r["k"]: r for r in rows if r["prompt"] == p}
        ref = refs[8]
        for k in (6, 5, 4):
            o = refs[k]
            a, b = ref["gen"], o["gen"]
            # first difference index
            n = min(len(a), len(b))
            i = 0
            while i < n and a[i] == b[i]:
                i += 1
            same_prefix = i
            identical = a == b
            print(
                f"{p}: k8 vs k{k}: identical={identical} len {len(a)}/{len(b)} "
                f"common_prefix={same_prefix} chars"
            )
            if not identical:
                print(f"  k8@{same_prefix}: {a[same_prefix:same_prefix+60]!r}")
                print(f"  k{k}@{same_prefix}: {b[same_prefix:same_prefix+60]!r}")
                print(f"  k8 head: {a[:120]!r}")
                print(f"  k{k} head: {b[:120]!r}")

    # dump full gens for report (truncated markers)
    dump = BASE / "quality_compare.txt"
    with dump.open("w", encoding="utf-8") as f:
        for p in ORDER:
            f.write(f"\n{'='*80}\nPROMPT {p}\n{'='*80}\n")
            for k in (8, 6, 5, 4):
                r = next(x for x in rows if x["prompt"] == p and x["k"] == k)
                f.write(
                    f"\n--- {p}-k{k} hit={r['cache_hit']} mib={r['mib_tok']} "
                    f"tokens={r['tokens']} chars={r['gen_chars']} ---\n"
                )
                f.write(r["gen"])
                f.write("\n")
    print(f"\nwrote {out_csv}")
    print(f"wrote {dump}")


if __name__ == "__main__":
    main()
