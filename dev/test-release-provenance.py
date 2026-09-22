#!/usr/bin/env python3
"""Red/green control for the release provenance of the concurrency artifact.

No network, no engine, no writes to the artifact: the manifest bodies, the
failing fetch and the mutated harnesses are all fixtures or in-memory-ish
copies (the mutated copy lives one file in dev/ and is deleted).

  (a) matching, and what is NOT a fork:
      - a manifest whose rows carry a DIFFERENT exe_sha256 than the binary
        that ran -> `not-the-release`, exactly the PLAN-DISK-TIER §9 label
        `fork build, not the release`, `platform` from the host with
        `platform_source: host`, `backend: null`; positive control beside it:
        the row that DOES carry the hash -> `matched`, `platform_source:
        manifest`. The fixture's platform is deliberately NOT the host's
        platform, or the platform check passes by accident (it did).
      - DEGENERATE rows: exe_sha256 missing / empty / null / int / short /
        non-hex -> `unverified` with reason_code
        `manifest-published-no-usable-exe-sha256`. A release that declares no
        hash is missing evidence, not a verdict.
      - UPPERCASE hex row, and uppercase hex binary -> still `matched`
        (comparison is case-insensitive) with the canonical lowercase digest
        recorded. A hash is a hash.
      - DUPLICATE rows claiming the executed digest -> `unverified`,
        reason_code `manifest-exe-sha256-ambiguous`, count recorded, never a
        silent pick: platform/backend would be arbitrary.
      - the BINARY with no usable digest -> `unverified`,
        reason_code `binary-has-no-usable-exe-sha256`.
      - the boundary, pinned: one usable published digest that is not ours
        (+ a degenerate row beside it) -> `not-the-release` is allowed.
  (b) a manifest that cannot be read (fetch raises; body that is not JSON)
      -> `unverified`, NEVER `not-the-release`.
  (c) the committed artifact: `provenance.max_load` and
      `provenance.attempts_max` present as numbers equal to the arguments the
      run used (passed here, because the argument is external evidence and
      this file must not "derive" the expectation from the field it checks);
      and `provenance.release.status == "matched"` — asserted separately and
      with its own message, because an artifact recorded `unverified` must
      not walk through this suite green.
  (e) the provenance BUILDER follows its input: `run_parameters()` called
      with a distinctive max_load (not the 6.0 default) must return exactly
      that, otherwise a `"max_load": 6.0` literal is invisible to the
      documented CLI invocation (its expectation is 6.0, the real value).
  (d) MUTATIONS, each applied to a copy of the harness and expected to turn
      (a) or (e) red:
      1. match always true (the hex comparison replaced by `True`);
      2. every weak outcome accused of being a fork (`if outcome ==
         "no-match":` -> `if outcome != "unique":`) — the §7 rule: the fork
         verdict must be able to fire only for its declared reason;
      3. `"max_load": args.max_load` -> the constant `6.0`.
      A surviving mutation is a RED result for this file: exit 2.

Exit 0 when everything is green (and every mutation is killed), 2 otherwise.

Commands:
  python3 dev/test-release-provenance.py
  python3 dev/test-release-provenance.py \
      --artifact dev/results/concurrency-two-devices/results.json \
      --expect-max-load 6.0 --expect-attempts 4
"""

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "measure-concurrency.py"
DEFAULT_ARTIFACT = HERE / "results" / "concurrency-two-devices" / "results.json"

# The hash of the binary the committed artifact says ran.
RUN_SHA = "327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"
OTHER_SHA = "f" * 64          # a row that is NOT the binary that ran
FORK_LABEL = "fork build, not the release"
# Deliberately NOT this host's platform (asserted in case (a)): with the
# fixture platform equal to the host's, the `platform` check of the
# not-the-release branch passed by accident and the always-true mutation was
# killed one check weaker than it looked.
FIXTURE_PLATFORM = "linux-x64"
FIXTURE_BACKEND = "cuda"

