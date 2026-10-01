from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q60-streaming-prefill-amdahl"
RAW = CELL / "raw"
Q56 = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "launch_with_guard.py"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "192.168.1.82:34037"
REMOTE_ROOT = "/data/local/tmp/q56_thermal_watchdog"
REMOTE_SAMPLER = "/data/local/tmp/q60_sampler_detach.sh"
REMOTE_CSV_ROOT = "/data/local/tmp/q60_sampler"
MODEL = "/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf"
BIN = "/data/local/tmp/llamabench/llama-bench"


def adb(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    result = subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)
    if result.returncode != 0:
        raise RuntimeError((result.stdout + result.stderr).strip())
    return result


_NR_ARGV: list[str] | None = None


def no_repack_argv() -> list[str]:
    global _NR_ARGV
    if _NR_ARGV is None:
        # Upstream b11304 renamed -nr to --repack <0|1>; ask the on-device binary which it speaks.
        out = adb(["shell", f"LD_LIBRARY_PATH=/data/local/tmp/llamabench {BIN} --help 2>&1 || true"])
        _NR_ARGV = ["--repack", "0"] if "--repack" in out.stdout + out.stderr else ["-nr", "1"]
    return _NR_ARGV


def heartbeat(stop: threading.Event) -> None:
    while not stop.wait(25.0):
        try:
            adb(["shell", "input", "keyevent", "224"], timeout=15.0)
        except Exception:
            pass


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: run_q60_one.py <n_prompt> <tag>")
    n_prompt = int(sys.argv[1])
    tag = re.sub(r"[^A-Za-z0-9_.-]", "_", sys.argv[2])
    RAW.mkdir(parents=True, exist_ok=True)
    launcher_stdout = RAW / f"{tag}.launcher.stdout.txt"
    launcher_stderr = RAW / f"{tag}.launcher.stderr.txt"
    remote_pid_file = f"{REMOTE_ROOT}/{tag}.pid"
    remote_csv = f"{REMOTE_CSV_ROOT}/{tag}.all.csv"

    cmd = [
        sys.executable,
        str(Q56),
        "--serial",
        SERIAL,
        "--tag",
        tag,
        "--warn-tenths",
        "400",
        "--kill-tenths",
        "430",
        "--sensor-failure-limit",
        "4",
        "--interval-s",
        "10",
        "--max-seconds",
        "900",
        "--local-dir",
        str(RAW),
        "--manifest-path",
        str(RAW / f"{tag}.manifest.json"),
        "--",
        "/system/bin/env",
        "LD_LIBRARY_PATH=/data/local/tmp/llamabench",
        BIN,
        "-m",
        MODEL,
        "-p",
        str(n_prompt),
        "-n",
        "0",
        "-r",
        "3",
        "--no-warmup",
        "-t",
        "8",
        "-o",
        "jsonl",
        "-ngl",
        "0",
        "-lm",
        "mmap",
        *no_repack_argv(),
    ]

    with launcher_stdout.open("w", encoding="utf-8", newline="\n") as out, launcher_stderr.open("w", encoding="utf-8", newline="\n") as err:
        process = subprocess.Popen(cmd, cwd=ROOT, stdout=out, stderr=err, text=True)
        stop = threading.Event()
        beat = threading.Thread(target=heartbeat, args=(stop,), daemon=True)
        beat.start()
        sampler_pid = None
        deadline = time.monotonic() + 120.0
        try:
            while time.monotonic() < deadline:
                try:
                    pid_text = adb(["shell", "cat", remote_pid_file], timeout=15.0).stdout
                except Exception:
                    pid_text = ""
                match = re.search(r"^BINARY_PID=(\d+)", pid_text, re.MULTILINE)
                if match:
                    binary_pid = int(match.group(1))
                    sample_result = adb(["shell", REMOTE_SAMPLER, str(binary_pid), remote_csv, "1"], timeout=15.0)
                    sampler_match = re.search(r"SAMPLER_PID=(\d+)", sample_result.stdout)
                    sampler_pid = int(sampler_match.group(1)) if sampler_match else None
                    (RAW / f"{tag}.sampler_start.txt").write_text(
                        f"binary_pid={binary_pid}\nsampler_pid={sampler_pid}\nremote_csv={remote_csv}\n",
                        encoding="utf-8",
                    )
                    break
                if process.poll() is not None:
                    break
                time.sleep(0.25)
            rc = process.wait()
        finally:
            stop.set()

    if sampler_pid is not None:
        settle_deadline = time.monotonic() + 15.0
        while time.monotonic() < settle_deadline:
            try:
                if adb(["shell", "kill", "-0", str(sampler_pid)], timeout=15.0).returncode != 0:
                    break
            except Exception:
                break
            time.sleep(0.5)
    try:
        adb(["pull", remote_csv, str(RAW / f"{tag}.all.csv")], timeout=120.0)
    except Exception as exc:
        (RAW / f"{tag}.sampler_pull_error.txt").write_text(str(exc) + "\n", encoding="utf-8")
    print(f"tag={tag} n_prompt={n_prompt} launcher_rc={rc} sampler_pid={sampler_pid}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

