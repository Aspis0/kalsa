#!/usr/bin/env python3
"""Task 3 (fixed): NMSE recompute from logged cell6 f1/f2 rows.
Each case region = ERR header .. next ERR header (or EOF).
NMSE = sum((f1-f2)^2)/sum(f1^2). Values logged at 6 decimals -> recompute has a
rounding floor; the report's <1e-6 claim must be explained separately.
"""
import re

path = "results/oracle_consumer_s23/retrial/cell6_armA_unpatched_hostrepack_q4_0_dump.log"
ERR = re.compile(r'\[MUL_MAT_ID\] ERR = ([\d.-]+) > [\d.-]+ DUMP (\S+ \S+) n=(\d+)')
ROW = re.compile(r'^\s*(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+),\s*diff\s*=\s*(-?[\d.]+)\s*$')

cases = []
cur = None
for line in open(path, encoding='utf-8', errors='replace'):
    e = ERR.search(line)
    if e:
        if cur: cases.append(cur)
        cur = {'err': float(e.group(1)), 'shape': e.group(2), 'n': int(e.group(3)), 'rows': []}
        continue
    if cur is not None:
        r = ROW.match(line)
        if r:
            cur['rows'].append((float(r.group(2).strip()), float(r.group(3).strip())))
if cur: cases.append(cur)

CLF = 1240/(8*344)
print(f"closed form 1240/(8*344) = {CLF:.8f}\n")
print(f"{'#':>2} {'n_log':>6} {'n_exp':>5} {'harness':>10} {'recompute':>10} {'rel|d|':>9}")
match_all = True
for i, c in enumerate(cases):
    s1 = sum(a*a for a, _ in c['rows'])
    se = sum((a-b)**2 for a, b in c['rows'])
    rec = se/s1 if s1 else float('nan')
    dd = abs(rec - c['err'])
    ok = len(c['rows']) == c['n']
    match_all &= ok
    print(f"{i+1:>2} {len(c['rows']):>6} {c['n']:>5} {c['err']:>10.8f} {rec:>10.8f} {dd:>9.2e} {'OK' if ok else 'MISSING-ROWS'}")
print("\nall cases have all rows:", match_all)

# What would NMSE be with FULL precision vs the 6-dp logged noise floor?
# quantify rounding-induced delta by perturbing
import random
print("\n-- rounding-floor estimate on case 1 --")
c = cases[0]
for reps in (1,3):
    worst = 0
    for a,b in c['rows']:
        e1 = max(abs(a),abs(b))
        # error in se and s1 terms from +-0.5e-6
        worst += 2*e1*5e-7 + 1e-12
    print(f"approx absolute error in recompute from 6-dp logging: <= ~{worst/c['n']:.2e} x n-sum-derived")
