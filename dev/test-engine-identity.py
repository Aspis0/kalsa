#!/usr/bin/env python3
"""Red/green for the launcher-only veto, on REAL release trees, offline.

The launcher `kalsa-server` is byte-identical in v1.1.0 and v1.1.1
(exe_sha256 327fb363... in both manifests), so `release_provenance`'s hash
match alone says `matched` even for a v1.1.0 tree sitting in a directory
named `kalsa-server-v1.1.1` - `derive_manifest_url` reads the directory
name, the match reads the hash, and both are satisfied. `release_block`
(measure-concurrency.py, the harness that performs the derivation) must
veto that with the two facts that DO separate the releases: the commit
`--version` prints and the module `libllama-server-impl.dylib` beside the
binary.

The manifest body is read from /tmp/k111/manifest.json and injected through
`release_provenance`'s existing `fetch=` seam - no network, no server.

  (a) the real /tmp/k111/kalsa-server-v1.1.1/ -> `matched`,
      identity.ok True
  (b) a COPY of the v1.1.0 release directory in a fresh mkdtemp folder
      NAMED kalsa-server-v1.1.1 -> `not-the-release` /
      reason_code `engine-commit-mismatch`, with
      `status_by_exe_sha256 == "matched"` (the downgrade is visible, not
      silent)
  (c) a COPY of v1.1.1 with libllama-server-impl.dylib removed ->
      reason_code `engine-module-missing`

Whole directories are copied, because `--version` loads its own dylibs from
beside the launcher. Case (c) is the declared exception: without the module
dyld refuses the launcher outright, which is exactly why that identity
cannot be completed - a non-zero `--version` is the EXPECTED observation
there, and only its absence in (a)/(b) means the case could not run.

Exit 0: every case ran and every check held.
Exit 1: a case ran and a check failed (the reason is on stderr).
Exit 2: a source tree is missing or a case could not run - never 0.

Run: python3 dev/test-engine-identity.py
"""

import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
V111_BIN = Path("/tmp/k111/kalsa-server-v1.1.1/kalsa-server")
V110_BIN = Path(
    "/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/"
    "metal/kalsa-server-v1.1.0/kalsa-server")
MANIFEST = Path("/tmp/k111/manifest.json")
MODULE = "libllama-server-impl.dylib"

SOURCES = (V111_BIN, V110_BIN, MANIFEST)


def cannot_run(why):
    print(f"cannot run: {why}", file=sys.stderr)
    sys.exit(2)


for src in SOURCES:
    if not Path(src).exists():
        cannot_run(f"missing source tree file: {src}")

spec = importlib.util.spec_from_file_location("mconc", HERE / "measure-concurrency.py")
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)

MANIFEST_BODY = MANIFEST.read_bytes()
FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}"
          + (f": {detail}" if detail else ""), file=sys.stderr)


def block_for(bin_path, version_required):
    """`--version` from the tree at bin_path, then release_block against the
    injected offline manifest. A failing `--version` where the tree should be
    intact means the case could not run at all - exit 2, never a green."""
    vp = subprocess.run([str(bin_path), "--version"],
                        capture_output=True, text=True)
    if version_required and vp.returncode != 0:
        cannot_run(f"--version failed (rc {vp.returncode}) on {bin_path}: "
                   + (vp.stderr or vp.stdout).strip()[:200])
    version = (vp.stdout + vp.stderr).strip()
    url = mc.derive_manifest_url(str(bin_path))
    return mc.release_block(str(bin_path), version, url,
                            fetch=lambda u: MANIFEST_BODY)


def copy_named(source_bin, work, remove_module=False):
    """A whole release directory (its dylibs load `--version`) copied as
    `<work>/kalsa-server-v1.1.1/kalsa-server`."""
    dest = Path(work) / "kalsa-server-v1.1.1"
    shutil.copytree(source_bin.parent, dest)
    if remove_module:
        (dest / MODULE).unlink()
    return dest / "kalsa-server"


def case_a():
    print("(a) the real v1.1.1 tree -> matched, identity ok", file=sys.stderr)
    block = block_for(V111_BIN, version_required=True)
    check("(a) status is matched", block["status"] == "matched",
          repr(block["status"]))
    check("(a) identity.ok is True", block["identity"]["ok"] is True,
          repr(block["identity"]["ok"]))
    check("(a) identity.commit_agrees is True",
          block["identity"]["commit_agrees"] is True,
          repr(block["identity"]["commit_agrees"]))
    check("(a) the module sha256 was read",
          isinstance(block["identity"]["module_sha256"], str)
          and len(block["identity"]["module_sha256"]) == 64,
          repr(block["identity"]["module_sha256"]))
    return block


def case_b():
    print("(b) v1.1.0 tree NAMED kalsa-server-v1.1.1 -> vetoed",
          file=sys.stderr)
    work = tempfile.mkdtemp(prefix="engine-identity-110-")
    try:
        block = block_for(copy_named(V110_BIN, work), version_required=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("(b) status is not-the-release", block["status"] == "not-the-release",
          repr(block["status"]))
    check("(b) reason_code is engine-commit-mismatch",
          block.get("reason_code") == "engine-commit-mismatch",
          repr(block.get("reason_code")))
    check("(b) status_by_exe_sha256 stays matched (the veto is visible)",
          block.get("status_by_exe_sha256") == "matched",
          repr(block.get("status_by_exe_sha256")))
    check("(b) identity.ok is False", block["identity"]["ok"] is False,
          repr(block["identity"]["ok"]))
    check("(b) identity.commit_agrees is False",
          block["identity"]["commit_agrees"] is False,
          repr(block["identity"]["commit_agrees"]))


def case_c():
    print("(c) v1.1.1 copy with the module removed -> module missing",
          file=sys.stderr)
    work = tempfile.mkdtemp(prefix="engine-identity-nomodule-")
    try:
        # --version CANNOT run here (dyld refuses the launcher), which is the
        # observation the case is built on: version_required=False.
        block = block_for(copy_named(V111_BIN, work, remove_module=True),
                          version_required=False)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("(c) status is not-the-release", block["status"] == "not-the-release",
          repr(block["status"]))
    check("(c) reason_code is engine-module-missing",
          block.get("reason_code") == "engine-module-missing",
          repr(block.get("reason_code")))
    check("(c) status_by_exe_sha256 stays matched (the veto is visible)",
          block.get("status_by_exe_sha256") == "matched",
          repr(block.get("status_by_exe_sha256")))
    check("(c) identity.module_sha256 is None",
          block["identity"]["module_sha256"] is None,
          repr(block["identity"]["module_sha256"]))


def main():
    case_a()
    case_b()
    case_c()
    print(f"engine identity: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
