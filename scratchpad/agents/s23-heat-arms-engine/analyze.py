#!/usr/bin/env python3
"""Summarize S23 engine-arm thermal samples and backend evidence."""
import csv
import re
import statistics
import sys
from pathlib import Path

TAIL_SECONDS = 60
STOP_WORDS = ("CDSP0 CRASHED", "dspqueue_read failed", "dspqueue_write failed",
              "ggml_abort", "GGML_ASSERT", "Segmentation")


def read_samples(path):
    with path.open() as f:
        next(f, None)
        rows = list(csv.DictReader(f, fieldnames=("epoch", "battery_temp_dC", "thermal_status",
                                                  "skin_C", "battery_pct", "wakefulness"),
                                   delimiter="\t"))
    for row in rows:
        row["epoch"] = int(row["epoch"])
        row["battery_c"] = int(row["battery_temp_dC"]) / 10
        row["status"] = int(row["thermal_status"])
        row["skin_c"] = float(row["skin_C"]) if row["skin_C"] != "NA" else None
    return rows


def read_markers(path):
    arms = {}
    proof = {"ops": 0, "rc": None}
    for line in path.read_text(errors="replace").splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == "PROOF_END":
            proof["rc"] = p[2].split("=")[1]
            proof["ops"] = int(p[3].split("=")[1])
            proof["v73"] = p[4].split("=")[1] == "1"
        elif p[0] == "A_START":
            arms.setdefault(p[1], {})["start"] = int(p[-1])
        elif p[0] == "A_END":
            arms.setdefault(p[1], {}).update(end=int(p[-1]), rc=p[2].split("=")[1])
        elif p[0] == "TAIL_END":
            arms.setdefault(p[1], {})["tail"] = int(p[-1])
        elif p[0] == "COOL":
            if p[1].startswith(("P-", "D-")):
                arms.setdefault(p[1], {})["cool"] = p[2]
        elif p[0] == "VOID":
            if p[1].startswith(("P-", "D-")):
                arms.setdefault(p[1], {})["void"] = " ".join(p[2:-1])
        elif p[0] == "WAKE":
            tag = p[1].replace("before_", "").replace("after_", "")
            if tag.startswith(("P-", "D-")):
                arms.setdefault(tag, {})[p[1].split("_")[0]] = p[2].split("=")[1]
    return arms, proof


def completion_metrics(text):
    m = re.search(r"prompt eval time =\s*([\d.]+) ms /\s*(\d+) tokens.*?([\d.]+) tokens per second", text)
    prompt = tuple(map(float, m.groups())) if m else None
    return {"prompt_ms": prompt[0] if prompt else None,
            "prompt_tokens": int(prompt[1]) if prompt else None,
            "prompt_tps": prompt[2] if prompt else None}


def decode_tps(text):
    m = re.search(r"\|\s*tg256\s*\|\s*([\d.]+)\s*±", text)
    return float(m.group(1)) if m else None


def backend_proof(arm, text, htp_proof):
    if arm.startswith("P-cpu"):
        ok = "CPU model buffer size" in text and "OpenCL model buffer size" not in text and "HTP0 model buffer size" not in text
        return ok, "CPU model buffer"
    if arm.startswith("P-gpu"):
        platform = ("selected platform: 'QUALCOMM" in text or
                    "OpenCL driver: OpenCL 3.0 QUALCOMM" in text)
        ok = platform and "OpenCL model buffer size" in text
        return ok, f"QUALCOMM={platform} OpenCL_buffer={'OpenCL model buffer size' in text}"
    if arm.startswith("P-npu"):
        buffer = "HTP0 model buffer size" in text
        return htp_proof and buffer, f"HTP_MUL_MAT_proof={htp_proof} HTP0_buffer={buffer}"
    return decode_tps(text) is not None, "CPU tg256 row"


def integrate(points, key, start_value):
    area = 0.0
    for (ta, a), (tb, b) in zip(points, points[1:]):
        area += (tb - ta) * (max(0.0, a - start_value) + max(0.0, b - start_value)) / 2
    return area


