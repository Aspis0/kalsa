"""q61 launcher shim: use q56's guarded launch with reconnects forbidden."""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "launch_with_guard.py"
SPEC = importlib.util.spec_from_file_location("q56_launch_with_guard", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SOURCE}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def refuse_reconnect(self) -> None:
    raise MODULE.AdbTransportError("q61 forbids reconnect; Xiaomi adb transport dropped")


MODULE.Device._reconnect_or_raise = refuse_reconnect

if __name__ == "__main__":
    raise SystemExit(MODULE.main())
