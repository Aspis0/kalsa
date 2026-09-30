#!/usr/bin/env python3
"""Build the gate's held-out text corpus: eval/text-holdout/<lang>.txt.

Per language (en, it, es, fr, zh) two Project Gutenberg books, public-domain
works (PG's Terms of Use apply to the site; boilerplate header/footer are
stripped), >= MIN_BYTES of prose each after the strip — non-Wikipedia, so no
slice of the gate rests on one encyclopedia article (the old multi5 IT slice
was literally the article on coffee). Books are hardcoded below and verified
live; the builder fails rather than shipping a short or wrong-language file.

Usage: build_text_holdout.py [out_dir=eval/text-holdout]
"""

import hashlib
import json
import pathlib
import re
import sys
import urllib.request

MIN_BYTES = 600_000
START_RE = re.compile(r"\*{3} ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\n", re.I)
END_RE = re.compile(r"\*{3} ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*", re.I | re.S)

# (gutenberg id, title, author) — ids probed live 2026-09-30 at
# gutenberg.org/files/<id>/<id>-0.txt (or /cache/epub/<id>/pg<id>.txt)
BOOKS = {
    "en": [(1342, "Pride and Prejudice", "Jane Austen"),
           (2701, "Moby Dick", "Herman Melville")],
    "it": [(45334, "I promessi sposi", "Alessandro Manzoni"),
           (52484, "Le avventure di Pinocchio", "Carlo Collodi")],
    "es": [(2000, "Don Quijote", "Miguel de Cervantes Saavedra"),
           (17013, "Fortunata y Jacinta", "Benito Pérez Galdós")],
    "fr": [(798, "Le rouge et le noir", "Stendhal"),
           (14155, "Madame Bovary", "Gustave Flaubert")],
    # ZH books are in traditional characters (PG's Chinese holdings); recorded
    # here because the calibration ZH is simplified
    "zh": [(24264, "紅樓夢 (A Dream of Red Mansions)", "Cao Xueqin"),
           (4580, "粉妝樓", "Luo Guanzhong (attrib.)")],
}
# enough hits of common words per 1000 chars to catch a wrong-book accident
STOPWORDS = {"en": ["the", "and", "of"], "it": ["che", "di", "la"],
             "es": ["que", "de", "la"], "fr": ["les", "de", "il"],
             "zh": None}


def fetch_book(gid: int) -> str:
    for url in (f"https://www.gutenberg.org/files/{gid}/{gid}-0.txt",
                f"https://gutenberg.org/cache/epub/{gid}/pg{gid}.txt"):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"  pg{gid}: {url} failed ({e})")
    sys.exit(f"build_text_holdout: pg{gid} unreachable at both URL shapes")


def strip_pg(text: str) -> str:
    m = START_RE.search(text)
    start = m.end() if m else 0
    m2 = END_RE.search(text, start)
    return text[start:m2.start()] if m2 else text[start:]


def sanity(lang: str, text: str) -> None:
    if lang == "zh":
        cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
        assert cjk / max(1, len(text)) > 0.2, f"zh: only {cjk / len(text):.0%} CJK"
        return
    words = re.findall(r"[a-zà-ÿ']+", text.lower())
    hits = sum(1 for w in words if w in STOPWORDS[lang])
    per_k = 1000.0 * hits / max(1, len(text))
    # real prose measures ~15-25; a wrong-language book lands near 0-3
    assert per_k > 12, f"{lang}: only {per_k:.0f} stopword hits/kchar"
    print(f"  sanity {lang}: {per_k:.0f} stopword hits/kchar")


def main() -> int:
    out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                           else pathlib.Path(__file__).parent / "text-holdout")
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"licence": "public-domain works; Project Gutenberg eBook "
                           "boilerplate stripped; gate corpus, hold-out",
                "built": "2026-09-30", "books": {}}
    for lang, books in BOOKS.items():
        pieces, provenance = [], []
        for gid, title, author in books:
            if sum(len(p) for p in pieces) >= MIN_BYTES:
                break
            print(f"{lang}: fetching pg{gid} {title}")
            body = strip_pg(fetch_book(gid))
            pieces.append(body)
            provenance.append({"gutenberg_id": gid, "title": title,
                               "author": author, "stripped_bytes": len(body.encode())})
        text = "\n".join(pieces).encode("utf-8")
        assert len(text) >= MIN_BYTES, f"{lang}: {len(text)} < {MIN_BYTES} bytes"
        sanity(lang, text.decode("utf-8"))
        path = out_dir / f"{lang}.txt"
        path.write_bytes(text)
        manifest["books"][lang] = {
            "bytes": len(text), "sha256": hashlib.sha256(text).hexdigest(),
            "sources": provenance}
        print(f"== {lang}: {len(text)} bytes -> {path}")
    (out_dir / "MANIFEST.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
