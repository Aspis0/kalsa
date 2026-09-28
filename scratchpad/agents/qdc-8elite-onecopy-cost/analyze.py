#!/usr/bin/env python3
"""Analyzer for qdc-8elite-onecopy-cost. Usage: analyze.py <device-out dir>
Reads markers.txt, per-unit .out (llama-bench jsonl) / .err (log) / .rss, the
proof and KLD logs. Prints the tables and the PREREG verdict; writes nothing else.
Thresholds below are the PREREG decision rule (keep the two in sync)."""
import glob, json, os, re, statistics as st, sys

R_FLAT_GO, R_FLAT_NO = 0.80, 0.50   # B / a-flat prefill tok/s
R_CPU_GO, R_CPU_NO = 2.0, 1.5       # B / c prefill tok/s
DEC_GO, DEC_NO = 0.90, 0.75         # d-host / best CPU decode
R_HMX_LOSS = 0.50                   # B / a-hmx: below this the layout forfeits HMX
KLD_MAX, KLD_DELTA, TOP_MIN, MM_MIN = 0.0035, 0.0005, 95.0, 1000
CRASH = ("CDSP0 CRASHED", "dspqueue_read failed", "dspqueue_write failed",
         "ggml_abort", "GGML_ASSERT", "Segmentation", "NO-SUPPORT", "dsp-error")
SIZES = (512, 2048)
PREFILL = ("a-hmx", "a-flat", "b", "c")
DECODE = ("d-cpu", "d-cpu-nr", "d-host")

D = sys.argv[1]
def rd(name):
    p = os.path.join(D, name)
    return open(p, errors="replace").read() if os.path.exists(p) else ""

# ---- markers ----
units = {}
for ln in rd("markers.txt").splitlines():
    f = ln.split()
    if len(f) < 3:
        continue
    k, tag = f[0], f[1]
    u = units.setdefault(tag, {})
    if k == "C":
        u["gate"], u["skin0"], u["st0"], u["wait"] = f[2], f[3], f[4], f[5]
    elif k == "U_START":
        u["t0"] = int(f[-1])
    elif k == "U_END":
        u["t1"] = int(f[-1]); u["rc"] = f[2].split("=")[1]
    elif k == "V":
        u["void"] = f[2]

# ---- thermal: skin range over a unit window ----
skin = []
for ln in rd("samples.txt").splitlines():
    f = ln.split()
    if len(f) >= 3 and f[0] == "S":
        try: skin.append((int(f[1]), float(f[2])))
        except ValueError: pass
def skin_max(t0, t1):
    v = [s for t, s in skin if t0 <= t <= t1]
    return max(v) if v else None

BUF = re.compile(r"model buffer size =\s+([0-9.]+) MiB")
BUFN = re.compile(r"(\S+)\s+model buffer size =\s+([0-9.]+) MiB")
def buffers(log):
    return {m.group(1): float(m.group(2)) for m in BUFN.finditer(log)}

def load(tag):
    """Per-unit facts; `bad` lists the reasons the unit is invalid."""
    u = units.get(tag, {})
    err, out = rd(tag + ".err"), rd(tag + ".out")
    bad = []
    if "void" in u: bad.append("VOID " + u["void"])
    if u.get("rc") != "0": bad.append("rc=" + str(u.get("rc")))
    for s in CRASH:
        if s in err: bad.append("crash:" + s)
    rows = []
    for ln in out.splitlines():
        try: rows.append(json.loads(ln))
        except ValueError: pass
    rss = re.search(r"VmHWM:\s+(\d+) kB", rd(tag + ".rss"))
    return dict(u=u, bad=bad, rows=rows, bufs=buffers(err),
                hwm=int(rss.group(1)) / 1024 if rss else None,
                skin_max=skin_max(u["t0"], u["t1"]) if "t1" in u else None)

def proof(arm, bufs):
    """Backend proof from the load log (PREREG proof table)."""
    names = list(bufs)
    host = [n for n in names if "HOST" in n]
    htp = [n for n in names if n.startswith("HTP") and "HOST" not in n]
    cpu_only = names and all(n.startswith("CPU") for n in names)
    if arm in ("a-hmx", "a-flat"): return bool(htp) and not host
    if arm in ("b", "d-host"):    return bool(host) and (bool(htp) or arm == "d-host")
    return bool(cpu_only)

