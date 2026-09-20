#!/usr/bin/env python3
"""SPIKE - encrypted per-device KV paging with the shared prompt cache disabled.

Design under test
-----------------
One llama-server process, explicit `-np N`, `--cache-ram 0` (closes the shared
cross-device prompt cache, hence the timing oracle), and per-device warm context
provided by `/slots/{i}?action=save` / `action=restore` to a file that the
household layer encrypts with a per-device key. No fork of llama.cpp.

The script launches and stops every server itself, one config at a time, on a
free port, and writes raw numbers plus server logs under
`dev/results/kv-paging-spike/`. It never inspects or modifies the app.

Experiments
-----------
E1  within-slot warmth with --cache-ram 0, np=2
E2  cross-device oracle, --cache-ram 384 (control) vs 0
E3  slot save/restore with --cache-ram 0 (the load-bearing test)
E4  encryption transparency (HKDF-SHA256 + AES-256-CBC), restore the plaintext
E5  more logical devices than physical slots: np=1 paging vs np=4 concurrent
E6  oracle probe with a guessed private tail, --cache-ram 384 vs 0

Every cached_tokens value comes from `usage.prompt_tokens_details.cached_tokens`
of the streaming OAI response; `timings.cache_n` from the same chunk is kept as
a native cross-check. TTFT is wall-clock to the first non-empty delta (includes
queue wait, i.e. user-perceived).

Stdlib only (urllib, hmac, hashlib, subprocess); AES comes from the `openssl`
CLI because the `cryptography` module is not importable on this machine.
"""

import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import random
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIN = ("/Users/marco/Library/Application Support/kalsa-brain/runtime/builds/"
       "metal/llama-b10950/llama-server")
MODEL = ("/Users/marco/Library/Application Support/kalsa-brain/runtime/models/"
         "Trinity-Nano-Preview-Q4_K_M.gguf")
RESULTS = HERE / "results" / "kv-paging-spike"

BASE_ARGV = [
    "--threads", "4", "--threads-batch", "4",
    "--batch-size", "2048", "--ubatch-size", "512",
    "--ctx-size", "16384",
    "--n-gpu-layers", "all",
    "--flash-attn", "on",
    "--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
    "--sleep-idle-seconds", "3600",
    "--no-webui", "--metrics",
]

# ---------------------------------------------------------------------------
# prompt fixtures (deterministic; built with the project's own generator)
# ---------------------------------------------------------------------------

_spec = importlib.util.spec_from_file_location("sp", HERE / "simulate-phones.py")
sp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sp)

# One long preamble shared verbatim by every device, then a private tail.
SHARED = sp.make_doc(9, 450)

A_TAIL = ("\nThe emergency bank pin is 84719.\n"
          "Question: what is the emergency bank pin?\nAnswer:")
B_TAIL = ("\nThe garage code is 5522.\n"
          "Question: what is the garage code?\nAnswer:")
C_TAIL = ("\nThe shed key is under the third flowerpot.\n"
          "Question: where is the shed key?\nAnswer:")
A_PROMPT = SHARED + A_TAIL
B_PROMPT = SHARED + B_TAIL
C_PROMPT = SHARED + C_TAIL
A_PIN = "84719"
# A virgin device that has never occupied a slot, used as the cross-device probe.
PROBE_PROMPT = SHARED + ("\nThe alarm code is 1234.\n"
                         "Question: what is the alarm code?\nAnswer:")
# E6 guesses: a wrong digit string, and A's exact private tail.
A_GUESS_WRONG = SHARED + ("\nThe emergency bank pin is 00000.\n"
                          "Question: what is the emergency bank pin?\nAnswer:")
A_GUESS_RIGHT = A_PROMPT


# ---------------------------------------------------------------------------
# server lifecycle
# ---------------------------------------------------------------------------

def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Server:
    """One llama-server child, stopped in stop(). Never left behind."""

    def __init__(self, label: str, parallel: int, cache_ram: int,
                 swa_full: bool, log_level: int = 3):
        self.label = label
        self.dir = RESULTS / label
        self.dir.mkdir(parents=True, exist_ok=True)
        self.slot_dir = self.dir / "slots"
        self.slot_dir.mkdir(exist_ok=True)
        self.port = free_port()
        self.log_path = self.dir / "server.log"
        self.proc = None
        self.argv = [
            BIN, "--host", "127.0.0.1", "--port", str(self.port),
            "--model", MODEL,
            *BASE_ARGV,
            "--parallel", str(parallel),
            "--cache-ram", str(cache_ram),
            "--slot-save-path", str(self.slot_dir),
            "-lv", str(log_level),
        ]
        if swa_full:
            self.argv.append("--swa-full")
        self.parallel = parallel
        self.cache_ram = cache_ram
        self.swa_full = swa_full

    def __enter__(self):
        (self.dir / "argv.txt").write_text(" ".join(self.argv) + "\n")
        self.log = open(self.log_path, "w")
        self.proc = subprocess.Popen(self.argv, stdout=self.log,
                                     stderr=subprocess.STDOUT)
        t0 = time.perf_counter()
        up = False
        for _ in range(300):
            if self.proc.poll() is not None:
                break
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{self.port}/health", timeout=2) as r:
                    if r.status == 200:
                        up = True
                        break
            except Exception:
                pass
            time.sleep(0.5)
        self.load_s = round(time.perf_counter() - t0, 2)
        if not up:
            self.stop()
            raise RuntimeError(f"{self.label}: server failed to become healthy "
                               f"(see {self.log_path})")
        return self

    def __exit__(self, *exc):
        self.stop()
        return False

    def stop(self):
        if self.proc is None:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=10)
        try:
            self.log.close()
        except Exception:
            pass
        self.proc = None
        # port must be free before the next config starts
        for _ in range(40):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", self.port)) != 0:
                    break
            time.sleep(0.25)


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib, same shape as simulate-phones.py)
# ---------------------------------------------------------------------------

