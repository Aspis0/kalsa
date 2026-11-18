"""Semgrep: our local rules and registry rules, gated on added shipped lines."""

from __future__ import annotations

import json
from pathlib import Path

from .common import ToolResult, clean_path, finding, reaches_users, run_tool, safe_path, scanner_error, source_snippet
from ..diff import clean_rule_id

RULES = Path(__file__).resolve().parents[1] / "rules.yml"


def scan(
    files: list[Path],
    root: Path,
    added: dict[str, set[int]],
) -> tuple[list[dict], list[dict]]:
    if not files:
        return [], []
    by_path = {str(path.relative_to(root)): path for path in files}
    command = [
        "semgrep", "scan", "--json", "--quiet", "--disable-version-check",
        "--config", "p/secrets", "--config", "p/supply-chain",
        "--config", str(RULES), "--",
        *[safe_path(path.relative_to(root)) for path in files],
    ]
    result = run_tool(command, cwd=root)
    if result.error or result.code not in (0, 1):
        return [scanner_error("semgrep", result.error or result.stderr)], []
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return [scanner_error("semgrep", "semgrep did not produce JSON")], []
    findings, signals = [], []
    for row in data.get("results", []):
        path = clean_path(row.get("path", ""))
        line = int(row.get("start", {}).get("line", 0))
        snippet = source_snippet(by_path, path, line)
        rule = clean_rule_id(row.get("check_id", ""))
        item = finding("semgrep", path, line, rule, snippet)
        if line not in added.get(path, set()) or not reaches_users(path):
            item["suppressed_because"] = "not-added-or-not-reaches-users"
            signals.append(item)
        elif rule == "kalsa.packaging-entrypoint":
            item["suppressed_because"] = "packaging-entrypoint"
            signals.append(item)
        else:
            findings.append(item)
    return findings, signals
