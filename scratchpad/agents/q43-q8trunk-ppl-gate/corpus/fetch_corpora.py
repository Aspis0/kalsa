#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_corpora.py — q43 multilingual perplexity-gate corpora builder.

Builds four single-language Wikipedia plain-text corpora (it, es, fr, zh) for the
pre-registered q43 Q8_0-trunk perplexity gate (see ../PREREG.md, "Corpora", item 2).

For each language:
  * fetches the plain-text extract of a fixed list of substantial, diverse-topic
    articles via the MediaWiki action API (prop=extracts&explaintext=1),
  * cleans the text (no HTML tags, no CRLF, no BOM, collapsed blank runs),
  * concatenates articles in list order with one blank line between them,
  * writes <lang>.txt (UTF-8, LF only) and verifies >= MIN_BYTES,
  * prints per-article byte sizes and a head/tail sanity check,
  * appends byte size + sha256 + ordered article list to MANIFEST.md.

Re-runnable: MANIFEST.md is rewritten from scratch on every run.
Politeness: strictly sequential requests, descriptive User-Agent, sleep between hits.

Run: python fetch_corpora.py
Requires network access. No third-party dependencies (urllib only).
"""

import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Windows consoles default to cp1252; force UTF-8 so sanity head/tail prints never crash.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MIN_BYTES = 400_000          # hard floor per language (task target: 400-500 KB)
SLEEP_SECONDS = 1.5          # politeness delay between API hits
MAX_RETRIES = 6              # retries on HTTP 429/5xx with exponential backoff
API_URL = "https://{lang}.wikipedia.org/w/api.php"
USER_AGENT = (
    "q43-q8trunk-ppl-gate-corpus-builder/1.0 "
    "(local offline-perplexity research corpus; Python urllib; contact: repo owner)"
)

# ---------------------------------------------------------------------------
# Article lists — fixed order = concatenation order recorded in MANIFEST.md.
# Diverse topics: science, history, geography, arts, technology.
# No article repeats within or across languages (different wikis, distinct topics).
#
# PROBE_CANDIDATES: superset used with --probe to measure plain-text byte sizes
# before freezing the final ARTICLES lists (target 400-500 KB total per language,
# >= 10 articles). Final lists are chosen from probed sizes.
# ---------------------------------------------------------------------------
PROBE_CANDIDATES = {
    "it": [
        "Italia", "Roma", "Dante Alighieri", "Leonardo da Vinci",
        "Lingua italiana", "Alpi", "Mar Mediterraneo", "Impero romano",
        "Firenze", "Galileo Galilei", "Colosseo", "Vesuvio",
        "Risorgimento", "Enrico Fermi", "Giulio Cesare", "Cucina italiana",
        "Po (fiume)", "Unione europea",
    ],
    "es": [
        "España", "Historia de España", "Idioma español", "Madrid",
        "Miguel de Cervantes", "Imperio español", "Cordillera de los Andes",
        "Civilización maya", "Sistema Solar", "Barcelona", "Amazonas",
        "Guerra civil española", "Diego Velázquez", "Francisco de Goya",
        "Relatividad general", "Evolución biológica", "Reconquista",
        "Física", "Ciudad de México",
    ],
    "fr": [
        "France", "Histoire de France", "Langue française", "Paris",
        "Napoléon Ier", "Révolution française", "Victor Hugo",
        "Système solaire", "Mont Blanc", "Impressionnisme", "Louis XIV",
        "Seconde Guerre mondiale", "Tour Eiffel", "Marie Curie",
        "Guerre de Cent Ans", "Loire", "Théorie de l'évolution",
        "Cathédrale Notre-Dame de Paris", "Alpes",
    ],
    "zh": [
        "中国历史", "汉语", "长江", "黄河", "唐朝", "宋朝",
        "孔子", "丝绸之路", "太阳系", "珠穆朗玛峰", "秦始皇",
        "故宫", "京剧", "相对论", "进化论", "四大发明",
        "明朝", "清朝", "唐诗",
    ],
}

# Third probe batch: more mid/small filler candidates for es/fr.
EXTRA_PROBE2 = {
    "es": [
        "Península ibérica", "Océano Atlántico", "Alhambra",
        "Camino de Santiago", "Felipe II de España",
        "Telescopio espacial Hubble", "Lope de Vega", "Química",
    ],
    "fr": [
        "Seine", "Gustave Eiffel", "Voltaire", "Bordeaux",
        "Cuisine française", "Métro de Paris",
    ],
}

# Fourth probe batch: FR-only fillers.
EXTRA_PROBE3 = {
    "fr": [
        "TGV", "Pont du Gard", "Avignon", "Canal du Midi",
        "Strasbourg", "Louis Pasteur",
    ],
}

# ---------------------------------------------------------------------------
# Article lists — FIXED FINAL ORDER = concatenation order in MANIFEST.md.
# Diverse topics: science, history, geography, arts, technology.
# No article repeats within or across languages (different wikis, distinct topics).
# Sizes probed via --probe modes so each language lands in the 400-500 KB target
# with >= 10 articles.
# ---------------------------------------------------------------------------
ARTICLES = {
    "it": [
        "Impero romano",
        "Colosseo",
        "Vesuvio",
        "Etna",
        "Alpi",
        "Mar Mediterraneo",
        "Lingua italiana",
        "Cucina italiana",
        "Alessandro Volta",
        "Guglielmo Marconi",
        "Enrico Fermi",
    ],
    "es": [
        "Península ibérica",
        "Océano Atlántico",
        "Cordillera de los Andes",
        "Alhambra",
        "Idioma español",
        "Miguel de Cervantes",
        "Gabriel García Márquez",
        "Sistema Solar",
        "Física",
        "Química",
        "Isaac Newton",
        "Telescopio espacial Hubble",
    ],
    "fr": [
        "Pont du Gard",
        "Alpes",
        "Loire",
        "Seine",
        "Impressionnisme",
        "Cuisine française",
        "Antoine Lavoisier",
        "Marie Curie",
        "Gustave Eiffel",
        "TGV",
    ],
    "zh": [
        "汉语",
        "长江",
        "黄河",
        "唐朝",
        "孔子",
        "丝绸之路",
        "太阳系",
        "相对论",
        "四大发明",
        "故宫",
        "京剧",
    ],
}

# Second probe batch: mid/small filler candidates so each language can reach
# >= 10 articles while staying inside the 400-500 KB target.
EXTRA_PROBE = {
    "it": [
        "Alessandro Volta", "Guglielmo Marconi", "Milano", "Napoli",
        "Etna", "Sandro Botticelli",
    ],
    "es": [
        "Antoni Gaudí", "Sevilla", "Isaac Newton", "Inteligencia artificial",
        "Gabriel García Márquez", "Andalucía",
    ],
    "fr": [
        "Claude Monet", "Molière", "Lyon", "Intelligence artificielle",
        "Antoine Lavoisier", "Château de Versailles",
    ],
    "zh": [
        "李白", "红楼梦", "上海市", "大熊猫", "人工智能", "郑和",
    ],
}


def fetch_extract(lang: str, title: str) -> str | None:
    """Return the full plain-text extract for one article, or None if missing."""
    params = {
        "action": "query",
        "prop": "extracts",
        "explaintext": "1",
        "redirects": "1",
        "format": "json",
        "formatversion": "2",
        "titles": title,
    }
    url = API_URL.format(lang=lang) + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 429 or exc.code >= 500:
                retry_after = exc.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else min(2 ** attempt * 2, 60)
                print(f"    HTTP {exc.code}, backing off {wait:.0f}s ...", flush=True)
                time.sleep(wait)
            else:
                raise
    else:
        raise RuntimeError(f"gave up after {MAX_RETRIES} retries: {title}")
    pages = data.get("query", {}).get("pages", [])
    if not pages or "missing" in pages[0]:
        return None
    return pages[0].get("extract", "")


def clean_text(text: str) -> str:
    """Normalize to clean plain text: LF-only, no tags/BOM, collapsed blanks."""
    text = text.replace("\ufeff", "")            # BOM
    text = text.replace("\r\n", "\n").replace("\r", "\n")  # LF only
    text = re.sub(r"<[^>]+>", "", text)          # stray HTML tags
    text = re.sub(r"\[\d{1,2}\]", "", text)      # reference brackets like [1]
    text = re.sub(r"\n{3,}", "\n\n", text)       # collapse blank-line runs
    return text.strip()


def sha256_of(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def build_language(lang: str, titles: list[str]) -> tuple[bytes, list[dict]]:
    parts: list[str] = []
    records: list[dict] = []
    for title in titles:
        raw = fetch_extract(lang, title)
        if raw is None:
            print(f"  !! MISSING/REDIRECT-UNRESOLVED: {title} — SKIPPED", flush=True)
            continue
        cleaned = clean_text(raw)
        encoded = (cleaned + "\n").encode("utf-8")
        parts.append(cleaned)
        records.append({"title": title, "bytes": len(encoded)})
        print(f"  {title}: {len(encoded):>9,} bytes", flush=True)
        time.sleep(SLEEP_SECONDS)
    body = "\n\n".join(parts).encode("utf-8") + b"\n"   # blank line between articles
    return body, records


def sanity_check(lang: str, body: bytes) -> bool:
    ok = True
    if b"\r" in body:
        print(f"  [{lang}] ERROR: CR byte found (CRLF contamination)", flush=True)
        ok = False
    if body.startswith(b"\xef\xbb\xbf"):
        print(f"  [{lang}] ERROR: UTF-8 BOM found", flush=True)
        ok = False
    try:
        body.decode("utf-8")
    except UnicodeDecodeError as exc:
        print(f"  [{lang}] ERROR: not valid UTF-8: {exc}", flush=True)
        ok = False
    if len(body) < MIN_BYTES:
        print(
            f"  [{lang}] ERROR: {len(body):,} bytes < required {MIN_BYTES:,} "
            f"(short by {MIN_BYTES - len(body):,})",
            flush=True,
        )
        ok = False
    head = body[:200].decode("utf-8", errors="replace").replace("\n", "\\n")
    tail = body[-200:].decode("utf-8", errors="replace").replace("\n", "\\n")
    print(f"  [{lang}] HEAD 200: {head}", flush=True)
    print(f"  [{lang}] TAIL 200: {tail}", flush=True)
    return ok


def probe(extra_only: int = 0) -> int:
    """Measure plain-text byte size of every candidate; write nothing."""
    print("PROBE mode — measuring candidate article sizes", flush=True)
    result: dict[str, dict[str, int]] = {}
    sources: dict[str, list[str]]
    if extra_only == 3:
        sources = EXTRA_PROBE3
    elif extra_only == 2:
        sources = EXTRA_PROBE2
    elif extra_only:
        sources = EXTRA_PROBE
    else:
        sources = PROBE_CANDIDATES
    for lang, titles in sources.items():
        print(f"\n=== {lang} candidates ===", flush=True)
        sizes: dict[str, int] = {}
        for title in titles:
            raw = fetch_extract(lang, title)
            if raw is None:
                print(f"  {title}: MISSING", flush=True)
                sizes[title] = -1
                continue
            n = len(clean_text(raw).encode("utf-8"))
            sizes[title] = n
            print(f"  {title}: {n:,}", flush=True)
            time.sleep(SLEEP_SECONDS)
        result[lang] = sizes
    print("\nPROBE_JSON:")
    print(json.dumps(result, ensure_ascii=False))
    return 0


def main() -> int:
    if "--probe" in sys.argv:
        return probe()
    if "--probe-extra" in sys.argv:
        return probe(extra_only=1)
    if "--probe-extra2" in sys.argv:
        return probe(extra_only=2)
    if "--probe-extra3" in sys.argv:
        return probe(extra_only=3)
    out_dir = Path(__file__).resolve().parent
    manifest_lines = [
        "# MANIFEST — q43 multilingual PPL-gate corpora",
        "",
        "Frozen at build time, BEFORE any PPL run (PREREG.md, Corpora item 2).",
        "Format: UTF-8 plain text, LF line endings only, no BOM.",
        "Source: MediaWiki action API, prop=extracts&explaintext=1&format=json&redirects=1.",
        "Articles concatenated in listed order, blank line between articles.",
        f"sha256 computed with Python hashlib. Minimum size enforced: {MIN_BYTES:,} bytes.",
        "",
    ]
    all_ok = True
    summary: dict[str, dict] = {}

    for lang, titles in ARTICLES.items():
        print(f"\n=== {lang}.txt ===", flush=True)
        body, records = build_language(lang, titles)
        ok = sanity_check(lang, body)
        all_ok = all_ok and ok
        digest = sha256_of(body)
        target = out_dir / f"{lang}.txt"
        with open(target, "wb") as fh:
            fh.write(body)
        print(f"  wrote {target.name}: {len(body):,} bytes  sha256={digest}", flush=True)
        summary[lang] = {
            "file": f"{lang}.txt",
            "bytes": len(body),
            "sha256": digest,
            "n_articles": len(records),
            "articles": [r["title"] for r in records],
        }
        manifest_lines += [
            f"## {lang}.txt",
            "",
            f"- Byte size: **{len(body):,}**",
            f"- sha256: `{digest}`",
            f"- Articles ({len(records)}), in order of concatenation:",
            "",
        ]
        manifest_lines += [f"{i+1}. {r['title']} — {r['bytes']:,} B" for i, r in enumerate(records)]
        manifest_lines.append("")

    manifest_lines += [
        "---",
        "",
        "## Build notes / anomalies",
        "",
    ]
    anomalies = [
        f"{lang}: {len(summary[lang]['articles'])} of {len(ARTICLES[lang])} requested "
        f"articles fetched"
        for lang in ARTICLES
        if len(summary.get(lang, {}).get("articles", [])) != len(ARTICLES[lang])
    ]
    manifest_lines += (["- " + a for a in anomalies] if anomalies else ["- None."]) + [""]

    with open(out_dir / "MANIFEST.md", "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(manifest_lines))

    print("\nSummary:", flush=True)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if not all_ok:
        print("\nRESULT: FAILED size/format checks — extend article lists and re-run.", flush=True)
        return 1
    print("\nRESULT: OK — all corpora >= minimum size, LF-only, valid UTF-8, no BOM.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
