#!/usr/bin/env python3
"""Build the Kalsa REAP calibration set (>=1024 samples, 5 languages).

Output (outside git, under ~/kalsa-models/reap-calib/):
  kalsa-reap-calib.jsonl  rows {messages, language, category, source, license, ...}
  counts.json             per-language / per-category matrix actually filled

Sources are licensed Apache-2.0 or MIT (see calib/SOURCES.md). Rows are
messages-only; the Qwen3.6 chat template is applied on the pod by moep's
tokenize_rows using the checkpoint's own tokenizer.

Disjointness from corpus/multi5: no calibration row may contain any 80-char
normalized window of the multi5 slices. Aya-family configs are read from
parquet with a column filter — streaming scan of translated_flan_cot is
impractical (tens of millions of rows, target languages scattered).
"""

import hashlib
import json
import pathlib
import random
import re
import sys

import pyarrow.parquet as pq
from datasets import load_dataset
from huggingface_hub import HfApi, hf_hub_download

OUT_DIR = pathlib.Path.home() / "kalsa-models/reap-calib"
MULTI5_DIR = pathlib.Path.home() / "Projects/kalsa-moe-experiments/corpus/multi5"

# rows per (language, category); code and tool-call are EN-only because the
# licensed sources for them are EN-only (reported as such in counts.json)
QUOTA = {
    ("it", "chat"): 264, ("it", "reasoning"): 120,
    ("en", "chat"): 36, ("en", "reasoning"): 24, ("en", "code"): 120, ("en", "toolcall"): 100,
    ("es", "chat"): 172, ("es", "reasoning"): 32,
    ("fr", "chat"): 172, ("fr", "reasoning"): 32,
    ("zh", "chat"): 176, ("zh", "reasoning"): 32,
}

# aya_dataset labels languages by name and has NO Chinese; aya_collection
# uses ISO 639-3 codes (zho). Both verified live on 2026-09-29.
AYA_LANG = {
    "CohereForAI/aya_dataset": {"it": "Italian", "es": "Spanish", "fr": "French",
                                "en": "English", "zh": None},
    "CohereForAI/aya_collection": {"it": "ita", "es": "spa", "fr": "fra",
                                   "en": "eng", "zh": "zho"},
}
SEED = 42
WINDOW = 80


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+", "", text.lower())


def load_multi5_windows() -> set[str]:
    ban: set[str] = set()
    for f in sorted(MULTI5_DIR.glob("*.txt")):
        ban.update(windows(f.read_text(encoding="utf-8")))
    return ban


