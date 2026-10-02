#!/usr/bin/env python3
"""Build raw/<run>/tables.txt for an htp-kv-attention run: the clean timing
table (tok/s ± sd from the clean logs, ms/chunk with proportional sd), tok/s
ratios, OLS slope of ms/chunk vs depth, and the per-arm device state (battery,
thermal, skin, cpu7 scaling_max_freq from the 60 s sampler) over each arm's
route-start → clean-end window. Usage: make_tables.py <run-dir>."""

import calendar
import re
import sys
import time
from pathlib import Path

ARM_ORDER = ["A-nkvo", "B-offload", "C-app-vq4"]
DEPTH_ORDER = [0, 512, 1700, 3100]


def read_clean(run):
    """{arm: {depth: (mean_ts, sd_ts)}} from the clean logs' markdown."""
    out = {}
    for arm in ARM_ORDER:
        rows = {}
        for line in (run / "logs" / f"{arm}-clean.log").read_text().splitlines():
            m = re.match(r"^\|.*\|\s*pp128(?: @ d(\d+))?\s*\|\s*"
                         r"([0-9.]+) ± ([0-9.]+)\s*\|$", line)
            if m:
                rows[int(m.group(1) or 0)] = (float(m.group(2)),
                                              float(m.group(3)))
        out[arm] = rows
    return out


def ols(points):
    """(slope per 1k tokens, intercept ms) of ms/chunk vs depth."""
    n = len(points)
    mx = sum(x for x, _ in points) / n
    my = sum(y for _, y in points) / n
    sxy = sum((x - mx) * (y - my) for x, y in points)
    sxx = sum((x - mx) ** 2 for x, _ in points)
    slope = sxy / sxx
    return slope * 1000.0, my - slope * mx


def arm_windows(events_path):
    """{arm: (start_dt, end_dt)} from CLI_START <arm>-route to the last of
    CLI_OK/CLI_FAILED <arm>-clean, as epoch seconds."""
    win, t0 = {}, {}
    for line in events_path.read_text().splitlines():
        m = re.match(r"(\S+)\tCLI_START (\S+?)-(route|clean|profile) ", line)
        if m:
            t0[(m.group(2), m.group(3))] = parse_ts(m.group(1))
        m = re.match(r"(\S+)\tCLI_(?:OK|FAILED) (\S+?)-clean ", line)
        if m and (m.group(2), "route") in t0:
            win[m.group(2)] = (t0[(m.group(2), "route")],
                               parse_ts(m.group(1)))
    return win


def parse_ts(stamp):
    """UTC stamps only: session-events.log (+00:00) and samples.log (Z)."""
    st = time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S")
    return calendar.timegm(st)


def window_values(path, win, pattern):
    """Values inside any arm window: {arm: [floats]}."""
    got = {a: [] for a in win}
    for line in path.read_text().splitlines():
        m = re.match(r"(\S+)", line)
        if not m:
            continue
        try:
            ts = parse_ts(m.group(1))
        except ValueError:
            continue
        for arm, (a, b) in win.items():
            if a <= ts <= b and (v := re.search(pattern, line)):
                got[arm].append(float(v.group(1)))
    return got


def nearest_values(path, win, pattern):
    """{arm: (value_in_last_line_before_start, value_in_first_line_after_end)}
    for sparse samplers: the reading either side of each arm window."""
    rows = []
    for line in Path(path).read_text().splitlines():
        m = re.match(r"(\S+)", line)
        if m and (v := re.search(pattern, line)):
            try:
                rows.append((parse_ts(m.group(1)), float(v.group(1))))
            except ValueError:
                continue
    got = {}
    for arm, (a, b) in win.items():
        before = [v for t, v in rows if t <= a]
        after = [v for t, v in rows if t >= b]
        got[arm] = ((before or [None])[-1], (after or [None])[0])
    return got


def main(run_dir):
    run = Path(run_dir)
    clean = read_clean(run)
    lines = []

    lines.append("# clean timing (driver-gated, no logging), n = 3 reps/cell")
    lines.append("arm\tdepth\tpp128 tok/s ± sd\tms/chunk ± sd")
    for arm in ARM_ORDER:
        for d in DEPTH_ORDER:
            mean, sd = clean[arm][d]
            ms = 128000.0 / mean
            lines.append(f"{arm}\t{d}\t{mean:.2f} ± {sd:.2f}\t"
                         f"{ms:.1f} ± {sd / mean * ms:.1f}")

    lines.append("\n# tok/s ratios")
    lines.append("depth\tB/A\tC/A\tB/C")
    for d in DEPTH_ORDER:
        a = clean["A-nkvo"][d][0]
        b = clean["B-offload"][d][0]
        c = clean["C-app-vq4"][d][0]
        lines.append(f"{d}\t{b / a:.2f}\t{c / a:.2f}\t{b / c:.2f}")

    lines.append("\n# OLS slope of ms/chunk vs depth")
    lines.append("arm\tms per 1k context tokens\tintercept ms")
    for arm in ARM_ORDER:
        pts = [(d, 128000.0 / clean[arm][d][0]) for d in DEPTH_ORDER]
        s, i = ols(pts)
        lines.append(f"{arm}\t{s:.1f}\t{i:.1f}")

    win = arm_windows(run / "session-events.log")
    skin = window_values(run / "session-events.log", win,
                         r"'skin_C': '([0-9.]+)'")
    bat_t = window_values(run / "session-events.log", win,
                          r"'battery_temp_c': '([0-9.]+)'")
    bat_p = window_values(run / "session-events.log", win,
                          r"'battery_level': '(\d+)'")
    th = window_values(run / "session-events.log", win,
                       r"'thermal_status': '(\d+)'")
    cpu7 = nearest_values(run / "samples.log", win, r"cpu7_max=(\d+)")

    lines.append("\n# per-arm device state over route-start → clean-end")
    lines.append("arm\twall_s\tbat_pct\tbat_temp_C\tthermal\tskin_C\t"
                 "cpu7_max_freq_kHz before -> after")
    for arm in ARM_ORDER:
        a, b = win[arm]
        cb, ca = cpu7[arm]
        cbs = f"{cb:.0f}" if cb is not None else "-"
        cas = f"{ca:.0f}" if ca is not None else "-"
        lines.append(f"{arm}\t{b - a:.0f}\t"
                     f"{min(bat_p[arm])}-{max(bat_p[arm])}\t"
                     f"{min(bat_t[arm])}-{max(bat_t[arm])}\t"
                     f"{min(th[arm])}-{max(th[arm])}\t"
                     f"{min(skin[arm])}-{max(skin[arm])}\t"
                     f"{cbs} -> {cas}")
    print("\n".join(lines))
    (run / "tables.txt").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
