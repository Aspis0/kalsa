"""Corpus mode: full gate plus reader-only agreement."""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import injection, malware
from .reader import client, config, pipeline

CORPUS = Path(__file__).parent / "tests" / "corpus"


def fixtures() -> list[tuple[str, dict]]:
    return [(path.stem, json.loads(path.read_text())) for path in sorted(CORPUS.glob("*.json"))]


def bad_count() -> int:
    return sum(1 for _, data in fixtures() if not data.get("good"))


def good_count() -> int:
    return sum(1 for _, data in fixtures() if data.get("good"))


def evaluate() -> dict:
    configs = [client.from_env("REVIEW_A"), client.from_env("REVIEW_B")]
    if not all(configs):
        return {"error": "readers are not configured"}
    precedents = config.load_precedents()
    counts = {
        "gate_bad_pass": 0, "gate_bad_fail": 0, "gate_good_pass": 0, "gate_good_fail": 0,
        "reader_bad_pass": 0, "reader_bad_fail": 0, "reader_good_pass": 0, "reader_good_fail": 0,
        "mismatches": [],
    }
    for name, data in fixtures():
        blocks = data.get("blocks") or [{"id": name, "path": name + ".txt", "text": data.get("text", "")}]
        verdicts = [client.read(cfg, blocks, [], precedents) for cfg in configs]
        joined = "\n".join(
            re.sub(r"^\s*(?://|#|/\*|\*)\s*", "", block["text"])
            for block in blocks
        )
        combined = injection.scan(joined)
        hard = {block["id"]: ["hard-rule"] for block in blocks} if data.get("hard") else {}
        malware_hits = {block["path"]: ["tool"] for block in blocks} if data.get("malware") else {}
        decisions = {}
        for index, block in enumerate(blocks):
            decisions[block["id"]] = pipeline.review_block(
                block, verdicts[0][index], verdicts[1][index], hard.get(block["id"], []),
                sorted(set(injection.scan(block["text"]) + combined)),
                malware_hits.get(block["path"], []), precedents,
            )
        reader_only = {}
        for index, block in enumerate(blocks):
            reader_only[block["id"]] = pipeline.review_block(
                block, verdicts[0][index], verdicts[1][index], [], [], [], precedents,
            )
        gate_clean = all(value == "auto-clean" for value in decisions.values())
        reader_clean = all(value == "auto-clean" for value in reader_only.values())
        expected = bool(data.get("good"))
        for prefix, actual in (("gate", gate_clean), ("reader", reader_clean)):
            bucket = "good" if expected else "bad"
            counts[f"{prefix}_{bucket}_{'pass' if actual == expected else 'fail'}"] += 1
        if gate_clean != expected:
            counts["mismatches"].append(name)
    return counts


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", action="store_true")
    parser.parse_args()
    counts = evaluate()
    if "error" in counts:
        print(counts["error"])
        return
    print(f"gate: bad {counts['gate_bad_pass']}/{bad_count()}, good {counts['gate_good_pass']}/{good_count()}")
    print(f"readers: bad {counts['reader_bad_pass']}/{bad_count()}, good {counts['reader_good_pass']}/{good_count()}")
    print("mismatches: " + ", ".join(counts["mismatches"]))


if __name__ == "__main__":
    main()
