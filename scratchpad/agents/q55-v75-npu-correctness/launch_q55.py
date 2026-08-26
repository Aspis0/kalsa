from __future__ import annotations

import sys

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
Q56 = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog"
sys.path.insert(0, str(Q56))

import launch_with_guard as MODULE  # noqa: E402


def no_reconnect(self: MODULE.Device) -> None:
    raise MODULE.AdbTransportError(
        "q55 forbids reconnect; exact Xiaomi mDNS transport dropped"
    )


# The q56 launcher normally has a bounded reconnect policy. q55 is stricter:
# any transport loss is recorded and terminates the cell without reconnecting.
MODULE.Device._reconnect_or_raise = no_reconnect


if __name__ == "__main__":
    raise SystemExit(MODULE.main())
