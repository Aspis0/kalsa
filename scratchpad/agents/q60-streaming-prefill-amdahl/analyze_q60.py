from __future__ import annotations

import csv
import json
import math
import shutil
from pathlib import Path


CELL = Path(__file__).resolve().parent
RAW = CELL / "raw"
HZ = 100
THREADS = 8

RUNS = [
    (128, "q60_pp128_20260825_1"),
    (512, "q60_pp512_20260825_1"),
    (2048, "q60_pp2048_20260825_1"),
]

GGUFS = [
    {"path": "/data/local/tmp/llamabench/Qwen3.5-2B-Q4_K_M.gguf", "bytes": 1280835840, "sha256": "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223"},
    {"path": "/data/local/tmp/llamabench/Qwen3.5-2B-Q4_0.gguf", "bytes": 1214873856, "sha256": "cd70221bebaee0503e0f6717e174250cd7825aa88438b3aabec9ad55731d9bb1"},
    {"path": "/data/local/tmp/llamabench/Qwen3.5-4B-Q4_K_M.gguf", "bytes": 2834975040, "sha256": "3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630"},
    {"path": "/data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf", "bytes": 1674454848, "sha256": "79fdf00351b46cf26f020aead28d01889886be87c55fa0eb907e6f9b00bfee14"},
    {"path": "/data/local/tmp/llamabench/LFM2.5-1.2B-Instruct-Q4_K_M.gguf", "bytes": 730895168, "sha256": "b1b3de114215d9507409a662a501a631095a479a419584e8a2ded6304b19b4f5"},
    {"path": "/data/local/tmp/llamabench/LFM2.5-2.6B-QAD-Q4_0.gguf", "bytes": 1593894944, "sha256": "a247afd6414918eac8e520e9a6137dc271235461ecbe1180462221d5b8d40b03"},
    {"path": "/data/local/tmp/LFM2.5-8B-A1B-Q4_K_M.gguf", "bytes": 5155564768, "sha256": "4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0"},
    {"path": "/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf", "bytes": 10505424704, "sha256": "a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc"},
    {"path": "/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf", "bytes": 3326160384, "sha256": "9638a381f31fab658af2c8926181d8ced432c4179139904aefc648d75d8d84fd"},
]

BINARIES = [
    {"path": "/data/local/tmp/llamabench/llama-bench", "bytes": 121472048, "sha256": "c61b2457f66419677a411f93bbadd6c15a43235fd905013b59eadcdf70a733a4", "selected": True},
    {"path": "/data/local/tmp/llamabench-vk/llama-bench", "bytes": 159329952, "sha256": "ac41368525404f7eea95098424ad20eb177a4536e091c37e88870722ac245b29", "selected": False},
    {"path": "/data/local/tmp/llamabench-aff/llama-bench", "bytes": 121458184, "sha256": "450f945d7e250e0e42ae8882fcb3990cdad2b0a487bb5e404ebc4ea40d159566", "selected": False},
    {"path": "/data/local/tmp/llamabench-kai/baseline/llama-bench", "bytes": 121450152, "sha256": "8d3e289dcb7286c060cbd2b7cb58f2bb3deb020ece5b1c2d307efc5f23e47758", "selected": False},
    {"path": "/data/local/tmp/llamabench-kai/kleidi/llama-bench", "bytes": 121815920, "sha256": "4486f2d78f6e0b2ba44c45fe274f46f1ddb780d4bcffe5d44947db821419ff7a", "selected": False},
    {"path": "/data/local/tmp/kalsa26/vk/llama-bench", "bytes": 7592, "sha256": "b4e9476ee03f270c85d0e9eb2dd578089756075d131dd058456bb039182c7b21", "selected": False},
    {"path": "/data/local/tmp/kalsa26/ocl2/llama-bench", "bytes": 7568, "sha256": "e3ab93f14d88bf9e6509cff5ddb6cdf17cb389ffc3526c4ff19588a0d1aab0e9", "selected": False},
]


def num(value: str) -> float:
    return float(value)


def ticks(row: dict[str, str]) -> int:
    return int(row["utime_ticks"]) + int(row["stime_ticks"])


