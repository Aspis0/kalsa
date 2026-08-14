#!/usr/bin/env python3
"""M3 arithmetic: projected prefill speedup for dense-GPU and CalaQwen hybrid.

Inputs (all optional, missing pieces stay None and the report says so):
  results/kernel_kg/m0/split_512.json
  results/kernel_kg/m0/wall_14h.out
  results/kernel_kg/m1/*.txt
  results/kernel_kg/m2/bench_*.json

Does not invent numbers. Writes m3/projection.json and prints a verdict line.
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
N_LAYER_CALA = 40
N_TOK_UBATCH = 512
N_EMBD = 2048


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""


def parse_result_line(text: str, tag: str):
    for ln in text.splitlines():
        if ln.startswith("RESULT ") and f" {tag} " in f" {ln} " or (
            ln.startswith("RESULT ") and ln.split()[1] == tag
        ):
            kv = {}
            for tok in ln.split()[1:]:
                if "=" in tok:
                    k, v = tok.split("=", 1)
                    try:
                        kv[k] = float(v) if "." in v else int(v)
                    except ValueError:
                        kv[k] = v
            return kv
    return None


def parse_llama_bench_json(path: Path):
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8", errors="replace")
    # llama-bench -o json prints a JSON array; stderr noise may precede it.
    start = raw.find("[")
    if start < 0:
        start = raw.find("{")
    if start < 0:
        return {"error": "no json", "raw_head": raw[:400]}
    try:
        data = json.loads(raw[start:])
    except json.JSONDecodeError as e:
        return {"error": str(e), "raw_head": raw[start : start + 400]}
    rows = data if isinstance(data, list) else [data]
    out = {"pp": None, "tg": None, "rows": []}
    for r in rows:
        n_p = r.get("n_prompt") or r.get("pp") or 0
        n_g = r.get("n_gen") or r.get("tg") or 0
        avg = r.get("avg_ts") or r.get("avg_ns")
        # llama-bench json: avg_ts is tok/s
        rec = {
            "n_prompt": n_p,
            "n_gen": n_g,
            "avg_ts": r.get("avg_ts"),
            "stdev_ts": r.get("stdev_ts"),
            "backend": r.get("backend") or r.get("n_gpu_layers"),
            "n_gpu_layers": r.get("n_gpu_layers"),
        }
        out["rows"].append(rec)
        if n_p and (not n_g or n_g == 0 or (n_p >= 64 and (out["pp"] is None or n_p >= 512))):
            if r.get("avg_ts") and n_p >= 64:
                out["pp"] = r.get("avg_ts")
        if n_g and n_g >= 8 and r.get("avg_ts"):
            out["tg"] = r.get("avg_ts")
    # Prefer the test whose n_prompt matches 512 and n_gen is 0-ish (pp test)
    for r in rows:
        if int(r.get("n_prompt") or 0) >= 256 and int(r.get("n_gen") or 0) == 0 and r.get("avg_ts"):
            out["pp"] = r["avg_ts"]
    if out["pp"] is None:
        for r in rows:
            if int(r.get("n_prompt") or 0) >= 256 and r.get("avg_ts"):
                out["pp"] = r["avg_ts"]
                break
    return out


def parse_bmoe_prefill(text: str):
    # prefill: 1441 tokens, 165.253 s (8.7 tok/s) | model load 12.3 s | TTFT ...
    m = re.search(
        r"prefill:\s+(\d+)\s+tokens,\s+([0-9.]+)\s+s\s+\(([0-9.]+)\s+tok/s\)",
        text,
    )
    if not m:
        return None
    return {
        "n_prompt": int(m.group(1)),
        "prefill_s": float(m.group(2)),
        "prefill_tps": float(m.group(3)),
    }


def main():
    m1 = read_text(ROOT / "m1" / "m1_512x2048.txt") or read_text(ROOT / "m1" / "m1_512x2048.preview.txt")
    write = parse_result_line(m1, "write_f32_512x2048") or {}
    read = parse_result_line(m1, "read_f32_512x2048") or {}
    pair = parse_result_line(m1, "handoff_pair_f32_512x2048") or {}
    fence = parse_result_line(m1, "empty_kernel_host_512x2048") or {}
    layout = parse_result_line(m1, "layout_copy_dev_512x2048") or {}
    finish = parse_result_line(m1, "clFinish_idle") or {}

    split_path = ROOT / "m0" / "split_512.json"
    split = json.loads(split_path.read_text()) if split_path.exists() else None
    wall = parse_bmoe_prefill(read_text(ROOT / "m0" / "wall_14h.out"))

    b2c = parse_llama_bench_json(ROOT / "m2" / "bench_2b_cpu.json")
    b2g = parse_llama_bench_json(ROOT / "m2" / "bench_2b_gpu.json")
    b4c = parse_llama_bench_json(ROOT / "m2" / "bench_4b_cpu.json")
    b4g = parse_llama_bench_json(ROOT / "m2" / "bench_4b_gpu.json")

    write_us = write.get("median_us")
    read_us = read.get("median_us")
    pair_us = pair.get("median_us")
    fence_us = fence.get("median_us")
    layout_us = layout.get("median_us")  # device-only; F32 path does NOT run this

    # Per MoE layer: one GPU->CPU read + one CPU->GPU write of the hidden.
    # F32 set/get_tensor is a blocking copy, no convert kernel.
    per_layer_us = None
    if pair_us is not None:
        per_layer_us = pair_us
    elif write_us is not None and read_us is not None:
        per_layer_us = write_us + read_us
    # 40 layers per 512-token ubatch
    bound_ubatch_ms = (per_layer_us * N_LAYER_CALA / 1000.0) if per_layer_us is not None else None
    bound_ms_per_tok = (bound_ubatch_ms / N_TOK_UBATCH) if bound_ubatch_ms is not None else None

    dense = {}
    for tag, cpu, gpu in (("2b", b2c, b2g), ("4b", b4c, b4g)):
        if cpu and gpu and cpu.get("pp") and gpu.get("pp"):
            dense[tag] = {
                "cpu_pp_tps": cpu["pp"],
                "gpu_pp_tps": gpu["pp"],
                "speedup": gpu["pp"] / cpu["pp"],
            }
        else:
            dense[tag] = {
                "cpu_pp_tps": (cpu or {}).get("pp"),
                "gpu_pp_tps": (gpu or {}).get("pp"),
                "speedup": None,
            }

    hybrid = {
        "approximation": (
            "t_hybrid = t_cpu * f_expert + t_cpu * (1-f_expert) / s_attn + t_bound. "
            "s_attn taken from 2B GPU/CPU pp512 (same GDN family, same n_embd=2048). "
            "2B FFN is dense 6144-wide; CalaQwen attn+shared is thinner — using the 2B "
            "ratio as s_attn is slightly optimistic if FFN drove the 2B win. "
            "Expert FFN stays on CPU (Q7-LANDMINE). Boundaries every MoE layer."
        )
    }
    f_ex = split["expert_ffn_frac"] if split else None
    t_cpu_s = wall["prefill_s"] if wall else None
    n_prompt = wall["n_prompt"] if wall else None
    s_attn = dense.get("2b", {}).get("speedup")
    t_bound_s = None
    if bound_ms_per_tok is not None and n_prompt:
        t_bound_s = bound_ms_per_tok / 1000.0 * n_prompt

    t_hyb = None
    speedup_hyb = None
    if t_cpu_s and f_ex is not None and s_attn:
        t_ex = t_cpu_s * f_ex
        t_rest = t_cpu_s * (1.0 - f_ex)
        t_rest_gpu = t_rest / s_attn
        t_hyb = t_ex + t_rest_gpu + (t_bound_s or 0.0)
        speedup_hyb = t_cpu_s / t_hyb if t_hyb else None
        hybrid.update(
            {
                "f_expert": f_ex,
                "t_cpu_s": t_cpu_s,
                "n_prompt": n_prompt,
                "s_attn_from_2b": s_attn,
                "t_expert_s": t_ex,
                "t_rest_cpu_s": t_rest,
                "t_rest_gpu_s": t_rest_gpu,
                "t_bound_s": t_bound_s,
                "t_hybrid_s": t_hyb,
                "speedup": speedup_hyb,
            }
        )

    # Verdict
    s2 = dense.get("2b", {}).get("speedup")
    s4 = dense.get("4b", {}).get("speedup")
    dense_ok = (s2 is not None and s2 >= 1.3) or (s4 is not None and s4 >= 1.3)
    hyb_ok = speedup_hyb is not None and speedup_hyb >= 1.3
    if dense_ok and hyb_ok:
        verdict = "KG_GO"
    elif dense_ok and not hyb_ok:
        verdict = "KG_PARTIAL"
    elif (s2 or 0) >= 1.15 or (speedup_hyb or 0) >= 1.15:
        verdict = "KG_PARTIAL"
    else:
        verdict = "KG_KILL"

    out = {
        "verdict": verdict,
        "m1": {
            "write_median_us": write_us,
            "write_p95_us": write.get("p95_us"),
            "read_median_us": read_us,
            "read_p95_us": read.get("p95_us"),
            "handoff_pair_median_us": pair_us,
            "handoff_pair_p95_us": pair.get("p95_us"),
            "empty_kernel_host_median_us": fence_us,
            "layout_copy_dev_median_us": layout_us,
            "clFinish_idle_median_us": finish.get("median_us"),
            "per_layer_handoff_us": per_layer_us,
            "bound_ms_per_512tok_ubatch": bound_ubatch_ms,
            "bound_ms_per_tok": bound_ms_per_tok,
            "note": "F32 activations: clEnqueueWrite/ReadBuffer CL_TRUE, no convert kernel",
        },
        "m0": {
            "split": split,
            "wall": wall,
        },
        "dense": dense,
        "hybrid": hybrid,
        "n_layer_cala": N_LAYER_CALA,
    }
    (ROOT / "m3").mkdir(exist_ok=True)
    (ROOT / "m3" / "projection.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    def fmt(x, nd=2):
        return "NA" if x is None else f"{x:.{nd}f}"

    print(
        f"{verdict}(dense-tier 2B {fmt(s2,2)}x, 4B {fmt(s4,2)}x, "
        f"hybrid {fmt(speedup_hyb,2)}x — M0 expert={fmt((f_ex or 0)*100,1)}% "
        f"M1 write/read {fmt(write_us,0)}/{fmt(read_us,0)} us)"
    )
    print(json.dumps({k: out[k] for k in ("verdict", "dense", "hybrid", "m1")}, indent=2))


if __name__ == "__main__":
    main()
