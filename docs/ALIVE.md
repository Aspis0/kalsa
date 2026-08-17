# ALIVE — what is still standing, 2026-08-16

One page. Everything else in this repo is either shipped, dead, or history.
The campaign has produced roughly 30 tested techniques; **4 are alive**.

---

## 1. SHIPPED — in production, with a p-value

### La Ricetta (certified phone config) — *name pending owner*

`-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65`

| device | effect | test |
|---|---|---|
| S23 (Mellum2) | stock 0.2585 → **0.1480 s/tok, −42.7%** (3.87 → 6.76 tok/s) | Wilcoxon W=0, **p=0.000488**, 12/12 pairs, exact floor |
| Xiaomi 14 | median **−14.5%**, HL −0.05625 s/tok | W=0, **p=0.000977**, 11 effective pairs (one exact tie) |

Pre-registered on both devices. The Xiaomi PREREG **predicted a smaller effect
there and was right** — the model predicted magnitude, not just sign.

Side axes: sustained −38% ✅ · temp parity ✅ · TTFT parity ✅ · J/token +11.8% ❌
declared — **but reversed for interactive use**: screen-on, the fast config saves
22 s of display per response (4–13 J) against +2.6 J of compute, so it is a net
battery *saving* with the screen on. Policy: gate on thermals and screen-off
tasks, never on battery level in chat.

Bonus, not sought: the certified config is **robust to real RAM pressure** —
stock collapses 60–100× with dirty zram, reproduced twice.

### TTFT stack (app side) — merged on ai-chat main

**53.4 s → 1.40 s** (Jelly, cold + 90 s + send). Prewarm of the static system
prefix at boot + P0 memguard + P1 idle-zombie fix. Survives process death
(swipe-kill → relaunch → send = 2.48 s), which the keepalive never would have.

### Lineup

**CalaQwen** (Qwen3.6-35B-A3B KEXP) and **Marco1c** (Marco-Mini-Instruct-KEXP)
shipped on all three phones.

---

## 2. ALIVE AND PROMISING — the one lever still growing

### Expert skipping (`--drop-cold-experts`) as a standalone fast mode

The quality curve is the best result on the board and it keeps getting better:

| drop | macro bpb (CalaQwen) | cost vs d0 | gate |
|---|---|---|---|
| 0.0 | 0.6781 | — | PASS |
| **0.3** | 0.6785 | **+0.06 % — free** | PASS |
| 0.8 | 0.6889 | +1.6 % | PASS |
| 1.0 | running | — | — |

And on Mellum the curve has a **minimum below zero**: d=0.5 measured −0.0150 bpb
against the k8 anchor, i.e. **skipping cold experts IMPROVES multilingual
perplexity**, with run-to-run noise at 1e-6. That is our strangest measured fact
and it is not yet explained.

**What is missing before this can ship as a speed claim:** a clean
**throughput + bytes** cell. The current curve never instrumented read bytes,
and its wall-clock times are confounded — each arm ran under a different amount
of CPU contention from other jobs (d0.8 ran under 100 % contention, d0.0 under
8 %, d1.0 under none). The bpb numbers are deterministic and safe; the timings
are not comparable across arms.

### Frozen Draft (E4/F5) — *name pending owner*

Attention-only self-draft with the GDN recurrent state **frozen** (skip-write at
compute time, never snapshot/restore). Unpublished polarity; the mirror paper
(Component-Aware SSD, arXiv:2605.01106) tried the opposite polarity on sequential
hybrids and got α=0.038.

**Alive as:** a *correction* mechanism and a RAM saving.
**Dead as:** a speed technique (see §3).

- α_step1 **0.987** (γ=4), macro 0.823, E[L] 2.995
- **alpha_alltok 0.413** vs the mirror paper's 0.038 — the apples-to-apples number
- real decode loop: acceptance **8.6 % → 24.6 %** with the freeze on
- multi-turn chat: without freeze acceptance decays 3.9× along the conversation
  (0.117 → 0.100 → 0.030); with freeze it does not (0.183 → 0.275 → 0.138)
