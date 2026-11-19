"""False-positive regressions through the real semgrep gate, not helper regexes."""

import json

from review.scanners import common, plain as plain_scan, semgrep as semgrep_gate


def gate(tmp_path, monkeypatch, rows, added):
    (tmp_path / "src").mkdir(exist_ok=True)
    (tmp_path / "tests").mkdir(exist_ok=True)
    (tmp_path / "src/main.py").write_text("exec(requests.get(u).text)\n")
    (tmp_path / "src/generate.cpp").write_text('fprintf(stderr, "RAM telemetry unavailable\\n");\n')
    (tmp_path / "tests/test-backend-ops.cpp").write_text("test->eval(b, b_cpu, n_batch, n_ubatch);\n")
    files = list(tmp_path.glob("*/*"))
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps({"results": rows}), ""))
    findings, signals = semgrep_gate.scan(files, tmp_path, added)
    return findings, signals


def row(path, rule="kalsa.eval-python", line=1):
    return {"check_id": rule, "path": path, "start": {"line": line}, "extra": {"lines": "requires login"}}


def test_cpp_eval_method_is_suppressed(tmp_path, monkeypatch):
    findings, signals = gate(tmp_path, monkeypatch, [row("tests/test-backend-ops.cpp")], {"tests/test-backend-ops.cpp": {1}})
    assert not findings
    assert signals[0]["rule"] == "kalsa.eval-python"
    assert signals[0]["suppressed_because"] == "not-added-or-not-reaches-users"
    assert signals[0]["snippet"] == "test->eval(b, b_cpu, n_batch, n_ubatch);"


def test_telemetry_log_word_is_suppressed(tmp_path, monkeypatch):
    findings, signals = gate(tmp_path, monkeypatch, [row("src/generate.cpp", "kalsa.telemetry-endpoint")], {})
    assert not findings and signals[0]["rule"] == "kalsa.telemetry-endpoint"


def test_added_python_exec_is_a_finding(tmp_path, monkeypatch):
    findings, _ = gate(tmp_path, monkeypatch, [row("src/main.py")], {"src/main.py": {1}})
    assert findings[0]["rule"] == "kalsa.eval-python"
    assert findings[0]["snippet"] == "exec(requests.get(u).text)"


def test_ci_wget_is_suppressed(tmp_path, monkeypatch):
    (tmp_path / "ci").mkdir()
    (tmp_path / "ci/run.sh").write_text("gg_wget https://huggingface.co/ggml-org/models/x.gguf\n")
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(
        0,
        json.dumps({"results": [row("ci/run.sh", "kalsa.download-in-build")]}),
        "",
    ))
    findings, signals = semgrep_gate.scan([tmp_path / "ci/run.sh"], tmp_path, {"ci/run.sh": {1}})
    assert not findings and signals[0]["suppressed_because"] == "not-added-or-not-reaches-users"


def test_new_shared_object_outside_tests_is_a_binary_finding(tmp_path):
    path = tmp_path / "libevil.so"
    path.write_bytes(b"\x7fELF\x02\x01\x01\x00")
    findings, _, _ = plain_scan.scan([path], [], tmp_path, "owner/fork", "upstream/repo")
    assert findings[0]["rule"] == "binary-or-nul-content"


def test_unresolved_and_constructed_urls():
    unresolved = plain_scan.classify_url(
        {"url": "http://$host:$port/v1", "file": "src/main.py", "line": 1, "comment": False},
        "owner/fork", "upstream/repo",
    )
    assert not unresolved["signal"] and unresolved["row"]["rule"] == "unresolved-host"
    constructed = plain_scan.classify_url(
        {"url": 'https://" + host', "file": "src/main.py", "line": 1, "comment": False},
        "owner/fork", "upstream/repo",
    )
    assert not constructed["signal"] and constructed["row"]["rule"] == "constructed-url"
