#!/usr/bin/env python3
"""Launch run_q52.py detached with redirected logs and persist its PID."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
PYTHON = Path(sys.executable).with_name("pythonw.exe")
if not PYTHON.exists():
    PYTHON = Path(sys.executable)


def main() -> None:
    pid_path = HERE / "runner.pid.txt"
    out_path = HERE / "runner.out.log"
    err_path = HERE / "runner.err.log"
    with out_path.open("a", encoding="utf-8") as stdout, err_path.open("a", encoding="utf-8") as stderr:
        flags = (
            getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
            | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        )
        process = subprocess.Popen(
            [str(PYTHON), str(HERE / "run_q52.py"), *sys.argv[1:]],
            cwd=str(HERE),
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            creationflags=flags,
            close_fds=False,
        )
    pid_path.write_text(str(process.pid) + "\n", encoding="ascii")
    print(process.pid)


if __name__ == "__main__":
    main()
