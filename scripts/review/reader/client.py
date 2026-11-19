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


class ProviderError(Exception):
    """A request-level provider refusal; the key is never included."""


class ShapeError(ValueError):
    """A response whose shape is not the contracted one; never carries response text."""


@dataclass(frozen=True)
class Config:
    base_url: str
    model: str
    key: str = field(repr=False)
    effort: str = "high"
    session: str = "run"


CHARS_PER_TOKEN = 4
DEFAULT_TOKEN_BUDGET = 3_000_000
# Effort "max" can think for minutes; 60 s cut real reads short.
REQUEST_TIMEOUT = 300


@dataclass
class TokenBudget:
    limit: int = 100_000
    used: int = 0

    def tokens(self) -> int:
        return self.used // CHARS_PER_TOKEN

    def spend(self, amount: int) -> bool:
        if self.used + amount > self.limit:
            return False
        self.used += amount
        return True


def budget_from_env() -> TokenBudget:
    """REVIEW_TOKEN_BUDGET is a token limit; spend() counts characters."""
    tokens = int(os.environ.get("REVIEW_TOKEN_BUDGET", DEFAULT_TOKEN_BUDGET))
    return TokenBudget(limit=tokens * CHARS_PER_TOKEN)


def from_env(prefix: str) -> Config | None:
    base = os.environ.get(prefix + "_BASE_URL", "")
    model = os.environ.get(prefix + "_MODEL", "")
    key = os.environ.get(prefix + "_KEY", "")
    if base and model and key:
        return Config(
            base, model, key,
            os.environ.get(prefix + "_EFFORT", "max"),
            os.environ.get("REVIEW_SESSION", "run"),
        )
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


def headers(config: Config, session: str | None = None) -> dict:
    return {
        "Content-Type": "application/json",
        "User-Agent": "kalsa-review/1.0 (+https://kalsa.io)",
        "x-opencode-session": session or config.session,
        "Authorization": "Bearer " + config.key,
    }


def _http(config: Config, request: dict, effort: str) -> dict:
    body = json.dumps({**request, "model": config.model, "reasoning_effort": effort}).encode()
    req = urllib.request.Request(
        config.base_url.rstrip("/") + "/chat/completions",
        data=body,
        headers=headers(config),
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 400 and "reasoning_effort" in error.read().decode(errors="ignore"):
            raise ProviderError("reasoning_effort rejected") from error
        raise


def _unsure(block: dict, config: Config, reason: str, effort: str) -> dict:
    return {
        "id": block.get("id", ""), "verdict": "unsure", "reason": reason,
        "quoted_line": "", "model": config.model, "effort": effort,
    }


def _failure_reason(error: BaseException) -> str:
    """Name the cause class; never the response text, keys or headers."""
    if isinstance(error, TimeoutError):
        return "reader timeout"
    if isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError):
        return "reader timeout"
    if isinstance(error, urllib.error.HTTPError):
        return f"reader error: http {error.code // 100}xx"
    if isinstance(error, (ShapeError, KeyError, TypeError)):
        return "reader error: shape"
    if isinstance(error, json.JSONDecodeError):
        return "reader error: json"
    return "reader error"


def tally(rows: list[dict]) -> dict:
    """Count transport failures separately from a model's own 'unsure'."""
    counts = {"timeouts": 0, "errors": 0, "budget": 0, "unsure": 0, "error_classes": {}}
    for row in rows:
        reason = row.get("reason", "")
        if reason == "reader timeout":
            counts["timeouts"] += 1
        elif reason.startswith("reader error"):
            counts["errors"] += 1
            classes = counts["error_classes"]
            classes[reason] = classes.get(reason, 0) + 1
        elif reason == "budget reached":
            counts["budget"] += 1
        elif row.get("verdict") == "unsure":
            counts["unsure"] += 1
    return counts


def _results_rows(content: str) -> list:
    """response_format json_object means the API returns an object, never an array."""
    payload = json.loads(content)
    if not isinstance(payload, dict) or set(payload) != {"results"}:
        raise ShapeError("unexpected top-level keys")
    rows = payload["results"]
    if not isinstance(rows, list):
        raise ShapeError("results is not an array")
    return rows


def _index_rows(rows, group: list[dict]) -> dict:
    """One row per block id; duplicate, missing or extra ids are refusals."""
    if not isinstance(rows, list) or len(rows) != len(group):
        raise ShapeError("wrong result count")
    by_id = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ShapeError("malformed row")
        identifier = row.get("id")
        if identifier in by_id:
            raise ShapeError("duplicate id")
        by_id[identifier] = row
    if set(by_id) != {block.get("id", "") for block in group}:
        raise ShapeError("wrong ids")
    return by_id


def _read_group(config: Config, group: list[dict], request: dict, http) -> list[dict]:
    """One request group: effort fallback, three attempts, one verdict per block id."""
    efforts = [config.effort, "high"] if config.effort == "max" else [config.effort]
    fallback = [_unsure(block, config, "reader error", config.effort) for block in group]
    for effort in efforts:
        for attempt in range(3):
            try:
                response = (http or _http)(config, request, effort)
                by_id = _index_rows(_results_rows(response["choices"][0]["message"]["content"]), group)
                return [
                    {**_validate(by_id[block.get("id", "")], block), "model": config.model, "effort": effort}
                    for block in group
                ]
            except ProviderError:
                break
            except (KeyError, TypeError, ValueError, json.JSONDecodeError, urllib.error.URLError, OSError) as error:
                if attempt < 2:
                    time.sleep(0.01 * 2 ** attempt)
                    continue
                # A later effort replaces these rows; it never appends to them.
                reason = _failure_reason(error)
                fallback = [_unsure(block, config, reason, effort) for block in group]
    return fallback


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
        delimiter = "KALSA-" + secrets.token_hex(12)
        request = build_request(prompt.READER_PROMPT_V2, group, hints, precedents, delimiter)
        # Spend the whole request: prompt, hints, precedents and blocks.
        if not budget.spend(len(request["messages"][0]["content"])):
            return [_unsure(row, config, "budget reached", config.effort) for row in blocks]
        results.extend(_read_group(config, group, request, http))
    return results
