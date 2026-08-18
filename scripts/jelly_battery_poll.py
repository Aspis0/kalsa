#!/usr/bin/env python3
"""Poll Jelly battery via adb dumpsys. Exit 0=unplugged-ok, 2=plugged, 3=low, 4=hot."""
from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path

ADB = Path(r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe")
SERIAL = "192.168.1.82:44395"
LOG = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp_jelly\battery_poll.log")


def dumpsys() -> str:
    r = subprocess.run(
        [str(ADB), "-s", SERIAL, "shell", "dumpsys", "battery"],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if r.returncode != 0:
        raise RuntimeError(f"adb dumpsys rc={r.returncode} {r.stderr}")
    return r.stdout


def parse(text: str) -> dict:
    def grab(name: str, default: str = "") -> str:
        m = re.search(rf"{re.escape(name)}:\s*(\S+)", text)
        return m.group(1) if m else default

    ac = grab("AC powered").lower() == "true"
    usb = grab("USB powered").lower() == "true"
    wireless = grab("Wireless powered").lower() == "true"
    level = int(grab("level", "-1"))
    status = grab("status", "?")
    voltage = grab("voltage", "?")
    raw_temp = grab("temperature", "-1")
    try:
        temp_c = int(raw_temp) / 10.0
    except ValueError:
        temp_c = -1.0
    plugged = ac or usb or wireless
    return {
        "ac": ac,
        "usb": usb,
        "wireless": wireless,
        "plugged": plugged,
        "level": level,
        "status": status,
        "voltage": voltage,
        "temp_c": temp_c,
        "raw": text,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--poll", type=int, default=0)
    ap.add_argument("--batt-min", type=int, default=35)
    ap.add_argument("--temp-max", type=float, default=43.0)
    args = ap.parse_args()
    info = parse(dumpsys())
    ts = dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    state = "PLUGGED" if info["plugged"] else "UNPLUGGED"
    line = (
        f"{ts} poll={args.poll} AC={str(info['ac']).lower()} USB={str(info['usb']).lower()} "
        f"wireless={str(info['wireless']).lower()} status={info['status']} "
        f"level={info['level']} temp_C={info['temp_c']:.1f} voltage={info['voltage']} {state}"
    )
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)
    print(info["raw"].rstrip())
    if info["plugged"]:
        return 2
    if info["level"] >= 0 and info["level"] < args.batt_min:
        return 3
    if info["temp_c"] > 0 and info["temp_c"] > args.temp_max:
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
