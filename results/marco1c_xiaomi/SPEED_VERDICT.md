# SPEED VERDICT — Marco1c on Xiaomi 14 + CalaQwen perf-mode follow-up

**Date:** 2026-08-13
**Device:** Xiaomi 14 (`23127PN0CG` / `houji` / SM8650), wireless adb `adb-625689a2`
**Status:** COMPLETE · 7/7 cells EXIT=0 · UNPLUGGED 72% → 68% · battery 33–35 °C
**Product cell:** Marco1c `-t 6` median **4.101 tok/s** / **51.5 MiB/tok** / **53.5% hit**
**Perf-mode (CalaQwen collapse):** **PERF_MODE_NULL**

## Identity

| id | path | size B | sha256 |
|---|---|---:|---|
| Marco1c | `taskb/Marco-Mini-Instruct-KEXP.gguf` | 6 385 238 848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |
| CalaQwen | `taskb/Qwen3.6-35B-A3B-KEXP.gguf` | 13 416 430 592 | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` |
| Binary | `taskb/bin/bmoe-cli` | — | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |

PC sha = device sha (both models). Binary pin MATCH before and after. `--version` 0.19.0.
Prompts: `p_fact` `b5301c32…` (361 B) · `p_creative` `761db0d0…` (268 B).
extm: `persist.miui.extm.*` empty, `getprop \| grep extm` none. OFF.

## Protocol

k6d065, n=200, cold `fadv` DONTNEED except the sustained cell.
Primary `-t 6` = lineup Xiaomi-class (`cpu_capacity ≥ 50%`). `-t 4` is the alt check.
UNPLUGGED only for timed cells. Start gate unplugged && ≥ 55% (opened at 72%). Floor 45%. Abort 43 °C (never fired).
MemAvailable guard 300 MiB / 60 s (never fired).

## Runs

| tag | -t | tok/s | MiB/tok | hit% | compute | flash I/O | MiB/s | TTFT | load | batt | temp | notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| m1c_t6_fact_r1 | 6 | 4.109 | 52.28 | 52.6 | 0.116 | 0.315 | 166 | 9.347 | 3.568 | 72 | 34 | product |
| m1c_t6_creative_r2 | 6 | 4.093 | 50.69 | 54.3 | 0.104 | 0.303 | 167 | 13.108 | 7.073 | 71 | 35 | product |
| m1c_t6_creative_sust | 6 | 6.839 | 50.69 | 54.3 | 0.060 | 0.204 | 248 | 5.835 | 2.854 | 71 | 33 | no fadvise |
| cq_t6_fact_perf_r1 | 6 | 2.156 | 33.16 | 79.2 | 0.256 | 0.496 | 67 | 21.966 | 12.844 | 70 | 32 | perf ON |
| cq_t6_fact_perf_r2 | 6 | 2.793 | 33.16 | 79.2 | 0.217 | 0.320 | 104 | 25.438 | 14.220 | 69 | 33 | perf ON |
| m1c_t6_fact_perf | 6 | 6.253 | 52.28 | 52.6 | 0.075 | 0.192 | 273 | 6.781 | 3.458 | 69 | 34 | perf ON |
| m1c_t4_fact | 4 | 8.577 | 52.29 | 52.6 | 0.048 | 0.150 | 349 | 6.049 | 3.013 | 68 | 34 | alt t |

`--cache-mb 2000` FIT (1999.5 MiB Marco1c / 1999.2 MiB CalaQwen) every run.

## Perf-mode

Enabled: `speed_mode=1`, `screen_game_mode=1`, `gb_boosting=1`. Restored to 0.
CalaQwen t6 fact med 2.475 vs original 2.55 (**0.97×**). Cold opener 2.156 vs 4.023.
**PERF_MODE_NULL** — does not fix the sustained-decode collapse.

## Why t6 is the card number

The lineup sheet pins Xiaomi at `-t 6`. t4 is 8.577 (near S23 8.819) and shows the SoC is thread-sensitive on this model. Do not silently swap the product t.

## Files

`results/marco1c_xiaomi/` — `runs.csv`, `device_pull/`, `sha_records.md`, `battery_poll.csv`, `battery_notes.txt`, `perf_mode_on.txt`, `perf_mode_restored.txt`.
