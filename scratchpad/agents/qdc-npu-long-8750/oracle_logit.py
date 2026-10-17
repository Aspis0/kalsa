#!/usr/bin/env python3
import json
import math
import sys

def result(status, rule, steps, max_dlogp, max_dp1, divergences, first_div):
    print("oracle=%s rule=%s steps=%d max_dlogp=%.4f max_dp1=%.4f divergences=%d first_div=%s" %
          (status, rule, steps, max_dlogp, max_dp1, divergences, first_div))

def load(path):
    rows = {}
    try:
        with open(path, encoding="utf-8") as stream:
            for line in stream:
                if not line.strip():
                    continue
                row = json.loads(line)
                row["step"] = int(row["step"])
                row["tok"] = int(row["tok"])
                # A step whose logits were unavailable is emitted with an empty
                # top by design (the hook makes it visible instead of dropping
                # it). It is not comparable, but it must not discard the file.
                if len(row["top"]) < 5:
                    row["top"] = []
                else:
                    row["top"] = [(int(pair[0]), float(pair[1])) for pair in row["top"][:5]]
                rows[row["step"]] = row
    except (OSError, TypeError, ValueError, KeyError, json.JSONDecodeError):
        return None
    return rows

def margin(row):
    return math.exp(row["top"][0][1]) - math.exp(row["top"][1][1])

def step_rule(arow, brow, margin_limit, prob_limit, logp_limit):
    btop = dict(brow["top"])
    a1, alogp1 = arow["top"][0]
    b1, blogp1 = brow["top"][0]
    max_dlogp = 0.0
    for token, alogp in arow["top"]:
        if token in btop:
            max_dlogp = max(max_dlogp, abs(btop[token] - alogp))
    max_dp1 = abs(math.exp(blogp1) - math.exp(alogp1))
    rule = "R1" if margin(arow) >= margin_limit and a1 != b1 else ""
    for token, alogp in arow["top"]:
        if math.exp(alogp) < prob_limit:
            continue
        if token not in btop or abs(btop[token] - alogp) > logp_limit:
            rule = rule or "R2"
    if max_dp1 > prob_limit:
        rule = rule or "R2"
    return rule, max_dlogp, max_dp1

def record(violations, step, rule):
    if rule:
        violations.append((step, {"R1": 1, "R2": 2, "R3": 3}[rule], rule))

def main():
    if len(sys.argv) != 7:
        return 2
    a_path, b_path, mode = sys.argv[1:4]
    try:
        margin_limit, prob_limit, logp_limit = map(float, sys.argv[4:7])
    except ValueError:
        return 2
    a_rows = load(a_path)
    b_rows = load(b_path)
    if mode not in ("TF", "G") or not a_rows or not b_rows:
        result("DESCRIPTIVE", "R4", 0, 0.0, 0.0, 0, -1)
        return 0
    compared = []
    violations = []
    divergences = []
    coverage_bad = False
    if mode == "TF":
        for step in sorted(set(a_rows) | set(b_rows)):
            arow = a_rows.get(step)
            brow = b_rows.get(step)
            if arow is None or brow is None:
                coverage_bad = True
                break
            if not arow["top"] or not brow["top"]:
                # First non-comparable step ends the comparison; whether the run
                # still has its 32 steps is decided by the coverage check below.
                break
            compared.append((step, arow, brow))
            rule, _, _ = step_rule(arow, brow, margin_limit, prob_limit, logp_limit)
            record(violations, step, rule)
            if brow.get("forced") is not True or brow["tok"] != arow["tok"]:
                coverage_bad = True
                break
        coverage_bad = coverage_bad or len(compared) < 32
    else:
        for step in sorted(a_rows):
            arow = a_rows[step]
            brow = b_rows.get(step)
            if brow is None:
                coverage_bad = True
                continue
            if not arow["top"] or not brow["top"]:
                coverage_bad = True
                continue
            if brow["tok"] != arow["tok"]:
                divergences.append((step, arow, brow))
                if margin(arow) >= margin_limit:
                    record(violations, step, "R1")
                elif brow["tok"] != arow["top"][1][0]:
                    record(violations, step, "R3")
                if len(divergences) > 1:
                    record(violations, step, "R3")
            elif not divergences:
                compared.append((step, arow, brow))
                rule, _, _ = step_rule(arow, brow, margin_limit, prob_limit, logp_limit)
                record(violations, step, rule)
    if violations:
        status, rule = "FAIL", min(violations)[2]
    elif coverage_bad:
        status, rule = "DESCRIPTIVE", "R4"
    else:
        status, rule = "PASS", "none"
    max_dlogp = max((step_rule(a, b, margin_limit, prob_limit, logp_limit)[1]
                     for _, a, b in compared), default=0.0)
    max_dp1 = max((step_rule(a, b, margin_limit, prob_limit, logp_limit)[2]
                   for _, a, b in compared), default=0.0)
    first_div = divergences[0][0] if divergences else -1
    result(status, rule, len(compared), max_dlogp, max_dp1, len(divergences), first_div)
    return 0

if __name__ == "__main__":
    sys.exit(main())
