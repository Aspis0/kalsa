from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "192.168.1.152:36269"
LAUNCHER = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "launch_with_guard.py"
GUARD = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "thermal_guard.sh"
MODEL = "/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf"
BENCH = "/data/local/tmp/kalsahtp/llama-bench"
SKEL_HEX = "/data/local/tmp/kalsahtp/libggml-hexagon.so"
SKEL_V73 = "/data/local/tmp/kalsahtp/libggml-htp-v73.so"
DEVICE_GUARD = "/data/local/tmp/q56_thermal_watchdog/thermal_guard.sh"
EXPECTED = {
    "thermal_guard_sha256": "f8b664194d7eae7d04ebb3bba8745769cbd79777796803d25eed7974e9bda84c",
    "launch_with_guard_sha256": "64ef5fb808b7bd2784555b54db3c395aecd1d85021e568c948d1f07b7f783b40",
    "llama_bench_sha256": "5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507",
    "libggml_hexagon_sha256": "f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448",
    "libggml_htp_v73_sha256": "c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5",
    "qwen_model_sha256": "298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb",
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def local_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def adb_bytes(args: list[str], timeout: float = 60.0) -> bytes:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    result = subprocess.run([ADB, "-s", SERIAL, *args], env=env, capture_output=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"adb rc={result.returncode}: {(result.stdout + result.stderr).decode(errors='replace')}")
    return result.stdout


def adb_text(args: list[str], timeout: float = 60.0) -> str:
    return adb_bytes(args, timeout).decode("utf-8", errors="replace")


def save_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


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


def capture(tag: str, suffix: str, command: str, timeout: float = 60.0) -> tuple[str, dict[str, int | bool | None] | None]:
    data = adb_bytes(["shell", command], timeout)
    save_bytes(RAW / f"{tag}.{suffix}.txt", data)
    text = data.decode("utf-8", errors="replace")
    return text, battery_values(text) if command == "dumpsys battery" else None


def pin_device() -> str:
    return adb_text(["shell", "sha256sum", DEVICE_GUARD, BENCH, SKEL_HEX, SKEL_V73, MODEL], timeout=180)


def pin_lines(text: str) -> dict[str, str]:
    return {line.split()[-1]: line.split()[0] for line in text.splitlines() if len(line.split()) >= 2}


def cool_gate(tag: str) -> tuple[str, dict[str, int | bool | None], list[str]]:
    log: list[str] = []
    while True:
        data = adb_bytes(["shell", "dumpsys battery"], timeout=30)
        text = data.decode("utf-8", errors="replace")
        snap = battery_values(text)
        line = json.dumps({"time": now(), **snap}, separators=(",", ":"))
        log.append(line)
        save_bytes(RAW / f"{tag}.cooldown.log", ("\n".join(log) + "\n").encode())
        level = snap.get("level")
        temp = snap.get("temperature_tenths")
        plugged = any(snap.get(key) for key in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
        print(f"{tag} cool-poll level={level} temp={None if temp is None else temp / 10:.1f}C plugged={plugged}", flush=True)
        if level is not None and level >= 45 and temp is not None and temp <= 320 and not plugged:
            return text, snap, log
        print(f"{tag} waiting 60s for cool-start/battery/unplugged gate", flush=True)
        time.sleep(60)


def parse_jsonl(path: Path) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    if not rows:
        return {"rows": 0}
    row = rows[-1]
    return {
        "rows": len(rows),
        "avg_ts": row.get("avg_ts"),
        "samples_ts": row.get("samples_ts"),
        "n_prompt": row.get("n_prompt"),
        "n_gen": row.get("n_gen"),
        "backends": row.get("backends"),
        "devices": row.get("devices"),
        "n_gpu_layers": row.get("n_gpu_layers"),
        "model_type": row.get("model_type"),
    }


def authorized_crash(text: str) -> str:
    for line in text.splitlines():
        if re.search(r"ggml_abort|ggml_assert|dspqueue|INTERNAL-ERROR|\bAborted\b|\bsegmentation\b", line, re.IGNORECASE):
            return line.strip()
        if re.search(r"\bCDSP\b", line):
            return line.strip()
    return ""


def run_one(n: int, engine: str, rep: int) -> dict[str, object]:
    tag = f"q58_n{n}_{engine.lower()}_{rep}"
    kill = 410 if engine == "NPU" else 430
    pre_text, pre, cooldown = cool_gate(tag)
    save_bytes(RAW / f"{tag}.battery.pre.txt", pre_text.encode("utf-8"))
    thermal_pre, _ = capture(tag, "thermalservice.pre", "dumpsys thermalservice", timeout=30)
    workload = [
        BENCH, "-m", MODEL, "-p", str(n), "-n", "0", "-r", "2", "--no-warmup",
        "-t", "8", "-fa", "on", "--load-mode", "none", "-o", "jsonl", "-v",
    ]
    if engine == "NPU":
        workload += ["-ngl", "99", "-dev", "HTP0"]
    else:
        workload += ["-ngl", "0"]
    command = [
        sys.executable, str(LAUNCHER), "--serial", SERIAL, "--tag", tag,
        "--warn-tenths", "400", "--kill-tenths", str(kill),
        "--session-hard-cap-tenths", "0", "--sensor-failure-limit", "4",
        "--interval-s", "1", "--max-seconds", "1800", "--local-dir", str(RAW),
    ]
    if engine == "NPU":
        command.append("--allow-npu")
    command += ["--", *workload]
    print(f"START {tag} engine={engine} n={n} pre={pre}", flush=True)
    started = time.time()
    result = subprocess.run(command, cwd=ROOT, env={**os.environ, "MSYS_NO_PATHCONV": "1"}, capture_output=True, text=True)
    elapsed = time.time() - started
    save_bytes(RAW / f"{tag}.launcher.stdout.log", result.stdout.encode())
    save_bytes(RAW / f"{tag}.launcher.stderr.log", result.stderr.encode())
    thermal_post, _ = capture(tag, "thermalservice.post", "dumpsys thermalservice", timeout=30)
    post_text, post = capture(tag, "battery.post", "dumpsys battery", timeout=30)
    manifest_path = RAW / f"{tag}.manifest.json"
    manifest: dict[str, object] = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    stdout_path = RAW / f"{tag}.stdout.jsonl"
    stderr_path = RAW / f"{tag}.stderr.log"
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace") if stderr_path.exists() else ""
    proof_text = stderr
    execute_count = len(re.findall(r"HTP0.*execute-op|execute-op.*HTP0", proof_text, re.IGNORECASE))
    offloaded = re.findall(r"offloaded\s+\d+/\d+\s+layers?\s+to\s+GPU", proof_text, re.IGNORECASE)
    crash = authorized_crash(stderr)
    guard_kill = manifest.get("guard_outcome") == "thermal kill" or manifest.get("guard_exit_code") == 2
    workload_rc = manifest.get("workload_rc")
    real_crash = bool(crash) or (isinstance(workload_rc, int) and workload_rc >= 128 and not guard_kill)
    record = {
        "tag": tag, "n": n, "engine": engine, "rep": rep, "kill_tenths": kill,
        "cooldown_samples": cooldown, "battery_pre": pre, "battery_post": post,
        "thermalservice_pre_file": f"{tag}.thermalservice.pre.txt",
        "thermalservice_post_file": f"{tag}.thermalservice.post.txt",
        "launcher_rc_process": result.returncode, "launcher_elapsed_s": round(elapsed, 3),
        "manifest_file": f"{tag}.manifest.json", "stdout_file": f"{tag}.stdout.jsonl",
        "stderr_file": f"{tag}.stderr.log", "guard_file": f"{tag}.guard.log",
        "execute_op_count": execute_count, "offloaded_proof": offloaded,
        "jsonl": parse_jsonl(stdout_path) if stdout_path.exists() else {"rows": 0},
        "crash_signature": crash, "guard_kill": guard_kill, "real_crash": real_crash,
        "thermalservice_pre_bytes": len(thermal_pre.encode("utf-8")),
        "thermalservice_post_bytes": len(thermal_post.encode("utf-8")),
    }
    save_bytes(RAW / f"{tag}.record.json", (json.dumps(record, indent=2) + "\n").encode())
    print(f"END {tag} rc={result.returncode} guard={manifest.get('guard_outcome')} workload_rc={workload_rc} post={post} elapsed={elapsed:.1f}s", flush=True)
    if guard_kill or real_crash or manifest.get("adb_disconnect"):
        print(f"STOP {tag} guard_kill={guard_kill} real_crash={real_crash} adb_disconnect={manifest.get('adb_disconnect')}", flush=True)
        record["stop"] = True
    else:
        record["stop"] = False
    return record


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    pc = {
        "thermal_guard_sha256": local_sha256(GUARD),
        "launch_with_guard_sha256": local_sha256(LAUNCHER),
    }
    if pc != {key: EXPECTED[key] for key in pc}:
        raise SystemExit(f"PC guard/launcher pin mismatch: {pc}")
    device_sha_text = pin_device()
    save_bytes(RAW / "preflight_device_sha256.txt", device_sha_text.encode())
    device = pin_lines(device_sha_text)
    expected_device = {
        DEVICE_GUARD: EXPECTED["thermal_guard_sha256"],
        BENCH: EXPECTED["llama_bench_sha256"],
        SKEL_HEX: EXPECTED["libggml_hexagon_sha256"],
        SKEL_V73: EXPECTED["libggml_htp_v73_sha256"],
        MODEL: EXPECTED["qwen_model_sha256"],
    }
    if any(device.get(path) != sha for path, sha in expected_device.items()):
        raise SystemExit(f"device pin mismatch: {device}")
    preflight_battery_text, preflight_battery = capture("preflight", "battery", "dumpsys battery", timeout=30)
    thermal = adb_bytes(["shell", "dumpsys thermalservice"], timeout=30)
    save_bytes(RAW / "preflight.thermalservice.txt", thermal)
    ps = adb_text(["shell", "ps -A | grep -E 'llama|thermal_guard' || true"], timeout=30)
    save_bytes(RAW / "preflight.ps.txt", ps.encode())
    if preflight_battery.get("level") is None or preflight_battery.get("temperature_tenths") is None:
        raise SystemExit(f"preflight battery parse failed: {preflight_battery}")
    manifest: dict[str, object] = {
        "cell": "q58-s23-npu-spike-sweep", "prereg": "f10d997b", "device": "Galaxy S23 / Hexagon v73",
        "serial": SERIAL, "mdns_serial": "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp",
        "pins": {**pc, **{key: EXPECTED[key] for key in EXPECTED if key not in pc}, "device_sha256": device},
        "model": MODEL, "binary": BENCH, "workload": "-n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl; -v; NPU -ngl 99 -dev HTP0; CPU -ngl 0",
        "environment": {"GGML_HEXAGON_NDEV": "1", "GGML_HEXAGON_VERBOSE": "1", "NPU_GGML_HEXAGON_HOSTBUF": "1", "CPU_GGML_HEXAGON_HOSTBUF": "unset"},
        "guard": {"warn_tenths": 400, "NPU_kill_tenths": 410, "CPU_kill_tenths": 430, "session_hard_cap_tenths": 0, "interval_s": 1, "sensor_failure_limit": 4, "sensor_timeout_s": 10, "cool_start_tenths": 320, "battery_floor_pct": 45},
        "preflight_battery": preflight_battery, "runs": [], "stop": None,
    }
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    records: list[dict[str, object]] = []
    for n in (128, 512, 1024, 2048):
        for rep, engine in enumerate(("NPU", "CPU", "CPU", "NPU"), start=1):
            record = run_one(n, engine, (1 if rep == 1 else 2) if engine == "NPU" else rep - 1)
            records.append(record)
            manifest["runs"] = records
            if record.get("stop"):
                manifest["stop"] = record
                try:
                    save_bytes(RAW / "final.battery.txt", adb_bytes(["shell", "dumpsys battery"], timeout=30))
                    save_bytes(RAW / "final.thermalservice.txt", adb_bytes(["shell", "dumpsys thermalservice"], timeout=30))
                    manifest["final_battery_file"] = "final.battery.txt"
                    manifest["final_thermalservice_file"] = "final.thermalservice.txt"
                except Exception as exc:
                    manifest["final_capture_error"] = str(exc)
                (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
                return 2
            (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    final_battery = adb_bytes(["shell", "dumpsys battery"], timeout=30)
    save_bytes(RAW / "final.battery.txt", final_battery)
    final_thermal = adb_bytes(["shell", "dumpsys thermalservice"], timeout=30)
    save_bytes(RAW / "final.thermalservice.txt", final_thermal)
    manifest["final_battery_file"] = "final.battery.txt"
    manifest["final_thermalservice_file"] = "final.thermalservice.txt"
    manifest["stop"] = False
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