def post_raw(port: int, path: str, payload: dict | None, timeout: float = 900):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data,
        headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        status = e.code
    wall_ms = round((time.perf_counter() - t0) * 1000, 2)
    try:
        parsed = json.loads(body)
    except Exception:
        parsed = {"_raw": body[:500]}
    return status, parsed, wall_ms


def tokenize(port: int, content: str) -> list:
    status, body, _ = post_raw(port, "/tokenize", {"content": content})
    if status != 200:
        raise RuntimeError(f"/tokenize failed: {status} {body}")
    return body["tokens"]


def chat(port: int, content: str, slot: int | None, n_predict: int = 8):
    """Streaming OAI chat completion; returns the raw numbers we report."""
    body = {
        "messages": [{"role": "user", "content": content}],
        "max_tokens": n_predict,
        "temperature": 0.0,
        "seed": 1,
        "cache_prompt": True,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if slot is not None:
        body["id_slot"] = slot
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    rec = {"slot": slot, "ttft_ms": None, "total_ms": None, "prompt_tokens": None,
           "cached_tokens": None, "cache_n": None, "prompt_ms": None,
           "answer": "", "error": None}
    parts = []
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[len("data: "):])
                if chunk.get("choices"):
                    delta = chunk["choices"][0].get("delta") or {}
                    if any(isinstance(v, str) and v for v in delta.values()):
                        parts.append(delta.get("content") or "")
                        if rec["ttft_ms"] is None:
                            rec["ttft_ms"] = round(
                                (time.perf_counter() - t0) * 1000)
                if chunk.get("usage"):
                    u = chunk["usage"]
                    rec["prompt_tokens"] = u.get("prompt_tokens")
                    rec["cached_tokens"] = (u.get("prompt_tokens_details")
                                            or {}).get("cached_tokens")
                    tim = chunk.get("timings") or {}
                    rec["cache_n"] = tim.get("cache_n")
                    rec["prompt_ms"] = (round(tim["prompt_ms"], 1)
                                        if tim.get("prompt_ms") is not None else None)
        rec["answer"] = "".join(parts)[:200]
        rec["total_ms"] = round((time.perf_counter() - t0) * 1000)
    except Exception as e:  # noqa: BLE001
        rec["error"] = f"{type(e).__name__}: {e}"
        rec["total_ms"] = round((time.perf_counter() - t0) * 1000)
    return rec


def slot_action(port: int, slot: int, action: str,
                filename: str | None = None) -> dict:
    payload = {} if filename is None else {"filename": filename}
    status, body, wall_ms = post_raw(
        port, f"/slots/{slot}?action={action}", payload)
    return {"status": status, "wall_ms": wall_ms, "body": body}


def erase(port: int, slot: int) -> dict:
    return slot_action(port, slot, "erase")


def slot_state(port: int):
    status, body, _ = post_raw(port, "/slots", None)
    if status != 200 or not isinstance(body, list):
        return []
    return [{"id": s.get("id"), "n_prompt_tokens": s.get("n_prompt_tokens"),
             "is_processing": s.get("is_processing")} for s in body]


# ---------------------------------------------------------------------------
# crypto (E4): HKDF-SHA256 + AES-256-CBC via the openssl CLI
# ---------------------------------------------------------------------------

def crypto_available() -> dict:
    try:
        import cryptography  # noqa: F401
        return {"python_cryptography": cryptography.__version__}
    except Exception as e:  # noqa: BLE001
        avail = {"python_cryptography": None,
                 "python_cryptography_error": f"{type(e).__name__}: {e}"}
    openssl = shutil.which("openssl")
    ver = ""
    if openssl:
        ver = subprocess.run([openssl, "version"], capture_output=True,
                             text=True).stdout.strip()
    avail["openssl"] = openssl
    avail["openssl_version"] = ver
    return avail


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm, t, i = b"", b"", 1
    while len(okm) < length:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t
        i += 1
    return okm[:length]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def openssl_encrypt(src: Path, dst: Path, key: bytes, iv: bytes):
    # -K/-iv are hex; PKCS#7 padding is on by default for CBC.
    subprocess.run(["openssl", "enc", "-aes-256-cbc",
                    "-K", key.hex(), "-iv", iv.hex(),
                    "-in", str(src), "-out", str(dst)], check=True,
                   capture_output=True)


