from __future__ import annotations

import datetime as dt
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q60b-s23-streaming-floor"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
REMOTE_GUARD_ROOT = "/data/local/tmp/q56_thermal_watchdog"
REMOTE_SAMPLER_ROOT = "/data/local/tmp/q60b_s23_sampler"
MODEL = "/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf"
BENCH = "/data/local/tmp/s3oracle/llama-bench"
BENCH_LD_LIBRARY_PATH = "/data/local/tmp/s3oracle"
RUN_PREFIX = "q60b_final2"
LAUNCHER = CELL.parent / "q56-thermal-watchdog" / "launch_with_guard.py"
SAMPLER = (CELL.parent / "q60-streaming-prefill-amdahl" / "q60_sampler.sh").read_text(encoding="utf-8")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def adb(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    result = subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)
    if result.returncode != 0:
        raise RuntimeError(f"adb rc={result.returncode}: {(result.stdout + result.stderr).strip()}")
    return result


def battery_values(text: str) -> dict[str, int | bool | None]:
    def integer(key: str) -> int | None:
        match = re.search(rf"^  {re.escape(key)}:\s*(-?\d+)", text, re.MULTILINE)
        return int(match.group(1)) if match else None

    def boolean(key: str) -> bool | None:
        match = re.search(rf"^  {re.escape(key)}:\s*(true|false)", text, re.MULTILINE | re.IGNORECASE)
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
    }


def capture(tag: str, suffix: str, command: str, timeout: float = 30.0) -> tuple[str, dict[str, int | bool | None] | None]:
    result = adb(["shell", command], timeout=timeout)
    text = result.stdout + result.stderr
    (RAW / f"{tag}.{suffix}.txt").write_text(text, encoding="utf-8", newline="\n")
    return text, battery_values(text) if command == "dumpsys battery" else None


