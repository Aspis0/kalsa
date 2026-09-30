#!/usr/bin/env python3
"""Build the Kalsa REAP calibration mix (>=2M tokens, IT ~30%, both modes).

Output (outside git, under ~/kalsa-models/reap-calib/):
  kalsa-reap-calib.jsonl  rows {messages, language, category, mode, source, ...}
  counts.json             per-language / per-category matrix actually filled

Owner decisions + 2026-09-30 review fixes embodied here:
  thinking AND non-thinking rows (GSM8K train: every other row carries its
  full solution inside a think block — real reasoning content, not an empty
  tag), full GSM8K solutions instead of bare numbers, seed-shuffled Aya
  sampling, some multi-turn (glaive-function-calling-5k dialogues with >=2
  user turns; EN-only, like all tool data — recorded, not hidden), IT ~30%
  of >=2M tokens.

Sources are licensed per calib/SOURCES.md. Disjointness from corpus/multi5:
no calibration row may contain any 80-char normalized window of the multi5
slices (checked here); containment vs the eval text-holdout is checked after
the build by eval/check_holdout_disjoint.py.
"""

import argparse
import hashlib
import json
import pathlib
import random
import re
import sys

import sources

OUT_DIR = pathlib.Path.home() / "kalsa-models/reap-calib"
MULTI5_DIR = pathlib.Path.home() / "Projects/kalsa-moe-experiments/corpus/multi5"

# rows per (language, category). code/toolcall/multiturn are EN-only (the
# licensed sources are); IT is deliberately heavy (~30% of tokens). A first
# build at 5.4k rows measured 237 tok/row — these quotas target ~2.4M so the
# 2M guard has margin. Multi-turn + tool rows come from hermes'
# glaive-function-calling-5k.json (4.5k dialogues with >=2 user turns); the
# eval tools holdout uses func-calling.json — a different generator.
QUOTA = {
    ("it", "chat"): 2400, ("it", "reasoning"): 1000,
    ("en", "chat"): 300, ("en", "reasoning"): 350, ("en", "code"): 300,
    ("en", "toolcall"): 300, ("en", "multiturn"): 120,
    ("es", "chat"): 1400, ("es", "reasoning"): 550,
    ("fr", "chat"): 1400, ("fr", "reasoning"): 550,
    ("zh", "chat"): 1400, ("zh", "reasoning"): 550,
}
SEED = 42
WINDOW = 80
THINK_ROWS = 175          # of the 350 EN reasoning rows
MIN_TOKENS = 2_000_000
MIN_CHARS_FALLBACK = 6_500_000   # ~2M tokens at a conservative 3.1 chars/tok
GUARDS = {"it": (0.27, 0.45), "en": (0.10, 1.0), "es": (0.08, 1.0),
          "fr": (0.08, 1.0), "zh": (0.08, 1.0)}


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
        self.modes: dict = {}
        self.skips: dict = {}
        self.total_chars = 0
        self.seen_hashes: set[str] = set()
        self.banned = load_multi5_windows()
        self.rng = random.Random(SEED)

    def add(self, lang, category, source, license_name, revision, messages,
            mode=None):
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
        self.total_chars += len(text)
        self.counts[f"{lang}/{category}"] = self.counts.get(f"{lang}/{category}", 0) + 1
        if mode:
            self.modes[mode] = self.modes.get(mode, 0) + 1
        self.rows.append({
            "id": f"kalsa-calib-{len(self.rows):05d}",
            "language": lang, "category": category, "mode": mode,
            "source": source, "license": license_name, "source_revision": revision,
            "messages": messages,
        })
        return True

    def _bump(self, why):
        self.skips[why] = self.skips.get(why, 0) + 1

    def need(self, lang, category):
        return QUOTA.get((lang, category), 0) - self.counts.get(f"{lang}/{category}", 0)


def take_aya(b: Builder, lang, category, config, repo, sample=4000):
    if b.need(lang, category) <= 0:
        return
    for inputs, targets in sources.aya_pairs(repo, config, lang, sample):
        if b.need(lang, category) <= 0:
            return
        b.add(lang, category, f"{repo}:{config}", sources.aya_licence(config),
              sources.REVISIONS[repo],
              [{"role": "user", "content": inputs},
               {"role": "assistant", "content": targets}])


def take_gsm8k(b: Builder):
    """EN reasoning: full solutions; every other row thinking-mode with the
    solution as real think content (review: no empty think blocks)."""
    rev = sources.REVISIONS["openai/gsm8k"]
    made_think = 0
    for r in sources.gsm8k_rows():
        if b.need("en", "reasoning") <= 0:
            return
        if made_think < THINK_ROWS:
            mode, content = "thinking", f"<think>\n{r['solution']}\n</think>\n{r['final']}"
            made_think += 1
        else:
            mode, content = "non-thinking", r["full"]
        b.add("en", "reasoning", "openai/gsm8k main (train)", "mit", rev,
              [{"role": "user", "content": r["question"]},
               {"role": "assistant", "content": content}], mode=mode)