# name -> (needle, patch, cases the mutation must turn red)
MUTATIONS = {
    "match-always-true": (
        '    hits = [r for r in published if canonical_sha256(r["exe_sha256"]) == key]',
        "    hits = [r for r in published if True]  # MUTATION: sempre vero",
        ["a"],
    ),
    "weak-outcome-accuses-fork": (
        '    if outcome == "no-match":',
        '    if outcome != "unique":  # MUTATION: ogni esito debole accusa fork',
        ["a"],
    ),
    "max-load-constant": (
        '        "max_load": args.max_load,',
        '        "max_load": 6.0,  # MUTATION: hardcoded default',
        ["e"],
    ),
}


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def manifest_fixture(exe_sha256, platform=FIXTURE_PLATFORM, backend=FIXTURE_BACKEND,
                     rows=None):
    """A manifest whose platform is NOT this host's platform."""
    if rows is None:
        rows = [{"platform": platform, "backend": backend,
                 "home": "https://dl.kalsa.io/kalsa-server/v9.9.9",
                 "file": "kalsa-server-v9.9.9-bin-fixture.tar.gz",
                 "url": "https://dl.kalsa.io/kalsa-server/v9.9.9/x.tar.gz",
                 "format": "tar.gz", "top_dir": "kalsa-server-v9.9.9",
                 "exe": "kalsa-server", "size_bytes": 11207195,
                 "sha256": "d" * 64, "exe_sha256": exe_sha256}]
    return {
        "version": "v9.9.9",
        "tag": "kalsa-server-v9.9.9",
        "tag_object": "a" * 40,
        "commit": "b" * 40,
        "ref": "refs/tags/kalsa-server-v9.9.9",
        "trigger": "push on a tag",
        "run_url": "https://github.com/example/run/1",
        "built_at": "2026-01-01T00:00:00Z",
        "reproducible": True,
        "pack_sha256": "c" * 64,
        "artifacts": rows,
    }


def row(exe_sha256, platform=FIXTURE_PLATFORM, backend=FIXTURE_BACKEND):
    return {"platform": platform, "backend": backend,
            "file": "x.tar.gz", "exe_sha256": exe_sha256}


def returns(body):
    return lambda url: body


def refuses(url):
    raise OSError(f"[Errno 61] Connection refused: {url}")


class Checks:
    def __init__(self, name):
        self.name = name
        self.failed = 0
        self.total = 0

    def eq(self, what, got, want):
        self.total += 1
        ok = got == want
        if not ok:
            self.failed += 1
        print(f"  [{'ok' if ok else 'FAIL'}] {what}: {got!r}"
              + ("" if ok else f" (expected {want!r})"), file=sys.stderr)

    def ok(self, what, cond, detail=""):
        self.total += 1
        if not cond:
            self.failed += 1
        print(f"  [{'ok' if cond else 'FAIL'}] {what}"
              + (f": {detail}" if detail else ""), file=sys.stderr)

    @property
    def green(self):
        return self.failed == 0


def ask(mc, body, exe_sha=RUN_SHA):
    return mc.release_provenance("https://dl.kalsa.io/kalsa-server/v9.9.9/manifest.json",
                                 exe_sha, fetch=returns(body),
                                 checked_utc="2026-01-01T00:00:00Z")