- **251.25 MiB of RAM saved**, measured, at γ=4
- four bitwise gates green: freezing does not contaminate, catch-up reconstructs
  exactly (max |Δlogit| = 0 over 300 positions)

---

## 3. THE GRAVEYARD — tested honestly, killed with a number

| technique | verdict |
|---|---|
| **K-F cold-start prefetch** | mapped, then closed. Jelly warm +7.1 % against (p=0.000977); Jelly cold **+4.3 % against, p=0.0635 null**; S23 / Xiaomi / CalaQwen all null. Mechanism works (stall 21.9 % → 13.4 %) but reads rise +14 % at 76 % precision. **Trades mean throughput for tail smoothness** (p99 328 vs 341 ms, stutter 0.34 % vs 0.55 %) — a UX argument, never claimed as speed. |
| **F6 cheap certification** | DEAD on bytes. Argmax agreement j=3 = 0.8120 against a GO threshold of 0.95; β=0.594 vs break-even 0.56. j≥4 fails on the structural floor by construction. |
| **Draft-by-drop** | DEAD before implementation. Assumed draft cost 0.2×; measured 0.91×. bpb is not a proxy for greedy acceptance. The expert cache is a second non-rewindable state that speculation pollutes. |
| **Self-speculative decoding for BYTES** | closed by the invariant (below). 0.31× on PC, 0.44× on phone; reads 32.8 GiB vs 12.7 for 256 tokens. |
| **CPU kernels S1/S2/S3, i8mm, REPACK** | three kernels, correct and audited (16191/16191 suite), all under the 10 % gate. **0.148 s/tok compute at t2 is the silicon floor.** Legacy: the config `t2 + k6d1.0` = 5.151 t/s, free. |
| **K-E (i8mm)** | never runs — mmla lives only in the REPACK path that streamed experts bypass. |
| **K-G (GPU prefill)** | the 1.29× was a cold-outlier artifact; honest 1.12 %. |
| **GPU decode (Adreno 740/750)** | 0.41× CPU on 740. The E2E gap is ~60 ms/token of dispatch glue, not kernels — a fix is a fused executor (months), not a kernel (weeks). |
| **REAP-50** | halves *stored* experts, not *active* ones. Same ~11 GB/s wall. |
| **MTP / speculation for byte amortization** | 0.00 % amortized, three independent mechanisms. |
| **cache policies · cache size · ubatch · cross-layer prefetch · k<6 · extreme drop as a compute lever · 1c requant · hand IQ2 kernels · similarity/skew · asymmetric drop · typeahead · phase-split 2B · LFM on G99 · Ling 3.0 Tiny** | all closed with numbers. See PLAN.md. |

---

## 4. THE THEORY THAT KILLED MOST OF IT

> With batched verify: `bytes/token = [γα + (γ+1)β] / L`, with `L ≤ γ+1`.
> **If β ≥ 1, bytes/token ≥ 1 even with free drafts (α=0)** — speculation can at
> best tie plain decoding. The only escape is `β < 1`: verification must read
> fewer bytes than plain generation.

Break-even for our regime (γ=4, α=1/3, L≈3): **β < 0.56**, i.e. fewer than ~3.3
experts on average. F6 measured that and it fails.

**The supporting measurement** (routing entropy, our own): 96 % of the 256
experts are touched within 300 tokens; the top-16 carry only 25 % of the mass;
~45 expert re-reads per token. Consecutive tokens route to **near-disjoint**
expert sets — which is why batching does not amortize on this architecture, and
why every cache-similarity trick died by physics.

---

## 5. MEASURED SPEEDS — the lineup, per model per device

All numbers screen-on and unplugged unless noted. Product-card numbers, not
cell-internal numbers.

