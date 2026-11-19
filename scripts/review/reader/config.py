"""Provider configuration and precedent loading."""

from __future__ import annotations

import tomllib
from pathlib import Path

PRECEDENTS = Path(__file__).resolve().parents[3] / "reviews" / "precedents.toml"


def load_precedents(path: Path = PRECEDENTS) -> list[dict]:
    if not path.is_file():
        return []
    with path.open("rb") as handle:
        data = tomllib.load(handle)
    return data.get("precedents", [])
