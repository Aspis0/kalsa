#!/usr/bin/env python3
"""Turn the multi-device-shape runs into the tables for MULTI-DEVICE-SHAPE.md.

Reads dev/results/multi-device-shape/<run>/results.json (+memory.txt) and
prints markdown. No per-token KV constants anywhere: memory rows are quoted
from the servers' own load lines.
"""

import json
import statistics
import sys
from pathlib import Path

BASE = Path("/Users/marco/Projects/kalsa-brain/dev/results/multi-device-shape")
ORDER = ["A-2p", "A-4p", "B2-2p", "B2-4p", "B4-2p", "B4-4p", "U-2p", "U-4p",
         "CLIFF-B4", "CLIFF-A", "CLIFF2-B4", "CLIFF2-A", "B2-8k", "U-16k"]
NAMES = {
    "A": "--parallel 1 (one slot, the app today)",
    "B2": "--parallel 2",
    "B4": "--parallel 4",
    "U": "auto slots (becomes --parallel 4 + kv_unified)",
    "CLIFF-B4": "--parallel 4, oversized conversation",
    "CLIFF-A": "--parallel 1, oversized conversation",
    "CLIFF2-B4": "--parallel 4, overflowing conversation",
    "CLIFF2-A": "--parallel 1, overflowing conversation",
    "B2-8k": "--parallel 2, four ~8k conversations",
    "U-16k": "unified pool, two ~16k conversations",
}


def family(run: str) -> str:
    return run.split("-")[0] if not run.startswith("CLIFF") else run


def warm_stats(reqs: list) -> tuple:
    """Over non-first turns of each phone: reuse ratio and cold-turn count."""
    ratios, cold, n = [], 0, 0
    per_phone_turn = {}
    for r in reqs:
        per_phone_turn.setdefault(r["phone"], []).append(r)
    for phone, rs in per_phone_turn.items():
        for r in rs[1:]:  # turn 0 is first contact: nothing to reuse
            n += 1
            if r["cached_tokens"] is None:
                continue
            ratio = r["cached_tokens"] / max(r["prompt_tokens"], 1)
            ratios.append(ratio)
            if r["cached_tokens"] <= 32:
                cold += 1
    med = statistics.median(ratios) if ratios else float("nan")
    return med, cold, n


def main() -> None:
    out = []
    data = {}
    for run in ORDER:
        d = BASE / run
        f = d / "results.json"
        if not f.exists():
            print(f"missing {run}", file=sys.stderr)
            continue
        data[run] = json.loads(f.read_text())

    out.append("## Wall clock, TTFT, queue\n")
    out.append("| run | shape | phones | wall s | TTFT avg ms | TTFT max ms | "
               "TTFT of last-served request ms | max requests_deferred | max requests_processing |")
    out.append("|---|---|---:|---:|---:|---:|---:|---:|---:|")
    for run, d in data.items():
        reqs = d["requests"]
        ttfts = sorted(r["ttft_ms"] for r in reqs if r.get("ttft_ms") is not None)
        last_served = max(ttfts) if ttfts else None  # the queue's tail IS the max TTFT
        out.append(
            f"| {run} | {NAMES[family(run)]} | {d['phones']} | {d['wall_s']} | "
            f"{round(statistics.mean(ttfts)) if ttfts else '-'} | {max(ttfts) if ttfts else '-'} | {last_served if last_served else '-'} | "
            f"{d['metrics']['max_deferred']} | {d['metrics']['max_processing']} |")

    out.append("\n## Warm context survival (same phone, turns 2..3)\n")
    out.append("| run | phones | median cached/prompt over non-first turns | cold turns (cached ≤ 32) | non-first turns |")
    out.append("|---|---:|---:|---:|---:|")
    for run, d in data.items():
        med, cold, n = warm_stats(d["requests"])
        out.append(f"| {run} | {d['phones']} | {med:.2f} | {cold}/{n} | {n} |")

    out.append("\n## Per-request cached_tokens, 4-phone runs\n")
    out.append("| run | per phone: cached/prompt by turn (t0, t1, t2) |")
    out.append("|---|---|")
    for run, d in data.items():
        if d["phones"] != 4:
            continue
        cols = {}
        for r in d["requests"]:
            cols.setdefault(r["phone"], []).append(f"{r['cached_tokens']}/{r['prompt_tokens']}")
        cells = " <br> ".join(
            f"phone{p}: " + ", ".join(cols[p]) for p in sorted(cols))
        out.append(f"| {run} | {cells} |")

    out.append("\n## Memory at load — the servers' own lines, quoted\n")
    out.append("| run | slot init line | KV lines | compute lines |")
    out.append("|---|---|---|---|")
    for run in ORDER:
        mem = BASE / run / "memory.txt"
        if not mem.exists():
            continue
        lines = [l.strip() for l in mem.read_text().splitlines() if l.strip()]
        init = next((l for l in lines if "n_slots" in l), "")
        kv = [l for l in lines if "llama_kv_cache: size" in l]
        comp = [l for l in lines if "compute buffer" in l]
        out.append(f"| {run} | `{init.split('I ')[-1] if init else ''}` | "
                   + " <br> ".join(f"`{k.split('I ')[-1]}`" for k in kv)
                   + " | " + " <br> ".join(f"`{c.split('I ')[-1]}`" for c in comp) + " |")

    text = "\n".join(out)
    print(text)
    (BASE / "summary.md").write_text(text + "\n")


if __name__ == "__main__":
    main()
