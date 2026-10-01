#!/usr/bin/env python3
"""HumanEval+ pass@1 with sandboxed execution (DESIGN.md §4 item 3).

164 problems from eval/humaneval-164.jsonl (build_humaneval_holdout.py:
EvalPlus base+plus tests merged). Greedy via
the llama.cpp server's /v1/chat/completions, thinking on (product parity).

Execution safety (the harness process NEVER runs model code):
  - one subprocess per problem, `python -I runner.py`, cwd = fresh temp dir,
    stdin devnull, minimal env (no network proxy vars, temp HOME)
  - the runner disables socket.socket / create_connection / getaddrinfo
    before the untrusted code is defined — accidental network use raises
  - per-problem timeout (--timeout, default 60 s, the EvalPlus convention):
    the whole check(candidate) bundle runs in that one subprocess; a hang is
    a kill and a FAIL (the plus tests are loop-based, so per-assert timeouts
    are not possible without rewriting the tests)
  - finish_reason "length" or an unclosed <think> at the cap = FAIL, like
    run_gen_eval.py

Output JSON matches run_gen_eval.py's shape ({id, pass, finish_reason, raw}),
so eval/bootstrap_ci.py pairs it unchanged. Seed: every request carries
temperature 0 + seed 42.

Usage: run_humaneval.py --holdout humaneval-164.jsonl --server URL --out r.json
                        [--limit N] [--max-tokens 8192] [--timeout 60]
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.request

FENCE_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.S)
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
UNCLOSED_THINK_RE = re.compile(r"<think>(?!.*?</think>)", re.S)

RUNNER_PREFIX = """\
import socket

class _NoSocket(socket.socket):
    def __init__(self, *_a, **_k):
        raise OSError("network disabled (eval sandbox)")

# a socket SUBCLASS still works (ssl.py does `class SSLSocket(socket)`), but
# any real socket creation raises before a packet can leave
socket.socket = _NoSocket


def _no_net(*_a, **_k):
    raise OSError("network disabled (eval sandbox)")

socket.create_connection = _no_net
socket.getaddrinfo = _no_net
"""


def chat(server: str, prompt: str, max_tokens: int) -> dict:
    body = {"messages": [{"role": "user", "content": (
        "Complete the following Python function. Reply with ONLY a single "
        "```python code block containing the complete function, no tests, "
        "no example calls.\n\n```python\n" + prompt)}],
        "temperature": 0.0, "max_tokens": max_tokens, "seed": 42,
        "stream": False}
    req = urllib.request.Request(
        f"{server}/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        msg = json.load(r)["choices"][0]
    return {"content": msg.get("message", {}).get("content", "") or "",
            "finish_reason": msg.get("finish_reason", "")}


def extract_code(reply: str, entry_point: str) -> str | None:
    """Last fenced block wins (models often restate code); raw text fallback."""
    blocks = FENCE_RE.findall(reply)
    code = blocks[-1].strip() if blocks else reply.strip()
    if f"def {entry_point}" in code:
        return code
    return None  # signature missing — a completion without the function is a miss


def run_sandboxed(program: str, test_src: str, entry_point: str,
                  timeout: int) -> tuple[int, str]:
    """Returns (exit_code, tail_of_output); 0 = all tests passed."""
    with tempfile.TemporaryDirectory(prefix="humaneval-") as tmp:
        runner = pathlib.Path(tmp) / "runner.py"
        runner.write_text(
            RUNNER_PREFIX + test_src + "\n" + program +
            f"\ncheck({entry_point})\n", encoding="utf-8")
        try:
            out = subprocess.run(
                [sys.executable, "-I", str(runner)], cwd=tmp,
                env={"PATH": "/usr/bin:/bin", "HOME": tmp, "TMPDIR": tmp,
                     "PYTHONDONTWRITEBYTECODE": "1"},
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                timeout=timeout)
        except subprocess.TimeoutExpired:
            return 124, f"TIMEOUT after {timeout}s"
        tail = (out.stdout + out.stderr).strip().splitlines()
        return out.returncode, tail[-1] if tail else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--server", required=True, help="llama-server base URL")
    ap.add_argument("--out", required=True, help="per-item JSON incl. raw code")
    ap.add_argument("--max-tokens", type=int, default=8192)
    ap.add_argument("--timeout", type=int, default=60,
                    help="per-problem test-run timeout, seconds")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    items = [json.loads(l) for l in open(a.holdout, encoding="utf-8")]
    if a.limit:
        items = items[: a.limit]

    results = []
    for i, item in enumerate(items):
        entry = item["entry_point"]
        r = chat(a.server, item["prompt"], a.max_tokens)
        code, error = None, ""
        if UNCLOSED_THINK_RE.search(r["content"]):
            hit, error = False, "unclosed <think> at the token cap"
        else:
            code = extract_code(THINK_RE.sub("", r["content"]), entry)
            if code is None:
                hit, error = False, "no function definition in the reply"
            else:
                rc, error = run_sandboxed(code, item["test"], entry, a.timeout)
                hit = rc == 0
        results.append({"id": item["id"], "task_id": item["task_id"],
                        "pass": int(hit), "finish_reason": r["finish_reason"],
                        "raw": r["content"], "code": code, "error": error})
        print(f"[{i + 1}/{len(items)}] {item['task_id']} -> "
              f"{'PASS' if hit else 'FAIL'}"
              f"{'' if hit else f' ({error[:60]})'}", flush=True)

    ok = sum(r["pass"] for r in results)
    truncated = sum(1 for r in results if r["finish_reason"] == "length")
    pathlib.Path(a.out).write_text(json.dumps({
        "dataset": "humanevalplus", "model": a.server,
        "max_tokens": a.max_tokens, "timeout_s": a.timeout,
        "n": len(results), "ok": ok, "truncated": truncated,
        "items": results}, indent=1))
    print(f"\nhumanevalplus: {ok}/{len(results)} = {ok / max(1, len(results)):.3f}"
          f" (raw outputs -> {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