def med(v): return st.median(v) if v else None
def fmt(x, n=1): return "NA" if x is None else f"{x:.{n}f}"

# ---- prefill ----
pf = {}   # (arm,size) -> samples
mem = {}  # arm -> dict
print("## Prefill (tok/s, pooled reps of both rounds)\n")
print("| arm | size | reps | median | min | max | proof | start skin (r1/r2) |\n|---|---:|---:|---:|---:|---:|---|---|")
for arm in PREFILL:
    for size in SIZES:
        s, ok, sk = [], True, []
        for r in (1, 2):
            d = load(f"P{r}-{arm}")
            sk.append(d["u"].get("skin0", "NA"))
            if d["bad"] or not proof(arm, d["bufs"]): ok = False; continue
            for row in d["rows"]:
                if row.get("n_prompt") == size and not row.get("n_gen"):
                    s += row["samples_ts"]
            mem.setdefault(arm, dict(bufs=d["bufs"], hwm=[]))["hwm"].append(d["hwm"])
        pf[(arm, size)] = s
        print(f"| {arm} | {size} | {len(s)} | {fmt(med(s))} | {fmt(min(s) if s else None)} | {fmt(max(s) if s else None)} | {'OK' if ok else 'PARTIAL/VOID'} | {'/'.join(sk)} |")

# ---- decode ----
dc = {}
print("\n## Decode tg256 (tok/s)\n")
print("| arm | reps | median | min | max | proof | start skin (r1/r2) |\n|---|---:|---:|---:|---:|---|---|")
for arm in DECODE:
    s, ok, sk = [], True, []
    for r in (1, 2):
        d = load(f"D{r}-{arm}")
        sk.append(d["u"].get("skin0", "NA"))
        if d["bad"] or not proof(arm, d["bufs"]): ok = False; continue
        for row in d["rows"]:
            if row.get("n_gen") == 256: s += row["samples_ts"]
        mem.setdefault(arm, dict(bufs=d["bufs"], hwm=[]))["hwm"].append(d["hwm"])
    dc[arm] = s
    print(f"| {arm} | {len(s)} | {fmt(med(s))} | {fmt(min(s) if s else None)} | {fmt(max(s) if s else None)} | {'OK' if ok else 'PARTIAL/VOID'} | {'/'.join(sk)} |")

# ---- memory ----
print("\n## Memory (model buffers from the load log; peak RSS = VmHWM)\n")
print("| arm | model buffers MiB | total MiB | peak RSS MiB (per process) |\n|---|---|---:|---|")
tot = {}
for arm in PREFILL + DECODE:
    m = mem.get(arm)
    if not m: print(f"| {arm} | NA | NA | NA |"); continue
    tot[arm] = sum(m["bufs"].values())
    b = ", ".join(f"{k} {v:.1f}" for k, v in m["bufs"].items())
    print(f"| {arm} | {b} | {tot[arm]:.1f} | {', '.join(fmt(h, 0) for h in m['hwm'])} |")
if "a-flat" in tot and "b" in tot:
    print(f"\nModel-buffer delta a-flat - b: {tot['a-flat'] - tot['b']:.1f} MiB (one process).")
if "a-flat" in tot and "d-cpu" in tot and "b" in tot:
    two = tot["a-flat"] + tot["d-cpu"]
    print(f"Derived governor footprint: two-copy = a-flat {tot['a-flat']:.1f} + d-cpu {tot['d-cpu']:.1f} = {two:.1f} MiB; "
          f"one-copy = b {tot['b']:.1f} MiB; saved {two - tot['b']:.1f} MiB (derived from separate processes, not measured together).")

# ---- KLD and dispatch proofs ----
def kld(tag):
    t = rd(tag + ".err") + rd(tag + ".out")
    g = lambda pat: (lambda m: float(m.group(1)) if m else None)(re.search(pat, t))
    return dict(rc=(re.search(r"EXIT=(\d+)", t) or [0, "NA"])[1], kld=g(r"Mean\s+KLD:\s+([0-9.]+)"),
                mx=g(r"Maximum KLD:\s+([0-9.]+)"), top=g(r"Same top p:\s+([0-9.]+)"),
                ppl=g(r"Mean PPL\(Q\)\s*:\s+([0-9.]+)"),
                mm=len(re.findall(r"execute-op MUL_MAT", t)),
                host=len(re.findall(r"execute-op MUL_MAT.*HOST", t)),
                crash=[s for s in CRASH if s in t])
