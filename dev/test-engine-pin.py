#!/usr/bin/env python3
"""Keep the engine pin honest: the pinned Engine row against the manifest
Kalsa actually publishes.

What it checks — EVERY field of the macOS arm64/metal Engine row in
`crates/kalsa-runtime/src/assets.rs`, against the same release's published
manifest (`<FORK_BASE>/manifest.json`, macos-arm64/metal row), field by
field:

    home, file, size_bytes, sha256, exe_sha256   (+ size_bytes != 0)

None of them is excluded because "the download already verifies it".
Judged by what happens when a value is wrong in a way nobody watches:

  SILENT fields — `home` and `file`: nothing in the app compares them to the
    manifest. A wrong `home` resolves to a 404, or worse to a still-credible
    v1.1.0 path if the shape ever changes; a wrong `file` makes the old name
    be looked for inside the new archive. The suite is silent on both; the
    USER meets it, after install.

  NOISY fields — `size_bytes` and `sha256`: `store.rs` verifies the download
    against them (:269, :292), so a wrong value already fails loudly. A check
    that goes red only here is an echo of a scream the system gives anyway,
    not a net.

  SEMI-SILENT — `exe_sha256`: the download never looks at it; `marker.rs`
    re-checks it on every engine start, so it shouts late, at start, not at
    install.

Normal invocation fetches the manifest live (like
`dev/test-release-provenance.py`; note the CDN 403s urllib's default
User-Agent, so an explicit one is sent). The MUTATIONS never touch the repo
file: they are applied to a copy of the row written under /tmp and compared
against the manifest fetched ONCE into memory, so the proof is deterministic
and does not depend on the network at mutation time.

Exit 0 when the row matches the manifest and every mutation is caught,
2 otherwise.

Commands:
  python3 dev/test-engine-pin.py
  python3 dev/test-engine-pin.py --manifest-file /tmp/manifest.json
"""

import argparse
import json
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
ASSETS_RS = REPO / "crates" / "kalsa-runtime" / "src" / "assets.rs"

FIELDS = ("home", "file", "size_bytes", "sha256", "exe_sha256")

# The wrong values a stale pin would carry: v1.1.0's own numbers, read from
# v1.1.0's published manifest — the realistic mistake, not a random digit.
V110 = "https://dl.kalsa.io/kalsa-server/v1.1.0"
V110_FILE = "kalsa-server-v1.1.0-bin-macos-arm64.tar.gz"
V110_SIZE = 11_205_316
V110_SHA = "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034"
WRONG_EXE = "ab" * 32

# field -> (wrong value, how loud the system already is about this field)
MUTATIONS = {
    "home": (V110, "SILENT at runtime — the download verifies size/sha, not "
                   "the host; the Rust test only asserts home == FORK_BASE "
                   "(a stale pair passes together); the user meets the wrong "
                   "host after install"),
    "file": (V110_FILE, "SILENT at runtime — the download verifies "
                        "size/sha, not the name; the old name gets looked for "
                        "inside the new archive; caught here and by the "
                        "pinned unit test, never by store.rs"),
    "size_bytes": (V110_SIZE, "NOISY — store.rs:269 verifies the download "
                              "against it and would already scream"),
    "sha256": (V110_SHA, "NOISY — store.rs:292 verifies the download against "
                         "it and would already scream"),
    "exe_sha256": (WRONG_EXE, "SEMI-SILENT — the download never looks at it; "
                              "marker.rs shouts only at engine start"),
}


class Fail(list):
    def add(self, msg):
        self.append(msg)


# --------------------------------------------------------------------------
# the row, as the repo has it
# --------------------------------------------------------------------------
def parse_row(text):
    """The macOS arm64/metal Engine row of ASSETS, plus FORK_BASE."""
    const = dict(re.findall(r'const (\w+): &str = "([^"]+)";', text))
    # Row literals are indented (`    Asset {` ... `    },`); the struct and
    # the impl are at column 0, so anchoring on the indent keeps them out —
    # a looser pattern swallowed the struct declaration and made every
    # mutation "caught" by a parse failure of its own.
    block = None
    for candidate in re.findall(r"(?m)^    Asset \{(.*?)^    \},$",
                                text, re.S | re.M):
        if "platform: Some(Platform::MacArm64)" in candidate \
                and "role: Role::Engine" in candidate:
            block = candidate
            break
    if block is None:
        raise SystemExit("no macOS arm64 Engine row found in assets.rs: the "
                         "table moved and this check reads it wrongly")

    def raw(field):
        m = re.search(rf"(?<![\w]){field}:\s*([^\n]+)", block)
        return m.group(1).strip().rstrip(",") if m else None

    def quoted(field):
        v = raw(field)
        m = re.match(r'"([^"]+)"', v or "")
        return m.group(1) if m else None

    home = raw("home")
    if home and not home.startswith('"'):
        home = const.get(home, home)          # `home: FORK_BASE` -> the const
    else:
        home = quoted("home")

    def some_int(field):
        v = raw(field)
        m = re.match(r"Some\((\d[\d_]*)\)", v or "")
        return int(m.group(1).replace("_", "")) if m else None

    def some_str(field):
        v = raw(field)
        m = re.match(r'Some\("([^"]+)"\)', v or "")
        return m.group(1) if m else None

    return {
        "home": home,
        "file": quoted("file"),
        "size_bytes": some_int("size_bytes"),
        "sha256": some_str("sha256"),
        "exe_sha256": some_str("exe_sha256"),
        "_fork_base": const.get("FORK_BASE"),
    }


