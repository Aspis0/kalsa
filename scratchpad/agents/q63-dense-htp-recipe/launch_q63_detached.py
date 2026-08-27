from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from q63_common import DETACHED_PROCESS, HERE, IDLE_PRIORITY_CLASS, ignore_console_signals, set_idle, write_json


def main() -> None:
    ignore_console_signals()
    out_path = HERE / "runner.out.log"
    err_path = HERE / "runner.err.log"
    pid_path = HERE / "runner.pid.txt"
    python = Path(sys.executable).with_name("pythonw.exe")
    if not python.exists():
        python = Path(sys.executable)
    flags = DETACHED_PROCESS | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200) | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    with out_path.open("a", encoding="utf-8") as stdout, err_path.open("a", encoding="utf-8") as stderr:
        process = subprocess.Popen([str(python), str(HERE / "run_q63_scheduler.py")], cwd=str(HERE.parent.parent.parent), stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, close_fds=False, creationflags=flags)
    set_idle(process)
    pid_path.write_text(str(process.pid) + "\n", encoding="ascii")
    write_json(HERE / "launcher.json", {"pid": process.pid, "scheduler": str(HERE / "run_q63_scheduler.py"), "flags": ["DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"], "priority": "IDLE"})
    print(process.pid, flush=True)


if __name__ == "__main__":
    main()
