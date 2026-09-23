#!/usr/bin/env python3
"""Measurement 1 - what two devices talking at once costs, per stream.

One engine, `--parallel N` (`--streams`, N in {2, 4}), a fixed `--ctx-size`
TOTAL that the engine splits evenly across the slots (a total not divisible
by N is refused, and the computed `context_size_per_slot` is checked against
the boot line's `n_ctx_slot`), q8_0 KV. The request is the same in every
arm: same prompt token length, same `n_predict`, `ignore_eos` so the token
count cannot drift.

  Arm A   one request, alone, on slot 0, its own cache salt.
  Arm B   the SAME request on slot 0 and one request of the same token
          length on each further slot (slot k, fixture seed PROMPT_SEEDS[k]),
          started together through a barrier, each with its own cache salt.

  Arm A2  Arm A repeated after Arm B, to bracket the background load. It is cold
          by construction: Arm B left a different namespace on slot 0.

Arms are built to be cold - `--cache-ram 0` closes the shared prompt cache and
each arm carries a fresh 64-hex salt. The artifact does not take that on faith:
the cold/warm verdict is DERIVED from the observed `cache_n` of every arm (A,
each B slot, A2), and if any of those values is missing the verdict field is
omitted rather than guessed.

Slot actions are live and asserted: the engine is launched with
`--slot-save-path` into a directory this script creates and clears, and every
erase must answer 2xx. Without the flag the engine answers 501
`ERROR_TYPE_NOT_SUPPORTED` ("Start it with `--slot-save-path`"), and a swallowed
non-2xx measured slots nobody had erased - plausible numbers on the wrong thing.

Numbers come from two places: the `/completion` response `timings` object, and
the engine's own `eval time ... tokens per second` / `n_gen = ... tg = ...` log
lines, attributed to a slot by the log's `id N |` field. Those log lines are the
corroborating channel: if an extraction comes back empty the format drifted and
the run stops instead of reporting silently.

Exit contract: 0 only when a bracketed number was written. A refused slot
action, a dead arm, an empty corroboration or an A/B/A2 bracket that never
passes each exit non-zero with no artifact - a timing taken under load is not a
number the panel may print.

Stdlib only. The engine process lifecycle (port pre-flight, boot check, stop)
lives in dev/engine-harness.py.

Usage:
  measure-concurrency.py --bin BIN --out dev/results/<dir>/results.json \
      --log /tmp/<dir>/server.log --slots-dir /tmp/<dir>/slots \
      [--port 19311] [--model MODEL] [--ctx-size 8192] [--streams {2,4}] \
      [--n-predict 256] [--ctx-checkpoints K] [--flash-attn {on,off,auto}] \
      [--prompt-tokens 512] [--attempts 4] [--bracket-tol 0.03] [--keep-server] \
      [--max-load 6.0] [--release-manifest-url URL] [--door-bin PATH]

`--door-bin PATH` runs the SAME arms through crates/kalsa-door - the road
the app's devices and the host seat take (the host is one seat,
src-tauri/src/tests.rs:1134) - instead of direct to the engine. The door is
the measure_door example as a child process; the mode is refused unless the
release is `matched`, each device's slot and salt are pinned end to end
before the first arm, every arm's slots are erased beforehand with the
device's own salt and a non-zero arm cache_n refuses the write, and arm B
carries a fifth request - a timed GET /health through the door - recorded
as `door_queue_probe`, what happened recorded and never asserted.

Provenance the next reader can check instead of trust: `max_load` and
`attempts_max` are recorded as the values actually used (after their
defaults), `ctx_checkpoints` and `flash_attn` as the values that rode the
argv (null when the flag was not rendered - the default), and `release` is
DERIVED by matching the sha256 of the binary that
ran against the published release manifest - by `exe_sha256` only, never by
path or directory name. Three statuses, kept apart on purpose: `matched` (a
manifest row carries this hash -> the row's fields ride along),
`not-the-release` (the manifest published at least one well-formed 64-hex
`exe_sha256` and none of them is this binary's -> a fork build, labelled
exactly as §9 of PLAN-DISK-TIER.md says), `unverified` (everything too weak
to decide: the manifest could not be read, it published no usable
`exe_sha256`, several rows claim the executed hash, no URL could be
derived). Weak evidence is never promoted to the fork verdict: a dead
network, a missing hash or a duplicate row each get `unverified` plus a
machine-readable `reason_code`. Hex is compared case-insensitively and the
canonical lowercase digest is recorded. The manifest URL is derived from a
`kalsa-server-vX.Y.Z` binary directory, overridable with
`--release-manifest-url`; when it cannot be derived the status is `unverified`.

The launcher alone cannot identify the release: `kalsa-server` is
byte-identical across v1.1.0 and v1.1.1, so an `exe_sha256` match alone
passes for a v1.1.0 tree too. `release_block` therefore vetoes a `matched`
the tree cannot back - the commit `--version` prints and the module beside
the binary are compared with the manifest's, and disagreement downgrades
the status to `not-the-release` under its own reason_code -
`engine-module-missing`, `engine-manifest-commit-missing`,
`engine-version-commit-missing` or `engine-commit-mismatch` - while the
launcher-only verdict stays visible in `status_by_exe_sha256`.
"""

import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("engine_harness",
                                               HERE / "engine-harness.py")
eh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eh)

DEFAULT_MODEL = ("/Users/marco/Library/Application Support/kalsa-brain/runtime/"
                 "models/Trinity-Nano-Preview-Q4_K_M.gguf")

NICE = 10                  # the gold artifacts ran the engine at nice 10 too
SLEEP_IDLE_S = -1          # engine default, disabled: no unload may land mid-run
SENTINEL = "zqxvsentinelconcurrency"
WORDS = ("harbor lantern gravel willow copper thistle marble quarry beacon "
         "cistern ferry juniper kelp limestone meadow nettle orchard pebble "
         "reed saffron tundra umber vellum wharf yarrow zephyr almond basalt "
         "cobalt dune elm fennel gable heather iris").split()

# Fixture seeds per slot: slots 0 and 1 keep the seeds the committed N=2
# artifact used (11 and 22), so an N=2 rerun builds the same prompts; slots
# 2 and 3 take the next two.
PROMPT_SEEDS = (11, 22, 33, 44)
# Arm B's key in `arms` and in every attempt: the committed artifact's own
# spelling at N=2 - tier-panel and the reviewers read that path.
ARM_KEYS = {2: "B_two_slots", 4: "B_four_slots"}
# The door's per-device cache-salt label, verbatim from its source
# (crates/kalsa-door/src/devices.rs CACHE_SALT_LABEL): sha256(label ||
# credential). Restated here so the pinning check can compute the door's
# salt independently and prove the door delivered exactly that namespace.
DOOR_SALT_LABEL = b"kalsa-cache-salt-v1"


# --------------------------------------------------------------------------
# http helpers
# --------------------------------------------------------------------------
def http_json_extra(port, path, payload, extra_headers, timeout=1800):
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    headers.update(extra_headers)
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def http_json(port, path, payload, timeout=1800):
    return http_json_extra(port, path, payload, {}, timeout)


def http_json_salted(port, path, payload, salt_hex, timeout=1800):
    return http_json_extra(port, path, payload,
                           {"x-kalsa-cache-salt": salt_hex}, timeout)


def tokenize(port, content):
    status, body = http_json(port, "/tokenize", {"content": content})
    if status != 200:
        raise RuntimeError(f"/tokenize failed: {status} {body}")
    return body["tokens"]


def detokenize(port, tokens):
    status, body = http_json(port, "/detokenize", {"tokens": tokens})
    if status != 200:
        raise RuntimeError(f"/detokenize failed: {status} {body}")
    return body["content"]


def salt_of(label):
    return hashlib.sha256(("kalsa-measure-concurrency/" + label).encode()).hexdigest()


def slot_action(port, slot, action, salt_hex, send=None):
    """Erase a slot the way the door does (the salt rides the header), and
    break the run if the engine refuses.

    A non-2xx here means the engine was started without `--slot-save-path` and
    answered 501, or the action failed: either way the arms would measure slots
    nobody erased, and that reads as plausible numbers on the wrong thing.
    `send` is the transport seam (see run_one): a test drives the whole arm
    sequence against a fake instead of a server.
    """
    path = f"/slots/{slot}?action={action}"
    if send is None:
        status, body = http_json_salted(port, path, {}, salt_hex)
    else:
        status, body = send(port, path, {},
                            {"x-kalsa-cache-salt": salt_hex})
    if status // 100 != 2:
        raise SystemExit(
            f"slot action refused: slot {slot} action={action} answered "
            f"{status} {body} - the run is broken and must not produce a number")
    return status


# --------------------------------------------------------------------------
# prompt fixture: exactly `target` tokens, deterministic, one sentinel
# --------------------------------------------------------------------------
def make_prompt(port, seed, target):
    import random
    rng = random.Random(seed)
    big = [SENTINEL]
    while True:
        big.append(rng.choice(WORDS))
        if len(big) > 16000:
            break
    text = " ".join(big)
    ids = tokenize(port, text)
    if len(ids) < target:
        raise RuntimeError("fixture text too short")
    # take a token window and detokenize it; verify the round trip is exact
    for start in range(0, 64):
        window = ids[start:start + target]
        content = detokenize(port, window)
        if len(tokenize(port, content)) == target:
            return content, target
    raise RuntimeError("could not build an exact-token prompt")


# --------------------------------------------------------------------------
# provenance helpers
# --------------------------------------------------------------------------
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def loadavg():
    try:
        return [float(x) for x in os.getloadavg()]
    except Exception:
        return None


# --------------------------------------------------------------------------
# release provenance: DERIVED from the published manifest, never asserted
# --------------------------------------------------------------------------
FORK_LABEL = "fork build, not the release"
MANIFEST_NAME_RE = re.compile(r"kalsa-server-(v\d+\.\d+\.\d+)")
HEX64_RE = re.compile(r"[0-9a-fA-F]{64}")
PLATFORM_ALIASES = {"x86_64": "x86-64", "amd64": "x86-64", "aarch64": "arm64"}
OS_ALIASES = {"darwin": "macos", "win32": "windows", "windows": "windows"}


