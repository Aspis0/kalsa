#!/usr/bin/env python3
"""Engine process lifecycle for the dev/ measurements.

One responsibility: run an engine we can trust is OUR engine. The port must be
free before the spawn, the child must survive its own boot, and stop() must be
safe on every exit path - a run that dies halfway and leaves the engine up
poisons the next run's pre-flight.

Used by `measure-concurrency.py`. The older measurement scripts share one copy of
this lifecycle between them (`measure-slot-restore.py` carries it, the others
import it): this module is not what they share yet, so the guard is written
twice, and the two spellings of it have already drifted apart.
"""

import json
import os
import re
import signal
import socket
import subprocess
import time
import urllib.request
from pathlib import Path


def engine_identity_line(block):
    """ONE line naming the engine a harness is about to measure:

        engine: <status> <tag or fork label> commit <x> module <sha12>

    Everything is derived from mc.release_block's output, nothing asserted:
    the status; the tag, or the fork label when the identity veto fired, or
    - when the evidence is too weak to call either - the reason code; the
    commit `--version` printed (the commit that RAN); and the first 12 hex
    of the module the launcher loads (or `missing`). Harnesses print it
    before the first measurement so every run's log names its object.
    """
    ident = block.get("identity") or {}
    commit = (ident.get("version_commit") or ident.get("manifest_commit")
              or "unknown")
    module = ident.get("module_sha256")
    subject = (block.get("tag") or block.get("label")
               or block.get("reason_code") or "-")
    return (f"engine: {block.get('status')} {subject} commit {commit} "
            f"module {module[:12] if module else 'missing'}")


def fetch_props(port, timeout=5):
    """GET /props - the running server's own announcement about itself.
    Raises whatever the exchange raises; the require_* wrappers below turn
    that into the harnesses' refusal path."""
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/props",
                                timeout=timeout) as r:
        return json.loads(r.read().decode())


def props_build_commit(props):
    """PURE: the commit out of /props' `build_info`. This release prints
    `b11195-a7d2cec79` (quoted from a live probe of v1.1.1); the commit is
    the trailing hex run, None when the field is absent or carries none."""
    build = props.get("build_info") if isinstance(props, dict) else None
    if not isinstance(build, str):
        return None
    m = re.search(r"([0-9a-f]{7,40})\s*$", build.strip())
    return m.group(1) if m else None


def version_build_commit(version_text):
    """PURE: the commit out of a `--version` text (`commit <x>`)."""
    m = re.search(r"\bcommit ([0-9a-f]{7,40})", version_text or "")
    return m.group(1) if m else None


def commits_agree(left, right):
    """The ONE commit-agreement rule (H1) - applied by this responder
    check, by mc.engine_identity, and (same vectors, same order) by
    chat/scripts/tier-panel.mjs:

    - each side must be at least 9 LOWERCASE hex characters: what
      --version and /props print on this engine, and the length below
      which a prefix match between unrelated commits is commonplace;
    - two SHORT strings must be EQUAL;
    - a prefix match is allowed only against a full 40-hex commit (the
      manifest's), in either direction.

    The old rule - prefix of >=7 either way - accepted
    `deadbee9` vs `deadbee` (Reviewer A's counterexample); this closes
    the residual risk the earlier messages had declared.
    """
    for s in (left, right):
        if not isinstance(s, str) or re.fullmatch(r"[0-9a-f]{9,}", s) is None:
            return False
    if left == right:
        return True
    if len(left) == 40 and left.startswith(right):
        return True
    if len(right) == 40 and right.startswith(left):
        return True
    return False


def check_running_build(version_text, props):
    """PURE -> (ok, reason): does the engine ANSWERING THE PORT claim the
    build of the binary this harness launched?

    A binary's identity says nothing about which process answered: a stale
    engine satisfies /health exactly like ours (see port_is_held), and the
    filesystem-side traps (APFS is case-insensitive) never touch the port.
    So the running server is asked about itself and ITS words are compared
    with the launched binary's `--version` commit - prefix either way, the
    two print different lengths - and absence on either side is NOT
    agreement: unknown is refused, never assumed.
    """
    want = version_build_commit(version_text)
    have = props_build_commit(props)
    if want is None:
        return (False, "the launched binary's --version carries no commit, "
                       "so the responder cannot be confirmed as it")
    if have is None:
        return (False, "the running server's /props carries no build_info "
                       "commit, so WHICH process answered the port is "
                       "unknown - a binary's identity is not the "
                       "responder's")
    if not commits_agree(want, have):
        return (False,
                f"the engine answering the port is not the binary this run "
                f"launched: /props says commit {have}, --version says "
                f"{want} (the agreement rule: >=9 lowercase hex each, "
                f"equal, or a prefix of a full 40-hex commit) - a stale or "
                f"foreign engine holds the port")
    return (True, f"running /props commit {have} agrees with --version "
                  f"commit {want}")


