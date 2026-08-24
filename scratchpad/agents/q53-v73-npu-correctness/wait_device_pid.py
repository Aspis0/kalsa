from __future__ import annotations

import subprocess
import sys

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
pid = sys.argv[1]
command = f"while [ -e /proc/{pid} ]; do sleep 5; done; echo BINARY_GONE"
p = subprocess.run([ADB, "-s", SERIAL, "shell", command], text=True, capture_output=True, timeout=7200)
print(p.stdout, end="")
print(p.stderr, end="", file=sys.stderr)
raise SystemExit(p.returncode)
