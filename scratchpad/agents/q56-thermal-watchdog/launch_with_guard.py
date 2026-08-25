#!/usr/bin/env python3
"""Launch an Android workload under a detached, fail-closed thermal guard.

The on-device supervisor starts the guard first. A workload wrapper is then
created, but it waits until the guard has sampled the sensor and confirmed the
wrapper PID before execing the real workload. This removes the PID/exec race.
"""

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
MAX_ALLOWED_SECONDS = 3600
DEFAULT_SENSOR_FAILURE_LIMIT = 4
MIN_FREE_KB = 500 * 1024
EXIT_GUARD_LIVENESS = 75
EXIT_ADB_DISCONNECT = 76
EXIT_WORKLOAD_NOT_STARTED = 77


class AdbTransportError(RuntimeError):
    """ADB failed after the bounded reconnect policy was exhausted."""


class GuardLivenessError(RuntimeError):
    """The guard was not alive and sampling before the workload could run."""


class Device:
    def __init__(self, serial: str):
        self.serial = serial
        self.reconnect_attempts = 0

    @staticmethod
    def _transport_error(result: subprocess.CompletedProcess[str]) -> bool:
        text = (result.stdout + result.stderr).lower()
        return result.returncode != 0 and any(
            marker in text
            for marker in (
                "device offline",
                "no devices/emulators found",
                "failed to get feature set",
                "connection refused",
                "cannot connect",
                "closed",
            )
        )

    def _reconnect_or_raise(self) -> None:
        if self.reconnect_attempts >= 3:
            raise AdbTransportError("adb transport failed after 3 reconnect attempts")
        last_error = "adb transport unavailable"
        while self.reconnect_attempts < 3:
            if self.reconnect_attempts:
                time.sleep(90.0)
            self.reconnect_attempts += 1
            env = os.environ.copy()
            env["MSYS_NO_PATHCONV"] = "1"
            try:
                mdns = subprocess.run(
                    [ADB, "mdns", "services"],
                    text=True,
                    capture_output=True,
                    timeout=20,
                    env=env,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                last_error = str(exc)
                continue
            endpoints = re.findall(r"(\d{1,3}(?:\.\d{1,3}){3}:\d+)", mdns.stdout)
            if self.serial not in endpoints:
                endpoints.insert(0, self.serial)
            for endpoint in endpoints:
                try:
                    connected = subprocess.run(
                        [ADB, "connect", endpoint],
                        text=True,
                        capture_output=True,
                        timeout=20,
                        env=env,
                    )
                except (OSError, subprocess.TimeoutExpired) as exc:
                    last_error = str(exc)
                    continue
                connect_text = (connected.stdout + connected.stderr).lower()
                if connected.returncode == 0 and (
                    "connected" in connect_text
                    or "already connected" in connect_text
                    or endpoint == self.serial
                ):
                    self.serial = endpoint
                    return
                last_error = connected.stdout + connected.stderr
        raise AdbTransportError(f"adb reconnect budget exhausted: {last_error.strip()}")

    def adb(self, args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["MSYS_NO_PATHCONV"] = "1"
        try:
            result = subprocess.run(
                [ADB, "-s", self.serial, *args],
                text=True,
                capture_output=True,
                timeout=timeout,
                env=env,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            self._reconnect_or_raise()
            raise AdbTransportError(str(exc)) from exc
        if self._transport_error(result):
            self._reconnect_or_raise()
            try:
                result = subprocess.run(
                    [ADB, "-s", self.serial, *args],
                    text=True,
                    capture_output=True,
                    timeout=timeout,
                    env=env,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise AdbTransportError(str(exc)) from exc
            if self._transport_error(result):
                raise AdbTransportError(result.stdout + result.stderr)
        return result

    def shell(self, command: str, timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
        return self.adb(["shell", command], timeout=timeout)

    def pull(self, remote: str, local: Path, timeout: float = 120.0) -> subprocess.CompletedProcess[str]:
        local.parent.mkdir(parents=True, exist_ok=True)
        return self.adb(["pull", remote, str(local)], timeout=timeout)


def parse_key_value(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}=(.*)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def read_remote_file(device: Device, path: str) -> str:
    result = device.shell(f"cat {shlex.quote(path)}", timeout=10)
    return result.stdout.strip() if result.returncode == 0 else ""


def read_int_file(device: Device, path: str) -> int | None:
    value = read_remote_file(device, path)
    try:
        return int(value.splitlines()[0].strip())
    except (ValueError, IndexError):
        return None


def proc_exists(device: Device, pid: int) -> bool:
    result = device.shell(f"test -d /proc/{pid} && kill -0 {pid}", timeout=10)
    return result.returncode == 0


def require_safe_workload(workload: list[str], allow_npu: bool = False) -> None:
    lowered = [item.lower() for item in workload]
    is_perplexity = any(
        item == "llama-perplexity"
        or item.endswith("/llama-perplexity")
        or item.endswith("\\llama-perplexity")
        for item in lowered
    )
    npu_requested = "htp0" in lowered or "-dev" in lowered or "--device" in lowered
    for i, item in enumerate(lowered):
        if item in {"-ngl", "--n-gpu-layers"} and i + 1 < len(lowered) and lowered[i + 1] == "99":
            npu_requested = True
    if npu_requested and not allow_npu:
        raise SystemExit("REFUSING: HTP/NPU device flags require explicit --allow-npu")
    if is_perplexity:
        ngl_zero = any(
            item in {"-ngl", "--n-gpu-layers"}
            and i + 1 < len(lowered)
            and lowered[i + 1] == "0"
            for i, item in enumerate(lowered)
        )
        if not ngl_zero and not allow_npu:
            raise SystemExit("REFUSING: llama-perplexity is allowed only with explicit -ngl 0")


def failure_signature_line(text: str) -> str:
    for line in text.splitlines():
        if re.search(r"ggml_abort|ggml_assert|dspqueue|INTERNAL-ERROR|\baborted\b|\bsegmentation\b", line, re.IGNORECASE):
            return line.strip()
        # Normal startup uses lower-case "cdsp" in the URI/domain and
        # libcdsprpc name. The authorized crash marker is the explicit
        # upper-case CDSP token.
        if re.search(r"\bCDSP\b", line):
            return line.strip()
    return ""


def battery_snapshot(device: Device) -> dict[str, int | bool | None]:
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
        for match in re.finditer(r"\[(\d+)\]([0-9]+(?:\.[0-9]+)?)", line):
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
        if len(fields) < 2 or not fields[0].isdigit() or not re.fullmatch(r"-?\d+", fields[1]):
            continue
        value = int(fields[1])
        maximum = value if maximum is None else max(maximum, value)
    return maximum


def guard_has_sample(text: str) -> bool:
    return bool(re.search(r"^\d+,\d+,-?\d+(?:$|,)", text, re.MULTILINE))


def guard_outcome(guard_rc: int | None, guard_liveness_abort: bool, guard_log: str) -> str:
    if guard_liveness_abort or guard_rc == 75:
        return "guard-not-ready"
    if guard_rc == 0:
        return "normal"
    if guard_rc == 2:
        return "thermal kill"
    if guard_rc == 3:
        return "sensor fail-closed"
    return "other"


def wait_for_guard_ready(
    device: Device,
    supervisor_pid: int,
    guard_pid_file: str,
    ready_file: str,
    guard_log_file: str,
    interval_s: int,
) -> int:
    deadline = time.monotonic() + max(2.0 * interval_s + 5.0, 10.0)
    while time.monotonic() < deadline:
        guard_text = read_remote_file(device, guard_pid_file)
        guard_pid_text = parse_key_value(guard_text, "GUARD_PID")
        if guard_pid_text.isdigit():
            guard_pid = int(guard_pid_text)
            if not proc_exists(device, guard_pid):
                raise GuardLivenessError("guard died before first sample")
        elif not proc_exists(device, supervisor_pid):
            raise GuardLivenessError("supervisor died before guard readiness")
        ready_text = read_remote_file(device, ready_file)
        log_text = read_remote_file(device, guard_log_file)
        if guard_pid_text.isdigit() and parse_key_value(ready_text, "GUARD_READY").isdigit() and guard_has_sample(log_text):
            return int(guard_pid_text)
        time.sleep(0.25)
    raise GuardLivenessError("guard did not publish a first sample within max(2 intervals, 10 seconds)")


def wait_for_tracking(device: Device, guard_pid: int, tracking_file: str, interval_s: int) -> None:
    deadline = time.monotonic() + max(2.0 * interval_s, 5.0)
    while time.monotonic() < deadline:
        if not proc_exists(device, guard_pid):
            raise GuardLivenessError("guard died before tracking the workload wrapper")
        if parse_key_value(read_remote_file(device, tracking_file), "GUARD_TRACKING").isdigit():
            return
        time.sleep(0.25)
    raise GuardLivenessError("guard did not track the workload wrapper")


def disk_available_kb(device: Device) -> int | None:
    result = device.shell("df -k /data/local/tmp", timeout=15)
    values = re.findall(r"\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s", result.stdout)
    return int(values[-1][2]) if values else None


def launch(args: argparse.Namespace) -> int:
    workload = list(args.workload)
    if workload and workload[0] == "--":
        workload = workload[1:]
    if not workload:
        raise SystemExit("missing workload after --")
    require_safe_workload(workload, args.allow_npu)
    if args.max_seconds <= 0 or args.max_seconds > MAX_ALLOWED_SECONDS:
        raise SystemExit(f"max_seconds must be in 1..{MAX_ALLOWED_SECONDS}")
    if args.warn_tenths < 0 or args.kill_tenths <= 0 or args.warn_tenths > args.kill_tenths:
        raise SystemExit("warn/kill thresholds are invalid")
    if args.session_hard_cap_tenths < 0:
        raise SystemExit("session_hard_cap_tenths must be >= 0")
    if args.interval_s <= 0 or args.sensor_failure_limit <= 0:
        raise SystemExit("interval_s and sensor_failure_limit must be positive")

    device = Device(args.serial)
    local_dir = Path(args.local_dir)
    local_dir.mkdir(parents=True, exist_ok=True)
    remote_tag = re.sub(r"[^A-Za-z0-9_.-]", "_", args.tag)
    remote_workload_log = f"{REMOTE_DIR}/{remote_tag}.stdout.jsonl"
    remote_stderr_log = f"{REMOTE_DIR}/{remote_tag}.stderr.log"
    remote_guard_log = f"{REMOTE_DIR}/{remote_tag}.guard.log"
    remote_pid_file = f"{REMOTE_DIR}/{remote_tag}.pid"
    remote_exec_pid_file = f"{REMOTE_DIR}/{remote_tag}.workload.exec.pid"
    remote_guard_pid_file = f"{REMOTE_DIR}/{remote_tag}.guard.pid"
    remote_guard_ready_file = f"{REMOTE_DIR}/{remote_tag}.guard.ready"
    remote_guard_tracking_file = f"{REMOTE_DIR}/{remote_tag}.guard.tracking"
    remote_rc_file = f"{REMOTE_DIR}/{remote_tag}.workload.rc"
    remote_start_failure_file = f"{REMOTE_DIR}/{remote_tag}.workload.start_failure"
    remote_guard_rc_file = f"{REMOTE_DIR}/{remote_tag}.guard.rc"
    remote_supervisor_failure_file = f"{REMOTE_DIR}/{remote_tag}.supervisor.failure"
    remote_run_files = (
        remote_workload_log,
        remote_stderr_log,
        remote_guard_log,
        remote_pid_file,
        remote_exec_pid_file,
        remote_guard_pid_file,
        remote_guard_ready_file,
        remote_guard_tracking_file,
        remote_rc_file,
        remote_start_failure_file,
        remote_guard_rc_file,
        remote_supervisor_failure_file,
    )

    initial_battery = battery_snapshot(device)
    if initial_battery["returncode"] != 0 or initial_battery["level"] is None or initial_battery["temperature_tenths"] is None:
        raise SystemExit("REFUSING: initial battery snapshot unavailable")
    if int(initial_battery["level"]) < 50:
        raise SystemExit(f"REFUSING: initial battery level below 50% ({initial_battery['level']}%)")
    if int(initial_battery["temperature_tenths"]) > 320:
        raise SystemExit(f"REFUSING: initial battery temperature above 32.0 C ({initial_battery['temperature_tenths']})")
    if any(initial_battery[key] is True for key in ("ac_powered", "usb_powered", "wireless_powered")):
        raise SystemExit("REFUSING: device charging state is not unplugged")
    available_kb = disk_available_kb(device)
    if available_kb is None or available_kb < MIN_FREE_KB:
        raise SystemExit(f"REFUSING: /data/local/tmp free space below {MIN_FREE_KB} KB")

    battery_log_path = local_dir / f"{remote_tag}.battery.log"
    live_tail_path = local_dir / f"{remote_tag}.live.stderr.tail.log"
    running_log_path = local_dir / f"{remote_tag}.running_ppl.log"
    battery_samples: list[dict[str, int | bool | None]] = []
    running_values: dict[int, float] = {}
    battery_floor_triggered = False
    battery_floor_chunk: int | None = None
    battery_poll_error = False
    htp_execute_op_detected = False
    abort_reason = ""
    failure_signature = ""
    guard_liveness_abort = False
    adb_disconnect = False
    timed_out = False
    supervisor_pid: int | None = None
    guard_pid: int | None = None
    pid: int | None = None
    workload_exec_pid: int | None = None
    cpuset = "CPUSET_UNAVAILABLE"
    launch_text = ""
    guard_text = ""
    workload_rc: int | None = None
    guard_rc: int | None = None
    pulls: dict[str, dict[str, object]] = {}
    started = time.time()

    quoted_workload = " ".join(shlex.quote(item) for item in workload)
    hostbuf_setup = "export GGML_HEXAGON_HOSTBUF=1" if args.allow_npu else "unset GGML_HEXAGON_HOSTBUF"
    setup = " ; ".join(
        [
            f"cd {shlex.quote('/data/local/tmp/kalsahtp')}",
            "export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64",
            "export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp",
            "export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp",
            "export GGML_HEXAGON_NDEV=1",
            "export GGML_HEXAGON_VERBOSE=1",
            hostbuf_setup,
            "unset GGML_OPENCL_LOG_ALLOC",
        ]
    )
    workload_wrapper = (
        f"while [ ! -f {shlex.quote(remote_guard_ready_file)} ] || [ ! -f {shlex.quote(remote_guard_tracking_file)} ]; do sleep 1; done; "
        f"{setup} ; exec {quoted_workload} > {shlex.quote(remote_workload_log)} "
        f"2> {shlex.quote(remote_stderr_log)}; exec_rc=$?; "
        f"echo WORKLOAD_NEVER_STARTED=$exec_rc > {shlex.quote(remote_start_failure_file)}; exit 126"
    )
    guard_args = " ".join(
        shlex.quote(item)
        for item in [
            REMOTE_GUARD,
            remote_pid_file,
            str(args.warn_tenths),
            str(args.kill_tenths),
            remote_guard_log,
            str(args.interval_s),
            str(args.session_hard_cap_tenths),
            remote_guard_ready_file,
            remote_guard_tracking_file,
            str(args.sensor_failure_limit),
        ]
    )
    guard_env = ""
    if args.thermal_sensor_cmd:
        guard_env = f"export THERMAL_SENSOR_CMD={shlex.quote(args.thermal_sensor_cmd)}; "
    guard_inner = (
        f"{guard_env}{guard_args}; rc=$?; "
        f"if [ \"$rc\" -ne 126 ]; then echo $rc > {shlex.quote(remote_guard_rc_file)}; fi; exit $rc"
    )
    for path in remote_run_files:
        if device.shell(f"test -e {shlex.quote(path)}", timeout=10).returncode == 0:
            raise SystemExit(f"REFUSING: remote run tag already exists: {path}")
    clear_files = ":"
    supervisor_inner = " ; ".join(
        [
            clear_files,
            f"nohup setsid sh -c {shlex.quote(guard_inner)} </dev/null >/dev/null 2>&1 & guard=$!",
            f"echo GUARD_PID=$guard > {shlex.quote(remote_guard_pid_file)}",
            "child=0",
            "trap 'if [ \"$child\" -gt 0 ] && kill -0 \"$child\" 2>/dev/null; then kill -9 \"$child\" 2>/dev/null; fi' 0 1 2 3 15",
            f"( {workload_wrapper} ) & child=$!",
            f"echo WORKLOAD_PID=$child > {shlex.quote(remote_exec_pid_file)}",
            f"echo BINARY_PID=$child > {shlex.quote(remote_pid_file)}",
            f"if [ -r /proc/$child/cpuset ]; then echo CPUSET=$(cat /proc/$child/cpuset) >> {shlex.quote(remote_pid_file)}; else echo CPUSET_UNAVAILABLE >> {shlex.quote(remote_pid_file)}; fi",
            f"while [ ! -f {shlex.quote(remote_guard_tracking_file)} ]; do if ! kill -0 $guard 2>/dev/null; then echo GUARD_DIED_BEFORE_TRACKING > {shlex.quote(remote_supervisor_failure_file)}; exit {EXIT_GUARD_LIVENESS}; fi; sleep 1; done",
            "wait $child; rc=$?",
            f"echo $rc > {shlex.quote(remote_rc_file)}",
            "trap - 0",
            "exit $rc",
        ]
    )
    launcher_command = (
        f"mkdir -p {shlex.quote(REMOTE_DIR)}; "
        f"nohup setsid sh -c {shlex.quote(supervisor_inner)} </dev/null >/dev/null 2>&1 & echo LAUNCH_PID=$!"
    )

    try:
        launch_result = device.shell(launcher_command, timeout=20)
        launch_text = launch_result.stdout + launch_result.stderr
        launch_pid_text = parse_key_value(launch_text, "LAUNCH_PID")
        if not launch_pid_text.isdigit():
            raise GuardLivenessError("supervisor did not publish LAUNCH_PID")
        supervisor_pid = int(launch_pid_text)
        guard_pid = wait_for_guard_ready(
            device,
            supervisor_pid,
            remote_guard_pid_file,
            remote_guard_ready_file,
            remote_guard_log,
            args.interval_s,
        )
        wait_for_tracking(device, guard_pid, remote_guard_tracking_file, args.interval_s)
        pid_text = read_remote_file(device, remote_pid_file)
        pid_text_value = parse_key_value(pid_text, "BINARY_PID")
        if not pid_text_value.isdigit() or int(pid_text_value) <= 0:
            raise GuardLivenessError("workload wrapper did not publish BINARY_PID")
        pid = int(pid_text_value)
        cpuset = parse_key_value(pid_text, "CPUSET") or "CPUSET_UNAVAILABLE"
        exec_pid_value = ""
        exec_deadline = time.monotonic() + max(2.0 * args.interval_s + 5.0, 10.0)
        while time.monotonic() < exec_deadline:
            exec_pid_text = read_remote_file(device, remote_exec_pid_file)
            exec_pid_value = parse_key_value(exec_pid_text, "WORKLOAD_PID")
            if exec_pid_value.isdigit() and int(exec_pid_value) > 0:
                break
            if not proc_exists(device, pid):
                break
            time.sleep(0.5)
        if not exec_pid_value.isdigit() or int(exec_pid_value) <= 0:
            raise GuardLivenessError("workload wrapper did not publish WORKLOAD_PID")
        workload_exec_pid = int(exec_pid_value)

        deadline = time.monotonic() + args.max_seconds
        next_battery_poll = 0.0
        next_log_tail = 0.0
        while proc_exists(device, pid):
            now = time.monotonic()
            if guard_pid is None or not proc_exists(device, guard_pid):
                observed_guard_rc = read_int_file(device, remote_guard_rc_file)
                if observed_guard_rc in (2, 3):
                    abort_reason = f"guard_exit_{observed_guard_rc}"
                else:
                    guard_liveness_abort = True
                    abort_reason = "guard_liveness_lost"
                    kill_workload(device, pid)
                break
            if now >= next_battery_poll:
                sample = battery_snapshot(device)
                battery_samples.append(sample)
                append_text(
                    battery_log_path,
                    f"{int(time.time())},{sample.get('temperature_tenths')},{sample.get('level')},{sample.get('returncode')}\n",
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
                    signature = failure_signature_line(tail_text)
                    if signature:
                        failure_signature = signature
                        abort_reason = "workload_failure_signature"
                        kill_workload(device, pid)
                        break
                    if re.search(r"execute-op.*HTP0|HTP0.*execute-op", tail_text, re.I):
                        htp_execute_op_detected = True
                        if not args.allow_npu:
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
    except GuardLivenessError as exc:
        sensor_fail_closed = False
        try:
            sensor_fail_closed = read_int_file(device, remote_guard_rc_file) == 3
        except AdbTransportError:
            adb_disconnect = True
        if sensor_fail_closed:
            abort_reason = "sensor_fail_closed"
            # The detached guard has already killed the gated wrapper. Let the
            # supervisor publish its workload rc instead of killing it here.
        else:
            guard_liveness_abort = True
            abort_reason = f"guard_liveness_abort:{exc}"
            if pid is not None:
                try:
                    kill_workload(device, pid)
                except AdbTransportError:
                    adb_disconnect = True
            if supervisor_pid is not None:
                try:
                    device.shell(f"kill -9 {supervisor_pid}", timeout=10)
                except AdbTransportError:
                    adb_disconnect = True
            if guard_pid is not None:
                try:
                    device.shell(f"kill -9 {guard_pid}", timeout=10)
                except AdbTransportError:
                    adb_disconnect = True
    except AdbTransportError as exc:
        adb_disconnect = True
        abort_reason = f"adb_disconnect_after_reconnect_budget:{exc}"

    try:
        settle_deadline = time.monotonic() + 10.0
        while time.monotonic() < settle_deadline:
            if read_int_file(device, remote_rc_file) is not None and read_int_file(device, remote_guard_rc_file) is not None:
                break
            time.sleep(0.5)
        workload_rc = read_int_file(device, remote_rc_file)
        guard_rc = read_int_file(device, remote_guard_rc_file)
    except AdbTransportError as exc:
        adb_disconnect = True
        abort_reason = abort_reason or f"adb_disconnect_after_reconnect_budget:{exc}"

    for remote, local_name in [
        (remote_workload_log, f"{remote_tag}.stdout.jsonl"),
        (remote_stderr_log, f"{remote_tag}.stderr.log"),
        (remote_start_failure_file, f"{remote_tag}.workload.start_failure"),
        (remote_exec_pid_file, f"{remote_tag}.workload.exec.pid"),
        (remote_guard_log, f"{remote_tag}.guard.log"),
    ]:
        try:
            result = device.pull(remote, local_dir / local_name, timeout=120)
            pulls[remote] = {"returncode": result.returncode, "output": result.stdout + result.stderr}
        except AdbTransportError as exc:
            adb_disconnect = True
            pulls[remote] = {"error": str(exc)}

    guard_local = local_dir / f"{remote_tag}.guard.log"
    stdout_local = local_dir / f"{remote_tag}.stdout.jsonl"
    stderr_local = local_dir / f"{remote_tag}.stderr.log"
    start_failure_local = local_dir / f"{remote_tag}.workload.start_failure"
    exec_pid_local = local_dir / f"{remote_tag}.workload.exec.pid"
    guard_log = guard_local.read_text(encoding="utf-8", errors="replace") if guard_local.exists() else ""
    try:
        guard_text = read_remote_file(device, remote_guard_pid_file) if not adb_disconnect else ""
    except AdbTransportError as exc:
        guard_text = ""
        adb_disconnect = True
    stdout_log = stdout_local.read_text(encoding="utf-8", errors="replace") if stdout_local.exists() else ""
    stderr_log = stderr_local.read_text(encoding="utf-8", errors="replace") if stderr_local.exists() else ""
    start_failure_log = start_failure_local.read_text(encoding="utf-8", errors="replace") if start_failure_local.exists() else ""
    if workload_exec_pid is None and exec_pid_local.exists():
        exec_pid_value = parse_key_value(exec_pid_local.read_text(encoding="utf-8", errors="replace"), "WORKLOAD_PID")
        if exec_pid_value.isdigit():
            workload_exec_pid = int(exec_pid_value)
    workload_never_started = bool(re.search(r"^WORKLOAD_NEVER_STARTED=", start_failure_log, re.MULTILINE)) or workload_rc in {126, 127}
    if workload_never_started:
        abort_reason = "workload_never_started"
    execute_op_htp0 = bool(re.search(r"execute-op.*HTP0|HTP0.*execute-op", stderr_log, re.I))
    execute_op_htp0 = execute_op_htp0 or bool(re.search(r"execute-op.*HTP0|HTP0.*execute-op", stdout_log, re.I))
    failure_signature = failure_signature or failure_signature_line(stderr_log + ("\n" if stderr_log and stdout_log else "") + stdout_log)
    running_values.update(running_ppl_values(stdout_log))
    running_values.update(running_ppl_values(stderr_log))
    try:
        final_battery = battery_snapshot(device)
        if final_battery["returncode"] == 0:
            battery_samples.append(final_battery)
            append_text(
                battery_log_path,
                f"{int(time.time())},{final_battery.get('temperature_tenths')},{final_battery.get('level')},{final_battery.get('returncode')}\n",
            )
    except AdbTransportError as exc:
        final_battery = {"returncode": -1, "error": str(exc)}
        adb_disconnect = True
    if execute_op_htp0:
        htp_execute_op_detected = True
        if not args.allow_npu:
            abort_reason = abort_reason or "HTP0_execute_op_detected"
    if failure_signature:
        abort_reason = "workload_failure_signature"
    if battery_floor_chunk is None and battery_floor_triggered:
        battery_floor_chunk = max(running_values) if running_values else None
    if (
        not failure_signature
        and workload_rc is not None
        and workload_rc >= 128
        and guard_rc not in (2, 3)
        and not timed_out
        and not battery_floor_triggered
        and not guard_liveness_abort
        and not adb_disconnect
    ):
        failure_signature = f"workload_rc={workload_rc}"
        abort_reason = "workload_rc_ge_128"

    effective_kill_tenths = args.kill_tenths
    if args.session_hard_cap_tenths > 0:
        effective_kill_tenths = min(effective_kill_tenths, args.session_hard_cap_tenths)
    named_guard_outcome = guard_outcome(guard_rc, guard_liveness_abort, guard_log)
    if failure_signature:
        launcher_exit_code = 4
    elif htp_execute_op_detected and not args.allow_npu:
        launcher_exit_code = 3
    elif workload_never_started:
        launcher_exit_code = EXIT_WORKLOAD_NOT_STARTED
    elif adb_disconnect:
        launcher_exit_code = EXIT_ADB_DISCONNECT
    elif guard_liveness_abort:
        launcher_exit_code = EXIT_GUARD_LIVENESS
    elif timed_out:
        launcher_exit_code = 124
    elif guard_rc == 2:
        launcher_exit_code = 2 if args.allow_npu else 0
    elif guard_rc != 0 or workload_rc != 0:
        launcher_exit_code = 1
    else:
        launcher_exit_code = 0
    manifest = {
        "tag": args.tag,
        "serial": device.serial,
        "supervisor_pid": supervisor_pid,
        "guard_pid": guard_pid,
        "binary_pid": pid,
        "workload_exec_pid": workload_exec_pid,
        "cpuset": cpuset,
        "workload": workload,
        "allow_npu": args.allow_npu,
        "thermal_sensor_cmd": args.thermal_sensor_cmd,
        "environment": {
            "LD_LIBRARY_PATH": "/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64",
            "ADSP_LIBRARY_PATH": "/data/local/tmp/kalsahtp",
            "CDSP_LIBRARY_PATH": "/data/local/tmp/kalsahtp",
            "GGML_HEXAGON_NDEV": "1",
            "GGML_HEXAGON_VERBOSE": "1",
            "GGML_HEXAGON_HOSTBUF": "1" if args.allow_npu else "unset",
            "GGML_OPENCL_LOG_ALLOC": "unset",
        },
        "guard": {
            "warn_tenths": args.warn_tenths,
            "kill_tenths": args.kill_tenths,
            "hard_abort_tenths": args.session_hard_cap_tenths,
            "session_hard_cap_tenths": args.session_hard_cap_tenths,
            "effective_kill_tenths": effective_kill_tenths,
            "interval_s": args.interval_s,
            "sensor_fail_limit": args.sensor_failure_limit,
            "sensor_timeout_s": 10,
            "sensor_failure_window_s": args.sensor_failure_limit * 10,
            "fail_closed_false_kill_accepted": True,
            "ready_verified": not guard_liveness_abort and guard_pid is not None,
            "tracking_verified": not guard_liveness_abort and pid is not None,
            "exit_code": guard_rc,
            "max_temperature_tenths": max_temp_from_guard_log(guard_log),
        },
        "workload_rc": workload_rc,
        "guard_exit_code": guard_rc,
        "guard_outcome": named_guard_outcome,
        "launcher_exit_code": launcher_exit_code,
        "workload_never_started": workload_never_started,
        "timed_out": timed_out,
        "abort_reason": abort_reason,
        "workload_failure_signature": failure_signature,
        "guard_liveness_abort": guard_liveness_abort,
        "adb_disconnect": adb_disconnect,
        "adb_reconnect_attempts": device.reconnect_attempts,
        "wall_seconds_until_poll_end": round(time.time() - started, 3),
        "disk_available_kb": available_kb,
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
        "execute_op_htp0": htp_execute_op_detected,
        "pulls": pulls,
    }
    manifest_path = Path(args.manifest_path) if args.manifest_path else local_dir / f"{remote_tag}.manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))

    if failure_signature:
        print(f"STOP: workload failure signature: {failure_signature}", file=sys.stderr)
    elif htp_execute_op_detected and not args.allow_npu:
        print("STOP: HTP0 execute-op evidence found in workload logs", file=sys.stderr)
    return launcher_exit_code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default=os.environ.get("ADB_SERIAL", DEFAULT_SERIAL))
    parser.add_argument("--tag", required=True)
    parser.add_argument("--warn-tenths", type=int, required=True)
    parser.add_argument("--kill-tenths", type=int, required=True)
    parser.add_argument("--session-hard-cap-tenths", type=int, default=0)
    parser.add_argument("--sensor-failure-limit", type=int, default=DEFAULT_SENSOR_FAILURE_LIMIT)
    parser.add_argument("--interval-s", type=int, default=1)
    parser.add_argument("--max-seconds", type=int, default=120)
    parser.add_argument("--local-dir", default=str(HERE / "raw"))
    parser.add_argument("--manifest-path", default="")
    parser.add_argument("--allow-npu", action="store_true")
    parser.add_argument("--thermal-sensor-cmd", default="")
    parser.add_argument("workload", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    return launch(args)


if __name__ == "__main__":
    raise SystemExit(main())
