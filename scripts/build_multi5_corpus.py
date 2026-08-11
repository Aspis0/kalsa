#!/usr/bin/env python3
"""Build corpus/multi5/{en,es,fr,it,zh}.txt — 40-60 KB natural prose, UTF-8 LF."""
from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "corpus" / "multi5"
OUT.mkdir(parents=True, exist_ok=True)

# Wikipedia titles (URL-encoded where needed). Free content, natural prose.
PAGES = {
    "en": [
        "Coffee",
        "Photosynthesis",
        "Silk_Road",
        "Mediterranean_Sea",
        "Beekeeping",
        "Olive_oil",
        "Printing_press",
        "Coral_reef",
        "Astronomy",
        "Paper",
    ],
    "es": [
        "Caf%C3%A9",
        "Fotos%C3%ADntesis",
        "Ruta_de_la_seda",
        "Mar_Mediterr%C3%A1neo",
        "Apicultura",
        "Aceite_de_oliva",
        "Imprenta",
        "Arrecife_de_coral",
        "Astronom%C3%ADa",
        "Papel",
    ],
    "fr": [
        "Caf%C3%A9",
        "Photosynth%C3%A8se",
        "Route_de_la_soie",
        "Mer_M%C3%A9diterran%C3%A9e",
        "Apiculture",
        "Huile_d%27olive",
        "Imprimerie",
        "R%C3%A9cif_corallien",
        "Astronomie",
        "Papier",
    ],
    "zh": [
        "%E5%92%96%E5%95%A1",
        "%E5%85%89%E5%90%88%E4%BD%9C%E7%94%A8",
        "%E4%B8%9D%E7%BB%B8%E4%B9%8B%E8%B7%AF",
        "%E5%9C%B0%E4%B8%AD%E6%B5%B7",
        "%E5%85%BB%E8%9C%82",
        "%E6%A9%84%E6%A6%84%E6%B2%B9",
        "%E5%8D%B0%E5%88%B7%E6%9C%AF",
        "%E7%8F%8A%E7%91%9A%E7%A4%81",
        "%E5%A4%A9%E6%96%87%E5%AD%A6",
        "%E7%BA%B8",
    ],
}


def wiki_extract(lang: str, title: str) -> tuple[str, str]:
    url = (
        f"https://{lang}.wikipedia.org/w/api.php"
        f"?action=query&prop=extracts&explaintext=1&exsectionformat=plain"
        f"&redirects=1&format=json&titles={title}"
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "moe-experiments-corpus/1.0 (research; local lab)"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    pages = data["query"]["pages"]
    page = next(iter(pages.values()))
    text = page.get("extract") or ""
    real_title = page.get("title", title)
    return real_title, text


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines: list[str] = []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            lines.append("")
            continue
        if re.match(r"^[\*\-•]\s", s):
            continue
        if re.match(r"^\d+\.\s+\S+$", s) and len(s) < 40:
            continue
        lines.append(s)
    paras: list[str] = []
    buf: list[str] = []
    for line in lines:
        if line == "":
            if buf:
                paras.append(" ".join(buf))
                buf = []
        else:
            buf.append(line)
    if buf:
        paras.append(" ".join(buf))
    paras = [p for p in paras if len(p) >= 80]
    return "\n\n".join(paras) + ("\n" if paras else "")


def slice_bytes(text: str, lo: int = 40000, hi: int = 60000) -> tuple[str, int]:
    raw = text.encode("utf-8")
    if len(raw) <= hi and len(raw) >= lo:
        out = text if text.endswith("\n") else text + "\n"
        return out, len(out.encode("utf-8"))
    if len(raw) < lo:
        out = text if text.endswith("\n") else text + "\n"
        return out, len(out.encode("utf-8"))
    parts = text.split("\n\n")
    acc: list[str] = []
    size = 0
    mid = (lo + hi) // 2
    for p in parts:
        b = (p + "\n\n").encode("utf-8")
        if size + len(b) > hi and size >= lo:
            break
        acc.append(p)
        size += len(b)
        if size >= mid:
            break
    out = "\n\n".join(acc).strip() + "\n"
    return out, len(out.encode("utf-8"))


def main() -> None:
    manifest: dict = {
        "slices": {},
        "sources": {},
        "notes": (
            "Natural prose Wikipedia extracts, UTF-8 LF, no code. "
            "IT from historical quality/corpus_it for meter continuity."
        ),
    }

    # --- IT from historical corpus ---
    it_src = ROOT / "quality" / "corpus_it" / "prose_it.txt"
    if not it_src.exists():
        it_src = ROOT / "quality" / "corpus_it" / "mixed_it.txt"
    it_text = it_src.read_text(encoding="utf-8")
    cleaned = clean(it_text)
    it_slice, it_n = slice_bytes(cleaned if len(cleaned.encode("utf-8")) >= 40000 else it_text)
    if it_n < 40000:
        it_slice, it_n = slice_bytes(it_text.replace("\r\n", "\n").replace("\r", "\n"))
    (OUT / "it.txt").write_bytes(it_slice.encode("utf-8"))
    manifest["sources"]["it"] = {
        "file": str(it_src.as_posix()),
        "kind": "historical_corpus_it",
    }
    manifest["slices"]["it"] = {
        "bytes": it_n,
        "sha256": hashlib.sha256(it_slice.encode("utf-8")).hexdigest(),
    }
    print(f"it: {it_n} bytes sha={manifest['slices']['it']['sha256'][:16]}...")

    for lang, titles in PAGES.items():
        chunks: list[str] = []
        used: list[dict] = []
        for t in titles:
            try:
                real, extract = wiki_extract(lang, t)
                if not extract or len(extract) < 200:
                    print(f"  skip {lang}/{t}: short")
                    continue
                c = clean(extract)
                if len(c) < 200:
                    continue
                chunks.append(c.strip())
                used.append({"title": real, "url": f"https://{lang}.wikipedia.org/wiki/{t}"})
                joined = "\n\n".join(chunks) + "\n"
                if len(joined.encode("utf-8")) >= 62000:
                    break
            except Exception as e:  # noqa: BLE001
                print(f"  err {lang}/{t}: {e}")
        full = "\n\n".join(chunks) + "\n"
        sl, n = slice_bytes(full)
        if n < 40000:
            print(f"WARN {lang}: only {n} bytes")
        path = OUT / f"{lang}.txt"
        path.write_bytes(sl.encode("utf-8"))
        h = hashlib.sha256(sl.encode("utf-8")).hexdigest()
        manifest["slices"][lang] = {"bytes": n, "sha256": h}
        manifest["sources"][lang] = used
        print(f"{lang}: {n} bytes sha={h[:16]}... pages={len(used)}")

    (OUT / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lines = []
    for lang in ["en", "es", "fr", "it", "zh"]:
        p = OUT / f"{lang}.txt"
        b = p.read_bytes()
        if b"\r" in b:
            raise SystemExit(f"CR found in {lang}.txt")
        lines.append(f"{hashlib.sha256(b).hexdigest()}  {lang}.txt")
        print(lang, p.stat().st_size)
    (OUT / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("DONE", OUT)


if __name__ == "__main__":
    main()
