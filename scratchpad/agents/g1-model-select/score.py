#!/usr/bin/env python3
"""Aggregate runner results and list deterministic failures."""

import argparse
import json
from collections import defaultdict


def load(paths):
    rows = []
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            rows.extend(json.loads(line) for line in handle if line.strip())
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results", nargs="+", help="runner JSONL result files")
    args = parser.parse_args()
    rows = load(args.results)
    groups = defaultdict(lambda: {"PASS": 0, "FAIL": 0, "RUBRIC": 0, "ERROR": 0})
    failures = []
    for row in rows:
        status = row.get("check", {}).get("status", "ERROR")
        key = (row.get("model_label", "?"), row.get("category", "?"), row.get("lang", "?"), row.get("split", "?"))
        groups[key][status] = groups[key].get(status, 0) + 1
        if status in {"FAIL", "ERROR"}:
            failures.append((row.get("model_label", "?"), row.get("id", "?"), status, row.get("check", {}).get("detail", "")))
    print(f"cases={len(rows)}")
    print("model\tcategory\tlang\tsplit\tpass_rate\tpass\tfail\trubric\terror")
    for model, category, lang, split in sorted(groups):
        counts = groups[(model, category, lang, split)]
        scored = counts["PASS"] + counts["FAIL"]
        rate = "n/a" if not scored else f"{counts['PASS'] / scored:.3f}"
        print(f"{model}\t{category}\t{lang}\t{split}\t{rate}\t{counts['PASS']}\t{counts['FAIL']}\t{counts['RUBRIC']}\t{counts['ERROR']}")
    print("failures")
    if failures:
        for model, case_id, status, detail in failures:
            print(f"{model}\t{case_id}\t{status}\t{detail}")
    else:
        print("none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
