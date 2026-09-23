#!/usr/bin/env python3
"""Does the engine take a save while the slot is generating, and what does a
chat's file weigh?

Two questions, because the first one raised the second.

**1. A save that arrives mid-turn.** T4a marks a slot when a completion passes
through the door and its idle timer writes that slot out after the interval. The
review of T4a found the mark lands at the top of the turn, before the response
relays, and could not answer what the engine does with a save that arrives while
the slot is busy. Three answers, three different severities: *deferred* means the
save waits and then captures the whole turn, so the defect cost latency;
*refused* means the turn is not on disk until something marks the slot again;
*accepted* means the file is a prefix of the turn. The door's own patience is
10 s, so whether the save outlasts it decides whether the door reads its own
success as a failure.

**2. The file's weight per token, against the context size.** The plan quotes
~53 KB per token (~218 MB per chat at the 4096-token floor) from a run at
`--ctx-size 16384` without `--swa-full`, and one earlier run at 8192 did not
agree. The tier's context is a launch choice, so if the weight moves with it the
panel's disk line cannot be a constant. This run measures the same token count
at two contexts rather than extrapolating between two different ones.

Clocks are absolute and shared, so "the save returned after the turn" is a
comparison of instants rather than the subtraction of two wall times that start
at different moments - which is how the previous version of this script derived
the opposite verdict from the same evidence.

    python3 dev/measure-save-on-busy-slot.py --bin /path/to/kalsa-server \
        --out dev/results/save-on-busy-slot/results.json
"""

import argparse
import importlib.util
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("msr", HERE / "measure-slot-restore.py")
msr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(msr)
# The release identity is inherited, never written here: mc.release_block
# derives it, engine-harness prints the one line and later checks the port.
_mc_spec = importlib.util.spec_from_file_location("mconc",
                                                  HERE / "measure-concurrency.py")
mc = importlib.util.module_from_spec(_mc_spec)
_mc_spec.loader.exec_module(mc)
_eh_spec = importlib.util.spec_from_file_location("eh", HERE / "engine-harness.py")
eh = importlib.util.module_from_spec(_eh_spec)
_eh_spec.loader.exec_module(eh)

GEN_SECONDS = 30.0
DOOR_PATIENCE_MS = 10_000  # `PATIENCE` in crates/kalsa-door/src/lib.rs


def timed_save(port, slot, name, salt, timeout, slots_dir):
    t0 = time.perf_counter()
    try:
        st, body = msr.post(port, f"/slots/{slot}?action=save", {"filename": name},
                            salt, timeout=timeout)
        wall = (time.perf_counter() - t0) * 1000
        b = body if isinstance(body, dict) else {}
        path = Path(slots_dir) / name
        return {"status": st, "wall_ms": round(wall, 1), "timed_out": False,
                "n_saved": b.get("n_saved"), "n_written": b.get("n_written"),
                "save_ms": (b.get("timings") or {}).get("save_ms"),
                "file_bytes": path.stat().st_size if path.exists() else None,
                "door_would_give_up": wall > DOOR_PATIENCE_MS}
    except Exception as e:  # a timeout is a datum, not a crash
        wall = (time.perf_counter() - t0) * 1000
        return {"status": None, "wall_ms": round(wall, 1), "timed_out": True,
                "error": f"{type(e).__name__}: {e}"[:160],
                "door_would_give_up": wall > DOOR_PATIENCE_MS}


def arm(server, port, chat, salt, n_predict, ctx_size, slots_dir):
    """One context size: an idle turn, a save into a live turn, then an idle save."""
    out = {"ctx_size": ctx_size}
    msr.slot_action(port, 0, "erase", None, salt)
    # A turn that finishes, so the schedule below is not the first one ever.
    msr.send(port, chat, salt, 8, 0, server)

    lines_before = len(server.lines())
    gen = {}

    def generate():
        gen["t0"] = time.perf_counter()
        gen["result"] = msr.send(port, chat, salt, n_predict, 0, server)
        gen["t1"] = time.perf_counter()

    thread = threading.Thread(target=generate)
    thread.start()
    time.sleep(3.0)
    save_started = time.perf_counter()
    save = timed_save(port, 0, "busy.bin", salt, 600, slots_dir)
    save_ended = time.perf_counter()
    thread.join()
    save["clock"] = {
        "gen_start": round(gen["t0"], 3),
        "gen_end": round(gen["t1"], 3),
        "save_start": round(save_started, 3),
        "save_end": round(save_ended, 3),
        "save_ended_after_turn": save_ended >= gen["t1"] - 0.5,
        "save_began_during_turn": save_started <= gen["t1"],
    }
    save["turn"] = {k: gen["result"].get(k) for k in
                    ("status", "wall_ms", "prompt_n", "cache_n", "predicted_n",
                     "predicted_per_second")}
    save["engine_lines"] = msr.watched(server.lines()[lines_before:])
    out["save_into_a_live_turn"] = save

    after = msr.send(port, chat, salt, 4, 0, server)
    out["idle_save_after_the_turn"] = timed_save(port, 0, "after.bin", salt, 120, slots_dir)
    out["idle_save_after_the_turn"]["turn_cache_n"] = after.get("cache_n")
    return out


