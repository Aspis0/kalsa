import json
from pathlib import Path

try:
    import psutil  # type: ignore
except ImportError:
    psutil = None

out = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\f6_certify_probe\_procs.json")

# Fall back to a tiny ctypes/win32-free scan via tasklist if needed.
import subprocess

r = subprocess.run(
    ["powershell", "-NoProfile", "-Command",
     "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python|pwsh|bmoe' } | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, (([string]$_.CommandLine) -replace '[\\r\\n]',' ') }"],
    capture_output=True, text=True, encoding="utf-8", errors="replace",
)
rows = []
for line in (r.stdout or "").splitlines():
    parts = line.split("|", 3)
    if len(parts) != 4:
        continue
    pid, ppid, name, cmd = parts
    if any(s in cmd for s in ("f6_certify", "run_f6", "Qwen3.6", "dropcurve", "run_multi5", "run_mellum2")):
        rows.append({"pid": pid, "ppid": ppid, "name": name, "cmd": cmd[:240]})
out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
print(f"wrote {len(rows)} rows")
