#!/usr/bin/env python3
"""Assemble Mellum2 PPL-gate reports from results/mellum2_ppl_gate/summary.json."""
from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "mellum2_ppl_gate"
F1 = ROOT / "reports" / "moe-mellum2-f1-s23.md"
TASK = Path(
    r"C:\Users\gualt\AppData\Local\Temp\claude"
    r"\C--Users-gualt-Desktop-Kalsa-moe-experiments"
    r"\fb421f6e-808c-4488-b008-5b732da526a8"
    r"\scratchpad\agents\mellum2-ppl-gate\report.md"
)
MARKER = "## PPL quality gate (PC, 2026-08-14)"
LANGS = ["en", "es", "fr", "it", "zh"]


def rec(summary: dict, arm: str) -> dict | None:
    for r in summary.get("arms") or []:
        if r.get("arm") == arm:
            return r
    return None


def fmt_d(x) -> str:
    if x is None:
        return "n/a"
    return f"{x:+.4f}"


def fmt_f(x) -> str:
    if x is None:
        return "n/a"
    return f"{float(x):.4f}"


def one_line(r: dict, is_anchor: bool) -> str:
    if not r or not r.get("complete"):
        return f"{r.get('arm') if r else '?'} INCOMPLETE"
    if is_anchor:
        return (
            f"{r['arm']} ANCHOR macro={fmt_f(r.get('macro_bpb'))} "
            f"(en={fmt_f(r.get('bpb_en'))} es={fmt_f(r.get('bpb_es'))} "
            f"fr={fmt_f(r.get('bpb_fr'))} it={fmt_f(r.get('bpb_it'))} "
            f"zh={fmt_f(r.get('bpb_zh'))})"
        )
    return (
        f"{r['arm']} {r.get('verdict')} macro={fmt_f(r.get('macro_bpb'))} "
        f"dMacro={fmt_d(r.get('d_macro'))} worst={r.get('worst_lang')} "
        f"dWorst={fmt_d(r.get('d_worst'))}"
    )


