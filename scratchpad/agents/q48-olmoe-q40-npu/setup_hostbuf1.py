#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q48/hostbuf1"


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = [ADB, "-s", SERIAL, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def setup() -> int:
    r = run(["shell", "mkdir -p " + REMOTE])
    print(r.stdout, r.stderr, r.returncode)
    for name in ("hostbuf1_driver.sh", "hostbuf1_launch.sh"):
        r = run(["push", str(HERE / name), f"{REMOTE}/{name}"])
        print(r.stdout, r.stderr, r.returncode)
        if r.returncode != 0:
            return r.returncode
    script = (
        f"tr -d '\\r' < {REMOTE}/hostbuf1_driver.sh > {REMOTE}/hostbuf1_driver.sh.lf && "
        f"mv {REMOTE}/hostbuf1_driver.sh.lf {REMOTE}/hostbuf1_driver.sh && "
        f"tr -d '\\r' < {REMOTE}/hostbuf1_launch.sh > {REMOTE}/hostbuf1_launch.sh.lf && "
        f"mv {REMOTE}/hostbuf1_launch.sh.lf {REMOTE}/hostbuf1_launch.sh && "
        f"chmod 755 {REMOTE}/hostbuf1_driver.sh {REMOTE}/hostbuf1_launch.sh && "
        f"echo CR_driver=$(tr -cd '\\r' < {REMOTE}/hostbuf1_driver.sh | wc -c) && "
        f"echo CR_launch=$(tr -cd '\\r' < {REMOTE}/hostbuf1_launch.sh | wc -c) && "
        f"head -4 {REMOTE}/hostbuf1_driver.sh"
    )
    r = run(["shell", script])
    print(r.stdout)
    print(r.stderr)
    return r.returncode


POLL = """
echo STATUS=$(cat /data/local/tmp/kalsa_q48/hostbuf1/STATUS 2>/dev/null)
echo HEARTBEAT=$(cat /data/local/tmp/kalsa_q48/hostbuf1/HEARTBEAT 2>/dev/null)
echo driver_pid=$(cat /data/local/tmp/kalsa_q48/hostbuf1/driver.pid 2>/dev/null)
wc -c /data/local/tmp/kalsa_q48/hostbuf1/driver.log /data/local/tmp/kalsa_q48/hostbuf1/driver.out 2>/dev/null
echo ---LOG---
cat /data/local/tmp/kalsa_q48/hostbuf1/driver.log 2>/dev/null
echo ---PS---
ps -A | grep -i llama || echo NO_LLAMA
"""


def poll(tag: str) -> int:
    r = run(["shell", POLL])
    (HERE / f"{tag}.txt").write_text(r.stdout, encoding="utf-8")
    sys.stdout.write(r.stdout)
    return r.returncode


def launch() -> int:
    r = run(["shell", f"sh {REMOTE}/hostbuf1_launch.sh"])
    sys.stdout.write(r.stdout)
    (HERE / "hostbuf1_launch_pid.txt").write_text(r.stdout, encoding="utf-8")
    return r.returncode


def wait_done() -> int:
    deadline = time.time() + 40 * 60
    n = 0
    last = ""
    while time.time() < deadline:
        n += 1
        r = run(["shell", POLL])
        out = r.stdout
        (HERE / "hostbuf1_wait_last.txt").write_text(out, encoding="utf-8")
        print(f"===== poll {n} =====\n{out}", flush=True)
        last = out
        if "STATUS=DONE" in out or "STATUS=STOP" in out or "STATUS=SKIP" in out:
            (HERE / "hostbuf1_wait_final.txt").write_text(out, encoding="utf-8")
            return 0 if "STATUS=DONE" in out else 1
        time.sleep(15)
    (HERE / "hostbuf1_wait_final.txt").write_text("TIMEOUT\n" + last, encoding="utf-8")
    print("TIMEOUT", flush=True)
    return 2


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if action == "setup":
        return setup()
    if action == "launch":
        return launch()
    if action == "poll":
        return poll(sys.argv[2] if len(sys.argv) > 2 else "hbpoll")
    if action == "wait":
        return wait_done()
    print("unknown", action, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
