# kf_cold_jelly — in-flight state (2026-08-16 18:40)

## Status

`STOP_PLUGGED` at **RESUME_AT=17**. sshd down since 18:16. Phone was
`PLUGGED_AC` 60 % / 32 °C at last contact.

## What is already on disk (authoritative)

- Binary pin verified: `77a94640…` (`~/bin/kernel_kf/bmoe-cli`), flag is the arm.
- Cold floor declared 14:22:15 **before pairs**: `11144366080` bytes
  (50 % of first OFF `read_bytes=22288732160`). See `COLD_FLOOR.md`.
- **15 COLD-VALID kept blocks** (1–15), 0 warmth excludes among kept rows.
- Block 16 void after 3 tries (duplicate harness + SIGKILL during resume).
  Pair (16 OFF, 15 ON) is void; re-run of 16 is pending at end.
- Interruptions (disclosed, PREREG-allowed resume):
  1. sshd/process died after block 5 (14:41). Resumed 16:15 at block 6.
  2. sshd/process died after block 15 (17:05). Resumed 18:05 at block 16.
  3. Duplicate harness from `am start com.termux` keepalive — killed.
  4. `STOP_PLUGGED` at block 17 start (18:13).

## Remaining

Blocks 17–24 + appended retry of block 16. Need those for N=12; N≥10
requires through block 20 plus a kept 16 (or drop the void pair and
accept N=10 from quartets 1–3 + 5 if 17–20 complete and 16 stays void:
quartets 1–3 = 6 pairs, quartet 4 incomplete without 16, quartet 5 = 2,
total 8 — **not** 10). So we need **either** a kept 16 **or** both
quartets 5 and 6 (17–24) **and** 16. Practically: finish 16–24.

## Do not

Change arms, width, N_GEN, cooldown, or the analyzer.
