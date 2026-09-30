#!/usr/bin/env python3
"""Build the eval-gate holdout sets (runnable before the pod).

  gsm8k-200.jsonl — 200 fixed GSM8K test items (seed 42), MIT licence
  tools-100.jsonl — 100 function-calling dialogues from hermes'
                    func-calling.json (Apache-2.0). The file is a DIFFERENT
                    generator from the calibration's tool rows (glaive-
                    function-calling-5k.json) — the 2026-09-30 review
                    flagged same-file holdouts as favouring whichever model
                    trained on the generator. Content-hash disjointness vs
                    the calibration rows is still checked.

Both are written to eval/ next to this script, each row carrying the licence
and the pinned source revision. Hermes/glaive tools are EN-only — no
permissively licensed multilingual tool-call source exists (EVAL-GATE.md).

Usage: build_holdouts.py <calib_jsonl> [out_dir]
"""

import hashlib
import json
import pathlib
import random
import re
import sys

from datasets import load_dataset
from huggingface_hub import hf_hub_download

GSM8K_REV = "740312add88f781978c0658806c59bc2815b9866"
HERMES_REV = "dae3e1d28cfbcf4b915c04ea1e072030529b4bda"
HOLDOUT_FILE = "func-calling.json"
TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)
HERMES_ROLE = {"system": "system", "human": "user", "gpt": "assistant",
               "assistant": "assistant", "tool": "tool"}


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())[:240]


def calib_hashes(calib_path: pathlib.Path) -> set[str]:
    out = set()
    for line in open(calib_path):
        row = json.loads(line)
        out.add(hashlib.sha256(norm(
            " ".join(m["content"] for m in row["messages"])).encode()).hexdigest())
    return out


def build_gsm8k(out_dir: pathlib.Path) -> int:
    ds = load_dataset("openai/gsm8k", "main", split="test", streaming=True,
                      revision=GSM8K_REV)
    items = [r for _, r in zip(range(2000), ds)]
    rng = random.Random(42)
    picked = rng.sample(items, 200)
    path = out_dir / "gsm8k-200.jsonl"
    with open(path, "w") as f:
        for i, r in enumerate(picked):
            f.write(json.dumps({
                "id": f"gsm8k-200-{i:03d}",
                "question": r["question"],
                "answer_number": r["answer"].split("####")[-1].strip(),
                "source": "openai/gsm8k main test", "license": "mit",
                "source_revision": GSM8K_REV,
            }) + "\n")
    print(f"gsm8k-200: {len(picked)} items -> {path} (mit, {GSM8K_REV[:12]})")
    return len(picked)


def build_tools(out_dir: pathlib.Path, calib: set[str]) -> int:
    path_in = hf_hub_download("NousResearch/hermes-function-calling-v1",
                              HOLDOUT_FILE, repo_type="dataset",
                              revision=HERMES_REV)
    rows = json.load(open(path_in))
    held, seen = [], set()
    for r in rows:
        if len(held) >= 100:
            break
        conv = r.get("conversations") or r.get("messages") or []
        msgs = [{"role": HERMES_ROLE.get(m.get("from") or m.get("role"), "user"),
                 "content": m.get("value") or m.get("content") or ""}
                for m in conv]
        # prompt = everything up to the user turn that triggers the call;
        # expected = the first tool_call JSON in the assistant reply that follows
        last_user = max((i for i, m in enumerate(msgs) if m["role"] == "user"),
                        default=None)
        if last_user is None or last_user + 1 >= len(msgs):
            continue
        reply = " ".join(m["content"] for m in msgs[last_user + 1:])
        m = TOOL_CALL_RE.search(reply)
        if not m:
            continue
        try:
            expect = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        row_hash = hashlib.sha256(norm(
            " ".join(m["content"] for m in msgs)).encode()).hexdigest()
        if row_hash in calib or row_hash in seen:
            continue
        seen.add(row_hash)
        held.append({
            "id": f"tools-100-{len(held):03d}",
            "prompt_messages": msgs[: last_user + 1],
            "expect": expect,
            "source": f"NousResearch/hermes-function-calling-v1:{HOLDOUT_FILE}",
            "license": "apache-2.0", "source_revision": HERMES_REV,
        })
    path = out_dir / "tools-100.jsonl"
    with open(path, "w") as f:
        for r in held:
            f.write(json.dumps(r) + "\n")
    print(f"tools-100: {len(held)} items -> {path} "
          f"(apache-2.0, {HOLDOUT_FILE}, {HERMES_REV[:12]})")
    return len(held)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    calib_path = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).parent
    n_gsm = build_gsm8k(out_dir)
    n_tools = build_tools(out_dir, calib_hashes(calib_path))
    ok = n_gsm == 200 and n_tools == 100
    print("OK" if ok else "FAIL: quotas unfilled")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
