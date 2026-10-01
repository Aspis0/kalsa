"""HTTP /v1/chat/completions client for the eval runners, with retry.

Responsibility: one place for the request shape — greedy, seeded, product
thinking ON via chat_template_kwargs (templates that ignore the kwarg are
unaffected) — plus bounded retries on transient failures so one blip does
not discard a paid arm, and correct handling of reasoning_content (the
server may move reasoning out of `content` into `reasoning_content`;
runners must look at both, audit M10).
"""

import json
import time
import urllib.error
import urllib.request


def chat(server: str, messages: list, max_tokens: int, *,
         tools: list | None = None, timeout: int = 1800, retries: int = 2) -> dict:
    body = {"messages": messages, "temperature": 0.0, "max_tokens": max_tokens,
            "seed": 42, "stream": False,
            "chat_template_kwargs": {"enable_thinking": True}}
    if tools:
        body["tools"] = tools
    last: Exception | None = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{server}/v1/chat/completions", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                msg = json.load(r)["choices"][0]
            out = msg.get("message", {})
            return {"content": out.get("content", "") or "",
                    "reasoning_content": out.get("reasoning_content", "") or "",
                    "tool_calls": out.get("tool_calls", []) or [],
                    "finish_reason": msg.get("finish_reason", "")}
        except (OSError, TimeoutError) as e:  # HTTPError/URLError are OSErrors
            last = e
            if attempt < retries:
                time.sleep(5 * (attempt + 1))
    raise last  # the caller fails the stage; the journal keeps what landed
