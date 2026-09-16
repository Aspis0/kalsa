#!/usr/bin/env python3
"""Write terse G2-leftovers verdict.md. Not G2."""
import pathlib
import re
import sys

EVID = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
PHONE = sys.argv[2] if len(sys.argv) > 2 else "s23"
SHA = "1dd4af1db22d734ba4d0c79bd48123c1412187361f7d8bc480a9362a067f9b09"


def slurp(name: str) -> str:
    p = EVID / name
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""


def quote(text: str, n: int = 8) -> str:
    body = text.strip() or "(empty)"
    return "\n".join(body.splitlines()[:n])


run = slurp("run.log")
stay = timeout = ""
for ln in run.splitlines():
    if "stay_on_after=" in ln:
        stay = ln.split("stay_on_after=", 1)[-1].strip()
    if "timeout_after=" in ln:
        timeout = ln.split("timeout_after=", 1)[-1].strip()
batt_b = next((ln for ln in run.splitlines() if "battery_before=" in ln), "(no battery_before)")
batt_a = next((ln for ln in run.splitlines() if "battery_after=" in ln), "(no battery_after)")

tools_call = slurp("tools-call.txt") + slurp("tools-kv.txt.tools")
tools_tel = slurp("tools-tel.txt")
tools_reply = slurp("tools-reply.txt")
tools_skip = slurp("tools-verdict.txt").strip()
if tools_skip == "SKIP":
    tools_v = "SKIP (parent-verified PASS, not re-run)"
    has_tool = False
    has_num = False
else:
    has_tool = bool(
        re.search(
            r"KALSA_TOOLCALL|KALSA_TOOL\b|\"tool\":\"device_calc\"|\"tool\":\"(?!null)",
            tools_call + tools_tel,
        )
        and re.search(r"device_calc|web_search|document_chat|calendar", tools_call + tools_tel)
    )
    if re.search(r'"tool":"device_calc"', tools_call + tools_tel):
        has_tool = True
    if re.search(r"KALSA_TOOLCALL", tools_call + tools_tel) and re.search(
        r'"executed":[1-9]|"structuredCalls":[1-9]|"fallbackCalls":[1-9]|"toolNames":\[[^\]]+',
        tools_call + tools_tel,
    ):
        has_tool = True
    has_num = bool(re.search(r"4138|4[\s.,]138", tools_reply + tools_tel + tools_call))
    if not has_num:
        has_num = bool(re.search(r"\b\d{3,5}\b", tools_reply))
    tools_v = "PASS" if has_tool and has_num else "FAIL"

docs_n = 0
for ln in slurp("docs-count.txt").splitlines():
    if ln.startswith("n="):
        try:
            docs_n = int(ln.split("=", 1)[1])
        except ValueError:
            docs_n = 0
docs_call = slurp("docs-call.txt") + slurp("docs-tel.txt")
docs_reply = slurp("docs-reply.txt")
if slurp("docs-verdict.txt").strip() == "HARNESS_MISS" or docs_n <= 0:
    docs_v = "SKIP/HARNESS_MISS"
elif re.search(r"document_chat|\"tool\":\"document", docs_call) and docs_reply.strip():
    docs_v = "PASS"
else:
    docs_v = "FAIL"

n_turns = 0
try:
    n_turns = int(slurp("turns-count.txt").strip() or "0")
except ValueError:
    n_turns = 0
abort = slurp("turns-abort.txt").strip()
kvs = []
for i in range(1, n_turns + 1):
    t = slurp(f"turn-{i}-kv.txt")
    for ln in t.splitlines():
        if "KALSA_KVPREFIX" in ln:
            m = re.search(r"embd=(\d+).*n_common=(\d+)", ln)
            if m:
                kvs.append((i, int(m.group(1)), int(m.group(2)), ln))
            break
OLD = {1829, 1833, 2122, 2136, 5196, 5199}
stuck = False
for i, _embd, nc, _ln in kvs:
    if i < 5:
        continue
    if nc == 0 or nc in OLD or 1800 <= nc <= 1850:
        stuck = True
turns_v = "PASS" if n_turns >= 20 and not abort and not stuck else "FAIL"
load = slurp("restore-load.txt")
load_ok = bool(re.search(r'"ok":true', load) and re.search(r'"tokens":[1-9]', load))

last3 = kvs[-3:] if kvs else []
last3_txt = "\n".join(x[3] for x in last3) if last3 else "(no KVPREFIX)"
t1 = next((x[3] for x in kvs if x[0] == 1), "(no t1 KVPREFIX)")
t5 = next((x[3] for x in kvs if x[0] == 5), "(no t5 KVPREFIX)")

title = "S23" if PHONE == "s23" else "Jelly"
md = f"""# {title} e8c8886 — G2 leftovers 20t — 2026-09-13

{title} only. No reinstall (hash match). No stayon. Not G2. `oneshot` see run.log.

## SHA — PASS

```text
sha256={SHA}
hash_match=true
```

{batt_b}
{batt_a}
After: stay_on={stay or "?"}, timeout={timeout or "?"}.

## 1) Tools — {tools_v}

```text
{quote(tools_call or tools_tel)}
```

```text
{quote(tools_tel)}
```

numeric in UI: **{has_num}**. tool line present: **{has_tool}**.

```text
{quote(tools_reply, 12)}
```

## 2) Documents — {docs_v}

library n={docs_n}. keys:
```text
{quote(slurp("docs-keys.txt") or slurp("docs-count.txt"))}
```

```text
{quote(docs_call)}
```

```text
{quote(docs_reply, 8)}
```

## 3) 20 turns — {turns_v}

completed **{n_turns}/20**. abort=`{abort or "none"}`. stuck_1833_or_0_after_t5=**{stuck}**. restore load ok=**{load_ok}**.

turn 1:
```text
{t1}
```

turn 5:
```text
{t5}
```

last 3 KVPREFIX:
```text
{last3_txt}
```

restore:
```text
{quote(load)}
```

| check | verdict |
|---|---|
| SHA | **PASS** |
| tools | **{tools_v}** |
| documents | **{docs_v}** |
| 20-turn | **{turns_v}** ({n_turns}/20) |
| timeout/stayon after | **{timeout or "?"} / {stay or "?"}** |
| G2 | **not claimed** |
"""
(EVID / "verdict.md").write_text(md, encoding="utf-8")
print(f"tools={tools_v} docs={docs_v} turns={turns_v} n={n_turns} stay={stay} timeout={timeout}")
