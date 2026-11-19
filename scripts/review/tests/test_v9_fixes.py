"""Failing-first regressions from audit v9."""

import hashlib
import json
from pathlib import Path

from review import apply as review_apply, diff, review
from review.scanners import plain


def test_binary_nul_file_exports_readable_text_with_escapes():
    data = b'x = 1\x00\nimport os\nos.system("id")\n'
    info = {
        "blocks": {"src/x.py": [[1, 2, 3]]},
        "blobs": {"src/x.py": data},
        "paths": ["src/x.py"],
        "statuses": {"src/x.py": "A"},
        "binary_info": {"src/x.py": {"old_size": 0, "new_size": len(data), "old_sha": "", "new_sha": hashlib.sha256(data).hexdigest()}},
    }
    blocks = review.export_blocks(info)
    assert len(blocks) == 1
    block = blocks[0]
    assert block["kind"] == "binary" and "text" in block
    assert "\\x00" in block["text"] and "os.system" in block["text"]


def test_lfs_pointer_exports_text_and_kind():
    data = b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n"
    info = {
        "blocks": {"m.gguf": [[1, 2, 3]]},
        "blobs": {"m.gguf": data},
        "paths": ["m.gguf"],
        "statuses": {"m.gguf": "A"},
    }
    block = review.export_blocks(info)[0]
    assert block["kind"] == "lfs-pointer"
    assert "spec/v1" in block["text"]


def test_binary_and_lfs_files_are_hard_rule_findings(tmp_path):
    binary = tmp_path / "x.py"
    binary.write_bytes(b'x = 1\x00\nos.system("id")\n')
    patch = "@@ -0,0 +1,2 @@\n+x = 1\\x00\n+os.system(\"id\")\n"
    findings, _, _ = plain.scan([binary], [("x.py", patch)], tmp_path, "owner/fork", "up/repo")
    row = next(item for item in findings if item["rule"] == "binary-or-nul-content")
    assert row["needs_person"] is True


def test_every_block_and_removed_block_has_full_schema():
    info = {
        "blocks": {"src/a.py": [[1]]},
        "blobs": {"src/a.py": b"x\n"},
        "paths": ["src/a.py"], "statuses": {"src/a.py": "A"},
        "binary_info": {"src/a.py": {"old_size": 0, "new_size": 2, "old_sha": "", "new_sha": "s"}},
    }
    schema = {"id", "path", "start", "end", "text", "kind", "context", "ships", "truncated"}
    for row in review.export_blocks(info):
        assert schema <= set(row)
    patch = "@@ -1,2 +1,1 @@\n-context\n-verify_signature(blob);\n+x\n"
    _, _, removed = plain.scan([], [("src/a.py", patch)], Path("/tmp"), "owner/fork", "up/repo")
    for row in removed:
        assert schema <= set(row)


def test_removed_long_line_truncates_and_ships():
    text = "verify_signature(" + "x" * 40_010 + ");"
    patch = "@@ -1,2 +1,1 @@\n context\n-" + text + "\n+x\n"
    _, _, removed = plain.scan([], [("src/a.py", patch)], Path("/tmp"), "owner/fork", "up/repo")
    row = removed[0]
    assert row["truncated"] is True and row["ships"] is True
    assert len(row["text"]) == 40_000


def test_cap_values_are_pinned():
    assert review.MAX_BLOCK_LINES == 400
    assert review.MAX_BLOCK_BYTES == 40_000
    text = "x" * 40_001
    block = review.export_blocks({
        "blocks": {"big.py": [[1]]}, "blobs": {"big.py": text.encode()},
        "paths": ["big.py"], "statuses": {"big.py": "A"},
    })[0]
    assert block["truncated"] is True


def test_truncated_block_gates_the_badge(tmp_path, monkeypatch):
    import shutil
    import subprocess

    from review import catalog, github, localdiff

    work = tmp_path / "work"; bare = tmp_path / "repo.git"
    work.mkdir()
    git = lambda *a: subprocess.run(["git", "-C", str(work), *a], check=True, capture_output=True)
    git("init", "-b", "main"); git("config", "user.email", "t@e"); git("config", "user.name", "T")
    (work / "big.c").write_text("int a;\n")
    git("add", "."); git("commit", "-m", "base")
    base = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    git("checkout", "-b", "fork")
    (work / "big.c").write_text("int a;\n" + "x" * 40_001 + "\n")
    git("add", "."); git("commit", "-m", "fork")
    fork = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, capture_output=True)
    engine = {"id": "synthetic", "repo": "owner/fork", "upstream": "owner/up", "kind": "fork"}
    monkeypatch.setattr(catalog, "load", lambda: {"engine": [engine]})
    monkeypatch.setattr(github, "token", lambda: "t")
    monkeypatch.setattr(github, "fork_head", lambda repo, token: (fork, "fork") if repo == "owner/fork" else (base, "main"))
    monkeypatch.setattr(github, "default_branch", lambda repo, token: "main")
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    monkeypatch.setattr(localdiff, "find_base", lambda *args: base)
    reviews = tmp_path / "reviews"; reviews.mkdir()
    monkeypatch.setattr(review, "REVIEWS", reviews)
    review.scan("synthetic", 2000, 200000)
    data = json.loads((reviews / f"synthetic-{fork}.json").read_text())
    assert data["verdict"] == "too large to review"
    assert data["stats"]["reason"] == "block truncated"


def test_digest_covers_blocks_and_removed_blocks():
    report = {
        "verdict": "no findings", "inputs": {"commit": "a" * 40},
        "findings": [], "signals": [], "stats": {},
        "blocks": [{"id": "x", "text": "a"}], "removed_blocks": [],
    }
    digest = review_apply.findings_digest(report)
    changed = json.loads(json.dumps(report)); changed["blocks"][0]["text"] = "b"
    assert review_apply.findings_digest(changed) != digest
    changed = json.loads(json.dumps(report)); changed["removed_blocks"] = [{"id": "y", "text": "z"}]
    assert review_apply.findings_digest(changed) != digest


def test_invalid_utf8_uses_one_decoding_policy():
    data = b"bad \xff byte\n"
    assert diff.decode(data) == "bad \\xff byte\n"
    patch = "@@ -0,0 +1 @@\n+" + diff.decode(data).rstrip("\n") + "\n"
    assert diff.added_texts(patch)[0] == diff.decode(data).rstrip("\n")
