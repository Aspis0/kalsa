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

  (2) K1 - child output NEVER enters a message. Scrubbing lost to
      formats (a fake writing the credential in colon groups, spaced,
      uppercase, split across writes - plus a door salt - reproduced the
      EXACT credential in the refusal), so the policy is now WITHHOLD:
      the refusal names the exit code and says stdout/stderr are
      withheld because they could carry a credential (rerun the runner
      by hand to see them). The test pins secrets.token_hex, runs a fake
      that emits every one of those formats on BOTH streams and exits 1,
      and asserts the SystemExit text contains NO plain 4-hex chunk of
      the credential or salt AND none of the renderings, plus the exit
      code and the withheld/rerun wording. The artifact side
      (credentials/salts never reach records) is
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

GROUPED_RUNNER = """#!/usr/bin/env python3
import hashlib, sys
NL = chr(10)
cred = ""
for line in sys.stdin:
    cred = line.rstrip(NL)
    break
salt = hashlib.sha256(b"kalsa-cache-salt-v1" + cred.encode()).hexdigest()
groups = ":".join(cred[i:i+4] for i in range(0, len(cred), 4))
spaced = " ".join(salt[i:i+4] for i in range(0, len(salt), 4))
# every format that beat the scrubber, split across writes, both streams
sys.stdout.write("probe " + groups[:20])
sys.stdout.flush()
sys.stdout.write(groups[20:] + NL)
sys.stderr.write("colons " + groups + NL)
sys.stderr.write("spaced " + spaced + NL)
sys.stderr.write("upper " + cred.upper() + NL)
sys.stderr.write("split " + cred[:10] + " " + cred[10:24] + " " + cred[24:] + NL)
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


def case_withheld():
    print("(2) K1: child output NEVER enters a refusal - colon groups, "
          "spaces, uppercase, split writes, a salt", file=sys.stderr)
    work, script = write_script(GROUPED_RUNNER)
    known = "ab" * 32          # token_hex(32) pinned -> salts are known
    real_token_hex = secrets.token_hex
    secrets.token_hex = lambda nbytes: known
    try:
        caught = raised(mc.start_door_runner, str(script), 19311, 1,
                        timeout_s=30.0)
    finally:
        secrets.token_hex = real_token_hex
        shutil.rmtree(work, ignore_errors=True)
    check("(2) the failure became the harness's SystemExit refusal",
          isinstance(caught, SystemExit),
          type(caught).__name__ if caught is not None else "no exception")
    msg = str(caught) if caught is not None else ""
    # the temp path is random; remove it so the scan below is deterministic
    scan = msg.replace(str(script), "")
    salt = mc.device_cache_salt(known)
    chunks = set()
    for secret in (known, salt, known.upper(), salt.upper()):
        chunks.update(secret[i:i + 4] for i in range(len(secret) - 3))
    leaked = sorted(c for c in chunks if c in scan)
    check("(2) NO plain 4-hex chunk of credential or salt survives into "
          "the message", not leaked, str(leaked[:6]))
    colon_groups = ":".join(known[i:i + 4] for i in range(0, len(known), 4))
    spaced_salt = " ".join(salt[i:i + 4] for i in range(0, len(salt), 4))
    split_cred = known[:10] + " " + known[10:24] + " " + known[24:]
    renderings = [colon_groups, spaced_salt, known.upper(), split_cred,
                  known, salt]
    forms = [r[:28] for r in renderings if r and r in scan]
    check("(2) NO grouped / spaced / uppercase / split rendering survives "
          "(every format that beat the scrubber)", not forms, str(forms))
    check("(2) the refusal names the exit code", "runner exit 1" in msg,
          msg[:200])
    check("(2) ...and that the output was WITHHELD, to be rerun by hand",
          "WITHHELD" in msg and "rerun the runner by hand" in msg,
          msg[:270])


VALID_RUNNER = """#!/usr/bin/env python3
import sys
next(sys.stdin, None)     # the one credential line
print("listening 127.0.0.1:58229")
sys.stdout.flush()
next(sys.stdin, None)     # then block until the harness closes stdin
"""

def case_success_path():
    print("(2b) K1: the SUCCESS path still parses a valid listening line",
          file=sys.stderr)
    work, script = write_script(VALID_RUNNER)
    proc = None
    try:
        proc, port, creds = mc.start_door_runner(str(script), 19311, 1,
                                                 timeout_s=30.0)
        check("(2b) the bounded parse returns the port as an int",
              port == 58229, repr(port))
        check("(2b) one 64-hex credential was minted - and no output text "
              "made it into the returned port",
              len(creds) == 1 and len(creds[0]) == 64, repr(len(creds)))
    except BaseException as e:
        check("(2b) start succeeded on a valid line", False,
              f"{type(e).__name__}: {e}")
    finally:
        mc.stop_door_runner(proc)
        shutil.rmtree(work, ignore_errors=True)
    if proc is not None and proc.poll() is not None:
        check("(2b) the runner is dead after stop", True, f"exit {proc.returncode}")
    elif proc is not None:
        check("(2b) the runner is dead after stop", False, "still alive")


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


def main():
    case_lifecycle()
    case_withheld()
    case_success_path()
    case_spawn_window_runner()
    case_spawn_window_engine()
    print(f"door runner: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
