# moe-calaqwen-xiaomi

**Question:** what is CalaQwen (KEXP 35B, campaign k6d065) on the 2024-flagship
class the premium buyer owns (Xiaomi 14 / SM8650 / UFS 4.0), vs the S23
campaign card (5.86 med / 30.7 MiB/tok / 80.7% hit)?

Date: 2026-08-13
Device: Xiaomi 14 (`23127PN0CG` / `houji` / SM8650), Android 16, **UNPLUGGED**
Binary: **k4 static** `bmoe-cli` sha
  `b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab`
  (see §3 — campaign pin did not link).
Model: `Qwen3.6-35B-A3B-KEXP.gguf` 13 416 430 592 B
  sha `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a`
  (device sha256sum MATCH after 745 s / 17.2 MB/s Wi-Fi push).
Config: k6d065 — `-c 4096 --moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65
  --temp 0 --chatml --no-think`
Prompts: byte-identical to `results/marco_phase1/speed_s23/prompts/`
  `p_fact.txt` sha `b5301c32…` (361 B) · `p_creative.txt` sha `761db0d0…` (268 B)
Primary `-t`: **6** (SM8650 `cpu_capacity ≥ 50%`: cpu2–cpu7; A520 cpu0/cpu1
  excluded). `-t 4` reference: **not run** (device dropped mid-block).
Artifacts: `results/xiaomi_ab/taskb/`
S23 / Jelly: untouched this session.

This is a **product datapoint**, not a silicon A/B. Different `-t`, different
SoC, different UFS, and — this session — a **different binary pin**. Same model,
same flags, same two prompts as the Marco-phase-1 KEXP session.

## TL;DR

| gate | result |
|---|---|
| ABBA k6d065 `-t 6` | **PARTIAL** — 3/4 cells. med **0.350 tok/s**, 27.50 MiB/tok, hit 82.3% |
| `-t 4` reference | **NOT RUN** — device left the LAN after a dual-process fault |
| vs S23 5.86 / 30.7 / 80.7 | decode **~16× slower** than Marco-P1 5.696; I/O + hit% in the same band |

Do not quote Xiaomi as “0.35 vs S23 5.86” as a controlled result. See §3.

## 0. Method

- Cold `posix_fadvise(DONTNEED)` via on-device `fadv` before every run.
- Never measured plugged. Start floor 45% (57% at first cell). Mid-block floor 35%.
  Battery 57 → 49% across the three completed cells (~3 pp / 20 min run).
- Order: ABBA primary `-t 6` (fact, creative, creative, fact) then one `-t 4`
  fact and one `-t 4` creative. Stopped after creative_o3 / start of fact_o4.
- n=200. Full stdout/stderr per completed run. Harness-written `runs.csv` rows
  are **tag-clobbered** (mksh `batt_dump` reused `tag=`; parse redirected from
  a missing `after_before_*.out`). Numbers below are re-parsed from `*.out`.
- S23 5.86 med is from `reports/moe-adopt-kexp.md` parte 3 (prompts `short` /
  `f45_1`, `-t 4`, n=200, 4 cells). S23 30.7 MiB/tok / 80.7% hit / 5.696 tok/s
  is from `reports/moe-marco-phase1-runtime.md` same-session KEXP (prompts
  **p_fact / p_creative**, `-t 4`, 8 runs). The closest like-for-like column
  is the Marco-phase-1 KEXP row, not the 5.86 grid — different prompts.
  Both are shown. Do not collapse them.

## 1. Xiaomi runs

Source: `results/xiaomi_ab/taskb/logs/before_t6_*.out` + `battery_notes.txt`.

| tag | prompt | -t | decode t/s | MiB/tok | hit% | TTFT s | load s | n_gen | batt | temp °C | wall s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|
| t6_fact_o1 | fact | 6 | 0.335 | 34.82 | 78.5 | 38.100 | 31.234 | 200 | 57→54 | 29.5→29.9 | 1253 |
| t6_creative_o2 | creative | 6 | 0.369 | 27.50 | 82.3 | 40.268 | 27.656 | 200 | 54→51 | 29.9→29.6 | 1196 |
| t6_creative_o3 | creative | 6 | 0.350 | 27.50 | 82.3 | 41.130 | 31.129 | 200 | 51→49 | 29.6→29.7 | 1207 |
| t6_fact_o4 | fact | 6 | — | — | — | — | — | — | 49→? | 29.7 | STARTED then dual-proc / device lost |
| t4_fact_ref | fact | 4 | — | — | — | — | — | — | — | — | not run |
| t4_creative_ref | creative | 4 | — | — | — | — | — | — | — | — | not run |

