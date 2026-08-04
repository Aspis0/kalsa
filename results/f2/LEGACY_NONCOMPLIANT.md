# F2.2 / F2.3 legacy rows — NONCOMPLIANT with §8.2 (2026-08-04)

These rows remain in `results/runs.csv` for audit. They must **not** be used for gate
medians, best-so-far, or DONE claims.

## Why noncompliant

| Rule §8.2 | Legacy behaviour |
|---|---|
| Cooldown ≥3 min idle between reps | `COOLDOWN_S=15–25` in runners |
| Batt temp ≤30.0°C before every rep | Gate only ≤32°C; many starts at 31–32°C |
| Sentinel anti-drift after each stage | Not implemented |
| majflt >50k excluded from baseline median | All rows entered median |
| Declared start t=5,c=1024 | Grid started measuring t=4 first (declared BEST_T=5 only as seed) |

## Phase F2.2 (Qwen3.5-4B) — 18 rows (2026-08-04 ~02:45–09:12)

- threads {4,5,6}@c1024 kv=q8_0: 9 rows (hot regime; medians 5.30/4.70/4.20)
- ctx {512,4096}@t4: 6 rows (c512 rest-phone 8.9/8.7 vs back-to-back 5.9)
- kv f16@t4 c512: 3 rows
- Claimed best legacy: t=4 c=512 kv=q8_0 median **8.70** (inflated by mixed rest/hot; no sentinel)
- Reboot mid-grid: confirmed (`ro.boot.bootreason=reboot`, uptime gap ~03:52→08:32)

## Phase F2.3 (LFM2) — partial, stopped mid-ctx (2026-08-04 ~09:16–11:13)

- threads {4,5,6}@c1024: 9 rows (temps often 31–35°C end; majflt multi-million)
- ctx c512@t4: 3 rows (eval 21.9 / 0.9 / 4.3 — unstable)
- ctx c4096@t4: 1 row then runner stopped by operator (noncompliant protocol)
- cooldown 25s; no sentinel; no cool≤30 gate

## Compliant replacement

- Phase tags: **F2.2c** / **F2.3c** (legacy F2.2/F2.3 tags are refused by the grid)
- Script: `scripts/run_f2_grid.sh` with `--cooldown 180 --max-cool-temp 30.0` (floor/ceiling enforced)
- Starters: `scripts/start_f2_2c.sh`, `scripts/start_f2_3c.sh` (no broad pkill)
- Retired (hard refuse): `scripts/start_f2_2_resume.sh`, `scripts/start_f2_3.sh`
- Audit: `reports/moe-f2-resume-audit.md` — **0** legacy rows are valid for gate medians
