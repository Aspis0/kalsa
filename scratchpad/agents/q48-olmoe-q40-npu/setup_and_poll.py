#!/usr/bin/env python3
"""Setup q48 scripts on S23 and poll STATUS."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q48"


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = [ADB, "-s", SERIAL, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def setup() -> int:
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


POLL_CMD = """
echo STATUS=$(cat /data/local/tmp/kalsa_q48/STATUS 2>/dev/null)
echo HEARTBEAT=$(cat /data/local/tmp/kalsa_q48/HEARTBEAT 2>/dev/null)
echo driver_pid=$(cat /data/local/tmp/kalsa_q48/driver.pid 2>/dev/null)
wc -c /data/local/tmp/kalsa_q48/driver.log /data/local/tmp/kalsa_q48/driver.out 2>/dev/null
echo ---LOG---
cat /data/local/tmp/kalsa_q48/driver.log 2>/dev/null
echo ---PS---
ps -A | grep -i llama || echo NO_LLAMA
"""


def poll(tag: str) -> int:
    r = run(["shell", POLL_CMD])
    (HERE / f"{tag}.txt").write_text(r.stdout, encoding="utf-8")
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    return r.returncode


def wait_done() -> int:
    deadline = time.time() + 25 * 60
    n = 0
    last = ""
    while time.time() < deadline:
        n += 1
        r = run(["shell", POLL_CMD])
        out = r.stdout
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


def launch() -> int:
    r = run(["shell", f"sh {REMOTE}/phase2_launch.sh"])
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    (HERE / "launch_pid.txt").write_text(r.stdout, encoding="utf-8")
    return r.returncode


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if action == "setup":
        return setup()
    if action == "launch":
        return launch()
    if action == "poll":
        return poll(sys.argv[2] if len(sys.argv) > 2 else "poll")
    if action == "wait":
        return wait_done()
    print("unknown", action, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
