"""Plain checks: binaries, dash paths and the Kalsa URL policy."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlsplit

from .common import BUILD_FILES, clean_path, finding, reaches_users, source_snippet
from .. import diff

CONSTRUCTED = re.compile(r'["\']\s*\+\s*|\bconcat\b', re.IGNORECASE)
FETCH_EXEC = re.compile(
    r'(curl|wget|Invoke-WebRequest|fetch\(|urlopen|requests\.|http\.Get|URLSession|git clone|pip install|npm install)'
    r'[\s\S]*(\|\s*(ba)?sh|iex|-fsSL|install)',
    re.IGNORECASE,
)
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
CODE_HOSTS = {"github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com", "huggingface.co"}
DOC_HOSTS = {"docs.python.org", "docs.rs", "developer.mozilla.org", "cmake.org"}
BUILD_SUFFIXES = {".cmake"}
BUILD_NAMES = BUILD_FILES | {"makefile", "meson.build", "dockerfile"}


def authority(url: str) -> str:
    try:
        return urlsplit(url).netloc.lower()
    except ValueError:
        return ""


def host_part(authority_value: str) -> str:
    if authority_value.startswith("["):
        return authority_value.split("]", 1)[0] + "]"
    return authority_value.split(":", 1)[0]


def owner_of(url: str, host: str) -> str:
    try:
        parts = [part for part in urlsplit(url).path.split("/") if part]
    except ValueError:
        return ""
    return parts[0].lower() if parts and (host == "github.com" or "githubusercontent" in host or host == "huggingface.co") else ""


def is_docs(path: str) -> bool:
    value = clean_path(path).lower()
    if value.startswith(("docs/", "readme")):
        return True
    return not is_build_file(value) and Path(value).suffix in {".md", ".rst", ".txt"}


def is_build_file(path: str) -> bool:
    value = clean_path(path).lower()
    return Path(value).name in BUILD_NAMES or Path(value).suffix in BUILD_SUFFIXES


RELEASE_HINT = re.compile(
    r'(release|publish|upload|deploy|gh\s+release|gh\s+api|docker/build-push-action|'
    r'pypa/gh-action-pypi-publish|goreleaser|attest|actions/upload-release-asset|softprops|'
    r'twine|npm\s+publish|cargo\s+publish|docker\s+push|tags:)',
    re.IGNORECASE,
)


def release_workflow(path: str, patch: str) -> bool:
    value = clean_path(path).lower()
    if not value.startswith(".github/workflows/"):
        return False
    return bool(RELEASE_HINT.search(patch))


def suppress(reason: str, row: dict) -> dict:
    row["suppressed_because"] = reason
    return {"signal": True, "row": row}


def classify_url(
    entry: dict,
    upstream_domains: set[str],
    fork: str,
    upstream: str,
    release_workflow: bool = False,
    fenced: bool = False,
) -> dict:
    url = entry["url"]
    path = clean_path(entry["file"])
    text = entry.get("text", "")
    host = diff.domain(url)
    if CONSTRUCTED.search(url):
        return {"signal": False, "row": finding("plain", path, entry["line"], "constructed-url", url)}
    host_name = host_part(authority(url))
    if "$" in host_name or "{" in host_name:
        rule = "unresolved-host"
        row = finding("plain", path, entry["line"], rule, url)
        return {"signal": False, "row": row} if FETCH_EXEC.search(text) else suppress("not-fetch-line", row)
    if host in LOOPBACK:
        return suppress("ignored-loopback", finding("plain", path, entry["line"], "new-url", url))
    known_owner = False
    if host in CODE_HOSTS:
        owners = {fork.split("/")[0].lower(), upstream.split("/")[0].lower(), "ggml-org", "huggingface"}
        known_owner = owner_of(url, host) in owners
    if known_owner:
        return suppress("known-owner-url", finding("plain", path, entry["line"], "new-url", url))
    if is_docs(path):
        rule = "download-and-execute" if FETCH_EXEC.search(text) else "new-url"
        if not (fenced and FETCH_EXEC.search(text)):
            return suppress("documentation-url", finding("plain", path, entry["line"], rule, url))
    if entry.get("comment") and not (fenced and FETCH_EXEC.search(text)):
        return suppress("comment-url", finding("plain", path, entry["line"], "new-url", url))
    if not reaches_users(path, release_workflow) and not is_build_file(path):
        return suppress("not-reaches-users", finding("plain", path, entry["line"], "new-url", url))
    if FETCH_EXEC.search(text):
        return {"signal": False, "row": finding("plain", path, entry["line"], "download-and-execute", url)}
    if host in DOC_HOSTS or host == "pypi.org":
        return suppress("allowlisted-domain", finding("plain", path, entry["line"], "new-url", url))
    if FETCH_EXEC.search(text):
        return {"signal": False, "row": finding("plain", path, entry["line"], "download-and-execute", url)}
    return {"signal": False, "row": finding("plain", path, entry["line"], "new-url", url)}


def scan(
    files: list[Path],
    patches: list[tuple[str, str]],
    root: Path,
    upstream_domains: set[str],
    fork: str,
    upstream: str,
) -> tuple[list[dict], list[dict]]:
    by_path = {str(path.relative_to(root)): path for path in files}
    findings, signals = [], []
    for path in files:
        relative = str(path.relative_to(root))
        if Path(relative).name.startswith("-"):
            findings.append(finding("plain", relative, 0, "dash-prefixed-path", "refusing tool flags from a fork path"))
        if diff.is_binary_sample(path.open("rb").read(8192)) and not diff.binary_exempt(relative):
            findings.append(finding("plain", relative, 0, "binary-file", "new or changed binary content"))
    for path, patch in patches:
        release = release_workflow(path, patch)
        for entry in diff.patch_url_entries(path, patch):
            entry["file"] = clean_path(entry["file"])
            result = classify_url(entry, upstream_domains, fork, upstream, release, entry.get("fenced", False))
            result["row"]["snippet"] = source_snippet(by_path, entry["file"], entry["line"]) or entry["url"]
            (signals if result["signal"] else findings).append(result["row"])
    return findings, signals
