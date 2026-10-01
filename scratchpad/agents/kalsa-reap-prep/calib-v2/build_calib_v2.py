#!/usr/bin/env python3
"""Build the calib-v2 mix: seven equal-token domains (~450k tokens each, ~3.15M total).

Output (outside git, under ~/kalsa-models/reap-calib-v2/): one jsonl per domain
(it fr es en zh code math) + counts.json. Rows keep the v1 schema plus a `domain`
field. Existing v1 rows are reused where they fit (IT/FR/ES/ZH whole, EN chat +
multiturn, EN code+toolcall -> code, EN reasoning (GSM8K train) -> math); the
rest is topped up from FineWeb-2 / FineWeb (web), GSM8K train (math), and local
code sources (code). Sources + licences: calib-v2/SOURCES.md.

Every candidate row is screened against the eval-set ban lists (evalsets.py:
exact + 13-gram overlap vs FLORES dev+devtest, GSM8K test, HumanEval(+),
MBPP test, corpus/postcutoff, corpus/multi5) — hits are DROPPED and counted,
so the built files contain zero known eval overlap by construction.

Usage: build_calib_v2.py [--tokenizer DIR]   (exit 1 on guard failure)
"""

import argparse
import hashlib
import json
import pathlib
import random
import sys

import evalsets
import sources_v2

HOME = pathlib.Path.home()
OUT_DIR = HOME / "kalsa-models/reap-calib-v2"
DOMAINS = ("it", "fr", "es", "en", "zh", "code", "math")
TARGET_TOKENS = 450_000
GUARD = (430_000, 470_000)
TOTAL_GUARD = 3_000_000
SEED = 20261001
# code: local sources are the backbone (~2/3 of the domain); the v1 MBPP-train
# and glaive-toolcall rows only top up the rest (they are dialogues ABOUT code)
CODE_SOURCES_TOKENS = 300_000
# FineWeb-2 language subset per non-English domain (cmn_Hani = Mandarin; there
# is no zho_* in fineweb-2 and no English in fineweb-2 at all)
FINWEB_CONFIG = {"it": "ita_Latn", "fr": "fra_Latn", "es": "spa_Latn",
                 "zh": "cmn_Hani", "en": "en"}

# which v1 rows belong to which v2 domain (everything else stays in v1 only)
REUSE = {
    "it": lambda r: r["language"] == "it",
    "fr": lambda r: r["language"] == "fr",
    "es": lambda r: r["language"] == "es",
    "zh": lambda r: r["language"] == "zh",
    "en": lambda r: r["language"] == "en" and r["category"] in ("chat", "multiturn"),
    "code": lambda r: r["language"] == "en" and r["category"] in ("code", "toolcall"),
    "math": lambda r: r["language"] == "en" and r["category"] == "reasoning",
}


class Domain:
    def __init__(self, name, bans, tok, seen_hashes):
        self.name = name
        self.bans = bans
        self.tok = tok
        self.seen = seen_hashes
        self.rows = []
        self.tokens = 0
        self.reused_rows = 0
        self.reused_tokens = 0
        self.by_source: dict[str, int] = {}
        self.skips: dict[str, int] = {}

    def accept(self, text, source, license_name, revision, messages,
               language, category, mode=None):
        ntext = " ".join(evalsets.tokens(text))
        key = hashlib.sha256(ntext[:240].encode()).hexdigest()
        if key in self.seen:
            self.skips["dupe"] = self.skips.get("dupe", 0) + 1
            return False
        hit = self.bans.hits(text)
        if hit:
            for name in hit:
                self.skips[f"ban:{name}"] = self.skips.get(f"ban:{name}", 0) + 1
            return False
        if len(ntext) < 120:
            self.skips["short"] = self.skips.get("short", 0) + 1
            return False
        self.seen.add(key)
        n = len(self.tok(text, add_special_tokens=False)["input_ids"])
        self.tokens += n
        src = source.split(" ")[0].split(":")[0]
        self.by_source[src] = self.by_source.get(src, 0) + n
        self.rows.append({
            "id": f"kalsa-calib-v2-{self.name}-{len(self.rows):05d}",
            "domain": self.name, "language": language, "category": category,
            "mode": mode, "source": source, "license": license_name,
            "source_revision": revision, "messages": messages,
        })
        return True

    def full(self):
        return self.tokens >= TARGET_TOKENS


