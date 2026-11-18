"""Shared result type, tool runner and finding shape for the review scanners."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

BUILD_FILES = {
    "cmakelists.txt", "build.rs", "setup.py", "pyproject.toml", "package.json",
    "makefile", "meson.build", "dockerfile", "install.sh", "install.ps1",
}
NOT_REACHING_USERS = {"ci", "bench", "benchmarks", "tests", "test", ".devops", "docs", "examples"}


@dataclass
class ToolResult:
    code: int
    stdout: str
    stderr: str = ""
    error: str = ""


def run_tool(command: list[str], cwd: Path | None = None, timeout: int = 900) -> ToolResult:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return ToolResult(result.returncode, result.stdout, result.stderr)
    except OSError as error:
        return ToolResult(-1, "", "", str(error))
    except subprocess.TimeoutExpired:
        return ToolResult(-1, "", "timed out", "timed out")


def finding(tool: str, path: str, line: int, rule: str, snippet: str) -> dict:
    return {"tool": tool, "file": path, "line": line, "rule": rule, "snippet": str(snippet)[:200]}


def scanner_error(tool: str, detail: str) -> dict:
    return finding(tool, "", 0, "scanner-error", detail[:200])


def clean_path(path: str | Path) -> str:
    """One canonical, repo-relative key. Never strip a real directory name."""
    value = str(path).replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    return value


def safe_path(path: str | Path) -> str:
    value = clean_path(path)
    return value if value.startswith("/") else "./" + value


def reaches_users(path: str, release_workflow: bool = False) -> bool:
    """Does this file end up executing for a user or in published artifacts?"""
    parts = clean_path(path).lower().split("/")
    if parts[-1] in BUILD_FILES:
        return True
    if release_workflow:
        return True
    if parts[0] == ".github" and "workflows" in parts:
        return False
    if len(parts) > 1 and parts[0] == "scripts" and parts[1].startswith("bench"):
        return False
    return not any(part in NOT_REACHING_USERS for part in parts)


def source_snippet(files: dict[str, Path], path: str, line: int) -> str:
    source = files.get(clean_path(path))
    if source is None or line < 1:
        return ""
    lines = source.read_text(errors="ignore").splitlines()
    if line > len(lines):
        return ""
    return lines[line - 1].strip()[:200]