def kb_per_token(a):
    if a.get("file_bytes") and a.get("n_saved"):
        return round(a["file_bytes"] / a["n_saved"] / 1024.0, 2)
    return None


def derive(arms):
    busy = arms["save_into_a_live_turn"]
    clock = busy.get("clock") or {}
    if busy.get("timed_out"):
        answer, why = "unanswered", "the save did not answer within its budget"
    elif busy.get("status") != 200:
        answer, why = "refused", f"the save answered with {busy.get('status')}"
    elif clock.get("save_ended_after_turn"):
        answer, why = "deferred", "the save answered only after the turn it arrived in had ended"
    else:
        answer, why = "accepted", "the save answered while the turn was still running"
    return {"save_on_busy": answer, "why": why,
            "the_door_would_have_given_up": bool(busy.get("door_would_give_up")),
            "saved_the_whole_turn": busy.get("n_saved") is not None
            and (busy.get("turn") or {}).get("prompt_n") is not None
            and busy["n_saved"] >= (busy["turn"]["prompt_n"] + busy["turn"]["predicted_n"]) - 2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--bin", required=True,
                    help="the engine binary under test; which binary the "
                         "panel's number describes is the owner's decision, "
                         "so there is no default")
    ap.add_argument("--model", default=msr.DEFAULT_MODEL)
    ap.add_argument("--work", default="/tmp/kalsa-save-on-busy")
    ap.add_argument("--port", type=int, default=19341)
    ap.add_argument("--ctx-sizes", default="8192,16384")
    ap.add_argument("--n-predict", type=int, default=0, help="0 = size the turn from a rate probe")
    args = ap.parse_args()

    # The engine's identity, derived and printed before the first arm: the
    # old DEFAULT_BIN was the fork's CPU-only dev build, which prefills 16x
    # slower - which tree this run measures is now the owner's decision.
    vp = subprocess.run([args.bin, "--version"], capture_output=True, text=True)
    version = (vp.stdout + vp.stderr).strip()
    release = mc.release_block(args.bin, version,
                               mc.derive_manifest_url(args.bin))
    print(eh.engine_identity_line(release), flush=True)

    record = {"engine_sha256": msr.sha256_file(args.bin), "model": args.model,
              "model_sha256": msr.sha256_file(args.model),
              "provenance": {"release": release,
                             "engine_binary": args.bin,
                             "engine_version": version},
              "door_patience_ms": DOOR_PATIENCE_MS, "loadavg_before": msr.loadavg(),
              "arms": {}, "engine_commits": {}}
    for ctx in [int(x) for x in args.ctx_sizes.split(",")]:
        work = Path(args.work) / f"ctx{ctx}"
        slots = work / "slots"
        slots.mkdir(parents=True, exist_ok=True)
        extra = ["--slot-save-path", str(slots), "--ctx-checkpoints", "1",
                 "--cache-ram", "0", "--sleep-idle-seconds", "300"]
        argv = msr.engine_argv(args.bin, args.model, args.port, ctx, extra)
        server = msr.Server(argv, work / "engine.log")
        try:
            server.start(args.port)
            # the responder must claim this binary's build, or the run stops
            eh.require_running_engine(args.port, version)
            for ln in server.lines():
                if "build" in ln and "commit" in ln:
                    record["engine_commits"][ctx] = ln.strip()[:200]
                    break
            chat, n_tokens, _ = msr.make_chat(args.port, 7, 600)
            n_predict = args.n_predict
            if not n_predict:
                probe = msr.send(args.port, chat, msr.SALT_HEX, 16, 0, server)
                rate = probe.get("predicted_per_second") or 0
                n_predict = int(max(64, min(4000, rate * GEN_SECONDS))) if rate else 400
            a = arm(server, args.port, chat, msr.SALT_HEX, n_predict, ctx, str(slots))
            a["argv"] = argv
            a["chat_tokens"] = n_tokens
            a["n_predict"] = n_predict
            a["kb_per_token_after_the_turn"] = kb_per_token(a["idle_save_after_the_turn"])
            a["kb_per_token_busy"] = kb_per_token(a["save_into_a_live_turn"])
            a["verdict"] = derive(a)
            record["arms"][str(ctx)] = a
            print(f"ctx {ctx}: {json.dumps(a['verdict'])} kb/token="
                  f"{a['kb_per_token_after_the_turn']}", flush=True)
        finally:
            server.stop()

    weights = {ctx: a["kb_per_token_after_the_turn"] for ctx, a in record["arms"].items()}
    record["file_weight"] = {
        "kb_per_token_by_ctx": weights,
        "moves_with_the_context": len(set(w for w in weights.values() if w)) > 1,
        "reading": ("the weight per token is not a constant of the tier: it is a "
                    "function of the context size the engine was launched with, so the "
                    "panel's disk line has to be derived from the engine's own figure"),
    }
    record["loadavg_after"] = msr.loadavg()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"verdicts": {c: a["verdict"]["save_on_busy"] for c, a in record["arms"].items()},
                      "kb_per_token": weights,
                      "out": str(out)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
