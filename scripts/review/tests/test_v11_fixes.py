"""Failing-first regressions from audit v11."""

import json
from pathlib import Path

import pytest

from review import apply as review_apply
from review.scanners import plain


def assess(path, data):
    return plain.assess_binary(path, data)


def test_c_hex_escape_is_not_binary_content():
    assert assess("src/h.c", b'char *s = "\\x41";\n') == (False, False)


def test_png_polyglot_with_elf_or_zip_needs_person():
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    for magic in (b"\x7fELF", b"PK\x03\x04"):
        needs_person, plain_asset = assess("a.png", png + b"x" * 100 + magic)
        assert needs_person and not plain_asset


def test_nul_after_first_8kb_needs_person():
    data = b"int a;\n" + b"x" * 9000 + b"\x00\nint b;\n"
    assert assess("src/a.c", data)[0] is True


def test_nul_in_text_docs_needs_person():
    for path in ("README.md", "notes.txt", "docs/guide.rst"):
        assert assess(path, b"hello\x00world\n")[0] is True


def test_apply_plain_gate_error_mentions_needs_person(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"; reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "human review needed", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork"},
        "findings": [{
            "file": "x", "line": 0, "rule": "binary-or-nul-content",
            "snippet": "x", "needs_person": True,
        }],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError, match="need a person"):
        review_apply.apply_review("one", catalog)
