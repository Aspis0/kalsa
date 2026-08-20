# ALIVE — what is still standing, 2026-08-20

> **Derivative.** `PLAN.md` is authoritative; this page is a short status view.
> Git history preserves the long form. If this file and PLAN disagree, PLAN wins.

One page. The campaign has produced roughly 30 tested techniques. The useful
distinction is now simple: shipped, alive, dead, theory, measured speeds, queue.

**19–20/08 — Adreno MoE OpenCL kernels restored.** Upstream disabled this family
for now because of compiler miscompilations nobody had understood: A6X/A7X
(S23/S24 class) now has working llama.cpp MoE kernels. Three Qualcomm compiler
miscompiles were dissected bit-by-bit, fixed with minimal diffs, and byte-verified;
narrow-quant MoE **q4_0/q4_1/q5_0/q5_1/mxfp4 now passes on Adreno 740** where it
never had. This is the publishable result: upstream turned the GPU off; we turned
it back on. Internal path name: `trans4`.

Supporting evidence: the test CPU judge had been poisoned by `get_tensor` copying
weights back from the GPU, so any judge could fail; e2e PASS proves self-consistency,
not fidelity, while roundtrip/raw-readback zeros prove fidelity. Production is
immune: zero trans4 dispatches and byte-identical 64-token output against the
all-broken `.so`. The Adreno medicine is scalar-uint end-to-end dataflow, never
byte/short lanes; expression-form changes do nothing. KEXP uses Q2_K+Q3_K experts
and Q5_K/Q6_K trunk, so production was never exposed. Next: **K2**, q4_K/q5_K
`MUL_MAT_ID` compute, affecting Mellum2 Q4_K_M.

---

## 1. SHIPPED — in production, with a p-value

### Kalsa Recipe — two configs, kept separate

**Mellum2 A/B config:** `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`
with `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
--ubatch 512 -c 4096 --temp 0 --chatml --no-think`.

| device / session | effect | test |
|---|---|---|
| S23, canonical `device/` | 0.2585 → **0.1480 s/tok, −42.7%** (3.87 → 6.76 tok/s) | W=0, **p=0.000488**, 12/12 |
| S23, exploratory `screenon/` | 0.2665 → 0.1565, **−41.3%** | W=0, p=0.000488, 12/12 |
| Xiaomi 14 | median **−14.5%**, HL −0.05625 s/tok | W=0, **p=0.000977**, 11 effective pairs |

**CalaQwen campaign config:** `-t 4 -c 4096 --moe-stream --cache-mb 2000
--dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6
--drop-cold-experts 1.0 --drop-no-renorm`.

| config | quality vs d=0.0 | speed vs d=0.0 (Jelly) | bytes read |
|---|---|---|---|
| d=0.65, retired 2026-08-18 | +0.91 % | **+5.8 % slower** | −27.3 % |
| d=0.65 + no-renorm | +0.20 % | ~+5.8 % slower | −27.3 % |
| **d=1.0 + no-renorm** | **+1.18 %** | **−12.9 %** | **−71.8 %** |

CalaQwen anchor: **0.6660114**; current default **+0.0201**, 50 % of the
`MACRO_PASS = 0.04` budget. Renorm ON was +0.0389, 97 % of budget, passing by
0.0011. The answer-quality cell passed **8/8** executed tests and **15/16**
common-sense questions. The Mellum2 p-values do not support this CalaQwen config.

### TTFT stack (app side) — merged on ai-chat main

**53.4 s → 1.40 s** (Jelly, cold + 90 s + send); swipe-kill → relaunch → send
is **2.48 s**. Prewarm, P0 memguard, and P1 idle-zombie fix are shipped.

### Lineup

**CalaQwen** and **Marco1c** shipped on all three phones.

---

## 2. ALIVE AND PROMISING — the one lever still growing

