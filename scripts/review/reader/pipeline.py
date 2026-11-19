"""One-block reader decision, shared by the run and the corpus test."""

from __future__ import annotations

from ..decide import decide


def review_block(
    block: dict,
    reader_a: dict,
    reader_b: dict,
    hard_hits: list[str],
    injection_hits: list[str],
    malware_hits: list[str],
    precedents: list[dict] | None = None,
) -> str:
    return decide(
        block, reader_a, reader_b, [],
        injection_hits, malware_hits, precedents, hard_hits,
    )


def verify_decisions(blocks: list[dict], decisions: dict) -> str:
    if any(decisions.get(block.get("id", "")) != "auto-clean" for block in blocks):
        return "needs person"
    return "auto-clean"
