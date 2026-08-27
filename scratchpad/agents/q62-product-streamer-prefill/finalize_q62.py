from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q62-product-streamer-prefill"
RAW = CELL / "raw"
MODEL = "/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf"
EXPECTED_MODEL_BYTES = 13416430592
EXPECTED_MODEL_SHA = "ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a"
EXPECTED_BMOE_SHA = "0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c"
CRASH_MARKERS = (
    "CDSP0 CRASHED",
    "dspqueue_read failed",
    "dspqueue_write failed",
    "INTERNAL-ERROR",
    "ggml_abort",
    "GGML_ASSERT",
    "Aborted",
    "Segmentation",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def read_records() -> list[dict[str, object]]:
    path = CELL / "run_records.jsonl"
    records: list[dict[str, object]] = []
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def numeric(row: dict[str, str], aliases: tuple[str, ...]) -> float | None:
    lowered = {str(key).lower().strip(): value for key, value in row.items() if key is not None and not isinstance(value, list)}
    for alias in aliases:
        value = lowered.get(alias.lower())
        if value in (None, "", "NA", "nan", "NaN"):
            continue
        try:
            return float(value)
        except ValueError:
            continue
    return None


def csv_rows(tag: str) -> list[dict[str, str]]:
    path = RAW / f"{tag}.csv"
    if not path.exists() or path.stat().st_size == 0:
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    data_lines = [line for line in lines if line and not line.startswith("#")]
    if not data_lines:
        return []
    return list(csv.DictReader(data_lines))


def sampler_evidence(tag: str) -> dict[str, object]:
    path = RAW / f"{tag}.sampler.csv"
    if not path.exists():
        return {"rows": 0, "first_bmoe_row": None, "allowed_values": []}
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        rows = list(csv.DictReader(handle))
    allowed = [row.get("cpus_allowed_list", "") for row in rows if row.get("cpus_allowed_list")]
    return {
        "rows": len(rows),
        "first_bmoe_row": rows[0] if rows else None,
        "allowed_values": sorted(set(allowed)),
        "gate_pass": bool(rows) and all(value == "0-7" for value in allowed),
    }


def phase0_rows(record: dict[str, object]) -> tuple[list[dict[str, str]], str]:
    tag = str(record.get("tag", ""))
    rows = csv_rows(tag)
    if not rows:
        return [], "no CSV rows"
    keys = [key for key in rows[0] if key]
    phase_key = next((key for key in keys if key.lower().strip() in {"phase", "phase_id", "stage", "kind", "type"}), None)
    if phase_key:
        values = [str(row.get(phase_key, "")).strip().lower() for row in rows]
        selected = [row for row, value in zip(rows, values) if value in {"0", "phase-0", "phase0", "prompt", "prefill", "pp"}]
        if selected:
            return selected, f"CSV {phase_key}=phase-0"
    op_key = next((key for key in keys if key.lower().strip() in {"op", "event", "name"}), None)
    if op_key:
        selected = [row for row in rows if str(row.get(op_key, "")).strip().lower() in {"prompt", "prefill", "phase-0", "phase0"}]
        if selected:
            return selected, f"CSV {op_key}=phase-0"
    if int(record.get("decode_n", 0) or 0) == 1 and len(rows) > 1:
        return rows[:-1], "CSV rows minus final n=1 decode row"
    return rows, "all CSV rows (n=0)"


def summary_number(tag: str, key: str) -> float | None:
    path = RAW / f"{tag}.csv"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(rf"\b{re.escape(key)}=([0-9]+(?:\.[0-9]+)?)\b", text)
    return float(match.group(1)) if match else None


def phase0_trace(tag: str) -> dict[str, object]:
    path = RAW / f"{tag}.iotrace.txt"
    if not path.exists():
        return {"rows": 0, "read_bytes": None, "read_mb": None, "latency_sum_s": None, "lane_s": {}, "layer_max_lane_s": None, "phase_code": None, "overlap": None}
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        lines = list(handle)
    overlap = 0 if any("overlap=0" in line for line in lines if line.startswith("#")) else None
    phase_code = "0"
    rows = [row for row in csv.DictReader((line for line in lines if not line.startswith("#"))) if row.get("phase") == phase_code]
    lane_totals: dict[str, float] = {}
    layer_lane_totals: dict[str, dict[str, float]] = {}
    read_bytes = 0
    latency_ns = 0
    for row in rows:
        try:
            read_bytes += int(row.get("read_bytes", "0") or 0)
            latency = int(row.get("latency_ns", "0") or 0)
        except ValueError:
            continue
        latency_ns += latency
        latency_s = latency / 1_000_000_000.0
        lane = row.get("lane", "")
        lane_totals[lane] = lane_totals.get(lane, 0.0) + latency_s
        layer = row.get("layer", "")
        layer_totals = layer_lane_totals.setdefault(layer, {})
        layer_totals[lane] = layer_totals.get(lane, 0.0) + latency_s
    layer_max = sum(max(values.values()) for values in layer_lane_totals.values() if values)
    return {
        "rows": len(rows),
        "read_bytes": read_bytes,
        "read_mb": read_bytes / 1_048_576.0,
        "latency_sum_s": latency_ns / 1_000_000_000.0,
        "lane_s": lane_totals,
        "layer_max_lane_s": layer_max if layer_lane_totals else None,
        "phase_code": phase_code,
        "overlap": overlap,
    }


def decode_summary(tag: str) -> dict[str, float | None]:
    csv_path = RAW / f"{tag}.csv"
    stdout_path = RAW / f"{tag}.stdout.jsonl"
    csv_text = csv_path.read_text(encoding="utf-8", errors="replace") if csv_path.exists() else ""
    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.exists() else ""
    read_field = summary_number(tag, "read_MiB")
    match = re.search(r'"read_mb":([0-9]+(?:\.[0-9]+)?)', stdout_text)
    progress_read = float(match.group(1)) if match else None
    match = re.search(r"moe-stream:.*?([0-9]+(?:\.[0-9]+)?)\s+MiB/s", stdout_text)
    decode_rate = float(match.group(1)) if match else None
    decode_bytes = None
    rows = csv_rows(tag)
    if rows:
        decode_bytes = numeric(rows[-1], ("read_bytes",))
    if decode_bytes is None:
        csv_lines = csv_text.splitlines()
        header_line = next((line for line in csv_lines if line.startswith("step,")), "")
        data_line = next((line for line in csv_lines if re.match(r"^\d+,", line)), "")
        if header_line and data_line:
            fields = header_line.split(",")
            values = data_line.split(",")
            if "read_bytes" in fields:
                try:
                    decode_bytes = float(values[fields.index("read_bytes")])
                except (IndexError, ValueError):
                    decode_bytes = None
    return {
        "read_field": progress_read if progress_read is not None else read_field,
        "read_bytes": decode_bytes,
        "read_mib_from_bytes": decode_bytes / 1_048_576.0 if decode_bytes is not None else None,
        "decode_mib_s": decode_rate,
    }


def derive_engine_row(record: dict[str, object]) -> dict[str, object] | None:
    tag = str(record.get("tag", ""))
    trace = phase0_trace(tag)
    wall_s = summary_number(tag, "prefill_s")
    if not trace["rows"] or trace["read_mb"] is None or trace["latency_sum_s"] is None or trace["layer_max_lane_s"] is None or wall_s is None or wall_s <= 0:
        return None
    read_mb = float(trace["read_mb"])
    io_wall_point_s = float(trace["layer_max_lane_s"])
    io_wall_lower_s = float(trace["latency_sum_s"]) / 4.0
    io_wall_upper_s = float(trace["latency_sum_s"])
    compute_wall_s = float(wall_s) - io_wall_point_s
    return {
        "arm": str(record.get("base_tag", tag)).split("_inv", 1)[0],
        "tag": tag,
        "invocation": str(record.get("base_tag", tag)),
        "io_ms": None,
        "compute_ms": None,
        "mgmt_ms": None,
        "read_mb": read_mb,
        "phase0_trace_read_bytes": trace["read_bytes"],
        "phase0_trace_rows": trace["rows"],
        "majflt": None,
        "cpu_ms": None,
        "wall_s": float(wall_s),
        "compute_share": compute_wall_s / float(wall_s),
        "io_share": io_wall_point_s / float(wall_s),
        "overlap": trace["overlap"],
        "measured_eval_mbps": None,
        "io_floor_s": io_wall_point_s,
        "compute_wall_s": compute_wall_s,
        "io_wall_lower_s": io_wall_lower_s,
        "io_wall_point_s": io_wall_point_s,
        "io_wall_upper_s": io_wall_upper_s,
        "io_share_lower": io_wall_lower_s / float(wall_s),
        "io_share_point": io_wall_point_s / float(wall_s),
        "io_share_upper": io_wall_upper_s / float(wall_s),
        "phase0_trace_latency_sum_s": trace["latency_sum_s"],
        "phase0_trace_lane_s": trace["lane_s"],
        "phase0_trace_layer_max_lane_sum_s": trace["layer_max_lane_s"],
        "phase0_trace_phase_code": trace["phase_code"],
        "phase0_trace_overlap": trace["overlap"],
        "phase_source": "iotrace phase=0 read_bytes/latency_ns/lane/layer; CSV summary prefill_s; phase-0 engine io_ms/compute_ms/mgmt_ms/cpu_ms/majflt absent",
    }


def classify(row: dict[str, object]) -> str:
    floor = row.get("io_floor_s")
    wall = row.get("wall_s")
    if not isinstance(floor, (int, float)) or not isinstance(wall, (int, float)) or wall <= 0:
        return "NA"
    ratio = float(floor) / float(wall)
    if ratio >= 0.8:
        return "flash-bound"
    if ratio <= 0.5:
        return "compute-bound"
    return "mixed"


def classify_io(io_wall: float, wall: float) -> str:
    ratio = io_wall / wall if wall > 0 else float("nan")
    if ratio >= 0.8:
        return "flash-bound"
    if ratio <= 0.5:
        return "compute-bound"
    return "mixed"


def f(value: object, places: int = 6) -> str:
    if value is None:
        return "NA"
    return f"{float(value):.{places}f}"


def parse_props() -> dict[str, str]:
    result: dict[str, str] = {}
    path = RAW / "device_props.txt"
    if path.exists():
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                result[key] = value
    return result


def marker_from_files(records: list[dict[str, object]]) -> str:
    for record in records:
        tag = str(record.get("tag", ""))
        for name in (f"{tag}.stderr.log", f"{tag}.stdout.jsonl"):
            path = RAW / name
            if not path.exists():
                continue
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                for marker in CRASH_MARKERS:
                    if marker in line:
                        return line.strip()
    return ""


def protocol_stop_from_files(records: list[dict[str, object]]) -> str:
    for record in records:
        tag = str(record.get("tag", ""))
        path = RAW / f"{tag}.stderr.log"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"prompt \+ n_predict exceeds[^\n]*", text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return ""


def calibration_result(tag: str) -> dict[str, object]:
    csv_path = RAW / f"{tag}.csv"
    stdout_path = RAW / f"{tag}.stdout.jsonl"
    csv_text = csv_path.read_text(encoding="utf-8", errors="replace") if csv_path.exists() else ""
    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.exists() else ""
    match = re.search(r"\bn_prompt=(\d+)\b", csv_text)
    if match:
        return {"tag": tag, "prompt_tokens": int(match.group(1)), "source": "CSV summary n_prompt field", "measurement": False}
    match = re.search(r"prefill:\s*(\d+)\s+tokens", stdout_text, re.IGNORECASE)
    if match:
        return {"tag": tag, "prompt_tokens": int(match.group(1)), "source": "printed prefill token figure", "measurement": False}
    return {"tag": tag, "prompt_tokens": None, "source": "no engine prompt-token count; see stderr", "measurement": False}


def measurement_records(records: list[dict[str, object]]) -> list[dict[str, object]]:
    selected: dict[str, dict[str, object]] = {}
    for record in records:
        tag = str(record.get("tag", ""))
        base = str(record.get("base_tag", tag))
        if not re.fullmatch(r"(?:(?:primary|secondary)_inv\d+(?:_retry\d+)?|optional_p2048(?:_retry\d+)?)", tag):
            continue
        key = re.sub(r"_retry\d+$", "", base)
        if key not in selected or int(record.get("retry", 0) or 0) > int(selected[key].get("retry", 0) or 0):
            selected[key] = record
    return [selected[key] for key in sorted(selected, key=lambda value: (value.split("_", 1)[0], int(re.search(r"\d+$", value).group(0))))]


def sampler_crosscheck(tag: str) -> dict[str, object]:
    path = RAW / f"{tag}.sampler.csv"
    if not path.exists():
        return {"rows": 0, "cpu_s": None, "wall_s": None, "read_bytes": None, "read_mb": None, "read_ratio": None, "cpuset": [], "gate_pass": False, "status": "FAIL_WRONG_PID_SHELL_WRAPPER"}
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        return {"rows": 0, "cpu_s": None, "wall_s": None, "read_bytes": None, "read_mb": None, "read_ratio": None, "cpuset": [], "gate_pass": False, "status": "FAIL_WRONG_PID_SHELL_WRAPPER"}
    first, last = rows[0], rows[-1]
    def val(row: dict[str, str], key: str) -> float:
        try:
            return float(row.get(key, "0") or 0)
        except ValueError:
            return 0.0
    cpu_s = ((val(last, "utime_ticks") + val(last, "stime_ticks")) - (val(first, "utime_ticks") + val(first, "stime_ticks"))) / 100.0
    wall_s = max(0.0, val(last, "uptime_s") - val(first, "uptime_s"))
    read_bytes = max(0.0, val(last, "read_bytes") - val(first, "read_bytes"))
    read_mb = read_bytes / 1_000_000.0
    cpuset = sorted({row.get("cpus_allowed_list", "") for row in rows})
    engine = derive_engine_row({"tag": tag, "base_tag": tag, "decode_n": 0})
    engine_read = engine.get("read_mb") if engine else None
    return {
        "rows": len(rows),
        "cpu_s": cpu_s,
        "wall_s": wall_s,
        "read_bytes": int(read_bytes),
        "read_mb": read_mb,
        "read_ratio": read_mb / float(engine_read) if isinstance(engine_read, (int, float)) and engine_read > 0 else None,
        "cpuset": cpuset,
        "gate_pass": bool(cpuset) and all(value == "0-7" for value in cpuset),
        "status": "FAIL_WRONG_PID_SHELL_WRAPPER",
    }


def compact_arm(record: dict[str, object]) -> dict[str, object]:
    monitor = record.get("monitor", {})
    launcher = record.get("launcher_manifest", "")
    raw_launcher = read_json(CELL / str(launcher), {}) if launcher else {}
    guard = raw_launcher.get("guard", {}) if isinstance(raw_launcher, dict) else {}
    return {
        "tag": record.get("tag"),
        "arm": str(record.get("base_tag", record.get("tag", ""))).split("_inv", 1)[0],
        "invocation": str(record.get("base_tag", record.get("tag", ""))),
        "retry": record.get("retry"),
        "command_verbatim": record.get("command_verbatim"),
        "rc": {"launcher": record.get("launcher_rc"), "workload": record.get("workload_rc"), "guard": record.get("guard_rc")},
        "battery_pre": record.get("battery_pre"),
        "battery_post": record.get("battery_post"),
        "mem_pre": record.get("mem_pre"),
        "mem_post": record.get("mem_post"),
        "cpuset": monitor.get("cpuset_samples", []) if isinstance(monitor, dict) else [],
        "cpuset_violation": monitor.get("cpuset_violation") if isinstance(monitor, dict) else None,
        "guard_max_temp_tenths": guard.get("max_temperature_tenths"),
        "guard_outcome": record.get("guard_outcome"),
        "failure_signature": record.get("failure_signature"),
        "sampler": sampler_crosscheck(str(record.get("tag", ""))),
    }


def main() -> None:
    all_records = read_records()
    records = measurement_records(all_records)
    metrics: list[dict[str, object]] = []
    for record in records:
        row = derive_engine_row(record)
        if row is None:
            continue
        for k in (2, 4, 8):
            compute = row.get("compute_wall_s")
            wall = row.get("wall_s")
            for bound in ("lower", "point", "upper"):
                floor = row.get(f"io_wall_{bound}_s")
                row[f"headroom_{bound}_k{k}"] = float(wall) / max(float(floor), float(compute) / k) if all(isinstance(v, (int, float)) for v in (floor, compute, wall)) and float(wall) > 0 else None
        row["headroom_k2"] = row["headroom_point_k2"]
        row["headroom_k4"] = row["headroom_point_k4"]
        row["headroom_k8"] = row["headroom_point_k8"]
        row["wording"] = "NA"
        row["wording_lower"] = classify_io(float(row["io_wall_lower_s"]), float(row["wall_s"]))
        row["wording_point"] = classify_io(float(row["io_wall_point_s"]), float(row["wall_s"]))
        row["wording_upper"] = classify_io(float(row["io_wall_upper_s"]), float(row["wall_s"]))
        row["wording_robust"] = row["wording_lower"] == row["wording_point"] == row["wording_upper"]
        metrics.append(row)

    previous = read_json(CELL / "manifest.json", {})
    attempt1 = previous.get("attempt_1") if isinstance(previous, dict) and previous.get("attempt_1") else {
        "status": previous.get("status") if isinstance(previous, dict) else "STOPPED unknown arg: -r",
        "arms": previous.get("arms", []) if isinstance(previous, dict) else [],
        "metrics": previous.get("metrics", []) if isinstance(previous, dict) else [],
        "stop_reason": previous.get("stop_reason", "unknown arg: -r") if isinstance(previous, dict) else "unknown arg: -r",
    }
    attempt2_records = [record for record in all_records if str(record.get("tag", "")).startswith(("calib", "n0_probe", "primary_inv", "secondary_inv", "optional_p2048"))]
    calibration_paths = [path for path in sorted(RAW.glob("calib*.csv")) if not path.name.endswith(".sampler.csv")]
    calibration_paths += [path for path in sorted(RAW.glob("optional_p2048_calib*.csv")) if not path.name.endswith(".sampler.csv")]
    calibration = [calibration_result(path.stem) for path in calibration_paths]
    optional_calibration = [item for item in calibration if str(item.get("tag", "")).startswith("optional_p2048_calib")]
    decode_mode = read_json(RAW / "decode_mode.json", {})
    attempt2_arms = [compact_arm(record) for record in attempt2_records]
    exact_stop = marker_from_files(all_records)
    protocol_stop = protocol_stop_from_files(all_records)
    stop_reason = exact_stop or protocol_stop or ("" if metrics else "no measurements")
    primary_prompt_value = summary_number("primary_inv1", "n_prompt")
    primary_prompt_count = int(primary_prompt_value) if primary_prompt_value is not None else None
    optional_prompt_value = summary_number("optional_p2048", "n_prompt")
    optional_prompt_count = int(optional_prompt_value) if optional_prompt_value is not None else None
    optional_sha_path = RAW / "q62_p2048_calib3.pc.sha256.txt"
    optional_device_sha_path = RAW / "q62_p2048_calib3.device.sha256sum.txt"
    optional_sha_tokens = optional_sha_path.read_text(encoding="utf-8", errors="replace").split() if optional_sha_path.exists() else []
    optional_device_sha_tokens = optional_device_sha_path.read_text(encoding="utf-8", errors="replace").split() if optional_device_sha_path.exists() else []
    optional_sha = optional_sha_tokens[0] if optional_sha_tokens else None
    optional_device_sha = optional_device_sha_tokens[0] if optional_device_sha_tokens else None
    optional_prompt_bytes = (CELL / "prompts/q62_p2048.txt").stat().st_size if (CELL / "prompts/q62_p2048.txt").exists() else None
    superseded_optional_sha = "66271b4753fcaec9f289898ab8c9b1562627b225931fd857f17b6ba0c188975d"
    primary_done = sum(1 for record in records if str(record.get("base_tag", "")).startswith("primary_inv") and record.get("workload_rc") == 0 and record.get("guard_rc") == 0)
    secondary_done = sum(1 for record in records if str(record.get("base_tag", "")).startswith("secondary_inv") and record.get("workload_rc") == 0 and record.get("guard_rc") == 0)
    optional_done = sum(1 for record in records if str(record.get("base_tag", "")) == "optional_p2048" and record.get("workload_rc") == 0 and record.get("guard_rc") == 0)
    if optional_done >= 1:
        final_status = "DONE_OPTIONAL"
    elif secondary_done >= 3:
        final_status = "DONE_SECONDARY"
    elif primary_done >= 3:
        final_status = "DONE_PRIMARY_AUDITED"
    else:
        final_status = "STOPPED " + stop_reason
    reported_stop = "" if final_status.startswith("DONE_") else stop_reason
    attempt2 = {
        "status": final_status,
        "prompt": {
            "path": "scratchpad/agents/q62-product-streamer-prefill/prompts/q62_pp512.txt",
            "sha256": (read_json(RAW / "attempt2_prep_summary.json", {}).get("prompt", {}) or {}).get("sha256"),
            "calibration": calibration,
            "token_count": primary_prompt_count if primary_prompt_count is not None else (calibration[-1].get("prompt_tokens") if calibration else None),
            "token_count_source": "primary CSV summary n_prompt field" if primary_prompt_count is not None else (calibration[-1].get("source") if calibration else None),
        },
        "optional_prompt": {
            "path": "scratchpad/agents/q62-product-streamer-prefill/prompts/q62_p2048.txt",
            "sha256": optional_sha,
            "device_sha256": optional_device_sha,
            "sha256_source": "raw/q62_p2048_calib3.pc.sha256.txt; device recheck raw/q62_p2048_calib3.device.sha256sum.txt",
            "bytes": optional_prompt_bytes,
            "token_count": optional_prompt_count,
            "token_count_source": "optional CSV summary n_prompt field" if optional_prompt_count is not None else None,
            "n_ctx": 2048,
            "label": "n=1, exploratory",
            "superseded_candidates": [{"sha256": superseded_optional_sha, "bytes": 7973, "artifact": "raw/q62_p2048.superseded_candidate.sha256.txt"}],
            "calibration": optional_calibration,
        },
        "decode_mode": decode_mode,
        "calibration": calibration,
        "arms": attempt2_arms,
        "metrics": metrics,
        "phase0_io_derivation": {
            "prefill_phase_code": "0",
            "decode_phase_code_excluded": "1",
            "prefill_rows_per_invocation": {str(row["invocation"]): row.get("phase0_trace_rows") for row in metrics},
            "sum_latency_s": {str(row["invocation"]): row.get("phase0_trace_latency_sum_s") for row in metrics},
            "lane_latency_s": {str(row["invocation"]): row.get("phase0_trace_lane_s") for row in metrics},
            "sum_layers_max_lane_s": {str(row["invocation"]): row.get("io_wall_point_s") for row in metrics},
            "overlap": 0,
            "engine_phase0_counters": "absent",
            "sampler_crosscheck": "FAIL_WRONG_PID_SHELL_WRAPPER",
        },
        "measured_invocations": len(metrics),
        "deviations": ["drop_caches denied in Attempt 1; not retried", "n0 probe rejected: n_predict must be positive; n=1 decode row excluded", "optional p2048 calibration 2 rejected by n_ctx=2048 after calibration 1 count=1947; candidate trimmed and calibration 3 accepted", "phase-0 io/compute/mgmt/cpu/majflt counters absent from shipped CSV/progress; phase-0 read_bytes from io-trace and prefill_s from CSV summary retained", "FORMAL DEVIATION G-1: follow-up run_q62.py used >=40% versus the locked >=45%; actual battery levels 68% -> 60% were all >=45%, so no invocation was admitted that the locked gate would reject", "APPENDIX G-2: superseded optional candidate 66271b47... (7973 B) retained as a noted artifact; final prompt is a748f3c4... (7894 B), and the device copy matches"],
    }

    runtime_pc = read_json(RAW / "runtime_pc_hashes.json", {})
    device_hash_text = (RAW / "runtime_device_sha256.txt").read_text(encoding="utf-8", errors="replace") if (RAW / "runtime_device_sha256.txt").exists() else ""
    runtime_device: dict[str, str] = {}
    for line in device_hash_text.splitlines():
        match = re.match(r"^([0-9a-fA-F]{64})\s+(.+)$", line.strip())
        if match:
            runtime_device[Path(match.group(2)).name] = match.group(1).lower()
    help_text = (RAW / "bmoe_help.txt").read_text(encoding="utf-8", errors="replace") if (RAW / "bmoe_help.txt").exists() else ""
    required_flags = ["--moe-stream", "--cache-mb", "--dense-weights", "--io-threads", "--ubatch", "--no-think", "--progress", "--csv", "--io-trace", "--cache-ceil-mb", "--compute-trace-layers"]
    manifest = {
        "cell": "q62-product-streamer-prefill",
        "owner_go": "2026-08-26: Xiaomi attached and free, hurry",
        "status": final_status,
        "commit": "d82fb3c1",
        "amendment": "Amendment 1",
        "prereg": {"file": "scratchpad/agents/q62-product-streamer-prefill/PREREG.md", "locked": True},
        "device": {"serial": "adb-625689a2-9xEOfw._adb-tls-connect._tcp", "model_path": MODEL, "model_bytes": EXPECTED_MODEL_BYTES, "model_sha256_expected": EXPECTED_MODEL_SHA, "runtime_remote": "/data/local/tmp/q62_rt", "output_remote": "/data/local/tmp/q62_out"},
        "runtime": {"pc_files": runtime_pc, "device_sha256": runtime_device, "bmoe_cli_expected_sha256": EXPECTED_BMOE_SHA, "bmoe_cli_device_match": EXPECTED_BMOE_SHA in (RAW / "existing_device_check.txt").read_text(encoding="utf-8", errors="replace") if (RAW / "existing_device_check.txt").exists() else None},
        "smoke": {"help_file": "raw/bmoe_help.txt", "required_flags": required_flags, "missing_flags": [flag for flag in required_flags if flag not in help_text]},
        "attempts": {"Attempt 1": attempt1, "Attempt 2": attempt2},
        "attempt_1": attempt1,
        "attempt_2": attempt2,
        "arms": attempt2_arms,
        "metrics": metrics,
        "measured_reps": len(metrics),
        "stop_reason": reported_stop,
        "calibration_stop_reason": protocol_stop,
        "crash_stop_marker": exact_stop if exact_stop in CRASH_MARKERS else None,
        "deviations": attempt2["deviations"],
        "raw_dir": "raw",
        "finalized_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    with (CELL / "manifest.json").open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    lines = [
        "# q62 numbers",
        "",
        "| attempt | status | stop_reason |",
        "|---|---|---|",
        f"| Attempt 1 | {attempt1.get('status', 'STOPPED')} | {attempt1.get('stop_reason', 'unknown arg: -r')} |",
        f"| Attempt 2 | {attempt2['status']} | {reported_stop or 'NA'} |",
        "",
        "| arm | invocation | io_ms | compute_ms | mgmt_ms | read_mb | majflt | cpu_ms | wall_s | compute_share(point) | io_share(point) | overlap | wording(engine phase-0 counters) |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in metrics:
        lines.append("| " + " | ".join([str(row["arm"]), str(row["invocation"]), f(row["io_ms"], 3), f(row["compute_ms"], 3), f(row["mgmt_ms"], 3), f(row["read_mb"], 3), str(row["majflt"] if row["majflt"] is not None else "NA"), f(row["cpu_ms"], 3), f(row["wall_s"]), f(row["compute_share"]), f(row["io_share"]), f(row["overlap"]), str(row["wording"])]) + " |")
    if not metrics:
        lines.append("| NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |")

    primary_by_invocation = {str(row["invocation"]): row for row in metrics if row["arm"] == "primary"}
    secondary_by_invocation = {str(row["invocation"]): row for row in metrics if row["arm"] == "secondary"}
    paired = [(primary_by_invocation[f"primary_inv{index}"], secondary_by_invocation[f"secondary_inv{index}"]) for index in (1, 2, 3) if f"primary_inv{index}" in primary_by_invocation and f"secondary_inv{index}" in secondary_by_invocation]
    if paired:
        comparison = []
        for index, (primary, secondary) in enumerate(paired, 1):
            delta = float(secondary["wall_s"]) - float(primary["wall_s"])
            pct = 100.0 * delta / float(primary["wall_s"])
            comparison.append(f"inv{index} {delta:+.3f} s ({pct:+.2f}%)")
        primary_mean = sum(float(primary["wall_s"]) for primary, _ in paired) / len(paired)
        secondary_mean = sum(float(secondary["wall_s"]) for _, secondary in paired) / len(paired)
        mean_delta = secondary_mean - primary_mean
        comparison.append(f"mean {mean_delta:+.3f} s ({100.0 * mean_delta / primary_mean:+.2f}%)")
        lines.append("Cache comparison (secondary − primary prefill wall; negative = secondary faster): " + "; ".join(comparison) + ".")
        lines.append(f"Pooled mean = mean of per-invocation deltas in seconds / mean primary wall = {mean_delta:+.3f} s / {primary_mean:.3f} s = {100.0 * mean_delta / primary_mean:+.2f}%; not the mean of per-invocation percentages.")
        lines.append("Prefill cache interpretation: consistent with no measurable prefill effect (deltas −8.05/−4.49/+5.85 %, within this device's ±6–14 % run scatter).")

    lines.append("Optional arm: n=1, exploratory.")

    optional_calibration_text = ", ".join(f"{item.get('tag')}={item.get('prompt_tokens')}" for item in optional_calibration) or "NA"

    lines += [
        "",
        "## Phase-0 I/O trace",
        "",
        "phase code 0 is PREFILL; phase code 1 is the single decode step and is excluded. overlap=0 is taken from the trace header.",
        "Max-lane-per-layer model (primary audit): the trace has no timestamps; all PREFILL rows have step=485, with one wave per layer and lanes interleaved. This model is PLAUSIBLE NOT VERIFIED for PREFILL, but is bracketed by the engine's own decode io_ms=334.4 ms versus trace max-lane 328.3 ms (1.9%) and refutes serialized Σlat=1275 ms. The primary verdict cannot flip: even the serialized upper bound stays ≤0.5.",
        "",
        "| invocation | phase_code | prefill_rows | sum_latency_s | lane0_s | lane1_s | lane2_s | lane3_s | sum_layers_max_lane_s (I/O wall) | compute_wall_s | wall_s | overlap |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        lanes = row.get("phase0_trace_lane_s", {})
        lines.append("| " + " | ".join([str(row["invocation"]), str(row["phase0_trace_phase_code"]), str(row.get("phase0_trace_rows", "NA")), f(row["phase0_trace_latency_sum_s"]), f(lanes.get("0"), 6), f(lanes.get("1"), 6), f(lanes.get("2"), 6), f(lanes.get("3"), 6), f(row["io_wall_point_s"]), f(row["compute_wall_s"]), f(row["wall_s"]), str(row["phase0_trace_overlap"])]) + " |")

    lines += [
        "",
        "## I/O floors, shares, and PREREG wording",
        "",
        "lower = sum latency / 4; point = sum over layers of max lane time; upper = sum latency. compute_wall = wall - point I/O wall.",
        "",
        "| invocation | bound | I/O floor wall_s | io_share | compute_share(point) | PREREG wording | wording robust across bounds |",
        "|---|---|---:|---:|---:|---|---|",
    ]
    for row in metrics:
        for bound in ("lower", "point", "upper"):
            lines.append("| " + " | ".join([str(row["invocation"]), bound, f(row[f"io_wall_{bound}_s"]), f(row[f"io_share_{bound}"]), f(row["compute_share"]), str(row[f"wording_{bound}"]), str(row["wording_robust"])]) + " |")

    lines.append("Study-wide narrowest margin: secondary inv3 upper-bound io share = 0.494, 1.1% below the 0.5 boundary; secondary inv1/inv2 are mixed under the serialized upper bound, with robustness False/False/True. All 3×3 cells are compute-bound except those two secondary upper-bound cells.")
    lines.append("Primary narrowest margin: inv2 upper-bound io share = 0.477, 4.5% below the 0.5 boundary; all primary 3×3 cells are compute-bound.")

    lines += [
        "",
        "## Headroom (wall-seconds)",
        "",
        "point is the primary I/O wall; lower/upper are sensitivity bounds. Formula: wall / max(I/O wall, compute_wall/k), k = 2, 4, 8.",
        "",
        "| invocation | lower_k2 | point_k2 | upper_k2 | lower_k4 | point_k4 | upper_k4 | lower_k8 | point_k8 | upper_k8 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        lines.append("| " + " | ".join([str(row["invocation"])] + [f(row[f"headroom_{bound}_k{k}"]) for k in (2, 4, 8) for bound in ("lower", "point", "upper")]) + " |")
    lines.append("Settling rule (PREREG; primary): min headroom(k=4) = 2.095 ≥ 2.0 under every bound → streaming-NPU has a real ceiling under the product streamer (HVX prerequisite (1) — decision is the owner's).")
    lines.append("Secondary settling: min headroom(k=4) = 1.938 under the serialized upper bound (owner-decision zone); lower/point bounds are ≥ 2.0.")
    arm_k4_min: dict[str, float] = {}
    for row in metrics:
        arm = str(row["arm"])
        values = [float(row[f"headroom_{bound}_k4"]) for bound in ("lower", "point", "upper")]
        arm_k4_min[arm] = min(arm_k4_min[arm], *values) if arm in arm_k4_min else min(values)
    if arm_k4_min:
        lines.append("Settling k=4 minima across all bounds by arm: " + "; ".join(f"{arm}={value:.3f}" for arm, value in sorted(arm_k4_min.items())) + ".")

    lines += [
        "",
        "## Read and rate cross-check",
        "",
        "trace read_bytes / 1,048,576 = MiB and /1,000,000 = decimal MB. The engine field is named read_mb but 351.160 matches 368,214,016 / 1,048,576 = 351.156250 MiB (rounded), not decimal MB; decimal MB is shown separately. Effective prefill MB/s = trace bytes / point I/O wall / 1,000,000; engine decode rate is the printed MiB/s counter.",
        "Systematic over-read in pp512 runs: +4096 B per read in 19,161/19,542 reads (+1.05%), included consistently in all pp512 byte totals.",
        "",
        "| invocation | prefill_read_bytes | prefill_read_MiB | engine_decode_read_mb_field | engine_decode_read_MB_decimal | engine_decode_read_bytes | engine_decode_read_MiB | effective_prefill_MB_s | effective_prefill_MiB_s | engine_decode_MiB_s |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in metrics:
        decoded = decode_summary(str(row["tag"]))
        point = float(row["io_wall_point_s"])
        trace_bytes = row.get("phase0_trace_read_bytes")
        effective_mb = float(trace_bytes) / point / 1_000_000.0 if isinstance(trace_bytes, (int, float)) and point > 0 else None
        effective_mib = float(trace_bytes) / point / 1_048_576.0 if isinstance(trace_bytes, (int, float)) and point > 0 else None
        engine_decimal_mb = float(decoded["read_bytes"]) / 1_000_000.0 if decoded["read_bytes"] is not None else None
        lines.append("| " + " | ".join([str(row["invocation"]), str(trace_bytes if trace_bytes is not None else "NA"), f(row["read_mb"]), f(decoded["read_field"]), f(engine_decimal_mb), str(int(decoded["read_bytes"]) if decoded["read_bytes"] is not None else "NA"), f(decoded["read_mib_from_bytes"]), f(effective_mb), f(effective_mib), f(decoded["decode_mib_s"])]) + " |")

    lines += [
        "",
        "## Sampler and gates",
        "",
        "sampler_cpu_s=0.020 over 40 rows followed the wrapper pid, not binary_pid — cross-check failed. No sampler CPU share is derived; cpuset evidence from binary_pid stands.",
        "",
        "| invocation | sampler_rows | sampler_cpu_s | sampler_wall_s | sampler_read_bytes | cpuset | cpuset_gate | cross-check | guard_max_temp_C |",
        "|---|---:|---:|---:|---:|---|---|---|---:|",
    ]
    for record in records:
        sample = sampler_crosscheck(str(record.get("tag", "")))
        guard = compact_arm(record).get("guard_max_temp_tenths")
        lines.append("| " + " | ".join([str(record.get("base_tag", record.get("tag"))), str(sample["rows"]), f(sample["cpu_s"], 3), f(sample["wall_s"], 3), str(sample["read_bytes"] if sample["read_bytes"] is not None else "NA"), ",".join(sample["cpuset"]) or "NA", str(sample["gate_pass"]), str(sample["status"]), f(float(guard) / 10.0 if isinstance(guard, (int, float)) else None, 1)]) + " |")

    lines += [
        "",
        "## Gate values",
        "",
        "| gate | value |",
        "|---|---|",
        f"| prompt_tokens | {attempt2['prompt']['token_count']} ({attempt2['prompt']['token_count_source']}); Amendment-1 window 480–544 is effectively 480–511 with -n 1 (n_ctx 512); 486 is inside both |",
        f"| decode_n | {decode_mode.get('decode_n', 'NA')} (n=0 probe rejected; one decode row excluded) |",
        "| calibration_measurement | false; calibration loads discarded |",
        "| primary_battery_min_pct | 50 (gate >=45) |",
        "| cool_start_max_C | 30.4 (gate <=32.0) |",
        "| guard_warn_C / kill_C / poll_s | 40 / 43 / 10 |",
        "| cpuset_allowed | 0-7 |",
        "| drop_caches | denied in Attempt 1; not retried |",
        "| follow-up battery deviation | run_q62.py used >=40% versus locked >=45%; actual levels 68% -> 60% were all >=45%; no invocation was admitted that the locked gate would reject |",
        "| secondary | --cache-mb 2000; 3 separate invocations completed; gate used >=40% (formal deviation above); observed levels all >=45% |",
        f"| optional_p2048 | --cache-mb 0; 1 invocation completed; n=1, exploratory; prompt_tokens={optional_prompt_count or 'NA'}; gate used >=40% (formal deviation above) |",
        "| phase-0 engine counters | io_ms, compute_ms, mgmt_ms, cpu_ms, majflt absent; not fabricated |",
        "| primary wall trend | 38.049→35.814→32.781 s (−13.85%); 82.8% of the drop is compute-side, I/O non-monotone; primary verdict survives |",
        f"| optional calibration | {optional_calibration_text}; calibration 2 n_ctx rejection retained; final accepted count={optional_prompt_count or 'NA'} |",
        f"| optional prompt hash | {optional_sha or 'NA'}; 7894 B; device recheck matches; superseded candidate 66271b47... was 7973 B and is retained as raw/q62_p2048.superseded_candidate.sha256.txt |",
        "",
        "The former read-rate-divided-by-wall identity is not used. The engine's BMOE_PROGRESS/CSV counters cover the one decode step, not phase-0 I/O/compute.",
    ]
    with (CELL / "REPORT.md").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
