#!/usr/bin/env python3
"""Mellum2 PC PPL quality gate — campaign multi5 harness, stock kernel.

Arms (run one at a time; resume-safe if TAG_multi5.json already has all langs):
  1. k8d0     baseline, native k, no drop
  2. k6d065   campaign-style cell
  3. k6d10    candidate (5.151 t/s S23 config)
  4. k4d0     F1c speed point

Priority if the grid cannot finish: 1 then 3 then 2 then 4
(anchor first so the candidate can be scored).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "scripts" / "run_multi5_ppl_host.py"
LANGS = ["en", "es", "fr", "it", "zh"]

# Campaign Marco phase-1 protocol (results/marco_phase1/VERDICT.md)
MACRO_PASS = 0.04
LANG_PASS = 0.10
MACRO_MARGINAL = 0.06
LANG_MARGINAL = 0.15

ARMS = [
    {"id": "k8d0", "k": 8, "drop": 0.0, "role": "baseline"},
    {"id": "k6d10", "k": 6, "drop": 1.0, "role": "candidate"},
    {"id": "k6d065", "k": 6, "drop": 0.65, "role": "campaign_style"},
    {"id": "k4d0", "k": 4, "drop": 0.0, "role": "f1c_speed"},
]


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


def verdict(d_macro: float, d_worst: float) -> str:
    if d_macro <= MACRO_PASS and d_worst <= LANG_PASS:
        return "GATE_PASS"
    if d_macro <= MACRO_MARGINAL and d_worst <= LANG_MARGINAL:
        return "GATE_MARGINAL"
    return "GATE_FAIL"


def write_identity(out: Path, binary: Path, model: Path, extra: list[str]) -> dict:
    ident = {
        "model": str(model),
        "model_sha256": sha256_file(model),
        "model_bytes": model.stat().st_size,
        "binary": str(binary),
        "binary_sha256": sha256_file(binary),
        "binary_bytes": binary.stat().st_size,
        "expected_model_sha256": "b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7",
        "extra_flags": extra,
        "threads": None,
        "corpus": str(ROOT / "corpus" / "multi5"),
        "code_slice": None,
        "note": (
            "No code-heavy PPL slice exists under corpus/ or quality/; "
            "multi5 only (do not invent a corpus)."
        ),
        "gates": {
            "macro_pass": MACRO_PASS,
            "lang_pass": LANG_PASS,
            "macro_marginal": MACRO_MARGINAL,
            "lang_marginal": LANG_MARGINAL,
            "precedent": "Marco A2 dMacro=+0.0182 GATE_PASS (in-gate); per-lang +0.10 / macro +0.04",
        },
        "written": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    # sibling DLLs
    dlls = {}
    for folder in (binary.parent, binary.parent.parent / "bin"):
        if not folder.is_dir():
            continue
        for p in folder.glob("*.dll"):
            dlls[p.name] = sha256_file(p)
    ident["dll_sha256"] = dlls
    (out / "identity.json").write_text(json.dumps(ident, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"model  {ident['model_sha256']}  {ident['model_bytes']}  {model}",
        f"expect b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7",
        f"match  {ident['model_sha256'] == ident['expected_model_sha256']}",
        f"binary {ident['binary_sha256']}  {ident['binary_bytes']}  {binary}",
        f"extra  {' '.join(extra)}",
        f"code_slice  NONE (corpus/ + quality/ have no code-heavy PPL file)",
    ]
    (out / "shas.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ident


def run_arm(arm: dict, binary: Path, model: Path, out_root: Path, threads: int, extra: list[str]) -> int:
    outdir = out_root / arm["id"]
    tag = arm["id"]
    json_path = outdir / f"{tag}_multi5.json"
    existing = load_multi5(json_path)
    if existing:
        print(f"SKIP {tag} (complete multi5 on disk)", flush=True)
        return 0
    outdir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(HARNESS),
        "--binary",
        str(binary),
        "--model",
        str(model),
        "--tag",
        tag,
        "--outdir",
        str(outdir),
        "--langs",
        ",".join(LANGS),
        "--threads",
        str(threads),
        "--ctx",
        "4096",
        "--ubatch",
        "512",
        "--moe-stream",
        "--cache-mb",
        "2000",
        "--dense-weights",
        "anon",
        "--io-threads",
        "4",
        "--overlap",
        "--n-expert-used",
        str(arm["k"]),
        "--drop-cold-experts",
        str(arm["drop"]),
        "--ppl-mode",
        "decode",
        "--stock-kernel",
    ]
    if extra:
        for tok in extra:
            cmd += [f"--extra={tok}"]
    cmd_path = outdir / "command.txt"
    cmd_path.write_text(" ".join(cmd) + "\n", encoding="utf-8")
    print(f"=== ARM {tag} k={arm['k']} drop={arm['drop']} ===", flush=True)
    print("CMD:", " ".join(cmd), flush=True)
    env = os.environ.copy()
    # Avoid campaign-bin collision: prefer this binary's dirs
    lib_dirs = [str(binary.parent), str(binary.parent.parent / "bin")]
    env["PATH"] = os.pathsep.join(lib_dirs) + os.pathsep + env.get("PATH", "")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, cwd=str(ROOT))
    dt = time.time() - t0
    (outdir / "harness_rc.txt").write_text(f"{proc.returncode}\nseconds={dt:.1f}\n", encoding="utf-8")
    print(f"ARM {tag} rc={proc.returncode} wall={dt:.1f}s", flush=True)
    return proc.returncode


def summarize(out_root: Path) -> dict:
    rows = []
    by_id = {}
    for arm in ARMS:
        path = out_root / arm["id"] / f"{arm['id']}_multi5.json"
        data = load_multi5(path)
        rec = {
            "arm": arm["id"],
            "role": arm["role"],
            "k": arm["k"],
            "drop": arm["drop"],
            "complete": data is not None,
        }
        if data:
            rec["macro_bpb"] = data.get("macro_bpb")
            rec["seconds"] = sum((data["langs"][L].get("seconds") or 0) for L in LANGS)
            rec["binary_sha256"] = data.get("binary_sha256")
            rec["model_sha256"] = data.get("model_sha256")
            for L in LANGS:
                rec[f"bpb_{L}"] = data["langs"][L]["bpb"]
                rec[f"ppl_{L}"] = data["langs"][L]["ppl"]
        by_id[arm["id"]] = rec
        rows.append(rec)

    base = by_id.get("k8d0") if by_id.get("k8d0", {}).get("complete") else None
    if base:
        for rec in rows:
            if not rec.get("complete"):
                continue
            rec["d_macro"] = rec["macro_bpb"] - base["macro_bpb"]
            worst_lang, worst_d = None, None
            for L in LANGS:
                d = rec[f"bpb_{L}"] - base[f"bpb_{L}"]
                rec[f"d_{L}"] = d
                if worst_d is None or d > worst_d:
                    worst_d, worst_lang = d, L
            rec["d_worst"] = worst_d
            rec["worst_lang"] = worst_lang
            rec["verdict"] = "ANCHOR" if rec["arm"] == "k8d0" else verdict(rec["d_macro"], rec["d_worst"])
    summary = {
        "baseline": "k8d0",
        "arms": rows,
        "gates": {
            "macro_pass": MACRO_PASS,
            "lang_pass": LANG_PASS,
            "macro_marginal": MACRO_MARGINAL,
            "lang_marginal": LANG_MARGINAL,
        },
        "finished": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (out_root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    csv_path = out_root / "runs_ppl.csv"
    fields = [
        "arm", "role", "k", "drop", "complete", "verdict",
        "macro_bpb", "d_macro", "worst_lang", "d_worst",
        "bpb_en", "bpb_es", "bpb_fr", "bpb_it", "bpb_zh",
        "d_en", "d_es", "d_fr", "d_it", "d_zh",
        "ppl_en", "ppl_es", "ppl_fr", "ppl_it", "ppl_zh",
        "seconds",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for rec in rows:
            w.writerow(rec)

    lines = [
        "# Mellum2 PPL gate summary",
        "",
        f"Baseline = k8d0. Gates: dMacro<=+{MACRO_PASS} and worst-lang<=+{LANG_PASS} → GATE_PASS;",
        f"dMacro<=+{MACRO_MARGINAL} and worst-lang<=+{LANG_MARGINAL} → GATE_MARGINAL; else GATE_FAIL.",
        "Precedent: Marco A2 dMacro=+0.0182 GATE_PASS.",
        "",
        "| arm | k | drop | macro | dMacro | worst | dWorst | verdict |",
        "|---|---:|---:|---:|---:|---|---:|---|",
    ]
    for rec in rows:
        if not rec.get("complete"):
            lines.append(f"| {rec['arm']} | {rec['k']} | {rec['drop']} | — | — | — | — | INCOMPLETE |")
            continue
        if rec["arm"] == "k8d0":
            lines.append(
                f"| {rec['arm']} | {rec['k']} | {rec['drop']} | {rec['macro_bpb']:.4f} | "
                f"0.0000 | — | 0.0000 | ANCHOR |"
            )
        else:
            lines.append(
                f"| {rec['arm']} | {rec['k']} | {rec['drop']} | {rec['macro_bpb']:.4f} | "
                f"{rec['d_macro']:+.4f} | {rec['worst_lang']} | {rec['d_worst']:+.4f} | {rec['verdict']} |"
            )
    (out_root / "VERDICT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--outdir", default=str(ROOT / "results" / "mellum2_ppl_gate"))
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument("--only", default="", help="comma ids to run (default: 1,3,2,4 order)")
    ap.add_argument(
        "--extra",
        nargs="*",
        default=[],
        help="optional extra tokens (use with --extra=--flag). Stock kernel is always on.",
    )
    ap.add_argument("--skip-identity", action="store_true")
    args = ap.parse_args()

    binary = Path(args.binary)
    model = Path(args.model)
    out_root = Path(args.outdir)
    out_root.mkdir(parents=True, exist_ok=True)

    if not args.skip_identity:
        ident = write_identity(
            out_root,
            binary,
            model,
            ["--no-moe-fused-gemv", "--no-moe-fused-ffn", *args.extra],
        )
        if ident["model_sha256"] != ident["expected_model_sha256"]:
            print("FAIL model sha mismatch", file=sys.stderr)
            return 2
        print("model sha MATCH", flush=True)

    wanted = [x.strip() for x in args.only.split(",") if x.strip()] if args.only else [a["id"] for a in ARMS]
    arms = [a for a in ARMS if a["id"] in wanted]
    # keep priority order defined in ARMS, not user list order except filter
    rc_all = 0
    for arm in arms:
        rc = run_arm(arm, binary, model, out_root, args.threads, args.extra)
        summarize(out_root)
        if rc != 0:
            rc_all = rc
            print(f"STOP after {arm['id']} rc={rc}", flush=True)
            break
    summarize(out_root)
    return rc_all


if __name__ == "__main__":
    raise SystemExit(main())