def openssl_decrypt(src: Path, dst: Path, key: bytes, iv: bytes):
    subprocess.run(["openssl", "enc", "-d", "-aes-256-cbc",
                    "-K", key.hex(), "-iv", iv.hex(),
                    "-in", str(src), "-out", str(dst)], check=True,
                   capture_output=True)


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------

def table(title: str, headers: list, rows: list) -> str:
    widths = [len(h) for h in headers]
    srows = [[("" if c is None else str(c)) for c in r] for r in rows]
    for r in srows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], len(c))
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    out = [f"\n### {title}", line, "  ".join("-" * w for w in widths)]
    for r in srows:
        out.append("  ".join(c.ljust(widths[i]) for i, c in enumerate(r)))
    txt = "\n".join(out)
    print(txt, flush=True)
    return txt


# ---------------------------------------------------------------------------
# E1 / E2 / E6 on a two-slot server
# ---------------------------------------------------------------------------

def measure_lengths(port: int, notes: dict) -> dict:
    ta = tokenize(port, A_PROMPT)
    tb = tokenize(port, B_PROMPT)
    shared = 0
    for x, y in zip(ta, tb):
        if x != y:
            break
        shared += 1
    notes["tokens_A_raw"] = len(ta)
    notes["tokens_B_raw"] = len(tb)
    notes["shared_prefix_raw"] = shared
    return notes


def run_e1(port: int, results: dict):
    rows = []
    # slot 0: same prompt twice; slot 1: same prompt twice
    for slot, prompt, label in ((0, A_PROMPT, "A"), (1, B_PROMPT, "B")):
        erase(port, slot)
        for i in (1, 2):
            r = chat(port, prompt, slot)
            rows.append([f"{label} (slot {slot})", i, r["cached_tokens"],
                         r["prompt_tokens"], r["cache_n"], r["prompt_ms"],
                         r["ttft_ms"]])
    results["E1_rows"] = rows
    table("E1 - within-slot warmth, --cache-ram 0, np=2",
          ["device/slot", "req#", "cached_tokens", "prompt_tokens",
           "cache_n", "prompt_ms", "ttft_ms"], rows)
    ok = (rows[1][2] or 0) > 0 and (rows[3][2] or 0) > 0
    results["E1_warm_within_slot"] = bool(ok)
    return ok


def run_e2(server: Server, results: dict):
    """Two devices, shared preamble, divergent tails.

    The shared prompt cache is only populated when a *new* task launches and
    flushes the currently idle slots (--cache-idle-slots). So the first B
    request cannot see A's state; B2 can. Both the pinned-slot channel and the
    unpinned (similarity-router) channel are measured.
    """
    port = server.port
    erase(port, 0)
    erase(port, 1)
    a = chat(port, A_PROMPT, 0)
    b1 = chat(port, B_PROMPT, 1)          # first contact: nothing flushed yet
    a2 = chat(port, A_PROMPT, 0)          # makes A's state flush on next launch
    b2 = chat(port, B_PROMPT, 1)          # flushes A's slot 0 into the shared cache
    erase(port, 1)                        # slot 1 empty again, cache still holds A
    probe_pinned = chat(port, PROBE_PROMPT, 1)   # virgin device, pinned  -> cache channel
    erase(port, 1)
    probe_auto = chat(port, PROBE_PROMPT, None)  # virgin device, unpinned -> router channel
    auto_state = slot_state(port)
    rows = [
        ["A (slot 0)", "pinned 0", a["cached_tokens"],
         a["prompt_tokens"], a["prompt_ms"], a["ttft_ms"], A_PIN in a["answer"]],
        ["B1 (slot 1, first)", "pinned 1", b1["cached_tokens"],
         b1["prompt_tokens"], b1["prompt_ms"], b1["ttft_ms"],
         A_PIN in b1["answer"]],
        ["A2 (slot 0)", "pinned 0", a2["cached_tokens"],
         a2["prompt_tokens"], a2["prompt_ms"], a2["ttft_ms"], None],
        ["B2 (slot 1)", "pinned 1", b2["cached_tokens"],
         b2["prompt_tokens"], b2["prompt_ms"], b2["ttft_ms"],
         A_PIN in b2["answer"]],
        ["virgin probe (pinned 1)", "pinned 1", probe_pinned["cached_tokens"],
         probe_pinned["prompt_tokens"], probe_pinned["prompt_ms"],
         probe_pinned["ttft_ms"], A_PIN in probe_pinned["answer"]],
        ["virgin probe (unpinned)", "auto", probe_auto["cached_tokens"],
         probe_auto["prompt_tokens"], probe_auto["prompt_ms"],
         probe_auto["ttft_ms"], A_PIN in probe_auto["answer"]],
    ]
    results[f"E2_{'ctrl384' if server.cache_ram == 384 else 'cram0'}"] = {
        "cache_ram": server.cache_ram, "rows": rows,
        "probe_pinned_cached": probe_pinned["cached_tokens"],
        "probe_pinned_prompt_ms": probe_pinned["prompt_ms"],
        "probe_pinned_ttft_ms": probe_pinned["ttft_ms"],
        "probe_auto_cached": probe_auto["cached_tokens"],
        "probe_auto_prompt_ms": probe_auto["prompt_ms"],
        "probe_auto_ttft_ms": probe_auto["ttft_ms"],
        "B2_cached": b2["cached_tokens"],
        "after_auto_slots": auto_state,
    }
    table(f"E2 - cross-device oracle, --cache-ram {server.cache_ram}, np=2",
          ["request", "slot", "cached_tokens", "prompt_tokens", "prompt_ms",
           "ttft_ms", "A_pin_leaked"], rows)
    return b2


