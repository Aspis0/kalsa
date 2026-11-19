"""Structurally valid image containers for the scanner tests."""

import math
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        len(payload).to_bytes(4, "big") + kind + payload
        + zlib.crc32(kind + payload).to_bytes(4, "big")
    )


def ihdr(width: int = 1, height: int = 1, interlace: int = 0, colour: int = 2, depth: int = 8) -> bytes:
    return (
        width.to_bytes(4, "big") + height.to_bytes(4, "big")
        + bytes([depth, colour, 0, 0, interlace])
    )


def row_bytes(width: int = 1, colour: int = 2, depth: int = 8) -> int:
    return math.ceil(width * CHANNELS[colour] * depth / 8)


def scanlines(width: int = 1, height: int = 1, fill: bytes = b"\x00", colour: int = 2, depth: int = 8) -> bytes:
    return b"".join(b"\x00" + fill * row_bytes(width, colour, depth) for _ in range(height))


def png(extra=(), width: int = 1, height: int = 1, raw: bytes | None = None,
        colour: int = 2, depth: int = 8) -> bytes:
    """A walkable PNG: IHDR, extra chunks, zlib IDAT of filtered scanlines, IEND."""
    if raw is None:
        raw = scanlines(width, height, colour=colour, depth=depth)
    return (
        PNG_SIGNATURE + chunk(b"IHDR", ihdr(width, height, colour=colour, depth=depth))
        + b"".join(extra) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    )


def png_with_idat(payload: bytes, extra=(), width: int = 1, height: int = 1) -> bytes:
    """A PNG whose IDAT chunk carries exactly `payload`, for the attack probes."""
    return (
        PNG_SIGNATURE + chunk(b"IHDR", ihdr(width, height)) + b"".join(extra)
        + chunk(b"IDAT", payload) + chunk(b"IEND", b"")
    )


def segment(marker: int, payload: bytes) -> bytes:
    return b"\xff" + bytes([marker]) + (len(payload) + 2).to_bytes(2, "big") + payload


def jpeg(extra=()) -> bytes:
    """A structurally walkable JPEG; the scanner no longer trusts any JPEG."""
    return (
        b"\xff\xd8" + segment(0xE0, b"JFIF\x00" + b"\x00" * 9) + b"".join(extra)
        + segment(0xDB, b"\x00" * 3) + segment(0xC0, b"\x00" * 3)
        + segment(0xC4, b"\x00" * 3) + segment(0xDA, b"\x00" * 3)
        + b"\x00\x01\x02" + b"\xff\xd9"
    )
