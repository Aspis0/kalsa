"""Run both readers and build per-block decisions."""

from __future__ import annotations

import re

from .. import decide, injection
from . import client, config

PREFIXES = ("REVIEW_A", "REVIEW_B")


def _one_to_one(blocks: list[dict], verdicts: list[list[dict]]) -> bool:
    wanted = sorted(block.get("id", "") for block in blocks)
    return all(sorted(row.get("id", "") for row in rows) == wanted for rows in verdicts)


def run(
    blocks: list[dict],
    hints: dict[str, list[str]],
    hard_hits: dict[str, list[str]],
    malware_hits: dict[str, list[str]],
    precedents: list[dict] | None = None,
    budget: client.TokenBudget | None = None,
) -> tuple[list[dict], list[dict], dict]:
    precedents = precedents or config.load_precedents()
    configs = [client.from_env(prefix) for prefix in PREFIXES]
    if not all(configs):
        return [], [], {}
    verdicts = [client.read(cfg, blocks, hints.get("all", []), precedents, budget=budget) for cfg in configs]
    if not _one_to_one(blocks, verdicts):
        return verdicts[0], verdicts[1], {block.get("id", ""): "needs person" for block in blocks}
    by_a = {row.get("id", ""): row for row in verdicts[0]}
    by_b = {row.get("id", ""): row for row in verdicts[1]}
    joined = "\n".join(
        re.sub(r"^\s*(?://|#|/\*|\*)\s*", "", block.get("text", ""))
        for block in blocks
    )
    combined = injection.scan(joined)
    decisions = {}
    for block in blocks:
        identifier = block.get("id", "")
        combined_hints = hints.get(identifier, []) + hints.get("all", [])
        decisions[identifier] = decide.decide(
            block,
            by_a.get(identifier, {}),
            by_b.get(identifier, {}),
            combined_hints,
            sorted(set(injection.scan(block.get("text", "")) + combined)),
            malware_hits.get(block.get("path", ""), []),
            precedents,
            hard_hits.get(identifier, []),
        )
    return verdicts[0], verdicts[1], decisions