def usable_sha256(value):
    """A digest this comparison is allowed to reason about: a string of
    exactly 64 hex digits.

    `null`, an int, an empty string, a short or malformed string are NOT a
    hash - and "the release published no hash" is a different claim from
    "this build is not the release": the first is missing evidence, the
    second is a verdict, and only a published digest can support one.
    """
    return (isinstance(value, str)
            and HEX64_RE.fullmatch(value.strip()) is not None)


def canonical_sha256(value):
    """Lowercase: `A-F` and `a-f` are the same digest, and the artifact
    records the canonical spelling of whatever matched."""
    return value.strip().lower()


def derive_manifest_url(bin_path):
    """Which manifest to ask, from where the binary lives.

    `kalsa-server-vX.Y.Z/kalsa-server` ->
    `https://dl.kalsa.io/kalsa-server/vX.Y.Z/manifest.json`. The tag is not
    typed by anyone and not read out of the binary: it comes from the
    release's own directory spelling. A directory of any other shape yields
    None - with no version there is nothing to ask, and guessing a tag would
    attribute this build to a release nobody published. The path chooses the
    URL and only that: it never takes part in the match itself.
    """
    parent = Path(bin_path).resolve().parent.name
    m = MANIFEST_NAME_RE.fullmatch(parent)
    if not m:
        return None
    return f"https://dl.kalsa.io/kalsa-server/{m.group(1)}/manifest.json"


def host_platform():
    """Platform of the machine that ran the binary - the FALLBACK source.

    Labelled `platform_source: host` wherever it is used, so a host-derived
    platform is never read as the manifest's claim about the artifact.
    """
    import platform as plat
    system = OS_ALIASES.get(plat.system().lower(), plat.system().lower() or "unknown")
    machine = PLATFORM_ALIASES.get(plat.machine().lower(),
                                   plat.machine().lower() or "unknown")
    return f"{system}-{machine}"


def match_manifest(manifest, exe_sha256):
    """PURE. The executed binary's sha256 against the manifest's rows.

    Match is by `exe_sha256` and by nothing else: never a path, never a
    directory name, never a file name - those are exactly what a copied
    release binary in a renamed folder would fake. Hex is compared
    case-insensitively; the merged header + row block carries the canonical
    lowercase digest.

    Returns {"outcome", "published_rows", "matched_rows", "block"?} where
    outcome is one of:
      unique            exactly one published row carries this digest
      no-match          at least one row published a usable digest, none is
                        this one - the ONLY outcome that can justify the fork
                        verdict
      no-usable-hash    the manifest published no 64-hex exe_sha256 at all:
                        missing evidence, not a verdict
      ambiguous         several rows claim this digest: platform/backend
                        would be an arbitrary pick, so no pick is made
      not-a-manifest    no artifacts[] list to reason about
      binary-hash-unusable  the digest we would match with is not a digest
    """
    if not usable_sha256(exe_sha256):
        return {"outcome": "binary-hash-unusable",
                "published_rows": 0, "matched_rows": 0}
    if not isinstance(manifest, dict) \
            or not isinstance(manifest.get("artifacts"), list):
        return {"outcome": "not-a-manifest",
                "published_rows": 0, "matched_rows": 0}
    rows = [r for r in manifest["artifacts"] if isinstance(r, dict)]
    published = [r for r in rows if usable_sha256(r.get("exe_sha256"))]
    if not published:
        return {"outcome": "no-usable-hash",
                "published_rows": 0, "matched_rows": 0}
    key = canonical_sha256(exe_sha256)
    hits = [r for r in published if canonical_sha256(r["exe_sha256"]) == key]
    out = {"published_rows": len(published), "matched_rows": len(hits)}
    if not hits:
        out["outcome"] = "no-match"
        return out
    if len(hits) > 1:
        out["outcome"] = "ambiguous"
        return out
    row = hits[0]
    block = {k: manifest.get(k) for k in
             ("tag", "tag_object", "commit", "run_url", "built_at",
              "pack_sha256")}
    block.update({k: row.get(k) for k in
                  ("file", "platform", "backend")})
    block["exe_sha256"] = canonical_sha256(row["exe_sha256"])
    block["platform_source"] = "manifest"
    out["outcome"] = "unique"
    out["block"] = block
    return out


