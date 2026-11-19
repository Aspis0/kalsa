"""Failing-first regressions: chunking instead of truncation, digest escaping."""

import json
import subprocess

from review import diff, pr_step, review
from review.scanners import plain
from image_fixtures import chunk, png
from test_v16 import git, scan_fixture


def big_fork_fixture(tmp_path, body):
    """Two commits; the second adds big.py with `body`. Returns (first, second, remote)."""
    work, remote = tmp_path / "work", tmp_path / "remote.git"
    work.mkdir()
    git(work, "init", "-b", "main")
    git(work, "config", "user.email", "t@e")
    git(work, "config", "user.name", "T")
    (work / "a.py").write_text("def a():\n    return 1\n")
    git(work, "add", ".")
    git(work, "commit", "-m", "first")
    first = git(work, "rev-parse", "HEAD")
    (work / "big.py").write_text(body)
    git(work, "add", ".")
    git(work, "commit", "-m", "second")
    second = git(work, "rev-parse", "HEAD")
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "origin", "main")
    git(remote, "config", "uploadpack.allowAnySHA1InWant", "true")
    return first, second, remote


def thousand_lines():
    lines = [f"line_{i}" for i in range(1, 1001)]
    lines[949] = "payload = 'evil'"
    return lines


def info_for(path, text, numbers):
    return {
        "blocks": {path: [numbers]}, "blobs": {path: text.encode()},
        "paths": [path], "statuses": {path: "A"},
    }


def test_thousand_line_block_becomes_three_chunks():
    lines = thousand_lines()
    rows = review.export_blocks(info_for("big.py", "\n".join(lines) + "\n", list(range(1, 1001))))
    assert len(rows) == 3
    covered = [number for row in rows for number in range(row["start"], row["end"] + 1)]
    assert covered == list(range(1, 1001))
    assert [row["part"] for row in rows] == [1, 2, 3]
    assert [row["parts"] for row in rows] == [3, 3, 3]
    assert len({row["id"] for row in rows}) == 3
    assert any("payload = 'evil'" in row["text"] for row in rows)
    assert all(row["context"] for row in rows)


def test_byte_cap_splits_chunks_and_keeps_every_line():
    text = "\n".join(["x" * 1000] * 100) + "\n"
    rows = review.export_blocks(info_for("big.py", text, list(range(1, 101))))
    assert len(rows) == 3
    covered = [number for row in rows for number in range(row["start"], row["end"] + 1)]
    assert covered == list(range(1, 101))
    assert all(len(row["text"].encode()) <= diff.MAX_BLOCK_BYTES for row in rows)


def test_single_long_line_is_exported_whole():
    text = "x" * 40_001
    rows = review.export_blocks(info_for("big.py", text, [1]))
    assert len(rows) == 1
    assert rows[0]["text"] == text
    assert not rows[0].get("truncated")


def test_removed_long_line_is_exported_whole(tmp_path):
    text = "verify_signature(" + "x" * 40_010 + ");"
    patch = "@@ -1,2 +1,1 @@\n context\n-" + text + "\n+x\n"
    _, _, removed = plain.scan([], [("src/a.py", patch)], tmp_path, "owner/fork", "up/repo")
    assert removed[0]["text"] == text
    assert removed[0]["ships"] is True
    assert not removed[0].get("truncated")


def test_scan_chunks_a_thousand_line_file_without_gating(tmp_path, monkeypatch):
    first, second, remote = big_fork_fixture(tmp_path, "\n".join(thousand_lines()) + "\n")
    reviews = scan_fixture(tmp_path, monkeypatch, first, second, remote)
    review.scan("synthetic", 2000, 200000, first, second)
    data = json.loads((reviews / f"synthetic-{second}.json").read_text())
    assert data["verdict"] != "too large to review"
    assert "reason" not in data["stats"]
    big = [row for row in data["blocks"] if row["path"] == "big.py"]
    assert len(big) == 3
    covered = [number for row in big for number in range(row["start"], row["end"] + 1)]
    assert covered == list(range(1, 1001))
    assert any("payload = 'evil'" in row["text"] for row in big)
    assert set(data["decisions"]) == {row["id"] for row in big}


