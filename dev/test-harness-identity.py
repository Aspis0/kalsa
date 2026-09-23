#!/usr/bin/env python3
"""Every harness names its engine explicitly and carries its identity.

The traps this closes (HANDOFF-2026-09-22 §7.9 and the review):
measure-slot-restore defaulted to the installed v1.1.0 - the release WITHOUT
T1; measure-unload-restore and measure-save-on-busy-slot defaulted to the
fork's CPU-only dev build (16x slower prefill); prefill-ab defaulted to one
of each. Run without the flag, each measured an object nobody ships and
recorded a bare sha of it.

Cases (switch-cost is deliberately absent from (1)/(3)-bin: it runs NO
binary - it drives an already-running server, and its job (record the
running build string, refuse when absent) is checked by its smoke and by
dev/test-running-engine.py):

  (1) the bin flag(s) are REQUIRED: each harness run WITHOUT them exits 2
      with argparse naming them. Parse-time only - fake --model/--trinity/
      --gemma paths are passed too, so even a harness that had LOST its
      requirement would die on its own missing-file gate instead of
      launching an engine, and a timeout bounds the rest.
  (2) every bin flag's --help carries mc's wording: "the owner's decision".
      Which engine a number describes is the owner's decision, so there is
      no default - the sentence is the policy, the flag is its enforcement.
  (3) the SOURCE of each harness carries the derivation and the print
      (`release_block(`, `engine_identity_line(`), and each harness IMPORTS
      cleanly - its importlib loaders for measure-concurrency.py and
      engine-harness.py resolve at load time.

Exit 0 green, 1 red, 2 a harness file is missing (cannot run).
Run: python3 dev/test-harness-identity.py
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

BIN_HELP_SENTENCE = "the owner's decision"

# harness -> (extra args, omitted bin flags argparse must name)
REQUIRED_CASES = {
    "measure-slot-restore.py": (
        ["--out", "/tmp/ti.json", "--model", "/nonexistent-model"], ["--bin"]),
    "measure-unload-restore.py": (
        ["--out", "/tmp/ti.json", "--model", "/nonexistent-model"], ["--bin"]),
    "measure-save-on-busy-slot.py": (
        ["--out", "/tmp/ti.json", "--model", "/nonexistent-model"], ["--bin"]),
    "measure-prefill-ab.py": (
        ["--out", "/tmp/ti.json", "--model", "/nonexistent-model"],
        ["--fork-bin", "--release-bin"]),
    "measure-model-switch.py": (
        ["--trinity", "/nonexistent-trinity", "--gemma", "/nonexistent-gemma",
         "--results-dir", "/tmp/ti-results"], ["--bin"]),
    # the reference: measure-concurrency's --bin was required from the start
    "measure-concurrency.py": (
        ["--out", "/tmp/ti.json", "--log", "/tmp/ti.log",
         "--slots-dir", "/tmp/ti-slots"], ["--bin"]),
}

# harnesses (a) touched: the derivation + the one identity line
WIRED = [
    "measure-slot-restore.py",
    "measure-unload-restore.py",
    "measure-save-on-busy-slot.py",
    "measure-prefill-ab.py",
    "measure-model-switch.py",
]

FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}"
          + (f": {detail}" if detail else ""), file=sys.stderr)


def run(argv, timeout=60):
    return subprocess.run([sys.executable, *argv], capture_output=True,
                          text=True, timeout=timeout)


def case_1_required():
    print("(1) the bin flag(s) are required - argparse, parse-time",
          file=sys.stderr)
    for harness, (extra, omitted) in REQUIRED_CASES.items():
        path = HERE / harness
        if not path.exists():
            print(f"cannot run: missing {path}", file=sys.stderr)
            sys.exit(2)
        p = run([str(path), *extra])
        check(f"(1) {harness} without {' '.join(omitted)} exits 2",
              p.returncode == 2, f"rc={p.returncode}")
        check(f"(1) ...and argparse names {' '.join(omitted)} as required",
              "the following arguments are required" in p.stderr
              and all(flag in p.stderr for flag in omitted),
              p.stderr.strip().splitlines()[-1] if p.stderr.strip() else "")


def case_2_help():
    print("(2) every bin flag's help carries the policy sentence",
          file=sys.stderr)
    for harness in REQUIRED_CASES:
        p = run([str(HERE / harness), "--help"])
        want = (2 if harness == "measure-prefill-ab.py" else 1)
        check(f"(2) {harness} --help says {BIN_HELP_SENTENCE!r} "
              f"at least {want}x",
              p.returncode == 0
              and p.stdout.count(BIN_HELP_SENTENCE) >= want,
              f"count={p.stdout.count(BIN_HELP_SENTENCE)}")


def case_3_wired():
    print("(3) the derivation and the identity line are wired, and every "
          "harness imports", file=sys.stderr)
    for harness in WIRED:
        source = (HERE / harness).read_text()
        check(f"(3) {harness} calls release_block(",
              "release_block(" in source)
        check(f"(3) {harness} prints engine_identity_line(",
              "engine_identity_line(" in source)
        spec = importlib.util.spec_from_file_location(
            f"wire_{harness.replace('-', '_').replace('.', '_')}",
            HERE / harness)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            ok, detail = True, ""
        except Exception as e:
            ok, detail = False, f"{type(e).__name__}: {e}"
        check(f"(3) {harness} imports cleanly (its loaders resolve)", ok,
              detail)


def main():
    case_1_required()
    case_2_help()
    case_3_wired()
    print(f"harness identity: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
