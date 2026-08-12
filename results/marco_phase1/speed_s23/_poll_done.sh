#!/data/data/com.termux/files/usr/bin/bash
python3 - <<'PY'
import json, subprocess, time
from pathlib import Path
out = Path.home()/"experiments/results/marco_phase1_speed_s23"
for i in range(240):
    try:
        d=json.loads(subprocess.check_output(["termux-battery-status"], timeout=5))
    except Exception:
        d={"plugged":"?","percentage":-1,"temperature":-1}
    status=(out/"STATUS.txt").read_text().strip() if (out/"STATUS.txt").exists() else "?"
    csv_n=max(0, len((out/"runs_speed.csv").read_text().splitlines())-1) if (out/"runs_speed.csv").exists() else 0
    last=""
    if (out/"SPEED.master.log").exists():
        lines=(out/"SPEED.master.log").read_text(errors="replace").splitlines()
        last=lines[-1] if lines else ""
    print("i=%d plug=%s batt=%s temp=%s status=%s csv=%d last=%s" % (
        i, d.get("plugged"), d.get("percentage"), d.get("temperature"), status, csv_n, last), flush=True)
    if status in ("DONE","STOP_BATT","STOP_THERMAL","STOP_PLUGGED","FAIL_PIN","FAIL_MODEL","FAIL_MODEL_SHA"):
        print("TERMINAL", status, flush=True)
        break
    time.sleep(30)
else:
    print("POLL_TIMEOUT", flush=True)
print("---CSV---", flush=True)
print((out/"runs_speed.csv").read_text() if (out/"runs_speed.csv").exists() else "missing", flush=True)
print("---TAIL---", flush=True)
if (out/"SPEED.master.log").exists():
    print("\n".join((out/"SPEED.master.log").read_text(errors="replace").splitlines()[-50:]), flush=True)
PY