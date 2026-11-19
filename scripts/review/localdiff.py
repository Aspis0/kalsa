"""Git-derived diff: safe fetch, merge base, paths, patches and blob reads."""

from __future__ import annotations

import codecs
import hashlib
import os
import re
import subprocess
from pathlib import Path

from . import diff

SHA = re.compile(r"^[0-9a-f]{40}$")
REPO = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)\.git$")
GIT_ARGS = [
    "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always",
    "-c", "core.symlinks=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.quotePath=false",
]


def valid_sha(value: str) -> bool:
    return bool(SHA.match(value))


def valid_repo(url: str, catalog_repo: str) -> bool:
    match = REPO.match(url)
    return bool(match and f"{match.group(1)}/{match.group(2)}" == catalog_repo)


def git_env(home: Path) -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C"),
        "HOME": str(home),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C",
    }


def git(bare: Path, args: list[str], env: dict[str, str], timeout: int = 300) -> subprocess.CompletedProcess[bytes]:
    command = ["git", "-C", str(bare), *GIT_ARGS, *args]
    return subprocess.run(command, check=False, capture_output=True, env=env, timeout=timeout)


def init(bare: Path) -> None:
    bare.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)


def fetch_commit(
    bare: Path, url: str, sha: str, env: dict[str, str], depth: int,
    expected_repo: str = "",
) -> bool:
    if expected_repo:
        valid = valid_sha(sha) and valid_repo(url, expected_repo)
    else:
        match = REPO.match(url)
        valid = bool(valid_sha(sha) and match)
    if not valid:
        return False
    args = ["fetch", f"--depth={depth}", "--no-tags", "--no-write-fetch-head", url, sha]
    result = git(bare, ["-c", "remote.origin.promisor=true", *args], env)
    if result.returncode == 0:
        return True
    return git(bare, args, env).returncode == 0


def merge_base(bare: Path, base: str, head: str, env: dict[str, str]) -> str | None:
    result = git(bare, ["merge-base", base, head], env)
    return result.stdout.decode().strip() if result.returncode == 0 else None


def find_base(
    bare: Path, base: str, head: str, base_url: str, head_url: str,
    env: dict[str, str], base_repo: str = "", head_repo: str = "",
) -> str | None:
    for depth in (64, 512, 4096):
        if fetch_commit(bare, base_url, base, env, depth, base_repo) and fetch_commit(bare, head_url, head, env, depth, head_repo):
            found = merge_base(bare, base, head, env)
            if found:
                return found
    return None


def decode_git_path(value: str) -> str:
    value = value.strip().rstrip('"')
    if value.startswith('"'):
        value = value[1:]
    if "\\" in value:
        try:
            decoded = codecs.decode(value, "unicode_escape")
            return decoded.encode("latin-1").decode("utf-8")
        except UnicodeDecodeError:
            return value
    return value


def parse_raw(raw: bytes) -> dict[str, list[str]]:
    symlinks, submodules, paths, statuses, renames, gitlinks = [], [], [], {}, {}, {}
    tokens = [token for token in raw.split(b"\0") if token]
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if not token.startswith(b":"):
            continue
        fields = token[1:].split()
        status = diff.decode(fields[4]) if len(fields) > 4 else ""
        if index >= len(tokens):
            break
        old = decode_git_path(diff.decode(tokens[index]))
        index += 1
        new = old
        if status.startswith(("R", "C")) and index < len(tokens):
            new = decode_git_path(diff.decode(tokens[index]))
            renames[new] = old
            index += 1
        paths.append(new)
        statuses[new] = status
        mode = fields[1].decode()
        if mode == "120000":
            symlinks.append(new)
        if mode == "160000" or new.endswith(".gitmodules"):
            submodules.append(new)
        if mode == "160000" and len(fields) > 3:
            gitlinks[new] = (fields[2].decode(), fields[3].decode())
    return {
        "symlinks": symlinks, "submodules": submodules, "paths": paths,
        "statuses": statuses, "renames": renames, "submodule_shas": gitlinks,
    }


def too_large(stats: dict[str, int], max_files: int, max_lines: int) -> bool:
    return stats["files"] > max_files or stats["lines"] > max_lines


def numstat(bare: Path, base: str, head: str, env: dict[str, str]) -> dict[str, int]:
    result = git(bare, ["diff", "--numstat", "-z", f"{base}...{head}", "--"], env)
    files = lines = 0
    for row in result.stdout.split(b"\0"):
        fields = row.split(b"\t")
        if len(fields) < 3:
            continue
        files += 1
        if fields[0].isdigit():
            lines += int(fields[0])
        if fields[1].isdigit():
            lines += int(fields[1])
    return {"files": files, "lines": lines}


def patch_text(bare: Path, base: str, head: str, env: dict[str, str]) -> str:
    result = git(bare, [
        "diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--patch", "--text",
        f"{base}...{head}", "--",
    ], env)
    return diff.decode(result.stdout)


