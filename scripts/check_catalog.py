#!/usr/bin/env python3
"""Weekly gate check for catalog/engines.toml (PLAN.md rules 2-5).

Reads the checked-in catalog, asks GitHub for each repository's live facts and
opens one issue when any entry falls below the bar. With --dry-run it prints
findings and warnings, and creates nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

API = "https://api.github.com"
CATALOG = Path(__file__).resolve().parents[1] / "catalog" / "engines.toml"
ISSUE_TITLE = "Catalog gate: an engine is below the bar"
FRESH_DAYS = 183
NON_OSI = {"BUSL-1.1", "SSPL-1.0", "ELASTIC-2.0"}


def github_token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token
    try:
        result = subprocess.run(
            ["gh", "auth", "token"], check=True, capture_output=True, text=True
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError("no GitHub token: set GITHUB_TOKEN or run gh auth login") from error
    token = result.stdout.strip()
    if not token:
        raise RuntimeError("gh auth token returned nothing")
    return token


def api_get(path: str, token: str) -> dict:
    request = Request(
        API + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "kalsa-catalog-check",
        },
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def check_repo(repo: str, catalog_licence: str, facts: dict, today: datetime) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []
    if facts.get("archived"):
        failures.append("archived")
    if facts.get("full_name", "").lower() != repo.lower():
        failures.append(f"repo now resolves to {facts.get('full_name', 'unknown')}")
    stars = facts.get("stargazers_count") or 0
    if stars < 5:
        failures.append(f"only {stars} stars")

    spdx = str((facts.get("license") or {}).get("spdx_id") or "").upper()
    known = (catalog_licence or "").upper()
    if spdx in NON_OSI or spdx.startswith("CC-BY-NC"):
        failures.append(f"non-OSI licence {spdx}")
    elif not spdx or spdx in {"NOASSERTION", "NONE"}:
        warnings.append(f"licence {spdx or 'missing'} in the GitHub API; verify by hand")
    elif spdx != known:
        failures.append(f"GitHub licence {spdx} differs from catalog {catalog_licence}")

    pushed = facts.get("pushed_at")
    if not pushed:
        failures.append("no push date")
    else:
        when = datetime.fromisoformat(pushed.replace("Z", "+00:00"))
        if when < today - timedelta(days=FRESH_DAYS):
            failures.append(f"last push {when.date()} is older than {FRESH_DAYS} days")
    return failures, warnings


def collect(token: str) -> tuple[list[tuple[str, list[str]]], list[tuple[str, list[str]]]]:
    with CATALOG.open("rb") as handle:
        catalog = tomllib.load(handle)
    today = datetime.now(timezone.utc)
    findings: list[tuple[str, list[str]]] = []
    warnings: list[tuple[str, list[str]]] = []
    for engine in catalog["engine"]:
        repo = engine["repo"]
        try:
            facts = api_get(f"/repos/{quote(repo, safe='/')}", token)
            failures, cautions = check_repo(repo, engine["license"], facts, today)
        except (HTTPError, URLError, OSError, TimeoutError, ValueError, KeyError) as error:
            findings.append((repo, [f"GitHub API error: {error}"]))
            continue
        if failures:
            findings.append((repo, failures))
        if cautions:
            warnings.append((repo, cautions))
    return findings, warnings


def print_report(
    findings: list[tuple[str, list[str]]], warnings: list[tuple[str, list[str]]]
) -> None:
    if not findings and not warnings:
        print("No catalog gate findings.")
    for repo, failures in findings:
        print(f"FAIL {repo}: {'; '.join(failures)}")
    for repo, cautions in warnings:
        print(f"CHECK {repo}: {'; '.join(cautions)}")


def issue_exists() -> bool:
    result = subprocess.run(
        ["gh", "issue", "list", "--state", "open", "--limit", "1000", "--json", "title"],
        check=True,
        capture_output=True,
        text=True,
    )
    issues = json.loads(result.stdout)
    return any(issue.get("title") == ISSUE_TITLE for issue in issues)


def open_issue(findings: list[tuple[str, list[str]]]) -> None:
    if issue_exists():
        print("An open catalog gate issue already exists; not opening another.")
        return
    lines = ["The weekly catalog check found engines below the gate:", ""]
    for repo, failures in findings:
        lines.append(f"- `{repo.replace('`', "'")}`: {'; '.join(failures)}")
    lines.extend(["", "Fix the catalog entry or remove the engine, then close this issue."])
    subprocess.run(
        ["gh", "issue", "create", "--title", ISSUE_TITLE, "--body", "\n".join(lines)],
        check=True,
    )
    print("Opened one catalog gate issue.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print findings, create no issue")
    args = parser.parse_args()
    try:
        findings, warnings = collect(github_token())
    except RuntimeError as error:
        print(f"catalog check failed: {error}", file=sys.stderr)
        return 1
    print_report(findings, warnings)
    if not args.dry_run and findings:
        try:
            open_issue(findings)
        except (OSError, subprocess.CalledProcessError, ValueError) as error:
            print(f"could not open the issue: {error}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
