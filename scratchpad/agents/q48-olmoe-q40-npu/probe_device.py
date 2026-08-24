#!/usr/bin/env python3
"""adb -s S23 helper for q48. Avoids PowerShell eating redirects."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q48"

STATUS_CMD = r"""
echo ===LLAMA===
ps -A | grep -i llama || echo NO_LLAMA
echo ===BATT===
dumpsys battery | grep -E 'powered|^  level:|^  temperature:|^  status:'
echo ===DF===
df -h /data
echo ===TMP_GGUF===
ls -l /data/local/tmp/*.gguf
echo ===MEM===
grep -E 'MemTotal:|MemAvailable:' /proc/meminfo
"""


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = [ADB, "-s", SERIAL, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "status":
        r = run(["shell", STATUS_CMD])
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        (HERE / "device_status.txt").write_text(r.stdout, encoding="utf-8")
        return r.returncode
    if action == "shell":
        timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 120
        r = run(["shell", sys.argv[2]], timeout=timeout)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    if action == "push":
        src = sys.argv[2]
        dst = sys.argv[3]
        r = run(["push", "--sync", src, dst], timeout=int(sys.argv[4]) if len(sys.argv) > 4 else 600)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    if action == "pull":
        src = sys.argv[2]
        dst = sys.argv[3]
        r = run(["pull", src, dst], timeout=int(sys.argv[4]) if len(sys.argv) > 4 else 180)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    print("unknown", action, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
