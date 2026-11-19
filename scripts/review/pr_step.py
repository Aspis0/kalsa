"""Shadow-mode weekly PR: reports and a safe digest, never catalog changes."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
from html import escape
from pathlib import Path

TITLE_PREFIX = "Weekly review "


def pr_error() -> str:
    return "PR creation failed; enable 'Allow GitHub Actions to create and approve pull requests' for this repository"


def week() -> str:
    today = dt.date.today().isocalendar()
    return f"{today[0]}-W{today[1]:02d}"


def safe(text: str) -> str:
    value = str(text).replace("@", "@\u200d").replace("://", "[:]//")
    return re.sub(r"([\[\]()])", r"\\\1", value)


def fenced(text: str) -> str:
    runs = [len(run) for run in re.findall(r"`+", text)]
    marker = "`" * (max(runs, default=0) + 3)
    return f"{marker}\n{text}\n{marker}"


def digest(reports: list[Path], reports_dir: Path) -> str:
    lines = ["# Weekly review digest", ""]
    for path in reports:
        data = json.loads(path.read_text())
        lines.append(f"- {safe(path.name)}: {safe(data.get('verdict', 'unknown'))}")
        for row in data.get("findings", []):
            if not row.get("needs_person") or not row.get("file"):
                continue
            lines.append(f"  - {safe(row['file'])}: {safe(row.get('rule', ''))} (needs a person)")
        decisions = data.get("decisions", {})
        for block in data.get("blocks", []):
            if decisions.get(block.get("id")) != "needs person":
                continue
            lines.append(
                f"  - {safe(block.get('path', ''))}:{block.get('start')}-{block.get('end')}"
            )
            lines.append("    " + fenced(escape(str(block.get("text", "")), quote=False)).replace("\n", "\n    "))
            for name in ("a", "b"):
                verdict = block.get("readers", {}).get(name, {})
                lines.append(
                    f"    {name}: {safe(verdict.get('verdict', 'unsure'))} — {safe(verdict.get('reason', ''))}"
                )
    return "\n".join(lines) + "\n"


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=False, capture_output=True, text=True)


def branch_error(detail: str) -> str:
    return f"could not read the weekly branch from origin: {detail.strip()[:200]}"


def remote_has_branch(branch: str) -> bool:
    """Only exit 2 ('no matching refs') means first run; any other failure aborts."""
    result = _run(["git", "ls-remote", "--exit-code", "origin", branch])
    if result.returncode == 0:
        return True
    if result.returncode == 2:
        return False
    print("::error::" + branch_error(result.stderr))
    raise SystemExit(1)


def stage_reports(branch: str, reports: list[Path], digest_path: Path, remote_branch: bool) -> None:
    """Put the reports and digest on the weekly branch, and nothing else."""
    commands = [
        ["git", "config", "user.name", "github-actions[bot]"],
        ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
        # No start point: checking out origin/<branch> aborts because the freshly
        # downloaded reports differ from the ones already committed on it.
        ["git", "checkout", "-B", branch],
    ]
    if remote_branch:
        # --mixed resets the index to the remote tip, so the commit carries only
        # the reports and digest; --soft would keep main's tree and commit its
        # unrelated changes into the review PR.
        commands.append(["git", "reset", "--mixed", "FETCH_HEAD"])
    commands.append(["git", "add", *[str(path) for path in reports], str(digest_path)])
    for command in commands:
        result = _run(command)
        if result.returncode:
            print("::error::" + pr_error())
            raise SystemExit(1)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    reports_dir = Path(os.environ.get("REVIEW_REPORTS_DIR", "reviews"))
    reports = sorted(reports_dir.glob("*.json"))
    label = week()
    digest_path = reports_dir / f"digest-{label}.md"
    digest_path.write_text(digest(reports, reports_dir))
    if args.dry_run:
        print("dry run: no PR created")
        return
    branch = f"review/weekly-{label}"
    title = TITLE_PREFIX + label
    remote_branch = remote_has_branch(branch)
    if remote_branch:
        fetched = _run(["git", "fetch", "origin", branch])
        if fetched.returncode:
            print("::error::" + branch_error(fetched.stderr))
            raise SystemExit(1)
    stage_reports(branch, reports, digest_path, remote_branch)
    if _run(["git", "diff", "--cached", "--quiet"]).returncode:
        _run(["git", "commit", "-m", title])
    pushed = _run(["git", "push", "--force-with-lease", "origin", branch])
    if pushed.returncode:
        print("::error::" + pr_error())
        raise SystemExit(1)
    found = _run(["gh", "pr", "view", branch, "--json", "number"])
    if found.returncode:
        created = _run(["gh", "pr", "create", "--title", title, "--body-file", str(digest_path), "--head", branch])
    else:
        created = _run(["gh", "pr", "edit", branch, "--body-file", str(digest_path)])
    if created.returncode:
        print("::error::" + pr_error())
        raise SystemExit(1)


if __name__ == "__main__":
    main()
