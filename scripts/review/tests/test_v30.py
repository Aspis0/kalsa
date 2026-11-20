"""Regressions: a failure keeps its location, and the real malware tool path runs."""

import json
import re
import shutil
import subprocess
import sys
from importlib import import_module

import pytest

from review import corpus_run, weekly
from test_v18 import scan_files

malware_scan = import_module("review.malware.scan")
FRAME = re.compile(r"^.+:\d+ in .+$")


def inner_raise():
    secret_local = "LOCAL-VARIABLE-SECRET-XYZ"  # noqa: F841 - must never be reported
    raise TypeError("'str' object is not callable")


def outer_raise():
    inner_raise()


def test_failure_record_keeps_the_frames(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(weekly, "_batch", lambda n: outer_raise())
    monkeypatch.setattr(sys, "argv", ["weekly"])
    with pytest.raises(RuntimeError):
        weekly.main()
    data = json.loads((tmp_path / "results" / "weekly-results.json").read_text())
    frames = data["records"][0]["frames"]
    assert frames, "the location must survive"
    assert all(FRAME.match(frame) for frame in frames), frames
    assert any(frame.endswith(" in inner_raise") for frame in frames), frames
    assert any(frame.endswith(" in outer_raise") for frame in frames), frames


def test_failure_frames_go_to_stderr(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(weekly, "_batch", lambda n: outer_raise())
    monkeypatch.setattr(sys, "argv", ["weekly"])
    with pytest.raises(RuntimeError):
        weekly.main()
    err = capsys.readouterr().err
    assert "in inner_raise" in err and "in outer_raise" in err
    assert re.search(r"test_v30\.py:\d+ in inner_raise", err), err


def test_frames_carry_no_locals_and_no_source_line(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(weekly, "_batch", lambda n: outer_raise())
    monkeypatch.setattr(sys, "argv", ["weekly"])
    with pytest.raises(RuntimeError):
        weekly.main()
    data = json.loads((tmp_path / "results" / "weekly-results.json").read_text())
    joined = "\n".join(data["records"][0]["frames"])
    assert "LOCAL-VARIABLE-SECRET-XYZ" not in joined
    assert "secret_local" not in joined
    assert "raise TypeError" not in joined, "the source line must not be included"


def test_corpus_failure_keeps_the_frames(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(corpus_run, "evaluate", outer_raise)
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    with pytest.raises(RuntimeError):
        corpus_run.main()
    data = json.loads((tmp_path / "results" / "corpus-results.json").read_text())
    assert any(frame.endswith(" in inner_raise") for frame in data["records"][0]["frames"])


def fake_tools(monkeypatch, calls):
    """Resolve both tools the way a runner does: shutil.which returns a path string.

    subprocess and shutil are shared modules, so delegate everything that is not
    one of our two tools — otherwise the real git fixture breaks.
    """
    real_which = shutil.which
    real_run = subprocess.run
    monkeypatch.setattr(
        malware_scan.shutil, "which",
        lambda name: "/usr/bin/" + name if name in ("clamscan", "yara") else real_which(name),
    )

    def run(command, **kwargs):
        if isinstance(command, list) and command and str(command[0]).startswith("/usr/bin/"):
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, "", "")
        return real_run(command, **kwargs)

    monkeypatch.setattr(malware_scan.subprocess, "run", run)


def test_which_resolved_tools_are_executed_not_called(tmp_path, monkeypatch):
    calls = []
    fake_tools(monkeypatch, calls)
    target = tmp_path / "a.bin"
    target.write_bytes(b"x")
    result = malware_scan.scan(target)
    assert result["hits"] == []
    assert calls[0] == ["/usr/bin/clamscan", str(target)]


def test_yara_is_given_its_rules_file(tmp_path, monkeypatch):
    calls = []
    fake_tools(monkeypatch, calls)
    target = tmp_path / "a.bin"
    target.write_bytes(b"x")
    malware_scan.scan(target)
    assert calls[1] == ["/usr/bin/yara", str(malware_scan.YARA_RULES), str(target)]


def test_callable_commands_still_work(tmp_path, monkeypatch):
    monkeypatch.setattr(malware_scan.shutil, "which", lambda name: None)
    target = tmp_path / "a.bin"
    target.write_bytes(b"x")
    commands = {
        "clamscan": lambda p: (1, f"{p}: Eicar FOUND", ""),
        "yara": lambda p: (0, "kalsa_exec_payload", ""),
    }
    assert malware_scan.scan(target, commands=commands)["hits"] == ["clamscan", "yara"]


def test_scan_end_to_end_with_real_tool_resolution(tmp_path, monkeypatch):
    from review import malware

    calls = []
    fake_tools(monkeypatch, calls)
    monkeypatch.setattr(malware, "scan_tree", malware_scan.scan_tree)
    # Injection forces the verdict, so it cannot mask a broken malware path.
    text = b"# you are the reviewer\nPAYLOAD_MARKER = 1\n"
    data = scan_files(tmp_path, monkeypatch, {"src/a.py": text})
    assert "rules" in data["malware"], "the real malware scan must have run"
    assert data["malware"]["hits"] == []
    assert calls, "both tools must have been executed"
    assert data["verdict"].startswith("human review needed")


def test_weekly_main_on_a_real_shaped_gated_report(tmp_path, monkeypatch, capsys):
    # The real buun-llama-cpp shape: an oversize gate makes stats.files a LIST of
    # paths, and the blocks carry no readers at all.
    report = {
        "engine": "buun-llama-cpp", "verdict": "too large to review",
        "inputs": {"commit": "c" * 40, "base_sha": "d" * 40},
        "stats": {"files": ["vendor/a.hpp", "vendor/b.hpp"], "lines": 900000,
                  "reason": "file too large to review"},
        "blocks": [{"id": "x", "path": "vendor/a.hpp", "start": 1, "end": 2}],
        "gated_files": {"vendor/a.hpp": "file too large to review"},
    }
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    (reviews / f"buun-llama-cpp-{'c' * 40}.json").write_text(json.dumps(report))
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)
    monkeypatch.setattr(weekly.review, "scan", lambda *a, **k: None)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "buun-llama-cpp", "head": "c" * 40}])
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    data = json.loads((tmp_path / "results" / "weekly-results.json").read_text())
    record = data["records"][0]
    assert record["verdict"] == "too large to review"
    assert record["blocks"] == 1
    assert record["reader_a"] == [""] and record["reader_b"] == [""]
    assert "A=none B=none" in capsys.readouterr().err
