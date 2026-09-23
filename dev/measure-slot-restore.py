#!/usr/bin/env python3
"""Measurement 2 - does a chat switch come back warm without `--swa-full`?

The committed record contradicts itself. `dev/results/kv-paging-spike/summary.md`
reports a restore with `n_restored=613` and then `cache_n=0` ("paging gives
nothing back"); `docs/MULTI-DEVICE-SHAPE.md` section 5 reports a switch-back
restoring 1862 of 1867 tokens for -2 ms, same build, same default, no
`--swa-full`. This settles which mechanism each one exercised, on the pinned
fork build.

Three engines, the same sliding-window model (`n_swa = 2048`):

  1. slot save/restore, `--swa-full` off  (`--cache-ram 0`, `--slot-save-path`,
     `--ctx-checkpoints 1`)
  2. slot save/restore, `--swa-full` on   (identical argv plus `--swa-full`)
  3. the RAM prompt cache, `--cache-ram 384`, no save/restore (the mechanism
     `MULTI-DEVICE-SHAPE.md` section 5 actually measured)

For engines 1 and 2, two chat sizes (~600 and ~1900 tokens) and two salt modes:
`salted` is the real device path - save, erase, restore, then the SAME request
with the SAME 64-hex salt; `unsalted` is the paging spike's path - the same run
with no salt header at all, which is the control that shows the namespace is
what changed.

Stdlib only. Prints a summary and writes the stripped artifact. Raw engine logs
are gitignored and never committed; the artifact carries only the numbers and
the named log lines above.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The release identity is inherited, never written here: mc.release_block
# derives it (launcher hash + engine-identity veto), engine-harness prints
# the one line and later checks the process on the port is this binary's.
_mc_spec = importlib.util.spec_from_file_location("mconc",
                                                  HERE / "measure-concurrency.py")
mc = importlib.util.module_from_spec(_mc_spec)
_mc_spec.loader.exec_module(mc)
_eh_spec = importlib.util.spec_from_file_location("eh",
                                                  HERE / "engine-harness.py")
eh = importlib.util.module_from_spec(_eh_spec)
_eh_spec.loader.exec_module(eh)

DEFAULT_MODEL = ("/Users/marco/Library/Application Support/kalsa-brain/runtime/"
                 "models/Trinity-Nano-Preview-Q4_K_M.gguf")

SALT_HEX = hashlib.sha256(b"kalsa-measure-slot-restore/device-D").hexdigest()

WORDS = ("harbor lantern gravel willow copper thistle marble quarry beacon "
         "cistern ferry juniper kelp limestone meadow nettle orchard pebble "
         "reed saffron tundra umber vellum wharf yarrow zephyr almond basalt "
         "cobalt dune elm fennel gable heather iris").split()

WATCH = re.compile(
    r"appended \d+ context checkpoint\(s\)"
    r"|restored \d+ context checkpoint\(s\)"
    r"|different cache namespace"
    r"|forcing full prompt re-processing"
    r"|restored context checkpoint"
    r"|erased invalidated context checkpoint"
    r"|erased old context checkpoint"
    r"|erasing context checkpoint too close"
    r"|making room for prompt cache entry"
    r"|selected slot by id"
    r"| - saving prompt with length"
    r"| - found better prompt with f_keep"
    r"|prompt cache update took")
LOG_SLOT = re.compile(r"slot\s+\S+:\s+id\s+(\d+)\s+\|")


# --------------------------------------------------------------------------
def post(port, path, payload, salt_hex=None, timeout=1800):
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if salt_hex:
        headers["x-kalsa-cache-salt"] = salt_hex
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data,
                                 headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"_raw": body[:400]}


def tokenize(port, content):
    st, body = post(port, "/tokenize", {"content": content})
    if st != 200:
        raise RuntimeError(f"/tokenize failed: {st} {body}")
    return body["tokens"]


def detokenize(port, tokens):
    st, body = post(port, "/detokenize", {"tokens": tokens})
    if st != 200:
        raise RuntimeError(f"/detokenize failed: {st} {body}")
    return body["content"]


def make_chat(port, seed, target):
    import random
    rng = random.Random(seed)
    sentinel = f"zqxvsentinelchat{seed:04d}"
    big = [sentinel]
    while len(big) <= 16000:
        big.append(rng.choice(WORDS))
    ids = tokenize(port, " ".join(big))
    for start in range(0, 64):
        window = ids[start:start + target]
        content = detokenize(port, window)
        if len(tokenize(port, content)) == target:
            return content, target, content[:80]
    raise RuntimeError("could not build an exact-token chat")


def wait_health(port, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health",
                                        timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def port_is_held(port):
    """True when something already listens on the port.

    A stale engine left by an interrupted run answers /health exactly like the
    one about to start. The harness would then measure the wrong process in the
    wrong work directory, and every number would look plausible: this happened,
    and a whole arm of a run was read from an engine writing into the previous
    run's directory. Binding is the exact test, and it costs nothing.
    """
    probe = socket.socket()
    # SO_REUSEADDR, because the engine sets it: a port left in TIME_WAIT by the
    # engine we just stopped is one cpp-httplib binds happily, and without this
    # the guard refuses a port that was never occupied. It still refuses a real
    # listener, which is the case it exists for.
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(("127.0.0.1", port))
        return False
    except OSError:
        return True
    finally:
        probe.close()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


class Server:
    def __init__(self, argv, log_path):
        self.argv = argv
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.proc = None
        self._fh = None

    def start(self, port):
        if port_is_held(port):
            raise RuntimeError(
                f"port {port} already answers: an engine from an earlier run is "
                f"still up, and this run would read ITS directory, not ours"
            )
        self._fh = open(self.log_path, "wb")
        env = dict(os.environ)
        env.pop("LLAMA_SERVER_SLOTS_DEBUG", None)
        env.pop("LLAMA_SERVER_SLOTS_N_DIFF", None)
        self.proc = subprocess.Popen(self.argv, stdout=self._fh,
                                     stderr=subprocess.STDOUT, env=env,
                                     start_new_session=True)
        if not wait_health(port):
            self.stop()
            raise RuntimeError("engine did not become healthy")
        if self.proc.poll() is not None:
            self.stop()
            raise RuntimeError(
                f"the engine exited during boot and something else answered the "
                f"health check; see {self.log_path}"
            )

    def stop(self):
        if self.proc is not None:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except Exception:
                self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except Exception:
                try:
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                except Exception:
                    pass
            self.proc = None
        if self._fh is not None:
            self._fh.flush()
            self._fh.close()
            self._fh = None

    def lines(self):
        try:
            return self.log_path.read_text(errors="replace").splitlines()
        except FileNotFoundError:
            return []


def watched(lines):
    out = []
    for ln in lines:
        if not WATCH.search(ln):
            continue
        m = LOG_SLOT.search(ln)
        body = ln.split("|", 1)[1].strip() if "|" in ln else ln.strip()
        out.append({"slot": int(m.group(1)) if m else None, "line": body})
    return out


def loadavg():
    try:
        return [float(x) for x in os.getloadavg()]
    except Exception:
        return None


def send(port, prompt, salt_hex, n_predict, slot, server):
    payload = {"prompt": prompt, "n_predict": n_predict, "temperature": 0.0,
               "seed": 1, "cache_prompt": True, "ignore_eos": True,
               "id_slot": slot}
    before = len(server.lines())
    t0 = time.perf_counter()
    st, r = post(port, "/completion", payload, salt_hex)
    wall = round((time.perf_counter() - t0) * 1000, 1)
    tim = (r or {}).get("timings") or {}
    return {
        "status": st,
        "salt": "set" if salt_hex else "none",
        "wall_ms": wall,
        "prompt_n": tim.get("prompt_n"),
        "cache_n": tim.get("cache_n"),
        "prompt_ms": tim.get("prompt_ms"),
        "predicted_n": tim.get("predicted_n"),
        "predicted_per_second": tim.get("predicted_per_second"),
        "cache_reused_tokens": (r or {}).get("tokens_cached"),
        "engine_lines": watched(server.lines()[before:]),
        "loadavg": loadavg(),
    }


def slot_action(port, slot, action, filename=None, salt_hex=None):
    # The salt rides the slot actions too, because the door's own call to the
    # engine carries it (`engine.rs: private_headers`). Leaving it out here made
    # the "salted" arm mean "completion salted, slot actions unsalted" - a path
    # no client produces - so the restore stamped the empty namespace and the
    # next request wiped it. That read cold and said nothing about the fix.
    payload = {} if filename is None else {"filename": filename}
    t0 = time.perf_counter()
    st, body = post(port, f"/slots/{slot}?action={action}", payload, salt_hex)
    wall = round((time.perf_counter() - t0) * 1000, 2)
    return {"status": st, "wall_ms": wall, "body": body}


def sequence(port, slot, chat, salt_hex, n_predict, server, slot_dir, tag):
    """cold send -> save -> erase -> restore -> the same send again."""
    cold = send(port, chat, salt_hex, n_predict, slot, server)
    before = len(server.lines())
    save = slot_action(port, slot, "save", f"{tag}.bin", salt_hex)
    size = (slot_dir / f"{tag}.bin").stat().st_size if (slot_dir / f"{tag}.bin").exists() else None
    erase = slot_action(port, slot, "erase", None, salt_hex)
    restore = slot_action(port, slot, "restore", f"{tag}.bin", salt_hex)
    action_lines = watched(server.lines()[before:])
    after = send(port, chat, salt_hex, n_predict, slot, server)
    sb = save["body"] if isinstance(save["body"], dict) else {}
    rb = restore["body"] if isinstance(restore["body"], dict) else {}
    eb = erase["body"] if isinstance(erase["body"], dict) else {}
    return {
        "salt_mode": "salted" if salt_hex else "unsalted",
        "cold_send": cold,
        "save": save,
        "erase": erase,
        "restore": restore,
        "action_engine_lines": action_lines,
        "next_send_same_salt": after,
        "file_bytes": size,
        "save_filename": f"{tag}.bin",
        "n_saved": sb.get("n_saved"),
        "n_written": sb.get("n_written"),
        "save_ms": (sb.get("timings") or {}).get("save_ms"),
        "n_erased": eb.get("n_erased"),
        "n_restored": rb.get("n_restored"),
        "n_read": rb.get("n_read"),
        "restore_ms": (rb.get("timings") or {}).get("restore_ms"),
        "re_evaluated_tokens": after.get("prompt_n"),
        "next_cache_n": after.get("cache_n"),
        "next_wall_ms": after.get("wall_ms"),
        "restore_confirms_cold": {
            "cold_cache_n": cold.get("cache_n"),
            "cold_prompt_n": cold.get("prompt_n"),
            "cold_prompt_ms": cold.get("prompt_ms"),
        },
    }


def ram_switch(port, slot, chat_a, chat_b, salt_hex, n_predict, server, tag):
    """The MULTI-DEVICE-SHAPE section 5 mechanism: A, A, B, A, A, B, A.

    Two switch-backs (A2 and A4) against the same warm baseline (A1), because a
    handful of milliseconds of prompt_ms moves with host load; the reused-token
    count is the stable signal.
    """
    seq = []
    plan = [("A0-cold", chat_a), ("A1-warm", chat_a),
            ("B0-switch-away", chat_b), ("A2-switch-back", chat_a),
            ("A3-warm-confirm", chat_a), ("B1-switch-away-2", chat_b),
            ("A4-switch-back-2", chat_a)]
    for label, chat in plan:
        rec = send(port, chat, salt_hex, n_predict, slot, server)
        rec["label"] = label
        seq.append(rec)
    out = {"tag": tag, "sequence": seq}
    by = {r["label"]: r for r in seq}
    warm = by["A1-warm"]["prompt_ms"]
    out["warm_baseline_cache_n"] = by["A1-warm"]["cache_n"]
    out["switch_backs"] = []
    for label in ("A2-switch-back", "A4-switch-back-2"):
        rec = by[label]
        out["switch_backs"].append({
            "label": label,
            "cache_n": rec["cache_n"],
            "prompt_n": rec["prompt_n"],
            "prompt_ms": rec["prompt_ms"],
            "minus_warm_prompt_ms": (round((rec["prompt_ms"] or 0) - (warm or 0), 2)
                                     if rec["prompt_ms"] is not None and warm is not None
                                     else None),
            "loadavg": rec["loadavg"],
        })
    out["switch_back_cache_n"] = out["switch_backs"][0]["cache_n"]
    out["switch_back_prompt_ms"] = out["switch_backs"][0]["prompt_ms"]
    out["switch_back_minus_warm_prompt_ms"] = out["switch_backs"][0]["minus_warm_prompt_ms"]
    return out


def engine_argv(binary, model, port, ctx, extra):
    return [binary, "-m", model, "--host", "127.0.0.1", "--port", str(port),
            "--parallel", "1", "--ctx-size", str(ctx),
            "--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
            "--n-gpu-layers", "all", "--threads", "4", "--threads-batch", "4",
            "--batch-size", "2048", "--ubatch-size", "512",
            "--no-webui", "-lv", "4"] + extra


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default="/tmp/kalsa-m2")
    ap.add_argument("--bin", required=True,
                    help="the engine binary under test; which binary the "
                         "panel's number describes is the owner's decision, "
                         "so there is no default")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--ctx-size", type=int, default=16384)
    ap.add_argument("--n-predict", type=int, default=8)
    ap.add_argument("--sizes", default="600,1900")
    ap.add_argument("--max-load", type=float, default=6.0,
                    help="refuse to start an engine while the 1-minute load "
                         "average is above this; the token counts here are "
                         "contention-invariant but the wall and prompt_ms "
                         "columns are not")
    args = ap.parse_args()

    la0 = os.getloadavg()[0]
    if args.max_load > 0 and la0 > args.max_load:
        raise SystemExit(
            f"refusing to measure: 1-minute load average is {la0:.2f}, above "
            f"--max-load {args.max_load}. Other work is running on this "
            f"machine. Wait, then run again, or raise --max-load "
            f"deliberately.")

    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    sizes = [int(s) for s in args.sizes.split(",")]

    vp = subprocess.run([args.bin, "--version"], capture_output=True, text=True)
    version = (vp.stdout + vp.stderr).strip()

    # The engine's identity, derived (never asserted) and printed before
    # the first measurement: the old DEFAULT_BIN pointed at v1.1.0 - the
    # release WITHOUT T1 - so which tree this run measures is now the
    # owner's decision, recorded and legible in the log.
    release = mc.release_block(args.bin, version,
                               mc.derive_manifest_url(args.bin))
    print(eh.engine_identity_line(release), flush=True)

    prov = {
        "host_arch": subprocess.run(["uname", "-m"], capture_output=True,
                                    text=True).stdout.strip(),
        "engine_binary": args.bin,
        "engine_sha256": sha256_file(args.bin),
        "engine_version": version,
        "release": release,
        "model": args.model,
        "model_sha256": sha256_file(args.model),
        "context_size": args.ctx_size,
        "cache_type_k": "q8_0", "cache_type_v": "q8_0",
        "n_predict": args.n_predict,
        "ignore_eos": True,
        "verbosity": 4,
        "verbosity_note": ("-lv 4 carries the INFO lines and the TRC lines "
                           "(which print with an I but need verbosity 4); "
                           "-lv 5 would add the DEBUG `launching slot` JSON, "
                           "which embeds prompt tokens"),
        "raw_log_committed": False,
        "salt_header": "x-kalsa-cache-salt",
        "salt_value_reported_as": "sha256(device label), 64 hex",
    }

    result = {"measurement": "slot-restore-swa", "provenance": prov,
              "engines": {}, "ram_prompt_cache_control": {}}
    sentinels = []

    # ---------------- engines 1 and 2: save/erase/restore ----------------
    for swa in (False, True):
        name = "swa_full_on" if swa else "swa_full_off"
        port = 19312 if not swa else 19313
        slot_dir = work / f"slots_{name}"
        slot_dir.mkdir(parents=True, exist_ok=True)
        for old in slot_dir.glob("*.bin"):
            old.unlink()
        extra = ["--cache-ram", "0", "--slot-save-path", str(slot_dir) + "/",
                 "--ctx-checkpoints", "1"]
        if swa:
            extra.append("--swa-full")
        argv = engine_argv(args.bin, args.model, port, args.ctx_size, extra)
        server = Server(argv, work / f"server_{name}.log")
        print(f"[engine {name}] starting on {port}", flush=True)
        server.start(port)
        # the responder must claim this binary's build, or the run stops
        eh.require_running_engine(port, version)
        boot = server.lines()
        eng = {
            "argv": argv, "port": port, "slot_dir": str(slot_dir),
            "slot_actions_supported": True,
            "init_line": [l.strip() for l in boot
                          if "n_slots" in l and "n_ctx_slot" in l],
            "kv_lines": [l.strip() for l in boot if "llama_kv_cache: size" in l],
            "swa_lines": [l.strip() for l in boot
                          if "n_swa " in l or "is_swa_any" in l
                          or "creating non-SWA" in l or "creating     SWA" in l
                          or "swa_full" in l],
            "checkpoint_line": [l.strip() for l in boot
                                if "context checkpoints" in l],
            "cache_ram_line": [l.strip() for l in boot if "prompt cache" in l],
            "sequences": {},
        }
        for size in sizes:
            chat_a, na, sent_a = make_chat(port, 101 + size, size)
            sentinels.append((sent_a, server))
            na_ver = len(tokenize(port, chat_a))
            for salt_mode, salt in (("salted", SALT_HEX), ("unsalted", None)):
                port_tag = f"{name}_{size}_{salt_mode}"
                for slot in (0,):
                    slot_action(port, slot, "erase")
                rec = sequence(port, 0, chat_a, salt, args.n_predict, server,
                               slot_dir, f"{size}_{salt_mode}")
                rec["chat_tokens"] = na_ver
                eng["sequences"][f"{size}_{salt_mode}"] = rec
                print(f"[{name} {size} {salt_mode}] cold cache_n={rec['cold_send']['cache_n']} "
                      f"n_saved={rec['n_saved']} n_written={rec['n_written']} "
                      f"file={rec['file_bytes']} n_restored={rec['n_restored']} "
                      f"next cache_n={rec['next_cache_n']} "
                      f"re-eval={rec['re_evaluated_tokens']} "
                      f"next_ms={rec['next_wall_ms']}", flush=True)
                time.sleep(1)
        result["engines"][name] = eng
        server.stop()
        print(f"[engine {name}] stopped", flush=True)
        time.sleep(3)

    # ---------------- engine 3: the RAM prompt cache mechanism -----------
    # one fresh engine per size: the prompt cache survives a slot erase, so two
    # sizes on one engine would let the first size's state answer for the second
    name = "ram_prompt_cache"
    port = 19314
    ram_engines = {}
    for size in sizes:
        extra = ["--cache-ram", "384"]
        argv = engine_argv(args.bin, args.model, port, args.ctx_size, extra)
        server = Server(argv, work / f"server_ram_{size}.log")
        print(f"[engine {name} {size}] starting on {port}", flush=True)
        server.start(port)
        # the responder must claim this binary's build, or the run stops
        eh.require_running_engine(port, version)
        boot = server.lines()
        eng = {
            "argv": argv, "port": port,
            "slot_actions_supported": False,
            "slot_actions_note": ("no --slot-save-path, so action=erase "
                                  "returns 501; the slot begins empty, which is "
                                  "all this control needs"),
            "init_line": [l.strip() for l in boot
                          if "n_slots" in l and "n_ctx_slot" in l],
            "cache_ram_line": [l.strip() for l in boot if "prompt cache" in l],
        }
        chat_a, _, sent_a = make_chat(port, 101 + size, size)
        chat_b, _, sent_b = make_chat(port, 202 + size, size)
        sentinels.append((sent_a, server))
        sentinels.append((sent_b, server))
        erase = slot_action(port, 0, "erase")
        rec = ram_switch(port, 0, chat_a, chat_b, SALT_HEX, args.n_predict,
                         server, f"size{size}")
        rec["erase_before"] = erase["status"]
        rec["chat_tokens"] = len(tokenize(port, chat_a))
        eng["run"] = rec
        ram_engines[str(size)] = eng
        print(f"[{name} size={size}] warm={rec['warm_baseline_cache_n']} "
              f"switch_back={rec['switch_back_cache_n']} "
              f"d_prompt_ms={rec['switch_back_minus_warm_prompt_ms']}", flush=True)
        server.stop()
        print(f"[engine {name} {size}] stopped", flush=True)
        time.sleep(3)
    result["ram_prompt_cache_control"] = {
        "mechanism": "RAM prompt cache, --cache-ram 384, no slot save/restore",
        "engines": ram_engines,
    }

    # ---------------- leak check ----------------------------------------
    leaked = []
    for sent, srv in sentinels:
        for ln in srv.lines():
            if sent in ln:
                leaked.append((sent, ln[:80]))
    if leaked:
        raise SystemExit(
            f"REFUSING TO WRITE: {len(leaked)} log lines carry chat text")
    result["provenance"]["chat_sentinels_found_in_log"] = False

    def seq(engine, key):
        return result["engines"][engine]["sequences"][key]

    derived = {}
    for engine in ("swa_full_off", "swa_full_on"):
        for size in sizes:
            for mode in ("salted", "unsalted"):
                s = seq(engine, f"{size}_{mode}")
                derived[f"{engine}_{size}_{mode}"] = {
                    "n_restored": s["n_restored"],
                    "next_cache_n": s["next_cache_n"],
                    "re_evaluated_tokens": s["re_evaluated_tokens"],
                    "file_bytes": s["file_bytes"],
                    "warm": bool(s["next_cache_n"] and s["next_cache_n"] > 32),
                }
    result["answers"] = {
        "same_salt_next_request_warm_without_swa_full": derived[
            "swa_full_off_1900_salted"]["warm"],
        "same_salt_next_request_warm_with_swa_full": derived[
            "swa_full_on_1900_salted"]["warm"],
        "saltless_next_request_warm_without_swa_full": derived[
            "swa_full_off_1900_unsalted"]["warm"],
        "saltless_next_request_warm_with_swa_full": derived[
            "swa_full_on_1900_unsalted"]["warm"],
        # Derived, never asserted: an artifact that states a defect is present
        # when every arm comes back warm is worse than no field at all. This run
        # is the one that proved that.
        "cold_arms": sorted(name for name, rec in derived.items() if not rec["warm"]),
        "mechanism_if_cold": ("the restore clears slot.prompt.cache_salt; a cold arm carrying a salt "
                              "means the namespace was not stamped back, and the engine's own log says "
                              "`different cache namespace - clearing cached prompt`"),
        "derived": derived,
    }

    blob = json.dumps(result)
    probes = [s for s, _ in sentinels if s and s in blob]
    if probes:
        raise SystemExit("REFUSING TO WRITE: the artifact carries chat text")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(result, f, indent=1)
    print("\nwrote", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
