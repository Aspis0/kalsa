"""Corpus mode: full gate plus reader-only agreement."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from . import injection, progress, results
from .reader import client, config, pipeline

CORPUS = Path(__file__).parent / "tests" / "corpus"


def fixtures() -> list[tuple[str, dict]]:
    return [(path.stem, json.loads(path.read_text())) for path in sorted(CORPUS.glob("*.json"))]


def bad_count() -> int:
    return sum(1 for _, data in fixtures() if not data.get("good"))


def good_count() -> int:
    return sum(1 for _, data in fixtures() if data.get("good"))


def _fixture_result(name: str, data: dict, configs: list, precedents: list, budget) -> dict:
    """One fixture: gate decision, reader-only decision, verdicts and failure counts."""
    blocks = data.get("blocks") or [{"id": name, "path": name + ".txt", "text": data.get("text", "")}]
    verdicts = [client.read(cfg, blocks, [], precedents, budget=budget) for cfg in configs]
    joined = "\n".join(
        re.sub(r"^\s*(?://|#|/\*|\*)\s*", "", block["text"])
        for block in blocks
    )
    combined = injection.scan(joined)
    hard = {block["id"]: ["hard-rule"] for block in blocks} if data.get("hard") else {}
    malware_hits = {block["path"]: ["tool"] for block in blocks} if data.get("malware") else {}
    decisions, reader_only = {}, {}
    for index, block in enumerate(blocks):
        hits = sorted(set(injection.scan(block["text"]) + combined))
        decisions[block["id"]] = pipeline.review_block(
            block, verdicts[0][index], verdicts[1][index], hard.get(block["id"], []),
            hits, malware_hits.get(block["path"], []), precedents,
        )
        reader_only[block["id"]] = pipeline.review_block(
            block, verdicts[0][index], verdicts[1][index], [], [], [], precedents,
        )
    counts = client.tally(verdicts[0] + verdicts[1])
    return {
        "name": name,
        "expected": bool(data.get("good")),
        "gate": all(value == "auto-clean" for value in decisions.values()),
        "reader": all(value == "auto-clean" for value in reader_only.values()),
        "reader_a": [row.get("verdict", "") for row in verdicts[0]],
        "reader_b": [row.get("verdict", "") for row in verdicts[1]],
        "timeouts": counts["timeouts"], "errors": counts["errors"], "unsure": counts["unsure"],
    }


def _totals(records: list[dict], tokens: int) -> dict:
    return {
        "fixtures": len(records),
        "timeouts": sum(row["timeouts"] for row in records),
        "errors": sum(row["errors"] for row in records),
        "unsure": sum(row["unsure"] for row in records),
        "tokens": tokens,
    }


def evaluate() -> dict:
    configs = [client.from_env("REVIEW_A"), client.from_env("REVIEW_B")]
    if not all(configs):
        return {"error": "readers are not configured"}
    precedents = config.load_precedents()
    budget = client.budget_from_env()
    counts = {
        "gate_bad_pass": 0, "gate_bad_fail": 0, "gate_good_pass": 0, "gate_good_fail": 0,
        "reader_bad_pass": 0, "reader_bad_fail": 0, "reader_good_pass": 0, "reader_good_fail": 0,
        "mismatches": [],
    }
    records = []
    for name, data in fixtures():
        started = time.monotonic()
        record = _fixture_result(name, data, configs, precedents, budget)
        records.append(record)
        progress.emit(name, record["reader_a"], record["reader_b"], time.monotonic() - started, budget.tokens())
        expected = record["expected"]
        for prefix, actual in (("gate", record["gate"]), ("reader", record["reader"])):
            bucket = "good" if expected else "bad"
            counts[f"{prefix}_{bucket}_{'pass' if actual == expected else 'fail'}"] += 1
        if record["gate"] != expected:
            counts["mismatches"].append(name)
    counts["records"] = records
    counts["totals"] = _totals(records, budget.tokens())
    return counts


def summary_text(counts: dict) -> str:
    totals = counts["totals"]
    return "\n".join([
        f"gate: bad {counts['gate_bad_pass']}/{bad_count()}, good {counts['gate_good_pass']}/{good_count()}",
        f"readers: bad {counts['reader_bad_pass']}/{bad_count()}, good {counts['reader_good_pass']}/{good_count()}",
        "mismatches: " + ", ".join(counts["mismatches"]),
        f"reader timeouts: {totals['timeouts']}, errors: {totals['errors']}, model unsure: {totals['unsure']}",
        f"tokens used: {totals['tokens']}",
    ]) + "\n"


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", action="store_true")
    parser.parse_args()
    counts = evaluate()
    if "error" in counts:
        print(counts["error"])
        return
    text = summary_text(counts)
    print(text, end="")
    results.write("corpus", text, counts["records"], counts["totals"])


if __name__ == "__main__":
    main()
