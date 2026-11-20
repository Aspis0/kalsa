"""GitHub API reads: HEAD, compare, and a changed-files checkout."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.parse
import urllib.request

API = "https://api.github.com"
# No git subprocess runs: the tarball has no .git, hooks, submodules or LFS filters.
os.environ.setdefault("GIT_CONFIG_NOSYSTEM", "1")


def token() -> str:
    """GITHUB_TOKEN on the runner, else a local gh login; neither is ever echoed."""
    value = os.environ.get("GITHUB_TOKEN", "").strip()
    if value:
        return value
    try:
        result = subprocess.run(["gh", "auth", "token"], check=False, capture_output=True, text=True)
    except OSError:
        result = None
    if result is not None and result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    raise RuntimeError("no GitHub token available: set GITHUB_TOKEN, or run gh auth login")


def api_get(path: str, gh_token: str) -> dict:
    request = urllib.request.Request(
        API + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {gh_token}",
            "User-Agent": "kalsa-review",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def default_branch(repo: str, gh_token: str) -> str:
    return api_get(f"/repos/{repo}", gh_token)["default_branch"]


def fork_head(repo: str, gh_token: str) -> tuple[str, str]:
    branch = default_branch(repo, gh_token)
    info = api_get(f"/repos/{repo}/commits/{urllib.parse.quote(branch)}", gh_token)
    return info["sha"], branch


def compare_url(upstream: str, base: str, fork: str, sha: str) -> str:
    return f"https://github.com/{upstream}/compare/{base}...{fork.split('/')[0]}:{sha}"
