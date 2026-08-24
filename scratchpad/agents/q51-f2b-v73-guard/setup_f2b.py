#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q51_f2b"


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = [ADB, "-s", SERIAL, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def setup() -> int:
    run(["shell", "mkdir -p " + REMOTE])
    for name in ("f2b_driver.sh", "f2b_launch.sh"):
        r = run(["push", str(HERE / name), f"{REMOTE}/{name}"])
        print(r.stderr)
        if r.returncode != 0:
            return r.returncode
    script = (
        f"tr -d '\\r' < {REMOTE}/f2b_driver.sh > {REMOTE}/f2b_driver.sh.lf && "
        f"mv {REMOTE}/f2b_driver.sh.lf {REMOTE}/f2b_driver.sh && "
        f"tr -d '\\r' < {REMOTE}/f2b_launch.sh > {REMOTE}/f2b_launch.sh.lf && "
        f"mv {REMOTE}/f2b_launch.sh.lf {REMOTE}/f2b_launch.sh && "
        f"chmod 755 {REMOTE}/f2b_driver.sh {REMOTE}/f2b_launch.sh && "
        f"echo CR=$(tr -cd '\\r' < {REMOTE}/f2b_driver.sh | wc -c)"
    )
    r = run(["shell", script])
    print(r.stdout)
    return r.returncode


POLL = """
echo STATUS=$(cat /data/local/tmp/kalsa_q51_f2b/STATUS 2>/dev/null)
echo HEARTBEAT=$(cat /data/local/tmp/kalsa_q51_f2b/HEARTBEAT 2>/dev/null)
wc -c /data/local/tmp/kalsa_q51_f2b/driver.log /data/local/tmp/kalsa_q51_f2b/driver.out 2>/dev/null
echo ---LOG---
cat /data/local/tmp/kalsa_q51_f2b/driver.log 2>/dev/null
echo ---PS---
ps -A | grep -i llama || echo NO_LLAMA
"""


def wait_done() -> int:
    deadline = time.time() + 40 * 60
    n = 0
    last = ""
    while time.time() < deadline:
        n += 1
        r = run(["shell", POLL])
        out = r.stdout
        (HERE / "wait_last.txt").write_text(out, encoding="utf-8")
        print(f"===== poll {n} =====\n{out}", flush=True)
        last = out
        if "STATUS=DONE" in out or "STATUS=STOP" in out or "STATUS=SKIP" in out:
            (HERE / "wait_final.txt").write_text(out, encoding="utf-8")
            return 0 if "STATUS=DONE" in out else 1
        time.sleep(20)
    (HERE / "wait_final.txt").write_text("TIMEOUT\n" + last, encoding="utf-8")
    return 2


def main() -> int:
    a = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if a == "setup":
        return setup()
    if a == "launch":
        r = run(["shell", f"sh {REMOTE}/f2b_launch.sh"])
        sys.stdout.write(r.stdout)
        return r.returncode
    if a == "wait":
        return wait_done()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
