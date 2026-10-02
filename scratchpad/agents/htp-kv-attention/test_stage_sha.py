"""Fix 1: the on-device sha check must fail unless every expected file
prints its expected hash — empty sha256sum output is a failure, not a pass."""

import run_bench

EXPECTED = {"bin/llama-bench": "a" * 64, "ship.gguf": "b" * 64}


def test_empty_output_fails_naming_everything():
    err = run_bench.sha_mismatch("", EXPECTED)
    assert err
    assert "bin/llama-bench" in err and "ship.gguf" in err


def test_all_files_with_expected_hashes_pass():
    out = f"{'a' * 64}  bin/llama-bench\n{'b' * 64}  ship.gguf\n"
    assert run_bench.sha_mismatch(out, EXPECTED) is None


def test_one_missing_file_fails():
    out = f"{'a' * 64}  bin/llama-bench\n"
    err = run_bench.sha_mismatch(out, EXPECTED)
    assert err and "ship.gguf" in err


def test_wrong_hash_fails():
    out = f"{'a' * 64}  bin/llama-bench\n{'c' * 64}  ship.gguf\n"
    assert "mismatch" in run_bench.sha_mismatch(out, EXPECTED)


def test_error_lines_are_not_hash_pairs():
    out = "sha256sum: bin/llama-bench: No such file or directory\n"
    assert run_bench.sha_mismatch(out, EXPECTED)
