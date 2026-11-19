"""Container walks: an image is plain only if every byte is explained."""

from __future__ import annotations

import math
import zlib

from .common import BINARY_MAGIC

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_CHUNKS = {
    b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS", b"gAMA", b"cHRM",
    b"sRGB", b"pHYs", b"bKGD", b"sBIT",
}
# iCCP is deliberately absent: an ICC profile is not parsed, so it needs a person.
PNG_FIXED = {b"IHDR": 13, b"IEND": 0, b"gAMA": 4, b"cHRM": 32, b"sRGB": 1, b"pHYs": 9}
PNG_ONCE = PNG_CHUNKS - {b"IDAT"}
PLTE_COLOURS = {2, 3, 6}
PNG_TEXT_KEYWORD = b"Software"
PNG_TEXT_MAX = 200
# Hard bound on inflated pixels; the largest real fork PNG seen is ~24 MB.
PNG_MAX_INFLATED = 64 * 1024 * 1024
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
DEPTHS = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}


def _png_text_clean(payload: bytes) -> bool:
    """Only a Software tag of short printable ASCII is inert enough to trust."""
    keyword, separator, value = payload.partition(b"\x00")
    return (
        bool(separator)
        and keyword == PNG_TEXT_KEYWORD
        and len(value) <= PNG_TEXT_MAX
        and all(0x20 <= byte <= 0x7E for byte in value)
    )


def _png_chunk_clean(kind: bytes, payload: bytes, colour: int) -> bool:
    """Exact lengths and value ranges; nothing unvalidated is allowed through."""
    if kind == b"tEXt":
        return _png_text_clean(payload)
    if kind not in PNG_CHUNKS:
        return False
    if kind in PNG_FIXED and len(payload) != PNG_FIXED[kind]:
        return False
    if kind == b"PLTE":
        return 0 < len(payload) <= 768 and len(payload) % 3 == 0 and colour in PLTE_COLOURS
    if kind == b"sRGB":
        return payload[0] <= 3
    if kind == b"pHYs":
        return payload[8] <= 1
    if kind == b"sBIT":
        return 1 <= len(payload) <= 4
    if kind == b"bKGD":
        return len(payload) in (1, 2, 6)
    if kind == b"tRNS":
        return len(payload) <= 256
    return True


def _png_geometry(ihdr: bytes) -> tuple[int, int] | None:
    """(stride, height) for a non-interlaced PNG; interlaced Adam7 needs a person."""
    if len(ihdr) != 13:
        return None
    width = int.from_bytes(ihdr[0:4], "big")
    height = int.from_bytes(ihdr[4:8], "big")
    depth, colour = ihdr[8], ihdr[9]
    if not width or not height or ihdr[10] or ihdr[11] or ihdr[12]:
        return None
    if depth not in DEPTHS.get(colour, ()):
        return None
    stride = 1 + math.ceil(width * CHANNELS[colour] * depth / 8)
    if height * stride > PNG_MAX_INFLATED:
        return None
    return stride, height


def _png_idat_clean(idat: bytes, stride: int, height: int) -> bool:
    """Inflate under a hard bound; pixels must match IHDR and rows must filter 0-4."""
    expected = stride * height
    try:
        inflater = zlib.decompressobj()
        raw = inflater.decompress(idat, expected + 1)
    except zlib.error:
        return False
    if len(raw) != expected or inflater.unconsumed_tail or not inflater.eof:
        return False
    if inflater.unused_data:
        return False
    return all(raw[row * stride] <= 4 for row in range(height))


def _png_clean(data: bytes) -> bool:
    """Walk chunks, verify CRC32, screen non-IDAT bytes, inflate IDAT to EOF."""
    if not data.startswith(PNG_SIGNATURE):
        return False
    offset = len(PNG_SIGNATURE)
    first = True
    seen, idat, geometry, colour = set(), [], None, 0
    while offset + 12 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], "big")
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            return False
        payload = data[offset + 8:end - 4]
        if kind in PNG_ONCE and kind in seen:
            return False
        if not _png_chunk_clean(kind, payload, colour):
            return False
        if first and kind != b"IHDR":
            return False
        if zlib.crc32(data[offset + 4:end - 4]) != int.from_bytes(data[end - 4:end], "big"):
            return False
        seen.add(kind)
        if kind == b"IHDR":
            geometry = _png_geometry(payload)
            if geometry is None:
                return False
            colour = payload[9]
        elif kind == b"IDAT":
            idat.append(payload)
        elif any(magic in payload for magic in BINARY_MAGIC):
            return False
        first = False
        offset = end
        if kind == b"IEND":
            break
    else:
        return False
    if offset != len(data) or not idat or geometry is None:
        return False
    return _png_idat_clean(b"".join(idat), *geometry)


def parses_clean(suffix: str, data: bytes) -> bool:
    """Only PNG is walked. JPEG entropy cannot be validated without decoding it,
    so JPEG, GIF, WebP and ICO always need a person."""
    return suffix == ".png" and _png_clean(data)
