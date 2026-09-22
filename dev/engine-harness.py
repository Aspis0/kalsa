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

import os
import signal
import socket
import subprocess
import time
import urllib.request
from pathlib import Path


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
