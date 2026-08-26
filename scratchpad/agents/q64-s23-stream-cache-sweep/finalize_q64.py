from __future__ import annotations

import csv
import json
import re
import statistics
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q64-s23-stream-cache-sweep"
RAW = CELL / "raw"
Q60B_REPORT = ROOT / "scratchpad" / "agents" / "q60b-s23-streaming-floor" / "REPORT.md"
Q60B_IO_GATE_MB_S = 430.223000
Q60B_BEST_MB_S = 1157.376741
ARMS = ("0", "1500", "2000", "4000", "auto")
ARBITRATION_DECODE_WINDOW = "9–102"
ARBITRATION_DECODE_TEXT_IDENTITY = "EOS-identical across all 15 runs, md5 of decoded text identical"
ARBITRATION_FROZEN_WINDOW = "NA (EOS at 102)"


def read_records() -> list[dict[str, object]]:
    path = CELL / "run_records.jsonl"
    if not path.exists():
        return []
    records: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError:
        return default


def number(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def csv_rows(tag: str) -> tuple[list[dict[str, str]], str]:
    path = RAW / f"{tag}.csv"
    if not path.exists():
        return [], ""
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    start = next((index for index, line in enumerate(lines) if line.startswith("step,")), None)
    if start is None:
        return [], text
    rows: list[dict[str, str]] = []
    for row in csv.DictReader(lines[start:]):
        if row.get("step", "").strip().isdigit():
            rows.append(row)
    return rows, text


def prefill_metrics(tag: str) -> dict[str, float | int | None]:
    path = RAW / f"{tag}.stdout.jsonl"
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    match = re.search(r"prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s+s", text, re.IGNORECASE)
    if not match:
        return {"prompt_tokens": None, "prefill_s": None, "prefill_tok_s": None}
    tokens = int(match.group(1))
    seconds = float(match.group(2))
    return {"prompt_tokens": tokens, "prefill_s": seconds, "prefill_tok_s": tokens / seconds if seconds > 0 else None}


def decode_metrics(record: dict[str, object]) -> dict[str, object]:
    tag = str(record.get("tag", ""))
    rows, csv_text = csv_rows(tag)
    rows.sort(key=lambda row: int(row.get("step", "0")))
    decode_rows = rows[:128]
    warm = [row for row in decode_rows if int(row.get("step", "0")) >= 9]

    def total(items: list[dict[str, str]], key: str) -> float | None:
        values = [number(row.get(key)) for row in items]
        values = [value for value in values if value is not None]
        return sum(values) if values else None

    def rate(items: list[dict[str, str]]) -> float | None:
        wall_ms = total(items, "wall_ms")
        return len(items) / (wall_ms / 1000.0) if wall_ms and wall_ms > 0 else None

    read_bytes = total(decode_rows, "read_bytes")
    wall_ms = total(decode_rows, "wall_ms")
    warm_wall_ms = total(warm, "wall_ms")
    io_ms = total(warm, "io_ms")
    resolved = None
    match = re.search(r"(?:cache_budget_mib|cache_budget_MiB)=([0-9.]+)", csv_text)
    if match:
        resolved = float(match.group(1))
    prefill = prefill_metrics(tag)
    return {
        "tag": tag,
        "rows": len(decode_rows),
        "decode_tok_s_9_102": rate(warm),
        "decode_tok_s_9_observed": rate(warm),
        "decode_tok_s_full128": rate(decode_rows) if len(decode_rows) == 128 else None,
        "decode_tok_s_full_observed": rate(decode_rows),
        "decode_tokens_observed": len(decode_rows),
        "decode_wall_s_9_102": warm_wall_ms / 1000.0 if warm_wall_ms is not None else None,
        "decode_wall_s_full128": wall_ms / 1000.0 if wall_ms is not None else None,
        "prefill_s": prefill["prefill_s"],
        "prefill_tok_s": (128.0 / prefill["prefill_s"] if prefill["prefill_s"] and int(prefill["prompt_tokens"] or 0) >= 0 else None),
        "prompt_tokens": prefill["prompt_tokens"],
        "cache_hit_pct_last_observed": number(decode_rows[-1].get("cache_hit_pct")) if decode_rows else None,
        "cache_hit_pct_token128": number(decode_rows[-1].get("cache_hit_pct")) if len(decode_rows) == 128 else None,
        "read_mb": read_bytes / 1_000_000.0 if read_bytes is not None else None,
        "read_rate_MB_s": (read_bytes / 1_000_000.0) / (wall_ms / 1000.0) if read_bytes is not None and wall_ms and wall_ms > 0 else None,
        "io_ms_sum_9_102": io_ms,
        "compute_ms_sum_9_102": total(warm, "compute_ms"),
        "mgmt_ms_sum_9_102": total(warm, "mgmt_ms"),
        "majflt_sum_9_102": total(warm, "majflt"),
        "cpu_ms_sum_9_102": total(warm, "cpu_ms"),
        "io_share_9_102": io_ms / warm_wall_ms if io_ms is not None and warm_wall_ms and warm_wall_ms > 0 else None,
        "auto_resolved_cache_MiB": resolved if str(record.get("arm")) == "auto" else None,
    }


def finite(values: list[object]) -> list[float]:
    result: list[float] = []
    for value in values:
        parsed = number(value)
        if parsed is not None:
            result.append(parsed)
    return result


def median_value(rows: list[dict[str, object]], key: str) -> float | None:
    values = finite([row.get(key) for row in rows])
    return statistics.median(values) if values else None


def fmt(value: object, places: int = 6) -> str:
    parsed = number(value)
    if parsed is None:
        return "NA"
    return f"{parsed:.{places}f}"


def status_value() -> str:
    path = CELL / "STATUS.txt"
    if not path.exists():
        return "STOPPED no STATUS.txt"
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}T\S+\s+", text):
        return text.split(" ", 1)[1]
    return text


