# SPEED NOTES — Marco Phase 1 · Galaxy S23 · A0 vs A2 (ABBA)

**Date:** 2026-08-12  
**Device:** Galaxy S23 (Termux ssh `u0_a344@192.168.1.152:8022`)  
**Protocol:** `results/marco_phase1/PROTOCOL.md` § Velocità — gate  
**Status:** COMPLETE · gate **PASS**

---

## Setup (verified)

| item | value |
|---|---|
| Binary | `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN` |
| Binary sha256 | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` (pin `1ca51420…` OK) |
| Marco model | `~/experiments/models/Marco-Mini-Instruct.i1-Q4_K_M.gguf` |
| Marco size | 10 505 424 704 B |
| Marco sha256 | `a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc` MATCH |
| KEXP model | `~/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf` (optional block) |
| Cold | `~/bin/cold_model.sh` (fadvise DONTNEED) before every run · `cold=1` |
| Threads/ctx | `-t 4 -c 4096` |
| Fixed flags | `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --temp 0 --chatml --no-think` |
| Decode length | `n=200` |

### Disk prep
- Free space before push: **6.8 GB** (insufficient for ~10.5 GB Marco).
- Freed by deleting unused `Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` (~12 GB). KEXP retained.
- After free: **18 GB** available; pushed Marco via scp (~4.7 min Wi‑Fi), sha256 verified on device.

### Cells

| cell | k | drop |
|---|---:|---|
| **A0** | 8 | OFF |
| **A2** | 6 | 0.65 |
| **KEXP_k6d065** (optional) | 6 | 0.65 |

### Prompts (byte-identical across cells)

| prompt_id | nature | path | sha256 |
|---|---|---|---|
| **fact** | technical MoE explanation | `prompts/p_fact.txt` | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` |
| **creative** | short courier-robot story | `prompts/p_creative.txt` | `761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871` |

### Order
ABBA per prompt: A0 → A2 → A2 → A0 (order_idx 1..4) × 2 prompts = **8 Marco runs**.  
Optional KEXP: 4 reps × 2 prompts = **8 KEXP runs** (batt after Marco block was 96% ≥ 55%).

---

## Battery / thermal log

| phase | batt% | temp °C | plugged |
|---|---:|---:|---|
| First contact (pre-setup) | 51 | 28.2 | UNPLUGGED |
| After model push | 50–52 | ~30.5 | **PLUGGED_AC** (waited ~73 min; charged to 100%) |
| Measure start (Marco ABBA) | 100 | 28.1 | **UNPLUGGED** |
| End Marco (post A0 creative o4) | 96 | 36.6 | UNPLUGGED |
| End KEXP optional | 92 | 39.1 | UNPLUGGED |
| Peak battery temp observed | — | **39.1** | (under 45 °C guard) |

No thermal pause; no battery-floor stop (floor 45%).

---

## Absolute numbers (prominent)

### Medians (4 runs A0 / 4 runs A2 / 8 runs KEXP)

| cell | decode tok/s median | MiB/tok median | hit% median | TTFT s median |
|---|---:|---:|---:|---:|
| **A0** | **4.122** | **192.50** | **33.50** | 13.59 |
| **A2** | **5.371** | **126.21** | **36.65** | 12.64 |
| **KEXP_k6d065** | **5.696** | **30.67** | **80.65** | 18.98 |

### A2 vs A0 deltas
- decode median: **5.371 / 4.122 = 1.303×** (≥ 1.15× required)
- MiB/tok median: **−34.4%** (≤ −20% required)
- hit% median: **+3.15 pt** (report only; clear I/O success bar was ~+15 pt — **not met**)

### Per-run decode tok/s
- A0: 4.056, 4.113, 4.156, 4.131
- A2: 5.197, 5.300, 5.444, 5.442
- KEXP: 6.157, 6.012, 5.878, 5.746, 5.361, 5.646, 5.254, 5.581

### SESSION_SLOW
**Not flagged.** A0 median decode **4.12 tok/s** ≫ 1.5 tok/s sanity floor.  
(Smoke n=32 A0-like was 4.43 tok/s cold — consistent.)

---

## Pre-declared gate verdict

| gate | threshold | observed | verdict |
|---|---|---|---|
| decode median A2 vs A0 | ≥ **1.15×** | **1.303×** | **PASS** |
| MiB/tok median vs A0 | ≤ **−20%** | **−34.4%** | **PASS** |
| Combined (OR) | either | both true | **PASS** |
| hit% call-out | report; +15 pt = clear I/O win | **+3.15 pt** | reported (not a hard fail; I/O win **not** “clear”) |

**Overall SPEED gate: PASS** (decode and MiB both clear).

### Aspirazione vs KEXP (same session)
- KEXP k6d065 decode median **5.70 tok/s** vs Marco A2 **5.37 tok/s** (~1.06×).
- KEXP MiB/tok **30.7** vs Marco A2 **126.2** (~4.1× less I/O per token) — KEXP still dominates I/O efficiency / hit (80.7% vs 36.7%).

---

## Deviations / notes

1. **Wait for UNPLUGGED:** Device was plugged ~10:00–11:13 after model push (charged 50%→100%). No measurements taken while plugged. Harness waited; measures started only after physical unplug.
2. **First harness attempt failed** with empty metrics: used `-f promptfile` which bmoe-cli rejects (`unknown arg: -f`). Campaign uses `-p "$ptext"`. Fixed, archived bad CSV under device `archive_fail_nof/`, re-ran full ABBA.
3. **Disk:** Removed unused UD-Q2_K_XL to free space for Marco. KEXP kept.
4. **n_gen:** Some A0/A2 fact runs produced 191–195 tokens (EOS) not always 200; decode rate still valid from fork summary.
5. **hit%** rise modest (+3 pt): speed win is real, but cache hit is **not** the main story vs A0 — MiB/tok drop (−34%) is. vs KEXP, Marco still much colder on cache.

---

## Artifacts

| path | content |
|---|---|
| `results/marco_phase1/speed_s23/runs_speed.csv` | 16 data rows + header |
| `results/marco_phase1/speed_s23/logs/*/` | raw stdout/stderr/combo/cmdline per run |
| `results/marco_phase1/speed_s23/prompts/` | prompt texts |
| `results/marco_phase1/speed_s23/device_raw/SPEED.master.log` | device master log |
| `results/marco_phase1/speed_s23/device_raw/marco.sha256` | model sha on device |
| `results/marco_phase1/speed_s23/run_marco_speed_s23.sh` | harness used |
| `results/marco_phase1/speed_s23/smoke/` | n=32 smoke before full ABBA |
