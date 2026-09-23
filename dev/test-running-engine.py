#!/usr/bin/env python3
"""The responder's identity: /props versus --version, as a PURE comparison.

(b) A binary's identity says nothing about which process answered the port:
a stale engine satisfies /health exactly like ours (engine-harness's own
port_is_held docstring), and the filesystem-side traps (APFS being
case-insensitive among them) never touch the port. So the running server is
asked (GET /props) and ITS OWN build string is compared with the launched
binary's `--version` commit. The comparison is pure - no port, no network -
which is what makes it testable offline and mutable on purpose.

Quoted shapes, read from a live probe of THIS release (v1.1.1) before this
file was written: /props returns `"build_info":"b11195-a7d2cec79"`, and
`--version` prints `commit a7d2cec79`.

Cases:
  (1) the parsers, pinned on those quoted shapes: build_info -> commit
      exactly `a7d2cec79`; --version -> exactly `a7d2cec79`; and every
      absence (no build_info, build_info without a commit, a --version
      without a commit) -> None, never a guess.
  (2) check_running_build: match -> ok with the agreement in the reason;
      DIFFERENT commit -> refused with BOTH commits in the reason;
      either side missing -> refused (unknown is not agreement); prefix
      either way against a FULL 40-hex -> ok.
  (2b) H1 THE RULE (commits_agree), the TEN vectors shared VERBATIM
      with chat/scripts/tier-panel.mjs (S3: they WERE 8 vs 6 while the
      code claimed "the same list" - now identical, same order): the
      deadbee9/deadbee counterexample; the equal 9-hex pair; 9 vs
      full-40 both directions; full-40 vs an 8-hex (the floor bites
      even against 40); 8 vs 9; two differing 9-hex; an uppercase pair;
      and S1's two: 12 vs 9 and 9 vs 12 - both >=9, one strictly
      longer, NEITHER 40 - the clause no other vector pinned. deadbee9 vs deadbee -> refuse; the
      equal 9-hex pair -> ok; 9 vs full-40 (both orders) -> ok;
      a7d2cec7 (8 hex) -> refuse; a7d2cec79 vs a7d2cec70 -> refuse; plus
      an uppercase pair -> refuse (lowercase only), and an integration
      probe of check_running_build with the deadbee counterexample.
  (2c) K2 extraction vectors (the shared list, both languages): a 41-hex
      `commit` token -> None (no silent truncation to 40);
      `notcommit <40hex>` -> None (leading edge); `commit a7d2cec79` ->
      a7d2cec79. Plus a 41-hex /props tail -> None, in case (1).
  (3) engine_identity_line's format: the exact line for a matched block,
      the fork label when the veto fired, `module missing` when the
      module is gone, the reason_code when the evidence is too weak for
      tag or label.
  (4) MUTATION, built in: a copy of engine-harness.py whose disagreement
      branch never fires must turn (2)'s different-commit check red; a
      surviving mutation exits 2 (like test-release-provenance's).

The impure wrappers (require_running_engine / require_running_build:
fetch, then refuse) are exercised live by the per-harness smokes - this
file never opens a socket.

Exit 0 green, 1 a check failed, 2 cannot run or the mutation survived.
Run: python3 dev/test-running-engine.py
"""

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EH = HERE / "engine-harness.py"

if not EH.exists():
    print(f"cannot run: missing {EH}", file=sys.stderr)
    sys.exit(2)

spec = importlib.util.spec_from_file_location("eh", EH)
eh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eh)

# The quoted shapes: a live /props and a live --version of v1.1.1.
VERSION_OK = ("version: 0.4.1-dev (build 11195, commit a7d2cec79)\n"
              "built with AppleClang 21.0.0.21000101 for Darwin arm64")
PROPS_OK = {"build_info": "b11195-a7d2cec79"}

