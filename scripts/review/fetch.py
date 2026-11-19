"""Fetch every commit required before a scan, including incremental bases."""

from __future__ import annotations

from . import localdiff


def fetch_all(
    bare,
    upstream_sha: str,
    fork_sha: str,
    base_override: str,
    upstream: str,
    fork: str,
    env: dict,
) -> None:
    localdiff.fetch_commit(bare, f"https://github.com/{upstream}.git", upstream_sha, env, 4096, upstream)
    localdiff.fetch_commit(bare, f"https://github.com/{fork}.git", fork_sha, env, 4096, fork)
    if base_override:
        localdiff.fetch_commit(bare, f"https://github.com/{fork}.git", base_override, env, 4096, fork)


def resolve_base(
    bare, upstream_sha: str, fork_sha: str, base_override: str,
    upstream: str, fork: str, env: dict,
) -> str | None:
    """Fetch first; base_override selects the base, it never skips a fetch."""
    fetch_all(bare, upstream_sha, fork_sha, base_override, upstream, fork, env)
    return base_override or localdiff.find_base(
        bare, upstream_sha, fork_sha,
        f"https://github.com/{upstream}.git", f"https://github.com/{fork}.git", env,
        upstream, fork,
    )
