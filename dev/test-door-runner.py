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

  (3) H2 runner spawn window: a SIGINT delivered by os.kill to self at
      the point RIGHT AFTER Popen returns (via a Popen wrapper) must not
      orphan the child - signal.pthread_sigmask blocks SIGINT across
      spawn+assignment, the deferred KeyboardInterrupt lands after
      `proc` exists, and the BaseException cleanup kills the child.
      Asserts the KeyboardInterrupt arrived AND the pidfile's child is
      dead.
  (4) H2 engine spawn window: the same injection against
      engine-harness.Server with /bin/sleep as argv - server.proc must
      have been assigned before delivery (so main's finally can stop it),
      and the sleep must be dead afterwards; even a RED run's cleanup
      kills the child it lost track of.
  (5) H3 scrub order, three fakes with a pinned credential: (a) 290
      padding chars then the FULL credential on stderr - the old
      truncate-first leaked 10 hex of it, and only a pre-truncation
      scrub can put [scrubbed] at offset 290; (b) a PREFIX-only leak
      (first 16 hex alone) must be [scrubbed], proving the prefix
      entries are load-bearing (B R1 showed them vacuous against a
      full-echo fake); (c) a 10-hex mid-string fragment must become
      [hex]. None may survive into the exception.

Exit 0 green, 1 red, 2 cannot run (measure-concurrency.py missing).
Run: python3 dev/test-door-runner.py
"""

import importlib.util
import os
import secrets
import shutil
import signal
import socket
import subprocess
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

PADDING_RUNNER = """#!/usr/bin/env python3
import sys
for line in sys.stdin:               # the credential sits at offset 290
    sys.stderr.write("p" * 290 + line)
    sys.stderr.flush()
    sys.exit(1)
"""

PREFIX_RUNNER = """#!/usr/bin/env python3
import sys
for line in sys.stdin:               # ONLY the first 16 hex leak
    sys.stderr.write(line[:16])
    sys.stderr.flush()
    sys.exit(1)
"""

FRAGMENT_RUNNER = """#!/usr/bin/env python3
import sys
for line in sys.stdin:               # a 10-hex mid-string fragment
    sys.stderr.write(line[6:16])
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


def case_spawn_window_runner():
    print("(3) H2 runner spawn window: SIGINT right after Popen cannot "
          "orphan the child", file=sys.stderr)
    work, script = write_script(SILENT_RUNNER)
    pidfile = work / "pid"
    os.environ["DOOR_FAKE_PIDFILE"] = str(pidfile)
    real_popen = subprocess.Popen

    def interrupting_popen(*a, **k):
        child = real_popen(*a, **k)
        os.kill(os.getpid(), signal.SIGINT)   # A's injection point
        return child

    subprocess.Popen = interrupting_popen
    try:
        caught = raised(mc.start_door_runner, str(script), 19311, 1,
                        timeout_s=30.0)
    finally:
        subprocess.Popen = real_popen
        os.environ.pop("DOOR_FAKE_PIDFILE", None)
    check("(3) the SIGINT arrived as KeyboardInterrupt (deferred past the "
          "assignment)", isinstance(caught, KeyboardInterrupt),
          type(caught).__name__ if caught is not None else "no exception")
    pid = int(pidfile.read_text()) if pidfile.exists() else None
    check("(3) the fake runner announced its pid", pid is not None)
    if pid is not None:
        deadline = time.time() + 3
        while pid_alive(pid) and time.time() < deadline:
            time.sleep(0.1)
        check("(3) the child is DEAD after the in-window SIGINT",
              not pid_alive(pid), f"pid {pid} alive={pid_alive(pid)}")
    shutil.rmtree(work, ignore_errors=True)


def case_spawn_window_engine():
    print("(4) H2 engine spawn window: the same injection against "
          "engine-harness.Server", file=sys.stderr)
    _eh_spec = importlib.util.spec_from_file_location(
        "eh_for_spawn_test", HERE / "engine-harness.py")
    eh = importlib.util.module_from_spec(_eh_spec)
    _eh_spec.loader.exec_module(eh)

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    work = Path(tempfile.mkdtemp(prefix="spawn-window-engine-"))
    server = eh.Server(["/bin/sleep", "300"], work / "engine.log")
    real_popen = subprocess.Popen
    holder = {}

    def interrupting_popen(*a, **k):
        child = real_popen(*a, **k)
        holder["child"] = child          # cleanup even when this goes red
        os.kill(os.getpid(), signal.SIGINT)
        return child

    subprocess.Popen = interrupting_popen
    pid = None
    try:
        caught = raised(server.start, port)
        pid = server.proc.pid if server.proc is not None else None
        server.stop()                    # what every harness main's finally does
    finally:
        subprocess.Popen = real_popen
        if pid is None and holder.get("child") is not None:
            # un-fixed code lost the reference: kill it anyway so a RED
            # run never leaves a sleep behind
            try:
                holder["child"].kill()
                holder["child"].wait(timeout=5)
            except Exception:
                pass
        shutil.rmtree(work, ignore_errors=True)
    check("(4) the SIGINT arrived as KeyboardInterrupt",
          isinstance(caught, KeyboardInterrupt),
          type(caught).__name__ if caught is not None else "no exception")
    check("(4) self.proc was ASSIGNED before delivery (stop() has a pid "
          "to kill)", pid is not None,
          "server.proc was None - the window orphaned the child")
    if pid is not None:
        deadline = time.time() + 3
        while pid_alive(pid) and time.time() < deadline:
            time.sleep(0.1)
        check("(4) the sleep child is DEAD after stop()",
              not pid_alive(pid), f"pid {pid} alive={pid_alive(pid)}")


def case_scrub_order():
    print("(5) H3 scrub order: padding, prefix-only, fragment - none may "
          "survive", file=sys.stderr)
    known = "ab" * 32
    cases = [
        ("padding-then-full-credential", PADDING_RUNNER,
         lambda m: known not in m and "[scrubbed]" in m,
         "full credential absent AND [scrubbed] present - only a "
         "pre-truncation scrub puts [scrubbed] at offset 290"),
        ("prefix-only (first 16 hex)", PREFIX_RUNNER,
         lambda m: known[:16] not in m and "[scrubbed]" in m,
         "the 16-hex prefix absent AND [scrubbed] present - the prefix "
         "entries are load-bearing, not vacuous"),
        ("10-hex mid-string fragment", FRAGMENT_RUNNER,
         lambda m: known[6:16] not in m and "[hex]" in m,
         "the fragment absent AND [hex] present - the hex-run rule did it"),
    ]
    for name, script_src, predicate, why in cases:
        work, script = write_script(script_src)
        real_token_hex = secrets.token_hex
        secrets.token_hex = lambda nbytes: known
        try:
            caught = raised(mc.start_door_runner, str(script), 19311, 1,
                            timeout_s=30.0)
        finally:
            secrets.token_hex = real_token_hex
            shutil.rmtree(work, ignore_errors=True)
        msg = str(caught) if caught is not None else ""
        check(f"(5) {name}: became the SystemExit refusal",
              isinstance(caught, SystemExit),
              type(caught).__name__ if caught is not None else "none")
        check(f"(5) {name}: {why}", predicate(msg), msg[:170])


def main():
    case_lifecycle()
    case_scrub()
    case_spawn_window_runner()
    case_spawn_window_engine()
    case_scrub_order()
    print(f"door runner: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
