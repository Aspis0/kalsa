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
| 11 | **B′ Q8_0-trunk (NPU-on-KEXP road (a)) — ALIVE, gate PASSED 24/08** | The last surviving trunk candidate after q41 killed the 4-bit trunks (IQ4_NL +4.27%, Q4_0 +8.06% PPL): **Q8_0-trunk passes the FIRST multilingual pre-registered PPL gate (q43) on all five corpora — wiki −1.08%, IT −0.57%, ES −0.60%, FR −0.66%, ZH −1.34% — it is BETTER than the shipped KEXP control everywhere, at +1.948% file size**, experts byte-identical to shipped. Prereg locked pre-download, math audit CLEAN on the measurement layer, doc audit BANK-w-corrections applied. Owner decision: road (a) — HVX kernels shelved for KEXP, NPU role = Q4_0-native models + KEXP via Q8_0 trunk. Not yet: behavioral axis (#30) and on-device HTP dispatch smoke (first Xiaomi window). Winner gguf kept, sha `bd63fc0f…`. **v73/S23 smoke attempt (24/08): killed by FIT, not by a defect** — the HTP load path materializes the experts as a 5996 MiB anon CPU buffer (+repack copies, 6360 MiB total on a 7074 MiB MemTotal phone) → LMK during load; but the design split DOES form (attn Q/K/V/O init-tensor on HTP0). Marco-B′ NPU = Xiaomi/16GB-class; on the S23 road (a) applies only to smaller KEXP models. **Numbers landed 24/08**: Marco-B′ on houji same-harness pp512 **1.46×** (27.8 vs 19.1) + first matched-work energy J/token **0.86×**; LFM-B′ on S23 pp512 1.14× — trunk-on-NPU prize is real but architecture-bound. **BEHAVIORAL AXIS: FAIL DEFINITIVE (q52, 24/08 evening, prereg `1a1c9a19`, DeepSeek pre-bank audit BANK-CLEAN)** — under the app's PRODUCTION sampler (temp .7/topk 40/topp .95/minp .05), Marco-B′ degenerates on `long_it_04` in **4/10 pre-registered escalation seeds vs control 0/10** (unbounded name-list loops to the token cap, hand-verified; 5/23 vs 0/23 on that prompt overall). The v1 "greedy artifact" theory is dead. **Lineup trunk STAYS Q5_K/Q6_K; KEXP-Q8 does not proceed; B′ = NPU-lab variant only, and the router's trunk-B′ lanes (R4/R7) now owe a LOOP gate on top of numerical correctness before certification.** Method note: PPL better 5/5 + blind judge 6:1 FOR B′ coexist with a 40% degeneration tail — those instruments don't see it; the loop gate does |
| 13 | **MoE EXPERTS ON THE NPU — lane OPENED 24/08 (first ever)** | All-Q4_0 OLMoE (experts = 96.6% of file): 3.6 GiB of experts load to HTP0-REPACK and **execute via MUL_MAT_ID on the NPU** on both retail devices. v73/S23: dispatch proven (48 execute-ops at pp16) but the DSP queue dies under load (`dspqueue_read 0x2e`, pp512 and decode, tombstone saved — upstream issue candidate). **v75/houji: SURVIVES — pp512 686 t/s vs CPU 142 = 4.82×, the best NPU ratio of the campaign** (dense-hybrid 4B was 3.19×); tg 0.63× (decode stays CPU, consistent everywhere). Correctness gate (text/PPL device HTP-vs-CPU) still owed. Strategic: experts-on-NPU (4.82×) ≫ trunk-only B′ (1.14–1.46×) → the HVX K-quant MUL_MAT_ID kernel road is repriced as the only path to this class on KEXP models; Q4_0-native MoE gets it today on v75-class. **v73 hardening chapter CLOSED 24/08 (F2b + guarded logcat): removing binary ops from HTP does NOT save v73 — a SECOND independent death mechanism appears (deliberate `qurt_exit()` in `fastrpc_shell_unsigned_3`/`htp_iface_stop`, no op handler in the stack). Bounded skel fixes have no target → **policy F6, OWNER-CONFIRMED 24/08: MoE-experts-on-NPU is v75-class-only**; v73 keeps dense/hybrid prefill 3.5× and B′-trunk (both device-proven). The v73 skel chapter reopens only on explicit product demand (est. 1–2 weeks, uncertain outcome, firmware-wall risk). Two characterized v73 death mechanisms = rich upstream report (dossier #8, queued)** |
| 12 | **GPU fit-gate memory constant (q44 sweep, 24/08, math audit CLEAN)** | **k (MemAvailable cost per offloaded weight byte) is NOT a constant**: k_set 1.74→1.05 from ngl 7 to full (N=25, LFM2.5-KEXP, S23), incremental k collapses 1.70→0.09. Post-hoc affine reading: partial offload ≈ **~750 MiB fixed (Adreno prealloc, present even at ngl 0) + ~1.0× offloaded bytes**; candidate conservative gate for the app `800 MiB + 1.05×bytes` (safe on all 5 measured points). Bonus proofs: mmap weights cost ~nothing in MemAvailable (RssFile peak 3.1 GiB, ΔMA 35 MiB at ngl 0) and GPU weight copies are invisible to RssAnon (~80–110 MiB flat) — the app's gate blindness, now measured. Constants need a second model/device before shipping |
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

| | S23 / 740-class (v73, 8 GB) | Xiaomi / 750-class (v75, 16 GB) | Jelly / G99-class (no HTP) |
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
