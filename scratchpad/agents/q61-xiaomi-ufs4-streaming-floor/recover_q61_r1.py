from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q61-xiaomi-ufs4-streaming-floor"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
TAG = "q61_borderline_marco_n512_r1"
MODEL = "/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf"


def run(args: list[str], timeout: float = 60.0) -> str:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    result = subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)
    text = result.stdout + result.stderr
    if result.returncode != 0:
        raise RuntimeError(text.strip())
    return text


def shell(command: str, timeout: float = 60.0) -> str:
    return run(["shell", command], timeout)


def main() -> None:
    remote_csv = f"/data/local/tmp/q61_stream_sampler/{TAG}.sampler.csv"
    local_csv = RAW / f"{TAG}.sampler.csv"
    run(["pull", remote_csv, str(local_csv)], timeout=180.0)
    post = shell("dumpsys battery")
    (RAW / f"{TAG}.battery.post.txt").write_text(post, encoding="utf-8", newline="\n")
    manifest = json.loads((RAW / f"{TAG}.manifest.json").read_text(encoding="utf-8"))
    stdout_lines = (RAW / f"{TAG}.stdout.jsonl").read_text(encoding="utf-8", errors="replace").splitlines()
    result_row = {}
    for line in stdout_lines:
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if candidate.get("n_prompt") == 512:
            result_row = candidate
            break
    timeline = (RAW / f"{TAG}.stderr.timeline.log").read_text(encoding="utf-8", errors="replace")
    markers: dict[str, float] = {}
    for line in timeline.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        if "benchmark " in parts[2] and "starting" in parts[2] and "load_start" not in markers:
            markers["load_start"] = float(parts[0])
        if "prompt run" in parts[2] and "eval_start" not in markers:
            markers["eval_start"] = float(parts[0])
    def integer(key: str) -> int | None:
        match = re.search(rf"^  {re.escape(key)}:\s*(-?\d+)", post, re.MULTILINE)
        return int(match.group(1)) if match else None
    cooldown = []
    cooldown_path = RAW / f"{TAG}.cooldown.log"
    if cooldown_path.exists():
        for line in cooldown_path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                cooldown.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    eval_start = markers.get("eval_start")
    wall_s = (float(result_row["samples_ns"][0]) / 1_000_000_000.0) if result_row.get("samples_ns") else None
    record = {
        "tag": TAG,
        "model_class": "secondary_borderline_model_lt_memtotal",
        "model_path": MODEL,
        "model_sha256_before_idle": "bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419",
        "n_prompt": 512,
        "rep": 1,
        "cache_class": "cold-designated",
        "idle_before_s_requested": 600.0,
        "cooldown_samples": cooldown,
        "battery_pre": manifest.get("battery_start", {}),
        "battery_post": {"level": integer("level"), "temperature_tenths": integer("temperature"), "voltage_mv": integer("voltage"), "ac_powered": False, "usb_powered": False, "wireless_powered": False},
        "launcher_rc": manifest.get("launcher_exit_code"),
        "launcher_elapsed_s": wall_s or manifest.get("wall_seconds_until_poll_end"),
        "launch_started_host_epoch": markers.get("load_start"),
        "launch_finished_host_epoch": (eval_start + wall_s) if eval_start is not None and wall_s is not None else None,
        "binary_pid": manifest.get("binary_pid"),
        "sampler_pid": None,
        "remote_sampler_csv": remote_csv,
        "sampler_csv": f"raw/{TAG}.sampler.csv",
        "workload": manifest.get("workload", []),
        "stderr_timeline": f"raw/{TAG}.stderr.timeline.log",
        "stderr_markers_host_epoch": markers,
        "guard_manifest": f"raw/{TAG}.manifest.json",
        "guard_rc": manifest.get("guard_exit_code"),
        "guard_outcome": manifest.get("guard_outcome"),
        "workload_rc": manifest.get("workload_rc"),
        "workload_failure_signature": manifest.get("workload_failure_signature", ""),
        "adb_disconnect": manifest.get("adb_disconnect", False),
        "execute_op_htp0": manifest.get("execute_op_htp0", False),
        "thermalservice_post": f"raw/{TAG}.thermalservice.post.txt",
    }
    (CELL / "run_records.json").write_text(json.dumps([record], indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
