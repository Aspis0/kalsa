#!/usr/bin/env python3
"""Red/green control for the release provenance of the concurrency artifact.

Four checks, all against measure-concurrency.py's own helpers. No network, no
engine, no writes: the manifest body and the failing fetch are fixtures.

  (a) a manifest whose rows carry a DIFFERENT exe_sha256 than the binary that
      ran -> status `not-the-release`, exactly the PLAN-DISK-TIER §9 label
      `fork build, not the release`, `platform` from the host with
      `platform_source: host`, `backend: null`. The positive control beside it:
      the manifest whose row DOES carry the hash -> `matched`, and the row's
      own fields (tag, commit, platform, backend...) with
      `platform_source: manifest`.
  (b) a manifest that cannot be read (fetch raises; body that is not JSON)
      -> status `unverified`, NEVER `not-the-release`. A dead network is not
      evidence that the build is a fork build.
  (c) the committed artifact carries `provenance.max_load`, a number equal to
      the `--max-load` argument the run used (passed here as --expect-max-load,
      because the argument is external evidence and this file must not
      "derive" the expectation from the field it checks).
  (d) MUTATION: a copy of the harness whose match is ALWAYS true - the
      exe_sha256 comparison replaced by `True` - must fail (a). The mutated
      matcher still says "true" for every input, including the matching one,
      so only a check that a NON-matching manifest goes red can see it. This
      is the expensive rule of §7: the mechanism has to be able to go red for
      the reason it declares.

Exit 0 when everything is green (and the mutation is killed), 2 otherwise.

Commands:
  python3 dev/test-release-provenance.py
  python3 dev/test-release-provenance.py \
      --artifact dev/results/concurrency-two-devices/results.json \
      --expect-max-load 6.0
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

# The mutation: match becomes always-true. The matching manifest still matches
# (the mutated code says yes to everything), so the only thing that can kill it
# is case (a): a manifest whose exe_sha256 differs must go red, and with this
# mutation it answers `matched`.
MUTATION = (
    'if row.get("exe_sha256") and row.get("exe_sha256") == exe_sha256:',
    'if True:  # MUTATION: abbinamento sempre vero',
)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def manifest_fixture(exe_sha256, platform="macos-arm64", backend="metal"):
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
        "artifacts": [{
            "platform": platform,
            "backend": backend,
            "home": "https://dl.kalsa.io/kalsa-server/v9.9.9",
            "file": "kalsa-server-v9.9.9-bin-macos-arm64.tar.gz",
            "url": "https://dl.kalsa.io/kalsa-server/v9.9.9/x.tar.gz",
            "format": "tar.gz",
            "top_dir": "kalsa-server-v9.9.9",
            "exe": "kalsa-server",
            "size_bytes": 11207195,
            "sha256": "d" * 64,
            "exe_sha256": exe_sha256,
        }],
    }


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


def case_a(mc):
    """A manifest that does not carry this hash must go red (not-the-release),
    and one that does must go green (matched)."""
    c = Checks("(a) match / not-the-release")
    url = "https://dl.kalsa.io/kalsa-server/v9.9.9/manifest.json"

    other = mc.release_provenance(url, RUN_SHA,
                                  fetch=returns(json.dumps(
                                      manifest_fixture(OTHER_SHA)).encode()),
                                  checked_utc="2026-01-01T00:00:00Z")
    c.eq("status", other["status"], "not-the-release")
    c.eq("label", other.get("label"), FORK_LABEL)
    c.eq("backend", other.get("backend"), None)
    c.eq("platform", other.get("platform"), mc.host_platform())
    c.eq("platform_source", other.get("platform_source"), "host")
    c.ok("manifest_sha256 recorded (the manifest WAS read)",
         re.fullmatch(r"[0-9a-f]{64}", other.get("manifest_sha256") or "") is not None)
    c.ok("tag/commit of the unread row NOT asserted",
         "tag" not in other and "commit" not in other)

    good = mc.release_provenance(url, RUN_SHA,
                                 fetch=returns(json.dumps(
                                     manifest_fixture(RUN_SHA)).encode()),
                                 checked_utc="2026-01-01T00:00:00Z")
    c.eq("positive control status", good["status"], "matched")
    c.eq("positive control tag", good.get("tag"), "kalsa-server-v9.9.9")
    c.eq("positive control platform", good.get("platform"), "macos-arm64")
    c.eq("positive control platform_source", good.get("platform_source"), "manifest")
    c.eq("positive control backend", good.get("backend"), "metal")
    c.eq("positive control exe_sha256", good.get("exe_sha256"), RUN_SHA)
    return c


def case_b(mc):
    """Unreadable manifest -> unverified, never not-the-release."""
    c = Checks("(b) unreadable manifest")
    url = "https://dl.kalsa.io/kalsa-server/v9.9.9/manifest.json"

    down = mc.release_provenance(url, RUN_SHA, fetch=refuses,
                                 checked_utc="2026-01-01T00:00:00Z")
    c.eq("network-down status", down["status"], "unverified")
    c.ok("network-down is NOT not-the-release",
         down["status"] != "not-the-release", down["status"])
    c.ok("network-down says why", "not readable" in down.get("reason", ""))
    c.eq("network-down manifest_sha256", down.get("manifest_sha256"), None)

    html = mc.release_provenance(url, RUN_SHA,
                                 fetch=returns(b"<html>404 not found</html>"),
                                 checked_utc="2026-01-01T00:00:00Z")
    c.eq("404-body status", html["status"], "unverified")
    c.ok("404-body is NOT not-the-release",
         html["status"] != "not-the-release", html["status"])

    noderive = mc.release_provenance(None, RUN_SHA,
                                     fetch=returns(b"never called"),
                                     checked_utc="2026-01-01T00:00:00Z")
    c.eq("no URL derivable status", noderive["status"], "unverified")
    c.ok("no URL derivable says why",
         "--release-manifest-url" in noderive.get("reason", ""))

    if not (mc.derive_manifest_url("/tmp/k111/kalsa-server-v1.1.1/kalsa-server")
            == "https://dl.kalsa.io/kalsa-server/v1.1.1/manifest.json"):
        c.ok("directory kalsa-server-vX.Y.Z derives the manifest URL", False)
    else:
        c.ok("directory kalsa-server-vX.Y.Z derives the manifest URL", True)
    c.eq("a non-release directory derives no URL",
         mc.derive_manifest_url("/opt/builds/kalsa-server"), None)
    return c


def case_c(artifact, expect_max_load):
    """max_load exists in the artifact and equals the argument the run used."""
    c = Checks("(c) max_load in the artifact")
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
    rel = prov.get("release") or {}
    c.ok("provenance.release present", "release" in prov)
    c.ok("release.status is one of the three",
         rel.get("status") in ("matched", "not-the-release", "unverified"),
         repr(rel.get("status")))
    if rel.get("status") == "matched":
        c.eq("release.exe_sha256 is provenance.engine_sha256 (same hash)",
             rel.get("exe_sha256"), prov.get("engine_sha256"))
        c.ok("release.platform says where it came from",
             rel.get("platform_source") in ("manifest", "host"),
             repr(rel.get("platform_source")))
    return c


def case_d(mc):
    """Run (a) against a copy of the harness whose match is always true.

    The mutated matcher still says 'true' for the matching manifest (the
    positive control of (a) stays green), so the only thing that can turn red
    is the assertion that a NON-matching manifest goes `not-the-release`.
    This control file exits 2 if that assertion does NOT go red: a mutation
    that survives is a RED result here.
    """
    c = Checks("(d) mutation kills (a)")
    source = HARNESS.read_text()
    needle, patch = MUTATION
    hits = source.count(needle)
    c.eq("mutation needle exists exactly once in the harness", hits, 1)
    if hits != 1:
        return c

    mutated_path = HERE / ".mutation-measure-concurrency.py"
    mutated_path.write_text(source.replace(needle, patch))
    try:
        mm = load(mutated_path, "measure_concurrency_mutated")
        print("[mutation demo] case (a) re-run against the ALWAYS-TRUE match; "
              "FAIL lines below are the required red:", file=sys.stderr)
        mutated_a = case_a(mm)
        c.eq("(a) turns red under the mutation",
             mutated_a.green, False)
        c.ok("how much of (a) is red", mutated_a.failed >= 1,
             f"{mutated_a.failed} failing check(s); the matching-manifest "
             "positive control stays green because the match is always true")
    finally:
        mutated_path.unlink(missing_ok=True)
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", default=str(DEFAULT_ARTIFACT))
    ap.add_argument("--expect-max-load", type=float, default=6.0,
                    help="the --max-load argument the recorded run used")
    ap.add_argument("--skip-mutation", action="store_true")
    args = ap.parse_args()

    mc = load(HARNESS, "measure_concurrency")
    results = [case_a(mc), case_b(mc), case_c(args.artifact, args.expect_max_load)]
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
