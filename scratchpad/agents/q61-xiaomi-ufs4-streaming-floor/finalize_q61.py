from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import statistics
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q61-xiaomi-ufs4-streaming-floor"
RAW = CELL / "raw"
HZ = 100
THREADS = 8
MODEL_BYTES = 6509642624
MODEL_PATH = "/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf"
MODEL_REGIME = "secondary borderline (model < MemTotal; not a clean streaming arm)"
BENCH_PATH = "/data/local/tmp/kalsa16/llama-bench"
BENCH_SHA256 = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"
BENCH_IMPL_SHA256 = "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807"
IO_GATE_XIAOMI_MB_S = 2046.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_lines(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def parse_battery(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    result: dict[str, object] = {}
    for key in ("level", "temperature_tenths", "voltage_mv"):
        marker = {"temperature_tenths": "temperature", "voltage_mv": "voltage"}.get(key, key)
        for line in text.splitlines():
            if line.startswith(f"  {marker}:"):
                try:
                    result[key] = int(line.split(":", 1)[1].strip())
                except ValueError:
                    pass
                break
    return result


def read_sampler(tag: str) -> list[dict[str, str]]:
    path = RAW / f"{tag}.sampler.csv"
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def workload_json(tag: str, n_prompt: int) -> dict[str, object]:
    values = json_lines(RAW / f"{tag}.stdout.jsonl")
    candidates = [v for v in values if isinstance(v.get("samples_ns"), list) and v.get("samples_ns") and int(v.get("n_prompt", -1)) == n_prompt and int(v.get("n_gen", -1)) == 0]
    if not candidates:
        raise RuntimeError(f"{tag}: no prompt samples_ns JSON object")
    value = candidates[-1]
    samples = value["samples_ns"]
    if not isinstance(samples, list) or len(samples) != 1:
        raise RuntimeError(f"{tag}: expected one -r 1 prompt sample")
    return value


def marker_epoch(record: dict[str, object], key: str) -> float | None:
    values = record.get("stderr_markers_host_epoch")
    if not isinstance(values, dict):
        return None
    value = values.get(key)
    return float(value) if isinstance(value, (int, float)) else None


def derive(record: dict[str, object]) -> dict[str, object]:
    tag = str(record["tag"])
    n_prompt = int(record["n_prompt"])
    workload = workload_json(tag, n_prompt)
    rows = read_sampler(tag)
    if len(rows) < 2:
        raise RuntimeError(f"{tag}: sampler requires >=2 rows, got {len(rows)}")
    start = rows[0]
    end = rows[-1]
    wall_s = int(workload["samples_ns"][0]) / 1_000_000_000.0
    utime_s = max(0, int(end["utime_ticks"]) - int(start["utime_ticks"])) / HZ
    stime_s = max(0, int(end["stime_ticks"]) - int(start["stime_ticks"])) / HZ
    read_mb = max(0, int(end["read_bytes"]) - int(start["read_bytes"])) / 1_000_000.0
    majflt = max(0, int(end["majflt"]) - int(start["majflt"]))
    load_marker = marker_epoch(record, "load_start")
    eval_marker = marker_epoch(record, "eval_start")
    run_end = float(record.get("launch_finished_host_epoch", 0.0))
    sampler_last_epoch = float(end["epoch"])
    clock_offset = run_end - sampler_last_epoch if run_end else 0.0
    eval_device_epoch = eval_marker - clock_offset if eval_marker is not None else None
    eval_index: int | None = None
    if eval_device_epoch is not None:
        eval_index = min(range(len(rows)), key=lambda i: abs(float(rows[i]["epoch"]) - eval_device_epoch))
    if eval_index is None:
        prefetch_mb = 0.0
        eval_read_mb = read_mb
    else:
        prefetch_mb = max(0.0, int(rows[eval_index]["read_bytes"]) - int(start["read_bytes"])) / 1_000_000.0
        eval_read_mb = max(0.0, int(end["read_bytes"]) - int(rows[eval_index]["read_bytes"])) / 1_000_000.0
    eval_rate = eval_read_mb / wall_s if wall_s else 0.0
    load_s = load_marker and eval_marker and max(0.0, eval_marker - load_marker)
    sampler_window_s = max(0.0, float(end["uptime_s"]) - float(start["uptime_s"]))
    compute_s = utime_s + stime_s
    row: dict[str, object] = {
        "n_prompt": n_prompt,
        "rep": int(record["rep"]),
        "cache_class": record["cache_class"],
        "tag": tag,
        "wall_s": wall_s,
        "load_time_s_stderr_markers": load_s,
        "eval_wall_s": wall_s,
        "sampler_window_s": sampler_window_s,
        "sampler_window_vs_wall": sampler_window_s / wall_s if wall_s else None,
        "sampler_window_extra_s": sampler_window_s - wall_s,
        "utime_s": utime_s,
        "stime_s": stime_s,
        "user_share_8t": utime_s / (THREADS * wall_s),
        "stime_share_8t": stime_s / (THREADS * wall_s),
        "stime_of_busy": stime_s / compute_s if compute_s else 0.0,
        "io_stall_complement_8t": 1.0 - compute_s / (THREADS * wall_s),
        "read_MB_total_launch": read_mb,
        "prefetch_read_MB": prefetch_mb,
        "eval_read_MB": eval_read_mb,
        "eval_pass_MB_s": eval_rate,
        "re_read_multiplier": eval_read_mb / (MODEL_BYTES / 1_000_000.0),
        "majflt": majflt,
        "sampler_rows": len(rows),
        "psi_io_readable": any(row.get("psi_some_avg10") not in (None, "", "NA") or row.get("psi_full_avg10") not in (None, "", "NA") for row in rows),
        "model_bytes": MODEL_BYTES,
        "model_regime": MODEL_REGIME,
        "load_marker_host_epoch": load_marker,
        "eval_marker_host_epoch": eval_marker,
        "eval_marker_sampler_index": eval_index,
        "workload_json": f"raw/{tag}.stdout.jsonl",
        "sampler_csv": f"raw/{tag}.sampler.csv",
    }
    return row


def classify(ratio: float) -> str:
    if ratio >= 0.8:
        return "flash-bound"
    if ratio <= 0.5:
        return "compute-bound"
    return "mixed"


def f(value: object, places: int = 6) -> str:
    if value is None:
        return "NA"
    return f"{float(value):.{places}f}"


def main() -> None:
    records = json.loads((CELL / "run_records.json").read_text(encoding="utf-8"))
    metrics = [derive(record) for record in records]
    best_eval_rate = max(float(row["eval_pass_MB_s"]) for row in metrics)
    for row in metrics:
        wall = float(row["wall_s"])
        eval_mb = float(row["eval_read_MB"])
        utime = float(row["utime_s"])
        stime = float(row["stime_s"])
        self_io = wall
        cell_io = eval_mb / best_eval_rate if best_eval_rate else wall
        row["self_consistent_io_floor_s"] = self_io
        row["cell_best_io_floor_s"] = cell_io
        row["cell_best_eval_rate_MB_s"] = best_eval_rate
        for k in (2, 4, 8):
            row[f"headroom_self_k{k}"] = wall / max(self_io, stime + utime / k)
            row[f"headroom_cell_best_k{k}"] = wall / max(cell_io, stime + utime / k)
        row["self_consistent_io_floor_ratio"] = self_io / wall if wall else None
        row["cell_best_io_floor_ratio"] = cell_io / wall if wall else None
        row["wording_self_consistent"] = classify(float(row["self_consistent_io_floor_ratio"]))
        row["wording_cell_best"] = classify(float(row["cell_best_io_floor_ratio"]))

    warm512 = [row for row in metrics if row["n_prompt"] == 512 and row["cache_class"] == "warm"]
    self_k2_median = statistics.median(float(row["headroom_self_k2"]) for row in warm512)
    self_ratio_median = statistics.median(float(row["self_consistent_io_floor_ratio"]) for row in warm512)
    cell_ratio_median = statistics.median(float(row["cell_best_io_floor_ratio"]) for row in warm512)
    wording_self = classify(self_ratio_median)
    wording_cell = classify(cell_ratio_median)
    if self_k2_median >= 2.0:
        settling = "self-consistent pp512 warm headroom >= 2.0x: v75 streaming-NPU has a real ceiling; phase 2 ring design is worth owner review"
    elif self_k2_median <= 1.3:
        settling = "self-consistent pp512 warm headroom <= 1.3x: streaming stays CPU on every generation we own; HVX, if ever, is resident-only"
    else:
        settling = "self-consistent pp512 warm headroom is between 1.3x and 2.0x: owner decision with tables"

    anomalies = [
        "no PC MoE GGUF met the clarified >=1.2x MemTotal primary threshold; no model push",
        "selected model is secondary borderline: 6.509642624 GB file is > current MemAvailable but < MemTotal",
        "q61_guard_t2_20260826 rehearsal used HTP-linked binary and is excluded; valid T2 uses kalsa16 CPU/OpenCL build",
        "q61_guard_t1_cpu_20260826 guard killed before launcher readiness classification; guard log and rc/workload kill path are valid",
    ]
    for record in records:
        tag = str(record["tag"])
        manifest_path = RAW / f"{tag}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
        if manifest.get("guard_exit_code") != 0:
            anomalies.append(f"{tag}: guard_exit_code={manifest.get('guard_exit_code')}")
        if manifest.get("adb_disconnect"):
            anomalies.append(f"{tag}: adb_disconnect=true")
        if manifest.get("execute_op_htp0"):
            anomalies.append(f"{tag}: execute_op_htp0=true")
        if not (RAW / f"{tag}.sampler.csv").exists():
            anomalies.append(f"{tag}: sampler missing")
        if marker_epoch(record, "load_start") is None or marker_epoch(record, "eval_start") is None:
            anomalies.append(f"{tag}: stderr progress marker missing")
    if not all(bool(row["psi_io_readable"]) for row in metrics):
        anomalies.append("sampler: /proc/pressure/io unreadable in at least one measured run")

    inventory = json.loads((CELL / "inventory.json").read_text(encoding="utf-8")) if (CELL / "inventory.json").exists() else {}
    first = records[0]
    last = records[-1]
    battery_start = first.get("battery_pre", {})
    battery_end = last.get("battery_post", {})
    guard_t2 = {
        "tag": "q61_guard_t2_cpu_20260826",
        "expected": "guard 0; workload 0; numeric current-block sample; MAX; no execute-op HTP0",
        "observed": "guard 0; workload 0; samples 271/79; MAX; execute_op_htp0=false",
        "result": "PASS",
    }
    guard_t1 = {
        "tag": "q61_guard_t1_cpu_20260826",
        "expected": "kill threshold=current temperature-5; guard 2; workload 137",
        "observed": "threshold 266; guard 2; workload 137; KILL_THRESHOLD; KILLED; max 281",
        "result": "PASS (launcher readiness classified guard-not-ready due immediate kill)",
    }
    manifest = {
        "cell": "q61-xiaomi-ufs4-streaming-floor",
        "prereg_lock": "e51542ed",
        "completed_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "device": {
            "model": "23127PN0CG",
            "product": "houji_global",
            "device": "houji",
            "soc": "SM8650 / Hexagon v75 / Adreno 750",
            "storage": "UFS 4.0",
            "ram_GB_nominal": 12,
            "serial": "adb-625689a2-9xEOfw._adb-tls-connect._tcp",
            "reconnects": 0,
        },
        "guard_validation": {"t2": guard_t2, "t1": guard_t1, "guard_sha256": "f8b664194d7eae7d04ebb3bba8745769cbd79777796803d25eed7974e9bda84c", "warn_tenths": 400, "kill_tenths": 430, "interval_s": 1, "sensor_fail_limit": 4, "parser_current_block": "^  temperature: / ^  level:", "timeout": "/system/bin/timeout"},
        "inventory": inventory,
        "selected_model": {"path": MODEL_PATH, "bytes": MODEL_BYTES, "sha256": first.get("model_sha256_before_idle"), "regime": MODEL_REGIME, "primary_model_found": False},
        "selected_binary": {"path": BENCH_PATH, "sha256": BENCH_SHA256, "libllama_bench_impl_sha256": BENCH_IMPL_SHA256, "load_mode": "mmap", "no_repack": True, "n_gpu_layers": 0, "npu_flags_absent": True},
        "protocol": {"sizes": "pp512 x3; pp2048 x1; pp128 x1", "cold": "sha256 then >=600s no-touch before each rep1", "cool_poll_s": 60, "cool_start_C": 32.0, "battery_floor_pct": 45, "charging_changed": False, "per_launch_sampler_s": 1, "stderr_split": "llama-bench --progress load-start/prompt-run markers; eval wall=samples_ns"},
        "metrics": metrics,
        "best_observed_eval_pass_MB_s": best_eval_rate,
        "headroom_convention": "wall / max(eval-read / rate, stime + utime/k), k=2,4,8; user-compute-only; stime stays on CPU",
        "pp512_warm_self_consistent_io_floor_ratio_median": self_ratio_median,
        "pp512_warm_cell_best_io_floor_ratio_median": cell_ratio_median,
        "pp512_warm_wording_self_consistent": wording_self,
        "pp512_warm_wording_cell_best": wording_cell,
        "settling_statement": settling,
        "io_gate_xiaomi_reference_MB_s": IO_GATE_XIAOMI_MB_S,
        "battery_start": battery_start,
        "battery_end": battery_end,
        "max_temperature_C": max(float(json.loads((RAW / f"{record['tag']}.manifest.json").read_text(encoding="utf-8")).get("guard", {}).get("max_temperature_tenths", 0)) / 10.0 for record in records),
        "anomalies": anomalies,
        "run_records": records,
    }
    (CELL / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    lines = [
        "# q61 numbers",
        "",
        "DISCLAIMER: this cell does NOT decide GO/NO-GO for any kernel; it characterizes the streaming prefill floor. The selected arm is secondary borderline (model < MemTotal), not a clean streaming-regime arm.",
        "LEGEND: headroom = eval wall / max(I/O floor, stime + utime/k); k = hypothetical user-matmul speed-up; stime stays on CPU; values >1 are ceilings, not predictions.",
        "",
        "| n | rep | cache | load_s(stderr) | eval_wall_s | sampler_window_s | window/wall | prefetch_MB | eval_read_MB | eval_MB/s | re-read_x | utime_s | stime_s | user_share_8t | stime_share_8t | majflt |",
        "|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        lines.append("| " + " | ".join([
            str(row["n_prompt"]), str(row["rep"]), str(row["cache_class"]), f(row["load_time_s_stderr_markers"]), f(row["eval_wall_s"]), f(row["sampler_window_s"]), f(row["sampler_window_vs_wall"]), f(row["prefetch_read_MB"], 3), f(row["eval_read_MB"], 3), f(row["eval_pass_MB_s"], 3), f(row["re_read_multiplier"], 3), f(row["utime_s"], 3), f(row["stime_s"], 3), f(row["user_share_8t"]), f(row["stime_share_8t"]), str(row["majflt"]),
        ]) + " |")
    lines += [
        "",
        "| n | rep | self_io_floor_s | cell_best_io_floor_s | self_hr_k2 | self_hr_k4 | self_hr_k8 | cell_best_hr_k2 | cell_best_hr_k4 | cell_best_hr_k8 |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        lines.append("| " + " | ".join([
            str(row["n_prompt"]), str(row["rep"]), f(row["self_consistent_io_floor_s"]), f(row["cell_best_io_floor_s"]), f(row["headroom_self_k2"]), f(row["headroom_self_k4"]), f(row["headroom_self_k8"]), f(row["headroom_cell_best_k2"]), f(row["headroom_cell_best_k4"]), f(row["headroom_cell_best_k8"]),
        ]) + " |")
    lines += [
        "",
        f"model_regime = {MODEL_REGIME}",
        f"best_observed_eval_pass_MB_s = {best_eval_rate:.6f}",
        f"pp512_warm_self_consistent_io_floor_ratio_median = {self_ratio_median:.6f}",
        f"pp512_warm_cell_best_io_floor_ratio_median = {cell_ratio_median:.6f}",
        f"pp512_warm_wording_self_consistent = {wording_self}",
        f"pp512_warm_wording_cell_best = {wording_cell}",
        f"settling_statement = {settling}",
        f"max_temperature_C = {manifest['max_temperature_C']:.1f}",
        f"battery_start_pct = {battery_start.get('level')}",
        f"battery_end_pct = {battery_end.get('level')}",
        f"guard_T2 = {guard_t2['result']}",
        f"guard_T1 = {guard_t1['result']}",
        "anomalies = " + "; ".join(anomalies),
    ]
    (CELL / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    log = [
        "# q61 RUN_LOG",
        "",
        "cell=q61-xiaomi-ufs4-streaming-floor",
        "prereg_lock=e51542ed",
        "device=23127PN0CG / houji_global / SM8650 / Hexagon v75 / Adreno 750 / UFS 4.0 / 12 GB",
        "serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp",
        "wireless=1; unplugged=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0; reconnects=0",
        "guard_parser=current block only: ^  temperature: [0-9]+ and ^  level: [0-9]+; timeout=/system/bin/timeout; WARN=400; KILL=430; interval=1s; sensor_fail_limit=4",
        "guard_T2=PASS; tag=q61_guard_t2_cpu_20260826; guard_rc=0; workload_rc=0; MAX; samples=271/79; execute_op_htp0=0",
        "guard_T1=PASS; tag=q61_guard_t1_cpu_20260826; threshold=266=current_pre_temp_271-5; guard_rc=2; workload_rc=137; KILL_THRESHOLD; KILLED; max=281",
        "guard_T1_launcher_note=immediate kill caused launcher readiness classification guard-not-ready/75; the guard log and required guard_rc/workload_rc path passed",
        "primary_model=none found on PC at >=1.2x MemTotal; no push",
        f"selected_model={MODEL_PATH}; bytes={MODEL_BYTES}; sha256={first.get('model_sha256_before_idle')}; regime={MODEL_REGIME}",
        f"selected_binary={BENCH_PATH}; sha256={BENCH_SHA256}; libllama_bench_impl_sha256={BENCH_IMPL_SHA256}; -ngl=0; mmap=1; -nr=1; NPU/GPU flags absent",
        "protocol=pp512 x3, pp2048 x1, pp128 x1; each rep1 hash then >=600s no-touch; each launch separate; cool-start <=32.0C by 60s polls; battery floor 45%",
        "stderr_split=--progress benchmark starting to prompt run marker is load phase; samples_ns is timed eval wall; sampler-window-vs-wall recorded per launch",
        "",
        "## runs",
    ]
    for row, record in zip(metrics, records):
        log.append(f"{record['tag']} pre_level={record.get('battery_pre', {}).get('level')} pre_temp_C={float(record.get('battery_pre', {}).get('temperature_tenths', 0)) / 10:.1f} post_level={record.get('battery_post', {}).get('level')} post_temp_C={float(record.get('battery_post', {}).get('temperature_tenths', 0)) / 10:.1f} wall_s={float(row['wall_s']):.6f} load_s={float(row['load_time_s_stderr_markers']):.6f} prefetch_MB={float(row['prefetch_read_MB']):.3f} eval_MB={float(row['eval_read_MB']):.3f} eval_MB_s={float(row['eval_pass_MB_s']):.3f} majflt={row['majflt']} guard_manifest={record['guard_manifest']}")
    log += [
        "",
        "## derivations",
        f"best_observed_eval_pass_MB_s={best_eval_rate:.6f}; io_gate_xiaomi_reference_MB_s={IO_GATE_XIAOMI_MB_S:.3f}; gate_comparability=reference_only",
        "headroom=wall/max(eval_read/rate, stime+utime/k); k=2,4,8; self-consistent rate=each launch eval_read/eval_wall; cell-best rate=max observed eval pass; user-compute-only; stime stays CPU",
        f"pp512_warm_wording_self_consistent={wording_self}; ratio_median={self_ratio_median:.6f}; cell_best_wording={wording_cell}; ratio_median={cell_ratio_median:.6f}",
        f"settling_statement={settling}",
        f"max_temperature_C={manifest['max_temperature_C']:.1f}; battery_start_pct={battery_start.get('level')}; battery_end_pct={battery_end.get('level')}",
        "pressure_io_readable=" + str(int(all(bool(row["psi_io_readable"]) for row in metrics))),
        "anomalies=" + "; ".join(anomalies),
    ]
    (CELL / "RUN_LOG.md").write_text("\n".join(log) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"metrics": metrics, "best_observed_eval_pass_MB_s": best_eval_rate, "settling_statement": settling, "anomalies": anomalies}, indent=2))


if __name__ == "__main__":
    main()
