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

    nice-free by construction: the engine is launched under `nice -n 10`
    inside this script. Stdlib only.

    python3 dev/measure-unload-restore.py --out dev/results/unload-restore/results.json
"""

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("msr", HERE / "measure-slot-restore.py")
msr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(msr)

DEFAULT_BIN = "/Users/marco/Projects/kalsallama/build/bin/llama-server"

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


# ------------------------------------------------------------------------ main
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
    args = ap.parse_args()

    for p in (args.bin, args.model):
        if not Path(p).exists():
            raise SystemExit(f"missing file: {p} - refusing to measure against "
                             f"something that is not there")
    sizes = [int(s) for s in args.sizes.split(",")]

    vp = subprocess.run(["nice", "-n", "10", args.bin, "--version"],
                        capture_output=True, text=True)
    record = {
        "measurement": "unload-restore",
        "provenance": {
            "engine_binary": args.bin,
            "engine_sha256": msr.sha256_file(args.bin),
            "engine_version": (vp.stdout + vp.stderr).strip()[:200],
            "model": args.model,
            "model_sha256": msr.sha256_file(args.model),
            "script": str(Path(__file__).resolve()),
            "script_sha256": msr.sha256_file(Path(__file__).resolve()),
            "ctx_size": args.ctx_size,
            "parallel": 1, "cache_ram": 0, "ctx_checkpoints": 1,
            "swa_full": False,
            "sleep_idle_seconds": SLEEP_IDLE_S,
            "sleep_idle_note": ("short so the release lands inside the run; the app "
                                "ships 300"),
            "engine_nice": 10,
            "watched_release_line": RELEASE_LINE,
            "watched_reload_line": RELOAD_LINE,
            "watched_lines_source": "crates/kalsa-supervisor/src/child.rs:42-43",
            "release_deadline_s": RELEASE_DEADLINE_S,
            "reload_deadline_s": RELOAD_DEADLINE_S,
            "release_settle_s": RELEASE_SETTLE_S,
            "n_predict": args.n_predict,
            "warm_threshold": f"cache_n >= {WARM_FRACTION} * chat_tokens",
            "salt_header": "x-kalsa-cache-salt",
            "salt_on_slot_actions": True,
            "raw_log_committed": False,
            "wall_times_note": ("wall times are measurements of this machine at "
                                "nice 10 under whatever else it was doing, not "
                                "performance promises"),
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
            extra = ["--slot-save-path", str(slots), "--ctx-checkpoints", "1",
                     "--cache-ram", "0", "--sleep-idle-seconds", str(SLEEP_IDLE_S)]
            argv = ["nice", "-n", "10"] + msr.engine_argv(
                args.bin, args.model, args.port, args.ctx_size, extra)
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
                    for ln in server.lines():
                        if "build" in ln and "commit" in ln:
                            record["engine_commits"]["boot"] = ln.strip()[:200]
                            break
                chat, _, sent = msr.make_chat(args.port, 1000 + size, size)
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
        "conclusion": build_conclusion(per_size),
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
