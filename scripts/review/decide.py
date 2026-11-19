"""Pure decision table for the reader layer."""

from __future__ import annotations


def _for_block(value: dict, block: dict) -> dict:
    return value if "verdict" in value else value.get(block.get("id", ""), {})


def _valid(row: dict, block: dict) -> bool:
    quoted = str(row.get("quoted_line", "")).strip()
    lines = [line.strip() for line in block.get("text", "").split("\n")]
    return (
        row.get("verdict") == "harmless"
        and bool(str(row.get("reason", "")).strip())
        and quoted in lines
        and len([char for char in quoted if not char.isspace()]) >= 8
    )


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
    if hard_hits or injection_hits or malware_hits:
        return "needs person"
    a, b = _for_block(reader_a, block), _for_block(reader_b, block)
    if any(row.get("needs_person") for row in [a, b]):
        return "needs person"
    if not (_valid(a, block) and _valid(b, block)):
        return "needs person"
    # Precedents are context for the readers only; they never clear a rule.
    return "auto-clean"
