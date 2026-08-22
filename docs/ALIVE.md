# ALIVE — what is still standing, 2026-08-22

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
and Q5_K/Q6_K trunk, so production was never exposed.

**K2 closed (2026-08-20 night, tag `kalsakernel-v3` = `c1bb48d32`):** q4_K/q5_K
MoE `MUL_MAT_ID` (0/80 + 0/4, garbage ERR 0.57–0.96, both GEMV and GEMM) is the
**fourth miscompile site** of the same E031 compiler: the literal byte masks in
`get_scale_min_k4` — Qualcomm's own dense kernels already pass those masks as
arguments (the dodge was load-bearing) but the MoE kernels kept literals. Fix:
masks as kernel args + ILA guard on the q4_K GEMM (the prebuilt binary keeps the
old signature). Proof: semantically identical transform flips FAIL→PASS
(80/80 + 4/4; whether the trigger is the literals per se or the ABI/program-shape
change is not isolated). Final: MUL_MAT_ID **391/391 across all types**, dense
unchanged (10 pre-existing q6_K flat fails; upstream #26476 is a cherry-pick
candidate), roundtrip zero. Beneficiaries: Mellum2 (Q4_K_M) and every standard
Q4_K/Q5_K MoE gguf on Adreno; KEXP experts (q2_K/q3_K) still CPU-fallback by
design. Upstream master (checked 2026-08-20): A6X/A7X gate still active, none of
our four fixes superseded.

**And the repaired path is FAST (2026-08-21, exploratory):** on the S23,
experts-on-GPU vs experts-on-CPU at equal offload (OLMoE-1B-7B Q4_K_M, full
ngl=16, unplugged, ABBA×2): burst decode **27.5 vs 12.7 tok/s (2.17×)**,
sustained **15.3 vs 10.3 (~1.5×)**, and the GPU arm runs COOLER (CPU arm hits
40.2°C). On this device class, when the model fits in RAM, GPU experts are a
candidate default, not just a thermal valve. N≥10 pre-registered cell required
before any ship claim.

**And then the step beyond repair (2026-08-21 evening, tag `kalsakernel-v4`):
we WROTE the q2_K/q3_K MoE kernels that upstream has for NO GPU generation** —
the KEXP recipe's experts (Q2_K+Q3_K) run on GPU for the first time ever.
Method: triple-audited design before any code, storage bijections certified
against the CPU reference by a dedicated dequant oracle (nfail=0, max_abs=0 —
the safety net the trans4 saga lacked), barrier-safe kernels (immune by
construction AND device-proven on padding shapes m=96, GEMV and GEMM), then
supports_op flipped last. Verification: MUL_MAT_ID **401/401** (391 baseline
untouched + 10 new), LFM2.5 smoke with all four new kernels dispatching and
zero expert fallback (tg64 15.09 t/s — a function smoke, not a speed claim).
Side discovery: the q4/q5/q6 sibling kernels carry a LATENT barrier defect
(early return before work-group barrier, `ne01%32&&!%64` shapes; review-found,
not device-proven; dormant because all current shapes are %64) — queued as its
own chapter.

**The power-off wall was never the GPU (oomwall, 2026-08-21):** Mellum2-scale
crashes were llama-bench's DEFAULT ARM repack (`use_extra_bufts=true`, no flag
to disable) allocating ~6.5GB of anonymous memory — kernel death even at
`-ngl 0`, proven by the single-variable W4/W4c pair. Production is structurally
immune (`use_extra_bufts=false` is a hard rule). Bench rule on 8GB devices:
always the no-extra-bufts variant. Separate known bug: FLASH_ATTN `map::at`
(d_head=64, no guard) — use `-fa off` in GPU benches.

