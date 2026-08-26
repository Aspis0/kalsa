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
CELL = ROOT / "scratchpad" / "agents" / "q55-v75-npu-correctness"
RAW = CELL / "raw"
ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
LAUNCHER = CELL / "launch_q55.py"
GUARD = CELL.parent / "q56-thermal-watchdog" / "thermal_guard.sh"
DEV = "/data/local/tmp/kalsahtp"
MODEL_OLMOE = "/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf"
MODEL_QWEN = "/data/local/tmp/kalsahtp/models/Qwen3.5-4B-Q4_0.gguf"
CORPUS = "/data/local/tmp/wiki.test.raw"
OLMOE_SHA = "43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500"
QWEN_SHA = "298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb"
CORPUS_SHA = "173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08"
SOURCE_COMMIT = "3f545beccee69d9975f466ec7e45fd9aacd8ba90"
NPU_KILL = 410
CPU_KILL = 430
WARN = 400

CPU_TPS_DIAGNOSIS = {
    "q55_command": "/data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -ngl 0",
    "q55_flags": {"t": 8, "ngl": 0, "dev": "absent", "load_mode": "none", "n_prompt": 512, "n_gen": 0, "repetitions": 2},
    "q55_binary_json": {"n_threads": 8, "cpu_mask": "0x0", "cpuset": "/"},
    "q55_environment": {
        "ADSP_LIBRARY_PATH": "/data/local/tmp/kalsahtp (retained by watchdog launcher)",
        "CDSP_LIBRARY_PATH": "/data/local/tmp/kalsahtp (retained by watchdog launcher)",
        "GGML_HEXAGON_NDEV": "1 (retained by watchdog launcher)",
        "GGML_HEXAGON_VERBOSE": "1 (retained by watchdog launcher)",
        "GGML_HEXAGON_HOSTBUF": "unset",
    },
    "q55_launcher": "nohup setsid sh -c supervisor; supervisor starts (workload_wrapper) in sh -c and uses exec; no nice/taskset/chrt/ionice/setpriority invocation",
    "q55_affinity_evidence": "/proc/<binary_pid>/cpuset captured as /; llama-bench JSON cpu_mask=0x0; taskset -p output was not captured",
    "q48_command": "./llama-bench -m \"$MODEL\" -p 512 -n 128 -r 2 --no-warmup -ngl 0 -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024",
    "q48_flags": {"t": "omitted; default thread selection", "ngl": 0, "dev": "absent", "load_mode": "none", "n_prompt": 512, "n_gen": 128, "repetitions": 2},
    "q48_cpu_environment": "setup_env_cpu explicitly unset ADSP_LIBRARY_PATH, CDSP_LIBRARY_PATH, GGML_HEXAGON_NDEV, GGML_HEXAGON_VERBOSE, GGML_HEXAGON_HOSTBUF, GGML_HEXAGON_MM_SELECT, and GGML_OPENCL_LOG_ALLOC",
    "q48_launcher": "direct llama-bench invocation from hostbuf1_driver.sh; no watchdog wrapper, nice/taskset/chrt/ionice/setpriority evidence in the recorded script",
    "interpretation": "Not an apples-to-apples comparison. q55 first-sample pp512 values were 52.6183 and 53.1056 t/s, with JSON averages 70.541380 and 69.473463 t/s; q48 reported 142.92 and 141.48 t/s for its -n 128/default-thread CPU arm. Records prove different n_gen and thread/environment setup, but do not isolate which difference dominates. No rerun performed.",
}


class DeviceDrop(RuntimeError):
    pass


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def append_log(line: str) -> None:
    path = CELL / "RUN_LOG.md"
    existing = path.read_text(encoding="utf-8", errors="replace") if path.exists() else "# q55 RUN_LOG\n"
    if not existing.endswith("\n"):
        existing += "\n"
    path.write_text(existing + line.rstrip("\n") + "\n", encoding="utf-8", newline="\n")


