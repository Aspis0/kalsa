from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q60b-s23-streaming-floor"
RAW = CELL / "raw"
HZ = 100
THREADS = 8
MODEL_BYTES = 6509642624
MODEL_SHA256 = "bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419"
BENCH_BYTES = 7600
BENCH_SHA256 = "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c"
BENCH_IMPL_SHA256 = "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807"
IO_GATE_SEQ_MEDIAN_MB_S = 430.223
IO_GATE_SEQ_BEST_MB_S = 452.654
IO_GATE_COMPARABLE = False
INITIAL_MEM_TOTAL_KB = 7243748
INITIAL_MEM_AVAILABLE_KB = 4725704


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_json_lines(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def first_workload_object(path: Path) -> dict[str, object]:
    for value in reversed(parse_json_lines(path)):
        if isinstance(value.get("samples_ns"), list) and value["samples_ns"]:
            return value
    raise RuntimeError(f"no samples_ns JSON object in {path}")


def int_delta(end: dict[str, str], start: dict[str, str], key: str) -> int:
    return int(end[key]) - int(start[key])


def derive(record: dict[str, object]) -> dict[str, object]:
    tag = str(record["tag"])
    workload = first_workload_object(RAW / f"{tag}.stdout.jsonl")
    samples_ns = [int(value) for value in workload["samples_ns"]]
    if len(samples_ns) != 1:
        raise RuntimeError(f"{tag}: expected one -r 1 wall sample, got {samples_ns}")
    wall_s = samples_ns[0] / 1_000_000_000.0
    sampler_path = RAW / f"{tag}.sampler.csv"
    with sampler_path.open("r", encoding="utf-8", newline="") as handle:
        sampler_rows = list(csv.DictReader(handle))
    if len(sampler_rows) < 2:
        raise RuntimeError(f"{tag}: sampler needs at least 2 rows, got {len(sampler_rows)}")
    start = sampler_rows[0]
    end = sampler_rows[-1]
    utime_s = max(0, int_delta(end, start, "utime_ticks")) / HZ
    stime_s = max(0, int_delta(end, start, "stime_ticks")) / HZ
    compute_s = utime_s + stime_s
    read_mb = max(0, int_delta(end, start, "read_bytes")) / 1_000_000.0
    majflt = max(0, int_delta(end, start, "majflt"))
    psi_readable = any(
        row.get("psi_some_avg10") not in (None, "", "NA")
        or row.get("psi_full_avg10") not in (None, "", "NA")
        for row in sampler_rows
    )
    return {
        "n_prompt": int(record["n_prompt"]),
        "rep": int(record["rep"]),
        "cache_class": record["cache_class"],
        "tag": tag,
        "wall_s": wall_s,
        "utime_s": utime_s,
        "stime_s": stime_s,
        "compute_s": compute_s,
        "busy_fraction_8t": compute_s / (THREADS * wall_s),
        "utime_fraction_8t": utime_s / (THREADS * wall_s),
        "stime_fraction_8t": stime_s / (THREADS * wall_s),
        "stime_of_busy": stime_s / compute_s if compute_s else 0.0,
        "io_share_complement": 1.0 - compute_s / (THREADS * wall_s),
        "read_MB": read_mb,
        "MB_s": read_mb / wall_s,
        "majflt": majflt,
        "sampler_rows": len(sampler_rows),
        "psi_io_readable": psi_readable,
        "load_mode": workload.get("load_mode"),
        "no_repack": workload.get("no_repack"),
        "n_gpu_layers": workload.get("n_gpu_layers"),
        "model_filename": workload.get("model_filename"),
        "workload_json": f"raw/{tag}.stdout.jsonl",
        "sampler_csv": f"raw/{tag}.sampler.csv",
    }


def f(value: object, places: int = 6) -> str:
    return f"{float(value):.{places}f}"


def classify(ratio: float) -> str:
    if ratio >= 0.8:
        return "flash-bound"
    if ratio <= 0.5:
        return "compute-bound"
    return "mixed"


def parse_preflight() -> dict[str, object]:
    path = RAW / "preflight_device.txt"
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    def first_int(pattern: str) -> int | None:
        match = re.search(pattern, text, re.MULTILINE)
        return int(match.group(1)) if match else None
    return {
        "mem_total_kb": first_int(r"^MemTotal:\s+(\d+) kB"),
        "mem_available_kb": first_int(r"^MemAvailable:\s+(\d+) kB"),
        "data_available_kb": first_int(r"^/dev/\S+\s+\d+\s+\d+\s+(\d+)\s+93%"),
        "pressure_io_readable": bool(re.search(r"^some avg10=", text, re.MULTILINE) and re.search(r"^full avg10=", text, re.MULTILINE)),
    }


def battery_dict(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
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
        "ac_powered": boolean("AC powered"),
        "usb_powered": boolean("USB powered"),
        "wireless_powered": boolean("Wireless powered"),
        "dock_powered": boolean("Dock powered"),
    }


def main() -> None:
    records = json.loads((CELL / "run_records.json").read_text(encoding="utf-8"))
    metrics = [derive(record) for record in records]
    best_cell = max(float(row["MB_s"]) for row in metrics)
    for row in metrics:
        read_mb = float(row["read_MB"])
        compute_s = float(row["compute_s"])
        wall_s = float(row["wall_s"])
        io_floor = read_mb / best_cell
        io_floor_gate = read_mb / IO_GATE_SEQ_MEDIAN_MB_S
        row["io_floor_cell_s"] = io_floor
        row["io_floor_iogate_seqmedian_s"] = io_floor_gate
        row["headroom_cell_k2"] = wall_s / max(io_floor, compute_s / 2.0)
        row["headroom_cell_k4"] = wall_s / max(io_floor, compute_s / 4.0)
        row["headroom_cell_k8"] = wall_s / max(io_floor, compute_s / 8.0)
        row["headroom_iogate_k2"] = wall_s / max(io_floor_gate, compute_s / 2.0)
        row["headroom_iogate_k4"] = wall_s / max(io_floor_gate, compute_s / 4.0)
        row["headroom_iogate_k8"] = wall_s / max(io_floor_gate, compute_s / 8.0)
        row["io_floor_ratio_cell"] = io_floor / wall_s
        row["wording_cell"] = classify(io_floor / wall_s)
    pp512_warm = [row for row in metrics if row["n_prompt"] == 512 and row["cache_class"] == "warm"]
    pp512_ratio_median = sorted(float(row["io_floor_ratio_cell"]) for row in pp512_warm)[len(pp512_warm) // 2]
    pp512_ratio_mean = sum(float(row["io_floor_ratio_cell"]) for row in pp512_warm) / len(pp512_warm)
    pp512_wording = classify(pp512_ratio_median)
    max_temp_by_n: dict[str, int | None] = {}
    max_temp_all: int | None = None
    anomalies: list[str] = [
        "initial q60b_n128_r1 kalsahtp probe: rc=1 invalid parameter -nr; no model benchmark ran; guard normal",
        "q60b_final_n128_r1 #23 probe: rc=1 invalid parameter -lm; no model benchmark ran; guard normal",
    ]
    for record in records:
        tag = str(record["tag"])
        manifest_path = RAW / f"{tag}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
        max_temp = manifest.get("guard", {}).get("max_temperature_tenths") if isinstance(manifest.get("guard"), dict) else None
        if max_temp is None:
            guard_text = (RAW / f"{tag}.guard.log").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.guard.log").exists() else ""
            values = [int(match.group(1)) for match in re.finditer(r"^\d+,(\d+),", guard_text, re.MULTILINE)]
            max_temp = max(values) if values else None
        n_key = str(record["n_prompt"])
        max_temp_by_n[n_key] = max(max_temp_by_n.get(n_key) or 0, max_temp) if max_temp is not None else max_temp_by_n.get(n_key)
        max_temp_all = max(max_temp_all or 0, max_temp) if max_temp is not None else max_temp_all
        if manifest.get("guard_outcome") != "normal":
            anomalies.append(f"{tag}: guard_outcome={manifest.get('guard_outcome')}")
        if manifest.get("adb_disconnect"):
            anomalies.append(f"{tag}: adb_disconnect=true")
        if record.get("sampler_error") or record.get("sampler_pull_error"):
            anomalies.append(f"{tag}: sampler_error={record.get('sampler_error') or record.get('sampler_pull_error')}")
        if int(record.get("launcher_rc", -1)) != 0:
            anomalies.append(f"{tag}: launcher_rc={record.get('launcher_rc')}")
    if not all(bool(row["psi_io_readable"]) for row in metrics):
        anomalies.append("sampler: /proc/pressure/io unreadable in at least one run")
    if not anomalies:
        anomalies.append("none")
    preflight = parse_preflight()
    battery_start = battery_dict(RAW / f"{records[0]['tag']}.battery.pre.txt")
    battery_end = battery_dict(RAW / f"{records[-1]['tag']}.battery.post.txt")
    source_sampler = CELL.parent / "q60-streaming-prefill-amdahl" / "q60_sampler.sh"
    source_detach = CELL.parent / "q60-streaming-prefill-amdahl" / "q60_sampler_detach.sh"
    launch_path = CELL.parent / "q56-thermal-watchdog" / "launch_with_guard.py"
    guard_path = CELL.parent / "q56-thermal-watchdog" / "thermal_guard.sh"
    manifest = {
        "cell": "q60b-s23-streaming-floor",
        "prereg_lock": "9e2b6b36",
        "completed_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "device": {
            "model": "Galaxy S23",
            "soc": "v73",
            "storage": "UFS 3.1",
            "ro_serialno": "R3CW406P8CV",
            "mdns_serial": "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp",
            "active_serial": "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp",
            "direct_endpoint_seen": "192.168.1.152:36269",
            "wireless": True,
            "reconnects": 0,
        },
        "inventory": {
            **preflight,
            "initial_snapshot_mem_total_kb": INITIAL_MEM_TOTAL_KB,
            "initial_snapshot_mem_available_kb": INITIAL_MEM_AVAILABLE_KB,
            "data_use_pct": 93,
            "ggufs": [
                {"path": "/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf", "bytes": 3326160384},
                {"path": "/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf", "bytes": 4213513024},
                {"path": "/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf", "bytes": 10505424704},
                {"path": "/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf", "bytes": 2583221408},
                {"path": MODEL_PATH, "bytes": MODEL_BYTES},
                {"path": "/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf", "bytes": 3580407296},
                {"path": "/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf", "bytes": 3928037856},
            ],
            "inventory_model_hash_before_idle": MODEL_SHA256,
        },
        "selected_model": {"path": MODEL_PATH, "bytes": MODEL_BYTES, "sha256": MODEL_SHA256, "larger_than_mem_available": True},
        "selected_binary": {"path": "/data/local/tmp/s3oracle/llama-bench", "bytes": BENCH_BYTES, "sha256": BENCH_SHA256, "libllama_bench_impl_sha256": BENCH_IMPL_SHA256, "library_dir": "/data/local/tmp/s3oracle", "mmap": True, "no_repack": True},
        "flags": "-p N -n 0 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 -mmp 1 -nr (legacy mmap alias; canonical boolean no-repack)",
        "forbidden_flags_absent": ["-dev HTP0", "-ngl 99"],
        "guard": {"warn_tenths": 400, "kill_tenths": 430, "interval_s": 1, "sensor_failure_limit": 4, "session_hard_cap_tenths": 0, "battery_floor_pct": 45, "launch_guard_min_pct": 50, "cool_start_tenths": 320, "thermal_guard_sha256": sha256(guard_path), "launch_with_guard_sha256": sha256(launch_path)},
        "sampler": {"source": "q60_sampler.sh exact logic, executed inline on-device; no push", "interval_s": 1, "clock_ticks_per_second": HZ, "sampler_sha256": sha256(source_sampler), "sampler_detach_sha256": sha256(source_detach), "pressure_io_readable": all(bool(row["psi_io_readable"]) for row in metrics)},
        "cold_protocol": {"hash_before_idle": True, "idle_after_hash_s": 600, "rep1_cold_designated": True, "rep2_rep3_warm": True, "per_n_rep1_idle_s": 600, "no_model_eviction": True},
        "battery_start": battery_start,
        "battery_end": battery_end,
        "io_gate_reference": {"seq_median_MB_s": IO_GATE_SEQ_MEDIAN_MB_S, "seq_best_MB_s": IO_GATE_SEQ_BEST_MB_S, "comparable": IO_GATE_COMPARABLE, "source": "results/io_gate/s23_ufs31/summary.txt"},
        "metrics": metrics,
        "best_sustained_cell_MB_s": best_cell,
        "pp512_warm_io_floor_ratio_cell_mean": pp512_ratio_mean,
        "pp512_warm_io_floor_ratio_cell_median": pp512_ratio_median,
        "pp512_warm_wording": pp512_wording,
        "max_temperature_tenths_by_n": max_temp_by_n,
        "max_temperature_tenths_all": max_temp_all,
        "anomalies": anomalies,
        "run_records": records,
    }
    (CELL / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")

    lines = [
        "# q60b numbers",
        "",
        "| n | rep | cache | wall_s | utime_s | stime_s | busy_frac_8t | stime_frac_8t | stime_of_busy | read_MB | MB/s | majflt |",
        "|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        lines.append(f"| {row['n_prompt']} | {row['rep']} | {row['cache_class']} | {f(row['wall_s'])} | {f(row['utime_s'])} | {f(row['stime_s'])} | {f(row['busy_fraction_8t'])} | {f(row['stime_fraction_8t'])} | {f(row['stime_of_busy'])} | {f(row['read_MB'], 3)} | {f(row['MB_s'], 3)} | {row['majflt']} |")
    lines += [
        "",
        "| n | rep | io_floor_cell_s | io_floor_iogate_seqmedian_s | headroom_cell_k2 | headroom_cell_k4 | headroom_cell_k8 | headroom_iogate_k2 | headroom_iogate_k4 | headroom_iogate_k8 |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        lines.append(f"| {row['n_prompt']} | {row['rep']} | {f(row['io_floor_cell_s'])} | {f(row['io_floor_iogate_seqmedian_s'])} | {f(row['headroom_cell_k2'])} | {f(row['headroom_cell_k4'])} | {f(row['headroom_cell_k8'])} | {f(row['headroom_iogate_k2'])} | {f(row['headroom_iogate_k4'])} | {f(row['headroom_iogate_k8'])} |")
    lines += [
        "",
        f"best_sustained_cell_MB_s = {best_cell:.6f}",
        f"io_gate_seq_median_MB_s = {IO_GATE_SEQ_MEDIAN_MB_S:.6f}",
        f"io_gate_seq_best_MB_s = {IO_GATE_SEQ_BEST_MB_S:.6f}",
        f"pp512_warm_io_floor_ratio_mean = {pp512_ratio_mean:.6f}",
        f"pp512_warm_io_floor_ratio_median = {pp512_ratio_median:.6f}",
        f"pp512_warm_wording = {pp512_wording}",
        f"max_temperature_C_n128 = {None if max_temp_by_n.get('128') is None else max_temp_by_n['128'] / 10:.1f}",
        f"max_temperature_C_n512 = {None if max_temp_by_n.get('512') is None else max_temp_by_n['512'] / 10:.1f}",
        f"max_temperature_C_n2048 = {None if max_temp_by_n.get('2048') is None else max_temp_by_n['2048'] / 10:.1f}",
        f"max_temperature_C_all = {None if max_temp_all is None else max_temp_all / 10:.1f}",
        f"battery_start_pct = {battery_start.get('level')}",
        f"battery_end_pct = {battery_end.get('level')}",
    ]
    (CELL / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    run_lines = [
        "# q60b RUN_LOG",
        "",
        "cell=q60b-s23-streaming-floor",
        "prereg_lock=9e2b6b36",
        "device=Galaxy S23 / v73 / UFS 3.1",
        "serial=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp",
        "direct_endpoint_seen=192.168.1.152:36269",
        "wireless=1; unplugged=1; no_model_push=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0",
        f"initial_inventory_mem_total_kb={INITIAL_MEM_TOTAL_KB}; initial_inventory_mem_available_kb={INITIAL_MEM_AVAILABLE_KB}; run_start_mem_total_kb={preflight.get('mem_total_kb')}; run_start_mem_available_kb={preflight.get('mem_available_kb')}; data_use_pct=93",
        f"selected_model={MODEL_PATH}; bytes={MODEL_BYTES}; sha256={MODEL_SHA256}; larger_than_mem_available=1",
        f"selected_binary=/data/local/tmp/s3oracle/llama-bench; bytes={BENCH_BYTES}; sha256={BENCH_SHA256}; LD_LIBRARY_PATH=/data/local/tmp/s3oracle; -ngl=0; -mmp=1 (mmap); -nr (canonical boolean no-repack)",
        "cold_protocol=hash model before idle; >=600 s no-touch idle; rep1=cold-designated; reps2-3=warm; separate -r 1 launch and sampler CSV per rep",
        "guard_invocation=WARN 400 / KILL 430 / interval 1 s / sensor_failure_limit 4 / session_hard_cap 0",
        "sampler=q60_sampler.sh exact logic inline on-device; utime+stime, majflt, read_bytes, /proc/pressure/io; no sampler push",
        "workload=-p N -n 0 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 -mmp 1 -nr",
        "npu_flags=absent; -dev HTP0=absent; -ngl 99=absent",
        "cool_gate=<=32.0 C; 60 s polls; battery >=45%; q56 launch precheck >=50%; unplugged",
        "",
        "## run order",
    ]
    for row, record in zip(metrics, records):
        run_lines.append(f"{record['tag']} pre_level={record.get('battery_pre', {}).get('level')} pre_temp_C={None if record.get('battery_pre', {}).get('temperature_tenths') is None else record['battery_pre']['temperature_tenths'] / 10:.1f} post_level={record.get('battery_post', {}).get('level')} post_temp_C={None if record.get('battery_post', {}).get('temperature_tenths') is None else record['battery_post']['temperature_tenths'] / 10:.1f} wall_s={row['wall_s']:.6f} busy_frac={row['busy_fraction_8t']:.6f} stime_s={row['stime_s']:.3f} read_MB={row['read_MB']:.3f} MB_s={row['MB_s']:.3f} majflt={row['majflt']} guard_manifest=raw/{record['tag']}.manifest.json")
    run_lines += [
        "",
        "## analysis",
        f"best_sustained_cell_MB_s={best_cell:.6f}",
        f"io_gate_seq_median_MB_s={IO_GATE_SEQ_MEDIAN_MB_S:.6f}; seq_best_MB_s={IO_GATE_SEQ_BEST_MB_S:.6f}; comparable={int(IO_GATE_COMPARABLE)}",
        f"headroom=wall/max(io_floor,compute_s/k), k=2,4,8; compute_s=utime_s+stime_s; stime_reported_separately=1",
        f"pp512_warm_wording={pp512_wording}; pp512_warm_io_floor_ratio_mean={pp512_ratio_mean:.6f}; median={pp512_ratio_median:.6f}",
        f"max_temperature_C={None if max_temp_all is None else max_temp_all / 10:.1f}; battery_start_pct={battery_start.get('level')}; battery_end_pct={battery_end.get('level')}",
        f"pressure_io_readable={int(all(bool(row['psi_io_readable']) for row in metrics))}",
        "anomalies=" + "; ".join(anomalies),
    ]
    (CELL / "RUN_LOG.md").write_text("\n".join(run_lines) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"metrics": metrics, "pp512_warm_wording": pp512_wording, "anomalies": anomalies}, indent=2))


MODEL_PATH = "/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf"


if __name__ == "__main__":
    main()
