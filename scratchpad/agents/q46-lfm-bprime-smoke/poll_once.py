#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
HERE = Path(__file__).resolve().parent
REMOTE = "/data/local/tmp/kalsa_q46"

CMD = """
echo STATUS=$(cat /data/local/tmp/kalsa_q46/STATUS 2>/dev/null)
echo HEARTBEAT=$(cat /data/local/tmp/kalsa_q46/HEARTBEAT 2>/dev/null)
echo driver_pid=$(cat /data/local/tmp/kalsa_q46/driver.pid 2>/dev/null)
wc -c /data/local/tmp/kalsa_q46/driver.log /data/local/tmp/kalsa_q46/driver.out 2>/dev/null
echo ---LOG---
cat /data/local/tmp/kalsa_q46/driver.log 2>/dev/null
echo ---PS---
ps -A | grep -i llama || echo NO_LLAMA
echo ---HEADER---
cat /data/local/tmp/kalsa_q46/header_session.txt 2>/dev/null
"""


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "poll"
    r = subprocess.run(
        [ADB, "-s", SERIAL, "shell", CMD],
        text=True,
        capture_output=True,
        timeout=60,
    )
    out = r.stdout
    (HERE / f"{tag}.txt").write_text(out, encoding="utf-8")
    sys.stdout.write(out)
    if r.stderr:
        sys.stderr.write(r.stderr)
    return r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