def delta(end: dict[str, str], start: dict[str, str], field: str) -> int:
    return int(end[field]) - int(start[field])


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "epoch", "uptime_s", "utime_ticks", "stime_ticks", "majflt", "read_bytes",
            "psi_some_avg10", "psi_some_total", "psi_full_avg10", "psi_full_total",
        ], lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def derive_run(n_prompt: int, tag: str) -> tuple[list[dict[str, object]], dict[str, object]]:
    jsonl_path = RAW / f"{tag}.stdout.jsonl"
    data = json.loads(jsonl_path.read_text(encoding="utf-8").strip().splitlines()[0])
    walls = [int(ns) / 1_000_000_000 for ns in data["samples_ns"]]
    all_path = RAW / f"{tag}.all.csv"
    with all_path.open("r", encoding="utf-8", newline="") as handle:
        all_rows = list(csv.DictReader(handle))
    if not all_rows:
        raise RuntimeError(f"no sampler rows: {all_path}")
    first_uptime = num(all_rows[0]["uptime_s"])
    elapsed = [num(row["uptime_s"]) - first_uptime for row in all_rows]
    boundaries = [0.0]
    for wall in walls:
        boundaries.append(boundaries[-1] + wall)

    metrics: list[dict[str, object]] = []
    for rep, wall in enumerate(walls, start=1):
        start_t = boundaries[rep - 1]
        end_t = boundaries[rep]
        start_indices = [index for index, value in enumerate(elapsed) if value <= start_t]
        end_indices = [index for index, value in enumerate(elapsed) if value < end_t]
        if not end_indices:
            raise RuntimeError(f"no sampler rows for {tag} rep {rep}")
        start_index = start_indices[-1] if start_indices else 0
        end_index = end_indices[-1]
        if end_index <= start_index:
            end_index = min(start_index + 1, len(all_rows) - 1)
        rep_rows = all_rows[start_index:end_index + 1]
        rep_path = RAW / f"{tag}.rep{rep}.sampler.csv"
        write_csv(rep_path, rep_rows)
        start_row = all_rows[start_index]
        end_row = all_rows[end_index]
        cpu_s = max(0.0, delta(end_row, start_row, "utime_ticks") + delta(end_row, start_row, "stime_ticks")) / HZ
        compute_share = max(0.0, min(1.0, cpu_s / (THREADS * wall)))
        read_mb = max(0, delta(end_row, start_row, "read_bytes")) / 1_000_000
        majflt = max(0, delta(end_row, start_row, "majflt"))
        metrics.append({
            "n_prompt": n_prompt,
            "rep": rep,
            "cache_class": "cold-designated" if rep == 1 else "warm",
            "wall_s": wall,
            "compute_cpu_s": cpu_s,
            "compute_share": compute_share,
            "io_share": 1.0 - compute_share,
            "read_MB": read_mb,
            "MB_s": read_mb / wall,
            "majflt": majflt,
            "sampler_rows": len(rep_rows),
            "sampler_start_index": start_index,
            "sampler_end_index": end_index,
        })
    return metrics, data


def fmt(value: float, places: int = 3) -> str:
    return f"{value:.{places}f}"


