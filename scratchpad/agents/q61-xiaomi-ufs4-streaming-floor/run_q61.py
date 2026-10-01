from __future__ import annotations

import csv
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
CELL = ROOT / "scratchpad" / "agents" / "q61-xiaomi-ufs4-streaming-floor"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
MODEL = "/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf"
BENCH = "/data/local/tmp/kalsa16/llama-bench"
BENCH_LD = "/data/local/tmp/kalsa16"
REMOTE_GUARD = "/data/local/tmp/q56_thermal_watchdog"
REMOTE_SAMPLER = "/data/local/tmp/q61_sampler.sh"
REMOTE_SAMPLER_DIR = "/data/local/tmp/q61_stream_sampler"
LAUNCHER = CELL / "launch_q61.py"
RUN_PREFIX = "q61_borderline_marco"
THREADS = 8
HZ = 100


class DeviceDrop(RuntimeError):
    pass


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def is_transport_error(text: str) -> bool:
    low = text.lower()
    return any(marker in low for marker in ("device offline", "no devices/emulators found", "failed to get feature set", "cannot connect", "connection refused", "closed", "not found"))


def adb(args: list[str], timeout: float = 30.0, allow_nonzero: bool = False) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        result = subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeviceDrop(str(exc)) from exc
    text = result.stdout + result.stderr
    if result.returncode != 0 and (not allow_nonzero or is_transport_error(text)):
        raise DeviceDrop(f"adb rc={result.returncode}: {text.strip()}")
    if result.returncode != 0 and not allow_nonzero:
        raise RuntimeError(f"adb rc={result.returncode}: {text.strip()}")
    return result


def shell(command: str, timeout: float = 30.0, allow_nonzero: bool = False) -> subprocess.CompletedProcess[str]:
    return adb(["shell", command], timeout=timeout, allow_nonzero=allow_nonzero)


_NR_ARGV: list[str] | None = None


def no_repack_argv() -> list[str]:
    global _NR_ARGV
    if _NR_ARGV is None:
        # Upstream b11304 renamed -nr to --repack <0|1>; ask the on-device binary which it speaks.
        out = shell(f"LD_LIBRARY_PATH={BENCH_LD} {BENCH} --help 2>&1 || true", allow_nonzero=True)
        _NR_ARGV = ["--repack", "0"] if "--repack" in out.stdout + out.stderr else ["-nr"]
    return _NR_ARGV


def check_state() -> None:
    result = adb(["get-state"], timeout=15.0)
    if result.stdout.strip() != "device":
        raise DeviceDrop(f"unexpected Xiaomi adb state: {result.stdout.strip()!r}")


def snapshot() -> dict[str, int | bool | None]:
    check_state()
    result = shell("dumpsys battery", timeout=15.0)
    text = result.stdout + result.stderr

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


def remote_cat(path: str, allow_missing: bool = False) -> str:
    result = shell(f"cat {shlex.quote(path)}", timeout=15.0, allow_nonzero=allow_missing)
    return result.stdout if result.returncode == 0 else ""


def write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8", newline="\n")


def append_state(message: str) -> None:
    path = CELL / "RUN_LOG.md"
    existing = path.read_text(encoding="utf-8", errors="replace") if path.exists() else "# q61 RUN_LOG\n"
    if not existing.endswith("\n"):
        existing += "\n"
    path.write_text(existing + f"\nstate_event={utc_now()} {message}\n", encoding="utf-8", newline="\n")


