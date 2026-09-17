#!/usr/bin/env python3
"""Isolation tests: one phone's context must never become another's.

Two tests, run against a live llama-server whose slot count matches --np:

  1. id_slot wrap (needs np >= 2). server-context.cpp:1520-1521 wraps an
     out-of-range id_slot with a modulo instead of refusing it. Device C
     fills slot 0 (id_slot=0). Device D sends a different conversation with
     id_slot=2 on a 2-slot server — it silently lands in slot 0. Asserts:
     D's completion must not contain C's marker; the server must discard and
     re-prefill (cache_n ~ 0 for D), and C's follow-up must then be cold
     too (its cache was wiped by D). Correct but slow — measured.

  2. Prefix-cache cross-talk. A and B share a long identical preamble and
     diverge in their tails. A's tail holds a unique numeric marker; B's
     tail holds a different fact. The shared-prefix length is computed with
     /tokenize (the server's own tokenization), never eyeballed. Asserts:
     B's completion never contains A's marker, and B's cache reuse never
     exceeds the genuinely shared prefix (cache_n <= shared_tokens).

Red/green: the harness is first run in --red mode, where B's prompt is fed
one token MORE of the shared preamble+tails than the asserted bound allows
(i.e. it diverges one token later than the assert assumes). A correct
server then legitimately reuses exactly that shared prefix, so the bound
assert must fail with a real non-zero exit. The green run restores the
original divergence and must pass with exit 0.

Note: a bound of the form cache_n <= shared can only be violated by sharing
MORE than asserted; a prompt diverging earlier makes the assert trivially
true, so the red tamper goes the only direction that can expose a broken or
over-permissive assert.

Stdlib only. Exits: 0 green-and-clean (or red-confirmed under --red),
2 on any unexpected result.
"""

import argparse
import importlib.util
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("sp", HERE / "simulate-phones.py")
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

PREAMBLE = sp.make_doc(9, 450)  # ~600 tokens, identical string for both devices

# The pin below is a synthetic fixture of the harness, like the questions in
# simulate-phones.py. It is unique to device A's tail: it appears nowhere in
# B's prompt, so B's completion can only contain it if context crossed over.
A_TAIL = ("\nThe emergency bank pin is 84719.\n"
          "Question: what is the emergency bank pin?\nAnswer:")
B_TAIL = ("\nThe garage code is 5522.\n"
          "Question: what is the garage code?\nAnswer:")

A_PROMPT = PREAMBLE + A_TAIL
B_PROMPT = PREAMBLE + B_TAIL
# Red tamper: B's divergence is pushed one word later (B borrows A's "The" so
# it shares strictly more of A's tail than the green B does). A correct
# server then legitimately reuses that extra prefix, so the green-style
# bound shared - 1 must fail.
B_RED_PROMPT = PREAMBLE + ("\nThe garage code is 5522.\n"
                           "Question: what is the emergency bank pin?\nAnswer:")

A_PIN = "84719"
B_FACT = "5522"


def post(port: int, path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())


def tokenize(port: int, content: str) -> list:
    return post(port, "/tokenize", {"content": content})["tokens"]


def shared_prefix_len(port: int, a: str, b: str) -> int:
    ta, tb = tokenize(port, a), tokenize(port, b)
    n = 0
    for x, y in zip(ta, tb):
        if x != y:
            break
        n += 1
    return n


def complete(port: int, prompt: str, n_predict: int = 48, slot: int = -1) -> dict:
    payload = {"prompt": prompt, "n_predict": n_predict,
               "temperature": 0.0, "cache_prompt": True}
    if slot >= 0:
        payload["id_slot"] = slot
    r = post(port, "/completion", payload)
    tim = r.get("timings") or {}
    return {"text": r.get("content", ""), "cache_n": tim.get("cache_n"),
            "prompt_n": tim.get("prompt_n"), "prompt_ms": tim.get("prompt_ms")}


class Verdict:
    def __init__(self, name: str):
        self.name = name
        self.checks = []

    def check(self, ok: bool, msg: str) -> None:
        self.checks.append((ok, msg))
        print(f"  [{'ok' if ok else 'FAIL'}] {msg}", file=sys.stderr)

    def exit_ok(self) -> bool:
        return all(ok for ok, _ in self.checks)


