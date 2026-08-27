from __future__ import annotations

import datetime as dt
import csv
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
CELL = ROOT / "scratchpad" / "agents" / "q62-product-streamer-prefill"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
MODEL = "/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf"
RUNTIME_PC = ROOT / "models_staging" / "ship_runtime_s23_0ac612de"
RUNTIME_REMOTE = "/data/local/tmp/q62_rt"
OUT_REMOTE = "/data/local/tmp/q62_out"
GUARD_PC = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "thermal_guard.sh"
SAMPLER_PC = CELL / "q62_sampler.sh"
GUARD_REMOTE_DIR = "/data/local/tmp/q62_guard"
GUARD_REMOTE = f"{GUARD_REMOTE_DIR}/thermal_guard.sh"
SAMPLER_REMOTE = "/data/local/tmp/q62_sampler.sh"
SAMPLER_REMOTE_DIR = "/data/local/tmp/q62_sampler"
LAUNCHER = CELL / "launch_q62.py"
EXPECTED_MODEL_BYTES = 13416430592
EXPECTED_MODEL_SHA = "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a"
EXPECTED_BMOE_SHA = "0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c"
REQUIRED_FLAGS = (
    "--moe-stream",
    "--cache-mb",
    "--dense-weights",
    "--io-threads",
    "--ubatch",
    "--no-think",
    "--progress",
    "--csv",
    "--io-trace",
    "--cache-ceil-mb",
    "--compute-trace-layers",
)
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


class DeviceError(RuntimeError):
    pass


def now_local() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def append_log(message: str) -> None:
    path = CELL / "RUN_LOG.md"
    if not path.exists():
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write("# q62 RUN_LOG\n")
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"\n{now_local()} {message}\n")


def set_status(value: str) -> None:
    with (CELL / "STATUS.txt").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{now_local()} {value}\n")


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
    transport = (
        "device offline",
        "no devices/emulators found",
        "failed to get feature set",
        "cannot connect",
        "connection refused",
        "closed",
    )
    if any(marker in combined.lower() for marker in transport):
        raise DeviceError(f"adb transport failure: {combined.strip()}")
    if result.returncode != 0 and not allow_nonzero:
        raise DeviceError(f"adb rc={result.returncode}: {combined.strip()}")
    return result


def shell(command: str, timeout: float = 30.0, allow_nonzero: bool = False) -> subprocess.CompletedProcess[str]:
    return run_adb(["shell", command], timeout=timeout, allow_nonzero=allow_nonzero)


def write_raw(name: str, text: str) -> Path:
    path = RAW / name
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return path


def append_jsonl(name: str, value: object) -> None:
    with (RAW / name).open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(value, separators=(",", ":")) + "\n")