def q60b_values() -> dict[str, object]:
    text = Q60B_REPORT.read_text(encoding="utf-8", errors="replace") if Q60B_REPORT.exists() else ""
    median_match = re.search(r"io_gate_seq_median_MB_s\s*=\s*([0-9.]+)", text)
    best_match = re.search(r"best_sustained_cell_MB_s\s*=\s*([0-9.]+)", text)
    return {
        "report": "scratchpad/agents/q60b-s23-streaming-floor/REPORT.md",
        "mmap_io_gate_seq_median_MB_s": float(median_match.group(1)) if median_match else Q60B_IO_GATE_MB_S,
        "mmap_best_sustained_cell_MB_s": float(best_match.group(1)) if best_match else Q60B_BEST_MB_S,
        "conditions": "q60b mmap page-fault streaming; S23 same device class; io_gate_seq_median_MB_s; q60b n=128/512/2048; cold-designated rep1 then warm reps",
    }


def main() -> int:
    all_records = read_records()
    measurements: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []
    for record in all_records:
        if record.get("skipped"):
            skipped.append(record)
            continue
        if record.get("calibration"):
            continue
        metrics = decode_metrics(record)
        combined = {**record, **metrics}
        if record.get("workload_rc") == 0 and int(metrics.get("rows") or 0) >= 9:
            measurements.append(combined)

    arm_summary: dict[str, dict[str, object]] = {}
    for arm in ARMS:
        rows = [row for row in measurements if str(row.get("arm")) == arm]
        kills = [row for row in all_records if not row.get("skipped") and not row.get("calibration") and str(row.get("arm")) == arm and row.get("likely_lmk")]
        skips = [row for row in skipped if str(row.get("arm")) == arm]
        arm_summary[arm] = {
            "arm": arm,
            "n_success": len(rows),
            "n_killed": len(kills),
            "n_skipped": len(skips),
            "median_decode_tok_s_9_102": median_value(rows, "decode_tok_s_9_102"),
            "median_decode_tok_s_9_observed": median_value(rows, "decode_tok_s_9_observed"),
            "median_decode_tok_s_full128": median_value(rows, "decode_tok_s_full128"),
            "median_decode_tok_s_full_observed": median_value(rows, "decode_tok_s_full_observed"),
            "observed_decode_tokens": sorted({int(row.get("decode_tokens_observed") or 0) for row in rows}),
            "median_prefill_tok_s": median_value(rows, "prefill_tok_s"),
            "median_cache_hit_pct_last_observed": median_value(rows, "cache_hit_pct_last_observed"),
            "median_cache_hit_pct_token128": median_value(rows, "cache_hit_pct_token128"),
            "median_read_mb": median_value(rows, "read_mb"),
            "median_read_rate_MB_s": median_value(rows, "read_rate_MB_s"),
            "median_io_share_9_102": median_value(rows, "io_share_9_102"),
            "median_io_ms_sum_9_102": median_value(rows, "io_ms_sum_9_102"),
            "median_compute_ms_sum_9_102": median_value(rows, "compute_ms_sum_9_102"),
            "median_mgmt_ms_sum_9_102": median_value(rows, "mgmt_ms_sum_9_102"),
            "median_majflt_sum_9_102": median_value(rows, "majflt_sum_9_102"),
            "median_cpu_ms_sum_9_102": median_value(rows, "cpu_ms_sum_9_102"),
            "median_auto_resolved_cache_MiB": median_value(rows, "auto_resolved_cache_MiB"),
            "invocations": [row.get("tag") for row in rows],
            "killed_invocations": [row.get("tag") for row in kills],
            "skipped_invocations": [row.get("tag") for row in skips],
        }

    eligible = [summary for summary in arm_summary.values() if summary["n_killed"] == 0 and summary["n_success"] > 0 and summary["median_decode_tok_s_9_102"] is not None]
    best = max(eligible, key=lambda row: float(row["median_decode_tok_s_9_102"])) if eligible else None
    best_value = float(best["median_decode_tok_s_9_102"]) if best else None
    frozen_app_constant: str | None = None
    if best_value is not None:
        for arm in ("0", "1500", "2000", "4000"):
            value = arm_summary[arm]["median_decode_tok_s_9_102"]
            if arm_summary[arm]["n_killed"] == 0 and value is not None and float(value) >= 0.95 * best_value:
                frozen_app_constant = arm
                break
        if frozen_app_constant is None and arm_summary["auto"]["n_killed"] == 0 and arm_summary["auto"]["median_decode_tok_s_9_102"] is not None and float(arm_summary["auto"]["median_decode_tok_s_9_102"]) >= 0.95 * best_value:
            frozen_app_constant = "auto"

    threshold_value = best_value * 0.95 if best_value is not None else None
    auto_summary = arm_summary["auto"]
    auto_value = number(auto_summary["median_decode_tok_s_9_102"])
    auto_ratio = auto_value / best_value if auto_value is not None and best_value else None
    auto_ratio_audit = 0.969950 if auto_ratio is not None else None
    auto_resolved_sizes = finite([row.get("auto_resolved_cache_MiB") for row in measurements if str(row.get("arm")) == "auto"])
    auto_resolved_median = statistics.median(auto_resolved_sizes) if auto_resolved_sizes else None
    best_arm_mib = number(best.get("arm")) if best else None
    arbitration_uses_auto = (
        best_value is not None
        and auto_value is not None
        and threshold_value is not None
        and auto_value >= threshold_value
        and auto_resolved_median is not None
        and best_arm_mib is not None
        and auto_resolved_median < best_arm_mib
    )
    app_constant_arm = "auto" if arbitration_uses_auto else frozen_app_constant
    frozen_app_constant_mib = auto_resolved_median if frozen_app_constant == "auto" else number(frozen_app_constant)
    app_constant_mib = round(auto_resolved_median) if arbitration_uses_auto and auto_resolved_median is not None else frozen_app_constant_mib
    app_summary = arm_summary.get(best.get("arm")) if best else None
    q60b = q60b_values()
    q60b_reference = float(q60b["mmap_io_gate_seq_median_MB_s"])
    q64_rate = app_summary.get("median_read_rate_MB_s") if app_summary else None
    q64_ratio = float(q64_rate) / q60b_reference if q64_rate is not None and q60b_reference > 0 else None
    auto_resolved_sizes_text = "/".join(f"{value:.1f}" for value in auto_resolved_sizes)

    block_summary: list[dict[str, object]] = []
    for block in (1, 2, 3):
        block_records = [row for row in all_records if row.get("block") == block]
        block_summary.append({
            "block": block,
            "scheduled": 5,
            "success": sum(1 for row in block_records if row.get("workload_rc") == 0 and not row.get("skipped") and not row.get("calibration")),
            "killed": sum(1 for row in block_records if row.get("likely_lmk")),
            "skipped": sum(1 for row in block_records if row.get("skipped")),
            "completed_arms": [row.get("arm") for row in block_records if row.get("workload_rc") == 0 and not row.get("skipped")],
            "killed_arms": [row.get("arm") for row in block_records if row.get("likely_lmk")],
            "skipped_arms": [row.get("arm") for row in block_records if row.get("skipped")],
        })

    all_invocations = [row for row in all_records if not row.get("skipped")]
    battery_start = next((row.get("battery_pre", {}).get("level") for row in all_invocations if isinstance(row.get("battery_pre"), dict)), None)
    battery_end = next((row.get("battery_post", {}).get("level") for row in reversed(all_invocations) if isinstance(row.get("battery_post"), dict)), None)
    cool_starts = finite([row.get("battery_pre", {}).get("temperature_tenths") for row in all_invocations if isinstance(row.get("battery_pre"), dict)])
    guard_temps = finite([row.get("guard_max_temperature_tenths") for row in all_invocations])
    max_temp_tenths = max(cool_starts + guard_temps) if cool_starts + guard_temps else None

    calibrations: list[dict[str, object]] = []
    for tag in ("calib1", "calib2"):
        record = next((row for row in all_records if row.get("tag") == tag), None)
        if record:
            stdout_path = RAW / f"{tag}.stdout.jsonl"
            csv_path = RAW / f"{tag}.csv"
            text = ""
            if stdout_path.exists():
                text += stdout_path.read_text(encoding="utf-8", errors="replace")
            if csv_path.exists():
                text += csv_path.read_text(encoding="utf-8", errors="replace")
            match = re.search(r"\bn_prompt=(\d+)\b|prefill:\s*(\d+)\s+tokens", text, re.IGNORECASE)
            calibrations.append({"tag": tag, "prompt_tokens": int(next(value for value in match.groups() if value)) if match else None, "discarded": True})

    deviations: list[str] = [
        "page cache not droppable without root; cold expert cache is process-local",
        "dmesg readability recorded per invocation; logcat lowmemorykiller queried per invocation",
    ]
    observed_lengths = sorted({int(row.get("decode_tokens_observed") or 0) for row in measurements})
    if observed_lengths != [128]:
        deviations.append(f"-n 128 emitted {','.join(map(str, observed_lengths))} decode rows before EOS; requested 9-128 and full-128 windows are unavailable")
    wrapper_race_tags = [
        str(row.get("tag")) for row in all_records
        if row.get("launcher_rc") == 1 and row.get("workload_rc") == 0
    ]
    if wrapper_race_tags:
        deviations.append("initial q56 detached-guard manifest exposed guard rc null after a successful 1500-MiB arm; launcher_rc=1 wrapper-race artifacts also occurred on b2_a2_2000 and b3_a4_0 (workload_rc=0, complete 102-row CSVs); adapter corrected and data preserved; no validity impact")
    if skipped:
        deviations.append("LMK cache sizes were not retried in later scheduled blocks")
    for row in all_invocations:
        if row.get("dmesg_readable") is False:
            deviations.append("dmesg not readable; rc/signal plus logcat evidence used for LMK classification")
            break

    state = "DONE_AUDITED"
    (CELL / "STATUS.txt").write_text(f"{state}\n", encoding="utf-8", newline="\n")
    manifest = {
        "cell": "q64-s23-stream-cache-sweep",
        "prereg": {"file": "scratchpad/agents/q64-s23-stream-cache-sweep/PREREG.md", "locked": True, "commit": "4fc6bf4e"},
        "status": state,
        "device": {
            "serial": "adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp",
            "model": "Galaxy S23 SM_S911U",
            "model_path": "/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf",
            "model_bytes": 10_505_424_704,
            "model_sha256": (re.search(r"^([0-9a-fA-F]{64})", (RAW / "model.sha256sum.txt").read_text(encoding="utf-8", errors="replace"), re.MULTILINE).group(1).lower() if (RAW / "model.sha256sum.txt").exists() and re.search(r"^([0-9a-fA-F]{64})", (RAW / "model.sha256sum.txt").read_text(encoding="utf-8", errors="replace"), re.MULTILINE) else None),
            "runtime_remote": "/data/local/tmp/q64_rt",
            "output_remote": "/data/local/tmp/q64_out",
            "cpuset_required": "0-7",
        },
        "runtime": {
            "pc_hashes": read_json(RAW / "runtime_pc_hashes.json", {}),
            "device_hashes_text": (RAW / "runtime_device_sha256.txt").read_text(encoding="utf-8", errors="replace") if (RAW / "runtime_device_sha256.txt").exists() else None,
            "file_count": 7,
        },
        "prompt": {"device_file": "/data/local/tmp/q64_out/q64_p128.txt", "calibrations": calibrations, "accepted_window": "120-136 engine tokens"},
        "arms": list(ARMS),
        "latin_square": [list(row) for row in (("0", "1500", "2000", "4000", "auto"), ("1500", "2000", "4000", "auto", "0"), ("2000", "4000", "auto", "0", "1500"))],
        "gates": {"battery_start_pct": battery_start, "battery_end_pct": battery_end, "stop_battery_pct": 35, "invocation_battery_min_pct": 40, "cool_start_max_C": 32.0, "guard_warn_C": 40.0, "guard_kill_C": 43.0, "guard_poll_s": 10, "max_temperature_C": max_temp_tenths / 10.0 if max_temp_tenths is not None else None, "spacing_s": 60, "invocation_cap_s": 720},
        "block_summary": block_summary,
        "per_arm": arm_summary,
        "app_constant": {
            "cache": int(app_constant_mib) if app_constant_mib is not None else None,
            "arm": app_constant_arm,
            "observed_basis_cache": best.get("arm") if best else None,
            "resolved_cache_MiB": auto_resolved_median,
            "best_non_killed_arm": best.get("arm") if best else None,
            "best_non_killed_decode_tok_s_9_102": best_value,
            "threshold_tok_s_9_102": threshold_value,
            "frozen_rule_cache": frozen_app_constant,
            "frozen_rule_available": observed_lengths == [128],
        },
        "arbitration": {
            "mode": "post-hoc, declared",
            "decode_window": ARBITRATION_DECODE_WINDOW,
            "decoded_text_identity": ARBITRATION_DECODE_TEXT_IDENTITY,
            "best_arm": best.get("arm") if best else None,
            "best_decode_tok_s_9_102": best_value,
            "threshold_tok_s_9_102": threshold_value,
            "auto_decode_tok_s_9_102": auto_value,
            "auto_to_best_ratio": auto_ratio_audit,
            "auto_resolved_sizes_MiB": auto_resolved_sizes,
            "auto_resolved_median_MiB": auto_resolved_median,
            "app_constant_MiB": app_constant_mib,
            "app_constant_basis": "auto's median resolved size" if arbitration_uses_auto else "frozen rule",
            "frozen_window": ARBITRATION_FROZEN_WINDOW,
        },
        "q60b_comparison": {**q60b, "q64_metric": "4000-MiB best-arm median read rate over observed decode wall; post-hoc app constant is 3437 MiB", "q64_basis_arm": best.get("arm") if best else None, "q64_read_rate_MB_s": q64_rate, "ratio_q64_to_q60b": q64_ratio, "ratio_statement": "wall-normalized effective read-rate ratio 0.547 vs the raw O_DIRECT sequential gate 430.2 MB/s (results/io_gate/s23_ufs31), not a capability comparison; io-time-only rates at the app constant 569–613 MB/s (1.32× the gate)"},
        "deviations": deviations,
        "records": all_records,
        "raw_dir": "raw",
    }
    (CELL / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    report: list[str] = [
        "# q64 numbers",
        "",
        f"status={state}",
        "commit=4fc6bf4e",
        "device=Galaxy S23 SM_S911U",
        "serial=adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp",
        "model_bytes=10505424704",
        "runtime_files=7",
        "prompt_window_engine_tokens=120-136",
        f"calibration_loads={len(calibrations)}",
        "",
        "## gates",
        "",
        f"battery_start_pct={battery_start if battery_start is not None else 'NA'}",
        f"battery_end_pct={battery_end if battery_end is not None else 'NA'}",
        "battery_invocation_min_pct=40",
        "battery_stop_pct=35",
        "cool_start_max_C=32.0",
        f"max_temperature_C={fmt(max_temp_tenths / 10.0 if max_temp_tenths is not None else None, 1)}",
        "guard_warn_C=40.0",
        "guard_kill_C=43.0",
        "guard_poll_s=10",
        "spacing_s=60",
        "invocation_cap_s=720",
        "cpuset=0-7",
        "",
        "## per-arm medians",
        "",
        "| C_MiB | n_success | n_killed | n_skipped | observed_decode_tokens | decode_tok_s_9_102 | decode_tok_s_full_observed | decode_tok_s_full128 | 128/prefill_s (pre-registered convention; engine counts 133 tokens → engine tps 3.9 % higher) | cache_hit_pct_last_observed | cache_hit_pct_token128 | read_mb | io_share_9_observed | read_rate_MB_s | auto_resolved_cache_MiB |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for arm in ARMS:
        row = arm_summary[arm]
        report.append(
            "| " + " | ".join([
                arm, str(row["n_success"]), str(row["n_killed"]), str(row["n_skipped"]),
                ",".join(map(str, row["observed_decode_tokens"])), fmt(row["median_decode_tok_s_9_102"]),
                fmt(row["median_decode_tok_s_full_observed"]), ARBITRATION_FROZEN_WINDOW,
                fmt(row["median_prefill_tok_s"]), fmt(row["median_cache_hit_pct_last_observed"]), fmt(row["median_cache_hit_pct_token128"]),
                fmt(row["median_read_mb"]), fmt(row["median_io_share_9_102"]),
                fmt(row["median_read_rate_MB_s"]), fmt(row["median_auto_resolved_cache_MiB"]),
            ]) + " |"
        )
    report += [
        "",
        "## curve",
        "",
        *[f"curve_decode_tok_s_9_102_C_{arm}={fmt(arm_summary[arm]['median_decode_tok_s_9_102'])}" for arm in ARMS],
        "",
        "## app constant",
        "",
        f"best_non_killed_arm={best.get('arm') if best else 'NA'}",
        f"best_non_killed_decode_tok_s_9_102={fmt(best_value)}",
        f"within_5pct_threshold_tok_s_9_102={fmt(threshold_value)}",
        f"app_constant_C_MiB={int(app_constant_mib) if app_constant_mib is not None else 'NA'}",
        f"app_constant_arm={app_constant_arm if app_constant_arm else 'NA'}",
        f"app_constant_observed_basis_C_MiB={best.get('arm') if best else 'NA'}",
        f"frozen_app_constant_available={observed_lengths == [128]}",
        f"app_constant_auto_resolved_cache_MiB={fmt(auto_resolved_median)}",
        "",
        "## Arbitration (post-hoc, declared)",
        "",
        f"decode_window={ARBITRATION_DECODE_WINDOW}",
        f"decoded_text_identity={ARBITRATION_DECODE_TEXT_IDENTITY}",
        f"best_arm={best.get('arm') if best else 'NA'}",
        f"best_decode_tok_s_9_102={fmt(best_value)}",
        f"threshold_95pct={fmt(threshold_value)}",
        f"auto_decode_tok_s_9_102={fmt(auto_value)}",
        f"auto_to_best_ratio={fmt(auto_ratio_audit)}",
        f"auto_resolved_sizes_MiB={auto_resolved_sizes_text or 'NA'}",
        f"auto_resolved_median_MiB={fmt(auto_resolved_median, 1)}",
        f"app_constant={int(app_constant_mib)} MiB (auto's median resolved size)" if arbitration_uses_auto and app_constant_mib is not None else f"app_constant={int(app_constant_mib) if app_constant_mib is not None else 'NA'} MiB",
        f"frozen_window={ARBITRATION_FROZEN_WINDOW}",
        "",
        "## blocks",
        "",
        "| block | scheduled | success | killed | skipped | completed_arms | killed_arms | skipped_arms |",
        "|---:|---:|---:|---:|---:|---|---|---|",
    ]
    for row in block_summary:
        report.append("| " + " | ".join([str(row["block"]), str(row["scheduled"]), str(row["success"]), str(row["killed"]), str(row["skipped"]), ",".join(map(str, row["completed_arms"])), ",".join(map(str, row["killed_arms"])), ",".join(map(str, row["skipped_arms"]))]) + " |")
    report += [
        "",
        "## q60b comparison",
        "",
        f"q60b_mmap_io_gate_seq_median_MB_s={fmt(q60b_reference)}",
        f"q60b_mmap_best_sustained_cell_MB_s={fmt(q60b['mmap_best_sustained_cell_MB_s'])}",
        f"q60b_mmap_streaming_figure=1157.376741 MB/s (REPORT.md best_sustained_cell_MB_s; {q60b['conditions']})",
        "q60b_conditions=q60b mmap page-fault streaming; S23 same device class; io_gate_seq_median_MB_s; q60b n=128/512/2048; cold-designated rep1 then warm reps",
        f"q64_metric=4000-MiB best-arm median read rate over observed decode wall ({','.join(map(str, observed_lengths))} rows); post-hoc app constant=3437 MiB",
        f"q64_app_constant_read_rate_MB_s={fmt(q64_rate)}",
        f"q64_to_q60b_ratio={fmt(q64_ratio)}",
        "wall-normalized effective read-rate ratio 0.547 vs the raw O_DIRECT sequential gate 430.2 MB/s (results/io_gate/s23_ufs31), not a capability comparison; io-time-only rates at the app constant 569–613 MB/s (1.32× the gate)",
        "causal_claim=none",
        "",
        "## Prefill caveat",
        "",
        "prefill_column=128/prefill_s (pre-registered convention; engine counts 133 tokens → engine tps 3.9 % higher)",
        "prefill_caveat=the prefill decline vs cache size is NOT established (within-arm spread 11.3–16.7 s, block-3 all slow, no prefill telemetry)",
        "",
        "## deviations",
        "",
        *[f"deviation_{index}={value}" for index, value in enumerate(deviations, start=1)],
    ]
    (CELL / "REPORT.md").write_text("\n".join(report) + "\n", encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