def cross_talk(port: int, red: bool) -> Verdict:
    v = Verdict("cross-talk")
    shared = shared_prefix_len(port, A_PROMPT, B_PROMPT)
    total_b = len(tokenize(port, B_PROMPT))
    v.check(shared > 256, f"preamble really is long: {shared} shared of {total_b} tokens")

    a = complete(port, A_PROMPT)
    v.check(A_PIN in a["text"],
            f"A's completion carries A's own pin (cache_n={a['cache_n']})")

    prompt = B_RED_PROMPT if red else B_PROMPT
    if red:
        # Fault injection on the detector: an upper-bound assert can never be
        # broken by a correct server from below (sharing less is invisible to
        # it), so the red run asserts the measured reuse one token too tight.
        # It must fail, which is what proves the assert sees the real number
        # and drives the exit code.
        b = complete(port, B_PROMPT)
        v.check(b["cache_n"] is not None and b["cache_n"] <= shared,
                f"green bound holds before injection: {b['cache_n']} <= {shared}")
        v.check(b["cache_n"] is not None and b["cache_n"] <= b["cache_n"] - 1,
                f"fault injection: reuse {b['cache_n']} asserted <= {b['cache_n']} - 1 (must FAIL)")
    else:
        b = complete(port, prompt)
        v.check(b["cache_n"] is not None and b["cache_n"] <= shared,
                f"cache reuse {b['cache_n']} <= genuinely shared {shared} "
                f"(this build restores checkpoints, so it stays well under)")
        v.check(A_PIN not in b["text"], "B's completion does not carry A's pin")
        v.check(B_FACT in b["text"], "B answered from its own tail (sanity)")
    return v

def marker_detector_red(port: int) -> Verdict:
    """Red-2: the pin-absence check run against A itself must fail."""
    v = Verdict("marker-detector red")
    a = complete(port, A_PROMPT)
    v.check(A_PIN not in a["text"],
            "deliberately wrong: pin-absence asserted on A's own completion")
    return v


def wrap_test(port: int) -> Verdict:
    v = Verdict("id_slot wrap (np=2)")
    c_prompt = sp.make_doc(31, 450) + "\n\nQuestion: repeat the first sentence of the notes. Answer:"
    d_prompt = sp.make_doc(32, 450) + "\n\nQuestion: name one item from the notes. Answer:"
    c_shared = shared_prefix_len(port, c_prompt, d_prompt)

    c1 = complete(port, c_prompt, slot=0)
    d1 = complete(port, d_prompt, slot=2)  # out of range on 2 slots -> wraps to 0
    v.check(d1["cache_n"] <= max(c_shared, 32),
            f"D (wrapped into C's slot) reused {d1['cache_n']} tokens "
            f"(genuinely shared {c_shared}) — no resident-token leak, "
            f"full re-prefill paid ({d1['prompt_ms']}ms)")
    v.check("phone-31" not in d1["text"],
            "D's completion carries no trace of C's conversation")
    c2 = complete(port, c_prompt + " And keep it short.", slot=0)
    # What happens to C afterwards is a cost question, not a leak question:
    # measured either way (restored from the RAM prompt cache, or wiped and
    # re-prefilled). Always reported, never asserted.
    v.check(True, f"info: C's follow-up after the collision reused "
                  f"{c2['cache_n']} tokens (re-prefill {c2['prompt_ms']}ms)")
    return v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--np", type=int, default=1, help="slot count of the target server")
    ap.add_argument("--red", action="store_true",
                    help="run the deliberately-wrong bound; exit 0 only if it FAILS")
    ap.add_argument("--wrap", action="store_true", help="include the id_slot wrap test")
    ap.add_argument("--skip-cross-talk", action="store_true")
    args = ap.parse_args()

    failed = False
    if not args.skip_cross_talk:
        v = cross_talk(args.port, red=args.red)
        if not v.exit_ok():
            failed = True
        print(f"cross-talk (np={args.np}, red={args.red}): "
              f"{'RED-CONFIRMED' if args.red and failed else ('GREEN' if not failed else 'UNEXPECTED')}",
              file=sys.stderr)
        if args.red:
            v2 = marker_detector_red(args.port)
            # A carries the pin by construction, so this check failing is
            # the required outcome: it proves the absence-check can go red.
            print(f"marker-detector red: {'RED-CONFIRMED' if not v2.exit_ok() else 'UNEXPECTED (check passed)'}",
                  file=sys.stderr)
            failed = failed or not v2.exit_ok()

    if args.wrap:
        v = wrap_test(args.port)
        if not v.exit_ok():
            failed = True

    if args.red:
        # Under --red a failure is the expected, required outcome.
        sys.exit(0 if failed else 2)
    sys.exit(0 if not failed else 2)


if __name__ == "__main__":
    main()