def sha256_pc(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


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
    target = f"{tag}.{label}.battery.txt" if tag else f"{label}.battery.txt"
    write_raw(target, text)
    value = parse_battery(text)
    append_jsonl("battery_snapshots.jsonl", {"label": label, **value})
    return value


def meminfo(label: str, tag: str | None = None) -> dict[str, object]:
    result = shell("cat /proc/meminfo", timeout=20)
    target = f"{tag}.{label}.meminfo.txt" if tag else f"{label}.meminfo.txt"
    write_raw(target, result.stdout + result.stderr)
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
    fields = [
        "ro.product.model",
        "ro.product.device",
        "ro.product.name",
        "ro.soc.model",
        "ro.build.version.release",
        "ro.build.version.sdk",
        "ro.hardware",
        "ro.boot.hardware",
    ]
    lines = []
    for field in fields:
        result = shell(f"getprop {shlex.quote(field)}", timeout=15)
        lines.append(f"{field}={result.stdout.strip()}\n")
    write_raw("device_props.txt", "".join(lines))
    write_raw("device_space.txt", shell("df -k /data /data/local/tmp", timeout=20).stdout)


def verify_existing_device() -> None:
    """One bounded check; the runtime, model, guard, and output dir are pre-verified."""
    command = (
        "ls -l /data/local/tmp/q62_rt/bmoe-cli /data/local/tmp/q62_guard/thermal_guard.sh "
        "/data/local/tmp/q62_out; "
        "stat -c model_bytes=%s " + MODEL + "; "
        "sha256sum /data/local/tmp/q62_rt/bmoe-cli; "
        "test -d /data/local/tmp/q62_out"
    )
    result = shell(command, timeout=30)
    text = result.stdout + result.stderr
    write_raw("existing_device_check.txt", text)
    if EXPECTED_BMOE_SHA not in text:
        raise RuntimeError("existing device bmoe-cli sha mismatch")
    if f"model_bytes={EXPECTED_MODEL_BYTES}" not in text:
        raise RuntimeError("existing device model size mismatch")
    append_log("existing device check: bmoe-cli sha and model size passed; guard/output/runtime paths verified; 13 GB model hash not rehashed per locked instruction")


def push_prompt(prompt_path: Path, tag: str = "q62_pp512") -> dict[str, object]:
    remote = f"{OUT_REMOTE}/{prompt_path.name}"
    run_adb(["shell", f"mkdir -p {shlex.quote(OUT_REMOTE)}"], timeout=20)
    run_adb(["push", str(prompt_path), remote], timeout=60)
    device_sha = shell(f"sha256sum {shlex.quote(remote)}", timeout=30).stdout.strip()
    write_raw(f"{tag}.device.sha256sum.txt", device_sha + "\n")
    local_sha = sha256_pc(prompt_path)
    write_raw(f"{tag}.pc.sha256.txt", local_sha + "  " + str(prompt_path) + "\n")
    if local_sha not in device_sha:
        raise RuntimeError(f"prompt sha mismatch PC={local_sha} device={device_sha}")
    append_log(f"prompt pushed remote={remote} sha256={local_sha} bytes={prompt_path.stat().st_size}")
    return {"file": str(prompt_path), "remote": remote, "bytes": prompt_path.stat().st_size, "sha256": local_sha}


def dry_prompt_echo(prompt_name: str, raw_tag: str = "q62_pp512") -> str:
    remote = f"{OUT_REMOTE}/{prompt_name}"
    command = (
        f"cd {shlex.quote(OUT_REMOTE)} && p=\"$(cat {shlex.quote(remote)})\" && "
        "set -- -p \"$p\" && "
        "printf 'p_arg_count=%s\\n' \"$(( $# - 1 ))\" && "
        "printf 'p_arg_chars=%s\\n' \"${#2}\" && "
        "printf 'p_arg_preview=%s\\n' \"$(printf '%s' \"$2\" | cut -c1-96)\""
    )
    result = shell(command, timeout=20)
    text = result.stdout + result.stderr
    write_raw(f"{raw_tag}.dry_echo.txt", text)
    if "p_arg_count=1" not in text:
        raise RuntimeError(f"prompt dry echo did not prove one -p argument: {text.strip()}")
    append_log(f"prompt dry echo passed; {text.strip().replace(chr(10), ' ')}")
    return text


def verify_lf_remote(path: str) -> str:
    result = shell(f"head -c 200 {shlex.quote(path)} | od -c", timeout=15, allow_nonzero=True)
    text = result.stdout + result.stderr
    if "\\r" in text:
        raise RuntimeError(f"CRLF detected on device script {path}")
    return text


def push_prep() -> dict[str, object]:
    RAW.mkdir(parents=True, exist_ok=True)
    append_log("PREP begin; no git operation; BigMoeOnEdge sources untouched")
    device_props()
    runtime_files = [path for path in sorted(RUNTIME_PC.iterdir()) if path.is_file()]
    if not runtime_files:
        raise RuntimeError(f"runtime archive is empty: {RUNTIME_PC}")
    local_hashes = {path.name: {"bytes": path.stat().st_size, "sha256": sha256_pc(path)} for path in runtime_files}
    write_raw("runtime_pc_hashes.json", json.dumps(local_hashes, indent=2) + "\n")
    append_log(f"runtime PC archive files={','.join(sorted(local_hashes))}")

    shell(f"mkdir -p {shlex.quote(RUNTIME_REMOTE)} {shlex.quote(GUARD_REMOTE_DIR)} {shlex.quote(OUT_REMOTE)} {shlex.quote(SAMPLER_REMOTE_DIR)}", timeout=20)
    run_adb(["push", *[str(path) for path in runtime_files], RUNTIME_REMOTE + "/"], timeout=180)
    run_adb(["push", str(GUARD_PC), GUARD_REMOTE], timeout=60)
    run_adb(["push", str(SAMPLER_PC), SAMPLER_REMOTE], timeout=60)
    shell(f"chmod 755 {shlex.quote(RUNTIME_REMOTE)}/* {shlex.quote(GUARD_REMOTE)} {shlex.quote(SAMPLER_REMOTE)}", timeout=20)
    write_raw("runtime_remote_listing.txt", shell(f"ls -l {shlex.quote(RUNTIME_REMOTE)}", timeout=20).stdout)
    write_raw("guard_head_od.txt", verify_lf_remote(GUARD_REMOTE))
    write_raw("sampler_head_od.txt", verify_lf_remote(SAMPLER_REMOTE))
    append_log("runtime, guard, and sampler pushed; device LF checks passed")

    device_hash_text = shell(
        "cd " + shlex.quote(RUNTIME_REMOTE) + " && sha256sum bmoe-cli *.so",
        timeout=240,
    ).stdout
    write_raw("runtime_device_sha256.txt", device_hash_text)
    device_hashes: dict[str, str] = {}
    for line in device_hash_text.splitlines():
        match = re.match(r"^([0-9a-fA-F]{64})\s+(.+)$", line.strip())
        if match:
            device_hashes[Path(match.group(2)).name] = match.group(1).lower()
    required_runtime = {name: value for name, value in local_hashes.items() if name == "bmoe-cli" or name.endswith(".so")}
    for name, info in required_runtime.items():
        if device_hashes.get(name) != info["sha256"]:
            raise RuntimeError(f"runtime hash mismatch for {name}: PC={info['sha256']} device={device_hashes.get(name)}")
    if device_hashes.get("bmoe-cli") != EXPECTED_BMOE_SHA:
        raise RuntimeError(f"bmoe-cli expected sha mismatch: {device_hashes.get('bmoe-cli')}")
    append_log("device runtime sha256 verified for bmoe-cli and all six .so files")

    model_stat = shell(f"stat -c %s {shlex.quote(MODEL)}", timeout=20)
    model_size = int(model_stat.stdout.strip())
    write_raw("model_size.txt", model_stat.stdout + model_stat.stderr)
    if model_size != EXPECTED_MODEL_BYTES:
        raise RuntimeError(f"model size mismatch: {model_size} != {EXPECTED_MODEL_BYTES}")
    append_log(f"model size verified bytes={model_size}")
    model_sha_text = shell(f"sha256sum {shlex.quote(MODEL)}", timeout=900).stdout
    write_raw("model.sha256sum.txt", model_sha_text)
    match = re.search(r"^([0-9a-fA-F]{64})\s+", model_sha_text, re.MULTILINE)
    if not match:
        raise RuntimeError("device model sha256sum missing")
    model_sha = match.group(1).lower()
    if model_sha != EXPECTED_MODEL_SHA:
        raise RuntimeError(f"model sha mismatch: {model_sha} != {EXPECTED_MODEL_SHA}")
    append_log(f"model sha256 verified once on device sha256={model_sha}")

    help_result = shell(
        f"env LD_LIBRARY_PATH={shlex.quote(RUNTIME_REMOTE)} {shlex.quote(RUNTIME_REMOTE + '/bmoe-cli')} --help",
        timeout=60,
        allow_nonzero=True,
    )
    help_text = help_result.stdout + help_result.stderr
    write_raw("bmoe_help.txt", help_text)
    missing = [flag for flag in REQUIRED_FLAGS if flag not in help_text]
    append_log(f"bmoe-cli --help rc={help_result.returncode} required_flags_missing={missing}")
    if missing:
        raise RuntimeError(f"smoke help missing required flags: {', '.join(missing)}")
    return {
        "runtime_pc_hashes": local_hashes,
        "runtime_device_hashes": device_hashes,
        "model_bytes": model_size,
        "model_sha256": model_sha,
        "help_rc": help_result.returncode,
        "required_flags": list(REQUIRED_FLAGS),
    }


def wait_cool_and_unplug() -> dict[str, object]:
    first = snapshot("prep_initial")
    append_log(f"initial gate battery={first.get('level')} temp_tenths={first.get('temperature_tenths')} AC={first.get('ac_powered')} USB={first.get('usb_powered')}")
    while first.get("level") is None or int(first["level"]) < 45:
        set_status(f"WAIT_BATT {first.get('level')}")
        append_log(f"WAIT_BATT level={first.get('level')} temp_tenths={first.get('temperature_tenths')}")
        time.sleep(60)
        first = snapshot("battery_wait")
    while first.get("temperature_tenths") is None or int(first["temperature_tenths"]) > 320:
        append_log(f"cool-start wait temp_tenths={first.get('temperature_tenths')} level={first.get('level')}")
        time.sleep(30)
        first = snapshot("cool_wait")

    set_status(f"READY_UNPLUG {first.get('level')}")
    append_log(f"READY_UNPLUG level={first.get('level')} temp_C={float(first['temperature_tenths']) / 10:.1f}")
    unplugged = False
    polls: list[dict[str, object]] = []
    deadline = time.monotonic() + 15 * 60
    while time.monotonic() < deadline:
        current = snapshot("unplug_poll")
        polls.append(current)
        plugged = any(current.get(key) is True for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
        append_jsonl("unplug_polls.jsonl", {"plugged": plugged, **current})
        if not plugged:
            unplugged = True
            append_log(f"unplug declared observed level={current.get('level')} temp_tenths={current.get('temperature_tenths')}")
            break
        time.sleep(30)
    deviation = ""
    if not unplugged:
        deviation = "DEVIATION: plugged"
        append_log(deviation + " after 15-minute unplug poll; owner requested run-anyway")
    current = snapshot("gates_ready")
    while current.get("temperature_tenths") is None or int(current["temperature_tenths"]) > 320:
        append_log(f"cool-start wait after unplug temp_tenths={current.get('temperature_tenths')}")
        time.sleep(30)
        current = snapshot("cool_wait_after_unplug")
    return {"battery": current, "unplugged": unplugged, "deviation": deviation, "polls": polls}


def exact_marker(text: str) -> str:
    for line in text.splitlines():
        for marker in CRASH_MARKERS:
            if marker in line:
                return line.strip()
    return ""


def pull_remote(remote: str, local_name: str, timeout: float = 180.0) -> bool:
    result = run_adb(["pull", remote, str(RAW / local_name)], timeout=timeout, allow_nonzero=True)
    write_raw(f"{local_name}.pull.txt", result.stdout + result.stderr)
    return result.returncode == 0


def remote_file(path: str) -> str:
    result = shell(f"cat {shlex.quote(path)}", timeout=15, allow_nonzero=True)
    return result.stdout if result.returncode == 0 else ""


def start_sampler(pid: int, tag: str) -> int | None:
    remote_csv = f"{SAMPLER_REMOTE_DIR}/{tag}.sampler.csv"
    result = shell(
        f"mkdir -p {shlex.quote(SAMPLER_REMOTE_DIR)}; "
        f"nohup {shlex.quote(SAMPLER_REMOTE)} {pid} {shlex.quote(remote_csv)} 1 </dev/null >/dev/null 2>&1 & echo SAMPLER_PID=$!",
        timeout=20,
    )
    match = re.search(r"SAMPLER_PID=(\d+)", result.stdout)
    return int(match.group(1)) if match else None


def monitor_guarded_process(process: subprocess.Popen[str], tag: str, expected_reps: int) -> dict[str, object]:
    pid_path = f"{GUARD_REMOTE_DIR}/{tag}.pid"
    remote_csv = f"{SAMPLER_REMOTE_DIR}/{tag}.sampler.csv"
    sampler_pid: int | None = None
    binary_pid: int | None = None
    sampler_started = False
    cpuset_seen: list[dict[str, object]] = []
    cpuset_violation = False
    observed_rep = 0
    monitor_error = ""
    cpuset_path = RAW / f"{tag}.cpuset.log"
    with cpuset_path.open("w", encoding="utf-8", newline="\n") as cpuset_handle:
        while process.poll() is None:
            try:
                pid_text = remote_file(pid_path)
                match = re.search(r"^BINARY_PID=(\d+)", pid_text, re.MULTILINE)
                if match:
                    binary_pid = int(match.group(1))
                    if not sampler_started:
                        sampler_pid = start_sampler(binary_pid, tag)
                        sampler_started = True
                    proc_text = remote_file(f"/proc/{binary_pid}/cpuset").strip()
                    status_text = remote_file(f"/proc/{binary_pid}/status")
                    cmdline = remote_file(f"/proc/{binary_pid}/cmdline").replace("\x00", " ").strip()
                    allowed_match = re.search(r"^Cpus_allowed_list:\s*(.+)$", status_text, re.MULTILINE)
                    allowed = allowed_match.group(1).strip() if allowed_match else "NA"
                    item = {"timestamp": utc_now(), "pid": binary_pid, "cpuset": proc_text or "NA", "cpus_allowed_list": allowed, "cmdline": cmdline}
                    cpuset_seen.append(item)
                    cpuset_handle.write(json.dumps(item, separators=(",", ":")) + "\n")
                    cpuset_handle.flush()
                    if "bmoe-cli" in cmdline and allowed != "0-7":
                        cpuset_violation = True
                    try:
                        line_count = int(shell(f"wc -l < {shlex.quote(OUT_REMOTE + '/' + tag + '.csv')}", timeout=10, allow_nonzero=True).stdout.strip() or "0")
                    except (DeviceError, ValueError):
                        line_count = 0
                    if line_count > 1:
                        observed_rep = min(expected_reps, line_count - 1)
                        set_status(f"RUN {tag} rep {observed_rep}")
                time.sleep(1)
            except DeviceError as exc:
                monitor_error = str(exc)
                append_log(f"{tag} monitor adb failure={monitor_error}")
                break
        process_rc = process.wait()
    if expected_reps and observed_rep < expected_reps and binary_pid is not None:
        set_status(f"RUN {tag} rep {expected_reps}")
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
        "sampler_remote": remote_csv,
        "cpuset_samples": cpuset_seen,
        "cpuset_violation": cpuset_violation,
        "monitor_error": monitor_error,
    }


def frozen_command(
    tag: str,
    cache_mb: int,
    prompt_file: str,
    decode_n: int,
    cache_ceil_mb: int = 0,
    n_ctx: int = 512,
) -> tuple[str, list[str]]:
    csv_name = f"{tag}.csv"
    trace_name = f"{tag}_iotrace.txt"
    cache_ceil = f" --cache-ceil-mb {cache_ceil_mb}" if cache_ceil_mb else ""
    binary_args = [
        RUNTIME_REMOTE + "/bmoe-cli",
        "-m", MODEL,
        "--moe-stream",
        "--cache-mb", str(cache_mb),
        "--dense-weights", "anon",
        "--io-threads", "4",
        "-t", "4",
        "-p", f'$(cat {OUT_REMOTE}/{prompt_file})',
        "-n", str(decode_n),
        "-c", str(n_ctx),
        "--ubatch", "512",
        "--no-think",
        "--progress",
        "--csv", csv_name,
        "--io-trace", trace_name,
    ]
    # Keep the protocol's prompt expansion in the device shell.  The command
    # is carried as one sh -c argument through the guarded launcher.
    rendered = " ".join(
        shlex.quote(arg) if not arg.startswith("$(cat ") else f'"{arg}"'
        for arg in binary_args
    )
    actual = (
        "cd " + OUT_REMOTE + " && LD_LIBRARY_PATH=" + RUNTIME_REMOTE + " "
        + rendered + cache_ceil
    )
    workload = ["/system/bin/sh", "-c", actual]
    return actual, workload


def run_arm(
    tag: str,
    cache_mb: int,
    prompt_file: str,
    decode_n: int,
    min_battery: int,
    allow_plugged: bool,
    retry: int = 0,
    cache_ceil_mb: int = 0,
    n_ctx: int = 512,
) -> dict[str, object]:
    tag_run = tag if retry == 0 else f"{tag}_retry{retry}"
    command_text, workload = frozen_command(tag_run, cache_mb, prompt_file, decode_n, cache_ceil_mb, n_ctx)
    pre = snapshot("pre", tag_run)
    pre_mem = meminfo("pre", tag_run)
    thermal_zones("pre", tag_run)
    level = pre.get("level")
    temp = pre.get("temperature_tenths")
    if level is None or int(level) < min_battery:
        raise RuntimeError(f"{tag}: battery gate failed level={level} required>={min_battery}")
    if temp is None or int(temp) > 320:
        raise RuntimeError(f"{tag}: cool-start gate failed temp_tenths={temp}")
    append_log(f"INVOCATION {tag_run} cache_mb={cache_mb} prompt_file={prompt_file} decode_n={decode_n} battery_pre={level} temp_pre_tenths={temp} MemAvailable_pre_kb={pre_mem.get('memavailable_kb')} allow_plugged={allow_plugged}")
    write_raw(f"{tag_run}.command.txt", command_text + "\n")
    write_raw(f"{tag_run}.workload.argv.txt", json.dumps(workload) + "\n")
    launch_args = [
        sys.executable,
        str(LAUNCHER),
        "--serial", SERIAL,
        "--tag", tag_run,
        "--warn-tenths", "400",
        "--kill-tenths", "430",
        "--session-hard-cap-tenths", "0",
        "--sensor-failure-limit", "4",
        "--interval-s", "10",
        "--max-seconds", "900",
        "--launcher-min-battery", str(min_battery),
        "--local-dir", str(RAW),
        "--manifest-path", str(RAW / f"{tag_run}.manifest.json"),
    ]
    if allow_plugged:
        launch_args.append("--allow-plugged")
    launch_args += ["--", *workload]
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    env["MSYS2_ARG_CONV_EXCL"] = "*"
    stdout_path = RAW / f"{tag_run}.launcher.stdout.log"
    stderr_path = RAW / f"{tag_run}.launcher.stderr.log"
    with stdout_path.open("w", encoding="utf-8", newline="\n") as stdout_handle, stderr_path.open("w", encoding="utf-8", newline="\n") as stderr_handle:
        process = subprocess.Popen(launch_args, cwd=ROOT, env=env, stdout=stdout_handle, stderr=stderr_handle, text=True)
        monitor = monitor_guarded_process(process, tag_run, 1)
    append_log(f"{tag_run} launcher completed process_rc={monitor['process_rc']} binary_pid={monitor['binary_pid']} sampler_pid={monitor['sampler_pid']}")

    remote_files = {
        "csv": (f"{OUT_REMOTE}/{tag_run}.csv", f"{tag_run}.csv"),
        "iotrace": (f"{OUT_REMOTE}/{tag_run}_iotrace.txt", f"{tag_run}.iotrace.txt"),
        "sampler": (str(monitor["sampler_remote"]), f"{tag_run}.sampler.csv"),
        "pid": (f"{GUARD_REMOTE_DIR}/{tag_run}.pid", f"{tag_run}.pid"),
        "guard_pid": (f"{GUARD_REMOTE_DIR}/{tag_run}.guard.pid", f"{tag_run}.guard.pid"),
        "guard_ready": (f"{GUARD_REMOTE_DIR}/{tag_run}.guard.ready", f"{tag_run}.guard.ready"),
        "guard_tracking": (f"{GUARD_REMOTE_DIR}/{tag_run}.guard.tracking", f"{tag_run}.guard.tracking"),
        "workload_rc": (f"{GUARD_REMOTE_DIR}/{tag_run}.workload.rc", f"{tag_run}.workload.rc"),
        "guard_rc": (f"{GUARD_REMOTE_DIR}/{tag_run}.guard.rc", f"{tag_run}.guard.rc"),
        "supervisor_failure": (f"{GUARD_REMOTE_DIR}/{tag_run}.supervisor.failure", f"{tag_run}.supervisor.failure"),
    }
    pulled = {key: pull_remote(remote, local_name) for key, (remote, local_name) in remote_files.items()}
    post = snapshot("post", tag_run)
    post_mem = meminfo("post", tag_run)
    thermal_zones("post", tag_run)
    launcher_manifest = {}
    manifest_path = RAW / f"{tag_run}.manifest.json"
    if manifest_path.exists():
        try:
            launcher_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            launcher_manifest = {}
    stdout_text = (RAW / f"{tag_run}.stdout.jsonl").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag_run}.stdout.jsonl").exists() else ""
    stderr_text = (RAW / f"{tag_run}.stderr.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag_run}.stderr.log").exists() else ""
    signature = exact_marker(stderr_text + "\n" + stdout_text)
    record = {
        "tag": tag_run,
        "base_tag": tag,
        "retry": retry,
        "cache_mb": cache_mb,
        "prompt_file": prompt_file,
        "decode_n": decode_n,
        "cache_ceil_mb": cache_ceil_mb,
        "reps": 1,
        "command_verbatim": command_text,
        "workload_argv": workload,
        "launcher_argv": launch_args,
        "battery_pre": pre,
        "battery_post": post,
        "mem_pre": pre_mem,
        "mem_post": post_mem,
        "monitor": monitor,
        "launcher_manifest": f"raw/{tag_run}.manifest.json",
        "launcher_rc": monitor["process_rc"],
        "workload_rc": launcher_manifest.get("workload_rc"),
        "guard_rc": launcher_manifest.get("guard_exit_code"),
        "guard_outcome": launcher_manifest.get("guard_outcome"),
        "failure_signature": signature,
        "pulled": pulled,
        "timestamp_start": pre.get("timestamp"),
        "timestamp_end": post.get("timestamp"),
    }
    with (CELL / "run_records.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, separators=(",", ":")) + "\n")
    write_raw(f"{tag_run}.record.json", json.dumps(record, indent=2) + "\n")
    return record


def should_retry_load(record: dict[str, object]) -> bool:
    if record.get("failure_signature"):
        return False
    if record.get("guard_rc") in (2, 3):
        return False
    if record.get("workload_rc") == 1:
        manifest_path = RAW / f"{record['tag']}.manifest.json"
        text = manifest_path.read_text(encoding="utf-8", errors="replace") if manifest_path.exists() else ""
        stderr_path = RAW / f"{record['tag']}.stderr.log"
        if stderr_path.exists():
            text += stderr_path.read_text(encoding="utf-8", errors="replace")
        load_markers = (
            "failed to load model",
            "error loading model",
            "model load failed",
            "cannot open model",
            "unable to load model",
        )
        return any(marker in text.lower() for marker in load_markers)
    return False


def stop_reason(record: dict[str, object]) -> str:
    monitor = record.get("monitor", {})
    if isinstance(monitor, dict) and monitor.get("monitor_error"):
        return f"adb transport/monitor failure: {monitor['monitor_error']}"
    if isinstance(monitor, dict) and monitor.get("cpuset_violation"):
        return "cpuset gate failure (Cpus_allowed_list != 0-7), exit-code-93-style condition"
    if record.get("failure_signature"):
        return f"exact stop marker: {record['failure_signature']}"
    if isinstance(record.get("workload_rc"), int) and int(record["workload_rc"]) >= 128 and record.get("guard_rc") not in (2, 3):
        return f"workload rc={record['workload_rc']}"
    if record.get("guard_rc") in (2, 3):
        return f"guard rc={record['guard_rc']} outcome={record.get('guard_outcome')}"
    if record.get("launcher_rc") not in (0, None):
        return f"launcher rc={record['launcher_rc']}"
    if record.get("workload_rc") not in (0, None):
        return f"workload rc={record['workload_rc']}"
    return ""


def _json_number(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"\d+", value.strip()):
        return int(value.strip())
    return None


def prompt_token_count(tag: str) -> tuple[int | None, str]:
    """Prefer an explicit engine count; otherwise count phase-0 CSV rows."""
    stdout_path = RAW / f"{tag}.stdout.jsonl"
    stdout = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.exists() else ""
    explicit_keys = {
        "prompt_tokens", "prompt_token_count", "n_prompt", "n_prompt_tokens",
        "nprompt", "nprompt_tokens", "prompt_count",
    }
    for line in stdout.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            for key, item in value.items():
                key_norm = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if key_norm in {re.sub(r"[^a-z0-9]", "", key) for key in explicit_keys}:
                    number = _json_number(item)
                    if number is not None:
                        return number, f"--progress JSON field {key}"
        match = re.search(r"(?:prompt[ _-]*tokens?|n[ _-]*prompt(?:[ _-]*tokens?)?)\D+(\d+)", line, re.I)
        if match:
            return int(match.group(1)), "printed prompt-token figure"

    csv_path = RAW / f"{tag}.csv"
    if csv_path.exists() and csv_path.stat().st_size:
        csv_text = csv_path.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"\bn_prompt=(\d+)\b", csv_text)
        if match:
            return int(match.group(1)), "CSV summary n_prompt field"
        with csv_path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            rows = list(csv.DictReader(handle))
        if rows:
            keys = [key for key in rows[0] if key]
            phase_key = next((key for key in keys if key.lower().strip() in {"phase", "phase_id", "stage", "kind", "type"}), None)
            if phase_key:
                values = [str(row.get(phase_key, "")).strip().lower() for row in rows]
                phase0 = [row for row, value in zip(rows, values) if value in {"0", "phase-0", "phase0", "prompt", "prefill", "pp"}]
                if phase0:
                    return len(phase0), f"--csv phase-0 row count ({phase_key})"
            # Some shipped builds label phase-0 as op=prompt/prefill.
            op_key = next((key for key in keys if key.lower().strip() in {"op", "event", "name"}), None)
            if op_key:
                phase0 = [row for row in rows if str(row.get(op_key, "")).strip().lower() in {"prompt", "prefill", "phase-0", "phase0"}]
                if phase0:
                    return len(phase0), f"--csv phase-0 row count ({op_key})"
    return None, "no engine prompt-token count found"


