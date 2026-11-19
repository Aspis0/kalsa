"""Chat client with strict JSON validation."""

from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from . import prompt


SCHEMA = {"verdict": {"type": "string", "enum": ["harmless", "suspicious", "unsure"]}}


@dataclass(frozen=True)
class Config:
    base_url: str
    model: str
    key: str = field(repr=False)


@dataclass
class TokenBudget:
    limit: int = 100_000
    used: int = 0

    def spend(self, amount: int) -> bool:
        if self.used + amount > self.limit:
            return False
        self.used += amount
        return True


def from_env(prefix: str) -> Config | None:
    base = os.environ.get(prefix + "_BASE_URL", "")
    model = os.environ.get(prefix + "_MODEL", "")
    key = os.environ.get(prefix + "_KEY", "")
    if base and model and key:
        return Config(base, model, key)
    return None


def build_request(prompt: str, blocks: list[dict], hints: list[str], precedents: list[dict], delimiter: str) -> dict:
    payload = {
        "blocks": [{"id": row.get("id", ""), "text": row.get("text", "")} for row in blocks],
        "hints": hints,
        "precedents": precedents,
    }
    content = (
        prompt
        + f"\nData delimiters: {delimiter}\n{delimiter}\n"
        + json.dumps(payload, sort_keys=True)
        + f"\n{delimiter}\n"
    )
    return {
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }


def chunks(blocks: list[dict], max_chars: int = 12_000) -> list[list[dict]]:
    result, current, size = [], [], 0
    for block in blocks:
        length = len(block.get("text", ""))
        if current and size + length > max_chars:
            result.append(current)
            current, size = [], 0
        current.append(block)
        size += length
    if current:
        result.append(current)
    return result


def _validate(row: dict, block: dict) -> dict:
    if (
        not isinstance(row, dict)
        or set(row) != {"id", "verdict", "reason", "quoted_line"}
        or row.get("verdict") not in {"harmless", "suspicious", "unsure"}
    ):
        return {"id": block.get("id", ""), "verdict": "unsure", "reason": "invalid shape", "quoted_line": ""}
    if row["id"] != block.get("id") or str(row["quoted_line"]).strip() not in block.get("text", ""):
        return {"id": block.get("id", ""), "verdict": "unsure", "reason": "bad id or quote", "quoted_line": ""}
    return row


def _http(config: Config, request: dict) -> dict:
    body = json.dumps({**request, "model": config.model}).encode()
    req = urllib.request.Request(
        config.base_url.rstrip("/") + "/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + config.key,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def read(
    config: Config,
    blocks: list[dict],
    hints: list[str],
    precedents: list[dict],
    http=None,
    budget: TokenBudget | None = None,
) -> list[dict]:
    budget = budget or TokenBudget()
    results = []
    for group in chunks(blocks):
        if not budget.spend(sum(len(row.get("text", "")) for row in group)):
            return [{"id": row.get("id", ""), "verdict": "unsure", "reason": "budget exhausted", "quoted_line": ""} for row in blocks]
        delimiter = "KALSA-" + secrets.token_hex(12)
        request = build_request(prompt.READER_PROMPT_V1, group, hints, precedents, delimiter)
        for attempt in range(3):
            try:
                response = (http or _http)(config, request)
                content = response["choices"][0]["message"]["content"]
                rows = json.loads(content)
                if not isinstance(rows, list) or len(rows) != len(group):
                    raise ValueError("wrong result count")
                ids = {row.get("id") for row in rows if isinstance(row, dict)}
                if ids != {row.get("id") for row in group}:
                    raise ValueError("wrong ids")
                for row, block in zip(rows, group):
                    validated = _validate(row, block)
                    validated["model"] = config.model
                    results.append(validated)
                break
            except (KeyError, TypeError, ValueError, json.JSONDecodeError, urllib.error.URLError, OSError):
                if attempt == 2:
                    results.extend(
                        {
                            "id": row.get("id", ""), "verdict": "unsure", "reason": "reader error",
                            "quoted_line": "", "model": config.model,
                        }
                        for row in group
                    )
                else:
                    time.sleep(0.01 * 2 ** attempt)
    return results