def case_a(mc):
    """Matching, fork, and every weak-evidence outcome that must NOT be a
    fork verdict."""
    c = Checks("(a) match / not-the-release / weak evidence")
    body = lambda m: json.dumps(m).encode()  # noqa: E731

    c.ok("the fixture platform differs from this host's platform "
         "(otherwise the platform check passes by accident)",
         FIXTURE_PLATFORM != mc.host_platform(),
         f"fixture {FIXTURE_PLATFORM} vs host {mc.host_platform()}")

    other = ask(mc, body(manifest_fixture(OTHER_SHA)))
    c.eq("different digest -> status", other["status"], "not-the-release")
    c.eq("different digest -> label", other.get("label"), FORK_LABEL)
    c.eq("different digest -> backend", other.get("backend"), None)
    c.eq("different digest -> platform from the HOST", other.get("platform"),
         mc.host_platform())
    c.eq("different digest -> platform_source", other.get("platform_source"), "host")
    c.eq("different digest -> published digest rows counted",
         other.get("manifest_exe_sha256_rows"), 1)
    c.ok("different digest -> manifest_sha256 recorded (the manifest WAS read)",
         re.fullmatch(r"[0-9a-f]{64}", other.get("manifest_sha256") or "") is not None)
    c.ok("different digest -> tag/commit of the NON-matching row NOT asserted",
         "tag" not in other and "commit" not in other)

    # The boundary, pinned: >=1 well-formed published digest and none is ours
    # is the ONLY shape allowed to carry the fork label.
    mixed = manifest_fixture(OTHER_SHA)
    mixed["artifacts"].append(row(None))
    mixed_block = ask(mc, body(mixed))
    c.eq("boundary: one usable digest, not ours (+ a degenerate row beside "
         "it) -> not-the-release", mixed_block["status"], "not-the-release")

    good = ask(mc, body(manifest_fixture(RUN_SHA)))
    c.eq("matching digest -> status", good["status"], "matched")
    c.eq("matching digest -> tag", good.get("tag"), "kalsa-server-v9.9.9")
    c.eq("matching digest -> platform from the MANIFEST", good.get("platform"),
         FIXTURE_PLATFORM)
    c.eq("matching digest -> platform_source", good.get("platform_source"), "manifest")
    c.eq("matching digest -> backend", good.get("backend"), FIXTURE_BACKEND)
    c.eq("matching digest -> exe_sha256", good.get("exe_sha256"), RUN_SHA)

    # Uppercase hex is the same hash: matched, canonical value recorded.
    up_row = ask(mc, body(manifest_fixture(RUN_SHA.upper())))
    c.eq("UPPERCASE manifest digest -> status", up_row["status"], "matched")
    c.eq("UPPERCASE manifest digest -> canonical lowercase recorded",
         up_row.get("exe_sha256"), RUN_SHA)
    up_bin = ask(mc, body(manifest_fixture(RUN_SHA)), exe_sha=RUN_SHA.upper())
    c.eq("UPPERCASE binary digest -> status", up_bin["status"], "matched")
    c.eq("UPPERCASE binary digest -> canonical lowercase recorded",
         up_bin.get("exe_sha256"), RUN_SHA)

    # Every degenerate published exe_sha256: missing evidence, never a verdict.
    degenerate = {
        "key missing": "__MISSING__",
        "empty string": "",
        "null": None,
        "integer": 12345,
        "too short": "abc",
        "not hex": "z" * 64,
    }
    for name, value in degenerate.items():
        rowd = dict(row(RUN_SHA))
        if value == "__MISSING__":
            rowd.pop("exe_sha256")
        else:
            rowd["exe_sha256"] = value
        blk = ask(mc, body(manifest_fixture(None, rows=[rowd])))
        c.eq(f"degenerate row ({name}) -> status", blk["status"], "unverified")
        c.eq(f"degenerate row ({name}) -> reason_code",
             blk.get("reason_code"), "manifest-published-no-usable-exe-sha256")
        c.ok(f"degenerate row ({name}) -> NOT the fork label",
             "label" not in blk and blk["status"] != "not-the-release")

    # Two rows claiming the executed digest: no silent pick.
    dup = manifest_fixture(None, rows=[row(RUN_SHA, platform="macos-arm64",
                                           backend="metal"),
                                       row(RUN_SHA, platform="linux-x64",
                                           backend="cuda")])
    dup_block = ask(mc, body(dup))
    c.eq("duplicate rows -> status", dup_block["status"], "unverified")
    c.eq("duplicate rows -> reason_code", dup_block.get("reason_code"),
         "manifest-exe-sha256-ambiguous")
    c.eq("duplicate rows -> count recorded", dup_block.get("matched_rows"), 2)
    c.eq("duplicate rows -> no arbitrary platform picked",
         dup_block.get("platform"), mc.host_platform())
    c.eq("duplicate rows -> no arbitrary backend picked",
         dup_block.get("backend"), None)

    # The binary side: with no digest of our own there is nothing to match.
    nohash = ask(mc, body(manifest_fixture(RUN_SHA)), exe_sha="")
    c.eq("binary digest empty -> status", nohash["status"], "unverified")
    c.eq("binary digest empty -> reason_code", nohash.get("reason_code"),
         "binary-has-no-usable-exe-sha256")
    c.ok("binary digest empty -> NOT the fork label",
         "label" not in nohash and nohash["status"] != "not-the-release")
    return c