Per-token split (from `moe-stream` / `compute` lines):

| tag | compute s/tok | flash I/O s/tok | flash MiB/s | CPU occ. | major faults/tok | drop% |
|---|---:|---:|---:|---:|---:|---:|
| t6_fact_o1 | 2.929 | 0.577 | 60 | 39.2% | 1.32 | 6.0 |
| t6_creative_o2 | 2.661 | 0.410 | 67 | 40.3% | 4.86 | 3.0 |
| t6_creative_o3 | 2.805 | 0.461 | 60 | 39.7% | 1.70 | 3.0 |

`--cache-mb 2000` was **accepted** (resident 1999.2 MiB every run). Loader did
not refuse; no step-down to 1500. The phone still swapped (MemAvailable fell
to ~2.3 GiB mid-run 1; SwapUsed ~4 GiB observed). ~40% CPU occupancy over 6
threads + 1–5 major faults/token is the speed story, not UFS.

## 2. Product table — Xiaomi vs S23

| | Xiaomi `-t 6` (primary, n=3) | Xiaomi `-t 4` (ref) | S23 campaign card | S23 Marco-P1 KEXP (same prompts) |
|---|---|---|---|---|
| decode med t/s | **0.350** | not run | **5.86** (grid, other prompts) | **5.696** |
| MiB/tok | **27.50** med (mean 29.94) | — | **30.7** (P1 session) | **30.67** |
| hit% | **82.3** med (mean 81.0) | — | **80.7** (P1 session) | **80.65** |
| TTFT s | **40.27** med | — | — | **18.98** |
| n | 3 (4th aborted) | 0 | 4 (grid) | 8 |
| silicon | SM8650 / UFS 4.0 | — | SM8550 | SM8550 |
| `-t` | 6 (cap≥50%) | 4 planned | 4 | 4 |
| binary | k4 `b8b1c732…` | — | `1ca51420…` | `1ca51420…` |
| cache-mb | 2000 accepted | — | 2000 | 2000 |

## 3. Caveats

- Product number, not an A/B. Do not say "Xiaomi is 16× slower than S23" as a
  controlled silicon result.
- **Campaign pin failed on device.** `bmoe-cli` `1ca51420…` + companion `.so`
  pushed and sha-matched. Android linker:
  `library "libssl.so.3" not found: needed by libllama-common.so.0`.
  houji ships `/system/lib64/libssl.so` (BoringSSL), not OpenSSL 3.
  Documented fallback `results/k4split/bin/bmoe-cli` (`b8b1c732…`, static,
  DT_NEEDED = libm/libdl/libOpenCL/libandroid/libc++_shared/libc) was used
  for every cell. Label: **k4 binary, not campaign pin**.
- RAM: 11436476 kB total. MemAvailable was 5.5–6.1 GiB before ABBA, not the
  “~7 free” guess. cache 2000 + dense-anon 1664 MiB + compute buffer 503 MiB
  fits the allocator and then the kernel swaps. That is a product finding,
  not a loader refusal.
- Harness died-looking after cell 3: `parse_run < $LOG/${tag}.out` followed
  a `batt_dump` that overwrote `tag` in mksh (no `local`). Cells 1–3 still
  wrote complete `.out`. Cell 4 started under the original harness; a resume
  script then started a **second** `bmoe-cli.k4`. Two 35B processes (~38 GiB
  VIRT each) coincided with adbd/Wi-Fi going away. Device still unreachable
  via `192.168.1.193:39643` / mDNS `adb-625689a2` ~10 min later (not in ARP).
  Cell 4 and both `-t 4` refs are missing. No logs pulled after the drop.
- Nothing deleted. Every number above is in a log on disk under
  `results/xiaomi_ab/taskb/logs/`.