def adb(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        result = subprocess.run([ADB, "-s", SERIAL, *args], text=True, capture_output=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeviceDrop(str(exc)) from exc
    text = result.stdout + result.stderr
    if result.returncode != 0:
        lowered = text.lower()
        if any(marker in lowered for marker in ("device offline", "no devices/emulators found", "failed to get feature set", "connection refused", "cannot connect", "closed")):
            raise DeviceDrop(f"adb transport rc={result.returncode}: {text.strip()}")
        raise RuntimeError(f"adb command rc={result.returncode}: {text.strip()}")
    return result


def shell(command: str, timeout: float = 30.0) -> str:
    result = adb(["shell", command], timeout)
    return result.stdout + result.stderr


def state_check() -> None:
    if adb(["get-state"], timeout=15.0).stdout.strip() != "device":
        raise DeviceDrop("exact Xiaomi serial is not in device state")


def battery_text(tag: str) -> tuple[str, dict[str, object]]:
    state_check()
    text = shell("dumpsys battery", timeout=15.0)
    (RAW / f"{tag}.battery.txt").write_text(text, encoding="utf-8", newline="\n")

    def integer(key: str) -> int | None:
        match = re.search(rf"^  {re.escape(key)}:\s*(-?\d+)", text, re.MULTILINE)
        return int(match.group(1)) if match else None

    def boolean(key: str) -> bool | None:
        match = re.search(rf"^  {re.escape(key)}:\s*(true|false)", text, re.MULTILINE | re.IGNORECASE)
        return match.group(1).lower() == "true" if match else None

    record: dict[str, object] = {
        "utc": now(),
        "level": integer("level"),
        "temperature_tenths": integer("temperature"),
        "voltage_mv": integer("voltage"),
        "charge_counter_uah": integer("Charge counter"),
        "ac_powered": boolean("AC powered"),
        "usb_powered": boolean("USB powered"),
        "wireless_powered": boolean("Wireless powered"),
        "dock_powered": boolean("Dock powered"),
    }
    record["plugged"] = any(record.get(k) is True for k in ("ac_powered", "usb_powered", "wireless_powered", "dock_powered"))
    return text, record


def wait_gate(tag: str) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    while True:
        _, record = battery_text(f"{tag}.gate.{len(rows):03d}")
        rows.append(record)
        (RAW / f"{tag}.gate.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
        level = record.get("level")
        temp = record.get("temperature_tenths")
        plugged = record.get("plugged")
        print(f"{tag} gate level={level} temp={None if temp is None else int(temp)/10:.1f}C plugged={plugged}", flush=True)
        if level is None or int(level) < 45:
            raise RuntimeError(f"{tag}: battery floor unavailable/crossed: {record}")
        if temp is None:
            raise RuntimeError(f"{tag}: temperature unavailable: {record}")
        if plugged:
            raise RuntimeError(f"{tag}: charging state changed: {record}")
        if int(temp) <= 320:
            return record
        time.sleep(60.0)


def sha256_remote(path: str, label: str) -> str:
    text = shell(f"sha256sum {shlex.quote(path)}", timeout=180.0)
    (RAW / f"{label}.sha256sum.txt").write_text(text, encoding="utf-8", newline="\n")
    match = re.search(r"^([0-9a-fA-F]{64})\s+", text, re.MULTILINE)
    if not match:
        raise RuntimeError(f"sha256 missing for {path}: {text}")
    return match.group(1).lower()


def thermalservice(tag: str, phase: str) -> str:
    text = shell("dumpsys thermalservice", timeout=30.0)
    (RAW / f"{tag}.thermalservice.{phase}.txt").write_text(text, encoding="utf-8", newline="\n")
    return text


def workload_args(model: str, kind: str, npu: bool, chunks: int = 32) -> list[str]:
    if kind == "ppl":
        args = [
            f"{DEV}/llama-perplexity", "-m", model, "-f", CORPUS,
            "-c", "2048", "-b", "2048", "-ub", "1024", "-t", "8",
            "-ngl", "99" if npu else "0", "--chunks", str(chunks), "--ppl-stride", "0",
            "-fa", "on", "--load-mode", "none", "-nkvo",
        ]
        if npu:
            args += ["-dev", "HTP0", "-v"]
        return args
    if kind == "bench":
        args = [
            f"{DEV}/llama-bench", "-m", model, "-p", "512", "-n", "0", "-r", "2",
            "--no-warmup", "-t", "8", "-fa", "on", "--load-mode", "none", "-o", "jsonl",
            "-ngl", "99" if npu else "0",
        ]
        if npu:
            args += ["-dev", "HTP0", "-v"]
        return args
    raise ValueError(kind)


def parse_manifest(tag: str) -> dict[str, object]:
    path = RAW / f"{tag}.manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def failure_line(text: str) -> str:
    stop_substrings = (
        "CDSP0 CRASHED",
        "dspqueue_read failed",
        "dspqueue_write failed",
        "INTERNAL-ERROR",
        "ggml_abort",
        "GGML_ASSERT",
        "Aborted",
        "Segmentation",
    )
    for line in text.splitlines():
        if any(marker in line for marker in stop_substrings):
            return line.strip()
    return ""


def run_arm(tag: str, model_name: str, model: str, kind: str, npu: bool, chunks: int = 32) -> dict[str, object]:
    pre = wait_gate(tag)
    thermalservice(tag, "pre")
    args = workload_args(model, kind, npu, chunks)
    (RAW / f"{tag}.workload.args.txt").write_text(" ".join(shlex.quote(x) for x in args) + "\n", encoding="utf-8", newline="\n")
    kill = NPU_KILL if npu else CPU_KILL
    max_seconds = 600 if npu else 3600
    command = [
        sys.executable, str(LAUNCHER), "--serial", SERIAL, "--tag", tag,
        "--warn-tenths", str(WARN), "--kill-tenths", str(kill),
        "--session-hard-cap-tenths", "0", "--sensor-failure-limit", "4",
        "--interval-s", "1", "--max-seconds", str(max_seconds),
        "--local-dir", str(RAW), "--manifest-path", str(RAW / f"{tag}.manifest.json"),
    ]
    if npu:
        command.append("--allow-npu")
    command += ["--", *args]
    (RAW / f"{tag}.launcher.args.txt").write_text(" ".join(shlex.quote(x) for x in command) + "\n", encoding="utf-8", newline="\n")
    started = time.time()
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    (RAW / f"{tag}.launcher.stdout.txt").write_text(result.stdout, encoding="utf-8", newline="\n")
    (RAW / f"{tag}.launcher.stderr.txt").write_text(result.stderr, encoding="utf-8", newline="\n")
    try:
        _, post = battery_text(f"{tag}.post")
        thermalservice(tag, "post")
    except DeviceDrop as exc:
        append_log(f"ADB_DROP tag={tag} after arm: {exc}")
        raise
    manifest = parse_manifest(tag)
    stdout = (RAW / f"{tag}.stdout.jsonl").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.stdout.jsonl").exists() else ""
    stderr = (RAW / f"{tag}.stderr.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.stderr.log").exists() else ""
    guard_text = (RAW / f"{tag}.guard.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.guard.log").exists() else ""
    combined = stdout + "\n" + stderr + "\n" + result.stdout + "\n" + result.stderr
    signature = failure_line(combined)
    battery_floor_triggered = bool(manifest.get("battery_floor_triggered")) or "BATTERY_LOW_ABORT" in guard_text
    battery_floor_chunk = manifest.get("battery_floor_chunk")
    if battery_floor_chunk is None and battery_floor_triggered:
        running = [int(m.group(1)) for m in re.finditer(r"\[(\d+)\]", combined)]
        battery_floor_chunk = max(running) if running else None
    record = {
        "tag": tag,
        "model_name": model_name,
        "model": model,
        "kind": kind,
        "chunks": chunks,
        "npu": npu,
        "args": args,
        "guard_warn_tenths": WARN,
        "guard_kill_tenths": kill,
        "wall_cap_s": max_seconds if npu else None,
        "battery_pre": pre,
        "battery_post": post,
        "launcher_rc": result.returncode,
        "guard_rc": manifest.get("guard_exit_code"),
        "workload_rc": manifest.get("workload_rc"),
        "guard_outcome": manifest.get("guard_outcome"),
        "timed_out": manifest.get("timed_out"),
        "abort_reason": manifest.get("abort_reason") or ("battery_below_45_percent_guard" if battery_floor_triggered else ""),
        "battery_floor_triggered": battery_floor_triggered,
        "battery_floor_chunk": battery_floor_chunk,
        "max_temperature_tenths": (manifest.get("guard") or {}).get("max_temperature_tenths") if isinstance(manifest.get("guard"), dict) else None,
        "execute_op_htp0": bool(manifest.get("execute_op_htp0")),
        "failure_signature": signature,
        "elapsed_s": round(time.time() - started, 3),
        "manifest": f"raw/{tag}.manifest.json",
        "stdout": f"raw/{tag}.stdout.jsonl",
        "stderr": f"raw/{tag}.stderr.log",
    }
    (RAW / f"{tag}.record.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(record, indent=2), flush=True)
    guard_outcome = str(record.get("guard_outcome") or "").lower()
    guard_kill = guard_outcome in {"thermal-kill", "guard-kill", "killed"} or record.get("guard_rc") == 2
    try:
        workload_rc = int(record.get("workload_rc"))
    except (TypeError, ValueError):
        workload_rc = None
    non_guard_high_rc = workload_rc is not None and workload_rc >= 128 and not guard_kill
    record["guard_kill"] = guard_kill
    record["non_guard_workload_rc_ge_128"] = non_guard_high_rc
    record["stop"] = bool(signature or guard_kill or non_guard_high_rc)
    return record


def count_proof(tag: str) -> dict[str, int]:
    path = RAW / f"{tag}.stderr.log"
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    lines = text.splitlines()
    def count(pattern: str) -> int:
        return sum(bool(re.search(pattern, line, re.IGNORECASE)) for line in lines)
    return {
        "execute_op_htp0": count(r"execute-op.*HTP0|HTP0.*execute-op"),
        "mul_mat_id": count(r"execute-op.*MUL_MAT_ID"),
        "expert_mul_mat_id": count(r"execute-op.*MUL_MAT_ID.*ffn_.*_exps"),
        "attn_execute_op": count(r"execute-op.*(attn_q|attn_k|attn_v|attn_output|attn_qkv)"),
        "execute_op_any": count(r"execute-op"),
    }


def parse_ppl(tag: str) -> dict[str, object]:
    texts = []
    for suffix in (".stdout.jsonl", ".stderr.log"):
        path = RAW / f"{tag}{suffix}"
        if path.exists():
            texts.append(path.read_text(encoding="utf-8", errors="replace"))
    text = "\n".join(texts)
    matches = list(re.finditer(r"Final estimate:\s*PPL\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*\+/-\s*([0-9]+(?:\.[0-9]+)?)", text))
    running: dict[int, float] = {}
    for match in re.finditer(r"\[(\d+)\]([0-9]+(?:\.[0-9]+)?)", text):
        running[int(match.group(1))] = float(match.group(2))
    result: dict[str, object] = {"ppl": None, "ppl_std": None, "running_ppl": running}
    if matches:
        result["ppl"] = float(matches[-1].group(1))
        result["ppl_std"] = float(matches[-1].group(2))
    return result


def qwen_12_characterization(records: list[dict[str, object]]) -> dict[str, object] | None:
    htp = next((r for r in reversed(records) if r.get("tag") == "partA_qwen_htp"), None)
    cpu = next((r for r in reversed(records) if r.get("tag") == "partA_qwen_cpu_12char"), None)
    if not htp or not cpu:
        return None
    htp_running = parse_ppl(str(htp["tag"])).get("running_ppl", {})
    cpu_running = parse_ppl(str(cpu["tag"])).get("running_ppl", {})
    htp_ppl = htp_running.get(12) if isinstance(htp_running, dict) else None
    cpu_ppl = cpu_running.get(12) if isinstance(cpu_running, dict) else None
    result_base = {
        "n": 12,
        "htp_ppl": htp_ppl,
        "cpu_ppl": cpu_ppl,
        "htp_max_chunk": max(htp_running) if isinstance(htp_running, dict) and htp_running else None,
        "cpu_max_chunk": max(cpu_running) if isinstance(cpu_running, dict) and cpu_running else None,
    }
    if not isinstance(htp_ppl, (int, float)) or not isinstance(cpu_ppl, (int, float)) or float(cpu_ppl) == 0:
        return {**result_base, "r12": None, "gate": "UNAVAILABLE", "status": "CPU arm stopped before common chunk 12"}
    r12 = float(htp_ppl) / float(cpu_ppl) - 1.0
    gate = "PASS" if r12 <= 0.02 else ("GREY" if r12 <= 0.05 else "FAIL")
    return {**result_base, "htp_ppl": float(htp_ppl), "cpu_ppl": float(cpu_ppl), "r12": r12, "gate": gate, "status": "12-chunk characterization"}


def write_outputs(records: list[dict[str, object]], proof: dict[str, dict[str, int]], setup: dict[str, object], status: str) -> None:
    qwen_char = qwen_12_characterization(records)
    manifest = {
        "cell": "q55-v75-npu-correctness",
        "prereg": "q55 PREREG locked",
        "source_commit": SOURCE_COMMIT,
        "status": status,
        "device": {"model": "23127PN0CG", "product": "houji_global", "serial": SERIAL, "soc": "SM8650 / Hexagon v75", "storage": "UFS 4.0", "ram_GB_nominal": 12},
        "guard": {"warn_tenths": WARN, "npu_kill_tenths": NPU_KILL, "cpu_kill_tenths": CPU_KILL, "npu_wall_cap_s": 600, "cool_start_C": 32.0, "battery_floor_pct": 45, "validated_in_q61": True},
        "arbitration": {
            "single_authorized_retry": True,
            "kv_cache_on_host": True,
            "deviation": "KV cache on host: attention K/V stay on CPU; the experts MUL_MAT_ID and dense matmuls still execute on HTP0 — proof required via execute-op lines",
            "pre_retry_memavailable_kb": 6818768,
            "pre_retry_memavailable_gate": "PASS (>5.0 GB); no processes closed and no device state changed",
        },
        "thermalservice_headroom_available": False,
        "thermalservice_headroom_note": "No dynamic numeric headroom exposed; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]",
        "cpu_throughput_diagnosis": CPU_TPS_DIAGNOSIS,
        "stop_rule": {
            "case_sensitive_substrings": ["CDSP0 CRASHED", "dspqueue_read failed", "dspqueue_write failed", "INTERNAL-ERROR", "ggml_abort", "GGML_ASSERT", "Aborted", "Segmentation"],
            "workload_rc": "stop only when rc >= 128 and not caused by guard",
            "normal_session_open_cdsp_text_is_not_a_stop": True,
        },
        "false_stop_correction": "The earlier Part B STOPPED classification was false: Loading driver libcdsprpc.so and HTP0 new session ... _dom=cdsp are normal session-open messages, not crash signatures.",
        "qwen_12_chunk_characterization": qwen_char,
        "setup": setup,
        "models": {"OLMoE": {"path": MODEL_OLMOE, "sha256": OLMOE_SHA}, "Qwen3.5-4B-Q4_0": {"path": MODEL_QWEN, "sha256": QWEN_SHA}, "corpus": {"path": CORPUS, "sha256": CORPUS_SHA}},
        "records": records,
        "execute_op_proof": proof,
    }
    (CELL / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    lines = [
        "# q55 numbers",
        "",
        "DISCLAIMER: correctness r is a same-device 32-chunk comparison, not a proof of all workloads; Part B t/s is exploratory and charge-counter energy is recorded only.",
        "LEGEND: r = PPL_HTP / PPL_CPU - 1; PASS <= 0.02, GREY <= 0.05, FAIL > 0.05 or NaN; proof is required for certification.",
        "",
        "| arm | model | npu | guard_rc | workload_rc | launcher_rc | PPL | PPL_std | max_C | ΔT_C | wall_s | t/s | signature |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for rec in records:
        pre = rec.get("battery_pre") if isinstance(rec.get("battery_pre"), dict) else {}
        post = rec.get("battery_post") if isinstance(rec.get("battery_post"), dict) else {}
        pre_t = pre.get("temperature_tenths")
        post_t = post.get("temperature_tenths")
        delta = (int(post_t) - int(pre_t)) / 10.0 if isinstance(pre_t, int) and isinstance(post_t, int) else None
        wall = None
        tps = None
        if rec.get("kind") == "bench":
            out = parse_jsonl_result(str(rec["tag"]))
            wall, tps = out
        ppl = parse_ppl(str(rec["tag"])) if rec.get("kind") == "ppl" else {}
        max_t = rec.get("max_temperature_tenths")
        max_text = "" if max_t is None else f"{int(max_t)/10:.1f}"
        lines.append(f"| {rec.get('tag')} | {rec.get('model_name')} | {int(bool(rec.get('npu')))} | {rec.get('guard_rc')} | {rec.get('workload_rc')} | {rec.get('launcher_rc')} | {ppl.get('ppl','')} | {ppl.get('ppl_std','')} | {max_text} | {'' if delta is None else f'{delta:.1f}'} | {'' if wall is None else f'{wall:.6f}'} | {'' if tps is None else f'{tps:.6f}'} | {rec.get('failure_signature','')} |")
    lines += ["", "## Arbitration deviation", "", "KV cache on host: attention K/V stay on CPU; the experts MUL_MAT_ID and dense matmuls still execute on HTP0 — proof required via execute-op lines.", "Pre-retry MemAvailable=6818768 kB (>5.0 GB); no processes were closed and no device state changed.", "", "## Part A", ""]
    for model_name in ("OLMoE", "Qwen3.5-4B-Q4_0"):
        htp_candidates = [r for r in records if r.get("kind") == "ppl" and r.get("model_name") == model_name and r.get("npu") and parse_ppl(str(r.get("tag"))).get("ppl") is not None]
        cpu_candidates = [r for r in records if r.get("kind") == "ppl" and r.get("model_name") == model_name and not r.get("npu") and parse_ppl(str(r.get("tag"))).get("ppl") is not None]
        htp = htp_candidates[-1] if htp_candidates else next((r for r in records if r.get("kind") == "ppl" and r.get("model_name") == model_name and r.get("npu")), None)
        cpu = cpu_candidates[-1] if cpu_candidates else next((r for r in records if r.get("kind") == "ppl" and r.get("model_name") == model_name and not r.get("npu")), None)
        if model_name == "Qwen3.5-4B-Q4_0" and qwen_char is not None:
            r12_text = "" if qwen_char.get("r12") is None else f"{float(qwen_char['r12']):.8f}"
            lines.append(
                f"{model_name}: HTP_running_PPL_n12={qwen_char['htp_ppl']}; CPU_running_PPL_n12={qwen_char['cpu_ppl']}; "
                f"r12={r12_text}; gate={qwen_char['gate']}; "
                "12-chunk characterization (HTP arm capped at 10 min), not a 32-chunk certification; "
                f"HTP_max_chunk={qwen_char['htp_max_chunk']}; CPU_max_chunk={qwen_char['cpu_max_chunk']}; status={qwen_char['status']}; "
                f"proof={json.dumps(proof.get(str(htp['tag']), {}), sort_keys=True)}"
            )
        elif htp and cpu:
            hp = parse_ppl(str(htp["tag"])).get("ppl")
            cp = parse_ppl(str(cpu["tag"])).get("ppl")
            r_value = (float(hp) / float(cp) - 1.0) if isinstance(hp, (int, float)) and isinstance(cp, (int, float)) and float(cp) != 0 else None
            gate = "PASS" if isinstance(r_value, float) and r_value <= 0.02 else ("GREY" if isinstance(r_value, float) and r_value <= 0.05 else "FAIL/UNAVAILABLE")
            lines.append(f"{model_name}: PPL_HTP={hp}; PPL_CPU={cp}; r={'' if r_value is None else f'{r_value:.8f}'}; gate={gate}; proof={json.dumps(proof.get(str(htp['tag']), {}), sort_keys=True)}")
        else:
            lines.append(f"{model_name}: not completed")
    true_signatures = [str(rec.get("failure_signature")) for rec in records if rec.get("failure_signature")]
    true_stop_events = []
    for rec in records:
        if rec.get("failure_signature") or rec.get("guard_kill") or rec.get("non_guard_workload_rc_ge_128"):
            true_stop_events.append(
                f"{rec.get('tag')}: launcher_rc={rec.get('launcher_rc')}; workload_rc={rec.get('workload_rc')}; "
                f"guard_rc={rec.get('guard_rc')}; guard_outcome={rec.get('guard_outcome')}; "
                f"abort_reason={rec.get('abort_reason','')}; battery_floor_triggered={rec.get('battery_floor_triggered', False)}; "
                f"battery_floor_chunk={rec.get('battery_floor_chunk')}"
            )
    lines += [
        "", "## Stop-rule correction", "",
        "The earlier Part B STOPPED classification was false: Loading driver libcdsprpc.so and HTP0 new session ... _dom=cdsp are normal session-open messages, not crash signatures.",
        "Correct case-sensitive stop substrings: CDSP0 CRASHED; dspqueue_read failed; dspqueue_write failed; INTERNAL-ERROR; ggml_abort; GGML_ASSERT; Aborted; Segmentation; or workload rc >= 128 not caused by the guard.",
        "TRUE crash signatures: " + ("; ".join(true_signatures) if true_signatures else "none"),
        "TRUE stop events: " + ("; ".join(true_stop_events) if true_stop_events else "none"),
        "",
        "## CPU t/s discrepancy diagnosis",
        "",
        "q55 exact CPU command: " + CPU_TPS_DIAGNOSIS["q55_command"],
        "q55 JSON: first-sample pp512 t/s = 52.6183, 53.1056; avg_ts = 70.541380, 69.473463; n_threads=8; cpu_mask=0x0; /proc/<binary_pid>/cpuset=/.",
        "q55 launcher/priority: nohup setsid sh -c supervisor, then sh -c workload wrapper with exec; no nice/taskset/chrt/ionice/setpriority; taskset -p output was not captured.",
        "q55 CPU flags/environment: -t 8, -ngl 0, no -dev, --load-mode none, -n 0; ADSP_LIBRARY_PATH/CDSP_LIBRARY_PATH/NDEV/VERBOSE retained by launcher, HOSTBUF unset.",
        "q48 exact CPU command: " + CPU_TPS_DIAGNOSIS["q48_command"],
        "q48 CPU setup: -t omitted (default), -ngl 0, no -dev, --load-mode none, -n 128; setup_env_cpu explicitly unset Hexagon variables; direct invocation, no watchdog wrapper evidence.",
        "Diagnosis: records establish a non-identical comparison (n_gen and thread/environment setup differ); they do not isolate which factor dominates. No rerun performed.",
        "", "## Part B", "", "| model | sequence | ΔT_C | MAX_C | wall_s | t/s |", "|---|---|---:|---:|---:|---:|",
    ]
    for rec in records:
        if rec.get("kind") != "bench":
            continue
        pre = rec.get("battery_pre") if isinstance(rec.get("battery_pre"), dict) else {}
        post = rec.get("battery_post") if isinstance(rec.get("battery_post"), dict) else {}
        pt, qt = pre.get("temperature_tenths"), post.get("temperature_tenths")
        delta = (int(qt) - int(pt)) / 10 if isinstance(pt, int) and isinstance(qt, int) else None
        wall, tps = parse_jsonl_result(str(rec["tag"]))
        max_t = rec.get("max_temperature_tenths")
        max_text = "" if max_t is None else f"{int(max_t)/10:.1f}"
        lines.append(f"| {rec.get('model_name')} | {'NPU' if rec.get('npu') else 'CPU'} | {'' if delta is None else f'{delta:.1f}'} | {max_text} | {'' if wall is None else f'{wall:.6f}'} | {'' if tps is None else f'{tps:.6f}'} |")
    lines += ["", f"status={status}", "thermalservice_headroom_available=false; no dynamic numeric headroom exposed; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]", ""]
    (CELL / "REPORT.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


def parse_jsonl_result(tag: str) -> tuple[float | None, float | None]:
    path = RAW / f"{tag}.stdout.jsonl"
    if not path.exists():
        return None, None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("n_prompt") == 512 and row.get("n_gen") == 0:
            samples = row.get("samples_ts") or []
            if samples:
                return float(row.get("avg_ns", 0)) / 1e9, float(samples[0])
    return None, None


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    proof: dict[str, dict[str, int]] = {}
    prior_manifest = CELL / "manifest.json"
    if prior_manifest.exists():
        try:
            prior = json.loads(prior_manifest.read_text(encoding="utf-8"))
            records = list(prior.get("records", []))
            proof = dict(prior.get("execute_op_proof", {}))
        except (OSError, json.JSONDecodeError):
            pass
    setup: dict[str, object] = {
        "binary": f"{DEV}/llama-perplexity and {DEV}/llama-bench",
        "stub_sha256": "5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507",
        "hexagon_sha256": "f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448",
        "htp_v75_sha256": "46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182",
        "llama_perplexity_pc_sha256": "4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50",
        "llama_perplexity_impl_pc_sha256": "344a81ff021cd110abe966e7daf535efcaeb50dc4d777cb12ee751b9d1a4af4f",
        "env_npu": "NDEV=1 HOSTBUF=1; ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp; CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp",
            "q48_v75_flag": "-dev HTP0; q48 HOSTBUF=1/NDEV=1 environment retained; boolean --no-host 1 rejected by this perplexity parser and is omitted per locked q55 command",
    }
    try:
        state_check()
        for label, path, expected in (("olmoe", MODEL_OLMOE, OLMOE_SHA), ("qwen", MODEL_QWEN, QWEN_SHA), ("corpus", CORPUS, CORPUS_SHA)):
            got = sha256_remote(path, label)
            if got != expected:
                raise RuntimeError(f"sha mismatch {label}: expected {expected}, got {got}")
        append_log(f"setup_verified_utc={now()}; corpus/model shas match; v75 setup shas recorded; source_commit={SOURCE_COMMIT}")
        write_outputs(records, proof, setup, "SETUP_VERIFIED")
        sequence = [
            ("partA_olmoe_htp_kvhost_retry", "OLMoE", MODEL_OLMOE, "ppl", True),
            ("partA_olmoe_cpu_kvhost", "OLMoE", MODEL_OLMOE, "ppl", False),
            ("partB_olmoe_npu_1", "OLMoE", MODEL_OLMOE, "bench", True),
            ("partB_olmoe_cpu_1", "OLMoE", MODEL_OLMOE, "bench", False),
            ("partB_olmoe_cpu_2", "OLMoE", MODEL_OLMOE, "bench", False),
            ("partB_olmoe_npu_2", "OLMoE", MODEL_OLMOE, "bench", True),
            ("partA_qwen_htp", "Qwen3.5-4B-Q4_0", MODEL_QWEN, "ppl", True),
            ("partA_qwen_cpu", "Qwen3.5-4B-Q4_0", MODEL_QWEN, "ppl", False),
            ("partB_qwen_npu_1", "Qwen3.5-4B-Q4_0", MODEL_QWEN, "bench", True),
            ("partB_qwen_cpu_1", "Qwen3.5-4B-Q4_0", MODEL_QWEN, "bench", False),
            ("partB_qwen_cpu_2", "Qwen3.5-4B-Q4_0", MODEL_QWEN, "bench", False),
            ("partB_qwen_npu_2", "Qwen3.5-4B-Q4_0", MODEL_QWEN, "bench", True),
        ]
        for tag, model_name, model, kind, npu in sequence:
            record = run_arm(tag, model_name, model, kind, npu)
            records.append(record)
            proof[tag] = count_proof(tag)
            write_outputs(records, proof, setup, "RUNNING")
            append_log(f"{tag} launcher_rc={record.get('launcher_rc')} guard_rc={record.get('guard_rc')} workload_rc={record.get('workload_rc')} max_C={None if record.get('max_temperature_tenths') is None else int(record['max_temperature_tenths'])/10:.1f} signature={record.get('failure_signature','')!r}")
            if record.get("stop"):
                append_log(f"STOP q55 tag={tag}; no retry; signature={record.get('failure_signature','')!r}")
                write_outputs(records, proof, setup, "STOPPED")
                return 2
        append_log("q55 complete; no NPU crash signature, guard kill, or transport loss")
        write_outputs(records, proof, setup, "COMPLETE")
        return 0
    except DeviceDrop as exc:
        append_log(f"ADB_DROP q55 exact serial; no reconnect; detail={exc}")
        write_outputs(records, proof, setup, "STOPPED_ADB_DROP")
        return 76
    except Exception as exc:
        append_log(f"STOP q55 setup/runtime exception; no retry; detail={exc}")
        write_outputs(records, proof, setup, "STOPPED_EXCEPTION")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
