#!/usr/bin/env python3
"""After a real engine release, does a chat saved on disk come back warm, and
what does the round trip cost?

This is T4's last unproven acceptance criterion (`docs/PLAN-DISK-TIER.md`): *a
switch after an unload restores from disk instead of returning an empty
conversation*. Every other criterion has an artifact; this one had an argument.

The release is **observed, not assumed**. The engine prints two stderr lines
around it - `server is entering sleeping state` and `server is exiting
sleeping state`, the exact strings the supervisor watches
(`crates/kalsa-supervisor/src/child.rs:42-43`) - and the harness waits for the
first one with a deadline before it trusts the arm. `/health` keeps answering
200 while the model is gone, so a green health check proves nothing about
residency. If the release line never arrives, the arm is marked unmeasured and
the verdict says so; a silence is never read as a success.

Two arms per chat size (~600 and ~1900 tokens), one fresh engine each:

  saved:    cold send -> save to file -> a restore while the model is still
            resident (the baseline the reload will be subtracted from) ->
            wait for the REAL release -> restore (this request is what wakes the
            engine, so its wall time carries the model reload) -> the same chat
            sent again -> timings.
  control:  cold send -> wait for the real release -> the same chat sent again
            with NOTHING saved. It must come back cold; otherwise the warmth in
            the saved arm is not attributable to the file.

The salt rides every request here, slot actions included (`slot_action` in
`measure-slot-restore.py` carries it, and the door's own engine call does too).

Requests are inherited from `measure-slot-restore.py` via importlib, the same
way `measure-save-on-busy-slot.py` inherits them: one source for the shapes.
The RELEASE IDENTITY is inherited the same way: `measure-concurrency.py` is
loaded as a module (importlib - the name has a hyphen) and ITS
`derive_manifest_url` / `release_provenance` build the block. Never copied:
one implementation, and the file the concurrency artifact names by
`script_sha256` stays byte-identical. Where the block came from is recorded
as `release_derivation {script, sha256}`.

The launcher alone cannot identify the release. `kalsa-server` is
BYTE-IDENTICAL across v1.1.0 and v1.1.1 (exe_sha256
`327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` in BOTH
published manifests), so a `matched` on that hash would pass for a v1.1.0
tree too - the tree with no T1. So the block also carries the two things that
do separate the releases, and may not read `matched` without them: the
sha256 of `libllama-server-impl.dylib` beside the binary (the file the
launcher loads, where T1 lives: `714e8ba1...` in v1.1.1, `4b7d69fb...` in
v1.1.0) and the commit inside `--version` (`a7d2cec79` vs `2a290390d`)
compared with the manifest's `commit`. Disagreement downgrades the status to
`not-the-release` under its own `reason_code`; the launcher-only verdict
stays in `status_by_exe_sha256`, so the downgrade is visible and not silent.

`--max-load` (default 6.0) refuses to start BEFORE any engine is launched,
and `loadavg_before`/`loadavg_after` are recorded. The floor matters by
column: token counts and byte counts are contention-invariant, `prompt_ms`
and every wall are not - the disk-curve conclusion leans on the former and
labels the latter.

    nice-free by construction: the engine is launched under `nice -n 10`
    inside this script. Stdlib only.

    python3 dev/measure-unload-restore.py --out dev/results/unload-restore/results.json
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("msr", HERE / "measure-slot-restore.py")
msr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(msr)

# The derivation of the release block lives in measure-concurrency.py and is
# LOADED, not copied: two implementations of `matched` / `not-the-release` /
# `unverified` would be a divergence waiting six months, and editing that
# file would change the script_sha256 the concurrency artifact records (a
# fourth concurrency run to put it back in sync - not bought here).
MC_SCRIPT = HERE / "measure-concurrency.py"
_mc_spec = importlib.util.spec_from_file_location("mconc", MC_SCRIPT)
mc = importlib.util.module_from_spec(_mc_spec)
_mc_spec.loader.exec_module(mc)

DEFAULT_BIN = "/Users/marco/Projects/kalsallama/build/bin/llama-server"

# The module the launcher loads, beside it: the same name the runtime's inlet
# check spells (crates/kalsa-runtime/src/inlet.rs, ENGINE_MODULE_FILE).
ENGINE_MODULE_FILE = "libllama-server-impl.dylib"
NICE = 10

# GGUF value types, from the spec (v3 spells the type as uint32, which is the
# trap that made a first naive parse read the value length four bytes late).
GGUF_SCALAR = {0: ("B", 1), 1: ("b", 1), 2: ("H", 2), 3: ("h", 2), 4: ("I", 4),
               5: ("i", 4), 6: ("f", 4), 7: ("?", 1), 10: ("Q", 8),
               11: ("q", 8), 12: ("d", 8)}

# The two announcements, verbatim from crates/kalsa-supervisor/src/child.rs:42-43.
# A build that rewords either line stops being observable here, exactly as it
# stops being observable to the supervisor - that is a finding, not a fallback.
RELEASE_LINE = "server is entering sleeping state"
RELOAD_LINE = "server is exiting sleeping state"

SLEEP_IDLE_S = 30  # short, so the release lands inside the run; the app ships 300
RELEASE_DEADLINE_S = 120  # the idle clock restarts at the last task: 30 s + margin
RELOAD_DEADLINE_S = 180  # the engine's readiness budget is 600 s; this is a watch, not patience
RELEASE_SETTLE_S = 1.0  # the release line prints BEFORE destroy(); the model goes right after

# A conversation came back when the second send reads most of its prompt from the
# slot instead of re-evaluating it. Half the prompt is the line; cache_n and its
# fraction travel with the verdict so the line can be redrawn from the artifact.
WARM_FRACTION = 0.5


# ---------------------------------------------------------------- watched calls
def scan_line(server, needle, start_index):
    lines = server.lines()
    for i, ln in enumerate(lines[start_index:], start=start_index):
        if needle in ln:
            return {"observed": True, "line_index": i, "line": ln.strip()[:200]}
    return None


def wait_for_release(server, start_index, deadline_s):
    """Block until the engine announces the release. No request is in flight."""
    t0 = time.perf_counter()
    while True:
        hit = scan_line(server, RELEASE_LINE, start_index)
        now = time.perf_counter()
        if hit:
            hit["waited_s"] = round(now - t0, 2)
            return hit
        if now - t0 > deadline_s:
            return {"observed": False, "waited_s": round(now - t0, 2),
                    "deadline_s": deadline_s}
        time.sleep(0.25)


def call_watching_line(fn, server, needle, start_index, deadline_s):
    """Run fn() while polling the log for needle; report when the line lands.

    The line's own clock starts at the request, not at the poll: the engine
    prints the reload line BEFORE load_model(), so the gap between them is what
    separates "the model is coming back" from "the model is back".
    """
    box = {}
    ready = threading.Event()

    def target():
        box["start"] = time.perf_counter()
        ready.set()
        try:
            box["result"] = fn()
        except Exception as e:  # a failed exchange is a datum for the verdict
            box["error"] = f"{type(e).__name__}: {e}"[:200]

    th = threading.Thread(target=target)
    th.start()
    ready.wait(timeout=10)
    base = box["start"]
    watch = {"observed": False}
    while True:
        hit = scan_line(server, needle, start_index)
        if hit:
            hit["ms_after_start"] = round((time.perf_counter() - base) * 1000, 1)
            watch = hit
            break
        elapsed = time.perf_counter() - base
        if elapsed > deadline_s or not th.is_alive():
            watch = {"observed": False, "waited_ms": round(elapsed * 1000, 1),
                     "deadline_s": deadline_s}
            break
        time.sleep(0.05)
    th.join()
    return box.get("result"), box.get("error"), watch


# ------------------------------------------------------------------- extraction
def action_figures(action):
    b = action.get("body") if isinstance(action.get("body"), dict) else {}
    tim = b.get("timings") or {}
    return {"status": action.get("status"), "wall_ms": action.get("wall_ms"),
            "n_saved": b.get("n_saved"), "n_written": b.get("n_written"),
            "n_restored": b.get("n_restored"), "n_read": b.get("n_read"),
            "n_erased": b.get("n_erased"), "save_ms": tim.get("save_ms"),
            "restore_ms": tim.get("restore_ms")}


def is_warm(cache_n, chat_tokens):
    if cache_n is None or not chat_tokens:
        return None
    return cache_n >= WARM_FRACTION * chat_tokens


# ------------------------------------------------------------------------ arms
def arm_saved(server, port, chat, chat_tokens, tag, slots_dir, n_predict, blockers):
    out = {"arm": "saved", "chat_tokens": chat_tokens,
           "save_filename": f"{tag}.bin"}
    out["erase"] = action_figures(msr.slot_action(port, 0, "erase", None, msr.SALT_HEX))
    if out["erase"]["status"] != 200:
        # An erase that did not land means the restore below reads whatever
        # the slot still held: the warmth would be credited to the file and
        # measured from residue. save and restore are asserted already; erase
        # is what makes their assertion mean something.
        blockers.append(f"erase refused ({out['erase']['status']}): the slot was not "
                        "emptied, so the restore measures residue, not the file")
    out["cold_send"] = msr.send(port, chat, msr.SALT_HEX, n_predict, 0, server)

    save_act = msr.slot_action(port, 0, "save", f"{tag}.bin", msr.SALT_HEX)
    f = Path(slots_dir) / f"{tag}.bin"
    out["save"] = {**action_figures(save_act),
                   "file_bytes": f.stat().st_size if f.exists() else None}
    if out["save"]["status"] != 200 or not f.exists():
        blockers.append(f"save did not produce a file (status {out['save']['status']})")

    # Baseline: the same restore with the model still resident. The restore
    # after the release will be compared against this to split the model reload
    # out of its wall time - the plan's "restore PLUS a model load".
    resident = msr.slot_action(port, 0, "restore", f"{tag}.bin", msr.SALT_HEX)
    out["restore_with_model_resident"] = action_figures(resident)

    rel = wait_for_release(server, len(server.lines()), RELEASE_DEADLINE_S)
    out["release"] = {**rel, "deadline_s": RELEASE_DEADLINE_S}
    if not rel.get("observed"):
        blockers.append(f"release line never arrived within {RELEASE_DEADLINE_S}s")
    else:
        time.sleep(RELEASE_SETTLE_S)

    idx = len(server.lines())
    restore, err, reload_watch = call_watching_line(
        lambda: msr.slot_action(port, 0, "restore", f"{tag}.bin", msr.SALT_HEX),
        server, RELOAD_LINE, idx, RELOAD_DEADLINE_S)
    if err:
        out["restore_after_release"] = {"error": err}
        blockers.append(f"restore after release failed: {err}")
    else:
        out["restore_after_release"] = action_figures(restore)
        if restore.get("status") != 200:
            blockers.append(f"restore after release answered {restore.get('status')}")
    out["model_reload"] = {**reload_watch,
                           "triggered_by": "restore" if reload_watch.get("observed") else None}
    if not reload_watch.get("observed"):
        blockers.append("reload line never arrived during the restore")

    idx2 = len(server.lines())
    second, err2, w2 = call_watching_line(
        lambda: msr.send(port, chat, msr.SALT_HEX, n_predict, 0, server),
        server, RELOAD_LINE, idx2, RELOAD_DEADLINE_S)
    if err2:
        out["second_send"] = {"error": err2}
        blockers.append(f"second send failed: {err2}")
    else:
        out["second_send"] = second
        if second.get("status") != 200:
            blockers.append(f"second send answered {second.get('status')}")
    if not out["model_reload"].get("observed") and w2.get("observed"):
        out["model_reload"] = {**w2, "triggered_by": "completion"}
        # it arrived late relative to the restore; the restore wall then did NOT
        # carry the reload, and the split below is not available
        blockers.append("reload was triggered by the completion, not the restore")

    out["derived"] = derive_saved(out, chat_tokens, blockers)
    out["measured"] = not blockers
    return out


def derive_saved(out, chat_tokens, blockers):
    d = {"release_observed": bool((out.get("release") or {}).get("observed")),
         "release_waited_s": (out.get("release") or {}).get("waited_s"),
         "reload_observed": bool((out.get("model_reload") or {}).get("observed")),
         "reload_triggered_by": (out.get("model_reload") or {}).get("triggered_by"),
         "n_saved": (out.get("save") or {}).get("n_saved"),
         "file_bytes": (out.get("save") or {}).get("file_bytes"),
         "n_restored": (out.get("restore_after_release") or {}).get("n_restored"),
         "n_read": (out.get("restore_after_release") or {}).get("n_read"),
         "restore_wall_ms": (out.get("restore_after_release") or {}).get("wall_ms"),
         "resident_restore_wall_ms":
             (out.get("restore_with_model_resident") or {}).get("wall_ms"),
         "warm": None}
    second = out.get("second_send") or {}
    d["second_send"] = {k: second.get(k) for k in
                        ("cache_n", "prompt_n", "prompt_ms", "predicted_n", "wall_ms")}
    d["cache_n"] = second.get("cache_n")
    d["reused_fraction"] = (round(second["cache_n"] / chat_tokens, 3)
                            if second.get("cache_n") is not None and chat_tokens else None)
    rl = out.get("model_reload") or {}
    d["reload_announced_ms_after_restore_start"] = rl.get("ms_after_start")
    rw, resid = d["restore_wall_ms"], d["resident_restore_wall_ms"]
    if rw is not None and resid is not None:
        d["restore_wall_minus_resident_ms"] = round(rw - resid, 1)
    if rw is not None and resid is not None and rl.get("ms_after_start") is not None:
        # the line prints before load_model(): everything after it is load +
        # restore; minus the resident restore, it is the model reload
        d["model_reload_ms_estimate"] = round(rw - rl["ms_after_start"] - resid, 1)
    if not blockers:
        d["warm"] = is_warm(second.get("cache_n"), chat_tokens)
    return d


def arm_control(server, port, chat, chat_tokens, n_predict, blockers):
    out = {"arm": "control", "chat_tokens": chat_tokens, "file_saved": False}
    out["erase"] = action_figures(msr.slot_action(port, 0, "erase", None, msr.SALT_HEX))
    if out["erase"]["status"] != 200:
        # Same as the saved arm: without a landed erase the control's second
        # send could read residue and come back "warm" with nothing saved.
        blockers.append(f"erase refused ({out['erase']['status']}): the control's slot "
                        "was not emptied, so a warm answer would be residue")
    out["cold_send"] = msr.send(port, chat, msr.SALT_HEX, n_predict, 0, server)

    rel = wait_for_release(server, len(server.lines()), RELEASE_DEADLINE_S)
    out["release"] = {**rel, "deadline_s": RELEASE_DEADLINE_S}
    if not rel.get("observed"):
        blockers.append(f"release line never arrived within {RELEASE_DEADLINE_S}s")
    else:
        time.sleep(RELEASE_SETTLE_S)

    idx = len(server.lines())
    second, err, w = call_watching_line(
        lambda: msr.send(port, chat, msr.SALT_HEX, n_predict, 0, server),
        server, RELOAD_LINE, idx, RELOAD_DEADLINE_S)
    if err:
        out["second_send"] = {"error": err}
        blockers.append(f"second send failed: {err}")
    else:
        out["second_send"] = second
        if second.get("status") != 200:
            blockers.append(f"second send answered {second.get('status')}")
    out["model_reload"] = {**w, "triggered_by": "completion" if w.get("observed") else None}
    if not w.get("observed"):
        blockers.append("reload line never arrived during the second send")

    d = {"release_observed": bool(rel.get("observed")),
         "release_waited_s": rel.get("waited_s"),
         "reload_observed": bool(w.get("observed")),
         "reload_triggered_by": out["model_reload"]["triggered_by"],
         "reload_announced_ms_after_send_start": w.get("ms_after_start"),
         "warm": None}
    second = out.get("second_send") or {}
    d["second_send"] = {k: second.get(k) for k in
                        ("cache_n", "prompt_n", "prompt_ms", "predicted_n", "wall_ms")}
    d["cache_n"] = second.get("cache_n")
    d["reused_fraction"] = (round(second["cache_n"] / chat_tokens, 3)
                            if second.get("cache_n") is not None and chat_tokens else None)
    if not blockers:
        d["warm"] = is_warm(second.get("cache_n"), chat_tokens)
        d["cold"] = d["warm"] is False
    else:
        d["cold"] = None
    out["derived"] = d
    out["measured"] = not blockers
    return out


# --------------------------------------------------------------------- verdict
def aggregate(flags):
    if any(f is None for f in flags):
        return None
    return all(flags)


def build_conclusion(per_size):
    parts, blockers = [], []
    for size in sorted(per_size):
        s = per_size[size].get("saved") or {}
        c = per_size[size].get("control") or {}
        sd, cd = s.get("derived") or {}, c.get("derived") or {}
        parts.append(f"{size} tokens: saved cache_n={sd.get('cache_n')}/{size} "
                     f"n_restored={sd.get('n_restored')} restore={sd.get('restore_wall_ms')}ms "
                     f"(resident {sd.get('resident_restore_wall_ms')}ms, reload est. "
                     f"{sd.get('model_reload_ms_estimate')}ms), "
                     f"control cache_n={cd.get('cache_n')}/{size}")
        for arm, rec in (("saved", s), ("control", c)):
            if not rec.get("measured"):
                why = rec.get("blockers") or ["unmeasured"]
                blockers.append(f"{size}/{arm} ({'; '.join(why)})")
    nums = "; ".join(parts)
    if blockers:
        return ("no verdict: at least one arm never showed the event it exists to "
                "measure - " + " | ".join(blockers) + f". Numbers as measured: {nums}")
    warm = aggregate([(per_size[s]["saved"]["derived"]["warm"]) for s in per_size])
    cold = aggregate([(per_size[s]["control"]["derived"]["cold"]) for s in per_size])
    if warm and cold:
        return ("after a real release the saved chats came back warm and the no-file "
                f"controls stayed cold, so the warmth travelled with the file. Numbers: {nums}")
    if warm and not cold:
        return ("the saved chats came back warm, but the controls that saved no file "
                f"were warm as well, so this run cannot credit the file. Numbers: {nums}")
    if (not warm) and cold:
        return ("the no-file controls stayed cold, and the saved chats did NOT come "
                f"back warm after the release. Numbers: {nums}")
    return (f"neither the saved chats nor the controls came back warm. Numbers: {nums}")


# ---------------------------------------------------- release identity block
def arm_extra(slots_dir):
    """The flags every arm gets, in one place: the provenance is parsed back
    out of the argv built from this list, never typed beside it."""
    return ["--slot-save-path", str(slots_dir), "--ctx-checkpoints", "1",
            "--cache-ram", "0", "--sleep-idle-seconds", str(SLEEP_IDLE_S)]


def flags_from_argv(argv):
    """The provenance facts, read out of the argv the arms really receive.

    `parallel`, `cache_ram`, `ctx_checkpoints`, `swa_full`, `engine_nice` and
    `ctx_size` used to be hand-written in the provenance block and hand-built
    into the argv: two copies of one truth that can drift apart silently.
    Here they are read back from the argv (and main refuses to run if what it
    reads is not what it meant to record).
    """
    def val(flag):
        return argv[argv.index(flag) + 1]
    return {
        "engine_nice": int(argv[2]) if argv[:2] == ["nice", "-n"] else None,
        "parallel": int(val("--parallel")),
        "cache_ram": int(val("--cache-ram")),
        "ctx_checkpoints": int(val("--ctx-checkpoints")),
        "swa_full": "--swa-full" in argv,
        "sleep_idle_seconds": int(val("--sleep-idle-seconds")),
        "ctx_size": int(val("--ctx-size")),
    }


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
    manifest matched and any of those fails; None when there is no manifest
    commit to compare against (status not `matched`).
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
        "module_sha256": msr.sha256_file(module) if has_module else None,
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


def release_block(bin_path, version_text):
    """The inherited launcher verdict, plus the identity that may veto it.

    The derivation (URL from the directory, match on exe_sha256, three
    statuses) is `measure-concurrency.py`'s, loaded as a module; what is added
    here is only the veto: a `matched` the module/commit cannot back becomes
    `not-the-release` under its own reason_code, with the launcher-only
    verdict preserved as `status_by_exe_sha256`.
    """
    url = mc.derive_manifest_url(bin_path)
    block = mc.release_provenance(url, msr.sha256_file(bin_path))
    block["status_by_exe_sha256"] = block["status"]
    ident = engine_identity(bin_path, version_text, block)
    block["identity"] = ident
    if block["status"] == "matched" and ident["ok"] is not True:
        if ident["module_sha256"] is None:
            code = "engine-module-missing"
            why = f"no {ENGINE_MODULE_FILE} beside the binary"
        elif ident["commit_agrees"] is not True:
            code = "engine-commit-mismatch"
            why = (f"--version says commit {ident['version_commit']!r}, the "
                   f"manifest says {ident['manifest_commit']!r}")
        else:
            code = "engine-identity-incomplete"
            why = "the identity could not be completed"
        block["status"] = "not-the-release"
        block["label"] = mc.FORK_LABEL
        block["reason_code"] = code
        block["reason"] = ("the launcher hash matched but the tree did not: " + why
                           + " - by launcher hash alone this build would have "
                             "called itself the release")
    return block


def release_qualification(block):
    """ONE sentence per run, generated here: the artifact's first field, and
    the start of `conclusion` whenever the run is not the delivered release.
    One generator, so the two places cannot drift."""
    ident = block.get("identity") or {}
    st = block.get("status")
    if st == "matched":
        return (f"MATCHED: measured on the delivered release {block.get('tag')} "
                f"({block.get('platform')}/{block.get('backend')}), engine module "
                f"{str(ident.get('module_sha256'))[:16]}..., version commit "
                f"{ident.get('version_commit')}")
    if st == "not-the-release":
        return ("NOT THE RELEASE BUILD: "
                f"{block.get('label', mc.FORK_LABEL)} "
                f"(reason_code {block.get('reason_code')}) - this run measured "
                "something that resembles the release, not the delivered artifact")
    return (f"RELEASE NOT VERIFIED (reason_code {block.get('reason_code')}) - this "
            "run cannot claim the delivered artifact, and does not")


def gguf_header_facts(path, extra_keys=(), with_offsets=False):
    """Read scalars out of the model's own GGUF header - no engine started.

    The trained context and the sliding window are properties of the MODEL,
    so they are read from the model file (the ceiling, the bend's explanation
    and the disk law's window come from here, not from a typed constant).
    Arrays are read and discarded: this model's header parses in milliseconds
    and only the scalar facts are wanted. `with_offsets` also returns where
    each value lives in the file - what lets a mutation patch a COPY of the
    header instead of the model.
    """
    scalars = {}
    offsets = {}
    try:
        with open(path, "rb") as f:
            if f.read(4) != b"GGUF":
                return {"error": "not a GGUF file"}
            version = struct.unpack("<I", f.read(4))[0]
            n_tensors = struct.unpack("<Q", f.read(8))[0]
            n_kv = struct.unpack("<Q", f.read(8))[0]

            def rd_str():
                n = struct.unpack("<Q", f.read(8))[0]
                if n > 10_000_000:
                    raise ValueError("implausible string length")
                return f.read(n).decode("utf-8", "replace")

            def rd_value(t):
                if t == 8:
                    return rd_str()
                if t == 9:
                    et = struct.unpack("<I", f.read(4))[0]
                    n = struct.unpack("<Q", f.read(8))[0]
                    if et == 8:
                        for _ in range(n):
                            rd_str()
                        return None
                    _, size = GGUF_SCALAR[et]
                    f.seek(size * n, 1)
                    return None
                fmt, size = GGUF_SCALAR[t]
                return struct.unpack("<" + fmt, f.read(size))[0]

            for _ in range(n_kv):
                key = rd_str()
                t = struct.unpack("<I", f.read(4))[0]
                offsets[key] = {"value_offset": f.tell(), "type": t}
                value = rd_value(t)
                if isinstance(value, (int, float, bool)) or (
                        isinstance(value, str) and len(value) < 120):
                    scalars[key] = value
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
    arch = scalars.get("general.architecture")
    keys = list(extra_keys)
    if arch:
        keys += [f"{arch}.context_length", f"{arch}.block_count",
                 f"{arch}.attention.head_count_kv", f"{arch}.attention.key_length",
                 f"{arch}.attention.value_length", f"{arch}.attention.sliding_window"]
    facts = {k: scalars[k] for k in keys if k in scalars}
    facts["gguf_version"] = version
    facts["n_tensors"] = n_tensors
    facts["source"] = "the model file's own header, read without starting an engine"
    if with_offsets:
        facts["value_offsets"] = offsets
    return facts


def header_kv_arithmetic(model_facts):
    """q8_0 full-KV bytes per token, computed from the header's own numbers:
    blocks x kv-heads x (key+value) elements x 34/32 B (a q8_0 block is 32
    payload bytes + a 2-byte fp16 scale). None when the header lacks a field."""
    arch = model_facts.get("general.architecture")
    try:
        blocks = int(model_facts[f"{arch}.block_count"])
        heads = int(model_facts[f"{arch}.attention.head_count_kv"])
        key = int(model_facts[f"{arch}.attention.key_length"])
        val = int(model_facts[f"{arch}.attention.value_length"])
    except (KeyError, TypeError, ValueError):
        return None, None
    per_layer = heads * (key + val) * 34 / 32      # B per token per layer (K+V)
    return round(blocks * per_layer), round(per_layer)


def window_from_facts(model_facts):
    arch = model_facts.get("general.architecture")
    try:
        return int(model_facts[f"{arch}.attention.sliding_window"])
    except (KeyError, TypeError, ValueError):
        return WINDOW_TOKENS


def kv_layout(kv_lines, swa_lines):
    """Cells and layers per cache, out of the engine's own boot lines - the
    log side of the disk curve's arithmetic."""
    cells_by_kind = {}
    for line in swa_lines or []:
        m = re.search(r"creating\s+(non-SWA|SWA) KV cache, size = (\d+) cells", line)
        if m:
            cells_by_kind[m.group(1)] = int(m.group(2))
    layout = {}
    for line in kv_lines or []:
        m = re.search(r"size =\s*[\d.]+ MiB \(\s*(\d+) cells,\s*(\d+) layers", line)
        if not m:
            continue
        cells, layers = int(m.group(1)), int(m.group(2))
        kind = next((k for k, v in cells_by_kind.items() if v == cells), "unknown")
        layout[kind] = {"cells": cells, "layers": layers, "line": line.strip()}
    return layout


# ---------------------------------------------------------------- disk curve
# Declared sources for the comparisons the disk-curve conclusion makes - all
# of them committed artifacts or the GGUF header, none of them invented here:
#   BASE_BYTES_PER_TOKEN  53_352 = (101_493_292 - 32_135_692) / 1300, the
#       600->1900 slope in dev/results/slot-restore-swa (swa_full_off); the
#       fork-build unload-restore artifact gives the SAME slope
#       (101_737_228 - 32_379_628) / 1300 = 53_352 at a different ctx_size.
#   SWA_FULL_BYTES_PER_TOKEN 30_492 = (58_149_648 - 18_510_048) / 1300, the
#       --swa-full arm of the same artifact.
#   Q8_KV_BYTES_PER_TOKEN  30_464 = 56 blocks x (2 kv heads x 128 x 2 [K+V])
#       elements x 1.0625 B (q8_0), from the model's own GGUF header
#       (afmoe.block_count 56, head_count_kv 2, key/value_length 128), read
#       without starting an engine. The --swa-full slope is this within 0.1 %.
#   WINDOW_TOKENS 2048 = afmoe.attention.sliding_window, same header.
BASE_BYTES_PER_TOKEN = 53_352
SWA_FULL_BYTES_PER_TOKEN = 30_492
Q8_KV_BYTES_PER_TOKEN = 30_464
WINDOW_TOKENS = 2048
PLAN_4096_DERIVED_BYTES = 218_000_000   # ~218 MB, PLAN-DISK-TIER.md:522's derivation


def disk_curve(per_size):
    """The disk numbers per size: bytes (contention-invariant) first, the
    millisecond columns beside them and labelled as this machine's."""
    rows = {}
    for size in sorted(per_size):
        s = per_size[size].get("saved") or {}
        c = per_size[size].get("control") or {}
        sd, cd = s.get("derived") or {}, c.get("derived") or {}
        fb, ct = sd.get("file_bytes"), s.get("chat_tokens")
        bpt = round(fb / ct) if fb and ct else None
        warm = (sd.get("second_send") or {}).get("prompt_ms")
        re_prefill = (cd.get("second_send") or {}).get("prompt_ms")
        rows[str(size)] = {
            "chat_tokens": ct,
            "file_bytes": fb,
            "bytes_per_token": bpt,
            "excess_over_q8_kv_bytes_per_token": (bpt - Q8_KV_BYTES_PER_TOKEN)
            if bpt is not None else None,
            "cold_prompt_ms": (s.get("cold_send") or {}).get("prompt_ms"),
            "warm_second_prompt_ms": warm,
            "control_reprefill_prompt_ms": re_prefill,
            "prefill_ms_avoided": (round(re_prefill - warm, 1)
                                   if re_prefill is not None and warm is not None
                                   else None),
            "resident_restore_wall_ms": sd.get("resident_restore_wall_ms"),
            "restore_wall_carries_reload_ms": sd.get("restore_wall_ms"),
            "tokens_reused_saved": sd.get("cache_n"),
            "tokens_reused_control": cd.get("cache_n"),
        }
    sizes = sorted(int(k) for k in rows)
    for a, b in zip(sizes, sizes[1:]):
        ra, rb = rows[str(a)], rows[str(b)]
        if ra.get("file_bytes") and rb.get("file_bytes") \
                and ra.get("chat_tokens") != rb.get("chat_tokens"):
            rb["marginal_bytes_per_token"] = round(
                (rb["file_bytes"] - ra["file_bytes"])
                / (rb["chat_tokens"] - ra["chat_tokens"]))
            rb["marginal_from"] = a
        if ra.get("prefill_ms_avoided") and rb.get("prefill_ms_avoided") \
                and ra["chat_tokens"] and rb["chat_tokens"]:
            rb["prefill_ms_avoided_per_token_from_prev"] = round(
                (rb["prefill_ms_avoided"] - ra["prefill_ms_avoided"])
                / (rb["chat_tokens"] - ra["chat_tokens"]), 3)
    return rows


def disk_curve_sentence(rows, model_facts=None, kv_lines=None, swa_lines=None):
    """The citable sentences: (a) bytes/token and where the curve bends,
    (b) the benefit per size with its millisecond half labelled as this
    machine's, (c) the verdict on the plan's 4096 derivation, (d) the excess
    over the header's full-KV arithmetic - attributed only if the numbers fit,
    otherwise declared unexplained."""
    model_facts = model_facts or {}
    sizes = sorted(int(k) for k in rows)
    bpts = {s: rows[str(s)].get("bytes_per_token") for s in sizes}
    have = {s: v for s, v in bpts.items() if v is not None}
    if not have:
        return "no file was written, so there is no curve"
    q8bpt, per_layer_bpt = header_kv_arithmetic(model_facts)
    q8bpt = q8bpt or Q8_KV_BYTES_PER_TOKEN
    window = window_from_facts(model_facts)

    a_bits = []
    for s in sizes:
        r = rows[str(s)]
        bit = f"{s} tokens -> {r['file_bytes']} B = {r['bytes_per_token']} B/token"
        if r.get("marginal_bytes_per_token") is not None:
            bit += (f" (marginal {r['marginal_from']}->{s}: "
                    f"{r['marginal_bytes_per_token']} B/token)")
        a_bits.append(bit)
    a_clause = "(a) bytes/token: " + "; ".join(a_bits)
    a_clause += f"; the 600->1900 base was {BASE_BYTES_PER_TOKEN} B/token, "
    a_clause += f"the q8_0 full-KV arithmetic from the model's own GGUF header is {q8bpt} B/token"

    vals = [have[s] for s in sorted(have)]
    spread = (max(vals) - min(vals)) / max(vals) if len(vals) > 1 else 0.0
    marginals = [(rows[str(s)]["marginal_from"], s, rows[str(s)]["marginal_bytes_per_token"])
                 for s in sizes if rows[str(s)].get("marginal_bytes_per_token") is not None]
    bend = None
    for prev, cur, marg in marginals:
        if have.get(prev) and marg < 0.90 * have[prev]:
            bend = (prev, cur, marg, have[prev])
            break
    if bend:
        prev, cur, marg, before = bend
        a_clause += (f". THE CURVE BENDS between {prev} and {cur}: the marginal drops to "
                     f"{marg} B/token, {round(100 * (marg / before - 1), 1)} % below the "
                     f"{prev}-token average - consistent with the {window}-token sliding "
                     "window the model's own GGUF header declares capping the windowed "
                     "layers there")
    elif spread <= 0.05:
        a_clause += (f". THE CURVE DOES NOT BEND in this range: every size is within "
                     f"{round(100 * spread, 1)} % of every other and the marginals hold")
        if max(have) < window:
            a_clause += (f" - but every size measured here is BELOW the declared "
                         f"{window}-token window, so this range cannot show the bend "
                         f"either way; the artifact that measures past {window} settles it")
        else:
            a_clause += (f", linear across the {window}-token window: the window does not "
                         "cap what the file stores, and the plan's per-token figure extends")
    else:
        a_clause += (f". THE CURVE MOVES across this range: {round(100 * spread, 1)} % "
                     "spread between sizes - read the marginals above")
    smallest = min(have)
    if have[smallest] < 0.85 * BASE_BYTES_PER_TOKEN:
        a_clause += (f". THE BEND IS BELOW THE SMALLEST SIZE MEASURED HERE: at "
                     f"{smallest} tokens the average is already {have[smallest]} B/token, "
                     f"{round(100 * (have[smallest] / BASE_BYTES_PER_TOKEN - 1), 1)} % under "
                     f"the {BASE_BYTES_PER_TOKEN} B/token base measured at 600->1900 tokens, "
                     f"so the {window}-token window was crossed between 1900 and "
                     f"{smallest} tokens - the marginals above are what remains after it")

    b_bits = []
    for s in sizes:
        r = rows[str(s)]
        if r.get("prefill_ms_avoided") is None:
            continue
        b_bits.append(f"{s} tokens: {r['control_reprefill_prompt_ms']} ms cold re-prefill "
                      f"vs {r['warm_second_prompt_ms']} ms warm -> {r['prefill_ms_avoided']} ms "
                      f"avoided, {r['tokens_reused_saved']}/{r['chat_tokens']} tokens reused")
    b_clause = "(b) benefit per size: " + ("; ".join(b_bits) if b_bits else "not available")
    if b_bits:
        b_clause += (" - the MILLISECOND half is this machine at this load "
                     "(contention-dependent, not a promise); the invariant half is the "
                     "token count and the byte counts above")
        first, last = sizes[0], sizes[-1]
        r0, rl = rows[str(first)], rows[str(last)]
        if r0.get("prefill_ms_avoided") and rl.get("prefill_ms_avoided") \
                and r0["chat_tokens"] and rl["chat_tokens"]:
            rate0 = r0["prefill_ms_avoided"] / r0["chat_tokens"]
            rateL = rl["prefill_ms_avoided"] / rl["chat_tokens"]
            ratio = rateL / rate0 if rate0 else None
            if ratio is not None:
                if abs(ratio - 1) <= 0.25:
                    word = "about LINEARLY"
                elif ratio > 1:
                    word = "FASTER than"
                else:
                    word = "SLOWER than"
                b_clause += (f"; the benefit grows {word} with the token count "
                             f"({round(rate0, 3)} -> {round(rateL, 3)} ms avoided per token, "
                             f"{first} -> {last} tokens)")

    if "4096" in {str(s) for s in sizes} and rows["4096"].get("file_bytes"):
        measured = rows["4096"]["file_bytes"]
        delta = round(100 * (measured / PLAN_4096_DERIVED_BYTES - 1), 1)
        verdict_word = "CONFIRMED" if abs(delta) <= 10 else "MUST BE CORRECTED"
        c_clause = (f"(c) the plan derives ~{PLAN_4096_DERIVED_BYTES // 1_000_000} MB per "
                    f"4096-token chat (~53 KB/token x 4096): {verdict_word} - measured "
                    f"{measured} B ({round(measured / 1_000_000, 1)} MB, {delta:+.1f} % "
                    f"against the derivation); the citable figure is "
                    f"{round(measured / 1_000_000, 1)} MB")
    else:
        c_clause = (f"(c) this artifact does not reach 4096 tokens (sizes: "
                    f"{', '.join(str(s) for s in sizes)}), so the plan's ~218 MB at 4096 "
                    "is NOT settled here - it is settled by the artifact that measures 4096")

    # (d) the excess over the header arithmetic: attributed only if a real
    # decomposition fits the numbers; otherwise it says so, loudly.
    d_clause = None
    layout = kv_layout(kv_lines, swa_lines)
    swa_layers = (layout.get("SWA") or {}).get("layers")
    d_size = max(have)
    excess = have[d_size] - q8bpt
    if excess is None:
        d_clause = (f"(d) the excess over the header's full-KV arithmetic at {d_size} "
                    "tokens could not be computed (no file_bytes)")
    elif excess <= 0:
        d_clause = (f"(d) at {d_size} tokens there is NO excess: the file sits "
                    f"{abs(excess)} B/token BELOW the header's full-KV arithmetic, which is "
                    f"what the {window}-token window capping the windowed layers does to a "
                    "file. The positive excess exists only BELOW the window; it is measured "
                    "and attributed in the companion 600/1900-token artifact "
                    "(dev/results/unload-restore-release), not re-derived from this one")
    elif swa_layers and per_layer_bpt:
        second_copy = round(swa_layers * per_layer_bpt)
        fit = round(100 * (excess / second_copy - 1), 1) if second_copy else None
        if fit is None or abs(fit) > 25:
            d_clause = (f"(d) the file carries {excess} B/token MORE than the header's "
                        f"full-KV arithmetic at {d_size} tokens, and the windowed-copy "
                        f"decomposition ({swa_layers} x {round(per_layer_bpt)} = "
                        f"{second_copy} B/token, {fit:+.1f} %) does NOT fit within 25 % - "
                        "the excess is DECLARED UNEXPLAINED rather than attributed")
        else:
            d_clause = (f"(d) the file carries {excess} B/token MORE than the header's full-KV "
                        f"arithmetic at {d_size} tokens; the boot line "
                        f"'{(layout.get('SWA') or {}).get('line', '')[:80]}' gives "
                        f"{swa_layers} windowed layers, and {swa_layers} x {round(per_layer_bpt)} "
                        f"B/layer/token = {second_copy} B/token ({fit:+.1f} % against the excess) "
                        "- the excess fits ONE extra copy of the windowed layers' q8_0 KV per "
                        "token, and the --swa-full arm of dev/results/slot-restore-swa measures "
                        f"{SWA_FULL_BYTES_PER_TOKEN} B/token, i.e. no excess at all. WHAT IS NOT "
                        "SHOWN: no log line and no save field names that second copy, so the "
                        "MECHANISM is an attribution by arithmetic and by that control run, "
                        "not an observation")
    else:
        d_clause = (f"(d) the file carries {excess} B/token MORE than the header's full-KV "
                    "arithmetic and the boot lines do not split the caches, so the excess "
                    "is DECLARED UNEXPLAINED rather than attributed")
    return ". ".join([a_clause, b_clause, c_clause, d_clause]) + "."


# ------------------------------------------------------------------------ main
# ---------------------------------------------------------- chat fixture
def make_chat_at(port, seed, target, floor_words=16000):
    """An exact-token chat of ANY size the engine can hold, deterministic.

    The shared `measure-slot-restore.make_chat` builds a 16 001-word pool and
    stops working somewhere past ~8k tokens; the app's own default context is
    65 536 (crates/kalsa-launch/src/args.rs DEFAULT_CONTEXT_TOKENS), which is
    the size this artifact has to measure. Same contract as `make_chat`:
    seeded rng (the same seed builds the same text, run after run), a window
    that is detokenized and RE-TOKENIZED to exactly `target` tokens before it
    is returned, and `(content, target, sentinel)` with the sentinel = the
    text's first 80 chars - the artifact and the logs are checked against it.

    The pool GROWS until it holds the target: a fixed pool is a silent ceiling
    on the measurement, and a chat whose token count is not exact is not the
    size it claims to be - if no window start round-trips, the run stops.
    """
    import random
    rng = random.Random(seed)
    sentinel = f"zqxvsentinelchat{seed:04d}"
    need = max(floor_words, target)
    for _ in range(6):
        big = [sentinel] + [rng.choice(msr.WORDS) for _ in range(need)]
        ids = msr.tokenize(port, " ".join(big))
        if len(ids) >= target:
            for start in range(0, 256):
                window = ids[start:start + target]
                content = msr.detokenize(port, window)
                if len(msr.tokenize(port, content)) == target:
                    return content, target, content[:80], need
            raise SystemExit(
                f"the {target}-token window did not round-trip at any of 256 "
                "starts - refusing to measure a chat whose token count is not exact")
        need *= 2
    raise SystemExit(
        f"the chat pool ({need} words) still tokenizes below {target} tokens "
        "- refusing to fake the size")


def read_app_context_default():
    """The app's per-slot context, read from the source that declares it - the
    owner's number is about THAT context, so the context is read, not typed."""
    src = HERE.parent / "crates" / "kalsa-launch" / "src" / "args.rs"
    try:
        text = src.read_text()
    except OSError as e:
        return {"value": None, "source": str(src), "error": str(e)}
    m = re.search(r"DEFAULT_CONTEXT_TOKENS: u64 = ([\d_]+)", text)
    return {"value": int(m.group(1).replace("_", "")) if m else None,
            "source": str(src.relative_to(HERE.parent)),
            "line_text": m.group(0) if m else None}


def read_device_offers():
    """Which device counts the menu offers, read from the Offer initializers
    (n1/n2/n4 -> 1/2/4 devices)."""
    src = HERE.parent / "crates" / "kalsa-launch" / "src" / "policy" / "menu.rs"
    try:
        text = src.read_text()
    except OSError as e:
        return {"values": None, "source": str(src), "error": str(e)}
    found = sorted({int(n) for n in re.findall(r"\bn(\d+):\s*\(", text)})
    return {"values": found or None,
            "source": str(src.relative_to(HERE.parent))}


def disk_law(rows, model_facts, kv_lines, swa_lines):
    """THE LAW, predicted from the model's own geometry, checked against the
    measurement - per size, with the error in percent.

    Every input is READ, never typed: window and block/head/key/value come
    from the GGUF header, the full/windowed layer split comes from the
    engine's boot cache lines (kv_layout), and the per-layer cost is q8_0
    arithmetic (34 B per 32 elements = 1.0625 B/element).

      bytes = per_layer_bpt x (layer_full x tokens
                               + 2 x layer_windowed x min(tokens, window))

    The `2 x` is what the sizes below the window already showed: the windowed
    layers are stored twice while inside the window, once capped at `window`
    beyond it. This function does not TRUST that the window still caps at the
    app's real context: it computes the prediction, and the error is what
    says whether the law holds or has to be corrected.
    """
    _, per_layer = header_kv_arithmetic(model_facts)
    window = window_from_facts(model_facts)
    layout = kv_layout(kv_lines, swa_lines)
    full = (layout.get("non-SWA") or {}).get("layers")
    windowed = (layout.get("SWA") or {}).get("layers")
    arch = model_facts.get("general.architecture")
    blocks = model_facts.get(f"{arch}.block_count") if arch else None
    law = {
        "formula": ("bytes = per_layer_bpt x (layer_full x tokens + 2 x "
                    "layer_windowed x min(tokens, window))"),
        "per_layer_bpt": per_layer,
        "window_from_header": window,
        "layer_full_from_boot_line": full,
        "layer_windowed_from_boot_line": windowed,
        "blocks_from_header": blocks,
        "layers_add_up_to_blocks": (full + windowed == blocks)
        if (full and windowed and blocks) else None,
        "per_size": {},
    }
    if not (per_layer and full and windowed):
        law["available"] = False
        law["why_not"] = "the boot cache lines or the header fields are missing"
        return law
    law["available"] = True
    for size, row in rows.items():
        tokens, measured = row.get("chat_tokens"), row.get("file_bytes")
        if not tokens or not measured:
            continue
        predicted = per_layer * (full * tokens
                                 + 2 * windowed * min(tokens, window))
        law["per_size"][str(size)] = {
            "tokens": tokens,
            "measured_bytes": measured,
            "predicted_bytes": predicted,
            "error_pct": round((measured - predicted) / predicted * 100, 2),
        }
    return law


def law_clause(law):
    """(e) predicted vs measured vs error, per size, with a verdict."""
    if not law.get("available"):
        return ("(e) THE LAW COULD NOT BE EVALUATED: "
                f"{law.get('why_not')} - no prediction to compare")
    per_size = law["per_size"]
    if not per_size:
        return "(e) THE LAW COULD NOT BE EVALUATED: no size has a file to compare"
    bits = []
    for size in sorted(map(int, per_size)):
        e = per_size[str(size)]
        bits.append(f"{size}: predicted {e['predicted_bytes']} B vs measured "
                    f"{e['measured_bytes']} B ({e['error_pct']:+.2f} %)")
    worst = max(abs(e["error_pct"]) for e in per_size.values())
    verdict = (f"HOLDS within {round(worst, 2)} % at every size" if worst <= 5
               else f"IS WRONG AT THIS SIZE: worst error {round(worst, 2)} % "
                    "- the law must be corrected, not the measurement")
    return (f"(e) the law read from the model's own header - "
            f"{law['window_from_header']}-token window, "
            f"{law['layer_full_from_boot_line']} full + "
            f"{law['layer_windowed_from_boot_line']} windowed layers from the "
            f"boot lines, {law['per_layer_bpt']} B/layer/token, layers sum to "
            f"{law['blocks_from_header']} blocks "
            f"({law['layers_add_up_to_blocks']}): "
            + "; ".join(bits) + f" -> the law {verdict}")


def owner_clause(law, rows, app_ctx, offers):
    """(f) the number the owner asked for: bytes per saved chat at the app's
    default context, MEASURED when this artifact reaches that size, and the
    1/2/4-device consequence declared as arithmetic on it."""
    target = app_ctx.get("value")
    src = app_ctx.get("source")
    if not target:
        return ("(f) THE OWNER NUMBER IS UNAVAILABLE: the app's default context "
                f"could not be read from {src} - nothing derived without it")
    row = rows.get(str(target)) or {}
    offer_values = offers.get("values") or []
    offers_txt = ("/".join(str(v) for v in offer_values) + " devices"
                  if offer_values else "unknown offers")
    if row.get("file_bytes"):
        measured = row["file_bytes"]
        per = round(measured / 1_000_000, 1)
        multi = {d: round(d * measured / 1_000_000, 1) for d in (1, 2, 4)}
        return (f"(f) THE NUMBER FOR THE OWNER: one chat saved at the app's default "
                f"context ({target} tokens, read from {src}) costs MEASURED "
                f"{measured} bytes = {per} MB; BY ARITHMETIC ON THAT MEASUREMENT, "
                f"not measured as a group, the menu offers {offers_txt} (read from "
                f"{offers.get('source')}), so saved chats alone are "
                + ", ".join(f"{d} = {multi[d]} MB" for d in (1, 2, 4)))
    per_layer = law.get("per_layer_bpt")
    full = law.get("layer_full_from_boot_line")
    windowed = law.get("layer_windowed_from_boot_line")
    window = law.get("window_from_header")
    if law.get("available"):
        predicted = per_layer * (full * target + 2 * windowed * min(target, window))
        return (f"(f) THE OWNER NUMBER IS A DERIVATION IN THIS ARTIFACT: no chat of "
                f"{target} tokens was measured here (sizes: "
                f"{', '.join(sorted(rows, key=int))}); the law above puts it at "
                f"{predicted} bytes = {round(predicted / 1_000_000, 1)} MB per saved "
                "chat - DECLARED as arithmetic, measured in "
                "dev/results/unload-restore-app-context/")
    return (f"(f) THE OWNER NUMBER IS UNAVAILABLE: {target} tokens not measured "
            "here and the law could not be evaluated")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--bin", default=DEFAULT_BIN)
    ap.add_argument("--model", default=msr.DEFAULT_MODEL)
    ap.add_argument("--work", default="/tmp/kalsa-unload-restore")
    ap.add_argument("--port", type=int, default=19347)
    ap.add_argument("--ctx-size", type=int, default=8192)
    ap.add_argument("--sizes", default="600,1900")
    ap.add_argument("--n-predict", type=int, default=16)
    ap.add_argument("--max-load", type=float, default=6.0,
                    help="refuse to start ANY engine while the 1-minute load "
                         "average is above this; token counts and byte counts "
                         "are contention-invariant, prompt_ms and every wall "
                         "are not, so the floor is declared and enforced")
    args = ap.parse_args()

    # The gate comes before the first process of any kind: a measurement that
    # starts under load has walls nobody can read, and this harness reports
    # millisecond columns it must be able to stand behind.
    la0 = os.getloadavg()[0]
    if args.max_load > 0 and la0 > args.max_load:
        raise SystemExit(
            f"refusing to measure: 1-minute load average is {la0:.2f}, above "
            f"--max-load {args.max_load}. Other work is running on this "
            "machine. Wait, then run again, or raise --max-load deliberately.")

    for p in (args.bin, args.model):
        if not Path(p).exists():
            raise SystemExit(f"missing file: {p} - refusing to measure against "
                             f"something that is not there")
    sizes = [int(s) for s in args.sizes.split(",")]

    # The model's own header: trained context and sliding window are read,
    # never typed - the size ceiling and the bend's explanation cite these.
    model_facts = gguf_header_facts(args.model,
                                    extra_keys=("general.architecture", "general.name"))
    arch = model_facts.get("general.architecture")
    model_ctx = model_facts.get(f"{arch}.context_length") if arch else None
    largest = max(sizes)
    headroom = args.ctx_size - largest - args.n_predict
    if headroom < 0:
        raise SystemExit(
            f"refusing to measure: size {largest} + n_predict {args.n_predict} does not fit "
            f"the {args.ctx_size}-token slot ctx - the run would truncate, not measure")
    ceiling = {
        "largest_size": largest,
        "sizes": sizes,
        "per_slot_ctx": args.ctx_size,
        "headroom_tokens": headroom,
        "model_context_length": model_ctx,
        "model_context_source": "read from the model's own GGUF header (model_header)",
        "honest": bool(model_ctx and largest <= model_ctx),
        "why": (f"the largest size {largest} comes from --sizes {sizes}; it plus n_predict "
                f"{args.n_predict} fits the {args.ctx_size}-token per-slot ctx with "
                f"{headroom} tokens spare (--parallel 1), and the model's trained context "
                f"read from its own GGUF header is {model_ctx}: the ceiling is a choice of "
                "what this run has to measure, not a model or ctx limit; a size that did "
                "not fit would be refused above, never truncated"),
    }

    vp = subprocess.run(["nice", "-n", str(NICE), args.bin, "--version"],
                        capture_output=True, text=True)
    version = (vp.stdout + vp.stderr).strip()

    # The release block, before any arm: what this run measures is decided by
    # the object, not by how the run goes.
    release = release_block(args.bin, version)
    qualification = release_qualification(release)
    print(f"[release] {release['status']} (by exe_sha256: "
          f"{release['status_by_exe_sha256']}): {qualification}", flush=True)

    # The argv facts, from the argv: built once as the template the arms use,
    # read back, and refused if what is read is not what was meant.
    template_argv = ["nice", "-n", str(NICE)] + msr.engine_argv(
        args.bin, args.model, args.port, args.ctx_size, arm_extra(Path("slots")))
    argv_flags = flags_from_argv(template_argv)
    intended = {"engine_nice": NICE, "parallel": 1, "cache_ram": 0,
                "ctx_checkpoints": 1, "swa_full": False,
                "sleep_idle_seconds": SLEEP_IDLE_S, "ctx_size": args.ctx_size}
    if argv_flags != intended:
        raise SystemExit(f"the argv this run would pass disagrees with the provenance "
                         f"it intends to record: {argv_flags} != {intended}")

    record = {
        "release_qualification": qualification,
        "measurement": "unload-restore",
        "provenance": {
            "engine_binary": args.bin,
            "engine_sha256": msr.sha256_file(args.bin),
            "engine_version": version[:200],
            "release": release,
            "release_derivation": {
                "script": "dev/measure-concurrency.py",
                "sha256": msr.sha256_file(MC_SCRIPT),
                "loaded_as": "importlib module mconc - loaded, never copied",
            },
            "model": args.model,
            "model_sha256": msr.sha256_file(args.model),
            "model_header": model_facts,
            "sizes": sizes,
            "size_ceiling": ceiling,
            "script": str(Path(__file__).resolve()),
            "script_sha256": msr.sha256_file(Path(__file__).resolve()),
            "ctx_size": argv_flags["ctx_size"],
            "parallel": argv_flags["parallel"],
            "cache_ram": argv_flags["cache_ram"],
            "ctx_checkpoints": argv_flags["ctx_checkpoints"],
            "swa_full": argv_flags["swa_full"],
            "argv_facts_source": ("parsed back out of the argv every arm receives "
                                  "(flags_from_argv), asserted equal per arm and "
                                  "against the intended flags before the first engine"),
            "sleep_idle_seconds": argv_flags["sleep_idle_seconds"],
            "sleep_idle_note": ("short so the release lands inside the run; the app "
                                "ships 300"),
            "engine_nice": argv_flags["engine_nice"],
            "max_load": args.max_load,
            "max_load_note": ("gate on the 1-minute load average, checked before any "
                              "engine starts; 0 disables it and would be recorded as 0.0"),
            "watched_release_line": RELEASE_LINE,
            "watched_reload_line": RELOAD_LINE,
            "watched_lines_source": "crates/kalsa-supervisor/src/child.rs:42-43",
            "release_deadline_s": RELEASE_DEADLINE_S,
            "reload_deadline_s": RELOAD_DEADLINE_S,
            "release_settle_s": RELEASE_SETTLE_S,
            "n_predict": args.n_predict,
            "warm_threshold": f"cache_n >= {WARM_FRACTION} * chat_tokens",
            "warm_threshold_kind": "RULE - the line this verdict draws, not a measured datum",
            "salt_header": "x-kalsa-cache-salt",
            "salt_on_slot_actions": True,
            "raw_log_committed": False,
            "wall_times_note": ("wall times are measurements of this machine at "
                                "nice 10 under whatever else it was doing, not "
                                "performance promises"),
            "invariant_note": ("contention-invariant: token counts, cache_n, file "
                               "bytes. NOT invariant: prompt_ms, save_ms, every wall "
                               "- they move with loadavg_before (recorded above and "
                               "below) and are labelled wherever they are quoted"),
            "loadavg_before": msr.loadavg(),
        },
        "engine_commits": {},
        "arms": {},
    }

    work = Path(args.work)
    per_size = {}
    sentinels, logs = [], []

    for size in sizes:
        for arm in ("saved", "control"):
            arm_dir = work / f"{arm}_{size}"
            if arm_dir.exists():
                shutil.rmtree(arm_dir)  # a fresh slot dir: no file may predate the arm
            slots = arm_dir / "slots"
            slots.mkdir(parents=True, exist_ok=True)
            extra = arm_extra(slots)
            argv = ["nice", "-n", str(NICE)] + msr.engine_argv(
                args.bin, args.model, args.port, args.ctx_size, extra)
            got = flags_from_argv(argv)
            if got != argv_flags:
                raise SystemExit(
                    f"[{arm} {size}] this arm's argv disagrees with the recorded "
                    f"provenance: {got} != {argv_flags} - refusing to measure")
            server = msr.Server(argv, arm_dir / "engine.log")
            print(f"[{arm} {size}] starting on {args.port}", flush=True)
            try:
                server.start(args.port)
            except RuntimeError as e:
                raise SystemExit(f"[{arm} {size}] engine refused to start: {e} "
                                 f"(log: {arm_dir / 'engine.log'})")
            blockers = []
            try:
                if not record["engine_commits"]:
                    boot = server.lines()
                    for ln in boot:
                        if "build" in ln and "commit" in ln:
                            record["engine_commits"]["boot"] = ln.strip()[:200]
                            break
                    if "boot" not in record["engine_commits"]:
                        # An empty engine_commits is the ABSENCE of that line,
                        # not a measurement: say so instead of leaving a blank
                        # field for the next reader to wonder about.
                        record["engine_commits"]["scan_note"] = (
                            "no boot line carries both 'build' and 'commit'; this "
                            "field is empty because the line is absent, not because "
                            "a commit was not found - provenance.engine_version "
                            "(--version) carries the commit instead")
                    # The KV layout lines: the disk curve's arithmetic (bytes per
                    # token) is checkable against them, and they are the log side
                    # of the cache-size claim.
                    pv = record["provenance"]
                    pv["engine_init_line"] = [l.strip() for l in boot
                                              if "n_slots" in l and "n_ctx_slot" in l]
                    pv["engine_kv_lines"] = [l.strip() for l in boot
                                             if "llama_kv_cache: size" in l]
                    pv["engine_swa_lines"] = [l.strip() for l in boot
                                              if "n_swa " in l or "is_swa_any" in l
                                              or "creating non-SWA" in l
                                              or "creating     SWA" in l]
                    pv["checkpoint_line"] = [l.strip() for l in boot
                                             if "context checkpoints" in l]
                chat, _, sent, pool_words = make_chat_at(args.port, 1000 + size, size)
                sentinels.append(sent)
                logs.append(arm_dir / "engine.log")
                chat_tokens = len(msr.tokenize(args.port, chat))
                t0 = time.perf_counter()
                if arm == "saved":
                    rec = arm_saved(server, args.port, chat, chat_tokens,
                                    f"chat{size}", str(slots), args.n_predict, blockers)
                else:
                    rec = arm_control(server, args.port, chat, chat_tokens,
                                      args.n_predict, blockers)
                rec["arm_wall_s"] = round(time.perf_counter() - t0, 1)
                rec["chat_pool_words"] = pool_words
                rec["argv"] = argv
                rec["blockers"] = blockers
                rec["engine_lines_note"] = ("per-send engine lines are filtered by "
                                            "WATCH in measure-slot-restore.py")
            finally:
                server.stop()
            per_size.setdefault(size, {})[arm] = rec
            print(f"[{arm} {size}] measured={rec['measured']} "
                  f"release={rec['derived'].get('release_waited_s')}s "
                  f"warm={rec['derived'].get('warm')} "
                  f"cold={rec['derived'].get('cold')} "
                  f"cache_n={rec['derived'].get('cache_n')} "
                  f"blockers={blockers}", flush=True)
            time.sleep(2)

    record["arms"] = {str(size): per_size[size] for size in sorted(per_size)}
    warm_flags = [per_size[s]["saved"]["derived"]["warm"] for s in per_size]
    cold_flags = [per_size[s]["control"]["derived"]["cold"] for s in per_size]
    curve = disk_curve(per_size)
    conclusion = build_conclusion(per_size)
    if release["status"] != "matched":
        # the run is not the delivered artifact: the sentence says so FIRST.
        conclusion = f"{qualification} {conclusion}"
    conclusion = f"{conclusion} | disk curve: " + disk_curve_sentence(
        curve, record["provenance"].get("model_header"),
        record["provenance"].get("engine_kv_lines"),
        record["provenance"].get("engine_swa_lines"))
    app_ctx = read_app_context_default()
    offers = read_device_offers()
    record["provenance"]["app_context_default"] = app_ctx
    record["provenance"]["device_offers"] = offers
    law = disk_law(curve, record["provenance"].get("model_header") or {},
                   record["provenance"].get("engine_kv_lines"),
                   record["provenance"].get("engine_swa_lines"))
    conclusion = (f"{conclusion} {law_clause(law)} "
                  f"{owner_clause(law, curve, app_ctx, offers)}")
    record["verdict"] = {
        "warm_after_unload": aggregate(warm_flags),
        "cold_without_the_file": aggregate(cold_flags),
        "per_size": {str(s): {
            "warm_after_unload": per_size[s]["saved"]["derived"]["warm"],
            "cold_without_the_file": per_size[s]["control"]["derived"]["cold"],
            "release_waited_s_saved": per_size[s]["saved"]["derived"].get("release_waited_s"),
            "release_waited_s_control": per_size[s]["control"]["derived"].get("release_waited_s"),
            "restore_wall_ms": per_size[s]["saved"]["derived"].get("restore_wall_ms"),
            "resident_restore_wall_ms": per_size[s]["saved"]["derived"].get("resident_restore_wall_ms"),
            "model_reload_ms_estimate": per_size[s]["saved"]["derived"].get("model_reload_ms_estimate"),
            "n_restored": per_size[s]["saved"]["derived"].get("n_restored"),
            "second_send_cache_n_saved": per_size[s]["saved"]["derived"].get("cache_n"),
            "second_send_cache_n_control": per_size[s]["control"]["derived"].get("cache_n"),
        } for s in sorted(per_size)},
        "disk_curve": curve,
        "disk_law": law,
        "conclusion": conclusion,
    }
    record["provenance"]["loadavg_after"] = msr.loadavg()

    # No chat text in the artifact, and none in the logs we keep evidence from.
    leaked = []
    for sent in sentinels:
        for lg in logs:
            if sent and sent in lg.read_text(errors="replace"):
                leaked.append(str(lg))
    blob = json.dumps(record)
    if any(s and s in blob for s in sentinels) or leaked:
        raise SystemExit(f"REFUSING TO WRITE: chat text found in {leaked or 'the artifact'}")
    record["provenance"]["chat_sentinels_found_in_log"] = False

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps(record["verdict"], indent=2))
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