# --------------------------------------------------------------------------
# the manifest, as the publisher serves it
# --------------------------------------------------------------------------
def fetch(url):
    # dl.kalsa.io 403s Python-urllib's default User-Agent.
    req = urllib.request.Request(
        url, headers={"User-Agent": "kalsa-engine-pin-check/1.0 (assets.rs "
                                    "row vs published manifest)",
                      "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def parse_manifest(body, url):
    try:
        data = json.loads(body.decode("utf-8", errors="replace"))
    except Exception as e:
        raise SystemExit(f"manifest at {url} is not readable JSON: {e}")
    rows = data.get("artifacts")
    if not isinstance(rows, list):
        raise SystemExit(f"manifest at {url} carries no artifacts[]")
    for row in rows:
        if isinstance(row, dict) and row.get("platform") == "macos-arm64" \
                and row.get("backend") == "metal":
            return {k: row.get(k) for k in FIELDS}
    raise SystemExit(f"manifest at {url} has no macos-arm64/metal row")


def compare(row, manifest_row):
    """Field by field. Nothing excluded as 'already covered'."""
    fail = Fail()
    for field in FIELDS:
        if row.get(field) != manifest_row.get(field):
            fail.add(f"{field}: row {row.get(field)!r} != manifest "
                     f"{manifest_row.get(field)!r}")
    if not isinstance(row.get("size_bytes"), int) or row["size_bytes"] == 0:
        fail.add(f"size_bytes must be a non-zero integer, got "
                 f"{row.get('size_bytes')!r}")
    for field in ("sha256", "exe_sha256"):
        v = row.get(field)
        if not (isinstance(v, str) and len(v) == 64
                and all(c in "0123456789abcdef" for c in v)):
            fail.add(f"{field} is not 64 lowercase hex characters: {v!r}")
    if row.get("home") != row.get("_fork_base") and row.get("_fork_base"):
        fail.add(f"home {row.get('home')!r} is not FORK_BASE "
                 f"{row.get('_fork_base')!r}: the row and the constant "
                 "disagree, and url() follows home")
    return fail


# --------------------------------------------------------------------------
# mutations: on a COPY of the row under /tmp, against the in-memory manifest
# --------------------------------------------------------------------------
def run_mutations(pristine, manifest_row, manifest_in_memory):
    failures = 0
    with tempfile.TemporaryDirectory(prefix="engine-pin-mutation-") as tmp:
        base = Path(tmp) / "row-copy.json"
        base.write_text(json.dumps(pristine, indent=1))
        for field, (wrong, loudness) in MUTATIONS.items():
            mutated = json.loads(base.read_text())   # always from the copy
            mutated[field] = wrong
            mutated_path = Path(tmp) / f"row-copy--mutated-{field}.json"
            mutated_path.write_text(json.dumps(mutated, indent=1))
            # re-read from the /tmp copy, so what is compared is the file,
            # not a dict this process happens to hold
            loaded = json.loads(mutated_path.read_text())
            caught = compare(loaded, manifest_in_memory)
            ok = len(caught) > 0
            if not ok:
                failures += 1
            verdict = "CAUGHT" if ok else "SURVIVED (this check is an echo)"
            print(f"  [{'ok' if ok else 'FAIL'}] mutation {field} -> "
                  f"{wrong!r}: {verdict}", file=sys.stderr)
            print(f"         {loudness}", file=sys.stderr)
            if ok:
                fired = "; ".join(caught)
                print(f"         fired: {fired}", file=sys.stderr)
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default=str(ASSETS_RS))
    ap.add_argument("--manifest-file", default=None,
                    help="read the manifest from a file instead of fetching "
                         "it live (the mutations always use the in-memory "
                         "copy of whatever was fetched/read once)")
    ap.add_argument("--skip-mutations", action="store_true")
    args = ap.parse_args()

    text = Path(args.assets).read_text()
    row = parse_row(text)
    if not row["_fork_base"]:
        raise SystemExit("FORK_BASE not found: the row's home is not pinned "
                         "through the constant this check knows about")
    url = f"{row['_fork_base']}/manifest.json"
    body = Path(args.manifest_file).read_bytes() if args.manifest_file \
        else fetch(url)
    manifest_row = parse_manifest(body, url)

    fail = compare(row, manifest_row)
    print(f"live row vs {url}", file=sys.stderr)
    for field in FIELDS:
        mark = "ok" if row.get(field) == manifest_row.get(field) else "FAIL"
        print(f"  [{mark}] {field}: {row.get(field)!r}", file=sys.stderr)
    if fail:
        for f in fail:
            print(f"  [FAIL] {f}", file=sys.stderr)
    else:
        print("  [ok] every field matches, size_bytes != 0, digests shaped "
              "like sha256, home == FORK_BASE", file=sys.stderr)

    mutated_failures = 0
    if not args.skip_mutations:
        print("mutations (row copy in /tmp, manifest in memory):",
              file=sys.stderr)
        mutated_failures = run_mutations(row, manifest_row, manifest_row)

    verdict = "GREEN" if not fail and mutated_failures == 0 else "RED"
    print(f"engine pin: {verdict} (live mismatches {len(fail)}, "
          f"surviving mutations {mutated_failures})", file=sys.stderr)
    sys.exit(0 if verdict == "GREEN" else 2)


if __name__ == "__main__":
    main()