def cooldown(tag: str, not_before: float) -> tuple[str, dict[str, int | bool | None], float, list[dict[str, object]]]:
    samples: list[dict[str, object]] = []
    while True:
        text, snap = capture(tag, "battery.poll", "dumpsys battery", timeout=30.0)
        assert snap is not None
        plugged = any(bool(snap.get(key)) for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
        sample = {"time": now(), **snap, "plugged": plugged}
        samples.append(sample)
        (RAW / f"{tag}.cooldown.log").write_text(
            "".join(json.dumps(item, separators=(",", ":")) + "\n" for item in samples),
            encoding="utf-8",
            newline="\n",
        )
        level = snap.get("level")
        temp = snap.get("temperature_tenths")
        print(f"{tag} cool-poll level={level} temp={None if temp is None else temp / 10:.1f}C plugged={plugged}", flush=True)
        if level is None or temp is None:
            raise RuntimeError(f"{tag}: battery snapshot unavailable")
        if level < 45:
            raise RuntimeError(f"{tag}: battery below 45% ({level}%)")
        if level < 50:
            raise RuntimeError(f"{tag}: q56 launch guard requires >=50% ({level}%)")
        if temp <= 320 and not plugged and time.monotonic() >= not_before:
            pre_text, pre = capture(tag, "battery.pre", "dumpsys battery", timeout=30.0)
            assert pre is not None
            return pre_text, pre, time.monotonic(), samples
        time.sleep(60.0)


def launch_sampler(binary_pid: int, remote_csv: str) -> int | None:
    command = (
        f"mkdir -p {shlex.quote(REMOTE_SAMPLER_ROOT)}; "
        f"nohup sh -c {shlex.quote(SAMPLER)} q60b_sampler {binary_pid} {shlex.quote(remote_csv)} 1 "
        f"</dev/null >/dev/null 2>&1 & echo SAMPLER_PID=$!"
    )
    result = adb(["shell", command], timeout=20.0)
    match = re.search(r"SAMPLER_PID=(\d+)", result.stdout)
    return int(match.group(1)) if match else None


def wait_sampler_exit(sampler_pid: int | None) -> None:
    if sampler_pid is None:
        return
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        try:
            adb(["shell", "kill", "-0", str(sampler_pid)], timeout=15.0)
        except Exception:
            return
        time.sleep(0.5)


def run_one(n_prompt: int, rep: int, last_model_touch: float, idle_before_s: float) -> tuple[dict[str, object], float]:
    tag = f"{RUN_PREFIX}_n{n_prompt}_r{rep}"
    remote_pid_file = f"{REMOTE_GUARD_ROOT}/{tag}.pid"
    remote_csv = f"{REMOTE_SAMPLER_ROOT}/{tag}.sampler.csv"
    not_before = last_model_touch + idle_before_s
    pre_text, pre, gate_time, cooldown_samples = cooldown(tag, not_before)
    workload = [
        "/system/bin/env", f"LD_LIBRARY_PATH={BENCH_LD_LIBRARY_PATH}", BENCH,
        "-m", MODEL, "-p", str(n_prompt), "-n", "0", "-r", "1", "--no-warmup",
        "-t", "8", "-o", "jsonl", "-ngl", "0", "-mmp", "1", "-nr",
    ]
    command = [
        sys.executable, str(LAUNCHER), "--serial", SERIAL, "--tag", tag,
        "--warn-tenths", "400", "--kill-tenths", "430", "--session-hard-cap-tenths", "0",
        "--sensor-failure-limit", "4", "--interval-s", "1", "--max-seconds", "1800",
        "--local-dir", str(RAW), "--manifest-path", str(RAW / f"{tag}.manifest.json"), "--", *workload,
    ]
    (RAW / f"{tag}.workload.args.txt").write_text(
        " ".join(shlex.quote(item) for item in workload) + "\n", encoding="utf-8", newline="\n"
    )
    stdout_path = RAW / f"{tag}.launcher.stdout.log"
    stderr_path = RAW / f"{tag}.launcher.stderr.log"
    sampler_pid: int | None = None
    binary_pid: int | None = None
    sampler_error = ""
    started = time.monotonic()
    with stdout_path.open("w", encoding="utf-8", newline="\n") as stdout, stderr_path.open("w", encoding="utf-8", newline="\n") as stderr:
        process = subprocess.Popen(command, cwd=ROOT, env={**os.environ, "MSYS_NO_PATHCONV": "1"}, stdout=stdout, stderr=stderr, text=True)
        deadline = time.monotonic() + 150.0
        while time.monotonic() < deadline and process.poll() is None:
            try:
                pid_text = adb(["shell", "cat", remote_pid_file], timeout=15.0).stdout
            except Exception:
                pid_text = ""
            match = re.search(r"^BINARY_PID=(\d+)", pid_text, re.MULTILINE)
            if match:
                binary_pid = int(match.group(1))
                try:
                    sampler_pid = launch_sampler(binary_pid, remote_csv)
                    if sampler_pid is None:
                        sampler_error = "sampler pid was not published"
                except Exception as exc:
                    sampler_error = str(exc)
                break
            time.sleep(0.25)
        launcher_rc = process.wait()
    (RAW / f"{tag}.battery.pre.txt").write_text(pre_text, encoding="utf-8", newline="\n")
    wait_sampler_exit(sampler_pid)
    local_csv = RAW / f"{tag}.sampler.csv"
    pull_error = ""
    try:
        adb(["pull", remote_csv, str(local_csv)], timeout=120.0)
    except Exception as exc:
        pull_error = str(exc)
        (RAW / f"{tag}.sampler.pull_error.txt").write_text(pull_error + "\n", encoding="utf-8", newline="\n")
    try:
        post_text, post = capture(tag, "battery.post", "dumpsys battery", timeout=30.0)
    except Exception as exc:
        post_text, post = "", {"error": str(exc)}
    try:
        capture(tag, "thermalservice.post", "dumpsys thermalservice", timeout=30.0)
    except Exception:
        pass
    record: dict[str, object] = {
        "tag": tag,
        "n_prompt": n_prompt,
        "rep": rep,
        "cache_class": "cold-designated" if rep == 1 else "warm",
        "idle_before_s_requested": idle_before_s,
        "cooldown_samples": cooldown_samples,
        "gate_time_utc": now(),
        "battery_pre": pre,
        "battery_post": post,
        "binary_pid": binary_pid,
        "sampler_pid": sampler_pid,
        "remote_sampler_csv": remote_csv,
        "sampler_csv": f"raw/{tag}.sampler.csv",
        "launcher_rc": launcher_rc,
        "launcher_elapsed_s": round(time.monotonic() - started, 3),
        "sampler_error": sampler_error,
        "sampler_pull_error": pull_error,
        "workload": workload,
        "guard_invocation": "WARN 400 / KILL 430 / interval 1 s / sensor failure 4 / session cap disabled",
    }
    (RAW / f"{tag}.run.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"END {tag} rc={launcher_rc} sampler_pid={sampler_pid} pull_error={bool(pull_error)}", flush=True)
    return record, time.monotonic()


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    preflight_command = (
        "echo ===IDENTITY===; getprop ro.serialno; getprop ro.product.model; getprop ro.build.version.incremental; "
        "echo ===MEMINFO===; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; "
        "echo ===BATTERY===; dumpsys battery; echo ===DF===; df -k /data/local/tmp; "
        "echo ===PSI===; if [ -r /proc/pressure/io ]; then cat /proc/pressure/io; else echo UNREADABLE; fi"
    )
    try:
        (RAW / "preflight_device.txt").write_text(adb(["shell", preflight_command], timeout=60.0).stdout, encoding="utf-8", newline="\n")
    except Exception as exc:
        (RAW / "preflight_device_error.txt").write_text(str(exc) + "\n", encoding="utf-8", newline="\n")
    all_records: list[dict[str, object]] = []
    last_model_touch = time.monotonic() - 600.0
    for n_prompt in (128, 512, 2048):
        for rep in (1, 2, 3):
            idle_before_s = 600.0 if rep == 1 else 0.0
            record, last_model_touch = run_one(n_prompt, rep, last_model_touch, idle_before_s)
            all_records.append(record)
            (CELL / "run_records.json").write_text(json.dumps(all_records, indent=2) + "\n", encoding="utf-8", newline="\n")
            if record.get("launcher_rc") not in (0,):
                print(f"STOP after {record['tag']}: launcher_rc={record['launcher_rc']}", flush=True)
                return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
