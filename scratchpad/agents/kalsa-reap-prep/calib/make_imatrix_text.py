#!/usr/bin/env python3
"""Render the calibration JSONL to the plain-text file llama-imatrix consumes.

llama-imatrix runs the model over raw text (-f file); chat structure helps
because the weight-activation statistics should come from chat-shaped tokens.
Each row is rendered with the checkpoint's own Qwen3.6 chat template
(hermes tool rows keep their system turn) and blocks are separated by the
EOS the packer will see.

Usage: make_imatrix_text.py <tokenizer_dir> <calib.jsonl> <out.txt>
"""

import json
import pathlib
import sys

from transformers import AutoTokenizer


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    tok_dir, calib, out = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
    tok = AutoTokenizer.from_pretrained(tok_dir)
    blocks = []
    for line in open(calib):
        row = json.loads(line)
        blocks.append(tok.apply_chat_template(
            row["messages"], add_generation_prompt=False, tokenize=False))
    pathlib.Path(out).write_text("\n".join(blocks) + "\n", encoding="utf-8")
    n_chars = sum(len(b) for b in blocks)
    print(f"imatrix text: {len(blocks)} rows, {n_chars:,} chars -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
