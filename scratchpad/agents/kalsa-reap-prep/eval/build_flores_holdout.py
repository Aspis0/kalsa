#!/usr/bin/env python3
"""Build flores-devtest-100.jsonl — the FLORES-200 translation holdout.

Pairs EN -> {IT,FR,ES,ZH}, the FIRST 100 devtest sentences (FLORES-200 keeps
the same sentence order in every language, so one index range is a parallel
corpus). devtest only: DESIGN.md §5.9 keeps it out of calibration (v3 used
dev+devtest for the corpus — the calibration rebuild must drop devtest).

Licence: CC-BY-SA-4.0 (FLORES-200 distribution). Provenance: the official
tarball https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz
(25,585,843 B, sha256 recorded below); the extracted devtest files are
verified against the v3 corpus hashes before use.

Usage: build_flores_holdout.py --flores-dir <dir with <code>.devtest> [out_dir]
"""

import argparse
import hashlib
import json
import pathlib
import sys

LANGS = {"it": "ita_Latn", "fr": "fra_Latn", "es": "spa_Latn",
         "zh": "zho_Hans", "en": "eng_Latn"}
TARBALL_URL = "https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz"
TARBALL_SHA256 = "b8b0b76783024b85797e5cc75064eb83fc5288b41e9654dabc7be6ae944011f6"
N = 100
KNOWN_DEVTEST_SHA256 = {  # v3 corpus provenance (moe-expert-usage-v3/raw/source_hashes.txt)
    "eng_Latn": "612e9fbe87997617c0fa8fa8929654a4f49b728d96738112c2b86ef6a1d78d88",
    "ita_Latn": "4166da51aba285736535916870142d7e9491494cee52b1db0808533399796a94",
    "fra_Latn": "82f5b000db419ef9254eea7857cce82943b361090942f17ed696e3dce2944f42",
    "spa_Latn": "40fcb836b49b0a461a14c00b8bce1f03113f8d2668132af424e74b2421d18ce9",
    "zho_Hans": "b30158b1b76f7cee08530d8127a9769f4512597c7eefe97ae1ccf630d5b6e7fd",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--flores-dir", required=True)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    out = pathlib.Path(a.out) if a.out else pathlib.Path(__file__).parent / "flores-devtest-100.jsonl"

    lines = {}
    for short, code in LANGS.items():
        path = pathlib.Path(a.flores_dir) / f"{code}.devtest"
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != KNOWN_DEVTEST_SHA256[code]:
            sys.exit(f"{path.name}: sha256 {digest} != pinned {KNOWN_DEVTEST_SHA256[code]}")
        rows = path.read_text(encoding="utf-8").splitlines()
        if len(rows) < N:
            sys.exit(f"{path.name}: {len(rows)} lines < {N}")
        lines[short] = rows[:N]

    with open(out, "w", encoding="utf-8") as f:
        for i in range(N):
            f.write(json.dumps({
                "id": f"flores-devtest-{i:03d}",
                "source_en": lines["en"][i],
                "refs": {lang: lines[lang][i] for lang in ("it", "fr", "es", "zh")},
                "license": "cc-by-sa-4.0", "source": TARBALL_URL,
                "tarball_sha256": TARBALL_SHA256,
            }, ensure_ascii=False) + "\n")
    print(f"flores-devtest-100: {N} sentences x 5 langs -> {out} "
          f"(cc-by-sa-4.0, all devtest sha256 verified against the v3 pins)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