print("\n## KLD sanity (2 chunks, base = CPU on this device)\n")
print("| run | exit | mean KLD | max KLD | same top % | PPL(Q) | HTP MUL_MAT | reading HOST | crash |\n|---|---|---:|---:|---:|---:|---:|---:|---|")
K = {t: kld(t) for t in ("k2-flat", "k1-p5")}
for t, v in K.items():
    print(f"| {t} | {v['rc']} | {v['kld']} | {v['mx']} | {v['top']} | {v['ppl']} | {v['mm']} | {v['host']} | {','.join(v['crash']) or '-'} |")
k1, k2 = K["k1-p5"], K["k2-flat"]
valid = (k1["rc"] == "0" and not k1["crash"] and k1["kld"] is not None and k2["kld"] is not None
         and k1["mm"] >= MM_MIN and k1["host"] >= MM_MIN and k1["kld"] <= KLD_MAX
         and (k1["top"] or 0) >= TOP_MIN and abs(k1["kld"] - k2["kld"]) <= KLD_DELTA)
print(f"\nNumerics valid (P5 reproduces): {valid}")
for t in ("proof-nkv", "proof-nkv2", "proof-flat", "proof-one"):
    v = kld(t)
    print(f"{t}: exit {v['rc']}, execute-op MUL_MAT {v['mm']}, reading HOST {v['host']}, crash {v['crash'] or '-'}")

# ---- verdict ----
def ratio(a, b, size):
    x, y = pf.get((a, size)), pf.get((b, size))
    if not x or not y: return None
    return med(x) / med(y), min(x) / max(y), max(x) / min(y)
print("\n## Ratios (median; [min/max, max/min] in brackets)\n")
res = {}
for name, num, den in (("r_flat = b / a-flat", "b", "a-flat"), ("r_cpu = b / c", "b", "c"), ("r_hmx = b / a-hmx", "b", "a-hmx")):
    row = [ratio(num, den, s) for s in SIZES]
    res[name.split()[0]] = row
    print(f"- {name}: " + ", ".join(f"{s}: " + ("NA" if r is None else f"{r[0]:.3f} [{r[1]:.3f}, {r[2]:.3f}]") for s, r in zip(SIZES, row)))
best_cpu = max([med(dc.get(a)) for a in ("d-cpu", "d-cpu-nr") if dc.get(a)] or [0]) or None
dec = med(dc["d-host"]) / best_cpu if dc.get("d-host") and best_cpu else None
print(f"- dec = d-host / best CPU decode: {fmt(dec, 3)}")

def worst(key):
    v = [r[0] for r in res[key] if r]
    return min(v) if len(v) == len(SIZES) else None
rf, rc, rh = worst("r_flat"), worst("r_cpu"), worst("r_hmx")
print(f"\nworst-size: r_flat {fmt(rf,3)}, r_cpu {fmt(rc,3)}, r_hmx {fmt(rh,3)}, dec {fmt(dec,3)}")
if not valid: v1 = "UNDECIDED: P5 numerics not reproduced on v79 (timing informational only)"
elif None in (rf, rc, dec): v1 = "UNDECIDED: an arm is missing or void"
elif rf >= R_FLAT_GO and rc >= R_CPU_GO and dec >= DEC_GO: v1 = "GO: one-copy is worth it (layout cost)"
elif rf < R_FLAT_NO or rc < R_CPU_NO or dec < DEC_NO: v1 = "NO-GO: one-copy costs too much"
else: v1 = "MARGINAL: needs a faster converter before the governor takes it"
print(f"V1 (layout cost, like-for-like): {v1}")
if rh is None: print("V2 (vs today's HMX prefill): UNDECIDED")
else: print(f"V2 (vs today's HMX prefill): b keeps {rh*100:.0f}% -> " + ("FORFEITS >50% of HMX prefill" if rh < R_HMX_LOSS else "keeps at least half"))
