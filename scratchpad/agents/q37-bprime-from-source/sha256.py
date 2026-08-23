#!/usr/bin/env python3
"""Print sha256 of a file. Exit 0 always; caller compares."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: sha256.py FILE", file=sys.stderr)
        return 2
    p = Path(sys.argv[1])
    h = hashlib.sha256()
    with p.open("rb") as f:
        while True:
            b = f.read(8 * 1024 * 1024)
            if not b:
                break
            h.update(b)
    print(h.hexdigest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
