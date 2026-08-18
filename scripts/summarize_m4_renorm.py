#!/usr/bin/env python3
"""Summarise the M4 renormalisation ablation into a 2x2 and a verdict.

WRITTEN BEFORE THE DATA EXISTS (2026-08-17, while the OFF arms were still queued)
so that the decision rule is code rather than a judgement made after seeing the
numbers. Do not relax the rules below to fit a result.

The 2x2:

                renorm ON (default)          renorm OFF (--drop-no-renorm)
    d=0.5       calaqwen_dropcurve/k6d05     m4_renorm_ablation/k6d05_norenorm
    d=1.0       calaqwen_dropcurve/k6d10     m4_renorm_ablation/k6d10_norenorm

The ON arms were measured by the curve orchestrator on the same pinned binary and
model, so the contrast is confound-free.

THE NO-OP GUARD. In --ppl-decode the engine echoes only `drop_cold=... k=...`; it
never prints drop_renorm, and the ppl CSV is just pos,token_id,logprob. So no log
line proves --drop-no-renorm actually fired, and a null result would be
indistinguishable from a silently ignored flag. With renorm off the survivors are
NOT rescaled by total/kept (router_hook.cpp:278-282), so the layer output is
systematically shrunk and the perplexity cannot come out bit-identical. Therefore:

    identical macro_bpb at full precision  ->  NO-OP FLAG, not a null result.

Usage:  python scripts/summarize_m4_renorm.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURVE = ROOT / "results" / "calaqwen_dropcurve"
ABL = ROOT / "results" / "m4_renorm_ablation"
OUT = ABL / "VERDICT.md"

# (drop level, ON arm dir/id, OFF arm dir/id)
PAIRS = [
    ("0.5", CURVE / "k6d05", "k6d05", ABL / "k6d05_norenorm", "k6d05_norenorm"),
    ("0.65", CURVE / "k6d065", "k6d065", ABL / "k6d065_norenorm", "k6d065_norenorm"),
    ("1.0", CURVE / "k6d10", "k6d10", ABL / "k6d10_norenorm", "k6d10_norenorm"),
]
# The d=0.0 reference: the drop machinery is not armed at all there.
BASE = (CURVE / "k6d0", "k6d0")


def load(d: Path, tag: str) -> dict | None:
    """Return the arm's meta only if it actually finished.

    `<tag>_multi5.json` is written after every language and on both failure paths
    (run_multi5_ppl_host.py:218,229,258); only the final write adds `finished`.
    Treating the file's existence as completion is how a crashed one-language arm
    gets compared against a full five-language arm.
    """
    p = d / f"{tag}_multi5.json"
    if not p.exists():
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    if "finished" not in m or m.get("macro_bpb") is None:
        return None
    return m


def langs_of(m: dict) -> int:
    v = m.get("langs")
    if isinstance(v, dict):
        return len(v)
    if isinstance(v, list):
        return len(v)
    return -1


def main() -> int:
    base = load(*BASE)
    lines: list[str] = []
    lines.append("# M4 — renormalisation ablation on CalaQwen: does the drop's quality")
    lines.append("# result come from removing experts, or from rescaling the survivors?")
    lines.append("")
    if base:
        lines.append(f"Reference, machinery not armed: **d=0.0 macro bpb = {base['macro_bpb']:.7f}**")
        lines.append("")

    lines.append("| drop | renorm ON | renorm OFF | OFF - ON | reading |")
    lines.append("|---|---|---|---|---|")

    rows = []
    verdicts = []
    for drop, on_dir, on_tag, off_dir, off_tag in PAIRS:
        on = load(on_dir, on_tag)
        off = load(off_dir, off_tag)
        if on is None:
            rows.append(f"| {drop} | *ON arm incomplete* | — | — | cannot read |")
            continue
        if off is None:
            rows.append(f"| {drop} | {on['macro_bpb']:.7f} | *not finished yet* | — | pending |")
            continue

        a, b = float(on["macro_bpb"]), float(off["macro_bpb"])
        d = b - a
        # Full-precision identity is the no-op signature, not a null.
        if repr(a) == repr(b):
            reading = "**NO-OP FLAG** — investigate before concluding anything"
            verdicts.append(("noop", drop, a, b, d))
        elif abs(d) < 1e-6:
            reading = "**suspiciously identical** (|Δ| < 1e-6) — treat as no-op until explained"
            verdicts.append(("noop", drop, a, b, d))
        elif d > 0:
            reading = f"OFF worse by {100*d/a:+.2f}% — renorm is helping"
            verdicts.append(("renorm_helps", drop, a, b, d))
        else:
            reading = f"OFF better by {100*d/a:+.2f}% — the default is costing quality"
            verdicts.append(("renorm_hurts", drop, a, b, d))

        note = ""
        if langs_of(on) != langs_of(off):
            note = f" ⚠️ langs {langs_of(on)} vs {langs_of(off)}"
        rows.append(f"| {drop} | {a:.7f} | {b:.7f} | {d:+.7f} | {reading}{note} |")

    lines.extend(rows)
    lines.append("")

    kinds = {v[0] for v in verdicts}
    lines.append("## Verdict")
    lines.append("")
    if not verdicts:
        lines.append("Incomplete — no pair has both arms finished. No verdict.")
    elif "noop" in kinds:
        lines.append("**BLOCKED: at least one pair came out identical at full precision.**")
        lines.append("That is the signature of `--drop-no-renorm` never reaching the engine,")
        lines.append("not evidence that renormalisation does not matter. Verify the flag")
        lines.append("(`BigMoeOnEdge/cli/main.cpp:729-730` -> `cfg.moe.drop_renorm`) with a short")
        lines.append("run on a small model, checking the metrics CSV header shows `drop_renorm=0`,")
        lines.append("before drawing any conclusion from these arms.")
    elif kinds == {"renorm_helps"}:
        lines.append("**The renormalisation is carrying the result.** Removing experts without")
        lines.append("rescaling the survivors costs more than the drop curve reports, so the")
        lines.append("honest claim is *sharpening the mixture is nearly free*, not *cold experts")
        lines.append("are free to remove*. The wording in PLAN.md, docs/ALIVE.md and NAMING.md")
        lines.append("has to change, and the 'under-trained noise' story is not supported.")
    elif kinds == {"renorm_hurts"}:
        lines.append("**The default is wrong and there is free quality on the table:** turning")
        lines.append("renormalisation off measured *better* at every level tested.")
    else:
        lines.append("**Mixed across drop levels** — the renormalisation's sign depends on how")
        lines.append("much is dropped. Report per level; do not average them into one claim.")
    lines.append("")
    lines.append("Arms compared byte-for-byte on the same pinned binary and model; the only")
    lines.append("difference between an ON and an OFF cell is `--extra=--drop-no-renorm`.")
    lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(lines) + "\n"
    OUT.write_text(body, encoding="utf-8")
    # The file is UTF-8 and authoritative; the console on this machine is cp1252,
    # so never let an un-encodable character turn a successful summary into a
    # traceback that looks like the summary failed.
    try:
        print(body)
    except UnicodeEncodeError:
        print(body.encode("ascii", "replace").decode("ascii"))
    print(f"[written] {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
