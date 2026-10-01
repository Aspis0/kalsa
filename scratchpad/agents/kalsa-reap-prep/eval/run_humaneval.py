#!/usr/bin/env python3
"""HumanEval+ pass@1 with sandboxed execution (DESIGN.md §4 item 3).

164 problems from eval/humaneval-164.jsonl (build_humaneval_holdout.py:
EvalPlus base+plus tests merged). Greedy via the llama.cpp server's
/v1/chat/completions, thinking on (product parity).

Scoring follows the EvalPlus order: the model's program is exec'd FIRST and
the test source — which defines check() — is appended AFTER it, so model
code cannot shadow check(); then check(entry_point) runs and a sentinel
line prints. An item PASSES only if the subprocess exits 0 AND the sentinel
appears on stdout: a sys.exit(0)/os._exit(0) or a crippled print before the
tests leaves no sentinel and the item FAILS (audit B2). finish_reason
"length" and an unclosed <think> at the cap are FAILs decided before any
model code runs (run_gen_eval.py parity, and the docstring's old promise —
audit M5).

Execution safety — BEST-EFFORT isolation for the disposable pod, NOT a
containment boundary (audit H1):
  - the harness process never runs model code; one subprocess per problem
  - child env is replaced (no HF token, no proxy vars) and PATH is
    /nonexistent so PATH-based lookup of curl/git/ssh fails
  - rlimits (CPU, AS 2 GB, FSIZE 16 MB, NPROC 16) are set at runner start
    where the OS supports them; a root child may re-raise soft limits
  - the timeout kills the whole process GROUP (start_new_session +
    killpg), so a fork cannot leak grandchildren (audit M6)
  - KNOWN BYPASSES: import _socket, absolute-path binaries like
    /usr/bin/curl, absolute-path writes. On macOS this tool refuses to run
    unless --allow-host is passed. Run it only on a disposable pod.

Output shape (NOT run_gen_eval's): items are {id, task_id, pass,
finish_reason, truncated, raw, reasoning, code, error}, top-level
{dataset, model, max_tokens, timeout_s, n, ok, truncated, items}.
Items append to <out>.journal as they complete; a rerun skips done ids
(audit H4). eval/bootstrap_ci.py pairs items by id, which this shape has.

Usage: run_humaneval.py --holdout humaneval-164.jsonl --server URL --out r.json
                       [--limit N] [--max-tokens 8192] [--timeout 60]
                       [--concurrency N]
"""

import argparse
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

import journal as journal_mod
import server

FENCE_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.S)
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
UNCLOSED_THINK_RE = re.compile(r"<think>(?!.*?</think>)", re.S)

SENTINEL = "__EVALPLUS_TESTS_RAN__"
RLIMIT_BYTES = 2 << 30  # RLIMIT_AS: EvalPlus plus-tests import numpy; 2 GB is ample
RUNNER_PREFIX = f"""\
# best-effort isolation; see run_humaneval.py docstring for the known bypasses
import os
try:
    import resource
    _cpu = int(os.environ["HE_TIMEOUT"]) + 10
    for _res, _lim in (("RLIMIT_AS", {RLIMIT_BYTES}), ("RLIMIT_FSIZE", 16 << 20),
                       ("RLIMIT_NPROC", 16), ("RLIMIT_CPU", _cpu)):
        _hard = resource.getrlimit(getattr(resource, _res))[1]
        resource.setrlimit(getattr(resource, _res), (min(_lim, _hard), _hard))
except (ImportError, AttributeError, ValueError, OSError):
    pass  # kernel without some of these rlimits — isolation is best-effort
"""


def extract_code(reply: str, entry_point: str) -> str | None:
    """Last fenced block wins (models often restate code); raw text fallback."""
    blocks = FENCE_RE.findall(reply)
    code = blocks[-1].strip() if blocks else reply.strip()
    if f"def {entry_point}" in code:
        return code
    return None  # signature missing — a completion without the function is a miss


def run_sandboxed(program: str, test_src: str, entry_point: str,
                  timeout: int) -> tuple[int, str, bool]:
    """Exec program THEN tests (EvalPlus order); returns (rc, tail, sentinel).

    The sentinel is printed by the harness tail after check() — only a run
    that reached the end of the tests can print it.
    """
    with tempfile.TemporaryDirectory(prefix="humaneval-") as tmp:
        runner = pathlib.Path(tmp) / "runner.py"
        runner.write_text(RUNNER_PREFIX + program + "\n" + test_src +
                          f"\ncheck({entry_point})\nprint('{SENTINEL}')\n",
                          encoding="utf-8")
        outf = pathlib.Path(tmp) / "out.txt"
        with open(outf, "w", encoding="utf-8") as out:
            p = subprocess.Popen(
                [sys.executable, "-I", str(runner)], cwd=tmp,
                env={"PATH": "/nonexistent", "HOME": tmp, "TMPDIR": tmp,
                     "PYTHONDONTWRITEBYTECODE": "1", "HE_TIMEOUT": str(timeout)},
                stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                start_new_session=True)
        try:
            rc = p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)  # group, not just child
            except ProcessLookupError:
                pass
            p.wait()
            return 124, f"TIMEOUT after {timeout}s", False
        # file, not pipe: a print-flood cannot buffer unbounded in the harness
        text = outf.read_text(encoding="utf-8", errors="replace")[-65536:]
        lines = [l for l in text.strip().splitlines() if l.strip()]
        return rc, lines[-1] if lines else "", SENTINEL in text


