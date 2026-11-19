"""Pure decision table for the reader layer."""

from __future__ import annotations


def _for_block(value: dict, block: dict) -> dict:
    return value if "verdict" in value else value.get(block.get("id", ""), {})


def _quote_rule(row: dict, block: dict) -> str:
    """'' when every quote rule passes, else the name of the rule that refused."""
    if row.get("verdict") != "harmless":
        return "verdict-not-harmless"
    if not str(row.get("reason", "")).strip():
        return "empty-reason"
    quoted = str(row.get("quoted_line", "")).strip()
    lines = [line.strip() for line in block.get("text", "").split("\n")]
    if quoted not in lines:
        return "quote-not-a-whole-line"
    if len([char for char in quoted if not char.isspace()]) < 8:
        return "quote-shorter-than-8"
    return ""


def judge(
    block: dict,
    reader_a: dict,
    reader_b: dict,
    hints: list[str],
    injection_hits: list[str],
    malware_hits: list[str],
    precedents: list[dict] | None = None,
    hard_hits: list[str] | None = None,
) -> tuple[str, str]:
    """The verdict plus the rule that produced it; the rule is '' when auto-clean."""
    if hard_hits:
        return "needs person", "hard-rule"
    if injection_hits:
        return "needs person", "injection"
    if malware_hits:
        return "needs person", "malware"
    a, b = _for_block(reader_a, block), _for_block(reader_b, block)
    if any(row.get("needs_person") for row in [a, b]):
        return "needs person", "reader-needs-person"
    for name, row in (("a", a), ("b", b)):
        rule = _quote_rule(row, block)
        if rule:
            return "needs person", f"{name}:{rule}"
    # Precedents are context for the readers only; they never clear a rule.
    return "auto-clean", ""


def decide(
    block: dict,
    reader_a: dict,
    reader_b: dict,
    hints: list[str],
    injection_hits: list[str],
    malware_hits: list[str],
    precedents: list[dict] | None = None,
    hard_hits: list[str] | None = None,
) -> str:
    return judge(
        block, reader_a, reader_b, hints, injection_hits, malware_hits, precedents, hard_hits,
    )[0]