def fetch_manifest(url):
    # A User-Agent, because dl.kalsa.io answers 403 to the default
    # `Python-urllib/3.x`: refusing the default agent turns a readable
    # manifest into `unverified` and loses the match for a reason that has
    # nothing to do with the build.
    req = urllib.request.Request(
        url, headers={"User-Agent": "kalsa-brain-measure-concurrency/1.0 "
                                    "(release provenance check)",
                      "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def release_provenance(manifest_url, exe_sha256, fetch=None, checked_utc=None):
    """The `release` block, with its three statuses kept apart.

    Pure given `fetch` (the injected callable is the only I/O), which is what
    lets dev/test-release-provenance.py drive the red paths without a network.

      matched          exactly one manifest row carries this exe_sha256 ->
                       record the row and the header it belongs to.
      not-the-release  the manifest published at least one well-formed
                       64-hex exe_sha256 and none is this binary's -> a fork
                       build: label `fork build, not the release`, platform
                       from the host, backend null.
      unverified       anything too weak to decide, each with its own
                       machine-readable `reason_code`: no URL derivable,
                       fetch failed, body not JSON, no artifacts[], the
                       executed binary has no usable digest, the manifest
                       published no usable exe_sha256, or several rows
                       claim the executed digest. None of those is promoted
                       to not-the-release: a dead network, a missing hash
                       and a duplicate row say nothing about which build
                       this is.
    """
    fetch = fetch or fetch_manifest
    block = {
        "status": None,
        "manifest_url": manifest_url,
        "manifest_sha256": None,
        "checked_utc": checked_utc or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "match_basis": ("exe_sha256 of the executed binary, compared as "
                        "64-hex case-insensitively and recorded in canonical "
                        "lowercase; never a path, never a directory name"),
        "exe_sha256": (canonical_sha256(exe_sha256)
                       if usable_sha256(exe_sha256) else exe_sha256),
        # host is the fallback claim until a manifest row upgrades it:
        "platform": host_platform(),
        "platform_source": "host",
        "backend": None,
    }
    if not usable_sha256(exe_sha256):
        block["status"] = "unverified"
        block["reason_code"] = "binary-has-no-usable-exe-sha256"
        block["reason"] = (
            f"the executed binary's exe_sha256 is {exe_sha256!r}, not a "
            "64-hex sha256: with no digest there is no match to report, and "
            "no manifest row can be accused of anything")
        return block
    if not manifest_url:
        block["status"] = "unverified"
        block["reason_code"] = "no-manifest-url"
        block["reason"] = (
            "no manifest URL could be derived from the binary's directory "
            "(expected kalsa-server-vX.Y.Z) and none was given with "
            "--release-manifest-url: there is no release tag to ask, and "
            "inventing one would attribute this build to a release nobody "
            "published")
        return block

    try:
        body = fetch(manifest_url)
    except Exception as e:
        block["status"] = "unverified"
        block["reason_code"] = "manifest-fetch-failed"
        block["reason"] = (
            f"manifest not readable at {manifest_url}: "
            f"{type(e).__name__}: {e} - a network or HTTP failure says nothing "
            "about which build this is, so it is NOT 'not-the-release'")
        return block
    if isinstance(body, str):
        body = body.encode()
    block["manifest_sha256"] = hashlib.sha256(body).hexdigest()
    try:
        manifest = json.loads(body.decode("utf-8", errors="replace"))
    except Exception as e:
        block["status"] = "unverified"
        block["reason_code"] = "manifest-body-unreadable"
        block["reason"] = (
            f"manifest at {manifest_url} answered with a body that is not JSON "
            f"({type(e).__name__}: {e}): it could not be read, so the build is "
            "unverified, not 'not-the-release'")
        return block

    match = match_manifest(manifest, exe_sha256)
    outcome = match["outcome"]
    block["manifest_exe_sha256_rows"] = match["published_rows"]

    if outcome == "unique":
        block["status"] = "matched"
        block.update(match["block"])
        return block
    if outcome == "no-match":
        block["status"] = "not-the-release"
        block["label"] = FORK_LABEL
        block["reason_code"] = "no-published-exe-sha256-is-this-binary"
        block["reason"] = (
            f"the manifest was read and published {match['published_rows']} "
            "well-formed exe_sha256 values, none of them this binary's: the "
            "binary that ran is not what the release published")
        return block

    # Everything left is evidence too weak for the fork verdict.
    block["status"] = "unverified"
    block["matched_rows"] = match["matched_rows"]
    if outcome == "not-a-manifest":
        block["reason_code"] = "manifest-not-a-release-manifest"
        block["reason"] = (
            f"the body at {manifest_url} is JSON but not a release manifest "
            "(no artifacts[]): there is no row to match against, so the build "
            "is unverified, not 'not-the-release'")
    elif outcome == "no-usable-hash":
        block["reason_code"] = "manifest-published-no-usable-exe-sha256"
        block["reason"] = (
            "the manifest published no usable exe_sha256 (0 rows of 64 hex "
            "out of " + str(len(manifest.get("artifacts") or [])) + " artifacts[]): "
            "a release that declares no hash is missing evidence, not a "
            "declaration that this build is not the release")
    elif outcome == "ambiguous":
        block["reason_code"] = "manifest-exe-sha256-ambiguous"
        block["reason"] = (
            f"{match['matched_rows']} manifest rows carry this exe_sha256: "
            "platform/backend would be an arbitrary pick, so no pick is made "
            "and the build stays unverified")
    elif outcome == "binary-hash-unusable":  # guarded above; stated, not assumed
        block["reason_code"] = "binary-has-no-usable-exe-sha256"
        block["reason"] = "the executed binary's exe_sha256 is not a 64-hex sha256"
    else:  # an outcome nobody declared: unknown is unverified, never fork
        block["reason_code"] = "unknown-match-outcome"
        block["reason"] = f"unforeseen match outcome {outcome!r}"
    return block


# The module the launcher loads, beside it: the same name the runtime's inlet
# check spells (crates/kalsa-runtime/src/inlet.rs, ENGINE_MODULE_FILE).
ENGINE_MODULE_FILE = "libllama-server-impl.dylib"


def engine_identity(bin_path, version_text, block):
    """The facts that separate v1.1.0 from v1.1.1, beside the executed bin.

    The launcher `kalsa-server` is byte-identical across the two releases
    (exe_sha256 327fb363... in both published manifests), so the launcher hash
    - which is all `release_provenance` matches on - also passes for a
    v1.1.0 tree. The module the launcher loads is not identical
    (714e8ba1... vs 4b7d69fb...), and `--version` reads those modules, so its
    commit is the manifest-comparable form of the same fact.

    `ok` is True only when the manifest matched AND the version commit agrees
    with the manifest's commit AND the module file is there; False when the
    manifest matched and any of those fails (including a missing commit on
    either side - the reason code names WHICH side is missing); None when
    the status is not `matched` - there is no launcher verdict to veto.
    """
    module = Path(bin_path).parent / ENGINE_MODULE_FILE
    hit = re.search(r"\bcommit ([0-9a-f]{7,40})", version_text or "")
    vcommit = hit.group(1) if hit else None
    mcommit = block.get("commit")
    agrees = None
    if vcommit and mcommit:
        agrees = mcommit.startswith(vcommit) or vcommit.startswith(mcommit)
    has_module = module.exists()
    ident = {
        "why": ("the launcher is byte-identical across v1.1.0 and v1.1.1, so "
                "exe_sha256 alone cannot tell the delivered release from a "
                "v1.1.0 tree; the module it loads and the commit --version "
                "prints can"),
        "module_file": ENGINE_MODULE_FILE,
        "module_path": str(module) if has_module else None,
        "module_sha256": sha256_file(module) if has_module else None,
        "version_full": (version_text or "").strip()[:200] or None,
        "version_commit": vcommit,
        "manifest_commit": mcommit,
        "commit_agrees": agrees,
    }
    if block.get("status") != "matched":
        ident["ok"] = None
    else:
        ident["ok"] = bool(has_module and agrees is True)
    return ident


def release_block(bin_path, version_text, manifest_url, fetch=None):
    """The launcher verdict, plus the identity that may veto it.

    The derivation (URL supplied by the caller - so main()'s
    `--release-manifest-url` override is honoured - match on exe_sha256,
    three statuses) is `release_provenance`'s; `fetch` is threaded through
    the injectable it already accepts, so the veto runs offline. What is
    added here is only the veto: a `matched` the module/commit cannot back
    becomes `not-the-release` under its own reason_code, with the
    launcher-only verdict preserved as `status_by_exe_sha256`.
    """
    block = release_provenance(manifest_url, sha256_file(bin_path), fetch=fetch)
    block["status_by_exe_sha256"] = block["status"]
    ident = engine_identity(bin_path, version_text, block)
    block["identity"] = ident
    if block["status"] == "matched" and ident["ok"] is not True:
        # Exhaustive over `ok is False` (= no module, or no agreement):
        # each missing side gets ITS OWN honest code - a manifest without a
        # commit is missing evidence, not a mismatched tree - and the final
        # branch is reachable only when both commits are present and differ
        # (the old `engine-identity-incomplete` branch was unreachable and
        # is gone).
        if ident["module_sha256"] is None:
            code = "engine-module-missing"
            why = f"no {ENGINE_MODULE_FILE} beside the binary"
        elif ident["manifest_commit"] is None:
            code = "engine-manifest-commit-missing"
            why = ("the manifest matched the launcher hash but publishes no "
                   "commit: there is nothing to compare --version's commit "
                   "against, so this tree cannot be CONFIRMED as the release "
                   "- missing evidence, and not a mismatch")
        elif ident["version_commit"] is None:
            code = "engine-version-commit-missing"
            why = ("--version printed no commit while the manifest says "
                   f"{ident['manifest_commit']!r}: nothing to compare, so the "
                   "tree cannot be CONFIRMED as the release")
        else:
            code = "engine-commit-mismatch"
            why = (f"--version says commit {ident['version_commit']!r}, the "
                   f"manifest says {ident['manifest_commit']!r}")
        block["status"] = "not-the-release"
        block["label"] = FORK_LABEL
        block["reason_code"] = code
        block["reason"] = ("the launcher hash matched but the tree did not: " + why
                           + " - by launcher hash alone this build would have "
                             "called itself the release")
    return block


def run_parameters(args):
    """The knobs of this run, each as the VALUE USED - after its default.

    These fields live here and not inline in the artifact literal so the
    control file can call this builder with a distinctive value and prove
    the field FOLLOWS the argument: a provenance field whose builder ignores
    its input records the default forever and calls it a measurement. The
    two launch flags are here for the same reason, and their "default" is
    None = the flag was not rendered at all - the null IS the value a
    default run used.
    """
    return {
        "max_load": args.max_load,
        "attempts_max": args.attempts,
        "ctx_checkpoints": args.ctx_checkpoints,
        "flash_attn": args.flash_attn,
    }


def engine_argv(bin_path, model, port, ctx_size, slots_dir, streams,
                ctx_checkpoints=None, flash_attn=None):
    """The engine command line.

    `--parallel` is `streams` verbatim - at 2 the argv is byte-identical to
    the committed artifact's (pinned by dev/test-concurrency-shape.py).
    The two optional flags render only when given (default None -> nothing
    in the argv, so the argv at defaults is the committed one) and as the
    same flag/value PAIR the app ships (`--flash-attn on`,
    `--ctx-checkpoints 1`). Their POSITION in this argv is the harness's
    own: the engine does not care about order, and the app's overall
    ordering differs anyway (argv.rs renders the tier pair last). The value
    rides as its own element - a bare substring of the joined argv would
    let `1` pass for `12`.
    `--slot-save-path` is not decoration: without it the slot actions answer
    501 and every erase in this run fails silently. The directory is created
    by the caller, because the engine refuses a path that is not a directory.
    """
    argv = ["nice", "-n", str(NICE), bin_path, "-m", model,
            "--host", "127.0.0.1", "--port", str(port),
            "--parallel", str(streams), "--ctx-size", str(ctx_size)]
    if flash_attn is not None:
        argv.extend(["--flash-attn", flash_attn])
    argv.extend(["--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
                 "--n-gpu-layers", "all", "--threads", "4",
                 "--threads-batch", "4",
                 "--batch-size", "2048", "--ubatch-size", "512",
                 "--cache-ram", "0", "--slot-save-path", str(slots_dir) + "/"])
    if ctx_checkpoints is not None:
        argv.extend(["--ctx-checkpoints", str(ctx_checkpoints)])
    argv.extend(["--sleep-idle-seconds", str(SLEEP_IDLE_S),
                 "--no-webui", "-lv", "4"])
    return argv


# --------------------------------------------------------------------------
# checks that stop the run instead of letting it report quietly
# --------------------------------------------------------------------------
def require_engine_lines(where, lines):
    """The engine's own timing lines corroborate the HTTP numbers. If the log
    format drifts they come back empty, and an empty list in the artifact would
    be the only trace - so the run stops instead."""
    if not lines:
        raise SystemExit(
            f"no engine timing lines extracted for {where}: the log format "
            "drifted and the corroborating channel is dead - refusing to "
            "measure")


def require_rates(recs):
    """Every arm of the accepted attempt must carry a real POSITIVE decode
    rate.

    A dead arm used to enter the aggregate as a zero (`or 0`) and a missing
    rate used to surface later as `None` in a min() after the engine was
    already up; both are failed runs, not data. A rate of 0.0 or below is
    the same species of non-number: `ratio()` would turn it into `None`
    while tokens_per_second printed 0.0 - two artifacts of one broken arm -
    so <= 0 is refused here, with the dead arm. NaN and infinities are
    refused too (G10): `nan <= 0` is False, so the <= 0 test alone would
    let a NaN through into every ratio it touches.
    """
    bad = [name for name, rec in recs.items()
           if rec.get("status") != 200
           or not isinstance(rec.get("predicted_per_second"), (int, float))
           or not math.isfinite(rec.get("predicted_per_second"))
           or rec.get("predicted_per_second") <= 0]
    if bad:
        raise SystemExit(
            f"no usable decode rate for {bad}: a dead arm is a failed run, "
            "not a zero - refusing to measure")


def require_rate_agreement(where, rec, lines):
    """Corroboration BY VALUE, not by presence: the HTTP decode rate must
    AGREE with the engine's own `eval time ... tokens per second` for the
    same slot. The engine prints 2 decimals, so agreement is
    abs diff <= 0.011; an empty corroboration or a disagreeing one both
    stop the run - a log that carries a different number than the HTTP
    answer is two measurements, and neither may be printed. G10: a rate
    that is None or non-finite REFUSES with the harness's own message
    instead of raising TypeError out of the subtraction."""
    http = rec.get("predicted_per_second")
    if (not isinstance(http, (int, float)) or isinstance(http, bool)
            or not math.isfinite(http)):
        raise SystemExit(
            f"{where}: the HTTP rate {http!r} is not a finite number - "
            "refusing to measure rather than computing on NaN/None")
    raw = [x["tokens_per_second"] for x in lines
           if x.get("kind") == "eval"
           and x.get("tokens_per_second") is not None]
    bad_eval = [v for v in raw
                if not isinstance(v, (int, float)) or not math.isfinite(v)]
    if bad_eval:
        raise SystemExit(
            f"{where}: the engine's eval line carries a non-finite rate "
            f"{bad_eval} - refusing to measure")
    evals = raw
    if not evals:
        raise SystemExit(
            f"{where}: no engine eval line to corroborate the HTTP rate "
            f"{http} - refusing to measure")
    best = min(abs(http - e) for e in evals)
    if best > 0.011:
        raise SystemExit(
            f"{where}: HTTP predicted_per_second {http} disagrees with the "
            f"engine's eval line(s) {evals} by {round(best, 4)} (> 0.011, "
            "the engine's print precision): the corroborating channel "
            "contradicts the number - refusing to measure")


def require_accepted_corroboration(accepted, arm_key, n):
    """Every slot of the ACCEPTED attempt, checked value against value:
    HTTP rate against that slot's engine eval line (A, all N B slots, A2)."""
    arm_a = accepted["A_solo_slot0"]
    arm_b = accepted[arm_key]
    arm_a2 = accepted["A2_solo_repeat"]
    require_rate_agreement("attempt arm A", arm_a, arm_a["engine_lines"])
    for k in range(n):
        require_rate_agreement(f"attempt arm B slot {k}", arm_b[f"slot{k}"],
                               arm_b[f"engine_lines_slot{k}"])
    require_rate_agreement("attempt arm A2", arm_a2, arm_a2["engine_lines"])


def require_n_ctx_slot(init_lines, per_slot):
    """The engine's boot lines must CONFIRM the per-slot ctx the run
    computed - EVERY n_ctx_slot value found, not the first: `--ctx-size` is
    a total the engine divides by `--parallel`, and
    `provenance.context_size_per_slot` stays a derived claim until the
    engine says the same number everywhere. One disagreeing value (or a
    boot line that no longer carries the value at all) stops the run.
    A guard, not a builder: it returns nothing."""
    found = [int(m.group(1)) for line in init_lines
             for m in re.finditer(r"n_ctx_slot\s*=\s*(\d+)", line)]
    if not found:
        raise SystemExit(
            "the boot lines carry no n_ctx_slot value: the log format drifted "
            "and the corroborating channel is dead - refusing to measure")
    if any(v != per_slot for v in found):
        raise SystemExit(
            f"the engine booted n_ctx_slot values {sorted(set(found))}, the "
            f"run computed context_size_per_slot={per_slot} (ctx_size // "
            "streams): the artifact would record a per-slot context the "
            "engine does not have - refusing to measure")


def require_checkpoint_line(ctx_check_lines, requested):
    """When `--ctx-checkpoints K` was RENDERED, the engine's own boot line
    must report it: `context checkpoints enabled, max = K`. The line is
    captured either way (`checkpoint_line`); without this comparison the
    flag could ride the argv and never reach the engine's parser, and the
    artifact would record a value the engine never used. Absent line or a
    different `max` stops the run."""
    found = []
    for line in ctx_check_lines:
        m = re.search(r"context checkpoints.*max\s*=\s*(\d+)", line)
        if m:
            found.append(int(m.group(1)))
    if not found:
        raise SystemExit(
            f"--ctx-checkpoints {requested} was rendered but no boot line "
            "reports `context checkpoints ... max = ...`: the flag did not "
            "reach the engine (or the log format drifted) - refusing to "
            "measure")
    if any(v != requested for v in found):
        raise SystemExit(
            f"--ctx-checkpoints {requested} was rendered but the engine "
            f"booted with max values {sorted(set(found))} - the artifact "
            "would record a checkpoint count the engine does not have - "
            "refusing to measure")


def require_divisible_ctx(ctx_size, streams):
    """`--ctx-size` is a TOTAL the engine splits evenly across the slots; a
    remainder would make `context_size_per_slot = ctx_size // N` a lie with
    tokens nobody accounts for. Refused before anything starts."""
    if ctx_size % streams != 0:
        raise SystemExit(
            f"refusing to measure: --ctx-size {ctx_size} is not divisible "
            f"by --streams {streams}: the context is a TOTAL the engine "
            f"splits evenly, and a remainder would make "
            f"context_size_per_slot a lie")


def require_outside_repo(path, flag_name):
    """Run outputs must not land inside the repository: the artifact's
    `raw_log_committed: false` (and a git tree nobody litters with engine
    logs and slot files) is true BY CONSTRUCTION only when the log and the
    slots directory resolve outside it. `--out` is deliberately exempt:
    the artifact itself is committed on purpose, from dev/results/.

    G8: APFS is case-insensitive and symlinks resolve, so the old
    Path-equality/parents compare let `/tmp/REVB-.../dev/...` pass for the
    repo `/tmp/revB-...`. Every EXISTING ancestor is now compared with
    os.path.samefile - inode identity, which survives case and symlinks
    both. A candidate that does not exist cannot BE the repo, and is
    skipped (the loop still reaches the repo-spelling ancestor)."""
    resolved = Path(path).resolve()
    repo = HERE.parent.resolve()
    for candidate in (resolved, *resolved.parents):
        if candidate.exists() and os.path.samefile(candidate, repo):
            raise SystemExit(
                f"--{flag_name} {resolved} resolves INSIDE the repository "
                f"{repo}: raw_log_committed: false and a clean tree are true "
                "by construction only if run outputs never land in the repo "
                "- refusing")


def delete_log_or_say(log_path):
    """Delete a SENTINEL-leaked engine log; True only when the file is
    actually gone. G9: a failed unlink must never be reported as a
    deletion - the caller's message tells the truth either way and names
    the path so the owner can remove it by hand."""
    try:
        Path(log_path).unlink(missing_ok=True)
        return not Path(log_path).exists()
    except OSError:
        return False


def ratio(x, y):
    """x/y rounded to 4 decimals; None when either side is missing, so a
    dead arm yields no ratio instead of a zero or a crash."""
    return round(x / y, 4) if (x and y) else None


def warm_prefix_field(cache_ns, door=False):
    """Cold/warm verdict DERIVED from the recorded cache_n values, never
    written: an artifact that claims every arm was cold while its own data
    says otherwise is worse than no field at all. If a value is missing the
    verdict is not derivable, so only the data is emitted.

    Only the DATA picks cold vs warm; `door` picks the clause that names
    what KEPT the arms cold on that road - a fresh salt per arm (direct)
    versus the erase before each arm with the device's FIXED salt (door,
    where the salt alone would leave arm B's warmth under A2)."""
    field = {"cache_n": dict(cache_ns)}
    if any(v is None for v in cache_ns.values()):
        return field
    warm = sorted(name for name, v in cache_ns.items() if v > 0)
    if not warm:
        if door:
            field["verdict"] = ("none - every arm is cold; --cache-ram 0 and "
                                "the erase before each arm with the device's "
                                "fixed salt, so only decode is compared")
        else:
            field["verdict"] = ("none - every arm is cold; --cache-ram 0 and a "
                                "fresh salt per arm, so only decode is compared")
    else:
        field["verdict"] = ("present in " + ", ".join(warm) +
                            " - prompt cache reuse is in play there, so those "
                            "arms compare more than decode")
    return field


LOG_SLOT = re.compile(r"slot\s+\S+:\s+id\s+(\d+)\s+\|")
LOG_EVAL = re.compile(r"eval time =\s*([\d.]+) ms /\s*(\d+) tokens "
                      r"\(\s*([\d.]+) ms per token,\s*([\d.]+) tokens per second\)")
LOG_PROMPT = re.compile(r"prompt eval time =\s*([\d.]+) ms /\s*(\d+) tokens "
                        r"\(\s*([\d.]+) ms per token,\s*([\d.]+) tokens per second\)")
LOG_NGEN = re.compile(r"n_gen =\s*(\d+), tg =\s*([\d.]+) t/s, tg_3s =\s*([\d.]+) t/s")


def extract(lines):
    """Pull only the timing lines that carry the numbers, with their slot.

    `prompt eval time` is tested before `eval time`, or the two collapse.
    The engine prints `print_timings` twice on release; the exact duplicate
    line is dropped so the artifact carries each number once.
    """
    out = []
    seen = set()
    for ln in lines:
        pm = LOG_PROMPT.search(ln)
        em = LOG_EVAL.search(ln) if pm is None else None
        nm = LOG_NGEN.search(ln)
        hit = pm or em or nm
        if not hit:
            continue
        if ln in seen:
            continue
        seen.add(ln)
        m = LOG_SLOT.search(ln)
        kind = "prompt_eval" if pm else "eval" if em else "n_gen"
        out.append({
            "slot": int(m.group(1)) if m else None,
            "kind": kind,
            "eval_ms": float(hit.group(1)) if kind == "eval" else None,
            "tokens": int(hit.group(2)) if kind == "eval" else None,
            "tokens_per_second": float(hit.group(4)) if kind == "eval" else None,
            "prompt_ms": float(hit.group(1)) if kind == "prompt_eval" else None,
            "prompt_tokens": int(hit.group(2)) if kind == "prompt_eval" else None,
            "prompt_per_second": float(hit.group(4)) if kind == "prompt_eval" else None,
            "n_gen": int(hit.group(1)) if kind == "n_gen" else None,
            "tg": float(hit.group(2)) if kind == "n_gen" else None,
            "tg_3s": float(hit.group(3)) if kind == "n_gen" else None,
            "line": ln.strip(),
        })
    return out


def run_one(port, prompt, n_predict, salt_hex, slot, server, credential=None,
            split_log=True, send=None, stamps=None):
    """One completion, both roads. Direct (credential None): id_slot in the
    body, the run's salt on the header, salt_label the salt's first 16 hex
    (run-internal, never a device secret). Door: no id_slot, the device's
    Bearer instead, salt_label the device's LABEL - a device salt or a
    credential must never enter the artifact.

    `split_log=False` (the barriered B threads) skips the per-region
    extract: that region belongs to the WHOLE arm, so a per-thread extract
    was computed and immediately thrown away - the arm's split happens
    once, after the join. `send` is the transport seam: None = the real
    HTTP dispatch; a test injects a recorder and sees (port, path, payload,
    headers) for exactly this request. `stamps` (optional dict) receives
    perf_counter() at two instants - immediately before the request leaves
    and immediately after the response lands - which is where the door
    probe's per-stream timestamps come from (G4: stamped at the events,
    never reconstructed from a rounded duration).
    """
    payload, headers = completion_request(prompt, n_predict, slot, salt_hex,
                                          credential)
    before = len(server.lines()) if split_log else None
    t0 = time.perf_counter()
    if stamps is not None:
        stamps["sent"] = t0
    if send is None:
        status, r = http_json_extra(port, "/completion", payload, headers)
    else:
        status, r = send(port, "/completion", payload, headers)
    t1 = time.perf_counter()
    if stamps is not None:
        stamps["done"] = t1
    wall_ms = round((t1 - t0) * 1000, 1)
    new = extract(server.lines()[before:]) if split_log else []
    tim = (r or {}).get("timings") or {}
    return {
        "slot": slot,
        "salt_label": (f"device-{slot}" if credential is not None
                       else salt_hex[:16]),
        "status": status,
        "wall_ms": wall_ms,
        "loadavg_at_start": loadavg(),
        "tokens_evaluated": (r or {}).get("tokens_evaluated"),
        "tokens_predicted": (r or {}).get("tokens_predicted"),
        "stop_type": (r or {}).get("stop_type"),
        "cache_n": tim.get("cache_n"),
        "prompt_n": tim.get("prompt_n"),
        "prompt_ms": tim.get("prompt_ms"),
        "prompt_per_second": tim.get("prompt_per_second"),
        "predicted_n": tim.get("predicted_n"),
        "predicted_ms": tim.get("predicted_ms"),
        "predicted_per_second": tim.get("predicted_per_second"),
        "engine_lines": new,
    }


def run_streams(port, prompts, n_predict, salts, server, send=None):
    """All N requests leave through a barrier and land together.

    The new log region belongs to the arm, not to any single thread, so it
    is collected once after every request finishes and split by slot id -
    `engine_lines_slot{k}` for each stream k. A thread that RAISES is
    captured, not swallowed: after the join the run ends through the
    harness's own refusal path naming the slot, instead of a traceback on
    stderr and a KeyError on the missing record.
    """
    out = {}
    errors = {}
    n = len(prompts)
    barrier = threading.Barrier(n)
    before = len(server.lines())

    def one(k, prompt, salt):
        try:
            barrier.wait(timeout=90)
            out[f"slot{k}"] = run_one(port, prompt, n_predict, salt, k, server,
                                      split_log=False, send=send)
        except Exception as e:
            errors[k] = f"{type(e).__name__}: {e}"

    t0 = time.perf_counter()
    threads = [threading.Thread(target=one, args=(k, prompts[k], salts[k]),
                                daemon=True)
               for k in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        k = min(errors)
        raise SystemExit(
            f"stream slot{k} died: {errors[k]}; refusing to measure")
    wall_ms = round((time.perf_counter() - t0) * 1000, 1)
    new = extract(server.lines()[before:])
    out["engine_lines"] = new
    for k in range(n):
        out[f"engine_lines_slot{k}"] = [x for x in new if x["slot"] == k]
    out["arm_wall_ms"] = wall_ms
    out["loadavg_at_start"] = loadavg()
    return out


# --------------------------------------------------------------------------
# door mode: the road the app's devices actually take
# --------------------------------------------------------------------------
def device_cache_salt(credential):
    """The door's per-device cache salt, computed HERE so the pinning check
    can prove the door delivered exactly this namespace. The label and the
    order are the door's own (sha256(label || credential bytes),
    crates/kalsa-door/src/devices.rs); a label that drifts lands the direct
    leg in an empty namespace and the run refuses."""
    return hashlib.sha256(
        DOOR_SALT_LABEL + credential.encode("ascii")).hexdigest()


def completion_request(prompt, n_predict, slot, salt_hex=None, credential=None):
    """What ONE completion sends, decided in one place - checked offline by
    dev/test-door-harness.py, which drives the WHOLE arm sequence through
    this and the run_one/send seam.

    Same body in both roads except `id_slot`: direct names the slot itself;
    through the door the slot is the door's seal and the client's copy is
    stripped (request.rs), so naming it would be a lie the door discards.
    The headers are the EXACT transport headers for the road taken: direct
    gets `x-kalsa-cache-salt` (and never a Bearer), door gets
    `Authorization: Bearer` and no salt header (the salt is the one the
    DOOR derives). Returns (payload, headers).
    """
    payload = {"prompt": prompt, "n_predict": n_predict, "temperature": 0.0,
               "seed": 1, "cache_prompt": True, "ignore_eos": True}
    if credential is None:
        payload["id_slot"] = slot
        return payload, {"x-kalsa-cache-salt": salt_hex}
    return payload, {"Authorization": f"Bearer {credential}"}


def require_matched_for_door(release):
    """Door mode starts only on the delivered release.

    The runner declares `EnginePrivateHeaders::Consumed` - capacity > 1 is
    refused without it (lib.rs:379-380) - i.e. it promises the engine reads
    X-Kalsa-Slot / X-Kalsa-Cache-Salt. Only a release the identity veto
    passed (`matched`: manifest hash, engine module and --version commit
    agreeing) is known to be that engine; a fork or an unverified build
    could ignore the headers and auto-schedule every device into one slot,
    which is exactly the number this mode exists to measure.
    """
    if release.get("status") != "matched":
        raise SystemExit(
            "--door-bin refuses to start: the runner would tell the door the "
            "engine consumes its private headers (EnginePrivateHeaders::"
            "Consumed), and only a `matched` release - manifest hash, engine "
            "module and --version commit all agreeing - is known to do that; "
            f"this run is {release.get('status')!r} (reason_code "
            f"{release.get('reason_code')!r}), so several devices could be "
            "auto-scheduled into one slot and the artifact would not know. "
            "Run direct (--door-bin absent) or on the delivered release.")


def require_published_manifest(door_bin, override_url):
    """Door mode refuses `--release-manifest-url` (Reviewer B's N9).

    The whole door gate rests on `matched` being load-bearing -
    require_matched_for_door runs on it, the pinning runs after it. An
    override manifest can carry ANY binary's own hash and commit: a fork
    shipping its own manifest would read `matched` through its own file
    and self-certify into door mode. So the door runs only on the
    PUBLISHED manifest, derived from the kalsa-server-vX.Y.Z directory;
    the override stays legal for direct runs, where it only relabels the
    provenance this run's own gate does not lean on."""
    if door_bin and override_url:
        raise SystemExit(
            "--door-bin refuses to run with --release-manifest-url: the "
            "door gate rests on `matched` from the PUBLISHED manifest "
            "(derived from the binary's kalsa-server-vX.Y.Z directory), and "
            "an override manifest can carry this build's own hash and "
            "commit - a fork would self-certify through its own file. Drop "
            "the override, or run direct (--door-bin absent).")


def scrub_secrets(text, credentials):
    """G3: child output may contain ANYTHING - a runner that echoes stdin
    must not be able to put a credential or a derived salt into an
    exception, a print or the artifact. Every credential and its door
    salt, full and as 16-hex prefixes, are replaced before `text` leaves
    this function. Longest-first, so a full digest is hidden even where
    its prefix would match too. (Credentials and salts reach no artifact
    path at all - dev/test-door-harness.py (7) proves that on the records
    - so child output is the one channel this guards.)"""
    if not text:
        return text
    hidden = set()
    for cred in credentials:
        salt = device_cache_salt(cred)
        hidden.update((cred, salt, cred[:16], salt[:16]))
    for s in sorted(hidden, key=len, reverse=True):
        text = text.replace(s, "[scrubbed]")
    return text


def start_door_runner(door_bin, engine_port, capacity, timeout_s=15.0):
    """Spawn measure_door, hand it `capacity` fresh credentials over stdin,
    and wait for its ONE stdout line: `listening 127.0.0.1:<port>`.

    Credentials are minted here and live only in this process's memory.
    EVERY exit path stops the child, BaseException included: Ctrl-C during
    startup must not orphan a runner that was already spawned (the old
    `except Exception` did exactly that - Reviewer A proved it live:
    HARNESS_EXIT=-2, RUNNER_SURVIVED_AFTER_SIGINT=True). KeyboardInterrupt
    and SystemExit stop the child first and then propagate unchanged; an
    ordinary Exception becomes the harness's refusal, and BOTH child-output
    channels (the first stdout line, the stderr excerpt) are run through
    scrub_secrets before they can enter that message. Returns (proc,
    door_port, credentials).
    """
    credentials = [secrets.token_hex(32) for _ in range(capacity)]
    proc = None
    try:
        proc = subprocess.Popen(
            [door_bin, "--engine-port", str(engine_port),
             "--capacity", str(capacity)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True)
        for cred in credentials:
            proc.stdin.write(cred + "\n")
        proc.stdin.flush()
        box = {}

        def read_listening():
            # scrubbed AT THE SOURCE: the line is child output, and it is
            # about to be quoted into an exception message
            box["line"] = scrub_secrets(proc.stdout.readline(), credentials)

        reader = threading.Thread(target=read_listening, daemon=True)
        reader.start()
        reader.join(timeout_s)
        if reader.is_alive():
            raise RuntimeError(f"no `listening` line within {timeout_s}s")
        line = box.get("line", "")
        m = re.fullmatch(r"listening 127\.0\.0\.1:(\d+)\n?", line)
        if not m:
            raise RuntimeError(
                f"unexpected runner output {line.strip()[:80]!r} "
                f"(runner exit {proc.poll()})")
        return proc, int(m.group(1)), credentials
    except BaseException as e:
        stop_door_runner(proc)
        if not isinstance(e, Exception):
            # KeyboardInterrupt / SystemExit: the child is stopped, the
            # original BaseException propagates untouched.
            raise
        stderr = ""
        if proc is not None and proc.stderr is not None:
            try:
                raw = proc.stderr.read().strip()[:300]
                stderr = scrub_secrets(raw, credentials)
            except OSError:
                pass
        raise SystemExit(
            f"the door runner {door_bin} failed to start: {type(e).__name__}: "
            f"{e}" + (f" - runner stderr: {stderr}" if stderr else ""))


def stop_door_runner(proc):
    """Close the runner's stdin (its cue to shut down), wait, kill if it
    lingers. Safe on a runner that already died, and on None - every exit
    path calls this, like the engine's own stop."""
    if proc is None:
        return
    if proc.stdin is not None:
        try:
            proc.stdin.close()
        except OSError:
            pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def door_health(door_port, credential, timeout=60):
    """One GET /health through the door with a device's bearer - the queue
    probe. What comes back is RECORDED, never asserted: with N streams on
    the door's 4 workers the prediction is that it waits for a worker, and
    the artifact says what actually happened. Returns (status_or_None,
    wall_ms, t_sent, t_answered): the two instants are perf_counter()
    stamps taken immediately before the request and immediately after the
    response - the wall is the rounded reading of them, the instants are
    what the probe dict records (G4: the answer is never rebuilt from the
    rounded wall)."""
    req = urllib.request.Request(
        f"http://127.0.0.1:{door_port}/health",
        headers={"Authorization": f"Bearer {credential}"})
    t_sent = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception:
        status = None
    t_answered = time.perf_counter()
    return status, round((t_answered - t_sent) * 1000, 1), t_sent, t_answered


def count_done_before(streams_done_ms, probe_answered_ms):
    """Pure (G4): how many streams finished at or before the probe's
    answer, computed FROM THE RECORDED, rounded values the artifact
    stores - so any reader (and dev/test-door-harness.py (10)) can
    recompute `streams_done_before_probe_answered` from the artifact's own
    fields. A stream with no stamp (None) never counts."""
    return sum(1 for d in streams_done_ms
               if d is not None and d <= probe_answered_ms)


def require_arms_cold(recs):
    """Door mode REFUSES to write the number when any arm is warm. The
    erase before every arm exists precisely so the arms compare decode only
    (the door's salt is FIXED per device, so a missed erase WOULD show up
    as warmth): a warm arm means the erase did not land, and its number
    would be prompt-cache reuse, not decode. Door-only - main() calls this
    under `if door`, and direct mode keeps its documented behaviour (its
    salts differ per arm, so its warmth semantics are the warm_prefix
    verdict's, not this refusal's)."""
    warm = sorted(name for name, rec in recs.items()
                  if rec.get("cache_n") != 0)
    if warm:
        raise SystemExit(
            f"door mode refuses: arm cache_n != 0 for {warm} - every arm's "
            "slots are erased (direct, with the device's own salt) before "
            "the arm runs so the arms stay cold; a warm arm means the erase "
            "did not land and the number would be prompt-cache reuse, not "
            "decode - no artifact written")


def pin_device_slots(port, door_port, prompts, credentials, salts):
    """Prove the salt per device END TO END, one device at a time, before
    anything is measured.

    leg 1 (through the door): device k, its own Bearer, no id_slot and no
    salt header - the door must answer `id_slot == k` (the sticky first-fit
    assignment, slots.rs). leg 2 (direct): the SAME prompt to slot k with
    the salt THIS harness derives from k's credential - `cache_n > 0` only
    if the door wrote exactly that salt: a different namespace clears the
    slot instead of warming it. The label mutation (v1 -> v2) turns leg 2
    red; that is what makes "the salt per device" a measurement rather than
    an assumption. Then slot k is erased (direct, the device's salt) so the
    arms start cold.
    """
    for k, prompt in enumerate(prompts):
        payload, headers = completion_request(prompt, 1, k, salts[k],
                                              credentials[k])
        status, resp = http_json_extra(door_port, "/completion", payload, headers)
        got_slot = (resp or {}).get("id_slot")
        if status != 200 or got_slot != k:
            raise SystemExit(
                f"door pinning failed for device {k}: through the door "
                f"status={status} id_slot={got_slot!r}, expected {k} - the "
                "door did not seal this device's slot; refusing to measure "
                "through a road that does not route")
        dpayload, dheaders = completion_request(prompt, 1, k, salts[k], None)
        status, direct = http_json_extra(port, "/completion", dpayload, dheaders)
        cache_n = ((direct or {}).get("timings") or {}).get("cache_n")
        if status != 200 or not cache_n:
            raise SystemExit(
                f"door pinning failed for device {k}: the direct read of "
                f"slot {k} in the salt THIS harness derives answered "
                f"status={status} cache_n={cache_n!r} - the door's warm "
                "state did not survive in that namespace, so either the "
                "door wrote another salt or the harness's label drifted "
                "(the v1->v2 mutation is exactly this failure); the "
                "salt-per-device claim is unproven - refusing to measure")
        slot_action(port, k, "erase", salts[k])
        print(f"[pin {k}] door id_slot={got_slot} direct cache_n={cache_n} "
              "erase ok", flush=True)


def run_streams_door(door_port, prompts, n_predict, credentials, server,
                     probe_after_s=1.0, send=None):
    """Arm B through the door, plus the FIFTH request: one GET /health
    through the door, sent probe_after_s after the LAST of the N
    completions left, timed.

    Timestamps (G4): each stream stamps perf_counter() INSIDE run_one -
    immediately before its request leaves and immediately after its
    response lands - and the probe stamps its own send and answer the same
    way. All four series are recorded RELATIVE TO THE BARRIER RELEASE:
    this thread waits on the same n+1 barrier, so t_release is the instant
    every stream was let go. `streams_done_before_probe_answered` is
    computed AFTER the join from exactly the recorded values
    (count_done_before) - never from a rounded duration, never while a
    thread may still write.

    The probe is an ACTIVE fifth request through the door's worker path
    (crates/kalsa-door/src/proxy.rs:51 forwards /health through the same
    workers the streams hold), not a passive observation; what waits is
    recorded, not asserted (with WORKERS = 4, source-derived into
    provenance, and N streams the prediction is that it waits). Returns
    (arm, probe), the arm shaped exactly as run_streams()'s. The engine
    port is NOT a parameter: every completion here goes to the door.
    """
    out = {}
    errors = {}
    n = len(prompts)
    barrier = threading.Barrier(n + 1)   # the N streams + THIS thread,
    # so t_release below is the instant every stream was released
    marks = {}                           # k -> {"sent": ..., "done": ...}
    before = len(server.lines())

    def one(k):
        try:
            barrier.wait(timeout=90)
            st = {}
            marks[k] = st                # published before the request
            out[f"slot{k}"] = run_one(door_port, prompts[k], n_predict, None,
                                      k, server, credentials[k],
                                      split_log=False, send=send, stamps=st)
        except Exception as e:
            errors[k] = f"{type(e).__name__}: {e}"

    t0 = time.perf_counter()
    threads = [threading.Thread(target=one, args=(k,), daemon=True)
               for k in range(n)]
    for t in threads:
        t.start()
    try:
        barrier.wait(timeout=90)
    except threading.BrokenBarrierError:
        k = min(errors) if errors else 0
        raise SystemExit(
            f"stream slot{k} died: {errors.get(k, 'the barrier broke')}; "
            "refusing to measure")
    t_release = time.perf_counter()
    deadline = time.perf_counter() + 60
    while not all(k in marks and "sent" in marks[k] for k in range(n)):
        if errors:
            # a thread died before its request left: no probe, no arm -
            # the refusal names the slot instead of a later KeyError.
            k = min(errors)
            raise SystemExit(
                f"stream slot{k} died: {errors[k]}; refusing to measure")
        if time.perf_counter() > deadline:
            raise SystemExit(
                "door arm B: a stream never reported its send within 60s - "
                "refusing to probe (and to measure) a run that did not start")
        time.sleep(0.005)
    all_sent = max(marks[k]["sent"] for k in range(n))
    wait = probe_after_s - (time.perf_counter() - all_sent)
    if wait > 0:
        time.sleep(wait)
    probe_status, probe_wall, t_probe_sent, t_probe_answered = door_health(
        door_port, credentials[0])
    for t in threads:
        t.join()
    if errors:
        k = min(errors)
        raise SystemExit(
            f"stream slot{k} died: {errors[k]}; refusing to measure")
    # G4: everything below is computed AFTER the join, from the recorded
    # stamps only - the count is reproducible from the artifact's fields.
    streams_sent_ms = [round(marks[k]["sent"] - t_release, 1)
                       for k in range(n)]
    streams_done_ms = [round(marks[k]["done"] - t_release, 1)
                       for k in range(n)]
    probe_sent_ms = round(t_probe_sent - t_release, 1)
    probe_answered_ms = round(t_probe_answered - t_release, 1)
    probe = {
        "sent_after_ms": round(probe_sent_ms - max(streams_sent_ms), 1),
        "wall_ms": probe_wall,
        "status": probe_status,
        "probe_sent_ms": probe_sent_ms,
        "probe_answered_ms": probe_answered_ms,
        "streams_sent_ms": streams_sent_ms,
        "streams_done_ms": streams_done_ms,
        "streams_done_before_probe_answered": count_done_before(streams_done_ms, probe_answered_ms),
        "note": ("the probe is an ACTIVE fifth request through the door's "
                 "worker path (crates/kalsa-door/src/proxy.rs:51 forwards "
                 "/health through the same workers the streams hold), not a "
                 "passive observation"),
    }
    wall_ms = round((time.perf_counter() - t0) * 1000, 1)
    new = extract(server.lines()[before:])
    out["engine_lines"] = new
    for k in range(n):
        out[f"engine_lines_slot{k}"] = [x for x in new if x["slot"] == k]
    out["arm_wall_ms"] = wall_ms
    out["loadavg_at_start"] = loadavg()
    return out, probe


def run_attempt_arms(port, door_port, prompts, n_predict, credentials,
                     device_salts, server, door, attempt_index,
                     send=None, pause_s=2.0, probe_after_s=1.0):
    """The arm sequence of ONE attempt, both roads, in one place.

    EVERY completion - A, all N slots of B, A2 - rides the road `door`
    names: through door_port with the device's Bearer when door mode, to
    the engine port with id_slot + the salt header otherwise. The slot
    ERASEs are always direct against the engine with that road's salts
    (the door has no erase route this harness trusts, and the erase must
    land before routing decides a slot). The pre-A2 erase exists only in
    door mode: door salts are fixed per device, so arm B just left device
    0's prompt warm on slot 0 and A2 would read that warmth as its own
    speed - direct's A2 salt is fresh and lands in an empty namespace.

    `send` is the transport seam (run_one/slot_action): a test drives this
    whole sequence against a fake and asserts the port, headers and body
    of every completion. `pause_s` is main()'s pacing (2 s); tests pass 0.
    Returns (arm_a, arm_b, arm_a2, probe); probe is None in direct mode.
    """
    n = len(prompts)
    if door:
        # The door derives each device's salt from its credential and it
        # is FIXED for the whole run: these are the namespaces every
        # direct erase below targets.
        sA = device_salts[0]
        sB = list(device_salts)
        sA2 = device_salts[0]
        arm_port = door_port
        print(f"[road] completions A/B/A2 via door 127.0.0.1:{door_port} "
              f"(Bearer per device); erases direct via 127.0.0.1:{port}",
              flush=True)
    else:
        sA = salt_of(f"arm-A-{attempt_index}")
        sB = [salt_of(f"arm-B-slot{k}-{attempt_index}") for k in range(n)]
        sA2 = salt_of(f"arm-A2-{attempt_index}")
        arm_port = port

    # Arm A: the request alone on slot 0 - through the door in door mode.
    slot_action(port, 0, "erase", sA, send=send)
    arm_a = run_one(arm_port, prompts[0], n_predict, sA, 0, server,
                    credentials[0] if door else None, send=send)
    time.sleep(pause_s)

    # Arm B: the same request on slot 0 and equal-length ones on every
    # further slot, started together through the barrier, same road.
    for k in range(n):
        slot_action(port, k, "erase", sB[k], send=send)
    probe = None
    if door:
        arm_b, probe = run_streams_door(door_port, prompts, n_predict,
                                        credentials, server,
                                        probe_after_s=probe_after_s, send=send)
    else:
        arm_b = run_streams(port, prompts, n_predict, sB, server, send=send)
    time.sleep(pause_s)

    # Arm A2: cold A again, to bound background drift.
    if door:
        slot_action(port, 0, "erase", sA2, send=send)
    arm_a2 = run_one(arm_port, prompts[0], n_predict, sA2, 0, server,
                     credentials[0] if door else None, send=send)
    return arm_a, arm_b, arm_a2, probe


def door_pool_from_source():
    """WORKERS and QUEUE read out of the door's source at run time: the
    compiled runner does not expose its pool sizes, so the numbers the
    artifact quotes come from the file that defines them, labelled
    source-derived - and door_source.commit says WHICH revision that file
    was read from."""
    src = HERE.parent / "crates" / "kalsa-door" / "src" / "lib.rs"
    try:
        text = src.read_text()
    except OSError as e:
        return {"workers": None, "queue": None, "source": str(src),
                "error": str(e)}
    w = re.search(r"const WORKERS: usize = (\d+);", text)
    q = re.search(r"const QUEUE: usize = (\d+);", text)
    return {"workers": int(w.group(1)) if w else None,
            "queue": int(q.group(1)) if q else None,
            "source": "crates/kalsa-door/src/lib.rs (const WORKERS, const QUEUE)",
            "derived": ("source-derived at run time: the compiled runner "
                        "does not expose its pool sizes")}


def door_provenance(args):
    """The door side of provenance: which binary ran (path + sha256) and
    which source it belongs to (commit + the door subtree's porcelain - a
    DIRTY door is recorded, never refused: the run measures the binary it
    ran), plus the pool its source declares."""
    def git(*g):
        return subprocess.run(["git", "-C", str(HERE.parent), *g],
                              capture_output=True, text=True).stdout.strip()
    return {
        "door_bin": args.door_bin,
        "door_bin_sha256": sha256_file(args.door_bin),
        "door_source": {
            "commit": git("rev-parse", "HEAD"),
            "porcelain": git("status", "--porcelain", "--",
                             "crates/kalsa-door"),
        },
        "door_pool_from_source": door_pool_from_source(),
    }


def build_result(args, release, version, engine_sha256, argv, slots_dir,
                 started_utc, loadavg_before, boot, n_verify, attempts,
                 accepted, door_probe=None):
    """The artifact dict, extracted from main() so its SHAPE can be checked
    offline (dev/test-concurrency-shape.py): every input is a value main()
    already holds, and nothing here starts a server or reads the network
    (the file hashes excepted - properties of files, not of the run).

    N-driven: the arm key comes from ARM_KEYS, every slot k gets its
    `per_stream_slot{k}_over_A`, `B_slot{k}` and engine-line keys,
    `aggregate_over_A` is the sum over slots over A, `parallel` is N, and
    `context_size_per_slot` is ctx_size // N (main() has already refused a
    ctx_size the engine cannot split evenly, and checked it against the
    boot line). At N=2 every key path is the committed artifact's.
    """
    n = args.streams
    arm_key = ARM_KEYS[n]
    arm_a = accepted["A_solo_slot0"]
    arm_b = accepted[arm_key]
    arm_a2 = accepted["A2_solo_repeat"]
    a_pps = arm_a["predicted_per_second"]
    b_pps = [arm_b[f"slot{k}"]["predicted_per_second"] for k in range(n)]
    a2_pps = arm_a2["predicted_per_second"]
    cache_ns = {"A": arm_a["cache_n"],
                **{f"B_slot{k}": arm_b[f"slot{k}"]["cache_n"]
                   for k in range(n)},
                "A2": arm_a2["cache_n"]}
    script = Path(__file__).resolve()
    harness = HERE / "engine-harness.py"
    # The question says N devices; N=2 keeps the committed artifact's exact
    # wording ("a second device" IS two devices, and the panel reads this).
    concurrent = "a second device decodes" if n == 2 else f"{n} devices decode"

    result = {
        "measurement": "concurrency-cost",
        "question": ("what one device's decode rate costs when "
                     f"{concurrent} at the same time, on one engine"),
        "provenance": {
            **run_parameters(args),
            # which road the arms took: "direct" (the historical path the
            # committed artifact used, minus this one key) or "door".
            "via": "door" if args.door_bin else "direct",
            "started_utc": started_utc,
            "hostname": socket.gethostname(),
            "host_arch": subprocess.run(["uname", "-m"], capture_output=True,
                                        text=True).stdout.strip(),
            "engine_binary": args.bin,
            "engine_sha256": engine_sha256,
            "release": release,
            "engine_version": version,
            "engine_nice": NICE,
            "script": str(script),
            "script_sha256": sha256_file(script),
            "harness": str(harness),
            "harness_sha256": sha256_file(harness),
            "model": args.model,
            "model_sha256": sha256_file(args.model),
            "argv": argv,
            "slots_dir": str(slots_dir),
            "context_size_total": args.ctx_size,
            "context_size_per_slot": args.ctx_size // n,
            "parallel": n,
            "cache_ram": 0,
            "cache_type_k": "q8_0",
            "cache_type_v": "q8_0",
            "sleep_idle_seconds": SLEEP_IDLE_S,
            "sleep_idle_note": ("disabled on purpose: a model unload "
                                "mid-run would contaminate every later arm; "
                                "the app ships 300"),
            "engine_init_line": boot["init_lines"],
            "engine_kv_lines": boot["kv_lines"],
            "engine_swa_lines": boot["swa_lines"],
            "checkpoint_line": boot["ctx_check"],
            "n_predict": args.n_predict,
            "ignore_eos": True,
            "prompt_tokens": n_verify[0],
            "prompt_tokens_arm_b_slot1": n_verify[1],
            "prompt_tokens_per_slot": list(n_verify),
            "prompt_seeds": list(PROMPT_SEEDS[:n]),
            "prompt_sentinel_checked": True,
            "prompt_sentinel_found_in_log": False,
            "prompt_sentinel_note": ("the harness fixture word the leak check "
                                     "searches for; not carried here"),
            "slot_actions_supported": True,
            "slot_actions_note": ("--slot-save-path is in argv and every "
                                  "erase was asserted 2xx"),
            "raw_log_committed": False,
            "wall_times_note": ("walls are this machine's at nice 10 under "
                                "whatever else it was doing, with the A2/A "
                                "bracket as the drift control; not "
                                "performance promises"),
            "loadavg_before": loadavg_before,
        },
        "arms": {
            "A_solo_slot0": arm_a,
            arm_key: arm_b,
            "A2_solo_repeat": arm_a2,
        },
        "attempts": attempts,
        "accepted_attempt": accepted["index"],
        "bracket": {
            "rule": "A2 must land within +/- bracket_tol of A; A2 is the "
                    "control for host load, not a measurement",
            "bracket_tol": args.bracket_tol,
            "accepted_A2_over_A": accepted["A2_over_A"],
        },
        "tokens_generated": {
            "A": arm_a["predicted_n"],
            **{f"B_slot{k}": arm_b[f"slot{k}"]["predicted_n"]
               for k in range(n)},
            "A2": arm_a2["predicted_n"],
        },
        "warm_prefix_in_play": warm_prefix_field(
            cache_ns, door=bool(args.door_bin)),
        "ratios": {
            **{f"per_stream_slot{k}_over_A": ratio(b_pps[k], a_pps)
               for k in range(n)},
            "aggregate_over_A": ratio(sum(b_pps), a_pps),
            "per_stream_slot0_over_A2": ratio(b_pps[0], a2_pps),
            "A2_over_A": ratio(a2_pps, a_pps),
        },
        "tokens_per_second": {
            "A": a_pps,
            **{f"B_slot{k}": b_pps[k] for k in range(n)},
            "A2": a2_pps,
            "B_aggregate": round(sum(b_pps), 2),
        },
    }
    result["provenance"]["loadavg_after"] = loadavg()
    result["provenance"]["finished_utc"] = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if args.door_bin:
        result["provenance"].update(door_provenance(args))
    if door_probe is not None:
        # door mode only: the fifth request of the accepted attempt's arm B.
        result["door_queue_probe"] = door_probe
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=19311)
    ap.add_argument("--out", required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--slots-dir", required=True,
                    help="directory this run gives the engine for slot files; "
                         "created and cleared here, passed as --slot-save-path")
    ap.add_argument("--bin", required=True,
                    help="the engine binary under test; which binary the "
                         "panel's number describes is the owner's decision, "
                         "so there is no default")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--ctx-size", type=int, default=8192,
                    help="TOTAL context, split by the engine across "
                         "--streams; a total not divisible by the stream "
                         "count is refused before anything starts")
    ap.add_argument("--streams", type=int, choices=(2, 4), default=2,
                    help="concurrent streams (the engine's --parallel). The "
                         "app's menu offers 1/2/4 devices "
                         "(crates/kalsa-launch/src/policy/menu.rs); 1 has no "
                         "concurrency to measure and 3 is not offered, so "
                         "neither is a choice")
    ap.add_argument("--n-predict", type=int, default=256)
    ap.add_argument("--prompt-tokens", type=int, default=512)
    ap.add_argument("--attempts", type=int, default=4,
                    help="A/B/A2 attempts; each is rejected unless A2 is "
                         "within --bracket-tol of A; the value used (after "
                         "this default) is recorded as provenance.attempts_max")
    ap.add_argument("--bracket-tol", type=float, default=0.03,
                    help="how far A2 may drift from A before the attempt is "
                         "called contaminated by other load")
    ap.add_argument("--keep-server", action="store_true")
    ap.add_argument("--max-load", type=float, default=6.0,
                    help="refuse to start an engine while the 1-minute load "
                         "average is above this; a decode rate recorded under "
                         "other load is not the number the panel may print; "
                         "the value used (after this default) is recorded as "
                         "provenance.max_load. 0 or a negative value means NO "
                         "ceiling: the gate is off by explicit choice, and the "
                         "artifact records the field as 0.0 - a reader sees the "
                         "gate was disabled, not that the run passed a limit")
    ap.add_argument("--ctx-checkpoints", type=int, default=None,
                    help="render `--ctx-checkpoints K` as the same pair the "
                         "app ships (argv.rs renders `--ctx-checkpoints 1`); "
                         "default None renders NOTHING (the argv at defaults "
                         "stays the committed one); the value used is "
                         "recorded as provenance.ctx_checkpoints (null when "
                         "not rendered), and the engine's boot line must "
                         "report `context checkpoints ... max = K` or the "
                         "run is refused")
    ap.add_argument("--flash-attn", choices=("on",),
                    default=None,
                    help="render `--flash-attn on` - the only value the app "
                         "renders (argv.rs FLASH_ATTN). `off` and `auto` are "
                         "not choices: this run's q8_0 V cache cannot boot "
                         "without flash attention (the engine refuses a "
                         "quantized V cache without it). Default None "
                         "renders NOTHING; recorded as provenance.flash_attn "
                         "(null when not rendered)")
    ap.add_argument("--release-manifest-url", default=None,
                    help="override the release manifest URL; by default it is "
                         "derived from a kalsa-server-vX.Y.Z binary directory")
    ap.add_argument("--door-bin", default=None,
                    help="path to the measure_door example: run the arms "
                         "THROUGH crates/kalsa-door instead of direct to the "
                         "engine (provenance.via = 'door'). Refused unless "
                         "the release is matched: only the release the "
                         "identity veto passed is known to consume the "
                         "door's private headers, and without them every "
                         "device would collapse into one slot")
    args = ap.parse_args()

    require_outside_repo(args.log, "log")
    require_outside_repo(args.slots_dir, "slots-dir")
    require_divisible_ctx(args.ctx_size, args.streams)
    require_published_manifest(args.door_bin, args.release_manifest_url)

    # Hashed and URL-derived before anything is measured, so a later failure
    # to read the manifest is recorded as unverified instead of quietly
    # forgotten. The release BLOCK is built below, after --version: its veto
    # compares the commit --version prints with the manifest's.
    engine_sha256 = sha256_file(args.bin)
    manifest_url = args.release_manifest_url
    if manifest_url is None:
        manifest_url = derive_manifest_url(args.bin)

    la0 = os.getloadavg()[0]
    # max_load <= 0 is the documented way to switch this gate OFF (no
    # ceiling, recorded verbatim as provenance.max_load = 0.0); anything
    # positive is a real ceiling the run must pass before anything starts.
    if args.max_load > 0 and la0 > args.max_load:
        raise SystemExit(
            f"refusing to measure: 1-minute load average is {la0:.2f}, above "
            f"--max-load {args.max_load}. Other work is running on this "
            f"machine; a contended decode rate is not usable. Wait, then "
            f"run again, or raise --max-load deliberately.")

    slots_dir = Path(args.slots_dir)
    slots_dir.mkdir(parents=True, exist_ok=True)
    for old in slots_dir.glob("*.bin"):
        old.unlink()   # a file from an earlier run must not predate this one

    argv = engine_argv(args.bin, args.model, args.port, args.ctx_size,
                       slots_dir, args.streams,
                       ctx_checkpoints=args.ctx_checkpoints,
                       flash_attn=args.flash_attn)

    vp = subprocess.run(["nice", "-n", str(NICE), args.bin, "--version"],
                        capture_output=True, text=True)
    version = (vp.stdout + vp.stderr).strip()
    release = release_block(args.bin, version, manifest_url)
    if args.door_bin:
        require_matched_for_door(release)

    started_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    loadavg_before = loadavg()

    server = eh.Server(argv, args.log)
    print("[engine] starting", flush=True)
    keep = False
    runner = None
    try:
        server.start(args.port)
        # A health check proves a server is alive, not WHICH one: the
        # responder must claim this binary's build before anything is
        # measured (engine-harness.check_running_build, offline-tested).
        eh.require_running_engine(args.port, version)

        boot = server.lines()
        init_lines = [l.strip() for l in boot if "n_slots" in l and "n_ctx_slot" in l]
        kv_lines = [l.strip() for l in boot if "llama_kv_cache: size" in l]
        ctx_check = [l.strip() for l in boot if "context checkpoints" in l]
        swa_lines = [l.strip() for l in boot
                     if "n_swa " in l or "is_swa_any" in l or "creating non-SWA" in l
                     or "creating     SWA" in l]
        if not init_lines:
            raise SystemExit(
                "the boot log carries no n_slots line: the log format drifted "
                "and the corroborating channel is dead - refusing to measure")
        require_n_ctx_slot(init_lines, args.ctx_size // args.streams)
        if args.ctx_checkpoints is not None:
            require_checkpoint_line(ctx_check, args.ctx_checkpoints)

        prompts = [make_prompt(args.port, seed, args.prompt_tokens)[0]
                   for seed in PROMPT_SEEDS[:args.streams]]
        n_verify = [len(tokenize(args.port, p)) for p in prompts]
        print(f"[fixture] verified token counts {n_verify} "
              f"target={args.prompt_tokens}", flush=True)
        if any(n != args.prompt_tokens for n in n_verify):
            raise SystemExit("prompt lengths differ - refusing to measure")

        door = args.door_bin is not None
        credentials = None
        device_salts = None
        door_port = None
        if door:
            # The runner starts only now: the engine is up, healthy (the
            # harness waits for /health) and boot-checked, so the door it
            # fronts is a server, not a hope. The pinning below is what
            # makes the salt-per-device claim a measurement.
            runner, door_port, credentials = start_door_runner(
                args.door_bin, args.port, args.streams)
            device_salts = [device_cache_salt(c) for c in credentials]
            pin_device_slots(args.port, door_port, prompts, credentials,
                             device_salts)

        # A, B, A2 is one attempt. The A2 arm is the control: if it drifts from A
        # by more than the tolerance, another agent moved the machine during the
        # attempt and the attempt is rejected. Every attempt is kept in the
        # artifact; only a bracket-passing attempt may become the number.
        attempts = []
        accepted = None
        arm_key = ARM_KEYS[args.streams]
        for i in range(args.attempts):
            # The whole arm sequence - every completion on ONE road - lives
            # in run_attempt_arms, where a test drives it against a fake
            # transport and proves the road (dev/test-door-harness.py).
            arm_a, arm_b, arm_a2, door_probe = run_attempt_arms(
                args.port, door_port, prompts, args.n_predict, credentials,
                device_salts, server, door, i)
            print(f"[A{i} ] wall={arm_a['wall_ms']}ms cache_n={arm_a['cache_n']} "
                  f"tok/s={arm_a['predicted_per_second']}", flush=True)
            for k in range(args.streams):
                rec = arm_b[f"slot{k}"]
                print(f"[B{k}{i}] wall={rec['wall_ms']}ms "
                      f"cache_n={rec['cache_n']} "
                      f"tok/s={rec['predicted_per_second']}", flush=True)
            if door and door_probe is not None:
                print(f"[B probe{i}] status={door_probe['status']} "
                      f"wall={door_probe['wall_ms']}ms "
                      f"sent_after={door_probe['sent_after_ms']}ms "
                      f"done_before_answer="
                      f"{door_probe['streams_done_before_probe_answered']}"
                      f"/{args.streams}", flush=True)
            print(f"[A2{i}] wall={arm_a2['wall_ms']}ms cache_n={arm_a2['cache_n']} "
                  f"tok/s={arm_a2['predicted_per_second']}", flush=True)

            recs = {"A": arm_a, **{f"B_slot{k}": arm_b[f"slot{k}"]
                                   for k in range(args.streams)},
                    "A2": arm_a2}
            require_rates(recs)
            require_engine_lines(f"attempt {i} arm A", arm_a["engine_lines"])
            require_engine_lines(f"attempt {i} arm A2", arm_a2["engine_lines"])
            require_engine_lines(f"attempt {i} arm B", arm_b["engine_lines"])
            for k in range(args.streams):
                require_engine_lines(f"attempt {i} arm B slot {k}",
                                     arm_b[f"engine_lines_slot{k}"])
            if door:
                require_arms_cold(recs)

            a_pps = arm_a["predicted_per_second"]
            a2_pps = arm_a2["predicted_per_second"]
            a2_over_a = ratio(a2_pps, a_pps)
            ok = a2_over_a is not None and abs(a2_over_a - 1.0) <= args.bracket_tol
            attempts.append({"index": i, "A_solo_slot0": arm_a,
                             arm_key: arm_b, "A2_solo_repeat": arm_a2,
                             "A2_over_A": a2_over_a, "bracket_ok": ok})
            print(f"[attempt {i}] A2/A = {a2_over_a} bracket_ok={ok}", flush=True)
            if ok:
                accepted = attempts[-1]
                break
            time.sleep(5)
        if accepted is None:
            # No fallback: the tightest contaminated attempt is still a timing
            # taken under load, and the house rule is that it is not
            # panel-printable. No artifact, non-zero exit.
            detail = ", ".join(f"{a['index']}:{a['A2_over_A']}" for a in attempts)
            raise SystemExit(
                f"no attempt passed the A2/A bracket ({detail}); a timing taken "
                "while the host drifted is not a number the panel may print - "
                "no artifact written")

        require_accepted_corroboration(accepted, arm_key, args.streams)

        full_log = server.lines()
        leak = [l for l in full_log if SENTINEL in l]
        if leak:
            # The refusal must not leave the leak behind for the next
            # reader: the log carried prompt text, so the log goes too -
            # and the message says whether that actually succeeded (G9).
            if delete_log_or_say(args.log):
                tail = f"the log was deleted: {args.log}"
            else:
                tail = ("the log could NOT be deleted and still holds the "
                        f"text: {args.log} - remove it yourself")
            raise SystemExit(
                f"REFUSING TO WRITE: the engine log carries prompt text "
                f"({len(leak)} lines); {tail}")

        result = build_result(
            args, release, version, engine_sha256, argv, slots_dir,
            started_utc, loadavg_before,
            {"init_lines": init_lines, "kv_lines": kv_lines,
             "ctx_check": ctx_check, "swa_lines": swa_lines},
            n_verify, attempts, accepted,
            door_probe=door_probe if door else None)

        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(result, f, indent=1)

        print("\n=== numbers ===")
        for k, v in result["tokens_per_second"].items():
            print(f"  {k:12s} {v}")
        for k, v in result["ratios"].items():
            print(f"  {k:28s} {v}")

        keep = args.keep_server
        return 0
    finally:
        # Every exit path stops the runner and then the engine: a runner
        # left up would hold the door's listener and the engine's upstream
        # port open against the next run. The engine's --keep-server still
        # governs only the engine.
        stop_door_runner(runner)
        if keep:
            print("[engine] left running (--keep-server)", flush=True)
        else:
            server.stop()
            print("[engine] stopped", flush=True)


if __name__ == "__main__":
    sys.exit(main())
