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
      [--prompt-tokens 512] [--attempts 4] [--bracket-tol 0.03] [--keep-server]
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
                         "within --bracket-tol of A")
    ap.add_argument("--bracket-tol", type=float, default=0.03,
                    help="how far A2 may drift from A before the attempt is "
                         "called contaminated by other load")
    ap.add_argument("--keep-server", action="store_true")
    ap.add_argument("--max-load", type=float, default=6.0,
                    help="refuse to start an engine while the 1-minute load "
                         "average is above this; a decode rate recorded under "
                         "other load is not the number the panel may print")
    args = ap.parse_args()

    la0 = os.getloadavg()[0]
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
                "started_utc": started_utc,
                "hostname": socket.gethostname(),
                "host_arch": subprocess.run(["uname", "-m"], capture_output=True,
                                            text=True).stdout.strip(),
                "engine_binary": args.bin,
                "engine_sha256": sha256_file(args.bin),
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
