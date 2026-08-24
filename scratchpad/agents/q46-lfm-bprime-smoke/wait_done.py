#!/usr/bin/env python3
"""Poll S23 q46 STATUS until DONE/STOP/SKIP or timeout."""
from __future__ import annotations

import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q46"


def sh(cmd: str, timeout: int = 60) -> str:
    r = subprocess.run(
        [ADB, "-s", SERIAL, "shell", cmd],
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    return (r.stdout or "") + (r.stderr or "")


def main() -> int:
    deadline = time.time() + 20 * 60
    n = 0
    last = ""
    while time.time() < deadline:
        n += 1
        out = sh(
            "echo STATUS=$(cat /data/local/tmp/kalsa_q46/STATUS 2>/dev/null); "
            "echo HEARTBEAT=$(cat /data/local/tmp/kalsa_q46/HEARTBEAT 2>/dev/null); "
            "tail -5 /data/local/tmp/kalsa_q46/driver.log 2>/dev/null; "
            "ps -A | grep -i llama || echo NO_LLAMA"
        )
        (HERE / "wait_done_last.txt").write_text(out, encoding="utf-8")
        print(f"===== poll {n} =====\n{out}", flush=True)
        last = out
        if "STATUS=DONE" in out or "STATUS=STOP" in out or "STATUS=SKIP" in out:
            (HERE / "wait_done_final.txt").write_text(out, encoding="utf-8")
            return 0 if "STATUS=DONE" in out else 1
        time.sleep(20)
    (HERE / "wait_done_final.txt").write_text("TIMEOUT\n" + last, encoding="utf-8")
    print("TIMEOUT", flush=True)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
