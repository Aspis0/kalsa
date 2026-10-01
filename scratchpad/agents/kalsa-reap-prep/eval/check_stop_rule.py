#!/usr/bin/env python3
"""Stop-rule check (DESIGN.md §4 S1) — reads one arm's gate JSONs, prints
GO or STOP with the numbers. Fail-closed: a missing file is a STOP.

Rules for the 128-expert arms (base = the unpruned reference arm's JSONs):
  - IT bpb (arm bpb.json, overall) > 0.75                          -> STOP
  - HumanEval+ pass rate < base rate - 15 percentage points        -> STOP
  - wrong-language rate > 5% in ANY FLORES pair (arm wronglang)    -> STOP
Exit code: 0 = GO, 1 = STOP (usable as a shell gate).

Usage: check_stop_rule.py --arm <results/arm> --base <results/base>
"""

import argparse
import json
import pathlib
import sys

IT_BPB_MAX = 0.75
HUMANEVAL_DROP_PP = 15.0
WRONG_LANG_MAX = 0.05


def load(path: pathlib.Path) -> dict:
    if not path.exists():
        print(f"  MISSING {path} -> STOP (fail-closed)")
        return {}
    return json.loads(path.read_text())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True, help="results dir of the pruned arm")
    ap.add_argument("--base", required=True, help="results dir of the unpruned base")
    a = ap.parse_args()
    arm, base = pathlib.Path(a.arm), pathlib.Path(a.base)
    stop = False

    bpb = load(arm / "bpb.json")
    if bpb:
        it = bpb["it"]["overall_bpb"]
        bad = it > IT_BPB_MAX
        stop |= bad
        print(f"IT bpb        {it:.3f} (rule: <= {IT_BPB_MAX})     -> {'STOP' if bad else 'ok'}")

    he_arm = load(arm / "humaneval.json")
    he_base = load(base / "humaneval.json")
    if he_arm and he_base:
        rate = 100.0 * he_arm["ok"] / max(1, he_arm["n"])
        base_rate = 100.0 * he_base["ok"] / max(1, he_base["n"])
        bad = rate < base_rate - HUMANEVAL_DROP_PP
        stop |= bad
        print(f"HumanEval+    {he_arm['ok']}/{he_arm['n']} = {rate:.1f}% vs base "
              f"{base_rate:.1f}% (rule: >= base - {HUMANEVAL_DROP_PP:.0f} pp) "
              f"-> {'STOP' if bad else 'ok'}")

    wl = load(arm / "flores-wronglang.json")
    if wl:
        for pair, d in sorted(wl.items()):
            bad = d["rate"] > WRONG_LANG_MAX
            stop |= bad
            print(f"wrong-language {pair}: {d['n_wrong']}/{len(d['chunks'])} = "
                  f"{d['rate']:.1%} (rule: <= {WRONG_LANG_MAX:.0%})   -> {'STOP' if bad else 'ok'}")

    print(f"VERDICT {'arm=' + a.arm}: {'STOP' if stop else 'GO'}")
    return 1 if stop else 0


if __name__ == "__main__":
    sys.exit(main())
