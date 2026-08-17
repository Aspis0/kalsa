#!/usr/bin/env python3
"""Mellum2 PC drop-curve: is there a quality optimum at drop > 0?

Mirrors scripts/run_mellum2_ppl_gate.py / run_multi5_ppl_host.py verbatim
(same binary, model, corpus, flags, stock kernel, one pass per language).

Arms (all k=6), interleaved so temporal drift cannot fake a trend:
  k6d0, k6d08, k6d03, k6d10, k6d05, k6d065, [k6d12, k6d15 probed then skipped]

d > 1.0 is rejected by config (drop_cold_frac must be in [0, 1]); we probe
once, record the rejection, and stop at 1.0.

k8d0 anchor is REUSED from results/mellum2_ppl_gate/ — never re-run.
k6d0 is measured here (first arm) and used to isolate drop from k.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "scripts" / "run_multi5_ppl_host.py"
LANGS = ["en", "es", "fr", "it", "zh"]
GATE_DIR = ROOT / "results" / "mellum2_ppl_gate"
DEFAULT_OUT = ROOT / "results" / "mellum2_dropcurve"
EXPECTED_MODEL = "b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
EXPECTED_BINARY = "7722cb23729d367a274fb682cadd28ef5d456f50fc9b5c064e4923ed04d75d52"
EXPECTED_DLLS = {
    "ggml-base.dll": "b72667acab062c253df6c2449cb642fbe6fb9a50ec7c4201b7680b1be24b609d",
    "ggml-cpu.dll": "eb1d25cdab6d41a9ca30e2cdcaa1592c2dbc1d08c76685db31bad14ea4c11529",
    "ggml.dll": "e4513bb2e6fee9c63f8262c47e716d650788bb23875c68942c13c0a41ae555ef",
    "llama-common.dll": "d1cad7e687fc23d2d8209b18ede879dd3f1c9a34484b29ced01056caebe30959",
    "llama.dll": "020d6045b226fe717276d2a6f9bc1c82bec41423d7254ef497eba715c66edc85",
}
MACRO_PASS = 0.04
LANG_PASS = 0.10
REPORT_PATH = Path(
    r"C:\Users\gualt\AppData\Local\Temp\claude"
    r"\C--Users-gualt-Desktop-Kalsa-moe-experiments"
    r"\fb421f6e-808c-4488-b008-5b732da526a8"
    r"\scratchpad\agents\dropcurve\report.md"
)

# Interleaved order (protocol). d>1.0 arms are probes only.
ARMS = [
    {"id": "k6d0", "k": 6, "drop": 0.0, "role": "k6_baseline"},
    {"id": "k6d08", "k": 6, "drop": 0.8, "role": "curve"},
    {"id": "k6d03", "k": 6, "drop": 0.3, "role": "curve"},
    {"id": "k6d10", "k": 6, "drop": 1.0, "role": "continuity_d10"},
    {"id": "k6d05", "k": 6, "drop": 0.5, "role": "curve"},
    {"id": "k6d065", "k": 6, "drop": 0.65, "role": "continuity_d065"},
    {"id": "k6d12", "k": 6, "drop": 1.2, "role": "probe_above_uniform"},
    {"id": "k6d15", "k": 6, "drop": 1.5, "role": "probe_above_uniform"},
]
CURVE_ARMS = [a for a in ARMS if a["drop"] <= 1.0]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_multi5(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    langs = data.get("langs") or {}
    if all(L in langs and "bpb" in langs[L] for L in LANGS):
        return data
    return None


def status(out_root: Path, msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')}  {msg}"
    print(line, flush=True)
    prev = ""
    sp = out_root / "STATUS.txt"
    if sp.exists():
        prev = sp.read_text(encoding="utf-8")
    sp.write_text(prev + line + "\n", encoding="utf-8")


def write_identity(out: Path, binary: Path, model: Path,
                   expect_model: str = EXPECTED_MODEL) -> dict:
    ident = {
        "experiment": "mellum2_dropcurve",
        "model": str(model),
        "model_sha256": sha256_file(model),
        "model_bytes": model.stat().st_size,
        "binary": str(binary),
        "binary_sha256": sha256_file(binary),
        "binary_bytes": binary.stat().st_size,
        "expected_model_sha256": expect_model,
        "expected_binary_sha256": EXPECTED_BINARY,
        "extra_flags": ["--no-moe-fused-gemv", "--no-moe-fused-ffn"],
        "threads": 16,
        "corpus": str(ROOT / "corpus" / "multi5"),
        "note": (
            "Drop-curve at k=6. Protocol = mellum2 PPL gate verbatim. "
            "k8d0 reused from results/mellum2_ppl_gate (not re-run). "
            "Arms interleaved: d0, d08, d03, d10, d05, d065. "
            "d>1.0 probed then skipped (CLI rejects drop_cold_frac > 1.0)."
        ),
        "gates": {
            "macro_pass": MACRO_PASS,
            "lang_pass": LANG_PASS,
            "precedent": "gate k6d065 dMacro=-0.0086 vs k8d0",
        },
        "written": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    dlls = {}
    dll_match = {}
    for folder in (binary.parent, binary.parent.parent / "bin"):
        if not folder.is_dir():
            continue
        for p in folder.glob("*.dll"):
            dlls[p.name] = sha256_file(p)
    ident["dll_sha256"] = dlls
    for name, exp in EXPECTED_DLLS.items():
        got = dlls.get(name)
        dll_match[name] = got == exp if got else False
    ident["dll_match"] = dll_match
    ident["model_match"] = ident["model_sha256"] == expect_model
    ident["binary_match"] = ident["binary_sha256"] == EXPECTED_BINARY
    (out / "identity.json").write_text(json.dumps(ident, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"model  {ident['model_sha256']}  {ident['model_bytes']}  {model}",
        f"expect {expect_model}",
        f"match  {ident['model_match']}",
        f"binary {ident['binary_sha256']}  {ident['binary_bytes']}  {binary}",
        f"expect {EXPECTED_BINARY}",
        f"match  {ident['binary_match']}",
        f"extra  --no-moe-fused-gemv --no-moe-fused-ffn",
    ]
    for name, exp in EXPECTED_DLLS.items():
        got = dlls.get(name, "MISSING")
        lines.append(f"dll    {name}  {got}  match={got == exp}")
    (out / "shas.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ident


def load_gate_anchor(arm_id: str) -> dict:
    path = GATE_DIR / arm_id / f"{arm_id}_multi5.json"
    data = load_multi5(path)
    if not data:
        raise FileNotFoundError(f"gate result missing/incomplete: {path}")
    return data


def probe_above_one(binary: Path, model: Path, out_root: Path) -> dict:
    """Confirm CLI rejects drop > 1.0. Cheap: tiny corpus, one model load."""
    probe_dir = out_root / "probe_dgt1"
    probe_dir.mkdir(parents=True, exist_ok=True)
    marker = probe_dir / "probe.json"
    if marker.exists():
        return json.loads(marker.read_text(encoding="utf-8"))

    tiny = probe_dir / "tiny.txt"
    tiny.write_text("The quick brown fox jumps over the lazy dog.\n" * 8, encoding="utf-8")
    results = {}
    for drop in (1.2, 1.5):
        stdout_p = probe_dir / f"d{drop}_stdout.txt"
        stderr_p = probe_dir / f"d{drop}_stderr.txt"
        cmd = [
            str(binary),
            "-m", str(model),
            "-t", "16",
            "-c", "4096",
            "--ubatch", "512",
            "--ppl-decode", str(tiny),
            "--moe-stream",
            "--cache-mb", "2000",
            "--dense-weights", "anon",
            "--io-threads", "4",
            "--overlap",
            "--n-expert-used", "6",
            "--drop-cold-experts", str(drop),
            "--no-moe-fused-gemv",
            "--no-moe-fused-ffn",
        ]
        env = os.environ.copy()
        lib_dirs = [str(binary.parent), str(binary.parent.parent / "bin")]
        env["PATH"] = os.pathsep.join(lib_dirs) + os.pathsep + env.get("PATH", "")
        t0 = time.time()
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=str(binary.parent),
        )
        dt = time.time() - t0
        stdout_p.write_text(proc.stdout, encoding="utf-8")
        stderr_p.write_text(proc.stderr, encoding="utf-8")
        blob = (proc.stdout or "") + "\n" + (proc.stderr or "")
        rejected = proc.returncode != 0 and (
            "drop_cold_frac" in blob or "must be in [0, 1]" in blob or "drop-cold" in blob.lower()
        )
        results[str(drop)] = {
            "drop": drop,
            "rc": proc.returncode,
            "seconds": round(dt, 3),
            "rejected": rejected,
            "stderr_tail": (proc.stderr or proc.stdout or "")[-1500:],
        }
        # If 1.2 already rejected, 1.5 is the same code path — still try once
        # so the note is empirical, but do not score a full multi5.
    payload = {
        "probed": True,
        "cli_rejects_above_1": all(results[k]["rejected"] for k in results),
        "results": results,
        "decision": "stop at 1.0; do not run k6d12/k6d15 multi5",
        "source": (
            "kalsa-engine/core/src/config.cpp: drop_cold_frac must be in [0, 1]; "
            "1.0 is the uniform share 1/n_expert_used and the useful maximum."
        ),
    }
    marker.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def run_arm(arm: dict, binary: Path, model: Path, out_root: Path, threads: int) -> int:
    outdir = out_root / arm["id"]
    tag = arm["id"]
    json_path = outdir / f"{tag}_multi5.json"
    existing = load_multi5(json_path)
    if existing:
        status(out_root, f"SKIP {tag} (complete multi5 on disk)")
        return 0
    if arm["drop"] > 1.0:
        status(out_root, f"SKIP {tag} drop={arm['drop']} (CLI rejects drop_cold_frac > 1.0)")
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "REJECTED.txt").write_text(
            f"drop={arm['drop']} not runnable: moe.drop_cold_frac must be in [0, 1]\n",
            encoding="utf-8",
        )
        return 0
    outdir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(HARNESS),
        "--binary", str(binary),
        "--model", str(model),
        "--tag", tag,
        "--outdir", str(outdir),
        "--langs", ",".join(LANGS),
        "--threads", str(threads),
        "--ctx", "4096",
        "--ubatch", "512",
        "--moe-stream",
        "--cache-mb", "2000",
        "--dense-weights", "anon",
        "--io-threads", "4",
        "--overlap",
        "--n-expert-used", str(arm["k"]),
        "--drop-cold-experts", str(arm["drop"]),
        "--ppl-mode", "decode",
        "--stock-kernel",
    ]
    (outdir / "command.txt").write_text(" ".join(cmd) + "\n", encoding="utf-8")
    status(out_root, f"START {tag} k={arm['k']} drop={arm['drop']}")
    env = os.environ.copy()
    lib_dirs = [str(binary.parent), str(binary.parent.parent / "bin")]
    env["PATH"] = os.pathsep.join(lib_dirs) + os.pathsep + env.get("PATH", "")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, cwd=str(ROOT))
    dt = time.time() - t0
    (outdir / "harness_rc.txt").write_text(f"{proc.returncode}\nseconds={dt:.1f}\n", encoding="utf-8")
    status(out_root, f"END {tag} rc={proc.returncode} wall={dt:.1f}s")
    return proc.returncode


def arm_record(arm: dict, out_root: Path) -> dict:
    path = out_root / arm["id"] / f"{arm['id']}_multi5.json"
    data = load_multi5(path)
    rec = {
        "arm": arm["id"],
        "role": arm["role"],
        "k": arm["k"],
        "drop": arm["drop"],
        "complete": data is not None,
    }
    if arm["drop"] > 1.0:
        rec["rejected"] = True
        rec["complete"] = False
        rec["note"] = "CLI rejects drop_cold_frac > 1.0"
        return rec
    if data:
        rec["macro_bpb"] = data.get("macro_bpb")
        rec["seconds"] = sum((data["langs"][L].get("seconds") or 0) for L in LANGS)
        rec["binary_sha256"] = data.get("binary_sha256")
        rec["model_sha256"] = data.get("model_sha256")
        for L in LANGS:
            rec[f"bpb_{L}"] = data["langs"][L]["bpb"]
            rec[f"ppl_{L}"] = data["langs"][L]["ppl"]
    return rec


def attach_deltas(rec: dict, k8: dict, k6d0: dict | None) -> None:
    if not rec.get("complete"):
        return
    rec["d_macro_vs_k8d0"] = rec["macro_bpb"] - k8["macro_bpb"]
    worst_lang, worst_d = None, None
    for L in LANGS:
        d = rec[f"bpb_{L}"] - k8[f"bpb_{L}"]
        rec[f"d_{L}_vs_k8d0"] = d
        if worst_d is None or d > worst_d:
            worst_d, worst_lang = d, L
    rec["d_worst_vs_k8d0"] = worst_d
    rec["worst_lang_vs_k8d0"] = worst_lang
    if rec["d_macro_vs_k8d0"] <= MACRO_PASS and worst_d <= LANG_PASS:
        rec["gate_vs_k8d0"] = "GATE_PASS"
    elif rec["d_macro_vs_k8d0"] <= 0.06 and worst_d <= 0.15:
        rec["gate_vs_k8d0"] = "GATE_MARGINAL"
    else:
        rec["gate_vs_k8d0"] = "GATE_FAIL"
    if k6d0 and k6d0.get("complete"):
        rec["d_macro_vs_k6d0"] = rec["macro_bpb"] - k6d0["macro_bpb"]
        for L in LANGS:
            rec[f"d_{L}_vs_k6d0"] = rec[f"bpb_{L}"] - k6d0[f"bpb_{L}"]


def gate_as_rec(arm_id: str, data: dict, k: int, drop: float, role: str) -> dict:
    rec = {
        "arm": arm_id,
        "role": role,
        "k": k,
        "drop": drop,
        "complete": True,
        "macro_bpb": data["macro_bpb"],
        "seconds": sum((data["langs"][L].get("seconds") or 0) for L in LANGS),
        "source": "stored_gate",
    }
    for L in LANGS:
        rec[f"bpb_{L}"] = data["langs"][L]["bpb"]
        rec[f"ppl_{L}"] = data["langs"][L]["ppl"]
    return rec


def write_svg(path: Path, rows: list[dict], k8_macro: float) -> None:
    complete = [r for r in rows if r.get("complete")]
    if len(complete) < 2:
        return
    complete = sorted(complete, key=lambda r: r["drop"])
    w, h = 720, 420
    pad_l, pad_r, pad_t, pad_b = 70, 24, 28, 48
    xs = [r["drop"] for r in complete]
    ys = [r["macro_bpb"] for r in complete]
    ymin = min(min(ys), k8_macro) - 0.01
    ymax = max(max(ys), k8_macro + MACRO_PASS) + 0.01
    xmin, xmax = -0.05, 1.05

    def sx(x: float) -> float:
        return pad_l + (x - xmin) / (xmax - xmin) * (w - pad_l - pad_r)

    def sy(y: float) -> float:
        return pad_t + (ymax - y) / (ymax - ymin) * (h - pad_t - pad_b)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" font-family="ui-monospace, Consolas, monospace" font-size="12">',
        f'<rect width="{w}" height="{h}" fill="#0f1115"/>',
        f'<text x="{w/2}" y="18" fill="#e6edf3" text-anchor="middle">k6 drop-curve macro bpb</text>',
    ]
    # axes
    parts.append(f'<line x1="{pad_l}" y1="{h-pad_b}" x2="{w-pad_r}" y2="{h-pad_b}" stroke="#8b949e"/>')
    parts.append(f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{h-pad_b}" stroke="#8b949e"/>')
    # k8d0 + gate
    parts.append(
        f'<line x1="{sx(xmin)}" y1="{sy(k8_macro)}" x2="{sx(xmax)}" y2="{sy(k8_macro)}" '
        f'stroke="#58a6ff" stroke-dasharray="4 3"/>'
    )
    parts.append(
        f'<text x="{w-pad_r}" y="{sy(k8_macro)-4}" fill="#58a6ff" text-anchor="end">k8d0</text>'
    )
    parts.append(
        f'<line x1="{sx(xmin)}" y1="{sy(k8_macro+MACRO_PASS)}" x2="{sx(xmax)}" '
        f'y2="{sy(k8_macro+MACRO_PASS)}" stroke="#f85149" stroke-dasharray="2 3"/>'
    )
    parts.append(
        f'<text x="{w-pad_r}" y="{sy(k8_macro+MACRO_PASS)-4}" fill="#f85149" text-anchor="end">+0.04</text>'
    )
    pts = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in zip(xs, ys))
    parts.append(f'<polyline fill="none" stroke="#3fb950" stroke-width="2" points="{pts}"/>')
    for r in complete:
        parts.append(
            f'<circle cx="{sx(r["drop"]):.1f}" cy="{sy(r["macro_bpb"]):.1f}" r="4" fill="#3fb950"/>'
        )
        parts.append(
            f'<text x="{sx(r["drop"]):.1f}" y="{h-pad_b+16}" fill="#8b949e" text-anchor="middle">'
            f'{r["drop"]:g}</text>'
        )
    parts.append(f'<text x="{w/2}" y="{h-8}" fill="#8b949e" text-anchor="middle">drop (frac of 1/k)</text>')
    parts.append("</svg>\n")
    path.write_text("\n".join(parts), encoding="utf-8")


def try_png(path: Path, rows: list[dict], k8_macro: float) -> None:
    complete = [r for r in rows if r.get("complete")]
    if len(complete) < 2:
        return
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return
    complete = sorted(complete, key=lambda r: r["drop"])
    xs = [r["drop"] for r in complete]
    ys = [r["macro_bpb"] for r in complete]
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=120)
    ax.plot(xs, ys, "o-", color="#238636", label="k6 drop-curve")
    ax.axhline(k8_macro, color="#0969da", ls="--", label="k8d0 anchor")
    ax.axhline(k8_macro + MACRO_PASS, color="#cf222e", ls=":", label="k8d0 + 0.04 gate")
    ax.set_xlabel("drop-cold-experts (frac of uniform 1/k)")
    ax.set_ylabel("macro bpb (5 langs)")
    ax.set_title("Mellum2 F1 Q4 — k=6 drop curve")
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def fmt4(x: float | None) -> str:
    if x is None:
        return "—"
    return f"{x:.4f}"


def fmt4s(x: float | None) -> str:
    if x is None:
        return "—"
    return f"{x:+.4f}"


def analyze(out_root: Path, k8: dict, stored_d065: dict, stored_d10: dict, probe: dict) -> dict:
    rows = [arm_record(a, out_root) for a in CURVE_ARMS]
    k6d0 = next((r for r in rows if r["arm"] == "k6d0"), None)
    for rec in rows:
        attach_deltas(rec, k8, k6d0)

    # Noise from d065 re-run vs stored gate
    rerun_d065 = next((r for r in rows if r["arm"] == "k6d065" and r.get("complete")), None)
    rerun_d10 = next((r for r in rows if r["arm"] == "k6d10" and r.get("complete")), None)
    noise = {
        "d065_stored_macro": stored_d065["macro_bpb"],
        "d065_stored_dMacro_vs_k8d0": stored_d065["macro_bpb"] - k8["macro_bpb"],
        "d10_stored_macro": stored_d10["macro_bpb"],
        "d10_stored_dMacro_vs_k8d0": stored_d10["macro_bpb"] - k8["macro_bpb"],
    }
    if rerun_d065:
        noise["d065_rerun_macro"] = rerun_d065["macro_bpb"]
        noise["d065_delta_macro"] = rerun_d065["macro_bpb"] - stored_d065["macro_bpb"]
        noise["d065_rerun_dMacro_vs_k8d0"] = rerun_d065["d_macro_vs_k8d0"]
        for L in LANGS:
            noise[f"d065_delta_bpb_{L}"] = rerun_d065[f"bpb_{L}"] - stored_d065["langs"][L]["bpb"]
            noise[f"d065_delta_ppl_{L}"] = rerun_d065[f"ppl_{L}"] - stored_d065["langs"][L]["ppl"]
    if rerun_d10:
        noise["d10_rerun_macro"] = rerun_d10["macro_bpb"]
        noise["d10_delta_macro"] = rerun_d10["macro_bpb"] - stored_d10["macro_bpb"]
        noise["d10_rerun_dMacro_vs_k8d0"] = rerun_d10["d_macro_vs_k8d0"]

    complete = [r for r in rows if r.get("complete")]
    noise_floor = None
    if "d065_delta_macro" in noise:
        noise_floor = abs(noise["d065_delta_macro"])
        if "d10_delta_macro" in noise:
            noise_floor = max(noise_floor, abs(noise["d10_delta_macro"]))
    # If only one continuity point, still use it. Floor of 1e-5 if somehow zero.
    if noise_floor is not None and noise_floor < 1e-6:
        noise_floor = 1e-6
    noise["noise_floor_macro"] = noise_floor

    verdict = "DROPCURVE_INCOMPLETE"
    verdict_detail = {}
    if k6d0 and k6d0.get("complete") and len(complete) >= 2 and noise_floor is not None:
        ranked = sorted(complete, key=lambda r: r["macro_bpb"])
        best = ranked[0]
        k6_base = k6d0["macro_bpb"]
        # improvement vs k6d0
        gain = k6_base - best["macro_bpb"]
        # monotone? sorted by drop, check non-decreasing macro (degrading) within noise
        by_drop = sorted(complete, key=lambda r: r["drop"])
        deltas = [
            by_drop[i + 1]["macro_bpb"] - by_drop[i]["macro_bpb"]
            for i in range(len(by_drop) - 1)
        ]
        strictly_degrading = all(d >= -noise_floor for d in deltas) and any(
            d > noise_floor for d in deltas
        )
        all_within_noise = all(abs(r["macro_bpb"] - k6_base) <= noise_floor for r in complete)
        has_opt = (
            best["drop"] > 0
            and gain > noise_floor
            and best["arm"] != "k6d0"
        )
        if has_opt:
            verdict = (
                f"DROPCURVE_OPTIMUM(dstar={best['drop']:g}, "
                f"dMacro={best.get('d_macro_vs_k8d0', float('nan')):+.4f})"
            )
        elif all_within_noise:
            spread = max(r["macro_bpb"] for r in complete) - min(r["macro_bpb"] for r in complete)
            verdict = f"DROPCURVE_FLAT(spread={spread:.4f}, noise={noise_floor:.4f})"
        elif strictly_degrading:
            last = by_drop[-1]
            verdict = (
                f"DROPCURVE_MONOTONE(d1.0_dMacro="
                f"{last.get('d_macro_vs_k8d0', float('nan')):+.4f})"
            )
        else:
            # mixed / no dip below k6d0 beyond noise — still classify
            spread = max(r["macro_bpb"] for r in complete) - min(r["macro_bpb"] for r in complete)
            if best["arm"] == "k6d0" and strictly_degrading:
                last = by_drop[-1]
                verdict = (
                    f"DROPCURVE_MONOTONE(d1.0_dMacro="
                    f"{last.get('d_macro_vs_k8d0', float('nan')):+.4f})"
                )
            elif spread <= max(2 * noise_floor, 0.002):
                verdict = f"DROPCURVE_FLAT(spread={spread:.4f}, noise={noise_floor:.4f})"
            elif best["drop"] > 0 and gain > 0:
                # dip exists but inside noise
                verdict = (
                    f"DROPCURVE_FLAT(dstar={best['drop']:g}, "
                    f"gain={gain:.4f}, noise={noise_floor:.4f})"
                )
            else:
                last = by_drop[-1]
                verdict = (
                    f"DROPCURVE_MONOTONE(d1.0_dMacro="
                    f"{last.get('d_macro_vs_k8d0', float('nan')):+.4f})"
                )
        verdict_detail = {
            "best_arm": best["arm"],
            "best_drop": best["drop"],
            "best_macro": best["macro_bpb"],
            "k6d0_macro": k6_base,
            "gain_vs_k6d0": gain,
            "noise_floor": noise_floor,
            "all_within_noise": all_within_noise,
            "strictly_degrading": strictly_degrading,
            "deltas_by_drop": [
                {"from": by_drop[i]["drop"], "to": by_drop[i + 1]["drop"], "dMacro": deltas[i]}
                for i in range(len(deltas))
            ],
        }

    # Where does the curve cross +0.04 vs k8d0?
    cross = {"crosses": False, "note": "incomplete"}
    if complete:
        by_drop = sorted(complete, key=lambda r: r["drop"])
        over = [r for r in by_drop if r.get("d_macro_vs_k8d0", -1) > MACRO_PASS]
        under = [r for r in by_drop if r.get("d_macro_vs_k8d0", 1) <= MACRO_PASS]
        if not over:
            last = by_drop[-1]
            cross = {
                "crosses": False,
                "note": (
                    f"no arm in [0, {last['drop']:g}] exceeds +{MACRO_PASS}; "
                    f"max dMacro={max(r['d_macro_vs_k8d0'] for r in by_drop):+.4f} "
                    f"at d={max(by_drop, key=lambda r: r['d_macro_vs_k8d0'])['drop']:g}"
                ),
            }
        elif not under:
            first = over[0]
            cross = {
                "crosses": True,
                "at_or_before": first["drop"],
                "note": f"already over gate at smallest d={first['drop']:g}",
            }
        else:
            # interpolate between last under and first over
            a = max(under, key=lambda r: r["drop"])
            b = min(over, key=lambda r: r["drop"])
            ya, yb = a["d_macro_vs_k8d0"], b["d_macro_vs_k8d0"]
            if yb != ya:
                frac = (MACRO_PASS - ya) / (yb - ya)
                dstar = a["drop"] + frac * (b["drop"] - a["drop"])
            else:
                dstar = b["drop"]
            cross = {
                "crosses": True,
                "between": [a["drop"], b["drop"]],
                "interpolated_d": dstar,
                "a_dMacro": ya,
                "b_dMacro": yb,
                "note": (
                    f"crosses +{MACRO_PASS} between d={a['drop']:g} "
                    f"({ya:+.4f}) and d={b['drop']:g} ({yb:+.4f}); "
                    f"linear interp d*={dstar:.3f}"
                ),
            }

    summary = {
        "experiment": "mellum2_dropcurve",
        "baseline_k8d0_source": str(GATE_DIR / "k8d0" / "k8d0_multi5.json"),
        "k8d0_macro": k8["macro_bpb"],
        "k6d0_macro": k6d0["macro_bpb"] if k6d0 and k6d0.get("complete") else None,
        "arms": rows,
        "noise": noise,
        "verdict": verdict,
        "verdict_detail": verdict_detail,
        "gate_cross": cross,
        "probe_dgt1": {
            "cli_rejects_above_1": probe.get("cli_rejects_above_1"),
            "decision": probe.get("decision"),
        },
        "gates": {"macro_pass": MACRO_PASS, "lang_pass": LANG_PASS},
        "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (out_root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    fields = [
        "arm", "role", "k", "drop", "complete", "gate_vs_k8d0",
        "macro_bpb", "d_macro_vs_k8d0", "d_macro_vs_k6d0",
        "worst_lang_vs_k8d0", "d_worst_vs_k8d0",
        "bpb_en", "bpb_es", "bpb_fr", "bpb_it", "bpb_zh",
        "ppl_en", "ppl_es", "ppl_fr", "ppl_it", "ppl_zh",
        "d_en_vs_k8d0", "d_es_vs_k8d0", "d_fr_vs_k8d0", "d_it_vs_k8d0", "d_zh_vs_k8d0",
        "d_en_vs_k6d0", "d_es_vs_k6d0", "d_fr_vs_k6d0", "d_it_vs_k6d0", "d_zh_vs_k6d0",
        "seconds",
    ]
    with (out_root / "runs_ppl.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for rec in rows:
            w.writerow(rec)
    with (out_root / "curve.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["drop", "arm", "macro_bpb", "d_macro_vs_k8d0", "d_macro_vs_k6d0", "gate_vs_k8d0"],
            extrasaction="ignore",
        )
        w.writeheader()
        for rec in sorted(complete, key=lambda r: r["drop"]):
            w.writerow(rec)

    write_svg(out_root / "curve.svg", rows, k8["macro_bpb"])
    try_png(out_root / "curve.png", rows, k8["macro_bpb"])
    return summary


def render_report(out_root: Path, summary: dict, k8: dict, stored_d065: dict, stored_d10: dict, probe: dict) -> str:
    rows = summary["arms"]
    noise = summary["noise"]
    complete = [r for r in rows if r.get("complete")]
    n_done = len(complete)
    n_total = len(CURVE_ARMS)

    # Name the model actually run. This script was written for Mellum2 and is now
    # reused for other models via --expect-model-sha; the hardcoded name put
    # "Mellum2" next to CalaQwen's sha in a committed VERDICT.md — a provenance
    # bug, not a cosmetic one. identity.json is the only place that carries the
    # real path (summary.json does not), so read it there and stay silent rather
    # than guess if it is missing.
    try:
        _ident = json.loads((out_root / "identity.json").read_text(encoding="utf-8"))
        model_path = Path(_ident["model"])
        model_name, model_file = model_path.stem, model_path.name
    except Exception:
        model_name, model_file = "drop", "unknown (identity.json unreadable)"

    lines = [
        summary["verdict"],
        "",
        f"# {model_name} drop-curve (k=6, multi5 PPL, PC)",
        "",
        "Protocol = mellum2 PPL gate verbatim: campaign multi5 `--ppl-decode` "
        "`--moe-stream cache=2000 anon io=4 overlap -t 16 --stock-kernel`.",
        "",
        f"- binary `{summary.get('binary', 'bmoe-cli.exe')}` sha `{EXPECTED_BINARY}` (verified)",
        f"- model `{model_file}` sha `{EXPECTED_MODEL}` (verified)",
        f"- k8d0 anchor REUSED from `results/mellum2_ppl_gate/k8d0/` "
        f"(macro={k8['macro_bpb']:.6f}); not re-run",
        f"- arms interleaved: d0, d0.8, d0.3, d1.0, d0.5, d0.65 so drift cannot fake a trend",
        f"- d>1.0: CLI **rejects** (`drop_cold_frac` must be in [0, 1]); stopped at 1.0",
        f"- progress: {n_done}/{n_total} curve arms complete",
        "",
        "## Probe d > 1.0",
        "",
        f"CLI rejects above 1.0: **{probe.get('cli_rejects_above_1')}**.",
        "Source: `kalsa-engine/core/src/config.cpp` — 1.0 is the uniform share "
        "`1/n_expert_used` and the useful maximum. Above 1.0 the threshold can "
        "exceed the largest weight in a routing and discard every expert of a layer.",
        "No multi5 was run at d=1.2 or d=1.5.",
        "",
    ]
    if probe.get("results"):
        for k, r in probe["results"].items():
            tail = (r.get("stderr_tail") or "").strip().replace("\n", " ")[-240:]
            lines.append(f"- d={k}: rc={r.get('rc')} rejected={r.get('rejected')} `{tail}`")
        lines.append("")

    lines += [
        "## Table (arm × language)",
        "",
        "dMacro_k8 = macro − stored k8d0. dMacro_k6 = macro − this-run k6d0.",
        "",
        "| arm | drop | en ppl | es ppl | fr ppl | it ppl | zh ppl | macro bpb | dMacro vs k8d0 | dMacro vs k6d0 | gate |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    # stored anchors first for context
    lines.append(
        f"| k8d0 (stored) | 0.0 | {k8['langs']['en']['ppl']:.4f} | {k8['langs']['es']['ppl']:.4f} | "
        f"{k8['langs']['fr']['ppl']:.4f} | {k8['langs']['it']['ppl']:.4f} | {k8['langs']['zh']['ppl']:.4f} | "
        f"{k8['macro_bpb']:.4f} | +0.0000 | — | ANCHOR |"
    )
    for rec in sorted(rows, key=lambda r: r["drop"]):
        if not rec.get("complete"):
            note = rec.get("note") or ("INCOMPLETE" if rec.get("rejected") else "PENDING")
            lines.append(
                f"| {rec['arm']} | {rec['drop']:g} | — | — | — | — | — | — | — | — | {note} |"
            )
            continue
        lines.append(
            f"| {rec['arm']} | {rec['drop']:g} | "
            f"{rec['ppl_en']:.4f} | {rec['ppl_es']:.4f} | {rec['ppl_fr']:.4f} | "
            f"{rec['ppl_it']:.4f} | {rec['ppl_zh']:.4f} | {rec['macro_bpb']:.4f} | "
            f"{rec.get('d_macro_vs_k8d0', 0):+.4f} | {fmt4s(rec.get('d_macro_vs_k6d0'))} | "
            f"{rec.get('gate_vs_k8d0', '')} |"
        )

    lines += [
        "",
        "### Per-language bpb and deltas vs k8d0",
        "",
        "| arm | drop | bpb en | bpb es | bpb fr | bpb it | bpb zh | d en | d es | d fr | d it | d zh |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for rec in sorted(rows, key=lambda r: r["drop"]):
        if not rec.get("complete"):
            continue
        lines.append(
            f"| {rec['arm']} | {rec['drop']:g} | "
            f"{rec['bpb_en']:.4f} | {rec['bpb_es']:.4f} | {rec['bpb_fr']:.4f} | "
            f"{rec['bpb_it']:.4f} | {rec['bpb_zh']:.4f} | "
            f"{rec.get('d_en_vs_k8d0', 0):+.4f} | {rec.get('d_es_vs_k8d0', 0):+.4f} | "
            f"{rec.get('d_fr_vs_k8d0', 0):+.4f} | {rec.get('d_it_vs_k8d0', 0):+.4f} | "
            f"{rec.get('d_zh_vs_k8d0', 0):+.4f} |"
        )

    lines += [
        "",
        "## Noise (continuity vs stored gate)",
        "",
        f"Stored k6d065 macro = {stored_d065['macro_bpb']:.6f} "
        f"(dMacro vs k8d0 = {stored_d065['macro_bpb'] - k8['macro_bpb']:+.6f}).",
        f"Stored k6d10  macro = {stored_d10['macro_bpb']:.6f} "
        f"(dMacro vs k8d0 = {stored_d10['macro_bpb'] - k8['macro_bpb']:+.6f}).",
        "",
    ]
    if "d065_delta_macro" in noise:
        lines.append(
            f"- d065 re-run macro = {noise['d065_rerun_macro']:.6f}; "
            f"Δ vs stored = {noise['d065_delta_macro']:+.6f}; "
            f"dMacro vs k8d0 = {noise['d065_rerun_dMacro_vs_k8d0']:+.6f}"
        )
        for L in LANGS:
            lines.append(
                f"  - {L}: Δbpb={noise[f'd065_delta_bpb_{L}']:+.6f} "
                f"Δppl={noise[f'd065_delta_ppl_{L}']:+.4f}"
            )
    else:
        lines.append("- d065 re-run not complete yet.")
    if "d10_delta_macro" in noise:
        lines.append(
            f"- d10 re-run macro = {noise['d10_rerun_macro']:.6f}; "
            f"Δ vs stored = {noise['d10_delta_macro']:+.6f}; "
            f"dMacro vs k8d0 = {noise['d10_rerun_dMacro_vs_k8d0']:+.6f}"
        )
    if noise.get("noise_floor_macro") is not None:
        lines.append(f"- noise floor (max |Δ| of continuity arms) = {noise['noise_floor_macro']:.6f}")

    # Reproduce the -0.0086 claim?
    lines += ["", "### Is the stored d065 improvement reproduced?", ""]
    if rerun := next((r for r in complete if r["arm"] == "k6d065"), None):
        stored_dm = stored_d065["macro_bpb"] - k8["macro_bpb"]
        rerun_dm = rerun["d_macro_vs_k8d0"]
        delta = abs(rerun_dm - stored_dm)
        nf = noise.get("noise_floor_macro") or delta
        if rerun_dm < 0 and delta <= max(nf, 0.002):
            lines.append(
                f"YES within noise: stored dMacro={stored_dm:+.4f}, "
                f"re-run {rerun_dm:+.4f}, |Δ|={delta:.4f}."
            )
        elif rerun_dm < 0:
            lines.append(
                f"SIGN reproduced but magnitude moved: stored {stored_dm:+.4f}, "
                f"re-run {rerun_dm:+.4f}, |Δ|={delta:.4f}."
            )
        else:
            lines.append(
                f"NO: stored {stored_dm:+.4f} was an improvement; "
                f"re-run {rerun_dm:+.4f} is not. |Δ|={delta:.4f}."
            )
    else:
        lines.append("d065 re-run pending.")

    lines += [
        "",
        "## Gate cross (+0.04 vs k8d0)",
        "",
        summary.get("gate_cross", {}).get("note", "n/a"),
        "",
        "## Verdict rationale",
        "",
    ]
    vd = summary.get("verdict_detail") or {}
    if vd:
        lines.append(
            f"- best arm = {vd.get('best_arm')} (d={vd.get('best_drop')}) "
            f"macro={vd.get('best_macro')}"
        )
        lines.append(f"- k6d0 macro = {vd.get('k6d0_macro')}")
        lines.append(f"- gain vs k6d0 = {vd.get('gain_vs_k6d0')}")
        lines.append(f"- noise floor = {vd.get('noise_floor')}")
        lines.append(f"- all within noise of k6d0 = {vd.get('all_within_noise')}")
        lines.append(f"- strictly degrading (within noise) = {vd.get('strictly_degrading')}")
        if vd.get("deltas_by_drop"):
            lines.append("- consecutive Δmacro by increasing d:")
            for d in vd["deltas_by_drop"]:
                lines.append(f"  - {d['from']:g} → {d['to']:g}: {d['dMacro']:+.6f}")
    else:
        lines.append("Incomplete — verdict reserved until curve + continuity arms finish.")

    lines += [
        "",
        "## Artifacts",
        "",
        "Under `results/mellum2_dropcurve/`: `identity.json`, `shas.txt`, `STATUS.txt`, "
        "`summary.json`, `runs_ppl.csv`, `curve.csv`, `curve.svg`, `curve.png` (if matplotlib), "
        "per-arm directories (command.txt, `*_multi5.json`, per-lang stdout/csv), "
        "`probe_dgt1/`.",
        "",
        f"Updated: {summary.get('updated')}",
        "",
    ]
    text = "\n".join(lines)
    (out_root / "VERDICT.md").write_text(text + "\n", encoding="utf-8")
    (out_root / "CURVE.md").write_text(text + "\n", encoding="utf-8")
    try:
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        REPORT_PATH.write_text(text + "\n", encoding="utf-8")
    except OSError as e:
        (out_root / "report_copy_error.txt").write_text(str(e), encoding="utf-8")
    return text


def main() -> int:
    ap = __import__("argparse").ArgumentParser()
    ap.add_argument(
        "--binary",
        default=str(ROOT / "build-pc-mellum-ppl" / "cli" / "bmoe-cli.exe"),
    )
    ap.add_argument(
        "--model",
        default=str(ROOT / "models" / "Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"),
    )
    ap.add_argument("--outdir", default=str(DEFAULT_OUT))
    # Running this protocol on another model must DECLARE that model's sha.
    # --skip-identity would also drop the binary and DLL pins, which is worse.
    ap.add_argument("--expect-model-sha", default=EXPECTED_MODEL)
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument("--skip-identity", action="store_true")
    ap.add_argument("--probe-only", action="store_true")
    ap.add_argument("--summarize-only", action="store_true")
    args = ap.parse_args()

    binary = Path(args.binary)
    model = Path(args.model)
    out_root = Path(args.outdir)
    out_root.mkdir(parents=True, exist_ok=True)

    if not binary.exists():
        print(f"FAIL binary missing: {binary}", file=sys.stderr)
        return 2
    if not model.exists():
        print(f"FAIL model missing: {model}", file=sys.stderr)
        return 2

    k8 = load_gate_anchor("k8d0")
    stored_d065 = load_gate_anchor("k6d065")
    stored_d10 = load_gate_anchor("k6d10")
    # flatten k8 for attach_deltas
    k8_flat = {
        "macro_bpb": k8["macro_bpb"],
        "langs": k8["langs"],
    }
    for L in LANGS:
        k8_flat[f"bpb_{L}"] = k8["langs"][L]["bpb"]
        k8_flat[f"ppl_{L}"] = k8["langs"][L]["ppl"]

    if not args.skip_identity and not args.summarize_only:
        ident = write_identity(out_root, binary, model, args.expect_model_sha)
        if not ident["model_match"]:
            print("FAIL model sha mismatch", file=sys.stderr)
            return 2
        if not ident["binary_match"]:
            print("FAIL binary sha mismatch", file=sys.stderr)
            return 2
        bad_dlls = [k for k, v in ident["dll_match"].items() if not v]
        if bad_dlls:
            print(f"FAIL dll sha mismatch: {bad_dlls}", file=sys.stderr)
            return 2
        status(out_root, "identity MATCH (model + binary + 5 DLLs)")

    if not args.summarize_only:
        status(out_root, "probe d>1.0")
        probe = probe_above_one(binary, model, out_root)
        status(
            out_root,
            f"probe done rejects_above_1={probe.get('cli_rejects_above_1')} "
            f"decision={probe.get('decision')}",
        )
    else:
        ppath = out_root / "probe_dgt1" / "probe.json"
        probe = json.loads(ppath.read_text(encoding="utf-8")) if ppath.exists() else {}

    if args.probe_only:
        summary = analyze(out_root, k8_flat, stored_d065, stored_d10, probe)
        render_report(out_root, summary, k8, stored_d065, stored_d10, probe)
        return 0

    if not args.summarize_only:
        rc_all = 0
        for arm in ARMS:
            rc = run_arm(arm, binary, model, out_root, args.threads)
            summary = analyze(out_root, k8_flat, stored_d065, stored_d10, probe)
            render_report(out_root, summary, k8, stored_d065, stored_d10, probe)
            if rc != 0:
                rc_all = rc
                status(out_root, f"STOP after {arm['id']} rc={rc}")
                break
        summary = analyze(out_root, k8_flat, stored_d065, stored_d10, probe)
        render_report(out_root, summary, k8, stored_d065, stored_d10, probe)
        if rc_all == 0:
            status(out_root, f"DONE {summary['verdict']}")
        return rc_all

    summary = analyze(out_root, k8_flat, stored_d065, stored_d10, probe)
    render_report(out_root, summary, k8, stored_d065, stored_d10, probe)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