def cooldown(tag: str, not_before: float) -> tuple[dict[str, object], list[dict[str, object]]]:
    rows: list[dict[str, object]] = []
    while True:
        snap = snapshot()
        plugged = any(snap.get(key) is True for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
        row = {"utc": utc_now(), **snap, "plugged": plugged}
        rows.append(row)
        write_jsonl(RAW / f"{tag}.cooldown.log", rows)
        level = snap.get("level")
        temp = snap.get("temperature_tenths")
        print(f"{tag} cool-poll level={level} temp={None if temp is None else float(temp) / 10:.1f}C plugged={plugged} idle_ready={time.monotonic() >= not_before}", flush=True)
        if level is None or temp is None:
            raise RuntimeError(f"{tag}: missing battery level/temperature")
        if int(level) < 45:
            raise RuntimeError(f"{tag}: battery floor crossed ({level}%)")
        if int(temp) <= 320 and not plugged and time.monotonic() >= not_before:
            return {**snap, "plugged": plugged}, rows
        time.sleep(60.0)


def model_hash(tag: str) -> tuple[str, float]:
    check_state()
    result = shell(f"sha256sum {shlex.quote(MODEL)}", timeout=180.0)
    text = result.stdout + result.stderr
    (RAW / f"{tag}.model.sha256sum.txt").write_text(text, encoding="utf-8", newline="\n")
    match = re.search(r"^([0-9a-fA-F]{64})\s+", text, re.MULTILINE)
    if not match:
        raise RuntimeError(f"{tag}: model sha256sum missing")
    return match.group(1).lower(), time.monotonic()


def launch_sampler(pid: int, remote_csv: str) -> int:
    command = f"mkdir -p {shlex.quote(REMOTE_SAMPLER_DIR)}; nohup {shlex.quote(REMOTE_SAMPLER)} {pid} {shlex.quote(remote_csv)} 1 </dev/null >/dev/null 2>&1 & echo SAMPLER_PID=$!"
    result = shell(command, timeout=20.0)
    match = re.search(r"SAMPLER_PID=(\d+)", result.stdout)
    if not match:
        raise RuntimeError("sampler PID was not published")
    return int(match.group(1))


def wait_sampler_exit(pid: int | None) -> None:
    if pid is None:
        return
    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        result = shell(f"kill -0 {pid}", timeout=10.0, allow_nonzero=True)
        if result.returncode != 0:
            return
        time.sleep(0.5)


def timestamp_stderr(tag: str, remote_stderr: str, seen: set[str], markers: dict[str, float]) -> None:
    text = remote_cat(remote_stderr, allow_missing=True)
    if not text:
        return
    path = RAW / f"{tag}.stderr.timeline.log"
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for line in text.splitlines():
            if line in seen:
                continue
            seen.add(line)
            epoch = time.time()
            handle.write(f"{epoch:.6f}\t{utc_now()}\t{line}\n")
            if "benchmark " in line and "starting" in line and "load_start" not in markers:
                markers["load_start"] = epoch
            if "prompt run" in line and "eval_start" not in markers:
                markers["eval_start"] = epoch


def run_one(n_prompt: int, rep: int, idle_before_s: float) -> tuple[dict[str, object], bool]:
    tag = f"{RUN_PREFIX}_n{n_prompt}_r{rep}"
    remote_pid = f"{REMOTE_GUARD}/{tag}.pid"
    remote_csv = f"{REMOTE_SAMPLER_DIR}/{tag}.sampler.csv"
    if rep == 1:
        sha, touched = model_hash(tag)
        not_before = touched + idle_before_s
    else:
        sha = ""
        not_before = time.monotonic()
    pre, cooldown_rows = cooldown(tag, not_before)
    workload = [
        "/system/bin/env", f"LD_LIBRARY_PATH={BENCH_LD}", BENCH,
        "-m", MODEL, "-p", str(n_prompt), "-n", "0", "-r", "1", "--no-warmup",
        "-t", "8", "-o", "jsonl", "--progress", "-ngl", "0", "-mmp", "1", *no_repack_argv(),
    ]
    command = [
        sys.executable, str(LAUNCHER), "--serial", SERIAL, "--tag", tag,
        "--warn-tenths", "400", "--kill-tenths", "430", "--session-hard-cap-tenths", "0",
        "--sensor-failure-limit", "4", "--interval-s", "1", "--max-seconds", "1800",
        "--local-dir", str(RAW), "--manifest-path", str(RAW / f"{tag}.manifest.json"), "--", *workload,
    ]
    (RAW / f"{tag}.workload.args.txt").write_text(" ".join(shlex.quote(item) for item in workload) + "\n", encoding="utf-8", newline="\n")
    stdout_path = RAW / f"{tag}.launcher.stdout.log"
    stderr_path = RAW / f"{tag}.launcher.stderr.log"
    seen: set[str] = set()
    markers: dict[str, float] = {}
    sampler_pid: int | None = None
    binary_pid: int | None = None
    launch_started = time.time()
    stdout_handle = stdout_path.open("w", encoding="utf-8", newline="\n")
    stderr_handle = stderr_path.open("w", encoding="utf-8", newline="\n")
    process = subprocess.Popen(command, cwd=ROOT, env={**os.environ, "MSYS_NO_PATHCONV": "1"}, stdout=stdout_handle, stderr=stderr_handle, text=True)
    try:
        deadline = time.monotonic() + 180.0
        while time.monotonic() < deadline and process.poll() is None:
            check_state()
            pid_text = remote_cat(remote_pid, allow_missing=True)
            match = re.search(r"^BINARY_PID=(\d+)", pid_text, re.MULTILINE)
            if match:
                binary_pid = int(match.group(1))
                sampler_pid = launch_sampler(binary_pid, remote_csv)
                break
            time.sleep(0.5)
        while process.poll() is None:
            check_state()
            timestamp_stderr(tag, f"{REMOTE_GUARD}/{tag}.stderr.log", seen, markers)
            time.sleep(1.0)
        launcher_rc = process.wait()
        timestamp_stderr(tag, f"{REMOTE_GUARD}/{tag}.stderr.log", seen, markers)
    except DeviceDrop as exc:
        append_state(f"ADB_DROP tag={tag} detail={exc}")
        try:
            process.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            pass
        raise
    finally:
        stdout_handle.close()
        stderr_handle.close()

    wait_sampler_exit(sampler_pid)
    local_csv = RAW / f"{tag}.sampler.csv"
    try:
        adb(["pull", remote_csv, str(local_csv)], timeout=180.0)
    except DeviceDrop:
        append_state(f"ADB_DROP during sampler pull tag={tag}")
        raise
    post = snapshot()
    try:
        thermal = shell("dumpsys thermalservice", timeout=30.0).stdout
    except Exception as exc:
        thermal = f"capture_error={exc}\n"
    (RAW / f"{tag}.thermalservice.post.txt").write_text(thermal, encoding="utf-8", newline="\n")
    launcher_manifest_path = RAW / f"{tag}.manifest.json"
    manifest = json.loads(launcher_manifest_path.read_text(encoding="utf-8")) if launcher_manifest_path.exists() else {}
    launch_finished = time.time()
    record = {
        "tag": tag,
        "model_class": "secondary_borderline_model_lt_memtotal",
        "model_path": MODEL,
        "model_sha256_before_idle": sha,
        "n_prompt": n_prompt,
        "rep": rep,
        "cache_class": "cold-designated" if rep == 1 else "warm",
        "idle_before_s_requested": idle_before_s,
        "cooldown_samples": cooldown_rows,
        "battery_pre": pre,
        "battery_post": post,
        "launcher_rc": launcher_rc,
        "launcher_elapsed_s": round(time.time() - launch_started, 3),
        "launch_started_host_epoch": launch_started,
        "launch_finished_host_epoch": launch_finished,
        "binary_pid": binary_pid,
        "sampler_pid": sampler_pid,
        "remote_sampler_csv": remote_csv,
        "sampler_csv": f"raw/{tag}.sampler.csv",
        "workload": workload,
        "stderr_timeline": f"raw/{tag}.stderr.timeline.log",
        "stderr_markers_host_epoch": markers,
        "guard_manifest": f"raw/{tag}.manifest.json",
        "guard_rc": manifest.get("guard_exit_code"),
        "guard_outcome": manifest.get("guard_outcome"),
        "workload_rc": manifest.get("workload_rc"),
        "workload_failure_signature": manifest.get("workload_failure_signature", ""),
        "adb_disconnect": manifest.get("adb_disconnect", False),
        "execute_op_htp0": manifest.get("execute_op_htp0", False),
        "thermalservice_post": f"raw/{tag}.thermalservice.post.txt",
    }
    (RAW / f"{tag}.run.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"END {tag} launcher_rc={launcher_rc} guard_rc={record['guard_rc']} workload_rc={record['workload_rc']} max_temp={manifest.get('guard', {}).get('max_temperature_tenths') if isinstance(manifest.get('guard'), dict) else None}", flush=True)
    stop = bool(
        launcher_rc != 0
        or manifest.get("guard_exit_code") in (2, 3)
        or manifest.get("guard_outcome") not in ("normal", None)
        or manifest.get("workload_failure_signature")
        or (isinstance(manifest.get("workload_rc"), int) and int(manifest["workload_rc"]) >= 128 and manifest.get("guard_exit_code") not in (2, 3))
        or manifest.get("adb_disconnect")
        or manifest.get("execute_op_htp0")
    )
    return record, stop


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    check_state()
    records_path = CELL / "run_records.json"
    all_records: list[dict[str, object]] = json.loads(records_path.read_text(encoding="utf-8")) if records_path.exists() else []
    completed = {str(record.get("tag")) for record in all_records}
    # q61 clarification: no PC model met the >=1.2x MemTotal gate; run only
    # the on-device Marco-B' secondary arm, explicitly labeled borderline.
    for n_prompt, reps in ((512, 3), (2048, 1), (128, 1)):
        for rep in range(1, reps + 1):
            tag = f"{RUN_PREFIX}_n{n_prompt}_r{rep}"
            if tag in completed:
                print(f"SKIP already recorded {tag}", flush=True)
                continue
            record, stop = run_one(n_prompt, rep, 600.0 if rep == 1 else 0.0)
            all_records.append(record)
            completed.add(str(record["tag"]))
            records_path.write_text(json.dumps(all_records, indent=2) + "\n", encoding="utf-8", newline="\n")
            if stop:
                append_state(f"STOP tag={record['tag']} launcher_rc={record['launcher_rc']} guard_rc={record['guard_rc']} workload_rc={record['workload_rc']} signature={record['workload_failure_signature']!r}")
                return 2
    append_state("q61 measured launches complete; no guard kill, crash signature, HTP0 execute-op, or adb drop")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