def main() -> int:
    summary_path = OUT / "summary.json"
    if not summary_path.exists():
        print("FAIL no summary.json")
        return 2
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    ident = {}
    if (OUT / "identity.json").exists():
        ident = json.loads((OUT / "identity.json").read_text(encoding="utf-8"))

    k8 = rec(summary, "k8d0")
    k6d10 = rec(summary, "k6d10")
    k6d065 = rec(summary, "k6d065")
    k4 = rec(summary, "k4d0")

    cand_v = (k6d10 or {}).get("verdict") or "INCOMPLETE"
    first = (
        f"{cand_v} k6d1.0 dMacro={fmt_d((k6d10 or {}).get('d_macro'))} "
        f"worst={((k6d10 or {}).get('worst_lang') or 'n/a')} "
        f"dWorst={fmt_d((k6d10 or {}).get('d_worst'))}"
    )

    # --- task report ---
    TASK.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        first,
        "",
        one_line(k8, True),
        one_line(k6d065, False),
        one_line(k4, False),
        "",
        "Protocol: campaign multi5 --ppl-decode --moe-stream cache=2000 anon "
        "io=4 overlap -t 16 --stock-kernel (--no-moe-fused-gemv --no-moe-fused-ffn).",
        "Gates (Marco phase-1): dMacro<=+0.04 and worst-lang<=+0.10 → GATE_PASS; "
        "dMacro<=+0.06 and worst-lang<=+0.15 → GATE_MARGINAL; else GATE_FAIL. "
        "Precedent Marco A2 dMacro=+0.0182 in-gate.",
        f"Model sha {ident.get('model_sha256', 'see shas.txt')} MATCH campaign F1 Q4.",
        f"Binary {ident.get('binary', 'build-pc-mellum-ppl/cli/bmoe-cli.exe')} "
        f"{ident.get('binary_sha256', '')}.",
        "Code-heavy PPL slice: NONE under corpus/ or quality/; multi5 only.",
        "No phones. models/ read-only.",
        "Artifacts: results/mellum2_ppl_gate/ (per-arm JSON/CSV/stdout, runs_ppl.csv, "
        "identity.json, shas.txt, VERDICT.md). Append: reports/moe-mellum2-f1-s23.md.",
        "",
        "DONE",
        "",
    ]
    TASK.write_text("\n".join(lines), encoding="utf-8")

    # --- F1 append ---
    body = [
        "",
        MARKER,
        "",
        "PC only. Same multi5 corpus + `scripts/run_multi5_ppl_host.py --ppl-decode` "
        "as Marco phase-1 / LFM KEXP. Stock kernel (`--no-moe-fused-gemv --no-moe-fused-ffn`), "
        "same streaming recipe as the campaign PPL runs (`--moe-stream --cache-mb 2000 "
        "--dense-weights anon --io-threads 4 --overlap -c 4096 --ubatch 512 -t 16`).",
        "",
        "This is the quality gate that F1c/F1e left open. The 5.151 tok/s S23 number "
        "(kernel-s2-gate, k6d1.0 fused-OFF t=2) is **config only**; this run decides "
        "whether that cell is adoptable.",
        "",
        "### Identity",
        "",
        f"- GGUF `models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` "
        f"sha256 `{ident.get('model_sha256', '')}` "
        f"({ident.get('model_bytes', 8071293600)} B) — MATCH F0/F1 pin "
        "`b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7`.",
        f"- Binary `build-pc-mellum-ppl/cli/bmoe-cli.exe` "
        f"sha256 `{ident.get('binary_sha256', '')}` "
        "(Ninja Release, GGML_NATIVE=ON / AVX2; mellum recipe + fused flags forced OFF). "
        "Campaign `build-pc/cli/bmoe-cli.exe` (2026-08-09) was **not** overwritten — "
        "it predates the mellum recipe row.",
        "- Corpus: `corpus/multi5/{en,es,fr,it,zh}.txt`. **No code-heavy PPL slice** "
        "exists under `corpus/` or `quality/`; multi5 only (not invented).",
        "- Artifacts: `results/mellum2_ppl_gate/`.",
        "",
        "### Results vs k8d0 (native k, no drop)",
        "",
        "Gates = Marco phase-1 protocol: per-lang ΔBPB ≤ +0.10, macro ΔBPB ≤ +0.04 "
        "→ GATE_PASS. Soft band +0.06 / +0.15 → GATE_MARGINAL. "
        "Precedent: Marco A2 k6d065 **+0.0182** in-gate (worst lang zh +0.033).",
        "",
        "| arm | k | drop | macro BPB | Δmacro | worst lang | Δworst | verdict |",
        "|---|---:|---:|---:|---:|---|---:|---|",
    ]
    for r in summary.get("arms") or []:
        if not r.get("complete"):
            body.append(
                f"| {r['arm']} | {r['k']} | {r['drop']} | — | — | — | — | INCOMPLETE |"
            )
            continue
        if r["arm"] == "k8d0":
            body.append(
                f"| **k8d0** | 8 | 0 | **{r['macro_bpb']:.4f}** | 0.0000 | — | 0.0000 | ANCHOR |"
            )
        else:
            body.append(
                f"| **{r['arm']}** | {r['k']} | {r['drop']} | {r['macro_bpb']:.4f} | "
                f"{r['d_macro']:+.4f} | {r['worst_lang']} | {r['d_worst']:+.4f} | "
                f"**{r['verdict']}** |"
            )
    body += [
        "",
        "Per-language BPB (and Δ vs k8d0):",
        "",
        "| arm | en | es | fr | it | zh |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for r in summary.get("arms") or []:
        if not r.get("complete"):
            body.append(f"| {r['arm']} | — | — | — | — | — |")
            continue
        if r["arm"] == "k8d0":
            body.append(
                f"| k8d0 | {r['bpb_en']:.4f} | {r['bpb_es']:.4f} | {r['bpb_fr']:.4f} | "
                f"{r['bpb_it']:.4f} | {r['bpb_zh']:.4f} |"
            )
        else:
            body.append(
                f"| {r['arm']} | {r['bpb_en']:.4f} ({r['d_en']:+.4f}) | "
                f"{r['bpb_es']:.4f} ({r['d_es']:+.4f}) | "
                f"{r['bpb_fr']:.4f} ({r['d_fr']:+.4f}) | "
                f"{r['bpb_it']:.4f} ({r['d_it']:+.4f}) | "
                f"{r['bpb_zh']:.4f} ({r['d_zh']:+.4f}) |"
            )

    adopt = "NOT YET — candidate arm incomplete."
    if k6d10 and k6d10.get("complete") and k8 and k8.get("complete"):
        v = k6d10.get("verdict")
        if v == "GATE_PASS":
            adopt = (
                "**YES — k6d1.0 is adoptable as the product config** on quality. "
                "The 5.151 t/s S23 cell (stock kernel, t=2) clears the same "
                "Marco-phase-1 tolerances that licensed A2."
            )
        elif v == "GATE_MARGINAL":
            adopt = (
                "**MARGINAL — do not silently ship 5.151 as default.** "
                "Quality moved more than Marco A2; gualt call whether the speed "
                "(+11% vs F1e 4.638) buys the extra BPB."
            )
        else:
            adopt = (
                "**NO — k6d1.0 fails the campaign PPL gate.** "
                "5.151 stays a speed anecdote, not a product cell. "
                "Fall back to k6d0.65 (if that arm passed) or native k8."
            )
    body += [
        "",
        "### Product call on 5.151",
        "",
        adopt,
        "",
        f"Written {time.strftime('%Y-%m-%dT%H:%M:%S%z')}.",
        "",
    ]
    section = "\n".join(body)
    text = F1.read_text(encoding="utf-8") if F1.exists() else ""
    if MARKER in text:
        pre, _rest = text.split(MARKER, 1)
        # drop previous generated section
        text = pre.rstrip() + "\n" + section
    else:
        text = text.rstrip() + "\n" + section
    F1.write_text(text, encoding="utf-8")

    (OUT / "STATUS.txt").write_text(
        f"{cand_v}\n" + first + "\n" + "\n".join(one_line(x, x and x.get("arm") == "k8d0") for x in (k8, k6d065, k4)) + "\n",
        encoding="utf-8",
    )
    print(first)
    print("wrote", TASK)
    print("appended", F1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
