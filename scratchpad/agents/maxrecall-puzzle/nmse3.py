#!/usr/bin/env python3
"""Task 3: re-derive NMSE for the 12 f1/f2 cases from the LOGGED cell6 values.
cell6 unpatched+HOST_REPACK (correct producer) + old restore (poisoned judge f2).
Logged: 'idx f1 f2, diff = ...' with 6 decimals => rounding floor ~1e-5 rel.
NMSE = sum((f1-f2)^2) / sum(f1^2). Compare to harness-printed ERR.
"""
import re, sys, math

path = "results/oracle_consumer_s23/retrial/cell6_armA_unpatched_hostrepack_q4_0_dump.log"
cases = []  # (err_line, rows[{f1,f2}])
cur = None
with open(path, encoding='utf-8', errors='replace') as fh:
    for line in fh:
        m = re.search(r'\[MUL_MAT_ID\] ERR = (\S+) > (\S+) DUMP (\S+)', line)
        if m:
            cur = {"err": float(m.group(1)), "shape": m.group(3), "rows": []}
            cases.append(cur)
            continue
        r = re.match(r'\s*(\d+)\s+(-?[0-9.]+)\s+(-?[0-9.]+), diff = (-?[0-9.]+)\s*', line)
        if r and cur is not None:
            cur["rows"].append((float(r.group(2)), float(r.group(3))))

print(f"cases parsed: {len(cases)}")
clf = 1240/(8*344)  # 0.4505813953  closed form
print(f"closed-form q4_0 NMSE = 1240/(8*344) = {clf:.8f}\n")
print(f"{'case':>4} {'n_rows':>7} {'harness_ERR':>12} {'recompute':>12} {'|d|':>9} {'vs_closed':>9}")
for i, c in enumerate(cases):
    s1 = sum(v1*v1 for v1, v2 in c["rows"])
    se = sum((v1-v2)**2 for v1, v2 in c["rows"])
    rec = se/s1 if s1 else float('nan')
    print(f"{i+1:>4} {len(c['rows']):>7} {c['err']:>12.8f} {rec:>12.8f} "
          f"{abs(rec-c['err']):>9.2e} {abs(rec-clf):>9.4f}")

# sanity: verify the pre-registered 12 shape-list order n_mats(4/8) x n_used(1/2/4) x bcast(f/t)
print("\nexpected harness shape sequence (n_mats,n_used,bcast):")
expect = [(m,u,b) for m in (4,8) for u in (1,2,4) for b in (0,1)]
n_raw = [len(c['rows']) for c in cases]
print("  row totals:", n_raw)
