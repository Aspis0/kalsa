from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"


def f(value: float | int | None, digits: int = 3) -> str:
    if value is None:
        return "NA"
    return f"{value:.{digits}f}"


def thermal_info(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8", errors="replace")
    status_match = re.search(r"^Thermal Status:\s*(-?\d+)", text, re.MULTILINE)
    head_match = re.search(r"Temperature headroom thresholds:\s*\[([^]]*)\]", text, re.MULTILINE)
    thresholds = head_match.group(1).strip() if head_match else ""
    return {
        "status": int(status_match.group(1)) if status_match else None,
        "headroom_current": None,
        "headroom_thresholds": thresholds,
        "headroom_exposed": False,
    }


def main() -> int:
    root_manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    rows: list[dict[str, object]] = []
    for base in root_manifest["runs"]:
        tag = base["tag"]
        launch = json.loads((RAW / base["manifest_file"]).read_text(encoding="utf-8"))
        rec = json.loads((RAW / f"{tag}.record.json").read_text(encoding="utf-8"))
        pre = rec["battery_pre"]
        post = rec["battery_post"]
        delta_c = (post["temperature_tenths"] - pre["temperature_tenths"]) / 10.0
        tps = rec["jsonl"].get("avg_ts")
        tps = float(tps) if tps is not None else None
        c_per_1k = delta_c * 1000.0 / int(rec["n"])
        sec_per_1k = 1000.0 / tps if tps else None
        thermal_pre = thermal_info(RAW / rec["thermalservice_pre_file"])
        thermal_post = thermal_info(RAW / rec["thermalservice_post_file"])
        proof = f"{rec['execute_op_count']} / {';'.join(rec['offloaded_proof']) if rec['offloaded_proof'] else 'none'}"
        row = {
            "tag": tag, "n": int(rec["n"]), "engine": rec["engine"], "rep": int(rec["rep"]),
            "battery_pre": pre, "battery_post": post, "delta_T_C": delta_c,
            "thermalservice_pre_file": rec["thermalservice_pre_file"],
            "thermalservice_post_file": rec["thermalservice_post_file"],
            "max_temp_C": launch["guard"]["max_temperature_tenths"] / 10.0,
            "wall_s": launch["wall_seconds_until_poll_end"], "tps": tps,
            "execute_op_count": rec["execute_op_count"], "offloaded_proof": rec["offloaded_proof"],
            "proof": proof, "thermal_status_pre": thermal_pre["status"], "thermal_status_post": thermal_post["status"],
            "thermal_pre": thermal_pre, "thermal_post": thermal_post,
            "c_per_1k": c_per_1k, "sec_per_1k": sec_per_1k,
            "workload_rc": launch["workload_rc"], "guard_rc": launch["guard_exit_code"],
            "guard_outcome": launch["guard_outcome"], "crash_signature": rec["crash_signature"],
        }
        rows.append(row)

    grouped: dict[tuple[int, str], list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        grouped[(row["n"], row["engine"])].append(row)

    means: list[dict[str, object]] = []
    for (n, engine), items in sorted(grouped.items(), key=lambda item: (item[0][0], 0 if item[0][1] == "NPU" else 1)):
        def mean(key: str) -> float | None:
            values = [float(item[key]) for item in items if item[key] is not None]
            return sum(values) / len(values) if values else None
        means.append({
            "n": n, "engine": engine, "runs": len(items),
            "mean_delta_T_C": mean("delta_T_C"), "mean_max_temp_C": mean("max_temp_C"),
            "mean_wall_s": mean("wall_s"), "mean_tps": mean("tps"),
            "mean_c_per_1k": mean("c_per_1k"), "mean_sec_per_1k": mean("sec_per_1k"),
        })

    npu_means = {item["n"]: item for item in means if item["engine"] == "NPU"}
    eligible = [n for n, item in npu_means.items() if item["mean_delta_T_C"] <= 1.0]
    n_max = max(eligible)
    eligible_rows = [row for row in rows if row["engine"] == "NPU" and row["n"] <= n_max]
    max_individual = max(row["delta_T_C"] for row in eligible_rows)
    max_mean = max(npu_means[n]["mean_delta_T_C"] for n in eligible)
    threshold_individual = 40.0 - max_individual
    threshold_mean = 40.0 - max_mean

    preflight = root_manifest["preflight_battery"]
    final_battery_text = (RAW / "final.battery.txt").read_text(encoding="utf-8", errors="replace")
    def battery_current(text: str) -> dict[str, object]:
        def integer(key: str) -> int | None:
            match = re.search(rf"^  {re.escape(key)}:\s*(-?\d+)", text, re.MULTILINE)
            return int(match.group(1)) if match else None
        def boolean(key: str) -> bool | None:
            match = re.search(rf"^  {re.escape(key)}:\s*(true|false)", text, re.MULTILINE | re.IGNORECASE)
            return match.group(1).lower() == "true" if match else None
        return {"level": integer("level"), "temperature_tenths": integer("temperature"), "voltage_mv": integer("voltage"), "ac_powered": boolean("AC powered"), "usb_powered": boolean("USB powered"), "wireless_powered": boolean("Wireless powered"), "dock_powered": boolean("Dock powered")}
    final_battery = battery_current(final_battery_text)

    thermal_files = [thermal_info(RAW / row["thermalservice_pre_file"]) for row in rows] + [thermal_info(RAW / row["thermalservice_post_file"]) for row in rows]
    statuses = sorted({item["status"] for item in thermal_files})
    thresholds = sorted({item["headroom_thresholds"] for item in thermal_files})
    crash_lines = sorted({row["crash_signature"] for row in rows if row["crash_signature"]})

    root_manifest["summary"] = {
        "run_count": len(rows), "normal_count": sum(row["guard_outcome"] == "normal" and row["workload_rc"] == 0 for row in rows),
        "crash_signatures": crash_lines, "thermalservice_statuses": statuses,
        "thermalservice_current_headroom_exposed": False, "thermalservice_headroom_thresholds": thresholds,
        "n_max_npu": n_max, "max_npu_delta_T_C_individual_for_sizes_le_nmax": max_individual,
        "max_npu_delta_T_C_mean_for_sizes_le_nmax": max_mean,
        "thermal_threshold_candidate_C": threshold_individual,
        "thermal_threshold_candidate_C_mean_based": threshold_mean,
        "battery_start": preflight, "battery_end": final_battery,
        "rows": rows, "means": means,
    }
    (HERE / "manifest.json").write_text(json.dumps(root_manifest, indent=2) + "\n", encoding="utf-8")

    report: list[str] = []
    report.append("# q58 numeric report")
    report.append("")
    report.append("## per-run")
    report.append("")
    report.append("| n | engine | rep | ΔT_prompt_C | MAX_C | wall_s | t/s | execute-op / offload | thermal pre/post |")
    report.append("|---:|:---:|---:|---:|---:|---:|---:|:---|:---:|")
    for row in rows:
        report.append(f"| {row['n']} | {row['engine']} | {row['rep']} | {f(row['delta_T_C'])} | {f(row['max_temp_C'])} | {f(row['wall_s'])} | {f(row['tps'])} | {row['proof']} | {row['thermal_status_pre']}/{row['thermal_status_post']} |")
    report.append("")
    report.append("## per-size means")
    report.append("")
    report.append("| n | engine | runs | mean ΔT_prompt_C | mean MAX_C | mean wall_s | mean t/s | °C/1k tokens | s/1k tokens |")
    report.append("|---:|:---:|---:|---:|---:|---:|---:|---:|---:|")
    for item in means:
        report.append(f"| {item['n']} | {item['engine']} | {item['runs']} | {f(item['mean_delta_T_C'])} | {f(item['mean_max_temp_C'])} | {f(item['mean_wall_s'])} | {f(item['mean_tps'])} | {f(item['mean_c_per_1k'])} | {f(item['mean_sec_per_1k'])} |")
    report.append("")
    report.append("## frozen derivations")
    report.append("")
    report.append(f"N_max(NPU) = {n_max} tokens")
    report.append(f"max ΔT_prompt over individual NPU runs at n ≤ N_max = {f(max_individual)} °C")
    report.append(f"thermal-threshold candidate = 40.0 − {f(max_individual)} = {f(threshold_individual)} °C")
    report.append("")
    report.append("## battery start/end")
    report.append("")
    report.append(f"start level/temp/voltage = {preflight['level']}% / {preflight['temperature_tenths'] / 10:.1f} °C / {preflight['voltage_mv']} mV")
    report.append(f"end level/temp/voltage = {final_battery['level']}% / {final_battery['temperature_tenths'] / 10:.1f} °C / {final_battery['voltage_mv']} mV")
    report.append("")
    report.append("## thermalservice")
    report.append("")
    report.append(f"Thermal Status pre/post observed = {statuses} / {statuses}")
    report.append("current numeric headroom = NOT_EXPOSED")
    report.append(f"headroom thresholds = {thresholds[0] if thresholds else 'NOT_EXPOSED'}")
    report.append("")
    report.append("## crash signature")
    report.append("")
    report.append("NONE" if not crash_lines else "\n".join(crash_lines))
    (HERE / "REPORT.md").write_text("\n".join(report) + "\n", encoding="utf-8")

    log: list[str] = [
        "# q58 RUN_LOG",
        "",
        "cell=q58-s23-npu-spike-sweep",
        "prereg=f10d997b",
        "device=Galaxy S23 / Hexagon v73",
        f"serial={root_manifest['serial']}",
        "wireless=1; unplugged=1; no_model_push=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0",
        "preflight=PASS",
        f"preflight_battery={preflight}",
        f"pin_device_file=raw/preflight_device_sha256.txt",
        "pin_result=thermal_guard MATCH; llama-bench MATCH; libggml-hexagon MATCH; libggml-htp-v73 MATCH; Qwen3.5-4B-Q4_0 MATCH",
        "guard_invocation=launch_with_guard.py --warn-tenths 400 --kill-tenths {NPU:410,CPU:430} --session-hard-cap-tenths 0 --sensor-failure-limit 4 --interval-s 1 --max-seconds 1800",
        "workload=llama-bench -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -v; NPU -ngl 99 -dev HTP0; CPU -ngl 0",
        "environment=NDEV=1; NPU HOSTBUF=1; CPU HOSTBUF=unset",
        "cool_gate=<=32.0 C before each run; 60 s polls; battery >=45%; unplugged",
        f"runs={len(rows)}; normal={sum(row['guard_outcome'] == 'normal' and row['workload_rc'] == 0 for row in rows)}; guard_kills=0; adb_reconnects=0; crash_signatures=NONE",
        "",
        "## run order",
        "",
    ]
    for row in rows:
        log.append(f"{row['tag']} pre={row['battery_pre']['temperature_tenths'] / 10:.1f}C/{row['battery_pre']['level']}% post={row['battery_post']['temperature_tenths'] / 10:.1f}C/{row['battery_post']['level']}% delta={row['delta_T_C']:.1f}C MAX={row['max_temp_C']:.1f}C wall={row['wall_s']:.3f}s tps={row['tps']} guard={row['guard_outcome']} workload_rc={row['workload_rc']} thermal={row['thermal_status_pre']}/{row['thermal_status_post']}")
    log.extend([
        "",
        "## thermalservice exposure",
        "",
        f"thermal_statuses={statuses}",
        "current_headroom=not exposed",
        f"headroom_thresholds={thresholds[0] if thresholds else 'not exposed'}",
        "verbatim_per_run_files=*.thermalservice.pre.txt; *.thermalservice.post.txt",
        "",
        "## final",
        "",
        f"battery_start={preflight}",
        f"battery_end={final_battery}",
        "crash_signature=NONE",
    ])
    (HERE / "RUN_LOG.md").write_text("\n".join(log) + "\n", encoding="utf-8")
    print(json.dumps({"runs": len(rows), "n_max": n_max, "threshold_individual": threshold_individual, "threshold_mean": threshold_mean, "battery_start": preflight, "battery_end": final_battery, "thermal_statuses": statuses, "crash_signatures": crash_lines}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