def judge(reply: dict, item: dict, timeout: int) -> dict:
    content = reply["content"]
    unclosed = bool(UNCLOSED_THINK_RE.search(content))
    truncated = reply["finish_reason"] == "length" or unclosed
    rec = {"id": item["id"], "task_id": item["task_id"], "pass": 0,
           "finish_reason": reply["finish_reason"], "truncated": int(truncated),
           "raw": content, "reasoning": reply["reasoning_content"],
           "code": None, "error": ""}
    if truncated:
        rec["error"] = ("unclosed <think> at the token cap" if unclosed
                        else "truncated at the token cap (finish_reason=length)")
        return rec
    code = extract_code(THINK_RE.sub("", content), item["entry_point"])
    if code is None:
        rec["error"] = "no function definition in the reply"
        return rec
    rec["code"] = code
    rc, tail, sentinel = run_sandboxed(code, item["test"], item["entry_point"], timeout)
    if rc == 0 and sentinel:
        rec["pass"] = 1
    elif rc == 0:
        rec["error"] = f"exited 0 before the tests (sentinel missing): {tail}"
    else:
        rec["error"] = tail if tail else f"rc={rc}"
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--server", required=True, help="llama-server base URL")
    ap.add_argument("--out", required=True, help="per-item JSON incl. raw code")
    ap.add_argument("--max-tokens", type=int, default=8192)
    ap.add_argument("--timeout", type=int, default=60,
                    help="per-problem test-run timeout, seconds")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=1,
                    help="parallel requests — set to the server's -np slot count")
    ap.add_argument("--allow-host", action="store_true",
                    help="run on this macOS host anyway (the sandbox is "
                         "best-effort; meant for the disposable pod)")
    a = ap.parse_args()
    if sys.platform == "darwin" and not a.allow_host:
        ap.error("refusing to execute model code on macOS — the sandbox is "
                 "best-effort, not containment. Pass --allow-host to override.")

    items = [json.loads(l) for l in open(a.holdout, encoding="utf-8")]
    if a.limit:
        items = items[: a.limit]
    jrnl = journal_mod.Journal(pathlib.Path(a.out + ".journal"),
                               [it["id"] for it in items])
    pending = [it for it in items if it["id"] not in jrnl.done_ids]
    done = len(items) - len(pending)

    def work(item: dict) -> dict:
        reply = server.chat(a.server, [{"role": "user", "content": (
            "Complete the following Python function. Reply with ONLY a single "
            "```python code block containing the complete function, no tests, "
            "no example calls.\n\n```python\n" + item["prompt"])}],
            a.max_tokens)
        return judge(reply, item, a.timeout)

    if a.concurrency <= 1:
        for i, item in enumerate(pending):
            rec = work(item)
            jrnl.append(rec)
            print(f"[{done + i + 1}/{len(items)}] {item['task_id']} -> "
                  f"{'PASS' if rec['pass'] else 'FAIL'}"
                  f"{'' if rec['pass'] else ' (' + rec['error'][:60] + ')'}", flush=True)
    else:
        with ThreadPoolExecutor(max_workers=a.concurrency) as ex:
            futs = [ex.submit(work, it) for it in pending]
            for i, fut in enumerate(as_completed(futs), start=done + 1):
                rec = fut.result()
                jrnl.append(rec)
                print(f"[{i}/{len(items)}] {rec['task_id']} -> "
                      f"{'PASS' if rec['pass'] else 'FAIL'}"
                      f"{'' if rec['pass'] else ' (' + rec['error'][:60] + ')'}", flush=True)
    jrnl.close()

    records = jrnl.records()
    ok = sum(r["pass"] for r in records)
    truncated = sum(r["truncated"] for r in records)
    pathlib.Path(a.out).write_text(json.dumps({
        "dataset": "humanevalplus", "model": a.server,
        "max_tokens": a.max_tokens, "timeout_s": a.timeout,
        "n": len(records), "ok": ok, "truncated": truncated,
        "items": records}, indent=1))
    print(f"\nhumanevalplus: {ok}/{len(records)} = {ok / max(1, len(records)):.3f}"
          f", truncated {truncated}"
          f" (raw outputs -> {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
