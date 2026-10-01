#!/usr/bin/env python3
"""Re-score stored GSM8K raw generations (A40 probe follow-up).

The probe ran at max_tokens=4096, which cut reasoning models mid-think
(REPORT.md reading 3). This script re-applies the run_gen_eval.py scorer to
the raw outputs ALREADY ON DISK in each results dir's gsm8k.json and
reports, per arm: stored vs re-scored pass counts (must be identical — same
scorer, same text), how many items carry any raw text, and how many
truncated items carry NO raw text. Those are unrecoverable: the 4096-cap
thinking text was never stored, so an UNCAPPED re-score is impossible from
disk — only a regeneration at 8192 (the new gate default) can measure it.

Usage: rescore_gsm8k_raw.py --holdout gsm8k-200.jsonl <results_dir>...
"""

import argparse
import json
import pathlib
import sys

from run_gen_eval import score_text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", default=str(pathlib.Path(__file__).parent / "gsm8k-200.jsonl"))
    ap.add_argument("dirs", nargs="+", help="results dirs containing gsm8k.json")
    a = ap.parse_args()
    answers = {r["id"]: r["answer_number"]
               for r in map(json.loads, open(a.holdout, encoding="utf-8"))}

    print(f"{'arm':22s} {'stored':>6s} {'rescored':>8s} {'match':>5s} "
          f"{'raw_any':>7s} {'trunc_no_raw':>12s}")
    for d in a.dirs:
        data = json.load(open(f"{d}/gsm8k.json", encoding="utf-8"))
        n_raw = n_trunc_no_raw = rescored = 0
        for item in data["items"]:
            raw = item.get("raw") or ""
            if raw.strip():
                n_raw += 1
                rescored += int(score_text(raw, {"answer_number": answers[item["id"]]}))
            elif item.get("finish_reason") == "length":
                n_trunc_no_raw += 1
        stored = data["ok"]
        mark = "OK" if stored == rescored else "DIFF"
        print(f"{pathlib.Path(d).name:22s} {stored:6d} {rescored:8d} {mark:>5s} "
              f"{n_raw:7d} {n_trunc_no_raw:12d}")
    print("\ntrunc_no_raw items have no stored text (cut inside <think>, "
          "reasoning never stored): an uncapped re-score needs regeneration "
          "at max_tokens=8192, which the fixed gate now uses.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
