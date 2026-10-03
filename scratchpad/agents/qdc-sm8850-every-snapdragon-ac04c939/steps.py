#!/usr/bin/env python3
# usage: steps.py A.jsonl B.jsonl — per-step table for the TF pair using oracle_logit's own step_rule (read-only helper; the judged verdict is oracle_logit.py).
import sys, math
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import oracle_logit as o
a, b = o.load(sys.argv[1]), o.load(sys.argv[2])
bad = {"R1": [], "R2": []}
for s in range(32):
    ar, br = a[s], b[s]
    rule, dl, dp = o.step_rule(ar, br, 0.03, 0.02, 0.10)
    m = o.margin(ar)
    print("step %2d A1=%d B1=%d margin=%.3f max_dlogp=%.3f dp1=%.3f %s" % (s, ar["top"][0][0], br["top"][0][0], m, dl, dp, rule))
    if rule: bad[rule].append(s)
print("R1 steps:", bad["R1"]); print("R2-first steps:", bad["R2"])
