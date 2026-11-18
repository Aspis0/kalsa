"""Diff gating and plain source checks, all network-free."""

from __future__ import annotations

import re
from pathlib import Path

URL = re.compile(r"https?://[^\s\"'<>)\]}]+")
BINARY_HINT = re.compile(rb"[\x00\x01\x02\x03\x04\x05\x06\x07]")
BUILD_NAMES = {
    "cmakelists.txt", "setup.py", "setup.cfg", "build.rs", "package.json",
    "pyproject.toml", "requirements.txt", "makefile", "meson.build", "cargo.toml",
}
BUILD_SUFFIXES = (".sh", ".ps1", ".bat", ".cmd", ".gradle", ".yml", ".yaml")


def too_large(stats: dict, max_files: int, max_lines: int) -> bool:
    return stats["files"] > max_files or stats["lines"] > max_lines


def extract_urls(text: str) -> list[str]:
    found = []
    for match in URL.findall(text or ""):
        url = match.rstrip(".,;:")
        if url not in found:
            found.append(url)
    return found


def is_binary_sample(sample: bytes) -> bool:
    return bool(sample and BINARY_HINT.search(sample))


def is_build_file(path: str) -> bool:
    name = Path(path).name.lower()
    return name in BUILD_NAMES or name.endswith(BUILD_SUFFIXES)


def domain(url: str) -> str:
    from urllib.parse import urlparse
    try:
        return normalize_host(urlparse(url).hostname or "")
    except ValueError:
        return ""


def normalize_host(host: str) -> str:
    return host.strip().lower().rstrip(".")


def clean_rule_id(value: str) -> str:
    """Strip an absolute config path; keep registry rule ids intact."""
    value = str(value).replace("\\", "/")
    if value.startswith("kalsa."):
        return value
    if "kalsa." in value:
        return "kalsa." + value.rsplit("kalsa.", 1)[1]
    if value.startswith("p/") or value.startswith("python.") or value.startswith("generic."):
        return value
    return value.rsplit("/", 1)[-1].replace(" ", "_")


# Exact binary exemptions: images/fonts anywhere, and model weights only under
# test/, tests/, testdata/ or fixtures/ directories.
IMAGE_FONT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
              ".woff", ".woff2", ".ttf", ".otf", ".eot"}
MODEL_TEST = {".gguf", ".safetensors", ".bin", ".onnx"}
BINARY_EXT = IMAGE_FONT | MODEL_TEST | {".so", ".dylib", ".dll", ".a", ".o", ".exe", ".zip", ".gz", ".tar", ".pdf", ".png"}
TEST_DIRS = {"test", "tests", "testdata", "fixtures"}


def binary_path(path: str) -> bool:
    return Path(path.lower()).suffix in BINARY_EXT


def binary_exempt(path: str) -> bool:
    lowered = path.lower()
    suffix = Path(lowered).suffix
    parts = set(Path(lowered).parts)
    if suffix in IMAGE_FONT:
        return True
    return suffix in MODEL_TEST and bool(parts & TEST_DIRS)


def patch_url_entries(path: str, patch: str) -> list[dict]:
    """URLs added on '+' lines, with fence state and new-file line numbers."""
    entries = []
    line_number = 0
    fenced = False
    for row in (patch or "").splitlines():
        if row.startswith("@@"):
            marker = row.split("+", 1)[1].split(" ", 1)[0] if "+" in row else "0"
            line_number = int(marker.split(",")[0]) - 1
            continue
        if row.startswith("+") and not row.startswith("+++"):
            line_number += 1
            text = row[1:]
            if text.lstrip().startswith("```"):
                fenced = not fenced
            for url in extract_urls(text):
                comment = text.lstrip().startswith(("#", "//", "*", "<!--"))
                entries.append({
                    "url": url.rstrip(".,;:"),
                    "file": path,
                    "line": line_number,
                    "comment": comment or documentation_line(path, text),
                    "text": text.strip(),
                    "fenced": fenced,
                })
        elif not row.startswith("-"):
            line_number += 1
    return entries


def documentation_line(path: str, text: str) -> bool:
    return path.lower().startswith(("docs/", "readme")) or path.lower().endswith(".md")


def added_lines(patch: str) -> set[int]:
    """New-file line numbers introduced by one file's unified diff."""
    result = set()
    line = 0
    for row in (patch or "").splitlines():
        if row.startswith("@@"):
            marker = row.split("+", 1)[1].split(" ", 1)[0] if "+" in row else "0"
            line = int(marker.split(",")[0]) - 1
        elif row.startswith("+++ "):
            continue
        elif row.startswith("+"):
            line += 1
            result.add(line)
        elif row.startswith("-"):
            continue
        else:
            line += 1
    return result
