#!/usr/bin/env python3
"""Eval-set ban lists for calibration dedup: exact + 13-gram overlap.

Every eval set named in DESIGN.md sections 4/5 becomes a ban set here: FLORES-200
dev AND devtest (local v3 copy), GSM8K test, HumanEval, HumanEval+, MBPP test
(all HF, pinned revisions), the bpb corpus corpus/postcutoff/, and corpus/multi5
(the v1 calibration's containment ban, carried over). Text is normalized to
lowercase alnum tokens (diacritics kept; CJK/kana/hangul split one char per token
so the window works there — Chinese has no spaces to split on). A 13-gram is 13
consecutive tokens joined by a space; a text is HIT if any of its 13-grams appears
in a ban set, or its full normalized text equals a ban item exactly (a ban item
embedded verbatim in a longer text always trips the 13-gram net first).
"""

import json
import pathlib
import re

HOME = pathlib.Path.home()
LAB = HOME / "Projects/kalsa-moe-experiments"
FLORES_DIR = LAB / "scratchpad/agents/moe-expert-usage-v3/raw/corpus/flores"
POSTCUTOFF_DIR = LAB / "corpus/postcutoff"
MULTI5_DIR = LAB / "corpus/multi5"

N_GRAM = 13
# alnum + latin-extended + kana + CJK + hangul; everything >= U+2E80 is one token per char
_TOKEN = re.compile(r"[0-9a-z\u00c0-\u024f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]")

HF_REV = {
    "openai/gsm8k": "740312add88f781978c0658806c59bc2815b9866",
    "openai/openai_humaneval": "7dce6050a7d6d172f3cc5c32aa97f52fa1a2e544",
    "evalplus/humanevalplus": "d32357cf319e50e9c8d8dab5ea876c72b0fd321b",
    "google-research-datasets/mbpp": "4bb6404fdc6cacfda99d4ac4205087b89d32030c",
}
# id-ish / metadata columns that must not enter the ban text
_SKIP_COLS = {"id", "task_id", "dump", "url", "date", "file_path", "language", "license"}


def tokens(text: str) -> list[str]:
    out, cur = [], []
    for ch in text.lower():
        if _TOKEN.fullmatch(ch) is None:
            if cur:
                out.append("".join(cur))
                cur = []
            continue
        if ord(ch) >= 0x2E80:
            if cur:
                out.append("".join(cur))
                cur = []
            out.append(ch)
        else:
            cur.append(ch)
    if cur:
        out.append("".join(cur))
    return out


def norm(text: str) -> str:
    return " ".join(tokens(text))


class BanSets:
    def __init__(self):
        self.names: list[str] = []
        self.gram_sets: dict[str, set[str]] = {}
        self.exact_sets: dict[str, set[str]] = {}
        self.n_items: dict[str, int] = {}

    def add(self, name: str, items) -> None:
        """Add items to a ban set; calling twice with the same name merges (MBPP has
        two configs' test splits under one name)."""
        gs = self.gram_sets.setdefault(name, set())
        ex = self.exact_sets.setdefault(name, set())
        n = self.n_items.get(name, 0)
        for it in items:
            t = tokens(it)
            if len(t) < 2:
                continue
            n += 1
            ex.add(" ".join(t))
            gs.update(" ".join(t[i:i + N_GRAM])
                      for i in range(max(0, len(t) - N_GRAM + 1)))
        if name not in self.names:
            self.names.append(name)
        self.n_items[name] = n

    def hits(self, text: str) -> list[str]:
        """Ban-set names this text overlaps (any 13-gram, or exact normalized equality)."""
        t = tokens(text)
        wins = [" ".join(t[i:i + N_GRAM]) for i in range(len(t) - N_GRAM + 1)]
        exact = " ".join(t)
        found = []
        for name in self.names:
            if exact in self.exact_sets[name] or any(w in self.gram_sets[name] for w in wins):
                found.append(name)
        return found


def _row_text(r: dict) -> str:
    parts = []
    for k, v in r.items():
        if k in _SKIP_COLS:
            continue
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, list):
            parts.extend(str(x) for x in v)
    return " ".join(parts)


def _hf_items(repo: str, config: str | None, split: str):
    from datasets import load_dataset
    ds = load_dataset(repo, config, split=split, streaming=True, revision=HF_REV[repo])
    for r in ds:
        yield _row_text(r)


def _dir_items(d: pathlib.Path, whole_file: bool = False):
    for f in sorted(d.rglob("*")):
        if not f.is_file():
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        if whole_file:
            yield text
        else:
            yield from text.splitlines()


def load_all() -> BanSets:
    """Load every ban set. FLORES = the local v3 copy (dev AND devtest); MBPP = both
    configs' test splits; postcutoff/multi5 = one item per corpus file."""
    bs = BanSets()
    bs.add("flores", _dir_items(FLORES_DIR))
    bs.add("gsm8k_test", _hf_items("openai/gsm8k", "main", "test"))
    bs.add("humaneval", _hf_items("openai/openai_humaneval", None, "test"))
    bs.add("humanevalplus", _hf_items("evalplus/humanevalplus", None, "test"))
    bs.add("mbpp_test", _hf_items("google-research-datasets/mbpp", "full", "test"))
    bs.add("mbpp_test", _hf_items("google-research-datasets/mbpp", "sanitized", "test"))
    bs.add("postcutoff", _dir_items(POSTCUTOFF_DIR, whole_file=True))
    bs.add("multi5", _dir_items(MULTI5_DIR, whole_file=True))
    return bs


if __name__ == "__main__":
    bs = load_all()
    for name in bs.names:
        print(f"{name:14s} items={bs.n_items[name]:6d} grams={len(bs.gram_sets[name]):9d} "
              f"exact={len(bs.exact_sets[name]):6d}")
    print(f"json check: {json.dumps({'ok': True})}")
