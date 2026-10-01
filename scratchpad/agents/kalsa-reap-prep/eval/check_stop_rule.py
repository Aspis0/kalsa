#!/usr/bin/env python3
"""Stop-rule check (DESIGN.md §4 S1) — reads one arm's gate JSONs, prints
GO or STOP with the numbers. Fail-closed means it: a missing file, an
unparsable file, a JSON without the needed key, or n = 0 is a STOP, and
every rule below is evaluated — an unreadable rule can never produce a GO.

Rules for the 128-expert arms (base = the unpruned reference arm's JSONs):
  - IT bpb (arm bpb.json, overall) > 0.75                          -> STOP
  - HumanEval+ pass rate < base rate - 15 percentage points        -> STOP
  - wrong-language rate > 5% in ANY FLORES pair (arm wronglang)    -> STOP
Exit code: 0 = GO, 1 = STOP (usable as a shell gate).

In the probe flow this runs AFTER the arm loop (podprobe/run_probe.sh stage
50_stop_rule.sh) for the k=4 128-expert arms, with
--base "$RESULTS/qwen36-k4" — the only arm that is the exact unpruned
control at k=4. It needs both arms' bpb.json + humaneval.json +
flores-wronglang.json to exist; until then it exits 1 (STOP).

Usage: check_stop_rule.py --arm <results/arm> --base <results/base>
"""

import argparse
import json
import pathlib
import sys

IT_BPB_MAX = 0.75
HUMANEVAL_DROP_PP = 15.0
WRONG_LANG_MAX = 0.05


def load(path: pathlib.Path):
    """The arm's JSON, or None when absent/unparsable — the caller STOPs."""
    if not path.exists():
        print(f"  MISSING {path} -> STOP")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"  UNREADABLE {path} ({e}) -> STOP")
        return None


def rule_bpb(arm: pathlib.Path, stop: list) -> None:
    d = load(arm / "bpb.json")
    if d is None:
        stop.append("bpb.json unreadable")
        return
    try:
        it = float(d["it"]["overall_bpb"])
    except (KeyError, TypeError, ValueError):
        stop.append("bpb.json has no it/overall_bpb")
        return
    bad = it > IT_BPB_MAX
    print(f"IT bpb        {it:.3f} (rule: <= {IT_BPB_MAX})     -> {'STOP' if bad else 'ok'}")
    if bad:
        stop.append(f"IT bpb {it:.3f} > {IT_BPB_MAX}")


def rule_humaneval(arm: pathlib.Path, base: pathlib.Path, stop: list) -> None:
    he_arm = load(arm / "humaneval.json")
    he_base = load(base / "humaneval.json")
    if he_arm is None or he_base is None:
        stop.append("humaneval.json unreadable (arm or base)")
        return
    try:
        ok_a, n_a = int(he_arm["ok"]), int(he_arm["n"])
        ok_b, n_b = int(he_base["ok"]), int(he_base["n"])
    except (KeyError, TypeError, ValueError):
        stop.append("humaneval.json missing ok/n (arm or base)")
        return
    if n_a <= 0 or n_b <= 0:
        stop.append(f"humaneval n=0 (arm n={n_a}, base n={n_b}) — no data is a STOP")
        return
    rate, base_rate = 100.0 * ok_a / n_a, 100.0 * ok_b / n_b
    bad = rate < base_rate - HUMANEVAL_DROP_PP
    print(f"HumanEval+    {ok_a}/{n_a} = {rate:.1f}% vs base "
          f"{ok_b}/{n_b} = {base_rate:.1f}% (rule: >= base - {HUMANEVAL_DROP_PP:.0f} pp) "
          f"-> {'STOP' if bad else 'ok'}")
    if bad:
        stop.append(f"HumanEval+ drop {base_rate - rate:.1f} pp > {HUMANEVAL_DROP_PP:.0f}")


def rule_wronglang(arm: pathlib.Path, stop: list) -> None:
    wl = load(arm / "flores-wronglang.json")
    if wl is None:
        stop.append("flores-wronglang.json unreadable")
        return
    if not isinstance(wl, dict) or not wl:
        stop.append("flores-wronglang.json has no pairs")
        return
    for pair, d in sorted(wl.items()):
        try:
            rate = float(d["rate"])
            n_wrong, n_items = int(d["n_wrong"]), len(d["chunks"])
        except (KeyError, TypeError, ValueError):
            stop.append(f"flores-wronglang.json[{pair}] malformed")
            continue
        bad = rate > WRONG_LANG_MAX
        print(f"wrong-language {pair}: {n_wrong}/{n_items} = "
              f"{rate:.1%} (rule: <= {WRONG_LANG_MAX:.0%})   -> {'STOP' if bad else 'ok'}")
        if bad:
            stop.append(f"wrong-language {pair} {rate:.1%} > {WRONG_LANG_MAX:.0%}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True, help="results dir of the pruned arm")
    ap.add_argument("--base", required=True, help="results dir of the unpruned base")
    a = ap.parse_args()
    arm, base = pathlib.Path(a.arm), pathlib.Path(a.base)
    if not arm.is_dir() or not base.is_dir():
        print(f"results dir missing (arm={arm} base={base}) -> STOP")
        return 1

    stop = []
    rule_bpb(arm, stop)
    rule_humaneval(arm, base, stop)
    rule_wronglang(arm, stop)
    for reason in stop:
        print(f"  STOP reason: {reason}")
    print(f"VERDICT arm={a.arm}: {'STOP' if stop else 'GO'}")
    return 1 if stop else 0


if __name__ == "__main__":
    sys.exit(main())