# K2: the extraction vectors, shared VERBATIM with
# chat/scripts/tier-panel.mjs (identical three, same order) and read by
# dev/test-engine-identity.py to pin mc.engine_identity's delegation - ONE
# Python list, one JS list.
EXTRACT_VECTORS = [
    (f"version build commit {'a' * 41}", None),
    (f"notcommit {'a' * 40}", None),
    ("version: 0.4.1-dev (commit a7d2cec79)", "a7d2cec79"),
]

FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}"
          + (f": {detail}" if detail else ""), file=sys.stderr)


def case_1_parsers(mod):
    print("(1) the parsers, pinned on the quoted v1.1.1 shapes",
          file=sys.stderr)
    check("(1) build_info b11195-a7d2cec79 -> a7d2cec79",
          mod.props_build_commit(PROPS_OK) == "a7d2cec79",
          repr(mod.props_build_commit(PROPS_OK)))
    check("(1) --version -> a7d2cec79",
          mod.version_build_commit(VERSION_OK) == "a7d2cec79",
          repr(mod.version_build_commit(VERSION_OK)))
    check("(1) no build_info -> None",
          mod.props_build_commit({}) is None)
    check("(1) build_info without a commit -> None",
          mod.props_build_commit({"build_info": "b11195"}) is None)
    check("(1) a non-dict props -> None",
          mod.props_build_commit("garbage") is None)
    check("(1) --version without a commit -> None",
          mod.version_build_commit("version: 0.4.1-dev") is None)
    check("(1) props: a 41-hex build_info tail extracts None (it cannot "
          "re-anchor INSIDE the run)",
          mod.props_build_commit({"build_info": "b11195-" + "a" * 41}) is None)


def different_commit_is_refused(mod):
    """The case the mutation must turn red; True = the guard bit."""
    other = VERSION_OK.replace("a7d2cec79", "2a290390d")
    ok, reason = mod.check_running_build(other, PROPS_OK)
    return (not ok
            and "2a290390d" in reason
            and "a7d2cec79" in reason
            and "not the binary" in reason)


def case_2_comparison(mod=eh, label=""):
    print(f"(2) check_running_build{label}", file=sys.stderr)
    ok, reason = mod.check_running_build(VERSION_OK, PROPS_OK)
    check("(2) match -> ok, and the reason names both sides' agreement",
          ok and "agrees" in reason, reason)
    check("(2) DIFFERENT commit -> refused with BOTH commits in the reason",
          different_commit_is_refused(mod))
    ok, reason = mod.check_running_build(VERSION_OK, {})
    check("(2) a /props without build_info -> refused (unknown is not "
          "agreement)", not ok and "build_info" in reason, reason)
    ok, reason = mod.check_running_build("version: 0.4.1-dev", PROPS_OK)
    check("(2) a --version without a commit -> refused", not ok
          and "--version" in reason, reason)
    full = ("commit a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1")
    ok, _ = mod.check_running_build(f"version: x ({full})", PROPS_OK)
    check("(2) prefix rule: full 40-hex --version vs 9-hex build_info -> ok",
          ok)
    long_props = {"build_info": "b11195-a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1"}
    ok, _ = mod.check_running_build(VERSION_OK, long_props)
    check("(2) prefix rule the other way: 9-hex --version vs full-40 "
          "build_info -> ok", ok)


def case_2b_vectors(mod=eh, label=""):
    print(f"(2b) H1 the ONE commit rule's vectors{label}", file=sys.stderr)
    FULL40 = "a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1"
    vectors = [
        ("deadbee9", "deadbee", False),          # A's counterexample (8 vs 7)
        ("a7d2cec79", "a7d2cec79", True),        # equal 9-hex
        ("a7d2cec79", FULL40, True),             # 9 against the manifest's 40
        (FULL40, "a7d2cec79", True),             # either direction
        ("a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1", "a7d2cec7", False),
        ("a7d2cec7", "a7d2cec79", False),        # 8 hex: below the floor
        ("a7d2cec79", "a7d2cec70", False),       # two 9-hex, unequal
        ("A7D2CEC79", "A7D2CEC79", False),       # lowercase only
        # S1: both >=9, one strictly longer, NEITHER 40 - prefix FORBIDDEN
        ("a7d2cec79e7d", "a7d2cec79", False),    # 12 vs 9
        ("a7d2cec79", "a7d2cec79e7d", False),    # 9 vs 12
    ]
    for left, right, want in vectors:
        got = mod.commits_agree(left, right)
        check(f"(2b) commits_agree({left[:12]}…, {right[:12]}…) == {want}",
              got is want, f"got {got}")
    # the same counterexample through the impure check: both sides
    # EXTRACT fine (the old >=7 regexes), and the RULE refuses.
    ok, reason = mod.check_running_build("version: x (commit deadbee9)",
                                         {"build_info": "b11195-deadbee"})
    check("(2b) check_running_build refuses A's deadbee9/deadbee pair with "
          "the rule in its reason", not ok
          and "deadbee9" in reason and "deadbee" in reason
          and "agreement rule" in reason, reason)