def write_calibration_summary(tag: str, count: int | None, source: str) -> None:
    summary = {"tag": tag, "prompt_tokens": count, "source": source, "measurement": False}
    write_raw(f"{tag}.calibration.json", json.dumps(summary, indent=2) + "\n")
    append_log(f"CALIB {tag} prompt_tokens={count} source={source}; numbers discarded")


def gate_before(tag: str, min_battery: int) -> dict[str, object]:
    """Enforce battery, unplugged, and <=32 C before an invocation."""
    while True:
        value = snapshot("gate", tag)
        level = value.get("level")
        temp = value.get("temperature_tenths")
        plugged = any(value.get(key) is True for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
        append_log(f"GATE {tag} level={level} temp_tenths={temp} plugged={plugged} required_battery>={min_battery}")
        if level is None or int(level) < min_battery:
            raise RuntimeError(f"battery gate failed before {tag}: level={level} required>={min_battery}")
        if plugged:
            raise RuntimeError(f"unplug gate failed before {tag}")
        if temp is None:
            raise RuntimeError(f"temperature unavailable before {tag}")
        if int(temp) <= 320:
            return value
        set_status(f"WAIT_TEMP {tag} {temp}")
        append_log(f"WAIT_TEMP {tag} temp_tenths={temp}; waiting 30s")
        time.sleep(30)


def cooldown_60(tag: str) -> None:
    append_log(f"COOLDOWN {tag} begin; required gap=60s")
    for _ in range(60):
        time.sleep(1)
    append_log(f"COOLDOWN {tag} complete")


def run_invocations(
    arm: str,
    cache_mb: int,
    prompt_file: str,
    decode_n: int,
    count: int,
    min_battery: int,
    allow_plugged: bool,
    n_ctx: int = 512,
) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for index in range(1, count + 1):
        if index > 1:
            cooldown_60(f"{arm}_inv{index - 1}_to_inv{index}")
        tag = f"{arm}_inv{index}"
        gate_before(tag, min_battery)
        set_status(f"RUN {arm} inv {index}")
        record = run_arm(tag, cache_mb, prompt_file, decode_n, min_battery, allow_plugged, n_ctx=n_ctx)
        records.append(record)
        reason = stop_reason(record)
        if reason and should_retry_load(record):
            append_log(f"{tag} diagnosed rc=1 model-load failure; retrying once with identical flags")
            retry = run_arm(tag, cache_mb, prompt_file, decode_n, min_battery, allow_plugged, retry=1, n_ctx=n_ctx)
            records.append(retry)
            reason = stop_reason(retry)
        if reason:
            raise RuntimeError(f"{tag}: {reason}")
        after = snapshot("between", tag)
        if after.get("level") is None or int(after["level"]) < min_battery:
            raise RuntimeError(f"battery below {min_battery}% after {tag}: {after.get('level')}")
    return records


def read_decode_mode() -> int:
    path = RAW / "decode_mode.json"
    if not path.exists():
        raise RuntimeError("missing existing decode_mode.json")
    value = json.loads(path.read_text(encoding="utf-8"))
    decode_n = int(value.get("decode_n", -1))
    if decode_n != 1:
        raise RuntimeError(f"existing decode mode is not the required n=1 fallback: {decode_n}")
    return decode_n


def prepare_optional_prompt() -> Path:
    source = CELL / "prompts" / "q62_pp512.txt"
    if not source.exists():
        raise RuntimeError(f"missing source prompt file: {source}")
    base = source.read_text(encoding="ascii")
    path = CELL / "prompts" / "q62_p2048.txt"
    if path.exists():
        append_log(f"optional prompt candidate preserved for resume path={path.name} bytes={path.stat().st_size}")
        return path
    prompt = (base.rstrip() + "\n\n") * 4
    path.write_text(prompt, encoding="ascii", newline="\n")
    append_log(f"optional prompt candidate created path={path.name} bytes={path.stat().st_size}; calibration target <=2047 tokens with n=1,n_ctx=2048")
    return path


def adjust_optional_prompt(path: Path, count: int) -> None:
    base = (CELL / "prompts" / "q62_pp512.txt").read_text(encoding="ascii").rstrip()
    text = path.read_text(encoding="ascii")
    if count > 2047:
        new_length = max(1, int(len(text) * 2040 / count))
        text = text[:new_length].rstrip() + "\n"
    else:
        text = text.rstrip() + "\n\n" + base[:400] + "\n"
    path.write_text(text, encoding="ascii", newline="\n")
    append_log(f"optional prompt adjusted after engine_count={count}; bytes={path.stat().st_size}")


def calibrate_optional_prompt(path: Path) -> int:
    last_count: int | None = None
    start_index = 1
    failed_calib2 = RAW / "optional_p2048_calib2.manifest.json"
    if (RAW / "optional_p2048_calib1.calibration.json").exists() and failed_calib2.exists():
        failure_text = failed_calib2.read_text(encoding="utf-8", errors="replace") + "\n"
        failure_text += (RAW / "optional_p2048_calib2.stderr.log").read_text(encoding="utf-8", errors="replace") if (RAW / "optional_p2048_calib2.stderr.log").exists() else ""
        if "prompt + n_predict exceeds the session n_ctx (2048)" in failure_text:
            text = path.read_text(encoding="ascii")
            path.write_text(text[:max(1, int(len(text) * 0.99))].rstrip() + "\n", encoding="ascii", newline="\n")
            append_log(f"optional p2048 resume: calib2 n_ctx rejection; trimmed candidate 1%; remaining calibration load=3 bytes={path.stat().st_size}")
            start_index = 3
    for index in range(start_index, 4):
        tag = f"optional_p2048_calib{index}"
        push_prompt(path, tag=f"q62_p2048_calib{index}")
        dry_prompt_echo(path.name, raw_tag=f"q62_p2048_calib{index}")
        gate_before(tag, 40)
        set_status(f"CALIB optional p2048 {index}")
        record = run_arm(tag, 0, path.name, 1, 40, False, n_ctx=2048)
        reason = stop_reason(record)
        if reason:
            raise RuntimeError(f"{tag}: {reason}")
        count, source = prompt_token_count(tag)
        write_calibration_summary(tag, count, source)
        last_count = count
        if count is not None and 2016 <= count <= 2047:
            append_log(f"CALIB optional p2048 accepted prompt_tokens={count} source={source}; calibration numbers discarded")
            return count
        if count is None:
            raise RuntimeError(f"{tag}: engine prompt-token count unavailable")
        if index < 3:
            adjust_optional_prompt(path, count)
    raise RuntimeError(f"optional p2048 calibration did not reach 2016..2047; last_count={last_count}")


def followup_main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    set_status("PREP SECONDARY")
    append_log("Secondary follow-up start; Amendment 1; owner GO; primary records preserved")
    try:
        verify_existing_device()
        prompt_path = CELL / "prompts" / "q62_pp512.txt"
        prompt_meta = push_prompt(prompt_path, tag="q62_pp512_secondary")
        dry_prompt_echo(prompt_path.name, raw_tag="q62_pp512_secondary")
        decode_n = read_decode_mode()
        append_log(f"secondary uses existing decode fallback n={decode_n}; no n0 probe repeated")
        secondary_manifest = RAW / "secondary_inv3.manifest.json"
        secondary_complete = False
        if secondary_manifest.exists():
            try:
                secondary_value = json.loads(secondary_manifest.read_text(encoding="utf-8"))
                secondary_complete = secondary_value.get("workload_rc") == 0 and secondary_value.get("guard_exit_code") == 0
            except json.JSONDecodeError:
                secondary_complete = False
        if secondary_complete:
            append_log("secondary arm already complete in prior follow-up; preserving 3 existing invocations")
        else:
            run_invocations("secondary", 2000, prompt_path.name, decode_n, 3, 40, False, n_ctx=512)
            append_log("secondary arm complete: 3 separate invocations; cache_mb=2000")
        set_status("DONE_SECONDARY")

        optional_path = prepare_optional_prompt()
        optional_meta = push_prompt(optional_path, tag="q62_p2048")
        dry_prompt_echo(optional_path.name, raw_tag="q62_p2048")
        optional_count = calibrate_optional_prompt(optional_path)
        append_log(f"optional p2048 calibration complete prompt_tokens={optional_count}; final prompt sha256={optional_meta['sha256']} is superseded by calibrated push")
        gate_before("optional_p2048", 40)
        set_status("RUN optional p2048")
        record = run_arm("optional_p2048", 0, optional_path.name, 1, 40, False, n_ctx=2048)
        reason = stop_reason(record)
        if reason and should_retry_load(record):
            append_log("optional_p2048 diagnosed rc=1 model-load failure; retrying once with identical flags")
            record = run_arm("optional_p2048", 0, optional_path.name, 1, 40, False, retry=1, n_ctx=2048)
            reason = stop_reason(record)
        if reason:
            raise RuntimeError(f"optional_p2048: {reason}")
        after = snapshot("between", "optional_p2048")
        if after.get("level") is None or int(after["level"]) < 40:
            raise RuntimeError(f"battery below 40% after optional_p2048: {after.get('level')}")
        append_log("optional p2048 arm complete: 1 invocation; cache_mb=0")
        set_status("DONE_OPTIONAL")
        return 0
    except Exception as exc:
        append_log(f"STOPPED exception={type(exc).__name__}: {exc}")
        set_status(f"STOPPED {type(exc).__name__}: {exc}")
        return 2


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    set_status("PREP ATTEMPT 2")
    append_log("Attempt 2 start; Amendment 1; owner hurry; serial fixed to Xiaomi only")
    try:
        verify_existing_device()
        prompt_path = CELL / "prompts" / "q62_pp512.txt"
        if not prompt_path.exists():
            raise RuntimeError(f"missing prompt file: {prompt_path}")
        prompt_meta = push_prompt(prompt_path)
        dry_prompt_echo(prompt_path.name)
        start_gate = gate_before("attempt2_calib", 45)
        write_raw(
            "attempt2_prep_summary.json",
            json.dumps(
                {
                    "attempt": "Attempt 2",
                    "prompt": prompt_meta,
                    "start_gate": start_gate,
                    "drop_caches": "not retried; Attempt 1 recorded permission denied",
                },
                indent=2,
            )
            + "\n",
        )
        append_log("deviation: drop_caches was denied in Attempt 1; not retried per owner instruction")

        append_log("owner-directed resume: calibration cap already used; trimmed prompt before n0 probe; primary only")
        set_status("RUN n0 probe")
        probe = run_arm("n0_probe", 0, prompt_path.name, 0, 45, False)
        probe_reason = stop_reason(probe)
        if probe_reason and probe.get("failure_signature"):
            raise RuntimeError(f"n0_probe: {probe_reason}")
        probe_csv = RAW / "n0_probe.csv"
        probe_stdout = RAW / "n0_probe.stdout.jsonl"
        probe_telemetry = (probe_csv.exists() and probe_csv.stat().st_size > 0) or (probe_stdout.exists() and probe_stdout.stat().st_size > 0)
        if probe_reason or not probe_telemetry:
            decode_n = 1
            append_log(f"n0 probe fallback: reason={probe_reason or 'no telemetry'}; using n=1 and excluding single decode row")
        else:
            decode_n = 0
            append_log("n0 probe accepted: telemetry present; primary/secondary use n=0")
        write_raw("decode_mode.json", json.dumps({"n0_probe": not bool(probe_reason) and probe_telemetry, "decode_n": decode_n, "exclude_decode_row": decode_n == 1}, indent=2) + "\n")

        run_invocations("primary", 0, prompt_path.name, decode_n, 3, 45, False)
        append_log("primary arm complete: 3 separate invocations")
        append_log("SECONDARY and optional p2048 not run; owner directed separate session")
        set_status("DONE_PRIMARY")
        append_log("DONE_PRIMARY primary complete; finalize_q62.py remains deterministic post-processing")
        return 0
    except Exception as exc:
        append_log(f"STOPPED exception={type(exc).__name__}: {exc}")
        set_status(f"STOPPED {type(exc).__name__}: {exc}")
        return 2


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--followup":
        raise SystemExit(followup_main())
    raise SystemExit(main())