def test_digest_escapes_html_inside_fences(tmp_path):
    text = "<script>alert(1)</script> & <b>bold</b>"
    report = {
        "verdict": "human review needed",
        "decisions": {"b1": "needs person"},
        "blocks": [{
            "id": "b1", "path": "a.py", "start": 1, "end": 1, "text": text,
            "readers": {
                "a": {"verdict": "suspicious", "reason": "ok"},
                "b": {"verdict": "suspicious", "reason": "ok"},
            },
        }],
    }
    path = tmp_path / "a.json"
    path.write_text(json.dumps(report))
    out = pr_step.digest([path], tmp_path)
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in out
    assert "&lt;b&gt;bold&lt;/b&gt;" in out
    assert "<script>" not in out
    assert "&amp;" in out and " & " not in out


def scanned_report(tmp_path, monkeypatch):
    first, second, remote = big_fork_fixture(tmp_path, "\n".join(thousand_lines()) + "\n")
    reviews = scan_fixture(tmp_path, monkeypatch, first, second, remote)
    review.scan("synthetic", 2000, 200000, first, second)
    return json.loads((reviews / f"synthetic-{second}.json").read_text())


def test_scan_attaches_both_readers_to_every_chunk(tmp_path, monkeypatch):
    data = scanned_report(tmp_path, monkeypatch)
    assert len(data["blocks"]) == 3
    for block in data["blocks"]:
        assert set(block["readers"]) == {"a", "b"}
        assert block["readers"]["a"]["verdict"] == "harmless"
        assert block["readers"]["b"]["verdict"] == "harmless"
        assert block["readers"]["a"]["model"] == "a-model"
        assert block["readers"]["b"]["model"] == "b-model"


def test_scan_reader_verdict_change_changes_digest(tmp_path, monkeypatch):
    from review import apply as review_apply

    data = scanned_report(tmp_path, monkeypatch)
    baseline = review_apply.findings_digest(data)
    assert data["findings_digest"] == baseline
    data["blocks"][0]["readers"]["a"]["verdict"] = "suspicious"
    assert review_apply.findings_digest(data) != baseline


# Mirrors docs/benchmark_matrix_summary.png @ achyudh/llama.cpp b540a4b9:
# IHDR, tEXt Software, pHYs, IDAT, IEND. The real file's deflate stream happens to
# contain "MZ" and "\x1f\x8b"; here the same byte pairs sit in the inflated pixels,
# which IDAT validation accepts and the magic scan never sees.
REAL_PNG_HEAD = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
MAGIC_PIXELS = b"\x7fELF" + b"PK\x03\x04" + b"MZ" + b"\x1f\x8b" + b"\x00" * 288
REAL_PNG_BYTES = png(
    extra=[
        chunk(b"tEXt", b"Software\x00Matplotlib version3.11.1, https://matplotlib.org/"),
        chunk(b"pHYs", b"\x00" * 9),
    ],
    width=100, height=10,
    raw=b"".join(b"\x00" + MAGIC_PIXELS for _ in range(10)),
)


def test_real_png_with_coincidental_magic_is_a_plain_asset():
    assert REAL_PNG_BYTES.startswith(REAL_PNG_HEAD)
    for magic in (b"MZ", b"\x1f\x8b", b"\x7fELF", b"PK\x03\x04"):
        assert magic in MAGIC_PIXELS
    assert plain.assess_binary("docs/benchmark_matrix_summary.png", REAL_PNG_BYTES) == (False, True)


def test_real_png_yields_a_signal_not_findings(tmp_path):
    path = tmp_path / "docs" / "benchmark_matrix_summary.png"
    path.parent.mkdir()
    path.write_bytes(REAL_PNG_BYTES)
    patch = "@@ -0,0 +1,2 @@\n+\\x89PNG\n+http://example.invalid/a\\b\n"
    findings, signals, _ = plain.scan(
        [path], [("docs/benchmark_matrix_summary.png", patch)], tmp_path, "owner/fork", "up/repo",
    )
    assert not findings
    assert any(row.get("suppressed_because") == "plain-image" for row in signals)
