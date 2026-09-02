# ALIVE — what is still standing, 2026-08-22

> **Derivative.** `PLAN.md` is authoritative; this page is a short status view.
> Git history preserves the long form. If this file and PLAN disagree, PLAN wins.
>
> **1/09 cell #44 SURVIVES (audit mimo FIX→APPLY).** Job 795870. See table
> row 28. PLAN + `scratchpad/agents/qdc-8elite-npu-v79-experts/` win.

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

The streaming CPU/GPU evidence (same-harness decode row completed
2026-08-22, #23): Mellum2, llama-bench mmap, n=16: pure CPU `-ngl 0 -nr`
**0.216** t/s (plugged, declared; level flat, no mem cliff) vs trunk-GPU
partial `-ngl 2 -ncmoe 99` **0.223** (unplugged) — **GPU placement moves
nothing in the streaming regime (±3%)**; experts-GPU has no instrument
datapoint (killed cell, ~0.15 class, certainly not better). The 23×
jump to the product's 5.10 t/s is the RECIPE (bmoe moe-stream + cache),
different harness — never divide across harnesses. Prefill (K-G lane):
honest 1.12×, hybrid 1.07× — killed, not worth the complexity. Streaming
verdict, now same-harness-backed: the wall is flash bandwidth; GPU is
irrelevant to it; the recipe is everything.

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

## 5b. REPO CONSOLIDATION (22/08 evening — owner decision "option A")

Three repos, three roles — the vendored engine copies are gone. **`Aspis0/kalsa`**
= the app. **`Aspis0/kalsa-forkbigmoeonedge`** = BigMoeOnEdge (wrapper; renamed
from `kalsa-engine` 22/08, GitHub redirects). **`Aspis0/kalsallama`**
(new, private) = the llama.cpp fork: all branches + tags pushed; two legitimate
lineages, `kalsa/kernel-s3-repack` (Adreno GPU kernels, head `1882bf8cd`) and
`kalsa/mmap-prefetch-opt` (CPU expert-ready hook `5236140e5` — the lineage the
app's llama.rn patch mirrors; the branch name "bmoe/expert-ready-hook" cited in
app comments does not exist and must be corrected). `moe-experiments/kalsa-engine/`
(vendored) was deleted after proving zero unique content; its bundles moved to
`backups/engine-bundles/`. BigMoeOnEdge `.gitmodules` now points at kalsallama
(no more Helldez third-party URL), and the fork's pre-push hook is an allow-list
for `github.com/Aspis0/*` only. Full map: `docs/ENGINE.md`.

## 5c. XIAOMI/750 VALIDATION (22/08 evening — #16 closed, audit BANK-w-corrections)

**The MoE kernels transfer: MUL_MAT_ID 407/407 on Adreno 750** with a NEWER
Qualcomm compiler (E031.45.02.25 vs the S23's E031.41.03.62) — the campaign's
core result now holds on two devices and two compiler builds of the A7X family.
Two more findings, both dossier-grade:

- **The newer compiler breaks an upstream path the older one passed**: dense
  MUL_MAT 905/925 — 20 deterministic FAILs, all f16/bf16×f32 batched with
  nr≠[1,1] (k=1056/k_v=2112, ERR ~0.10-0.19); every nr=[1,1] and f32×f32 case
  passes. Not our kernels: upstream f16 batched. "Every E031 build breaks
  something different" is now a measured statement (compiler attribution =
  strong hypothesis, not formally isolated).
- **The 740 speed verdict does NOT generalize**: exploratory A/B/C (N=3, tg128,
  cells in Doze) on the same KEXP gguf gives decode **A 24.47 ≈ C 24.28**
  (A/C 1.008 vs 0.812 on S23) and **prefill A = 2.21× C**. B (trunk-GPU/
  experts-CPU) is the worst arm on both devices. On 750-class, full-GPU with
  our kernels is a candidate default — a preregistered confirmatory cell is
  the follow-up. Dense prefill: GPU unchanged since August (181.5), but HEAD
  CPU is ~4× faster → honest ratio 1.43× (CPU repack) / 2.62× (CPU -nr),
  the historical 5.77× was a weak CPU baseline.

**Phase d (same evening, audit BANK-w-corrections):** the A/C parity was
confirmed at **N=5 with clean protocol** (10/10 cells, all Awake, gguf hashed
on-device): **decode A/C 0.992, prefill 2.477**. And the product model got its
750 verdict the hard way: **Marco-KEXP 6.385G full-GPU = kernel reboot**
(fit-gate FAIL-HARD — the smoke even returned valid jsonl before the device
died; never retry full-GPU on this gguf/device). Surviving CPU row (N=3,
~12% spread caveat): **tg 28.2 / pp 41.8** — Marco fits in the Xiaomi's RAM
and runs ~3.4× the S23's 8.2 t/s, where it does not fit: **fit dominates
every optimization**.

Provenance gap on file: device-side gguf hash not recorded in phases b/c
(binary pinning is per-cell and solid; model pinning is PC-side only) — fixed
in phase d, mandatory for future harnesses. Evidence
`results/xiaomi750_validation/`, audit `scratchpad/agents/q16-xiaomi-audit/`.

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
| ~~2d-iv~~ | ~~Xiaomi/750 validation~~ | **CLOSED 22/08 evening (audit BANK-w-corrections)**: MUL_MAT_ID 407/407 on the newer E031.45 compiler; NEW upstream f16/bf16 batched defect (20 deterministic fails); exploratory A≈C decode + A=2.21× prefill on 750 — see block 5c |
| ~~3~~ | ~~cvt.cl cosmetics~~ | **CLOSED 22/08 mixed**: comments fixed; uniformity port audit-REJECTED and dropped (spec on file) |
| ~~4~~ | ~~LANE_MOD~~ | **CLOSED 22/08: BIASED by construction**; hint-only + raw dumps mandatory for session-2 |
| 5 | S23 cache cells + absolute lineup | dedicated unplugged device session |
| 6 | gap ~70 % kernel_kf vs lineup binary | investigate (diagnosis is plugged-OK; PC recon first) |
| ~~8~~ | ~~Expert-packing gate~~ | **CLOSED 22/08 night, DEAD with a number**: UFS 4.0 = 1.33×, **UFS 3.1 (decision gate) = 1.058×** — random reads at 0.94MB blocks are nearly free on both; the packing premise is false at our block size. Weeks of GGUF-rewriter work avoided by a 30-min gate |
| 10 | Mali gate (#26) — gates 1+2 RUN 22/08 | **The Mali OpenCL lane is ALIVE: f32 MUL_MAT 202/202 correct on G57** (allowlist patch, branch kalsa/mali-probe on kalsallama, never-merge). Quant kernels fail to COMPILE for a mundane reason: `#ifdef INTEL_GPU/ADRENO_GPU` with no `#else` leaves N_SIMDGROUP/N_DST/N_SIMDWIDTH undefined on Mali + non-portable `half*` loads. Vulkan stays dead (BDA missing). Gate 3 (RUN): portability patches compile everything, but dense quant dies on real architecture gaps (**Mali has no sub_group_shuffle_xor** → SIGILL; q4_K WG-size) — yet **MUL_MAT_ID q8_0 = 75/75 OK, a quantized MoE matmul runs on Mali**. Final: lane alive (f32 + q8_0-MoE), product path (Q4_K/Q4_0) needs Mali-tuned kernels = real project, owner decision. **Gate 4 (RUN 22/08 night, plugged, Luna audit BANK-w-corr): GPU < CPU on all 20 green cases, max 0.962× — f32 GEMM 0.238× (7.81 vs 32.76 GFLOPS), q8_0-MoE flat 20.7–22.2 GFLOPS while the 8-thread CPU scales 21.5→69.5 with batch (0.962×→0.320×). Achieved GFLOPS = 6.1%/16–17% of an ASSUMED unmeasured 128 GFLOPS fp32 peak (not measured ALU occupancy; paper's <3% was fp16 MLC, separate). Direct measurement: the generic OpenCL path never beats the same-device CPU; "Mali-tuned kernels mandatory" is the inference. Qwen 4-stage recipe on file for the project if opened.** **OWNER DECISION 22/08: PARKED on G57-class. Generation research (q26e): the jump is Valhall gen-3 (G610/G710, doubled FP32/core; G615/G720 better still, with the only published LLM-prefill evidence). G610/G615 MC6 already at the $220-350 tier (POCO X6 Pro ~$249); Africa/SEA volume tier stays G57 through 2026. Reopen when a G610/G615 MC6 device is in hand** |
| 9 | NPU-spike track | **THE DOOR IS OPEN ON BOTH RETAIL DEVICES (v73 S23 + v75 Xiaomi) and the first prefill number is in: HTP median 84.0 vs CPU 24.1 tok/s ≈ 3.5×** (avg 3.40×; pp512 nseq=1, Qwen3.5-4B-Q4_0, unplugged, scheduler proof audit-CONFIRMED `execute-op → HTP0|hmx-tiled`; the silent-CPU-fallback trap without `--no-host 1` is operator-reported, raw pending). Judge partially isolated (audit correction): **44/70** quantized FAILs are `CPU=nan` with fail signatures matching exactly across both devices → harness judge broken for those, HTP innocent (suspect: -ffp-model=fast); remaining 26 to classify. Caveat: 4B hybrid (GDN/SSM stays on CPU) — a pure transformer should ratio higher (upstream 2B ref: 461 tok/s). Toolchain fully in-house. Owner vision: tri-engine governor NPU-prefill/CPU-decode/GPU-cool (#24); K-quant HVX kernels possible sequel (#28c). Judge experiment #1 (Qwen: REPACK-poisoning suspect) in prep: pre-patch verbose baseline captured on Xiaomi 22/08 night (10-min window, unplugged 53%, all 70 quant fails reproduced, HTP finite / CPU nan, sha == q30 manifest) at `results/htp_judge/xiaomi_v75_baseline/`. **Judge mechanism traced (q32 desk + Jelly discriminator): NOT Qwen's CPU_REPACK — the HTP `is_host` buffer makes graph_copy memcpy TILED bytes into the CPU reference, skipping the unpack (tiles read as canonical blocks → NaN scales). CPU-only on MediaTek: 194/194 pass both stock and plain-host, zero REPACK lines → Qwen's theory loses. SENTENCE EXECUTED on Xiaomi 23/08 (plugged declared, Luna audit BANK-w-corr): the NaN class was ENTIRELY the judge's fault — PLAIN_HOST=1 zeroes all reference scale counters, 0/70 → 34/70 pass. 36 numeric FAILs remain, ALL at batch n>=5 across all 5 quant types (ERR 56-150 + two giant outliers at n=2048/4096), all already failing in baseline: possible REAL HTP batch defect, hypothesis NOT yet established. Fallback trap does NOT reproduce on houji/v75 (both arms HTP-class 109-117 t/s with execute-op proof in -v stderr; refutes only this exact setup — q31/S23 had different flags and its "CPU fallback" was itself an inference). First houji prefill data point: 116.8 t/s pp512 (plugged, non-cell); gguf + llama-bench now deployed → bankable unplugged cell ready to run. CLASSIFICATION CLOSED (q35 + Luna audit): the 36 residuals are NOT a compute error — the HMX kernel never runs on them: host eligibility uses m padded to 32, DSP rejects the unpadded m, returns INTERNAL-ERROR, and the host LOGS-AND-IGNORES it (TODO: handle errors) so the compared output is untouched random fill. All 36 reconcile 1:1. Bottom line: HTP never caught computing wrong — the harness corpus hits a broken host/DSP contract plus real error-swallowing (status-propagation defect worth fixing in fork/upstream; test shapes m=1/6/16 are artificial). Counterproof EXECUTED (mimo audit BANK clean): the failing q4_0 m=16 n=8 case passes 1/1 forced onto HVX via MM_SELECT=2. **BANKABLE PREFILL CELL EXECUTED 23/08 (houji unplugged 100%, mimo audit BANK-w-corr): pp512 HTP median 165.4 t/s (range 150-170, 3 reps) vs same-harness CPU 51.9 = 3.19x (range 2.89-3.28x), 448 hmx-tiled execute-ops proof. v73→v75: ~2x absolute HTP (84→165), similar ratio (3.49→3.19) because the CPU improves more than the HTP on the newer SoC. Caveats: 4B hybrid GDN/SSM-on-CPU, nseq=1, single device, HOSTBUF=1 here vs unset on S23. DECODE CELL (23/08, unplugged, exploratory): HTP tg128 4.1-4.9 t/s vs CPU 11.9 = **0.37x — NPU decode not competitive even though it really runs on HTP0 (hvx-tiled): prefill-only role CONFIRMED with numbers**. The tri-engine governor (#24) now has all three roles device-verified: NPU=prefill 3.19x, CPU=decode, GPU=cool-mode. nseq>1 probe not executable at this pin (no -np in llama-bench); kernel source confirms no-broadcast → multi-seq fallback expected from source, unmeasured** |
| 11 | **B′ Q8_0-trunk (NPU-on-KEXP road (a)) — ALIVE, gate PASSED 24/08** | The last surviving trunk candidate after q41 killed the 4-bit trunks (IQ4_NL +4.27%, Q4_0 +8.06% PPL): **Q8_0-trunk passes the FIRST multilingual pre-registered PPL gate (q43) on all five corpora — wiki −1.08%, IT −0.57%, ES −0.60%, FR −0.66%, ZH −1.34% — it is BETTER than the shipped KEXP control everywhere, at +1.948% file size**, experts byte-identical to shipped. Prereg locked pre-download, math audit CLEAN on the measurement layer, doc audit BANK-w-corrections applied. Owner decision: road (a) — HVX kernels shelved for KEXP, NPU role = Q4_0-native models + KEXP via Q8_0 trunk. Not yet: behavioral axis (#30) and on-device HTP dispatch smoke (first Xiaomi window). Winner gguf kept, sha `bd63fc0f…`. **v73/S23 smoke attempt (24/08): killed by FIT, not by a defect** — the HTP load path materializes the experts as a 5996 MiB anon CPU buffer (+repack copies, 6360 MiB total on a 7074 MiB MemTotal phone) → LMK during load; but the design split DOES form (attn Q/K/V/O init-tensor on HTP0). Marco-B′ NPU = Xiaomi/12GB-class; on the S23 road (a) applies only to smaller KEXP models. **Numbers landed 24/08**: Marco-B′ on houji same-harness pp512 **1.46×** (27.8 vs 19.1) + first matched-work energy J/token **0.86×**; LFM-B′ on S23 pp512 1.14× — trunk-on-NPU prize is real but architecture-bound. **BEHAVIORAL AXIS: FAIL DEFINITIVE (q52, 24/08 evening, prereg `1a1c9a19`, DeepSeek pre-bank audit BANK-CLEAN)** — under the app's PRODUCTION sampler (temp .7/topk 40/topp .95/minp .05), Marco-B′ degenerates on `long_it_04` in **4/10 pre-registered escalation seeds vs control 0/10** (unbounded name-list loops to the token cap, hand-verified; 5/23 vs 0/23 on that prompt overall). The v1 "greedy artifact" theory is dead. **Lineup trunk STAYS Q5_K/Q6_K; KEXP-Q8 does not proceed; B′ = NPU-lab variant only, and the router's trunk-B′ lanes (R4/R7) now owe a LOOP gate on top of numerical correctness before certification.** Method note: PPL better 5/5 + blind judge 6:1 FOR B′ coexist with a 40% degeneration tail — those instruments don't see it; the loop gate does |
| 13 | **MoE EXPERTS ON THE NPU — lane OPENED 24/08 (first ever)** | All-Q4_0 OLMoE (experts = 96.6% of file): 3.6 GiB of experts load to HTP0-REPACK and **execute via MUL_MAT_ID on the NPU** on both retail devices. v73/S23: dispatch proven (48 execute-ops at pp16) but the DSP queue dies under load (`dspqueue_read 0x2e`, pp512 and decode, tombstone saved — upstream issue candidate). **v75/houji: SURVIVES — pp512 686 t/s vs CPU 142 = 4.82×, the best NPU ratio of the campaign** (dense-hybrid 4B was 3.19×); tg 0.63× (decode stays CPU, consistent everywhere). Correctness gate (text/PPL device HTP-vs-CPU) still owed. Strategic: experts-on-NPU (4.82×) ≫ trunk-only B′ (1.14–1.46×) → the HVX K-quant MUL_MAT_ID kernel road is repriced as the only path to this class on KEXP models; Q4_0-native MoE gets it today on v75-class. **v73 hardening chapter CLOSED 24/08 (F2b + guarded logcat): removing binary ops from HTP does NOT save v73 — a SECOND independent death mechanism appears (deliberate `qurt_exit()` in `fastrpc_shell_unsigned_3`/`htp_iface_stop`, no op handler in the stack). Bounded skel fixes have no target → **policy F6, OWNER-CONFIRMED 24/08: MoE-experts-on-NPU is v75-class-only**; v73 keeps dense/hybrid prefill 3.5× and B′-trunk (both device-proven). The v73 skel chapter reopens only on explicit product demand (est. 1–2 weeks, uncertain outcome, firmware-wall risk). Two characterized v73 death mechanisms = rich upstream report (dossier #8, queued). **THIRD death signature landed 24/08 evening (q53, audit BANK-w-corr): `dspqueue_write 0x1` in flush_batch kills the TRUNK-only B′ lane under perplexity batch-2048 load (1667 execute-op proof held; same model+build was clean at pp512) → correctness gate FAIL by letter, and the v73 NPU menu is now formally UNCERTIFIED across the board: dense/hybrid and trunk-B′ ran demos, but no v73 lane has passed a correctness cell. Router R6/R7 OFF. **q53b (25/08, audit BANK-CLEAN): the death is NOT batch-bound — identical `dspqueue_write 0x1` at -b 512 after 9/32 chunks (2-3 at 2048); longer survival at smaller batch is consistent with accumulated DSP/queue state, not proven (n=1). THERMAL INCIDENT 25/08: during the sustained HTP perplexity of the full-on-NPU hybrid (lane 2) the S23 dropped off adb twice (8/32, 4/32; ping alive at the second drop, adbd dead) and was then found very hot, powered off and not booting — device DOWN, hardware state unknown. Our harness had no intra-run thermal watchdog (temp only pre/post arm). New rule: on-device watchdog on every run > 2 min (poll 10 s, kill at 43 °C); sustained v73 NPU runs OFF pending owner. R6 hard OFF (incident), R7 hard OFF (q53/q53b). `INCIDENT_THERMAL.md`. **Recovery night 25/08 (q56): device booted clean (`shutdown,lpm` = OS thermal protection, not a panic), integrity 100%; on-device thermal watchdog built + validated (kill path, pass-through), hostile audit SAFE-with-fixes (PID race + guard liveness, being fixed). The lane-2 HTP log recovered from the device shows the run COMPLETED after adb died: 32/32, PPL 8.5179±0.125, 55,730 execute-ops — HTP arm complete with zero new NPU load. CPU-ref attempt killed by the guard at 38.3 °C at chunk 1 (CPU alone heats the 4B past 38 °C in ~2 min tonight) → r not computable yet, but chunk-1 HTP 7.9075 vs CPU 7.9064 (+0.014%): first direct sign the v73 NPU computes the same numbers as the CPU on this graph. **Session 3 (25/08, BANK-CLEAN): guard re-validated T1–T5; CPU-ref guard-killed at 43.4 °C at chunk ~7 → 32-chunk reference unreachable unplugged; 2-chunk agreement NPU/CPU +0.01–0.03 % — the v73 NPU computes correctly on the graphs that run. q57: full-on-NPU hybrid prefill heats the S23 at 2.33 °C/min (40 °C in 3.75 min; CPU-ref 1.38 °C/min, not same-start) — sustained NPU load is thermally unusable on this device; product-relevant question = per-prompt cost. **q57 B/C (spike, B-C-C-B under guard, BANK-w-corr): pp512 NPU 88–91 t/s vs CPU 27–33; heat per 2×512-token pass NPU +0.6/+1.2 °C vs CPU +2.0/+2.5 → 0.45 vs 1.125 °C per pass: as a prefill SPIKE the v73 NPU is ~3× faster AND leaves less heat per prompt; charge-counter energy inconclusive (5.3× spread on identical work — do not cite). So v73 NPU: correct, firmware-dead for MoE/B′, thermally unusable sustained, attractive as a time-budgeted prefill spike on dense/hybrid — R6 may reopen only in that form (owner decision + dedicated cell). **q58 spike sweep (25/08, 16 guarded runs, BANK-w-corr): NPU v73 beats CPU at every prompt size — 3–5× faster and 2.5–4× less heat per prompt (per-process ΔT 0.5/0.0/1.1/2.2 vs 1.9/3.25/3.25/5.15 °C at 128/512/1024/2048; prompt-only 1.7 vs 12.3 s at 128, 23.2 vs 81.6 s at 2048). Spike-lane parameters: N_max = 512 tokens, thermal threshold 39.5 °C; the S23 thermalservice exposes no numeric headroom → the app must poll battery temperature.** **q60 (25/08, Jelly, math audit): NPU-for-STREAMING-MoE is a NO-GO on 8 GB/UFS 2.2 — the pp512 prefill wall already equals its flash floor (8.4 GB read per prefill at ~370 MB/s); the prereg's Amdahl rule ignored I/O–compute overlap (orchestrator error, refuted by audit); NPU headroom ≤1.8× minus a second tiling pass over the same bytes. Re-gate only on v75+UFS 4.0 with a read_bytes-per-prefill measurement. **q60b (S23/UFS 3.1, math audit): same verdict — self-consistent NPU headroom ≈ 1.0×, flash + page-fault bound (12 GB read per pp512 for a 6.5 GB model, cache holds ≤1.5 GB; re-read multiplier grows with batch to 3.7× at 2048). Audit extrapolation to UFS 4.0 (Xiaomi io_gate 2046 MB/s): pp512 ≈ 2.5–3× IF the NPU removes all user compute → the v75 door is real; the settling measurement is defined (cold pp512×3 + pp2048 on the Xiaomi with per-launch read_bytes + utime/stime split). **q61 ran it on the Xiaomi (borderline arm only, audit BANK-w-corr): the UFS 4.0 extrapolation is REFUTED — the same file prefetches at 1.8 GB/s but the eval page-fault pattern re-reads at 190–430 MB/s: mmap streaming is pattern-bound, faster flash does not help; honest NPU headroom on that arm 1.3–2.2× (owner band). None of q60/q60b/q61 measure the PRODUCT streamer (BigMoeOnEdge block reads) — that is the missing measurement (CalaQwen 13.4 GB on the 11.4 GB Xiaomi). **q55 Part A (26/08, v75, math audit BANK-w-corr): the 4.82× experts-on-NPU lane is now CORRECTNESS-CERTIFIED — OLMoE 32-chunk PPL HTP0 8.9214 vs CPU 8.9233 (r −0.02 %), the ENTIRE forward graph on HTP0 (3,024 expert MUL_MAT_ID + attention), KV storage on host (-nkvo: a 256 MB KV cache at ctx 2048 cannot be fastrpc-mapped — host limit to encode in the router). Scope: OLMoE/-nkvo/v75 only. **Part B + Qwen (audit BANK-CLEAN): v75 spike pp512 NPU 581–805 t/s vs CPU 52–70, ΔT ≤ 1.0 °C on every arm — the 750-class is where the NPU pays for free thermally; Qwen hybrid on HTP0 r10 = +0.11 % (10 common chunks, characterization of lane R3); houji thermalservice exposes no numeric headroom either** |
| 12 | **GPU fit-gate memory constant (q44 sweep, 24/08, math audit CLEAN)** | **k (MemAvailable cost per offloaded weight byte) is NOT a constant**: k_set 1.74→1.05 from ngl 7 to full (N=25, LFM2.5-KEXP, S23), incremental k collapses 1.70→0.09. Post-hoc affine reading: partial offload ≈ **~750 MiB fixed (Adreno prealloc, present even at ngl 0) + ~1.0× offloaded bytes**; candidate conservative gate for the app `800 MiB + 1.05×bytes` (safe on all 5 measured points). Bonus proofs: mmap weights cost ~nothing in MemAvailable (RssFile peak 3.1 GiB, ΔMA 35 MiB at ngl 0) and GPU weight copies are invisible to RssAnon (~80–110 MiB flat) — the app's gate blindness, now measured. Constants need a second model/device before shipping |
| 7 | **Publish the Adreno MoE OpenCL fix** | dossier at max strength: 4 bit-characterized miscompiles + 5th fixed&verified + repack-killer + novel q2/q3 kernels + pre-registered 1.553× + Vulkan-dead-on-K-quants context; owner decision |
| 14 | **Dense HTP-readable quant gate (q59, Qwen3.5-4B, PC, 25–26/08) — IQ4_NL FAIL, Q4_0 FAIL; no dense HTP-readable quant ships; owner decision pending** | Same-source BF16 → pinned quantizer, control = same-source Q4_K_M, 5 corpora, gate Δ% ≤ +1.0 % on all: IQ4_NL wiki −1.16 / it +0.84 / **es +1.39** / fr +0.46 / **zh +1.02** (2 FAIL); Q4_0 +2.15…+3.36 on all four languages. Paired per-chunk reading (post-hoc, non-gating): IQ4_NL is genuinely worse than Q4_K_M on every language corpus (sign p ≤ 4e-3, 95 % CI excludes 0), upper bound ≤ +1.93 %; whether it is above or below +1.0 % is unresolved on it/es/zh; wiki inverts (both candidates better, unexplained). Size −3.4 %. Not the q41 story (KEXP trunk IQ4_NL +4.27 %): the dense effect is 3–9× milder (4.27 / 1.39…0.46). Audit math DeepSeek BANK-w-corrections (wording only; all 15 cells + hashes re-derived on disk). **Options: A keep Q4_K_M (status quo) / B ship IQ4_NL with a quality asterisk after a q52-class loop gate / C Q4_0 out. Orchestrator recommendation: A now, B deferred** — the only consumer is router lane R3 (dense/hybrid on HTP v75), OFF in the ledger until the app-side spike cell + HTP memory model exist; IQ4_NL = NPU lab variant, same status as B′. **OWNER DECISION 26/08: A** (Q4_K_M stays; pure IQ4_NL for everyone rejected — quality tax for all, benefit only on v75-class and currently off). **Road D opened: q63 "IQ4_NL-M"** — HTP-readable recipe = IQ4_NL base + Q8_0 on the tensors Q4_K_M promotes to Q6_K/Q5_K (the "M" is the mix, not the base type — the KEXP method applied to a dense model); same source/quantizer/gate as q59, control cells reused; PASS 5/5 → per-device ship (v75-class only) after a q52-class loop gate; FAIL → dense-on-NPU waits for HVX (28c). Evidence `scratchpad/agents/q59-dense-quant-gate/` (PLAN #32) **ERRATUM 27/08 (banked with #18):** the q59 “IQ4_NL” arm was NOT pure — 37 Q5_K tensors → not HTP-readable; its quality FAIL stands, but the HTP-readable question was settled only by q63’s C1 |
| 15 | **Prefill under the PRODUCT streamer (q62, `bmoe-cli --moe-stream`, shipped binary `0ac612de`, Xiaomi v75, CalaQwen KEXP 13.42 GB > RAM, 26/08) — COMPUTE-BOUND, not flash-bound; HVX prerequisite (1) satisfied** | Prompt 486 engine-counted tokens, cache off, 4 O_DIRECT lanes, 3 invocations unplugged under guard (max 31.2 °C): wall 38.0 / 35.8 / 32.8 s (12.8–14.8 tok/s), 7149 MiB (6.98 GiB) of expert reads per prefill. The engine does not decompose prefill into io/compute, so I/O wall comes from the io-trace (19.5k reads with latency): Σlat 17.8 / 17.1 / 14.3 s over 4 parallel lanes → **I/O ≈ 10–13 % of wall, compute ≈ 87–90 %**, robust under all three bounds (max I/O share 0.477 even fully serialized). **Headroom (wall-seconds): k=2 ≈ 2.2, k=4 ≈ 4.5 (≥ 2.095 under every bound), k=8 ≈ 8.3–9.0** → PREREG settling rule: streaming-NPU has a real ceiling under the product streamer; the kernel decision is the owner's, together with the 8xx datum. Effective prefill read rate 1.75–2.27 GB/s (vs 0.2–0.4 GB/s of the mmap page-fault path in q60/61 — the product streamer is not pattern-bound). Math audit DeepSeek BANK-w-corrections (wording only; REPORT byte-reproducible). Caveats: max-lane model plausible-not-verified (no timestamps; bracketed by the engine's decode io_ms 334 vs 328 ms), +4 KiB/read over-read (+1.05 %), wall drift −13.9 % mostly compute-side, /proc sampler followed the wrong pid (cross-check failed, declared), no drop_caches (no root); **Appendix 27/08 (unplugged 68→60 %, same audit, corrections applied)**: secondary `--cache-mb 2000` 3/3 — headroom k=4 point 4.57–4.60 but 1.94–2.02 under the serialized bound (inv1/2 "mixed"; narrowest margin 1.1 % — the "≥ 2.095 under every bound" statement stays primary-only); the cache works in decode (−30 % bytes) while prefill reads are byte-identical → consistent with no measurable prefill effect (PREREG expectation); optional p2048 n=1 exploratory: I/O share 0.10, headroom k=4 4.45 — compute-bound scales. Declared deviations: battery gate 40-vs-45 in code (no invocation the locked gate would reject), 2048-prompt sha trail fixed, sampler wrapper-pid again (no derived number uses it). Evidence `scratchpad/agents/q62-product-streamer-prefill/` (PLAN #33) |
| 16 | **Owner away 28/08 → ~07/09: 10-day plan signed** (`docs/PLAN-10DAYS-2026-08-28.md` v2, DeepSeek-audited) | Order: QDC 8 Elite (Adreno 830 + Hexagon v79; kill-date day 4; E031 third column, decision table 8xx, NPU generation map) → S23 plugged baseline (prep done 26/08: 12 GB free, OLMoE + Marco-KEXP on device, `s3oracle` toolchain certified 407/407 + 925/925; plugged idle reference pending) → ≤ 3 OpenCL upstream picks with device gates → q2_K/q3_K MoE **prefill** kernel optimisation (profiling patch first; dual gate kernel ≥ 1.3× / cell ≥ 1.15×) → router prompt-length crossover on Marco1c. HVX K-quant (28c) only under the pre-delegated rule (v79 survives experts ∧ q63 FAIL ∧ written GO). In flight on the PC: **q63** IQ4_NL-M HTP-readable recipe (lock `7477247a`; rebuilt-binary validity PASS; C1 quantized and HTP-readable; PPL running ~12 h) — bank adds the q59 erratum (its IQ4_NL arm was non-pure, 37 Q5_K tensors). Xiaomi cells (q62 secondary, R2/R3) resume after 07/09 or on QDC |
| 17 | **Streaming-regime expert-cache sweep on the S23 (q64, 26/08 night, unplugged 90→82 %, ≤ 31.3 °C, shipped bmoe-cli `0ac612de`, Marco i1-Q4_K_M 10.5 GB > 8 GB RAM) — the cache is decisive; app constant = 3437 MiB** | Closes queue #5b + the row-6 remainder. `--cache-mb` {0, 1500, 2000, 4000, auto}, Latin square N=3, greedy tg (all 15 runs stop at EOS 102 with byte-identical text → identical 9–102 window, declared arbitration): decode **1.07 / 1.76 / 1.93 / 2.84 / 2.75 t/s** (2.65× from 0 to 4000), hit 0/29/39/59/55 %, reads 32.9→8.7 GB per 102 tokens, I/O share 0.47→0.38; no LMK (MemAvailable 5.2–5.4 GB). Frozen rule (smallest C within 5 % of the best) → `auto` qualifies (2.753 vs 2.838) and resolves to 3429/3437/3524 MiB → **3437 MiB**: the engine's auto sizing is already right on 8 GB. Prefill (128/prefill_s) 11.9→7.8 t/s with cache size, NOT established as causal (intra-arm spread, no prefill telemetry). vs q60b: 0.547 wall-normalized effective-rate ratio to the 430 MB/s O_DIRECT gate; io-time-only 569–613 MB/s. Math audit DeepSeek BANK-w-corrections (all numbers re-derived, REPORT byte-reproducible). Evidence `scratchpad/agents/q64-s23-stream-cache-sweep/` (PLAN #34) |
| 18 | **The “IQ4_NL-M” HTP-readable recipe on Qwen3.5-4B (q63, road D, 26–27/08, PC, lock `7477247a`; audits: math DeepSeek BANK clean (all 10 deltas re-derived ≤1e-9, paired bit-exact, es rounding-floor [+0.9511, +0.9539]), doc mimo BANK-w-corrections applied) — C1 PASSES 5/5: Q4_K_M’s quality lives in the MIX, not the base type; first dense HTP-readable quant to pass the gate** | C1 = IQ4_NL base + Q8_0 on the tensors Q4_K_M promotes (first-match `--tensor-type`, Q8_0 embd/out; 3 098 664 160 B, dump HTP-readable PASS): Δ% vs the reused q59 Q4_K_M controls — wiki −2.31, it +0.43, es +0.95, fr +0.12, zh +0.62, all ≤ +1.0 % (point-estimate gate, q59’s standard; honesty note: the post-hoc NON-gating paired CI on es [+0.39, +1.51] does not exclude the threshold). C2 (`--pure` + Q8_0 embd/out) FAILS 3/5 (it +1.31, es +1.73, zh +1.69) → the ~37 promoted tensors carry the quality. Banked q59 erratum: its “IQ4_NL” arm was non-pure (37 Q5_K), never HTP-readable. **q67 (Xiaomi v75, last day, locks `4b5afc37`+Amdt1–3):** C1 loads and executes on HTP0 (execute-op proof, flat temps) with **pp512 199.7 vs 43.8 t/s CPU ≈ 4.5×**; HTP-vs-CPU r NOT measured — VOID: A1 holds 20 valid HTP chunks but no CPU-ref ever completed (plugged-charging kill at 43.0 °C at n=4; the locked 4.0 GiB MemAvailable floor never opened unplugged, even right after a sanctioned reboot — 3.6 GB of HyperOS residents; gates never loosened across Amendments 1–4; to be measured post-07/09 on v75 or on QDC v79). Consequence: road D open — per-device ship (v75-class only) AFTER a q52-class loop gate; the HVX §8 pre-delegated rule’s “q63 FAIL” condition does NOT trigger. Evidence `scratchpad/agents/q63-dense-htp-recipe/` + `q67-c1-htp-v75-load/` (PLAN #35) |
| 19 | **S23 unplugged correctness certified; unplugged speed matrix DEAD for the trip (night0, 28/08, BANK-WITH-ERRATA, GLM hostile audit)** | s3oracle on the S23 **unplugged**: MUL_MAT_ID 407/407 + MUL_MAT 925/925, pin set 11/11, ac:false proven in raw. No speed numbers: three attempts, three distinct deaths — awake thermal plateau 38.8–39.0 °C vs the locked 32 °C gate, real idle drain 13–15 %/h (Amendment-1's 7.5 %/h premise REFUTED → the authorized block was arithmetically unfinishable from 46 %), and adb transport death ~20 s into run A. Speed moves to QDC 8 Elite — **operational same day: 1000 free min on QRD8750 (Android 16), adb-over-SSH dry-run PASS incl. custom-binary exec from /data/local/tmp** — and/or S23 plugged/USB after replug (TODO at replug: pull the possible orphan on-device jsonl). Platform bonus: kalsallama builds on macOS/aarch64, 10/10 tests incl. all six test-repack-q23k — first kernel-test platform off Windows, iOS groundwork. Evidence `scratchpad/agents/s23-unplugged-baseline-night0/` (+ `night0-bank-audit/`) (PLAN #36) |
| 20 | **First 8 Elite datum (qdc-8elite-cpu-day0, 28/08, QDC QRD8750/Oryon, BANK-WITH-ERRATA, GLM hostile audit) — our kernels are CORRECT on Oryon first-run, and the Oryon CPU alone doubles the S23's decode** | Correctness with the `a0cabca6b` CPU kit: MUL_MAT **1144/1144** + MUL_MAT_ID **812/812** (`-b CPU`; the vacuous no-`-b` skip was honestly recorded, not counted). Speed OLMoE Q4_K_M: tg128 **59.1 t/s** (-t8, conservative median; S23 CPU #20 27.685 → **~2.1× device-class**, not a controlled A/B: no_repack differs, older binary lineage), pp512 93.0; -t6 52.5/75.5. Caveats banked: mid-ramp numbers (monotone −8.6% worst drift, HAL CPU 39.6→53.8 °C, status 0→1), rack battery service FROZEN (all battery telemetry is a stub; "plugged" is declared, not measured), aggregator not preregistered (median-of-invocations chosen ex-post, conservative). Cost 20 of 996 free min; adb via SSH tunnel on local port 6037 (Jelly's adb server untouched). Plan consequence: the 8xx CPU bar rises for any HVX/GPU kernel investment; queued next — Marco-KEXP (#18 comparator) and a GGML_OPENCL=ON kit for the E031 column on Adreno 830. Evidence `scratchpad/agents/qdc-8elite-cpu-day0/` (+ `qdc-day0-bank-audit/`) (PLAN #37) |
| 21 | **Governor v0 wins on 8 Elite (qdc-8elite-governor-crossbackend, 29/08, prereg+amendment, cell #38) — per-phase routing beats both single-backend arms on the shipping model** | The three LiteRT gems on ggml, measured end-to-end: ctx_prefill on OpenCL/Adreno 830 + ctx_decode on CPU in ONE process, KV committed across the boundary. LFM2.5-2.6B QAD-Q4_0, 3 turns x (512 prompt + 128 gen), ABBA 2 blocks, r=3, thermal-gated (live HAL sensors, cooldown to <=60C before every run). Medians: G ttft **1434/1470 ms** vs C 16476/14412 (>=9.8x better, within 3-5% of pure-GPU A) with decode **25.3/24.2 t/s >= C's** and commit 26-29 ms = **1.80%/1.98% of prefill** (pre-written <2% gate: PASS both blocks, by 0.02 in block 2). Banked honesty: the 2% is prompt-length-dependent (commit cost ~fixed 11.2 MB/turn); part of G's decode edge is THERMAL (C self-heats to 90-93C in its own CPU prefill; G reaches decode cooler - a real systemic effect of the design, not kernel speed); run 1 VOID (thermal gate read dumpsys's frozen `Cached` group - live truth is `Current temperatures from HAL:` + Thermal Status, instrumentation erratum extending #20's frozen-battery finding). Correctness: full governor suite green on-device incl. cross-backend test (prefill_splits=2, both commit paths). Engine kalsa/governor-v0 @ 5c3979438. Evidence `scratchpad/agents/qdc-8elite-governor-crossbackend/` (PLAN #38) |
| 22 | **MoE q2/q3 kernels correct on Adreno 830 — third GPU/compiler generation, first run (qdc-8elite-opencl-e031, 29-30/08, prereg + hostile GLM audit FIX→APPLY, cell #39)** | test-backend-ops on QRD8750 (Android 16, driver 0800.70, Compiler E031.47.18.47): MUL_MAT **925/925 executed OK + 545 capability skips** (closes to 1470 per-case lines); MUL_MAT_ID **407/407 executed OK + 405 skips** (closes to 812) — counts independently reproduced by the auditor, 0 FAIL. Audit-narrowed claim: plain-MUL_MAT q2_K/q3_K NEVER executes on this backend (26/26 declined by capability); the MoE path (MUL_MAT_ID, our 8x4 kernels) passes 10/14 with ALL realistic shapes OK (m=64/96/512, n_mats=4, n=1..32) and 4 small-shape capability skips (m=8/16) — correct on the 830 for every shape they accept. Banked honesty: vacuous first attempt with `-b OpenCL` (backend registers as **GPUOpenCL**; green OK with zero cases run) kept as negative exhibit for BOTH ops; a draft's unsourced thermal "pre" pair retracted; no pre-run thermal snapshots captured (procedural deviation, disclosed — correctness is not clock-sensitive, Thermal Status 0 on record in both post snapshots). Kit bin-gov-5c3979438-stripped. Evidence `scratchpad/agents/qdc-8elite-opencl-e031/` (PLAN #39) |
| 23 | **KEXP decision table on Adreno 830: GPU wins prefill 2.56x, CPU wins decode 1.24x (qdc-8elite-speed-kexp, 30/08, prereg + hostile GLM audit FIX->APPLY, cell #40) - completes the generational series** | llama-bench on QRD8750 unit 41c5710f (arch sun, Android 16), model Marco-KEXP (qwen3moe 17.25B Q4_K 5.94GiB, sha local==device), ABBA A C C A, r=3, exit 0/4, live-HAL thermal gate <=44C status 0 on every invocation. Block medians: A(GPU ngl99) pp512 **274.5** tg128 **48.9**; C(CPU ngl0) pp512 **107.4** tg128 **60.7**. Pre-written rule (block medians, >=5% win): **GPU prefill 2.56x, CPU decode 1.24x**, both far past threshold. The three GPU generations now each give a DIFFERENT verdict, re-measured never transferred: 740 CPU-always -> 750 GPU-2.21x-prefill/tie-decode -> 830 GPU-2.56x-prefill/CPU-1.24x-decode. This is exactly the per-phase split the governor (#38) exploits - confirmed on the KEXP recipe, not only the shipping LFM2.5. Banked honesty: session 792778 VOID (/vendor/lib64 in LD_LIBRARY_PATH bypassed the sphal namespace -> Adreno driver's libCB.so dlopen failed -> SILENT CPU fallback labeled OpenCL ngl99 exit 0, its numbers matched arm C; wrong 'broken unit' diagnosis corrected on the record). Kit bin-gov-5c3979438-stripped. Evidence `scratchpad/agents/qdc-8elite-speed-kexp/` (PLAN #40) |
| 24 | **Governor v0 scales to the 3x model and the commit tax DROPS: 0.83-0.89% of prefill on LFM2.5-8B-A1B (qdc-8elite-governor-8b, 30/08, prereg + hostile GLM audit FIX->APPLY, cell #41)** | governor-bench 5c3979438 (structural fail-fast: A/G abort non-zero on CPU-only resolve) on QRD8750 unit b4bd0901 (sun/SM8750, Android 16), LFM2.5-8B-A1B Q4_K_M (lfm2moe, 5.15 GB, sha local==device), order A C C A G G, 6/6 exit 0, live-HAL gate PASS before every invocation (two 1-min cooldowns after post-run status-2 excursions, re-probes archived). Medians: A ttft **2517.7/2518.8 ms** decode **28.20/28.37**; C ttft 25122.6/26134.1 decode 13.95/13.46; G ttft **2495.8/2496.1** decode **13.32/13.33**, commit **22.15/20.77 ms = 0.89%/0.83% of prefill** (pre-written band "<=3%: scales cleanly"; #38 reference ~1.9% on the 2.6B -> commit grows SLOWER than prefill: 6/24 attention blocks, ~8.06 MiB/commit). **G = WIN by the pre-written rule** (keeps GPU prefill - faster than A - and CPU decode >=0.95xC, tightest 0.955). Binding co-headline: the best single arm HERE is A (GPU decode 2.0-2.1x the 1-thread CPU, caveat banked) - with #38 (2.6B: G beats both) and #40 (KEXP: CPU wins decode) this is the three-point proof that routing must be per-device AND per-model; a hardcoded GPU-prefill/CPU-decode split is wrong on this 8B, and v0's sub-1% commit makes ANY router choice affordable. Banked honesty: audit-corrected serial citation, upload rate 24.9 MB/s, mis-transcribed re-probe (46.9->47.5) fixed, GPU evidence via fail-fast + dedicated llama-bench banner probe (QUALCOMM/Adreno 830). Evidence `scratchpad/agents/qdc-8elite-governor-8b/` (PLAN #41) |
| 25 | **First VLM cell: LFM2.5-VL-3B on the 830 — the decision table gains a third phase: vision encode CPU, prefill GPU 4.0x, decode CPU 1.28x (qdc-8elite-vl3b, 30/08, prereg + hostile GLM audit FIX->APPLY, cell #42)** | llama-mtmd-cli from the fork @ 556118a08 (5c3979438 + unconditional timing line) on QRD8750 unit eb49fb9d, official LiquidAI GGUF (Q4_K_M + mmproj Q8_0, sha local==device==published), deterministic synthetic image, order C A M / M A C / A M C, 9/9 exit 0, live-HAL gate 18/18 PASS (max 46.5C status 0 - single-turn VLM is thermally mild). Medians: C enc **3915 ms** / prefill 5752.8 / **29.07 t/s**; A enc 6549 / 1445.6 / 22.64; M enc 3927 / **1436.2** / 22.68. Pre-written rule (median of 3, >=5%): **vision encode -> CPU** (GPU loses 1.67x: warmup lists the CLIP ops OpenCL lacks - UPSCALE/SOFT_MAX/CONT/PERMUTE/RESHAPE/f32 MUL_MAT, a concrete kernel target); **prefill -> GPU 4.0x**; **decode -> CPU 1.28x**. E2E (report-only): best static arm M 11008 ms; hypothetical per-phase composition 9755 ms = **1.13x over the best static arm**, 1.40x/1.44x over pure arms - no static arm can execute it: the governor thesis extended to a third phase, FOURTH data point for per-device/per-model/per-phase routing (#38 G wins 2.6B; #40 KEXP split; #41 8B all-GPU; #42 VL three-way). Determinism: 9/9 byte-identical intra-arm (archived extraction rule, hashes independently reproduced by the auditor). Banked honesty: prereg's banner clause deviated (mtmd logger filters it, #41 mechanism) - replacement evidence A=direct in-log (45 OpenCL warmup lines), M=behavioral+probe only (first draft's "A/M" claim was false, audit-caught); first-draft hashes unreproducible -> rule archived and regenerated; A not relabeled "degraded" with rationale on record. Product note: VL decode on CPU (29 t/s) clears Liquid's 20 t/s SM8850 reference. Evidence `scratchpad/agents/qdc-8elite-vl3b/` (PLAN #42) |
| 26 | **Hexagon v79 day-0 on the 8 Elite: the NPU lane EXISTS — our Mac/Docker-built skel loads first try, and ship-model prefill hits 1512 t/s = 7.2x CPU (qdc-8elite-npu-v79, 31/08, prereg + hostile GLM audit FIX->APPLY, cell #43)** | Kit built in the OFFICIAL toolchain container (ghcr.io/snapdragon-toolchain, NDK r28b + Hexagon SDK 6.6.0.0, no login, no PC — owner's call; 4-skel parallel race dodged by serial build) from fork @ 556118a08. Q1 INIT-OK: `Hexagon Arch version v79`, unsigned-PD cDSP session, 6 HVX + HMX + 8MB VTCM. Q2 = "v79 defect list started" (prereg rule as written): MUL_MAT 472/542 (70 FAIL), MUL_MAT_ID 0/301 — BUT the auditor's FULL census (362/362 diagnostic lines, zero inversions) shows HTP0 always finite vs CPU reference always nan/inf, and the GPUOpenCL control vs the SAME reference passes 407/407 -> judge poisoned ONLY in the HTP pairing (the Adreno NaN-judge class); REAL v79 defects: 36 dspcall INTERNAL-ERROR (29 at m=16 n=4..8, 7 outside incl. m=576x512x576) + 7 undiagnosed FAILs (incl. q4_0 m=1,n=2048). Q3 exploratory N C C N 4/4 exit 0 on THE SHIP MODEL (2.6B QAD-Q4_0): **N pp512 1512.2 / tg 23.47; C pp512 211.1 / tg 38.49 = NPU prefill 7.2x, CPU decode 1.64x** — the per-phase split on the THIRD engine class (upstream-recipe flags, declared non-comparable with #38/#41; no routing verdict, seeds the NPU column). Q4: reasoning-trace-only smoke (audit-imposed relabel: NO arm emitted a final answer at -n 64). Banked honesty: binding CLI thermal-gate deviation (stale 10-min gate, none before C; mitigant post 48C); "well under gate" retracted (pre_N2 57.6; post-C 61.5/63.0 = ABOVE threshold in-run); SHA256SUMS self-hash proven (entry = sha256 of empty string); botched first fix commit disclosed and amended. Session 793389: 11.5h queue record, headless web login broken all morning -> Connect host relayed by the owner. Evidence `scratchpad/agents/qdc-8elite-npu-v79/` (PLAN #43) |
| 27 | **Actions free-tier restored 1/09, android-bench probe PASS, cann auto-CI off, governor-v0 pushed (`cff0a4a75`)** | Operational record only, not a kernel cell: `ci/android-bench` free probe run `33457714894` PASS on `ubuntu-latest` in 8m53s (2026-09-01). `CI (cann)` disabled at repository level and YAML `workflow_dispatch`-only (`3cfe5ddab`). `kalsa/governor-v0` pushed to `Aspis0/kalsallama` as `88e88a1cf..cff0a4a75`; no new cann run on that push. |
| 28 | **v79 experts-on-NPU SURVIVES on the 8 Elite (qdc-8elite-npu-v79-experts, 1/09, prereg + hostile mimo audit FIX→APPLY, cell #44)** | OLMoE all-Q4_0 requant (sha `9d0b90c6…` host==device, not the q55 file). Job **795870** QRD8750 Android 16, 15 min billed. Q1: **48** `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps` (16 layers × gate/up/down), `Hexagon Arch version v79`. Q2: llama-bench `EXIT=0`. PREREG **SURVIVES**. Q3 `-r 3` clean number NOT RUN (session ended to stop idle burn). Verbose r=1 jsonl pp512 **845.9 t/s** is report-only, not comparable to #43 1512 (different model) nor q55 PPL. Kit tarball named 556118a08; jsonl `build_commit` `4c7101af4` = that pin plus one docs-only commit; hexagon/htp diff empty. `--list-devices` probe failed (script missing `LD_LIBRARY_PATH`); Q1 with env ok — not METHOD-VOID. Duplicate **795871** Canceled at Submitted, 0 min. Session 1 D NOT closed: patched-judge + Qwen3.5-4B dense v79 remain OPEN. HVX 28c stays frozen. Evidence `scratchpad/agents/qdc-8elite-npu-v79-experts/` (PLAN #44) |
| 29 | **Session 1 D remainder measured, correctness still OPEN (qdc-8elite-npu-v79-d-rest, 1/09, job 796061, mimo audit + parent EXIT erratum, cell #45)** | Same kit 556118a08, QRD8750, ~19 min. Q_ops: test-backend-ops HTP0 **not patched-correct** (OK=0/0; MUL_MAT FAIL 72 / INTERNAL-ERROR 36; MUL_MAT_ID FAIL 303 of which 301 CPU-nonfinite judge). Binding rc is log `EXIT=1`, not `adb.exit=0`. Q3 OLMoE Q4_0 r=3 no-verbose: pp512 NPU **862.6** vs CPU **199.9 = 4.32×** (closes #44 leftover). Qwen3.5-4B Q4_0 requant sha `f1635f9c…`: pp512 **355.0 / 107.1 = 3.32×**, tg128 **8.62 / 19.63** (CPU wins decode 2.28×). Session 1 D OPEN on correctness; dense+OLMoE speed measured. q63-on-HTP still deferred. HVX 28c frozen. Evidence `scratchpad/agents/qdc-8elite-npu-v79-d-rest/` (PLAN #45) |
| 30 | **The v79 judge was poisoned, not the kernels — repaired kit proves the MoE path correct and surfaces the real defects (qdc-8elite-npu-v79-judge, 1/09, job 796233, ~33 min, Luna REPORT + hostile Fable audit, cell #46)** | Kit `93e9592fa` (q32 judge port `GGML_TEST_PLAIN_HOST=1` + DSP-error→`GGML_STATUS_FAILED` propagation + `llama-perplexity`; hostile mimo audit APPLY×2). With the judge ON: `judge_nonfinite=0` on MUL_MAT and MUL_MAT_ID, `recopy_lines=executed` (542/301). **MUL_MAT_ID 301/301 PASS** — the experts path was 0/301 ALL judge-poison in #43/#45. Control (judge OFF): **301** CPU-nonfinite FAILs by direct raw scan (`0/301 tests passed`) → poison is real, repair is real (the frozen census tool mis-emits the control as 60, header-glue bug, `FINDINGS-reviewer.md`; the raw meets the 301 condition). MUL_MAT 37 FAIL = **36 DSP INTERNAL-ERROR** (kit propagation 36:36, every one forced to FAIL by `test-backend-ops.cpp:1850`) **+ 1 genuine numeric NaN** (`q4_0 m=2880 n=32 k=2880`, HTP0=nan vs CPU=−12.34) — the v79 defect list, the m=16 n=4..9/m=1 n=64 family matching #43. PPL ship 40.2720/40.2837 and OLMoE 9.0620/9.0562 were measured but **VOID** (the prereg dropped q55's `-v`, execute-op proof absent → #47). Evidence `scratchpad/agents/qdc-8elite-npu-v79-judge/` (PLAN #46) |
| 31 | **v79 NPU forward pass CERTIFIED numerically correct vs CPU — Session 1 D CLOSED on correctness (qdc-8elite-npu-v79-ppl-v, 1/09, job 796297, ~11 min, Fable REPORT + hostile mimo audit APPLY, cell #47)** | Same kit `93e9592fa`, PPL HTP-vs-CPU at 32 chunks WITH `-v` so the execute-op witness prints (the fix for #46's VOID). **Ship LFM2.5-2.6B QAD-Q4_0: PPL_HTP 40.2720 / PPL_CPU 40.2837 = r −0.029 % PASS**, 10648 `HTP0 execute-op MUL_MAT` (shortconv/dense, 0 MUL_MAT_ID). **OLMoE all-Q4_0: 9.0620 / 9.0562 = r +0.064 % PASS**, **3024 `HTP0 execute-op MUL_MAT_ID` = 1008×3 on ffn_gate/up/down_exps** (experts on the NPU; = q55's v75 expert count, now v79). Cross-check: PPL_HTP(#47) byte-identical to PPL_HTP(#46) → `-v` changed only logging. CPU denominators reused from #46 (deterministic, declared). shas all host==device; `[32]`=Final (32-chunk closure). Pre-gates PASS, post-gate in-run excursion disclosed. With #46 (judge repaired + MoE 301/301) this **CLOSES Session 1 D on correctness**: v79 computes correctly on the ship model and the experts-on-NPU lane. The 36 DSP + 1 NaN defect list (#46) stays open as hardening, not exercised by these models. Evidence `scratchpad/agents/qdc-8elite-npu-v79-ppl-v/` (PLAN #47) |
| 32 | **The v79 defect list is FIXED on device: INTERNAL-ERROR 36 → 0, zero regressions, and the lone NaN is narrowed to the uninit-memory family (qdc-8elite-npu-v79-fixA-48, 2/09, job 796621, ~4 min billed — cheapest cell of the campaign, Luna REPORT + hostile mimo audit APPLY, cell #48)** | Kit `153fdbafd` (= certified judge kit + 2-line host fix `736ddd206`: HMX eligibility on logical `src0->ne[1]%32` = DSP contract, HVX fallback + `GGML_TEST_EXTRA_MM` probe injector, each commit audited). R1=R2 `545/546`, R3 MUL_MAT_ID **301/301**, judge ON throughout (recopy 546/301). **All 36 former INTERNAL-ERROR shapes cleared**: 34 now PASS via HVX; 2 large ones (`q4_0 1/2048/8192`, `q8_0 6/4096/5120`) become an honest upfront "not supported" — code-traced: supported_mul_mat precompute (:2875) now parameterizes HVX (:2589 ineligible) and the VTCM demand exceeds the 8 MB budget → clean decline replacing a runtime error (both were broken in #46; audit F-7: chain FORCED by code). Per-shape diff vs #46: exactly 34 FAIL→OK + 2 FAIL→NS + 6 extras, zero former-OK degradations, m=576 control OK. **Class B narrowed**: only the FIRST in-run execution of `q4_0 2880/32/2880` NaNs — index **354 in both runs with different input data** (CPU ref 3.17 vs 8.47; index 305 on #46's binary), the 3 identical re-executions PASS; k=1024 OK, n=64 OK, q8_0 OK → binary-fixed slot + first-touch trigger: **uninit-memory family favored (scale-pad or VTCM layout undercount), fp16 accumulation doubly disfavored**; end-of-census order confound disclosed. Baseline-trap addendum banked: the m=1,n=64 census `real_fail` labels were pty-glue, all were IE (36 IE : 36 compute-failed : 1 NaN-diag closes the set). Fix is inert on real models (all #47 HMX shapes %32-aligned). Evidence `scratchpad/agents/qdc-8elite-npu-v79-fixA-48/` (PLAN #48) |
| 33 | **The Class B NaN does NOT fire in a cold process — the trigger needs dirty VTCM/process state from prior ops; the pad-zeroing diagnostic skel is proven SAFE (qdc-8elite-npu-v79-clsB-49, 2/09, job 797032, ~4 min, Luna REPORT + hostile mimo audit: 1 fabricated citation found and fixed, otherwise CONFIRMED, cell #49)** | Kit v4 (`ca82efa8b` test-backend-ops adds `GGML_TEST_EXTRA_MM_FIRST` prepend, prep audit mimo APPLY; stock skel = CERTIFIED `37131e07`, zeropad `HTP_ZERO_TILE_PAD` skel `398879cc` zeroes the VTCM tile pad after DMA at all 3 sites). 4 runs (stock×2, zeropad×2), 4 cold-head probes of `q4_0 2880/32/2880` each: **ALL 544/544, zero NaN diags, zero IE** — the shape's first in-process execution at cold head PASSES on the same certified skel that NaN'd mid-census in #48 → cold pages are benign; the poison requires prior-op state. Census arithmetic closes both cells at a 540 census (#48's q4_0 count included a Failing-list echo). T1-vs-T2 got NO signal (stock never NaN'd — design flaw admitted: FIRST=1 on all runs destroyed the repro condition; host-binary confound disclosed). Zeropad arm: zero regressions (grid case 4 clean). Evidence `scratchpad/agents/qdc-8elite-npu-v79-clsB-49/` (PLAN #49) |
| 34 | **T1 REFUTED: zeroing the VTCM scale-pad does NOT cure the Class B NaN — T2 (VTCM state corruption elsewhere) promoted; and the poisoned slot MOVES (qdc-8elite-npu-v79-clsB-50, 2/09, job 797063, ~3.5 min, prep audit mimo APPLY + Luna REPORT + hostile mimo audit APPLY, cell #50)** | Exact #48 replica (binary `5cf3565b` = #48's, EXTRA appended, NO FIRST, judge on) on a fresh unit (`f25c433a`): the live NaN is BACK on stock (`545/546` ×2) **and PERSISTS on the zeropad skel (`545/546` ×2, active skel sha verified per run)** → **grid case 2 binding: T1 (uninit scale-pad) refuted as sole cause**; the memset-the-pad candidate fix is dead. Second banked finding: **NaN index instability** — same binary gives #48: 354/354, #50 stock: 388/353, zeropad: 359/334 → the defect-desk "binary-fixed slot" reading is REFUTED; the slot moves per run/session (device change makes device-vs-run variance inseparable, disclosed). Zeropad stays safe-not-curative (only failure everywhere = the expected census NaN; F-8 respected; IE=0; gates 8/8). Next per prereg: deeper DSP instrumentation post-window (candidate angles in REPORT: dequantize path, VTCM aliasing, double-buffer staleness, HMX accumulator state). Evidence `scratchpad/agents/qdc-8elite-npu-v79-clsB-50/` (PLAN #50) |
| 35 | **Upstream descriptor type-check fix REFUTED as the Class B cause — the eliminated-causes ledger reaches three; Class B stays parked with containment (qdc-8elite-npu-v79-clsB-51, 2/09, job 797407, ~2.5 min — cheapest cell of the campaign, prep audit mimo APPLY + Luna REPORT + hostile mimo audit FIX-applied, cell #51)** | Upstream recon found llama.cpp `71102a73f` (22 Jul, PR #25968): missing tensor-TYPE term in the hexagon host descriptor-reuse check — mechanism matched the entire banked fingerprint ON PAPER. Cherry-pick `022458a28`, single-variable cell (kit v6: arms identical except `libggml-hexagon.so` buggy `e91fbcef` vs fixed `e95fa35e`, per-run hexlib+skel+tbo shas logged on-device): **NaN present in ALL FOUR arms** (`545/546` ×4, IE=0, gates 8/8) → grid case 2, **refuted**. Post-mortem banked: plausible-mechanism matching is not evidence; only the single-variable cell was. Index observations: controls agree 338/338 on this unit (#50's disagreed), fix arms 482/360 differ on identical bytes → index is lib/state-sensitive, presence is not; no law from 2+2 runs. **Eliminated causes: T1 scale-pad uninit (#50), descriptor cross-type reuse (#51), cold-process first-touch (#49)** — remaining T2 angles: dequantize path, VTCM aliasing, double-buffer staleness, HMX accumulator state. Cherry-pick stays on the branch (correct upstream hardening regardless). Fourth distinct unit (87b3a4aa). Evidence `scratchpad/agents/qdc-8elite-npu-v79-clsB-51/` (PLAN #51) |

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

---

## 8. THE THREE-ENGINE MAP BY GENERATION (2026-08-24, all cells banked)

The cross-generation laws, measured:

1. **Decode is DRAM-bound → the CPU wins it on every generation, always.**
   NPU decode 0.37–0.63×, GPU loses (740) or at best ties (750). No exception found.
2. **Prefill is compute-bound → accelerators pay there.** v75 ranking:
   experts-on-NPU **4.82×** > dense-NPU 3.2× > GPU 2.48× > trunk-NPU (B′) 1.46×.
   On 740 the GPU prefill is ~1.1× (not worth it) and the NPU stack is fragile.
3. **Quant compatibility is the gatekeeper.** HTP reads only Q4_0-family/Q8_0 —
   KEXP experts (Q2/Q3_K) enter only via the Q8_0 trunk (B′) today, or via future
   HVX K-quant MUL_MAT_ID kernels (the repriced road (b)). Our GPU kernels read
   everything including K-quants: the universal accelerator, with the smallest prize.
4. **Memory decides before speed.** NPU path materializes everything anon (no mmap
   — hard fit on 8 GB phones); GPU costs ~750 MiB fixed + 1:1 driver-side invisible
   to RSS (q44); CPU+mmap is the only elastic-residency engine — where the #29
   repack kernel plays.
5. **Energy, first datum:** NPU arm 0.86× J/token at matched work (single replica;
   the #24 sustained cell will confirm or kill it).

Per generation:

| | S23 / 740-class (v73, 8 GB) | Xiaomi / 750-class (v75, 12 GB) | Jelly / G99-class (no HTP) |
|---|---|---|---|
| **CPU** | Fastest overall; decode king (17.55 vs GPU 14.25 on KEXP) | Decode king still | The only engine: #29 residency kernel (6.6×) + K-F prefetch (−34% where stall>20%) |
| **GPU** | Cool-mode on KEXP only (−19 %, −2.75 °C); the only working GPU path for quantized MoE (Vulkan dead) | Decode parity (0.992) + prefill 2.48× → default candidate where the model fits (fit-gate hard) | Parked: G57 never beats CPU (0.24–0.96×); reopens on G610/G615 |
| **NPU** | Prefill-only and fragile: 3.5× on 4B Q4_0; experts dispatch but DSP queue dies under load (0x2e); all-anon load | Full menu: dense 3.19×, B′ trunk 1.46× (+J/token 0.86×), **experts 4.82× (686 t/s)**; survives where v73 dies | None |

**The generational jump 740→750 changes verdicts, not just speeds** (C-always-wins
→ GPU parity; NPU fragile → NPU holds). Decision tables are re-measured per
generation, never transferred (#16's lesson). Owner directive 24/08: the NPU lane
must ALSO work on v73 — DSP-queue crash and the no-mmap load path are the two
hardening targets (note: the v73/v75 crash discriminator carried a second variable,
HOSTBUF unset vs =1 — the clean retry is queued).
