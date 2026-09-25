#!/usr/bin/env python3
"""Keep the engine pin honest: the pinned Engine row against the manifest
Kalsa actually publishes.

THE ANCHOR IS DECLARED HERE, NEVER READ FROM THE THING BEING VERIFIED.
`RELEASE` below is this control's own statement of which release the row
must describe; the manifest URL is built from it, `home` is checked against
what it implies, and the fetched manifest's own `tag` must equal it. Deriving
any of those from `FORK_BASE` — the constant under test — was the defect this
revision fixes: with the anchor taken from the value, a `FORK_BASE` pointing
at v1.1.0 made the control move ITS OWN URL to v1.1.0, agree with itself, and
go red for the wrong reason with `home` never named. Same class as
`chat/scripts/tier-panel.mjs`'s rule: "two sources that must agree cannot be
one".

What it checks — EVERY field of the macOS arm64/metal Engine row in
`crates/kalsa-runtime/src/assets.rs`:

    home   against what RELEASE implies (NOT against FORK_BASE), plus the
           row-vs-manifest comparison that falls out of it
    file, size_bytes, sha256, exe_sha256   against the manifest row
    plus: manifest.tag == RELEASE (a manifest swapped under the control is
          caught), manifest.home == what RELEASE implies, size_bytes != 0,
          digests 64 lowercase hex.

Judged by what happens when a value is wrong in a way nobody watches:

  SILENT fields — `home` and `file`: the download verifies size/sha only. A
    wrong `home` resolves to a 404, or to a still-credible old path if the
    shape ever changes; a wrong `file` looks the old name up inside the new
    archive. The user meets both, after install.
  NOISY fields — `size_bytes` and `sha256`: `store.rs:269`/`:292` verify the
    download against them, so a check red only here echoes a scream.
  SEMI-SILENT — `exe_sha256`: the download never looks at it; `marker.rs`
    re-checks it at every engine start.

The normal invocation fetches the manifest live (the CDN 403s urllib's
default User-Agent, so an explicit one is sent). The MUTATIONS are proved two
ways, both with the anchor FIRM:
  - row mutations: the real `assets.rs` copied to /tmp and patched there
    (never the repo file), run against the manifest recorded once in memory;
    each must be red with its OWN field named and with the DECLARED URL in
    the header — proof it did not go and fetch the other release's manifest;
  - anchor mutation: a copy of THIS file with RELEASE at v1.1.0, run live
    against the untouched row: it must be red with `home` in the mismatch,
    i.e. row and anchor telling different releases is never green.

Exit 0 when the row matches the declared release and every mutation is
caught, 2 otherwise.

Commands:
  python3 dev/test-engine-pin.py
  python3 dev/test-engine-pin.py --skip-mutations
  python3 dev/test-engine-pin.py --manifest-file /tmp/manifest.json
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
ASSETS_RS = REPO / "crates" / "kalsa-runtime" / "src" / "assets.rs"
SELF = Path(__file__).resolve()

# The anchor. Declared by this control, in this file, on purpose.
RELEASE = "kalsa-server-v1.1.2"
RELEASE_HOME = ("https://dl.kalsa.io/kalsa-server/"
                + RELEASE.removeprefix("kalsa-server-"))
MANIFEST_URL = RELEASE_HOME + "/manifest.json"

FIELDS = ("home", "file", "size_bytes", "sha256", "exe_sha256")

# The wrong values a stale pin would carry: v1.1.0's own numbers, read from
# v1.1.0's published manifest — the realistic mistake, not a random digit.
V110_HOME = "https://dl.kalsa.io/kalsa-server/v1.1.0"
V110_FILE = "kalsa-server-v1.1.0-bin-macos-arm64.tar.gz"
V110_SIZE = "Some(11_205_316)"
V110_SHA = "9ee5d9f5199475844c99ac93272d429711b2f58d2a7c5d652c7495a391c5f034"
WRONG_EXE = "ab" * 32

# name -> (needle that must occur exactly once in assets.rs, replacement,
#          output token that must appear in the red run, how loud the system
#          already is about this field)
MUTATIONS = {
    "home (FORK_BASE, as the reviewer mutated it)": (
        'const FORK_BASE: &str = "https://dl.kalsa.io/kalsa-server/v1.1.2";',
        f'const FORK_BASE: &str = "{V110_HOME}";',
        "home:",
        "SILENT at runtime — the download verifies size/sha, not the host; "
        "the Rust test only asserts home == FORK_BASE (a stale pair passes "
        "together); the user meets the wrong host after install"),
    "file": (
        '        file: "kalsa-server-v1.1.2-bin-macos-arm64.tar.gz",',
        f'        file: "{V110_FILE}",',
        "file:",
        "SILENT at runtime — the download verifies size/sha, not the name; "
        "the old name gets looked for inside the new archive"),
    "size_bytes": (
        "        size_bytes: Some(11_207_047),",
        f"        size_bytes: {V110_SIZE},",
        "size_bytes:",
        "NOISY — store.rs:269 verifies the download against it and would "
        "already scream"),
    "sha256": (
        '        sha256: Some("691943209c6461ade1faa5fd67fd6725c9e0007aa9792f0a7bd7d7c408cb6961"),',
        f'        sha256: Some("{V110_SHA}"),',
        "sha256: row",
        "NOISY — store.rs:292 verifies the download against it and would "
        "already scream"),
    "exe_sha256": (
        '        exe_sha256: Some("327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"),',
        f'        exe_sha256: Some("{WRONG_EXE}"),',
        "exe_sha256:",
        "SEMI-SILENT — the download never looks at it; marker.rs shouts "
        "only at engine start"),
}


class Fail(list):
    def add(self, msg):
        self.append(msg)


# --------------------------------------------------------------------------
# the row, as the repo has it
# --------------------------------------------------------------------------
def parse_row(text):
    """The macOS arm64/metal Engine row of ASSETS. FORK_BASE is resolved only
    to learn what `home` SAYS — the anchor of the comparison is RELEASE."""
    const = dict(re.findall(r'const (\w+): &str = "([^"]+)";', text))
    # Row literals are indented (`    Asset {` ... `    },`); the struct and
    # the impl are at column 0, so anchoring on the indent keeps them out.
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
        m = re.match(r'"([^"]+)"', raw(field) or "")
        return m.group(1) if m else None

    home = raw("home")
    if home and not home.startswith('"'):
        home = const.get(home, home)          # `home: FORK_BASE` -> its value
    else:
        home = quoted("home")

    def some_int(field):
        m = re.match(r"Some\((\d[\d_]*)\)", raw(field) or "")
        return int(m.group(1).replace("_", "")) if m else None

    def some_str(field):
        m = re.match(r'Some\("([^"]+)"\)', raw(field) or "")
        return m.group(1) if m else None

    return {
        "home": home,
        "file": quoted("file"),
        "size_bytes": some_int("size_bytes"),
        "sha256": some_str("sha256"),
        "exe_sha256": some_str("exe_sha256"),
    }


# --------------------------------------------------------------------------
# the manifest, fetched from the DECLARED url
# --------------------------------------------------------------------------
def fetch(url):
    # dl.kalsa.io 403s Python-urllib's default User-Agent.
    req = urllib.request.Request(
        url, headers={"User-Agent": "kalsa-engine-pin-check/2.0 (assets.rs "
                                    "row vs the declared release manifest)",
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
            return {"tag": data.get("tag"), "home": row.get("home"),
                    **{k: row.get(k) for k in FIELDS}}
    raise SystemExit(f"manifest at {url} has no macos-arm64/metal row")


def check_manifest(man):
    """The manifest must be the one RELEASE names — otherwise a manifest
    swapped under the control would silently redefine what 'correct' means."""
    fail = Fail()
    if man.get("tag") != RELEASE:
        fail.add(f"manifest tag: fetched manifest declares "
                 f"{man.get('tag')!r}, this control declares RELEASE "
                 f"{RELEASE!r}: the manifest was swapped under the control, "
                 "or the control is stale")
    if man.get("home") != RELEASE_HOME:
        fail.add(f"manifest home: manifest says {man.get('home')!r}, RELEASE "
                 f"{RELEASE} implies {RELEASE_HOME!r}")
    return fail


def compare(row, man):
    """Row against the declared release. `home` is checked FIRST and against
    what RELEASE implies — never against FORK_BASE, which IS the row's own
    value — and the message names the field and says it points elsewhere."""
    fail = Fail()
    if row.get("home") != RELEASE_HOME:
        fail.add(f"home: row points at ANOTHER RELEASE: "
                 f"{row.get('home')!r} != {RELEASE_HOME!r} implied by "
                 f"RELEASE {RELEASE} (and != the manifest's "
                 f"{man.get('home')!r})")
    for field in ("file", "size_bytes", "sha256", "exe_sha256"):
        if row.get(field) != man.get(field):
            fail.add(f"{field}: row {row.get(field)!r} != manifest "
                     f"{man.get(field)!r}")
    if not isinstance(row.get("size_bytes"), int) or row["size_bytes"] == 0:
        fail.add(f"size_bytes must be a non-zero integer, got "
                 f"{row.get('size_bytes')!r}")
    for field in ("sha256", "exe_sha256"):
        v = row.get(field)
        if not (isinstance(v, str) and len(v) == 64
                and all(c in "0123456789abcdef" for c in v)):
            fail.add(f"{field}: row is not 64 lowercase hex characters: {v!r}")
    return fail


def live_check(assets_path, body, url, source):
    row = parse_row(Path(assets_path).read_text())
    man = parse_manifest(body, url)
    print(f"live row vs {url}  (declared by RELEASE {RELEASE}, never read "
          f"from the row; manifest from {source})", file=sys.stderr)
    fail = check_manifest(man)
    fail += compare(row, man)
    for field in FIELDS:
        want = RELEASE_HOME if field == "home" else man.get(field)
        mark = "ok" if row.get(field) == want else "FAIL"
        print(f"  [{mark}] {field}: {row.get(field)!r}", file=sys.stderr)
    for f in fail:
        print(f"  [FAIL] {f}", file=sys.stderr)
    if not fail:
        print("  [ok] every field matches the declared release; size_bytes "
              "!= 0; digests shaped like sha256; manifest tag == RELEASE",
              file=sys.stderr)
    return fail


# --------------------------------------------------------------------------
# mutations: real row copies under /tmp, anchor FIRM, manifest in memory
# --------------------------------------------------------------------------
def run_self(argv):
    p = subprocess.run([sys.executable, str(SELF)] + argv,
                       capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)


def run_mutations(assets_text, recorded_manifest_path):
    survived = Fail()
    tmp = Path(tempfile.mkdtemp(prefix="engine-pin-mutation-"))
    print(f"mutations (copies under {tmp}, anchor RELEASE {RELEASE} firm):",
          file=sys.stderr)

    # (a) row mutations: the REAL assets.rs, patched in /tmp, compared
    # against the manifest recorded once in memory.
    for name, (needle, patch, token, loudness) in MUTATIONS.items():
        hits = assets_text.count(needle)
        if hits != 1:
            print(f"  [FAIL] {name}: needle occurs {hits} times, expected 1 "
                  "(the source moved; this mutation proves nothing)",
                  file=sys.stderr)
            survived.add(f"mutation {name}: the needle moved, unproven")
            continue
        copy = tmp / f"assets--mutated-{re.sub(r'[^a-z0-9]+', '-', name.lower())}.rs"
        copy.write_text(assets_text.replace(needle, patch))
        code, out = run_self(["--assets", str(copy),
                              "--manifest-file", str(recorded_manifest_path),
                              "--skip-mutations"])
        red = code != 0
        named = token in out
        declared = f"live row vs {MANIFEST_URL}" in out
        wrong_host = f"{V110_HOME}/manifest.json" in out
        ok = red and named and declared and not wrong_host
        if not ok:
            survived.add(f"row mutation {name} survived (exit {code}, field "
                         f"named {named}, declared URL {declared})")
        print(f"  [{'ok' if ok else 'FAIL'}] row mutation {name}: "
              f"{'CAUGHT' if ok else 'SURVIVED'} "
              f"(exit {code}, field named: {named}, declared URL shown: "
              f"{declared}, fetched the OTHER release's manifest: "
              f"{wrong_host})", file=sys.stderr)
        print(f"         {loudness}", file=sys.stderr)
        if ok or red:
            for line in out.strip().splitlines():
                print(f"         | {line}", file=sys.stderr)

    # (b) anchor mutation: THIS control with RELEASE at v1.1.0, run LIVE
    # against the untouched row. Its manifest will be v1.1.0's and its tag
    # will match its own RELEASE, so green here would mean row and anchor
    # disagree and the control did not notice.
    control = tmp / "test-engine-pin--anchor-v1.1.0.py"
    own = SELF.read_text()
    needle = '\nRELEASE = "kalsa-server-v1.1.2"\n'
    if own.count(needle) != 1:
        print("  [FAIL] anchor mutation: RELEASE needle moved", file=sys.stderr)
        survived.add("anchor mutation: the RELEASE definition moved, unproven")
    else:
        control.write_text(own.replace(
            needle, '\nRELEASE = "kalsa-server-v1.1.0"\n'))
        p = subprocess.run([sys.executable, str(control),
                            "--assets", str(ASSETS_RS), "--skip-mutations"],
                           capture_output=True, text=True)
        out = p.stdout + p.stderr
        red = p.returncode != 0
        named = "home:" in out
        its_own_manifest = f"live row vs {V110_HOME}/manifest.json" in out
        ok = red and named and its_own_manifest
        if not ok:
            survived.add("anchor mutation RELEASE -> kalsa-server-v1.1.0 "
                         f"survived (exit {p.returncode}, home named {named}, "
                         f"own manifest {its_own_manifest})")
        print(f"  [{'ok' if ok else 'FAIL'}] anchor mutation RELEASE -> "
              f"kalsa-server-v1.1.0 with the row untouched: "
              f"{'CAUGHT' if ok else 'SURVIVED'} (exit {p.returncode}, "
              f"home named: {named}, fetched its own declared manifest: "
              f"{its_own_manifest})", file=sys.stderr)
        print("         the anchor is declared, so the control no longer "
              "follows the value it verifies", file=sys.stderr)
        for line in out.strip().splitlines():
            print(f"         | {line}", file=sys.stderr)

    # (c) manifest swapped under the control: tag says another release while
    # RELEASE does not move.
    swapped = tmp / "manifest--swapped-tag.json"
    body = Path(recorded_manifest_path).read_bytes()
    swapped.write_bytes(body.replace(
        f'"tag": "{RELEASE}"'.encode(), b'"tag": "kalsa-server-v9.9.9"'))
    code, out = run_self(["--assets", str(ASSETS_RS),
                          "--manifest-file", str(swapped),
                          "--skip-mutations"])
    ok = code != 0 and "manifest tag:" in out
    if not ok:
        survived.add("swapped-manifest mutation survived")
    print(f"  [{'ok' if ok else 'FAIL'}] swapped manifest (tag "
          f"kalsa-server-v9.9.9 under an unchanged RELEASE): "
          f"{'CAUGHT' if ok else 'SURVIVED'} (exit {code})", file=sys.stderr)
    for line in out.strip().splitlines():
        print(f"         | {line}", file=sys.stderr)

    return survived


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default=str(ASSETS_RS))
    ap.add_argument("--manifest-file", default=None,
                    help="read the manifest from a file instead of fetching "
                         "it live")
    ap.add_argument("--skip-mutations", action="store_true")
    args = ap.parse_args()

    url = MANIFEST_URL                     # declared, not derived from the row
    if args.manifest_file:
        body = Path(args.manifest_file).read_bytes()
        source = f"file {args.manifest_file}"
    else:
        body = fetch(url)
        source = "live fetch"
    fail = live_check(args.assets, body, url, source)

    recorded = None
    if not args.skip_mutations:
        recorded = Path(tempfile.gettempdir()) / "engine-pin-manifest.json"
        recorded.write_bytes(body)
        fail += run_mutations(Path(args.assets).read_text(), recorded)

    verdict = "GREEN" if not fail else "RED"
    print(f"engine pin: {verdict} ({len(fail)} failing check(s))",
          file=sys.stderr)
    sys.exit(0 if not fail else 2)


if __name__ == "__main__":
    main()
