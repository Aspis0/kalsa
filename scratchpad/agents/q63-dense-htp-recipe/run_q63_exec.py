from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

from q63_common import ACTIVE, CHILD_FLAGS, HERE, cmd_text, ignore_console_signals, set_idle, write_json


def main() -> int:
    ignore_console_signals()
    args = sys.argv[1:]
    if len(args) < 4 or args[0] != "--cell" or args[2] != "--log":
        print("usage: run_q63_exec.py --cell CELL --log LOG COMMAND...", file=sys.stderr)
        return 2
    cell, log_path = args[1], Path(args[3])
    command = args[4:]
    if not command:
        return 2
    log_path.parent.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    with log_path.open("w", encoding="utf-8", errors="replace") as output:
        output.write("CMD " + cmd_text(command) + "\n")
        output.flush()
        process = subprocess.Popen(
            command, cwd=str(HERE.parent.parent.parent), stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT, close_fds=False,
            creationflags=CHILD_FLAGS,
        )
        active = {"cell": cell, "pid": process.pid, "command": command, "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        write_json(ACTIVE, active)
        try:
            set_idle(process)
            rc = process.wait()
        finally:
            current = None
            try:
                current = json.loads(ACTIVE.read_text(encoding="utf-8"))
            except Exception:
                pass
            if current and current.get("pid") == process.pid:
                ACTIVE.unlink(missing_ok=True)
    print(f"CELL={cell} PID={process.pid} RC={rc} WALL_S={time.perf_counter() - start:.3f}", flush=True)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