### Expert skipping (`--drop-cold-experts`)
CalaQwen’s six-point curve is complete: `0.0=0.6780748`, `0.3=0.6784793
(+0.06 %)`, `0.5=0.6802864 (+0.33 %)`, `0.65=0.6842309 (+0.91 %)`,
`0.8=0.6889289 (+1.60 %)`, `1.0=0.7049320 (+3.96 %)`. It is monotone,
small but not flat, and not free. The old Mellum gate was an artifact: anchor
**1.020819**, `d_macro_vs_k8d0 ≈ −0.34`, `MACRO_PASS = 0.04`,
`spread=0.0269`, `noise=0.3537`.
Against CalaQwen k8d0: `d=0` **+0.0121 (30 %)**, `d=0.65` **+0.0182 (46 %)**,
`d=1.0` renorm ON **+0.0389 (97 %, passes by 0.0011)**, and no-renorm
**+0.0201 (50 %)**. Mellum d=0.5 was **1.0058 vs 1.0208, delta −0.0150**;
noise was 1e-6.
Renorm ablation: d=0.5 ON `0.6802864 (+0.33 %)` vs OFF `0.6791113 (+0.15 %)`;
d=1.0 ON `0.7049320 (+3.96 %)` vs OFF `0.6860923 (+1.18 %)`; Δ is −0.17 %
and **−2.67 %**. Roughly **70 %** of aggressive-drop quality cost is renorm,
the harm is **16×** larger at d=1.0, and all five languages move the same way.
Random-drop result, same Marco-Mini KEXP binary `59f2762e54ed56af`: macro
d0/cold/random = `0.766534/0.861667/0.918006`, costs `+12.41 %/+19.76 %`;
by language cold/random costs are en `+10.31/+16.49 %`, es `+10.83/+18.73 %`,
fr `+13.92/+21.93 %`, it `+12.05/+21.57 %`, zh `+14.11/+19.51 %`.
Cold beats random: **+6.54 % bpb** ( +0.0563, over `MACRO_PASS = 0.04` );
the partial estimate was +6.63 %. `weight` is **1.317696**, +71.90 % vs d0 and
52.9 % worse than cold. Measured drop rates: cold `16427/50400=32.6 %`,
weight `31217/50400=61.9 %`, random `14395/50400=28.6 %`; weight ⊇ cold,
so cold-vs-random is the only like-for-like verdict.
Cache interaction is device-specific: at cache 1500/2000/4000, hit at d0 is
39.5/50.2/76.8 %; Jelly drop benefit is **−25 %/−25 %/+15 %**, S23 is
≈−5 %/≈−2 %/≈−4 %. Jelly’s best is cache 4000 without drop: **0.113 vs
0.124 s/tok**. S23 rows remain unverifiable: old cache-2000 values were
0.229 vs Jelly 0.166 s/tok, with observed `0-2`, `nproc=3`; PID-level covariates
are required. Jelly is cleared at `/top-app`, `0-7`, `nproc=8`.
Mechanism: d=0.3 dropped `21/33600` and `9/17600` slots while compute rose
7–21 %; Marco hit 50.2 % caps drops at 29.7 %, LFM2.5 hit 93.5 % caps them at
3.6 %. Marco d=1.0 is **−27 % time and −68 % bytes**; every LFM2.5 drop level
is a net loss. CalaQwen’s Jelly cell is **12/12**: d=0.65 was slower in all
three rounds, so d=1.0 no-renorm is current. The unattended-session fix ran
**26 min 53 s**; full confirmation is ≥60 min.
### GPU prefill on Adreno 750-class
The corrected pp128 ratio is **3.18×** (orderings 3.10×/3.27×); prompt ratios
at pp 128/512/1024/2048 are 2B **3.18×/3.95×/5.35×/6.69×** and 4B
**4.17×/5.70×/6.95×/6.46×**. At ~1.4k prompt: 2B **~6.5 s vs ~33 s**;
4B **~16 s vs ~108 s**. CPU outliers were 29.5 and 18.8 t/s at 38–40 °C;
GPU held 216.7 and 212.2. `-fa on` crashes (exit 134); decode remains **0.66×**
(17.5 vs 26.5). Scope: dense 2B/4B on 750-class, not 35B MoE.

### Frozen Draft (E4/F5)

Alive as correction/RAM saving, dead as speed: α_step1 **0.987**, macro 0.823,
E[L] 2.995; alpha_alltok **0.413** vs 0.038; acceptance **8.6 % → 24.6 %**;
multi-turn without/with freeze `0.117 → 0.100 → 0.030` / `0.183 → 0.275 → 0.138`;
**251.25 MiB** saved at γ=4; four bitwise gates green, max |Δlogit| = 0 over
300 positions.

---

## 3. THE GRAVEYARD — tested honestly, killed with a number

| technique | verdict |
|---|---|
| **K-F cold-start prefetch** | closed: Jelly warm +7.1 % against (p=0.000977); Jelly cold +4.3 % against, p=0.0635 null; mechanism 21.9 % → 13.4 %, reads +14 %, p99 328 vs 341 ms, stutter 0.34 % vs 0.55 %. |
| **F6 cheap certification** | dead: j=3 agreement 0.8120 vs GO 0.95; β=0.594 vs break-even 0.56; j≥4 structural floor. |
| **Draft-by-drop** | dead: assumed draft cost 0.2×, measured 0.91×. |
| **Self-speculative decoding for BYTES** | closed: 0.31× PC, 0.44× phone; 32.8 GiB vs 12.7 for 256 tokens. |
| **CPU kernels S1/S2/S3, i8mm, REPACK** | correct, audited 16191/16191, under 10 %; 0.148 s/tok compute at t2 is the silicon floor. |
| **K-E / K-G / GPU decode** | K-E never runs; K-G’s 1.29× was a 740 cold-outlier artifact, honest 1.12 %; decode 0.41× CPU on 740 and 0.44× on 750. |
| **REAP-50 / MTP / speculation** | stored-not-active experts; same ~11 GB/s wall; 0.00 % amortized. |
| **Other closed lanes** | cache policies, ubatch, cross-layer prefetch, k<6, extreme drop, 1c requant, IQ2, similarity/skew, asymmetric drop, typeahead, phase-split 2B, LFM on G99, Ling 3.0 Tiny. |

