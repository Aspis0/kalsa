"""adb access: dry-run mode, and the personal-device command guard."""

import os
import re
import shlex
import subprocess

# The only process control allowed on a personal phone: TERM our own bench.
KILL_BENCH = "for p in $(pidof llama-bench); do kill -TERM $p; done"

# Read-only probes: stdout only, no device state touched, any path argument
# allowed (df needs /data, which is outside the bench dir on purpose).
_READ_ONLY = ("dumpsys ", "getprop", "settings get ", "printf ", "grep ",
              "df ", "nproc")
# Shell builtins that only touch this shell or stdout (redirection is
# refused separately, so echo cannot write files).
_BUILTINS = ("echo", "exit")
# Verbs allowed only because every absolute path they touch must stay under
# the bench dir. cd is stricter: its target must be the bench dir itself.
_BENCH_VERBS = ("export", "chmod", "mkdir", "sha256sum", "ls", "rm",
                "./bin/llama-bench", "./bin/llama-completion")
# KEYCODE_WAKEUP; never 26/POWER, never KEYCODE_SLEEP.
_WAKE = "input keyevent 224"
# Whole paths only: the match starts at a literal / (so bare words like the
# verb never match) and keeps / inside; the lookbehind keeps inner components
# (/local, /tmp, …) from starting one.
_ABS_PATH = re.compile(r"(?<![\w.,@+/-])/[\w.,@+/-]*")
_ASSIGNMENT = re.compile(r"^\w+=")


class PersonalRefused(Exception):
    """A command the personal-device guard does not allow."""


def guard_violation(cmd, device_dir):
    """None = allowed on the owner's daily driver; else the reason. The
    allow-list is: read-only probes, the wake keyevent, the bench kill
    switch, pure shell builtins/assignments, and bench verbs whose absolute
    paths all stay under device_dir. settings put, other apps' files, POWER/
    SLEEP keyevents and anything outside the bench dir never pass."""
    cmd = cmd.strip()
    if cmd == KILL_BENCH:
        return None
    for part in re.split(r";|&&|\|\||\|", cmd):
        part = part.strip()
        if not part:
            continue
        if ">" in part or "<" in part:
            return f"refused (redirection): {part!r}"
        if part == _WAKE or part.startswith(_READ_ONLY):
            continue
        if _ASSIGNMENT.match(part) or part.split()[0] in _BUILTINS:
            continue
        head = part.split()[0]
        if head == "cd":
            if device_dir not in _ABS_PATH.findall(part):
                return f"cd outside {device_dir}: {part!r}"
            continue
        if head not in _BENCH_VERBS:
            return f"refused: {part!r}"
        for tok in set(_ABS_PATH.findall(part)):
            if tok != device_dir and not tok.startswith(device_dir + "/"):
                return f"path outside {device_dir}: {tok}"
    return None


class Adb:
    """Device transport. A QDC tunnel is selected with --adb-port (a dedicated
    adb server on that port), a directly connected phone with --serial. With
    personal=True every command must pass guard_violation first."""

    def __init__(self, serial=None, adb_port=None, dry_run=False, log=print,
                 personal=False, device_dir=None):
        self.serial = serial
        self.adb_port = adb_port
        self.dry_run = dry_run
        self.log = log
        self.personal = personal
        self.device_dir = device_dir
        self.prefix = ["adb"]
        if serial:
            self.prefix += ["-s", serial]

    @property
    def target_kind(self):
        # The QRD rack board behind the tunnel has a stubbed battery: heat
        # gates only. A phone carries the full owner rules (gates.py).
        return "qrd-tunnel" if self.adb_port else "phone-serial"

    def _guard(self, cmd):
        if not self.personal:
            return
        why = guard_violation(cmd, self.device_dir)
        if why:
            raise PersonalRefused(why)

    def _run(self, args, timeout):
        cmd = self.prefix + args
        if self.dry_run:
            self.log(f"[dry-run] {shlex.join(cmd)}")
            return 0, "[dry-run]"
        env = dict(os.environ)
        if self.adb_port:
            env["ANDROID_ADB_SERVER_PORT"] = self.adb_port
        p = subprocess.run(cmd, text=True, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=timeout, env=env)
        return p.returncode, p.stdout

    def shell(self, cmd, timeout=60):
        self._guard(cmd)
        return self._run(["shell", cmd], timeout)

    def shell_stream(self, cmd, logfile):
        """Long-running remote command streamed to an open logfile; returns
        the Popen or None in dry-run. The caller polls and gates live."""
        self._guard(cmd)
        if self.dry_run:
            self.log(f"[dry-run] {shlex.join(self.prefix + ['shell', cmd])}")
            return None
        env = dict(os.environ)
        if self.adb_port:
            env["ANDROID_ADB_SERVER_PORT"] = self.adb_port
        return subprocess.Popen(self.prefix + ["shell", cmd], stdout=logfile,
                                stderr=subprocess.STDOUT, text=True, env=env)

    def push(self, src, dst, timeout=3600):
        if self.personal and not str(dst).startswith(self.device_dir + "/"):
            raise PersonalRefused(
                f"push destination outside {self.device_dir}: {dst}")
        return self._run(["push", str(src), str(dst)], timeout)

    def pull(self, src, dst, timeout=600):
        if self.personal and not str(src).startswith(self.device_dir + "/"):
            raise PersonalRefused(
                f"pull source outside {self.device_dir}: {src}")
        return self._run(["pull", str(src), str(dst)], timeout)
