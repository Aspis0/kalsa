"""All review rules are text-based; partial parses are signals, not extra scans."""

import json

from review.scanners import common, semgrep as semgrep_gate


def test_partial_parse_is_a_signal_not_a_finding_or_scanner_error(tmp_path, monkeypatch):
    source = tmp_path / "src/a.cpp"
    source.parent.mkdir()
    source.write_text('void f(){ system("id"); }\n')
    payload = {
        "results": [{
            "check_id": "kalsa.cpp-process-exec", "path": "src/a.cpp",
            "start": {"line": 1}, "end": {"line": 1}, "extra": {},
        }],
        "errors": [{"code": 3, "type": "SemgrepError", "message": "PartialParsing at line src/a.cpp:1", "path": "src/a.cpp"}],
        "paths": {"skipped": []},
    }
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, signals = semgrep_gate.scan([source], tmp_path, {"src/a.cpp": {1}})
    assert any(row["rule"] == "kalsa.cpp-process-exec" for row in findings)
    assert any(row["suppressed_because"] == "partial-parse" for row in signals)
    assert not any(row["rule"] == "scanner-error" for row in findings + signals)
