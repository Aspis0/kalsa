"""Privacy and upstream-attribution regressions."""

import json

from review import diff, review
from review.scanners import common, osv as osv_mod, plain


def test_rule_id_has_no_local_path():
    value = "Users.marco.Projects.kalsa.scripts.review.kalsa.cmake-remote"
    assert diff.clean_rule_id(value) == "kalsa.cmake-remote"
    assert diff.clean_rule_id("p/secrets.generic") == "p/secrets.generic"


def test_report_scrub_preserves_username_in_paths():
    payload = {"file": "src/root_cert.py", "snippet": "runner token"}
    assert review.scrub(payload) == payload


def test_only_changed_dependencies_count():
    assert review.added_dependencies("requests==2.19.0\n", "requests==2.32.0\n") == {"requests"}
    assert review.added_dependencies("numpy==1.0\n", "") == {"numpy"}


def test_code_host_owner_is_not_allowlisted_by_domain():
    result = plain.classify_url(
        {"url": "https://packages.lunarg.com/key.asc", "file": ".github/workflows/release.yml", "line": 1,
         "comment": False, "text": "wget https://packages.lunarg.com/key.asc"},
        {"packages.lunarg.com"}, "owner/fork", "upstream/repo", release_workflow=True,
    )
    assert not result["signal"]


def test_osv_error_is_per_file(tmp_path):
    manifest = tmp_path / "requirements.txt"
    manifest.write_text("bad==1\n")
    osv_mod.run_tool = lambda *a, **k: common.ToolResult(2, "", "extractor failed")
    findings = osv_mod.scan([manifest], tmp_path)
    assert findings[0]["rule"] == "scanner-error"
    assert findings[0]["file"] == "requirements.txt"


def test_published_reports_have_no_local_paths():
    import getpass
    from pathlib import Path

    user = getpass.getuser()
    reviews = Path(__file__).resolve().parents[3] / "reviews"
    for path in reviews.glob("*.json"):
        text = path.read_text()
        assert "/Users/" not in text, path
        assert f"Users.{user}" not in text, path


def test_osv_skips_package_json(tmp_path):
    manifest = tmp_path / "package.json"
    manifest.write_text('{"dependencies":{}}')
    called = []
    osv_mod.run_tool = lambda *a, **k: called.append(a) or common.ToolResult(0, "{}", "")
    assert osv_mod.scan([manifest], tmp_path) == []
    assert not called
