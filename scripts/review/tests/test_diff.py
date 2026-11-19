from review import diff, localdiff
from review.scanners import common, plain as plain_scan


def test_diff_gating():
    assert localdiff.too_large({"files": 301, "lines": 10}, 300, 20_000)
    assert localdiff.too_large({"files": 1, "lines": 20_001}, 300, 20_000)
    assert not localdiff.too_large({"files": 3, "lines": 100}, 300, 20_000)


def test_url_extraction():
    text = 'curl https://evil.example/a?b=1, and https://ok.example/x).'
    assert diff.extract_urls(text) == [
        "https://evil.example/a?b=1",
        "https://ok.example/x",
    ]


def test_binary_sniffing(tmp_path):
    text = tmp_path / "a.txt"
    text.write_text("hello")
    binary = tmp_path / "a.bin"
    binary.write_bytes(b"\x00\x01binary")
    assert not diff.is_binary_sample(text.read_bytes())
    assert diff.is_binary_sample(binary.read_bytes())


def test_dash_prefixed_path_is_a_finding(tmp_path):
    root = tmp_path
    path = root / "-evil"
    path.write_text("hello")
    findings, _, _ = plain_scan.scan([path], [], root, "owner/fork", "upstream/repo")
    assert any(row["rule"] == "dash-prefixed-path" for row in findings)
    assert common.safe_path("-evil") == "./-evil"


def test_semgrep_rule_id_is_portable():
    value = "/Users/dev/src/kalsa/scripts/review/rules.yml.kalsa.download-in-build"
    assert diff.clean_rule_id(value) == "kalsa.download-in-build"


def test_known_upstream_url_is_a_signal(tmp_path):
    entry = {"url": "https://old.example/a", "file": "src/a.py", "line": 3, "comment": False}
    result = plain_scan.classify_url(entry, {"old.example"}, "owner/fork", "upstream/repo")
    assert not result["signal"]
