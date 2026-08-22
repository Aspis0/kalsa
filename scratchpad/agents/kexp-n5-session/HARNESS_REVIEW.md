# HARNESS REVIEW — KEXP N≥5 confirmatory ship (`run_n5.ps1`)

Hostile audit vs `PREREG_KEXP_N5.md` protocol **v1.2**, lock **618323c**.
Saved from reviewer `01a027e9-5b42-7410-b6da-1478c2445328` (write was blocked in the child).

**Ship-session verdict at review time: DO NOT START.** Fixes applied in `run_n5.ps1` / `dump_env.sh` / `launch_bg.sh` before block 1: F1 refuse-if-ABORT, F2 pidof+CSV-on-stall, F3 detached nohup, F4 raw env dump before unset, F5 re-check before stall, F6 pause ≠ abort, plus F7 wakeup-immediately-before, F9 Stopwatch, F11 require jsonl fields, palindrome completeness.

See the reviewer transcript in the parent session for full F1–F13 text.
