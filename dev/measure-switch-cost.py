#!/usr/bin/env python3
"""The price of a conversation switch on one slot (design A).

For each conversation size, two fixed prompts A and B (different content,
same token count). Sequence per size:

  A0  first send of A            (cold, discarded)
  A1  A again                    (warm baseline: identical prompt, cache full)
  B0  B                          (the switch away)
  A2  A again                    (the switch back: same tokens, cache gone)
  A3  A again                    (warm confirm)

A2 vs A1 isolates the switch: same prompt tokens, only the cache state
differs. Server-side timings (prompt_ms, prompt_n, cache_n) are queue-free;
client wall time is also recorded. Stdlib only.
"""

import argparse
import importlib.util
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("sp", HERE / "simulate-phones.py")
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

QUESTION = "\n\nQuestion: name three items from the notes above. Answer briefly:"


def post(port: int, payload: dict) -> dict:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/completion",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())


def tokenize(port: int, content: str) -> list:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/tokenize",
        data=json.dumps({"content": content}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())["tokens"]


def send(port: int, prompt: str, n_predict: int, label: str) -> dict:
    t0 = time.perf_counter()
    r = post(port, {"prompt": prompt, "n_predict": n_predict,
                    "temperature": 0.0, "cache_prompt": True})
    total_ms = round((time.perf_counter() - t0) * 1000)
    tim = r.get("timings") or {}
    return {
        "label": label,
        "tokens_evaluated": r.get("tokens_evaluated"),
        "cache_n": tim.get("cache_n"),
        "prompt_n": tim.get("prompt_n"),
        "prompt_ms": tim.get("prompt_ms"),
        "total_ms": total_ms,
        "stop_type": r.get("stop_type"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--sizes-words", default="1500,6100,12000",
                    help="doc-words per conversation, comma separated (~1.3 tokens/word)")
    ap.add_argument("--n-predict", type=int, default=16)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    results = {"sizes": []}
    for words in [int(w) for w in args.sizes_words.split(",")]:
        doc_a = sp.make_doc(101, words)
        doc_b = sp.make_doc(202, words)
        prompt_a = doc_a + QUESTION
        prompt_b = doc_b + QUESTION
        toks_a = len(tokenize(args.port, prompt_a))
        toks_b = len(tokenize(args.port, prompt_b))

        seq = []
        for label, prompt in [("A0-cold", prompt_a), ("A1-warm", prompt_a),
                              ("B0-switch-away", prompt_b), ("A2-switch-back", prompt_a),
                              ("A3-warm-confirm", prompt_a)]:
            r = send(args.port, prompt, args.n_predict, label)
            r["prompt_tokens"] = toks_a if prompt is prompt_a else toks_b
            seq.append(r)
            print(f"words={words} {label}: cached={r['cache_n']} "
                  f"prompt_n={r['prompt_n']} prompt_ms={r['prompt_ms']} "
                  f"total={r['total_ms']}ms", file=sys.stderr)

        warm = next(r for r in seq if r["label"] == "A1-warm")
        back = next(r for r in seq if r["label"] == "A2-switch-back")
        results["sizes"].append({
            "doc_words": words,
            "prompt_tokens_a": toks_a,
            "prompt_tokens_b": toks_b,
            "sequence": seq,
            "switch_penalty_ms": (back["total_ms"] or 0) - (warm["total_ms"] or 0),
            "switch_penalty_prompt_ms": (back["prompt_ms"] or 0) - (warm["prompt_ms"] or 0),
        })

    with open(args.out, "w") as f:
        json.dump(results, f, indent=1)
    for s in results["sizes"]:
        print(f"size~{s['prompt_tokens_a']}tok: switch re-prefill "
              f"{s['switch_penalty_prompt_ms']}ms (server-side)")


if __name__ == "__main__":
    main()
