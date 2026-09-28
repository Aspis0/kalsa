#!/usr/bin/env python3
"""Host-side parse of one qdc-8elite-heat-arms session (PREREG "Metrics").

Reads raw/device-out/{markers.txt,samples.txt,<tag>.log,<tag>.proof.log},
writes raw/results.tsv (one row per arm) and prints the median table.
Usage: analyze.py <device-out dir>
"""
import re
import statistics
import sys
from pathlib import Path

TAIL_S = 60


def read_markers(path):
    arms = {}
    for line in path.read_text().splitlines():
        p = line.split()
        if len(p) < 2 or p[0] == "H":
            continue
        kind, tag, epoch = p[0], p[1], int(p[-1])
        a = arms.setdefault(tag, {"tag": tag})
        if kind == "C":
            a["cool"], a["cool_skin"], a["cool_s"], a["cool_t"] = p[2], p[3], p[4], epoch
        elif kind == "A_START":
            a["start"] = epoch
        elif kind == "A_END":
            a["end"], a["rc"] = epoch, p[2].split("=")[1]
        elif kind == "V":
            a["void"] = p[2]
    return arms


def read_samples(path):
    skin, zones, kills = [], [], []
    for line in path.read_text(errors="replace").splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == "S" and len(p) == 3:
            skin.append((int(p[1]), float(p[2])))
        elif p[0] == "Z":
            vals = {}
            for kv in p[2:]:
                name, _, v = kv.partition("=")
                if v.lstrip("-").isdigit():
                    vals[name] = int(v) / 1000.0
            zones.append((int(p[1]), vals))
        elif p[0] == "K":
            kills.append(int(p[1]))
    return skin, zones, kills


def rel_ts(stamp):
    """Log prefix 'm.ss.mmm.uuu' -> seconds since process start."""
    m, s, ms, us = (int(x) for x in stamp.split("."))
    return m * 60 + s + ms / 1000 + us / 1e6


def parse_completion(text):
    r = {}
    m = re.search(r"^(\d+\.\d+\.\d+\.\d+) I generate:", text, re.M)
    r["t_gen"] = rel_ts(m.group(1)) if m else None
    m = re.search(r"prompt eval time =\s+([\d.]+) ms /\s+(\d+) tokens.*?([\d.]+) tokens per second", text)
    if m:
        r["prefill_ms"], r["prompt_n"], r["prefill_tps"] = float(m.group(1)), int(m.group(2)), float(m.group(3))
    m = re.search(r"\s eval time =\s+([\d.]+) ms /\s+(\d+) runs.*?([\d.]+) tokens per second", text)
    if m:
        r["decode_runs"], r["decode_tps"] = int(m.group(2)), float(m.group(3))
    r["bufs"] = sorted(set(re.findall(r"load_tensors:\s+(\S+) model buffer size", text)))
    # f25 logs never carry `selected platform:` (0/21 S23 run-6 logs); the
    # driver line names the same QUALCOMM platform (PREREG "Proof").
    r["qcom"] = ("selected platform: 'QUALCOMM" in text
                 or "ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM" in text)
    return r


def parse_bench(text):
    m = re.search(r"\|\s*tg256\s*\|\s*([\d.]+)\s*±", text)
    return {"tg_tps": float(m.group(1))} if m else {}


def proof(backend, info, proof_text):
    bufs = set(info.get("bufs", []))
    if backend == "cpu":
        return bool(bufs) and bufs <= {"CPU", "CPU_REPACK"}, f"bufs={','.join(sorted(bufs))}"
    if backend == "gpu":
        return info.get("qcom") and "OpenCL" in bufs, f"qcom={info.get('qcom')} bufs={','.join(sorted(bufs))}"
    ops = len(re.findall(r"HTP0 execute-op MUL_MAT", proof_text or ""))
    v79 = "libggml-htp-v79" in (proof_text or "")
    ok = ops >= 1 and v79 and "HTP0" in bufs
    return ok, f"htp_mulmat_ops={ops} v79={v79} bufs={','.join(sorted(bufs))}"


STOP_WORDS = ("CDSP0 CRASHED", "dspqueue_read failed", "dspqueue_write failed",
              "ggml_abort", "GGML_ASSERT", "Segmentation")


