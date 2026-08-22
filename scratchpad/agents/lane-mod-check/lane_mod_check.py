#!/usr/bin/env python3
"""LANE_MOD equidistribution check — queue item #5 (PC-only, read-only).

Part A: parse every archived GEMV_AUDIT case line under
        results/oracle_consumer_s23/ and report whether LANE_MOD ever fired
        on real device data.
Part B: faithful Python reimplementation of the LANE_MOD classifier block
        (ggml-opencl.cpp :21684-21744, d77e82347 lineage), plus the proposed
        ~10-line equidistribution gate, replayed over synthetic dst-row maps:
        nominal single-cosets and the two known adversarial classes.
"""
import glob
import re
import sys
from math import gcd
from collections import Counter

ROOT = r"C:/Users/gualt/Desktop/Kalsa/moe-experiments"

# ----------------------------------------------------------------------------
# Part A — empirical replay over archived raw data
# ----------------------------------------------------------------------------

GEMV_RE = re.compile(r"GEMV_AUDIT\{([^}]*)\}")

def parse_gemv_lines(paths):
    cases = []
    for p in paths:
        with open(p, encoding="utf-8", errors="replace") as f:
            txt = f.read()
        # strip ANSI color codes that can sit inside lines
        txt = re.sub(r"\x1b\[[0-9;]*m", "", txt)
        for m in GEMV_RE.finditer(txt):
            fields = dict(
                kv.split("=", 1) for kv in m.group(1).split(", ") if "=" in kv
            )
            fields["_file"] = p.replace(ROOT + "/", "")
            cases.append(fields)
    return cases

# ----------------------------------------------------------------------------
# Part B — faithful classifier reimplementation (d77e82347) + eq-check gate
# ----------------------------------------------------------------------------

MOD = 128          # mods[mi==2]; largest tested modulus
FULL_BAD = 0.80    # rt >= 0.80  -> fully-bad residue
PARTIAL = 0.20     # 0.20 < rt < 0.80 -> partial residue (blocks tag)
MIN_TOT = 4        # per-residue observation floor

def lane_mod_classify(m, bad_rows):
    """Reimplements the LANE_MOD block given total rows m and a bad-row set.

    Returns (tag_or_None, diagnostics dict). mod_tot[r] = number of dst rows
    in [0,m) with i%128==r; mod_bad[r] = those that are bad.
    """
    mod_tot = [0] * MOD
    mod_bad = [0] * MOD
    for i in range(m):
        mod_tot[i % MOD] += 1
        if i in bad_rows:
            mod_bad[i % MOD] += 1
    n_full_bad = 0
    n_partial = 0
    full_set = []
    for r in range(MOD):
        if mod_tot[r] < MIN_TOT:
            continue
        rt = mod_bad[r] / mod_tot[r]
        if rt >= FULL_BAD:
            n_full_bad += 1
            full_set.append(r)
        elif rt > PARTIAL:
            n_partial += 1
    diag = {"n_full_bad": n_full_bad, "n_partial": n_partial,
            "full_set": sorted(full_set)}
    tag = None
    if n_partial == 0 and n_full_bad > 0 and (MOD % n_full_bad) == 0:
        period = MOD // n_full_bad
        if period >= 2:
            tag = f"LANE_MOD_{period}"
            diag["period"] = period
    return tag, diag

def equidistributed(full_set, period):
    """The proposed gate: the fully-bad residue set must be one equidistributed
    coset {r0 + k*period} — every cyclic gap between consecutive members
    equals the inferred period."""
    if not full_set:
        return False, None
    s = sorted(full_set)
    gaps = [b - a for a, b in zip(s, s[1:])]
    gaps.append(s[0] + MOD - s[-1])   # wraparound gap closes the cycle
    ok = all(g == period for g in gaps)
    return ok, gaps

def classify_with_eq(m, bad_rows):
    tag, diag = lane_mod_classify(m, bad_rows)
    diag["eq_pass"] = None
    diag["eq_gaps"] = None
    if tag:
        ok, gaps = equidistributed(diag["full_set"], diag["period"])
        diag["eq_pass"] = ok
        diag["eq_gaps"] = gaps
        if not ok:
            diag["eq_verdict"] = "EQ-FAIL -> tag suppressed (non-single-coset)"
        else:
            diag["eq_verdict"] = "eq-pass"
    return tag, diag

# ----------------------------------------------------------------------------
# Synthetic maps
# ----------------------------------------------------------------------------

def coset(period, r0, m):
    return {i for i in range(m) if i % period == r0 % period}