def window_metrics(samples, start, end):
    before = [s for s in samples if s["epoch"] <= start]
    if not before:
        return {}
    base = before[-1]
    inside = [s for s in samples if start < s["epoch"] <= end]
    battery_points = [(start, base["battery_c"])] + [(s["epoch"], s["battery_c"]) for s in inside]
    battery_peak = max(v for _, v in battery_points)
    result = {"battery_start_c": base["battery_c"],
              "battery_peak_c": battery_peak,
              "battery_delta_c": battery_peak - base["battery_c"],
              "battery_area_c_s": integrate(battery_points, "battery_c", base["battery_c"]),
              "peak_status": max([base["status"]] + [s["status"] for s in inside])}
    skin_base = base["skin_c"]
    skin_rows = [(s["epoch"], s["skin_c"]) for s in inside if s["skin_c"] is not None]
    if skin_base is not None:
        skin_points = [(start, skin_base)] + skin_rows
        skin_peak = max(v for _, v in skin_points)
        result.update(skin_start_c=skin_base, skin_peak_c=skin_peak,
                      skin_delta_c=skin_peak - skin_base,
                      skin_area_c_s=integrate(skin_points, "skin_c", skin_base))
    return result


def parse_arm(tag, data, out, samples, htp_proof):
    row = {"tag": tag, "valid": "NO", "reason": "incomplete"}
    if "start" not in data or "end" not in data or "tail" not in data:
        row["reason"] = data.get("void", "incomplete_or_hot")
        return row
    text = (out / f"{tag}.log").read_text(errors="replace")
    kind = tag.split("-")[0]
    row["run_s"] = data["end"] - data["start"]
    row["cool"] = data.get("cool", "missing")
    if kind == "P":
        row.update(completion_metrics(text))
    else:
        row["tg256_tps"] = decode_tps(text)
    proof, detail = backend_proof(tag, text, htp_proof)
    row["proof"] = detail
    hits = [w for w in STOP_WORDS if w in text]
    row.update(window_metrics(samples, data["start"], data["tail"]))
    if data.get("rc") != "0":
        row["reason"] = f"exit_{data.get('rc')}"
    elif data.get("before") != "Awake" or data.get("after") != "Awake":
        row["reason"] = "screen_not_awake"
    elif data.get("cool") != "ok":
        row["reason"] = data.get("void", "hot")
    elif not proof:
        row["reason"] = "backend_proof"
    elif hits:
        row["reason"] = "failure:" + hits[0]
    elif "battery_area_c_s" not in row:
        row["reason"] = "missing_thermal_samples"
    else:
        row["valid"], row["reason"] = "YES", ""
    return row


def median(rows, key):
    values = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    return f"{statistics.median(values):.2f}" if values else "—"


def main(out):
    samples = read_samples(out / "samples.tsv")
    markers, proof = read_markers(out / "markers.txt")
    htp_proof = proof["rc"] == "0" and proof["ops"] > 0 and proof.get("v73", False)
    rows = [parse_arm(tag, data, out, samples, htp_proof) for tag, data in sorted(markers.items())]
    cols = ("tag", "valid", "reason", "cool", "run_s", "prompt_tokens", "prompt_ms", "prompt_tps",
            "tg256_tps", "battery_start_c", "battery_delta_c", "battery_peak_c", "battery_area_c_s",
            "skin_delta_c", "skin_peak_c", "skin_area_c_s", "peak_status", "proof")
    with (out.parent / "results.tsv").open("w") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter="\t", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print("\t".join(cols))
    for row in rows:
        print("\t".join(str(row.get(c, "")) for c in cols))
    print("\n| arm | valid reps | median battery Δ °C | median battery area °C·s | median skin Δ °C | median skin area °C·s | median speed |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for prefix in ("P-cpu", "P-gpu", "P-npu", "D-5", "D-3", "D-2"):
        group = [r for r in rows if r["tag"].startswith(prefix) and r["valid"] == "YES"]
        speed = "prompt_tps" if prefix.startswith("P-") else "tg256_tps"
        print(f"| {prefix} | {len(group)} | {median(group, 'battery_delta_c')} | {median(group, 'battery_area_c_s')} | "
              f"{median(group, 'skin_delta_c')} | {median(group, 'skin_area_c_s')} | {median(group, speed)} |")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