def parse_patches(text: str, max_lines: int = 50_000) -> tuple[dict[str, str], dict[str, set[int]], dict[str, list[list[int]]], dict[str, set[int]], list[str]]:
    patches, added, blocks, removed, oversize = {}, {}, {}, {}, []
    current = None
    for line in diff.split_nl(text):
        if line.startswith("diff --git "):
            rest = line[len("diff --git "):]
            marker = rest.find(" b/")
            if marker < 0:
                marker = rest.find('"b/')
            current = decode_git_path(rest[marker + 3:]) if marker >= 0 else None
            if current:
                patches[current] = ""
                added[current] = set()
                removed[current] = set()
        elif current and not line.startswith(("index ", "similarity ", "rename ", "new file ", "deleted file ")):
            patches[current] += line + "\n"
    for path, patch in patches.items():
        added[path] = diff.added_lines(patch)
        removed[path] = diff.removed_lines(patch)
        blocks[path] = diff.added_blocks(patch)
        if len(added[path]) > max_lines:
            oversize.append(path)
    return patches, added, blocks, removed, oversize


def file_text(bare: Path, sha: str, path: str, env: dict[str, str]) -> str:
    data = blob(bare, sha, path, env)
    return diff.decode(data) if data is not None else ""


def domains(bare: Path, sha: str, env: dict[str, str]) -> set[str]:
    result = git(bare, ["grep", "-h", "-I", "-E", "https?://", sha, "--"], env)
    found = set()
    for url in diff.extract_urls(diff.decode(result.stdout)):
        host = diff.domain(url)
        if host:
            found.add(host)
    return found


def blob(bare: Path, head: str, path: str, env: dict[str, str]) -> bytes | None:
    if ".." in Path(path).parts or Path(path).is_absolute():
        return None
    result = git(bare, ["show", f"{head}:{path}"], env)
    return result.stdout if result.returncode == 0 else None


def analyze(bare: Path, base: str, head: str, env: dict[str, str], max_files: int, max_lines: int) -> dict:
    raw = git(bare, ["diff", "--raw", "-z", f"{base}...{head}", "--"], env).stdout
    parsed = parse_raw(raw)
    stats = numstat(bare, base, head, env)
    patches, added, blocks, removed, oversize = parse_patches(patch_text(bare, base, head, env))
    blobs = {}
    binary_info = {}
    for path in parsed["paths"]:
        data = blob(bare, head, path, env)
        if data is not None:
            blobs[path] = data
        if diff.binary_path(path) or diff.is_binary_sample((data or b"")[:8192]):
            old_data = blob(bare, base, path, env) or b""
            binary_info[path] = {
                "old_size": len(old_data),
                "new_size": len(data or b""),
                "old_sha": hashlib.sha256(old_data).hexdigest() if old_data else "",
                "new_sha": hashlib.sha256(data or b"").hexdigest(),
            }
    return {
        **parsed,
        "stats": stats,
        "patches": patches,
        "added": added,
        "blocks": blocks,
        "removed": removed,
        "blobs": blobs,
        "binary_info": binary_info,
        "oversize": oversize,
        "too_large": too_large(stats, max_files, max_lines) or bool(oversize),
    }


class HistoryChecker:
    """Proves that a whole added block existed in one upstream tree."""

    def __init__(self, bare: Path | None, base: str, tip: str, env: dict[str, str], cap: int = 100):
        self.bare = bare
        self.base = base
        self.tip = tip
        self.env = env
        self.cap = cap
        self.used = 0
        self.cap_hit = False
        self.cache: dict[tuple[str, tuple[str, ...]], dict | None] = {}

    def lookup(self, path: str, wanted: tuple[str, ...]) -> dict | None:
        if not wanted:
            return None
        key = (path, wanted)
        if key in self.cache:
            return self.cache[key]
        if self.used >= self.cap:
            self.cap_hit = True
            return None
        self.used += 1
        proof = self._contains(self.base, path, wanted)
        if proof:
            self.cache[key] = proof
            return proof
        candidates = self._candidates(path, wanted[0])
        for sha in candidates[:5]:
            if self.used >= self.cap:
                self.cap_hit = True
                break
            self.used += 1
            proof = self._contains(sha, path, wanted)
            if proof:
                self.cache[key] = proof
                return proof
        self.cache[key] = None
        return None

    def _contains(self, sha: str, path: str, wanted: tuple[str, ...]) -> dict | None:
        text = file_text(self.bare, sha, path, self.env)
        lines = tuple(diff.display_line(line).strip() for line in diff.split_nl(text))
        for index in range(len(lines) - len(wanted) + 1):
            if lines[index:index + len(wanted)] == wanted:
                return {
                    "path": path,
                    "upstream_commit": sha,
                    "base_sha": self.base,
                    "upstream_sha": self.tip,
                }
        return None

    def _candidates(self, path: str, needle: str) -> list[str]:
        result = git(self.bare, [
            "log", "--format=%H", "-F", f"-S{needle}", f"{self.base}..{self.tip}", "--", path,
        ], self.env)
        return diff.decode(result.stdout).split()
