#!/usr/bin/env python3
"""DESIGN 3.4 checks for the Xiaomi Stage 0 observation rows (cell xiaomi-stage0-obs-aa789620).

Reads the pulled observations.jsonl and prints one verdict per criterion with the numbers behind it.
Cell order is read from the code, not assumed:
  win cell 0 tokens, 1 leg_prev (0 cpu / 1 gpu / 2 npu / 3 gpu-coolmode marker / -1 none),
  2 headroom, 3 headroom_age_ms, 4 status, 5 status_age_ms, 6 app_age_ms,
  7 cpu_hot_c, 8 npu_hot_c, 9 gpu_hot_c, 10 applied_headroom, 11 applied_status, 12 duty_last.
  trips: [cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max], in C.
  bsys:  [temp_ok, temp_tenths_c, status_ok, status].
  tok/us: [cpu, gpu, npu].
"""
import json
import math
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "observations.jsonl"
rows = [json.loads(l) for l in open(PATH) if l.strip()]
print(f"rows: {len(rows)}  file: {PATH}\n")


def leg_tps(row):
    """Per-leg decode tok/s from the row's token and microsecond deltas."""
    out = {}
    for name, i in (("cpu", 0), ("gpu", 1), ("npu", 2)):
        tok, us = row["tok"][i], row["us"][i]
        out[name] = (tok * 1e6 / us) if us else None
    return out


print("=== per-row ===")
hdr = f"{'t':>4} {'rnd':>3} {'gap':>3} {'pred_n':>6} {'sum_tok':>7} {'pps':>6} {'npuTps':>7} {'win':>4} {'ovf':>3} {'hfAge':>6} {'maxWinHfAge':>10} {'maxAppAge':>9} {'bsys':>16}"
print(hdr)
c = dict(gap=0, neg=0, winlen_bad=0, ovf=0, hf_age_bad=0, trips_ok=0, sum_delta=[], tps_rows=[])
for r in rows:
    win = r.get("win") or []
    pred_n = r.get("pred_n")
    sum_tok = sum(x or 0 for x in (r["tok"] or []))
    ages = [w[3] for w in win if isinstance(w[3], (int, float))]
    appages = [w[6] for w in win if isinstance(w[6], (int, float))]
    first_hf_age = (r.get("first") or [None] * 4)[3]
    tps = leg_tps(r)
    npu_tps = tps["npu"]
    bsys = r.get("bsys")
    print(
        f"{str(r.get('t')):>4} {str(r.get('round')):>3} {r.get('gap'):>3} {str(pred_n):>6} {sum_tok:>7} "
        f"{(f'{r.get("pps"):.2f}' if isinstance(r.get('pps'), (int, float)) else 'None'):>6} "
        f"{(f'{npu_tps:.2f}' if npu_tps else 'None'):>7} {len(win):>4} {r.get('win_ovf'):>3} "
        f"{(first_hf_age if isinstance(first_hf_age, (int, float)) else 'None'):>6} "
        f"{(max(ages) if ages else 'None'):>10} {(max(appages) if appages else 'None'):>9} "
        f"{str(bsys):>16}"
    )
    if r.get("gap"):
        c["gap"] += 1
    if any(isinstance(v, (int, float)) and v < 0 for v in (r["tok"] + r["us"] + list(r["paced"]))):
        c["neg"] += 1
    if isinstance(pred_n, (int, float)):
        c["sum_delta"].append(sum_tok - pred_n)
        want = math.ceil(pred_n / 32)
        if len(win) != want:
            c["winlen_bad"] += 1
    if r.get("win_ovf"):
        c["ovf"] += 1
    hf = [a for a in [first_hf_age] + ages if isinstance(a, (int, float))]
    if hf and max(hf) > 3000:
        c["hf_age_bad"] += 1
    tr = r.get("trips") or []
    if tr and all(isinstance(v, (int, float)) and math.isfinite(v) for v in tr):
        c["trips_ok"] += 1
    # criterion 3: unpaced 100 % NPU row
    if (
        isinstance(pred_n, (int, float))
        and r["tok"][2] > 0
        and r["tok"][0] == 0
        and r["tok"][1] == 0
        and r["paced"][0] == 0
        and npu_tps
        and isinstance(r.get("pps"), (int, float))
    ):
        c["tps_rows"].append((npu_tps, r["pps"], 100 * abs(npu_tps - r["pps"]) / r["pps"]))