def require_running_engine(port, version_text):
    """The check every harness that launched a binary calls right after its
    server is healthy: fetch /props, compare, and REFUSE (SystemExit - the
    harnesses' own refusal path) on disagreement or absence. Returns the
    running build string for the caller to record."""
    try:
        props = fetch_props(port)
    except Exception as e:
        raise SystemExit(
            f"refusing to measure: the server on :{port} did not answer "
            f"/props ({type(e).__name__}: {e}): /health proves a server is "
            "alive, not WHICH one - the responder's identity cannot be "
            "confirmed")
    ok, reason = check_running_build(version_text, props)
    if not ok:
        raise SystemExit(f"refusing to measure: {reason}")
    return props.get("build_info")


def require_running_build(port):
    """For the harness that runs NO binary (it drives an already-running
    server and cannot hash one): the running build string is REQUIRED -
    present and recorded, or the run is refused. An unnamed engine's
    numbers belong to nobody."""
    try:
        props = fetch_props(port)
    except Exception as e:
        raise SystemExit(
            f"refusing to measure: the server on :{port} did not answer "
            f"/props ({type(e).__name__}: {e}): /health proves a server is "
            "alive, not WHICH one - no build to record, no run")
    build = props.get("build_info")
    if not isinstance(build, str) or not build.strip():
        raise SystemExit(
            f"refusing to measure: the server on :{port} carries no "
            "build_info in /props: the running build cannot be named, and "
            "an unnamed engine's numbers belong to nobody")
    return build


def wait_health(port, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/health", timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def port_is_held(port):
    """True when something already listens on the port.

    A stale engine left by an interrupted run answers /health exactly like the
    one about to start. The harness would then measure the wrong process in the
    wrong work directory, and every number would look plausible: this happened,
    and a whole arm of a run was read from an engine writing into the previous
    run's directory. Binding is the exact test, and it costs nothing.
    """
    probe = socket.socket()
    # SO_REUSEADDR, because the engine sets it: a port left in TIME_WAIT by the
    # engine we just stopped is one cpp-httplib binds happily, and without this
    # the guard refuses a port that was never occupied. It still refuses a real
    # listener, which is the case it exists for.
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(("127.0.0.1", port))
        return False
    except OSError:
        return True
    finally:
        probe.close()


class Server:
    """An engine process with a port pre-flight and an idempotent stop."""

    def __init__(self, argv, log_path):
        self.argv = argv
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.proc = None
        self._fh = None

    def start(self, port):
        if port_is_held(port):
            raise RuntimeError(
                f"port {port} already answers: an engine from an earlier run is "
                f"still up, and this run would read ITS responses, not ours"
            )
        self._fh = open(self.log_path, "wb")
        env = dict(os.environ)
        env.pop("LLAMA_SERVER_SLOTS_DEBUG", None)   # never print prompt text
        env.pop("LLAMA_SERVER_SLOTS_N_DIFF", None)
        self.proc = subprocess.Popen(
            self.argv, stdout=self._fh, stderr=subprocess.STDOUT, env=env,
            start_new_session=True)
        if not wait_health(port):
            self.stop()
            raise RuntimeError("engine did not become healthy")
        if self.proc.poll() is not None:
            # The child died on its own boot; whoever answered /health is not
            # this process, so measuring "the healthy server" would measure a
            # stranger.
            self.stop()
            raise RuntimeError(
                "the engine exited during boot and something else answered the "
                f"health check; see {self.log_path}"
            )

    def stop(self):
        if self.proc is not None:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except Exception:
                self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except Exception:
                try:
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                except Exception:
                    pass
            self.proc = None
        if self._fh is not None:
            self._fh.flush()
            self._fh.close()
            self._fh = None

    def lines(self):
        try:
            return self.log_path.read_text(errors="replace").splitlines()
        except FileNotFoundError:
            return []
