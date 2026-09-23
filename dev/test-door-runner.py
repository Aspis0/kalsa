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
      the wait is in progress (an Event.wait wrapper, restored after),
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
  (5) A#1/B-F2 floods: fakes print the listening line, then flood 1 MiB
      to STDERR (A#1) and to STDOUT in BOTH shapes - newline-free and
      200 x 8 KiB newline-terminated lines (B round-8) - then wait
      for stdin EOF - the harness must start AND stop each within an
      8 s bound (a daemon worker joined with a timeout, so a regression
      FAILS instead of hanging the suite) with the child exiting cleanly
      (0, not SIGKILLed after stop's 10 s wait). Fixes: stderr=DEVNULL
      (the output is WITHHELD anyway) and the reader thread drains
      stdout to EOF and discards it.
  (6) R5-1 the port RANGE: `listening 127.0.0.1:0` and
      `listening 127.0.0.1:65536` are both refused, with the withheld
      refusal text, and the line itself is never quoted into the
      message. Dropping the range clause turns this red.
  (7) B F1 - DEVNULL pinned BEHAVIOURALLY, not by reading the argument:
      a python SUBPROCESS runs start+stop (so its fd 2 is capturable)
      against a fake that prints the listening line and writes
      credential renderings to ITS stderr; none of THE shared chunk
      scan's 4-hex chunks of credential/salt may appear in that
      subprocess's captured stdout+stderr, and its OK marker must (a
      crashed harness must not pass green). Mutating DEVNULL -> None
      (inherit) turns this red; -> PIPE stays red via case (5).
  (8) P1: a 0xff byte AFTER the listening line, followed by a flood:
      the announcement is read as BYTES (bounded readline(64), strict
      decode) and the drain reads fixed-size chunks, so the invalid byte
      cannot kill the drain - text mode would raise UnicodeDecodeError
      there and the stall returns. start+stop must stay within the same
      8 s bound with a clean exit.
  (9) P1/P2: an announcement that is not valid UTF-8, or longer than
      the 64-byte bound, is refused with the withheld refusal text and
      nothing of the announcement itself quoted.
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
import threading
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


def secret_chunks(*secrets_list):
    """Every 4-hex chunk of each secret, in both cases - THE chunk scan,
    shared by case (2)'s message scan and case (7)'s fd scan: one
    implementation, no second copy."""
    chunks = set()
    for s in secrets_list:
        for variant in (s, s.upper()):
            chunks.update(variant[i:i + 4] for i in range(len(variant) - 3))
    return chunks


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
    real_event = mc.threading.Event

    class CtrlCEvent(real_event):
        """threading.Event with a Ctrl-C injected while the harness WAITS
        for the listening line - the exact moment Reviewer A hit (start
        waits on line_ready, not on the reader's join, since the F2
        drain)."""

        def wait(self, timeout=None):
            real_event.wait(self, 0.3)
            raise KeyboardInterrupt

    mc.threading.Event = CtrlCEvent
    try:
        caught = raised(mc.start_door_runner, str(script), 19311, 1,
                        timeout_s=30.0)
    finally:
        mc.threading.Event = real_event
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
    leaked = sorted(c for c in secret_chunks(known, salt) if c in scan)
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

FLOOD_RUNNER = """#!/usr/bin/env python3
import sys
print("listening 127.0.0.1:58229")
sys.stdout.flush()
sys.stderr.write("x" * (1024 * 1024))   # far past any pipe buffer
sys.stderr.flush()
next(sys.stdin, None)                   # then wait for stdin EOF
"""

FLOOD_STDOUT_RUNNER = """#!/usr/bin/env python3
import sys
print("listening 127.0.0.1:58229")
sys.stdout.flush()
sys.stdout.write("y" * (1024 * 1024))   # far past any pipe buffer, no newline
sys.stdout.flush()
next(sys.stdin, None)                   # then wait for stdin EOF
"""

FLOOD_MULTILINE_RUNNER = """#!/usr/bin/env python3
import sys
print("listening 127.0.0.1:58229")
sys.stdout.flush()
line = "y" * 8191 + chr(10)             # 200 newline-terminated 8 KiB lines
for _ in range(200):
    sys.stdout.write(line)
sys.stdout.flush()
next(sys.stdin, None)                   # then wait for stdin EOF
"""

UTF8_FLOOD_RUNNER = """#!/usr/bin/env python3
import sys
out = sys.stdout.buffer
out.write(b"listening 127.0.0.1:58229" + bytes([10]))
out.flush()
out.write(bytes([255]) + (b"z" * 8191 + bytes([10])) * 200)   # 0xff then a flood
out.flush()
sys.stdin.read()                        # wait for stdin EOF
"""

BAD_UTF8_ANNOUNCE = """#!/usr/bin/env python3
import sys
sys.stdout.buffer.write(bytes([255, 255]) + b"FFANNOUNCEMENT-INVALID" + bytes([10]))
sys.stdout.flush()
sys.stdin.read()
"""

LONG_ANNOUNCE = """#!/usr/bin/env python3
import sys
sys.stdout.buffer.write(b"listening 127.0.0.1:58229" + b"X" * 200 + bytes([10]))
sys.stdout.flush()
sys.stdin.read()
"""

FAKE_FD2_RUNNER = """#!/usr/bin/env python3
import hashlib, sys
cred = next(sys.stdin, "").rstrip(chr(10))
print("listening 127.0.0.1:58229")
sys.stdout.flush()
salt = hashlib.sha256(b"kalsa-cache-salt-v1" + cred.encode()).hexdigest()
sys.stderr.write("colons " + ":".join(cred[i:i+4] for i in range(0, len(cred), 4)) + chr(10))
sys.stderr.write("spaced " + " ".join(salt[i:i+4] for i in range(0, len(salt), 4)) + chr(10))
sys.stderr.write("upper " + cred.upper() + chr(10))
sys.stderr.flush()
next(sys.stdin, None)
"""

# run in a SUBPROCESS so fd 2 is capturable: under DEVNULL the fake's
# stderr goes to /dev/null; under the `None` (inherit) regression it
# lands in THIS captured stream and the chunk scan finds it.
FD2_SUBPROCESS = """import importlib.util, secrets, sys
mc_path, fake_path = sys.argv[1], sys.argv[2]
secrets.token_hex = lambda n: "ab" * 32          # pinned: chunks known
spec = importlib.util.spec_from_file_location("mconc", mc_path)
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)
proc, port, _ = mc.start_door_runner(fake_path, 19311, 1, timeout_s=30.0)
mc.stop_door_runner(proc)
print(f"OK started-and-stopped port={port} rc={proc.returncode}")
"""

def drive_bounded(script_src):
    """start+stop in a DAEMON worker with the 8 s bound: a regression
    FAILS the check instead of hanging the suite. Returns (alive, ok)."""
    work, script = write_script(script_src)
    result = {}

    def run():
        t0 = time.perf_counter()
        try:
            proc, port, creds = mc.start_door_runner(str(script), 19311, 1,
                                                     timeout_s=30.0)
            mc.stop_door_runner(proc)
            result["ok"] = ("stopped", port, proc.returncode,
                            round(time.perf_counter() - t0, 2))
        except BaseException as e:
            result["ok"] = ("error", f"{type(e).__name__}: {e}")

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(timeout=8)
    alive = worker.is_alive()
    ok = result.get("ok")
    shutil.rmtree(work, ignore_errors=True)
    return alive, ok


def check_bounded(tag, alive, ok):
    check(f"({tag}) started AND stopped within the 8 s bound",
          not alive and ok is not None and ok[0] == "stopped",
          f"alive={alive} ok={ok!r}"[:170])
    if ok is not None and ok[0] == "stopped":
        check(f"({tag}) ...child exited CLEANLY (rc 0, not SIGKILLed "
              "after stop's 10 s wait)",
              ok[3] < 5 and ok[2] == 0,
              f"port={ok[1]} rc={ok[2]} took={ok[3]}s")


def case_flood():
    floods = (("5/stderr", FLOOD_RUNNER),
              ("5/stdout-nolf", FLOOD_STDOUT_RUNNER),
              ("5/stdout-lines", FLOOD_MULTILINE_RUNNER))
    for tag, src in floods:
        print(f"(5) A#1/B: a child flooding {tag} starts and stops within "
              "the bound", file=sys.stderr)
        check_bounded(tag, *drive_bounded(src))


def case_utf8_flood():
    print("(8) P1: a 0xff byte after the listening line, then a flood",
          file=sys.stderr)
    check_bounded("8", *drive_bounded(UTF8_FLOOD_RUNNER))


def case_bad_announce():
    print("(9) P1/P2: an announcement over the bound or not valid UTF-8 "
          "is refused, nothing quoted", file=sys.stderr)
    for name, src, marker in (
            ("invalid UTF-8", BAD_UTF8_ANNOUNCE, "FFANNOUNCEMENT-INVALID"),
            ("longer than the 64-byte bound", LONG_ANNOUNCE,
             "listening 127.0.0.1:58229" + "X" * 10)):
        work, script = write_script(src)
        proc = None
        msg = ""
        try:
            proc, port, creds = mc.start_door_runner(str(script), 19311, 1,
                                                     timeout_s=30.0)
        except SystemExit as e:
            msg = str(e)          # the withheld refusal
        finally:
            if proc is not None:
                mc.stop_door_runner(proc)
            shutil.rmtree(work, ignore_errors=True)
        check(f"(9) {name} announcement is REFUSED",
              bool(msg) and "did not announce a valid" in msg,
              msg[:140] or "start ACCEPTED it")
        check(f"(9) ...with the withheld refusal text", "WITHHELD" in msg,
              msg[-140:])
        check(f"(9) ...and the announcement itself is never quoted",
              marker not in msg, msg[:140])


def case_fd2_inherit():
    print("(7) B F1: no credential chunk reaches the harness process's own "
          "fds (DEVNULL, behaviourally pinned)", file=sys.stderr)
    work = Path(tempfile.mkdtemp(prefix="fd2-capture-"))
    try:
        fake = work / "fake_runner.py"
        fake.write_text(FAKE_FD2_RUNNER)
        fake.chmod(0o755)
        harness = work / "fd2_harness.py"
        harness.write_text(FD2_SUBPROCESS)
        run = subprocess.run([sys.executable, str(harness), str(MC),
                              str(fake)],
                             capture_output=True, text=True, timeout=60)
        captured = ((run.stdout + run.stderr)
                    .replace(str(fake), "").replace(str(harness), ""))
        check("(7) the subprocess completed with its OK marker (a crashed "
              "harness must not pass green)",
              run.returncode == 0 and "OK started-and-stopped" in run.stdout,
              f"rc={run.returncode} out={run.stdout[:60]!r}")
        known = "ab" * 32
        salt = mc.device_cache_salt(known)
        leaked = sorted(c for c in secret_chunks(known, salt)
                        if c in captured)
        check("(7) NO 4-hex chunk of credential or salt reached the "
              "harness's captured stdout+stderr",
              not leaked, str(leaked[:6]))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def case_port_range():
    print("(6) R5-1: the port RANGE clause - :0 and :65536 refuse",
          file=sys.stderr)
    for line in ("listening 127.0.0.1:0", "listening 127.0.0.1:65536"):
        src = ("#!/usr/bin/env python3\n"
               "import sys\n"
               "next(sys.stdin, None)\n"
               f"print({line!r})\n"
               "sys.stdout.flush()\n"
               "next(sys.stdin, None)\n")
        work, script = write_script(src)
        proc = None
        msg = ""
        try:
            proc, port, creds = mc.start_door_runner(str(script), 19311, 1,
                                                     timeout_s=30.0)
        except SystemExit as e:
            msg = str(e)          # the withheld refusal
        finally:
            if proc is not None:
                mc.stop_door_runner(proc)  # only a REGRESSION gets here
            shutil.rmtree(work, ignore_errors=True)
        check(f"(6) {line!r} is REFUSED",
              bool(msg) and "did not announce a valid" in msg,
              msg[:150] or "start ACCEPTED the port")
        check(f"(6) ...with the withheld refusal text", "WITHHELD" in msg,
              msg[-140:])
        check(f"(6) ...and the line itself is never quoted",
              line not in msg, msg[:150])


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
    case_flood()
    case_fd2_inherit()
    case_port_range()
    case_utf8_flood()
    case_bad_announce()
    print(f"door runner: {'GREEN' if FAILED == 0 else 'RED'} "
          f"({FAILED} failing check(s))", file=sys.stderr)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
