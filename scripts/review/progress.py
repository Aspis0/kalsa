"""One stderr progress line per fixture or fork: never block text, keys or headers."""

from __future__ import annotations

import sys


def _summary(values: list[str]) -> str:
    return "/".join(sorted({value for value in values if value})) or "none"


def started(name: str) -> None:
    """Announce the fork before it runs, so a hang names its own culprit."""
    print(f"started {name}", file=sys.stderr)


def emit(name: str, a: list[str], b: list[str], seconds: float, tokens: int) -> None:
    print(f"{name} A={_summary(a)} B={_summary(b)} {seconds:.1f}s tokens={tokens}", file=sys.stderr)