def fill_web(dom: Domain):
    for text, label in sources_v2.web_docs(FINWEB_CONFIG[dom.name]):
        if dom.full():
            return
        dom.accept(text, label, "odc-by-1.0",
                   sources_v2.FINEWEB2_REV if dom.name != "en" else sources_v2.FINEWEB_REV,
                   [{"role": "user", "content": text}], dom.name, "chat")


def fill_math(dom: Domain):
    for r in sources_v2.gsm8k_train(SEED):
        if dom.full():
            return
        text = " ".join(m["content"] for m in r["messages"])
        dom.accept(text, r["source"], r["license"], r["source_revision"],
                   r["messages"], "en", "reasoning")


def fill_code(dom: Domain, until: int = TARGET_TOKENS):
    commit = sources_v2.engine_commit()
    for text, source in sources_v2.code_chunks():
        if dom.tokens >= until:
            return
        if source.startswith("cpython-stdlib"):
            lic, rev = "psf-2.0", "3.14.6 (homebrew python@3.14)"
        else:
            lic, rev = "mit", commit  # kalsallama engine + its python tools
        dom.accept(text, source, lic, rev,
                   [{"role": "user", "content": text}], "en", "code")


def reuse_v1(dom: Domain, v1_rows) -> None:
    pool = [r for r in v1_rows if REUSE[dom.name](r)]
    random.Random(f"{SEED}|{dom.name}").shuffle(pool)
    start_tokens, start_rows = dom.tokens, len(dom.rows)
    for r in pool:
        if dom.full():
            break
        text = " ".join(m["content"] for m in r["messages"])
        dom.accept(text, r["source"], r["license"], r.get("source_revision"),
                   r["messages"], r["language"], r["category"], r.get("mode"))
    dom.reused_rows = len(dom.rows) - start_rows
    dom.reused_tokens = dom.tokens - start_tokens


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokenizer", default=str(sources_v2.QWEN36_META))
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    print(f"loading eval ban sets (FLORES/GSM8K-test/HumanEval(+)/MBPP-test/"
          f"postcutoff/multi5) ...", flush=True)
    bans = evalsets.load_all()

    v1 = sources_v2.v1_rows()
    seen: set[str] = set()
    report = {"seed": SEED, "target_tokens": TARGET_TOKENS, "domains": {}}
    for name in DOMAINS:
        dom = Domain(name, bans, tok, seen)
        if name == "code":
            fill_code(dom, CODE_SOURCES_TOKENS)
            reuse_v1(dom, v1)
            fill_code(dom)
        else:
            reuse_v1(dom, v1)
            if name == "math":
                fill_math(dom)
            else:
                fill_web(dom)
        with open(OUT_DIR / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for r in dom.rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        report["domains"][name] = {
            "rows": len(dom.rows), "tokens": dom.tokens,
            "reused_v1_rows": dom.reused_rows, "reused_v1_tokens": dom.reused_tokens,
            "by_source_tokens": dom.by_source, "skips": dom.skips,
        }
        print(f"{name}: {len(dom.rows)} rows, {dom.tokens} tokens "
              f"(reused {dom.reused_tokens}), skips={dom.skips}", flush=True)

    report["total_tokens"] = sum(d["tokens"] for d in report["domains"].values())
    (OUT_DIR / "counts.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False))

    bad = [n for n, d in report["domains"].items()
           if not (GUARD[0] <= d["tokens"] <= GUARD[1])]
    if bad or report["total_tokens"] < TOTAL_GUARD:
        print(f"FAIL: token guards — out of range: {bad or 'none'}, "
              f"total {report['total_tokens']} < {TOTAL_GUARD}?", file=sys.stderr)
        return 1
    print(f"OK: {report['total_tokens']} tokens over {len(DOMAINS)} domains "
          f"-> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