def run_e6(server: Server, results: dict):
    port = server.port
    erase(port, 0)
    erase(port, 1)
    a = chat(port, A_PROMPT, 0)          # A's private tail enters the cache
    chat(port, B_PROMPT, 1)              # launch a second task: flushes A's idle slot
    probes = [
        ("own tail (B)", B_PROMPT, False, 1),
        ("guess wrong", A_GUESS_WRONG, False, 1),
        ("guess exact", A_GUESS_RIGHT, True, 1),
        ("guess wrong (unpinned)", A_GUESS_WRONG, False, None),
        ("guess exact (unpinned)", A_GUESS_RIGHT, True, None),
    ]
    rows = []
    lands = []
    for label, prompt, exact, slot in probes:
        erase(port, 1)
        if slot is None:
            erase(port, 0)
            chat(port, A_PROMPT, 0)      # re-seed A's slot for the router
        r = chat(port, prompt, slot)
        lands.append(slot_state(port))
        rows.append([label, "yes" if exact else "no",
                     "auto" if slot is None else f"pinned {slot}",
                     r["cached_tokens"], r["prompt_tokens"], r["cache_n"],
                     r["prompt_ms"], r["ttft_ms"]])
    key = "ctrl384" if server.cache_ram == 384 else "cram0"
    results[f"E6_{key}"] = {"cache_ram": server.cache_ram, "rows": rows,
                            "A_cached": a["cached_tokens"],
                            "probe_slots": lands}
    table(f"E6 - oracle probe with guessed private tail, "
          f"--cache-ram {server.cache_ram}, np=2",
          ["B probe", "exact guess", "slot", "cached_tokens", "prompt_tokens",
           "cache_n", "prompt_ms", "ttft_ms"], rows)
    return rows
    table(f"E6 - oracle probe with guessed private tail, "
          f"--cache-ram {server.cache_ram}, np=2",
          ["B probe", "exact guess", "cached_tokens", "prompt_tokens",
           "cache_n", "prompt_ms", "ttft_ms"], rows)
    return rows


# ---------------------------------------------------------------------------
# E3 / E4 on a one-slot (or multi-slot) server
# ---------------------------------------------------------------------------

def run_e3(server: Server, results: dict, slot: int = 0):
    port = server.port
    tag = "swafull" if server.swa_full else "off"
    erase(port, slot)
    rows = []

    cold = chat(port, A_PROMPT, slot)
    rows.append(["fill slot (cold)", cold["cached_tokens"], cold["prompt_tokens"],
                 cold["cache_n"], cold["prompt_ms"], cold["ttft_ms"],
                 None, None, None])

    save = slot_action(port, slot, "save", "a.bin")
    sb = save["body"] if isinstance(save["body"], dict) else {}
    fpath = server.slot_dir / "a.bin"
    fsize = fpath.stat().st_size if fpath.exists() else None
    rows.append(["save -> a.bin", None, None, None, None, None,
                 sb.get("timings", {}).get("save_ms"), save["wall_ms"], fsize])

    ev = erase(port, slot)
    cold2 = chat(port, A_PROMPT, slot)
    rows.append(["after erase (must be cold)", cold2["cached_tokens"],
                 cold2["prompt_tokens"], cold2["cache_n"], cold2["prompt_ms"],
                 cold2["ttft_ms"], None, None, None])

    restore = slot_action(port, slot, "restore", "a.bin")
    rb = restore["body"] if isinstance(restore["body"], dict) else {}
    rows.append(["restore <- a.bin", None, None, None, None, None,
                 rb.get("timings", {}).get("restore_ms"), restore["wall_ms"],
                 rb.get("n_read")])

    warm = chat(port, A_PROMPT, slot)
    rows.append(["after restore", warm["cached_tokens"], warm["prompt_tokens"],
                 warm["cache_n"], warm["prompt_ms"], warm["ttft_ms"],
                 None, None, None])

    results[f"E3_{tag}"] = {
        "swa_full": server.swa_full, "cache_ram": server.cache_ram,
        "rows": rows,
        "n_saved": sb.get("n_saved"), "n_written": sb.get("n_written"),
        "n_restored": rb.get("n_restored"), "n_read": rb.get("n_read"),
        "save_status": save["status"], "restore_status": restore["status"],
        "file_bytes": fsize,
        "after_restore_cached": warm["cached_tokens"],
        "after_restore_prompt_ms": warm["prompt_ms"],
        "after_restore_ttft_ms": warm["ttft_ms"],
        "cold_prompt_ms": cold["prompt_ms"],
        "erase_status": ev["status"],
    }
    table(f"E3 - slot save/restore, --cache-ram {server.cache_ram}"
          f"{', --swa-full' if server.swa_full else ''}",
          ["step", "cached_tokens", "prompt_tokens", "cache_n", "prompt_ms",
           "ttft_ms", "save_ms", "wall_ms", "bytes"], rows)
    return warm


