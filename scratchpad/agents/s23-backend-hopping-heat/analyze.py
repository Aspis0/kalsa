#!/usr/bin/env python3
"""Summarize the S23 backend-hopping session's one-second thermal samples."""

import csv
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).parent / "raw/device-out/out"
SAMPLES = ROOT / "samples.tsv"
MARKERS = ROOT / "markers.tsv"


def read_samples():
    with SAMPLES.open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    for row in rows:
        row["t"] = float(row["epoch"])
        row["battery"] = int(row["battery_dC"]) / 10
        row["skin"] = float(row["skin_C"])
        row["status_n"] = int(row["status"])
    return rows


def read_markers():
    events = {}
    for line in MARKERS.read_text().splitlines():
        cols = line.split("\t", 2)
        if len(cols) == 3:
            events.setdefault(cols[1], []).append((float(cols[0]), cols[2]))
    return events


def sensor(row, key):
    value = float(row[key])
    if key in {"battery", "skin"}:
        return value
    return value / 1000


def at_or_before(rows, t):
    candidates = [row for row in rows if row["t"] <= t]
    return candidates[-1] if candidates else rows[0]


def at_or_after(rows, t):
    return next((row for row in rows if row["t"] >= t), rows[-1])


def max_in(rows, key):
    vals = [sensor(row, key) for row in rows if row.get(key) not in {None, "", "NA"}]
    return max(vals) if vals else float("nan")


def area(rows, key, baseline):
    points = [(row["t"], max(0.0, sensor(row, key) - baseline)) for row in rows]
    return sum((t1 - t0) * (v0 + v1) / 2 for (t0, v0), (t1, v1) in zip(points, points[1:]))


def run_markers(events, prefix):
    found = []
    for event, values in events.items():
        if not event.startswith(prefix):
            continue
        tag = event[len("START_"):]
        ended = events.get("END_" + tag)
        if ended:
            found.append((values[0][0], ended[0][0], tag))
    return sorted(found)


def log_text(tag):
    path = ROOT / f"{tag}.log"
    return path.read_text(errors="replace") if path.exists() else ""


def prompt_eval(text):
    match = re.search(r"prompt eval time =\s*([0-9.]+) ms /\s*(\d+) tokens", text)
    return (float(match.group(1)), int(match.group(2))) if match else (float("nan"), 0)


def bench_speed(text):
    match = re.search(r"\|\s*lfm2 .*?\|.*?\|\s*tg256\s*\|\s*([0-9.]+)", text)
    return float(match.group(1)) if match else float("nan")


def write_prefill(rows, events):
    runs = run_markers(events, "START_P-")
    output = []
    indices = {"cpu": 0, "npu": 0, "gpu": 0}
    for start, end, tag in runs:
        backend = tag.split("-")[1]
        indices[backend] += 1
        before = at_or_before(rows, start)
        after = at_or_after(rows, end)
        window = [row for row in rows if start <= row["t"] <= end]
        if not window:
            window = [before, after]
        text = log_text(tag)
        eval_ms, tokens = prompt_eval(text)
        diffs = []
        for key in ("battery", "skin"):
            diffs.append(max_in(window, key) - sensor(before, key))
        gpu = max(max_in(window, key) for key in rows[0] if key.startswith("gpuss-"))
        nsp = max(max_in(window, key) for key in rows[0] if key.startswith("nspss-"))
        cpu = max(max_in(window, key) for key in rows[0] if key.startswith("cpu-") or key.startswith("cpuss-"))
        output.append((backend, indices[backend], tag, eval_ms, tokens,
                       sensor(before, "battery"), sensor(after, "battery"), diffs[0],
                       sensor(before, "skin"), sensor(after, "skin"), diffs[1], cpu, gpu, nsp,
                       "EXIT=0" in text))
    path = ROOT.parent / "prefill-results.tsv"
    with path.open("w") as stream:
        stream.write("backend\tunit\tlog_tag\tprompt_eval_ms\tprompt_tokens\tbattery_start_C\tbattery_end_C\tbattery_peak_rise_C\tskin_start_C\tskin_end_C\tskin_peak_rise_C\tpeak_cpu_C\tpeak_gpu_C\tpeak_nsp_C\texit0\n")
        for row in output:
            stream.write("\t".join(str(round(x, 3) if isinstance(x, float) else x) for x in row) + "\n")
    return output