def synth_cases():
    m = 512  # every residue class gets exactly MIN_TOT=4 observations
    cases = []
    # nominal single-coset lattices (the shape LANE_MOD was built for)
    for period in (4, 8, 16, 32, 64, 128):
        cases.append((f"nominal single-coset period-{period} (r0=5)",
                      m, coset(period, 5, m)))
    # adversarial 1: contiguous 32-row store-band tiled every 128 rows
    # (rows 32..63 of each 128-row tile -> residues 32..63 FULLY bad)
    band = {i for i in range(m) if 32 <= (i % 128) < 64}
    cases.append(("ADVERSARIAL-1 contiguous 32-row band (rows 32..63)",
                  m, band))
    # adversarial 2: union of two offset mod-64 classes (k1=3, k2=40)
    union = {i for i in range(m) if i % 64 in (3, 40)}
    cases.append(("ADVERSARIAL-2 union of two offset mod-64 classes (3,40)",
                  m, union))
    # adversarial 3: union of two offset mod-32 classes within mod-128 view
    union3 = {i for i in range(m) if i % 32 in (7, 19)}
    cases.append(("ADVERSARIAL-3 union of two offset mod-32 classes (7,19)",
                  m, union3))
    # guards already in place (must stay blocked under both versions)
    three = {i for i in range(m) if i % 128 in (9, 50, 100)}   # 3 residues
    cases.append(("guard: 3 fully-bad residues (128%3!=0)", m, three))
    half = {i for i in range(m) if i % 96 in (0,)}             # partial-rate mix
    cases.append(("guard: period-96 lattice (partial residues)", m, half))
    cases.append(("guard: all rows bad", m, set(range(m))))
    cases.append(("control: no bad rows", m, set()))
    return cases

# ----------------------------------------------------------------------------

def main():
    out = []
    say = out.append
    say("LANE_MOD equidistribution check — OUTPUT")
    say("=" * 70)

    # ---- Part A ----
    paths = sorted(glob.glob(f"{ROOT}/results/oracle_consumer_s23/run*/*.log"))
    paths += [f"{ROOT}/results/oracle_consumer_s23/_extract_r9r10.txt"]
    cases = parse_gemv_lines(paths)
    say("")
    say("PART A — archived GEMV_AUDIT case lines (real device data)")
    say("-" * 70)
    by_file = Counter(c["_file"] for c in cases)
    for f, n in sorted(by_file.items()):
        say(f"  {f}: {n} case lines")
    nb = Counter(int(c.get("n_bad", -1)) for c in cases)
    pat = Counter(c.get("pattern", "<none>") for c in cases)
    ms = Counter(c.get("m", "?") for c in cases)
    say(f"  total case lines parsed : {len(cases)}")
    say(f"  n_bad distribution      : {dict(sorted(nb.items()))}")
    say(f"  pattern distribution    : {dict(pat)}")
    say(f"  m values                : {dict(ms)}")
    lane_fired = [c for c in cases if c.get("pattern", "").startswith("LANE_MOD")]
    any_bad = [c for c in cases if int(c.get("n_bad", 0)) > 0]
    say(f"  cases with LANE_MOD tag : {len(lane_fired)}")
    say(f"  cases with n_bad > 0    : {len(any_bad)}")

    # ---- Part B ----
    say("")
    say("PART B — synthetic replay: current classifier vs +equidistribution gate")
    say("-" * 70)
    hdr = f"  {'case':<58} {'fires':<14} {'eq':<5} note"
    say(hdr)
    n_mislabel = 0
    for name, m, bad in synth_cases():
        tag, diag = classify_with_eq(m, bad)
        eq = ("PASS" if diag["eq_pass"] else "FAIL") if tag else "-"
        note = diag.get("eq_verdict", "")
        if tag and diag["eq_pass"] is False:
            n_mislabel += 1
            note += "  <-- FALSE TAG"
        say(f"  {name:<58} {str(tag):<14} {eq:<5} {note}")
        if diag["full_set"]:
            fs = diag["full_set"]
            show = fs if len(fs) <= 12 else f"[{len(fs)} residues]"
            say(f"      fully-bad residues @mod128: {show}, "
                f"gaps={diag['eq_gaps']}")
    say("")
    say(f"  false LANE tags caught by the eq-gate: {n_mislabel}")

    # ---- verdict inputs ----
    say("")
    say("VERDICT INPUTS")
    say("-" * 70)
    say(f"  empirical positive samples available: {len(lane_fired)} "
        f"(LANE_MOD firings) / {len(any_bad)} (any-bad cases)")
    print("\n".join(out))

    with open(f"{ROOT}/scratchpad/agents/lane-mod-check/OUTPUT.txt",
              "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

if __name__ == "__main__":
    sys.exit(main())
