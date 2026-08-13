# moe-calaqwen-xiaomi

**Question:** what is CalaQwen (KEXP 35B, campaign k6d065) on the 2024-flagship
class the premium buyer owns (Xiaomi 14 / SM8650 / UFS 4.0), vs the S23
campaign card (5.86 med / 30.7 MiB/tok / 80.7% hit)?

Date: 2026-08-13 (retry after HyperOS Memory Extension OFF)
Device: Xiaomi 14 (`23127PN0CG` / `houji` / SM8650), Android 16, **UNPLUGGED**
  88% → 84%, 33–36 °C. Wireless adb `adb-625689a2` @ 192.168.1.193:40501.
Binary: **campaign pin** `bmoe-cli` sha
  `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
  `--version` 0.19.0 after complete DT_NEEDED (incl. `libssl.so.3` /
  `libcrypto.so.3` from idle S23 Termux, one scp). Not the k4 fallback.
Model: `Qwen3.6-35B-A3B-KEXP.gguf` 13 416 430 592 B
  sha `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a`
  (device sha256sum MATCH).
Config: k6d065 — `-c 4096 --moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65
  --temp 0 --chatml --no-think`
Prompts: byte-identical to `results/marco_phase1/speed_s23/prompts/`
  `p_fact.txt` sha `b5301c32…` (361 B) · `p_creative.txt` sha `761db0d0…` (268 B)
Primary `-t`: **6** (SM8650 `cpu_capacity ≥ 50%`: cpu2–cpu7; A520 cpu0/cpu1
  excluded). `-t 4` reference: one run per prompt, both completed.
Artifacts: `results/xiaomi_ab/taskb_retry/`
S23 / Jelly: untouched this session (S23 scp of two .so only, after
  `pgrep -f bmoe-cli` idle).

This is a **product datapoint**, not a silicon A/B. Different `-t`, different
SoC, different UFS. Same model, same flags, same two prompts, **same campaign
binary pin** as Marco-phase-1 KEXP on S23.

## TL;DR

| gate | result |
|---|---|
| ABBA k6d065 `-t 6` | **COMPLETE** 4/4. med **2.55 tok/s**, 30.39 MiB/tok, hit 80.75% |
| `-t 4` reference | **COMPLETE** 2/2. 2.384 / 2.476 tok/s |
| vs S23 5.86 / 30.7 / 80.7 | decode **~2.3× slower**; I/O + hit% **match** |
| vs prior Xiaomi (extm ON, k4 bin) 0.350 | decode **~7× faster**; compute 2.93 → 0.15–0.22 s/tok |

Do not quote the old 0.35 as the Xiaomi flagship number. That run was
swap-bound (Memory Extension writeback) on a different binary.

## 0. Method

- Memory Extension OFF confirmed before measure:
  `persist.miui.extm.enable` / `bdsize` / `version` all **empty**;
  `getprop \| grep extm` none; `/data/extm/extm_file` gone-or-denied.
  See `results/xiaomi_ab/taskb_retry/extm_verify.txt`.
- `am kill-all` + `am memory-factor set NORMAL`. MemAvailable 3.81 → 6.15 GiB
  immediately, 6.71 GiB at run start.
- Cold `posix_fadvise(DONTNEED)` via on-device `fadv` before every run.
- Never measured plugged. Start floor 60% (88% at first cell). Mid-run floor 45%.
  Battery 88 → 84% across six cells.
- Order: ABBA primary `-t 6` (fact, creative, creative, fact) then `-t 4`
  fact and `-t 4` creative. All six EXIT=0.
- n=200. Full stdout/stderr per run. CSV in `results/xiaomi_ab/taskb_retry/logs/runs.csv`.
  Engine `.out` is ground truth for t/s / MiB/tok / hit / majflt.
- MemAvailable guard 300 MiB / 60 s (never MemFree). Never fired. Min observed
  2517 MiB (cell 1 load). Curves in `results/xiaomi_ab/taskb_retry/curves/`.
- S23 5.86 med is from `reports/moe-adopt-kexp.md` parte 3 (prompts `short` /
  `f45_1`, `-t 4`, n=200, 4 cells). S23 30.7 MiB/tok / 80.7% hit / 5.696 tok/s
  is from `reports/moe-marco-phase1-runtime.md` same-session KEXP (prompts
  **p_fact / p_creative**, `-t 4`, 8 runs). Closest like-for-like column is
  the Marco-phase-1 KEXP row. Both are shown. Do not collapse them.

## 1. Xiaomi runs (this retry)

Source: `results/xiaomi_ab/taskb_retry/logs/*.out` + `parsed.csv`.

| tag | prompt | -t | decode t/s | MiB/tok | hit% | TTFT s | load s | n_gen | batt | temp °C | wall s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|
| t6_fact_o1 | fact | 6 | 4.023 | 33.16 | 79.2 | 18.370 | 8.979 | 200 | 88 | 33 | 79 |
| t6_creative_o2 | creative | 6 | 2.698 | 27.61 | 82.3 | 18.190 | 11.627 | 200 | 87 | 36 | 152 |
| t6_creative_o3 | creative | 6 | 2.403 | 27.61 | 82.3 | 25.301 | 13.805 | 200 | 87 | 35 | 218 |
| t6_fact_o4 | fact | 6 | 2.315 | 33.16 | 79.2 | 23.836 | 11.715 | 200 | 86 | 33 | 212 |
| t4_fact_ref | fact | 4 | 2.384 | 33.57 | 79.1 | 23.898 | 12.016 | 200 | 85 | 33 | 215 |
| t4_creative_ref | creative | 4 | 2.476 | 27.77 | 82.2 | 23.347 | 11.176 | 200 | 85 | 32 | 203 |

Per-token split (engine `moe-stream` / `compute` lines):

| tag | compute s/tok | flash I/O s/tok | flash MiB/s | CPU occ. | eng. majflt/tok | drop% |
|---|---:|---:|---:|---:|---:|---:|
| t6_fact_o1 | 0.151 | 0.222 | 149 | 56.4% | 5.21 | 5.6 |
| t6_creative_o2 | 0.200 | 0.390 | 71 | 37.9% | 0.00 | 2.9 |
| t6_creative_o3 | 0.211 | 0.501 | 55 | 33.9% | 0.00 | 2.9 |
| t6_fact_o4 | 0.217 | 0.505 | 66 | 34.2% | 0.01 | 5.6 |
| t4_fact_ref | 0.235 | 0.433 | 78 | 38.9% | 0.01 | 5.7 |
| t4_creative_ref | 0.219 | 0.441 | 63 | 39.7% | 0.01 | 2.9 |

`--cache-mb 2000` **FIT** (resident 1999.2 MiB every run). MemAvailable during
decode stayed 2.5–3.6 GiB min, recovered to ~7.3–7.5 GiB after each cell.
SwapFree did not drain. That is the opposite of the extm-ON attempt
(MemAvailable → 2.3 GiB mid-run, SwapUsed ~4 GiB, compute 2.9 s/tok).

The 5.21 majflt/tok on cell 1 is the **cold fadvise burst** (DONTNEED then
first touch of streamed experts). Cells 2–6 are 0.00–0.01. The previous
0.35 t/s run had 1–5 majflt/tok **and** 2.9 s compute — that was flash
writeback, not this first-touch burst.

## 2. Product table — Xiaomi vs S23

| | Xiaomi `-t 6` (primary, n=4) | Xiaomi `-t 4` (ref, n=2) | S23 campaign card | S23 Marco-P1 KEXP (same prompts) |
|---|---|---|---|---|
| decode med t/s | **2.55** (2.315 / 2.403 / 2.698 / 4.023) | 2.384 / 2.476 | **5.86** (grid, other prompts) | **5.696** |
| MiB/tok | **30.39** med (27.61 / 33.16) | 33.57 / 27.77 | **30.7** (P1 session) | **30.67** |
| hit% | **80.75** med (79.2 / 82.3) | 79.1 / 82.2 | **80.7** (P1 session) | **80.65** |
| TTFT s | **21.10** med | 23.90 / 23.35 | — | **18.98** |
| n | 4 | 2 | 4 (grid) | 8 |
| silicon | SM8650 / UFS 4.0 | SM8650 / UFS 4.0 | SM8550 | SM8550 |
| `-t` | 6 (cap≥50%) | 4 | 4 | 4 |
| binary | campaign `1ca51420…` | same | `1ca51420…` | `1ca51420…` |
| cache-mb | 2000 FIT | 2000 FIT | 2000 | 2000 |
| extm / RAM Plus | OFF | OFF | — | — |

Medians of four t6 values: sort, mean of the middle pair.

## 3. What changed vs the 0.35 draft

| | prior (extm ON, k4 static) | this retry (extm OFF, campaign pin) |
|---|---|---|
| decode med | 0.350 (n=3, 4th aborted) | **2.55** (n=4 + 2 refs) |
| compute s/tok | 2.66–2.93 | 0.15–0.22 |
| flash MiB/s | 60–67 | 55–149 |
| eng. majflt/tok | 1.3–4.9 **steady** | 5.21 cold then **~0** |
| MemAvailable mid-run | collapsed ~2.3 GiB + 4 GiB swap | 2.5–3.6 GiB floor, swap stable |
| binary | k4 `b8b1c732…` (not campaign) | campaign `1ca51420…` |
| `-t 4` | not run (device dropped) | both refs done |
| wall / 200 tok | ~1200 s | 79–218 s |

The 7× decode recovery is the Memory Extension OFF result. Streaming
economics (MiB/tok, hit%) were already healthy at 0.35 t/s; they did not
change. The bound is now **UFS expert streaming**, not kswapd writeback.
First cell 4.02 t/s / 149 MiB/s then settled near 2.3–2.7 / 55–78 MiB/s
at 32–36 °C — not a thermal trip, more likely UFS DVFS / cold-cache
after each DONTNEED. Product number is the **median 2.55**, not the 4.02
opener.

## 4. Caveats

- Product number, not an A/B. Do not say "Xiaomi is 2.3× slower than S23"
  as a controlled silicon result. Different `-t` (6 vs 4), different SoC.
  The `-t 4` refs (2.38 / 2.48) are the closer thread-count match and are
  not faster than `-t 6` median — this is not a "too many threads" story.
- `/proc/PID/stat` majflt in the harness CSV is **wrong** (mksh `$10` is
  `${1}0`, not field 12). Engine `major faults/token` in `*.out` is the
  number to quote. Fix the harness before the next campaign; do not
  re-run this one for that bug.
- S23 was touched only for a single idle-window scp of `libssl.so.3` +
  `libcrypto.so.3`. No S23 cell was running (`pgrep -f bmoe-cli` idle,
  673% idle). Jelly untouched.
- zRAM itself is still present (`settings zram_enabled=1`, SwapTotal
  12.5 GiB). extm writeback is what went away. That matches
  `reports/research-hyperos-ram.md`.

## 5. Files

- `results/xiaomi_ab/taskb_retry/logs/` — `runs.csv`, `status.txt`, six `*.out`/`*.err`, `extm_verify.txt`, `model_sha.txt`, `binary_id.txt`, `battery_notes.txt`
- `results/xiaomi_ab/taskb_retry/curves/` — 5 s MemAvailable series
- `results/xiaomi_ab/taskb_retry/parsed.csv` — engine-parsed table
- `results/xiaomi_ab/taskb_retry/sha_records.md`
- `results/xiaomi_ab/taskb_retry/mem_curves.md`
- on-device harness: `results/xiaomi_ab/taskb_retry/run_task_b_retry.sh`
