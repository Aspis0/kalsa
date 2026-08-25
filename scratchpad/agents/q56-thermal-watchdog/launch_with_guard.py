#!/usr/bin/env python3
"""Launch one short, CPU-only Android workload under thermal_guard.sh.

The launcher is intentionally refusal-oriented: it will not launch
llama-perplexity or any HTP/NPU offload flags in this safety-critical session.
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
HARD_TENTHS = 380
MAX_ALLOWED_SECONDS = 180


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
    joined = " ".join(lowered)
    if "llama-perplexity" in joined or "perplexity" in joined:
        raise SystemExit("REFUSING: perplexity workloads are prohibited tonight")
    if "htp0" in lowered or "-dev" in lowered or "--device" in lowered:
        raise SystemExit("REFUSING: HTP/NPU device flags are prohibited tonight")
    for i, item in enumerate(lowered):
        if item in {"-ngl", "--n-gpu-layers"} and i + 1 < len(lowered) and lowered[i + 1] == "99":
            raise SystemExit("REFUSING: -ngl 99 is prohibited tonight")


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
    while proc_exists(device, pid):
        if time.monotonic() >= deadline:
            timed_out = True
            device.shell(f"kill -9 {pid}", timeout=10)
            break
        time.sleep(1.0)

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
    stderr_log = stderr_local.read_text(encoding="utf-8", errors="replace") if stderr_local.exists() else ""
    execute_op_htp0 = bool(re.search(r"execute-op.*HTP0|HTP0.*execute-op", stderr_log, re.I))
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
        "wall_seconds_until_poll_end": round(time.time() - started, 3),
        "launch_stdout": launch_text,
        "guard_launch_stdout": guard_text,
        "execute_op_htp0_in_stderr": execute_op_htp0,
        "pulls": pulls,
    }
    manifest_path = local_dir / f"{remote_tag}.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    if execute_op_htp0:
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
    parser.add_argument("workload", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    return launch(args)


if __name__ == "__main__":
    raise SystemExit(main())
