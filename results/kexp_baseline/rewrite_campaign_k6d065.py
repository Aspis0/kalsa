#!/usr/bin/env python3
"""Propagate campaign default A: --n-expert-used 6 --drop-cold-experts 0.65.

Only touches known campaign-default harness scripts (same set as adopt-dropcold
plus siblings with hard-coded product defaults). Leaves A/B sweeps and trial
Marco orchestrator alone.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

TARGETS = [
    "scripts/f55a_ppl_baseline.sh",
    "scripts/run_staccato.sh",
    "scripts/run_staccato2.sh",
    "scripts/start_f4_5_quality.sh",
    "scripts/start_f4_7_batt_curve.sh",
    "scripts/fix_smoke_and_sostenuto.sh",
    "scripts/retry_adopt_aborted.sh",
]


def transform(text: str) -> str:
    text = text.replace(
        "--n-expert-used 8 --drop-cold-experts 0.50",
        "--n-expert-used 6 --drop-cold-experts 0.65",
    )
    text = text.replace(
        "--drop-cold-experts 0.50 --n-expert-used 8",
        "--drop-cold-experts 0.65 --n-expert-used 6",
    )
    # fixed campaign drop 0.50 → 0.65
    text = re.sub(r"(--drop-cold-experts) 0\.50\b", r"\1 0.65", text)

    out_lines: list[str] = []
    for line in text.splitlines(keepends=True):
        if re.search(r"--n-expert-used\s+8\b", line):
            campaignish = any(
                k in line
                for k in (
                    "drop-cold-experts",
                    "moe-stream",
                    "FLAGS",
                    "BASE",
                    "flags_s",
                    "gate_config",
                    "append_run",
                    "--progress",
                )
            )
            # skip explicit A/B arm labels
            ab_arm = any(
                k in line
                for k in (
                    "F5.2-C4-k8",
                    "DROP_F",
                    "run_var",
                    'EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 8"',
                )
            )
            if campaignish and not ab_arm:
                line = re.sub(r"--n-expert-used\s+8\b", "--n-expert-used 6", line)
        out_lines.append(line)
    return "".join(out_lines)


def main() -> None:
    changed: list[str] = []
    for rel in TARGETS:
        p = ROOT / rel
        if not p.exists():
            print(f"MISSING {rel}")
            continue
        orig = p.read_text(encoding="utf-8")
        new = transform(orig)
        if new == orig:
            print(f"NOCHANGE {rel}")
            continue
        p.write_text(new, encoding="utf-8", newline="\n")
        changed.append(rel)
        print(
            f"OK {rel} residual_n8={new.count('--n-expert-used 8')} "
            f"residual_d050={new.count('--drop-cold-experts 0.50')} "
            f"n6={new.count('--n-expert-used 6')} d065={new.count('--drop-cold-experts 0.65')}"
        )

    out = ROOT / "results" / "kexp_baseline" / "campaign_k6d065_rewrite_list.txt"
    out.write_text("\n".join(changed) + ("\n" if changed else ""), encoding="utf-8")
    print(f"CHANGED {len(changed)}")


if __name__ == "__main__":
    main()