---

## 4. THE THEORY THAT KILLED MOST OF IT

With batched verify: `bytes/token = [γα + (γ+1)β] / L`, with `L ≤ γ+1`.
If **β ≥ 1**, bytes/token ≥ 1 even with free drafts; the escape is **β < 1**.
For γ=4, α=1/3, L≈3, break-even is **β < 0.56**, fewer than ~3.3 experts.
F6 measured that and failed.

Routing entropy: **96 %** of 256 experts touched within 300 tokens; top-16 carry
25 % of mass; ~45 expert re-reads per token. Consecutive tokens route to near-
disjoint expert sets. Batching and cache-similarity tricks therefore do not
amortize on this architecture.

---

## 5. MEASURED SPEEDS — the lineup, per model per device

All numbers are screen-on and unplugged unless noted; these are product-card
figures, not cell-internal figures. The provenance gap remains for CalaQwen S23
5.86 and Marco1c Jelly 3.64: they match the speed grid but lack a reopenable
`runs.csv` + analysis pair.

| model | S23 (8 GB, 8Gen2, UFS 3.1) | Xiaomi 14 (11.4 GB, 8Gen3) | Jelly Star (G99, 8 GB) |
|---|---|---|---|
| **CalaQwen** 35B-A3B KEXP | **5.86** t/s (t4, k6d065) | **4.75** t/s (t6) | — |
| **Marco1c** | **8.82** t/s (t4) | **10.57** t/s (t4) | 3.64 t/s (t2) |
| **Mellum2** 12B/A2.5B | **5.151** t/s (t2, k6d1.0) | — | — |
| Qwen3.5-2B dense | 15.9 t/s | — | 8.04 t/s (t2) |
| Qwen3.5-4B dense | 8.38 t/s | — | 3.52 t/s (t2) |
| Qwen3.5-1.5B | 25.8 t/s (LiteRT CPU) | — | — |
| LFM2.5-8B-A1B | — | — | 10.60 (k4) / 12.28 (k3) / 14.38 (k2) |

The streaming regime is silicon-independent: CalaQwen reads 30.4 MiB/token at
80.7 % hit on Xiaomi and 30.7/80.7 on S23. Marco is compute-heavy: t4 is 2.1×
t6 on Xiaomi; the card rule `cpu_capacity ≥ 50 % → t6` strangles SM8650.
Screen state changes Xiaomi CalaQwen from 0.22 to 0.50 s/tok. KEXP on G99 is
8.83 t/s against a 14.7 projection. Consecutive-run variance was **±50 %**
(3.99 → 8.27 t/s); speed claims need ABBA pairs.

---

## 6. OPEN QUEUE — what is left to finish

| # | item | state / blocked on |
|---|---|---|
| 1 | **K2: q4_K/q5_K `MUL_MAT_ID` compute** | pre-existing, confirmed on unpatched; touches Mellum2 Q4_K_M; grok, tonight |
| 2 | q2_K/q3_K MoE on GPU | after K2; KEXP experts |
| 3 | cvt.cl cosmetics | 2 stale comments plus uniformity on 6 macro consumers; debt, not defect |
| 4 | LANE_MOD | equidistribution check before reusing classifier; before session-2 classifier |
| 5 | S23 cache cells + absolute lineup | dedicated unplugged device session |
| 6 | gap ~70 % kernel_kf vs lineup binary | investigate |
| 7 | **Publish the Adreno MoE OpenCL fix** | dossier: 3 bit-characterized miscompiles and byte-exact reproduction; owner decision |

---

## 7. THE SCOREBOARD, WITHOUT DECORATION

**1 confirmed and replicated win** (the recipe), **1 shipped app result** (TTFT),
**1 strong candidate** (expert skipping), **1 real mechanism with no speed payoff**
(Frozen Draft), and **~25 techniques retired with numbers**.

**Adreno MoE OpenCL kernels: CLOSED 19–20/08.** Three Qualcomm compiler
miscompiles were fixed; q4_0/q4_1/q5_0/q5_1/mxfp4 pass on Adreno 740. The judge
is repaired, production is immune, and K2 is the remaining q4_K/q5_K chapter.

Outside the recipe and TTFT, nothing new has shipped into the app. The largest
unshipped configuration result remains **2.6×** on Marco1c and **−32 %** on
cache. Measurement discipline remains the bottleneck: record the condition in
the data row, and read the binary that ran from the run JSON.
