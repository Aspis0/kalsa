#!/usr/bin/env python3
"""Build gsm8kit-100.jsonl — the GSM8K-Italian holdout (DESIGN.md §4 item 3).

Source: Eurolingua/gsm8kx, split gsm8k_IT_test (the TEST split of GSM8K
translated to Italian by Thellmann et al., arXiv:2410.08928). Chosen over
sapienzanlp/gsm8k_italian because that one is a multiple-choice reformulation
of the TRAIN split — our phase-0 calibration adds GSM8K train, so it would be
contaminated. Licence: MIT (card tag; GSM8K itself is MIT).

Same schema as gsm8k-200.jsonl, so run_gen_eval.py --dataset gsm8kit scores
it unchanged: exact match of the LAST number in the reply vs the number after
"####". 100 items sampled seed-42 from the 1319-row test split.

Usage: build_gsm8kit_holdout.py [out_dir]
"""

import json
import pathlib
import random
import sys

from huggingface_hub import hf_hub_download

REPO = "Eurolingua/gsm8kx"
REVISION = "363d87617cd417b731dc860194a6935fd5ff49ae"
FILE = "gsm8k_IT_test.jsonl"


def main() -> int:
    out_dir = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent
    path_in = hf_hub_download(REPO, FILE, repo_type="dataset", revision=REVISION)
    rows = [json.loads(l) for l in open(path_in, encoding="utf-8")]
    usable = []
    for r in rows:
        tail = r["answer"].split("####")[-1].strip().replace(",", "")
        if tail and float(tail) == float(tail):  # numeric final answer present
            usable.append((r["question"], tail))
    rng = random.Random(42)
    picked = rng.sample(usable, 100)

    out = out_dir / "gsm8kit-100.jsonl"
    with open(out, "w", encoding="utf-8") as f:
        for i, (question, answer) in enumerate(picked):
            f.write(json.dumps({
                "id": f"gsm8kit-100-{i:03d}",
                "question": question,
                "answer_number": answer,
                "source": f"{REPO}:{FILE}", "license": "mit",
                "source_revision": REVISION,
            }, ensure_ascii=False) + "\n")
    print(f"gsm8kit-100: {len(picked)} of {len(rows)} rows ({len(usable)} usable)"
          f" -> {out} (mit, {REPO}, {REVISION[:12]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
