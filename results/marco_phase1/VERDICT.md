# Marco Phase1 quality VERDICT (post-reset resume)

Fail-fast IT+EN: A1/A2/A3 all PASS (see runs_quality.csv).
Full multi5 gates vs A0: per-lang d<=+0.10, macro d<=+0.04.

A1: full_gate=PASS macro=0.7317 dMacro=0.0040
A2: full_gate=PASS macro=0.7459 dMacro=0.0182
A3: full_gate=PASS macro=0.7372 dMacro=0.0095

Speed device (2026-08-12, S23 unplugged, ABBA n=200): **PASS both levers** —
A2 decode 5.371 vs A0 4.122 = 1.303x (gate >=1.15x); MiB/tok 126.2 vs 192.5 =
-34.4% (gate <=-20%). hit +3.2pt. See results/marco_phase1/speed_s23/.

PHASE 1 COMPLETE: quality 3/3 full PASS + speed PASS. Per PROTOCOL, runtime
transfer is SUFFICIENT (speed moved on both levers). Cell choice for product:
A2 (k6d065) has measured speed and worst-but-in-gate quality (dMacro +0.0182,
zh +0.0332); A3 (k6d050) halves the quality cost (+0.0095) but its device
speed was not measured. Fase 2 MarcoKEXP remains the I/O-regime upgrade
(same-device KEXP: 30.7 MiB/tok, hit 80.7% vs Marco A2 126.2 / 36.7).