**The speed claim is now PRE-REGISTERED (2026-08-21 evening): SHIP 1.553×.**
OLMoE confirmatory cell, prereg v1.2 (N≥5 ABBA, tg512-only, cooldown gate,
battery floor, frozen pins): median **A 16.36 vs B 10.53 t/s = 1.553×**, GPU
arm cooler (peak 38.4 vs 38.95 °C), 5/5 cool-start blocks, zero exclusions,
hostile audit BANK (28/28 csv=jsonl instrument-matched). Scope: S23 + OLMoE,
model fits in RAM. **Same session, KEXP exploratory (NOT ship): A 13.74 vs
B 7.58 = 1.81×** on LFM2.5-8B-A1B-KEXP with OUR q2/q3 kernels at ngl=99,
GPU arm cooler again. IMPORTANT: in both cells arm B keeps the trunk on GPU —
these numbers isolate EXPERT placement only.

**KEXP N≥5 ship session (2026-08-22 night, prereg v1.2, audit BANK): mixed
verdict, and the new fact is a REFUTE.** A/B **1.803 PASS** (replicates the
1.81 exploratory under prereg; GPU arm cooler by 2.2°C) — the expert-placement
claim now has two concordant datasets. But arm C (`-ngl 0`, pure CPU, -nr)
measured for the first time: **17.553 t/s — FASTER than full-GPU A (14.252)**.
A/C = 0.812 < 1.20 → the "GPU vs product-default" dossier sentence is
**refuted** on this model; the confirmatory package does not ship. On an A1B
(~1B active params) the 8Gen2 CPU out-runs full GPU offload; the GPU's honest
product role here is the COOL mode (−19% speed, −2.75°C peak). Two more
facts: hybrid B (trunk-GPU/experts-CPU) is the WORST arm (7.90 — per-layer
ping-pong), and stock repack does not help the CPU on this recipe (arm D
post-bag, n=2 descriptive: 16.48/15.51 — never quote as the true upstream
gap without hot-state caveats). **ANSWERED same day (#20 decision cell, audit BANK-with-corrections): pure
CPU beats full GPU on OLMoE too — in EVERY cell of every block.** A(-ngl16)
20.034 vs C(-ngl0) 27.685 t/s, A/C 0.724, decision invariant under pruning.
On OLMoE the thermal story is near-parity (median peak gap 0.45°C, max peaks
identical), so the binding wording is "full-GPU is slower at near-thermal-
parity" — the genuine cool-mode tradeoff exists only on KEXP (2.75°C).
Dossier synthesis after #18+#20: on small-active MoEs the pure CPU always
wins raw speed; half-offload (B) is always the worst; our kernels' value =
the only working GPU path on Adreno (Vulkan dead on K-quants), a replicated
1.8× on expert placement at equal offload, and a real cool mode on KEXP.
"GPU default candidate" is retired. The OLMoE A/B 1.553× SHIP claim stands
in its scope (expert placement at fixed ngl).

**THE DECISION TABLE (S23/Adreno 740, measured; scope: these two models):**

| config | KEXP 8B-A1B | OLMoE 1B-7B | thermal |
|---|---:|---:|---|
| C — all CPU (`-ngl 0`) | **17.55** 🥇 | **27.69** 🥇 | hottest on KEXP (40.0 peak); parity on OLMoE |
| A — all GPU | 14.25 (−19%) | 20.03 (−28%) | KEXP **−2.75°C** (real cool mode); OLMoE −0.45°C (parity) |
| B — trunk GPU, experts CPU | 7.90 ❌ worst | 10.53 ❌ worst (n10 build) | hotter than A |

**Big MoEs (don't fit in 8GB → STREAMING regime — CalaQwen 35B, Mellum2
12B): this table does not apply and mostly cannot exist.** All-GPU is
physically impossible; the only feasible GPU configs are partial offload,
measured on Mellum2: 0.22 t/s dense-GPU / <0.11 experts-GPU vs **5.10 CPU
with the Kalsa recipe** — in the streaming regime the wall is flash
bandwidth and the GPU only adds per-token friction. CalaQwen/Marco GPU
arms never measured; same wall, no reason to expect otherwise. Product
answer for streaming models: CPU + recipe, full stop. Open gap: Marco1c-
KEXP is 6.4GB (LFM2.5-class) and MIGHT fit — a Marco A/B/C cell is the
missing third row (queued).

The streaming CPU/GPU evidence, honestly labeled (no clean table exists):
full offload = impossible; decode partial-GPU (Mellum2, llama-bench mmap)
0.22 t/s vs CPU+recipe 5.10 — **cross-harness caveat**: the 0.22 is
recipe-less llama-bench, the 5.10 is bmoe+recipe, not a clean A/B; decode
experts-GPU = no instrument datapoint (killed cell, ~0.15 class); prefill
(K-G lane) honest 1.12×, hybrid 1.07× — lane killed, not worth the
complexity. Missing piece for a same-harness decode row: one cheap
Mellum2 `-ngl 0` llama-bench mmap cell (queued).

Rules: want speed → pure CPU, always. Want cool on KEXP → all-GPU (−19%
speed, −2.75°C). Half-offload is NEVER right — and that is the kernels'
real product value: without our q2/q3 kernels, offloading a KEXP MoE
FORCES you into B (experts can't go to GPU); the kernels exist so that A
is possible at all. Dense: GPU decode always loses (0.41× on 740); GPU
prefill wins big only on 750-class (3.2–7×, §2), not on 740 (K-G dead).
Speed verdicts are S23-only until the 750 validation (queue); correctness
fixes cover the whole A6X/A7X family. Vulkan is not an option anywhere on
this hardware (dies on all K-quants). Mellum2 footnote:
experts-GPU at ngl=2 in the streaming regime is not viable (<0.11 t/s vs
0.22 dense-GPU/experts-CPU) — the GPU valve pays when the model fits in RAM,
not against the flash-bandwidth wall.

**21–22/08 cleanup wave, all audited (hostile review on every item):**
upstream #26476 cherry-picked (dense q6_K 925/925 on device, the 10 historic
fails closed); **the latent 5th defect is now FIXED and device-VERIFIED**
(barrier-safe port to q4/q5/q6 MoE kernels: MUL_MAT_ID **407/407** incl. new
m=96 padding discriminators dispatching the new kernels, no ILA, no CPU
fallback); llama-bench grew the canonical `-nr/--no-repack` flag (upstream
default physically powers off 8GB devices — no more hacked .so for benches)
and FLASH_ATTN now cleanly rejects unsupported head sizes instead of
crashing on `map::at`; three host nits fixed (ADRENO-only gate guard,
explicit UNKNOWN_COMPILER, ne01==0 dispatch guard) with device regression
bit-identical; cvt.cl stale comments fixed while the uniformity port was
REJECTED by audit and discarded (half-porting device-proven code is worse
than the documented debt); LANE_MOD classifier proven BIASED by construction
(hint, never a verdict; raw residue dumps mandatory for session-2).

**Vulkan on Adreno 740 (2026-08-22, first data ever in this campaign): the
"backend of the future" runs NO K-quants at all.** It initializes, passes
f16 (242/242), then every K-quant pipeline (q4_K dense, q2/q3/q4_K MoE) dies
at `createComputePipeline ErrorUnknown` → uncaught vk::SystemError → SIGABRT,
while `supports_op` reports SUPPORTED. Same device, same day: OpenCL with our
kernels passes 407/407. On S23-class hardware our OpenCL path is not "the
faster option" — it is the ONLY working GPU path for quantized MoE.

**Anti-push hardening (owner directive, 2026-08-21):** all third-party git
remotes REMOVED (llama.cpp submodule: zero remotes; BigMoeOnEdge: Aspis0
only; Khronos deps: zero) + tested pre-push hooks everywhere. Engine backup
= rolling bundle in `backups/` inside the outer repo.

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
| **CalaQwen** 35B-A3B KEXP | **6.810** t/s (t4, k6d1.0 no-renorm, n_gen 224; 22/08 cpuset-gated — old card 5.86 was k6d065) | **4.75** t/s (t6) | — |
| **Marco1c** | **8.82** t/s (t4, i1-Q4_K_M, provenance gap) · KEXP-6.4G variant: **8.199** (t4, n_gen 122, 22/08 cpuset-gated) | **10.57** t/s (t4) | 3.64 t/s (t2) |
| **Mellum2** 12B/A2.5B | **5.098** t/s (t2, k6d1.0, n_gen 222, 22/08 cpuset-gated; old card 5.151 confirmed in-spread) | — | — |
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
| ~~1~~ | ~~K2: q4_K/q5_K `MUL_MAT_ID` compute~~ | **CLOSED 2026-08-20** (kalsakernel-v3, see headline) |
| ~~2~~ | ~~q2_K/q3_K MoE on GPU~~ | **CLOSED 2026-08-21** (kalsakernel-v4: KEXP experts on GPU, 401/401) |
| ~~2b~~ | ~~Cherry-pick #26476~~ | **CLOSED 21/08**: dense 925/925 on device |
| ~~2c~~ | ~~Barrier-safe port q4/q5/q6~~ | **CLOSED 22/08**: device-VERIFIED 407/407 |
| ~~2d-i~~ | ~~N≥10 ship cell (OLMoE)~~ | **CLOSED 21/08: SHIP 1.553×** (prereg v1.2, audit BANK) |
| ~~2d-ii~~ | ~~Vulkan-vs-OpenCL satellite~~ | **CLOSED 22/08**: Vulkan runs no K-quants on A740; ratio not estimable |
| ~~2d-iii~~ | ~~KEXP N≥5 ship cell A/B/C~~ | **CLOSED 22/08 mixed (audit BANK): A/B 1.803 PASS, A/C 0.812 REFUTED** — pure CPU beats full GPU on LFM2.5-KEXP; package does not ship |
| ~~2d-v~~ | ~~OLMoE arm C~~ | **CLOSED 22/08: yes, C wins every cell (A/C 0.724)** — "GPU default candidate" retired; near-thermal-parity on OLMoE, cool mode only on KEXP |
| 5b | S23 cache sweep + binary-side cpuset-gate enforcement (detect-only today) | remaining half of the old #5; dedicated unplugged session |
| 2d-iv | Xiaomi/750 validation | needs the device |
| ~~3~~ | ~~cvt.cl cosmetics~~ | **CLOSED 22/08 mixed**: comments fixed; uniformity port audit-REJECTED and dropped (spec on file) |
| ~~4~~ | ~~LANE_MOD~~ | **CLOSED 22/08: BIASED by construction**; hint-only + raw dumps mandatory for session-2 |
| 5 | S23 cache cells + absolute lineup | dedicated unplugged device session |
| 6 | gap ~70 % kernel_kf vs lineup binary | investigate (diagnosis is plugged-OK; PC recon first) |
| 7 | **Publish the Adreno MoE OpenCL fix** | dossier at max strength: 4 bit-characterized miscompiles + 5th fixed&verified + repack-killer + novel q2/q3 kernels + pre-registered 1.553× + Vulkan-dead-on-K-quants context; owner decision |

---

## 7. THE SCOREBOARD, WITHOUT DECORATION

**2 confirmed wins** (the recipe with p-values; GPU-experts on A740 with a
pre-registered 1.553×), **1 shipped app result** (TTFT), **1 strong candidate**
(expert skipping), **1 real mechanism with no speed payoff** (Frozen Draft),
and **~25 techniques retired with numbers**.

**Adreno MoE OpenCL kernels: CLOSED 19–20/08.** Three Qualcomm compiler
miscompiles were fixed; q4_0/q4_1/q5_0/q5_1/mxfp4 pass on Adreno 740. The judge
is repaired, production is immune, and K2 (q4_K/q5_K) closed on 2026-08-20.

Outside the recipe and TTFT, nothing new has shipped into the app. The largest
unshipped configuration result remains **2.6×** on Marco1c and **−32 %** on
cache. Measurement discipline remains the bottleneck: record the condition in
the data row, and read the binary that ran from the run JSON.
