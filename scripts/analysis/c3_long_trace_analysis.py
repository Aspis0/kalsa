#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from m5_route_trace_analysis import MIB, N_EXPERT, N_LAYER, CacheSim, build_batches, load_trace, parse_stdout
REPO = Path(__file__).resolve().parents[2]
DEFAULT_TRACE = REPO / "results" / "f4.8" / "traces" / "long_512.route.tsv"
DEFAULT_STDOUT = REPO / "results" / "f4.8" / "traces" / "long_512.stdout.txt"
DEFAULT_OUT = REPO / "results" / "f4.8" / "c3"
GATE_C_MIB = 2000.0
BLOCK = 64

class TrackLRU(CacheSim):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.batch_hits = []
    def batch(self, il, ids, decode):
        before_dl, before_dh = self.dec_lookups, self.dec_hits
        super().batch(il, ids, decode)
        self.batch_hits.append((decode, self.dec_lookups - before_dl, self.dec_hits - before_dh, il))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", type=Path, default=DEFAULT_TRACE)
    ap.add_argument("--stdout", type=Path, default=DEFAULT_STDOUT)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--short-policies", type=Path, default=REPO / "results" / "f4.8" / "m5" / "pass2_policies_C2000.tsv")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    tr = load_trace(args.trace)
    stdout = parse_stdout(args.stdout) if args.stdout.exists() else {}
    batches, n_prefill = build_batches(tr)
    budget = int(GATE_C_MIB * MIB)
    lru = CacheSim("lru", budget, tr["ebytes"]).run(batches, n_prefill)
    bel = CacheSim("belady", budget, tr["ebytes"]).run(batches, n_prefill)
    overall = {
        "n_events": tr["n"],
        "n_prefill_batches": n_prefill,
        "n_decode_batches": len(batches) - n_prefill,
        "gen_tokens_stdout": stdout.get("gen_tokens"),
        "measured_hit_pct": stdout.get("hit_pct"),
        "lru_cum": round(lru.hit_pct(), 3),
        "lru_dec": round(lru.dec_hit_pct(), 3),
        "belady_cum": round(bel.hit_pct(), 3),
        "belady_dec": round(bel.dec_hit_pct(), 3),
        "belady_minus_lru_dec": round(bel.dec_hit_pct() - lru.dec_hit_pct(), 3),
        "lru_dec_read_mib": round(lru.dec_read_bytes / MIB, 3),
        "belady_dec_read_mib": round(bel.dec_read_bytes / MIB, 3),
    }
    dec_steps = sorted({int(s) for s in tr["step"][tr["phase"] == 1]})
    overall["n_decode_steps"] = len(dec_steps)
    tsim = TrackLRU("lru", budget, tr["ebytes"]).run(batches, n_prefill)
    dec_records = [r for r in tsim.batch_hits if r[0]]
    n_dec_tok = len(dec_steps)
    per_tok_hits = []
    for ti in range(n_dec_tok):
        chunk = dec_records[ti * N_LAYER:(ti + 1) * N_LAYER]
        if len(chunk) < N_LAYER: break
        looks = sum(c[1] for c in chunk); hits = sum(c[2] for c in chunk)
        per_tok_hits.append((looks, hits))
    block_rows = []
    for b0 in range(0, len(per_tok_hits), BLOCK):
        chunk = per_tok_hits[b0:b0 + BLOCK]
        looks = sum(c[0] for c in chunk); hits = sum(c[1] for c in chunk)
        block_rows.append({"block_start_tok": b0, "block_end_tok": b0 + len(chunk) - 1, "n_tok": len(chunk), "lookups": looks, "hits": hits, "hit_pct": round(100.0 * hits / looks, 3) if looks else 0.0})
    by_step = defaultdict(set)
    for i in np.where(tr["phase"] == 1)[0]:
        st = int(tr["step"][i]); il = int(tr["layer"][i]); e = int(tr["expert"][i])
        by_step[st].add(il * N_EXPERT + e)
    cum = set(); n_seen_rows = []; full = []
    for k, st in enumerate(sorted(by_step)):
        cum |= by_step[st]; full.append(len(cum))
        if (k + 1) % 32 == 0 or k == 0 or k + 1 == len(by_step):
            n_seen_rows.append({"decode_tok_index": k + 1, "step": st, "unique_experts_cum": len(cum)})
    short_gap = {}
    if args.short_policies.exists():
        with args.short_policies.open() as f:
            header = f.readline().strip().split(chr(9))
            rows = [dict(zip(header, line.strip().split(chr(9)))) for line in f]
        for name in sorted({r["trace"] for r in rows}):
            l = next(r for r in rows if r["trace"] == name and r["policy"] == "lru")
            b = next(r for r in rows if r["trace"] == name and r["policy"] == "belady")
            short_gap[name] = round(float(b["hit_req_dec"]) - float(l["hit_req_dec"]), 3)
    short_mean = float(np.mean(list(short_gap.values()))) if short_gap else None
    hits_series = [r["hit_pct"] for r in block_rows]
    if len(hits_series) >= 2:
        q = max(1, len(hits_series) // 4)
        first = float(np.mean(hits_series[:q])); last = float(np.mean(hits_series[-q:]))
        trend = "sale" if last - first > 1.0 else ("scende" if first - last > 1.0 else "piatto")
        trend_delta = round(last - first, 3)
    else:
        trend = "n/a"; trend_delta = None; first = None; last = None
    summary = {
        "overall": overall,
        "block_hit_trend": {"trend": trend, "delta_pp_last_quarter_minus_first": trend_delta, "first_quarter_mean": first, "last_quarter_mean": last, "block_size_tok": BLOCK, "blocks": block_rows},
        "working_set": {"unique_at_end": full[-1] if full else None, "unique_at_64": full[63] if len(full) > 63 else None, "unique_at_256": full[255] if len(full) > 255 else None, "unique_at_512": full[511] if len(full) > 511 else (full[-1] if full else None), "n_decode_tokens": len(full)},
        "belady_gap_long": overall["belady_minus_lru_dec"],
        "belady_gap_short_mean": short_mean,
        "belady_gap_short_by_trace": short_gap,
        "stdout": stdout,
    }
    with (args.out / "block_hit_lru.tsv").open("w") as f:
        f.write("block_start_tok" + chr(9) + "block_end_tok" + chr(9) + "n_tok" + chr(9) + "lookups" + chr(9) + "hits" + chr(9) + "hit_pct" + chr(10))
        for r in block_rows:
            f.write("%d%s%d%s%d%s%d%s%d%s%s%s" % (r["block_start_tok"], chr(9), r["block_end_tok"], chr(9), r["n_tok"], chr(9), r["lookups"], chr(9), r["hits"], chr(9), r["hit_pct"], chr(10)))
    with (args.out / "working_set.tsv").open("w") as f:
        f.write("decode_tok_index" + chr(9) + "step" + chr(9) + "unique_experts_cum" + chr(10))
        for r in n_seen_rows:
            f.write("%d%s%d%s%d%s" % (r["decode_tok_index"], chr(9), r["step"], chr(9), r["unique_experts_cum"], chr(10)))
    with (args.out / "working_set_full.tsv").open("w") as f:
        f.write("decode_tok_index" + chr(9) + "unique_experts_cum" + chr(10))
        for i, v in enumerate(full, 1):
            f.write("%d%s%d%s" % (i, chr(9), v, chr(10)))
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
