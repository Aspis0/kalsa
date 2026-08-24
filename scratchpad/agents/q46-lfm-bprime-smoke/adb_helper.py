#!/usr/bin/env python3
"""Tiny adb -s S23 helper. Avoids PowerShell eating redirects."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q46"


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = [ADB, "-s", SERIAL, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if action == "setup":
        r = run(["shell", "mkdir -p " + REMOTE])
        print(r.stdout, r.stderr, r.returncode)
        for name in ("phase2_driver.sh", "phase2_launch.sh"):
            r = run(["push", str(HERE / name), f"{REMOTE}/{name}"])
            print(r.stdout, r.stderr, r.returncode)
            if r.returncode != 0:
                return r.returncode
        script = (
            f"tr -d '\\r' < {REMOTE}/phase2_driver.sh > {REMOTE}/phase2_driver.sh.lf && "
            f"mv {REMOTE}/phase2_driver.sh.lf {REMOTE}/phase2_driver.sh && "
            f"tr -d '\\r' < {REMOTE}/phase2_launch.sh > {REMOTE}/phase2_launch.sh.lf && "
            f"mv {REMOTE}/phase2_launch.sh.lf {REMOTE}/phase2_launch.sh && "
            f"chmod 755 {REMOTE}/phase2_driver.sh {REMOTE}/phase2_launch.sh && "
            f"echo CR_driver=$(tr -cd '\\r' < {REMOTE}/phase2_driver.sh | wc -c) && "
            f"echo CR_launch=$(tr -cd '\\r' < {REMOTE}/phase2_launch.sh | wc -c) && "
            f"wc -c {REMOTE}/phase2_driver.sh {REMOTE}/phase2_launch.sh && "
            f"head -3 {REMOTE}/phase2_driver.sh && echo --- && cat {REMOTE}/phase2_launch.sh"
        )
        r = run(["shell", script])
        print(r.stdout)
        print(r.stderr)
        return r.returncode
    if action == "shell":
        r = run(["shell", sys.argv[2]], timeout=int(sys.argv[3]) if len(sys.argv) > 3 else 120)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        return r.returncode
    print("unknown action", action, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
