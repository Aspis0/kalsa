#!/usr/bin/env python3
"""Append one battery.csv row. screen_on from dumpsys window mScreenOnFully."""
import datetime
import os
import pathlib
import re
import subprocess
import sys

evid = pathlib.Path(sys.argv[1])
phase = sys.argv[2]
turn = sys.argv[3] if len(sys.argv) > 3 else ""
serial = os.environ["ANDROID_SERIAL"]


def sh(*args, timeout=20):
    r = subprocess.run(
        ["adb", "-s", serial, "shell", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        stdin=subprocess.DEVNULL,
    )
    return (r.stdout or "").replace("\r", "")


def field(blob, name):
    m = re.search(rf"^[ \t]+{re.escape(name)}:[ \t]*(\S+)", blob, re.M)
    return m.group(1) if m else ""


utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
batt = sh("dumpsys", "battery")
ac = field(batt, "AC powered")
usb = field(batt, "USB powered")
wl = field(batt, "Wireless powered")
level = field(batt, "level")
temp = field(batt, "temperature")
volt = field(batt, "voltage")
now = field(batt, "current now")
avgs = re.findall(r"current_avg:(-?\d+)", batt)
avg = avgs[-1] if avgs else ""

br = sh("settings", "get", "system", "screen_brightness").strip()
pids = sh("pidof", "com.kalsa.app").split()
pid = pids[0] if pids else ""

cpu = ""
# dumpsys cpuinfo / window displays stall decode (attempt 4: 10.7s gap).
# Screen: dumpsys power mWakefulness only. Fully is checked in ensure_screen.
pwr = sh("dumpsys", "power")
awake = "true" if re.search(r"mWakefulness=Awake", pwr) else "false"
screen_on = "1" if awake == "true" else "0"

line = (
    f"{utc},{phase},{turn},{level},{temp},{volt},{now},{avg},"
    f"{br},{pid},{cpu},{screen_on}"
)
with (evid / "battery.csv").open("a", encoding="utf-8") as f:
    f.write(line + "\n")

if ac.lower() == "true" or usb.lower() == "true" or wl.lower() == "true":
    with (evid / "ac-events.txt").open("a", encoding="utf-8") as f:
        f.write(f"{utc} phase={phase} turn={turn} AC={ac} USB={usb} Wireless={wl}\n")
    print(f"AC_APPEARED utc={utc} ac={ac} usb={usb} wl={wl}")

if screen_on != "1":
    with (evid / "screen-off-events.txt").open("a", encoding="utf-8") as f:
        f.write(
            f"{utc} CONTAMINATED phase={phase} turn={turn} "
            f"mWakefulness={awake}\n"
        )
    print(
        f"SCREEN_OFF_CONTAMINATED utc={utc} phase={phase} "
        f"mWakefulness={awake}"
    )

print(
    f"batt utc={utc} phase={phase} turn={turn} level={level} temp_deci={temp} "
    f"now={now} avg={avg} brightness={br} pid={pid} cpu={cpu} "
    f"screen_on={screen_on} ac={ac}"
)
