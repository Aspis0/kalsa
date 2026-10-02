"""Device state gates (phone owner rules + QRD heat), the wait loop that
enforces them before every llama-bench call, and the HTP route proof."""

import re
import time

SKIN_STOP_C = 50.0
BATTERY_MIN_PCT = 25
BATTERY_MAX_C = 44.0
THERMAL_MAX_STATUS = 3
S23_MODEL_PREFIX = "SM-S911"
GATE_RETRY_S = 60
GATE_WAIT_LIMIT_S = 1800
WAKE_SETTLE_S = 5
# The only wake we may send: never keyevent 26/POWER, never KEYCODE_SLEEP,
# never any lock or unlock.
WAKE_KEYEVENT = "input keyevent 224"

# One shell call per probe: battery + thermals + power state + the traced
# prop + device identity, each under a marker so parse_probe can split them.
PROBE = (
    "printf '\\n===BATTERY===\\n'; dumpsys battery; "
    "printf '\\n===THERMAL===\\n'; dumpsys thermalservice; "
    "printf '\\n===POWER===\\n'; dumpsys power | grep -m1 mWakefulness; "
    "printf '\\n===TRACED===\\n'; getprop persist.traced.enable; "
    "printf '\\n===IDENT===\\n'; getprop ro.product.model; getprop ro.soc.model"
)

_SECTION = re.compile(r"===(\w+)===\n(.*?)(?=\n===|$)", re.S)


def _find(pattern, text):
    m = re.search(pattern, text, re.M)
    return m.group(1) if m else ""


def parse_probe(out):
    """Gate fields from one PROBE output; an empty field means that section
    was missing and the gate fails closed."""
    sections = dict(_SECTION.findall(out))
    bat = sections.get("BATTERY", "")
    thm = sections.get("THERMAL", "")
    hal = re.search(r"Current temperatures from HAL:(.*?)(?:Current cooling|$)",
                    thm, re.S)
    hal = hal.group(1) if hal else ""
    ident = [l.strip() for l in sections.get("IDENT", "").splitlines()
             if l.strip()]
    temp = _find(r"^\s*temperature:\s*(-?\d+)", bat)
    return {
        "probe_ok": (len(sections) == 5 and bool(bat.strip())
                     and "Thermal Status" in thm),
        "thermal_status": _find(r"^\s*Thermal Status:\s*(\d+)", thm),
        "skin_C": _find(r"mValue=([0-9.]+),\s*mType=\d+,\s*mName=skin", hal),
        "plug": {k: _find(rf"^\s*{k} powered:\s*(true|false)", bat)
                 for k in ("AC", "USB", "Wireless")},
        "awake": "mWakefulness=Awake" in out,
        "traced": _find(r"===TRACED===\n(\S+)", out),
        "model": ident[0] if ident else "",
        "soc": ident[1] if len(ident) > 1 else "",
        "battery_level": _find(r"^\s*level:\s*(\d+)", bat),
        "battery_temp_c": f"{int(temp) / 10:.1f}" if temp else "",
    }


def snapshot(adb, log):
    """Probe the device and parse the stored dump into gate fields."""
    rc, out = adb.shell(PROBE, timeout=45)
    snap = parse_probe(out)
    log("SNAP " + str(snap))
    return snap


def gate_reason(snap, target_kind, dry_run=False):
    """None = go; a string explains the pause. Missing live data stops the
    run (fail closed) — only a dry run proceeds without a device."""
    if dry_run:
        return None
    if not snap["probe_ok"]:
        return "probe-failed (no battery/thermal sections)"
    if target_kind != "phone-serial":
        if snap["thermal_status"] and int(snap["thermal_status"]) >= THERMAL_MAX_STATUS:
            return f"android_thermal_status={snap['thermal_status']}"
        if snap["skin_C"] and float(snap["skin_C"]) >= SKIN_STOP_C:
            return f"skin={snap['skin_C']}C"
        return None
    powered = [k for k, v in snap["plug"].items() if v == "true"]
    if powered:
        return f"battery powered ({','.join(powered)})"
    lvl = snap["battery_level"]
    if not lvl or int(lvl) < BATTERY_MIN_PCT:
        return f"battery {lvl or '?'}% < {BATTERY_MIN_PCT}"
    temp = snap["battery_temp_c"]
    if not temp or float(temp) >= BATTERY_MAX_C:
        return f"battery temp {temp or '?'}C >= {BATTERY_MAX_C:g}"
    if snap["thermal_status"] and int(snap["thermal_status"]) >= THERMAL_MAX_STATUS:
        return f"android_thermal_status={snap['thermal_status']}"
    if not snap["awake"]:
        return "screen asleep"
    if (snap["model"].startswith(S23_MODEL_PREFIX)
            and snap["traced"] not in ("", "0")):
        return f"persist.traced.enable={snap['traced']}"
    return None


def gate_list(target_kind):
    """The gates in check order, for the run log and the dry-run display."""
    names = ["probe_ok"]
    if target_kind == "phone-serial":
        names += ["not_powered(AC/USB/Wireless)",
                  f"battery>={BATTERY_MIN_PCT}%",
                  f"battery_temp<{BATTERY_MAX_C:g}C",
                  f"thermal_status<{THERMAL_MAX_STATUS}",
                  "awake(mWakefulness)",
                  f"traced==0({S23_MODEL_PREFIX}x only)"]
    else:
        names += [f"thermal_status<{THERMAL_MAX_STATUS}",
                  f"skin<{SKIN_STOP_C:g}C"]
    return names


def ensure_gates(adb, log, tag, dry_run=False):
    """Block until every gate for this target passes: probe, wake the screen
    via KEYCODE_WAKEUP when asleep, re-check every GATE_RETRY_S up to
    GATE_WAIT_LIMIT_S. Returns (None, snapshot) to go, (reason, snapshot) to
    stop cleanly — the caller must not count a partial row then."""
    log(f"GATES {tag}: " + "; ".join(gate_list(adb.target_kind)))
    limit = time.monotonic() + GATE_WAIT_LIMIT_S
    while True:
        snap = snapshot(adb, log)
        why = gate_reason(snap, adb.target_kind, dry_run)
        if why is None:
            return None, snap
        if why == "screen asleep" and not dry_run:
            log(f"GATE_WAKE {tag}: {WAKE_KEYEVENT} (KEYCODE_WAKEUP)")
            adb.shell(WAKE_KEYEVENT, timeout=30)
            time.sleep(WAKE_SETTLE_S)
            snap = snapshot(adb, log)
            why = gate_reason(snap, adb.target_kind)
            if why is None:
                return None, snap
        if dry_run or time.monotonic() >= limit:
            return why, snap
        log(f"GATE_WAIT {tag}: {why}; re-check in {GATE_RETRY_S}s")
        time.sleep(GATE_RETRY_S)


def route_proved(log_text, arch, nkvo):
    """Verbose-run proof that the model, the KV cache and the executed ops are
    on the intended side: HTP0 model buffer + execute-op lines + the arch's
    skel loaded, plus the KV buffer on HTP0 when nkvo=0 and on CPU when 1."""
    base = ("HTP0 model buffer size" in log_text
            and "HTP0 execute-op" in log_text
            and f"libggml-htp-{arch}.so" in log_text)
    kv_line = "HTP0 KV buffer size" if nkvo == 0 else "CPU KV buffer size"
    return base and kv_line in log_text
