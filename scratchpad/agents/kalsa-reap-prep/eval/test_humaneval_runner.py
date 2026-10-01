#!/usr/bin/env python3
"""Self-test for eval/run_humaneval.py — the audit B2 exploits must FAIL.

Drives run_sandboxed()/judge() directly (no server, no model): under the
old tests-first concatenation both audit exploits recorded PASS; under the
EvalPlus order (program first, tests after) + sentinel they must FAIL. A
timeout must kill the whole process group (audit M6), and judge() must
apply the truncation rules on canned replies (audit M5) — the <think> path
cannot be exercised by the 1.2B smoke model, so it is covered here.

Run: python3 eval/test_humaneval_runner.py  (exit 0 = all cases pass)
"""

import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import run_humaneval as rh  # noqa: E402

ENTRY = "add_one"
GOOD_IMPL = "def add_one(x):\n    return x + 1\n"
BAD_IMPL = "def add_one(x):\n    return x + 2\n"
TEST_SRC = "def check(candidate):\n    assert candidate(1) == 2\n    assert candidate(-1) == 0\n"
TIMEOUT = 30

ITEM = {"id": "he-test-000", "task_id": "selftest/0", "entry_point": ENTRY,
        "prompt": "def add_one(x):\n", "test": TEST_SRC}


def reply(content: str, finish: str = "stop", reasoning: str = "") -> dict:
    return {"content": content, "reasoning_content": reasoning,
            "tool_calls": [], "finish_reason": finish}


def check(name: str, got, want, log: list) -> None:
    ok = got == want
    print(f"{name}: got {got!r} want {want!r} -> {'ok' if ok else 'FAIL'}")
    if not ok:
        log.append(name)


def main() -> int:
    log = []

    # honest programs decide the normal way
    rc, tail, sent = rh.run_sandboxed(GOOD_IMPL, TEST_SRC, ENTRY, TIMEOUT)
    check("honest correct -> rc 0 + sentinel", (rc, sent), (0, True), log)
    check("honest wrong -> rc nonzero",
          rh.run_sandboxed(BAD_IMPL, TEST_SRC, ENTRY, TIMEOUT)[0] != 0, True, log)

    # audit exploit 1: a check() hijack plus a stub function must NOT pass
    hijack = "def check(candidate):\n    return None\n\n\n" + \
             "def add_one(x):\n    pass\n"
    rc, tail, sent = rh.run_sandboxed(hijack, TEST_SRC, ENTRY, TIMEOUT)
    check("check-hijack + stub -> FAIL", (rc == 0 and sent), False, log)
    # ...and the hijack must not punish an honest implementation either
    hijack_good = "def check(candidate):\n    return None\n\n\n" + GOOD_IMPL
    rc, tail, sent = rh.run_sandboxed(hijack_good, TEST_SRC, ENTRY, TIMEOUT)
    check("check-hijack inert for correct code -> PASS", (rc, sent), (0, True), log)

    # audit exploit 2: exiting 0 before the tests leaves no sentinel
    for exit_call in ("import sys; sys.exit(0)", "import os; os._exit(0)"):
        program = GOOD_IMPL + exit_call + "\n"
        rc, tail, sent = rh.run_sandboxed(program, TEST_SRC, ENTRY, TIMEOUT)
        check(f"{exit_call} before tests -> FAIL", (rc == 0 and sent), False, log)

    # a crippled print cannot fake the sentinel either
    crippled = "import builtins; builtins.print = lambda *a, **k: None\n\n" + GOOD_IMPL
    rc, tail, sent = rh.run_sandboxed(crippled, TEST_SRC, ENTRY, TIMEOUT)
    check("crippled print -> FAIL", (rc == 0 and sent), False, log)

    # audit M6: the timeout kills the process GROUP, not just the runner
    fork_bomb = ("import subprocess, sys, time\n"
                 "subprocess.Popen([sys.executable, '-c', "
                 "\"import time; time.sleep(600)  # HE-ORPHAN-MARKER\"])\n"
                 "time.sleep(600)\n")
    rc, tail, sent = rh.run_sandboxed(fork_bomb, TEST_SRC, ENTRY, 5)
    check("forking program -> TIMEOUT FAIL", (rc, sent), (124, False), log)
    import time
    time.sleep(0.5)
    orphan = subprocess.run(["pgrep", "-f", "HE-ORPHAN-MARKER"],
                            stdout=subprocess.DEVNULL).returncode
    check("grandchild killed with the group", orphan != 0, True, log)

    # judge() on canned replies: truncation rules (M5) — no model needed
    rec = rh.judge(reply("<think>partially", "length"), ITEM, TIMEOUT)
    check("unclosed <think> -> FAIL truncated",
          (rec["pass"], rec["truncated"]), (0, 1), log)
    rec = rh.judge(reply(GOOD_IMPL, "length"), ITEM, TIMEOUT)
    check("finish_reason length -> FAIL truncated (M5)",
          (rec["pass"], rec["truncated"]), (0, 1), log)
    rec = rh.judge(reply("<think>reasoning</think>" + GOOD_IMPL), ITEM, TIMEOUT)
    check("closed think + correct code -> PASS",
          (rec["pass"], rec["truncated"], rec["code"] == GOOD_IMPL.strip()),
          (1, 0, True), log)
    rec = rh.judge(reply(GOOD_IMPL, reasoning="hidden reasoning"), ITEM, TIMEOUT)
    check("reasoning_content recorded", rec["reasoning"], "hidden reasoning", log)
    rec = rh.judge(reply("no code here"), ITEM, TIMEOUT)
    check("no function definition -> FAIL",
          (rec["pass"], rec["error"]), (0, "no function definition in the reply"), log)

    # the Darwin refusal is main()'s job — exercise it through the CLI
    if sys.platform == "darwin":
        cli = subprocess.run(
            [sys.executable, str(pathlib.Path(rh.__file__)),
             "--holdout", "x", "--server", "http://127.0.0.1:1", "--out", "/tmp/he.json"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        check("darwin without --allow-host -> refused",
              (cli.returncode, "refusing" in cli.stderr), (2, True), log)

    print(f"\n{'ALL OK' if not log else 'FAILED: ' + ', '.join(log)}")
    return 1 if log else 0


if __name__ == "__main__":
    sys.exit(main())