def main() -> None:
    all_metrics: list[dict[str, object]] = []
    json_objects: dict[str, dict[str, object]] = {}
    for n_prompt, tag in RUNS:
        metrics, data = derive_run(n_prompt, tag)
        all_metrics.extend(metrics)
        json_objects[tag] = data

    pp512_warm = [row for row in all_metrics if row["n_prompt"] == 512 and row["cache_class"] == "warm"]
    warm_mean = sum(float(row["compute_share"]) for row in pp512_warm) / len(pp512_warm)
    warm_median = sorted(float(row["compute_share"]) for row in pp512_warm)[len(pp512_warm) // 2]
    if warm_mean >= 0.50:
        rule = "GO as phase 2 of the HVX K-quant project (NPU-for-streaming ceiling >= 2x)."
    elif warm_mean < 0.30:
        rule = "I/O-bound: NPU cannot help streaming prefill; drop."
    else:
        rule = "Owner decision: compute share in 0.30-0.50 band (ceiling 1.4-2x)."

    run_max_temps = {}
    for _, tag in RUNS:
        manifest = json.loads((RAW / f"{tag}.manifest.json").read_text(encoding="utf-8"))
        run_max_temps[tag] = manifest["guard"]["max_temperature_tenths"]

    manifest = {
        "cell": "q60-streaming-prefill-amdahl",
        "prereg_lock": "14b23056",
        "device": {
            "serial": "192.168.1.82:34037",
            "model": "Jelly Star",
            "soc_manufacturer": "Mediatek",
            "soc_model": "MT6789",
            "logical_cpus": 8,
        },
        "inventory": {
            "mem_total_kb": 7968548,
            "mem_available_kb": 5543816,
            "data_available_kb": 109947916,
            "battery_level_pct_start": 75,
            "battery_temperature_tenths_c_start": 240,
            "plugged": False,
            "ac_powered": False,
            "usb_powered": False,
            "wireless_powered": False,
            "ggufs": GGUFS,
            "llama_bench_binaries": BINARIES,
        },
        "selected_model": {
            "path": "/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf",
            "bytes": 10505424704,
            "sha256": "a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc",
            "streaming_regime": True,
            "model_note": "resident Marco-Mini MoE; 256 experts, native k=6",
        },
        "selected_binary": {
            "path": "/data/local/tmp/llamabench/llama-bench",
            "bytes": 121472048,
            "sha256": "c61b2457f66419677a411f93bbadd6c15a43235fd905013b59eadcdf70a733a4",
            "no_repack_flag": "-nr 1",
            "load_mode": "mmap",
        },
        "flags": "-p N -n 0 -r 3 --no-warmup -t 8 -o jsonl -ngl 0 -lm mmap -nr 1 (flash_attn default auto; -fa off rejected by this build)",
        "guard": {
            "warn_tenths": 400,
            "kill_tenths": 430,
            "sensor_failure_limit": 4,
            "interval_s": 10,
            "sensor_timeout_s": 10,
            "thermal_guard_sha256": "f8b664194d7eae7d04ebb3bba8745769cbd79777796803d25eed7974e9bda84c",
            "launch_with_guard_sha256": "64ef5fb808b7bd2784555b54db3c395aecd1d85021e568c948d1f07b7f783b40",
        },
        "sampler": {
            "interval_s": 1,
            "clock_ticks_per_second": HZ,
            "sampler_sha256": "1d20d9f37f4b2e11989526a414a12be8914daa160317f192185451719579766c",
            "sampler_detach_sha256": "9ebbab9a4610f1c05eefe0928ab2f35de38f8e1262c2d49793aab6517841065e",
            "pressure_io_readable": False,
        },
        "wake_state": {
            "original_mWakefulness": "Awake",
            "original_mStayOn": False,
            "original_mStayOnWhilePluggedInSetting": 7,
            "action": "svc power stayon true plus input keyevent 224 heartbeat",
            "restore": "settings put global stay_on_while_plugged_in 7",
        },
        "cold_cache_method": "No unrelated file >= MemTotal existed; pp512 and pp2048 launches were preceded by explicit 30 s relaunch-after-cooldown intervals, while pp128 followed inventory/guard setup; rep1 is cold-designated and reps2-3 warm within each -r3 process. Inventory sha256sum necessarily read the selected model before measurement, so cold designation is not an empty-page-cache guarantee.",
        "runs": {
            tag: {
                "n_prompt": n,
                "jsonl": f"raw/{tag}.stdout.jsonl",
                "stderr": f"raw/{tag}.stderr.log",
                "sampler_all": f"raw/{tag}.all.csv",
                "guard_max_temperature_tenths": run_max_temps[tag],
                "json": json_objects[tag],
            }
            for n, tag in RUNS
        },
        "derived": {
            "metrics": all_metrics,
            "pp512_warm_compute_share_mean": warm_mean,
            "pp512_warm_compute_share_median": warm_median,
            "rule_outcome": rule,
        },
    }
    (CELL / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")

    report_lines = [
        "# q60 numbers",
        "",
        "| n | rep | cache | wall_s | compute_share | io_share | read_MB | MB/s | majflt |",
        "|---:|---:|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in all_metrics:
        report_lines.append(
            f"| {row['n_prompt']} | {row['rep']} | {row['cache_class']} | {fmt(float(row['wall_s']), 6)} | {fmt(float(row['compute_share']), 6)} | {fmt(float(row['io_share']), 6)} | {fmt(float(row['read_MB']), 3)} | {fmt(float(row['MB_s']), 3)} | {row['majflt']} |"
        )
    report_lines += [
        "",
        f"pp512 warm compute_share mean = {warm_mean:.6f}",
        f"pp512 warm compute_share median = {warm_median:.6f}",
        f"rule = {rule}",
        "",
        "max_temperature_C: pp128=28.0; pp512=30.0; pp2048=36.0",
    ]
    (CELL / "REPORT.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8", newline="\n")

    print(json.dumps({"metrics": all_metrics, "pp512_warm_mean": warm_mean, "pp512_warm_median": warm_median, "rule": rule}, indent=2))


if __name__ == "__main__":
    main()
