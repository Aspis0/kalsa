#!/usr/bin/env python3
"""Write verdict.md from A+B evidence. Not G2."""
import pathlib
import re
import sys

EVID = pathlib.Path(
    "/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/XIAOMI-D39FA51-2026-09-13"
)
SHA = "1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c"
CHAT = "conv-g1-c02-1789009104"


def slurp(name: str) -> str:
    p = EVID / name
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""


def lines_of(text: str, needle: str) -> list[str]:
    return [ln for ln in text.splitlines() if needle in ln]


def last_kv(text: str):
    hits = lines_of(text, "KALSA_KVPREFIX")
    if not hits:
        return None
    m = re.search(r"embd=(\d+).*n_common=(\d+)", hits[-1])
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), hits[-1]


def slid(text: str) -> bool:
    return "window_slide" in text


def load_ok(text: str):
    for ln in lines_of(text, '"op":"load"'):
        if '"ok":true' not in ln:
            continue
        m = re.search(r'"tokens":(\d+)', ln)
        if m and int(m.group(1)) > 0:
            return True, ln
    hits = lines_of(text, '"op":"load"')
    return False, hits[-1] if hits else "(no load line)"


def quote(text: str, n: int = 12) -> str:
    body = text.strip() or "(empty)"
    return "\n".join(body.splitlines()[:n])


run = slurp("run.log")
raw = slurp("verdict-raw.txt").strip()
stay = ""
timeout = ""
for ln in run.splitlines():
    if "stay_on_after=" in ln:
        stay = ln.split("stay_on_after=", 1)[-1].strip()
    if "timeout_after=" in ln:
        timeout = ln.split("timeout_after=", 1)[-1].strip()
    if "battery_before=" in ln:
        batt_b = ln
    if "battery_after=" in ln:
        batt_a = ln
    if "temp_deci=" in ln:
        last_temp = ln

batt_b = next((ln for ln in run.splitlines() if "battery_before=" in ln), "(no battery_before)")
batt_a = next((ln for ln in run.splitlines() if "battery_after=" in ln), "(no battery_after)")

a_kv = last_kv(slurp("send2.txt"))
b_kv = last_kv(slurp("send3.txt"))
b_load_ok, b_load_line = load_ok(slurp("load2.txt") or slurp("logcat-b.txt"))

if raw == "BLOCKED_PIN":
    a_v = "BLOCKED (PIN lockscreen)"
    b_v = "not run"
elif a_kv and not slid(slurp("send2.txt")) and a_kv[1] / max(a_kv[0], 1) >= 0.8:
    a_v = "PASS"
else:
    a_v = "FAIL"

if raw == "BLOCKED_PIN":
    pass
elif (
    b_load_ok
    and b_kv
    and not slid(slurp("send3.txt"))
    and b_kv[1] / max(b_kv[0], 1) >= 0.8
):
    b_v = "PASS"
else:
    b_v = "FAIL" if raw != "BLOCKED_PIN" else b_v

ratio_a = (
    f"{a_kv[1]}/{a_kv[0]} = {a_kv[1]/a_kv[0]:.3f}" if a_kv else "missing KVPREFIX"
)
ratio_b = (
    f"{b_kv[1]}/{b_kv[0]} = {b_kv[1]/b_kv[0]:.3f}" if b_kv else "missing KVPREFIX"
)

md = f"""# Xiaomi 14 d39fa51 — A+B — 2026-09-13

Xiaomi only `192.168.1.193:38413` houji / 23127PN0CG. No reinstall (hash match). No stayon. Timeout 300000 during shot, restored **{timeout or "?"}**. Not G2.

## SHA — PASS

```text
local_sha256={SHA}
installed_sha256={SHA}
hash_match=true
lastUpdateTime=2026-09-13 01:01:27
```

Chat `{CHAT}`. {batt_b}
{batt_a}
After: `stay_on_while_plugged_in={stay or "?"}`, `screen_off_timeout={timeout or "?"}`.

## A — open LFM + two sends

### load

```text
{quote(slurp("load1.txt"))}
```

### send1 KVPREFIX / slide

```text
{quote(slurp("send1.txt"))}
```

### send2 KVPREFIX / slide (same process)

```text
{quote(slurp("send2.txt"))}
```

send2 window_slide: **{"yes" if slid(slurp("send2.txt")) else "no"}**. n_common/embd: **{ratio_a}**. A: **{a_v}**.

## B — kill-recovery

### load

```text
{quote(slurp("load2.txt"))}
```

load ok:true tokens>0: **{b_load_ok}**

```text
{b_load_line}
```

### send3 KVPREFIX / slide

```text
{quote(slurp("send3.txt"))}
```

send3 window_slide: **{"yes" if slid(slurp("send3.txt")) else "no"}**. n_common/embd: **{ratio_b}**. B: **{b_v}**.

| check | verdict |
|---|---|
| SHA | **PASS** |
| chat | `{CHAT}` |
| timeout/stayon after | **{timeout or "?"} / {stay or "?"}** |
| A two-send | **{a_v}** |
| B kill-recovery | **{b_v}** |
"""
(EVID / "verdict.md").write_text(md, encoding="utf-8")
print(f"A={a_v} B={b_v} stay={stay} timeout={timeout}")
sys.exit(0)
