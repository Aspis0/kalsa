"""Semgrep: gate results on added or removed lines in files that reach users."""

from __future__ import annotations

import json
import re
from pathlib import Path

from .common import clean_path, finding, reaches_users, run_tool, safe_path, scanner_error, source_snippet
from ..diff import clean_rule_id

RULES = Path(__file__).resolve().parents[1] / "rules.yml"


def error_path(error: dict) -> str:
    value = error.get("path", "")
    if value:
        return clean_path(value)
    message = str(error.get("message", ""))
    match = re.search(r"(?:at line\s+)?([^\s:]+\.[A-Za-z0-9_.-]+):\d+", message)
    return clean_path(match.group(1)) if match else ""


def scan(
    files: list[Path],
    root: Path,
    added: dict[str, set[int]],
) -> tuple[list[dict], list[dict]]:
    if not files:
        return [], []
    by_path = {str(path.relative_to(root)): path for path in files}
    for name in (".semgrepignore", ".gitignore", ".ignore"):
        (root / name).unlink(missing_ok=True)
    command = [
        "semgrep", "scan", "--json", "--quiet", "--disable-version-check",
        "--disable-nosem", "--max-target-bytes=0", "--no-git-ignore",
        "--config", "p/secrets", "--config", "p/supply-chain",
        "--config", str(RULES), "--",
        *[safe_path(path.relative_to(root)) for path in files],
    ]
    result = run_tool(command, cwd=root)
    if result.error or result.code not in (0, 1):
        detail = result.error or result.stderr
        try:
            data = json.loads(result.stdout)
            if data.get("errors"):
                first = data["errors"][0]
                return [scanner_error(
                    "semgrep",
                    str(first.get("message", detail)),
                    clean_path(first.get("path", "")),
                    str(first.get("type", "SemgrepError")),
                )], []
        except json.JSONDecodeError:
            pass
        return [scanner_error("semgrep", detail)], []
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return [scanner_error("semgrep", "semgrep did not produce JSON")], []
    findings, signals = [], []
    for error in data.get("errors", []):
        message = str(error.get("message", error))
        error_type = str(error.get("type", "SemgrepError"))
        path = error_path(error)
        if "Syntax error" in message or "partial" in message.lower():
            signals.append({
                **finding("semgrep", path, 0, "partial-parse", message),
                "suppressed_because": "partial-parse",
            })
            continue
        findings.append(scanner_error("semgrep", message, path, error_type))
    for skipped in data.get("paths", {}).get("skipped", []):
        findings.append(scanner_error("semgrep", "semgrep skipped this target", clean_path(skipped), "SkippedTarget"))
    for row in data.get("results", []):
        path = clean_path(row.get("path", ""))
        line = int(row.get("start", {}).get("line", 0))
        end = int(row.get("end", {}).get("line", line))
        snippet = source_snippet(by_path, path, line)
        rule = clean_rule_id(row.get("check_id", ""))
        item = finding("semgrep", path, line, rule, snippet)
        if not any(number in added.get(path, set()) for number in range(line, end + 1)) or not reaches_users(path):
            item["suppressed_because"] = "not-added-or-not-reaches-users"
            signals.append(item)
        elif rule in {"kalsa.packaging-entrypoint", "kalsa.cmake-link-dependency"}:
            item["suppressed_because"] = "informational-rule"
            signals.append(item)
        else:
            findings.append(item)
    return findings, signals
