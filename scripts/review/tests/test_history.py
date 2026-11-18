"""Block-level upstream-history attribution tests."""

from review import localdiff, review


def test_exact_block_in_base_is_proved(monkeypatch):
    def fake_file_text(bare, sha, path, env):
        if sha == "base":
            return "one\n  execute_process(  \n    COMMAND sh\n)\n"
        return "one\n"
    monkeypatch.setattr(localdiff, "file_text", fake_file_text)
    checker = localdiff.HistoryChecker(None, "base", "tip", {}, 10)
    proof = checker.lookup("CMakeLists.txt", ("execute_process(", "COMMAND sh", ")"))
    assert proof and proof["base_sha"] == "base"
    assert checker.lookup("CMakeLists.txt", ("different",)) is None


def test_cap_is_fail_closed(monkeypatch):
    monkeypatch.setattr(localdiff, "file_text", lambda *a: "")
    monkeypatch.setattr(localdiff.HistoryChecker, "_candidates", lambda self, path, needle: [])
    checker = localdiff.HistoryChecker(None, "base", "tip", {}, 1)
    assert checker.lookup("a", ("one",)) is None
    assert checker.lookup("b", ("two",)) is None
    assert checker.cap_hit


def test_history_filter_keeps_unproved_block(monkeypatch):
    findings = [{"tool": "semgrep", "file": "src/a.cpp", "line": 3, "rule": "kalsa.cpp-process-exec", "snippet": "dlopen(x)"}]
    blocks = {"src/a.cpp": [[2, 3, 4]]}
    lines = {"src/a.cpp": ["int f() {", "  dlopen(x);", "  return 0;", "}"]}
    monkeypatch.setattr(localdiff.HistoryChecker, "lookup", lambda self, path, wanted: None)
    checker = localdiff.HistoryChecker(None, "base", "tip", {}, 10)
    kept, signals = review.history_filter(findings, checker, blocks, lines)
    assert kept and not signals