def take_mbpp(b: Builder):
    rev = sources.REVISIONS["google-research-datasets/mbpp"]
    for r in sources.mbpp_rows():
        if b.need("en", "code") <= 0:
            return
        b.add("en", "code", f"google-research-datasets/mbpp {r['config']}",
              "cc-by-4.0", rev,
              [{"role": "user", "content": r["prompt"]},
               {"role": "assistant", "content": r["code"]}])


GLAIVE_FILE = "glaive-function-calling-5k.json"
HERMES_LICENCE = "apache-2.0"


def take_glaive_multiturn(b: Builder):
    """EN multi-turn: glaive dialogues with >=2 user turns, filled FIRST so
    the single-turn take cannot swallow them all (dedupe drops repeats)."""
    for r in sources.hermes_rows(GLAIVE_FILE):
        if b.need("en", "multiturn") <= 0:
            return
        if r["n_user_turns"] < 2:
            continue
        b.add("en", "multiturn",
              f"NousResearch/hermes-function-calling-v1:{GLAIVE_FILE}",
              HERMES_LICENCE,
              sources.REVISIONS["NousResearch/hermes-function-calling-v1"],
              r["messages"])


def take_glaive_toolcall(b: Builder):
    for r in sources.hermes_rows(GLAIVE_FILE):
        if b.need("en", "toolcall") <= 0:
            return
        b.add("en", "toolcall",
              f"NousResearch/hermes-function-calling-v1:{GLAIVE_FILE}",
              HERMES_LICENCE,
              sources.REVISIONS["NousResearch/hermes-function-calling-v1"],
              r["messages"])


def count_tokens(rows, tokenizer_dir):
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(tokenizer_dir)
    per_lang = {}
    for r in rows:
        n = len(tok(" ".join(m["content"] for m in r["messages"]),
                    add_special_tokens=False)["input_ids"])
        per_lang[r["language"]] = per_lang.get(r["language"], 0) + n
    return per_lang


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokenizer", default=str(OUT_DIR / "qwen36-meta"),
                    help="tokenizer dir for the exact token guard (skippable)")
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    b = Builder()

    # flan_cot reasoning covers the four non-EN languages; EN reasoning is
    # GSM8K's (full solutions, thinking + non-thinking modes) — if flan_cot
    # filled EN first, the quota would leave no room for the thinking rows
    for lang in ("it", "es", "fr", "zh"):
        take_aya(b, lang, "reasoning", "translated_flan_cot", "CohereForAI/aya_collection")
    for lang in ("it", "es", "fr", "zh", "en"):
        take_aya(b, lang, "chat", "data", "CohereForAI/aya_dataset")
    for lang in ("it", "es", "fr", "zh", "en"):
        take_aya(b, lang, "chat", "translated_dolly", "CohereForAI/aya_collection")
    take_glaive_multiturn(b)
    take_glaive_toolcall(b)
    take_gsm8k(b)
    take_mbpp(b)

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
    tok_lang = count_tokens(b.rows, a.tokenizer) if pathlib.Path(a.tokenizer).exists() else None
    tok_total = sum(tok_lang.values()) if tok_lang else 0
    report = {
        "total": total, "per_language": per_lang, "per_category": per_cat,
        "modes": b.modes,
        "tokens_per_language": tok_lang, "tokens_total": tok_total,
        "quota_matrix": {f"{k[0]}/{k[1]}": v for k, v in QUOTA.items()},
        "filled_matrix": b.counts, "skips": b.skips, "seed": SEED,
        "unfilled": {k: v for k, v in b.counts.items()
                     if v < QUOTA.get((k.split("/")[0], k.split("/")[1]), 0)},
    }
    (OUT_DIR / "counts.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps(report, indent=2, ensure_ascii=False))

    unit = tok_lang if tok_lang else per_lang
    unit_total = tok_total if tok_lang else total
    shares = {l: n / unit_total for l, n in unit.items()}
    lo, hi = GUARDS["it"]
    ok = ((tok_total >= MIN_TOKENS if tok_lang else b.total_chars >= MIN_CHARS_FALLBACK)
        and lo <= shares.get("it", 0) <= hi
        and all(shares.get(l, 0) >= GUARDS[l][0] for l in ("en", "es", "fr", "zh"))
        and b.modes.get("thinking", 0) >= 150
        and b.counts.get("en/multiturn", 0) >= 100)
    if not ok:
        print("FAIL: guards (tokens/chars, IT share, thinking rows, multiturn)",
              file=sys.stderr)
        return 1
    print(f"OK: {total} rows, {tok_total} tokens -> {out_jsonl}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
