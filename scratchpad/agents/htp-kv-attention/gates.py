"""Device state gates (QRD heat + S23 owner rules) and the HTP route proof."""

import re

SKIN_STOP_C = 50.0

# One shell call per probe: battery + thermals + power state + the traced prop.
PROBE = (
    "printf '\\n===BATTERY===\\n'; dumpsys battery; "
    "printf '\\n===THERMAL===\\n'; dumpsys thermalservice; "
    "printf '\\n===POWER===\\n'; dumpsys power | grep -m1 mWakefulness; "
    "printf '\\n===TRACED===\\n'; getprop persist.traced.enable"
)


def _find(pattern, text):
    m = re.search(pattern, text, re.M)
    return m.group(1) if m else ""


def snapshot(adb, log):
    """Parse the probe into gate fields; probe_ok=False forces a stop."""
    rc, out = adb.shell(PROBE, timeout=45)
    bat = re.search(r"===BATTERY===\n(.*?)===THERMAL===", out, re.S)
    thm = re.search(r"===THERMAL===\n(.*?)===POWER===", out, re.S)
    bat = bat.group(1) if bat else ""
    thm = thm.group(1) if thm else ""
    hal = re.search(r"Current temperatures from HAL:(.*?)(?:Current cooling|$)", thm, re.S)
    hal = hal.group(1) if hal else ""
    snap = {
        "probe_ok": "===TRACED===" in out and "Thermal Status" in thm,
        "thermal_status": _find(r"^Thermal Status:\s*(\d+)", thm),
        "skin_C": _find(r"mValue=([0-9.]+),\s*mType=\d+,\s*mName=skin", hal),
        "plug": {k: _find(rf"^\s*{k} powered:\s*(true|false)", bat)
                 for k in ("AC", "USB", "Wireless")},
        "awake": "mWakefulness=Awake" in out,
        "traced": _find(r"===TRACED===\n(\S+)", out),
    }
    log("SNAP " + str(snap))
    return snap


def gate_reason(snap, target_kind, dry_run=False):
    """None = go; a string explains the pause. Missing live data stops the
    run (fail closed) — only a dry run proceeds without a device."""
    if dry_run:
        return None
    if not snap["probe_ok"]:
        return "probe-failed (no battery/thermal sections)"
    if snap["thermal_status"] and int(snap["thermal_status"]) >= 3:
        return f"android_thermal_status={snap['thermal_status']}"
    if snap["skin_C"] and float(snap["skin_C"]) >= SKIN_STOP_C:
        return f"skin={snap['skin_C']}C"
    if target_kind != "phone-serial":
        return None
    powered = [k for k, v in snap["plug"].items() if v == "true"]
    if powered:
        return f"battery powered ({','.join(powered)})"
    if not snap["awake"]:
        return "screen asleep"
    if snap["traced"] not in ("", "0"):
        return f"persist.traced.enable={snap['traced']}"
    return None


def route_proved(log_text, arch):
    """Same proof as run_qdc.py: the HTP0 model buffer line, an execute-op
    line (needs GGML_HEXAGON_VERBOSE=1), and the arch's skel being loaded."""
    return ("HTP0 model buffer size" in log_text
            and "HTP0 execute-op" in log_text
            and f"libggml-htp-{arch}.so" in log_text)
