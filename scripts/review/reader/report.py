"""Attach reader results and decisions to a report."""

from __future__ import annotations

from .prompt import READER_PROMPT_V4


def annotate(report: dict, reader_a: list[dict], reader_b: list[dict], decisions: dict | str) -> dict:
    by_a = {row.get("id", ""): row for row in reader_a}
    by_b = {row.get("id", ""): row for row in reader_b}
    report["prompt_version"] = READER_PROMPT_V4
    report["reader_model_ids"] = {
        "a": reader_a[0].get("model", "") if reader_a else "",
        "b": reader_b[0].get("model", "") if reader_b else "",
    }
    for block in report.get("blocks", []):
        identifier = block.get("id", "")
        block["readers"] = {
            "a": by_a.get(identifier, {"verdict": "unsure", "reason": "not run"}),
            "b": by_b.get(identifier, {"verdict": "unsure", "reason": "not run"}),
        }
    report["decisions"] = decisions if isinstance(decisions, dict) else {
        block.get("id", ""): decisions for block in report.get("blocks", [])
    }
    return report
