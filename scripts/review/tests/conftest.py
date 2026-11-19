import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1].parent))

from review import malware, reader  # noqa: E402


def _harmless(_config, request):
    body = request["messages"][0]["content"]
    start = body.index('"blocks": ') + len('"blocks": ')
    blocks = json.JSONDecoder().raw_decode(body[start:])[0]
    rows = []
    for block in blocks:
        line = next(
            (
                item.strip() for item in block["text"].split("\n")
                if len([char for char in item if not char.isspace()]) >= 8
            ),
            "valid code line",
        )
        rows.append({
            "id": block["id"], "verdict": "harmless", "reason": "ok",
            "quoted_line": line,
        })
    return {"choices": [{"message": {"content": json.dumps(rows)}}]}


@pytest.fixture(autouse=True)
def fake_external_services(monkeypatch):
    monkeypatch.setattr(
        malware,
        "scan_tree",
        lambda paths, rules=None: {"hits": [], "rules": rules or {"version": "v", "sha256": "s"}},
    )
    for prefix, model in (("REVIEW_A", "a-model"), ("REVIEW_B", "b-model")):
        monkeypatch.setenv(prefix + "_BASE_URL", "https://invalid.local/v1")
        monkeypatch.setenv(prefix + "_MODEL", model)
        monkeypatch.setenv(prefix + "_KEY", "k")
    monkeypatch.setattr(reader.client, "_http", _harmless)
