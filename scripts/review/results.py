"""Run results: a markdown summary plus a machine-readable JSON record."""

from __future__ import annotations

import json
import os
from pathlib import Path


def results_dir() -> Path:
    return Path(os.environ.get("REVIEW_RESULTS_DIR", "review-results"))


def write(mode: str, summary: str, records: list[dict], totals: dict) -> tuple[Path, Path]:
    out = results_dir()
    out.mkdir(parents=True, exist_ok=True)
    markdown = out / f"{mode}-summary.md"
    payload = out / f"{mode}-results.json"
    markdown.write_text(summary)
    payload.write_text(json.dumps({"mode": mode, "totals": totals, "records": records}, indent=2) + "\n")
    return markdown, payload
