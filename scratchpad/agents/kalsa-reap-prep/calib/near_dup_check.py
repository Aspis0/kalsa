#!/usr/bin/env python3
"""Near-duplicate check between the Kalsa calibration set and corpus/multi5.

The builder already enforces exact 80-char normalized-window disjointness;
this adds fuzzy overlap: 8-char shingles, 64-permutation MinHash over a
61-bit hash space, then TRUE Jaccard for the top estimate per language.
Fails (exit 1) if any true Jaccard exceeds 0.3.

Usage: near_dup_check.py <calib.jsonl> <multi5_dir>
"""

import json
import pathlib
import random
import re
import sys

K = 8          # shingle chars
N_PERM = 64
MASK = (1 << 61) - 1
FAIL_ABOVE = 0.3


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+", "", text.lower())


def shingles(text: str) -> set[int]:
    t = norm(text)
    return {hash(t[i:i + K]) for i in range(0, max(1, len(t) - K + 1))}


class MinHash:
    """Classic (a*x+b) mod p permutations of a 64-bit hash."""

    def __init__(self, seed: int):
        rng = random.Random(seed)
        self.a = [rng.randrange(1, 1 << 61) for _ in range(N_PERM)]
        self.b = [rng.randrange(0, 1 << 61) for _ in range(N_PERM)]

    def sig(self, sh: set[int]) -> list[int]:
        return [min(((a * h + b) & MASK) for h in sh) for a, b in zip(self.a, self.b)]


def jaccard(x: set, y: set) -> float:
    return len(x & y) / max(1, len(x | y))


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    calib_path, multi5 = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    rows = [json.loads(l) for l in open(calib_path)]
    mh = MinHash(42)

    corpus = {}   # lang -> (shingles, signature)
    for f in sorted(multi5.glob("*.txt")):
        sh = shingles(f.read_text(encoding="utf-8"))
        corpus[f.stem] = (sh, mh.sig(sh))

    worst = {}
    for r in rows:
        sh = shingles(" ".join(m["content"] for m in r["messages"]))
        if not sh:
            continue
        sig = mh.sig(sh)
        for lang, (csh, csig) in corpus.items():
            est = sum(1 for x, y in zip(sig, csig) if x == y) / N_PERM
            true_j = jaccard(sh, csh)  # calib rows are small; exact is cheap
            prev = worst.get(lang, (0.0, 0.0))
            if est > prev[0] or true_j > prev[1]:
                worst[lang] = (max(est, prev[0]), max(true_j, prev[1]))

    print(f"{'multi5 file':<28} {'max MinHash Jaccard est':>24} {'max TRUE Jaccard':>18}")
    overall = 0.0
    for lang in sorted(worst):
        est, true_j = worst[lang]
        overall = max(overall, true_j)
        print(f"{lang + '.txt':<28} {est:>24.4f} {true_j:>18.4f}")
    print(f"\noverall max true overlap: {overall:.4f} (fail above {FAIL_ABOVE})")
    return 0 if overall <= FAIL_ABOVE else 1


if __name__ == "__main__":
    sys.exit(main())
