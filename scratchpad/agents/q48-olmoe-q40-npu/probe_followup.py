#!/usr/bin/env python3
"""q48 follow-up probes on S23. Avoids PowerShell quoting."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = [ADB, "-s", SERIAL, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


CMD_STATUS = r"""
echo ===LLAMA===
ps -A | grep -i llama || echo NO_LLAMA
echo ===BATT===
dumpsys battery | grep -E 'powered|^  level:|^  temperature:|^  status:|Charge counter:|^  voltage:'
echo ===SYSFS_CC===
cat /sys/class/power_supply/battery/charge_counter 2>&1 || true
echo ===SYSFS_TEMP===
cat /sys/class/power_supply/battery/temp 2>&1 || true
echo ===TOMBSTONES===
ls -l /data/tombstones 2>&1 | head -20
echo ===KALSAHTP===
ls /data/local/tmp/kalsahtp | head -40
echo ===HELP_N===
/data/local/tmp/kalsahtp/llama-bench --help 2>&1 | grep -E -- '-n |-p |-r |n-gen|n-prompt' || true
"""


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "status":
        r = run(["shell", CMD_STATUS], timeout=60)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        (HERE / "followup_status.txt").write_text(r.stdout, encoding="utf-8")
        return r.returncode
    if action == "shell":
        timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 120
        r = run(["shell", sys.argv[2]], timeout=timeout)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    if action == "push":
        r = run(["push", sys.argv[2], sys.argv[3]], timeout=60)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    if action == "pull":
        r = run(["pull", sys.argv[2], sys.argv[3]], timeout=int(sys.argv[4]) if len(sys.argv) > 4 else 180)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    print("unknown", action, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