| model | S23 (8 GB, 8Gen2, UFS 3.1) | Xiaomi 14 (11.4 GB, 8Gen3) | Jelly Star (G99, 8 GB) |
|---|---|---|---|
| **CalaQwen** 35B-A3B KEXP | **5.86** t/s (t4, k6d065) | **4.75** t/s (t6) | — |
| **Marco1c** | **8.82** t/s (t4) | **10.57** t/s (t4) ← *flagship overtakes* | 3.64 t/s (t2, ranking) |
| **Mellum2** 12B/A2.5B | **5.151** t/s (t2, k6d1.0) — certified | — | — |
| Qwen3.5-2B dense | 15.9 t/s | — | 8.04 t/s (t2) |
| Qwen3.5-4B dense | 8.38 t/s (llama-bench) | — | 3.52 t/s (t2) |
| Qwen3.5-1.5B | 25.8 t/s (LiteRT CPU) | — | — |
| LFM2.5-8B-A1B | — | — | 10.60 (k4) / 12.28 (k3) / 14.38 (k2) |

Notes that matter more than the numbers:

- **The streaming regime is silicon-independent.** CalaQwen reads 30.4 MiB/token
  at 80.7 % hit on Xiaomi and 30.7 / 80.7 on S23 — identical to the digit. The
  machine transfers; only the compute multiplier changes.
- **Thread count is per-model, not per-SoC.** Marco is compute-heavy (t4 = 2.1×
  t6 on Xiaomi); CalaQwen is flash-bound and thread-flat. The card rule
  "cpu_capacity ≥ 50 % → t6" strangles SM8650 on Marco.
- **Screen state is a first-class variable.** The "flagship is half as fast" story
  was HyperOS Doze throttling flash I/O (0.22 → 0.50 s/tok). CalaQwen on Xiaomi is
  4.75, not 2.55. `mWakefulness` is now a column in every runs.csv.
- **On weak silicon, fewer bytes ≠ more decode.** KEXP on G99 is dequant-bound on
  2×A76: 8.83 t/s against a 14.7 projection. Same lesson as REAP: only *active*
  bytes per token move the decode.
- **Device variance is ±50 % between consecutive runs** on the same model and
  config (3.99 → 8.27 t/s measured). Any speed claim needs ABBA pairs; two
  back-to-back runs prove nothing.

---

## 6. OPEN QUEUE — what is left to finish

| item | state | blocked on |
|---|---|---|
| CalaQwen drop curve, arm d=1.0 | running, finishes tonight | — |
| **Clean throughput + bytes cell for expert skipping** | **not started — the missing measurement** | PC free after d1.0 |
| CalaQwen quality gate for the recipe | the recipe's PPL curve is certified on **Mellum only**; CalaQwen's optimum drop may differ from 0.5 | ~1 PC-day, owner-approved |
| PPL corpus v2 | campaign metro is still Dante (memorized: bpb 0.27 vs 0.83 zh) — cross-model comparisons on that slice are NULL | owner design |
| FT tool-call + IT lane (Qwen3.5-2B) | **all gates closed** (licence, recipe ×2 families, registry FROZEN) | owner GO |
| Free-tier G99 decision | (i) accept A0 k4 = 10.6 · (iii) no LFM on G99 — (ii) REAP eliminated with data | owner |
| Three naming slots | recipe · cold-start prefetch · frozen draft | owner (`NAMING.md`) |

---

## 7. THE SCOREBOARD, WITHOUT DECORATION

**1 confirmed and replicated win** (the recipe), **1 shipped app result** (TTFT),
**1 strong candidate mid-flight** (expert skipping), **1 real mechanism with no
speed payoff** (Frozen Draft), **~25 techniques retired with numbers**.

The kill/win ratio is high and that is correct: each kill cost hours, not months,
because the theory said what to measure. Three techniques died on 2026-08-16
alone — two of them before a line of code was written.
