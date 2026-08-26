#!/usr/bin/env python3
"""Run exactly one child at Windows idle priority and wait for it."""
from __future__ import annotations

import ctypes
import subprocess
import sys
from pathlib import Path


IDLE_PRIORITY_CLASS = 0x40


def main() -> int:
    log_path = None
    argv = sys.argv[1:]
    if len(argv) >= 2 and argv[0] == "--log":
        log_path = Path(argv[1])
        argv = argv[2:]
    if not argv:
        print("usage: run_low.py [--log LOG] COMMAND [ARGS...]", file=sys.stderr)
        return 2
    cmd = argv
    print("IDLE_CMD " + " ".join(cmd), flush=True)
    log = None
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log = log_path.open("w", encoding="utf-8", errors="replace")
    p = subprocess.Popen(cmd, stdout=log or None, stderr=subprocess.STDOUT if log else None)
    if not ctypes.windll.kernel32.SetPriorityClass(int(p._handle), IDLE_PRIORITY_CLASS):
        print("SetPriorityClass failed", file=sys.stderr, flush=True)
        p.terminate()
        p.wait()
        if log:
            log.close()
        return 3
    rc = p.wait()
    if log:
        log.close()
    print(f"IDLE_RC {rc}", flush=True)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