def write_decode(rows, events):
    runs = run_markers(events, "START_D-")
    output = []
    for start, end, tag in runs:
        tail_key = "TAIL_END_" + tag
        tail = events.get(tail_key, [(end, "")])[0][0]
        base = at_or_before(rows, start)
        window = [row for row in rows if start <= row["t"] <= tail]
        window = [base] + window
        text = log_text(tag)
        backend = tag.split("-")[1]
        family = {
            "cpu": [k for k in rows[0] if k.startswith("cpu-") or k.startswith("cpuss-")],
            "gpu": [k for k in rows[0] if k.startswith("gpuss-")],
            "npu": [k for k in rows[0] if k.startswith("nspss-")],
        }
        peaks = [max(max_in(window, key) for key in family[name]) for name in ("cpu", "gpu", "npu")]
        batt_peak = max_in(window, "battery")
        skin_peak = max_in(window, "skin")
        batt_area = area(window, "battery", sensor(base, "battery"))
        skin_area = area(window, "skin", sensor(base, "skin"))
        output.append((backend, tag.split("-")[2], tag, bench_speed(text), sensor(base, "battery"), batt_peak - sensor(base, "battery"), batt_area, batt_area / 256, sensor(base, "skin"), skin_peak - sensor(base, "skin"), skin_area, skin_area / 256, *peaks, "EXIT=0" in text))
    path = ROOT.parent / "decode-results.tsv"
    with path.open("w") as stream:
        stream.write("backend\trep\tlog_tag\ttg256_tok_s\tbattery_start_C\tbattery_delta_C\tbattery_area_Cs\tbattery_Cs_per_token\tskin_start_C\tskin_delta_C\tskin_area_Cs\tskin_Cs_per_token\tpeak_cpu_C\tpeak_gpu_C\tpeak_nsp_C\texit0\n")
        for row in output:
            stream.write("\t".join(str(round(x, 4) if isinstance(x, float) else x) for x in row) + "\n")
    return output


def write_supplement():
    root = ROOT.parent / "supplement"
    samples_path = root / "samples.tsv"
    with samples_path.open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    for row in rows:
        row["t"] = int(row["epoch_ns"]) / 1e9
    events = read_marker_file(root / "markers.tsv")
    starts = sorted((event, values[0][0]) for event, values in events.items() if event.startswith("START_P-npu-supp-"))
    output = []
    for event, start in starts:
        tag = event[len("START_"):]
        end = events["END_" + tag][0][0]
        before = at_or_before(rows, start)
        after = at_or_after(rows, end)
        window = [row for row in rows if start <= row["t"] <= end]
        text = (root / f"{tag}.log").read_text(errors="replace")
        eval_ms, tokens = prompt_eval(text)
        peaks = [max_in(window, key) for key in rows[0] if key.startswith("nspss-")]
        nsp_peak = max(peaks) if peaks else float("nan")
        output.append((tag, eval_ms, tokens, float(before["hal_bat_C"]), float(after["hal_bat_C"]),
                       float(before["skin_C"]), float(after["skin_C"]), nsp_peak,
                       "HTP0 model buffer size" in text, "EXIT=0" in text))
    path = ROOT.parent / "supplement-prefill-results.tsv"
    with path.open("w") as stream:
        stream.write("run\tprompt_eval_ms\tprompt_tokens\tbattery_start_C\tbattery_end_C\tskin_start_C\tskin_end_C\tpeak_nsp_C\thtp_buffer\texit0\n")
        for row in output:
            stream.write("\t".join(str(round(x, 3) if isinstance(x, float) else x) for x in row) + "\n")
    times = [row["t"] for row in rows]
    intervals = [b - a for a, b in zip(times, times[1:])]
    return output, intervals


def read_marker_file(path):
    events = {}
    for line in path.read_text().splitlines():
        cols = line.split("\t", 2)
        if len(cols) == 3:
            events.setdefault(cols[1], []).append((int(cols[0]) / 1e9, cols[2]))
    return events


def main():
    rows = read_samples()
    events = read_markers()
    intervals = [b["t"] - a["t"] for a, b in zip(rows, rows[1:])]
    prefills = write_prefill(rows, events)
    decodes = write_decode(rows, events)
    print(f"samples={len(rows)} cadence_median_s={statistics.median(intervals):.1f} cadence_max_s={max(intervals):.1f}")
    print(f"prefill_runs={len(prefills)} decode_runs={len(decodes)}")
    for backend in ("cpu", "npu", "gpu"):
        group = [run for run in prefills if run[0] == backend]
        print(f"prefill_{backend}={len(group)} prompt_eval_ms=" + ",".join(str(round(run[3], 2)) for run in group))
    for backend in ("cpu", "gpu", "npu"):
        group = [run for run in decodes if run[0] == backend]
        print(f"decode_{backend}={len(group)} tg256=" + ",".join(str(round(run[3], 2)) for run in group))
        if group:
            for col, name in ((6, "battery_area"), (10, "skin_area")):
                vals = [run[col] for run in group]
                print(f"{name}_{backend}_median={statistics.median(vals):.3f} min={min(vals):.3f} max={max(vals):.3f}")
    supplement, supplement_intervals = write_supplement()
    print(f"supplement_npu_runs={len(supplement)} cadence_median_s={statistics.median(supplement_intervals):.3f} cadence_max_s={max(supplement_intervals):.3f}")
    print("supplement_prompt_eval_ms=" + ",".join(str(round(run[1], 2)) for run in supplement))


if __name__ == "__main__":
    main()