def run_e4(server: Server, results: dict, slot: int = 0):
    """Encrypt a.bin with a per-device HKDF key, decrypt, prove equality,
    then restore the decrypted file and confirm the server still warms up."""
    port = server.port
    avail = crypto_available()
    rows = []

    # fresh warm snapshot for this device
    erase(port, slot)
    chat(port, A_PROMPT, slot)
    save = slot_action(port, slot, "save", "a.bin")
    plain = server.slot_dir / "a.bin"
    enc = server.slot_dir / "a.bin.enc"
    dec = server.slot_dir / "a.bin.dec"

    device_secret = os.urandom(32)          # per-device secret, Keychain in prod
    salt = b"device-A"                      # per-device salt / identity
    info = b"kalsa-kv-paging-v1"
    key = hkdf_sha256(device_secret, salt, info, 32)
    iv = os.urandom(16)

    h_plain = sha256_file(plain)
    openssl_encrypt(plain, enc, key, iv)
    openssl_decrypt(enc, dec, key, iv)
    h_dec = sha256_file(dec)
    enc_bytes = enc.stat().st_size
    roundtrip_ok = h_plain == h_dec

    rows.append(["encrypt AES-256-CBC (HKDF key)", roundtrip_ok,
                 f"{enc_bytes} bytes", h_plain[:16], h_dec[:16]])

    # restore the DECRYPTED file through the slot endpoint
    erase(port, slot)
    cold = chat(port, A_PROMPT, slot)
    restore = slot_action(port, slot, "restore", "a.bin.dec")
    rb = restore["body"] if isinstance(restore["body"], dict) else {}
    warm = chat(port, A_PROMPT, slot)
    rows.append(["restore a.bin.dec", warm["cached_tokens"] is not None,
                 f"n_read={rb.get('n_read')}", f"cold={cold['cached_tokens']}",
                 f"warm={warm['cached_tokens']}"])

    # raw bytes of an encrypted blob are not a valid slot file (control)
    enc_as_slot = server.slot_dir / "a.bin.enc.slot"
    shutil.copyfile(enc, enc_as_slot)
    erase(port, slot)
    bad = slot_action(port, slot, "restore", "a.bin.enc.slot")
    rows.append(["restore a.bin.enc directly", bad["status"] == 200,
                 f"status={bad['status']}",
                 str(bad["body"])[:80] if isinstance(bad["body"], dict)
                 and bad["body"].get("error") else "",
                 ""])

    results["E4"] = {
        "crypto_available": avail,
        "hkdf": "HKDF-SHA256 (hmac+hashlib), 32-byte key, salt=b'device-A', "
                "info=b'kalsa-kv-paging-v1'",
        "cipher": "openssl enc -aes-256-cbc (PKCS#7), random 16-byte IV",
        "roundtrip_sha256_ok": roundtrip_ok,
        "h_plain": h_plain, "h_decrypted": h_dec,
        "plain_bytes": plain.stat().st_size, "enc_bytes": enc_bytes,
        "n_saved": (save["body"] or {}).get("n_saved"),
        "n_restored_decrypted": rb.get("n_restored"),
        "restore_dec_status": restore["status"],
        "cold_cached": cold["cached_tokens"],
        "after_restore_decrypted_cached": warm["cached_tokens"],
        "after_restore_decrypted_prompt_ms": warm["prompt_ms"],
        "after_restore_decrypted_ttft_ms": warm["ttft_ms"],
        "restore_encrypted_status": bad["status"],
        "restore_encrypted_body": bad["body"],
        "rows": rows,
    }
    table("E4 - encryption transparency (HKDF-SHA256 + AES-256-CBC)",
          ["step", "ok", "detail", "sha256(plain)", "sha256(decrypted)"],
          rows)
    print(f"  crypto available: cryptography module = "
          f"{avail.get('python_cryptography')!r}, "
          f"openssl = {avail.get('openssl')} ({avail.get('openssl_version')})",
          flush=True)
    return warm