def case_b(mc):
    """Unreadable manifest -> unverified, never not-the-release."""
    c = Checks("(b) unreadable manifest")
    url = "https://dl.kalsa.io/kalsa-server/v9.9.9/manifest.json"

    down = mc.release_provenance(url, RUN_SHA, fetch=refuses,
                                 checked_utc="2026-01-01T00:00:00Z")
    c.eq("network-down status", down["status"], "unverified")
    c.eq("network-down reason_code", down.get("reason_code"),
         "manifest-fetch-failed")
    c.ok("network-down is NOT not-the-release",
         down["status"] != "not-the-release", down["status"])
    c.ok("network-down says why", "not readable" in down.get("reason", ""))
    c.eq("network-down manifest_sha256", down.get("manifest_sha256"), None)

    html = mc.release_provenance(url, RUN_SHA,
                                 fetch=returns(b"<html>404 not found</html>"),
                                 checked_utc="2026-01-01T00:00:00Z")
    c.eq("404-body status", html["status"], "unverified")
    c.eq("404-body reason_code", html.get("reason_code"),
         "manifest-body-unreadable")
    c.ok("404-body is NOT not-the-release",
         html["status"] != "not-the-release", html["status"])

    noderive = mc.release_provenance(None, RUN_SHA,
                                     fetch=returns(b"never called"),
                                     checked_utc="2026-01-01T00:00:00Z")
    c.eq("no URL derivable status", noderive["status"], "unverified")
    c.eq("no URL derivable reason_code", noderive.get("reason_code"),
         "no-manifest-url")
    c.ok("no URL derivable says why",
         "--release-manifest-url" in noderive.get("reason", ""))

    c.ok("directory kalsa-server-vX.Y.Z derives the manifest URL",
         mc.derive_manifest_url("/tmp/k111/kalsa-server-v1.1.1/kalsa-server")
         == "https://dl.kalsa.io/kalsa-server/v1.1.1/manifest.json")
    c.eq("a non-release directory derives no URL",
         mc.derive_manifest_url("/opt/builds/kalsa-server"), None)
    return c


def case_c(artifact, expect_max_load, expect_attempts):
    """The committed artifact: the recorded knobs, and its status."""
    c = Checks("(c) the committed artifact")
    try:
        data = json.loads(Path(artifact).read_text())
    except Exception as e:
        c.ok(f"artifact {artifact} readable", False, str(e))
        return c
    prov = data.get("provenance") or {}
    got = prov.get("max_load")
    c.ok("provenance.max_load present", "max_load" in prov, repr(got))
    c.ok("provenance.max_load is a number (not a string)",
         isinstance(got, (int, float)) and not isinstance(got, bool), repr(got))
    c.eq("provenance.max_load == --max-load used", got, expect_max_load)
    att = prov.get("attempts_max")
    c.ok("provenance.attempts_max present", "attempts_max" in prov, repr(att))
    c.ok("provenance.attempts_max is a number (not a string)",
         isinstance(att, (int, float)) and not isinstance(att, bool), repr(att))
    c.eq("provenance.attempts_max == --attempts used", att, expect_attempts)

    rel = prov.get("release") or {}
    c.ok("provenance.release present", "release" in prov)
    c.ok("release.status is one of the three",
         rel.get("status") in ("matched", "not-the-release", "unverified"),
         repr(rel.get("status")))
    c.eq("the artifact committed in this repo must be release.status = "
         "matched (a number the panel cites is a release measurement)",
         rel.get("status"), "matched")
    if rel.get("status") == "matched":
        c.eq("release.exe_sha256 is provenance.engine_sha256 (same hash)",
             rel.get("exe_sha256"), prov.get("engine_sha256"))
        c.ok("release.platform says where it came from",
             rel.get("platform_source") in ("manifest", "host"),
             repr(rel.get("platform_source")))
    return c


