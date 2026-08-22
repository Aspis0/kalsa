#!/usr/bin/env python3
"""Parse test-backend-ops MUL_MAT stdout. ASCII only."""
from pathlib import Path
from collections import Counter
import re

p = Path(__file__).resolve().parent
text = (p / "run2.out").read_text(encoding="utf-8", errors="replace")
lines = text.splitlines()

ok = fail = skip = 0
fail_type = Counter()
ok_type = Counter()
nan_cpu = 0
first_fails = []
type_re = re.compile(r"type_a=([A-Za-z0-9_]+)")

for line in lines:
    if "not supported" in line:
        skip += 1
        continue
    if ": " in line and line.rstrip().endswith("OK") or "OK\x1b" in line or "mOK" in line:
        if "OK" in line and "FAIL" not in line and "MUL_MAT" in line:
            ok += 1
            m = type_re.search(line)
            if m:
                ok_type[m.group(1)] += 1
            continue
    if "FAIL" in line and "MUL_MAT" in line:
        fail += 1
        m = type_re.search(line)
        t = m.group(1) if m else "?"
        fail_type[t] += 1
        if "CPU=nan" in line or "CPU=-nan" in line:
            nan_cpu += 1
        if len(first_fails) < 12:
            # strip ANSI
            clean = re.sub(r"\x1b\[[0-9;]*m", "", line)
            first_fails.append(clean)

passed_line = [ln for ln in lines if "tests passed" in ln]
summary = []
summary.append(f"ok={ok}")
summary.append(f"fail={fail}")
summary.append(f"not_supported={skip}")
summary.append(f"fail_cpu_nan={nan_cpu}")
summary.append("ok_by_type=" + ",".join(f"{k}:{v}" for k, v in sorted(ok_type.items())))
summary.append("fail_by_type=" + ",".join(f"{k}:{v}" for k, v in sorted(fail_type.items())))
summary.append("passed_lines=" + " | ".join(passed_line))
summary.append("--- first FAIL dumps ---")
summary.extend(first_fails)
out = "\n".join(summary) + "\n"
(p / "run2_summary.txt").write_text(out, encoding="ascii", newline="\n")
print(out)
