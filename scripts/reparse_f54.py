#!/usr/bin/env python3
"""Reparse F5.4 cell logs: extract clean metrics from === perf === and CSV summary."""
import re, sys, csv, json
from pathlib import Path

PERF_RE = {
    "tokens": re.compile(r"generation:\s*(\d+)\s*tokens"),
    "s_tok": re.compile(r"generation:\s*\d+\s*tokens,\s*([0-9.]+)\s*s/token"),
    "tok_s": re.compile(r"\(([0-9.]+)\s*tok/s\)"),
    "n_prompt": re.compile(r"prefill:\s*(\d+)\s*tokens"),
    "prefill_s": re.compile(r"prefill:\s*\d+\s*tokens,\s*([0-9.]+)\s*s"),
    "prefill_tps": re.compile(r"prefill:.*? \(([0-9.]+)\s*tok/s\)"),
    "compute_s_tok": re.compile(r"compute\s+([0-9.]+)\s*\+\s*cache"),
    "io_s_tok": re.compile(r"flash I/O\s+([0-9.]+)\s*s/token"),
    "stall_s_tok": re.compile(r"stall\s+([0-9.]+)\s*s/token"),
    "read_mib": re.compile(r"read\s+([0-9.]+)\s*MiB"),
    "mib_tok": re.compile(r"\(([0-9.]+)\s*MiB/token\)"),
    "cache_hit": re.compile(r"moe-cache:\s*([0-9.]+)%\s*hit"),
    "cache_res": re.compile(r"resident\s+([0-9.]+)\s*MiB"),
    "load_s": re.compile(r"model load\s+([0-9.]+)\s*s"),
    "ttft_s": re.compile(r"TTFT\s+([0-9.]+)\s*s"),
}
SCHED_RE = re.compile(r"CPU compute buffer size\s*=\s*([0-9.]+)\s*MiB")

def parse_cell(outdir, cell):
    slog = outdir / f"{cell}.stdout.log"
    serr = outdir / f"{cell}.stderr.log"
    samp = outdir / f"{cell}.sampler.csv"
    meta = outdir / f"{cell}.meta.txt"
    out = {"cell": cell}
    text = ""
    if slog.exists():
        text += slog.read_text(encoding="utf-8", errors="replace")
    if serr.exists():
        text += "\n" + serr.read_text(encoding="utf-8", errors="replace")
    # prefer === perf === block
    m = re.search(r"=== perf ===(.*?)(?:\Z|\n===)", text, re.S)
    block = m.group(1) if m else text
    for k, rx in PERF_RE.items():
        mm = rx.search(block)
        if mm:
            out[k] = mm.group(1)
    # csv summary line
    metrics = outdir / f"{cell}.metrics.csv"
    if metrics.exists():
        for line in metrics.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("# summary"):
                for part in line[2:].split():
                    if "=" in part:
                        k,v = part.split("=",1)
                        out[f"sum_{k}"] = v
    sm = SCHED_RE.search(text)
    if sm:
        out["sched_reserve_mib"] = sm.group(1)
    # sampler
    if samp.exists():
        f0=[];f3=[];f5=[];f7=[];dies=[];rsss=[]
        for line in samp.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
            p=line.split(",")
            if len(p)<8: continue
            try:
                dies.append(float(p[1])); rsss.append(float(p[4]))
                f0.append(float(p[5])); f3.append(float(p[6])); f5.append(float(p[7])); f7.append(float(p[8]) if len(p)>8 else 0)
            except: continue
        def avg(a): return sum(a)/len(a) if a else 0.0
        out["die_max"] = max(dies) if dies else None
        out["rss_peak"] = max(rsss) if rsss else None
        out["cur_freq0"] = avg(f0); out["cur_freq3"]=avg(f3); out["cur_freq5"]=avg(f5); out["cur_freq7"]=avg(f7)
        out["cur_freq_prime"] = out["cur_freq3"] if out["cur_freq3"]>=out["cur_freq5"] else out["cur_freq5"]
        cst = float(out.get("compute_s_tok") or out.get("sum_compute_s/tok") or 0)
        out["work"] = cst * out["cur_freq_prime"]
    if meta.exists():
        for line in meta.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in line:
                k,v=line.split("=",1); out[f"meta_{k}"]=v
    return out

def main(root):
    root=Path(root)
    rows=[]
    for sub in ["c","d1","b","d2"]:
        d=root/sub
        if not d.exists(): continue
        for meta in sorted(d.glob("*.meta.txt")):
            cell=meta.name.replace(".meta.txt","")
            rows.append(parse_cell(d, cell))
    outp=root/"cells_reparsed.csv"
    if not rows:
        print("no rows"); return
    keys=sorted({k for r in rows for k in r})
    with open(outp,"w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f, fieldnames=keys)
        w.writeheader(); w.writerows(rows)
    print(f"wrote {outp} n={len(rows)}")
    for r in rows:
        print(r.get("cell"), "hit=", r.get("cache_hit") or r.get("sum_cache_hit_pct"),
              "compute=", r.get("compute_s_tok") or r.get("sum_compute_s/tok"),
              "prefill_tps=", r.get("prefill_tps") or r.get("sum_prefill_tps"),
              "tok_s=", r.get("tok_s") or r.get("sum_tok/s"),
              "work=", r.get("work"), "freq=", r.get("cur_freq_prime"))

if __name__=="__main__":
    main(sys.argv[1] if len(sys.argv)>1 else ".")
