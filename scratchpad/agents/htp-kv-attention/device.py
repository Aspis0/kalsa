"""adb access with a dry-run mode: one call path either prints or executes."""

import os
import shlex
import subprocess


class Adb:
    """Device transport. A QDC tunnel is selected with --adb-port (a dedicated
    adb server on that port), a directly connected phone with --serial."""

    def __init__(self, serial=None, adb_port=None, dry_run=False, log=print):
        self.serial = serial
        self.adb_port = adb_port
        self.dry_run = dry_run
        self.log = log
        self.prefix = ["adb"]
        if serial:
            self.prefix += ["-s", serial]

    @property
    def target_kind(self):
        # The QRD rack board behind the tunnel has a stubbed battery: heat
        # gates only. The phone carries the full owner rules (gates.py).
        return "qrd-tunnel" if self.adb_port else "phone-serial"

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
        return self._run(["shell", cmd], timeout)

    def shell_stream(self, cmd, logfile):
        """Long-running remote command streamed to an open logfile; returns
        the Popen or None in dry-run. The caller polls and gates live."""
        if self.dry_run:
            self.log(f"[dry-run] {shlex.join(self.prefix + ['shell', cmd])}")
            return None
        env = dict(os.environ)
        if self.adb_port:
            env["ANDROID_ADB_SERVER_PORT"] = self.adb_port
        return subprocess.Popen(self.prefix + ["shell", cmd], stdout=logfile,
                                stderr=subprocess.STDOUT, text=True, env=env)

    def push(self, src, dst, timeout=3600):
        return self._run(["push", str(src), str(dst)], timeout)

    def pull(self, src, dst, timeout=600):
        return self._run(["pull", str(src), str(dst)], timeout)