print("\n=== DESIGN 3.4 verdicts (Xiaomi arm) ===")
ok = lambda b: "PASS" if b else "FAIL"  # noqa: E731
print(f"1 one row per completion, no gap:1 on an unstopped turn -> {ok(c['gap'] == 0)} ({len(rows)} rows, {c['gap']} gaps)")
sd = c["sum_delta"]
print(
    f"2 every delta >= 0 and tok sums to pred_n within 2 -> {ok(c['neg'] == 0 and all(abs(d) <= 2 for d in sd))}"
    f" (negative deltas {c['neg']}, sum-pred_n in [{min(sd) if sd else 0},{max(sd) if sd else 0}])"
)
if c["tps_rows"]:
    worst = max(c["tps_rows"], key=lambda t: t[2])
    print(f"3 unpaced 100 % NPU row within 10 % of pps -> {ok(worst[2] <= 10)} ({len(c['tps_rows'])} row(s), worst {worst[0]:.2f} vs {worst[1]:.2f} = {worst[2]:.1f} %)")
else:
    print("3 unpaced 100 % NPU row within 10 % of pps -> NOT TESTABLE (no unpaced 100 % NPU row)")
print(f"4 win length = ceil(pred_n/32), no overflow -> {ok(c['winlen_bad'] == 0 and c['ovf'] == 0)} ({c['winlen_bad']} wrong length, {c['ovf']} overflowed)")
tr = rows[-1].get("trips") if rows else None
print(f"5 trips finite for all three legs -> {ok(c['trips_ok'] == len(rows) and len(rows) > 0)} ({c['trips_ok']}/{len(rows)} rows, last row {tr})")
hf = [a for r in rows for a in [((r.get('first') or [None]*4)[3])] + [w[3] for w in (r.get('win') or [])] if isinstance(a, (int, float))]
print(f"6 first[headroom_age] and every window h_age <= 3000 ms -> {ok(c['hf_age_bad'] == 0)} (max observed {max(hf) if hf else 'n/a'} ms)")

print("\n=== OPEN 4: battery sysfs (bsys) vs BatteryManager ===")
sysfs_any = False
for r in rows:
    b = r.get("bsys") or []
    ok_temp, tenths, ok_st, st = (list(b) + [None] * 4)[:4]
    bm = r.get("batt")
    plug = r.get("plugged")
    if ok_temp:
        sysfs_any = True
        d = None if bm is None else abs(tenths / 10.0 - bm)
        print(f"turn {r.get('t')}/{r.get('round')}: sysfs {tenths/10.0:.1f} C vs BatteryManager {bm} C -> {'' if d is None else f'{d:.2f} C'}; sysfs status {st} vs plugged {plug}")
print("verdict OPEN 4 on this phone:", "sysfs READABLE (compare above)" if sysfs_any else "sysfs NOT readable (temp_ok false on every row), same as the S23")

print("\n=== feed for DESIGN 3.3 / Stage 2 gates ===")
appages = [w[6] for r in rows for w in (r.get("win") or []) if isinstance(w[6], (int, float))]
if appages:
    appages.sort()
    print(f"app_sample age (window cell 6), ms: n={len(appages)} min={appages[0]} median={appages[len(appages)//2]} max={appages[-1]}  -> the 120 s Stage 2 gate would disarm at {'YES' if max(appages) > 120000 else 'no'} row(s)")
hs = [w[2] for r in rows for w in (r.get("win") or []) if isinstance(w[2], (int, float))]
if hs:
    blind = sum(1 for h in hs if h == 0)
    print(f"window forecast h: n={len(hs)} blind(0)={blind} awake(>0)={len(hs)-blind} min={min(hs)} max={max(hs)}")
legs = {}
for r in rows:
    for name, i in (("cpu", 0), ("gpu", 1), ("npu", 2)):
        legs[name] = legs.get(name, 0) + (r["tok"][i] or 0)
print(f"decode tokens per leg over the arm: {legs}")
temps = {}
for r in rows:
    for w in (r.get("win") or []):
        for name, i in (("cpu", 7), ("npu", 8), ("gpu", 9)):
            v = w[i]
            if isinstance(v, (int, float)):
                temps.setdefault(name, []).append(v)
for name, vs in temps.items():
    print(f"{name} hottest-zone temp: n={len(vs)} min={min(vs):.1f} max={max(vs):.1f} C")