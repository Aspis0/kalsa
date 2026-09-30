#!/usr/bin/env python3
"""Build the gate's post-cutoff corpus from Wikipedia newly created pages.

Each language Wikipedia's recentchanges log (rctype=new, namespace 0) lists
articles created in roughly the last 30 days — by construction after the
July-2026 cutoff the Fable-2 review asked for, and impossible to appear in
any pretrained model's corpus before it existed. One file per document; the
per-language set is the bootstrap unit set for bpb (run_bpb_eval.py).

Selection: wikitext-size floor (skips stubs and most vandalism), prose floor
on the plain-text extract, no truncation beyond MAX_CHARS. Licence: each
Wikipedia is CC-BY-SA-4.0; the MANIFEST records title/pageid/revid/timestamp
per document — that IS the attribution, so the corpus stays licence-clean.

Not byte-reproducible by design: a holdout corpus must be fresh. The
manifest pins what one build took; a later build legitimately differs.

Usage: build_postcutoff_corpus.py [out_dir=corpus/postcutoff]
"""

import hashlib
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

WIKIS = {"en": "en.wikipedia.org", "it": "it.wikipedia.org",
         "es": "es.wikipedia.org", "fr": "fr.wikipedia.org",
         "zh": "zh.wikipedia.org"}
WANT_DOCS = 55          # per language; the gate floor is 50
MIN_WIKITEXT_BYTES = 4000   # pre-filter via rcprop sizes: skips stubs/junk
MIN_CHARS = 2500        # plain-prose floor
MAX_CHARS = 12000
AFTER = "2026-07-01T00:00:00Z"
UA = "kalsa-lab-gate-corpus/1.0 (one-shot eval holdout builder)"


def api(host: str, **params) -> dict:
    params.update(action="query", format="json")
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode(params)
    delay = 30.0
    for attempt in range(4):   # 429s escalate; give the penalty box time
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            retry = e.headers.get("Retry-After")
            time.sleep(float(retry) if retry else delay)
            delay *= 2
    raise RuntimeError("unreachable")


def new_page_candidates(host: str) -> list[dict]:
    """Newly created articles, newest first, from the recentchanges log."""
    out = []
    for chunk in range(4):   # up to 2000 log entries per language
        params = dict(list="recentchanges", rcnamespace=0, rctype="new",
                      rclimit="500", rcshow="!redirect",
                      rcprop="title|timestamp|ids|sizes")
        if chunk:
            params["rccontinue"] = continue_from
        data = api(host, **params)
        out.extend(data["query"]["recentchanges"])
        continue_from = data.get("continue", {}).get("rccontinue")
        if not continue_from:
            break
        time.sleep(1)
    return [rc for rc in out
            if rc["timestamp"] >= AFTER and rc.get("newlen", 0) >= MIN_WIKITEXT_BYTES]


def plain_texts(host: str, pageids: list[int]) -> dict[int, str]:
    """One plain-text extract per request: the TextExtracts API silently
    returns empty strings for all but one page when a batch is requested
    with full (non-intro) extracts — measured 19/20 empty on a 20-page
    batch. Sleep between requests; api() backs off once on 429."""
    out = {}
    for pid in pageids:
        data = api(host, prop="extracts", explaintext=1, exlimit=1, pageids=pid)
        out[pid] = next(iter(data["query"]["pages"].values())).get("extract", "")
        time.sleep(3.0)
    return out


def main() -> int:
    default = pathlib.Path(__file__).resolve().parents[4] / "corpus/postcutoff"
    out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else default)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"built": time.strftime("%Y-%m-%d"), "after": AFTER,
                "license": "cc-by-sa-4.0 (per Wikipedia; attribution via "
                           "title/pageid/revid recorded per document)",
                "languages": {}}
    for lang, host in WIKIS.items():
        (out_dir / lang).mkdir(exist_ok=True)
        docs, seen = [], set()
        candidates = [rc for rc in new_page_candidates(host)
                      if rc["pageid"] not in seen]
        for i in range(0, len(candidates), 20):
            if len(docs) >= WANT_DOCS:
                break
            batch = candidates[i:i + 20]
            try:
                texts = plain_texts(host, [rc["pageid"] for rc in batch])
            except Exception as e:
                print(f"  {lang} batch {i//20}: fetch failed ({e})",
                      file=sys.stderr)
                continue
            by_pageid = {rc["pageid"]: rc for rc in batch}
            for pageid, text in texts.items():
                if len(docs) >= WANT_DOCS:
                    break
                rc = by_pageid[pageid]
                text = text.strip()[:MAX_CHARS]
                if len(text) < MIN_CHARS:
                    continue
                name = f"{len(docs):02d}-{pageid}.txt"
                (out_dir / lang / name).write_text(text, encoding="utf-8")
                docs.append({
                    "file": f"{lang}/{name}", "title": rc["title"],
                    "pageid": pageid, "revid": rc["revid"],
                    "created": rc["timestamp"],
                    "sha256": hashlib.sha256(text.encode()).hexdigest(),
                    "bytes": len(text.encode())})
            seen.update(rc["pageid"] for rc in batch)
        n_bytes = sum(d["bytes"] for d in docs)
        assert len(docs) >= 50, f"{lang}: only {len(docs)} docs (need >= 50)"
        assert n_bytes >= 150_000, f"{lang}: only {n_bytes} bytes"
        manifest["languages"][lang] = {"n_docs": len(docs), "bytes": n_bytes,
                                       "docs": docs}
        print(f"{lang}: {len(docs)} docs, {n_bytes} bytes "
              f"(shortest {min(d['bytes'] for d in docs)} B)")
    (out_dir / "MANIFEST.json").write_text(
        json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f"OK -> {out_dir}/MANIFEST.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
