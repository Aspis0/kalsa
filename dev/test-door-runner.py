#!/usr/bin/env python3
"""The runner's two failure contracts: no orphaned child, no leaked secret.

Both findings are Reviewer A's, proven live against the previous code.

  (1) G2 - Ctrl-C during startup left the runner ALIVE: `runner = None`
      in main() is assigned only after start_door_runner() returns, and
      that function caught `Exception`, not `BaseException`, so a
      KeyboardInterrupt mid-wait skipped the cleanup and the child
      outlived the harness (HARNESS_EXIT=-2;
      RUNNER_SURVIVED_AFTER_SIGINT=True). The test drives the REAL
      start_door_runner against a fake runner that writes its pid and
      NEVER prints the listening line, injects KeyboardInterrupt while
      the wait is in progress (a Thread.join wrapper, restored after),
      and asserts BOTH that the KeyboardInterrupt propagates unchanged
      AND that the child is dead (pid checked with os.kill(pid, 0)).

  (2) G3 - on a startup failure the refusal message quotes the child's
      first stdout line and up to 300 chars of stderr, so a runner that
      echoes stdin would put a credential into an exception. The test runs
      start_door_runner against a fake that echoes every credential it
      receives to BOTH stdout and stderr and exits 1, with
      secrets.token_hex pinned to known values, and asserts the
      SystemExit text contains none of them - full, 16-hex prefix - while
      still naming the scrub ([scrubbed]) and the failure. The artifact
      side (credentials/salts never reach records) is
      dev/test-door-harness.py (7)'s, not this file's.

Exit 0 green, 1 red, 2 cannot run (measure-concurrency.py missing).
Run: python3 dev/test-door-runner.py
"""

import importlib.util
import os
import secrets
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MC = HERE / "measure-concurrency.py"

if not MC.exists():
    print(f"cannot run: missing {MC}", file=sys.stderr)
    sys.exit(2)

spec = importlib.util.spec_from_file_location("mconc", MC)
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)

FAILED = 0


def check(name, ok, detail=""):
    global FAILED
    if not ok:
        FAILED += 1
    print(f"  [{'ok' if ok else 'FAIL'}] {name}"
          + (f": {detail}" if detail else ""), file=sys.stderr)


def raised(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except BaseException as e:
        return e
    return None


SILENT_RUNNER = """#!/usr/bin/env python3
import os, sys
open(os.environ["DOOR_FAKE_PIDFILE"], "w").write(str(os.getpid()))
sys.stdin.read()      # hold the credentials; NEVER print the listening line
"""

ECHO_RUNNER = """#!/usr/bin/env python3
import sys
for line in sys.stdin:               # echo each credential as it arrives
    sys.stdout.write(line)
    sys.stdout.flush()
    sys.stderr.write("runner saw: " + line)
    sys.stderr.flush()
sys.exit(1)
"""


def write_script(text):
    d = Path(tempfile.mkdtemp(prefix="door-runner-test-"))
    p = d / "fake_runner.py"
    p.write_text(text)
    p.chmod(0o755)
    return d, p


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def case_lifecycle():
    print("(1) G2: KeyboardInterrupt during startup cannot orphan the child",
          file=sys.stderr)
    work, script = write_script(SILENT_RUNNER)
    pidfile = work / "pid"
    os.environ["DOOR_FAKE_PIDFILE"] = str(pidfile)
    real_thread = mc.threading.Thread

    class CtrlCDuringWait(real_thread):
        """The reader thread, with a Ctrl-C injected while the harness
        waits for the listening line - the exact moment Reviewer A hit."""

        def join(self, *args, **kwargs):
            real_thread.join(self, 0.3)
            raise KeyboardInterrupt

    mc.threading.Thread = CtrlCDuringWait
    try:
        caught = raised(mc.start_door_runner, str(script), 19311, 1,
                        timeout_s=30.0)
    finally:
        mc.threading.Thread = real_thread
        os.environ.pop("DOOR_FAKE_PIDFILE", None)
    check("(1) KeyboardInterrupt propagated UNCHANGED (not converted to "
          "SystemExit)", isinstance(caught, KeyboardInterrupt),
          type(caught).__name__ if caught is not None else "no exception")
    pid = int(pidfile.read_text()) if pidfile.exists() else None
    check("(1) the fake runner announced its pid", pid is not None)
    if pid is not None:
        deadline = time.time() + 3
        while pid_alive(pid) and time.time() < deadline:
            time.sleep(0.1)
        check("(1) the child is DEAD after the Ctrl-C (was "
              "RUNNER_SURVIVED_AFTER_SIGINT=True)", not pid_alive(pid),
              f"pid {pid} alive={pid_alive(pid)}")
    try:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
    except OSError:
        pass


def case_scrub():
    print("(2) G3: a runner that echoes stdin cannot put a credential into "
          "the refusal", file=sys.stderr)
    work, script = write_script(ECHO_RUNNER)
    known = "11" * 32          # token_hex(32) -> 64 hex chars
    real_token_hex = secrets.token_hex
    secrets.token_hex = lambda nbytes: known
    try:
        caught = raised(mc.start_door_runner, str(script), 19311, 1,
                        timeout_s=30.0)
    finally:
        secrets.token_hex = real_token_hex
    shutil.rmtree(work, ignore_errors=True)
    check("(2) the failure became the harness's SystemExit refusal",
          isinstance(caught, SystemExit), type(caught).__name__
          if caught is not None else "no exception")
    msg = str(caught) if caught is not None else ""
    salt = mc.device_cache_salt(known)
    check("(2) the refusal text contains NO credential (full)", known not in msg,
          msg[:200])
    check("(2) ...nor its 16-hex prefix", known[:16] not in msg, known[:16])
    check("(2) ...and NO derived salt (full)", salt not in msg, salt[:20])
    check("(2) ...nor the salt's 16-hex prefix", salt[:16] not in msg,
          salt[:16])
    check("(2) the scrub is visible - the message was rewritten, not "
          "silently emptied", "[scrubbed]" in msg, msg[:200])
    check("(2) the message still names the failure",
          "failed to start" in msg, msg[:160])
    check("(2) BOTH channels were scrubbed: the echoed stdout (quoted via "
          "the unexpected-output reason) and the stderr excerpt",
          msg.count("[scrubbed]") >= 2, str(msg.count("[scrubbed]")))


def main():
    case_lifecycle()
    case_scrub()
    print(f"door runner: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
