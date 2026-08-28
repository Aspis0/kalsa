# Errata — s23-unplugged-baseline-night0 (bank companion)

Audit: night0-bank-audit/REPORT.md (GLM, hostile, 2026-08-28). Verdict BANK-WITH-ERRATA.
Banked claim (verified by orchestrator on disk): unplugged correctness only —
MUL_MAT_ID 407/407 (raw/cert_mmid.out:815), MUL_MAT 925/925 (raw/cert_mm.out:1473),
s3oracle pin set 11/11, ac:false in battery.pre of all runs. **No speed numbers.**

1. **AMENDMENT-1 premise was wrong.** It cited idle drain ~7.5%/h; the cell's own raw
   shows 13–15%/h (89→63% in 2h; 60→50% in 40 min Dozing). At 46% start the authorized
   block had ~4 minutes of headroom over the 45% floor — arithmetically unfinishable.
   The transport death ended a block that could not have completed anyway.
2. **Possible orphan result on-device.** llama-bench ran under nohup/setsid and writes
   its jsonl to an on-device .out; the tg128 cell-A workload had started before the
   transport died. A `kexp_tg128_b1_1_A.out` may exist on the S23. TO DO at replug:
   pull it, declare its content either way. Even if complete, cell A alone is not an
   ABBA block — it can inform, not bank.
   **RESOLVED 2026-08-28 ~18:45 EDT (declared either way, as promised): the orphan is
   EMPTY.** Checked over wireless adb at first reconnect (S23 charging on AC, 9%):
   `/data/local/tmp/s23_unplugged_night0/kexp_tg128_b1_1_A.out` = 0 bytes. The .err
   (209 B) shows llama-bench got as far as OpenCL platform/device init on the Adreno
   740; the thermal guard logged normally (last lines 35.9 °C / batt 46%) until the
   process group died with the transport at 10:59 device time. No numbers were ever
   written → nothing to recover, nothing that could have informed cell A.
3. **Undeclared port migration.** The night run logged :36329; the morning retry used
   :37687 after a Doze rotation + re-pair, not covered by the prereg's "same IP:port"
   reconnect clause, and the morning attempt has no raw log of its own.
4. **Device identity is asserted, not proven in raw/**: no SM_S911U/serial match in the
   raw files; the endpoint→device chain lives in RUN_LOG prose (pairing was performed
   by the orchestrator on-screen with the owner, which is the actual provenance).
5. **Gate at zero margin.** Amendment gate ≤36.0 °C was met at exactly 36.0/35.9 —
   compliant but borderline; declared here.
6. The #18/#20 ratio arithmetic in REPORT.md was checked and is correct (0.812 / 0.724).

Consequence for the plan: the unplugged speed matrix on the S23 is DEAD for this trip
(three blockers on three attempts: thermal plateau awake, drain floor, transport).
Speed moves to QDC 8 Elite cells and/or post-trip S23 plugged/USB sessions.
