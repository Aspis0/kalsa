#!/usr/bin/env python3
"""Regression for the three guards `measure-unload-restore.py` was missing.

The second review (gpt-6-luna xhigh) found that each of these guards either
did not exist, or existed in a shape nothing could fail on purpose. Each case
below fails its guard ON PURPOSE; exit 0 means every guard still bites.

  1. ERASE non-2xx. `erase_blocker()` is the guard, extracted so an injected
     501 produces the blocker and a 200 does not; and the chain the artifact
     relies on is exercised: a blocked arm makes `build_conclusion()` start
     with "no verdict:" - the refusal lives in the CONTENT (declared by
     `provenance.refusal_semantics`: exit 0 = the artifact was written), not
     in the exit code. WHAT THIS CANNOT PROVE is stated, not hidden: an erase
     that answers 200 while doing nothing is out of reach here by
     construction - each arm boots its own engine into a fresh slot dir, the
     slot is empty at erase time, and `n_erased = 0` is the normal answer.
     See `erase_blocker`'s docstring for why that is not a missing net.

  2. ARGV. A repeated flag is refused (the old guard read occurrence #1
     while the engine assigns each occurrence as it walks - last wins - so a
     duplicate could certify a value the engine never used), and
     `cache_type_k`/`cache_type_v` - the flags the whole byte law rests on -
     are among the asserted facts: a value diverging from the intended one
     makes `check_argv_facts()` raise.

  3. HEADROOM. A size that does not fit its slot ctx must RAISE
     (`require_headroom`), never truncate; a size that fits returns its
     headroom. This is the automatic version of the manual trigger the
     reviewer already pulled once.

Stdlib only, no engine, no network. Run: python3 dev/test-unload-guards.py
Exit 0 green, 2 red.
"""

import copy
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SPEC = importlib.util.spec_from_file_location("mur", HERE / "measure-unload-restore.py")
mur = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mur)

RELEASE_ARTIFACT = HERE / "results" / "unload-restore-release" / "results.json"

FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}" + (f": {detail}" if detail else ""),
          file=sys.stderr)


def raised(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except SystemExit as e:
        return str(e)
    return None


def case_erase():
    print("[1] erase non-2xx guard", file=sys.stderr)
    msg = mur.erase_blocker({"status": 501},
                            "the slot was not emptied, so the restore measures "
                            "residue, not the file")
    check("an injected 501 produces the blocker",
          msg == "erase refused (501): the slot was not emptied, so the restore "
                 "measures residue, not the file", repr(msg))
    check("500 also produces it", mur.erase_blocker({"status": 500}, "x") is not None)
    check("200 produces nothing", mur.erase_blocker({"status": 200}, "x") is None)

    # The chain the artifact relies on: a blocked arm -> measured false ->
    # the conclusion refuses in words, with the reason.
    arms = json.loads(RELEASE_ARTIFACT.read_text())["arms"]
    pristine = mur.build_conclusion(copy.deepcopy(arms))
    check("a measured run's conclusion is NOT a refusal",
          not pristine.startswith("no verdict"), pristine[:60])
    broken = copy.deepcopy(arms)
    first = sorted(broken)[0]
    broken[first]["saved"]["measured"] = False
    broken[first]["saved"]["blockers"] = [msg]
    refused = mur.build_conclusion(broken)
    check("a blocked arm makes the conclusion start 'no verdict:'",
          refused.startswith("no verdict:"), refused[:80])
    check("the refusal names the blocker", msg.split(":")[0] in refused and
          "erase refused" in refused, refused[:160])


def argv_fixture(ctx=8192):
    return (["nice", "-n", "10"]
            + mur.msr.engine_argv("/tmp/fake/kalsa-server",
                                  mur.msr.DEFAULT_MODEL, 19347, ctx,
                                  mur.arm_extra("/tmp/fake-slots")))


def intended_for(argv):
    return {"engine_nice": 10, "parallel": 1, "cache_ram": 0,
            "ctx_checkpoints": 1, "swa_full": False,
            "cache_type_k": "q8_0", "cache_type_v": "q8_0",
            "sleep_idle_seconds": 30,
            "ctx_size": int(argv[argv.index("--ctx-size") + 1])}


def case_argv():
    print("[2] argv guard: duplicates and the cache types", file=sys.stderr)
    argv = argv_fixture()
    facts = mur.flags_from_argv(argv)
    check("the clean argv yields the asserted facts", facts is not None)
    check("cache_type_k/v are among them", "cache_type_k" in facts and
          "cache_type_v" in facts, str(sorted(facts)))
    check("and they read q8_0", facts["cache_type_k"] == "q8_0" and
          facts["cache_type_v"] == "q8_0",
          f"{facts['cache_type_k']}/{facts['cache_type_v']}")
    check("a clean argv passes check_argv_facts",
          mur.check_argv_facts(facts, intended_for(argv)) is None)

    dup = argv + ["--parallel", "1"]
    err = raised(mur.flags_from_argv, dup)
    check("a REPEATED --parallel is refused (guard read #1, engine takes the last)",
          err is not None and "appears 2 times" in err, repr(err))

    i = argv.index("--cache-type-k")
    mutated = argv[:i + 1] + ["f16"] + argv[i + 2:]
    got = mur.flags_from_argv(mutated)
    check("the divergent cache type is read back as f16", got["cache_type_k"] == "f16",
          got["cache_type_k"])
    err = raised(mur.check_argv_facts, got, intended_for(argv),
                 "[saved 65536] this arm's ")
    check("and check_argv_facts refuses it",
          err is not None and "disagrees with the provenance" in err, repr(err))

    i = argv.index("--cache-type-v")
    mutated_v = argv[:i + 1] + ["bf16"] + argv[i + 2:]
    err = raised(mur.check_argv_facts, mur.flags_from_argv(mutated_v),
                 intended_for(argv), "")
    check("the same for --cache-type-v", err is not None, repr(err))


def case_headroom():
    print("[3] headroom guard: refuses instead of truncating", file=sys.stderr)
    check("a size that fits returns its headroom",
          mur.require_headroom(131072, 65536, 16) == 65520,
          str(mur.require_headroom(131072, 65536, 16)))
    check("the app-context run's own numbers fit",
          mur.require_headroom(131072, 65536, 16) > 0)
    check("a smaller run's numbers fit",
          mur.require_headroom(8192, 1900, 16) == 6276)
    err = raised(mur.require_headroom, 65536, 65536, 16)
    check("THE REVIEWER'S TRIGGER: a 65536-token chat at the app's own 65536 "
          "ctx (n_predict 16) RAISES, no artifact",
          err is not None and "does not fit" in err and "truncate" in err,
          repr(err))
    err = raised(mur.require_headroom, 8192, 8192, 16)
    check("any negative headroom raises", err is not None, repr(err))


def main():
    case_erase()
    case_argv()
    case_headroom()
    print(f"unload guards: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 2)


if __name__ == "__main__":
    main()
