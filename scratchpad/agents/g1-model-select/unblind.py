"""Unblind judge files against results/judge-key.json and tally per model and category.
Usage: python unblind.py results/judge-A-deepseek.jsonl results/judge-B-mimo.jsonl
"""
import collections
import json
import sys


def load_jsonl(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def unblind(path, key, pack):
    wins = collections.Counter()
    scores = collections.defaultdict(list)
    by_cat = collections.defaultdict(collections.Counter)
    for r in load_jsonl(path):
        k = key.get(r["id"])
        if not k:
            continue
        model = k["A"] if r["winner"] == "A" else k["B"] if r["winner"] == "B" else "tie"
        wins[model] += 1
        scores[k["A"]].append(r["score_A"])
        scores[k["B"]].append(r["score_B"])
        by_cat[pack[r["id"]].get("category", "?")][model] += 1
    means = {m: round(sum(v) / len(v), 2) for m, v in scores.items()}
    return wins, means, by_cat


def main():
    key = json.load(open("results/judge-key.json", encoding="utf-8"))
    pack = {r["id"]: r for r in load_jsonl("results/judge-pack.jsonl")}
    for path in sys.argv[1:]:
        wins, means, by_cat = unblind(path, key, pack)
        print(f"== {path}: rows={sum(wins.values())} wins={dict(wins)} mean_score={means}")
        for cat, cnt in sorted(by_cat.items()):
            print(f"   {cat}: {dict(cnt)}")
        no_ml = collections.Counter()
        for cat, cnt in by_cat.items():
            if cat != "multilingual":
                no_ml.update(cnt)
        print(f"   excluding multilingual: {dict(no_ml)}")


if __name__ == "__main__":
    main()