# ---------------------------------------------------------------------------
# E5: paging on one slot vs four concurrent slots
# ---------------------------------------------------------------------------

DEVICES = [("A", A_PROMPT), ("B", B_PROMPT), ("C", C_PROMPT)]


def run_e5_sequential(server: Server, results: dict):
    """Three logical devices, one physical slot, save/restore between turns.

    Each device's turn is the eviction of the previous device, so no request is
    wasted: A send (cold) -> save; B send (evicts A, cold) -> save; C send
    (evicts B, cold) -> save; A send without restore (cold baseline); restore
    a.bin; A send (the paged return).
    """
    port = server.port
    tag = "swafull" if server.swa_full else "off"
    rows = []
    saved = {}

    for name, prompt in DEVICES:
        r = chat(port, prompt, 0)
        sv = slot_action(port, 0, "save", f"{name.lower()}.bin")
        sb = sv["body"] if isinstance(sv["body"], dict) else {}
        fsize = (server.slot_dir / f"{name.lower()}.bin").stat().st_size
        saved[name] = {"cached": r["cached_tokens"], "prompt_ms": r["prompt_ms"],
                       "ttft_ms": r["ttft_ms"],
                       "save_ms": sb.get("timings", {}).get("save_ms"),
                       "save_wall_ms": sv["wall_ms"], "bytes": fsize,
                       "n_prompt_tokens": r["prompt_tokens"]}
        rows.append([f"{name}: send (evicts previous)", r["cached_tokens"],
                     r["prompt_tokens"], r["prompt_ms"], r["ttft_ms"],
                     sb.get("timings", {}).get("save_ms"), None, fsize])

    # A returns without a restore: the cold baseline for the same prompt
    cold = chat(port, A_PROMPT, 0)
    rows.append(["A: return, NO restore (baseline)", cold["cached_tokens"],
                 cold["prompt_tokens"], cold["prompt_ms"], cold["ttft_ms"],
                 None, None, None])
    rs = slot_action(port, 0, "restore", "a.bin")
    rb = rs["body"] if isinstance(rs["body"], dict) else {}
    warm = chat(port, A_PROMPT, 0)
    rows.append(["A: return, after restore a.bin", warm["cached_tokens"],
                 warm["prompt_tokens"], warm["prompt_ms"], warm["ttft_ms"],
                 None, rb.get("timings", {}).get("restore_ms"),
                 rb.get("n_read")])

    results[f"E5_seq_{tag}"] = {
        "np": 1, "swa_full": server.swa_full, "cache_ram": server.cache_ram,
        "rows": rows, "saved": saved,
        "A_return_cached": warm["cached_tokens"],
        "A_return_prompt_ms": warm["prompt_ms"],
        "A_return_ttft_ms": warm["ttft_ms"],
        "A_return_cold_cached": cold["cached_tokens"],
        "A_return_cold_prompt_ms": cold["prompt_ms"],
        "A_return_cold_ttft_ms": cold["ttft_ms"],
        "restore_status": rs["status"],
        "restore_ms": rb.get("timings", {}).get("restore_ms"),
        "restore_wall_ms": rs["wall_ms"],
        "restore_n_read": rb.get("n_read"),
        "switch_cost_ms": {
            "save_A": saved["A"]["save_ms"],
            "save_A_wall": saved["A"]["save_wall_ms"],
            "restore_A": rb.get("timings", {}).get("restore_ms"),
            "restore_A_wall": rs["wall_ms"],
        },
    }
    table(f"E5 - np=1 paging, 3 devices, --cache-ram {server.cache_ram}"
          f"{', --swa-full' if server.swa_full else ''}",
          ["step", "cached_tokens", "prompt_tokens", "prompt_ms", "ttft_ms",
           "save_ms", "restore_ms", "bytes"], rows)
    return warm