def case_3_identity_line():
    print("(3) engine_identity_line's exact format", file=sys.stderr)
    matched = {
        "status": "matched", "tag": "kalsa-server-v9.9.9",
        "identity": {"version_commit": "abc1234",
                     "module_sha256": "0123456789abcdef" + "0" * 48},
    }
    line = eh.engine_identity_line(matched)
    check("(3) matched: exact line",
          line == ("engine: matched kalsa-server-v9.9.9 commit abc1234 "
                   "module 0123456789ab"), repr(line))
    vetoed = {
        "status": "not-the-release", "label": "fork build, not the release",
        "identity": {"version_commit": "2a290390d", "module_sha256": None},
    }
    line = eh.engine_identity_line(vetoed)
    check("(3) vetoed: the fork label rides, module missing",
          line == ("engine: not-the-release fork build, not the release "
                   "commit 2a290390d module missing"), repr(line))
    weak = {"status": "unverified", "reason_code": "no-manifest-url",
            "identity": {"version_commit": "833cde99b",
                         "module_sha256": "a" * 64}}
    line = eh.engine_identity_line(weak)
    check("(3) unverified: the reason_code stands in for tag/label",
          line == ("engine: unverified no-manifest-url commit 833cde99b "
                   "module " + "a" * 12),
          repr(line))


def case_4_mutation():
    print("(4) MUTATION: the disagreement branch is made unreachable",
          file=sys.stderr)
    source = EH.read_text()
    needle = "    if not commits_agree(want, have):"
    patch = "    if False:  # MUTATION - a stale engine always passes"
    n = source.count(needle)
    check("(4) the mutation anchor exists exactly once in engine-harness",
          n == 1, f"{n} occurrence(s)")
    if n != 1:
        return
    mutated = source.replace(needle, patch)
    check("(4) the mutation changes the source", mutated != source)
    path = HERE / ".mutation-check-running-build-engine-harness.py"
    path.write_text(mutated)
    try:
        mspec = importlib.util.spec_from_file_location("eh_mutated", path)
        memh = importlib.util.module_from_spec(mspec)
        mspec.loader.exec_module(memh)
        killed = different_commit_is_refused(memh)
        check("(4) the gutted check no longer refuses a DIFFERENT commit - "
              "i.e. THIS test kills it", not killed,
              "the mutated module still refused (mutation too weak)"
              if killed else "mutated module now agrees on mismatch, as a "
                             "gutted guard would - the (2) case is what "
                             "dies")
        if killed:
            print("mutation survived: the (2) check cannot kill it",
                  file=sys.stderr)
            sys.exit(2)
    finally:
        path.unlink(missing_ok=True)


def case_2c_extract(mod=eh, label=""):
    print(f"(2c) K2 extraction vectors - both edges{label}", file=sys.stderr)
    for text, want in EXTRACT_VECTORS:
        got = mod.version_build_commit(text)
        check(f"(2c) version_build_commit({text[:36]!r}...) == {want!r}",
              got == want, f"got {got!r}")


def main():
    case_1_parsers(eh)
    case_2_comparison()
    case_2b_vectors()
    case_2c_extract()
    case_3_identity_line()
    case_4_mutation()
    print(f"running engine: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
