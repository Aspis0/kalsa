"""Regressions: malware exit codes fail closed; github.py has no dead imports."""

import ast
from importlib import import_module
from pathlib import Path

import pytest

from review import github

malware_scan = import_module("review.malware.scan")


def tools(clam, yara):
    return {"clamscan": lambda p: clam, "yara": lambda p: yara}


def run_scan(tmp_path, clam, yara):
    target = tmp_path / "a.bin"
    target.write_bytes(b"x")
    return malware_scan.scan(target, commands=tools(clam, yara), rules={"version": "v", "sha256": "s"})


def test_yara_exit_1_is_an_error_not_a_clean_result(tmp_path):
    with pytest.raises(RuntimeError, match="yara"):
        run_scan(tmp_path, (0, "", ""), (1, "", ""))


def test_yara_any_nonzero_exit_raises(tmp_path):
    for code in (1, 2, 3, 255):
        with pytest.raises(RuntimeError, match="yara"):
            run_scan(tmp_path, (0, "", ""), (code, "", ""))


def test_yara_exit_zero_with_output_is_a_hit(tmp_path):
    assert run_scan(tmp_path, (0, "", ""), (0, "kalsa_exec_payload", ""))["hits"] == ["yara"]


def test_yara_exit_zero_empty_is_no_hit(tmp_path):
    assert run_scan(tmp_path, (0, "", ""), (0, "  \n", ""))["hits"] == []


def test_clamscan_exit_1_is_a_hit_without_found_text(tmp_path):
    for out in ("", "something else entirely", "a.bin: OK"):
        assert run_scan(tmp_path, (1, out, ""), (0, "", ""))["hits"] == ["clamscan"], out


def test_clamscan_exit_0_is_no_hit_even_if_stdout_says_found(tmp_path):
    assert run_scan(tmp_path, (0, "a.bin: Eicar FOUND", ""), (0, "", ""))["hits"] == []


def test_clamscan_other_nonzero_exits_raise(tmp_path):
    for code in (2, 3, 255):
        with pytest.raises(RuntimeError, match="clamscan"):
            run_scan(tmp_path, (code, "", ""), (0, "", ""))


def test_both_tools_hit(tmp_path):
    hits = run_scan(tmp_path, (1, "", ""), (0, "rule", ""))["hits"]
    assert hits == ["clamscan", "yara"]


def test_github_module_has_no_dead_or_duplicate_imports():
    tree = ast.parse(Path(github.__file__).read_text())
    modules, bound = [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.append(alias.name)
                bound.append(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module != "__future__":
            for alias in node.names:
                modules.append(f"{node.module}.{alias.name}")
                bound.append(alias.asname or alias.name)
    # urllib.parse and urllib.request are distinct modules sharing one binding.
    assert len(modules) == len(set(modules)), f"duplicate imports: {modules}"
    used = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    dead = [name for name in bound if name not in used]
    assert not dead, f"dead imports: {dead}"
