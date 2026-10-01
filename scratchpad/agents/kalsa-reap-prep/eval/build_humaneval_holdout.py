#!/usr/bin/env python3
"""Build humaneval-164.jsonl — the HumanEval+ holdout (DESIGN.md §4 item 3).

Source: evalplus/humanevalplus test.jsonl (all 164 HumanEval problems with
the EvalPlus extended tests merged into the `test` field — base + plus tests
in one check(candidate)). HumanEval problems are MIT (OpenAI); the EvalPlus
test extensions are Apache-2.0.

canonical_solution is deliberately DROPPED: the holdout file must not carry
reference solutions. The output jsonl is ~11 MB (the plus tests dominate) —
over the lab's 5 MB git limit — so it is written next to this script but NOT
committed; this builder + the recorded source sha256 are the provenance.
git keeps it out via eval/.gitignore.

Usage: build_humaneval_holdout.py [out_dir]
"""

import hashlib
import json
import pathlib
import sys

from huggingface_hub import hf_hub_download

REPO = "evalplus/humanevalplus"
REVISION = "d32357cf319e50e9c8d8dab5ea876c72b0fd321b"
FILE = "test.jsonl"


def main() -> int:
    out_dir = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent
    path_in = hf_hub_download(REPO, FILE, repo_type="dataset", revision=REVISION)
    rows = [json.loads(l) for l in open(path_in, encoding="utf-8")]
    src_sha = hashlib.sha256(pathlib.Path(path_in).read_bytes()).hexdigest()

    out = out_dir / "humaneval-164.jsonl"
    with open(out, "w", encoding="utf-8") as f:
        for i, r in enumerate(rows):
            f.write(json.dumps({
                "id": f"humaneval-{i:03d}",
                "task_id": r["task_id"],
                "prompt": r["prompt"],
                "entry_point": r["entry_point"],
                "test": r["test"],  # EvalPlus check(): base + plus tests merged
                "license": "mit (problems) / apache-2.0 (plus tests)",
                "source": f"{REPO}:{FILE}", "source_revision": REVISION,
                "source_sha256": src_sha,
            }) + "\n")
    print(f"humaneval-164: {len(rows)} problems -> {out}")
    print(f"source {REPO}:{FILE} @ {REVISION[:12]} sha256 {src_sha}")
    print("NOT committed: > 5 MB (eval/.gitignore); provenance is this builder + the sha256 above")
    return 0


if __name__ == "__main__":
    sys.exit(main())
