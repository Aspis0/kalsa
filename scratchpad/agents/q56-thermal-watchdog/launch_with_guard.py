#!/usr/bin/env python3
"""Launch one CPU-only Android workload under thermal_guard.sh."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
DEFAULT_SERIAL = "192.168.1.152:41679"
REMOTE_DIR = "/data/local/tmp/q56_thermal_watchdog"
REMOTE_GUARD = f"{REMOTE_DIR}/thermal_guard.sh"
HARD_TENTHS = 380
MAX_ALLOWED_SECONDS = 3600


class Device:
    def __init__(self, serial: str):
        self.serial = serial
        self.reconnect_attempts = 0

    @staticmethod
    def _transport_error(result: subprocess.CompletedProcess[str]) -> bool:
        text = (result.stdout + result.stderr).lower()
        return result.returncode != 0 and any(
            marker in text
            for marker in ("device offline", "no devices/emulators found", "failed to get feature set", "connection refused")
        )

    def _reconnect_or_raise(self) -> None:
        if self.reconnect_attempts >= 3:
            raise RuntimeError("adb transport failed after 3 reconnect attempts")
        while self.reconnect_attempts < 3:
            if self.reconnect_attempts:
                time.sleep(90.0)
            self.reconnect_attempts += 1
            env = os.environ.copy()
            env["MSYS_NO_PATHCONV"] = "1"
            mdns = subprocess.run([ADB, "mdns", "services"], text=True, capture_output=True, timeout=20, env=env)
            endpoints = re.findall(r"(\d{1,3}(?:\.\d{1,3}){3}:\d+)", mdns.stdout)
            for endpoint in endpoints:
                connected = subprocess.run([ADB, "connect", endpoint], text=True, capture_output=True, timeout=20, env=env)
                if connected.returncode == 0 and ("connected" in (connected.stdout + connected.stderr).lower() or endpoint == self.serial):
                    self.serial = endpoint
                    return
        raise RuntimeError("adb transport failed after 3 reconnect attempts")

    def adb(self, args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["MSYS_NO_PATHCONV"] = "1"
        result = subprocess.run(
            [ADB, "-s", self.serial, *args],
            text=True,
            capture_output=True,
            timeout=timeout,
            env=env,
        )
        if self._transport_error(result):
            self._reconnect_or_raise()
            result = subprocess.run(
                [ADB, "-s", self.serial, *args],
                text=True,
                capture_output=True,
                timeout=timeout,
                env=env,
            )
        return result

    def shell(self, command: str, timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
        return self.adb(["shell", command], timeout=timeout)

    def pull(self, remote: str, local: Path, timeout: float = 120.0) -> subprocess.CompletedProcess[str]:
        local.parent.mkdir(parents=True, exist_ok=True)
        return self.adb(["pull", remote, str(local)], timeout=timeout)


def parse_key_value(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}=(.*)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def require_safe_workload(workload: list[str]) -> None:
    lowered = [item.lower() for item in workload]
    is_perplexity = any(item == "llama-perplexity" or item.endswith("/llama-perplexity") or item.endswith("\\llama-perplexity") for item in lowered)
    if "htp0" in lowered or "-dev" in lowered or "--device" in lowered:
        raise SystemExit("REFUSING: HTP/NPU device flags are prohibited tonight")
    for i, item in enumerate(lowered):
        if item in {"-ngl", "--n-gpu-layers"} and i + 1 < len(lowered) and lowered[i + 1] == "99":
            raise SystemExit("REFUSING: -ngl 99 is prohibited tonight")
    if is_perplexity:
        ngl_zero = any(
            item in {"-ngl", "--n-gpu-layers"}
            and i + 1 < len(lowered)
            and lowered[i + 1] == "0"
            for i, item in enumerate(lowered)
        )
        if not ngl_zero:
            raise SystemExit("REFUSING: llama-perplexity is allowed only with explicit -ngl 0")


def read_remote_file(device: Device, path: str) -> str:
    result = device.shell(f"cat {shlex.quote(path)}", timeout=10)
    return result.stdout.strip() if result.returncode == 0 else ""


def wait_for_pid_file(device: Device, pid_file: str, deadline: float) -> tuple[int, str, str]:
    while time.monotonic() < deadline:
        text = read_remote_file(device, pid_file)
        pid_text = parse_key_value(text, "BINARY_PID")
        if pid_text.isdigit():
            return int(pid_text), parse_key_value(text, "CPUSET"), text
        time.sleep(0.5)
    raise TimeoutError("workload did not publish BINARY_PID")


def proc_exists(device: Device, pid: int) -> bool:
    result = device.shell(f"test -d /proc/{pid}", timeout=10)
    return result.returncode == 0


def read_int_file(device: Device, path: str) -> int | None:
    value = read_remote_file(device, path)
    try:
        return int(value.splitlines()[0].strip())
    except (ValueError, IndexError):
        return None


def battery_snapshot(device: Device) -> dict[str, int | bool | str | None]:
    result = device.shell("dumpsys battery", timeout=15)
    text = result.stdout + result.stderr
    def integer(key: str) -> int | None:
        match = re.search(rf"^\s*{re.escape(key)}:\s*(-?\d+)", text, re.MULTILINE)
        return int(match.group(1)) if match else None
    def boolean(key: str) -> bool | None:
        match = re.search(rf"^\s*{re.escape(key)}:\s*(true|false)", text, re.MULTILINE | re.IGNORECASE)
        return match.group(1).lower() == "true" if match else None
    return {
        "level": integer("level"),
        "temperature_tenths": integer("temperature"),
        "voltage_mv": integer("voltage"),
        "health": integer("health"),
        "ac_powered": boolean("AC powered"),
        "usb_powered": boolean("USB powered"),
        "wireless_powered": boolean("Wireless powered"),
        "returncode": result.returncode,
    }


def running_ppl_values(text: str) -> dict[int, float]:
    values: dict[int, float] = {}
    for line in text.splitlines():
        match = re.search(r"^\[(\d+)\]([0-9]+(?:\.[0-9]+)?)", line)
        if match:
            values[int(match.group(1))] = float(match.group(2))
    return values


def append_text(path: Path, text: str) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def kill_workload(device: Device, pid: int) -> None:
    device.shell(f"kill -9 {pid}", timeout=10)


def max_temp_from_guard_log(text: str) -> int | None:
    maximum: int | None = None
    for line in text.splitlines():
        fields = line.split(",")
        if len(fields) < 2:
            continue
        try:
            value = int(fields[1])
        except ValueError:
            continue
        maximum = value if maximum is None else max(maximum, value)
    return maximum


def launch(args: argparse.Namespace) -> int:
    workload = list(args.workload)
    if workload and workload[0] == "--":
        workload = workload[1:]
    if not workload:
        raise SystemExit("missing workload after --")
    require_safe_workload(workload)
    if args.max_seconds <= 0 or args.max_seconds > MAX_ALLOWED_SECONDS:
        raise SystemExit(f"max_seconds must be in 1..{MAX_ALLOWED_SECONDS}")
    if args.kill_tenths >= HARD_TENTHS and args.tag.startswith("test1"):
        raise SystemExit("test1 kill threshold must be below the hard 38.0 C cutoff")

    device = Device(args.serial)
    local_dir = Path(args.local_dir)
    local_dir.mkdir(parents=True, exist_ok=True)
    remote_tag = re.sub(r"[^A-Za-z0-9_.-]", "_", args.tag)
    remote_workload_log = f"{REMOTE_DIR}/{remote_tag}.stdout.jsonl"
    remote_stderr_log = f"{REMOTE_DIR}/{remote_tag}.stderr.log"
    remote_guard_log = f"{REMOTE_DIR}/{remote_tag}.guard.log"
    remote_pid_file = f"{REMOTE_DIR}/{remote_tag}.pid"
    remote_rc_file = f"{REMOTE_DIR}/{remote_tag}.workload.rc"
    remote_guard_rc_file = f"{REMOTE_DIR}/{remote_tag}.guard.rc"

    initial_battery = battery_snapshot(device)
    if initial_battery["returncode"] != 0 or initial_battery["level"] is None or initial_battery["temperature_tenths"] is None:
        raise SystemExit("REFUSING: initial battery snapshot unavailable")
    if int(initial_battery["level"]) < 50:
        raise SystemExit(f"REFUSING: initial battery level below 50% ({initial_battery['level']}%)")
    if int(initial_battery["temperature_tenths"]) > 300:
        raise SystemExit(f"REFUSING: initial battery temperature above 30.0 C ({initial_battery['temperature_tenths']})")
    if any(initial_battery[key] is True for key in ("ac_powered", "usb_powered", "wireless_powered")):
        raise SystemExit("REFUSING: device charging state is not unplugged")

    battery_log_path = local_dir / f"{remote_tag}.battery.log"
    live_tail_path = local_dir / f"{remote_tag}.live.stderr.tail.log"
    running_log_path = local_dir / f"{remote_tag}.running_ppl.log"
    battery_samples: list[dict[str, int | bool | str | None]] = []
    running_values: dict[int, float] = {}
    battery_floor_triggered = False
    battery_floor_chunk: int | None = None
    battery_poll_error = False
    htp_execute_op_detected = False
    abort_reason = ""

    # The q46 HTP-linked environment is retained for the known ngl=0 behavior,
    # but the workload command itself must prove CPU offload with -ngl 0 and
    # must not contain -dev HTP0.
    quoted_workload = " ".join(shlex.quote(item) for item in workload)
    setup = " ; ".join(
        [
            f"cd {shlex.quote('/data/local/tmp/kalsahtp')}",
            "export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64",
            "export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp",
            "export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp",
            "export GGML_HEXAGON_NDEV=1",
            "export GGML_HEXAGON_VERBOSE=1",
            "unset GGML_HEXAGON_HOSTBUF",
            "unset GGML_OPENCL_LOG_ALLOC",
        ]
    )
    # The inner subshell execs the workload, so $child is the actual binary
    # PID captured in BINARY_PID/CPUSET, not a supervising shell PID.
    workload_wrapper = (
        f"( {setup} ; exec {quoted_workload} > {shlex.quote(remote_workload_log)} "
        f"2> {shlex.quote(remote_stderr_log)} ) & child=$!; "
        f"echo BINARY_PID=$child > {shlex.quote(remote_pid_file)}; "
        f"if [ -r /proc/$child/cpuset ]; then echo CPUSET=$(cat /proc/$child/cpuset) >> "
        f"{shlex.quote(remote_pid_file)}; else echo CPUSET_UNAVAILABLE >> "
        f"{shlex.quote(remote_pid_file)}; fi; wait $child; rc=$?; "
        f"echo $rc > {shlex.quote(remote_rc_file)}; exit $rc"
    )
    launcher_command = (
        f"mkdir -p {shlex.quote(REMOTE_DIR)}; "
        f"nohup setsid sh -c {shlex.quote(workload_wrapper)} "
        f"</dev/null >/dev/null 2>&1 & echo LAUNCH_PID=$!"
    )

    started = time.time()
    launch_result = device.shell(launcher_command, timeout=20)
    launch_text = launch_result.stdout + launch_result.stderr
    pid, cpuset, pid_file_text = wait_for_pid_file(device, remote_pid_file, time.monotonic() + 15.0)

    guard_inner = (
        f"{shlex.quote(REMOTE_GUARD)} {pid} {args.warn_tenths} {args.kill_tenths} "
        f"{shlex.quote(remote_guard_log)} {args.interval_s}; rc=$?; "
        f"echo $rc > {shlex.quote(remote_guard_rc_file)}; exit $rc"
    )
    guard_command = (
        f"nohup setsid sh -c {shlex.quote(guard_inner)} </dev/null >/dev/null 2>&1 & "
        "echo GUARD_LAUNCH_PID=$!"
    )
    guard_result = device.shell(guard_command, timeout=20)
    guard_text = guard_result.stdout + guard_result.stderr

    deadline = time.monotonic() + args.max_seconds
    timed_out = False
    next_battery_poll = 0.0
    next_log_tail = 0.0
    while proc_exists(device, pid):
        now = time.monotonic()
        if now >= next_battery_poll:
            sample = battery_snapshot(device)
            battery_samples.append(sample)
            epoch = int(time.time())
            append_text(
                battery_log_path,
                f"{epoch},{sample.get('temperature_tenths')},{sample.get('level')},{sample.get('returncode')}\n",
            )
            next_battery_poll = now + 10.0
            if sample["returncode"] != 0 or sample["level"] is None or sample["temperature_tenths"] is None:
                battery_poll_error = True
                abort_reason = "battery_poll_unavailable"
                kill_workload(device, pid)
                break
            if int(sample["level"]) < 45:
                battery_floor_triggered = True
                battery_floor_chunk = max(running_values) if running_values else None
                abort_reason = "battery_below_45_percent"
                kill_workload(device, pid)
                break

        if now >= next_log_tail:
            stderr_tail_result = device.shell(f"tail -n 600 {shlex.quote(remote_stderr_log)}", timeout=20)
            stdout_tail_result = device.shell(f"tail -n 600 {shlex.quote(remote_workload_log)}", timeout=20)
            stderr_tail = stderr_tail_result.stdout if stderr_tail_result.returncode == 0 else ""
            stdout_tail = stdout_tail_result.stdout if stdout_tail_result.returncode == 0 else ""
            tail_text = stderr_tail + ("\n" if stderr_tail and stdout_tail else "") + stdout_tail
            if tail_text:
                live_tail_path.write_text(tail_text, encoding="utf-8", newline="\n")
                latest = running_ppl_values(tail_text)
                for chunk, value in sorted(latest.items()):
                    if running_values.get(chunk) != value:
                        running_values[chunk] = value
                        append_text(running_log_path, f"{int(time.time())},[{chunk}]{value}\n")
                if re.search(r"execute-op.*HTP0|HTP0.*execute-op", tail_text, re.I):
                    htp_execute_op_detected = True
                    abort_reason = "HTP0_execute_op_detected"
                    kill_workload(device, pid)
                    break
            next_log_tail = now + 10.0

        if time.monotonic() >= deadline:
            timed_out = True
            abort_reason = "launcher_wall_clock_cap"
            kill_workload(device, pid)
            break
        time.sleep(2.0)

    # Let the wrapper and detached guard publish their rc files, but do not
    # extend the workload wall-clock cap.
    settle_deadline = time.monotonic() + 10.0
    while time.monotonic() < settle_deadline:
        if read_int_file(device, remote_rc_file) is not None and read_int_file(device, remote_guard_rc_file) is not None:
            break
        time.sleep(0.5)

    workload_rc = read_int_file(device, remote_rc_file)
    guard_rc = read_int_file(device, remote_guard_rc_file)
    pulls = {}
    for remote, local_name in [
        (remote_workload_log, f"{remote_tag}.stdout.jsonl"),
        (remote_stderr_log, f"{remote_tag}.stderr.log"),
        (remote_guard_log, f"{remote_tag}.guard.log"),
    ]:
        result = device.pull(remote, local_dir / local_name, timeout=120)
        pulls[remote] = {"returncode": result.returncode, "output": result.stdout + result.stderr}

    guard_local = local_dir / f"{remote_tag}.guard.log"
    stderr_local = local_dir / f"{remote_tag}.stderr.log"
    guard_log = guard_local.read_text(encoding="utf-8", errors="replace") if guard_local.exists() else ""
    stdout_local = local_dir / f"{remote_tag}.stdout.jsonl"
    stdout_log = stdout_local.read_text(encoding="utf-8", errors="replace") if stdout_local.exists() else ""
    stderr_log = stderr_local.read_text(encoding="utf-8", errors="replace") if stderr_local.exists() else ""
    execute_op_htp0 = bool(re.search(r"execute-op.*HTP0|HTP0.*execute-op", stderr_log, re.I))
    execute_op_htp0 = execute_op_htp0 or bool(re.search(r"execute-op.*HTP0|HTP0.*execute-op", stdout_log, re.I))
    running_values.update(running_ppl_values(stdout_log))
    running_values.update(running_ppl_values(stderr_log))
    final_battery = battery_snapshot(device)
    if final_battery["returncode"] == 0:
        battery_samples.append(final_battery)
        append_text(
            battery_log_path,
            f"{int(time.time())},{final_battery.get('temperature_tenths')},{final_battery.get('level')},{final_battery.get('returncode')}\n",
        )
    if execute_op_htp0:
        htp_execute_op_detected = True
        abort_reason = abort_reason or "HTP0_execute_op_detected"
    if battery_floor_chunk is None and battery_floor_triggered:
        battery_floor_chunk = max(running_values) if running_values else None
    manifest = {
        "tag": args.tag,
        "serial": args.serial,
        "binary_pid": pid,
        "cpuset": cpuset or "CPUSET_UNAVAILABLE",
        "workload": workload,
        "environment": {
            "LD_LIBRARY_PATH": "/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64",
            "ADSP_LIBRARY_PATH": "/data/local/tmp/kalsahtp",
            "CDSP_LIBRARY_PATH": "/data/local/tmp/kalsahtp",
            "GGML_HEXAGON_NDEV": "1",
            "GGML_HEXAGON_VERBOSE": "1",
            "GGML_HEXAGON_HOSTBUF": "unset",
            "GGML_OPENCL_LOG_ALLOC": "unset",
        },
        "guard": {
            "pid_file": pid_file_text,
            "warn_tenths": args.warn_tenths,
            "kill_tenths": args.kill_tenths,
            "hard_abort_tenths": HARD_TENTHS,
            "interval_s": args.interval_s,
            "exit_code": guard_rc,
            "max_temperature_tenths": max_temp_from_guard_log(guard_log),
        },
        "workload_rc": workload_rc,
        "timed_out": timed_out,
        "abort_reason": abort_reason,
        "wall_seconds_until_poll_end": round(time.time() - started, 3),
        "battery_start": initial_battery,
        "battery_end": final_battery,
        "battery_samples": battery_samples,
        "battery_floor_triggered": battery_floor_triggered,
        "battery_floor_chunk": battery_floor_chunk,
        "battery_poll_error": battery_poll_error,
        "running_ppl_values": {str(chunk): value for chunk, value in sorted(running_values.items())},
        "running_ppl_max_chunk": max(running_values) if running_values else None,
        "launch_stdout": launch_text,
        "guard_launch_stdout": guard_text,
        "execute_op_htp0_in_stderr": htp_execute_op_detected,
        "pulls": pulls,
    }
    manifest_path = Path(args.manifest_path) if args.manifest_path else local_dir / f"{remote_tag}.manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    if htp_execute_op_detected:
        print("STOP: HTP0 execute-op evidence found in workload stderr", file=sys.stderr)
        return 3
    if timed_out:
        return 124
    if guard_rc == 2:
        return 0
    if guard_rc != 0 or workload_rc != 0:
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default=os.environ.get("ADB_SERIAL", DEFAULT_SERIAL))
    parser.add_argument("--tag", required=True)
    parser.add_argument("--warn-tenths", type=int, required=True)
    parser.add_argument("--kill-tenths", type=int, required=True)
    parser.add_argument("--interval-s", type=int, default=1)
    parser.add_argument("--max-seconds", type=int, default=120)
    parser.add_argument("--local-dir", default=str(HERE / "raw"))
    parser.add_argument("--manifest-path", default="")
    parser.add_argument("workload", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    return launch(args)


if __name__ == "__main__":
    raise SystemExit(main())
