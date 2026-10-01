#!/usr/bin/env python3
"""Self-test for eval/check_stop_rule.py — exit codes are the contract.

Covers the audit's B1/M9/H2 cases: missing dir / missing file / partial
JSON / n=0 must exit 1 (STOP); a fully green arm exits 0; and the 15 pp
HumanEval clause must decide a REAL two-arm comparison both ways
(90/164 vs 100/164 = 5.5 pp drop -> GO; 60/164 vs 100/164 = 24.4 pp
drop -> STOP) — the previous round only ever proved arm == base.

Run: python3 eval/test_stop_rule.py  (exit 0 = all cases pass)
"""

import json
import pathlib
import subprocess
import sys
import tempfile

TOOL = str(pathlib.Path(__file__).parent / "check_stop_rule.py")


def run_rule(arm: pathlib.Path, base: pathlib.Path) -> int:
    return subprocess.run(
        [sys.executable, TOOL, "--arm", str(arm), "--base", str(base)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).returncode


def arm_dir(root: pathlib.Path, name: str, bpb_it=0.60, he=(150, 164),
            wl_rate=0.0) -> pathlib.Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "bpb.json").write_text(json.dumps({"it": {"overall_bpb": bpb_it}}))
    (d / "humaneval.json").write_text(json.dumps({"ok": he[0], "n": he[1]}))
    (d / "flores-wronglang.json").write_text(json.dumps(
        {"en-it": {"rate": wl_rate, "n_wrong": int(wl_rate * 100), "chunks": [0] * 100}}))
    return d


def expect(name: str, got: int, want: int, log: list) -> None:
    line = f"{name}: EXIT={got} (want {want}) -> {'ok' if got == want else 'FAIL'}"
    print(line)
    if got != want:
        log.append(name)


def main() -> int:
    log = []
    with tempfile.TemporaryDirectory(prefix="stop-rule-test-") as tmp:
        root = pathlib.Path(tmp)
        good = arm_dir(root, "good", he=(150, 164))
        base = arm_dir(root, "base", he=(100, 164))  # audit's example base

        expect("green arm vs base -> GO", run_rule(good, base), 0, log)
        expect("missing arm dir -> STOP", run_rule(root / "nope", base), 1, log)
        expect("missing base dir -> STOP", run_rule(good, root / "nope"), 1, log)

        partial = arm_dir(root, "partial")
        (partial / "bpb.json").write_text("{\"it\": {}}")  # key missing
        expect("partial bpb key -> STOP", run_rule(partial, base), 1, log)
        (partial / "bpb.json").write_text("{not json")
        expect("unparsable bpb -> STOP", run_rule(partial, base), 1, log)
        (partial / "humaneval.json").write_text('{"ok": 90}')  # no n
        expect("humaneval without n -> STOP", run_rule(partial, base), 1, log)

        zero = arm_dir(root, "zero", he=(0, 0))
        expect("n=0 on both sides -> STOP", run_rule(zero, base), 1, log)

        borderline = arm_dir(root, "wl-borderline", wl_rate=0.05)
        expect("wrong-language exactly 5% -> GO", run_rule(borderline, base), 0, log)
        bad_wl = arm_dir(root, "wl-over", wl_rate=0.06)
        expect("one rule bad (6% wrong-language) -> STOP", run_rule(bad_wl, base), 1, log)

        # audit H2 regression: the 15 pp clause against two DIFFERENT models
        small_drop = arm_dir(root, "small-drop", he=(90, 164))   # base 100/164
        expect("drop 5.5 pp (90 vs 100 of 164) -> GO", run_rule(small_drop, base), 0, log)
        big_drop = arm_dir(root, "big-drop", he=(60, 164))
        expect("drop 24.4 pp (60 vs 100 of 164) -> STOP", run_rule(big_drop, base), 1, log)

    print(f"\n{'ALL OK' if not log else 'FAILED: ' + ', '.join(log)}")
    return 1 if log else 0


if __name__ == "__main__":
    sys.exit(main())
