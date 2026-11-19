"""Failing-first tests for git-derived diffs and binary handling."""

from review import localdiff, review


def test_binary_without_patch_is_not_unreviewable():
    comparison = {"files": [{"filename": "docs/a.png", "status": "added"}]}
    blobs = {"docs/a.png": b"\x89PNG\r\n\x1a\n\x00more"}
    gate = review.incomplete_diff(comparison, 300, (), lambda path: blobs.get(path))
    assert gate == {}


def test_text_without_patch_is_unreviewable():
    comparison = {"files": [{"filename": "src/a.py", "status": "modified"}]}
    gate = review.incomplete_diff(comparison, 300, (), lambda path: b"print(1)\n")
    assert gate["reason"] == "files-without-patch"


def test_inputs_are_validated():
    assert localdiff.valid_sha("a" * 40)
    assert not localdiff.valid_sha("../bad")
    assert localdiff.valid_repo("https://github.com/ggml-org/llama.cpp.git", "ggml-org/llama.cpp")
    assert not localdiff.valid_repo("https://github.com/evil/llama.cpp.git", "ggml-org/llama.cpp")


def test_parse_raw_modes():
    raw = b":100644 120000 abcdef1 abcdef2 A\0docs/link\0:100644 160000 abcdef3 abcdef4 M\0deps/lib\0"
    parsed = localdiff.parse_raw(raw)
    assert parsed["symlinks"] == ["docs/link"]
    assert parsed["submodules"] == ["deps/lib"]


def test_size_cap():
    assert localdiff.too_large({"files": 2001, "lines": 1}, 2000, 200000)
    assert localdiff.too_large({"files": 1, "lines": 200001}, 2000, 200000)
    assert not localdiff.too_large({"files": 10, "lines": 20}, 2000, 200000)


def test_parse_raw_records_the_new_path_on_a_rename():
    raw = b":100644 100644 a1 a2 R095\0old/a.cuh\0new/a-dp4a.cuh\0"
    parsed = localdiff.parse_raw(raw)
    assert parsed["paths"] == ["new/a-dp4a.cuh"]
    assert not parsed["symlinks"]


def test_oversize_file_is_not_reviewable():
    patches, added, blocks, removed, oversize = localdiff.parse_patches(
        "diff --git a/src/big.py b/src/big.py\n@@ -0,0 +1,50001 @@\n" + "+x\n" * 50_001
    )
    assert "src/big.py" in oversize


def test_pure_rename_without_patch_is_not_unreviewable():
    comparison = {"files": [{"filename": "src/new.py", "status": "R100"}]}
    assert review.incomplete_diff(comparison, 300, (), lambda path: b"print(1)\n") == {}
