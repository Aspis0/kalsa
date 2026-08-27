#!/usr/bin/env python3
"""q67 Candidate 1 HTP-v75 characterization runner.

The device-side workload is detached into its own process group and watched by
the q67 fail-closed temperature guard.  This runner deliberately never calls
adb connect and never touches q63's live PC process.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
REMOTE_DIR = "/data/local/tmp/q67"
REMOTE_GUARD = f"{REMOTE_DIR}/q67_thermal_guard.sh"
MODEL = f"{REMOTE_DIR}/CANDIDATE_1.gguf"
BIN_DIR = "/data/local/tmp/kalsahtp"
PPL = f"{BIN_DIR}/llama-perplexity"
BENCH = f"{BIN_DIR}/llama-bench"
GUARD_LOCAL = HERE / "q67_thermal_guard.sh"
LOG = HERE / "RUN_LOG.md"
MANIFEST_PATH = HERE / "manifest.json"
EXPECTED_MODEL_BYTES = 3_098_664_160
EXPECTED_MODEL_SHA = "c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d"
EXPECTED_RUNTIME = {
    "llama-perplexity": "4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50",
    "llama-bench": "5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507",
}
STOP_MARKERS = (
    "CDSP0 CRASHED",
    "dspqueue_read failed",
    "dspqueue_write failed",
    "INTERNAL-ERROR",
    "ggml_abort",
    "GGML_ASSERT",
    "Aborted",
    "Segmentation",
)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def write_json(path: Path, value: object) -> None:
    write_text(path, json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def log_line(text: str) -> None:
    with LOG.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{now()} {text}\n")


def adb_run(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    env["MSYS2_ARG_CONV_EXCL"] = "*"
    return subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)


def adb_text(args: list[str], timeout: float = 30.0) -> str:
    result = adb_run(args, timeout)
    return result.stdout + result.stderr


def shell(command: str, timeout: float = 30.0) -> str:
    return adb_text(["shell", command], timeout)


def battery_values(text: str) -> dict[str, int | bool | None]:
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
        "ac_powered": boolean("AC powered"),
        "usb_powered": boolean("USB powered"),
        "wireless_powered": boolean("Wireless powered"),
        "dock_powered": boolean("Dock powered"),
    }


def mem_available_kb(text: str) -> int | None:
    match = re.search(r"^MemAvailable:\s*(\d+)\s+kB", text, re.MULTILINE)
    return int(match.group(1)) if match else None


def plugged(state: dict[str, object]) -> bool:
    return any(state.get(key) is True for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))


def capture_state(tag: str) -> dict[str, object]:
    battery_text = shell("dumpsys battery", 30)
    mem_text = shell("grep MemAvailable /proc/meminfo", 20)
    thermal_text = shell("dumpsys thermalservice", 30)
    write_text(RAW / f"{tag}.battery.txt", battery_text)
    write_text(RAW / f"{tag}.meminfo.txt", mem_text)
    write_text(RAW / f"{tag}.thermalservice.txt", thermal_text)
    state = battery_values(battery_text)
    state["mem_available_kb"] = mem_available_kb(mem_text)
    state["plugged"] = plugged(state)
    state["captured_at"] = now()
    return state


def remote_file(path: str) -> str:
    return shell(f"cat {shlex.quote(path)}", 15).strip()


def remote_exists(path: str) -> bool:
    result = adb_run(["shell", f"test -e {shlex.quote(path)}"], 15)
    return result.returncode == 0


def proc_exists(pid: int) -> bool:
    result = adb_run(["shell", f"test -d /proc/{pid} && ! grep -q '^State:[[:space:]]*Z' /proc/{pid}/status"], 15)
    return result.returncode == 0


def parse_kv(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}=(.*)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def append_gate(tag: str, index: int, state: dict[str, object]) -> None:
    line = {
        "time": now(),
        "poll": index,
        "level": state.get("level"),
        "temperature_tenths": state.get("temperature_tenths"),
        "plugged": state.get("plugged"),
        "mem_available_kb": state.get("mem_available_kb"),
    }
    with (RAW / f"{tag}.gate.csv").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(line, separators=(",", ":")) + "\n")
    log_line(
        f"GATE {tag} level={state.get('level')} temp_tenths={state.get('temperature_tenths')} "
        f"plugged={state.get('plugged')} MemAvailable_kb={state.get('mem_available_kb')}"
    )


def wait_gate(tag: str) -> dict[str, object] | None:
    start = time.monotonic()
    poll = 0
    while True:
        poll += 1
        battery_text = shell("dumpsys battery", 30)
        mem_text = shell("grep MemAvailable /proc/meminfo", 20)
        state = battery_values(battery_text)
        state["mem_available_kb"] = mem_available_kb(mem_text)
        state["plugged"] = plugged(state)
        state["captured_at"] = now()
        append_gate(tag, poll, state)
        level = state.get("level")
        temp = state.get("temperature_tenths")
        mem = state.get("mem_available_kb")
        if isinstance(level, int) and level < 40:
            log_line(f"NOT-RUN {tag} battery_floor level={level} < 40")
            return None
        if isinstance(mem, int) and mem < 4 * 1024 * 1024:
            log_line(f"NOT-RUN {tag} MemAvailable_kb={mem} < 4194304")
            return None
        if isinstance(level, int) and isinstance(temp, int) and isinstance(mem, int) and level >= 40 and temp <= 350 and mem >= 4 * 1024 * 1024:
            log_line(f"GATE_PASS {tag} battery>=40 temp<=35.0 MemAvailable>=4GiB plugged={state.get('plugged')}")
            return state
        if time.monotonic() - start >= 15 * 60:
            log_line(f"NOT-RUN {tag} cool-start wait exceeded 15 min")
            return None
        print(f"GATE {tag}: level={level} temp={None if not isinstance(temp, int) else temp / 10:.1f}C mem={mem}KB; waiting 30s", flush=True)
        time.sleep(30)


def setup_env() -> str:
    return " ; ".join(
        [
            f"cd {BIN_DIR}",
            f"export LD_LIBRARY_PATH={BIN_DIR}:/vendor/lib64:/system/vendor/lib64:/system/lib64",
            f"export ADSP_LIBRARY_PATH={BIN_DIR}",
            f"export CDSP_LIBRARY_PATH={BIN_DIR}",
            "export GGML_HEXAGON_NDEV=1",
            "export GGML_HEXAGON_HOSTBUF=1",
            "export GGML_HEXAGON_VERBOSE=1",
        ]
    )


def canonical_command(tag: str) -> str:
    if tag in ("a1_htp", "a1_htp_attempt2"):
        return "llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 99 -dev HTP0 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 32 -nkvo -v"
    if tag in ("a2_cpu", "a2_cpu_attempt2"):
        return "llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 0 -t 8 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 32 -nkvo -v"
    if tag == "a2_cpu_amendment2":
        return "llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 0 -t 8 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 20 -nkvo -v"
    if tag == "a2_cpu_amendment3":
        return "llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 0 -t 8 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 20 -nkvo -v"
    if tag == "a2_cpu_amendment4":
        return "llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 0 -t 8 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 20 -nkvo -v"
    if tag == "b_npu":
        return "llama-bench -m /data/local/tmp/q67/CANDIDATE_1.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -ngl 99 -dev HTP0 -v"
    return "llama-bench -m /data/local/tmp/q67/CANDIDATE_1.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -ngl 0"


def workload_args(tag: str) -> list[str]:
    if tag in ("a1_htp", "a1_htp_attempt2"):
        return ["./llama-perplexity", "-m", MODEL, "-f", "/data/local/tmp/wiki.test.raw", "-ngl", "99", "-dev", "HTP0", "-c", "2048", "-b", "2048", "-ub", "1024", "-fa", "on", "--load-mode", "none", "--chunks", "32", "-nkvo", "-v"]
    if tag in ("a2_cpu", "a2_cpu_attempt2"):
        return ["./llama-perplexity", "-m", MODEL, "-f", "/data/local/tmp/wiki.test.raw", "-ngl", "0", "-t", "8", "-c", "2048", "-b", "2048", "-ub", "1024", "-fa", "on", "--load-mode", "none", "--chunks", "32", "-nkvo", "-v"]
    if tag == "a2_cpu_amendment2":
        return ["./llama-perplexity", "-m", MODEL, "-f", "/data/local/tmp/wiki.test.raw", "-ngl", "0", "-t", "8", "-c", "2048", "-b", "2048", "-ub", "1024", "-fa", "on", "--load-mode", "none", "--chunks", "20", "-nkvo", "-v"]
    if tag == "a2_cpu_amendment3":
        return ["./llama-perplexity", "-m", MODEL, "-f", "/data/local/tmp/wiki.test.raw", "-ngl", "0", "-t", "8", "-c", "2048", "-b", "2048", "-ub", "1024", "-fa", "on", "--load-mode", "none", "--chunks", "20", "-nkvo", "-v"]
    if tag == "a2_cpu_amendment4":
        return ["./llama-perplexity", "-m", MODEL, "-f", "/data/local/tmp/wiki.test.raw", "-ngl", "0", "-t", "8", "-c", "2048", "-b", "2048", "-ub", "1024", "-fa", "on", "--load-mode", "none", "--chunks", "20", "-nkvo", "-v"]
    base = ["./llama-bench", "-m", MODEL, "-p", "512", "-n", "0", "-r", "2", "--no-warmup", "-t", "8", "-fa", "on", "--load-mode", "none", "-o", "jsonl"]
    return base + (["-ngl", "99", "-dev", "HTP0", "-v"] if tag == "b_npu" else ["-ngl", "0"])


def max_guard_temp(text: str) -> int | None:
    values: list[int] = []
    for line in text.splitlines():
        match = re.match(r"^\d+,(-?\d+),", line)
        if match:
            values.append(int(match.group(1)))
    return max(values) if values else None


def stop_marker(text: str) -> str:
    for marker in STOP_MARKERS:
        if marker in text:
            for line in text.splitlines():
                if marker in line:
                    return line.strip()
            return marker
    return ""


def running_values(text: str) -> dict[int, float]:
    values: dict[int, float] = {}
    for match in re.finditer(r"\[(\d+)\]\s*([0-9]+(?:\.[0-9]+)?)", text):
        values[int(match.group(1))] = float(match.group(2))
    return values


def final_ppl(text: str) -> float | None:
    matches = re.findall(r"Final estimate:\s*PPL\s*=\s*([0-9]+(?:\.[0-9]+)?)", text)
    return float(matches[-1]) if matches else None


def json_rows(text: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in text.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def pull(remote: str, local: Path) -> dict[str, object]:
    result = adb_run(["pull", remote, str(local)], 180)
    return {"returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


def launch_one(tag: str, gate: dict[str, object]) -> dict[str, object]:
    if any(remote_exists(f"{REMOTE_DIR}/{tag}.{suffix}") for suffix in ("stdout.log", "stderr.log", "guard.log", "pid")):
        raise RuntimeError(f"remote tag already exists: {tag}")
    warn = 400
    kill = 410 if tag in ("a1_htp", "a1_htp_attempt2", "b_npu") else 430
    pid_file = f"{REMOTE_DIR}/{tag}.pid"
    stdout_file = f"{REMOTE_DIR}/{tag}.stdout.log"
    stderr_file = f"{REMOTE_DIR}/{tag}.stderr.log"
    guard_file = f"{REMOTE_DIR}/{tag}.guard.log"
    guard_pid_file = f"{REMOTE_DIR}/{tag}.guard.pid"
    ready_file = f"{REMOTE_DIR}/{tag}.guard.ready"
    tracking_file = f"{REMOTE_DIR}/{tag}.guard.tracking"
    workload_rc_file = f"{REMOTE_DIR}/{tag}.workload.rc"
    guard_rc_file = f"{REMOTE_DIR}/{tag}.guard.rc"
    exec_pid_file = f"{REMOTE_DIR}/{tag}.workload.exec.pid"
    failure_file = f"{REMOTE_DIR}/{tag}.supervisor.failure"
    workload = workload_args(tag)
    quoted_workload = " ".join(shlex.quote(item) for item in workload)
    setup = setup_env()
    wrapper = (
        f"while [ ! -f {shlex.quote(ready_file)} ] || [ ! -f {shlex.quote(tracking_file)} ]; do sleep 1; done; "
        f"{setup}; exec {quoted_workload} > {shlex.quote(stdout_file)} 2> {shlex.quote(stderr_file)}"
    )
    guard_inner = " ".join(
        [
            shlex.quote(REMOTE_GUARD), shlex.quote(pid_file), str(warn), str(kill),
            shlex.quote(guard_file), "10", shlex.quote(ready_file), shlex.quote(tracking_file), "4",
        ]
    )
    guard_wrapper = f"{guard_inner}; guard_rc=$?; echo $guard_rc > {shlex.quote(guard_rc_file)}; exit $guard_rc"
    supervisor_inner = " ; ".join(
        [
            f"nohup setsid sh -c {shlex.quote(guard_wrapper)} </dev/null >/dev/null 2>&1 & guard=$!",
            f"echo GUARD_PID=$guard > {shlex.quote(guard_pid_file)}",
            "child=0",
            "trap 'if [ \"$child\" -gt 0 ] && kill -0 \"$child\" 2>/dev/null; then kill -9 \"$child\" 2>/dev/null; fi' 0 1 2 3 15",
            f"( {wrapper} ) & child=$!",
            f"echo BINARY_PID=$child > {shlex.quote(pid_file)}",
            f"echo CPUSET=$(cat /proc/$child/cpuset) >> {shlex.quote(pid_file)}",
            f"echo WORKLOAD_PID=$child > {shlex.quote(exec_pid_file)}",
            f"while [ ! -f {shlex.quote(tracking_file)} ]; do if ! kill -0 $guard 2>/dev/null; then echo GUARD_DIED_BEFORE_TRACKING > {shlex.quote(failure_file)}; exit 75; fi; sleep 1; done",
            "wait $child; rc=$?",
            f"echo $rc > {shlex.quote(workload_rc_file)}",
            "trap - 0",
            "exit $rc",
        ]
    )
    launcher = f"mkdir -p {REMOTE_DIR}; nohup setsid sh -c {shlex.quote(supervisor_inner)} </dev/null >/dev/null 2>&1 & echo LAUNCH_PID=$!"
    launch_result = adb_run(["shell", launcher], 20)
    launch_text = launch_result.stdout + launch_result.stderr
    launch_pid_text = parse_kv(launch_text, "LAUNCH_PID")
    if not launch_pid_text.isdigit():
        raise RuntimeError(f"no LAUNCH_PID for {tag}: {launch_text}")
    supervisor_pid = int(launch_pid_text)
    deadline = time.monotonic() + 90
    guard_pid = None
    binary_pid = None
    cpuset = "UNAVAILABLE"
    while time.monotonic() < deadline:
        guard_pid_text = parse_kv(remote_file(guard_pid_file), "GUARD_PID")
        pid_text = remote_file(pid_file)
        binary_text = parse_kv(pid_text, "BINARY_PID")
        cpuset = parse_kv(pid_text, "CPUSET") or cpuset
        if guard_pid_text.isdigit():
            guard_pid = int(guard_pid_text)
        if binary_text.isdigit():
            binary_pid = int(binary_text)
        if remote_exists(ready_file) and remote_exists(tracking_file) and binary_pid and guard_pid:
            break
        time.sleep(1)
    if not binary_pid or not guard_pid:
        raise RuntimeError(f"guard/workload did not become ready: {tag}")
    log_line(f"ARM_START {tag} command={canonical_command(tag)} battery_pre={gate.get('level')} temp_pre_tenths={gate.get('temperature_tenths')} MemAvailable_pre_kb={gate.get('mem_available_kb')} binary_pid={binary_pid} cpuset={cpuset}")
    start = time.monotonic()
    next_poll = 0.0
    next_tail = 0.0
    battery_samples: list[dict[str, object]] = []
    stop_reason = ""
    cap_datum = False
    last_tail = ""
    while proc_exists(binary_pid):
        current = time.monotonic()
        if current >= next_poll:
            state = capture_state(f"{tag}.poll{len(battery_samples) + 1}")
            battery_samples.append(state)
            with (RAW / f"{tag}.battery.csv").open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(json.dumps(state, separators=(",", ":")) + "\n")
            next_poll = current + 10
        if current >= next_tail:
            stderr_tail = shell(f"tail -n 800 {shlex.quote(stderr_file)}", 20)
            stdout_tail = shell(f"tail -n 800 {shlex.quote(stdout_file)}", 20)
            last_tail = stderr_tail + ("\n" if stderr_tail and stdout_tail else "") + stdout_tail
            write_text(RAW / f"{tag}.live.tail.log", last_tail)
            marker = stop_marker(last_tail)
            if marker:
                stop_reason = f"STOP_SIGNATURE: {marker}"
                adb_run(["shell", f"kill -9 {binary_pid}"], 15)
                break
            next_tail = current + 10
        if current - start >= 600:
            cap_datum = True
            log_line(f"CAP_DATUM {tag} wall_cap_s=600; workload kill issued; cap is datum")
            adb_run(["shell", f"kill -9 {binary_pid}"], 15)
            break
        if guard_pid and not proc_exists(guard_pid):
            guard_text = remote_file(guard_file)
            guard_rc_text = remote_file(guard_rc_file)
            if guard_rc_text.strip() == "2" or "KILL_THRESHOLD" in guard_text or "BATTERY_LOW_ABORT" in guard_text:
                stop_reason = f"STOP_GUARD_KILL {tag} guard_rc={guard_rc_text.strip()}"
            else:
                stop_reason = f"STOP_GUARD_LIVENESS {tag}"
            if proc_exists(binary_pid):
                adb_run(["shell", f"kill -9 {binary_pid}"], 15)
            break
        time.sleep(2)
    time.sleep(2)
    stdout_pull = pull(stdout_file, RAW / f"{tag}.stdout.log")
    stderr_pull = pull(stderr_file, RAW / f"{tag}.stderr.log")
    guard_pull = pull(guard_file, RAW / f"{tag}.guard.csv")
    for remote, name in (
        (pid_file, f"{tag}.pid"), (guard_pid_file, f"{tag}.guard.pid"),
        (ready_file, f"{tag}.guard.ready"), (tracking_file, f"{tag}.guard.tracking"),
        (exec_pid_file, f"{tag}.workload.exec.pid"), (workload_rc_file, f"{tag}.workload.rc"),
        (guard_rc_file, f"{tag}.guard.rc"), (failure_file, f"{tag}.supervisor.failure"),
    ):
        pull(remote, RAW / name)
    write_text(RAW / f"{tag}.launcher.stdout.log", launch_result.stdout)
    write_text(RAW / f"{tag}.launcher.stderr.log", launch_result.stderr)
    stdout = (RAW / f"{tag}.stdout.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.stdout.log").exists() else ""
    stderr = (RAW / f"{tag}.stderr.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.stderr.log").exists() else ""
    combined = stderr + ("\n" if stderr and stdout else "") + stdout
    write_text(RAW / f"{tag}.running_ppl.log", combined)
    marker = stop_marker(combined)
    if marker and not stop_reason:
        stop_reason = f"STOP_SIGNATURE: {marker}"
    workload_rc_text = (RAW / f"{tag}.workload.rc").read_text(encoding="utf-8", errors="replace").strip() if (RAW / f"{tag}.workload.rc").exists() else ""
    guard_rc_text = (RAW / f"{tag}.guard.rc").read_text(encoding="utf-8", errors="replace").strip() if (RAW / f"{tag}.guard.rc").exists() else ""
    try:
        workload_rc = int(workload_rc_text)
    except ValueError:
        workload_rc = None
    try:
        guard_rc = int(guard_rc_text)
    except ValueError:
        guard_rc = None
    guard_log = (RAW / f"{tag}.guard.csv").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.guard.csv").exists() else ""
    htp_lines = [line for line in combined.splitlines() if "execute-op" in line and "HTP0" in line]
    attn_lines = [line for line in combined.splitlines() if "execute-op" in line and re.search(r"attn_q|attn_k|attn_v|attn_output|attn_qkv", line)]
    all_exec = [line for line in combined.splitlines() if "execute-op" in line]
    write_text(RAW / f"{tag}.execute_op_htp0.txt", "\n".join(htp_lines) + ("\n" if htp_lines else ""))
    write_text(RAW / f"{tag}.execute_op_attn.txt", "\n".join(attn_lines) + ("\n" if attn_lines else ""))
    write_text(RAW / f"{tag}.execute_op_count.txt", str(len(all_exec)) + "\n")
    values = running_values(combined)
    write_text(
        RAW / f"{tag}.running_ppl.csv",
        "chunk,ppl\n" + "\n".join(f"{chunk},{value}" for chunk, value in sorted(values.items())) + ("\n" if values else ""),
    )
    ppl = final_ppl(combined)
    rows = json_rows(stdout)
    first_ts = None
    avg_ts = None
    if rows:
        row = rows[-1]
        avg_value = row.get("avg_ts")
        if isinstance(avg_value, (int, float)):
            avg_ts = float(avg_value)
        samples = row.get("samples_ts")
        if isinstance(samples, list):
            nums = [float(value) for value in samples if isinstance(value, (int, float))]
            if nums:
                first_ts = nums[0]
                avg_ts = avg_ts if avg_ts is not None else sum(nums) / len(nums)
        elif isinstance(samples, (int, float)):
            first_ts = float(samples)
    pre_temp = gate.get("temperature_tenths")
    post = capture_state(f"{tag}.post")
    post_temp = post.get("temperature_tenths")
    guard_kill = guard_rc == 2 or "KILL_THRESHOLD" in guard_log or "BATTERY_LOW_ABORT" in guard_log
    if stop_reason == "" and workload_rc is not None and workload_rc >= 128 and not guard_kill:
        stop_reason = f"STOP_WORKLOAD_RC_GE_128 rc={workload_rc}"
    if stop_reason == "" and workload_rc not in (None, 0) and not cap_datum:
        stop_reason = f"FAIL_LOAD rc={workload_rc}"
    if guard_kill and tag in ("a1_htp", "a1_htp_attempt2", "b_npu") and not stop_reason:
        stop_reason = f"STOP_GUARD_KILL {tag}"
    status = "CAP_DATUM" if cap_datum and not stop_reason else ("STOPPED" if stop_reason else "DONE")
    record = {
        "tag": tag,
        "arm": "A1 HTP correctness" if tag in ("a1_htp", "a1_htp_attempt2") else "A2 CPU-ref" if tag in ("a2_cpu", "a2_cpu_attempt2", "a2_cpu_amendment2", "a2_cpu_amendment3", "a2_cpu_amendment4") else "B pp512 NPU" if tag == "b_npu" else "B pp512 CPU",
        "engine": "HTP" if tag in ("a1_htp", "a1_htp_attempt2", "b_npu") else "CPU",
        "status": status,
        "command_verbatim": canonical_command(tag),
        "binary_pid": binary_pid,
        "workload_exec_pid": binary_pid,
        "guard_pid": guard_pid,
        "cpuset": cpuset,
        "gate_pre": gate,
        "state_post": post,
        "battery_samples": battery_samples,
        "warn_tenths": warn,
        "kill_tenths": kill,
        "wall_cap_s": 600,
        "workload_rc": workload_rc,
        "guard_rc": guard_rc,
        "guard_kill": guard_kill,
        "guard_max_temp_tenths": max_guard_temp(guard_log),
        "cap_datum": cap_datum,
        "stop_reason": stop_reason,
        "execute_op_htp0_count": len(htp_lines),
        "execute_op_attn_count": len(attn_lines),
        "execute_op_count": len(all_exec),
        "running_ppl_values": {str(k): v for k, v in sorted(values.items())},
        "final_ppl": ppl,
        "max_chunk": max(values) if values else None,
        "bench_json_rows": len(rows),
        "bench_first_sample_ts": first_ts,
        "bench_avg_ts": avg_ts,
        "temperature_delta_tenths": post_temp - pre_temp if isinstance(post_temp, int) and isinstance(pre_temp, int) else None,
        "raw": {"stdout": f"raw/{tag}.stdout.log", "stderr": f"raw/{tag}.stderr.log", "running_ppl": f"raw/{tag}.running_ppl.log", "guard": f"raw/{tag}.guard.csv"},
        "pulls": {"stdout": stdout_pull, "stderr": stderr_pull, "guard": guard_pull},
    }
    write_text(RAW / f"{tag}.execute_op_proof.json", json.dumps({"htp0": len(htp_lines), "attention": len(attn_lines), "total": len(all_exec)}, indent=2) + "\n")
    write_json(RAW / f"{tag}.record.json", record)
    log_line(f"ARM_END {tag} status={status} workload_rc={workload_rc} guard_rc={guard_rc} guard_max_temp_tenths={record['guard_max_temp_tenths']} execute_op_htp0={len(htp_lines)} execute_op_attn={len(attn_lines)} max_chunk={record['max_chunk']} final_ppl={ppl}")
    return record


def model_sha_record() -> str:
    path = RAW / "model_device_sha256.txt"
    return path.read_text(encoding="utf-8", errors="replace").strip() if path.exists() else ""


def generate_report(manifest: dict[str, object]) -> None:
    runs = manifest.get("runs", [])
    if not isinstance(runs, list):
        runs = []
    a1 = next((r for r in runs if isinstance(r, dict) and r.get("tag") == "a1_htp"), None)
    a2 = next((r for r in runs if isinstance(r, dict) and r.get("tag") == "a2_cpu"), None)
    lines = ["# q67 numbers", "", "| arm | status | rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | execute_op_HTP0 | execute_op_attn |", "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|"]
    for row in runs:
        if not isinstance(row, dict):
            continue
        pre = row.get("gate_pre", {})
        post = row.get("state_post", {})
        pre_temp = pre.get("temperature_tenths") if isinstance(pre, dict) else None
        post_temp = post.get("temperature_tenths") if isinstance(post, dict) else None
        max_temp = row.get("guard_max_temp_tenths")
        lines.append("| " + " | ".join([
            str(row.get("tag")), str(row.get("status")), str(row.get("workload_rc")), str(row.get("guard_rc")),
            f"{600 if row.get('cap_datum') else ''}",
            f"{pre_temp / 10:.1f}" if isinstance(pre_temp, int) else "NA",
            f"{post_temp / 10:.1f}" if isinstance(post_temp, int) else "NA",
            f"{max_temp / 10:.1f}" if isinstance(max_temp, int) else "NA",
            str(row.get("cpuset")), str(row.get("execute_op_htp0_count")), str(row.get("execute_op_attn_count")),
        ]) + " |")
    lines += ["", "## A1/A2 perplexity", "", "| chunk | PPL_HTP | PPL_CPU |", "|---:|---:|---:|"]
    htp = a1.get("running_ppl_values", {}) if isinstance(a1, dict) else {}
    cpu = a2.get("running_ppl_values", {}) if isinstance(a2, dict) else {}
    htp = {int(k): float(v) for k, v in htp.items()} if isinstance(htp, dict) else {}
    cpu = {int(k): float(v) for k, v in cpu.items()} if isinstance(cpu, dict) else {}
    common = sorted(set(htp) & set(cpu))
    for n in common:
        lines.append(f"| {n} | {htp[n]:.6f} | {cpu[n]:.6f} |")
    if common and common[-1] >= 8:
        n = common[-1]
        r = htp[n] / cpu[n] - 1 if cpu[n] != 0 else float("nan")
        gate = "PASS" if r <= 0.02 else "GREY" if r <= 0.05 else "FAIL"
        lines += ["", f"last common chunk n = {n}", f"r = PPL_HTP / PPL_CPU − 1 = {htp[n]:.6f} / {cpu[n]:.6f} − 1 = {r:.6%}", f"q55 gate = {gate} (PASS ≤2%; GREY 2–5%; FAIL >5% or NaN)"]
        load_ok = isinstance(a1, dict) and a1.get("status") in ("DONE", "CAP_DATUM") and int(a1.get("execute_op_htp0_count", 0)) > 0 and int(a1.get("execute_op_attn_count", 0)) > 0
        verdict = "HTP-VIABLE" if load_ok and gate == "PASS" else "HTP-GREY" if load_ok and gate == "GREY" else "FAIL-LOAD" if not load_ok else "FAIL-NUMERICS"
    else:
        lines += ["", f"common chunks = {len(common)}; last common n = {common[-1] if common else 'NA'}; gate = VOID (common chunks < 8)"]
        load_ok = isinstance(a1, dict) and a1.get("status") in ("DONE", "CAP_DATUM") and int(a1.get("execute_op_htp0_count", 0)) > 0 and int(a1.get("execute_op_attn_count", 0)) > 0
        verdict = "FAIL-LOAD" if not load_ok else "FAIL-NUMERICS"
    lines.append(f"verdict = {verdict}")
    lines += ["", "## B pp512", "", "| arm | status | first_sample_t/s | jsonl_avg_t/s | ΔT_C | MAX_C |", "|---|---|---:|---:|---:|---:|"]
    for row in runs:
        if not isinstance(row, dict) or not str(row.get("tag", "")).startswith("b_"):
            continue
        delta = row.get("temperature_delta_tenths")
        maximum = row.get("guard_max_temp_tenths")
        lines.append(f"| {row.get('tag')} | {row.get('status')} | {row.get('bench_first_sample_ts') if row.get('bench_first_sample_ts') is not None else 'NA'} | {row.get('bench_avg_ts') if row.get('bench_avg_ts') is not None else 'NA'} | {delta / 10:.1f} | {maximum / 10:.1f} |" if isinstance(delta, int) and isinstance(maximum, int) else f"| {row.get('tag')} | {row.get('status')} | {row.get('bench_first_sample_ts') or 'NA'} | {row.get('bench_avg_ts') or 'NA'} | NA | NA |")
    write_text(HERE / "REPORT.md", "\n".join(lines) + "\n")


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    if not GUARD_LOCAL.exists():
        raise SystemExit("missing q67_thermal_guard.sh")
    if not model_sha_record().startswith(EXPECTED_MODEL_SHA):
        raise SystemExit("model SHA record missing or mismatch; refusing arms")
    preflight = capture_state("preflight")
    runtime_sha_text = shell(f"sha256sum {PPL} {BENCH}", 60)
    runtime_stat_text = shell(f"stat -c '%n %s' {PPL} {BENCH}", 30)
    write_text(RAW / "runtime_device_sha256.txt", runtime_sha_text)
    write_text(RAW / "runtime_device_stat.txt", runtime_stat_text)
    model_stat = shell(f"stat -c '%n %s' {MODEL}", 30)
    write_text(RAW / "model_device_stat.txt", model_stat)
    if str(EXPECTED_MODEL_BYTES) not in model_stat:
        raise SystemExit(f"model size mismatch on device: {model_stat}")
    runtime_actual = {line.split()[-1].rsplit("/", 1)[-1]: line.split()[0] for line in runtime_sha_text.splitlines() if len(line.split()) >= 2}
    write_text(RAW / "q67_guard_pc_sha256.txt", hashlib.sha256(GUARD_LOCAL.read_bytes()).hexdigest() + "  q67_thermal_guard.sh\n")
    push_guard = adb_run(["push", str(GUARD_LOCAL), REMOTE_GUARD], 60)
    if push_guard.returncode != 0:
        raise SystemExit(f"guard push failed: {push_guard.stdout}{push_guard.stderr}")
    chmod = adb_run(["shell", f"chmod 755 {REMOTE_GUARD}"], 20)
    if chmod.returncode != 0:
        raise SystemExit("guard chmod failed")
    write_text(RAW / "q67_guard_push.log", push_guard.stdout + push_guard.stderr)
    log_line(f"PREFLIGHT model_device_sha={model_sha_record().split()[0]} model_bytes={EXPECTED_MODEL_BYTES} runtime_sha={runtime_actual} preflight={preflight} plugged_declared=True")
    manifest: dict[str, object] = {
        "cell": "q67-c1-htp-v75-load",
        "prereg_commit": "4b5afc37",
        "device": {"model": "Xiaomi houji", "serial": SERIAL, "runtime_dir": BIN_DIR, "model_remote": MODEL, "corpus_remote": "/data/local/tmp/wiki.test.raw", "corpus_sha256": "173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08", "plugged_declared": True},
        "model": {"remote": MODEL, "bytes_expected": EXPECTED_MODEL_BYTES, "sha256_expected": EXPECTED_MODEL_SHA, "device_sha256_record": model_sha_record(), "device_stat": model_stat, "verified_before_arms": True},
        "runtime": {"device_sha256": runtime_actual, "device_sha256_raw": "raw/runtime_device_sha256.txt", "device_stat_raw": "raw/runtime_device_stat.txt", "expected": EXPECTED_RUNTIME, "guard_pc_sha256": hashlib.sha256(GUARD_LOCAL.read_bytes()).hexdigest(), "guard_remote": REMOTE_GUARD},
        "environment": {"LD_LIBRARY_PATH": f"{BIN_DIR}:/vendor/lib64:/system/vendor/lib64:/system/lib64", "ADSP_LIBRARY_PATH": BIN_DIR, "CDSP_LIBRARY_PATH": BIN_DIR, "GGML_HEXAGON_NDEV": "1", "GGML_HEXAGON_HOSTBUF": "1", "GGML_HEXAGON_VERBOSE": "1", "cpu_arm_same_env": True},
        "guard": {"poll_s": 10, "battery_floor_pct": 40, "cool_start_max_C": 35.0, "MemAvailable_min_kb": 4194304, "NPU_warn_C": 40.0, "NPU_kill_C": 41.0, "CPU_warn_C": 40.0, "CPU_kill_C": 43.0, "wall_cap_s": 600, "stop_markers_case_sensitive": list(STOP_MARKERS)},
        "preflight": preflight,
        "runs": [],
        "status": "RUNNING",
        "stop_reason": None,
    }
    write_json(MANIFEST_PATH, manifest)
    records: list[dict[str, object]] = []
    for tag in ("a1_htp", "a2_cpu", "b_npu", "b_cpu"):
        gate = wait_gate(tag)
        if gate is None:
            manifest["status"] = "NOT-RUN"
            manifest["stop_reason"] = f"gate failed for {tag}"
            write_json(MANIFEST_PATH, manifest)
            generate_report(manifest)
            return 2
        record = launch_one(tag, gate)
        records.append(record)
        manifest["runs"] = records
        write_json(MANIFEST_PATH, manifest)
        if record.get("stop_reason"):
            manifest["status"] = "STOPPED"
            manifest["stop_reason"] = record["stop_reason"]
            write_json(MANIFEST_PATH, manifest)
            generate_report(manifest)
            return 2
        if tag == "a1_htp" and (record.get("workload_rc") != 0 or int(record.get("execute_op_htp0_count", 0)) <= 0 or int(record.get("execute_op_attn_count", 0)) <= 0):
            manifest["status"] = "STOPPED"
            manifest["stop_reason"] = "FAIL-LOAD A1 HTP proof/load gate"
            write_json(MANIFEST_PATH, manifest)
            generate_report(manifest)
            return 2
    manifest["status"] = "DONE"
    write_json(MANIFEST_PATH, manifest)
    generate_report(manifest)
    log_line("DONE q67 all four arms complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
