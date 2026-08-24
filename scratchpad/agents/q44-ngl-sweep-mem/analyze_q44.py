"""Analyze pulled q44 ngl-sweep raw. Writes analysis.json next to itself."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
DEV = ROOT / "results" / "ngl_sweep_s23" / "device" / "kalsa_q44"
OUT_JSON = Path(__file__).resolve().parent / "analysis.json"
MANIFEST_DIR = ROOT / "results" / "ngl_sweep_s23"

POINTS = [0, 7, 13, 19, 99]
N_LAYERS = 25
MODEL_BYTES = 3326160384  # on-device ls
GGUF_WEIGHT_BYTES = 3317921536  # jsonl model_size

OPENCL_RE = re.compile(
    r"OPENCL_ALLOC\{kind=(?P<kind>[^,]+),bytes=(?P<bytes>\d+),mib=(?P<mib>[0-9.]+),sum_mib=(?P<sum_mib>[0-9.]+),err=(?P<err>-?\d+)\}"
)
OFFLOAD_RE = re.compile(r"offloaded\s+(\d+)/(\d+)\s+layers")
SET_TENSOR_RE = re.compile(
    r"OPENCL_SET_TENSOR\{name=(?P<name>[^,]+),type=(?P<type>[^,]+),nbytes=(?P<nbytes>\d+)"
)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def meminfo_field(text: str, name: str) -> int | None:
    m = re.search(rf"^{re.escape(name)}:\s+(\d+)\s+kB", text, re.M)
    return int(m.group(1)) if m else None


def batt_temp_c(text: str) -> float | None:
    m = re.search(r"^\s*temperature:\s*(\d+)", text, re.M)
    return int(m.group(1)) / 10.0 if m else None


def batt_level(text: str) -> int | None:
    m = re.search(r"^\s*level:\s*(\d+)", text, re.M)
    return int(m.group(1)) if m else None


def parse_jsonl(p: Path) -> dict:
    out = {"pp512_ts": None, "tg128_ts": None, "rows": []}
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        out["rows"].append(row)
        n_prompt = row.get("n_prompt", 0)
        n_gen = row.get("n_gen", 0)
        ts = row.get("avg_ts")
        if n_prompt and not n_gen:
            out["pp512_ts"] = ts
        elif n_gen and not n_prompt:
            out["tg128_ts"] = ts
    return out


def parse_stderr(p: Path) -> dict:
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
    off = OFFLOAD_RE.findall(text)
    last_sum = None
    created = 0
    created_no_try = 0
    allocs = []
    for m in OPENCL_RE.finditer(text):
        rec = {k: m.group(k) for k in ("kind", "bytes", "mib", "sum_mib", "err")}
        rec["bytes"] = int(rec["bytes"])
        rec["mib"] = float(rec["mib"])
        rec["sum_mib"] = float(rec["sum_mib"])
        rec["err"] = int(rec["err"])
        allocs.append(rec)
        last_sum = rec["sum_mib"]
        created += rec["bytes"]
        if not rec["kind"].startswith("try."):
            created_no_try += rec["bytes"]
    set_sum = 0
    n_set = 0
    for m in SET_TENSOR_RE.finditer(text):
        set_sum += int(m.group("nbytes"))
        n_set += 1
    off_x, off_n = (None, None)
    if off:
        off_x, off_n = int(off[-1][0]), int(off[-1][1])
    notes = re.findall(r"OPENCL_ALLOC\{note=([^,]+),sum_mib=([0-9.]+)\}", text)
    return {
        "offloaded": off_x,
        "N": off_n,
        "n_offload_lines": len(off),
        "opencl_last_sum_mib": last_sum,
        "opencl_created_bytes": created,
        "opencl_created_bytes_no_try": created_no_try,
        "opencl_n_alloc": len(allocs),
        "set_tensor_nbytes": set_sum,
        "set_tensor_n": n_set,
        "notes": notes[-6:] if notes else [],
        "stderr_bytes": len(text.encode("utf-8", errors="replace")),
    }


def parse_sampler(p: Path) -> dict:
    rows = []
    if not p.exists():
        return {"n": 0, "rows": []}
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    hdr = lines[0].split(",") if lines else []
    for line in lines[1:]:
        if not line.strip():
            continue
        parts = line.split(",")
        # epoch,MemAvailable,MemFree,SwapFree,pid,VmRSS,RssAnon,RssFile,VmSwap,gpumem,cpuset,Cpus_allowed
        def num(i):
            try:
                v = parts[i].strip()
                if v in ("", "NA"):
                    return None
                return int(float(v))
            except Exception:
                return None

        rows.append(
            {
                "epoch": num(0),
                "MemAvailable_kB": num(1),
                "MemFree_kB": num(2),
                "SwapFree_kB": num(3),
                "pid": parts[4] if len(parts) > 4 else None,
                "VmRSS_kB": num(5),
                "RssAnon_kB": num(6),
                "RssFile_kB": num(7),
                "VmSwap_kB": num(8),
                "gpumem": parts[9] if len(parts) > 9 else None,
                "cpuset": parts[10] if len(parts) > 10 else None,
                "Cpus_allowed_list": parts[11] if len(parts) > 11 else None,
            }
        )

    def peak(key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return max(vals) if vals else None

    def trough(key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return min(vals) if vals else None

    live = [r for r in rows if r.get("pid") not in (None, "NA", "")]
    return {
        "n": len(rows),
        "n_with_pid": len(live),
        "min_MemAvailable_kB": trough("MemAvailable_kB"),
        "max_MemAvailable_kB": peak("MemAvailable_kB"),
        "min_MemFree_kB": trough("MemFree_kB"),
        "peak_VmRSS_kB": peak("VmRSS_kB"),
        "peak_RssAnon_kB": peak("RssAnon_kB"),
        "peak_RssFile_kB": peak("RssFile_kB"),
        "peak_VmSwap_kB": peak("VmSwap_kB"),
        "gpumem_unique": sorted({r["gpumem"] for r in rows if r.get("gpumem")}),
        "first": rows[0] if rows else None,
        "last": rows[-1] if rows else None,
    }


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""


def analyze_point(ngl: int) -> dict:
    pt = DEV / "points" / f"ngl{ngl}"
    pre = read_text(pt / "meminfo_pre.txt")
    post = read_text(pt / "meminfo_post.txt")
    batt_pre = read_text(pt / "battery_pre.txt")
    batt_post = read_text(pt / "battery_post.txt")
    samp = parse_sampler(pt / "sampler.csv")
    js = parse_jsonl(pt / "stdout.jsonl")
    err = parse_stderr(pt / "stderr.txt")
    ma_pre = meminfo_field(pre, "MemAvailable")
    ma_post = meminfo_field(post, "MemAvailable")
    ma_min = samp["min_MemAvailable_kB"]
    drop = None
    if ma_pre is not None and ma_min is not None:
        drop = ma_pre - ma_min  # kB
    off = err["offloaded"]
    if off is None and ngl == 0:
        off = 0
    bytes_layer = None
    if off is not None:
        bytes_layer = int(round(GGUF_WEIGHT_BYTES * off / N_LAYERS))
    bytes_ocl = None
    if err["opencl_last_sum_mib"] is not None:
        bytes_ocl = int(err["opencl_last_sum_mib"] * 1048576)
    bytes_set = err["set_tensor_nbytes"] or None

    def k_of(num_kb, den_bytes):
        if num_kb is None or not den_bytes:
            return None
        return (num_kb * 1024.0) / den_bytes

    return {
        "ngl_requested": ngl,
        "rc": read_text(pt / "rc.txt").strip(),
        "t_start": read_text(pt / "t_start.txt").strip(),
        "t_end": read_text(pt / "t_end.txt").strip(),
        "cpuset": read_text(pt / "cpuset.txt").strip(),
        "cpus_allowed": read_text(pt / "cpus_allowed.txt").strip(),
        "nproc": read_text(pt / "nproc.txt").strip(),
        "kgsl_ls": read_text(pt / "kgsl_proc_ls.txt").strip()[:500],
        "layers_offloaded": off,
        "N": err["N"] or (N_LAYERS if off is not None else None),
        "pp512_ts_exploratory": js["pp512_ts"],
        "tg128_ts_exploratory": js["tg128_ts"],
        "MemAvailable_pre_kB": ma_pre,
        "MemAvailable_min_during_kB": ma_min,
        "MemAvailable_post_kB": ma_post,
        "MemAvailable_drop_kB": drop,
        "MemFree_pre_kB": meminfo_field(pre, "MemFree"),
        "SwapFree_pre_kB": meminfo_field(pre, "SwapFree"),
        "SwapFree_post_kB": meminfo_field(post, "SwapFree"),
        "peak_RssAnon_kB": samp["peak_RssAnon_kB"],
        "peak_RssFile_kB": samp["peak_RssFile_kB"],
        "peak_VmSwap_kB": samp["peak_VmSwap_kB"],
        "peak_VmRSS_kB": samp["peak_VmRSS_kB"],
        "sampler_n": samp["n"],
        "sampler_n_with_pid": samp["n_with_pid"],
        "batt_level_pre": batt_level(batt_pre),
        "batt_level_post": batt_level(batt_post),
        "batt_temp_pre_C": batt_temp_c(batt_pre),
        "batt_temp_post_C": batt_temp_c(batt_post),
        "stderr": err,
        "bytes_offloaded_layer_frac": bytes_layer,
        "bytes_offloaded_opencl_sum": bytes_ocl,
        "bytes_offloaded_set_tensor": bytes_set,
        "k_layer_frac": k_of(drop, bytes_layer),
        "k_opencl_sum": k_of(drop, bytes_ocl),
        "k_set_tensor": k_of(drop, bytes_set),
        "cmd": read_text(pt / "cmd.txt").strip(),
    }


def walk_manifest(root: Path) -> list[dict]:
    rows = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        rows.append({"path": rel, "bytes": p.stat().st_size, "sha256": sha256_file(p)})
    return rows


def main() -> None:
    points = [analyze_point(n) for n in POINTS]
    ngl0 = next(p for p in points if p["ngl_requested"] == 0)
    baseline_ocl = ngl0["bytes_offloaded_opencl_sum"] or 0
    for p in points:
        extra = None
        if p["bytes_offloaded_opencl_sum"] is not None:
            extra = p["bytes_offloaded_opencl_sum"] - baseline_ocl
            if extra < 0:
                extra = 0
        p["bytes_offloaded_opencl_minus_ngl0"] = extra
        drop = p["MemAvailable_drop_kB"]
        if drop is not None and extra:
            p["k_opencl_minus_ngl0"] = (drop * 1024.0) / extra
        else:
            p["k_opencl_minus_ngl0"] = None

    # pooled k on GPU points using layer-frac bytes (prereg: linearity in BYTES)
    gpu = [p for p in points if (p["layers_offloaded"] or 0) > 0]
    pooled = []
    for p in gpu:
        if p["k_layer_frac"] is not None:
            pooled.append(
                {
                    "ngl": p["ngl_requested"],
                    "off": p["layers_offloaded"],
                    "drop_B": p["MemAvailable_drop_kB"] * 1024,
                    "bytes_layer": p["bytes_offloaded_layer_frac"],
                    "k": p["k_layer_frac"],
                }
            )

    analysis = {
        "N": N_LAYERS,
        "points_map": "0,7,13,19,99",
        "model_bytes_ls": MODEL_BYTES,
        "model_size_jsonl": GGUF_WEIGHT_BYTES,
        "binary": {
            "path": "/data/local/tmp/s3oracle/llama-bench",
            "stub": "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c",
            "impl": "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807",
            "opencl": "f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d",
            "model": "b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4",
            "threads": 4,
        },
        "pins_file": read_text(DEV / "PINS.txt"),
        "n_map": read_text(DEV / "N_MAP.txt"),
        "progress": read_text(DEV / "progress.txt"),
        "status": read_text(DEV / "STATUS").strip(),
        "offload_line_raw": read_text(DEV / "offload_line_raw.txt").strip(),
        "nproc_shell": read_text(DEV / "nproc.txt").strip(),
        "points": points,
        "pooled_k_layer_frac": pooled,
        "kgsl_note": "kgsl per-pid node not present at capture (see kgsl_proc_ls.txt)",
    }
    OUT_JSON.write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    print("wrote", OUT_JSON)

    # MANIFEST of pulled device tree
    rows = walk_manifest(DEV)
    man = MANIFEST_DIR / "MANIFEST.md"
    lines = [
        "# q44 ngl sweep S23 — MANIFEST",
        "",
        "Pulled from `/data/local/tmp/kalsa_q44/`. SHA256 via Python hashlib (PC-side).",
        "On-device binary/model pins also in `device/kalsa_q44/binary_sha.txt` (`sha256sum`).",
        "",
        "## Pins",
        "",
        "| artifact | path / value | sha256 |",
        "|---|---|---|",
        "| llama-bench stub | `/data/local/tmp/s3oracle/llama-bench` | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |",
        "| libllama-bench-impl.so | `/data/local/tmp/s3oracle/` | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` |",
        "| libggml-opencl.so | `/data/local/tmp/s3oracle/` | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` |",
        "| LFM2.5-8B-A1B-KEXP.gguf | `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |",
        "| threads | `-t 4` (n5 #18 pin, verified) | |",
        "| flags ngl0 | `-nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl` | |",
        "| flags ngl>0 | same + `-v` + `GGML_OPENCL_LOG_ALLOC=1` | |",
        "| N | 25 (`load_tensors: offloaded 1/25 layers to GPU`) | |",
        "| points | 0, 7, 13, 19, 99 | |",
        "",
        "## Pulled files (`results/ngl_sweep_s23/device/kalsa_q44/`)",
        "",
        "| path | bytes | sha256 |",
        "|---|---:|---|",
    ]
    for r in rows:
        lines.append(f"| `{r['path']}` | {r['bytes']} | `{r['sha256']}` |")
    lines.append("")
    man.write_text("\n".join(lines), encoding="utf-8")
    print("wrote", man, "files", len(rows))

    # compact table to stdout
    print(
        f"{'ngl':>5} {'off':>6} {'pp512':>10} {'tg128':>10} {'MApre':>10} {'MAmin':>10} {'MApost':>10} "
        f"{'dropMB':>8} {'RssA':>8} {'RssF':>8} {'VmSw':>8} {'k_layer':>8} {'rc':>4}"
    )
    for p in points:
        def f(x, nd=2):
            return "NA" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))

        drop_mb = p["MemAvailable_drop_kB"] / 1024.0 if p["MemAvailable_drop_kB"] is not None else None
        print(
            f"{p['ngl_requested']:5d} {f(p['layers_offloaded']):>6} {f(p['pp512_ts_exploratory']):>10} "
            f"{f(p['tg128_ts_exploratory']):>10} {f(p['MemAvailable_pre_kB'],0):>10} "
            f"{f(p['MemAvailable_min_during_kB'],0):>10} {f(p['MemAvailable_post_kB'],0):>10} "
            f"{f(drop_mb):>8} {f(p['peak_RssAnon_kB'],0):>8} {f(p['peak_RssFile_kB'],0):>8} "
            f"{f(p['peak_VmSwap_kB'],0):>8} {f(p['k_layer_frac']):>8} {p['rc']:>4}"
        )


if __name__ == "__main__":
    main()
