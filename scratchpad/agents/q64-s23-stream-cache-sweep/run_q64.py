from __future__ import annotations

import csv
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


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q64-s23-stream-cache-sweep"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp"
MODEL = "/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf"
MODEL_BYTES = 10_505_424_704
RUNTIME_PC = ROOT / "models_staging" / "ship_runtime_s23_0ac612de"
RUNTIME_REMOTE = "/data/local/tmp/q64_rt"
OUT_REMOTE = "/data/local/tmp/q64_out"
GUARD_PC = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "thermal_guard.sh"
GUARD_REMOTE = f"{OUT_REMOTE}/thermal_guard.sh"
SAMPLER_PC = CELL / "q64_sampler.sh"
SAMPLER_REMOTE = f"{OUT_REMOTE}/q64_sampler.sh"
LAUNCHER = CELL / "launch_q64.py"
SOURCE_PROMPT = ROOT / "scratchpad" / "agents" / "q62-product-streamer-prefill" / "prompts" / "q62_pp512.txt"
Q60B_REPORT = ROOT / "scratchpad" / "agents" / "q60b-s23-streaming-floor" / "REPORT.md"

RUNTIME_NAMES = {
    "bmoe-cli",
    "libc++_shared.so",
    "libggml-base.so",
    "libggml-cpu.so",
    "libggml.so",
    "libllama-common.so",
    "libllama.so",
}
CRASH_MARKERS = (
    "CDSP0 CRASHED",
    "dspqueue_read failed",
    "dspqueue_write failed",
    "INTERNAL-ERROR",
    "ggml_abort",
    "GGML_ASSERT",
    "Aborted",
    "Segmentation",
)
LOAD_MARKERS = (
    "failed to load model",
    "error loading model",
    "model load failed",
    "cannot open model",
    "unable to load model",
)
ARMS = ("0", "1500", "2000", "4000", "auto")
LATIN_SQUARE = (
    ("0", "1500", "2000", "4000", "auto"),
    ("1500", "2000", "4000", "auto", "0"),
    ("2000", "4000", "auto", "0", "1500"),
)

last_invocation_end: float | None = None


class StopCell(RuntimeError):
    pass


class DeviceError(RuntimeError):
    pass


def now_local() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def append_log(message: str) -> None:
    path = CELL / "RUN_LOG.md"
    if not path.exists():
        path.write_text("# q64 RUN_LOG\n", encoding="utf-8", newline="\n")
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"\n{now_local()} {message}\n")


def set_status(value: str) -> None:
    (CELL / "STATUS.txt").write_text(f"{now_local()} {value}\n", encoding="utf-8", newline="\n")


def write_raw(name: str, content: str) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / name
    path.write_text(content, encoding="utf-8", newline="\n")
    return path


def append_jsonl(name: str, value: object) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    with (RAW / name).open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n")


def append_record(record: dict[str, object]) -> None:
    with (CELL / "run_records.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")


