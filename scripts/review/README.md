# S2 review pipeline

Pinned tools: `requirements.in` -> `requirements.lock` (hashes), uv 0.13.9 in the
lock, OSV-Scanner v2.7.1 with sha256 in `tools.py`.

Run:

```sh
uv run --no-project --python 3.12 --with-requirements scripts/review/requirements.lock \
  PYTHONPATH=scripts python -m review.review scan <engine-id>
uv run --no-project --python 3.12 --with-requirements scripts/review/requirements.lock \
  PYTHONPATH=scripts pytest -q scripts/review/tests
```

`apply <engine-id>` writes `[engine.review]` only after the latest report says
`no findings`; it prints the TOML diff and never commits. GitHub Fact reads use
`GITHUB_TOKEN` or `gh auth token`. No git subprocess is used for the checkout:
the tarball has no .git, so no hooks, submodules or LFS filters can run.
