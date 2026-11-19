"""Failing-first regressions from audit v8."""

import hashlib
from pathlib import Path

from review import diff, localdiff, review
from review.scanners import plain


def test_git_line_numbers_survive_unicode_and_control_lines():
    line = 'int b; \x0c\v\x1c\x1e\u2028\u2029 int hidden;'
    patch = f"@@ -0,0 +1,5 @@\n+int a;\n+{line}\n+int c;\n+int d;\n+system(\"sh /tmp/p\");\n"
    assert diff.added_lines(patch) == {1, 2, 3, 4, 5}
    assert "system(" in diff.added_texts(patch)[4]
    assert diff.added_blocks(patch) == [[1, 2, 3, 4, 5]]


def test_cr_and_crlf_text_is_preserved_in_blocks():
    data = b"int a;\rint b;\r\nint c;\r\n"
    info = {
        "blocks": {"src/a.c": [[1, 2]]},
        "blobs": {"src/a.c": data},
        "paths": ["src/a.c"],
        "statuses": {"src/a.c": "A"},
    }
    block = review.export_blocks(info)[0]
    assert "int a;\rint b;\r" in block["text"]


def test_blocks_export_every_path_with_ships_flag():
    info = {
        "blocks": {
            "src/a.c": [[1]], "examples/e.c": [[1]], "tests/t.py": [[1]],
            "ci/run.sh": [[1]], "docs/readme.md": [[1]], ".github/workflows/t.yml": [[1]],
        },
        "blobs": {path: b"payload\n" for path in ["src/a.c", "examples/e.c", "tests/t.py", "ci/run.sh", "docs/readme.md", ".github/workflows/t.yml"]},
        "paths": list(info_blocks := {}),
        "statuses": {},
    }
    del info_blocks
    blocks = review.export_blocks(info)
    by_path = {row["path"]: row for row in blocks}
    assert set(by_path) == set(info["blocks"])
    assert by_path["src/a.c"]["ships"] is True
    for path in ("examples/e.c", "tests/t.py", "ci/run.sh", "docs/readme.md", ".github/workflows/t.yml"):
        assert by_path[path]["ships"] is False


def test_submodule_block_has_both_shas():
    info = {
        "blocks": {"sub": [[1]]},
        "blobs": {},
        "paths": ["sub"],
        "statuses": {"sub": "M"},
        "submodule_shas": {"sub": ("0" * 40, "1" * 40)},
    }
    block = review.export_blocks(info)[0]
    assert block["kind"] == "submodule"
    assert "0" * 40 in block["text"] and "1" * 40 in block["text"]


def test_binary_file_exports_one_binary_entry():
    data = b"\x89PNG\r\n\x1a\n\x00" + b"x" * 32
    info = {
        "blocks": {"img.png": [[1]]},
        "blobs": {"img.png": data},
        "paths": ["img.png"],
        "statuses": {"img.png": "A"},
        "binary_info": {"img.png": {"old_size": 0, "new_size": len(data), "old_sha": "", "new_sha": hashlib.sha256(data).hexdigest()}},
    }
    rows = review.export_blocks(info)
    assert len(rows) == 1 and rows[0]["kind"] == "binary"
    assert rows[0]["new_size"] == len(data)
    assert rows[0]["new_sha"] == hashlib.sha256(data).hexdigest()
    assert "text" in rows[0]


def test_long_block_is_chunked_not_gated(tmp_path):
    path = tmp_path / "big.py"
    text = "\n".join(f"line_{i}" for i in range(500)) + "\n"
    path.write_text(text)
    rows = review.export_blocks({
        "blocks": {"big.py": [list(range(1, 501))]},
        "blobs": {"big.py": text.encode()},
        "paths": ["big.py"], "statuses": {"big.py": "A"},
    })
    assert len(rows) == 2
    covered = [number for row in rows for number in range(row["start"], row["end"] + 1)]
    assert covered == list(range(1, 501))


def test_removed_blocks_have_id_and_numbered_context():
    patch = "@@ -1,3 +1,2 @@\n context\n-verify_signature(blob);\n+int x;\n tail\n"
    _, _, removed = plain.scan([], [("src/a.c", patch)], Path("/tmp"), "owner/fork", "up/repo")
    assert removed[0]["id"]
    assert removed[0]["context"][0]["line"] == 1


def test_hunks_ignore_no_newline_marker():
    patch = "\n".join(["@@ -0,0 +1,3 @@", "+a", "\\ No newline at end of file", "+b", '+system("id")']) + "\n"
    assert diff.added_lines(patch) == {1, 2, 3}
    assert diff.added_texts(patch) == ["a", "b", 'system("id")']
