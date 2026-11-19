"""Run results: a markdown summary plus a machine-readable JSON record."""

from __future__ import annotations

import json
import os
from pathlib import Path


def results_dir() -> Path:
    return Path(os.environ.get("REVIEW_RESULTS_DIR", "review-results"))


SECRET_ENV = ("GITHUB_TOKEN", "GH_TOKEN", "REVIEW_A_KEY", "REVIEW_B_KEY")


def redact(text: str) -> str:
    """Strip every secret this process holds before text reaches a log or a file."""
    for name in SECRET_ENV:
        value = os.environ.get(name, "")
        if value:
            text = text.replace(value, "[redacted]")
    return text


def write_failure(mode: str, error: BaseException) -> None:
    """A run that died early still leaves an artifact saying why, with no secrets."""
    detail = redact(str(error))
    record = {"error": type(error).__name__, "detail": detail}
    write(mode, f"# {mode} run failed\n\n{record['error']}: {detail}\n", [record], {"failed": 1})


def write(mode: str, summary: str, records: list[dict], totals: dict) -> tuple[Path, Path]:
    out = results_dir()
    out.mkdir(parents=True, exist_ok=True)
    markdown = out / f"{mode}-summary.md"
    payload = out / f"{mode}-results.json"
    markdown.write_text(summary)
    payload.write_text(json.dumps({"mode": mode, "totals": totals, "records": records}, indent=2) + "\n")
    return markdown, payload
