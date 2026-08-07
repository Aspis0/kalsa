#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, re, sys, urllib.request
from pathlib import Path

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def strip_gutenberg(text: str) -> str:
    start = re.search(r"\*\*\* START OF", text)
    end = re.search(r"\*\*\* END OF", text)
    if start and end:
        return text[start.end():end.start()]
    return text

SOURCES = [
    {"id": "divina_commedia", "kind": "prose", "url": "https://www.gutenberg.org/files/1012/1012-0.txt"},
    {"id": "promessi_sposi", "kind": "prose", "url": "https://www.gutenberg.org/files/45334/45334-0.txt"},
    {"id": "conversational_seed", "kind": "conversational", "local": "quality/corpus_it/seed_conversational_it.txt"},
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("quality/corpus_it"))
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--max-chars-prose", type=int, default=200000)
    ap.add_argument("--max-chars-conv", type=int, default=80000)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {"sources": [], "files": {}, "note": "Token counts MUST use model tokenizer, not wc. Night target 50-100k tokens if 500k too slow."}
    prose_parts, conv_parts = [], []
    for src in SOURCES:
        entry = dict(src)
        if src.get("local"):
            lp = Path(src["local"])
            text = lp.read_text(encoding="utf-8", errors="replace")
            entry["sha256"] = sha256_file(lp); entry["bytes"] = lp.stat().st_size
            conv_parts.append(text); manifest["sources"].append(entry); continue
        if not args.download:
            entry["status"] = "skipped_no_download"; manifest["sources"].append(entry); continue
        dest = args.out / (src["id"] + ".txt")
        try:
            print("fetch", src["url"]); urllib.request.urlretrieve(src["url"], dest)
            entry["sha256"] = sha256_file(dest); entry["bytes"] = dest.stat().st_size; entry["status"] = "ok"
            text = strip_gutenberg(dest.read_text(encoding="utf-8", errors="replace"))
            prose_parts.append(text)
        except Exception as e:
            entry["status"] = "error"; entry["error"] = str(e)
        manifest["sources"].append(entry)
    sep = chr(10) + chr(10)
    prose = sep.join(prose_parts)[:args.max_chars_prose]
    conv = sep.join(conv_parts)[:args.max_chars_conv]
    mixed = prose + sep + "===== CONV =====" + sep + conv
    for name, body in (("prose_it.txt", prose), ("conversational_it.txt", conv), ("mixed_it.txt", mixed)):
        fp = args.out / name; fp.write_text(body, encoding="utf-8")
        manifest["files"][name] = {"sha256": sha256_file(fp), "bytes": fp.stat().st_size}
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    main()