def case_e(mc):
    """The provenance builder must FOLLOW its input, with a value that is not
    the default: a `"max_load": 6.0` literal is invisible to the documented
    CLI run, whose --expect-max-load is 6.0 by definition."""
    c = Checks("(e) the provenance builder follows its input")
    args = type("Args", (), {"max_load": 4.75, "attempts": 7})()
    built = mc.run_parameters(args)
    c.eq("run_parameters(max_load=4.75).max_load follows the argument",
         built.get("max_load"), 4.75)
    c.eq("run_parameters(attempts=7).attempts_max follows the argument",
         built.get("attempts_max"), 7)
    c.ok("the distinctive values are NOT the defaults used by the artifact "
         "(a check that compares 6.0 to 6.0 kills nothing)",
         4.75 != 6.0 and 7 != 4)
    return c


CASES = {"a": lambda mc: case_a(mc), "e": lambda mc: case_e(mc)}


def case_d(mc):
    """Each mutation, applied to a copy of the harness, must turn its cases
    red. A surviving mutation exits this file with 2."""
    c = Checks("(d) mutations killed")
    source = HARNESS.read_text()
    for name, (needle, patch, case_names) in MUTATIONS.items():
        hits = source.count(needle)
        c.eq(f"{name}: needle exists exactly once in the harness", hits, 1)
        if hits != 1:
            continue
        mutated_path = HERE / f".mutation-{name}-measure-concurrency.py"
        mutated_path.write_text(source.replace(needle, patch))
        try:
            mm = load(mutated_path, f"measure_concurrency_{name.replace('-', '_')}")
            killed = 0
            total = 0
            for case_name in case_names:
                print(f"[mutation {name}] case ({case_name}) re-run against "
                      "the mutated harness; FAIL lines are the required red:",
                      file=sys.stderr)
                mutated = CASES[case_name](mm)
                killed += mutated.failed
                total += mutated.total
            c.ok(f"{name} turns its case red", killed > 0,
                 f"{killed} of {total} check(s) killed")
        finally:
            mutated_path.unlink(missing_ok=True)
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", default=str(DEFAULT_ARTIFACT))
    ap.add_argument("--expect-max-load", type=float, default=6.0,
                    help="the --max-load argument the recorded run used")
    ap.add_argument("--expect-attempts", type=int, default=4,
                    help="the --attempts argument the recorded run used")
    ap.add_argument("--skip-mutation", action="store_true")
    args = ap.parse_args()

    mc = load(HARNESS, "measure_concurrency")
    results = [case_a(mc), case_b(mc),
               case_c(args.artifact, args.expect_max_load, args.expect_attempts),
               case_e(mc)]
    if not args.skip_mutation:
        results.append(case_d(mc))

    failed = 0
    for c in results:
        verdict = "GREEN" if c.green else "RED"
        print(f"{c.name}: {verdict} ({c.total - c.failed}/{c.total})",
              file=sys.stderr)
        failed += c.failed
    sys.exit(0 if failed == 0 else 2)


if __name__ == "__main__":
    main()