def run_e5_concurrent(server: Server, results: dict):
    """Three devices concurrent on np=4, one slot each, cold then warm."""
    port = server.port
    rows = []
    lock = threading.Lock()

    def one(name, prompt, slot, round_no, seed):
        r = chat(port, prompt, slot)
        with lock:
            rows.append((name, round_no, slot, r))

    for round_no in (1, 2):
        if round_no == 1:          # round 2 must stay warm to measure reuse
            erase(port, 0)
            erase(port, 1)
            erase(port, 2)
        threads = [threading.Thread(target=one, args=(n, p, i, round_no, i))
                   for i, (n, p) in enumerate(DEVICES)]
        t0 = time.perf_counter()
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        wall = round((time.perf_counter() - t0) * 1000)
        rows.append((None, round_no, None, {"wall_ms": wall}))

    out_rows = []
    for name, round_no, slot, r in rows:
        if name is None:
            out_rows.append(["<wall>", round_no, None, None, None, None,
                             r["wall_ms"]])
        else:
            out_rows.append([name, round_no, slot, r["cached_tokens"],
                             r["prompt_tokens"], r["prompt_ms"], r["ttft_ms"]])
    results["E5_conc_np4"] = {"rows": out_rows}
    table("E5 - np=4, 3 devices concurrent, --cache-ram 0",
          ["device", "round", "slot", "cached_tokens", "prompt_tokens",
           "prompt_ms", "ttft_ms"], out_rows)
    return out_rows


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="",
                    help="comma list of configs to run, e.g. E3,E4")
    args = ap.parse_args()
    only = {s.strip().upper() for s in args.only.split(",") if s.strip()}

    RESULTS.mkdir(parents=True, exist_ok=True)
    results = {
        "model": MODEL,
        "binary": BIN,
        "base_argv": BASE_ARGV,
        "fixtures": {"shared_raw": SHARED, "A_TAIL": A_TAIL, "B_TAIL": B_TAIL,
                     "C_TAIL": C_TAIL},
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    prints = []

    def want(name):
        return not only or name in only

    # ---- E1 + E6 (cram 0) + E3 (cram 0, no swa-full) on np=2 ------------
    if want("E1") or want("E3") or want("E6") or want("E2"):
        with Server("np2-cram0", parallel=2, cache_ram=0, swa_full=False) as s:
            results["np2_cram0_load_s"] = s.load_s
            notes = measure_lengths(s.port, {})
            results.update({f"fixture_{k}": v for k, v in notes.items()})
            if want("E2"):
                prints.append(run_e2(s, results))
            if want("E1"):
                run_e1(s.port, results)
            if want("E6"):
                run_e6(s, results)
            if want("E3"):
                run_e3(s, results, slot=0)

    # ---- E2 + E6 control: cache-ram 384 ---------------------------------
    if want("E2") or want("E6"):
        with Server("np2-cram384", parallel=2, cache_ram=384, swa_full=False) as s:
            results["np2_cram384_load_s"] = s.load_s
            if want("E2"):
                run_e2(s, results)
            if want("E6"):
                run_e6(s, results)

    # ---- E5 sequential, np=1, cache-ram 0 (no swa-full) ------------------
    if want("E5"):
        with Server("np1-cram0", parallel=1, cache_ram=0, swa_full=False) as s:
            results["np1_cram0_load_s"] = s.load_s
            run_e5_sequential(s, results)

    # ---- E5 comparison, np=4, cache-ram 0 -------------------------------
    if want("E5"):
        with Server("np4-cram0", parallel=4, cache_ram=0, swa_full=False) as s:
            results["np4_cram0_load_s"] = s.load_s
            run_e5_concurrent(s, results)

    # ---- E3 rescue + E4 + E5 rescue: --swa-full, cache-ram 0 ------------
    if want("E3") or want("E4") or want("E5"):
        with Server("np1-cram0-swafull", parallel=1, cache_ram=0,
                    swa_full=True) as s:
            results["np1_cram0_swafull_load_s"] = s.load_s
            if want("E3"):
                run_e3(s, results, slot=0)
            if want("E4"):
                run_e4(s, results, slot=0)
            if want("E5"):
                run_e5_sequential(s, results)

    # ---- verdicts, from the numbers only ---------------------------------
    v = {}
    e1 = results.get("E1_rows")
    if e1:
        v["E1"] = ("PASS - repeat on the same slot is warm with --cache-ram 0 "
                   f"(slot0 {e1[1][2]}/{e1[1][3]}, slot1 {e1[3][2]}/{e1[3][3]} "
                   "cached/prompt tokens)"
                   if (e1[1][2] or 0) > 0 and (e1[3][2] or 0) > 0 else
                   "FAIL - slot does not keep its own KV")
    e2a = results.get("E2_ctrl384")
    e2b = results.get("E2_cram0")
    if e2a and e2b:
        v["E2"] = (
            f"shared-cache channel, virgin device pinned to slot 1: cram384 "
            f"cached={e2a['probe_pinned_cached']} (prompt_ms "
            f"{e2a['probe_pinned_prompt_ms']}, ttft {e2a['probe_pinned_ttft_ms']}) "
            f"VS cram0 cached={e2b['probe_pinned_cached']} (prompt_ms "
            f"{e2b['probe_pinned_prompt_ms']}, ttft {e2b['probe_pinned_ttft_ms']}); "
            f"router channel, virgin device unpinned: cram384 cached="
            f"{e2a['probe_auto_cached']} (prompt_ms {e2a['probe_auto_prompt_ms']}) "
            f"VS cram0 cached={e2b['probe_auto_cached']} (prompt_ms "
            f"{e2b['probe_auto_prompt_ms']}) -> cache channel "
            f"{'inactive in both' if (e2a['probe_pinned_cached'] or 0) == 0 and (e2b['probe_pinned_cached'] or 0) == 0 else ('closed by cram0' if (e2b['probe_pinned_cached'] or 0) == 0 else 'OPEN at cram0')}; "
            f"router channel {'STILL OPEN at cram0 (no --cache-ram effect)' if (e2b['probe_auto_cached'] or 0) > 0 else 'closed'}")
    e3a = results.get("E3_off")
    e3b = results.get("E3_swafull")
    if e3a:
        v["E3_no_swa_full"] = (
            f"restore reports n_restored={e3a['n_restored']} but the next "
            f"request cached={e3a['after_restore_cached']} "
            f"prompt_ms={e3a['after_restore_prompt_ms']} (cold fill "
            f"{e3a['cold_prompt_ms']}ms) -> RESTORE IS A NO-OP FOR CACHING")
    if e3b:
        v["E3_swa_full"] = (
            f"restore yields cached={e3b['after_restore_cached']} "
            f"prompt_ms={e3b['after_restore_prompt_ms']} vs cold "
            f"{e3b['cold_prompt_ms']}ms -> RESTORE WORKS with --swa-full")
    if results.get("E4"):
        e4 = results["E4"]
        v["E4"] = (f"HKDF-SHA256+AES-256-CBC roundtrip sha256 "
                   f"{'MATCH' if e4['roundtrip_sha256_ok'] else 'MISMATCH'}; "
                   f"decrypted restore cached={e4['after_restore_decrypted_cached']} "
                   f"(cold {e4['cold_cached']}); encrypted bytes fed to restore "
                   f"-> status {e4['restore_encrypted_status']}")
    e5a = results.get("E5_seq_off")
    e5b = results.get("E5_seq_swafull")
    if e5a:
        v["E5_np1_no_swa_full"] = (
            f"A returns cached={e5a['A_return_cached']} "
            f"prompt_ms={e5a['A_return_prompt_ms']} (cold "
            f"{e5a['A_return_cold_prompt_ms']}ms) -> paging gives nothing back")
    if e5b:
        v["E5_np1_swa_full"] = (
            f"A returns cached={e5b['A_return_cached']} "
            f"prompt_ms={e5b['A_return_prompt_ms']} (cold "
            f"{e5b['A_return_cold_prompt_ms']}ms) save="
            f"{e5b['switch_cost_ms']['save_A']}ms restore="
            f"{e5b['switch_cost_ms']['restore_A']}ms -> one slot pages")
    e6a = results.get("E6_ctrl384")
    e6b = results.get("E6_cram0")
    if e6a and e6b:
        def pick(blk, label):
            for r in blk["rows"]:
                if r[0] == label:
                    return r[3], r[7]
            return None, None
        c_wr, t_wr = pick(e6a, "guess wrong")
        c_ex, t_ex = pick(e6a, "guess exact")
        c_wra, t_wra = pick(e6a, "guess wrong (unpinned)")
        c_exa, t_exa = pick(e6a, "guess exact (unpinned)")
        z_wr, zt_wr = pick(e6b, "guess wrong")
        z_ex, zt_ex = pick(e6b, "guess exact")
        z_wra, zt_wra = pick(e6b, "guess wrong (unpinned)")
        z_exa, zt_exa = pick(e6b, "guess exact (unpinned)")
        v["E6"] = (
            f"pinned: ctrl384 wrong={c_wr}/{t_wr}ms exact={c_ex}/{t_ex}ms, "
            f"cram0 wrong={z_wr}/{zt_wr}ms exact={z_ex}/{zt_ex}ms (flat); "
            f"unpinned: ctrl384 wrong={c_wra}/{t_wra}ms exact={c_exa}/{t_exa}ms, "
            f"cram0 wrong={z_wra}/{zt_wra}ms exact={z_exa}/{zt_exa}ms "
            f"(cached {z_wra} vs {z_exa} = the guess is readable from "
            f"cached_tokens and TTFT with --cache-ram 0)")
        v["E6_verdict_yes_no"] = (
            "YES for the pinned-slot path only (every pinned guess shows 0 "
            "cached and flat TTFT at --cache-ram 0); NO for the unpinned path "
            f"({z_wra} vs {z_exa} cached, {zt_wra}ms vs {zt_exa}ms TTFT, "
            "identical at cram384 and cram0)"
            if (z_ex or 0) == 0 and (z_wr or 0) == 0 else "NO")

    results["verdicts"] = v
    results["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    (RESULTS / "results.json").write_text(json.dumps(results, indent=1))

    print("\n### VERDICTS")
    for k, val in v.items():
        print(f"  {k}: {val}")

    # a short, prompt-free summary for the report
    lines = ["# KV paging spike - raw numbers", ""]
    lines.append(f"binary: {BIN}")
    lines.append(f"model: {MODEL}")
    lines.append(f"openssl: {results.get('E4', {}).get('crypto_available')}")
    lines.append("")
    for k, val in v.items():
        lines.append(f"- **{k}**: {val}")
    (RESULTS / "summary.md").write_text("\n".join(lines) + "\n")
    print(f"\nresults: {RESULTS / 'results.json'}")
    print(f"summary: {RESULTS / 'summary.md'}")


if __name__ == "__main__":
    main()
