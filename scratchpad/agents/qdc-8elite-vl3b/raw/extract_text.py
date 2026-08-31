#!/usr/bin/env python3
# Determinism-probe extraction rule for cell #42 (audit fix F14).
# Text = everything AFTER the "encoding done" log line, up to (excluding)
# "KALSA_VL_TIMING", with timestamped log lines (^D.D.D.D [IWE] ) removed,
# stripped. sha256 of the UTF-8 bytes, first 12 hex chars reported.
import hashlib, re, sys
for f in sys.argv[1:]:
    t = open(f, errors="replace").read()
    t = t[t.rindex("encoding done"):]
    t = t[t.index("\n") + 1:]
    t = t.split("KALSA_VL_TIMING")[0]
    t = "\n".join(l for l in t.splitlines() if not re.match(r"^\d+\.\d+\.\d+\.\d+ [IWE] ", l)).strip()
    print(hashlib.sha256(t.encode()).hexdigest()[:12], f.split("/")[-1])
