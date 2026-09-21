#!/usr/bin/env python3
"""Summarize bench-out/results.tsv into per-arm medians with spread.

Prints one block per arm: n, and median [min-max] for each metric, plus the
engine-internal mode and the contamination record, so no timing can be read
without the daemon background that carried it.
"""
import csv, statistics as st, sys, os

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "bench-out", "results.tsv")
rows = list(csv.DictReader(open(path), delimiter="\t"))


def f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def med(vals):
    v = [x for x in vals if x is not None]
    if not v:
        return "NA"
    m = st.median(v)
    if len(v) == 1:
        return f"{m:.3g} (n=1)"
    return f"{m:.3g} [{min(v):.3g}-{max(v):.3g}]"


arms = []
for r in rows:
    if r["arm"] not in arms:
        arms.append(r["arm"])

for a in arms:
    g = [r for r in rows if r["arm"] == a]
    modes = sorted({r["mode_no_extra_bufts"] for r in g if r["mode_no_extra_bufts"]})
    refusals = [r for r in g if r.get("refusedBy")]
    print(f"\n=== {a}  model={g[0]['model']}  norepack={g[0]['norepack']} "
          f"engine_no_extra_bufts={','.join(modes) or 'NA'}  n={len(g)} ===")
    if refusals:
        print(f"  REFUSED by gate: refusedBy={refusals[0]['refusedBy']} reasonKey={refusals[0]['reasonKey']} "
              f"({len(refusals)}/{len(g)} runs)")
    prefill = [1000 * f(r["prompt_n"]) / f(r["prompt_ms"]) if f(r["prompt_n"]) and f(r["prompt_ms"]) else None for r in g]
    print(f"  load_wall_s            {med([f(r['load_wall_s']) for r in g])}")
    print(f"  prefill_ms             {med([f(r['prompt_ms']) for r in g])}")
    print(f"  prefill_tok/s          {med(prefill)}")
    print(f"  decode_tok/s           {med([f(r['predicted_per_s']) for r in g])}")
    print(f"  decode_tokens          {med([f(r['predicted_n']) for r in g])}")
    print(f"  peak_RssAnon_MiB       {med([f(r['peak_anon_kb']) / 1024 if f(r['peak_anon_kb']) else None for r in g])}")
    print(f"  peak_RssFile_MiB       {med([f(r['peak_file_kb']) / 1024 if f(r['peak_file_kb']) else None for r in g])}")
    print(f"  peak_Mlocked_MiB       {med([f(r['peak_mlocked_kb']) / 1024 if f(r['peak_mlocked_kb']) else None for r in g])}")
    print(f"  majflt_delta           {med([f(r['majflt_delta']) for r in g])}")
    print(f"  MemAvailable_pre_MiB   {med([f(r['memavail_pre_kb']) / 1024 if f(r['memavail_pre_kb']) else None for r in g])}")
    print(f"  temp_pre_deciC         {med([f(r['temp_pre_deciC']) for r in g])}")
    print(f"  temp_post_deciC        {med([f(r['temp_post_deciC']) for r in g])}")
    print(f"  battery level pre->post {med([f(r['level_pre']) for r in g])} -> {med([f(r['level_post']) for r in g])}")
    print(f"  adsprpcd %CPU s->e     {med([f(r['adsprpcd_pct_start']) for r in g])} -> {med([f(r['adsprpcd_pct_end']) for r in g])}")
    print(f"  loadavg s->e           {med([f(r['loadavg_start']) for r in g])} -> {med([f(r['loadavg_end']) for r in g])}")
    print(f"  swap_used_kb s->e      {med([f(r['swap_used_kb_start']) for r in g])} -> {med([f(r['swap_used_kb_end']) for r in g])}")
    print(f"  gguf_vma               {g[0]['gguf_vma'] or 'none'}")
