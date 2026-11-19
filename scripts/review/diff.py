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


def extract_urls(text: str) -> list[str]:
    found = []
    for match in URL.findall(text or ""):
        url = match.rstrip(".,;:")
        if url not in found:
            found.append(url)
    return found


def is_binary_sample(sample: bytes) -> bool:
    return bool(sample and BINARY_HINT.search(sample))


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
    for row in split_nl(patch):
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

MAX_BLOCK_LINES = 400
MAX_BLOCK_BYTES = 40_000
LFS_PREFIX = b"version https://git-lfs.github.com/spec/"


def decode(data: bytes) -> str:
    # Literal backslashes are doubled before decoding; generated escapes keep
    # one backslash, so source text and real non-printable bytes stay distinct.
    text = data.replace(b"\\", b"\\\\").decode("utf-8", errors="backslashreplace")
    return "".join(
        char if char in "\n\r\t" or char.isprintable() else f"\\x{ord(char):02x}"
        for char in text
    )


def is_lfs_pointer(data: bytes) -> bool:
    return data.startswith(LFS_PREFIX)


def chunk_block(numbers: list[int], lines: list[str]) -> list[list[int]]:
    """Consecutive chunks under both caps; every line lands in exactly one chunk."""
    chunks, current, size = [], [], 0
    for number in numbers:
        text = lines[number - 1] if 0 < number <= len(lines) else ""
        length = len(text.encode("utf-8", errors="backslashreplace")) + 1
        if current and (len(current) >= MAX_BLOCK_LINES or size + length > MAX_BLOCK_BYTES):
            chunks.append(current)
            current, size = [], 0
        current.append(number)
        size += length
    if current:
        chunks.append(current)
    return chunks


def split_nl(text: str) -> list[str]:
    return text.split("\n") if text else []


def display_line(line: str) -> str:
    return line[:-1] if line.endswith("\r") else line


def hunks(patch: str) -> list[dict]:
    rows = []
    old = new = 0
    in_hunk = False
    for row in split_nl(patch):
        if row.startswith("@@"):
            old = int(row.split("-", 1)[1].split(",", 1)[0].split(" ", 1)[0]) - 1
            new = int(row.split("+", 1)[1].split(",", 1)[0].split(" ", 1)[0]) - 1
            in_hunk = True
            continue
        if not in_hunk or row.startswith("\\"):
            continue
        if row.startswith("+"):
            new += 1
            rows.append({"side": "new", "line": new, "text": row[1:]})
        elif row.startswith("-"):
            old += 1
            rows.append({"side": "old", "line": old, "text": row[1:]})
        else:
            old += 1
            new += 1
            rows.append({"side": "context", "line": old, "text": row[1:] if row.startswith(" ") else row})
    return rows


def added_lines(patch: str) -> set[int]:
    return {row["line"] for row in hunks(patch) if row["side"] == "new"}


def added_texts(patch: str) -> list[str]:
    return [row["text"] for row in hunks(patch) if row["side"] == "new"]


def removed_entries(patch: str) -> list[tuple[int, str]]:
    return [(row["line"], row["text"]) for row in hunks(patch) if row["side"] == "old"]


def removed_lines(patch: str) -> set[int]:
    return {row["line"] for row in hunks(patch) if row["side"] == "old"}


def added_blocks(patch: str) -> list[list[int]]:
    numbers = sorted(added_lines(patch))
    blocks = []
    for number in numbers:
        if blocks and number == blocks[-1][-1] + 1:
            blocks[-1].append(number)
        else:
            blocks.append([number])
    return blocks
