"""Dependency parsing for lockfiles and Python/npm manifests."""

from __future__ import annotations

import json
import re

from .diff import split_nl


def values(text: str) -> dict[str, str]:
    result = {}
    for line in split_nl(text):
        clean = line.strip().lstrip("-+")
        if not clean or clean.startswith("#"):
            continue
        match = re.match(r'["\']?([A-Za-z0-9_.@/-]+)["\']?["\']?\s*(?:==|>=|<=|~=|!=|:|=|\^)\s*["\']?([^"\',;]+)', clean)
        if match:
            name = re.sub(r"[-_.]+", "-", match.group(1)).lower()
            result[name] = match.group(2).strip().strip("\"'")
    return result


def lock_values(text: str) -> dict[str, str]:
    values = {}
    current = ""
    for line in split_nl(text):
        match = re.match(r'name = "([^"]+)"', line)
        if match:
            current = match.group(1)
        version = re.match(r'version = "([^"]+)"', line)
        if current and version:
            values[current] = version.group(1)
            current = ""
    return values


def json_values(text: str) -> dict[str, str]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    values = dict(data.get("dependencies", {}))
    for key, value in data.get("packages", {}).items():
        if key and value.get("version"):
            values[key.rsplit("node_modules/", 1)[-1]] = value["version"]
    return {key: str(value) for key, value in values.items()}


def added_dependencies(fork_text: str, upstream_text: str) -> set[str]:
    before, after = values(upstream_text), values(fork_text)
    return {name for name, version in after.items() if before.get(name) != version}


def changed_dependencies(path: str, fork_text: str, upstream_text: str) -> set[str]:
    name = path.lower()
    if name.endswith("cargo.lock"):
        before, after = lock_values(upstream_text), lock_values(fork_text)
    elif name.endswith(("package.json", "package-lock.json")):
        before, after = json_values(upstream_text), json_values(fork_text)
    else:
        return added_dependencies(fork_text, upstream_text)
    return {name for name, version in after.items() if before.get(name) != version}
