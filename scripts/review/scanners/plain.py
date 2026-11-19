"""Plain checks: binaries, dash paths, URL policy and multi-line droppers."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .common import BUILD_FILES, clean_path, finding, reaches_users, source_snippet
from .. import diff

CONSTRUCTED = re.compile(r'["\']\s*\+\s*|\bconcat\b', re.IGNORECASE)
UNSAFE_PATH = re.compile(r'(\.\.|%2f|%5c|\\)', re.IGNORECASE)
FETCH_EXEC = re.compile(
    r'(curl|wget|Invoke-WebRequest|fetch\(|urlopen|requests\.|http\.Get|URLSession|git clone|pip install|npm install)'
    r'[\s\S]*(\|\s*(sh|bash|zsh|python|perl|node|ruby|sudo|iex|powershell)|sh\s+-s|iex|-fsSL|install)',
    re.IGNORECASE,
)
DOWNLOAD_FILE = re.compile(
    r'(?:/usr/bin/)?(?:curl|wget)[^\n]*?(?:-o|--output|-O)(?:\s+|=)?([^\s"\'`]+)',
    re.IGNORECASE,
)
EXECUTE_FILE = re.compile(
    r'(?:sh|bash|zsh|python3?|node|perl|ruby|source|\.|chmod\s+(?:\+x|[0-7]{3}))\s+["\']?([^\s"\']+)',
    re.IGNORECASE,
)
SECURITY_REMOVED = re.compile(
    r'\b(auth\w*|verify\w*|signature|checksum|permission|sandbox|setuid|setgid|chmod|chown|system|exec\w*|popen|dlopen|dlmopen|curl|wget)\b',
    re.IGNORECASE,
)
RELEASE_HINT = re.compile(
    r'(release|publish|upload|deploy|gh\s+release|gh\s+api|docker/build-push-action|'
    r'pypa/gh-action-pypi-publish|goreleaser|attest|actions/upload-release-asset|softprops|'
    r'twine|npm\s+publish|cargo\s+publish|docker\s+push|tags:)',
    re.IGNORECASE,
)
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
CODE_HOSTS = {
    "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
    "codeload.github.com", "huggingface.co",
}
DOC_HOSTS = {"docs.python.org", "docs.rs", "developer.mozilla.org", "cmake.org"}
BUILD_SUFFIXES = {".cmake"}
BUILD_NAMES = BUILD_FILES | {"makefile", "meson.build", "dockerfile"}


EXECUTABLE_EXT = {
    ".so", ".dylib", ".dll", ".exe", ".bin", ".o", ".a", ".zip", ".whl", ".jar",
    ".gguf", ".onnx", ".safetensors", ".pt", ".pkl",
}
SOURCE_EXT = {
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".py", ".js", ".ts", ".rs", ".go",
    ".java", ".sh", ".ps1", ".bat", ".cmake", ".toml", ".json", ".yml", ".yaml",
}
IMAGE_MAGIC = {
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff",
    ".gif": b"GIF8",
    ".webp": b"WEBP",
    ".ico": b"\x00\x00\x01\x00",
}
BINARY_MAGIC = (
    b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
    b"MZ", b"PK\x03\x04", b"\x1f\x8b",
)
TEXT_EXT = {".md", ".txt", ".rst"}


def assess_binary(relative: str, data: bytes) -> tuple[bool, bool]:
    """Return (needs_person, plain_asset_signal) from raw bytes only."""
    suffix = Path(relative.lower()).suffix
    if diff.is_lfs_pointer(data):
        return True, False
    window = data[:65_536] + data[-65_536:]
    if any(magic in window for magic in BINARY_MAGIC):
        return True, False
    if suffix in EXECUTABLE_EXT:
        return True, False
    if suffix in IMAGE_MAGIC and IMAGE_MAGIC[suffix] in data[:16]:
        return False, True
    if suffix in IMAGE_MAGIC:
        return True, False
    text_file = suffix in SOURCE_EXT or suffix in TEXT_EXT or relative.lower().startswith("docs/") or data.startswith(b"#!")
    if text_file and b"\x00" in data:
        return True, False
    if text_file:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return True, False
    return False, False


def authority(url: str) -> str:
    try:
        return urlsplit(url).netloc.lower()
    except ValueError:
        return ""


def host_part(value: str) -> str:
    if value.startswith("["):
        return value.split("]", 1)[0] + "]"
    return value.split(":", 1)[0]


def safe_url_path(url: str) -> bool:
    try:
        path = urlsplit(url).path
    except ValueError:
        return False
    decoded = unquote(unquote(path))
    return not UNSAFE_PATH.search(path) and not UNSAFE_PATH.search(decoded)


def safe_owner(url: str, host: str) -> str:
    try:
        parts = [part for part in unquote(urlsplit(url).path).split("/") if part and part != "."]
    except ValueError:
        return ""
    parts = [part for part in parts if part != ".."]
    return parts[0].lower() if parts and (host == "github.com" or "githubusercontent" in host or host == "huggingface.co") else ""


def is_build_file(path: str) -> bool:
    value = clean_path(path).lower()
    return Path(value).name in BUILD_NAMES or Path(value).suffix in BUILD_SUFFIXES


def is_docs(path: str) -> bool:
    value = clean_path(path).lower()
    if is_build_file(value) or Path(value).suffix in {".sh", ".ps1", ".bat", ".py"}:
        return False
    return value.startswith("docs/") or Path(value).suffix in {".md", ".rst"}


def release_workflow(path: str, patch: str) -> bool:
    if not clean_path(path).lower().startswith(".github/workflows/"):
        return False
    return bool(RELEASE_HINT.search(patch))


def pinned_to_review(url: str, host: str, reviewed_repo: str, reviewed_sha: str) -> bool:
    try:
        parts = [part for part in urlsplit(url).path.split("/") if part]
    except ValueError:
        return False
    if len(reviewed_repo.split("/")) != 2:
        return False
    owner, repo = reviewed_repo.lower().split("/")
    if host == "raw.githubusercontent.com" and len(parts) > 3:
        return parts[:3] == [owner, repo, reviewed_sha.lower()]
    if host == "github.com" and len(parts) > 4 and parts[2] == "blob":
        return parts[0].lower() == owner and parts[1].lower() == repo and parts[3] == reviewed_sha.lower()
    return False


def suppress(reason: str, row: dict) -> dict:
    row["suppressed_because"] = reason
    return {"signal": True, "row": row}


def classify_url(
    entry: dict,
    fork: str,
    upstream: str,
    release_workflow_flag: bool = False,
    fenced: bool = False,
    reviewed_repo: str = "",
    reviewed_sha: str = "",
) -> dict:
    url = entry["url"]
    path = clean_path(entry["file"])
    text = entry.get("text", "")
    host = diff.domain(url)
    if CONSTRUCTED.search(url):
        return {"signal": False, "row": finding("plain", path, entry["line"], "constructed-url", url)}
    if not safe_url_path(url):
        return {"signal": False, "row": finding("plain", path, entry["line"], "unsafe-url-path", url)}
    if host in LOOPBACK:
        return suppress("ignored-loopback", finding("plain", path, entry["line"], "new-url", url))
    if is_docs(path):
        rule = "download-and-execute" if FETCH_EXEC.search(text) else "new-url"
        if not (fenced and FETCH_EXEC.search(text)):
            return suppress("documentation-url", finding("plain", path, entry["line"], rule, url))
    if entry.get("comment") and not (fenced and FETCH_EXEC.search(text)):
        return suppress("comment-url", finding("plain", path, entry["line"], "new-url", url))
    if not reaches_users(path, release_workflow_flag) and not is_build_file(path):
        return suppress("not-reaches-users", finding("plain", path, entry["line"], "new-url", url))
    if "$" in host_part(authority(url)) or "{" in host_part(authority(url)):
        return {"signal": False, "row": finding("plain", path, entry["line"], "unresolved-host", url)}
    if FETCH_EXEC.search(text):
        return {"signal": False, "row": finding("plain", path, entry["line"], "download-and-execute", url)}
    if host in CODE_HOSTS and reviewed_repo and reviewed_sha and pinned_to_review(url, host, reviewed_repo, reviewed_sha):
        return suppress("reviewed-self-pinned", finding("plain", path, entry["line"], "new-url", url))
    known_owner = False
    if host in CODE_HOSTS:
        owners = {upstream.split("/")[0].lower(), "ggml-org", "huggingface"}
        known_owner = safe_owner(url, host) in owners
    if known_owner:
        return suppress("known-owner-url", finding("plain", path, entry["line"], "new-url", url))
    if host in DOC_HOSTS or host == "pypi.org":
        return suppress("allowlisted-domain", finding("plain", path, entry["line"], "new-url", url))
    return {"signal": False, "row": finding("plain", path, entry["line"], "new-url", url)}


def basename(value: str) -> str:
    value = value.strip().strip("\"'")
    for prefix in ("$TMPDIR/", "$HOME/", "~/", "${TMPDIR}/", "${HOME}/"):
        if value.startswith(prefix):
            value = value[len(prefix):]
    return Path(value).name


def download_then_execute(lines: list[str]) -> list[tuple[int, int]]:
    written: dict[str, int] = {}
    sites = []
    for index, line in enumerate(lines):
        for match in DOWNLOAD_FILE.finditer(line):
            written[basename(match.group(1))] = index
        for match in EXECUTE_FILE.finditer(line):
            download = written.get(basename(match.group(1)))
            if download is not None:
                sites.append((download, index))
    return sites


def scan(
    files: list[Path],
    patches: list[tuple[str, str]],
    root: Path,
    fork: str,
    upstream: str,
    reviewed_repo: str = "",
    reviewed_sha: str = "",
) -> tuple[list[dict], list[dict], list[dict]]:
    by_path = {str(path.relative_to(root)): path for path in files}
    findings, signals, removed_blocks = [], [], []
    plain_assets = set()
    for path in files:
        if not path.is_file():
            continue
        relative = str(path.relative_to(root))
        if Path(relative).name.startswith("-"):
            findings.append(finding("plain", relative, 0, "dash-prefixed-path", "refusing tool flags from a fork path"))
        data = path.read_bytes()
        needs_person, plain_asset = assess_binary(relative, data)
        if needs_person:
            row = finding("plain", relative, 0, "binary-or-nul-content", "binary or NUL content needs a person")
            row["needs_person"] = True
            findings.append(row)
        elif plain_asset:
            plain_assets.add(relative)
            row = finding("plain", relative, 0, "asset-binary", "plain image asset")
            row["suppressed_because"] = "plain-image"
            signals.append(row)
    for path, patch in patches:
        source = by_path.get(clean_path(path))
        release = release_workflow(path, patch)
        added = list(zip(sorted(diff.added_lines(patch)), diff.added_texts(patch)))
        added_lines = [text for _, text in added]
        if reaches_users(path, release) or is_build_file(path):
            for download, execute in download_then_execute(added_lines):
                snippet = f"{added_lines[download]} {added_lines[execute]}"
                findings.append(finding(
                    "plain", clean_path(path), added[download][0], "download-and-execute", snippet[:200],
                ))
        context_rows = [row for row in diff.hunks(patch) if row["side"] == "context"]
        for line, text in diff.removed_entries(patch):
            clipped, truncated = diff.cap_text(text)
            context = [
                {"line": row["line"], "text": row["text"][:200]}
                for row in context_rows if abs(row["line"] - line) <= 2
            ]
            removed_blocks.append({
                "id": hashlib.sha256((clean_path(path) + str(line) + clipped).encode()).hexdigest(),
                "path": clean_path(path), "start": line, "end": line,
                "kind": "removed", "text": clipped, "context": context,
                "ships": reaches_users(path, release), "truncated": truncated,
            })
            if SECURITY_REMOVED.search(text):
                row = finding("plain", clean_path(path), line, "removed-security-line", text[:200])
                row["suppressed_because"] = "removed-security-line"
                signals.append(row)
        if clean_path(path) in plain_assets:
            continue
        for entry in diff.patch_url_entries(path, patch):
            entry["file"] = clean_path(entry["file"])
            result = classify_url(
                entry, fork, upstream, release, entry.get("fenced", False), reviewed_repo, reviewed_sha,
            )
            result["row"]["snippet"] = source_snippet(by_path, entry["file"], entry["line"]) or entry["url"]
            (signals if result["signal"] else findings).append(result["row"])
    return findings, signals, removed_blocks
