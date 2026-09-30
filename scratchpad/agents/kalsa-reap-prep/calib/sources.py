#!/usr/bin/env python3
"""Read the licensed calibration sources into message rows.

One responsibility per function; every download goes through a pinned
revision (REVISIONS here matches build_calib.py). Aya rows are SHUFFLED with
a fixed seed before sampling (the 2026-09-30 review flagged first-N as
biasing the mix toward one slice of each config). Licence tags are per
config, not per repo: aya_collection's translated_dolly derives from
databricks-dolly-15k (CC-BY-SA-3.0) even though the collection ships
Apache-2.0, so those rows are tagged cc-by-sa-3.0.
"""

import hashlib
import json
import random

import pyarrow.parquet as pq
from datasets import load_dataset
from huggingface_hub import HfApi, hf_hub_download

REVISIONS = {
    "CohereForAI/aya_dataset": "f9ea04583f02a8f86404ff6c58bf75fe637df8a2",
    "CohereForAI/aya_collection": "09069079fad96ad9c7f8781be8c1d70471dfa768",
    "openai/gsm8k": "740312add88f781978c0658806c59bc2815b9866",
    "google-research-datasets/mbpp": "4bb6404fdc6cacfda99d4ac4205087b89d32030c",
    "NousResearch/hermes-function-calling-v1": "dae3e1d28cfbcf4b915c04ea1e072030529b4bda",
}
# aya_dataset names languages; aya_collection uses ISO 639-3 (zho, no zh in
# aya_dataset). Verified live on 2026-09-29.
AYA_LANG = {
    "CohereForAI/aya_dataset": {"it": "Italian", "es": "Spanish", "fr": "French",
                                "en": "English", "zh": None},
    "CohereForAI/aya_collection": {"it": "ita", "es": "spa", "fr": "fra",
                                   "en": "eng", "zh": "zho"},
}
# licence of the aya_collection config's UPSTREAM data, not of the collection
CONFIG_LICENCE = {
    "translated_flan_cot": "apache-2.0",   # flan is Apache-2.0
    "translated_dolly": "cc-by-sa-3.0",    # databricks-dolly-15k is CC-BY-SA-3.0
}
SAMPLE_SEED = 20260930

_TREE_CACHE: dict = {}


def parquet_files(repo: str, prefix: str) -> list[str]:
    if repo not in _TREE_CACHE:
        tree = HfApi().list_repo_tree(repo, repo_type="dataset", recursive=True)
        _TREE_CACHE[repo] = [{"path": f.path} for f in tree
                             if getattr(f, "size", None) is not None]
    return sorted(i["path"] for i in _TREE_CACHE[repo]
                  if i["path"].startswith(prefix + "/") and i["path"].endswith(".parquet"))


def aya_pairs(repo: str, config: str, lang: str, sample: int):
    """Yield (inputs, targets) pairs, language-filtered, seed-shuffled."""
    want = AYA_LANG[repo][lang]
    if want is None:
        return
    # stable integer seed: str.__hash__ is salted per process (PYTHONHASHSEED),
    # so the old tuple-hash seed was not reproducible across runs
    seed = int(hashlib.sha256(
        f"{SAMPLE_SEED}|{repo}|{config}|{lang}".encode()).hexdigest()[:15], 16)
    rng = random.Random(seed)
    for pf in parquet_files(repo, config):
        table = pq.read_table(hf_hub_download(repo, pf, repo_type="dataset",
                                              revision=REVISIONS[repo]),
                              columns=["inputs", "targets", "language"],
                              filters=[("language", "==", want)])
        n = table.num_rows
        if n == 0:
            continue
        take = rng.sample(range(n), min(n, sample))
        cols = table.take(take).to_pylist()
        for row in cols:
            yield row["inputs"], row["targets"]


def aya_licence(config: str) -> str:
    return CONFIG_LICENCE.get(config, "apache-2.0")


def gsm8k_rows():
    """Yield {question, solution, final} — the FULL train answer, not just
    the number (the old builder kept only the number; the review called it
    out). Splits at GSM8K's '####' marker."""
    ds = load_dataset("openai/gsm8k", "main", split="train", streaming=True,
                      revision=REVISIONS["openai/gsm8k"])
    for r in ds:
        full = r["answer"]
        sol, _, final = full.rpartition("####")
        yield {"question": r["question"], "solution": sol.strip(),
               "final": final.strip(), "full": full}


def mbpp_rows():
    """MBPP code rows (CC-BY-4.0; sanitized first, then full to top up)."""
    repo = "google-research-datasets/mbpp"
    for cfg in ("sanitized", "full"):
        ds = load_dataset(repo, cfg, split="train", streaming=True,
                          revision=REVISIONS[repo])
        for r in ds:
            yield {"prompt": r.get("prompt") or r["text"], "code": r["code"],
                   "config": cfg}


_HERMES_ROLE = {"system": "system", "human": "user", "user": "user",
                "gpt": "assistant", "assistant": "assistant", "tool": "tool",
                "chatbot": "assistant"}


def hermes_rows(fname: str):
    """Yield {messages, n_user_turns} from a hermes file (mechanical
    from->role, value->content conversion)."""
    repo = "NousResearch/hermes-function-calling-v1"
    path = hf_hub_download(repo, fname, repo_type="dataset",
                           revision=REVISIONS[repo])
    for r in json.load(open(path)):
        src = r.get("messages") or r.get("conversations") or []
        msgs = [{"role": _HERMES_ROLE.get(m.get("from") or m.get("role"), "user"),
                 "content": m.get("value") or m.get("content") or ""}
                for m in src]
        yield {"messages": msgs,
               "n_user_turns": sum(1 for m in msgs if m["role"] == "user")}
