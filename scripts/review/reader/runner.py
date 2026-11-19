"""Run both readers and build per-block decisions."""

from __future__ import annotations

import re

from .. import decide, injection
from . import client, config, prompt

PREFIXES = ("REVIEW_A", "REVIEW_B")


def run(
    blocks: list[dict],
    hints: dict[str, list[str]],
    hard_hits: dict[str, list[str]],
    malware_hits: dict[str, list[str]],
    precedents: list[dict] | None = None,
) -> tuple[list[dict], list[dict], dict]:
    precedents = precedents or config.load_precedents()
    configs = [client.from_env(prefix) for prefix in PREFIXES]
    if not all(configs):
        return [], [], {}
    verdicts = [client.read(cfg, blocks, hints.get("all", []), precedents) for cfg in configs]
    joined = "\n".join(
        re.sub(r"^\s*(?://|#|/\*|\*)\s*", "", block.get("text", ""))
        for block in blocks
    )
    combined = injection.scan(joined)
    decisions = {}
    for block, a, b in zip(blocks, *verdicts):
        identifier = block.get("id", "")
        combined_hints = hints.get(identifier, []) + hints.get("all", [])
        decisions[identifier] = decide.decide(
            block,
            a,
            b,
            combined_hints,
            sorted(set(injection.scan(block.get("text", "")) + combined)),
            malware_hits.get(block.get("path", ""), []),
            precedents,
            hard_hits.get(identifier, []),
        )
    return verdicts[0], verdicts[1], decisions
