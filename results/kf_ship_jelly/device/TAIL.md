# KF REALITY — Jelly tail / energy / thermal / memory

Status: RUNNING (skeleton — fill with `analyze_kf_reality.py` after the cell)

## Sequence

Blocks follow `block_plan.txt` (default **OFF ON:6 ON:6 OFF** — v1 ABBA).
ON tokens are `ON:<width>` and pass `--kf-prefetch-width`. OFF ignores width.

Each block is one continuous N_GEN-token generation. No cold reset
between blocks. Per-token rows come from native `--csv` (`wall_ms`, `stall_ms`,
`ra_issue_ms`, `ra_wd_ms`). ON per-token files are `b{N}_ON_w{W}.csv`.

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | — | |
| KF_THERMAL_WIN | — | |
| KF_MEMORY_WIN | — | |
| KF_ROBUST_WIN | — | |

Thresholds live in `analyze_kf_reality.py` header. Do not invent numbers here.
