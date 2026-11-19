"""The response shape the real API returns: content is a JSON *object* with "results".

Both live models also send reasoning fields; keeping them here stops a list-shaped
fake from hiding a contract mismatch again.
"""

import json


def message(content: str, **fields) -> dict:
    base = {
        "role": "assistant",
        "content": content,
        "reasoning_content": "thinking",
        "reasoning": "thinking",
    }
    base.update(fields)
    return {"choices": [{"message": base}]}


def results(rows: list, **fields) -> dict:
    return message(json.dumps({"results": rows}), **fields)
