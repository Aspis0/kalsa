"""q62 adapter around the validated q56 guarded launcher.

The q56 source remains untouched. This module loads it in memory and changes
only q62 paths, the prereg battery/plug policy, Xiaomi reconnect behavior, and
the exact q62 crash-marker matcher.
"""

from __future__ import annotations

import types
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
CELL = ROOT / "scratchpad" / "agents" / "q62-product-streamer-prefill"
SOURCE = ROOT / "scratchpad" / "agents" / "q56-thermal-watchdog" / "launch_with_guard.py"
REMOTE_DIR = "/data/local/tmp/q62_guard"
REMOTE_GUARD = f"{REMOTE_DIR}/thermal_guard.sh"


def load_q56() -> types.ModuleType:
    source = SOURCE.read_text(encoding="utf-8")
    source = source.replace(
        'if int(initial_battery["level"]) < 50:',
        'if int(initial_battery["level"]) < args.launcher_min_battery:',
    )
    source = source.replace(
        'if int(sample["level"]) < 45:',
        'if int(sample["level"]) < args.launcher_min_battery:',
    )
    source = source.replace(
        'if any(initial_battery[key] is True for key in ("ac_powered", "usb_powered", "wireless_powered")):\n'
        '        raise SystemExit("REFUSING: device charging state is not unplugged")',
        'if any(initial_battery[key] is True for key in ("ac_powered", "usb_powered", "wireless_powered")):\n'
        '        if not args.allow_plugged:\n'
        '            raise SystemExit("REFUSING: device charging state is not unplugged")',
    )
    source = source.replace(
        'parser.add_argument("--allow-npu", action="store_true")',
        'parser.add_argument("--launcher-min-battery", type=int, default=45)\n'
        '    parser.add_argument("--allow-plugged", action="store_true")\n'
        '    parser.add_argument("--allow-npu", action="store_true")',
    )
    module = types.ModuleType("q62_q56_launcher")
    module.__file__ = str(SOURCE)
    exec(compile(source, str(SOURCE), "exec"), module.__dict__)
    module.ROOT = ROOT
    module.HERE = CELL
    module.REMOTE_DIR = REMOTE_DIR
    module.REMOTE_GUARD = REMOTE_GUARD

    def refuse_reconnect(self) -> None:
        raise module.AdbTransportError("q62 forbids adb reconnect; Xiaomi transport dropped")

    module.Device._reconnect_or_raise = refuse_reconnect

    markers = (
        "CDSP0 CRASHED",
        "dspqueue_read failed",
        "dspqueue_write failed",
        "INTERNAL-ERROR",
        "ggml_abort",
        "GGML_ASSERT",
        "Aborted",
        "Segmentation",
    )

    def exact_failure_signature_line(text: str) -> str:
        for line in text.splitlines():
            for marker in markers:
                if marker in line:
                    return line.strip()
        return ""

    module.failure_signature_line = exact_failure_signature_line
    return module


MODULE = load_q56()


if __name__ == "__main__":
    raise SystemExit(MODULE.main())
