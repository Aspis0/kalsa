#!/usr/bin/env python3
"""Launch one S23 workload under q56 thermal_guard. No global adb, no mdns reconnect."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

SERIAL = "192.168.1.152:37687"
REMOTE_DIR = "/data/local/tmp/s23_unplugged_night0"
REMOTE_SCRIPT = f"{REMOTE_DIR}/run_guarded.sh"
CELL = Path(__file__).resolve().parent
STOP_RE = re.compile(
    r"CDSP0 CRASHED|dspqueue_.* failed|INTERNAL-ERROR|ggml_abort|GGML_ASSERT|"
    r"\bAborted\b|\bSegmentation\b",
    re.I,
)
EXIT_ADB = 76
EXIT_CPUSET = 93


def adb(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    drop_deadline = time.monotonic() + 600.0
    while True:
        try:
            result = subprocess.run(
                ["adb", "-s", SERIAL, *args],
                text=True,
                capture_output=True,
                timeout=timeout,
                env=env,
            )
        except subprocess.TimeoutExpired:
            ensure_transport(drop_deadline)
            continue
        except OSError:
            ensure_transport(drop_deadline)
            continue
        if transport_ok(result):
            return result
        ensure_transport(drop_deadline)


def transport_ok(result: subprocess.CompletedProcess[str]) -> bool:
    text = (result.stdout + result.stderr).lower()
    if result.returncode == 0:
        return True
    return not any(
        m in text
        for m in (
            "device offline",
            "no devices/emulators found",
            "connection refused",
            "cannot connect",
            "device not found",
        )
    )


def _get_state() -> str:
    try:
        st = subprocess.run(
            ["adb", "-s", SERIAL, "get-state"],
            text=True,
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (st.stdout + st.stderr).strip()


def ensure_transport(deadline: float | None = None) -> None:
    """On drop: adb connect same IP:port only, until deadline (default 10 min). No TimeoutExpired kill."""
    if _get_state() == "device":
        return
    if deadline is None:
        deadline = time.monotonic() + 600.0
    while time.monotonic() < deadline:
        try:
            subprocess.run(
                ["adb", "connect", SERIAL],
                text=True,
                capture_output=True,
                timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
        if _get_state() == "device":
            return
        time.sleep(5)
    raise SystemExit("BLOCKED: adb transport lost for 10 min")


def shell(cmd: str, timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    return adb(["shell", cmd], timeout=timeout)


def parse_battery(text: str) -> dict:
    def integer(key: str):
        m = re.search(rf"^  {re.escape(key)}:\s*(-?\d+)", text, re.M)
        return int(m.group(1)) if m else None

    def boolean(key: str):
        m = re.search(rf"^  {re.escape(key)}:\s*(true|false)", text, re.M | re.I)
        return m.group(1).lower() == "true" if m else None

    return {
        "level": integer("level"),
        "temperature_tenths": integer("temperature"),
        "voltage_mv": integer("voltage"),
        "ac_powered": boolean("AC powered"),
        "usb_powered": boolean("USB powered"),
        "wireless_powered": boolean("Wireless powered"),
        "dock_powered": boolean("Dock powered"),
        "status": integer("status"),
        "raw": text,
    }


def battery() -> dict:
    r = shell("dumpsys battery", timeout=20)
    snap = parse_battery(r.stdout + r.stderr)
    snap["returncode"] = r.returncode
    return snap


def plugged(snap: dict) -> bool:
    return any(snap.get(k) is True for k in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))


def screen_state() -> str:
    r = shell("dumpsys power | grep -E 'mWakefulness='", timeout=20)
    m = re.search(r"mWakefulness=(\S+)", r.stdout + r.stderr)
    return m.group(1) if m else "UNKNOWN"


def thermal_zones() -> str:
    r = shell(
        "for z in /sys/class/thermal/thermal_zone*; do "
        "t=$(cat $z/type 2>/dev/null); v=$(cat $z/temp 2>/dev/null); "
        "echo $t=$v; done",
        timeout=20,
    )
    return r.stdout


def read_remote(path: str) -> str:
    r = shell(f"cat {path} 2>/dev/null", timeout=15)
    return r.stdout if r.returncode == 0 else ""


def pull(remote: str, local: Path) -> None:
    local.parent.mkdir(parents=True, exist_ok=True)
    adb(["pull", remote, str(local)], timeout=120)


def launch(tag: str, cmd_body: str, max_seconds: int, warn: int = 400, kill: int = 430, interval: int = 10) -> dict:
    raw = CELL / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    reconnect_deadline = time.monotonic() + 600
    ensure_transport(reconnect_deadline)
    pre = battery()
    if pre.get("returncode") != 0 or pre.get("level") is None or pre.get("temperature_tenths") is None:
        raise SystemExit("BLOCKED: battery snapshot unavailable")
    if int(pre["level"]) < 45:
        raise SystemExit(f"BATTERY_FLOOR: {pre['level']}%")
    if plugged(pre):
        raise SystemExit("PLUG_FAILURE: ac/usb/wireless true (unplugged declared)")
    pre_screen = screen_state()
    pre_zones = thermal_zones()
    (raw / f"{tag}.battery.pre.txt").write_text(pre["raw"], encoding="utf-8", newline="\n")
    (raw / f"{tag}.thermals.pre.txt").write_text(pre_zones, encoding="utf-8", newline="\n")

    cmdfile = f"{REMOTE_DIR}/{tag}.cmd.sh"
    body = cmd_body if cmd_body.endswith("\n") else cmd_body + "\n"
    local_cmd = raw / f"{tag}.cmd.sh"
    local_cmd.write_text(body, encoding="utf-8", newline="\n")
    adb(["push", str(local_cmd), cmdfile], timeout=30)
    shell(f"chmod 755 {cmdfile} {REMOTE_SCRIPT}", timeout=10)

    starter = (
        f"nohup setsid sh {REMOTE_SCRIPT} {tag} {warn} {kill} {interval} {cmdfile} "
        f"</dev/null >/dev/null 2>&1 & echo LAUNCH_PID=$!"
    )
    started = time.time()
    lr = shell(starter, timeout=20)
    launch_text = lr.stdout + lr.stderr
    m = re.search(r"LAUNCH_PID=(\d+)", launch_text)
    if not m:
        raise SystemExit(f"supervisor did not publish LAUNCH_PID: {launch_text}")
    abort = ""
    failure_sig = ""
    deadline = time.monotonic() + max_seconds
    pid = None
    while time.monotonic() < deadline:
        ensure_transport(time.monotonic() + 600)
        snap = battery()
        (raw / f"{tag}.battery.samples.log").open("a", encoding="utf-8", newline="\n").write(
            f"{int(time.time())},{snap.get('temperature_tenths')},{snap.get('level')},{snap.get('ac_powered')}\n"
        )
        if plugged(snap):
            abort = "PLUG_FAILURE"
            if pid:
                shell(f"kill -9 {pid}", timeout=10)
            break
        if snap.get("level") is not None and int(snap["level"]) < 45:
            # Finish the in-flight run; orchestrator must not start the next cell.
            abort = abort or "BATTERY_FLOOR_AFTER_RUN"
        pid_text = read_remote(f"{REMOTE_DIR}/{tag}.pid")
        pm = re.search(r"BINARY_PID=(\d+)", pid_text)
        if pm:
            pid = int(pm.group(1))
        wrc = read_remote(f"{REMOTE_DIR}/{tag}.workload_rc").strip()
        if wrc != "":
            break
        err_tail = shell(f"tail -n 80 {REMOTE_DIR}/{tag}.err 2>/dev/null", timeout=15).stdout
        out_tail = shell(f"tail -n 80 {REMOTE_DIR}/{tag}.out 2>/dev/null", timeout=15).stdout
        sig = STOP_RE.search(err_tail + "\n" + out_tail)
        if sig:
            failure_sig = sig.group(0)
            abort = "workload_failure_signature"
            if pid:
                shell(f"kill -9 {pid}", timeout=10)
            break
        time.sleep(2)
    else:
        abort = "launcher_wall_clock_cap"
        if pid:
            shell(f"kill -9 {pid}", timeout=10)

    time.sleep(1)
    wrc_s = read_remote(f"{REMOTE_DIR}/{tag}.workload_rc").strip()
    grc_s = read_remote(f"{REMOTE_DIR}/{tag}.guard_rc").strip()
    post = battery()
    post_screen = screen_state()
    (raw / f"{tag}.battery.post.txt").write_text(post.get("raw") or "", encoding="utf-8", newline="\n")
    (raw / f"{tag}.thermals.post.txt").write_text(thermal_zones(), encoding="utf-8", newline="\n")
    for name in (
        f"{tag}.out",
        f"{tag}.err",
        f"{tag}.guard.log",
        f"{tag}.pid",
        f"{tag}_HARNESS_cpuset.txt",
        f"{tag}_BIN_cpuset.txt",
        f"{tag}.supervisor_failure",
        f"{tag}_BIN_why.txt",
        f"{tag}.workload_rc",
        f"{tag}.guard_rc",
    ):
        pull(f"{REMOTE_DIR}/{name}", raw / name)
    stdout = (raw / f"{tag}.out").read_text(encoding="utf-8", errors="replace") if (raw / f"{tag}.out").exists() else ""
    stderr = (raw / f"{tag}.err").read_text(encoding="utf-8", errors="replace") if (raw / f"{tag}.err").exists() else ""
    harness = (raw / f"{tag}_HARNESS_cpuset.txt").read_text(encoding="utf-8", errors="replace") if (raw / f"{tag}_HARNESS_cpuset.txt").exists() else ""
    bincs = (raw / f"{tag}_BIN_cpuset.txt").read_text(encoding="utf-8", errors="replace") if (raw / f"{tag}_BIN_cpuset.txt").exists() else ""
    if not failure_sig:
        sm = STOP_RE.search(stdout + "\n" + stderr)
        if sm:
            failure_sig = sm.group(0)
            abort = abort or "workload_failure_signature"
    workload_rc = int(wrc_s) if wrc_s.lstrip("-").isdigit() else None
    guard_rc = int(grc_s) if grc_s.lstrip("-").isdigit() else None
    cpuset_fail = workload_rc == EXIT_CPUSET or "FAIL_CPUSET" in harness or "FAIL_CPUSET" in bincs
    if workload_rc is not None and workload_rc >= 128 and guard_rc not in (2, 3) and not abort:
        abort = "workload_rc_ge_128"
        failure_sig = failure_sig or f"workload_rc={workload_rc}"
    row = {
        "tag": tag,
        "serial": SERIAL,
        "workload_rc": workload_rc,
        "guard_rc": guard_rc,
        "binary_pid": pid,
        "abort": abort,
        "failure_signature": failure_sig,
        "cpuset_fail": cpuset_fail,
        "battery_pre": {k: v for k, v in pre.items() if k != "raw"},
        "battery_post": {k: v for k, v in post.items() if k != "raw"},
        "screen_pre": pre_screen,
        "screen_post": post_screen,
        "plugged_pre": plugged(pre),
        "plugged_post": plugged(post),
        "harness_cpuset": harness,
        "bin_cpuset": bincs,
        "wall_s": round(time.time() - started, 3),
        "launch_stdout": launch_text,
    }
    (raw / f"{tag}.cell.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
    print(
        f"CELL {tag} exit={row.get('launcher_exit')} rc={workload_rc} guard={guard_rc} "
        f"abort={abort!r} cpuset_fail={cpuset_fail}",
        flush=True,
    )
    if cpuset_fail:
        return {**row, "launcher_exit": EXIT_CPUSET}
    if abort == "PLUG_FAILURE":
        return {**row, "launcher_exit": 2}
    if abort == "BATTERY_FLOOR":
        return {**row, "launcher_exit": 2}
    if failure_sig:
        return {**row, "launcher_exit": 4}
    if abort == "launcher_wall_clock_cap":
        return {**row, "launcher_exit": 124}
    if guard_rc == 2:
        return {**row, "launcher_exit": 2}
    if workload_rc != 0 or (guard_rc not in (0, None)):
        return {**row, "launcher_exit": 1}
    return {**row, "launcher_exit": 0}


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: launch_one.py TAG MAX_SECONDS CMD_BODY", file=sys.stderr)
        return 64
    tag, max_s, cmd = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    row = launch(tag, cmd, max_s)
    return int(row["launcher_exit"])


if __name__ == "__main__":
    raise SystemExit(main())
