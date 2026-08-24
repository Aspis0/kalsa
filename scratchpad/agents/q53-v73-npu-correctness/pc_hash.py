#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import pathlib
import sys


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


for arg in sys.argv[1:]:
    path = pathlib.Path(arg)
    print(f"{sha256(path)}  {path}  {path.stat().st_size}")