def read_records() -> list[dict[str, object]]:
    path = CELL / "run_records.jsonl"
    if not path.exists():
        return []
    records: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def sha256_pc(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_adb(args: list[str], timeout: float = 30.0, allow_nonzero: bool = False) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    env["MSYS2_ARG_CONV_EXCL"] = "*"
    try:
        result = subprocess.run(
            [ADB, "-s", SERIAL, *args],
            text=True,
            capture_output=True,
            timeout=timeout,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeviceError(str(exc)) from exc
    combined = result.stdout + result.stderr
    transport_markers = (
        "device offline",
        "no devices/emulators found",
        "failed to get feature set",
        "cannot connect",
        "connection refused",
        "closed",
    )
    if any(marker in combined.lower() for marker in transport_markers):
        raise DeviceError(f"adb transport failure: {combined.strip()}")
    if result.returncode != 0 and not allow_nonzero:
        raise DeviceError(f"adb rc={result.returncode}: {combined.strip()}")
    return result


def shell(command: str, timeout: float = 30.0, allow_nonzero: bool = False) -> subprocess.CompletedProcess[str]:
    return run_adb(["shell", command], timeout=timeout, allow_nonzero=allow_nonzero)


def remote_text(path: str) -> str:
    result = shell(f"cat {shlex.quote(path)}", timeout=20, allow_nonzero=True)
    return result.stdout if result.returncode == 0 else ""


def battery_text() -> str:
    result = shell("dumpsys battery", timeout=20)
    return result.stdout + result.stderr


def parse_battery(text: str) -> dict[str, object]:
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
        "dock_powered": boolean("Dock powered"),
        "timestamp": utc_now(),
    }


def snapshot(label: str, tag: str | None = None) -> dict[str, object]:
    text = battery_text()
    name = f"{tag}.{label}.battery.txt" if tag else f"{label}.battery.txt"
    write_raw(name, text)
    value = parse_battery(text)
    append_jsonl("battery_snapshots.jsonl", {"label": label, **value})
    return value


def meminfo(label: str, tag: str) -> dict[str, object]:
    result = shell("cat /proc/meminfo", timeout=20)
    write_raw(f"{tag}.{label}.meminfo.txt", result.stdout + result.stderr)
    match = re.search(r"^MemAvailable:\s+(\d+)\s+kB", result.stdout, re.MULTILINE)
    return {"memavailable_kb": int(match.group(1)) if match else None, "timestamp": utc_now()}


def thermal_zones(label: str, tag: str) -> None:
    command = (
        "for z in /sys/class/thermal/thermal_zone*; do "
        "[ -d \"$z\" ] || continue; "
        "printf '%s type=' \"$z\"; cat \"$z/type\" 2>/dev/null; "
        "printf '%s temp=' \"$z\"; cat \"$z/temp\" 2>/dev/null; "
        "done"
    )
    result = shell(command, timeout=30, allow_nonzero=True)
    write_raw(f"{tag}.{label}.thermal_zones.txt", result.stdout + result.stderr)


def device_props() -> None:
    fields = (
        "ro.product.model",
        "ro.product.device",
        "ro.product.name",
        "ro.soc.model",
        "ro.build.version.release",
        "ro.build.version.sdk",
        "ro.hardware",
        "ro.boot.hardware",
    )
    lines: list[str] = []
    for field in fields:
        result = shell(f"getprop {shlex.quote(field)}", timeout=15)
        lines.append(f"{field}={result.stdout.strip()}\n")
    write_raw("device_props.txt", "".join(lines))
    write_raw("device_space.txt", shell("df -k /data /data/local/tmp", timeout=20).stdout)


def verify_device_listing() -> None:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    env["MSYS2_ARG_CONV_EXCL"] = "*"
    result = subprocess.run([ADB, "devices", "-l"], text=True, capture_output=True, timeout=30, env=env)
    text = result.stdout + result.stderr
    write_raw("adb_devices.txt", text)
    if SERIAL + " device " not in text:
        raise StopCell(f"exact S23 ADB entry not present: {SERIAL}")
    if "model:SM_S911U" not in text:
        raise StopCell("exact S23 entry is not SM_S911U")


def push_file(local: Path, remote: str, timeout: float = 180.0) -> str:
    result = run_adb(["push", str(local), remote], timeout=timeout)
    return result.stdout + result.stderr


def verify_lf_remote(path: str) -> str:
    result = shell(f"head -c 200 {shlex.quote(path)} | od -c", timeout=20, allow_nonzero=True)
    text = result.stdout + result.stderr
    if "\\r" in text:
        raise StopCell(f"CRLF detected on device script {path}")
    return text


def prep_push() -> None:
    set_status("PUSH")
    verify_device_listing()
    device_props()
    files = sorted(
        path for path in RUNTIME_PC.iterdir()
        if path.is_file() and (path.name == "bmoe-cli" or path.name.endswith(".so"))
    )
    if {path.name for path in files} != RUNTIME_NAMES:
        raise StopCell(f"runtime file set mismatch: {[path.name for path in files]}")
    local_hashes = {path.name: {"bytes": path.stat().st_size, "sha256": sha256_pc(path)} for path in files}
    write_raw("runtime_pc_hashes.json", json.dumps(local_hashes, indent=2, sort_keys=True) + "\n")
    append_log(f"PUSH runtime files={','.join(path.name for path in files)}")

    shell(f"mkdir -p {shlex.quote(RUNTIME_REMOTE)} {shlex.quote(OUT_REMOTE)}", timeout=20)
    push_file(files[0], RUNTIME_REMOTE + "/")
    for path in files[1:]:
        push_file(path, RUNTIME_REMOTE + "/")
    push_file(GUARD_PC, GUARD_REMOTE, timeout=60)
    push_file(SAMPLER_PC, SAMPLER_REMOTE, timeout=60)
    shell(f"chmod 755 {shlex.quote(RUNTIME_REMOTE)}/* {shlex.quote(GUARD_REMOTE)} {shlex.quote(SAMPLER_REMOTE)}", timeout=20)
    write_raw("runtime_remote_listing.txt", shell(f"ls -l {shlex.quote(RUNTIME_REMOTE)}", timeout=20).stdout)
    write_raw("guard_head_od.txt", verify_lf_remote(GUARD_REMOTE))
    write_raw("sampler_head_od.txt", verify_lf_remote(SAMPLER_REMOTE))

    device_hash_text = shell(
        f"cd {shlex.quote(RUNTIME_REMOTE)} && sha256sum bmoe-cli *.so",
        timeout=240,
    ).stdout
    write_raw("runtime_device_sha256.txt", device_hash_text)
    device_hashes: dict[str, str] = {}
    for line in device_hash_text.splitlines():
        match = re.match(r"^([0-9a-fA-F]{64})\s+(.+)$", line.strip())
        if match:
            device_hashes[Path(match.group(2)).name] = match.group(1).lower()
    for name, info in local_hashes.items():
        if device_hashes.get(name) != info["sha256"]:
            raise StopCell(f"runtime hash mismatch {name}: PC={info['sha256']} device={device_hashes.get(name)}")
    append_log("PUSH device sha256 matches PC for all seven runtime files")

    stat_text = shell(f"stat -c %s {shlex.quote(MODEL)}", timeout=20).stdout.strip()
    write_raw("model_size.txt", stat_text + "\n")
    if int(stat_text) != MODEL_BYTES:
        raise StopCell(f"model size mismatch {stat_text} != {MODEL_BYTES}")
    model_sha_text = shell(f"sha256sum {shlex.quote(MODEL)}", timeout=1200).stdout
    write_raw("model.sha256sum.txt", model_sha_text)
    if not re.search(r"^[0-9a-fA-F]{64}\s+", model_sha_text, re.MULTILINE):
        raise StopCell("device model sha256sum missing")
    append_log("PUSH model sha256 computed once on device")

    help_result = shell(
        f"env LD_LIBRARY_PATH={shlex.quote(RUNTIME_REMOTE)} {shlex.quote(RUNTIME_REMOTE + '/bmoe-cli')} --help",
        timeout=60,
        allow_nonzero=True,
    )
    help_text = help_result.stdout + help_result.stderr
    write_raw("bmoe_help.txt", help_text)
    required = (
        "--moe-stream", "--cache-mb", "--dense-weights", "--io-threads", "--ubatch",
        "--no-think", "--progress", "--csv",
    )
    missing = [flag for flag in required if flag not in help_text]
    append_log(f"PUSH help rc={help_result.returncode} missing={missing}")
    if missing:
        raise StopCell("shipped bmoe-cli help missing: " + ", ".join(missing))


def push_prompt(path: Path, remote_name: str) -> dict[str, object]:
    remote = f"{OUT_REMOTE}/{remote_name}"
    push_file(path, remote, timeout=60)
    device_sha = shell(f"sha256sum {shlex.quote(remote)}", timeout=20).stdout.strip()
    local_sha = sha256_pc(path)
    write_raw(f"{remote_name}.device.sha256sum.txt", device_sha + "\n")
    write_raw(f"{remote_name}.pc.sha256.txt", local_sha + "  " + str(path) + "\n")
    if local_sha not in device_sha:
        raise StopCell(f"prompt sha mismatch for {remote_name}")
    return {"path": str(path), "remote": remote, "bytes": path.stat().st_size, "sha256": local_sha}


def initial_prompt() -> Path:
    if not SOURCE_PROMPT.exists():
        raise StopCell(f"missing reusable q62 prompt: {SOURCE_PROMPT}")
    text = SOURCE_PROMPT.read_text(encoding="utf-8")
    candidate = text[:500].strip() + "\n"
    path = CELL / "q64_p128_calib1.txt"
    path.write_text(candidate, encoding="utf-8", newline="\n")
    return path


def retarget_prompt(source: Path, count: int) -> Path:
    text = source.read_text(encoding="utf-8")
    desired = max(180, min(len(SOURCE_PROMPT.read_text(encoding="utf-8")), round(len(text) * 128 / max(count, 1))))
    path = CELL / "q64_p128_calib2.txt"
    path.write_text(SOURCE_PROMPT.read_text(encoding="utf-8")[:desired].strip() + "\n", encoding="utf-8", newline="\n")
    return path


def wait_spacing() -> None:
    global last_invocation_end
    if last_invocation_end is None:
        return
    remaining = 60.0 - (time.monotonic() - last_invocation_end)
    if remaining > 0:
        append_log(f"SPACING waiting {remaining:.1f}s; required=60s")
        time.sleep(remaining)


def gate_before(tag: str) -> dict[str, object]:
    while True:
        value = snapshot("gate", tag)
        level = value.get("level")
        temp = value.get("temperature_tenths")
        plugged = any(value.get(key) is True for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
        append_log(f"GATE {tag} battery={level} temp_tenths={temp} plugged={plugged} required_battery>=40")
        if level is None:
            raise StopCell(f"battery unavailable before {tag}")
        if int(level) < 35:
            raise StopCell(f"battery below STOP floor 35% before {tag}: {level}%")
        if int(level) < 40:
            raise StopCell(f"battery gate below 40% before {tag}: {level}%")
        if plugged:
            raise StopCell(f"unplug gate failed before {tag}")
        if temp is None:
            raise StopCell(f"temperature unavailable before {tag}")
        if int(temp) <= 320:
            return value
        append_log(f"GATE {tag} cool-start wait temp_tenths={temp}; poll=30s")
        time.sleep(30)


def start_sampler(binary_pid: int, tag: str) -> int | None:
    sampler_csv = f"{OUT_REMOTE}/{tag}.sampler.csv"
    result = shell(
        f"nohup {shlex.quote(SAMPLER_REMOTE)} {binary_pid} {shlex.quote(sampler_csv)} 1 "
        "</dev/null >/dev/null 2>&1 & echo SAMPLER_PID=$!",
        timeout=20,
    )
    match = re.search(r"SAMPLER_PID=(\d+)", result.stdout)
    return int(match.group(1)) if match else None


def monitor_guarded_process(process: subprocess.Popen[str], tag: str) -> dict[str, object]:
    pid_path = f"{OUT_REMOTE}/{tag}.pid"
    sampler_pid: int | None = None
    binary_pid: int | None = None
    sampler_started = False
    cpuset_seen: list[dict[str, object]] = []
    cpuset_violation = False
    monitor_error = ""
    cpuset_path = RAW / f"{tag}.cpuset.log"
    with cpuset_path.open("w", encoding="utf-8", newline="\n") as handle:
        while process.poll() is None:
            try:
                pid_text = remote_text(pid_path)
                match = re.search(r"^BINARY_PID=(\d+)", pid_text, re.MULTILINE)
                if match:
                    binary_pid = int(match.group(1))
                    if not sampler_started:
                        sampler_pid = start_sampler(binary_pid, tag)
                        sampler_started = True
                    proc_text = remote_text(f"/proc/{binary_pid}/cpuset").strip()
                    status_text = remote_text(f"/proc/{binary_pid}/status")
                    cmdline = remote_text(f"/proc/{binary_pid}/cmdline").replace("\x00", " ").strip()
                    allowed_match = re.search(r"^Cpus_allowed_list:\s*(.+)$", status_text, re.MULTILINE)
                    allowed = allowed_match.group(1).strip() if allowed_match else "NA"
                    item = {
                        "timestamp": utc_now(),
                        "binary_pid": binary_pid,
                        "cpuset": proc_text or "NA",
                        "cpus_allowed_list": allowed,
                        "cmdline": cmdline,
                        "is_bmoe_cli": "bmoe-cli" in cmdline,
                    }
                    handle.write(json.dumps(item, separators=(",", ":")) + "\n")
                    handle.flush()
                    cpuset_seen.append(item)
                    if "bmoe-cli" in cmdline and allowed != "0-7":
                        cpuset_violation = True
                time.sleep(1)
            except DeviceError as exc:
                monitor_error = str(exc)
                append_log(f"{tag} monitor adb failure={monitor_error}")
                break
        process_rc = process.wait()
    if sampler_pid is not None:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            result = shell(f"kill -0 {sampler_pid}", timeout=10, allow_nonzero=True)
            if result.returncode != 0:
                break
            time.sleep(0.5)
    return {
        "process_rc": process_rc,
        "binary_pid": binary_pid,
        "sampler_pid": sampler_pid,
        "sampler_remote": f"{OUT_REMOTE}/{tag}.sampler.csv",
        "sampler_argument_pid": binary_pid,
        "cpuset_samples": cpuset_seen,
        "cpuset_violation": cpuset_violation,
        "monitor_error": monitor_error,
    }


def command_text(tag: str, cache: str, prompt_name: str, decode_n: int) -> tuple[str, list[str]]:
    rendered = (
        f"cd {OUT_REMOTE} && "
        f"LD_LIBRARY_PATH={RUNTIME_REMOTE} {RUNTIME_REMOTE}/bmoe-cli "
        f"-m {MODEL} --moe-stream --cache-mb {cache} --dense-weights anon --io-threads 4 -t 4 "
        f"-p \"$(cat {OUT_REMOTE}/{prompt_name})\" -n {decode_n} -c 512 --ubatch 512 --no-think "
        f"--progress --csv {tag}.csv"
    )
    return rendered, ["/system/bin/sh", "-c", rendered]


def pull_remote(remote: str, local_name: str, timeout: float = 180.0) -> bool:
    result = run_adb(["pull", remote, str(RAW / local_name)], timeout=timeout, allow_nonzero=True)
    write_raw(f"{local_name}.pull.txt", result.stdout + result.stderr)
    return result.returncode == 0


def exact_marker(text: str) -> str:
    for line in text.splitlines():
        for marker in CRASH_MARKERS:
            if marker in line:
                return line.strip()
    return ""


def run_invocation(tag: str, block: int | None, arm: str, cache: str, prompt_name: str, decode_n: int, calibration: bool = False, retry: int = 0) -> dict[str, object]:
    global last_invocation_end
    wait_spacing()
    gate_before(tag)
    pre = snapshot("pre", tag)
    pre_mem = meminfo("pre", tag)
    thermal_zones("pre", tag)
    command, workload = command_text(tag, cache, prompt_name, decode_n)
    write_raw(f"{tag}.command.txt", command + "\n")
    write_raw(f"{tag}.workload.argv.txt", json.dumps(workload, ensure_ascii=False) + "\n")
    append_log(
        f"INVOCATION {tag} block={block} arm={arm} cache={cache} n={decode_n} "
        f"battery_pre={pre.get('level')} temp_pre_tenths={pre.get('temperature_tenths')} "
        f"MemAvailable_pre_kb={pre_mem.get('memavailable_kb')} calibration={calibration} retry={retry}"
    )
    launch_args = [
        sys.executable, str(LAUNCHER),
        "--serial", SERIAL,
        "--tag", tag,
        "--warn-tenths", "400",
        "--kill-tenths", "430",
        "--session-hard-cap-tenths", "0",
        "--sensor-failure-limit", "4",
        "--interval-s", "10",
        "--max-seconds", "720",
        "--launcher-min-battery", "40",
        "--local-dir", str(RAW),
        "--manifest-path", str(RAW / f"{tag}.manifest.json"),
        "--",
        *workload,
    ]
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    env["MSYS2_ARG_CONV_EXCL"] = "*"
    stdout_path = RAW / f"{tag}.launcher.stdout.log"
    stderr_path = RAW / f"{tag}.launcher.stderr.log"
    with stdout_path.open("w", encoding="utf-8", newline="\n") as stdout_handle, stderr_path.open("w", encoding="utf-8", newline="\n") as stderr_handle:
        process = subprocess.Popen(launch_args, cwd=ROOT, env=env, stdout=stdout_handle, stderr=stderr_handle, text=True)
        monitor = monitor_guarded_process(process, tag)
    last_invocation_end = time.monotonic()

    remote_files = {
        "csv": (f"{OUT_REMOTE}/{tag}.csv", f"{tag}.csv"),
        "stdout": (f"{OUT_REMOTE}/{tag}.stdout.jsonl", f"{tag}.stdout.jsonl"),
        "stderr": (f"{OUT_REMOTE}/{tag}.stderr.log", f"{tag}.stderr.log"),
        "sampler": (f"{OUT_REMOTE}/{tag}.sampler.csv", f"{tag}.sampler.csv"),
        "pid": (f"{OUT_REMOTE}/{tag}.pid", f"{tag}.pid"),
        "guard_pid": (f"{OUT_REMOTE}/{tag}.guard.pid", f"{tag}.guard.pid"),
        "guard_ready": (f"{OUT_REMOTE}/{tag}.guard.ready", f"{tag}.guard.ready"),
        "guard_tracking": (f"{OUT_REMOTE}/{tag}.guard.tracking", f"{tag}.guard.tracking"),
        "workload_rc": (f"{OUT_REMOTE}/{tag}.workload.rc", f"{tag}.workload.rc"),
        "guard_rc": (f"{OUT_REMOTE}/{tag}.guard.rc", f"{tag}.guard.rc"),
        "supervisor_failure": (f"{OUT_REMOTE}/{tag}.supervisor.failure", f"{tag}.supervisor.failure"),
        "guard_log": (f"{OUT_REMOTE}/{tag}.guard.log", f"{tag}.guard.log"),
    }
    pulled = {key: pull_remote(remote, local, timeout=300 if key == "csv" else 180) for key, (remote, local) in remote_files.items()}
    post = snapshot("post", tag)
    post_mem = meminfo("post", tag)
    thermal_zones("post", tag)

    dmesg = shell("dmesg", timeout=30, allow_nonzero=True)
    write_raw(f"{tag}.dmesg.txt", dmesg.stdout + dmesg.stderr)
    logcat = shell("logcat -d -s lowmemorykiller", timeout=60, allow_nonzero=True)
    write_raw(f"{tag}.lowmemorykiller.logcat.txt", logcat.stdout + logcat.stderr)

    manifest_path = RAW / f"{tag}.manifest.json"
    launcher_manifest: dict[str, object] = {}
    if manifest_path.exists():
        try:
            loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                launcher_manifest = loaded
        except json.JSONDecodeError:
            pass
    stdout_text = (RAW / f"{tag}.stdout.jsonl").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.stdout.jsonl").exists() else ""
    stderr_text = (RAW / f"{tag}.stderr.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.stderr.log").exists() else ""
    dmesg_text = (RAW / f"{tag}.dmesg.txt").read_text(encoding="utf-8", errors="replace")
    logcat_text = (RAW / f"{tag}.lowmemorykiller.logcat.txt").read_text(encoding="utf-8", errors="replace")
    workload_rc = launcher_manifest.get("workload_rc")
    guard_rc = launcher_manifest.get("guard_exit_code")
    if guard_rc is None:
        guard_rc_path = RAW / f"{tag}.guard.rc"
        if guard_rc_path.exists():
            guard_rc_text = guard_rc_path.read_text(encoding="utf-8", errors="replace").strip()
            if guard_rc_text.lstrip("-").isdigit():
                guard_rc = int(guard_rc_text)
    failure = exact_marker(stderr_text + "\n" + stdout_text)
    rc_value = int(workload_rc) if isinstance(workload_rc, int) or (isinstance(workload_rc, str) and workload_rc.lstrip("-").isdigit()) else None
    guard_value = int(guard_rc) if isinstance(guard_rc, int) or (isinstance(guard_rc, str) and guard_rc.lstrip("-").isdigit()) else None
    lmk_signal = rc_value in (9, 137) and guard_value not in (2, 3)
    lmk_evidence = bool(re.search(r"lowmemorykiller|killed process|out of memory", (dmesg_text + "\n" + logcat_text).lower()))
    likely_lmk = lmk_signal and (lmk_evidence or rc_value in (9, 137))
    record: dict[str, object] = {
        "tag": tag,
        "base_tag": tag.rsplit("_retry", 1)[0] if retry else tag,
        "block": block,
        "arm": arm,
        "cache": cache,
        "prompt_name": prompt_name,
        "decode_n": decode_n,
        "calibration": calibration,
        "retry": retry,
        "command_verbatim": command,
        "workload_argv": workload,
        "launcher_argv": launch_args,
        "battery_pre": pre,
        "battery_post": post,
        "mem_pre": pre_mem,
        "mem_post": post_mem,
        "monitor": monitor,
        "launcher_rc": monitor.get("process_rc"),
        "workload_rc": workload_rc,
        "guard_rc": guard_rc,
        "guard_outcome": launcher_manifest.get("guard_outcome"),
        "guard_max_temperature_tenths": (launcher_manifest.get("guard") or {}).get("max_temperature_tenths") if isinstance(launcher_manifest.get("guard"), dict) else None,
        "failure_signature": failure,
        "likely_lmk": likely_lmk,
        "lmk_evidence": lmk_evidence,
        "lmk_signal_rc": rc_value,
        "dmesg_readable": dmesg.returncode == 0,
        "logcat_readable": logcat.returncode == 0,
        "pulled": pulled,
        "timestamp_start": pre.get("timestamp"),
        "timestamp_end": post.get("timestamp"),
    }
    write_raw(f"{tag}.record.json", json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    append_record(record)
    return record


def load_failure(record: dict[str, object]) -> bool:
    if record.get("workload_rc") != 1:
        return False
    tag = str(record.get("tag"))
    text = ""
    for suffix in (".stdout.jsonl", ".stderr.log", ".launcher.stderr.log"):
        path = RAW / f"{tag}{suffix}"
        if path.exists():
            text += path.read_text(encoding="utf-8", errors="replace")
    return any(marker in text.lower() for marker in LOAD_MARKERS)


def stop_reason(record: dict[str, object]) -> str:
    monitor = record.get("monitor") if isinstance(record.get("monitor"), dict) else {}
    if monitor.get("monitor_error"):
        return f"adb monitor failure: {monitor['monitor_error']}"
    if monitor.get("cpuset_violation"):
        return "cpuset gate failure (binary_pid Cpus_allowed_list != 0-7)"
    if record.get("failure_signature"):
        return f"exact stop marker: {record['failure_signature']}"
    if record.get("likely_lmk"):
        return ""
    guard = record.get("guard_rc")
    if guard in (2, 3):
        return f"thermal/sensor guard rc={guard} outcome={record.get('guard_outcome')}"
    rc = record.get("workload_rc")
    if isinstance(rc, int) and rc >= 128:
        return f"workload rc={rc} (not guard)"
    if rc not in (0, None):
        return f"workload rc={rc}"
    launcher_rc = record.get("launcher_rc")
    if launcher_rc not in (0, None) and not (launcher_rc == 1 and record.get("workload_rc") == 0 and record.get("guard_rc") == 0):
        return f"launcher rc={launcher_rc}"
    return ""


def scheduled_run(block: int, index: int, arm: str, prompt_name: str, killed_arms: set[str]) -> dict[str, object] | None:
    tag = f"b{block}_a{index}_{arm}"
    existing_tags = {
        str(row.get("tag"))
        for row in read_records()
        if isinstance(row, dict) and row.get("tag")
    }
    if tag in existing_tags or f"{tag}_retry1" in existing_tags:
        append_log(f"{tag} RESUME already recorded; no rerun")
        return None
    if arm in killed_arms:
        skipped = {
            "tag": tag,
            "block": block,
            "arm": arm,
            "cache": arm,
            "skipped": True,
            "skip_reason": "prior LMK kill at this cache size; no retry at that size",
        }
        write_raw(f"{tag}.skipped.json", json.dumps(skipped, indent=2) + "\n")
        append_record(skipped)
        append_log(f"{tag} SKIPPED prior LMK at cache={arm}; no retry at that size")
        return None
    set_status(f"RUN block {block} arm {arm}")
    record = run_invocation(tag, block, arm, arm, prompt_name, 128)
    if load_failure(record):
        append_log(f"{tag} diagnosed rc=1 model-load failure; one retry permitted")
        retry_tag = f"{tag}_retry1"
        retry = run_invocation(retry_tag, block, arm, arm, prompt_name, 128, retry=1)
        reason = stop_reason(retry)
        if reason:
            raise StopCell(f"{retry_tag}: {reason}")
        return retry
    reason = stop_reason(record)
    if record.get("likely_lmk"):
        killed_arms.add(arm)
        append_log(
            f"{tag} LMK datum cache={arm}; no retry at that size; "
            f"MemAvailable_pre_kb={((record.get('mem_pre') or {}).get('memavailable_kb') if isinstance(record.get('mem_pre'), dict) else None)} "
            f"rc={record.get('lmk_signal_rc')} dmesg_readable={record.get('dmesg_readable')} logcat_readable={record.get('logcat_readable')}"
        )
        return record
    if reason:
        raise StopCell(f"{tag}: {reason}")
    return record


def parse_prompt_tokens(tag: str) -> int | None:
    for suffix in (".stdout.jsonl", ".csv"):
        path = RAW / f"{tag}{suffix}"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in (r"\bn_prompt=(\d+)\b", r"prefill:\s*(\d+)\s+tokens"):
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return int(match.group(1))
    return None


def calibrate() -> str:
    prompt = initial_prompt()
    first_meta = push_prompt(prompt, "q64_p128_calib1.txt")
    set_status("CALIB 1")
    first = run_invocation("calib1", None, "calib", "0", "q64_p128_calib1.txt", 1, calibration=True)
    first_count = parse_prompt_tokens("calib1")
    write_raw("calib1.summary.json", json.dumps({"record": first, "prompt_tokens": first_count, "prompt": first_meta, "discarded": True}, indent=2) + "\n")
    if stop_reason(first):
        raise StopCell(f"calib1: {stop_reason(first)}")
    if first_count is not None and 120 <= first_count <= 136:
        final = CELL / "q64_p128.txt"
        final.write_text(prompt.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        push_prompt(final, "q64_p128.txt")
        append_log(f"CALIB accepted count={first_count}; calibration loads=1; numbers discarded")
        return "q64_p128.txt"

    second_prompt = retarget_prompt(prompt, first_count or 128)
    second_meta = push_prompt(second_prompt, "q64_p128_calib2.txt")
    set_status("CALIB 2")
    second = run_invocation("calib2", None, "calib", "0", "q64_p128_calib2.txt", 1, calibration=True)
    second_count = parse_prompt_tokens("calib2")
    write_raw("calib2.summary.json", json.dumps({"record": second, "prompt_tokens": second_count, "prompt": second_meta, "discarded": True}, indent=2) + "\n")
    if stop_reason(second):
        raise StopCell(f"calib2: {stop_reason(second)}")
    if second_count is None or not 120 <= second_count <= 136:
        raise StopCell(f"prompt calibration outside 128+-8 after two loads: {second_count}")
    final = CELL / "q64_p128.txt"
    final.write_text(second_prompt.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    push_prompt(final, "q64_p128.txt")
    append_log(f"CALIB accepted count={second_count}; calibration loads=2; numbers discarded")
    return "q64_p128.txt"


def invoke_finalizer() -> int:
    finalize = subprocess.run(
        [sys.executable, str(CELL / "finalize_q64.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=120,
    )
    write_raw("finalize.stdout.log", finalize.stdout)
    write_raw("finalize.stderr.log", finalize.stderr)
    if finalize.returncode != 0:
        append_log(f"finalizer rc={finalize.returncode}")
    return finalize.returncode


def main() -> int:
    global last_invocation_end
    existing_records = read_records()
    status_text = (CELL / "STATUS.txt").read_text(encoding="utf-8", errors="replace") if (CELL / "STATUS.txt").exists() else ""
    resume = bool(existing_records) and "STOPPED" in status_text
    if any((CELL / name).exists() for name in ("run_records.jsonl", "manifest.json", "REPORT.md")) and not resume:
        set_status("STOPPED existing q64 outputs; refusing overwrite")
        return 2
    RAW.mkdir(parents=True, exist_ok=True)
    if not resume:
        (CELL / "run_records.jsonl").write_text("", encoding="utf-8", newline="\n")
    last_invocation_end = None
    append_log(("RESUME q64 after adapter-only bookkeeping correction; completed tags preserved" if resume else "START q64; locked PREREG; no git commit/push; BigMoeOnEdge sources untouched; adb reconnect forbidden"))
    try:
        if resume:
            prompt_name = "q64_p128.txt"
            if not remote_text(f"{OUT_REMOTE}/{prompt_name}"):
                raise StopCell("resume prompt q64_p128.txt missing on device")
            killed_arms = {str(row.get("arm")) for row in existing_records if row.get("likely_lmk")}
        else:
            prep_push()
            prompt_name = calibrate()
            killed_arms = set()
        for block_number, order in enumerate(LATIN_SQUARE, start=1):
            for index, arm in enumerate(order, start=1):
                scheduled_run(block_number, index, arm, prompt_name, killed_arms)
        set_status("DONE")
        append_log("DONE all scheduled blocks complete")
    except StopCell as exc:
        append_log(f"STOPPED {exc}")
        set_status(f"STOPPED {exc}")
        invoke_finalizer()
        return 2
    except Exception as exc:
        append_log(f"STOPPED {type(exc).__name__}: {exc}")
        set_status(f"STOPPED {type(exc).__name__}: {exc}")
        invoke_finalizer()
        return 2

    if invoke_finalizer() != 0:
        set_status("STOPPED finalizer failure")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
