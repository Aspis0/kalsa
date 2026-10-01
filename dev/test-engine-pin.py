#!/usr/bin/env python3
"""Keep the engine pin honest: the pinned Engine rows against the manifest
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

What it checks — EVERY field of the three Engine rows in
`crates/kalsa-runtime/src/assets.rs` (macos-arm64/metal, win-cpu-x64,
win-vulkan-x64):

    home   against what RELEASE implies (NOT against FORK_BASE), plus the
           row-vs-manifest comparison that falls out of it
    file, size_bytes, sha256, exe_sha256   against the manifest row for
           that row's platform
    plus: manifest.tag == RELEASE (a manifest swapped under the control is
          caught), manifest.home == what RELEASE implies, size_bytes != 0,
          digests 64 lowercase hex.

Judged by what happens when a value is wrong in a way nobody watches:

  SILENT fields — `home` and `file`: the download verifies size/sha only. A
    wrong `home` resolves to a 404, or to a still-credible old path if the
    shape ever changes; a wrong `file` changes the fetch path itself
    (`Asset::url()` is home/file). The user meets both, after install.
  NOISY fields — `size_bytes` and `sha256`: store.rs verifies the bytes
    against both while acquiring (`ensure_archive` reads them off the row,
    `acquire` downloads under them, `file_digest_is` re-checks size then
    digest), so a check red only here echoes a scream.
  SEMI-SILENT — `exe_sha256`: the download never looks at it; `publish()`
    refuses an unmatched exe before installing, `marker.rs` at every start.

The normal invocation fetches the manifest live (the CDN 403s urllib's
default User-Agent, so an explicit one is sent). The row MUTATIONS run on
copies of the real `assets.rs` under /tmp (never the repo file), against
the manifest recorded once in memory — a mutated copy cannot choose the
release it is judged against. Each must be red with its OWN failure line
printed: a green run prints an `[ok]` line per field, so the token a
mutation must show is the mismatch text, which only a red run prints.
Every mutation reproduces a real mistake with real published numbers,
never random digits: the file, size_bytes, sha256 and exe_sha256
mutations plant v1.1.4's own values (the release the pin just left),
the home mutation points FORK_BASE at v1.1.4's home with the row
otherwise untouched (a half-edited repin), and the cpu/vulkan swap
exchanges two digests this release itself published — the mistake only
a control that reads the Windows rows can see.

The anchor mutation is the other half: a copy of THIS file with RELEASE
at v1.1.4, run live against the untouched rows. It must be red with the
`home` mismatch printed — rows and anchor telling different releases is
never green — and it must have fetched the manifest its own anchor
declares, not this one.

The mirror (`FORK_MIRROR`, Hugging Face at a pinned commit) is the second
source for the same files. Each row's `mirror` must equal the home declared
here, and the commit it names is asked, through Hugging Face's paths-info
API, to serve each row's file at the row's size and sha256. Two mutations
cover it: a stale commit, and a file name from an older release. Every
child run asks Hugging Face live, so the mirror leg needs network too.

Exit 0 when the rows match the declared release and every mutation is
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
RELEASE = "kalsa-server-v1.1.5"
RELEASE_HOME = ("https://dl.kalsa.io/kalsa-server/"
                + RELEASE.removeprefix("kalsa-server-"))
MANIFEST_URL = RELEASE_HOME + "/manifest.json"

FIELDS = ("home", "file", "size_bytes", "sha256", "exe_sha256")

# The second source, declared here and never read from the row: the
# Hugging Face mirror pinned at a COMMIT (a tag there can move). The row's
# archive is only a safe fallback if that commit serves each pinned file at
# the pinned size and sha256 — the digest is what makes a second source safe.
MIRROR_COMMIT = "f038a4f4f34bd1c5287271e4fa477932112c7a6b"
MIRROR_HOME = ("https://huggingface.co/Kalsa-ai/kalsa-server/resolve/"
               + MIRROR_COMMIT)
MIRROR_API = ("https://huggingface.co/api/models/Kalsa-ai/kalsa-server/"
              "paths-info/")
# What a stale mirror pin looks like: v1.1.4's commit, which never held the
# v1.1.5 files.
V114_MIRROR_COMMIT = "7537e3cc311777491f74caa0b3af68b214de69b2"

# The wrong values a stale pin would carry: v1.1.4's own numbers, read from
# v1.1.4's published manifest — the realistic mistake, not a random digit.
V114_HOME = "https://dl.kalsa.io/kalsa-server/v1.1.4"
V114_FILE = "kalsa-server-v1.1.4-bin-macos-arm64.tar.gz"
V114_SIZE = "Some(11_890_855)"
V114_SHA = "08bc196ac32ccad715f889c58f499ce2553340047375fb7fdddfe7e4b65aed60"
V114_EXE = "2200e5e41341e4ffbee4e27ece5044a0816a868d4c29369772b257d8ddeae024"
V114_WIN_CPU_FILE = "kalsa-server-v1.1.4-bin-win-cpu-x64.zip"
V114_WIN_CPU_SIZE = "Some(14_487_114)"
V114_WIN_CPU_EXE = "a7ac3d1f81d44d927e5314b715580af6e9b40ca88a492cdca058a54af412ca26"

# name -> ([(needle, replacement), ...] — every needle must occur exactly
#          once in assets.rs and all are applied in ONE pass, so a swap
#          cannot re-replace its own output —,
#          output token that only the FAILURE line for that field prints
#          (a green run prints an `[ok]` line per field, so the bare field
#          name proves nothing),
#          how loud the system already is about this field)
MUTATIONS = {
    "home (FORK_BASE, as the reviewer mutated it)": (
        [('const FORK_BASE: &str = "https://dl.kalsa.io/kalsa-server/v1.1.5";',
          f'const FORK_BASE: &str = "{V114_HOME}";')],
        "home: row points at ANOTHER RELEASE",
        "SILENT at runtime — the download verifies size/sha, not the host; "
        "the Rust test only asserts home == FORK_BASE (a stale pair passes "
        "together); the user meets the wrong host after install"),
    "file": (
        [('        file: "kalsa-server-v1.1.5-bin-macos-arm64.tar.gz",',
          f'        file: "{V114_FILE}",')],
        "macos-arm64 file: row",
        "SILENT at runtime — the download verifies size/sha, not the name; "
        "Asset::url() is home/file and ensure_archive fetches it: a wrong name requests the wrong URL"),
    "size_bytes": (
        [("        size_bytes: Some(12_650_481),",
          f"        size_bytes: {V114_SIZE},")],
        "macos-arm64 size_bytes: row",
        "NOISY — store.rs's acquire verifies the download's size against it "
        "and would already scream"),
    "sha256": (
        [('        sha256: Some("cd5af85a490c283e82e8e08cf4f96fdd435c41d15bdd0931c2d8b76127ba674e"),',
          f'        sha256: Some("{V114_SHA}"),')],
        "macos-arm64 sha256: row",
        "NOISY — store.rs's file_digest_is verifies the download against it "
        "and would already scream"),
    "exe_sha256": (
        [('        exe_sha256: Some("8958c829b4e45893ac5d0d816858a410c4500e23335f890cab80fbf07fc97668"),',
          f'        exe_sha256: Some("{V114_EXE}"),')],
        "macos-arm64 exe_sha256: row",
        "SEMI-SILENT — the download never looks at it; publish() refuses the "
        "build before installing it, marker.rs re-checks at every start"),
    "mirror commit (stale pin: v1.1.4's commit)": (
        [('const FORK_MIRROR: &str =\n'
          '    "https://huggingface.co/Kalsa-ai/kalsa-server/resolve/'
          f'{MIRROR_COMMIT}";',
          'const FORK_MIRROR: &str =\n'
          '    "https://huggingface.co/Kalsa-ai/kalsa-server/resolve/'
          f'{V114_MIRROR_COMMIT}";')],
        "is not served at mirror commit",
        "SILENT until dl.kalsa.io is blocked — the mirror is only a fallback, "
        "and its digest gate would refuse the 404 or the wrong bytes; the "
        "user meets it on the one machine that needs it"),
    "mirror: win-cpu-x64 file (an older release's name)": (
        [('        file: "kalsa-server-v1.1.5-bin-win-cpu-x64.zip",',
          f'        file: "{V114_WIN_CPU_FILE}",')],
        "win-cpu-x64 mirror size:",
        "SILENT until dl.kalsa.io is blocked — the mirror still serves that "
        "older file, at its own size and digest, which the gate would refuse"),
    "cpu/vulkan sha256 swap": (
        [('        sha256: Some("5ffd88863f97536806f51117691caf701c4d9d407e4ef9b74fbc7e79fadf3a1b"),',
          '        sha256: Some("9eda1e79481281fce6d51e785b7012c0071ed9be245047de8ed0c81344f7498c"),'),
         ('        sha256: Some("9eda1e79481281fce6d51e785b7012c0071ed9be245047de8ed0c81344f7498c"),',
          '        sha256: Some("5ffd88863f97536806f51117691caf701c4d9d407e4ef9b74fbc7e79fadf3a1b"),')],
        "win-cpu-x64 sha256: row",
        "NOISY on the machine it strands — the cpu download is verified "
        "against the vulkan digest and refused — but invisible to any check "
        "that reads only the macOS row: both digests are values this "
        "release published"),
    "win-cpu-x64 file": (
        [('        file: "kalsa-server-v1.1.5-bin-win-cpu-x64.zip",',
          f'        file: "{V114_WIN_CPU_FILE}",')],
        "win-cpu-x64 file: row",
        "SILENT at runtime — the download verifies size/sha, not the name; "
        "Asset::url() is home/file and ensure_archive fetches it: a wrong name requests the wrong URL"),
    "win-cpu-x64 size_bytes": (
        [("        size_bytes: Some(14_489_079),",
          f"        size_bytes: {V114_WIN_CPU_SIZE},")],
        "win-cpu-x64 size_bytes: row",
        "NOISY — store.rs's acquire verifies the download's size against it "
        "and would already scream"),
    "win-cpu-x64 exe_sha256": (
        [('        exe_sha256: Some("6da613d9b45a151e3ce31053fb13795c1f3515ff059cc73cc148bf75ef9b88f7"),',
          f'        exe_sha256: Some("{V114_WIN_CPU_EXE}"),')],
        "win-cpu-x64 exe_sha256: row",
        "SEMI-SILENT — the download never looks at it; publish() refuses the "
        "build before installing it, marker.rs re-checks at every start"),
}


class Fail(list):
    def add(self, msg):
        self.append(msg)


# --------------------------------------------------------------------------
# the rows, as the repo has them
# --------------------------------------------------------------------------
# Each Engine row of the table, keyed the way the manifest keys its
# artifacts: (literals that identify the Asset block, manifest platform).
ENGINE_ROWS = (
    (("platform: Some(Platform::MacArm64)",
      "backend: Some(ServerBackend::Metal)"), "macos-arm64"),
    (("platform: Some(Platform::WindowsX64)",
      "backend: Some(ServerBackend::Cpu)"), "win-cpu-x64"),
    (("platform: Some(Platform::WindowsX64)",
      "backend: Some(ServerBackend::Vulkan)"), "win-vulkan-x64"),
)
ROW_KEYS = tuple(key for _, key in ENGINE_ROWS)


def read_fields(block, const):
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

    m = re.match(r'Some\((?:"([^"]+)"|(\w+))\)', raw("mirror") or "")
    mirror = (m.group(1) or const.get(m.group(2))) if m else None

    return {
        "home": home,
        "mirror": mirror,
        "file": quoted("file"),
        "size_bytes": some_int("size_bytes"),
        "sha256": some_str("sha256"),
        "exe_sha256": some_str("exe_sha256"),
    }


def parse_rows(text):
    """The three Engine rows of ASSETS, keyed by the manifest's platform
    string. FORK_BASE is resolved only to learn what `home` SAYS — the
    anchor of the comparison is RELEASE."""
    const = dict(re.findall(r'const (\w+): &str =\s*"([^"]+)";', text))
    # Row literals are indented (`    Asset {` ... `    },`); the struct and
    # the impl are at column 0, so anchoring on the indent keeps them out.
    blocks = re.findall(r"(?m)^    Asset \{(.*?)^    \},$", text, re.S | re.M)
    rows = {}
    for (platform_bits, backend_bits), key in ENGINE_ROWS:
        matches = [b for b in blocks
                   if "role: Role::Engine" in b
                   and platform_bits in b and backend_bits in b]
        if len(matches) != 1:
            raise SystemExit(f"assets.rs: expected exactly one Engine row "
                             f"for {key}, found {len(matches)}: the table "
                             "moved and this check reads it wrongly")
        rows[key] = read_fields(matches[0], const)
    return rows


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
    by_platform = {row.get("platform"): row for row in rows
                   if isinstance(row, dict)}
    missing = [key for key in ROW_KEYS if key not in by_platform]
    if missing:
        raise SystemExit(f"manifest at {url} has no row(s) for {missing}")
    return {"tag": data.get("tag"), "artifacts": by_platform}


def check_manifest(man):
    """The manifest must be the one RELEASE names — otherwise a manifest
    swapped under the control would silently redefine what 'correct' means."""
    fail = Fail()
    if man.get("tag") != RELEASE:
        fail.add(f"manifest tag: fetched manifest declares "
                 f"{man.get('tag')!r}, this control declares RELEASE "
                 f"{RELEASE!r}: the manifest was swapped under the control, "
                 "or the control is stale")
    for key in ROW_KEYS:
        home = man["artifacts"][key].get("home")
        if home != RELEASE_HOME:
            fail.add(f"manifest home ({key}): manifest says {home!r}, "
                     f"RELEASE {RELEASE} implies {RELEASE_HOME!r}")
    return fail


def compare(rows, man):
    """Each Engine row against the declared release, named by its platform.
    `home` is checked against what RELEASE implies — never against
    FORK_BASE, which IS the row's own value — and the message names the row,
    the field, and says it points elsewhere."""
    fail = Fail()
    for key in ROW_KEYS:
        row = rows[key]
        mrow = man["artifacts"][key]
        if row.get("home") != RELEASE_HOME:
            fail.add(f"{key} home: row points at ANOTHER RELEASE: "
                     f"{row.get('home')!r} != {RELEASE_HOME!r} implied by "
                     f"RELEASE {RELEASE} (and != the manifest's "
                     f"{mrow.get('home')!r})")
        for field in ("file", "size_bytes", "sha256", "exe_sha256"):
            if row.get(field) != mrow.get(field):
                fail.add(f"{key} {field}: row {row.get(field)!r} != manifest "
                         f"{mrow.get(field)!r}")
        if not isinstance(row.get("size_bytes"), int) \
                or row.get("size_bytes") == 0:
            fail.add(f"{key} size_bytes must be a non-zero integer, got "
                     f"{row.get('size_bytes')!r}")
        for field in ("sha256", "exe_sha256"):
            v = row.get(field)
            if not (isinstance(v, str) and len(v) == 64
                    and all(c in "0123456789abcdef" for c in v)):
                fail.add(f"{key} {field}: row is not 64 lowercase hex "
                         f"characters: {v!r}")
    return fail


def mirror_paths_info(commit, files):
    """What the mirror's COMMIT serves for these files: Hugging Face's own
    record (size, and the LFS sha256), not the file's bytes."""
    req = urllib.request.Request(
        MIRROR_API + commit,
        data=json.dumps({"paths": files}).encode(),
        headers={"User-Agent": "kalsa-engine-pin-check/2.0",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return {e["path"]: e for e in json.loads(r.read())}


def check_mirror(rows):
    """Each row's mirror URL against the declared MIRROR_HOME, then the
    commit the ROW names (what the app will fetch) against Hugging Face: it
    must serve the row's file at the row's size and sha256."""
    fail = Fail()
    commits = {}
    for key in ROW_KEYS:
        row = rows[key]
        if row.get("mirror") != MIRROR_HOME:
            fail.add(f"{key} mirror: row points at ANOTHER MIRROR: "
                     f"{row.get('mirror')!r} != {MIRROR_HOME!r} declared by "
                     "this control")
        commit = (row.get("mirror") or "").rsplit("/", 1)[-1]
        commits.setdefault(commit, []).append(key)
    for commit, keys in commits.items():
        files = [rows[key]["file"] for key in keys]
        try:
            served = mirror_paths_info(commit, files)
        except Exception as e:
            fail.add(f"mirror commit {commit!r} does not answer the "
                     f"paths-info query: {e}")
            continue
        for key in keys:
            row = rows[key]
            entry = served.get(row["file"])
            if entry is None:
                fail.add(f"{key} mirror: {row['file']} is not served at "
                         f"mirror commit {commit}")
                continue
            sha = (entry.get("lfs") or {}).get("oid")
            if entry.get("size") != row.get("size_bytes"):
                fail.add(f"{key} mirror size: row {row.get('size_bytes')!r} "
                         f"!= mirror {entry.get('size')!r}")
            if sha != row.get("sha256"):
                fail.add(f"{key} mirror sha256: row {row.get('sha256')!r} "
                         f"!= mirror {sha!r}")
    return fail


def live_check(assets_path, body, url, source):
    rows = parse_rows(Path(assets_path).read_text())
    man = parse_manifest(body, url)
    print(f"live rows vs {url}  (declared by RELEASE {RELEASE}, never read "
          f"from the row; manifest from {source})", file=sys.stderr)
    fail = check_manifest(man)
    fail += compare(rows, man)
    mirror_fail = check_mirror(rows)
    fail += mirror_fail
    if not mirror_fail:
        print(f"  [ok] the mirror commit {MIRROR_COMMIT} serves every "
              "engine row's file at the pinned size and sha256",
              file=sys.stderr)
    for key in ROW_KEYS:
        row = rows[key]
        mrow = man["artifacts"][key]
        for field in FIELDS:
            want = RELEASE_HOME if field == "home" else mrow.get(field)
            mark = "ok" if row.get(field) == want else "FAIL"
            print(f"  [{mark}] {key} {field}: {row.get(field)!r}",
                  file=sys.stderr)
    for f in fail:
        print(f"  [FAIL] {f}", file=sys.stderr)
    if not fail:
        print("  [ok] every field of all three engine rows matches the "
              "declared release; size_bytes != 0; digests shaped like "
              "sha256; manifest tag == RELEASE", file=sys.stderr)
    return fail


# --------------------------------------------------------------------------
# mutations: real row copies under /tmp, anchor FIRM, manifest in memory
# --------------------------------------------------------------------------
def run_self(argv):
    p = subprocess.run([sys.executable, str(SELF)] + argv,
                       capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)


def apply_at_once(text, swaps):
    """Every needle replaced in a single pass: chained str.replace calls
    would re-replace their own output, and a swap (A for B while B for A)
    would come back unchanged. The single pass has its own trap — a needle
    that is a prefix of another starves it in the leftmost-first
    alternation — so every needle must be logged exactly once by the match
    objects, or this refuses to hand back a copy that proves nothing."""
    mapping = dict(swaps)
    pattern = "|".join(re.escape(needle) for needle, _ in swaps)
    counts = {}

    def sub(m):
        counts[m.group(0)] = counts.get(m.group(0), 0) + 1
        return mapping[m.group(0)]

    out = re.sub(pattern, sub, text)
    starved = [needle for needle, _ in swaps if counts.get(needle) != 1]
    if starved:
        raise SystemExit(f"apply_at_once: {len(starved)} needle(s) were not "
                         "matched exactly once (one is likely a prefix of "
                         "another and starved in the alternation): the "
                         "mutation would prove nothing")
    return out


def run_mutations(assets_text, recorded_manifest_path):
    survived = Fail()
    tmp = Path(tempfile.mkdtemp(prefix="engine-pin-mutation-"))
    print(f"mutations (copies under {tmp}, anchor RELEASE {RELEASE} firm):",
          file=sys.stderr)

    # (a) row mutations: the REAL assets.rs, patched in /tmp, compared
    # against the manifest recorded once in memory.
    for name, (swaps, token, loudness) in MUTATIONS.items():
        moved = [needle for needle, _ in swaps
                 if assets_text.count(needle) != 1]
        if moved:
            print(f"  [FAIL] {name}: {len(moved)} needle(s) do not occur "
                  "exactly once in assets.rs (the source moved; this "
                  "mutation proves nothing)", file=sys.stderr)
            survived.add(f"mutation {name}: a needle moved, unproven")
            continue
        copy = tmp / f"assets--mutated-{re.sub(r'[^a-z0-9]+', '-', name.lower())}.rs"
        copy.write_text(apply_at_once(assets_text, swaps))
        code, out = run_self(["--assets", str(copy),
                              "--manifest-file", str(recorded_manifest_path),
                              "--skip-mutations"])
        red = code != 0
        named = token in out
        ok = red and named
        if not ok:
            survived.add(f"row mutation {name} survived (exit {code}, "
                         f"failure line named {named})")
        print(f"  [{'ok' if ok else 'FAIL'}] row mutation {name}: "
              f"{'CAUGHT' if ok else 'SURVIVED'} "
              f"(exit {code}, failure line named: {named})", file=sys.stderr)
        print(f"         {loudness}", file=sys.stderr)
        if ok or red:
            for line in out.strip().splitlines():
                print(f"         | {line}", file=sys.stderr)

    # (b) anchor mutation: THIS control with RELEASE at v1.1.4, run LIVE
    # against the untouched rows. Its manifest will be v1.1.4's and its tag
    # will match its own RELEASE, so green here would mean rows and anchor
    # disagree and the control did not notice. `named` must be the home
    # FAILURE text: a red caused by a fetch error instead would not name it.
    control = tmp / "test-engine-pin--anchor-v1.1.4.py"
    own = SELF.read_text()
    needle = '\nRELEASE = "kalsa-server-v1.1.5"\n'
    if own.count(needle) != 1:
        print("  [FAIL] anchor mutation: RELEASE needle moved", file=sys.stderr)
        survived.add("anchor mutation: the RELEASE definition moved, unproven")
    else:
        control.write_text(own.replace(
            needle, '\nRELEASE = "kalsa-server-v1.1.4"\n'))
        p = subprocess.run([sys.executable, str(control),
                            "--assets", str(ASSETS_RS), "--skip-mutations"],
                           capture_output=True, text=True)
        out = p.stdout + p.stderr
        red = p.returncode != 0
        named = "row points at ANOTHER RELEASE" in out
        its_own_manifest = f"live rows vs {V114_HOME}/manifest.json" in out
        ok = red and named and its_own_manifest
        if not ok:
            survived.add("anchor mutation RELEASE -> kalsa-server-v1.1.4 "
                         f"survived (exit {p.returncode}, home named {named}, "
                         f"own manifest {its_own_manifest})")
        print(f"  [{'ok' if ok else 'FAIL'}] anchor mutation RELEASE -> "
              f"kalsa-server-v1.1.4 with the row untouched: "
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