def heat(skin, zones, t0, t_run_end):
    """Skin metrics over [t0, t_run_end + TAIL]; zone peak over [t0, t_run_end]."""
    t1 = t_run_end + TAIL_S
    before = [v for t, v in skin if t <= t0]
    if not before:
        return None
    s0 = before[-1]
    pts = [(t0, s0)] + [(t, v) for t, v in skin if t0 < t <= t1]
    area = 0.0
    for (ta, va), (tb, vb) in zip(pts, pts[1:]):
        area += (tb - ta) * (max(0.0, va - s0) + max(0.0, vb - s0)) / 2
    peak = max(v for _, v in pts)
    zpk = [max((v for k, v in z.items() if k.startswith(("cpu", "gpuss"))), default=float("nan"))
           for t, z in zones if t0 <= t <= t_run_end]
    npk = [max((v for k, v in z.items() if k.startswith("nsp")), default=float("nan"))
           for t, z in zones if t0 <= t <= t_run_end]
    return {"skin0": s0, "peak": peak, "dskin": peak - s0, "area": area,
            "zone_peak": max(zpk) if zpk else float("nan"),
            "nsp_peak": max(npk) if npk else float("nan")}


def main(out):
    arms = read_markers(out / "markers.txt")
    skin, zones, kills = read_samples(out / "samples.txt")
    # The cooldown's final HAL skin read (C marker) is a real skin sample too;
    # without it arm 1 (started in the sampler's first second) has none <= t0.
    for a in arms.values():
        if a.get("cool_t") and a.get("cool_skin", "").replace(".", "", 1).isdigit():
            skin.append((a["cool_t"], float(a["cool_skin"])))
    skin.sort()
    rows = []
    for tag, a in sorted(arms.items()):
        _, kind, b, rep = tag.split("-")
        row = {"tag": tag, "arm": f"{kind}-{b}", "rep": rep, "status": "OK", "why": ""}
        if "void" in a or "start" not in a or "end" not in a:
            row.update(status="VOID", why=a.get("void", "not_run"))
            rows.append(row)
            continue
        text = (out / f"{tag}.log").read_text(errors="replace")
        ptext = (out / f"{tag}.proof.log").read_text(errors="replace") if (out / f"{tag}.proof.log").exists() else ""
        row["cool"] = f"{a.get('cool')}@{a.get('cool_skin')}/{a.get('cool_s')}s"
        if kind == "P":
            info = parse_completion(text)
            row.update({k: info.get(k) for k in ("prefill_ms", "prompt_n", "prefill_tps", "decode_runs", "decode_tps")})
            t0 = a["start"] + (info["t_gen"] or 0)
            row["dur_s"] = a["end"] - t0
            ok, row["proof"] = proof(b, info, ptext)
        else:
            info = parse_bench(text)
            row.update(info)
            t0 = a["start"]
            row["dur_s"] = a["end"] - t0
            ok, row["proof"] = ("tg_tps" in info), "dev=none tg256_row=" + str("tg_tps" in info)
        h = heat(skin, zones, t0, a["end"])
        if h:
            row.update(h)
        hits = [w for w in STOP_WORDS if w in text or w in ptext]
        if a.get("rc") != "0":
            row.update(status="VOID", why=f"rc={a.get('rc')}")
        elif any(a["start"] <= k <= a["end"] + TAIL_S for k in kills):
            row.update(status="VOID", why="watchdog")
        elif hits:
            row.update(status="VOID", why="stop:" + hits[0])
        elif not ok:
            row.update(status="VOID", why="proof")
        elif a.get("cool") != "ok":
            row.update(status="VOID", why="hot")
        elif not h:
            row.update(status="VOID", why="no_skin")
        elif kind == "P" and info.get("t_gen") is None:
            row.update(status="VOID", why="no_generate_line")
        rows.append(row)

    cols = ["tag", "arm", "rep", "status", "why", "cool", "proof", "prompt_n", "prefill_ms", "prefill_tps",
            "decode_runs", "decode_tps", "tg_tps", "dur_s", "skin0", "peak", "dskin", "area", "zone_peak", "nsp_peak"]
    lines = ["\t".join(cols)]
    for r in rows:
        lines.append("\t".join(f"{r[c]:.2f}" if isinstance(r.get(c), float) else str(r.get(c, "")) for c in cols))
    (out.parent / "results.tsv").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))

    print("\n| arm | n OK | duration s | skin start | skin Δ | peak skin | skin area °C·s | CPU/GPU zone peak | NSP peak | prefill ms | prefill tok/s | tg tok/s |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    order = ["P-cpu", "P-gpu", "P-npu", "D-6", "D-4", "D-2"]
    for arm in order:
        ok = [r for r in rows if r["arm"] == arm and r["status"] == "OK"]

        def med(k):
            v = [r[k] for r in ok if isinstance(r.get(k), (int, float))]
            return f"{statistics.median(v):.1f}" if v else "—"
        areas = sorted(f"{r['area']:.0f}" for r in ok)
        print(f"| {arm} | {len(ok)} | {med('dur_s')} | {med('skin0')} | {med('dskin')} | {med('peak')} | "
              f"{med('area')} ({'/'.join(areas)}) | {med('zone_peak')} | {med('nsp_peak')} | {med('prefill_ms')} | "
              f"{med('prefill_tps')} | {med('tg_tps')} |")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
