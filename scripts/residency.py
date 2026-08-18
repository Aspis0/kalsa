#!/usr/bin/env python3
"""Report mmap page-cache residency of a file without evicting it."""
from __future__ import annotations

import ctypes
import ctypes.util
import mmap
import os
import sys


def resident_pages(path: str) -> tuple[int, int, int]:
    page = os.sysconf("SC_PAGESIZE")
    size = os.path.getsize(path)
    npages = (size + page - 1) // page
    libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    libc.mincore.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_ubyte)]
    libc.mincore.restype = ctypes.c_int
    with open(path, "rb") as f:
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        try:
            vec = (ctypes.c_ubyte * npages)()
            addr = ctypes.addressof(ctypes.c_char.from_buffer(mm))
            rc = libc.mincore(addr, size, vec)
            if rc != 0:
                err = ctypes.get_errno()
                raise OSError(err, f"mincore failed errno={err}")
            res = sum(1 for b in vec if b & 1)
        finally:
            mm.close()
    return size, npages, res


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: residency.py FILE", file=sys.stderr)
        return 2
    path = sys.argv[1]
    size, npages, res = resident_pages(path)
    pct = (100.0 * res / npages) if npages else 0.0
    mib = res * os.sysconf("SC_PAGESIZE") / 1048576.0
    print(f"{path} size={size} pages={npages} resident={res} hit_pct={pct:.2f} resident_mib={mib:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