def windows(text: str):
    t = norm(text)
    for i in range(0, max(1, len(t) - WINDOW + 1), WINDOW // 2):
        yield t[i:i + WINDOW]


class Builder:
    def __init__(self):
        self.rows = []
        self.counts: dict = {}
        self.skips: dict = {}
        self.seen_hashes: set[str] = set()
        self.banned = load_multi5_windows()
        self.rng = random.Random(SEED)
        self.api = HfApi()
        self._rev_cache: dict = {}

    def add(self, lang, category, source, license_name, revision, messages):
        if len(messages) < 2 or not all(isinstance(m.get("content"), str) for m in messages):
            self._bump("malformed")
            return False
        text = " ".join(m["content"] for m in messages)
        if len(norm(text)) < 120:
            self._bump("short")
            return False
        key = hashlib.sha256(norm(text)[:240].encode()).hexdigest()
        if key in self.seen_hashes:
            self._bump("dupe")
            return False
        joined = norm(text)
        if any(w in joined for w in self.banned):
            self._bump("multi5")
            return False
        self.seen_hashes.add(key)
        self.counts[f"{lang}/{category}"] = self.counts.get(f"{lang}/{category}", 0) + 1
        self.rows.append({
            "id": f"kalsa-calib-{len(self.rows):05d}",
            "language": lang, "category": category, "source": source,
            "license": license_name, "source_revision": revision,
            "messages": messages,
        })
        return True

    def _bump(self, why):
        self.skips[why] = self.skips.get(why, 0) + 1

    def need(self, lang, category):
        return QUOTA.get((lang, category), 0) - self.counts.get(f"{lang}/{category}", 0)

    def revision(self, repo):
        if repo not in self._rev_cache:
            self._rev_cache[repo] = self.api.dataset_info(repo).sha
        return self._rev_cache[repo]


_TREE_CACHE: dict = {}


def parquet_files(repo: str, prefix: str) -> list[str]:
    if repo not in _TREE_CACHE:
        tree = HfApi().list_repo_tree(repo, repo_type="dataset", recursive=True)
        _TREE_CACHE[repo] = [{"path": f.path} for f in tree
                             if getattr(f, "size", None) is not None]
    return sorted(i["path"] for i in _TREE_CACHE[repo]
                  if i["path"].startswith(prefix + "/") and i["path"].endswith(".parquet"))


def take_aya_rows(b: Builder, lang_key, category, cfg_prefix, repo):
    """Fill (lang, category) from an aya-family parquet config, language-filtered."""
    if b.need(lang_key, category) <= 0:
        return
    want = AYA_LANG[repo][lang_key]
    if want is None:
        return  # e.g. aya_dataset has no Chinese
    rev = b.revision(repo)
    for pf in parquet_files(repo, cfg_prefix):
        if b.need(lang_key, category) <= 0:
            return
        local = hf_hub_download(repo, pf, repo_type="dataset")
        table = pq.read_table(local, columns=["inputs", "targets", "language"],
                              filters=[("language", "==", want)])
        for row in table.to_pylist():
            if b.need(lang_key, category) <= 0:
                return
            msgs = [{"role": "user", "content": row["inputs"]},
                    {"role": "assistant", "content": row["targets"]}]
            b.add(lang_key, category, f"{repo}:{cfg_prefix}", "apache-2.0", rev, msgs)


def take_gsm8k_en(b: Builder):
    rev = b.revision("openai/gsm8k")
    ds = load_dataset("openai/gsm8k", "main", split="train", streaming=True)
    for r in ds:
        if b.need("en", "reasoning") <= 0:
            return
        msgs = [{"role": "user", "content": r["question"]},
                {"role": "assistant", "content": r["answer"].split("####")[-1].strip()}]
        b.add("en", "reasoning", "openai/gsm8k main", "mit", rev, msgs)


def take_magicoder_en(b: Builder):
    rev = b.revision("ise-uiuc/Magicoder-Evol-Instruct-110K")
    ds = load_dataset("ise-uiuc/Magicoder-Evol-Instruct-110K", split="train",
                      streaming=True)
    for r in ds:
        if b.need("en", "code") <= 0:
            return
        msgs = [{"role": "user", "content": r["instruction"]},
                {"role": "assistant", "content": r["response"]}]
        b.add("en", "code", "ise-uiuc/Magicoder-Evol-Instruct-110K", "apache-2.0", rev, msgs)


_HERMES_ROLE = {"system": "system", "human": "user", "user": "user",
                "gpt": "assistant", "assistant": "assistant", "tool": "tool",
                "chatbot": "assistant"}


def take_hermes_en(b: Builder):
    rev = b.revision("NousResearch/hermes-function-calling-v1")
    for fname in ("func-calling.json", "func-calling-singleturn.json"):
        if b.need("en", "toolcall") <= 0:
            return
        path = hf_hub_download("NousResearch/hermes-function-calling-v1", fname,
                               repo_type="dataset")
        for r in json.load(open(path)):
            if b.need("en", "toolcall") <= 0:
                return
            src = r.get("messages") or r.get("conversations") or []
            msgs = [{"role": _HERMES_ROLE.get(m.get("from") or m.get("role"), "user"),
                     "content": m.get("value") or m.get("content") or ""}
                    for m in src]
            b.add("en", "toolcall", f"NousResearch/hermes-function-calling-v1:{fname}",
                  "apache-2.0", rev, msgs)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    b = Builder()

    for lang in ("it", "es", "fr", "zh", "en"):
        take_aya_rows(b, lang, "reasoning", "translated_flan_cot", "CohereForAI/aya_collection")
    for lang in ("it", "es", "fr", "zh", "en"):
        take_aya_rows(b, lang, "chat", "data", "CohereForAI/aya_dataset")
    for lang in ("it", "es", "fr", "zh"):
        take_aya_rows(b, lang, "chat", "translated_dolly", "CohereForAI/aya_collection")
    take_hermes_en(b)
    take_gsm8k_en(b)
    take_magicoder_en(b)

    b.rng.shuffle(b.rows)
    out_jsonl = OUT_DIR / "kalsa-reap-calib.jsonl"
    with open(out_jsonl, "w", encoding="utf-8") as f:
        for r in b.rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    per_lang: dict = {}
    per_cat: dict = {}
    for r in b.rows:
        per_lang[r["language"]] = per_lang.get(r["language"], 0) + 1
        per_cat[r["category"]] = per_cat.get(r["category"], 0) + 1
    total = len(b.rows)
    report = {
        "total": total, "per_language": per_lang, "per_category": per_cat,
        "quota_matrix": {f"{k[0]}/{k[1]}": v for k, v in QUOTA.items()},
        "filled_matrix": b.counts, "skips": b.skips, "seed": SEED,
        "unfilled": {k: v for k, v in b.counts.items()
                     if v < QUOTA.get((k.split("/")[0], k.split("/")[1]), 0)},
    }
    (OUT_DIR / "counts.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))

    it_share = per_lang.get("it", 0) / total
    ok = (total >= 1024 and it_share >= 0.28
          and all(per_lang.get(l, 0) / total >= 0.12
                  for l in ("en", "es", "fr", "zh")))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if not ok:
        print("FAIL: quota guards (total>=1024, IT>=28%, others>=12%)", file=sys.stderr)
        return 1
    print(f"OK: {total} rows -> {out_jsonl}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
