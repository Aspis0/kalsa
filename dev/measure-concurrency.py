#!/usr/bin/env python3
"""Measurement 1 - what two devices talking at once costs, per stream.

One engine, `--parallel 2`, a fixed `--ctx-size`, q8_0 KV. The request is the
same in both arms: same prompt token length, same `n_predict`, `ignore_eos` so
the token count cannot drift.

  Arm A   one request, alone, on slot 0, its own cache salt.
  Arm B   the SAME request on slot 0 and a second request of the same token
          length on slot 1, started together through a barrier, each with its
          own cache salt.

  Arm A2  Arm A repeated after Arm B, to bracket the background load. It is cold
          by construction: Arm B left a different namespace on slot 0.

Arms are built to be cold - `--cache-ram 0` closes the shared prompt cache and
each arm carries a fresh 64-hex salt. The artifact does not take that on faith:
the cold/warm verdict is DERIVED from the observed `cache_n` of the four arms,
and if any of those values is missing the verdict field is omitted rather than
guessed.

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
      [--port 19311] [--model MODEL] [--ctx-size 8192] [--n-predict 256] \
      [--prompt-tokens 512] [--attempts 4] [--bracket-tol 0.03] [--keep-server] \
      [--max-load 6.0] [--release-manifest-url URL]

Provenance the next reader can check instead of trust: `max_load` and
`attempts_max` are recorded as the values actually used (after their
defaults), and `release` is DERIVED by matching the sha256 of the binary that
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
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
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


# --------------------------------------------------------------------------
# http helpers
# --------------------------------------------------------------------------
def http_json(port, path, payload, timeout=1800):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def http_json_salted(port, path, payload, salt_hex, timeout=1800):
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json",
               "x-kalsa-cache-salt": salt_hex}
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


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


def slot_action(port, slot, action, salt_hex):
    """Erase a slot the way the door does (the salt rides the header), and
    break the run if the engine refuses.

    A non-2xx here means the engine was started without `--slot-save-path` and
    answered 501, or the action failed: either way the arms would measure slots
    nobody erased, and that reads as plausible numbers on the wrong thing.
    """
    status, body = http_json_salted(port, f"/slots/{slot}?action={action}",
                                    {}, salt_hex)
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


def run_parameters(args):
    """The knobs of this run, each as the VALUE USED - after its default.

    These fields live here and not inline in the artifact literal so the
    control file can call this builder with a distinctive value and prove
    the field FOLLOWS the argument: a provenance field whose builder ignores
    its input records the default forever and calls it a measurement.
    """
    return {
        "max_load": args.max_load,
        "attempts_max": args.attempts,
    }


def engine_argv(bin_path, model, port, ctx_size, slots_dir):
    """The engine command line.

    `--slot-save-path` is not decoration: without it the slot actions answer
    501 and every erase in this run fails silently. The directory is created by
    the caller, because the engine refuses a path that is not a directory.
    """
    return ["nice", "-n", str(NICE), bin_path, "-m", model,
            "--host", "127.0.0.1", "--port", str(port),
            "--parallel", "2", "--ctx-size", str(ctx_size),
            "--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
            "--n-gpu-layers", "all", "--threads", "4", "--threads-batch", "4",
            "--batch-size", "2048", "--ubatch-size", "512",
            "--cache-ram", "0", "--slot-save-path", str(slots_dir) + "/",
            "--sleep-idle-seconds", str(SLEEP_IDLE_S),
            "--no-webui", "-lv", "4"]


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
    """Every arm of the accepted attempt must carry a real decode rate.

    A dead arm used to enter the aggregate as a zero (`or 0`) and a missing
    rate used to surface later as `None` in a min() after the engine was
    already up; both are failed runs, not data.
    """
    bad = [name for name, rec in recs.items()
           if rec.get("status") != 200
           or rec.get("predicted_per_second") is None]
    if bad:
        raise SystemExit(
            f"no usable decode rate for {bad}: a dead arm is a failed run, "
            "not a zero - refusing to measure")


def warm_prefix_field(cache_ns):
    """Cold/warm verdict DERIVED from the recorded cache_n values, never
    written: an artifact that claims every arm was cold while its own data
    says otherwise is worse than no field at all. If a value is missing the
    verdict is not derivable, so only the data is emitted."""
    field = {"cache_n": dict(cache_ns)}
    if any(v is None for v in cache_ns.values()):
        return field
    warm = sorted(name for name, v in cache_ns.items() if v > 0)
    if not warm:
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


def run_one(port, prompt, n_predict, salt_hex, slot, server):
    payload = {"prompt": prompt, "n_predict": n_predict, "temperature": 0.0,
               "seed": 1, "cache_prompt": True, "ignore_eos": True,
               "id_slot": slot}
    before = len(server.lines())
    t0 = time.perf_counter()
    status, r = http_json_salted(port, "/completion", payload, salt_hex)
    wall_ms = round((time.perf_counter() - t0) * 1000, 1)
    new = extract(server.lines()[before:])
    tim = (r or {}).get("timings") or {}
    return {
        "slot": slot,
        "salt_label": salt_hex[:16],
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


def run_two(port, prompt0, prompt1, n_predict, salt0, salt1, server):
    """Both requests leave through a barrier and land together.

    The new log region belongs to the arm, not to either thread, so it is
    collected once after both requests finish and split by slot id.
    """
    out = {}
    barrier = threading.Barrier(2)
    before = len(server.lines())

    def one(key, prompt, salt, slot):
        barrier.wait()
        rec = run_one(port, prompt, n_predict, salt, slot, server)
        rec["engine_lines"] = []
        out[key] = rec

    t0 = time.perf_counter()
    threads = [threading.Thread(target=one, args=("slot0", prompt0, salt0, 0)),
               threading.Thread(target=one, args=("slot1", prompt1, salt1, 1))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall_ms = round((time.perf_counter() - t0) * 1000, 1)
    new = extract(server.lines()[before:])
    out["engine_lines"] = new
    out["engine_lines_slot0"] = [x for x in new if x["slot"] == 0]
    out["engine_lines_slot1"] = [x for x in new if x["slot"] == 1]
    out["arm_wall_ms"] = wall_ms
    out["loadavg_at_start"] = loadavg()
    return out


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
    ap.add_argument("--ctx-size", type=int, default=8192)
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
    ap.add_argument("--release-manifest-url", default=None,
                    help="override the release manifest URL; by default it is "
                         "derived from a kalsa-server-vX.Y.Z binary directory")
    args = ap.parse_args()

    # Derived before anything is measured, so a later failure to read the
    # manifest is recorded as unverified instead of quietly forgotten.
    engine_sha256 = sha256_file(args.bin)
    manifest_url = args.release_manifest_url
    if manifest_url is None:
        manifest_url = derive_manifest_url(args.bin)
    release = release_provenance(manifest_url, engine_sha256)

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

    script = Path(__file__).resolve()
    harness = HERE / "engine-harness.py"

    slots_dir = Path(args.slots_dir)
    slots_dir.mkdir(parents=True, exist_ok=True)
    for old in slots_dir.glob("*.bin"):
        old.unlink()   # a file from an earlier run must not predate this one

    argv = engine_argv(args.bin, args.model, args.port, args.ctx_size, slots_dir)

    vp = subprocess.run(["nice", "-n", str(NICE), args.bin, "--version"],
                        capture_output=True, text=True)
    version = (vp.stdout + vp.stderr).strip()

    started_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    loadavg_before = loadavg()

    server = eh.Server(argv, args.log)
    print("[engine] starting", flush=True)
    keep = False
    try:
        server.start(args.port)

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

        prompt_p, n_a = make_prompt(args.port, 11, args.prompt_tokens)
        prompt_q, n_b = make_prompt(args.port, 22, args.prompt_tokens)
        n_verify = (len(tokenize(args.port, prompt_p)),
                    len(tokenize(args.port, prompt_q)))
        print(f"[fixture] verified token counts P={n_verify[0]} Q={n_verify[1]} "
              f"target={args.prompt_tokens}", flush=True)
        if n_verify[0] != n_verify[1]:
            raise SystemExit("prompt lengths differ - refusing to measure")

        def r(x, y):
            return round(x / y, 4) if (x and y) else None

        # A, B, A2 is one attempt. The A2 arm is the control: if it drifts from A
        # by more than the tolerance, another agent moved the machine during the
        # attempt and the attempt is rejected. Every attempt is kept in the
        # artifact; only a bracket-passing attempt may become the number.
        attempts = []
        accepted = None
        for i in range(args.attempts):
            sA = salt_of(f"arm-A-{i}")
            sB0 = salt_of(f"arm-B-slot0-{i}")
            sB1 = salt_of(f"arm-B-slot1-{i}")
            sA2 = salt_of(f"arm-A2-{i}")

            # Arm A: the request alone on slot 0.
            slot_action(args.port, 0, "erase", sA)
            arm_a = run_one(args.port, prompt_p, args.n_predict, sA, 0, server)
            print(f"[A{i} ] wall={arm_a['wall_ms']}ms cache_n={arm_a['cache_n']} "
                  f"tok/s={arm_a['predicted_per_second']}", flush=True)
            time.sleep(2)

            # Arm B: the same request on slot 0 and an equal-length one on slot 1.
            slot_action(args.port, 0, "erase", sB0)
            slot_action(args.port, 1, "erase", sB1)
            arm_b = run_two(args.port, prompt_p, prompt_q, args.n_predict, sB0, sB1, server)
            print(f"[B0{i}] wall={arm_b['slot0']['wall_ms']}ms cache_n={arm_b['slot0']['cache_n']} "
                  f"tok/s={arm_b['slot0']['predicted_per_second']}", flush=True)
            print(f"[B1{i}] wall={arm_b['slot1']['wall_ms']}ms cache_n={arm_b['slot1']['cache_n']} "
                  f"tok/s={arm_b['slot1']['predicted_per_second']}", flush=True)
            time.sleep(2)

            # Arm A2: cold A again, to bound background drift.
            arm_a2 = run_one(args.port, prompt_p, args.n_predict, sA2, 0, server)
            print(f"[A2{i}] wall={arm_a2['wall_ms']}ms cache_n={arm_a2['cache_n']} "
                  f"tok/s={arm_a2['predicted_per_second']}", flush=True)

            recs = {"A": arm_a, "B_slot0": arm_b["slot0"],
                    "B_slot1": arm_b["slot1"], "A2": arm_a2}
            require_rates(recs)
            require_engine_lines(f"attempt {i} arm A", arm_a["engine_lines"])
            require_engine_lines(f"attempt {i} arm A2", arm_a2["engine_lines"])
            require_engine_lines(f"attempt {i} arm B", arm_b["engine_lines"])
            require_engine_lines(f"attempt {i} arm B slot 0",
                                 arm_b["engine_lines_slot0"])
            require_engine_lines(f"attempt {i} arm B slot 1",
                                 arm_b["engine_lines_slot1"])

            a_pps = arm_a["predicted_per_second"]
            a2_pps = arm_a2["predicted_per_second"]
            a2_over_a = r(a2_pps, a_pps)
            ok = a2_over_a is not None and abs(a2_over_a - 1.0) <= args.bracket_tol
            attempts.append({"index": i, "A_solo_slot0": arm_a,
                             "B_two_slots": arm_b, "A2_solo_repeat": arm_a2,
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

        full_log = server.lines()
        leak = [l for l in full_log if SENTINEL in l]
        if leak:
            raise SystemExit(
                f"REFUSING TO WRITE: the engine log carries prompt text ({len(leak)} lines)")

        arm_a = accepted["A_solo_slot0"]
        arm_b = accepted["B_two_slots"]
        arm_a2 = accepted["A2_solo_repeat"]
        a_pps = arm_a["predicted_per_second"]
        b0_pps = arm_b["slot0"]["predicted_per_second"]
        b1_pps = arm_b["slot1"]["predicted_per_second"]
        a2_pps = arm_a2["predicted_per_second"]
        cache_ns = {"A": arm_a["cache_n"], "B_slot0": arm_b["slot0"]["cache_n"],
                    "B_slot1": arm_b["slot1"]["cache_n"], "A2": arm_a2["cache_n"]}

        result = {
            "measurement": "concurrency-cost",
            "question": ("what one device's decode rate costs when a second device "
                         "decodes at the same time, on one engine"),
            "provenance": {
                **run_parameters(args),
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
                "parallel": 2,
                "cache_ram": 0,
                "cache_type_k": "q8_0",
                "cache_type_v": "q8_0",
                "sleep_idle_seconds": SLEEP_IDLE_S,
                "sleep_idle_note": ("disabled on purpose: a model unload "
                                    "mid-run would contaminate every later arm; "
                                    "the app ships 300"),
                "engine_init_line": init_lines,
                "engine_kv_lines": kv_lines,
                "engine_swa_lines": swa_lines,
                "checkpoint_line": ctx_check,
                "n_predict": args.n_predict,
                "ignore_eos": True,
                "prompt_tokens": n_verify[0],
                "prompt_tokens_arm_b_slot1": n_verify[1],
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
                "B_two_slots": arm_b,
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
                "B_slot0": arm_b["slot0"]["predicted_n"],
                "B_slot1": arm_b["slot1"]["predicted_n"],
                "A2": arm_a2["predicted_n"],
            },
            "warm_prefix_in_play": warm_prefix_field(cache_ns),
            "ratios": {
                "per_stream_slot0_over_A": r(b0_pps, a_pps),
                "per_stream_slot1_over_A": r(b1_pps, a_pps),
                "aggregate_over_A": r(b0_pps + b1_pps, a_pps),
                "per_stream_slot0_over_A2": r(b0_pps, a2_pps),
                "A2_over_A": r(a2_pps, a_pps),
            },
            "tokens_per_second": {
                "A": a_pps, "B_slot0": b0_pps, "B_slot1": b1_pps, "A2": a2_pps,
                "B_aggregate": round(b0_pps + b1_pps, 2),
            },
        }
        result["provenance"]["loadavg_after"] = loadavg()
        result["provenance"]["finished_utc"] = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime())

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
        # Every exit path stops the engine: a run that dies half-way and leaves
        # it up poisons the next run's port pre-flight.
        if keep:
            print("[engine] left running (--keep-server)", flush=True)
        else:
            server.stop()
            print("[engine] stopped", flush=True)


if __name__ == "__main__":
    sys.exit(main())
