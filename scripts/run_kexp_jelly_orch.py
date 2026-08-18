#!/usr/bin/env python3
"""PC orchestrator: wait-for-unplug, then run KEXP Jelly speed cells via SSH.

Battery gate uses adb dumpsys. Timed cells never run while AC/USB powered.
"""
from __future__ import annotations

import datetime as dt
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jelly_battery_poll as batt

SSH = ["ssh", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=10", "-p", "8022", "u0_a225@192.168.1.82"]
SCP = ["scp", "-o", "ConnectTimeout=15", "-P", "8022"]
LOCAL = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp_jelly")
FIRST_POLL = dt.datetime.fromisoformat("2026-08-13T19:45:07-04:00")
DEADLINE = FIRST_POLL + dt.timedelta(minutes=30)
POLL_EVERY = 120
TEMP_MAX = 43.0
BATT_MIN = 35

CELLS = [
    # ABBA-style: KEXP k4, A0 control between KEXP k4 reps, then k3
    ("KEXP_K4", 1, "$HOME/models/LFM2.5-8B-A1B-KEXP.gguf", "--n-expert-used 4"),
    ("A0_K4", 1, "$HOME/models/LFM2.5-8B-A1B-Q4_K_M.gguf", "--n-expert-used 4"),
    ("KEXP_K4", 2, "$HOME/models/LFM2.5-8B-A1B-KEXP.gguf", "--n-expert-used 4"),
    ("KEXP_K3", 1, "$HOME/models/LFM2.5-8B-A1B-KEXP.gguf", "--n-expert-used 3"),
    ("KEXP_K3", 2, "$HOME/models/LFM2.5-8B-A1B-KEXP.gguf", "--n-expert-used 3"),
]


def log(msg: str) -> None:
    line = f"[{dt.datetime.now().astimezone().strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    print(line, flush=True)
    LOCAL.mkdir(parents=True, exist_ok=True)
    with (LOCAL / "ORCH.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def ssh(cmd: str, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(SSH + [cmd], capture_output=True, text=True, timeout=timeout)


def pull(remote: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(SCP + [f"u0_a225@192.168.1.82:{remote}", str(dest)], check=False, timeout=120)


def wait_unplug() -> str:
    poll_n = 5
    while True:
        now = dt.datetime.now().astimezone()
        if now >= DEADLINE:
            log("DEADLINE 30min still PLUGGED — PENDING_UNPLUG")
            return "PENDING_UNPLUG"
        try:
            info = batt.parse(batt.dumpsys())
        except Exception as e:
            log(f"WARN dumpsys failed: {e}")
            time.sleep(POLL_EVERY)
            poll_n += 1
            continue
        ts = now.strftime("%Y-%m-%dT%H:%M:%S%z")
        state = "PLUGGED" if info["plugged"] else "UNPLUGGED"
        line = (
            f"{ts} poll={poll_n} AC={str(info['ac']).lower()} USB={str(info['usb']).lower()} "
            f"wireless={str(info['wireless']).lower()} status={info['status']} "
            f"level={info['level']} temp_C={info['temp_c']:.1f} {state}"
        )
        with batt.LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        log(line)
        if not info["plugged"]:
            if info["level"] >= 0 and info["level"] < BATT_MIN:
                log(f"UNPLUGGED but battery {info['level']} < {BATT_MIN}")
                return "BATT_LOW"
            if info["temp_c"] > 0 and info["temp_c"] > TEMP_MAX:
                log(f"UNPLUGGED but temp {info['temp_c']} > {TEMP_MAX}")
                return "TEMP_ABORT"
            return "UNPLUGGED"
        remaining = (DEADLINE - now).total_seconds()
        sleep_s = min(POLL_EVERY, max(5, remaining))
        time.sleep(sleep_s)
        poll_n += 1


def gate() -> dict:
    info = batt.parse(batt.dumpsys())
    if info["plugged"]:
        raise RuntimeError(f"PLUGGED mid-session AC={info['ac']} USB={info['usb']}")
    if info["level"] >= 0 and info["level"] < BATT_MIN:
        raise RuntimeError(f"battery {info['level']} < {BATT_MIN}")
    if info["temp_c"] > 0 and info["temp_c"] > TEMP_MAX:
        raise RuntimeError(f"temp {info['temp_c']} > {TEMP_MAX}")
    return info


def run_cell(cell: str, run: int, model: str, extra: str) -> None:
    info = gate()
    log(f"START {cell} r{run} batt={info['level']} temp={info['temp_c']:.1f} extra=[{extra}]")
    # persist per-rep battery snapshot
    snap = LOCAL / "logs" / f"{cell}_r{run}.batt"
    snap.parent.mkdir(parents=True, exist_ok=True)
    snap.write_text(
        f"level={info['level']}\ntemp_c={info['temp_c']:.1f}\nplugged={info['plugged']}\n",
        encoding="utf-8",
    )
    remote = (
        f"export HOME=/data/data/com.termux/files/home; "
        f"export PATH=$HOME/bin:/data/data/com.termux/files/usr/bin:$PATH; "
        f"termux-wake-lock >/dev/null 2>&1 || true; "
        f"bash $HOME/bench_kexp/run_one.sh {cell} {model} {run} '{extra}'"
    )
    proc = ssh(remote, timeout=420)
    (LOCAL / "logs" / f"{cell}_r{run}.ssh.out").write_text(
        (proc.stdout or "") + "\n---STDERR---\n" + (proc.stderr or ""),
        encoding="utf-8",
    )
    log(f"SSH rc={proc.returncode} {cell} r{run}")
    if proc.stdout:
        log("STDOUT " + proc.stdout.strip().replace("\n", " | ")[:500])
    if proc.stderr:
        log("STDERR " + proc.stderr.strip().replace("\n", " | ")[:500])
    for name in (
        f"logs/{cell}_r{run}.log",
        f"logs/{cell}_r{run}.rss",
        f"logs/{cell}_r{run}.residency",
        "runs.csv",
        "KEXP.master.log",
        "mem.log",
    ):
        pull(f"bench_kexp/{name}", LOCAL / name)
    time.sleep(8)


def push_helpers() -> None:
    scripts = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scripts")
    subprocess.run(
        SCP + [str(scripts / "run_kexp_jelly_one.sh"), "u0_a225@192.168.1.82:bench_kexp/run_one.sh"],
        check=True,
        timeout=30,
    )
    subprocess.run(
        SCP + [str(scripts / "residency.py"), "u0_a225@192.168.1.82:bench_kexp/residency.py"],
        check=True,
        timeout=30,
    )
    ssh("chmod +x $HOME/bench_kexp/run_one.sh")


def main() -> int:
    LOCAL.mkdir(parents=True, exist_ok=True)
    (LOCAL / "logs").mkdir(exist_ok=True)
    log("orchestrator start")
    push_helpers()
    state = wait_unplug()
    if state != "UNPLUGGED":
        (LOCAL / "STATUS.txt").write_text(state + "\n", encoding="utf-8")
        log(f"STOP {state}")
        return 0 if state == "PENDING_UNPLUG" else 1

    ssh("termux-wake-lock >/dev/null 2>&1 || true")
    completed = []
    try:
        for cell, run, model, extra in CELLS:
            run_cell(cell, run, model, extra)
            completed.append(f"{cell}_r{run}")
            (LOCAL / "STATUS.txt").write_text("PARTIAL " + ",".join(completed) + "\n", encoding="utf-8")
        (LOCAL / "STATUS.txt").write_text("DONE " + ",".join(completed) + "\n", encoding="utf-8")
        log("DONE all cells")
        return 0
    except Exception as e:
        log(f"ABORT {type(e).__name__}: {e}")
        (LOCAL / "STATUS.txt").write_text(
            "PARTIAL " + ",".join(completed) + f" ABORT {e}\n", encoding="utf-8"
        )
        return 2
    finally:
        ssh("termux-wake-unlock >/dev/null 2>&1 || true", timeout=20)


if __name__ == "__main__":
    sys.exit(main())
