# Product lineup card — CalaQwen + Marco1c

**Date:** 2026-08-13  
**Config:** campaign **k6d065** — `-c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think`  
**Prompts (S23 / Xiaomi / Jelly-Marco1c):** `p_fact` sha `b5301c32…` · `p_creative` sha `761db0d0…` · n=200 · cold fadvise every cell · **UNPLUGGED**  
**Threads:** S23 `-t 4` · Xiaomi 14 `-t 6` · Jelly Star `-t 2` (per-SoC `cpu_capacity` rule)

Shipped models:

| product name | file | size | sha256 |
|---|---|---:|---|
| **CalaQwen** | `Qwen3.6-35B-A3B-KEXP.gguf` | 13 416 430 592 | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` |
| **Marco1c** | `Marco-Mini-Instruct-KEXP.gguf` | 6 385 238 848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |

Retired on PC and on the phones we touched today: Marco i1-Q4_K_M (sha `a001d324…`, 10.5 GB) and the cons/q3k variant. Not in this card.

---

## How to read this

Each row is one (model × phone). **decode t/s** is the median of that row's measured runs (4 or 8, see footnotes). **MiB/tok** and **hit%** are the I/O regime (bytes pulled from flash per generated token, and moe-cache hit). Decode is **not** comparable across phones: different SoCs, different `-t`, and Jelly numbers are **ranking-only** (campaign rule — cite them relative to the other model on the same Jelly session, not as a product fps). I/O regime **is** comparable: the same k/drop/cache and (except Jelly CalaQwen, see note [3]) the same two prompts. Xiaomi decode is a **sustained** median — the first cold cell is faster (note [2]). Xiaomi Marco1c was not measured: the phone was not available today.

---

## Card

| model | phone | decode t/s (median) | MiB/tok | hit% | method |
|---|---|---:|---:|---:|---|
| CalaQwen | Galaxy S23 | **5.696** | **30.7** | **80.7** | 8 cells, `-t 4`, 2026-08-12, UNPLUGGED. `results/marco_phase1/speed_s23/` [1] |
| CalaQwen | Xiaomi 14 | **2.55** | **30.4** | **80.75** | 4 cells ABBA `-t 6`, 2026-08-13, UNPLUGGED. Sustained throttle — first cold cell **4.02**. `results/xiaomi_ab/taskb_retry/` [2] |
| CalaQwen | Jelly Star | **1.63** | **42.0** | **76.7** | 4 cells T3, `-t 2`, 2026-08-10, UNPLUGGED. **Ranking only.** T3 prompts, not `p_fact`/`p_creative`. `results/trial_marco/t3/` [3] |
| Marco1c | Galaxy S23 | **8.819** | **51.5** | **53.5** | 4 cells, `-t 4`, 2026-08-13, UNPLUGGED. `results/marcokexp/speed_s23_1c/` [4] |
| Marco1c | Xiaomi 14 | — | — | — | **pending device** (Xiaomi not available 2026-08-13) |
| Marco1c | Jelly Star | **3.642** | **51.58** | **53.4** | 4 cells ABBA, `-t 2`, 2026-08-13, UNPLUGGED. **Ranking only.** `results/lineup_card/jelly_1c/` [5] |

---

## Footnotes

**[1] S23 CalaQwen.** Source `results/marco_phase1/speed_s23/runs_speed.csv` rows `KEXP_k6d065` (8 runs: 4 fact + 4 creative). Decode vals 6.157, 6.012, 5.878, 5.746, 5.361, 5.646, 5.254, 5.581 → median **5.696**. MiB/tok 33.57 (fact) / 27.77 (creative) → median **30.67** (card **30.7**). hit% 79.1 / 82.2 → median **80.65** (card **80.7**). Binary pin `1ca51420…`. Batt 96% → 92%, peak 39.1 °C. Notes: `results/marco_phase1/speed_s23/SPEED_NOTES.md`. Device sha of KEXP verified in that session.

**[2] Xiaomi 14 CalaQwen.** Source `results/xiaomi_ab/taskb_retry/logs/runs.csv` primary `-t 6` ABBA (fact, creative, creative, fact): 4.023, 2.698, 2.403, 2.315 → median **2.5505** (card **2.55**). MiB/tok 33.16 / 27.61 → median **30.385** (card **30.4**). hit% 79.2 / 82.3 → median **80.75**. First cell is the cold 4.023 tok/s; cells 2–4 sit at 2.3–2.7. That is sustained thermal/SoC throttle on SM8650, **not** a bad first run — do not quote 4.02 as the Xiaomi product number. Binary pin `1ca51420…`. Model sha `ac44e20c…` MATCH on device. Batt 88% → 86% across the four, UNPLUGGED, 33–36 °C. Full write-up: `reports/moe-calaqwen-xiaomi.md`.

**[3] Jelly CalaQwen.** Source `results/trial_marco/t3/t3_runs.csv` tag A (KEXP k6d065, 4 runs). Decode 1.593, 1.487, 1.891, 1.668 → median **1.6305** (card **1.63**). MiB/tok 53.11, 53.11, 30.86, 30.86 → median **41.985** (card **42.0**). hit% 71.7, 71.7, 81.6, 81.6 → median **76.65** (card **76.7**). Regime **was** recorded (not just tok/s), so this card does **not** re-measure CalaQwen on Jelly. Caveats: (a) **ranking only** — do not cite 1.63 as a product fps; (b) T3 prompts are **not** the campaign `p_fact`/`p_creative` pair (p1 = English technical, p2 = Italian technical) — I/O still lands in the KEXP band (31–53 MiB/tok, 72–82% hit) but is not prompt-matched to the S23/Xiaomi rows; (c) battery columns in the CSV are `-1` (harness gap); README says unplugged, finished ~51%; (d) Jelly binary pin `36b01966…` (separate from S23/Xiaomi `1ca51420…`). On-device KEXP sha `ac44e20c…` re-verified 2026-08-13 before the Marco1c push — log `results/lineup_card/jelly_kexp35b.sha256`.

**[4] S23 Marco1c.** Source `results/marcokexp/speed_s23_1c/runs_speed.csv` rows `ARM_1C` (4 runs). Decode 8.758, 8.707, 8.880, 8.884 → median **8.819**. MiB/tok 52.29 / 50.70 → median **51.50** (card **51.5**). hit% 52.6 / 54.3 → median **53.45** (card **53.5**). Same k6d065 flags, same prompts. The 4 ARM_1C cells themselves: UNPLUGGED **92% → 90%**, peak **33.4 °C**. (The full 8-run session with the ARM_MARCO arm was 92% → 89%, peak 34.3 °C.) Binary `1ca51420…`. File sha `2f921958…` MATCH. Verdict: `results/marcokexp/speed_s23_1c/SPEED_VERDICT.md`.

**[5] Jelly Marco1c (measured this session).** Source `results/lineup_card/jelly_1c/runs_speed.csv`. Decode 3.594, 3.770, 3.690, 3.576 → median **3.642**. MiB/tok 52.68 / 50.48 → median **51.58**. hit% 52.3 / 54.5 → median **53.4**. Campaign prompts, n=200, cold fadvise, `-t 2`, UNPLUGGED 74% → 72%, peak 32.0 °C. MemAvailable guard never fired (start 5.75–5.68 GiB; during-run min ~2.95 GiB, well above the 300 MiB abort). Binary `36b01966…`. File sha `2f921958…` MATCH after scp. **Ranking only** for decode. I/O regime matches S23 Marco1c (51.5 / 53.5) to the reported digit. Verdict: `results/lineup_card/jelly_1c/SPEED_VERDICT.md`.

---

## Housekeeping this session

| action | where | log |
|---|---|---|
| Deleted retired Marco-Q4KM (10 505 424 704 B, sha `a001d324…`) | Jelly `~/experiments/models/` | `results/lineup_card/jelly_delete_marco_q4km.log` |
| Deleted retired Marco-Q4KM (same file) | S23 `~/experiments/models/` (not `~/models/` — that dir never had Q4KM) | `results/lineup_card/s23_delete_marco_q4km.log` |
| Pushed Marco1c 6.0 GB, sha verified | Jelly `~/models/Marco-Mini-Instruct-KEXP.gguf` | `results/lineup_card/jelly_push_marco1c.log` |
| Kept (this session) | KEXP 35B, Marco1c, 2B/4B (S23) / 2B + LFM2.5 (Jelly) | nothing else deleted **in this session**. Earlier today the S23 marcokexp push freed 3.6 G of spike leftovers (`~/models/spike_iq2/`) — not a KEEP item |

Xiaomi 14 was not contacted.

---

## One-line read

On the phones we can quote: CalaQwen is the I/O-efficient big model (~31 MiB/tok, ~81% hit on flagships; Jelly ranking ~42 / 77 on T3 prompts). Marco1c is the faster decode on S23 (8.82 vs 5.70) at a worse I/O point (~52 MiB/tok, ~53% hit) that **transfers** to Jelly. Xiaomi CalaQwen holds the I/O point and loses decode to throttle. Xiaomi Marco1c is the missing cell.
