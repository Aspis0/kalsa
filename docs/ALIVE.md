Two documents only (owner, 2026-09-09): this plan and docs/ALIVE.md. Everything older is under archived/.

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
| 36 | **First 7xx datapoint: on Snapdragon 7+ Gen 3 the GPU FLIES — OpenCL kernels 100% correct on Adreno 732, GPU prefill ~11× CPU, and the FA lane must be capability-probed (qdc-7pg3-govbench-52, 3/09, job 797795, ~80 min billed (35 of work + 45 idle: the End-Session JS click was silently swallowed — ops lesson 7), prep audit mimo FIX-applied + report audit mimo APPROVE, cell #52)** | QDC 7+ Gen 3 unlocked (1000 free min, +HDK8550/8650/8635 same deal → ~4600 min across 5 SoC classes). QRD7675 (SM7675, Adreno 732, 12 GB): **MUL_MAT 925/925 + MUL_MAT_ID 407/407 PASS on GPUOpenCL** (gov-kit `5c3979438`, shas device-verified) — the MoE kernel surface transfers intact to the third GPU class. **Ship config (LFM2.5-2.6B QAD-Q4_0, app-pinned HF rev): GPU -ngl 99 -fa 0 pp512 151.8±1.1 t/s, tg128 17.3±0.0** vs CPU pure (-dev none) 13.8/10.3 → **grid G1: 7xx behaves 750-class (GPU-prefill admissible), NOT 740 cool-mode** — with TWO bound caveats: CPU number is build-suspect (no -march flags in kit, repack paths likely absent → no crossover constant from this cell) and decode not gridded. **New defect class for the router: `sub_group_shuffle_xor` missing on the 732 driver → FA OpenCL kernels DON'T COMPILE (err=-11), FA-on must be probed per-GPU** (crash evidence preserved). Six ops lessons banked in REPORT (T4 adb background-launch pattern, bare-hex taskset, llama-cli-is-not-a-probe, bracketed pkill, perl-alarm caps, llama-bench defaults -ngl 99). Evidence `scratchpad/agents/qdc-7pg3-govbench-52/` (PLAN #52) |
| 37 | **Il gate device S23-class dei pick OpenCL è CHIUSO senza S23: A/B pulito su HDK8550/Adreno 740 — zero regressioni, perf piatta → TAKE come igiene, nessun claim di velocità (qdc-8g2-oclpicks-53, 3/09, job 797850, 24 min, prep audit mimo M1-fixed + report audit mimo APPLY 3-refuted-fixed, cell #53)** | HDK8550 (SM8550/kalama, la classe dell'S23) con DUE build sha-verificate on-device: base `a0cabca6b` vs picks `12f6d9b6d` (=base + q4_K/q5_K uint-mv A7x + fix OOB image kernels + fix WAR race FA). **Q1: base ≡ picks su tutte e tre le famiglie — MUL_MAT 925/925, MUL_MAT_ID 407/407, FLASH_ATTN_EXT 229/229 (subset supportato)** — e **l'FA COMPILA e passa sul 740**: il crash `sub_group_shuffle_xor` del 732 (#52) è tier-specific → probe di capability FA per-GPU nel router, confermato da due tier. **Q2 (LFM2.5-2.6B Q4_K_M, ABBA integro, gate termico per braccio, 8 retry/0 abort)**: base pp 84.09/tg 16.04 vs picks pp 84.64/tg 16.02 → **Δ +0.65%/−0.12%, dentro ±3%** → ramo igiene di G1: i 3 pick si tengono per correttezza, il claim di perf dell'ottimizzazione A7x NON esiste su questo workload (da riverificare gratis su 8650/8635 se serve). Il branch `kalsa/opencl-picks-2026-09` è device-validated; decisione di merge all'owner. Coda HDK: 28 min di starvation prima del Setup (trappola nuova: i click JS sul portale vengono ingoiati senza errore — lezione 7 di #52). Evidence `scratchpad/agents/qdc-8g2-oclpicks-53/` (PLAN #53) |
| 38 | **Il difetto f16/bf16-batched del 750 è replicato su hardware di riferimento QDC — e la GPU 750 vola sul ship config: pp512 284 t/s (qdc-8g3-govbench-55, 3/09, job 797935, 12 min — nuova cella più economica, report audit mimo APPLY 2-refuted-fixed, cell #55)** | QRD8650 (SM8650/pineapple, Adreno 750): **MUL_MAT 905/925 — 20 FAIL, TUTTI la stessa famiglia `f16|bf16 × f32, m=128 n=1 k=1056 k_v=2112` batched** = la firma dei "20 fail f16 batched dal compiler nuovo" della campagna #16 sul 750 fisico → è lo stack driver/compiler 750, non il telefono, e c'è ancora su Android 14 QRD. **MUL_MAT_ID 407/407** — la superficie MoE è pulita su tutti e tre i tier misurati oggi. Ship 2.6B QAD-Q4_0: **GPU -fa 0 pp512 284.2±0.1 / tg128 23.4±0.0** (1.87× il 732, ~17× la CPU di questa build) vs CPU pure 16.3/11.6. ✅ Amendment post-hoc CHIUSO dalla riga 41 (#58, re-run sotto PREREG che anticipava lo split: stessi 20 FAIL byte-identici, pp512 291.1/tg128 23.0 entro ±10%) → i numeri 750 di questa riga SONO costanti del router. Mappa tier del giorno: 732 pp 151.8 (FA non compila), 740 (Q4_K_M, #53) pp 84.1 FA ok, 750 pp 284.2 (20-FAIL family) → **la probe di capability per-GPU del router deve coprire FA E la famiglia f16/bf16-batched**. Evidence `scratchpad/agents/qdc-8g3-govbench-55/` (PLAN #55) |
| 39 | **Quarto tier in un giorno: l'8s Gen 3/Adreno 735 è pulito e gemello del 732 — e scagiona la generazione: il difetto f16/bf16-batched è SOLO del 750 (qdc-8s3-govbench-56, 3/09, job 797956, ~13.5 min, report audit mimo APPLY 1-refuted-fixed, cell #56)** | QRD8635 (SM8635/pineapple, Adreno 735): **MUL_MAT 925/925 + MUL_MAT_ID 407/407, zero FAIL** con lo stesso kit binario di #55 → la famiglia 20-FAIL del 750 NON riproduce sul fratello di generazione: è lo stack driver/compiler del 750, la probe del router la tratta per-GPU, non per-generazione. Ship 2.6B QAD-Q4_0: **GPU pp512 154.8±1.3 / tg128 16.5±0.0** vs CPU pure 14.9/11.3 → G1 (griglia #52 first-contact, nessun problema post-hoc): 735 ≈ 732 (151.8±1.1; overlap a 2σ), una sola classe di performance mid-tier per il router. Zero retry termici, ~13.5 min. **Mappa GPU del giorno (ship Q4_0, -fa 0): 732 → 151.8 | 735 → 154.8 | 750 → 284.2** (740 in Q4_K_M da #53, non comparabile). Caveat CPU build-suspect invariato. Evidence `scratchpad/agents/qdc-8s3-govbench-56/` (PLAN #56) |
| 40 | **La lane CPU onesta ribalta il quadro del mattino: il decode è della CPU su TUTTI e tre i nuovi tier, e il vantaggio prefill della GPU si sgonfia a 1.6× sui mid-tier (qdc-cpu-tuned-57, 3/09, 3 sessioni ~20 min totali, report audit mimo APPLY 6-refuted-fixed, cell #57)** | Build CPU-tuned (`GGML_CPU_ARM_ARCH=armv8.7-a+dotprod+i8mm+fp16`, OpenCL NON compilato → lane pura per costruzione, kit `573f1440`): ship 2.6B, -t 4, taskset top-4. **7675: pp 95.2/tg 20.0 · 8635: pp 97.1/tg 20.5 · 8650: pp 99.0±12.8/tg 28.6** — la build zoppa del mattino sottostimava ×6.1-6.9 il prefill (G3 refutata ovunque, caveat saldato, vecchi numeri CPU RITIRATI). Griglia: **G2 decode = CPU VINCE su tutti e tre i tier (GPU a 0.80-0.86×)** — il pattern S23 dell'owner si ripete (scoped: 3 punti single-session, non replicati); G1 prefill: mid-tier CONTESTED (GPU solo 1.59× → decide la probe per-device), 750 confermato 2.87× (provvisorio, Amendment #55). Outlier dichiarato: tg 28.6 sull'8650 (+40% sui mid) plausibile ma non spiegato con n=1. Router: decode-on-CPU default coerente con TUTTO il misurato; la probe di primo avvio deve misurare anche il crossover prefill. Evidence `scratchpad/agents/qdc-cpu-tuned-57/` (PLAN #57) |
| 41 | **L'Amendment del 750 è chiuso per via pulita, senza sign-off: la cella ri-corsa sotto un PREREG che nominava in anticipo la famiglia dei 20 FAIL riproduce #55 al numero (qdc-8g3-rerun-58, 3/09 notte, job 798429, ~8.7 min, PREREG auditato pre-run F15 applicato, REPORT audit BANK 10/10).** | QRD8650: MUL_MAT 905/925 con i 20 FAIL `diff`-IDENTICI a #55 (f16/bf16×f32 m=128 k=1056 k_v=2112 — terza replica indipendente dopo #16 fisico e #55: proprietà stabile dello stack 750, la probe per-GPU del router la copre), MUL_MAT_ID 407/407, GPU pp512 **291.11±0.56** (+2.4% vs 284.18) / tg128 **23.02±0.04** (−1.7% vs 23.42) → G3 dentro ±10% lontano dai bordi: i numeri 750 di #55 CONFERMATI come costanti router (pp 284-291, tg 23.0-23.4); G4 291/98.97 = 2.94× prefill GPU. Zero retry di gate, ordine bracci census→GPU dichiarato (F15) e ininfluente. Evidence `scratchpad/agents/qdc-8g3-rerun-58/` (PLAN #58) |
| 42 | **La morte NPU v73 dell'S23 REPLICA su hardware di riferimento: `dspqueue_read failed: 0x2e` dopo 48 dispatch esperti, proof 484/48/48 identica al q48, con HOSTBUF unset E =1 (qdc-8g2-npu-v73death-59, 3/09 notte, HDK8550 job 798484, 27.8 min di cui ~7 di lavoro, PREREG+driver doppio-auditati, REPORT audit BANK-WITH-FIXES applicati).** | G1 REPLICATED: A1 (S23 original) e A2 (q48 mirror) exit 134 con firma identica, tombstone presi; A3-A5 gated off. Build PIÙ NUOVO (npu-judge-v79 incl. #25968), board diversa, Android 16, modello allenai Q4_0 (census 113/81/1), load `--mmap 0` — e muore uguale → la morte è dello **stack HTP v73** (host flush path + skel + firmware, NON separati da questa cella: 'stack-bound', non 'arch-bound'), esclusi S23-unit, termica, HOSTBUF, binario 3f545bec; NON esclusa una componente firmware condivisa dai v73. **F6 (experts-on-NPU = v75-only) CONFERMATA su reference hw**; dossier #8 ha un repro QDC pubblico (board di riferimento + modello HF + build aperto). Primo lancio VOID (`--load-mode` inesistente nel lignaggio → `--mmap 0`, emendamento pre-dato). Lezione portale: End Session passato solo al 2° ref-click (~20 min idle). Evidence `scratchpad/agents/qdc-8g2-npu-v73death-59/` (PLAN #59) |
| 43 | **La morte v73 ha un nome: fallimento di allocazione VA sul DSP in `mmap_buf()` (htp/main.c:729), e l'offload PARZIALE degli esperti VIVE su v73 — prefill E decode (qdc-8g2-npu-mmapbudget-60, 4/09, HDK8550 job 798892, 8.5 min, PREREG+driver auditati, REPORT audit BANK-WITH-FIXES applicati da due auditor).** | Step 0 a costo zero: disassembly del medesimo skel (hexagon-llvm-objdump nel container Docker) → `htp_iface_start+0x1348` = ritorno dalla `call abort` con `r2=#729` e stringa "mmap failed : va %p" → lo 0x2e host è il SINTOMO del PD morto. Sei arm con `llama-bench.farf`=0x1F (FUNZIONA: FARF in logcat `adsprpc`): `-ngl 8` VIVE (proof 189), `-ngl 12` VIVE (297, 2.48 GiB vivi sul DSP), `-ngl 8 tg128` VIVE (2688 dispatch = PRIMO decode NPU v73 mai registrato); `-ngl 99` MUORE con MBUF=512 e con VMEM=1800 (entrambi :729, proof 48): catena `qurt_vtlb_mmap: unable to get virtual address` → `Error 0x80000483 fastrpc_mmap failed` → `HAP_mmap2 failed for fd 27 length 698355712` → abort; VMEM=0 misura 3.00 GiB ma è distruttiva (i fastrpc_mmap successivi falliscono). Al fallimento B2 aveva ~501 MiB vivi e B5 ~1033 MiB (ricostruzione create/destroy con timestamp, confermata da deepseek): non è solo budget totale, è allocazione VA dopo churn map/unmap (frammentazione / allineamento TLB / VA non reclamata: non discriminati). Grid G1b; H2 (limite per-mappatura) REFUTATA. **F6 RIFORMULATA: su v73 experts-on-NPU è viabile con pesi residenti ≤ ~2.5 GiB verificati e senza churn; a 3.6 GiB muore in QUESTO build a prescindere da MBUF/VMEM.** Upstream #26501 (27/08) e #28202 (2/09, batch ordinati per taglia contro la frammentazione) NON nel kit → #61-NPU = stesso driver su kit con i due PR. Issue upstream #26123 (aperta, 8 Gen 2, 0x2e su 7B/4B) = stessa classe; Qualcomm fastrpc #137 (VA cDSP 2 GB vecchi/3 GB 8gen3) — il 2 GB è refutato su HDK da B3/B6. Portale: End Session al primo ref-click (Ended On 06:11:27). Evidence `scratchpad/agents/qdc-8g2-npu-mmapbudget-60/` (DISASM, PREREG+amendment, REPORT, 2 audit, UPSTREAM-SEARCH) |
| 44 | **LA APP FUSA GIRA SU HARDWARE REALE: APK-A (main c513f00, pin a0cabca6b) e APK-B (pin 12f6d9b6d + 3 pick OpenCL) installano, caricano il ship LFM2.5-2.6B QAD-Q4_0 sideloadato e rispondono a un prompt su QRD8650 / Adreno 750 — G1-AMENDED (qdc-apk-smoke-61, 4/09, job 798961 31 min + job 798935 23 min a vuoto, PREREG + 2 emendamenti pre-dato auditati, REPORT audit BANK-WITH-FIXES applicati; l'owner deve ratificare l'emendamento del criterio).** | Smoke headless via adb (SSH only): install → sideload ROOT (gli APK release di CI NON sono debuggabili: `run-as: package not debuggable`; la board è userdebug con adbd root) → DB AsyncStorage via sqlite3 host → launch → prompt via uiautomator/input text (IME sospesa) → `KALSA_TELEMETRY`: A 129 token predetti a **26.4 tok/s**, B 196 a **26.0 tok/s** (decode CPU: `offloaded 0/31 layers to GPU` — l'app non manda layer alla GPU, ora visto su hardware; piattaforma OpenCL Adreno 750 e skel HTP v73-v81 comunque inizializzati). Screenshot headless raw/A_sa803030.png: header "LFM2.5 2.6B · QAD-Q4_0 · Ready · local" + risposta coerente. Nessuna regressione A→B a questa profondità; nessun A/B di velocità. Emendamento: i segnali del PREREG `KALSA_SESSION op:load` (= restore KV, `no_file` al 1° avvio) e banner `kalsa-native-patches` in logcat (mai emesso da llama.rn) erano errori della recon → pass su `llama_model_loader … 266 tensors`, `KALSA_PREWARM done` (1319 token in 9.4 s) e generazione; variante .so non leggibile da /proc/maps (SoLoader mappa da base.apk). Artefatto app: `promptMs` ≈ 411 s con 15 token nuovi (timer non del turno) — bug candidato. Lezioni QDC: il device parte in Dozing con keyguard → wake + dismiss-keyguard + stayon prima del primo launch; "Screen Always On" da spuntare nel wizard; End Session al primo ref-click in entrambe le sessioni. Evidence `scratchpad/agents/qdc-apk-smoke-61/` (PREREG, RECON-APP, driver, 3 audit, REPORT, raw con screenshot/logcat/DB) |
| 45 | **Il kit PURO UPSTREAM (master 64a155d24, con #26501+#28202) MUORE su v73 a QUALSIASI taglia — `-ngl 8` e `-ngl 99`, MBUF=512, VMEM=1800 — con TLBMISS RW in `op_binary+0x50E4` (`binary_job_vector_same_shape`, `Bad VA 0x0`, `Error code 0x7003`): è la SIGNATURE 1 dell'S23 (q50) riprodotta su board di riferimento con upstream master; il nostro kit NON la mostra (qdc-8g2-npu-upstream-62, 4/09, HDK8550 job 798985, 7.9 min, PREREG+2 lock addenda auditati, REPORT audit BANK-WITH-FIXES applicati; FIX-2 refutato dai raw).** | Per il PREREG: U1 (`-ngl 8`, il sopravvissuto di #60) muore → METHOD-VOID sulla domanda "#26501/#28202 fixano la morte di mapping?" + H4 nuovo finding. ZERO righe FARF di mmap/defrag in tutti gli arm: il DSP muore in compute (loop vadd f32 di `op_binary`, `vmem(r9++)` con puntatore NULL) durante il primo grafo (proof 33/32/34/14 contro 48/24). Ultime op in coda: `ADD|node_928 x ffn_moe_weighted-15 (view)` (stride 65536) e `ADD|ffn_moe_out-15 x ffn_inp-15`; coda asincrona → la op colpevole non è provata. Cherry-pick di #26501/#28202 sul nostro branch IMPOSSIBILE (23/7 file in conflitto: CHERRYPICK.md); kit upstream costruito con la ricetta kit-v6 (preset android-34) → `npu-kit-62-upstream.tgz` sha 1baee516…, branch `kalsa/upstream-snapshot-2026-09-04` sul fork. Objdump dello skel upstream: `mmap_buf` ha un percorso di defragmentazione (abort solo se fallisce anche il remap) — MAI raggiunto qui. Conseguenze: dossier #8 guadagna il fatto upstream-facing più forte (upstream master + HDK8550 pubblica + OLMoE Q4_0 pubblico → crash a ogni -ngl, zero codice kalsa); la domanda del mapping fix richiede un bisect 022458a28..64a155d24 o un kit ibrido; F6 (riga 43) intatta. Evidence `scratchpad/agents/qdc-8g2-npu-upstream-62/` (PREREG, MODEL_SHA, DISASM-upstream, driver, audit, REPORT, raw con crash_pc_resolution) |
| 46 | **L'APK DEBUGGABLE (release + `android:debuggable`, input `debuggable=true` di apk.yml) È IL BENCH INSTRUMENT PER IL CAMPO: A (main c513f00, pin a0cabca6b, sha c645f691…) e B (09bdfe9, pin 12f6d9b6d, sha 1b8e2793…) installano, provano il flag `DEBUGGABLE` in `dumpsys package`, ricevono il modello sideloadato e la modifica di RKStorage INTERAMENTE via `run-as` (nessun comando root in /data/data), caricano (`llama_model_loader` + `KALSA_PREWARM done`) e rispondono su QRD8650 — G1 (qdc-apk-smoke-63, 4/09, sessione 799128, 45 min, 5 tentativi: i primi 4 mangiati da TRE condizioni della board, non dell'app: `/data` a 0777 che un demone QDC ripristina da solo → `run-as: /data readable or writable by others` (holder `chmod 771 /data` ogni 2 s), keyguard che torna perché la board non è USB-powered e `svc power stayon` è un no-op → `locksettings set-disabled true`; REPORT audit BANK-WITH-FIXES applicati). Telemetria tentativo 5: A 90 token a 23.6 tok/s, B 65 a 23.8 tok/s (tokensEvaluated 1329; promptMs = artefatto timer); GPU `offloaded 0/31`. La variante NON è un'implementazione nuova: esisteva già in apk.yml (verifica `aapt2 dump badging` → `application-debuggable`), gli APK di #61 erano il default `false`. Sul campo: `run-as` funziona su telefoni user con `/data` 0771 di serie; la board root/userdebug prova il PERCORSO, non l'assenza di root.** | scratchpad/agents/qdc-apk-smoke-63/REPORT.md |
| 47 | **LA TLBMISS v73 DI UPSTREAM HA UN COLPEVOLE: `0a50d9909` = upstream #26049 "hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA)" (17 file, +1662/−757, tutto in `ggml/src/ggml-hexagon/htp/`)** — bisect binario sui 23 commit hexagon fra il nostro pin 022458a28 e master 64a155d24, kit v73-only per commit, OLMoE Q4_0 su HDK8550, probe `-ngl 8`: GOOD {pin, idx6 0278d83, idx7 c0bc859} con exit 0 e n_exps_htp0=189, BAD {idx8 0a50d99, idx9 355303e, idx12 990e3bf} con `crashed in thread "work-queue:N" due to TLBMISS RW` in `op_binary` dopo 21 op; tabella monotona, e 0a50d9909 è figlio DIRETTO di c0bc859 (rev-list = 1): nessun confound intermedio. A `-ngl 99` la morte di mapping (`dspqueue_read 0x2e`, main.c:729) c'è su OGNI commit GOOD del range, pin incluso → #26501/#28202 (fuori range) restano da provare con #26049 revertato o patchato: il fix è un task del fork (owner 4/09: mai issue upstream). Metodo: 6 run in 4 sessioni (~46 min pool 8 Gen 2), un run VOID onesto (kit ereditato dal resume del driver → driver corretto: kit sempre ri-pushato, sha nel log), tre fallimenti di build documentati (script editato in esecuzione; `cmake --install` esige tutte le skel e i test → kit assemblato dal build tree). Audit REPORT: deepseek BANK-WITH-FIXES (citazioni), fix applicati. (qdc-npu-bisect-64, 4/09) | scratchpad/agents/qdc-npu-bisect-64/REPORT.md |
| 48 | **PRIMI TURNI END-TO-END DEL GOVERNOR NELL'APP SU UN DEVICE (S5, qdc-governor-s5, QRD8650/Adreno 750, 5-6/09): prefill GPU + commit KV 9.2 MB/~10 ms + decode CPU su 4/4 turni B, stato FAST, prewarm GPU 5.16 s vs CPU 9.3-9.9 s (1024 token, confronto NON endpoint) — MA L'IPOTESI È REFUTATA SU QUESTO APK (G1-REFUTED, mechanism PROVEN):** oracolo greedy FAIL al token 14 (A=20 "," → "a simple, general"; B=5439 → "a simple request"), deterministico su 4+4 turni e su 3 APK per A (sha 0f4b385a…) → ipotesi principale numerica f16 Adreno vs CPU nel KV di prefill (alternative: fedeltà commit, bordi chunk 512+512+128+128+49, routing); decode B 22.1/22.1/4.26/21.9 vs A 24.1-24.5 tok/s — endpoint 2 NON ANALIZZABILE per la regola bloccata (zero coppie PASS), descrittivo B<A; B3 4.26 tok/s con lmkd "critical" (1 kill di sistema, 76 righe) e MemAvailable 8.7→4.4 GB a due contesti (A: →6.4); TTFT B NON misurabile (`promptMs 0`: JSI leggeva `llama_perf_context(active_ctx())` = contesto decode → fix fork 6ed44f567/app 64931c1, audit GO); dimensione termica NON interpretabile (driver leggeva la skin cached 31.4, la HAL viva 29.3→40.0 °C; fixato per il run 4). Tre run: 1 (sa803287) VOID `shouldUseMTP()` lanciava in governor mode; 2 (sa803304) VOID il runtime rigiocava il batch intero dopo i chunk ammessi (`-2`, 0 token); 3 (sa803354) 8/8. Cinque delta audit grok + audit REPORT deepseek (BANK-WITH-FIXES, tutti i numeri riprodotti). PREREG LOCKED + 4 emendamenti pre/post-dati, REPORT 145 righe. APK ac4820d sha 1a1356ac…; fork e1a0f5028; 3 sessioni ≈ 60 min QDC (8 Gen 3 ≈ 800 min residui) | **BANCATA 6/09**: governor funziona, correttezza e velocità NO su questo APK; **run 4 descrittivo FATTO (6/09, APK e8c2b1f, board 72c4dabb, 3 turni + abort a B2): il GATE TERMICO DELLA POLICY SI È VISTO DAL VIVO — a skin HAL 38.14 °C (+0.92 °C/min, soglia 38.0) `admit_prefill … waiting for a safe tabled chunk` → nessun prefill GPU, ma il turno si è bloccato (prewarm eval-failed, niente telemetria) → il Wait deve degradare a prefill CPU (fix in corso); TTFT B misurabile: 454 ms = prefill_ms, chunks "2+13" (solo ~15 token nuovi, sistema in cache) vs A 335/324 ms; decode B 20.7 vs A 24.4/23.5; oracolo FAIL con gli STESSI hash su board diversa; il 44 s del run 3 vs 335 ms del run 4 in A non è determinabile dai log (stesso riuso KV). **run 5 (6/09, APK 0265333 con fork a6642b73d/39c35bd1e, board 45207755): LA DEGRADAZIONE TERMICA FUNZIONA END-TO-END — a skin 38.5 °C (WARM) la policy dice Wait, il runtime instrada l'intero turno su CPU e lo COMPLETA (`engine_prefill CPU`, `cpu:2+13`, 337.6 ms, decode 22.1, commit 0; prewarm CPU 10.3 s vs GPU 5.6 s) — e quel turno PASSA l'oracolo (ids = A), mentre B1/B2 con prefill GPU falliscono come sempre → la divergenza al token 14 vive nel prefill GPU (routing esonerato direttamente; commit e disegno a due contesti solo indirettamente); ipotesi ristretta e ancorata: difetto f16/bf16×f32 batched del SOLO Adreno 750 (righe #38/#39). **run 6 (6/09, 8 ELITE / QRD8750 / Adreno 830 / V79, stesso APK 0265333, sessione 799540): ORACOLO PASS 4/4 — B1-B3 con prefill GPU (`2+13`, commit 9.2 MB) token-identici ad A, B4 degradato a CPU a 38.1 °C WARM e PASS** → la divergenza è confinata (in questa base di evidenza: 3 board 750 vs 1 board 830) all'Adreno 750; sul 750 la policy resta CPU-prefill via gate di correttezza per generazione (app f98a9fa, `gpu-prefill-incorrect-V75`, override `kalsa.bench.governor_force`). Endpoint 2 con 4 coppie PASS: decode mediane 2-4 A 28.53 vs B 28.33 tok/s (B/A 0.993: parità, formalmente FAIL sul ≥); TTFT del turno B 359 ms vs A 41.2 s — MA il promptMs di A è timer inquinato (A riusa il prefisso come B; `llama_perf_context_reset` non azzera lo stato asincrono → include l'attesa prewarm→Send: gap 44.5 s = 44.9 s riportati; docs/ARM-A-PREFIX-REUSE-2026-09-06.md) → fix nel fork in corso; unica cifra GPU vs CPU valida: prewarm 1024 token 4.06-4.30 s vs 6.6-6.8 s (1.65×, vs ~10× del #38 su 512 senza cache: da spiegare). RAM 8 Elite: 12.3 → 8.0 GB a due contesti, 0 lmkd. Sei sessioni QDC in tutto (~2 h). **run 7 (6/09, 8 Elite, APK 8a56edc con fork e31b9144c): timer corretto sul device — A `promptMs` 205/488 ms (era 41-45 s), B GPU 358/359 ms sui ~15 token nuovi: PARITÀ sul tail in cache (rapporti per coppia 1.74 e 0.74, n=2); prewarm 1024 token GPU 4.06-4.32 s vs CPU 6.60-6.82 s (1.6×); oracolo PASS 2/2; abort ad A3 per flake UI (Send) → driver con retry UI (parse.sh) e gate B solo in FAST. Sette sessioni QDC (≈ 2 h 20). Prossimo: cella S5b = prefill GRANDE senza prewarm (riconciliare 1.6× con il ~10× del #38); esperimento kernel test-backend-ops sul 750; headroom RAM |
| 49 | **S5b (qdc-governor-s5b, 8 Elite/QRD8750, 5/09): PREFILL GPU vs CPU SU 925 TOKEN NON IN CACHE, NELL'APP — una sola coppia valida: GPU 3200.7 ms vs CPU 5945.2 ms → B/A 0.538 (1.86×), nella banda pre-registrata del prior prewarm 1.4-1.9×, NON il ≥3× del fork; secondo punto GPU 3228.3 ms senza partner; decode alla pari (26.3-26.6 vs 26.6 tok/s); commit KV 12.1 MB/8.4-13.5 ms; endpoint pre-registrato NON MET (0 coppie oracle-PASS) → descrittivo.** Oracolo B1: UN token su 32 diverso (idx 29, 640 vs 1194) con rientro, n=1023 entrambi — ipotesi quasi-pareggio di logit, non il pattern 750. Termico: turni GPU finiscono a 44.6-45.3 °C vs CPU 41.4; dopo GPU la skin in 600 s si ferma a 36.3-37.7 → 4 VOID(hot) col target 36.0; B2 persa per logcat troncato (10 `logcat -d` rc=255). Quattro run per arrivarci: input text a blocchi (run 1), tool OFF (run 2), cooldown (run 3), dump atomico + target 37.0/720 s (run 5). REPORT auditato BANK (deepseek), delta #6 GO. Raw sa805734. **Run 5b (raw sa806366b): tre GPU 3324-3326 ms identici (ids_sha 17b3765f…), n GPU=5; ZERO A valide: dopo GPU la skin si ferma a 37,1-37,3 in 720 s (A2/A3 VOID hot). Run 5a abortita dall'orchestratore (criterio size≥ sbagliato su ring buffer). Addendum REPORT + delta #8 GO (deepseek).** **Run 6 (raw sa806967, exit 0): target cooldown per braccio (A 38,5 / B 37,0, cap 900) → 3 A valide (5855/6183/6155 ms) + 2 B GPU (3323,5/3321,3), DUE coppie stesso-turno A1/B1 0,568 e A3/B3 0,540 → mediana 0,554 = 1,81× SOLO in lettura PASS-1 esplorativa (oracolo stretto: FAIL per 1 token su 32, idx 29 640→1194, identico in run 4/5b/6 ⇒ endpoint NOT MET per costruzione su questa board). Equità misurata: A2/A3 partite a 38,4/37,4 sono il 5,6/5,1 % più lente di A1 (bias CONTRO la CPU). "B target sempre raggiungibile" falsificato (B2 VOID hot a 900 s dopo A2 finita a 47,9). Cross-run GPU n=7 (3200-3326), CPU n=4 (5855-6183). REPORT auditato BANK descrittivo (deepseek); deviazione mia (coppia B1/A2 nel brief) corretta in audit. PASS-1 pre-registrato per runs 7+ (PREREG:137).** | banked (descrittivo); QRD7675 → riga 50; QRD8650 run 8 pre-registrata |
| 50 | **S5b run 7 (qdc-governor-s5b, QRD7675 / SM7675 / Adreno 732, 5/09): IL GOVERNOR v0.3 È INERTE SUL 7+ GEN 3 PER ALLOWLIST, NON PER MISURA — arm B cade in `KALSA_GOVERNOR_FALLBACK stage=correctness reason=gpu-prefill-incorrect-Unknown` e gira su CPU (0/31 layer su GPU): B ≡ A per design, la A/B in-app pre-registrata (banda parità 1.01–1.05) NON è testata da questa run.** Numeri CPU dell'app spedita sul 732, prompt 938 token non in cache: A2 TTFT 12575.8 ms / 925 token nuovi / decode 16.56 tok/s (valida, ids_sha 647f906d); B1 (CPU dopo fallback) 12082.1 ms / 16.77 tok/s → B1/A2 0.96 "CPU vs CPU". Termico: 33→35 (A1), 35→44.5 (B1), 38.4→46.7 °C (A2). Causa: `GPU_PREFILL_CORRECT={V79:true,V75:false,V73:false,Unknown:false}` + `generationFor()` senza SM7675/SM8635 (app `src/engine/governorInputs.ts` @8a56edc); policy fork (`llama-governor-policy.cpp:160-168`) GPU solo V75/V79 con Fit+measured, cool-mode V73 solo MoE, CPU altrimenti ⇒ **su QRD7675, QRD8635 e HDK8550 (dense) non esiste una B in-app; solo QRD8650 (V75) è misurabile con `kalsa.bench.governor_force=1`**. Coerenza dati: prior mid-tier 1.6× (riga 40, cella 57) × sconto in-app 0.60 = parità → la scelta CPU della policy sul 732 è giustificata; il gap è di copertura della tabella device, non di esito. Costo: run 7a–7d senza dati per 7 trappole harness Android 14 (PREREG §7a→7e) + trappola 8 in 7e (`dumpsys power` rc=255 con output buono, 3/76, uccide A1). Oracolo: coppia A1/B1 non valutabile (lato A mancante). n=1 riga A valida. Audit REPORT deepseek #14 BANK. Fonti: PREREG §"Run 7e — post hoc"/§"Run 7e → run 8", REPORT §Run 7, raw/sa807902/. | banked (null descrittivo + numeri CPU); QRD8635/HDK8550 PARCHEGGIATI per l'owner (nessuna B possibile senza estendere la policy); run 8 QRD8650 → riga 51 |
| 51 | **S5b run 8 (qdc-governor-s5b, QRD8650 / SM8650 / Adreno 750, 5/09): CON IL GOVERNOR FORZATO (`kalsa.bench.governor_force=1`, solo arm B) IL PREFILL GPU IN-APP SUL 750 È 1,98× LA CPU — A1 CPU TTFT 8504.8 ms vs B1 GPU 4294.9 ms su 925 token non in cache, B/A 0.505, una sola coppia stesso-turno; MA L'ORACOLO GREEDY STRICT FALLISCE dall'indice 7 (B salta il token 14991, 24/32 diversi) → endpoint NOT MET per il difetto f16/bf16-batched del 750, come pre-registrato → DESCRITTIVO.** B1: `KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":12114944,"commit_ms":13.387,"prefill_chunks":"2+128×7+27","prefill_ctx_ngl":99,"forced":true,"thermal_state":"FAST"}`, nessun FALLBACK; decode 18.9 (B) vs 21.2 (A) tok/s; skin B1 37.0→47.4 °C, A1 30.5→43.2. Banda pre-registrata 0.55–0.58 (ALIVE 41 × sconto in-app): osservato 0.505, cioè GPU leggermente meglio del prior. L'indice di divergenza (7) differisce dal token 14 delle run 3-5 del fork: stesso difetto, punto diverso. Costi: A2 VOID composer per la **trappola 9** (su board calda `input text` perde caratteri anche a 200/blocco; a 100 è esatto ma il cap 400 s/tentativo scatta a 4400/5142), B2 VOID hot (900 s, 38.5 > 37.0 dopo A2), A3 persa alla deadline 85 min; rc=255 su dumpsys 1/run, `power_capture` (fix trappola 8) lo ha assorbito. Board 11.5 GB (gate RAM passato). Audit REPORT deepseek #16 BANK (0 finding). **Per l'owner**: il 750 resta in allowlist OFF nell'app (correttezza), quindi in produzione il governor vi instrada CPU pur avendo 2× di prefill disponibile — decidere se il difetto kernel va cacciato o se il 750 resta CPU. Fonti: PREREG §"Run 7e → run 8", REPORT §Run 8, raw/sa808770/. | banked (descrittivo, n=1 coppia, oracolo FAIL); 732 forzato → riga 52; test kit 750 in corso |
| 52 | **S5b run 9 (qdc-governor-s5b, QRD7675 / SM7675 / Adreno 732, 6/09, governor FORZATO sulla B via `bench_force_gpu_prefill`): IL PREFILL GPU IN-APP SUL 7+ GEN 3 È 1,63× LA CPU — coppie stesso-turno 0,631 e 0,595, mediana 0,613 (GPU 7,42 s vs CPU 11,77-12,48 s su 925 token), FUORI dalla banda di parità pre-registrata (0,95-1,05) e SOTTO la soglia 0,85 che per PREREG riapre la policy V73 mid-tier; MA l'oracolo greedy strict FALLISCE ×2 con ids GPU byte-identici a quelli del 750 → endpoint NOT MET, DESCRITTIVO.** Cinque righe valide su cinque (prima run senza VOID: ladder 200 al primo tentativo 361-381 s, trappola 8 assorbita 5/5 da `power_capture`). B: `KALSA_GOVERNOR {"engine_prefill":"GPU","forced":true,"thermal_state":"FAST","commit_bytes":12114944,"commit_ms":15.8/13.4,"prefill_ctx_ngl":99}`, nessun FALLBACK; decode B −11,9%/−9,8% vs A (al bordo del ±10%); skin B 37→45-47 °C, cooldown B2 810 s. Prior sbagliato: assumeva lo sconto in-app 0,6 sul 1,6× CLI (riga 40); in-app il 732 tiene il 1,6× intero. **Reperto trasversale**: ids GPU identici su 732 e 750 (d4556574…), CPU identica su 732/750/8 Elite (647f906d…), 8 Elite GPU diversa per 1 token → la divergenza in-app dall'indice 7 è una proprietà dei kernel A7X, NON del difetto 20-FAIL del 750 (che il 732 passa 925/925): ipotesi precisione f16/quasi-parità (H2) vs bug A7X in path n>1 (H3), separabili solo con un oracolo a margine di logit o con la run 8b sul kit candidato (Amendment 3 cella 750). Regola di aggiornamento policy (PREREG §Runs 9-11): condizione velocità SODDISFATTA (mediana ≤0,85, n=2), condizione oracolo NO → `GPU_PREFILL_CORRECT.V73` resta false. Audit REPORT deepseek #22 BANK (0 finding). Build: fork 9c28322ac (leva force), app 79c04a9 + pin 7e3d6d6 (SM7675/SM8635→V73), APK CI 34017852150. Fonti: PREREG §"Runs 9–11" + post hoc run 9, REPORT §Run 9, raw/sa811420/. | banked (descrittivo, n=2 coppie, oracolo FAIL); run 10 QRD8635 e 11 HDK8550 da fare; oracolo a logit da progettare |
| 53 | **IL DIFETTO ADRENO 750 f16/bf16 BATCHED MUL_MAT È CHIUSO A LIVELLO KERNEL DA UN GATE (qdc-750-mulmat-view, 6/09, QDC 807841 ~14 min): baseline 12f6d9b6d riproduce ESATTAMENTE i 20 FAIL (905/20; famiglia k_v=2112/m=128/n=1 28/20), candidato = pick 178a6c449 + gate `ADRENO && !ggml_is_contiguous(src0)` → kernel f16 generico dà 925/0 (famiglia 48/0), MUL_MAT_ID 407/407 e FLASH_ATTN_EXT invariati, bench pp512 289,6 (+0,2%) / tg128 22,2 (−2,2%).** Due kit dallo stesso script (Docker arm64-android v0.7, preset snapdragon-release, Hexagon OFF), SHA256SUMS verificati su device, compilatore E031.45.02.06. Diagnosi: i 20 FAIL sono tutti `MUL_MAT f16/bf16×f32, m=128, n=1, batch b≠[1,1], vista k_v=2112 con k=1056`, 14/20 con broadcast nr=4 (= KQV con V-cache in vista e GQA); il dispatch sceglie `kernel_mul_mat_f16_f32_l4_y8`, che è già stride-aware: **la causa radice sul 750 resta inspiegata** (ipotesi miscompile sub-group/cl_qcom con righe stridate; l'ipotesi "versione compilatore" è stata refutata dall'audit: il 732 passa anche con .02.06). Il fix è un workaround (gate), non un fix del kernel; l'effetto del cherry-pick non è isolato (una variabile = pick+gate). Upstream: nessun fix per questo sintomo (websearch 6/09). **NON stabilito**: (a) pp512 su 8 Elite col candidato (il gate rerouta le viste del V-cache su tutti gli Adreno); (b) run 8b in-app col candidato nel pin: gli ids GPU cambiano da d4556574? — dopo la riga 52 la divergenza in-app è una proprietà A7X decoupled da questo difetto, quindi la predizione pre-dichiarata è che il gate NON la tocchi. `GPU_PREFILL_CORRECT.V75` resta false. Branch fork `kalsa/opencl-picks-2026-09+25910` (c7ad97025 + 2f3b24dee) pushato. Audit deepseek #20 GO, #21 NO-GO→#21b GO, #23 BANK (2 minori applicati). Fonti: cella `scratchpad/agents/qdc-750-mulmat-view/` (PREREG + 3 amendment, ANALYSIS-f16-l4.md, REPORT, AUDIT, raw/sa811910/). | banked (kernel-level); 8 Elite pp512 e run 8b da fare prima di ogni decisione su pin/allowlist |
| 54 | **S5b run 10 (qdc-governor-s5b, QRD8635 / SM8635 / Adreno 735, 6/09, governor FORZATO sulla B): IL PREFILL GPU IN-APP SULL'8s GEN 3 È 1,72× LA CPU — coppie stesso-turno 0,592 e 0,570, mediana 0,581 (GPU 6,88-6,93 s vs CPU 11,62-12,16 s su 925 token), fuori dalla banda di parità e sotto la soglia 0,85; oracolo strict FAIL ×2 con ids GPU byte-identici a 732 e 750 → NOT MET, DESCRITTIVO.** Cinque righe valide su cinque (ladder 200 al primo tentativo 348-364 s; 8 rc=255 assorbiti da `power_capture`). B: `forced:true`, GPU/CPU, FAST, commit 12,1 MB / 12-13 ms, ngl 99, nessun FALLBACK; decode B −11,1% / −6,0% (media −8,7%); skin B 37→45-46,5 °C, cooldown B2 600 s, B3 tagliata dalla deadline dopo 480 s di cooldown. Quadro mid-tier V73 in-app col governor forzato: **732 0,613 (1,63×), 735 0,581 (1,72×)**, entrambi con lo stesso prior sbagliato (parità) e lo stesso oracolo FAIL — la proprietà A7X (ids GPU d4556574 identici su 732/735/750, CPU 647f906d identica su 4 board) è ora su tre GPU. Regola policy: velocità sì (mediana ≤0,85, n=2), oracolo no → `GPU_PREFILL_CORRECT.V73` resta false. Audit REPORT deepseek #24 NO-BANK→fix (B3 wording, banda decode) applicato. Fonti: REPORT §Run 10, raw/sa811930/. | banked (descrittivo, n=2 coppie, oracolo FAIL); run 11 HDK8550 da fare; oracolo a logit da progettare |
| 61 | **IL BRACCIO q4_K NON È MISURABILE IN-APP: sulla fascia high il governor NON SI ACCENDE MAI, e la causa non è il board né la termica ma DUE GATE STATICI DELL'APP** (cella `gemm-f32-ship`, QRD8635/SM8635/Adreno 735, sessione QDC 808791, job `sa812860b`, 8/09, 47 min di 75; APK `6fc14d1` = la stessa binaria di ALIVE 60, pin fork `67c73d26c` che porta il prodotto in f32 in ENTRAMBI i kernel q4_0 e q4_K; modello high `Qwen3.5-4B-Q4_K_M` sha 38742092… + testa vision `mmproj-F16.gguf` 672 423 616 B sha cd88edcf…, entrambe le sha registrate PRIMA della run). Due righe: **A (CPU) valida** — ttft 27 524 ms, 915 token, decode 8,227 t/s, skin 32,9 → 46,2 °C; **B VOID** — `prefill_ms=0`, decode 8,942, `oracle=VOID DESCRIPTIVE R4`. La B ha girato **sulla CPU**, e la telemetria del device lo dice da sola: `KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU","prefill_ctx_ngl":0,"forced":true,"fit":"NoFit","fallback_reason":"governor not eligible"}` — **`forced:true`: il lever di banco `kalsa.bench.governor_force` era applicato e NON BASTA.** Le due cause, indipendenti e ciascuna da sola fatale, lette nel sorgente dell'APK spedita e non dedotte: **(1)** `src/engine/governorInputs.ts:82-83`, prime righe eseguibili di `gpuFit()`, `const kv = model.kvBytesPerToken;` → `if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit"`, e la entry `qwen3.5-4b` in `ModelRegistry.ts:187` **omette apposta** quel campo (`// kvBytesPerToken intentionally omitted: no on-device measurement for the 4B`) ⇒ `gpu_fit` = NoFit **su qualunque device, sempre**, prima di ogni aritmetica di memoria; **(2)** `src/engine/LlamaService.ts:1387-1389`, il governor si aggancia solo se `governorBase.gpu_fit !== "NoFit" && !options.mmprojPath && !streamExperts` ⇒ **qualunque modello con testa vision disabilita il governor**. **Attribuzione controllata, non solo lettura di codice: ALIVE 54 ha misurato lo STESSO board col governor forzato e la GPU è partita** (`forced:true`, ngl 99, prefill 1,72× la CPU) — l'unica variabile cambiata è il modello. Board classificato correttamente (`ro.soc.model=SM8635` → `generationFor()` = V73, `governorInputs.ts:56`), termica innocente (skin 36,9 °C contro target 37,0, cooldown riuscito in 465 s), RAM innocente (`MemTotal` 11 530 632 kB, `MemAvailable` 8,99 GB a inizio turno). **Conseguenza prodotto: la fascia high — quella dove il prefill pesa di più — non riceve MAI il governor**, per un campo di catalogo mancante e un'esclusione in blocco dei multimodali, niente che c'entri col fatto che la GPU vincerebbe. **Conseguenza campagna: il kernel q4_K corretto non è mai stato eseguito e la sua fedeltà resta ignota.** Errore dell'orchestratore messo a verbale: la cella era stata registrata (Amendment 3) senza verificare che l'app potesse instradare quel modello sulla GPU — due grep sul Mac lo dicevano prima di aprire la sessione. Perse anche 4 min a un `set -u` sul driver (`local a=… b=$a`, stessa trappola di S5 run 1) fixato in `41352fb5` con scan statico + dry-run stubbato. Fonti: `scratchpad/agents/gemm-f32-ship/` (PLAN+PREREG Amendment 5) e `qdc-governor-s5b/raw/sa812860b/`. | **NOT MET, negativo ma solido**: nessuna misura di fedeltà q4_K; per misurarlo serve un veicolo con pesi q4_K + NESSUN mmproj + `kvBytesPerToken` non nullo — oggi nessuna entry del catalogo lo è. Via più economica: entry `listed: false` per `LFM2.5-2.6B-Q4_K_M.gguf` (già sul Mac, 1 674 455 040 B) con kvBytesPerToken misurato + APK da CI |
| 60 | **IL FIX ARRIVA NELL'APP E FUNZIONA SUL DEVICE: col prodotto in f32 il prefill GPU smette di dissentire dalla CPU, e il costo misurato al banco si trasferisce entro il 2 %** (cella `gemm-f32-ship`, QRD8650/Adreno 750, unità 36aa3b71, sessione QDC 808521, job `sa812590d`, 7/09; APK `6fc14d1` = commit app `8269aa2` + pin fork `67c73d26c`; modello ship LFM2.5-2.6B-QAD-Q4_0 sha a247afd6…; driver `qdc-governor-s5b` in `ORACLE_MODE=logit`, tool spenti, greedy, governor forzato sulla B). **Fedeltà, stesso board e stesso protocollo a 32 passi teacher-forced di ALIVE 55: mediana |Δp₁| 0,0861 → 0,0014 (61×), mediana max|Δlogp| 3,444 → 0,3037 (11×), passi oltre 0,02 21/32 → 8/32, e i flip del top-1 con la CPU sicura 8/32 → ZERO.** Verdetto grezzo `oracle=FAIL rule=R2 steps=32 max_dlogp=0,8627 max_dp1=0,0883 divergences=0`: il FAIL era **pre-registrato come atteso anche col fix giusto** (R2 chiede |Δp₁| ≤ 0,02 a OGNI passo e il same-top è 94,8 %, non 100), quindi la risposta sta nelle metriche continue, che sono collassate — il passo peggiore dopo il fix vale il passo tipico prima. **Velocità, stessa coppia, prefill da 925 token (`2+128×7+27`) con `engine_prefill=GPU` letto nei route facts: CPU 7,599 s vs GPU 6,119 s = 1,242×**, contro 1,78× pre-fix (ALIVE 55). Previsione pre-registrata 1,17× (intervallo 1,05-1,30): **dentro**. E il costo di banco predice il tempo in-app entro il 2 % (4,105/0,659 = 6,229 s attesi contro 6,119 misurati, −1,8 %): `llama-bench` e l'app misurano la stessa cosa. Decode invariato (21,27 A vs 22,18 B): non usa quel kernel. Termica dello stesso turno: GPU +4,5 °C contro CPU +10,1 °C di skin. **Copertura**: sul ramo prodotto il catalogo è di due LLM (`qwen3.5-4b` Q4_K_M per la fascia high, `lfm2.5-2.6b` Q4_0 per low/mid) e **entrambi i kernel di prefill sono ora corretti** (q4_0 misurato, q4_K no); restano in half otto `gemm_noshuffle_*` e dieci `gemm_moe_*_ns`, irraggiungibili da lì. **CORREZIONE 8/09 (l'ultima frase era SBAGLIATA, misurata e non dedotta):** l'etichetta `Q4_K_M` non descrive un solo tipo. Inventario dei tensori dei GGUF reali con `gguf-py`: `Qwen3.5-4B-Q4_K_M.gguf` = Q4_K 149, **Q6_K 35, Q5_K 24, Q8_0 1**, F32 232 (60 tensori quantizzati su 209 NON sono Q4_K); `LFM2.5-2.6B-QAD-Q4_0.gguf` = Q4_0 166, F32 99, **Q6_K 1**. E al pin spedito `67c73d26c` i `gemm_noshuffle_q5_k/q6_k/q8_0` sono **ancora in half** (`half8 c0`, verificato con `git show` sul commit pinnato, contro `float8 c0` su q4_0 e q4_k). Quindi tre degli otto kernel non corretti **sono raggiungibili dal catalogo**, e la copertura del prefill non è chiusa da questi due fix: la fascia high ne userebbe 60 tensori. Causa a monte: `llama-quant.cpp:535-536` e :593-596 promuovono `attn_v` e parte dei `ffn_down` a Q6_K sotto `LLAMA_FTYPE_MOSTLY_Q4_K_M`. Fix presente verificato nel BINARIO spedito, non nel repo: `strings` sulla `.so` dà 32 × `convert_float8(B) * (float)` e 8 `half8 c0` residui in `6fc14d1`, contro 0 e 10 in `8269aa2`. Tre run perse prima, tutte per parametri dell'harness e non per il device (deadline 40 min troppo corta; poi due cooldown falliti al tetto di 900 s, il secondo per 0,22 °C) → Amendment 2 registrato e pushato PRIMA della run: tetto di ATTESA 900 → 1500 s, target termico **invariato a 37,0** perché sopra ~38 °C il governor degrada il turno a prefill CPU e la B misurerebbe la CPU. Fonti: `scratchpad/agents/gemm-f32-ship/` (PLAN+PREREG+AUDIT+REPORT) e `qdc-governor-s5b/raw/sa812590d/`. | banked (descrittivo, n=1 coppia, 1 board, 1 unità). **PROMOSSO: l'owner ha deciso il 7/09 di accendere il prefill GPU su V75** — `GPU_PREFILL_CORRECT.V75` false → true, decisione sotto R6 e presa sull'effect size, NON sul verdetto binario che resta `FAIL rule=R2` per disegno; verbale in `scratchpad/agents/gemm-f32-ship/DECISION.md`. Accettato consapevolmente: n=1, q4_K (fascia high) non misurato (e ALIVE 61: in-app NON è misurabile su quel modello), 732/735/8 Elite non rifatti, V73 resta false |
| 59 | **ANCHE L'OPERANDO È REFUTATO: la precisione dei dati in memoria non spiega il residuo, e resta solo il PRODOTTO** (cella `adreno-operand-b`, QRD8650/Adreno 750, sessione 808395, 7/09, kit `0eebee77…` da `kalsallama-wt-accprobe` @eefa27e30, tre file diversi dal pinnato). Aggiunto un kernel di trasposizione f32 **affiancato** a quello condiviso (`kernel_transpose_32_16` NON toccato: lo lanciano dieci percorsi quantizzati) più `KALSA_GEMM_B=half\|float` che tiene le attivazioni in f32 fino dentro il GEMM (immagine `CL_FLOAT`, scratch raddoppiato, `read_imagef`). Quattro bracci, **tutti OK** (la sonda di provenienza per variante con `llama-bench -v` elimina i VOID di ALIVE 57): **`stock:half:half` 0,453822 / 62,823 % / +8,40** e **`stock:mul:half` 0,004736 / 94,826 % / +0,349** — i due controlli riproducono i valori bancati **alla sesta cifra col terzo kit**; **`stock:mul:float` 0,004641 / 94,319 % / +0,386** e `stock:deq:float` 0,004635 / 94,432 %. **Lettura 3 del PREREG: l'operando come è memorizzato NON è il residuo** — la mediana si muove del 2 % e il same-top **peggiora**. La catena di refutazioni per misura è ora completa su cinque assi: attenzione (ALIVE 56), flag del compilatore, accumulatore f16, dequantizzazione (ALIVE 57) e precisione dell'operando; **l'unica cosa che ha mai mosso la KLD è il prodotto, di 95,8×**. Il fattore ~5 residuo contro il GEMV batch-1 (0,000962) **non è una questione di bit**: restano due soli sospetti, entrambi strutturali e non misurati — la **geometria del tile** (`{1,128,1}` contro `{2,64,1}`, `qcom_reqd_sub_group_size("full")`) e l'**ordine di somma**. **Velocità con protocollo nuovo** (cooldown 180 s, ordine randomizzato seed 42, temperatura pelle pre/post): `mul:half` 190,25 ± 0,49 contro `half` 288,62 ± 1,07 = **0,659×** (0,656× contro il riferimento 289,98) — tre stime in condizioni termiche diverse concordi entro l'1 %, **ma la lettura di validità pre-registrata FALLISCE** (escursione delle temperature di inizio 5,71 °C contro i 2 ammessi) quindi il debito **non è formalmente chiuso** e la banda non è stata allargata a posteriori. Causa della bocciatura = **difetto del nostro harness**: il cooldown si applica fra i passi ma non prima del primo, che eredita il calore della fase KLD (40,971 °C contro 35-37). Nota controintuitiva: il braccio più caldo è stato il più veloce, quindi la deriva non spiega l'ordine. **`mul:float` costa e non rende**: 147,05 t/s = 0,509× dello stock (raddoppia la banda sulla gamba trasposta senza comprare fedeltà) → variante da scartare. Fonti: `scratchpad/agents/adreno-operand-b/` (PREREG+REPORT+AUDIT+raw), audit deepseek sul codice (rischio "header embeddato stantio" chiuso da una guardia automatica sui marker nella `.so`). | banked (n=1 board, 4 bracci); velocità da riprendere col cooldown anche prima del primo passo; geometria e ordine di somma da testare; 732/735/8 Elite mai misurati |
| 58 | **IL DECODE SULL'NPU È LENTO DI SUO: la KV sul DSP si mappa e il decode PEGGIORA, quindi cade il meccanismo su cui poggiava la tesi "NPU per la batteria in decode"** (cella `npu-decode-kv`, QRD8650/Hexagon v75, sessione 808386, 11 min di device, 7/09, modello **spedito** LFM2.5-2.6B-QAD-Q4_0 1,48 GiB, `tg128 @ d1920`). Tre bracci pre-registrati: **A CPU 17,68 ± 4,17**; **B NPU con `-nkvo`** (KV sull'host) **15,08 ± 0,55**; **C NPU con KV su HTP0 13,37 ± 0,25**. C/A = 0,756 (soglia "opzione viva" ≥ 1,0: no); C/B = 0,887, e la banda ±10 % pre-registrata **non scatta per 1,3 punti, dal lato lento** — non è stata allargata a posteriori. **Il meccanismo è l'opposto di quello ipotizzato**: con la KV sul DSP l'attenzione si sposta sull'NPU (`FLASH_ATTN` compare **3168 volte nel log di C e ZERO in quello di B**; `cache_k_l13\|512:2048\|f16\|2:1024\|HTP0\|yes` conferma la cache on-device), quindi `-nkvo` non era un handicap su questo grafo: teneva l'attenzione sulla CPU, dove va più veloce. **Soffitto di mapping MISURATO, non ipotizzato**: `ggml-hex: HTP0 measured max vmem 3489660928` = **3328 MiB = 3,25 GiB**, con un mapping da 256 MiB fallito (`HTP0 buffer mapping failed : domain_id 3 size 268435456`). Questo **refuta l'ipotesi 4 GB/32-bit dell'orchestratore** (era mia, era sbagliata) e sta 128 MiB sopra il default 3200 MiB del backend. Sul modello spedito 1,48 GiB + 32 MiB di KV stanno larghi, e infatti C ha mappato: **il vincolo che aveva costretto a `-nkvo` su OLMoE non si applica a ciò che spediamo**, ma non serve, perché la KV sul DSP peggiora. **Incoerenza aperta e non risolta**: ALIVE 13 riporta 3,6 GiB di esperti OLMoE mappati su HTP0, cioè 3686 MiB, sopra il soffitto misurato qui — o il soffitto varia per device/sessione, o quel 3,6 GiB è dimensione di file e non di mapping. Limiti dichiarati dall'esecutore: il braccio A è rumoroso (±4,17) e il gate termico era dichiarato ma non applicato dal driver (snapshot sì, skip no), quindi **C/B è il rapporto solido e C/A il più debole**. Conseguenza: il decode resta sulla CPU, e ora è misurato sul modello che spediamo invece che inferito da OLMoE. Fonti: `scratchpad/agents/npu-decode-kv/` (PREREG+REPORT+raw), numeri riverificati dall'orchestratore nei log grezzi. | banked (n=1 board, 3 bracci); C/A da rifare con gate termico applicato; incoerenza del soffitto contro ALIVE 13 da chiarire |
| 57 | **NON è l'accumulatore: l'infedeltà del prefill GPU Adreno viene dalla MOLTIPLICAZIONE in f16, e ripararla porta la KLD mediana da 0,4538 a 0,004736** (cella `adreno-acc-type`, QRD8650/Adreno 750, sessione 808196, 7/09, kit `6c0414ba…` da `kalsallama-wt-accprobe` @7ef9389bc = 2f3b24dee + due file, modello spedito Q4_0 sha a247afd6…, stesso strumento `llama-perplexity --kl-divergence`, `-c 256 -b 256 -fa off -s 42`, base CPU generata una volta e condivisa). Quattro assi del kernel `gemm_noshuffle_q4_0_f32.cl` resi selezionabili a runtime (`KALSA_GEMM_PREC=half\|acc\|mul\|deq` → `-DKALSA_GEMM_PREC=0..3`) più un quinto asse trovato dal recon e assente dalla cella precedente (i flag del compilatore: il GEMM riceve `-cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math` a `ggml-opencl.cpp:1575-1577`, il GEMV no, `:3678-3681`) → `KALSA_GEMM_MATH=stock\|strict`. Otto misure: **`stock:half` 0,453822 / 62,823 % / +8,40 (riproduce il controllo archiviato ALLA SESTA CIFRA, con un altro kit su un altro esemplare di board); `strict:half` IDENTICO alla sesta cifra → i flag matematici non c'entrano nulla; `stock:acc` (accumulatori `float8`, prodotto ancora in half) 0,460999 / 61,417 % / +10,09 → l'accumulatore f16 NON è la causa, e allargarlo peggiora; `stock:mul` (`convert_float8(B) * (float)w`) 0,004736 / 94,826 % / +0,349 → 95,8× di riduzione; `stock:deq` (anche la dequantizzazione in float) 0,004793 / 94,488 % → non aggiunge nulla.** Ogni variante `strict` è identica alla `stock` corrispondente alla sesta cifra. **Questo refuta l'analogia coi due precedenti trovati online**: su WebGPU (#25748) *"f16 loads, f32 accumulation"* risolveva e su Vulkan (#18969) il default `f16acc` è indicato come causa — su Adreno quella leva non serve, serve il prodotto. la soglia più severa dell'Amendment 4 era **congiuntiva** (mediana ≤ 0,005 **e** same-top ≥ 95 %): `mul` soddisfa la mediana (0,004736, contro il riferimento CUDA 0,004962 dell'issue #25593) ma **non** il same-top (94,826 %, 0,174 punti sotto), quindi la congiunzione NON è soddisfatta, e resta un fattore ~5 contro il GEMV fp32 in batch 1 (0,000962): l'ultimo asse non toccato è l'operando **memorizzato** (immagine B `CL_HALF_FLOAT` scritta dal kernel di trasposizione, `:17150`/`:17170`, che in batch-1 non esiste) → prossima cella, richiede modifica host. **Costo in velocità INDICATIVO e non stabilito**: `mul` 189,73 t/s = 0,663× contro i 286,30 dello stesso batch e 0,654× contro i 289,98 ± 1,28 pre-registrati; lo 0,50× della lettura 6 non scatta con nessuno dei due, lo 0,85× resta indeciso. Prese in sequenza su board che si scaldava: una `llama-bench -p 512 -n 128` lanciata a mano ~12 min dopo il bench stock ha dato `pp512 165,74 ± 53,58` contro `286,30 ± 0,61` (n=1, senza telemetria termica: deriva termica è la spiegazione più probabile, non una diagnosi misurata). Serve una misura raffreddata e a ordine randomizzato. **Buco di provenienza dichiarato**: tutte e otto le righe sono VOID `provenance_missing` perché `llama-perplexity` filtra i log INFO del backend ggml; la riga `prec=… math=… compile_opts='…'` esiste ed è archiviata a parte (`raw/provenance/`) catturata con `llama-bench -v`, ma solo per **quattro combinazioni su otto** (half/stock, mul/stock, deq/stock, acc/strict), e le velocità fisicamente diverse (286/173/190/182 t/s) provano che i `-D` hanno agito. Difetti chiusi prima di spendere device: parser delle metriche che non agganciava le etichette vere (`Mean    KLD:` con spazi multipli) e `local a="$1" b="${a}"` sotto `set -u` in due script. Su 732/735/8 Elite e sugli altri nove `gemm_noshuffle_*` nulla è misurato. Controllo di sanità pre-registrato PASSATO in modo forte: la PPL del braccio CPU è `22.9415 +/- 1.68463` **identica cifra per cifra** nelle due invocazioni di questa cella e nella cella precedente (kit diverso, sessione diversa, esemplare di board diverso). Fonti: `scratchpad/agents/adreno-acc-type/` (PREREG 8 amendment + REPORT + AUDIT + raw). | banked (n=1 board, 8 misure); velocità da rimisurare a freddo; cella operando-B da aprire; driver da correggere sulla sonda di provenienza |
| 56 | **TROVATA LA CAUSA DELL'INFEDELTÀ DEL PREFILL GPU SU ADRENO, e non è l'attenzione: è il percorso GEMM che il backend usa quando il batch > 1** (cella `adreno-precision-bisect`, QRD8650/Adreno 750, 7/09, kit 2f3b24dee, modello spedito Q4_0 sha a247afd6…, strumento di serie `llama-perplexity --kl-divergence-base/--kl-divergence`, corpus 3079 parole, `-c 256 -s 42`). Tre misure: (1) CPU vs GPU così com'è → **KLD mediana 0,454, stesso-top 62,4 %, PPL +8,50**; (2) con `-fa off` su ENTRAMBI i bracci (i due grafi usavano attenzioni diverse: 8 `FLASH_ATTN_EXT` sulla CPU contro 8 `SOFT_MAX` sulla GPU, `resolve_fused_ops: Flash Attention not supported`) → **0,4538 / 62,8 % / +8,40**, tutto dentro l'incertezza della prima: **il percorso di attenzione NON è la causa**; (3) stesso confronto con **batch 1**, che instrada la GPU sul kernel GEMV (`gemv_noshuffle_q4_0_f32.cl:225` `__private float2 totalSum`, fp32, operando B `CL_FLOAT`) invece del GEMM (`gemm_noshuffle_q4_0_f32.cl:38` `half8 c0`, f16, operando B `CL_HALF_FLOAT`) → **KLD mediana 0,000962 (472× meno), stesso-top 98,0 %, PPL +0,27**. Letture pre-registrate prima di ogni misura (Amendment 1 e 2, commit precedenti ai run, verificati dall'audit con 19 s di margine). **Limite del disegno, dichiarato:** fra i due percorsi cambiano insieme kernel, precisione dell'accumulatore, precisione dell'operando e ordine di somma → l'esperimento NON separa accumulatore da operando; dice che il percorso batch>1 è infedele e quello fp32 no. Il residuo fp32 (0,00096) è dell'ordine di quanto la issue upstream #25593 riporta per CUDA (0,004962), cioè fedeltà normale. Lo stesso schema `half8 c0` è nei dieci `gemm_noshuffle_*` quantizzati (comportamento non misurato altrove); il decode non è esposto (GEMV fp32). Compatibile con ALIVE 55 sullo stesso board; su 732/735 nulla è dimostrato. Riferimento di velocità per il fix: **pp512 289,98 ± 1,28 t/s** (`raw/bench/`). Due esemplari fisici diversi fra misura 1 (df8ea83f) e 2-3 (36aa3b71). Audit #31 (GLM, ogni numero ricalcolato dal raw): BANK-WITH-FIXES → 10 correzioni applicate, inclusa la rititolazione della causa. Fonti: `scratchpad/agents/adreno-precision-bisect/` (PREREG+REPORT+raw). | banked (n=1 board, 3 misure); apre la cella ACC_TYPE (accumulatori float nel GEMM, con costo in velocità da pagare); da rifare su 732/735/8 Elite |
| 55 | **Oracolo a logit VIVO e prima misura di QUANTO diverge il prefill GPU: su QRD8650 (SM8650/pineapple, Adreno 750, V75, 6-7/09, sessione 807970, governor FORZATO sulla B) i logit grezzi pre-sampler del prefill GPU differiscono in modo sostanziale da quelli CPU sugli STESSI 32 token forzati — mediana \|Δp₁\| 0,0861, 21/32 passi oltre 0,02, mediana max\|Δlogp\| 3,444, e **OTTO passi su 32** in cui il top-1 grezzo cambia mentre la CPU è sicura (3, 15, 18, 20, 22, 23, 25, 28; peggiore il 23: CPU 0,9826 su 11671 vs GPU 0,2660 su 7457, con il token della GPU sotto lo 0,05% per la CPU; in 5 casi su 8 la scelta GPU è comunque nei top-5 della CPU, in 3 no). Verdetto `oracle=FAIL steps=32 max_dlogp=8,7216 max_dp1=0,7166`.** Controllo di misura, gratuito dai dati archiviati: i due bracci CPU (positivo APK 8269aa2 e negativo APK 5243755 — sessioni, build e installazioni diverse) sono **identici bit a bit su tutti i 936 passi** (`PASS steps=936 max_dlogp=0,0000`): lo strumento legge 0,0000 su CPU-vs-CPU e 3,444 di mediana su CPU-vs-GPU, quindi la divergenza non è rumore. Velocità della stessa coppia: **prefill GPU 4,105 s vs CPU 7,294 s = 1,78×**. Coerente col token-oracle già FAIL su questo stesso board (run 8, riga 51) e su 732/735 (righe 52/54): il prefill GPU su V73/V75 NON preserva l'uscita, e ora si sa di quanto. **R5 (sanità dell'oracolo) NON soddisfatta**: il controllo positivo va girato dove il prefill GPU è ritenuto corretto (8 Elite/V79) — averlo messo su un board dove la divergenza era già nota è un errore mio (PREREG Amendment 12); il controllo negativo (APK con guasto iniettato) non ha prodotto coppie. Quattro difetti reali chiusi per arrivarci (tool non spenti nel prompt; contatore token legato a una riga di log sparita; launcher in primo piano su Android 16; SIGSEGV dell'hook e contratto JS di `stopCompletion`). Vincolo termico misurato: solo la PRIMA coppia di sessione rientra nel tetto di cooldown 900 s. Fonti: REPORT §Sessione 807970, raw/sa812039/ e raw/sa812039-fault/, PREREG Amendments 3-12. | banked (descrittivo, n=1 coppia + controllo CPU-vs-CPU); R5 sull'8 Elite e negativo col guasto ancora da fare; nessuna promozione di `GPU_PREFILL_CORRECT` (R6) |

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

---

## 9. THE PRODUCT TRACK — first day of the practical plan (2026-09-09, all measured, none decorated)

Plan: `kalsa/docs/PROPOSTA-OTTIMIZZAZIONE-CHAT-2026-09-08.md`. Detail and evidence in `PLAN.md` (diary) and
`scratchpad/agents/{g1-model-select,session-contract,product-suite,competitors}/`.

| cell | what was measured | number | limit |
|---|---|---|---|
| **G1 Mac, dev corpus** | 48 deterministic cases per model, shipped prompt/sampler/budget, fork 67c73d26c CPU | LFM 2 FAIL, MiniCPM5 3 FAIL (same conversation-EN fail) | rubric cases judged separately |
| **G1 Mac, blind judges v2** | 60 open rows, two independent judges (deepseek, mimo), A/B randomised per row, key never shown | A: LFM 25 / MiniCPM5 22 / tie 13; B: 23 / 24 / 13; agreement 43/60 | 14 LFM finals empty by a harness round-cap (v2b re-run in flight) |
| **G1 Mac, blind judges v2 + v2b (app tool-loop semantics)** | the 18 rows the round-cap had emptied, re-judged fresh by both judges, merged into v2 | **A: LFM 34 / MiniCPM5 13 / tie 13; B: 30 / 15 / 15** (means 3.57 vs 3.18, 3.72 vs 3.22) | 18 rows judged in a separate session; 17/18 are LFM-side repairs; MiniCPM5 `@256` has 2/44 bare-`>` answers from the thinking-budget cut |
| **G1 Mac, MiniCPM5 thinking budget (v2c)** | MiniCPM5 at budget 1024 and unbounded vs LFM v2b, 60 rows, both judges, fresh A/B | **LFM 28/15/17 and 27/13/20 (@1024); 26/17/17 and 24/15/21 (unbounded)**; deterministic 33/44 at both; 0/60 bare-`>` | budget moves 2-4 rows, wild block only; bake-off gap (fabrications, language drift) unchanged → budget REFUTED as the cause; Q8_0 cell (v2d) next to separate quant from behaviour |
| **G1 Mac, MiniCPM5 quantisation (v2d)** | MiniCPM5 Q8_0, unbounded thinking, vs LFM v2b, 60 rows, both judges | **LFM 24/16/20 (deepseek), 26/13/21 (mimo)**; deterministic 31/44 (Q4_K_M 33/44) | same failure classes at 8 bit → quantisation REFUTED as the cause; remaining lever for MiniCPM5 is fine-tuning, post-G1 |
| **Jelly, three app fixes on a36074e** | shipped LFM, USB, 30 °C start | prefill budget live: prewarm 1832 tok / 53.7 s = 34 tok/s → `budgetTokens 653`; large PDF (26 655 tok) → retrieve, small (489) → retrieve at the hot-run budget 344; session after a tool turn: `mark_prefix ok`, relaunch `load ok tokens 2161`, turn 3 `n_common=2161`, `promptMs 32 s` vs ~120 s cold | the two document answers ended `interrupted=true` (harness poll/timeout, not the fix); large-doc answer began in English to an Italian question → FIXED 4b29466 (answer-language cue at the end of the tool result): Italian answer to the Italian question (TTFT 94 s, 150 s total), English to the English one (30 s / 69 s), both `interrupted:false` |
| **G1 Mac, harness artefacts** | three, in opposite directions | prompt forced locale language (hurt MiniCPM5, fixed on main f77ea7b); no tool schemas offered (hurt LFM: raw tool syntax 15/44); 2-round cap without forced synthesis (hurt LFM: 14/60 empty) | only v2b counts for G1 |
| **G1 Mac, language drift with the fixed prompt** | wild block, es/fr/de/pt/zh/ja + it/en | MiniCPM5 3/9 non-en/it prompts answered in English (W01, W02 es; W16 ja); LFM 0/9 | heuristic language detector |
| **MiniCPM5 quants (Mac)** | PPL on one text, fork llama-perplexity | Q8_0 22.34 · Q4_K_M 23.55 · **Q4_K_M-imx 23.36** · Q4_0 26.19 · Q4_0-imx 24.64 | one text, one ctx; calibration disjoint from the G1 corpus |
| **S23 restore, shipping config** | LFM, thinking ON, main@332aeed, force-stop → relaunch → turn | cold seed 37.9 s / 1811 tok; restore load 36 ms, n_past 2051, continuation prefill **562 ms**; one save per turn; disk estimate 1.01× | **n=1** (thermal status 3 at 42.7 °C stopped cycles 2-4, unplugged) |
| **S23 dry run, both models** | G1 device runner, 2 cases × 2 models, ~2000-token cached prefix | decode LFM 9.5-10.4 vs MiniCPM5 6.5-6.6 tok/s; LFM prewarm 40 s / 1919 tok; MiniCPM5 prewarm **138 s / 2112 tok** (`promptN=1` was a perf-accounting artefact, fixed e168b4a; real prefill ~15 vs ~48 tok/sgest, cause open) | 4 cells; runner filtered native logs |
| **Jelly document chat, shipped LFM** | 5 scenarios, 1-page + 40-page PDFs, same questions before/after | main@332aeed **1/5** → main@5707cfe **7/7** (retrieval reached p.3/17/31 with page cited) | 2.8-3.7 tok/s, 119-417 s per answer, thermal status 3 constant |
| **S23 share intents** | 3 states × 2 intents | cold VIEW and cold SEND-text: FAIL on 332aeed → **PASS on 5707cfe**; SEND pdf from adb denied by MediaProvider (harness limit, needs a real app share) | uiautomator dump dies intermittently on One UI (rc=164) |

Defects fixed on `kalsa/main` today, each from a measurement above: forced-locale language rule (f77ea7b); PDF text
capped at 5 pages, exact-id document selection, malformed SEND filters (doubled prefix), cold-start share wiped by
conversation hydration, 100-minute extraction timeout → 180 s with partial text (5707cfe). Opt-in dev-catalog entry
`dev-minicpm5-2b` with one-time sha256 verification (7836db7).

Current product status: G1 closed on 10 September with LFM2.5-2.6B as the main model; M1 remains 9 October. The S23 battery reproduction is **PARTIAL** and not paired: 9/09 was MiniCPM5 Q4_K_M, while 10/09 was shipped LFM. The five LFM attempts provide energy evidence, but C02's final retry false-settled (`The`); only C03-C06 are valid answers, and the prior C02 `4.35` is excluded. Memory extraction was disabled in all five turns (`memoryEnabled:0`, `skipped_no_snapshot`).

Lifecycle sources omitted from 3ca6145 were restored in `1e02fe3`; `e89bd2a` adds the UI test IDs. The Jelly native/long gate is **PASS** on APK CI run `34483949398`, SHA-256 `a2d08f9df19d179d86d55db1e0407bd4ec77ec9e6d2edb0954083487c27ea5fb`, with identical installed hash: save `10:34:18.945` → unload `10:35:04.621` (~45.7 s), reopen fit `no_active_model availableMb=5789`, load `3628 tokens/62 ms`, prewarm `skip kv_holds_chat`, continuation `promptMs=1489.054`. The brief check is **PASS with limits** because shell HOME/reopen markers are missing; only cancellation/no-unload slices were covered, so this is not blanket lifecycle PASS. Stop abort plus partial preservation is **PASS scoped** on the same installed `095466e` APK (`STOP-PARTIAL-JELLY-EVIDENCE-2026-09-10.md`): Stop after visible text left assistant `a-8080264` at 285 chars with `interrupted:true`, UI marker `Generazione interrotta.`, and `extractStopReason:4`; the partial is English chain-of-thought, not the Italian answer. Edit→Salva is **PASS scoped** (`EDIT-SAVE-JELLY-EVIDENCE-2026-09-10.md`): Salva on the prefilled draft re-sent with `edited:true`, session `messageCount:2`, assistant `ciao`. Regenera UI is **PASS scoped** on Jelly APK `34539915778` / `1807aad` (SHA `9c03c710…3693`): Altro→Rigenera, `KALSA_SEND regen:true`, user `edited` absent, assistant `ciao`. Model-switch LFM→Qwen on the same install left the header on Qwen "Tocca per ricaricare" in 2 s, not checking. MiniCPM5 unused. Pref restored to LFM. Same `1807aad` APK on S23: extract-cancel is **PASS scoped** (Nuova chat → `aborted_by_send`, native extract interrupted). Copy sheet on Jelly APK `34544351697` / `c906727` (SHA `1a47fff2…4298`) is **PASS scoped**. Decode-EMA withhold on that Jelly install is **PASS scoped** (`budget:512 decodeTokPerSec:null` on the first send; that turn decoded at 6.48 tok/s).

Memory extraction `e455afc` is **PASS scoped**: meta v2 is identical, restore loaded 4517 tokens with prewarm skipped, completed extraction produced facts 1/1 and 2/2, and the next send produced `aborted_by_send` after 8688 ms with facts 0 and restore 5022. App commit `f99fe4506a3072c6d18b625bdaca815615bf7421` now forwards the outer turn signal to the inner extraction abort for clearChat, conversation switch, background discard, and unmount; new-send behavior is unchanged, and handleStop does not overlap extraction. MiMo's re-audit is **SHIP** by code review. Automatic E2E run `34526920272` was **cancelled** (not a pass). Extract-cancel is **PASS scoped** on S23 (`1807aad` APK, grok-4.6 `798d29e6`): Nuova chat → `aborted_by_send`, native extract interrupted. Model-switch after the 3-second bounded stop/discard is **PASS scoped** on Jelly (`1807aad` APK `34539915778`, LFM→Qwen in 2 s, not checking).

The `e2e09f5` identity fix is commit `095466ec5c88a8cf4588b898b00cce632b1c1508` on pushed app `main`. APK CI run `34494832409` and E2E emulator run `34494789017` are **SUCCESS** on the exact head. `assets/app.config` and the independent calculation agree on `kalsa-eng-v1:source:765509c292652441bd8bc8a3ebbad51c51657a4127cd545b47488800f9433a65`; engine-change invalidation remains build-time/logic evidence, not a second-APK device proof. This is scoped identity/memory PASS, not blanket G2 PASS.

The embedding completion-log gap is closed at the diagnostic level by app commit `1edf5c662715a357c7aa74d16b9b2ab787688f6e`: the historical 707-chunk report was a force-stop/SIGKILL, not a missing surviving-process exit, and surviving exits already log `done` exactly once. The app now logs deterministic progress every 50 successful chunks and at the final planned chunk. MiMo audit is **SHIP** with zero corrections; local gates are targeted Jest 6/6, full Jest 646/646, tsc clean, semanticIndexHarness 29/0, and embeddingServiceHarness 22/1 versus pre-existing base 21/1. Automatic E2E run `34528014849` on exact `1edf5c6` is **SUCCESS** (job `e2e` completed). No device or Mac build was performed.

## 10. Diario

*(voci ≤ 2026-08-11 in `PLAN-archive.md` → «Registro checkpoint (archivio)»)*

- **2026-08-12 (notte fonda) — 🔒 750 CHIUSO: decode gate FAIL 0.44× (predizione
  recon CONFERMATA) — ma prefill GPU 5.77×: il dividendo GPU su A7X è il TTFT,
  ed è GRANDE.** (`moe-gdn-750.md` completo)

  Xiaomi 14 staccato, 100%: CPU tg 16.15 / GPU 7.07 (0.44×, muro A7X identico
  al 740); CPU pp 31.5 / **GPU pp 181.7 (5.77×!)** — sul 740 era 2.2×. Il 750
  ha muscolo GEMM ma non banda/dispatch per il decode. Correttezza già tutta
  PASS (incl. flat q6_K: il bug del 740 è del compiler E031.41). **Strategia
  GPU su A7X definitiva: decode morto su entrambe le gen (per misura), prefill
  vivo e grosso su entrambe → la leva prodotto è il TTFT (phase-scheduling /
  K4-split trunk-prefill su GPU)**. Nella stessa notte: maratona 2B (CPU vince
  sostenuto 10.2 vs 8.2, GPU piatta e fredda), maratona 4B in corso, pista G99
  LFM2.5 viva (14.4 a k=2, proiezione KEXP 15-20), Fase 2 requant Marco in
  corso (Grok#2), mandato K4-split notturno consegnato a gualt.

- **2026-08-12 (notte) — 🏆 FASE 1 MARCO: CHIUSA CON PASS PIENO — qualità
  3/3 full multi5 + speed entrambe le leve. Il transfer runtime della
  config di campagna su Marco è UFFICIALE: k/drop funzionano su qwen3moe
  senza requant.**

  | cella | ΔMacro bpb | peggior lingua | gate |
  |---|---|---|---|
  | A1 k8d065 | **+0.0040** | zh +0.008 | PASS |
  | A3 k6d050 | +0.0095 | zh +0.018 | PASS |
  | A2 k6d065 | +0.0182 | zh +0.033 | PASS |

  Letture: (1) il drop 0.65 a k=8 è quasi GRATIS in qualità — la penalità
  vera è del k ridotto, non del drop (coerente con l'audit "il drop non
  salta il matmul": toglie I/O, non calcolo); (2) zh è sempre la lingua
  più sensibile; (3) con lo speed gate di stamattina (A2 1.303×, −34.4%
  MiB/tok) il PROTOCOL dichiara il transfer SUFFICIENTE. Decisioni a
  gualt: cella prodotto (A2 misurata vs A3 conservativa) e GO Fase 2
  MarcoKEXP per il regime I/O (gap 4× MiB/tok e +44pt hit vs KEXP).
  Nota di processo: il run PC è sopravvissuto a uno shutdown notturno
  (resume idempotente) e ha macinato ~19 ore totali su 3 celle × 5 lingue.

- **2026-08-12 (sera) — 🧭 RECON 750: la speranza "sul 750 i subgroup ci
  sono" era FALSA — il 750 è A7X come il 740, broadcast=false anche lì.
  Il primo telefono con la feature è l'Adreno 830 (8 Elite). E LiteRT
  dimostra che si può vincere sul 750 SENZA subgroups: la via è il port
  delle tecniche ML Drift.** (`research-adreno750.md`, fonti primarie)

  1. **Il fatto che ribalta lo scoping**: driver telefonici Adreno 750
     (compiler E031.45.02.16) riportano `vector subgroup broadcast: false`
     — stessa lacuna del 740; flash-attn è declinata su TUTTA la A7X
     (SIGSEGV clBuildProgram, PR #26430); le ottimizzazioni K-quant 2026
     escludono esplicitamente A7X (regredisce, PR #26477). Primo driver
     col broadcast: 830/E031.47 (8 Elite, S25-class — device che NON
     abbiamo in lab).
  2. **Predizione per il nostro gate 750 (Q4_K_M, fork): LIKELY_FAIL** —
     740 misurato 0.56-0.74×; 750 = stessa arch + CPU più veloce; scaling
     generoso → 0.93-1.04×. Il test Xiaomi resta utile come conferma da
     10 min, ma non è più la speranza: è il controllo della predizione.
  3. **Il dato che tiene viva la GPU su A7X**: LiteRT (kernel
     subgroup-FREE) fa **1.43× a 3.8B PROPRIO sul 750** (Phi-4-mini S24U:
     GPU 10.39 vs CPU 7.28) e pareggia a 1.5B. Tradotto: sul silicio A7X
     si vince a 4B-class, ma solo con kernel stile ML Drift — che nel
     fork non esistono. **Il port delle tecniche (paper CC-BY + reference
     Apache) diventa L'UNICA via GPU per l'installed base 740+750**, non
     un'opzione tra due.
  4. **Primato confermato dalla ricerca**: nessun numero pubblicato di
     ibrido GDN corretto su GPU di telefono — il nostro E2E sul 740
     resta, a oggi, il primo conosciuto. (Vicini: Qualcomm su laptop
     X2-90; LiteRT 0.8B CPU-only; MLC su S24U senza numeri e throttled.)
  5. Nota 830: coi subgroups veri e LiteRT Qwen3-4B a 19 t/s su S25+,
     l'8 Elite è il primo TOSS_UP onesto per il path llama.cpp — ma
     richiede hardware che non possediamo (opzione da valutare: device
     830 fisico o remote lab).

- **2026-08-12 (pomeriggio) — 🔧 IL POMERIGGIO DEL FIX: K2.1 → K2.2 →
  review ostile → K2.2b → probe build CPU. Primo E2E ibrido GDN CORRETTO
  su GPU mobile (che si sappia); il 740 perde comunque il decode; e il
  probe CPU trova un tradeoff che tocca l'app Kalsa.**

  1. **K2.1** (`moe-gdn-k21-parity.md`): il garbage GPU non era GDN — era
     il kernel flat Q6_K (NMSE ~12 sul 740) che si rubava l'lm_head tied
     via redirect large-M. Bisezione ngl + isolamento `-ot`: chirurgico.
  2. **K2.2** (`moe-gdn-k22-fix.md`, branch `kalsa/opencl-q6k-dispatch-fix`):
     redirect spento quando noshuffle è legale → greedy GPU token-identico
     al CPU. **Primo numero onesto 740: tg GPU 0.41× → poi 0.56× col build
     CPU giusto. Lane decode-740 chiusa per misura.** Prefill GPU 1.29×.
  3. **Review ostile DeepSeek** (`results/gdn_gpu_k22/review_hostile.md`):
     fix corretto, zero blocker; 3 chiusure → **K2.2b @ 04c5d362a**: path
     n≥32 validato (case n=64 + greedy 62-token identico), commento falso
     corretto, twin Q4_K sistemato. Diagnostica: flat Q4_K NON rotto sul
     740 (solo Q6_K). GDN family sempre zero FAIL.
  4. **Probe build CPU** (`moe-cpu-build-gap.md`): il −46% del nostro build
     era **GGML_CPU_REPACK=ON** (pp ×2 MA tg −33% su questo device) +
     binario non-strippato (-g, 125 MB → tg −16%). Fix: REPACK=OFF + strip
     → tg 18.19 ≈ build-safe. ⚠ **ACTION ITEM prodotto: verificare i flag
     di build di llama.rn nell'app — se ha repack ON, il prodotto perde
     ~33% di decode.** Il GPU è raddoppiato pure lui col build giusto
     (5.06→10.25).
  5. Nota storica: con K2.2 siamo (a quanto risulta) i primi con un ibrido
     Gated DeltaNet end-to-end corretto su GPU mobile — LiteRT è CPU-only
     sugli ibridi, upstream aveva i kernel ma l'E2E era rotto. Sul 740 è
     corretto-ma-lento; il verdetto velocità vero è del 750 (Xiaomi,
     attesa gualt). In volo: recon riusabilità kernel Google (ML Drift).

- **2026-08-12 — ⚗️ K2 E2E: il kernel GDN è CORRETTO perfino sul 740 —
  a rompersi è tutto il resto. S23 = FAIL_CORRECTNESS (flash-attn non
  compila sul driver senza subgroup; -fa off degenerato e 0.27×);
  MUL_MAT_ID Q4_K con 73 FAIL numerici = kernel MoE Adreno del pin
  ROTTO. Xiaomi 750 non in LAN: il verdetto sulla famiglia target è
  rinviato a un'accensione fisica.**

  Report `moe-gdn-k2-e2e.md`, artefatti `results/gdn_gpu_k2/` (build
  manifest con sha, log test per op, bench JSON, battery notes; binari
  Android fuori da git). Fatti chiave: (1) build fork Android OpenCL
  riproducibile (NDK r27b, -j4, zero modifiche sorgente); (2)
  `GATED_DELTA_NET` 36/36 PASS su 740 incl. head 128 — il cuore ibrido
  su GPU È GIUSTO anche dove il driver è peggiore; (3) il muro 740 è
  flash-attn (`sub_group_shuffle_xor` assente) + una parità E2E rotta
  nel path -fa off; (4) `MUL_MAT_ID` Q4_K numericamente sbagliato →
  la regola "esperti 35B su CPU" ora ha DUE ragioni (hook streaming +
  correttezza kernel); (5) Xiaomi assente dal mdns → K2-bis su 750
  quando gualt lo accende. Disciplina: unplugged 90→80%, mai >36°C.

- **2026-08-12 — 🏁 SPEED GATE MARCO FASE 1: PASS SU ENTRAMBE LE LEVE
  (S23, staccato, cold fadvise, ABBA 2 prompt, 16 run; batt 100→92,
  temp max 39.1°C; niente SESSION_SLOW — l'anomalia 3-4× della
  fix-session NON si è ripresentata).**

  | cella | decode med | MiB/tok | hit% | TTFT |
  |---|---|---|---|---|
  | A0 (k8, no drop) | 4.122 | 192.5 | 33.5 | 13.6 |
  | **A2 (k6d065)** | **5.371** | **126.2** | 36.7 | 12.6 |
  | KEXP k6d065 (stessa sessione) | 5.696 | **30.7** | **80.7** | 19.0 |

  Gate pre-dichiarati: decode **1.303×** (≥1.15 PASS) e MiB/tok **−34.4%**
  (≤−20% PASS). Hit solo +3.2 pt: la config di campagna trasferisce su
  Marco come velocità, NON come regime di cache — gli esperti Q4_K di
  Marco (~3× i byte dei Q2/Q3 KEXP) non ci stanno in cache 2000. Il
  confronto stesso-device quantifica il premio della Fase 2 MarcoKEXP:
  4× MiB/tok e +44 pt hit di distanza. Bonus: KEXP 5.70 ≈ scheda 5.86 →
  sessione sana. Con la qualità full multi5 in arrivo dal PC, Fase 1 è
  a un passo dalla chiusura completa. Artefatti:
  `results/marco_phase1/speed_s23/` (CSV 16 righe, note, log per run).

- **2026-08-12 — 🎁 K0 CONSEGNA UN RIBALTONE: i kernel GDN che volevamo
  scrivere ESISTONO GIÀ nel nostro pin. Il cantiere passa da "scrivere
  kernel" a "verificare e integrare". E S_v=128 su tutti e tre i modelli:
  il gate GPU è già aperto.**

  Report: `moe-gdn-k0-op-inventory.md` (DeepSeek sul checkout
  `BigMoeOnEdge/third_party/llama.cpp`, pin 5236140e5 + 3 commit fork;
  ogni claim con file:line). Nota di processo: prima run impiccata a 5 min
  (CLI hung, sessione preservata), recuperata con follow-up sulla stessa
  sessione via opencode-go — zero lavoro perso.

  1. **Upstream ci ha preceduto** (e il claim K2 del 3/8 era stale):
     `GGML_OP_GATED_DELTA_NET` (kernel `gated_delta_net.cl`, S_v gate
     {16,32,64,128}) e `SSM_CONV` sono NEL pin; e ci sono i kernel MoE
     Adreno `gemm/gemv_moe_q4_k/q5_k/q6_k` per `MUL_MAT_ID`. La lezione
     "verifica online prima di agire" colpisce ancora: 5 mesi di upstream
     hanno chiuso il gap che stavamo per scavare a mano.
  2. **Verifica GGUF (coordinatore, 2026-08-12)**: ssm.state_size=128,
     conv_kernel=4, dk/dv=256 su Qwen3.5-2B, 4B e KEXP 35B → G1 e G5
     VERDI. Gap veri residui: GET_ROWS su embedding quantizzato (CPU,
     piccolo) e le euristiche Adreno MoE (nomi tensori, ne01%32).
  3. **La LANDMINE Q7**: l'`expert-ready hook` dello streaming engine
     (commit fork 5236140e5) vive SOLO nel loop CPU di `mul_mat_id` —
     se il MoE andasse su GPU il prefetch/blocking dell'engine è bypassato.
     Design obbligato per il 35B: **esperti su CPU (hook intatto),
     GDN+attn+dense su GPU**; boundary per token = attivazioni FFN
     (~KB-scala) se il GDN resta su GPU, tens-of-MB se cadesse su CPU.
  4. **Dense 2B/4B: nessun MoE → grafo interamente GPU-abile OGGI** col
     backend del fork. K2 diventa: build OpenCL Android + E2E fail-fast
     su S23 (740, dove K5 va ri-testato coi kernel Adreno nuovi del pin)
     e Xiaomi 14 (750). Il gate resta ≥1.15× vs CPU, staccato.

- **2026-08-12 — 🔨 DECISIONE: CANTIERE GDN-GPU APERTO (mandato gualt).
  Niente downgrade a Qwen3 per il free tier ("generazioni indietro, e i 3.8
  sono in arrivo"): i kernel GDN/SSM OpenCL li scriviamo NOI nel fork.
  Ruoli dichiarati: Claude design, Grok codice.**

  Razionale: il muro GDN-su-GPU è cross-stack (recon #61) — quindi
  scriverli nel NOSTRO stack (llama.cpp fork) è l'unica via che tiene i
  pesi Qwen3.5 (e domani 3.8) su GPU, conserva i K-quants e un solo
  engine llama.rn, e sblocca free E CalaQwen insieme. La velocità dei
  free è dichiarata priorità di prodotto (funnel dei pro). Fasi K0-K4
  gated (v. riga Aperto): K0 inventario op dal sorgente (in volo),
  K1 design, K2 kernel+unit test, K3 E2E 2B su S23 gate ≥1.15×,
  K4 4B/750/CalaQwen. Regole ereditate: no-subgroup baseline per il 740
  (recipe adreno-llms, riduzioni in local memory), INT8 non INT4 (HAQA),
  la misura on-device decide ogni promozione di fase.

- **2026-08-12 — 🔎 RECON PORTING LITERT (Grok web, `research-litert-porting.md`):
  il blocco GPU del free tier ha un NOME, ed è lo stesso del 35B — Gated
  DeltaNet. E il "CPU-only" del nostro import 4B era un artefatto rotto,
  non un limite dello stack.**

  1. **Scoperta architetturale**: Qwen3.5-2B/4B NON sono "Qwen3 più addestrato"
     — sono **ibridi GDN + full-attention** (`Qwen3_5ForCausalLM`), stessa
     famiglia del nostro 35B. `export_hf` non li supporta; l'unico ibrido
     first-party (litert-community Qwen3.5-0.8B, litert-lm ≥0.15) è
     **CPU-only: la GPU fallisce la full delegation sugli op GDN**. È il K2
     di LiteRT: il muro GDN-su-GPU è TRASVERSALE agli stack (llama.cpp
     OpenCL E LiteRT). Corollario strategico: chi scrive i kernel GDN una
     volta sblocca free 3.5 dense E CalaQwen ibrido, ovunque.
  2. **Qwen3-4B (non ibrido) è GPU-capable OGGI**: bundle ufficiale
     `mixed_int4` con numeri OpenCL pubblicati (S25-class decode 19.1;
     **Mali G615 10.9** — LiteRT copre anche MediaTek, cosa che il kernel
     nostro Adreno-only non farà mai). Il nostro import "CPU-only" del twin
     era quindi un file rotto/mismatch di runtime (cause tabulari nel
     report; issue #1136: DIY export 16% delegato vs 100% ufficiale).
  3. **Bivio prodotto dichiarato** (decisione gualt): (1) free tier su
     **Qwen3-4B litert** → GPU subito, spike 1 giorno zero-conversioni
     (re-download ufficiale sha-verified, Gallery + litert-lm CLI su S23,
     misura vs CPU 8.38) + quality gate vs 3.5; (2) restare Qwen3.5 →
     llama.rn CPU finché non esistono kernel GDN. RN: LiteRT-LM Kotlin
     stable, wrapper community, MediaPipe legacy; 1-3 settimane + hardening.
  4. Logistica conversioni (se mai servisse la via B): Linux ≥64 GB RAM,
     litert-lm-builder per bundle completi (spiega il nostro storico
     `TF_LITE_PREFILL_DECODE not found` = pack incompleto); qualità: nessun
     bake-off pubblico int4/int8 litert vs K-quants → serve gate nostro.

- **2026-08-12 — 🧱 TWIN CLASSI PRODOTTO (Grok su S23, unplugged, batt 57→53):
  la via zero-fork per il numero GPU 2B/4B è ESAURITA — Gallery non può
  darlo. Twin CPU misurati e curva completata.**

  1. **2B-GPU BLOCKED**: non esiste bundle `.litertlm` ufficiale ~2B Qwen
     (litert-community ha 0.5/0.6/1.5/4B); l'import non ufficiale resta
     rigettato (LTLM magic). Niente rabbit-hole conversioni, da mandato.
  2. **4B-GPU NO GPU OPTION**: `qwen3_4b_mixed_int4.litertlm` (2.7 GB,
     importato) espone SOLO CPU come accelerator in Gallery 1.0.18 — il
     chip GPU proprio non appare. Wall Gallery CPU 5.3-5.7 tok/s; nota a
     margine: llama-bench CPU fa 8.38 → **llama.cpp CPU batte LiteRT CPU
     sul 4B**.
  3. **Twin CPU (llama-bench `-t 4`, tg256, sha verificati)**: Qwen3.5-2B
     Q4_K_M **18.10** (pp128 44.13); Qwen3.5-4B Q4_K_M **8.38** (pp128
     16.91). Curva CPU per taglia: 1.5B 25.8 → 2B 18.1 → 3B-class 9.7 →
     4B 8.38. Conferma dove il CPU crolla: esattamente sulla classe del
     modello prodotto Kalsa.
  4. **Lettura di gate**: il criterio pre-dichiarato (GPU ≥1.15× same-class)
     non è verificabile né falsificabile coi bundle DI CATALOGO. L'evidenza
     pro resta per proxy (Gemma E2B 2.76×; ML Drift 26.8 su Llama-3B vs
     nostro CPU 8.38 sul 4B ≈ 2-3× potenziale). **[CORREZIONE stessa
     giornata, stop di gualt]**: la prima stesura diceva "via zero-fork
     esaurita" — FALSO: resta il **porting in proprio** (conversione
     ai-edge-torch di Qwen3.5-2B/4B + bundling litert-lm GPU-enabled), che
     dà il numero mancante senza scrivere kernel. Direttiva prodotto
     dichiarata: i free (2B/4B) DEVONO essere veloci — sono il funnel dei
     pro. Recon feasibility affidata a Grok (web); F3-fork resta la pista
     alternativa se il porting non è percorribile.
  Artefatti: `results/litert_product/` (bench JSON, dump a11y, battery
  notes), report `moe-litert-product-classes.md`. Disciplina rispettata:
  sempre staccato, mai <30% batt, mai ≥45°C.

- **2026-08-13 (notte, tardi) — 🔍 IL "FLAGSHIP DIMEZZATO" ERA UN ARTEFATTO
  DOZE — round t4+screen Xiaomi chiuso in 25 min** (sospetto di gualt sullo
  schermo → design 2×2 thread×screen, `results/xiaomi_t4_round/`).
  CalaQwen fact: t6 screen-ON **4.750 med** vs 2.55 campagna screen-off
  (+86%), t4 flat (4.580), sustained regge (4.392) — il collasso 4.02→2.3
  era HyperOS Doze che strozza il flash I/O (0.22→0.50 s/tok; sveglio resta
  ~0.20). Marco1c: due leve indipendenti — thread (t6 4.11 → t4 8.58,
  effetto per-modello: Marco è compute-heavy, CalaQwen flash-bound e
  thread-flat) + screen (+23%) = **t4 screen-ON 10.574 t/s, PRIMO SORPASSO
  del flagship sull'S23 (8.82)**; ginocchio t4>t5>t6. Cleanup verificato
  (timeout 60 s, perf-mode 0/0/0, pin MATCH). Da stasera: colonna
  mWakefulness nei runs.csv; question aperta se anche S23/Jelly campagna
  fossero screen-off (listini conservativi ovunque?). Nel mezzo: grok
  measurement S2 scoperto MORTO AL LANCIO dopo 4 h di "in volo" fantasma
  (watcher vede solo il report; lezione bancata in memoria: verificare PID
  a ogni check di board). Kernel S2 IMPLEMENTATO e corretto (7/7 PC,
  geometry-parameterized, branch verificati); misura S23 in attesa di
  carica (46% < 55%); review ostile DeepSeek sul diff in volo.

- **2026-08-13 (notte) — 🚢📱 DOPPIO LANDING: TTFT-v2 MERGIATO su ai-chat main
  + cella Xiaomi-Marco1c con RIBALTONE t4.** (1) **TTFT-v2**: i 3 fix della
  review (dense-restore guard, bakeRematchKey canonica persona'd, compaction
  "0"=OFF esplicito) + optionals landed in 3 commit, harness tutti verdi, diff
  auditato dal coordinatore, merge --no-ff (main c407299 → merge commit). Il
  numero che shippa: cold+90s+send = **1.40 s** (era 53.4). (2) **Xiaomi 14
  Marco1c** (`reports/lineup-card.md` + `moe-calaqwen-xiaomi.md` §perf-mode,
  staccato 72→68%): t6 med **4.101** / 51.5 MiB/tok / hit 53.5% — regime I/O
  identico a S23/Jelly alla cifra; sustained hot 6.84 (NESSUN collasso:
  temp 33-35°C, era il DONTNEED non il termico); perf-mode HyperOS
  **PERF_MODE_NULL** su CalaQwen (0.97×) ma 1.52× su Marco1c. IL DATO che
  riapre tutto: **t4 = 8.577 t/s (2.1× su t6, compute 0.048 vs 0.116)** — a
  un 3% dall'S23 (8.82), con schermo spento. La card rule "cpu_capacity≥50%
  → t6" oversubscrive SM8650. Caveat di metodo scoperto da gualt: TUTTE le
  celle Xiaomi (incluso il baseline CalaQwen 2.55) girate screen-off/Doze,
  mai documentato. Round di chiusura in volo: CalaQwen t4 (mai misurata,
  può uccidere la narrativa "flagship dimezzato"), Marco1c t4 r2, cella
  screen-ON. Lezione: il thread-count di card va autotunato per-SoC — stesso
  principio dell'autotune kernel (U t2-vs-t4 per-SoC del K0).
  layout era t=8-only; il kernel è corretto, al floor, e resta il substrato
  per S2.** (`moe-mellum2-kernel-s1.md`, branch `kalsa/kernel-s1-expert-pack`
  @ 93d78ab, llama.cpp b8a78977d)

  - Costruito il virtual tall GEMV (k esperti = un GEMV logico di k×896
    righe, mappa riga→(slice,offset), ZERO memcpy — overhead 14 µs = 6% vs
    MUL_MAT contiguo). Geometry dal tensore a runtime, fallback stock di
    default, flag `--moe-fused-gemv`.
  - Gates: NMSE 8/8 PC+S23 PASS; fused 231.6 µs a t=8 PASS (stock 598 =
    trenchcoat confermato, 2.58×); greedy n=32 token-identico PASS;
    qwen3moe 256e ON/OFF match PASS. **Gate 4 FAIL: on-model t=2 compute
    0.182 ≈ baseline 0.181.**
  - **La scienza**: a t=2 stock ID = fused = tall MUL_MAT = 421 µs — due
    thread a chunk-stealing saturano già quel GEMV. Il guadagno del pack
    esiste SOLO dove i thread abbondano (t=8). Quindi: recuperabile
    rivisto ~64%; la strada è S2 (84→28 launch = la fetta dispatch 0.097),
    e con op grasse i thread tornano scalabili — lì S1 ripaga (a t=4 già
    mangia 0.027).
  - Bonus dato: k6 d1.0 a t=2 → compute 0.159 (best mai visto su Mellum).
  - Igiene perfetta: pin campagna intatto, bins solo ~/bin/kernel_s1/,
    staccato 54→52%.

- **2026-08-13 — 📊 TTFT VERIFY su Jelly: il branch fix è un FAIL TOTALE
  (S1 cold 53.4 s, identico a prima) — ma il report consegna i colpevoli
  esatti e la mossa vincente.** (`kalsa-ttft-verify-jelly.md`, grok gualt;
  mandato v2: `mandates/kalsa-ttft-fixes-v2.md`)

  - **Bug 1 (eager init MAI partito)**: il kick a boot è dentro
    `runAfterInteractions` chiuso su deps volatili — i re-render di boot
    cancellano l'handle. `engine.eagerInit` mai apparso in logcat. I 6.6 s
    di `initLlama` restano sul tap.
  - **Bug 2 (il muro, 88%)**: restore `.kvs` su modello IBRIDO = JS
    `ok:true, 1635 tok` ma nativo `loadPrompt:462` → `n_past=0`, full
    wipe (Q6.c, stessa classe del C3 engine). 47 s di re-prefill del
    prompt system/tool (~1.4k tok a 28 tok/s su G99). Era dichiarato
    fuori scope nel mandato v1 — ed era quasi tutto il numero.
  - Keepalive: il processo viene ucciso dall'OEM in <5 min — un flag
    AppState non sopravvive alla morte del processo. Non è una fix Jelly.
  - Compaction default-ON: non arriva agli upgrade (chiave "0" residua
    della vecchia install).
  - **L'ORO**: in-process il prefix-match FUNZIONA — turno 2 riusa
    1407/1436 token, prefill 1.8 s. Quindi la v2 non aspetta Q6.c:
    **prewarm a boot del prefisso system statico** (byte-identico al
    render del messaggio 1, join se l'utente manda prima della fine) →
    messaggio 1 = delta-prefill + decode ≈ 2-4 s su Jelly, quasi zero
    su S23-class. Q6.c resta necessario solo per il cold-restore delle
    chat lunghe.

- **2026-08-13 — 🔧 KERNEL K0: GO_KERNEL, il 72% dello 0.228 s/tok è
  RECUPERABILE — e lo stage 0 è gratis (`-t 2`).**
  (`moe-mellum2-kernel-k0.md`, artefatti `results/mellum2_kernel_k0/`)

  **Il gate pre-dichiarato (≥50% recuperabile) è passato con margine.**
  Waterfall dello 0.228 s/tok (k=8, S23 staccato, campaign-flag build):
  - **GEMV puro fused: 0.023 s (10%)** — pack Q4_K a 39 GB/s, SOPRA il
    tetto campagna 25. Il GEMV non è il problema: lo 0.228 è 10× il floor.
  - **Layout/scatter mul_mat_id: 0.018 s (8%)** — ID Q4_K 557 µs ≈ 8 GEMV
    singoli in fila (571): oggi mul_mat_id è "8 GEMV in un trench", zero pack.
  - **Dispatch per-op: 0.097 s (43%)** — 84 launch MoE/token + barriere.
  - **Tax sync/scheduler t=4 vs t=2: 0.047 s (21%)** — la U dei thread:
    t1 0.205 / **t2 0.181 (best)** / t4 0.236. Il 3° e 4° thread PEGGIORANO
    (occupancy 87→72%, cpu-s 0.61→1.05, WALT→little 68.8%).
  - Dequant <2% (fuso nel vec_dot, non è leva). Attn ~0.035 stimata;
    sensibilità: perfino attn 0.050 lascia 65% — il gate non si ribalta.
  - Correzione geometria dal GGUF: down NON è Q4_K (896%256≠0) →
    Q8_0×14 + Q5_0×14, GIÀ a tetto DRAM (53.5 GB/s): non impaccarlo.

  **Design a stadi (numeri attesi, gate correttezza NMSE<5e-4 + greedy match):**
  S0 `-t 2` runtime flag → 5.5 t/s compute; S1 pack 8 esperti Q4_K in un
  MUL_MAT (556→236 µs) → 6.1; S2 UNA launch per layer (84→28) → 7-9;
  S3 placement solo a op grassa. Soffitto onesto **7-9 t/s compute**;
  il wall-clock resta flash-bound finché KEXP/k-cut non paga i 183 MiB/tok.
  Igiene: pin campagna 1ca51420… intatto, tool solo in ~/bin/kernel_k0/,
  staccato 58→55%, F1e atteso finire prima di ogni cella.

- **2026-08-13 (sera tardi) — 🏭 L'ARCO MELLUM2 F1→F1e IN UN GIORNO + la
  decisione KERNEL CPU: il muro è `mul_mat_id` (fattore ~2.5× perso), spike
  di profiling GO (gualt).** (`moe-mellum2-f1-s23.md` §F1-F1e,
  `research-mellum2-paper-tuning.md`)

  **La catena dei fatti (tutti misurati, S23 staccato):**
  - F1: arch `mellum` carica, streaming bloccato da UNA riga ricetta mancante.
  - F1b: riga aggiunta (branch `kalsa/mellum-recipe`), STREAMS_OK —
    **2.944 t/s / 185.0 MiB/tok / hit 76%** a k=8 (proiezione carta 92
    MiB/tok era sbagliata 2×: attivi pieni ~780 MiB/tok × 24% miss).
  - F1c griglia k: 2.94→3.76→4.72→5.68 (k8→k2, 1.93×); drop 0.65 a k=2
    taglia I/O ma PERDE tok/s; k=2 garbage a vista, k=4/6 coerenti.
  - F1d forense: **CEILING_REAL(mul_mat_id)** — rebuild flag-campagna
    identico (i8mm/REPACK innocenti QUI); **dense 2B sullo stesso binario =
    15.9 t/s** (build sana); WALT manda 74% dei tick Mellum sui little; pin
    sui big non alza il tetto. Il muro 4.4 t/s è la GEOMETRIA: 64
    micro-esperti (3×2304×896) = 672 micro-GEMV/token.
  - F1e (drop zona-viva 0.75/1.0 + io-two-wave): IN VOLO.
  - Paper 2605.31268 = **Mellum 2 Technical Report** (JetBrains): non è un
    paper di streaming (H100/vLLM/FP8 non trasferisce); conferma MTP
    assente dai pesi; leva k confermata (loro 1.5× su H100, noi 1.93×
    I/O-bound). Matrice di tuning completa bancata: knob mai testati =
    io-two-wave, drop 0.75/1.0 (0.65 possibile zona morta), ahwb (+17.9%
    dichiarato, leva sustained).

  **LA DECISIONE (assessment Claude, GO gualt): kernel CPU nostro per la
  classe micro-esperti.** Il caso: Mellum2 computa a 0.228 s/tok ma lo
  scaling dal dense 2B (0.063 s/tok per 1.15B attivi) predice ~0.09-0.10
  → **fattore ~2.5× perso in mul_mat_id** (micro-kernel 896-wide, sync
  per-op, WALT→little, dequant senza pack). Il kernel = GEMV batched
  per-layer (8 esperti fusi), pack SIMD al cache-insert, una sync/layer,
  hint scheduler. Paga: Mellum2-S23 (tetto 4.4→6-9), TUTTI i modelli in
  scenario RESIDENTE (iPhone Pro/flagship 12-16GB, dove compute è il collo
  — posizionamento SKU corretto: iPhone-first, NON "Mac-first", M1 Max =
  solo proxy da banco), LFM2.5 e futuri MoE micro-esperti. NON paga: Marco1c
  su S23 (è al tetto flash 453 MiB/s). **Gate pre-dichiarato: spike
  profiling 1 giorno** — spaccare 0.228 in dequant/GEMV-puro/dispatch/sync/
  migrazione; se ≥50% recuperabile → GO kernel (1-2 settimane); se è GEMV
  puro al tetto DRAM → chiuso con un numero. Weakness nota di llama.cpp
  upstream → materiale da PR se funziona.

  **Infra riparata in cascata (stesso pomeriggio):** (1) verify KEXP LFM2.5
  era un FALSO FAIL (libreria gguf restituisce tipi come int, script
  confrontava "13" vs "q5_k") — file KEXP PERFETTO, fix + rilancio, ora
  RUNNING_KEXP-PPL; (2) runner selfspec moriva su flag inesistenti
  (--flash-attn/--ngl sul bmoe-cli PC) mascherati da "timeout BMOE_READY"
  — fix + waiter rilanciato in coda corretta; (3) skip-if-done aggiunto al
  loop A0 della pipeline (mai più 6h di PPL ripagate). Mandato
  ttft-verify-jelly scritto e consegnato a gualt (matrice 6 scenari
  before/after sul branch fix/ttft-load-policy, finito).

- **2026-08-13 (sera) — 🔴 C3-RERUN COL KVFIX: FAIL — non era il binario. Il
  contratto di riuso sessione multi-turn è ROTTO sull'ibrido attn+SSM, con
  meccanismo ora identificato a 8 token di precisione.** (addendum in
  `moe-ttft-f0-jelly.md`, log `results/ttft_f0_jelly/C3_kvfix/`)

  Rebuild fresco del commit KVFIX (2c675a5) per A76 (`armv8.2-a+dotprod+
  fp16`, no i8mm, installato come `bmoe-cli-kvfix` senza toccare il pin):
  T2 `n_common=0` su entrambe le rep (prefill 163.8 s, −13% vs C2). In più
  l'agente ha verificato che il sorgente del binario di campagna aveva GIÀ
  entrambe le hunk KVFIX → l'ipotesi "binario sbagliato" è refutata anche a
  livello sorgente. G-K1 (PASS, S23, prompt corto) aveva copertura
  insufficiente.

  **La firma forense**: re-render T2 = 2033 token = T1(1980) + follow-up(53)
  — mancano ESATTAMENTE gli 8 token della risposta assistant di T1 (attesi
  1988+53=2041). Quindi due guasti impilati: (a) il commit della risposta
  assistant nella history non è byte-fedele ai token generati → il re-render
  diverge a ~1980; (b) su ibrido attn+SSM `seq_rm` non può troncare la coda
  (stato ricorrente non riavvolgibile senza checkpoint) → invece di
  n_common=1980 (~97% comunque salvo!) il motore fa WIPE totale → 0%.

  **Vie di fix (engine, in ordine di costo)**: (1) commit assistant
  byte-fedele nella history di sessione — rimuove il bisogno stesso del
  troncamento, è LA fix del contratto; (2) checkpoint dello stato SSM
  (classe patch llama.rn hybrid-restore) — pesante; (3) intanto loggare
  n_common pre-fallback (oggi il wipe è una black box). Entra nella lista
  engine-work insieme a delta-prefill API e KV handover. I P0 app NON
  aspettano (leva minuti = compaction, già giustificata da C2). Citare
  SEMPRE 0% finché una cella non misura diversamente.

- **2026-08-13 (pomeriggio) — 💪 MELLUM2 F0: STRONG 15/20 — il gate coding-SKU
  è superato, e il "ROSSO multilingua" della recon è RIBALTATO dalla misura.**
  (`moe-mellum2-f0.md`)

  Suite 20 task isolati (greedy, template ufficiale, PC `-t 4` senza pestare
  la PPL LFM2.5): **15/20 = CANDIDATE_STRONG** (gate ≥14). Per famiglia:
  fromdoc **5/5**, review bug piantati **3/3**, bugfix 6/8, refactor **1/4**
  (la famiglia debole). Lingue: EN code-explain **7/7 perfetto** (era il
  kill-gate), IT 9×2+1×1 = usabile (risponde in italiano, non madrelingua),
  ES/FR tutti 2 — il tag HF "en only" era pessimista. Speed PC idle 24.2
  tok/s (i ~10 della suite erano contesi con la PPL, non regressione).
  **Rischio prodotto individuato dai fail: diff "no-op"** (05/06: patch
  dall'aspetto valido che tocca solo il docstring e lascia il bug) — un
  merge-bot cieco la applicherebbe; il client DEVE strippare i fence e
  verificare che il patch cambi codice. Refactor locali deboli = pitch "SE
  assistant", non "agente refactor autonomo" (coerente con JetBrains).
  Appendice Metal pronta da incollare per l'M1 Max di gualt (bench + smoke,
  confronto vs 24.2 PC). Prossimo gate naturale: F1 on-device S23 col
  nostro stack streaming (12B/A2.5B, file 8.07 GB → streaming obbligatorio
  su 8 GB) — GO gualt.

- **2026-08-13 (pomeriggio) — 📉📊 DOPPIO VERDETTO: Ling 3.0 Tiny NOT_BETTER
  (watchlist, non sostituisce LFM2.5) + TTFT-F0 Jelly COMPLETO: i minuti sono
  il re-prefill a 13.8 tok/s, e il riuso KV di sessione è USCITO ROTTO (C3 =
  0% salvato).** (`research-ling3tiny.md`, `moe-ttft-f0-jelly.md`)

  **Ling 3.0 Tiny (`NOT_BETTER`)**: geometria vera da config.json 7.893B/
  ~1.14B attivi decode, 128 esperti k=8, ctx nativo 131k (262k è solo YaRN),
  MIT solo su card. Thinking ibrido SPEGNIBILE (`enable_thinking:false`) MA
  zero eval pubblicate a think-off; think-on = 51k tok/task (57 min a 15
  tok/s = kill UX). **Blocco duro: arch `bailingmoe3` NON mergiata in
  llama.cpp (PR #26608 aperta)** — non entra in fabbrica. Niente IT/ES/FR
  documentate (LFM2.5 le dichiara). Q4 4.82 GB non residente in 2.5-3 GB.
  Proiezione Jelly ~14 t/s Q4 / ~16 KEXP = stessa banda di LFM2.5 misurato
  (10.6/12.3/14.4, KEXP 14.7-18.3), non sopra. Leva KEXP più debole (esperti
  ~43% dei byte attivi vs ~70% LFM). Riapertura solo dopo merge PR + smoke
  think-off (fail-fast: GGUF piccolo su fork bailingmoe3-support). AA 25 vs
  8 NON è confronto pulito (think-on vs stima). LFM2.5 resta il cavallo.

  **TTFT-F0 Jelly (C1-C4 DONE, unplugged 69→53%, mai plugged)**:
  - C1: l'alloc KV NON è i minuti — perfino `-c 262144` (3 GiB KV) carica in
    ~5 s; load 2.35-3.75 s; l'app (16k, KV q8/q4 ~78 MiB) è nella banda 2.4 s.
  - C2: LA curva dei minuti — prefill lineare 13.8 tok/s su 2×A76: 257 tok=
    21 s, 974=73 s, 1980=**147 s**; finestra app 10-16k proiettata **12-19
    min** (l'audit stimava 8-16 con slope ottimista). C2@4000 = overflow
    n_ctx 4096, non cella mancante.
  - **C3 ROTTO: riuso 0%** — T2 con prefisso byte-identico e `--chatml` ha
    riprefillato TUTTI i 2033 token (155-180 s vs ~4-5 s attesi). H1-H4
    (flag/load/harness) REFUTATE dai log; H5 SUPPORTED: re-render non
    byte-identico a kv_tokens → `llama_memory_seq_rm` a metà prefisso può
    RIFIUTARE su questo ibrido attn+SSM → session.cpp fa wipe totale
    (`n_common=0`). Indizio chiave: **il binario Jelly `36b01966` NON è il
    KVFIX `ede3ac7c`** che passò G-K1 (preserve_thinking + empty-think).
    Supera la nota trasversale del checkpoint precedente: C3 usava --chatml,
    quindi NON è il n_common=0 del typeahead — è un guasto diverso, engine.
    **Follow-up obbligatorio: C3 re-run col binario KVFIX** prima di citare
    qualsiasi % di riuso.
  - C4 (prefisso mutato): 4007 tok / 6+ min T2 — ma SOVRASTIMA l'anti-pattern
    di un intero T1 finché C3 è rotto; costo onesto isolato ~2.5-3 min.
  - Impatto fix app: **P0-1/2/3 REGGONO senza C3** (compaction ON è la leva
    dei minuti; eager init toglie i 2-4 s di load dal critical path); la
    vittoria KV-reuse resta NON VERIFICATA su entrambi i path (bmoe-cli E
    llama.rn). C5: REPACK ha branch dotprod-only 8×4 per A76 — knob TTFT
    non gratis, serve A/B ON/OFF.
  Nota infra: i 3 agent morivano ai confini di compattazione della sessione
  (4 ondate) — root cause trovata, protocollo detached a verbale
  (`background-kills-at-compaction`). Bonus: recon privacy Grok CLI
  (`research-grok-privacy.md`) — session registry cross-host per account,
  documentato nei posti sbagliati; lockdown disponibile, non applicato
  (decisione gualt: ok così).

- **2026-08-13 (pomeriggio) — 🪦🪦 DUE IDEE, DUE DEAD (test gualt su S23,
  87→81% sempre staccato, no reboot, 35B-GPU non toccato): typeahead morto
  su un BUCO API del motore; phase-split 2B ha un soffitto carino (0.73×)
  ma irraggiungibile senza handover KV in-process.**

  1. **Typeahead (CalaQwen prefilla mentre l'utente scrive): DEAD su questo
     motore.** L'idea era prefillare solo il delta a ogni pezzo di testo;
     nella realtà ogni passo ha ricalcolato TUTTO: a 527 token
     "incrementale" = 67 s vs controllo da zero 64 s; crescere a pezzi è
     costato 3.5× un prefill unico. Causa: il riuso KV parte solo con
     `--chatml` (senza, `n_common = 0`), e anche col chat template il
     protocollo attuale manderebbe un NUOVO turno, non "sostituisci quello
     che sto scrivendo". Non è fisica: è un buco API — servirebbe un
     "rimpiazza il prompt e prefilla il delta" nel motore. Rifare lo stesso
     test è tempo buttato; riapertura SOLO con quell'API engine-side.
     (Nota trasversale: `n_common=0` senza chat template è anche l'indiziato
     naturale del C3=0% riuso visto su TTFT-F0 Jelly — da verificare nel
     report in scrittura.)
  2. **2B phase-split (prefill GPU + decode CPU): soffitto reale, turno
     reale NO.** Turno onesto 490 tok prompt + 128 decode: tutto-CPU
     28.3 s; tutto-GPU 29.2 s (peggio); GPU-prefill + CPU-decode SE il KV
     si passasse = 20.6 s (0.73×, il soffitto); quello realizzabile oggi
     (due processi) = 36.0 s (1.27×, peggio). Il dividendo esiste solo con
     handover KV dentro UN processo (switch di backend a runtime) — lavoro
     engine, non flag. Lane parcheggiata con la stessa etichetta del resto
     del cantiere GPU-A7X: riapre su engine-work, non su altri run.

- **2026-08-13 (mattina) — ⚖️ K4 CHIUSO: lo split è CORRETTO ma PIÙ LENTO su
  ogni asse sul 740 — N3 FAIL (decode 0.698×, TTFT 0.59×), N4 skippata.
  Il primato resta di meccanica e correttezza, non di velocità.**

  N3 (ABBA 2 prompt, staccato 100%, guardia MemAvailable dopo il false-kill
  MemFree — post-mortem `k4_n3_false_ram_kill.md`): decode mediano split
  2.02 vs CPU 2.90; TTFT 30.4 vs 17.8 s (il load raddoppia: re-upload dei
  dense a ogni cold start); prefill ~pari (9.5 vs 9.9 — il vantaggio
  dense-GPU visto sui densi 2B/4B NON trasferisce al MoE streamato: il
  prefill è dominato dal GEMM esperti su CPU); hit/MiB ~uguali. Gate
  pre-dichiarato FAIL → N4 skip automatico. **Lane velocità split su A7X:
  CHIUSA per misura.** Asset bancati: stack correttezza GDN+split+pin
  router, residency kernel nel parent, flag prodotto `--moe-cpu-experts`,
  e il primato documentato (mai pubblicato da nessuno: 35B MoE streamato
  con tronco GPU su telefono, output byte-identico). Riaperture plausibili:
  830+/subgroup veri, o fused-executor (mesi) — parcheggiate salvo bisogno
  prodotto. Nota metodo: 2 false-kill di guardie in 2 notti (waiter 15s,
  MemFree) — la regola nuova a verbale: le guardie RAM leggono
  MemAvailable, mai MemFree sotto page-cache pressure.

- **2026-08-13 (alba) — 🌍 LA NOTTE DELLO SPLIT: il 35B streamato da flash
  gira con TRONCO SU GPU ed esperti su CPU su un telefono da 8 GB, hook
  vivo, output BYTE-IDENTICO al CPU (dopo il pin del router). Il primo
  sistema del genere che si conosca. Manca solo il verdetto velocità
  (N3/N4 armati sullo stacco).**

  Arco completo (workflow notturno di gualt + 3 task di completamento):
  1. **N0** (workflow gualt): il fork esprime già lo split SENZA patch a
     llama.cpp — esperti Q2/Q3 → `supports_op` false → CPU+hook; pin
     prodotto `--moe-cpu-experts` nel parent (@ 8958cdf). Build Android OK.
  2. **N1 PASS**: KEXP carica con 40 layer su GPU, esperti pinnati CPU,
     82 split, hook vivo — MA solo a **cache 1000 `--force-cache`**
     (ram-guard rifiuta 2000/1500; transiente MemFree 14-90 MiB in alloc
     OpenCL, poi 3-4 GiB dopo anon-drop). Costo regime: hit ~44% vs 80%.
  3. **N2 FAIL → N2b CONFIRMED → PASS col pin**: la divergenza testo era
     il ROUTER MoE su OpenCL (flip di selezione esperti su pareggi ~1e-6);
     `--override-tensor ffn_gate_inp.weight=CPU` → greedy **byte-identico**
     (sha match), hook 43.7 vs 44.0. I dense 2B/4B erano identici perché
     senza router. Patch prodotto 5 righe pronta, non applicata.
     Residuo onesto: l'hidden che entra nel router viene dal trunk GPU
     (softmax può muoversi di epsilon senza flippare il greedy).
  4. **N3/N4 armati** (waiter sullo stacco, batt ≥45%): burst ABBA con pin
     → se ≥1.10× decode o TTFT ≥1.5×, maratona sostenuta automatica.
  Nella stessa notte: curva prefill 750 completa (GPU 5.2×→7.6× che CRESCE
  con la lunghezza, 4B pp2048 86.2 vs 11.3), maratona 4B (CPU sostenuto
  vince 0.80×, legge confermata), Task B CalaQwen-flagship in corso su
  Xiaomi, MarcoKEXP gates + LFM2.5-KEXP pipeline sul PC, pulizia disco
  −82 GB. Report: `moe-k4-split.md` (in completamento con N3/N4).

- **2026-08-14 (sera) — 🏆 KF_PROTO_WIN: il primo kernel-candidato che
  VINCE su device.** A/B Jelly Marco1c (config campagna t2 k6 d065,
  ABBA cold 2+2 + hot + coppia identità d0, batt 84→79, pin intoccato):
  **wall −34.0% (0.318→0.210 s/tok), +51.8% tok/s, IDENTITY_D0=PASS**
  (byte identici a drop 0), win presente anche a d0 (−25.7%), stall
  −58%, e il prefetch mangia pure i page-fault dentro compute
  (0.218→0.163) — quasi saturato il tetto teorico ~36%. Divergenza a
  d065 attesa (F2): l'harness corretto l'ha classificata informativa —
  il gate vecchio avrebbe urlato un falso BROKEN. Costi: ~31% issued
  sprecato (precision 68%), J/token non misurato → cella energia prima
  di ogni promozione a default; N≥10 pre-registrato prima di ogni claim
  di ship. Contesto ops: 2 false partenze (CRLF che uccide il bash
  Termux alla riga 5 con push rc=0; Termux:API morta che finge batteria
  scarica) → 2 memorie con contromisure. In parallelo: **ship A/B S23
  partita** (PREREG 12 coppie stock-vs-certified, warm-up ok, RUNNING).
  Report: reports/moe-kernel-kf-proto.md.

- **2026-08-14 (tardo pomeriggio) — 🔧 K-F: PROTOTIPO LANDATO E BLINDATO,
  in attesa solo dello stacco fisico del Jelly.** (1) **Implementazione
  consegnata**: `--kf-prefetch` issue-only su `kalsa/kf-layer-ahead`
  (b737374 feat / 2150b56 test / dfce4e8 docs), ctest 10/10, G15
  byte-identity PASS, G15b non-vacuo (325 speculati, 27% precision host).
  NB: l'orchestratore grok aveva chiuso la sessione "aspettando il coder"
  3 min prima della consegna — staffetta ripresa a mano ~2.5h dopo.
  (2) **Review ostile (DeepSeek via opencode-go; conto deepseek diretto a
  secco, 402)**: strutturalmente sano — 4 claim contrattuali CONFIRMED,
  race/leak/lifecycle REFUTED; 3 fix pre-A/B applicati e verificati
  (b2f3509 F1 telemetria CPU worker kf esposta in RunSummary/CLI/CSV;
  c3e8fc4 F2 caveat drop + F3 changelog Unreleased). **F2 ha salvato
  l'A/B da un falso BROKEN**: con d065 (config campagna!) l'identità
  byte NON regge (residency è input di apply_drop) — harness corretto:
  coppia identità a drop 0 in coda (gate vero), divergenza d065 loggata
  come ATTESA, vecchio gate hard OUTPUT_COMPARE rimosso. (3) **Runner:
  build Android canonica ok, ma BLOCKED_PLUGGED** (Jelly 100% attaccato,
  pre-check onorato, pin mai toccato). Watcher armato: all'unplug parte
  da solo push+ABBA(7 run: 2+2+hot+coppia d0) con follow per-run.
  (4) **F1b committata da coordinatore** (2396c56, 8 file +670/−10,
  protocollo E2 anti graph-reuse col pad token, RAII k-switch); corsa
  E1/E2/E3 sul 35B ACCODATA a fine PPL arms (due 35B streaming insieme
  = thrash RAM/IO). (5) P1 mergiato su ai-chat main (47be749): stack
  TTFT ship-grade (già bancato 926958f).

- **2026-08-14 (pomeriggio) — 🏭 IL GIORNO DEL FUNNEL: sei candidati
  kernel processati, la casa nuova, e il primo bollino qualità.**
  (1) **Kernel funnel**: K-E morta (i8mm non gira mai: mmla vive solo nel
  REPACK che gli esperti streamati bypassano); K-G morta (l'1.29× GPU
  prefill era una media con cold-outlier; onesto 1.12×; boundary
  innocenti 0.068 ms/tok); **K-F VIVA** (stall 37.3% del wall derivato a
  zero minuti device; prototipo issue-only in volo sul macchinario
  route_ahead già esistente); **libreria Kalsa Kernel** costruita,
  review MERGE_WITH_FIXES(7)→10/10 chiusi (geometria CABLATA, flag
  utente vincono, CI mai verde-a-vuoto). (2) **PPL GATE_PASS k6d1.0**
  (dMacro +0.0378, worst fr +0.0877) → 5.151 t/s = config prodotto
  certificata. (3) **TTFT PREWARM_UNIVERSAL** su Xiaomi-4B post fix P0
  (1.42/2.02 s, riuso 98.9%); saga P1: REJECT (probe RSS insano su
  engine mmappato — la review ha salvato da un fix che convertiva zombie
  in crash OOM) → on-contact v2 → MERGE_WITH_FIXES(1) → fix3 in volo.
  (4) **Migrazione: BigMoeOnEdge dismesso** (direttiva gualt) →
  `kalsa-engine/` nostro + bundle storia completa, pushato su
  Aspis0/kalsa-moe-experiments previa riscrittura bare-clone della
  storia (5 blob >100MB filtrati da 159 commit, groks in volo mai
  disturbati). (5) Canale Qwen Max attivato via browser: parere
  selfspec bancato (45% rollback-corruption, bomba aritmetica
  sublinearità verify). Lezione ops: `git add -A` mai più (l'APK in
  history è costata una riscrittura); pre-push scan >90MB nel protocollo.

- **2026-08-14 (mattina) — 🏁 LANE KERNEL CPU: CHIUSA SU OGNI ASSE, il
  floor è il silicio.** Arco completo S0→S3b in ~36 ore: S0 t2 (+37% vs
  t4, gratis) → S1 pack (corretto, nullo a t2) → S2 fusione (corretta,
  bit-exact, adversarial-audited, PERF_NULL: perde dai propri overhead
  cache/barrier, non dal REPACK) → S3 Phase 0 (REPACK 8x4 delta −1.5%,
  e la scoperta che NESSUNO repacka gli esperti streamati) → S3b i8mm
  (8x8 mmla ripara l'8x4: ID t2 389 µs ×1.27 sul floor, ma token-model
  +0.2÷4.0% < gate 10%). **Tre kernel diversi misurati onestamente
  sotto soglia → 0.148 s/tok compute a t2 È il floor fisico del path
  micro-esperti su S23-class.** Il prodotto della lane: config
  **k6d10 t2 = 5.151 t/s wall (+37% dal 3.76 di partenza F1c), zero
  righe di kernel nel binario di campagna**, più un branch S1+S2+fix
  upstreamabile (fusione corretta + matcher difensivo — il perf su
  altri silici resta da vedere upstream). La lane velocità passa a
  selfspec (F1 in volo, α=0.70).

- **2026-08-14 (notte fonda) — 🌙 PRIMA NOTTATA A 4 LANE: S2 STOP onesto al
  n=256, Jelly 4B chiude la scala free-tier.** (1) **Kernel S2 su S23**
  (`moe-mellum2-kernel-s2.md`): 7/7 backend-ops device + greedy n=32 PASS,
  ma il check n=256 (adottato dalla review esterna Qwen3.8-Max) becca
  **fuso ON≠OFF al char 677** — celle gate non partite, da mandato. Il
  discriminante riordino-FP vs race è ON-vs-ON ripetuto: triage + gate
  condizionale in volo (kernel-s2-gate). Unofficial t4 k8: compute
  0.204→0.179 (−12%). Nel frattempo la review DeepSeek è diventata
  EMPIRICA: si è compilata `adversarial_s2.exe` e attacca il kernel in 7
  modalità — convergenza perfetta col drift. (2) **Jelly 4B dense 3.52
  t/s** tg128 `-t 2` (ABBA, staccato 100→90%): fisica rispettata (previsto
  3.59 dal rapporto pesi 2.24×); scala G99: LFM k4 10.6 / 2B 8.04 / 4B
  3.52 — il free-tier resta 2B-classe, MAI 4B dense. Riga BLOCKED chiusa
  dal grok stesso. (3) Ops: DUE falsi-morti del watcher (wrapper pwsh
  orfanato dal self-update di grok; `ps -W` inaffidabile nel bash
  background) → watcher v3 su mtime `updates.jsonl` di sessione; lezioni
  in memoria. Selfspec run 3 ancora in corso (~item 305, 8.5 t/s PC).

- **2026-08-14 (00:50) — 🎯 SELFSPEC F0: PASS_LANE_OPEN, alpha pooled
  0.6991 (n=1037, gate ≥0.60).** Run 3 completo dopo i 3 bug infra della
  serata (EOS creative, --execute, sha pin): draft k=2 / verify k=6 su
  CalaQwen, 4 categorie × 2 bracci drop (d065 + d0). Il 0.5419 visto a
  metà era la sola categoria fact in corso — il pooled chiude a ~0.70.
  Con α=0.70 e γ≤4 l'aspettativa è ~2.7-2.8 token accettati per ciclo di
  verify: la matematica dello speedup dipende dal rapporto costo k2/k6
  on-device (da misurare in F1). F1 = engine-work (loop speculativo in
  BigMoeOnEdge), non carta. PC LIBERO → coda: PPL gates Mellum drop/k
  (k6d1.0 = la config su cui punta il kernel S2), da lanciare quando la
  review adversariale finisce di usare il PC. Artefatti:
  `results/selfspec_f0/acceptance/` (8 file ckpt+csv).

- **2026-08-14 (01:35) — ⚖️ KERNEL S2: CORRETTO ma PERF_NULL — e la pepita
  è nella cella di controllo.** Phase A: DETERMINISTIC_REORDER provato
  (ON==ON, OFF==OFF byte-identici; ON≠OFF stesso char — è il riordino
  REPACK previsto dalla review, zero race). Phase B (gate, S23 staccato
  86→84%): **il fuso perde contro lo stock in OGNI coppia same-t**
  (k6d10 t2: 0.1585 vs 0.148; k6d065 t2: 0.1735 vs 0.163; retry
  confermati) — su ARM il path fuso row-wise bypassa i kernel REPACK/i8mm
  e restituisce più di quanto il taglio launch compri. La fetta "dispatch
  43%" del waterfall K0 era mal attribuita. Verdetto onesto:
  **S2_PERF_NULL** (la lettera direbbe PARTIAL, 0.1585 ≤ 0.17, ma OFF è
  già a 0.148). LA PEPITA: **k6d10 stock t2 = 5.151 t/s wall — nuovo best
  Mellum2-S23** (+11% su F1e 4.638), solo config, zero kernel. Arco
  S0→S2 chiuso ONESTAMENTE: S0 (t2) l'unica leva vera, S1/S2 kernel
  corretti e auditati (full suite 16191/16191) ma perf-nulli su
  ARM-REPACK. Decisione gualt: (a) chiudere col 5.15, (b) S3
  repack-aware, (c) archivio. PPL quality gate d1.0 resta dovuto (coda
  PC). I 4 fix matcher della review in volo — il branch resta PR-able.

- **2026-08-14 (01:40) — 🪦 REAP-50: LOSES, e la fisica era ovvia col senno
  di poi.** Pipeline intera in una notte (fetch 9.18 GB → PRIMO convert
  safetensors→GGUF della famiglia lfm2moe → Q4_K_M 2.82 GB, sha 2d027f33 →
  cella Jelly staccato 81→78%): k4 resident **10.68** vs A0 streamed
  10.60; k3 12.20 / k2 14.23 = curva A0 identica. Residenza PERFETTA
  (majflt 0.00/tok, 688795 pagine = 100% del file in cache, hot=cold) ma
  irrilevante per il decode: **REAP dimezza gli esperti STORED (32→16),
  non gli ACTIVE (k=4 restano 4 × FFN 1792)** → stessi ~1033 MiB/token →
  stesso muro ~11 GB/s del G99. Il -42% di file compra prefill 15.9 vs
  10.0 t/s, TTFT 8.2/5.7 vs 13.3 s, load 0.90 s hot — non token/s. La
  decisione free-tier si riduce a (i) A0 10.6 vs (iii) no-LFM. Lezione di
  campagna (la seconda dello stesso tipo dopo KEXP-G99): su silicio
  bandwidth-bound contano SOLO i byte attivi per token — né i byte
  totali (REAP), né i byte freddi (KEXP) spostano il decode. Bonus:
  licenza konic taggata Apache-2.0 è FALSA (LFM v1.0 ereditata).

- **2026-08-28 (sera) — #37 qdc-8elite-cpu-day0: BANK-WITH-ERRATA — prima cella
  QDC, primo dato 8xx.** Prereg `f72b1b20` (locked pre-numeri), esecuzione grok su
  sessione interattiva QDC (8 Elite QRD8750 "Sun"/Oryon, Android 16, adb via tunnel
  SSH porta locale 6037 — server adb locale/Jelly mai toccato), audit ostile GLM
  `qdc-day0-bank-audit/REPORT.md`, spot-check orchestratore (righe cert, mediana t8
  tg128 ri-derivata dai 3 avg_ts, skip-record, battery stub). BANCATO: (a)
  correttezza CPU kit `a0cabca6b`: **MUL_MAT 1144/1144** (cert_mm_cpu.out:1477) +
  **MUL_MAT_ID 812/812** (cert_mmid.out:819) con `-b CPU` — il tentativo senza `-b`
  era uno skip vacuo e NON è stato contato (gestione onesta, audit-CONFIRMED); (b)
  speed OLMoE Q4_K_M (4213513024 B, sha verificata): tg128 -t8 **59.095**, pp512
  **92.996**, -t6 **52.504 / 75.514** (mediane per-invocazione, aggregatore
  conservativo ma non pre-reggato — erratum 1). PLUGGED DECLARED (e il battery
  service del rack è CONGELATO: stub 43.0 °C — erratum 3; termica vera da
  thermalservice HAL: CPU 39.6→53.8 °C, status 0→1, drift monotono −8.6% worst =
  numeri mid-ramp, erratum 2). Comparator #20 (S23 CPU tg128 27.685 unplugged,
  no_repack diverso): **~2.1× device-class**, non A/B controllato (erratum 5).
  Costo 20 min / 996. Conseguenza piano: il dato-CPU degli 8xx alza l'asticella di
  ogni investimento kernel HVX/GPU su quella classe; in coda Marco-KEXP (#18) e
  kit GGML_OPENCL=ON per la colonna E031 su Adreno 830. Evidenza
  `scratchpad/agents/qdc-8elite-cpu-day0/` + `qdc-day0-bank-audit/`.

- **2026-08-28 — #36 s23-unplugged-baseline-night0: BANK-WITH-ERRATA
  (correttezza-only).** Prereg `ecd3e983`, Amendment-1 `f90a1d5e`, audit ostile
  GLM `night0-bank-audit/REPORT.md`, verifiche orchestratore su disco. BANCATO:
  correttezza s3oracle su S23 **UNPLUGGED** — MUL_MAT_ID 407/407
  (`raw/cert_mmid.out:815`), MUL_MAT 925/925 (`raw/cert_mm.out:1473`), pin set
  11/11 verbatim, ac:false provato nei battery.pre. **NESSUN numero di velocità**:
  tre tentativi, tre morti diverse — (1) plateau 38.8–39.0 °C ×2h da sveglio
  (gate 32 irraggiungibile), (2) drain reale 13–15 %/h ≫ premessa 7.5 dell'
  Amendment-1 (blocco aritmeticamente infinibile dal 46 %), (3) transport adb
  morto ~20 s dentro la run A (refused, 10 min di retry). ERRATA (6 voci in
  `ERRATA.md`): premessa drain REFUTED, possibile jsonl orfano ON-DEVICE da
  tirare giù al replug (TODO), migrazione porta :36329→:37687 non coperta dal
  prereg, identità device asserita nei raw, gate 36.0 a margine zero, evidenza
  committata solo al bank (questo commit). Conseguenza: matrice speed unplugged
  MORTA per la trasferta → QDC 8 Elite (operativo da oggi: 1000 min su QRD8750,
  adb-via-SSH + exec binari PASS) e/o S23 plugged/USB. Bonus piattaforma:
  kalsallama su macOS/aarch64 10/10 test (incl. 6× test-repack-q23k) — prima
  piattaforma kernel-test fuori da Windows. Evidenza
  `scratchpad/agents/s23-unplugged-baseline-night0/` + `night0-bank-audit/`.

- **2026-08-29 — #38 qdc-8elite-governor-crossbackend: BANCATA — il governor v0
  VINCE su 8 Elite.** Prereg `ddddf077` (locked pre-numeri) + AMENDMENT-1 `28a6c934`
  (scritto PRIMA della riesecuzione: il gate termico del run 1 leggeva il gruppo
  sensori `Cached` CONGELATO di dumpsys thermalservice — run 1 VOID per i tempi, la
  correttezza resta; il gruppo vivo è `Current temperatures from HAL:` + `Thermal
  Status`). Esecuzione orchestratore, sessione 788862 (QRD8750/Adreno 830, ~75 min),
  engine `kalsa/governor-v0` @ 5c3979438, modello di SHIP LFM2.5-2.6B QAD-Q4_0,
  ABBA 2 blocchi, r=3, cooldown ≤60 °C + status ≤1 prima di OGNI run. Mediane:
  A(GPU) ttft 1395/1394 ms, dec 23.7/23.8; C(CPU) ttft 16476/14412 ms, dec
  21.6/23.3; **G ttft 1434/1470 ms, dec 25.3/24.2, commit 26/29 ms = 1.80%/1.98%
  del prefill**. Regola pre-scritta: G PASSA tutte e tre le condizioni in ENTRAMBI
  i blocchi (TTFT ~10× meglio di C e entro 3-5% di A; decode ≥ C; commit <2%).
  Onestà bancata: il 2% passa per 0.02 punti nel blocco 2 ed è prompt-length-
  dependent (costo commit quasi fisso 11.2 MB/turno); parte del vantaggio decode di
  G è TERMICO (C si scalda da solo a 90-93 °C col proprio prefill CPU, G arriva al
  decode più fresco — effetto reale del design ma non velocità kernel); r=3, un
  device, niente 740/battery/app/KEXP. Correttezza cross-backend: test-governor-
  v0-devices PASS su GPU+CPU reali (prefill_splits=2, naive+staged entrambi
  esercitati). Evidence `scratchpad/agents/qdc-8elite-governor-crossbackend/`.

- **2026-08-30 — #40 qdc-8elite-speed-kexp: BANCATA (audit GLM fresco FIX →
  APPLY al re-audit) — decision table KEXP su Adreno 830 completa la serie
  generazionale.** Prereg `3af32c18` (locked pre-numeri). Sessione 792790,
  QRD8750/8 Elite (unit `41c5710f`, arch sun/SM8750, Android 16), modello
  Marco-Mini-Instruct-KEXP (qwen3moe 17.25B Q4_K 5.94GiB, sha verificato
  local==device), ABBA 4/4 exit 0, gate termico HAL vivo (≤44°C, status 0) su
  ogni invocazione. Mediane dei blocchi: **A(GPU ngl99) pp512 274.5, tg128 48.9;
  C(CPU ngl0) pp512 107.4, tg128 60.7**. Regola pre-scritta (mediana dei blocchi,
  soglia 5%): **GPU vince il prefill 2.56×, CPU vince il decode 1.24×** — entrambi
  ben oltre soglia. Serie ora completa e OGNI generazione dà verdetto diverso:
  740 CPU-sempre → 750 GPU-2.21×-prefill/pari-decode → 830 GPU-2.56×-prefill/
  CPU-1.24×-decode; ri-misurata per generazione, mai trasferita. È esattamente lo
  split per-fase che il governor (#38) sfrutta — tesi confermata anche sulla
  ricetta KEXP, non solo sull'LFM2.5 di ship. Onestà bancata: sessione 792778
  VOID (`/vendor/lib64` nel LD_LIBRARY_PATH bypassa il namespace sphal → driver
  Adreno fallisce il dlopen di libCB.so → fallback CPU SILENZIOSO etichettato
  OpenCL ngl99 con exit 0; numeri farlocchi = arm C vero, verificato) tenuta come
  exhibit; diagnosi iniziale sbagliata ("unità rotta") corretta a verbale.
  Evidenze scratchpad/agents/qdc-8elite-speed-kexp/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #41 qdc-8elite-governor-8b: BANCATA (audit GLM fresco FIX →
  APPLY al re-audit) — il governor scala al modello 3× e il commit-tax SCENDE.**
  Prereg `166f9ccf` (locked pre-numeri). Sessione 793164, QRD8750/8 Elite (unit
  `b4bd0901` da adb devices, props sun/SM8750/Android 16), modello LFM2.5-8B-A1B
  Q4_K_M (arch lfm2moe, 5.15 GB, sha local==device), governor-bench 5c3979438
  (fail-fast anti-fallback), ordine A C C A G G, 6/6 exit 0, gate termico HAL
  vivo pre-invocazione tutti PASS (max 50.5°C/status 1), due cooldown da 1 min
  dopo eccursioni post-run a status 2 (47.1/47.5 al re-probe, archiviati).
  Mediane: **A ttft 2517.7/2518.8 ms decode 28.20/28.37 t/s; C ttft
  25122.6/26134.1 decode 13.95/13.46; G ttft 2495.8/2496.1 decode 13.32/13.33,
  commit 22.15/20.77 ms = 0.89%/0.83% del prefill** (banda pre-scritta "≤3%:
  scales cleanly"; riferimento #38 ~1.9% sul 2.6B → il commit cresce PIÙ LENTO
  del prefill: solo 6/24 blocchi attention, ~8.06 MiB/commit, primo turn
  staged-only 6.28 MiB). **G = WIN per la regola pre-scritta** (prefill: sotto
  entrambe le barre, perfino più veloce di A; decode ≥0.95×C in tutti i
  pairing, il più stretto 0.955). Co-headline vincolante: l'arm migliore in
  ASSOLUTO qui è A (decode 2.0–2.1× vs CPU a n_threads=1, caveat dichiarato) —
  con #38 (2.6B: G batte entrambi) e #40 (KEXP: CPU vince il decode) è la prova
  a tre punte che il routing va deciso per-device E per-modello; uno split
  fisso GPU-prefill/CPU-decode è sbagliato su questo 8B, e il meccanismo v0
  (commit sub-1%) è abbastanza economico da permettere QUALUNQUE scelta del
  router. Onestà bancata: citazione serial corretta dall'audit (non era nel
  getprop), rate upload 24.9 MB/s (non 23.8 decimali), re-probe termici e
  SHA256SUMS archiviati post-hoc con etichetta, "46.9" del primo draft era una
  trascrizione sbagliata (47.5 reale). governor-bench inghiotte il banner
  OpenCL → evidenza GPU via fail-fast strutturale + probe llama-bench dedicato
  (selected platform QUALCOMM/Adreno 830) + split 10× dei numeri. Evidenze
  scratchpad/agents/qdc-8elite-governor-8b/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #42 qdc-8elite-vl3b: BANCATA (audit GLM fresco FIX → APPLY
  al re-audit) — il primo VLM della campagna, e la decision table guadagna la
  terza fase.** Prereg `6642824d` + AMENDMENT-1 pre-misura `20f2a259` (kit
  556118a08 = 5c3979438 + patch timing mtmd-cli; --ignore-eos; metriche
  esatte). Sessione 793229, unit `eb49fb9d` (serial NEL provenance — lezione
  #41), LFM2.5-VL-3B ufficiale LiquidAI (backbone = LFM2.5-2.6B di ship +
  SigLIP2 NaFlex 400M; gguf Q4_K_M + mmproj Q8_0, sha local==device==
  pubblicati), immagine sintetica deterministica sha 55e455a2. Ordine
  C A M / M A C / A M C, 9/9 exit 0, gate termico HAL 18/18 PASS (max 46.5°C
  status 0 — il VLM single-turn è termicamente mite). Mediane: **C enc 3915 ms
  / prefill 5752.8 / 29.07 t/s; A enc 6549 / 1445.6 / 22.64; M enc 3927 /
  1436.2 / 22.68**. Regola pre-scritta (mediane di 3, ≥5%): **encode → CPU
  (tie C/M 0.31%; la GPU perde 1.67× — il warmup elenca le op CLIP che
  OpenCL non supporta: UPSCALE/SOFT_MAX/CONT/PERMUTE/RESHAPE/MUL_MAT f32,
  bersaglio kernel concreto se mai servirà la visione GPU); prefill → GPU
  4.0× (tie A/M 0.65%); decode → CPU 1.28×**. End-to-end (REPORT-only):
  M miglior arm statico 11008 ms; composizione per-fase ipotetica
  CPU-enc+GPU-prefill+CPU-dec = 9755 ms = 1.13× sul migliore, 1.40×/1.44×
  sui puri — nessun arm statico può eseguirla: è la tesi del governor estesa
  alla terza fase, QUARTO punto dati del routing per-device/per-modello/
  per-fase (#38 G vince sul 2.6B; #40 KEXP split; #41 8B tutto-GPU; #42 VL
  three-way). Determinismo: 9/9 byte-identici intra-arm (regola di estrazione
  archiviata, hash riprodotti indipendentemente dall'auditor). Onestà bancata:
  il banner OpenCL richiesto dal prereg è filtrato dal logger di mtmd-cli
  (stesso meccanismo #41) → deviazione dichiarata, evidenza sostitutiva:
  A = 45 righe warmup backend=OpenCL in-run (prova diretta), M = SOLO
  comportamentale+probe (il primo draft diceva "A/M" — falso, beccato
  dall'audit e corretto); hash del primo draft non riproducibili → regola
  archiviata e rigenerati; A NON rilabellata "degraded" con motivazione a
  verbale (fallback op-level gridato ≠ fallback silenzioso totale della
  clausola). Actionable di prodotto: sul VL il decode CPU (29 t/s) supera il
  20 t/s di riferimento Liquid su SM8850. Evidenze
  scratchpad/agents/qdc-8elite-vl3b/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-30 — #39 qdc-8elite-opencl-e031: BANCATA (audit GLM ostile FIX →
  APPLY al re-audit) — i kernel MoE q2/q3 sono CORRETTI su Adreno 830, terza
  generazione GPU/compiler, al primo run.** Prereg `e14b7fe1` (locked pre-numeri:
  commit 14:44, raw mtimes 17:16-17:22; la riga "locked at e68414a9" del prereg
  nomina il commit BASE). Kit bin-gov-5c3979438-stripped su QRD8750, Android 16,
  driver OpenCL 0800.70 Compiler E031.47.18.47. test-backend-ops: **MUL_MAT
  925/925 eseguiti OK, 0 FAIL, 545 skip** (925+545=1470 righe per-caso);
  **MUL_MAT_ID 407/407 eseguiti OK, 0 FAIL, 405 skip** (407+405=812) — conteggi
  riprodotti indipendentemente dall'auditor. Claim RISTRETTA dall'audit: i
  q2_K/q3_K su MUL_MAT semplice NON sono MAI stati eseguiti (26/26 "not
  supported" — il backend li declina per capability); sul path MoE (MUL_MAT_ID,
  i nostri kernel 8x4) 10/14 casi eseguiti e TUTTI OK — tutte le shape
  realistiche (m=64/96/512, n_mats=4, n=1..32); i 4 skip sono shape piccole
  dichiarate non supportate (m=8 n_mats=3, m=16 n_mats=5). La claim bancabile:
  corretti sull'830 per ogni shape che accettano. Onestà bancata: primo
  tentativo VACUO con `-b OpenCL` (il backend si registra come **GPUOpenCL**;
  12 righe di Skipping + OK verde) tenuto in raw/ come negative exhibit per
  ENTRAMBI gli op; il "pre 37.3/32.4 °C" di una bozza è RITRATTATO
  (mis-trascrizione, nessun artefatto lo contiene); snapshot termici pre-run
  non catturati (deviazione procedurale dichiarata — correttezza non
  clock-sensitive, Thermal Status 0 a verbale in entrambi i post); exit code
  non preservati come artefatti (evidenza di completamento = firma completa
  per-caso + summary + backend OK). Evidenze
  scratchpad/agents/qdc-8elite-opencl-e031/ (PREREG/REPORT/AUDIT/raw).

- **2026-08-31 — #43 qdc-8elite-npu-v79: BANCATA (audit GLM fresco #8 FIX →
  APPLY al re-audit) — NPU v79 day-0: il lane esiste, e sul modello di ship
  il prefill NPU è 7.2× la CPU.** Prereg `5606d929` (lock 12h prima della
  prima misura, verificato via git dall'auditor). Sessione 793389 (coda
  11.5h su pool Unavailable — record; il login web QDC del browser headless
  si è rotto per tutta la mattina: host Connect relayato dall'owner, ops
  note). Unit `2a38935c` (sun/SM8750/Android 16 userdebug). Kit
  npu-kit-556118a08 buildato NEL CONTAINER UFFICIALE (ghcr.io/
  snapdragon-toolchain, NDK r28b + Hexagon SDK 6.6.0.0, niente login/PC —
  via indicata dall'owner; race dei 4 skel paralleli aggirata con build
  seriale). **Q1 INIT-OK**: `Hexagon Arch version v79`, sessione cDSP
  unsigned-PD, hwinfo 6 HVX + HMX + 8MB VTCM — skel nostro servito al primo
  colpo. **Q2 = "v79 defect list started"** (regola prereg applicata alla
  lettera): MUL_MAT 472/542 (70 FAIL), MUL_MAT_ID 0/301; MA il censimento
  COMPLETO dell'auditor (362/362 righe diagnostiche, zero inversioni) mostra
  HTP0 sempre finito e giudice CPU sempre nan/±inf, e il control GPUOpenCL
  contro lo STESSO giudice passa 407/407 → giudice avvelenato SOLO in
  accoppiata HTP (classe del NaN-judge Adreno già bancato); restano VERI:
  36 dspcall INTERNAL-ERROR (29 su m=16 n=4..8, 7 fuori incluso
  m=576×512×576) e 7 FAIL senza diagnostico (incluso q4_0 m=1,n=2048) non
  caratterizzati. **Q3 esplorativo, N C C N 4/4 exit 0, modello di ship**:
  N pp512 1500.4/1524.1 tg 22.6/24.3; C pp512 212.0/210.2 tg 38.6/38.4 →
  mediane N 1512.2/23.47, C 211.1/38.49 = **prefill NPU 7.2×, decode CPU
  1.64×** (flag della ricetta upstream, dichiarati NON comparabili con
  #38/#41; nessun verdetto di routing — semina la colonna NPU della
  decision table 2.6B/830). Q4: smoke reasoning-trace-only (NESSUN braccio
  ha emesso risposta finale a -n 64 — relabel imposto dall'audit), lingua
  coerente e lista pianeti corretta nel thinking N. Onestà bancata:
  deviazione binding sul gate termico CLI (gate stantio 10 min, nessun gate
  pre-C, mitigante post 48°C); "well under gate" ritrattato (pre_N2 57.6;
  post-C 61.5/63.0 = SOPRA soglia IN esecuzione — il braccio CPU si
  autoscalda oltre il gate anche qui); SHA256SUMS self-hash provato
  matematicamente (voce = sha256 della stringa vuota); primo commit di fix
  errato (solo artefatti) dichiarato e amendato. Evidenze
  scratchpad/agents/qdc-8elite-npu-v79/ (PREREG/REPORT/AUDIT/raw).

> **3/09 notte — DELEGA PIENA OWNER ("fai tutto") + due fatti di contesto
> duri.** (a) Owner via ALTRI 10 giorni (~13/09) e **S23 E JELLY PERSI**:
> lab fisico ZERO, tutto QDC/CI/Mac. (b) Chiarita la regola push: vietati
> solo i repo pubblici DI TERZI; il nostro fork si pusha (incidente
> delete+ripush da fraintendimento, ora in memoria). **Step bancati
> stanotte finora:** (1) `feat/moe-stream` MERGIATO in `main` dell'app
> (c513f00, conflitto assert-native-patch.sh risolto: entrambi i marker
> vivono nelle lib engine; pin llama.rn tenuto a 0.12.8 npm — l'assemblaggio
> device-proven; audit mimo APPLY, un finding refutato alla lettura);
> E2E emulatore in volo sul merge (run 33822638488). (2) **Decisione
> "merge pick" CHIUSA lato fork**: fork-main fast-forward a0cabca6b →
> **12f6d9b6d** (3 pick upstream: fix race FA, fix OOB-read Adreno, opt
> uint A7x — cella #53 zero regressioni), ref-verificato. Il pin dell'app
> resta a0cabca6b: stanotte APK-A (pin attuale) + APK-B (pin 12f6d9b6d)
> per confronto al rientro. In coda: cella #58 (re-run 750 con PREREG che
> prevede lo split → chiude l'Amendment senza sign-off), cella #59 NPU
> replica-morti-v73 su HDK8550 (OLMoE Q4_0 da procurare: Mac e backup
> negativi, ricerca full-disk Lenovo in corso).

> **3/09 notte, 21:05 — #58 BANCATA (riga 41): Amendment 750 CHIUSO.** Re-run
> su QRD8650 sotto PREREG pre-auditato (F15 applicato): i 20 FAIL sono
> byte-identici a #55, MMID 407/407, GPU pp512 291.1 / tg128 23.0 = +2.4%/−1.7%
> vs #55 → dentro ±10%, i numeri 750 sono costanti router (decisione owner n.1
> chiusa senza firma, per la via che l'audit di #55 aveva indicato). 8.7 min
> QDC. Report audit mimo BANK 10/10. Parallelamente: PREREG #59 (replica morti
> v73 su HDK8550) scritto+auditato (F1 dell'auditor refutato dal testo, F2/F3
> applicati; modello allenai Q4_0 sha 361e8d83 — il q55 in-house non è
> recuperabile, census 113/81/1 identico → gate modello PASS, emendamento
> pre-run dichiarato); driver #59 in scrittura (grok→Luna).

> **3/09 notte, 21:45 — E2E EMULATORE VERDE sul merge main (run 33822638488,
> 63 min, inferenza reale, primo E2E verde su main dal 16/08).** Gate
> superato → dispatch APK-A (apk.yml su main, pin a0cabca6b = assemblaggio
> device-proven) e APK-B (branch chore/engine-pin-12f6d9b6d pushato, pin
> 12f6d9b6d con i 3 pick OpenCL; vendor diff verificato = diff upstream
> 87/11/16/41/33/65). Decisione owner n.3 (APK) in esecuzione; n.2 (pick)
> chiusa lato fork + APK-B per il confronto al rientro.

> **3/09 notte, 22:30 — APK-A PRONTO (decisione owner n.3 CHIUSA nella forma
> baseline).** Run 33826825621 su main c513f00 verde in ~35 min: artifact
> `kalsa-apk-arm64-v8a-c513f00…`, app-release.apk 135 593 407 B, **sha256
> e0d56a398bbd1cb102dbab635272b7b88c43b22e6cd8896538c313603b774403**,
> scaricato in ~/kalsa-qdc/apk/apk-A-c513f00/ (APK-A.sha256). È il primo APK
> CI del `main` fuso, assemblaggio device-proven (pin a0cabca6b) — mai
> installato su telefono (lab zero fino ~13/09). APK-B (pin 12f6d9b6d): primo
> run 33826834623 CANCELLATO dal runner a 28 min dentro Gradle senza errore
> di compilazione (unico run sul branch, non è la concurrency) → rilanciato.

> **3/09 notte, 22:40 — CELLA #59 IN VOLO (HDK8550 job 798484, host
> sa802553, 45 min prenotati).** Driver scritto da grok→Luna, doppio audit
> mimo (F1 PULL_FAIL re-entry e F2 gating A2 applicati da grok; nel secondo
> giro: NO_BINARY "mancante" REFUTATO — era la variabile dell'esperimento
> F2b, non la baseline; guard del fallback -n0→-n1 allargato a
> `dspqueue|fastrpc|qurt_exit|0x2e`). Nota device: l'HDK8550 monta Android
> 16 (S23 era 14) — da dichiarare nel REPORT come confound residuo.

> **3/09 notte, 22:50 — #59 ESEGUITA: LA MORTE v73 REPLICA SU HDK8550 (G1).**
> Primo lancio VOID (`--load-mode` non esiste in questo lignaggio → `--mmap
> 0`, emendamento pre-dato). Poi A1 (HOSTBUF unset) e A2 (HOSTBUF=1 +
> --no-host 1) muoiono ENTRAMBI con `dspqueue_read failed: 0x0000002e` dopo
> 48 dispatch esperti — proof 484/48/48 identica all'S23 q48, tombstone
> presi. Build più nuovo, board di riferimento, Android 16, modello allenai:
> la morte è dello stack HTP v73 sotto dispatch MoE, non dell'S23. F6
> confermata su reference hw; dossier #8 ha un repro QDC. 27.8 min fatturati
> (7 di lavoro + ~20 idle: End Session passato solo al secondo ref-click —
> lezione 7 rafforzata: End + Yes via ref, reload, leggere Ended On entro 1 min). REPORT
> scritto, audit in coda. **APK-B PRONTO**: retry run 33829826282 verde,
> app-release.apk 135 593 407 B sha256
> 1e2709e57561e97149664ea30588b7df9141c25a6813642cdda1c3ddf9d7f86d
> (~/kalsa-qdc/apk/apk-B-09bdfe9/); verifica differenziale sulla lib
> `librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so`: A 10 750 296 B sha
> 35a15613 vs B 10 756 296 B sha 91e2a1b9, fingerprint dei pick (`q1u`=2,
> `WG_SIZE > FA_SG`=2) presenti SOLO in B; q23k=4 e marker=1 in entrambi →
> i 3 pick sono dentro APK-B e non in APK-A, come voluto.

> **3/09 notte, 23:20 — NOTTE CHIUSA: LE QUATTRO DECISIONI SONO CHIUSE.**
> (1) Amendment 750 → #58 (riga 41). (2) Merge pick → fork-main @12f6d9b6d
> + APK-B. (3) APK → APK-A e0d56a39… (pin proven) + APK-B 1e2709e5… (pin
> pick), entrambi in ~/kalsa-qdc/apk/, mai installati su telefono. (4) Cella
> NPU → #59 (riga 42): morte v73 replicata su HDK8550, F6 confermata
> stack-bound (audit: non dire 'arch-bound'). Lato app: feat/moe-stream
> mergiato in main (c513f00, E2E verde 63 min). Budget QDC ≈ 912(7xx) +
> 946(8G2) + 970(8G3) + 981(8sG3) + 623(8E). Prossimi (al risveglio owner):
> cella discriminante host-vs-DSP per lo 0x2e (rebuild alla base S23-era o
> strace del flush path), dossier #8 upstream con il repro QDC (solo LETTURA
> del repo terzo, nessun push), test APK-A/B su QDC via installazione APK.

> **4/09 mattina presto, 01:30 — #60 STEP 0 CHIUSO A COSTO QDC ZERO: LO 0x2e È
> UN SINTOMO, IL FAULT È `htp/main.c:729` (mmap_buf → HAP_mmap = -1 su v73).**
> Il logcat della #59 conteneva già il crash report cDSP (`abort()` da
> `libggml-htp-v73.so htp_iface_start+0x1348`, PD morto → status 3 →
> `dspsignal_wait` 0x2e sul host). Disassembly del medesimo skel con
> hexagon-llvm-objdump (container Docker snapdragon-toolchain, HEXAGON_Tools
> 19.0.07): 0x3E58 = ritorno dalla `call abort` a 0x3E54 con `r2=#0x2d9`=729
> e la stringa "mmap failed : va %p fd %u size %u" — v73 usa `HAP_mmap`
> (len int) senza fallback, v75+ `HAP_mmap2`. #59 mappava 3.57 GiB in 8
> buffer (3×~1 GiB; MBUF default 1 GiB). Non è quindi né "host flush path"
> né (per ora) firmware: è lo skel che abortisce quando una mappatura pesi
> fallisce. Cella #60 (qdc-8g2-npu-mmapbudget-60, PREREG+DISASM scritti):
> B1 `-ngl 8` vs B2 `-ngl 99 MBUF=512` discriminano budget VA cumulativo (H1)
> da limite per-mappatura (H2); B3 `-ngl 12` bracketa, B4 tg128. Driver da
> Luna, audit mimo, HDK8550 30 min. Dossier #8 = aggiornare
> docs/upstream-v73-hexagon-report.md (esiste, 3 firme S23), non un file nuovo.

> **4/09, 06:15 — #60 ESEGUITA (HDK8550 job 798892, 8.5 min): LA MORTE v73 È UN
> FALLIMENTO DI ALLOCAZIONE VA SUL DSP, E L'OFFLOAD PARZIALE VIVE (ANCHE IL DECODE).**
> Sei arm: `-ngl 8` VIVE (proof 189), `-ngl 12` VIVE (297, 2.48 GiB mappati),
> `-ngl 8 tg128` VIVE (2688 dispatch: primo decode NPU v73 mai registrato);
> `-ngl 99` con MBUF=512 MUORE, con VMEM=1800 MUORE (entrambi :729, proof 48);
> VMEM=0 misura 3 GiB ma poi non carica più (probe distruttiva). Il file
> `llama-bench.farf`=0x1F ha FUNZIONATO: logcat `adsprpc` mostra la catena
> `qurt_vtlb_mmap: unable to get virtual address` → `Error 0x80000483
> fastrpc_mmap failed` → `HAP_mmap2 failed for fd 27 length 698355712` →
> `mmap failed : va FFFFFFFF` → abort. Con ~0.53 GB (B2) e ~1.08 GB (B5) vivi
> al fallimento, dopo cicli map/unmap: FRAMMENTAZIONE VA del PD a 32 bit, non
> solo budget (upstream #26501/#28202 del 27/08-2/09 toccano proprio questo,
> non nel nostro kit). Websearch: issue upstream #26123 (aperta, luglio) =
> stessa classe su 8 Gen 2; Qualcomm fastrpc #137: VA cDSP 2 GB vecchi/3 GB
> 8gen3. Grid: G1b. F6 da RIFORMULARE (v73 ok sotto ~2.5 GiB residenti, muore
> a 3.6 GiB in questo build). REPORT scritto, audit mimo in corso; #61
> candidata = stesso driver su kit con #26501+#28202. Sessione chiusa al primo
> ref-click (Ended On 06:11:27).

> **4/09, 07:10 — #60 BANCATA (ALIVE riga 43).** Audit 1 (mimo): tre BLOCKER,
> tutti refutati sui raw con timestamp (fd24 distrutta a 49.691 prima di fd26;
> 8 destroy di B3 al teardown; 3221225472 B = 3.00 GiB); mimo poi morto in
> loop aritmetico nel delta → delta rifatto da deepseek (Reviewer bench):
> refutazioni CONFERMATE, BANK-WITH-FIXES (citazione objdump trascritta in
> DISASM, wording). F6 riformulata (v73 viabile ≤ ~2.5 GiB residenti, senza
> churn). Prossimi: dossier #8 aggiornato con il meccanismo; #61 APK smoke su
> QRD8650 (PREREG scritto, driver Luna 257 righe, audit mimo in corso);
> #61-NPU kit con upstream #26501+#28202 da costruire (CI/Docker).

> **4/09, 08:05 — #61 ESEGUITA: LA APP FUSA GIRA SU HARDWARE REALE (QRD8650,
> Adreno 750). APK-A e APK-B installano, caricano il gguf ship sideloadato
> (1 593 894 944 B, riconosciuto senza download), rispondono a un prompt:
> A 129 token a 26.4 tok/s, B 196 token a 26.0 tok/s (CPU: `offloaded 0/31
> layers to GPU` — la nota assenza dell'implementazione GPU nell'app, ora vista
> su hardware). Screenshot headless raw/A_sa803030.png: header "LFM2.5 2.6B ·
> QAD-Q4_0 · Ready · local" + risposta coerente. Prima app fusa su telefono.**
> Costo: 2 sessioni (23 + 31 min): 1° tentativo morto su `run-as: package not
> debuggable` (gli APK release di CI NON sono debuggabili → percorso root, la
> board è userdebug con adbd root) + bug set -u; 2° tentativo: schermo spento
> (Dozing) → nessun DB → wake+dismiss-keyguard nel driver. Il segnale S4 del
> PREREG (`KALSA_SESSION op:load`) era il restore della sessione KV, non il
> load del modello (errore della recon): il ledger dice S4 fail, il REPORT
> lo rilegge sui raw (llama_model_loader + PREWARM 1319 token in 9.4 s).
> Artefatto app: `promptMs` 411 s con 15 token nuovi (timer partito al prewarm).
> Dossier #8 aggiornato e auditato ACCEPT (commit 0b517d07, nessuna issue).
> Kit mmapfix: cherry-pick di #26501/#28202 IMPOSSIBILE (conflitti) → build
> puro da upstream/master in corso (npu-kit-62-upstream). REPORT #61 in audit.

> **4/09, 08:30 — #61 BANCATA (ALIVE riga 44, G1-AMENDED: l'owner ratifica
> l'emendamento del criterio S4/banner).** Audit mimo DO-NOT-BANK → 5 fix
> applicati (verdict rietichettata, alternative per promptMs, inferenza .so
> dichiarata non supportata, log driver in raw) → delta BANK-WITH-FIXES.
> Tre lavori del mini-prompt CHIUSI: #60 (riga 43), dossier #8 (0b517d07),
> #61 (riga 44). In volo: kit puro upstream (container 11a6…, grok su docker
> wait); container zombie `clever_brown` del 2/09 (bash appeso, 0% CPU) da
> pulire a mano. Budget QDC ≈ 912(7xx)/935(8G2)/913(8G3)/981(8sG3)/623(8E).

> **4/09, 08:50 — #62 ESEGUITA (HDK8550 job 798985, 7.9 min): IL KIT PURO
> UPSTREAM (64a155d24, con #26501+#28202) MUORE SU v73 A QUALSIASI TAGLIA —
> `-ngl 8` e `-ngl 99`, MBUF=512 e VMEM=1800 — con TLBMISS RW in
> `op_binary+0x50E4` (`binary_job_vector_same_shape`, loop vadd f32), thread
> `work-queue:N`, ZERO righe FARF di mmap: non è la morte di mapping, è la
> SIGNATURE 1 dell'S23 (q50, TLBMISS in op_binary) che riappare su board di
> riferimento con upstream master. Il nostro kit (022458a28 + commit kalsa)
> NON la mostra (#60: ngl 8/12 vivi). Per il PREREG: U1 morto → METHOD-VOID
> sulla domanda del mapping fix + H4 nuovo finding. Conseguenze: (1) bisect
> 022458a28..64a155d24 o kit ibrido per rispondere al mapping; (2) dossier #8:
> fatto upstream-facing forte (repro pubblico: upstream master + HDK8550 +
> OLMoE Q4_0 → crash a ogni -ngl). Kit rebuild: cherry-pick impossibile
> (23/7 file in conflitto); preset upstream android-34. REPORT in audit.

> **4/09, 09:05 — #62 BANCATA (ALIVE riga 45).** Audit BANK-WITH-FIXES: FIX-1
> applicato (righe ANON benigne), FIX-2 REFUTATO dai raw (`Bad VA 0x0` +
> `Error code 0x7003` identici a q50 → stesso modo NULL-deref). Prossimi:
> addendum dossier #8 con il repro upstream-master; bisect o kit ibrido per
> la domanda del mapping. Budget QDC ≈ 912/926/913/981/623.

> **4/09, 09:40 — OWNER: "approvo tutte le decisioni, soprattutto apk debug".**
> Ratifiche registrate in STATO CORRENTE; priorità: APK debuggable (apk.yml
> variante debug-release, sha, smoke #61-bis su QDC via run-as). Regola:
> aggiornare sempre tutti i docs.

> **4/09, 11:00 — OWNER: "Non aprire nessuna issue upstream. O fixiamo noi
> stessi o lasciamo perdere".** Decisione 4 riscritta: il dossier #8 è solo
> interno; per la TLBMISS/mapping v73 la strada è il bisect + fix nel fork
> (cella #63+) oppure l'abbandono. Ordine di lavoro confermato: (1) APK
> debuggable, (2) #61-bis run-as su QRD8650, (3) bisect 022458a28..64a155d24.

> **4/09, 11:15 — JOB 1 (APK debuggable): NIENTE DA IMPLEMENTARE.** La
> variante esiste già in `.github/workflows/apk.yml` (identico su main
> c513f00 e su chore/engine-pin-12f6d9b6d 09bdfe9): input `debuggable=true`
> → sed `debuggable true` nel blocco release del build.gradle generato dal
> prebuild, poi verifica `aapt2 dump badging` del token
> `application-debuggable`, artifact `kalsa-apk-<abi>-debuggable-<sha>`. Gli
> APK di #61 erano il default `false`. Dispatch fatti: main → run
> 33886959263, chore → run 33886967732 (~35-45 min l'uno, in parallelo);
> watcher scarica in ~/kalsa-qdc/apk/apk-{A,B}-debug-<sha>/ con sha256 e
> controllo badging. Luna prepara PREREG+driver #63 (run-as, no root nel data
> path). Pulizia fatta: container `clever_brown` rimosso (0% CPU), worktree
> kalsallama-wt-mmapfix + branch locale rimossi (nessun commit proprio).

> **4/09, 11:40 — #63 PRONTA (audit GO), #64 TOOLING PRONTO, build step 0 in
> corso.** #63 (scratchpad/agents/qdc-apk-smoke-63): PREREG + driver run-as
> (20 `run-as`, zero chown/restorecon/su nel data path), S0 = flag DEBUGGABLE
> da `dumpsys package`, S4 = `llama_model_loader: loaded meta data … from
> …/files/models/lfm2.5-2.6b/…gguf` + `KALSA_PREWARM "op":"done"` (righe
> #61 raw A:4802/5800, B:5198/6193). Audit mimo GO, 0 blocker; la sua nota
> "flags_rc mai controllato" è FALSA (d_run.sh:214). Aspetta gli APK
> debuggable dalla CI. #64 (scratchpad/agents/qdc-npu-bisect-64): build-kit.sh
> = kit SOLO v73 per commit (~10 min, non 40: configure 0.5 + skel 4 + host
> 2.5), BISECT.md con i 23 commit hexagon (index 12 = 990e3bfee #27042);
> step 0 = upstream PURO 022458a28 (mai provato: il nostro kit ha patch
> kalsa) in build ora (container kalsa-bisect-022458a, runner pid 68323),
> poi il midpoint. Audit tooling in corso. aapt2 installato sul Mac
> (openjdk@17 formula + build-tools 35 via sdkmanager, niente sudo).

> **4/09, 11:52 — APK DEBUGGABLE A/B PRONTI; KIT STEP 0 PRONTO; sessione #63
> creata.** CI: A run 33886959263 → `apk-A-debug-c513f00/…/app-release.apk`
> sha256 c645f691a9d16a896415a25d90bd3e179c7d9743c9bcdbde17603017112b0adc;
> B run 33886967732 → `apk-B-debug-09bdfe9/…/app-release.apk` sha256
> 1b8e2793a63d182a1fe422a50519e246d8d4d4e4ce510ed2660c6cbbf8370a46; entrambi
> 142 033 466 B, `aapt2 dump badging` sul Mac: `application-debuggable`
> PRESENTE (la release di #61: assente). Kit bisect step 0
> `npu-kit-bisect-022458a.tgz` sha e8f5cfd1…, 39 voci, skel v73 711 880 B.
> Tre fallimenti onesti prima del kit: (1) Luna ha editato build-kit.sh 2 min
> DOPO il lancio del runner → bash legge lo script a pezzi → "unexpected end
> of file" (lezione: mai editare uno script in esecuzione); (2) `cmake
> --install` esige tutte e 4 le skel HTP; (3) e tutti i test binari → install
> eliminato, il kit si assembla dal build tree (`build-snapdragon/bin` + skel
> v73). macOS non ha `setsid`. Build midpoint 990e3bfee in corso (container
> kalsa-bisect-990e3bf). Sessione QDC 799128 `kalsa63-apkdebug-runas-qrd8650`
> (SSH only, 45 min) submitted 11:51.

> **4/09, 12:00 — #64 PREREG + DRIVER PRONTI (audit NO-GO → fix → GO).**
> PREREG: step 0 = upstream puro 022458a28 a `-ngl 8` come gate del range
> (BAD → range invalido, si studia il diff delle patch kalsa); poi bisect
> binario sui 23 commit hexagon (index 12 = 990e3bfee), verdetto per commit
> dal solo `up_ngl8`: BAD = famiglia TLBMISS/Bad VA/0x7003, GOOD = exit 0 con
> n_exps_htp0=24, OTHER = stop; `up_ngl99` registrato per la domanda mapping.
> Cap 6 sessioni HDK8550 (~60 min). Driver = #62 parametrizzato per sha7
> (kit npu-kit-bisect-<sha7>.tgz, raw/<sha7>/, D=kalsa64). Audit mimo:
> NO-GO perché exit 0 senza prova HTP tornava GOOD → fix (rc 11 + un re-run,
> poi METHOD-VOID), delta audit GO. Audit tooling: GO-WITH-FIXES; la "build
> dir stale fra commit" è REFUTATA (worktree per sha7). Build step 0 in corso
> (host 442/445 alle 11:42): la stima "10 min" era ottimista, sono ~25.

> **4/09, 12:50 — #64 STEP 0 (sessione 799155, HDK8550 Android 14, job
> sa803224): upstream PURO 022458a28 a `-ngl 8` è GOOD** (exit 0,
> n_exps_htp0=189 come le B-arm di #60) **e a `-ngl 99` muore con
> `dspqueue_read 0x2e`** (la morte di mapping del nostro kit, non la
> TLBMISS). Range del bisect VALIDO: la TLBMISS entra dopo 022458a28.
> Midpoint 990e3bfee (index 12) lanciato nella stessa sessione.

> **4/09, 12:55 — #63 BANCATA (ALIVE riga 46): l'APK debuggable passa TUTTO
> via run-as su QRD8650, G1.** Sessione 799128 (45 min, cap raggiunto), 5
> tentativi: 1) `run-as: /data readable or writable by others: 40777` — la
> board QDC ha `/data` 0777; 2) dopo `chmod 771 /data`: S0-S4 ok su A e B,
> S5 void per keyguard (board NON USB-powered → `svc power stayon` no-op);
> 3) `/data` tornato 0777 da solo (demone QDC) → run-as rotto a metà run;
> 4) holder `chmod 771 /data` ogni 2 s: B passa tutto (223 tok, 23.5 tok/s),
> A void a S5 (schermo caduto tra type e Send); 5) A e B S0-S7 (A 90 tok
> 23.6 tok/s, B 65 tok 23.8 tok/s). Tre emendamenti pre-dato nel PREREG,
> tutti interventi sullo stato della board fuori da /data/data. REPORT (Luna)
> audit mimo BANK-WITH-FIXES (2 fix applicati). Lezioni QDC: `/data` va
> tenuto a 0771 con un holder; keyguard via `locksettings set-disabled true`;
> il nome sessione ha max 30 caratteri (form Angular resta invalido in
> silenzio). Budget 8G3: 911 → ~866.
>

> **4/09, 13:00 — #64 STEP 1: index 12 (990e3bfee, #27042) è BAD** — a
> `-ngl 8` muore dopo 21 op con `crashed in thread "work-queue:0" due to
> TLBMISS RW`, Fault PC `op_binary+0x5B9C`: la firma di #62/S23. Culprit fra
> gli index 1..12; prossimo index 6 (`0278d83`, #25974 "activation ops
> update"), kit in build (~30 min). Un run VOID onesto: il primo "990e3bf"
> aveva ereditato il kit di step 0 (resume guard del driver #62 saltava anche
> il push del kit) → driver corretto (kit sempre rimosso e ri-pushato, sha
> tgz nel log), raw quarantenato. Sessione 799155 chiusa a mano (~10 min).
> BISECT-LOG.md nel cell dir tiene la tabella dei verdetti.

> **4/09, 13:35 — #64 STEP 2: index 6 (0278d83, #25974 "activation ops
> update") è GOOD** (sessione 799162, ~6 min: `-ngl 8` exit 0 con 189 exps;
> `-ngl 99` la solita morte di mapping 0x2e). Culprit ∈ index 7..12:
> 7 c0bc859 (op_poll Windows fix), 8 0a50d99 (pipeline L2/DMA/MM/FA #26049),
> 9 355303e (im2col), 10 153d324 (load-mode auto), 11 fe8156f (rope offset),
> 12 990e3bf (BAD). Index 9 in build (~14:05), poi 8 e 11 in coda
> speculativa. Lezione: `pkill -f` col nome dello script ha ucciso anche il
> runner sequenziale → usare i PID. Sessioni oggi: 799128 (45), 799155 (~10),
> 799162 (~6). Budget 8G2 ≈ 923 → ~905.

> **4/09, 14:10 — #64 STEP 3: index 9 (355303e, im2col #26007) è BAD**
> (sessione 799168, ~7 min; TLBMISS in `work-queue:2`, Fault PC 0x20089EEC).
> Culprit ∈ {7, 8, 9}: 8 = #26049 "further improved pipeline (L2, DMA, MM,
> FA)" è il sospetto principale, kit in build (~14:35); 7 (#26029, fix
> Windows op_poll) solo se 8 è BAD. Al massimo 2 sessioni ancora.

> **4/09, 14:30 — PIVOT PRODOTTO.** Owner: "a che punto siamo del goal?" →
> risposta onesta: motore avanti, app ferma (cpu-only statico, niente
> governor, niente NPU, termico solo banner). Owner: "rileggiti tutto". Fatto:
> memorie app-side, HARNESS_FINDINGS §7.33/§7.7g-i, governor-v0/PLAN, e digest
> Luna `docs/GOVERNOR-STATE-2026-09-04.md` (mimo aveva allucinato un intero
> report: escluso dai recon larghi). Righe portanti verificate su disco:
> contratto v0.2 ha GIÀ input batteria/temperatura/plugged/trend e soglie
> termiche; l'app non li alimenta. STATO CORRENTE riscritto sul piano a 9
> giorni: governor nell'app → fit GPU → loop termico → lane NPU. Bisect #64
> resta in background.

> **4/09, 14:50 — #64 STEP 4: index 8 (0a50d9909, #26049 "further improved
> pipeline of the core bits (L2, DMA, MM, FA)") è BAD** (sessione 799176,
> ~8 min, coda 9 min; TLBMISS `work-queue:1`, Fault PC 0x20089ECC). Culprit
> ∈ {7, 8}; index 7 (#26029, fix Windows op_poll, minuscolo) in build: se
> GOOD, il colpevole è #26049. Ultima sessione del bisect a seguire.

> **4/09, 15:05 — #64 CHIUSO: CULPRIT = 0a50d9909 (upstream #26049
> "hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA)").**
> Index 7 (c0bc859) GOOD nella stessa sessione 799176 (modello riusato, kit
> ri-pushato): tabella monotona GOOD {pin, 6, 7} / BAD {8, 9, 12}, sei
> sessioni, ~44 min del pool 8 Gen 2. Il commit tocca L2 dirty-range flush,
> HVX reduce_max, MM bias in VTCM, mmid row-mapping, HMX tiling, FA DMA.
> Confound dichiarato: solo i commit hexagon erano candidati. Aperto: la
> morte di mapping a `-ngl 99` (0x2e) c'è su OGNI commit del range, pin
> incluso → #26501/#28202 (fuori range) restano da provare con #26049
> revertato/patchato. REPORT in scrittura (Luna) → audit → ALIVE 47.

> **4/09, 15:20 — FASE 1 GOVERNOR: piano APPROVATO.** `docs/PLAN-governor-in-app.md`
> (Luna) → audit deepseek APPROVE-WITH-FIXES (11 refutazioni/lacune: path
> CMake, pin 3 commit/6 file, oracolo di correttezza greedy prima della
> velocità, fallback dopo il doppio load con `KALSA_GOVERNOR_FALLBACK`,
> BatteryManager nativo, test Reject→CPU, n_ubatch 256 di produzione con
> bound 3.46-3.94 GiB per due contesti del 2.6B) → fix → delta APPROVE.
> Emendamento mio: le board QDC non hanno temperatura batteria → override
> di bench `kalsa.bench.thermo` da `dumpsys thermalservice` (skin), marcato
> `thermo_source: bench-skin`; in produzione solo BatteryManager, mai profili
> sintetici. S1 (rebase governor su 12f6d9b6d + build/test macOS) in corso
> su grok, worktree kalsallama-wt-governor-v03.

> **4/09, 15:40 — S1 FATTO (grok) + audit Luna GO-WITH-FIXES.** Ramo
> `kalsa/governor-v0.3-on-12f6d9b6d` @8665e9a9f in kalsallama-wt-governor-v03:
> rebase 28/28 identico (range-diff tutto "="), OpenCL byte-identico, build
> macOS ok, `router_v02_golden/metrics=PASS`, bench C 3×3 su LFM2.5-2.6B:
> ttft 10087 ms / decode 19.6 t/s (Mac CPU, riferimento), G fail-fast senza
> acceleratore (atteso). Fix richiesti = lavoro di S2: l'overlay dell'app
> (`scripts/sync-kalsallama.sh`) non copia i 14 file governor/kv-commit/
> hybrid-commit; S1 non prova nulla su Android. S2 parte ora (Luna) in un
> worktree dedicato dell'app (`kalsa-wt-governor`, branch
> `feat/governor-in-app` da main) per non pestare la sessione UI.

> **4/09, 16:00 — S2 CONSEGNATO (Luna), audit grok in corso, CI in volo.**
> Worktree app `/Users/marco/Projects/kalsa-wt-governor`, branch
> `feat/governor-in-app` (pushato su Aspis0/kalsa, MAI il fork): 414b494 pin
> → 8665e9a9f + overlay dei 13 file governor/kv-commit/hybrid-commit nel
> vendor; 67c9f7f patch llama.rn con `rn-governor.{h,cpp}` (owner a due
> modelli + `llama_governor_init` come il bench di riferimento), accessor
> `active_ctx()`/`decode()` su tutti i siti decode/ctx (completion, slots,
> MTP, JSI), sessioni rifiutate in governor mode, `KALSA_GOVERNOR_FALLBACK`.
> Patch 2747 righe (sana). `clang++ -fsyntax-only` ok su tutti i file; CI APK
> debug run 33916141291 sul branch. Non ancora provato con un modello vero.

> **4/09, 16:20 — AUDIT S2 (grok): NO-GO.** Blocker vero: in governor mode
> `loadModel` ritorna dopo `load_governor_models` (rn-llama.cpp:604-606)
> saltando templates/n_ctx/completion (667-687) → primo completion su
> nullptr e n_ctx=0. Altri: FALLBACK non emesso sui fallimenti di load dei
> due modelli, thermo non impostato prima del primo decode, usi raw di ctx
> (clearCache/LoRA/mmproj) in governor mode, `reload_budget_available`
> permissivo, zero test. Fix in corso (Luna) → re-audit → CI.

> **4/09, 16:40 — #64 BANCATA (ALIVE riga 47).** REPORT (Luna) → audit
> deepseek BANK-WITH-FIXES (righe di BISECT.md sfalsate di −6, conteggio
> sessioni: 6 run in 4 sessioni ≈ 46 min, path degli script, clausola pkill
> non supportata) → fix applicati e ricontrollati. Primo audit deepseek
> bloccato da path relativi con cwd nel repo app (`find` sulla home):
> path assoluti sempre. Worktree del bisect rimossi (kit tgz conservati).

> **4/09, 16:50 — CI APK debug del branch `feat/governor-in-app` (run
> 33916141291, commit 67c9f7f pre-fix) VERDE:** overlay dei 13 file governor
> + patch llama.rn con rn-governor compilano su Android (NDK, arm64), assert
> del marker nativo passato. Non dice nulla sul runtime (il NO-GO resta).

> **4/09, 17:05 — S2 v2 (Luna): 7/7 finding del NO-GO chiusi** — commit
> b3a6137/1766cd3/42ddcf4: load governor converge su templates/n_ctx (da
> `active_ctx()`)/metadata/n_seq_max/completion/ctx_shift (rn-llama.cpp
> 629-784); `KALSA_GOVERNOR_FALLBACK` a ogni stadio (load acceleratore, load
> CPU, init, Reject) con {stage, models_loaded, reason, gpu_fit,
> profile_valid}; thermo parsato al load e impostato prima del primo decode,
> profilo invalido → throw `governor: thermo profile invalid` prima di ogni
> load; LoRA/mmproj/parallel/MTP/sessioni/clearCache rifiutati a voce alta;
> `reload_budget_available=false` di default; test C++ del parser
> (`scripts/governor-params-test.cpp`, PASS). Patch 3174 righe. Delta audit
> grok in corso; CI run 33922285427 in volo. Il retry CPU resta in S4.

> **4/09, 17:20 — DELTA AUDIT S2 (grok): GO-WITH-FIXES.** Crash chiuso;
> residui: una sola riga FALLBACK sul Reject di init (stage route_reject),
> `moe_stream.reset()` al reload CPU↔governor, test del parser compilato
> con exit code. Accorpati al brief S3+S4 (Luna): modulo Kotlin
> `GovernorBatteryModule` (BatteryManager: temp decimi, %, plugged,
> sensorValid), JSI `setGovernorThermo`/`getGovernorStats`,
> `src/engine/governorInputs.ts` (generation da SoC, model_kind dal
> registry, gpu_fit con termine §7.18, override `kalsa.bench.thermo`),
> wiring LlamaService dietro flag `kalsa.governor.enabled` (default OFF)
> con retry CPU unico su FALLBACK e riga `KALSA_GOVERNOR` per turno; jest
> sui moduli nuovi; CI a fine step. Solo `src/engine`, mai UI.

> **4/09 sera (18:00 → 5/09 00:30) — S2 residui su disco, S3 in corso, repo
> riordinato.** Luna (bf40dcfe) ha committato i 3 residui del delta audit S2 in
> `74390c5` (verificati da me nel patch: stage `route_reject` con UNA riga
> `KALSA_GOVERNOR_FALLBACK`, `moe_stream.reset()` al reload CPU↔governor,
> `scripts/governor-params-test.sh` con exit code registrato + script
> `test:governor-params` in package.json) e sta costruendo S3 (Kotlin
> `GovernorBatteryModule`, JSI `setGovernorThermo`/`getGovernorStats`). CI
> 33922285427 su 42ddcf4 **VERDE** (native compila con fallback a stadi + convergenza post-load). Memoria compattata per l'owner
> (state-2026-09-01.md → "PUNTO FINALE 4/09 SERA"). **Riordino repo (owner):**
> PLAN.md 2433→~1460 righe (990 righe di capitoli chiusi di agosto spostate
> verbatim in PLAN-archive.md), README riscritto (era falso: "nessuna
> dipendenza dall'app"; ora mappa dei 4 repo, layout, regole, lab QDC), i due
> .txt con spazi nel nome in `docs/archive/`. Nel repo ci sono file NON miei
> (`scratchpad/design/leaf-fold-v9.html`, `audit-lot-a-2026-09-02/A1-LEAF-*`,
> `mimo-lot-b-map-2026-09-04/`) dell'altra sessione Claude sull'app: lasciati
> fuori dal commit.

> **5/09 — CI 33932740946 su c5c55a4 VERDE: primo APK con governor + contratto
> bench compilato.** Artifact in `~/kalsa-qdc/apk/apk-gov-c5c55a4/`, sha
> `12ecb73145ca…3284`, 142,751,510 byte, `application-debuggable` ✓. **PREREG S5
> LOCKED** con identità APK; host QDC per sessione nei raw. Prossimo: sessione
> QDC `S5-QRD8650` (45 min), tunnel 6037, `d_run.sh <job> <apk> ABABABAB`.

> **5/09 — Fix `shouldUseMTP()` consegnato (ee4741e9, `db1606c`, pushato):**
> `rn-completion.cpp:721` e `rn-slot.cpp:335` ora `return false` in modalità
> governor (verificato da me); i chiamanti prendono il decode semplice. Tabella
> dei throw gated da `hasGovernor()` rimasti: rn-llama.cpp 788 (draft MTP,
> init), 921/953 (LoRA), 972 (multimodal init), **1117 (`clearCache`, che
> l'app chiama a `LlamaService.ts:848` su hash-miss del prewarm da idle →
> potenziale throw in sessione normale)**, JSI 834. → Delta audit 2 a grok con
> tracciamento obbligatorio dei call-path fino all'app. CI 33936537090 in volo
> (waiter scarica l'APK in `~/kalsa-qdc/apk/apk-gov-db1606c/`). Driver: Luna
> 5fcd34c9 su `local`/set -u dry-run + MemAvailable + lmkd globali.

> **5/09 — Delta audit 2 (grok, db1606c): GO-WITH-FIXES per il run 2.** Fix
> MTP confermato con call-path completo: `createMTPDraftContext` è raggiungibile
> solo via `shouldUseMTP()`/`should_use_mtp()` (ora false) → irraggiungibile.
> Tabella dei 9 throw `hasGovernor()`: 7 UNREACHABLE (LoRA, multimodal
> mutuamente esclusivo con `governorLoad`, parallel, thermo inverso, session
> load su fresh install); **2 REACHABLE ma inghiottiti**: `clearCache`
> (hash-miss settings `:848`, translate `:3922`, completeOnce `:4034` — throw
> catturato, ma i KV NON vengono puliti: no-op silenzioso) e session save
> (`:2115`, persist in background dopo il turno, catch `:2234`). Nessuno dei
> due tocca il flusso S5 (fresh install → prewarm → un turno). **Follow-up
> obbligatorio dopo il run 2:** clearCache in governor = pulizia di ENTRAMBI i
> KV o reload CPU + riga FALLBACK; session save in governor = skip esplicito
> loggato. Una riga `KALSA_GOVERNOR` + una `KALSA_BENCH_TOKENS` per turno
> confermate (`:3247-3249`).

- **2026-09-05 — S5b run 4 BANCATA (ALIVE 49)**: GPU/CPU prefill 3200.7/5945.2 ms su 925 token nell'app (8 Elite), 0.538; endpoint NOT MET (1 coppia, oracolo 1 token); REPORT BANK, fix run 5 GO. Raw `scratchpad/agents/qdc-governor-s5b/raw/sa805734`. **Run 5b (raw sa806366b): +3 GPU 3324-3326 ms, 0 A valide (plateau skin 37,1-37,3); addendum REPORT + delta #8 GO; run 6 = target per braccio.** **Run 6 BANCATA descrittiva: 2 coppie stesso-turno → 1,81× (PASS-1 esplorativo), strict NOT MET; REPORT BANK (deepseek). Raw `raw/sa806967`.**

*(voci ≤ 2026-08-11 in `PLAN-archive.md` → «Registro checkpoint (archivio)»)*

> **5/09 ~01:00 — S3+S4 CONSEGNATI da Luna (bf40dcfe), audit ostile in
> volo.** Commit su `feat/governor-in-app` (pushato su Aspis0/kalsa):
> `05ad253` (Kotlin `native/GovernorBatteryModule.kt` 57 righe + plugin Expo
> `plugins/withGovernorBattery.js` + JSI `llamaSetGovernorThermo` /
> `llamaGetGovernorStats` nel patch, ora 3462 righe) e `81bcaf2`
> (`src/engine/governorInputs.ts` 168 righe + test, `governorRuntime.ts` 53
> righe + test, wiring LlamaService +164 righe: flag `kalsa.governor.enabled`,
> retry CPU unico con `KALSA_GOVERNOR_FALLBACK_RETRY`, thermo per turno,
> riga `KALSA_GOVERNOR {...}` via JSON). **Verificato da me su disco:** jest
> 7/7 (exit 0), `test:governor-params` PASS (exit 0), il patch tocca solo 24
> file di glue llama.rn (nessun sorgente ggml/llama). CI APK 33927024200 su
> 81bcaf2 in volo. Audit ostile S3+S4 → grok (agente 2f3f58ef), report atteso
> in `docs/AUDIT-S3S4-governor-app.md`.

> **5/09 ~02:00 — Audit S3+S4 (grok, `docs/AUDIT-S3S4-governor-app.md`):
> NO-GO, 2 blocker + 9 major + 5 minori, tutte le righe citate verificate da
> me.** B1: LFM2.5-2.6B non ha `kvBytesPerToken` nel registry → `gpu_fit`
> sempre NoFit → il governor non si sarebbe MAI acceso sul modello ship (S5
> sarebbe stata CPU vs CPU). B2: la validità thermo in JS pretende
> `!plugged || idle calibrato`; l'esempio del piano (plugged:true, senza
> t_idle) era invalido su board USB → piano emendato (plugged:false +
> t_idle_valid/t_idle_c). M1: probe generazione su `Build.MODEL` = "Pineapple
> for arm64" su QDC → Unknown, e Unknown non forzava NoFit → si legge
> `Build.SOC_MODEL`. M2: FALLBACK stantio nel tail dei log riclassifica errori
> qualsiasi come governor. M3: riga `KALSA_GOVERNOR` per ogni round tool /
> prewarm / extract, enum come interi. M4: `sensorValid` senza EXTRA_PRESENT.
> M5: fit a due contesti conta UN compute e UN KV. M6/M7: rifiuto
> speculative/MTP senza FALLBACK; thermo invalido = throw del turno. M8: CI
> 33927024200 ROSSA (timeout Maven, non codice) → non è prova di build. M9:
> mock non resettati, casi d'errore scoperti. Puliti: sicurezza/privacy,
> unità e nomi campo Kotlin→JS→native, patch solo glue. Fix mandati a Luna
> (bf40dcfe) con decisioni prese (kv LFM dai log #63, non inventato; Unknown ⇒
> NoFit; una riga per turno a fine completeChat; enum come nomi; JSI thermo
> ritorna false, mai throw); poi delta audit grok. PREREG S5 in bozza su
> Luna (5fcd34c9) in `scratchpad/agents/qdc-governor-s5/`.

> **5/09 ~02:30 — PREREG S5 in bozza (Luna 5fcd34c9,
> `scratchpad/agents/qdc-governor-s5/`: PREREG 111 righe, d_run.sh 249,
> README-run 15).** Disegno: stessa board/APK/modello, ABABABAB, plateau turni
> 2-4; endpoint 1 = oracolo greedy (32 token ID identici A vs B), endpoint 2 =
> TTFT B/A ≤ 1/3 e decode B ≥ A da `KALSA_TELEMETRY`; secondari: riga
> `KALSA_GOVERNOR` (GPU/CPU, bench-skin), 0 FALLBACK, 0 lmkd, skin pre/post
> turno; thermo bench `plugged:false` + `t_idle_*` dal primo skin (B2).
> **PREREQUISITO APERTO:** l'app non ha una chiave bench per il sampling greedy
> né output dei token ID (`LlamaService.ts:3985` `top_k: 20,` fisso) → serve
> `kalsa.bench.sampling` (src/engine, piccolo) prima del lock; il driver esce 3
> finché non c'è. Da riempire al lock: sha APK, host QDC. Audit pre-run → deepseek.

> **5/09 ~03:00 — Audit pre-run S5 (deepseek, `qdc-governor-s5/AUDIT-PRERUN.md`):
> NO-GO, 2 blocker + 2 major + 6 minori.** B1: il driver non ha il macchinario
> dell'oracolo (atteso: prerequisito aperto) → **contratto definito da me**
> e scritto nel piano (Amendment 5/09): `kalsa.bench.sampling="greedy"` +
> riga `KALSA_BENCH_TOKENS {turnId,n,ids[32]}` per turno; il driver confronta
> le coppie A/B adiacenti, `n<32` ⇒ VOID. B2: `logcat -c` NON svuota il
> buffer `events` (provato nei raw #63: `am_kill` di 5 mesi prima) → ogni
> turno avrebbe contato ≥1 kill e abortito → `-b all -c` + ancora temporale +
> filtro sul pacchetto. M1: `pm uninstall || true` → install -r sopra dati
> vecchi. M2: `mWakefulness` mai letto. Budget: 25 min stimati su 45, zero
> slack → deadline interna 40 min. Fix mandati a Luna 5fcd34c9. L'app
> (`kalsa.bench.sampling`) si fa su una Luna fresca appena bf40dcfe finisce i
> fix S3+S4 (stesso LlamaService.ts, niente edit concorrenti).

> **5/09 ~03:40 — Fix S3+S4 consegnati da Luna (bf40dcfe) e verificati su
> disco.** Commit su `feat/governor-in-app`: `1c4b142` (probe SoC via
> `Build.SOC_MODEL` + `readSoc()`, Unknown ⇒ NoFit, **kv LFM misurato dai log
> #63: 104.00 MiB @ n_ctx 16384 = 6656 B/token** in `ModelRegistry.ts:311`,
> `sensor_valid` passa dalla sorgente, EXTRA_PRESENT, fit a due contesti con
> secondo compute+KV, test 12 GB Fit / 8 GB NoFit), `4df562d` (classificatore
> fallback per epoca di load, tail svuotato al dispose, UNA riga
> `KALSA_GOVERNOR` a fine completeChat, guard `engine === context` dopo
> l'await, `KALSA_NATIVE_VARIANT` con ngl per contesto), `2646e77` (JSI enum
> come nomi, `setGovernorThermo` ritorna false, FALLBACK stage params sul
> rifiuto speculative/MTP, profile_valid reale). Verificato da me: righe
> citate presenti, aritmetica kv corretta, patch 3491 righe solo glue. Jest
> 10/10, tsc 0, npm ci 0, clang syntax 0 (dichiarati da Luna). CI APK
> 33930036540 in volo. **Prerequisito S5 in corso** su Luna fresca (ee4741e9):
> `kalsa.bench.sampling` + `KALSA_BENCH_TOKENS`, in `src/engine` +
> eventuale estensione minima del patch per i token id. Poi UN delta audit
> grok su fix + contratto, poi APK e lock PREREG.

> **5/09 ~04:00 — Driver S5 corretto (Luna 5fcd34c9, commit 874e326b:
> PREREG 125 / d_run.sh 299 / README 16 righe)**: `logcat -b all -c` + ancora
> epoch dal device e conteggi solo dopo l'ancora (`-v epoch` verificato da
> me), lmkd filtrato su pacchetto/pid, oracolo per coppie A/B adiacenti con
> `ids_sha` e colonna `oracle` (PASS/FAIL/VOID), prerequisito verificato a
> runtime (riga `KALSA_BENCH_TOKENS` al turno 1, altrimenti exit 3),
> uninstall gated su `pm list packages`, `mWakefulness` letto e re-wake,
> deadline interna 40 min (exit 124), solo ABABABAB, `kalsa.bench.sampling`
> iniettato in entrambi i bracci. Delta audit → deepseek (706f8d2f, appende
> in AUDIT-PRERUN.md). CI APK 33930036540 (2646e77): completed failure.

> **5/09 ~04:20 — CI 33930036540 (2646e77) ROSSA per CODICE, non Maven.**
> (1) C++: `llama-governor-runtime.cpp:196` chiama il costruttore privato di
> `llama_governor` — la `friend` nel .h dichiara `llama_governor_init_with_params`,
> il chiamante è `..._internal`. Causa radice: Luna ha modificato i file
> governor DIRETTAMENTE nel vendor dell'app (b3a6137, 74390c5) invece che nel
> fork → `vendor/kalsallama-cpp/llama-governor.{h,cpp}` e `-runtime.cpp`
> DIVERGONO dal fork @8665e9a9f (verificato con diff -q). Il syntax check su
> Mac dichiarato da Luna non copriva questi file. **Regola (memoria):** il
> vendor non si edita mai a mano; si fixa nel fork, si bumpa il pin e si
> rigenera con `scripts/sync-kalsallama.sh`. (2) Kotlin:
> `GovernorBatteryModule.kt` importa `com.facebook.react.bridge.ReactPackage`
> (non esiste: è `com.facebook.react.ReactPackage`) → "overrides nothing" +
> mismatch in MainApplication; la CI precedente era morta su Maven prima di
> compilare Kotlin, quindi mai visto. Fix fork → Luna fresca nel worktree
> v03 (un commit sopra 8665e9a9f, build Mac + syntax); poi nell'app: pin bump
> + sync vendor + import Kotlin, dopo che ee4741e9 (sampling) ha finito.

> **5/09 ~04:45 — Delta audit driver S5 (deepseek): GO-WITH-FIXES, 0 blocker,
> 1 major, 4 minori.** B1/B2/M1/M2/budget/m1-m6 tutti FIXED o PARTIAL
> verificati riga per riga. Nuovo D1 (major): il poll telemetria esige n≥32
> token → una risposta greedy corta per EOS farebbe scadere i 600 s e
> abortire la sessione, mentre il contratto la vuole VOID-e-continua → poll
> su tokensPredicted≥1, n≥32 solo nell'oracolo. D2: dump logcat extra dopo il
> match telemetria (KALSA_BENCH_TOKENS arriva ms dopo). D3: `list_rc` sempre
> 0. D5: `governor_count==1` conterebbe anche il prewarm → seconda ancora al
> Send. Fix a Luna 5fcd34c9. Puliti: parse_tokens, quoting, 13 colonne TSV,
> evidenze prima di ogni exit.

> **5/09 ~05:00 — Fix nel fork consegnato (Luna a51f22b6): `e131345b7`
> "governor: expose init failure reason, fix friend/ctor access" sopra
> 8665e9a9f, un commit.** `llama_governor::failure_reason()`, friend corretta
> su `llama_governor_init_with_params_internal(..., std::string*)`
> (`src/llama-governor.h:29-34`, verificate da me). Build Mac 0, router test
> 0, syntax check Android 0. Branch `kalsa/governor-v0.3-on-12f6d9b6d`
> pushato su Aspis0/kalsallama (backup; la CI app compila dal vendor). Nota:
> le "174 differenze" vendor/fork sono la rinomina `lm_ggml_` del sync
> script, non divergenze; quelle vere erano i 3 file governor. Prossimo, nel
> worktree app appena ee4741e9 committa: pin → e131345b7, `sync-kalsallama.sh`,
> import `com.facebook.react.ReactPackage`, CI.

> **5/09 ~05:30 — Contratto sampling nell'app consegnato (Luna ee4741e9,
> `826fe50`, pushato)**: `src/engine/benchSampling.ts` 50 righe + test 69,
> riga `KALSA_BENCH_TOKENS {turnId,n,ids}` alle due uscite di completeChat
> (`LlamaService.ts:3250,3561`, verificato), id raccolti in greedy via
> `n_probs:1` e `generated_token_ids` (primi 32) esposti dal JSI nel patch
> (ora 3538 righe). Jest 5/5, tsc 0, npm ci 0, syntax 0 (dichiarati).
> Driver S5 D1-D5 fixati (7fe207ca): poll su tokensPredicted≥1, n≥32 solo
> nell'oracolo (VOID-e-continua), dump extra +2 s, `list_rc` reale, seconda
> ancora al Send. **In corso su ee4741e9:** pin → e131345b7 + sync vendor
> (prova: righe `failure_reason`/friend nel vendor, diff solo sui 3 file
> governor) + import `com.facebook.react.ReactPackage` + CI APK debug. Poi
> delta audit grok unico (fix S3+S4, contratto, vendor, Kotlin), poi lock
> PREREG con lo sha dell'artifact.

> **5/09 ~06:00 — Pin bump + Kotlin consegnati (ee4741e9): `04ba9a9` pin →
> e131345b7 con vendor rigenerato dal sync (diff: pin, VENDOR_SHA, build-info,
> llama-ext.h, llama-governor.h — runtime.cpp/governor.cpp del vendor già
> uguali al fork), `c5c55a4` import `com.facebook.react.ReactPackage`.**
> Verificato da me: pin, righe h nel vendor, import, origin = c5c55a4. Jest
> 15/15, tsc 0, npm ci 0, prebuild 0 (dichiarati). CI APK debug
> 33932740946 su c5c55a4 in volo. **Delta audit grok** (2f3f58ef) lanciato su
> tutto il delta: 16 finding S3+S4, contratto sampling (n_probs:1, ids,
> path non-greedy intatto), purezza del vendor vs fork e131345b7, Kotlin,
> CI. Appende in `docs/AUDIT-S3S4-governor-app.md`.

> **5/09 ~06:30 — Delta audit grok (appeso a `docs/AUDIT-S3S4-governor-app.md`):
> GO-WITH-FIXES, 0 blocker.** 16 finding: 12 FIXED, B2/M9/m1 PARTIAL, M8 (CI)
> e m5 NOT FIXED. B1 ricalcolato dall'auditor (104 MiB/16384 = 6656 ✓). Vendor
> = sync puro del fork e131345b7 (diff vuoto dopo rinomina lm_ggml_). Contratto
> sampling: path non-greedy byte-identico, riga solo dietro la chiave,
> `n_probs` letto DOPO il sampling (non cambia il token); **gli ids omettono
> l'EOS** (simmetrico, annotato nel PREREG). Residui accettati: commento
> stantio `LlamaService.ts:1608` "deviceTuning selects gpu-opencl" e
> `temperature > 0` in Kotlin (0.0 °C = invalido) → da piegare nel prossimo
> commit app, non bloccanti. Header fork `reload_budget_available=true` di
> default, JS manda false: coerente col piano. Gate per S5: CI 33932740946
> verde + JSON bench con t_idle_* (già nel driver). PREREG emendato pre-lock.

> **5/09 07:30 EDT Mac — S5b LOCKED.** Fix Luna applicati e verificati su disco (bash -n 0,
> dryrun 0, righe citate lette); delta audit #1 deepseek: GO-WITH-FIXES, 1 major nuovo (una
> riga B VOID per composer corto faceva `status=1` → ABORT di tutta la sessione: gate B ora
> saltati quando `row_void=1`) + mio rilievo: `clear_composer` mandava CTRL e A come keyevent
> separati (non è una chord: il retype accodava al testo residuo) → ora `input keycombination`
> + redump + verifica composer vuoto PRIMA del retype unico. Delta #2: GO, 0 rilievi. PREREG
> bloccato su APK 8a56edc (sha 272f4547…). Nota orologio: le voci "6/09" qui sopra erano
> etichettate male, il Mac segna 5/09 EDT. Prossimo: sessione QDC `S5b-8Elite-r1` su
> QRD8750, ordine ABABABAB, budget 8 Elite ≈583 min.

> **5/09 08:15 EDT Mac — S5b run 1 (sessione 800721, sa804790, QRD8750): 3 righe VOID, run
> fermata da me, sessione chiusa (Completed 7:56, ~22 min).** Meccanismo, misurato dal vivo
> sulla stessa board: `adb shell input text` PERDE caratteri sulle stringhe lunghe (one-shot
> 1500 → 1073 arrivati, 71%; nella run 5142 → 1046-1221), mentre a blocchi da 500 con pausa
> 0,5 s arrivano tutti (1501/1500). Secondo difetto: a composer vuoto uiautomator riporta il
> hint "Ask a question…" come `text` (16-17 char), quindi il check post-clear "≤3" non passa
> mai e ogni retype torna VOID. Nessun numero di velocità/oracolo prodotto; il gate
> "VOID non aborta" ha funzionato (3 VOID, loop proseguito). Fix a Luna 5fcd34c9: digitazione
> a blocchi ≤500 + quoting single-quote, hint = lunghezza 0, fixture dryrun, emendamento
> PREREG "run 1 VOID". Raw in `scratchpad/agents/qdc-governor-s5b/raw/sa804790/`.
> Budget 8 Elite dopo la run: ~561 min.

> **5/09 08:35 EDT Mac — S5b fix post-run-1 applicati e auditati (GO).** Digitazione a blocchi
> ≤500 (`${PROMPT_TEXT:offset:500}` sul testo originale, poi `%s` e single-quote), hint == text
> ⇒ lunghezza 0 sia nel check iniziale sia nel post-clear, dryrun che distingue il codice
> vecchio (2 chiamate) dal nuovo (22 chiamate, tutte ≤500 e quotate), emendamento PREREG
> "Run 1 VOID". Delta audit #3 deepseek: 5/5 CONFIRMED-FIXED, GO. Lock invariato su APK
> 8a56edc. Prossimo: sessione `S5b-8Elite-r2`.

> **5/09 09:15 EDT Mac — Review dei 10 commit app su `feat/moe-stream` (A1, B1-B6, C1+C2),
> su richiesta owner.** Direzione giusta (catalogo data-driven, privacy all'egress, registry
> tipizzato); QUATTRO fix chiesti all'altra sessione via `docs/handoff/2026-09-05-moe-stream-
> fixes.md`: sweep orphan dirs al boot → migrazione con avviso; nessuna CI mai girata sui 10
> commit (tutti i workflow sono dispatch, E2E solo su main) → E2E on push + ci.yml leggero;
> documentare il modello privacy col suo limite (parafrasi); `src/engine` è condiviso: un
> conflitto in ModelRegistry (LFM: `kvBytesPerToken` governor vs `sizeClass` C1+C2), regola
> heads-up. Dopo i fix: dispatch APK + E2E su moe-stream da me. S5b run 2 in corso.

> **5/09 09:25 EDT Mac — S5b run 2 (sessione 801146, sa805215): digitazione RIPARATA, ma
> il driver è uscito (exit 3) dopo A1.** A1 pulita: composer 5142/5142 in 59 s (11 blocchi),
> 1016 token nuovi, promptMs 6582 (CPU), decode 28,4 tok/s. Il modello ha risposto al prompt
> lungo con una TOOL CALL (`web_search`, bloccata dal gate privacy) → round 1 → nessun
> `KALSA_BENCH_TOKENS` (l'app lo emette solo nei round senza tool call, LlamaService:3294) →
> prerequisito "contratto assente" scattato per la ragione sbagliata. Non è un bug app: la
> cella va con i tool OFF (`kalsa.web.enabled`, `kalsa.tools.*`). Sessione chiusa (~15 min).
> Fix a Luna: pref tool OFF in set_prefs, tool call ⇒ riga VOID (mai exit 3), fixture
> dryrun, emendamento PREREG run 2. Raw in `raw/sa805215/`. Budget 8 Elite ≈545 min.

> **5/09 09:40 EDT Mac — Fix "tool OFF" applicati e auditati (delta #4 deepseek:
> GO-WITH-FIXES → fix dryrun al turno 1 → verificato da me: con la condizione vecchia il
> dryrun esce 3, con la nuova 0).** set_prefs scrive `kalsa.web.enabled`/`kalsa.tools.device`/
> `kalsa.tools.calendar`="false" (forma letta da AppShell:704 e toolToggles:10); tool call
> ⇒ riga VOID `void_reason=toolcall`, exit 3 solo con `row_void=0`. Sessione
> `S5b-8Elite-r3` (801374) creata.

> **5/09 09:55 EDT Mac — S5b run 3 (sessione 801374, sa805443): PRIMA RIGA A VALIDA, poi
> abort termico legittimo.** A1: composer 5142/5142 in 59 s, 925 token nuovi, promptMs 5842
> (CPU non in cache), decode 26,9 tok/s, oracolo registrato, zero tool call. Skin post-turno
> 42,5 °C (da 33,1; in S5 r7 lo stesso turno finiva a 34,8) → regola pre-registrata `<42`
> → status=1 → ABORT dopo un turno. Non è un bug: 60 s di digitazione + prefill CPU da 900
> token + 280 token di decode scaldano ~9,5 °C. Sonda a board ferma (16 campioni/30 s):
> 42,5 → 36,0 in ~3,5 min, poi ~0,5 °C/min (`raw/sa805443/cooldown_probe.txt`). Fix a Luna:
> cooldown a 36 °C prima di ogni turno (poll 15 s, cap 10 min, altrimenti VOID `hot`),
> skin post-turno registrata non gatata, dumpsys con retry, deadline parametrica (85 min,
> sessione da 90). Sessione chiusa. Budget 8 Elite ≈525 min.

> **5/09 10:15 EDT Mac — moe-stream: i 5 fix dell'altra sessione sono su origin (F1 migrazione
> detect-only + banner, F2 ci.yml + E2E on push, F3 doc privacy + test, F4 kvBytesPerToken
> 6656 nella voce LFM).** Il gate nuovo è scattato al primo push: typecheck ROSSO,
> `isDocumentUnreadable` importato in AppShell/DocumentDetailView ma definito da nessuna parte
> (rotto da B5, prima dei fix). Dispatch APK+E2E rimandato a typecheck verde; handoff aggiornato.

> **5/09 10:25 EDT Mac — S5b cooldown applicato e auditato (delta #5 deepseek: 5/5
> CONFIRMED-FIXED, GO; nit 0,5→0,36 °C/min corretto).** cooldown_to_target prima di ogni
> turno (36 °C, 15 s, cap 10 min → VOID hot, niente am start), skin post-turno registrata non
> gatata, dumpsys con 3 retry, deadline = 4° argomento (85). Budget stimato 57-69 min su 90.
> Prossimo: sessione `S5b-8Elite-r4` da 90 min, driver con deadline 85.

> **5/09 10:40 EDT Mac — moe-stream: typecheck VERDE (aa12471 esporta isDocumentUnreadable),
> APK build lanciata da me (run 33972096001).** E2E ancora ROSSO: il passo "logic harnesses"
> compila `src/bench/benchConfig.ts` da solo senza i globali RN → `__DEV__` non definito
> (riga 465, introdotto da B3). Fix all'altra sessione; E2E lo rilancio dopo. S5b r4 (801665,
> sa805734) partita alle 10:24 con deadline 85.

> **5/09 10:50 EDT Mac — APK build moe-stream (33972096001) ROSSA allo stesso step/errore
> `__DEV__` di benchConfig.ts:465: apk.yml esegue lo stesso gate harness dell'E2E.** Un solo
> fix sblocca entrambi; ri-dispatch APK dopo il push dell'altra sessione.

> **5/09 11:05 EDT Mac — S5b run 4 (801665, sa805734) IN CORSO, primi reperti.** A1 valida
> (CPU 5945 ms / 925 token, decode 26,6). **B1 = prima coppia completa: GPU prefill 3201 ms
> vs CPU 5945 ms → B/A 0,54 (1,86×)**, chunk 2+512+128+128+128+27, commit KV 12,1 MB / 8,4 ms,
> FAST, decode 26,3; oracolo FAIL ma per UN token su 32 (indice 29) con rientro immediato:
> quasi-pareggio di logit GPU/CPU, non il difetto sistematico del 750. A2 VOID `hot`: dopo
> B1 (skin 44,6) 600 s portano solo a 36,44 > 36,0 (la GPU scalda più della CPU; target
> troppo vicino all'equilibrio). B2 VOID senza motivo: composer 5080/5142 ok, Send ok, il
> turno è girato (skin +7 °C) ma quattro `logcat -d -b all` hanno dato rc=255 e il re-dump
> finale (sovrascrivente, timeout 60 s) ha lasciato il file troncato a metà riga → parsing
> su file monco → tutti `na`. Fix run 5: dump atomico su tmp (sostituire solo con rc 0 e
> size ≥), retry ×3, rc nello status; target cooldown da rivedere (37 °C o cap 15 min).
> Regola bloccata: nessun cambio in corsa; la run prosegue (A3 in cooldown).

> **5/09 11:50 EDT Mac — S5b run 4 COMPLETATA (final_rc 0, DONE 11:42, ~86 min QDC).** 8 righe:
> A1 valida (CPU 5945 ms/925 tok, 26,6 tok/s), B1 valida (GPU 3201 ms, FAST, commit 12,1 MB/
> 8,4 ms, oracolo FAIL per 1 token su 32), A2/A3/A4/B4 VOID `hot` (dopo un turno GPU la skin
> in 600 s si ferma a 36,3-37,7 > 36,0), B2 VOID per logcat troncato (10 dump con rc=255 nella
> run), B3 valida (GPU 3228 ms, FAST, 26,6 tok/s, oracolo VOID senza A). Velocità: 0 coppie
> GPU/PASS → descrittivo: B/A = 0,54 (1,86×) sull'unica coppia, nella banda pre-registrata
> 1,4-1,9 del prior prewarm; il ≥3× del fork non è supportato. Prossimo: REPORT (Luna) +
> audit (deepseek); fix run 5: logcat atomico con retry, target cooldown 37 °C/cap 12 min.

> **5/09 12:10 EDT Mac — moe-stream: 659a644 (`isDevBuild()`) → ci.yml VERDE ed E2E on push
> VERDE con inferenza reale.** APK build rilanciata da me: run 33976887711, watcher attivo.
> I quattro (cinque) fix del handoff sono chiusi; resta solo l'esito APK.

> **5/09 12:25 EDT Mac — S5b run 4 BANCATA (ALIVE 49, registro).** Audit REPORT deepseek: BANK
> (ogni numero riprodotto dai raw, 3 cosmetici applicati); delta #6 fix run 5: GO (dump
> atomico distinguibile dal vecchio codice, 37.0/720). Nit `requested_timeout` morto → ora
> `timeout_s = max(arg,120)`. Prossimo: sessione `S5b-8Elite-r5` (90 min, deadline 85).

> **5/09 12:45 EDT Mac — S5b run 5a (sessione 802297, sa806366) ABORTITA DA ME ad A1: errore MIO
> nel criterio del dump atomico.** `logcat -d -b all` è un ring buffer: un dump più recente e
> completo può essere più piccolo. La regola "size(tmp) ≥ size(file)" che ho dettato nel brief
> ha rifiutato ~45 dump con rc 0 → file mai aggiornato → telemetria mai vista → poll da 600 s
> per turno. L'audit #6 non poteva vederlo dal dryrun. Fix a Luna: accettare rc 0 + ultima
> riga completa + timestamp finale ≥; mai dimensioni. Sessione tenuta aperta (fine ~13:50):
> rilancio con deadline ridotta appena il fix è verificato. Memoria corretta.

> **5/09 12:55 EDT Mac — moe-stream CHIUSO: APK build VERDE su 659a644 (run 33976887711,
> artifact 57.6 MB release).** ci.yml + E2E on push + APK tutti verdi sullo stesso sha; handoff
> chiuso. S5b run 5b partita 12:45 (job sa806366b, deadline 55) con criterio ring-buffer.

> **5/09 13:00 EDT Mac — run 5b A1 VOID `toolcall`, causa a monte: composer 5141/5142.** Un
> carattere perso anche a blocchi da 500; il check ≥90% lo lascia passare, il modello
> (greedy, deterministico) prende un'altra strada e chiama un tool DOCUMENTI (sempre attivo,
> nessuna pref lo spegne) → round 1 → VOID. In run 4 con 5142/5142 lo stesso prompt non
> chiamava tool. Fix run 6 (Luna, solo parse.sh/dryrun/PREREG, d_run.sh in esecuzione non si
> tocca): lunghezza ESATTA obbligatoria, retype unico, altrimenti VOID `composer`; `last_epoch`
> in awk stampava 1.78863e+09 (precisione persa) → printf. Il dump atomico ring-buffer ha
> funzionato (2 rc=255 ritentati, terzo ok). Run continua: B1 in cooldown a 37,9.

> **5/09 13:15 EDT Mac — delta audit #7 (deepseek): GO, 0 rilievi.** Dump ring-buffer-safe,
> lunghezza esatta con retype unico e VOID `composer`, epoch a 3 decimali, d_run.sh intatto;
> correzione: in 5a i dump rc 0 rifiutati erano 147 (non ~45). Run 5b: B1 valida (GPU 3326 ms,
> FAST, 26,5 tok/s, skin 37,0→47,0, cooldown 435 s), A2 in cooldown da 42,7. Run 6 pronta.

> **5/09 13:45 EDT Mac — run 5b CHIUSA (deadline 55 min), sessione 802297 Completed 13:45:25.**
> Righe: A1 VOID toolcall (5141/5142 char), B1 GPU 3325,7, A2 VOID hot (37,07 a 720 s),
> B2 GPU 3324,1, A3 VOID hot (37,23 a 720 s), B3 GPU 3325,7 (FAST, 26,8 tok/s, skin
> 36,96→47,0). Tre punti GPU identici (ids_sha 17b3765f…), nessuna A valida: A dopo B non
> scende sotto 37,0 in 12 min (secondo run consecutivo). Dump atomico ok: rc 0, 1 tentativo
> per turno, 30 rifiuti in tutto (147 in 5a). Tunnel chiuso. Portale: il primo `Confirm`
> cliccato via JS era un pulsante nascosto (sessione ancora Running); funziona click JS su
> "End Session" → `Yes` VISIBILE. Run 6: target cooldown per braccio (A 38,5 / B 37,0),
> cap 900 s, ABABAB, deadline 85 → brief a Luna 5fcd34c9.

> **5/09 14:20 EDT Mac — run 6 pronta: addendum REPORT 5a/5b + fix per braccio, delta #8 GO.**
> Luna: `cool_target_for_arm` (A 38,5 / B 37,0), cap 900 s, ordine ABABAB accettato, status
> `cool_target_c=`, gate A post-cooldown `skin_before > target` ⇒ VOID hot, dryrun con fixture
> 39,5 °C (target A e cap 900 asseriti), PREREG §"Run 5b → run 6" con caveat equità (A parte
> più calda ⇒ bias CONTRO il nullo CPU) e aggregazione a 6 turni (plateau 2-3, ≤2 coppie,
> mediana invariata, asimmetria gate B dichiarata). Deepseek #8: GO, 4 minori tutti chiusi
> (A1 skin 34,883; letterale 38,5 → `$COOL_TARGET_C`; regola mediana; asimmetria). Verificato
> su disco: bash -n 0/0, dryrun rc 0. Prossimo: sessione QDC 90 min, `d_run.sh <sa> <apk 8a56edc> ABABAB 85`.

> **5/09 14:45 EDT Mac — run 6 in volo (sessione 802898, sa806967, driver 14:21, deadline 85):
> A1 CPU 5855,5 ms VALIDA (925 tok, skin 33,2→42,7), B1 a 37,0 in 195 s.** Decisioni owner:
> (1) Luna canale primario, grok razionato (78 % token in 2 giorni); (2) estendere S5b agli
> altri Snapdragon QDC con minuti gratis — QRD8650/750 (757 min), QRD7675/732 (912), HDK8550/740
> (868), QRD8635/735 (981) — "se riesci a essere multitasking". Correzione mia: quei SoC sono GIÀ
> misurati da CLI (ALIVE #36 732 GPU ~11×, #37 740 piatto, #38 750 pp512 284 t/s, #39 735) e il
> governor in-app ha già girato su QRD8650 (S5, #48); ciò che manca è la cella A/B in-app fuori
> dall'8 Elite. Domanda di record: il guadagno TTFT in-app segue il rapporto CLI per SoC, e sul
> 740 il governor NON aiuta come atteso? Luna in volo: PREREG "Runs 7+" + copie `d_run.next.sh`/
> `parse.next.sh` (tag device da `ro.product.name`, sensore skin che fallisce forte); d_run.sh
> NON si tocca finché gira. NPU in-app: non è cella numerata (S6 RAM, S7 termico) → da aprire dopo.

> **5/09 15:00 EDT Mac — run 6: prima coppia adiacente (B1 GPU 3323,5 / A2 CPU 6182,9 → 0,537);
> A2 partita a 38,4 °C finisce a 47,9 ed è il 5,6 % più lenta di A1 (caveat equità reale, contro
> la CPU). Oracolo B1 FAIL per UN token su 32 (idx 29, 640 vs 1194, rientro), identico a run 4:
> divergenza GPU/CPU sistematica su quasi-pareggio → con oracolo stretto l'endpoint 8 Elite non
> è raggiungibile per costruzione.** Multi-SoC: Luna ha scritto PREREG "Runs 7+" + `d_run.next.sh`/
> `parse.next.sh` (device_tag da ro.product.name+ro.soc.model, thermal fail-loud, gate 8650 tolto);
> deepseek #9 **NO-GO**: F1 MAJOR i priori CLI (732 11×, 750 17,4×, 735 10,4×) usano CPU RITIRATE
> da ALIVE #57/#58 (mid-tier 1,59×, 750 2,87-2,94×) → bande 3-4× troppo ottimiste; F2 cherry-pick
> 284,2/16,3; F3 pre-registrare PASS-1 (≤1 token divergente con rientro) per runs 7+ PRIMA dei dati,
> non retroattivo su 8 Elite; F6 dryrun senza il path di abort termico a livello run. Correzione
> mia in chat: avevo citato il 732 "~11×" da ALIVE #36 senza il ritiro di #57. Attesa realistica
> sui mid-tier: parità (1,01-1,05) = null legittimo da bancare; 750 0,55-0,57. Ordine consigliato:
> QRD7675 → QRD8635 → HDK8550 → QRD8650 (ultimo, solo descrittivo finché il difetto 750 è aperto).
> Fix a Luna in volo.

> **5/09 15:15 EDT Mac — multi-SoC: fix Luna verificati, deepseek #9b GO (2 nit chiusi da me:
> banda 750 0,55-0,58; nota post hoc su PREREG:130).** Run 6: B2 VOID hot a 900 s (37,07) dopo A2
> finita a 47,9 → "B sempre raggiungibile" falsificato quando A parte calda; A3/B3 in corso.
> Pronti per lo swap `d_run.next.sh`→`d_run.sh` a driver morto e run 7 su QRD7675 (732), attesa
> pre-registrata: parità (null bancabile).

> **5/09 15:50 EDT Mac — RUN 6 BANCATA (descrittiva, ALIVE 49).** Exit 0, sessione 802898
> chiusa 15:25:49. 3 A + 2 B valide, B2 VOID hot (900 s dopo A2 a 47,9). Coppie stesso-turno
> A1/B1 0,568, A3/B3 0,540 → mediana 0,554 = **1,81×** in PASS-1 esplorativo; strict NOT MET
> (1 token, idx 29, in TUTTE le coppie di run 4/5b/6). Audit REPORT deepseek: numeri tutti
> confermati, 1 MAJOR **mio**: avevo imposto a Luna la coppia B1/A2 (0,5375, la più favorevole
> al governor) contro la regola stesso-turno pre-registrata → corretto a 0,554/1,81×, deviazione
> dichiarata nel REPORT; delta BANK. Driver device-agnostic swappato in `d_run.sh` (run-6 driver
> in `*.run6.bak.sh`); dryrun rc 1 per un `d_run.next.sh` residuo in dryrun.sh, corretto (19dd3b6e).
> **Run 7 in volo**: sessione 803252 (S5b-7pG3-r7, QRD7675/SM7675, tag `7p-Gen-3`, host sa807321,
> Running 15:29, 120 min), driver 15:30 `ABABAB 85` → fine ~16:55. Attesa pre-registrata: parità.

> **5/09 16:05 EDT Mac — run 7a (QRD7675) MORTA senza dati in 10 min (exit 1).** A1/B1 VOID
> `composer` (3821/5142 char, clear lascia 17 char con hint_len=0), A2 ABORT su `run-as: /data
> readable or writable by others: 40777`. Probe live mio sul board: (1) `screen_off_timeout`=60 s
> su questo QRD Android 14 → lo schermo va in doze dopo 60 s mentre il typing dura 73 s → coda
> persa; con `svc power stayon true` + timeout 1800 s il typing è lossless (500/500, 600/600);
> (2) il dump uiautomator di Android 14 NON ha l'attributo `hint`: il composer vuoto riporta
> text="Ask a question…" (15 char) → il check "cleared ≤3" fallisce e il retype non parte;
> (3) /data torna 777 a tratti nonostante 202 chmod rc 0 del driver → retry con chmod attorno a
> ogni run-as. Errore mio nel probe: tap fuori schermo e misure a schermo spento prima di
> accorgermi del doze (mWakefulness=Dozing). Nota a margine: senza prefs il catalogo propone
> Qwen 3.5 4B su questo device (dialog "Download model"). Fix a Luna (stayon+timeout, wake per
> chunk, EMPTY_TEXT catturato a composer vuoto, retry run-as, dryrun, PREREG "7a → 7b").

> **5/09 16:35 EDT Mac — fix 7b su disco (Luna) + deepseek #10 GO (1 minore, 2 nit).** `configure_screen`
> (stayon + timeout 1800 s, previous registrato in recon, exit 2 se fallisce), `typing_awake` prima
> di ogni chunk (Dozing → WAKEUP + dismiss-keyguard, se resta spento VOID composer), EMPTY_TEXT
> catturato a composer vuoto per turno (Android 14 senza attributo hint), `run_as_retry` (chmod +
> 3 tentativi sul solo 40777) su tutti gli 11 call site, 4 scenari dryrun nuovi, rc 0. Minore
> accettato: +15-25 % di tempo typing per i dumpsys → un retype potrebbe superare il cap 150 s
> (ABORT); se succede, cap da ri-registrare. **Run 7b rilanciata sulla STESSA sessione 803252**
> (scade 17:29, modello già sul board) con `ABABAB 50`.

> **5/09 16:50 EDT Mac — run 7b MORTA a A1 (VOID composer 3976/5142), driver ucciso da me 16:47,
> sessione 803252 chiusa 16:45:35.** EMPTY_TEXT funziona (cleared=0), schermo Awake su 11/11
> chunk: il doze NON era l'unica causa. Typing su 732: 133 s (73 sull'8 Elite); il retype è stato
> ucciso dal cap TOTALE 150 s (rc 2 a 55 s) — il minore #10 era vero. Probe live mio col prompt
> intero e dump dopo ogni chunk: 499/999/…/4999/5141 → UN solo carattere perso, il PRIMO del
> prompt (`w`), tutto il resto esatto; la perdita di massa (23 %) è il ritmo 0,5 s senza verifica,
> il dump per chunk fa da pacing. Stessa firma del 5141/5142 dell'8 Elite (run 5b A1). Fix a
> Luna: pausa 2 s dopo il focus, verifica prefisso esatto per chunk, retype del solo chunk 0 se
> manca il primo char, ladder 500→200→100 su mismatch, cap PER TENTATIVO 400 s, mai abort.
> Raw 7a spostati in `raw/sa807321a` (7b in `raw/sa807321`).

> **5/09 17:30 EDT Mac — typing per chunk su disco (Luna), deepseek #11 GO (2 minori chiusi:
> `-ge` unificato, `deadline_check` per tentativo).** `verify_typed_chunk` con prefisso esatto,
> pausa 2 s dopo il focus, retype del solo chunk 0 se manca il primo char, ladder 500→200→100,
> cap 400 s PER tentativo, sempre VOID composer mai abort; 3 fixture dryrun nuove, rc 0. PREREG
> "Run 7b → 7c" (147-151), citazioni 7a su `raw/sa807321a/`. **moe-stream**: handback C3 chiuso
> su 5d8b2eb (CI 33988146795, E2E 33988146799 77 min, APK 33989863108 verdi; artifact sha
> 6eba835a…, 135,66 MB) — handoff aggiornato. **Run 7c**: sessione 803833 (S5b-7pG3-r7c) in
> apertura; budget QRD7675 835 min prima di questa.

> **5/09 17:45 EDT Mac — run 7c (sa807902, sessione 803833) ABORT ad A1 prima del typing.**
> `uiautomator dump` fallito in silenzio (stdout/stderr scartati; `edit.xml` = 64 byte "No such
> file"), `edit_bounds` vuoto → `return 1` → ABORT dell'intera run a un turno. Contesto: il prewarm
> dell'app su 732 dura 117,8 s (3,9 s sull'8 Elite) e il primo dump arrivava subito dopo. Quarta
> causa device-specific in tre run. Fix a Luna: dump_ui con 5 retry a 3 s e log dell'errore,
> pausa 3 s dopo il load, dump fallito ⇒ VOID composer (rc 2) e mai abort; PREREG "7c → 7d".
> Sessione 803833 tenuta viva (scade 19:32) per run 7d sullo stesso tunnel.

> **5/09 18:00 EDT Mac — dump retry su disco (Luna), deepseek #12 GO pulito (2 nit).** dump_ui
> 5 tentativi con `rm -f` prima di ognuno, log per tentativo, flag transport (124/255 ⇒ abort
> pre-registrato, altro ⇒ VOID composer), pausa 3 s dopo il load, dryrun con "2 fail poi ok" e
> "5 fail ⇒ VOID e il turno dopo gira". Raw 7c → `raw/sa807902a`. **Run 7d lanciata sulla stessa
> sessione 803833/sa807902** con `ABABAB 85` (fine ≤19:25).

> **5/09 18:25 EDT Mac — run 7d: A1/B1 VOID composer, driver ucciso 18:08.** Il dump riusciva
> (9,6 kB) ma era SOLO systemui (orologio/data/batteria = AOD): schermo in doze al primo dump.
> Probe live: `mStayOn=false` perché `mIsPowered=false` (il board non si dichiara alimentato →
> `svc power stayon` inerte); timeout 1800 s onorato solo dopo attività utente VERA: dopo un
> `KEYCODE_WAKEUP` nudo ridorme in 9 s (`mLastSleepReason=timeout`), dopo WAKEUP + dismiss-keyguard
> + un tap resta Awake ≥40 s. In 7b il typing (133 s) faceva da attività; i 150 s di poll_load
> (prewarm 118 s) no. adb è root. Fix a Luna: tap sul composer (bounds noti o 540,2047) in ogni
> wake, dump con nodo com.kalsa.app obbligatorio (systemui ⇒ ri-wake e retry), re-wake in
> poll_load. Quinto difetto device-specific su QRD7675 in quattro run: ognuno nascosto dal
> precedente. Raw 7d → `raw/sa807902b`; sessione 803833 viva fino alle 19:32.

> **5/09 18:35 EDT Mac — fix wake/AOD su disco (Luna), deepseek #13 GO (2 minori: citazioni
> PREREG corrette da me → `raw/sa807902b/`, wake.log:10,15; `poll_load` fatale su ogni rc di
> dumpsys power invece che solo 124/255 → da fare a Luna DOPO la run, d_run.sh non si tocca
> mentre gira).** wake_sequence = locksettings + WAKEUP + dismiss-keyguard + tap sul composer
> (bounds dell'ultimo dump buono o 540,2047), dump valido solo con `package="com.kalsa.app"`
> (altrimenti `aod` → ri-wake e retry), poll_load con re-wake per iterazione; dryrun 0.
> **Run 7e lanciata sulla sessione 803833/sa807902 con `ABABAB 45`** (fine ≤19:20).

> **5/09 18:45 EDT Mac — run 7e: il lancio 18:26 è stato ucciso dalla compattazione della
> sessione (`Terminated: 15` durante l'install, raw rimossa); rilancio 18:33, fine ≤19:18.
> A1 VOID composer, nuova trappola n. 8:** typing a 500 perde caratteri (chunk 3: 1412/1500),
> la scala a 200 è esatta, ma al chunk 4 del tentativo 2 `adbT 60 dumpsys power` torna
> **rc=255 con output completo** (`typing_wake_4_before.txt` 147 KB, `mWakefulness=Awake`) e
> `typing_awake` lo tratta come fatale → rc 2 → VOID. rc=255 su `dumpsys power` in 3/76 dump
> della run (4%): stesso flake di trasporto del `logcat -d`. B1 procede (tentativo 2 a 200,
> chunk 16/26 a t=179 s, sotto il cap 400 s). Fix per Luna A FINE RUN (d_run/parse intoccabili
> col driver vivo): accettare il dump se contiene `mWakefulness=` a prescindere dal rc, o
> retry ×3, in typing_awake / dump_ui / poll_load; stesso trattamento del minore #13.

> **5/09 19:20 EDT Mac — run 7e CHIUSA alla deadline (19:17:51): A1 VOID (trappola 8), B1 TTFT
> 12,08 s con `KALSA_GOVERNOR_FALLBACK stage=correctness reason=gpu-prefill-incorrect-Unknown`
> (0/31 layer su GPU → B ≡ CPU), A2 12,58 s / 925 token / 16,6 tok/s valida, B2 tagliata dopo
> 780 s di cooldown. Sessione 803833 Completed, tunnel chiuso.** Scoperta di scopo: "correctness"
> non è un check a runtime ma l'allowlist `GPU_PREFILL_CORRECT={V79:true, V75:false, V73:false,
> Unknown:false}` in `src/engine/governorInputs.ts` (app @8a56edc) e `generationFor()` non conosce
> SM7675 → Unknown; la policy del fork (`llama-governor-policy.cpp:160-168`) dà GPU solo a V75/V79
> con Fit+measured, cool-mode a V73 solo MoE, CPU altrimenti. Quindi su QRD7675 e QRD8635 (Unknown)
> e HDK8550 (V73, modello dense) **la B in-app non esiste per design**: la A/B multi-SoC come l'avevo
> pre-registrata era cieca su questa tabella (punto cieco mio, ownato in PREREG §"Run 7e — post
> hoc"). Il prior 1,59× (riga ALIVE 40 / cella 57, che ritira l'11× di #36) con lo sconto in-app dà
> parità → la scelta CPU della policy sul 732 è coerente coi dati; il gap è di copertura della
> tabella, non di esito. **Prossimo: run 8 su QRD8650 (V75) con `kalsa.bench.governor_force=1`
> sulla sola B**, pre-registrata in PREREG §"Run 7e → run 8" (4 punti: wakefulness dal contenuto,
> force V75, VOID governor_fallback, gate RAM > 8 GiB); Luna 2d5dfbe0 implementa, poi audit
> deepseek. **QRD8635 e HDK8550 NON scartati da me: parcheggiati per la decisione dell'owner**
> (nessuna B possibile senza estendere la policy del governor). REPORT run 7 in arrivo (Luna nuova).

> **5/09 19:45 EDT Mac — run 7 BANCATA (ALIVE 50, f39da521; REPORT §Run 7 Luna e57dbe5e, audit #14
> deepseek BANK, 1 minore di wording applicato). Driver run 8 (Luna 2d5dfbe0): `power_capture` (dump
> accettato se contiene `mWakefulness=`, 3 tentativi, trasporto solo su 3×124/255) in typing_awake /
> dump_ui / poll_load; `kalsa.bench.governor_force='1'` solo per B su 8-Gen-3; B senza `KALSA_GOVERNOR {`
> o con FALLBACK → VOID `governor_fallback` (guardia `row_void -eq 0` dopo il MAJOR F1 di #15: non
> sovrascrive composer/hot); gate `GPU_FIT_RAM` ≤ 8 GiB prima dell'install. dryrun rc=0 (rieseguito
> da me). Audit #15 GO (1 major fixato, minore poll_load accettato), #15b in volo. Sessione QDC
> **804701** QRD8650 = sa808770 aperta 19:41 (120 min), tunnel 6037, board SM8650/pineapple 11,5 GB,
> Dozing/mIsPowered=false. Nota portale: allo step 3 esiste `deviceConfiguration.ScreenAlwaysOn`
> (non usato per tenere l'harness identico; sonda futura). `setsid` non esiste su macOS.

> **5/09 (21:10 ora Mac) — S5 IN CORSO su QDC: sessione 799218 `S5-QRD8650`
> (45 min, SSH only, chiave kalsa-mac; il form richiede la SSH key, NON il
> pacchetto), job sa803287, tunnel 6037 pid in `~/kalsa-qdc/tunnel-799218.pid`,
> serial a652109b, skin 28.9 °C.** Primo lancio del driver morto al secondo:
> `line 90: name: unbound variable` — con `set -u`, `local a="$1" b="${a}"`
> espande `${a}` PRIMA dell'assegnazione (bash espande gli argomenti del
> builtin). Stesso pattern alla riga 272 (`prefix`/`logcat`). Fixati da me
> spezzando le `local` (urgenza: sessione a tempo; `bash -n` ok, raw del crash
> in `raw/sa803287-VOID-crash-line90/`); rilanciato 21:13. Lezione da memoria:
> `bash -n` non vede gli unbound di `set -u`; una prova a secco con `set -u` su
> funzioni con `local` multiple andava fatta nel pre-run audit.

> **5/09 21:15 EDT Mac — RUN 8 (QRD8650, governor forzato sulla B) CHIUSA alla deadline 21:11:05
> (raw 4e7733c9 pushato, sessione 804701 Completed, tunnel chiuso).** Una coppia stesso-turno:
> **A1 CPU TTFT 8504,8 ms vs B1 GPU 4294,9 ms → B/A 0,505 (1,98×)**, `KALSA_GOVERNOR
> {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":12114944,"commit_ms":13.387,
> "prefill_chunks":"2+128×7+27","prefill_ctx_ngl":99,"forced":true,"thermal_state":"FAST"}`, nessun
> FALLBACK; decode 18,9 (B) vs 21,2 (A) tok/s; skin B1 37,0→47,4 °C. Banda pre-registrata 0,55-0,58:
> osservato 0,505 (sotto = GPU un po' meglio del prior). **Oracolo strict FAIL** dall'indice 7 (B salta
> il token 14991, 24/32 diversi) → endpoint NOT MET per il difetto f16/bf16 del 750, descrittivo come
> pre-registrato; l'indice differisce dal token 14 del fork. A2 VOID composer: su board calda il typing
> perde caratteri anche a 200 (tentativo 2 rc=1 a 314 s), a 100 è esatto ma il cap 400 s scatta a
> 4400/5142 → **trappola 9** (il cap 400 s per tentativo non basta a 100 char/chunk). B2 VOID hot
> (900 s, 38,49 > 37,0 dopo i 42,6 di A2). A3 digitata (382 s) e persa alla deadline. rc=255: 1 su
> tutta la run; `power_capture` non ha dovuto salvare nulla. REPORT run 8 con Luna 2f6bc505, poi
> audit deepseek #16, ALIVE 51. **Decisioni per l'owner**: 8635/8550 (nessuna B in-app senza
> estendere la policy); se tenere il 750 in allowlist OFF (2× di prefill vs oracolo FAIL).

> **5/09 (21:26 Mac) — S5 run 1 su sa803287: A1 OK, B1 FALLITO → sessione
> chiusa a ~17 min per non bruciare minuti.** A1: TTFT 42.7 s (include il
> prefill del system prompt), decode 24.3 tok/s, `KALSA_BENCH_TOKENS`
> presente (prerequisito verificato a runtime), 0 fallback, 0 lmkd. B1: il
> governor SI È ACCESO (due `loaded meta data`, `KALSA_NATIVE_VARIANT
> nGpuLayers {prefill:99, decode:0}`) ma il prewarm e ogni completion falliscono:
> `"Governor mode does not support MTP or speculative decoding"`. **Causa
> radice trovata:** `rn-completion.cpp:719-721 shouldUseMTP()` (e
> `rn-slot.cpp:335`) LANCIANO appena `hasGovernor()` è vero, a prescindere che
> MTP/speculative sia richiesto; viene chiamata a ogni completion → il
> governor non può mai generare. Bug introdotto in S2 (patch riga 1520),
> sfuggito a tre audit (nessuno ha tracciato il call-path). Fix: in modalità
> governor `shouldUseMTP()` ritorna false; il rifiuto resta solo all'init
> se speculative è richiesto esplicitamente. Nota a margine: al caricamento
> del secondo modello lmkd è andato in "critical pressure" e ha ucciso un
> servizio di sistema (non kalsa) → la modalità a due contesti su questa board
> è vicina al limite di RAM: da misurare nel run 2 (MemAvailable pre/post).
> Run 1 = VOID per la velocità, ma diagnosi bancabile. Raw in
> `raw/sa803287/`, crash del driver in `raw/sa803287-VOID-crash-line90/`.

> Sessione 799218 chiusa e verificata: "Completed", Ended On 09/04/26 9:27:07 PM
> (17 min). Tunnel chiuso. Fix `shouldUseMTP()` → Luna ee4741e9 (poi CI, poi
> run 2 su QRD8650 con MemAvailable pre/post per il dubbio lmkd). Lezione in
> memoria `audit-must-trace-call-paths-and-set-u`: ogni brief d'audit deve
> chiedere il call-path di ogni throw; ogni driver una prova a secco con set -u.

> **5/09 (22:18 Mac) — CI 33936537090 VERDE (45 min di build): APK db1606c in
> `~/kalsa-qdc/apk/apk-gov-db1606c/`, sha `dd77516a…2b6a`, debuggable ✓.**
> PREREG emendato pre-dati (run 1 VOID, identità APK run 2, driver 6bbb67b6).
> Apro la sessione QDC `S5-QRD8650-r2`.

> **5/09 (22:24 Mac) — S5 RUN 2 IN CORSO: sessione 799235 `S5-QRD8650-r2`
> (45 min, SSH only), job sa803304, tunnel 6037 (`~/kalsa-qdc/tunnel-799235.pid`),
> serial 7b5f6c52, APK db1606c, driver 6bbb67b6 (pid in
> `raw/driver-sa803304.pid`).** Watcher attivo; a fine run: End Session
> verificato, REPORT (Luna) → audit (deepseek) → ALIVE 48.

> 22:26 — Primo lancio run 2 morto in 30 s: board FRESCA senza app →
> `pm uninstall` = DELETE_FAILED_INTERNAL_ERROR (normale) e `grep -c` esce 1
> con zero match; il gate D3 di Luna esigeva `list_rc==0` e `uninstall_rc==0`
> → abort sul caso PULITO, e a cascata il check prerequisito scattava senza
> telemetria (exit 3 falso). Fix miei: gate = adb ok AND `package_count==0`;
> prerequisito solo se `telemetry_rc==0`; guardie `${var:-0}` sui conteggi.
> Raw del falso avvio in `raw/sa803304-VOID-gate-freshboard/`. Rilanciato 22:27.
> (Il dry-run di Luna non poteva vederlo: stubbava `pm list packages` con rc 0.)

> **5/09 (22:44 Mac) — S5 run 2 (sa803304): A1 OK (TTFT 45.9 s, 24.9 tok/s,
> `ids_sha` IDENTICO al run 1 → greedy deterministico tra sessioni), B1 =
> PRIMO TURNO GENERATO DAL GOVERNOR, e dice tre cose sbagliate:**
> `KALSA_GOVERNOR {engine_prefill:"CPU", engine_decode:"CPU", commit_bytes:0,
> commit_ms:0, thermal_state:"FAST", thermo_source:"bench-skin", fit:"Fit"}`;
> `KALSA_TELEMETRY tokensEvaluated 1329, promptMs 45154 (= CPU), tokensPredicted
> 0`; `KALSA_BENCH_TOKENS n=0`. Cioè: modello GPU caricato (OpenCL Adreno 750,
> 4612 MiB free, layer 0-26 su GPU, mlock fallito 223 MB = warning), ma il
> prefill è stato instradato sulla CPU con stato FAST e fit ok, nessun commit
> KV, e il decode ha prodotto zero token. Prewarm `done` con promptMs 0
> (sospetto: non ha valutato). RAM: MemAvailable 8.7 → 4.5 GB a due contesti
> (A: 8.8 → 6.4), nessun kill lmkd. Sessione 799235 chiusa (~24 min) per non
> bruciare minuti. Raw in `raw/sa803304/`. Diagnosi → Luna ee4741e9 (ha scritto
> il codice): tracciare la decisione di route del governor, il path del commit
> e perché la generazione termina a 0 token; poi audit grok.

> **5/09 (23:00 Mac) — Diagnosi run 2 (Luna ee4741e9) + verifica mia.** Due
> difetti: (1) **ammissione**: `admit_prefill` rifiuta il prompt (1329 token,
> 1024 in cache → 305 nuovi) perché la coda residua non si partiziona in
> chunk "tabled" ≥ 128 → `failed to eval, n_eval 305, n_past 1024` → 0 token,
> commit 0; prewarm stessa sorte ma JS lo dichiara `done` (promptMs 0). Fix
> fork `6f0a33c0d` (coda corta ammessa se termicamente sicura; test) → app
> `fcaf0df` (pin + sync solo policy.cpp); CI 33940693243 in volo. (2)
> **routing — scoperto da me leggendo la policy**: `prefill_engine()` dà GPU
> su V75 solo se `params_.gpu_prefill_measured` (`llama-governor-policy.cpp:158-160`),
> e l'app non lo manda mai (`rn-governor-params.cpp:136` default false,
> `governorInputs.ts` non lo emette) → il governor chiederebbe SEMPRE prefill
> CPU sul QRD8650; inoltre `prefill_engine()` non ha alcun ramo GPU per V79.
> Luna sostiene che l'esecuzione usi comunque `ctx_prefill` per n_tokens>1 e
> che l'etichetta sia solo dalla policy: da provare. → Delta audit 3 (grok):
> ammissione, routing policy-vs-esecuzione, V79, prewarm, test. In parallelo
> Luna (solo src/engine): `gpu_prefill_measured` true per V75/V79 (celle
> ALIVE #55-58, #38), prewarm veritiero. Poi UNA CI e run 3.

> **5/09 (23:15 Mac) — App `803b499` (Luna, verificato):** `governorInputs.ts:117`
> `gpu_prefill_measured: generation === "V75" || generation === "V79"` con
> test (V75 true, V73/Unknown false); prewarm ora logga `op:"skip",
> reason:"eval-failed"` su errore nativo / 0 token valutati / prompt_ms ≤ 0.
> CI APK debug dispatchata su 803b499: run 33941238832 803b499. Delta audit 3 di grok
> ancora in corso (routing policy-vs-esecuzione, V79, ammissione, test).

> **5/09 (23:30 Mac) — Delta audit 3 (grok): NO-GO per il run 3.** Fatti
> provati con call-path: (a) la policy NON sceglie il contesto —
> `llama-governor.cpp:166-167` `target = n_tokens > 1 ? ctx_prefill : ctx_decode`;
> `prefill_engine()` è solo etichetta → `gpu_prefill_measured` (803b499) è
> onestà della telemetria, non routing; (b) `n_batch 512` ⇒ 1329 = 512+512+305:
> i due 512 sono righe esatte della tabella → Admit → `llama_decode(ctx_prefill)`
> reale (ecco i 45 s, GPU con il modello a 27 layer su OpenCL… da rimisurare);
> il 305 si partiziona 128+128+49 ma **il runtime non applica la partizione**:
> `decode_impl` passa comunque l'intero batch (`runtime.cpp:48-49` ritorna 0
> solo se `tokens >= n_tokens`) → `-2` → `failed to eval` → 0 token, commit 0;
> (c) `CPUFallback` di `admit_prefill` non è mai consumato dal runtime; (d)
> prewarm falso `done` (già fixato in 803b499); (e) i test di 6f0a33c0d non
> coprono 1329/1024 né la coda GPU; (f) **V79 senza ramo GPU in
> `prefill_engine()`**: gap da chiudere nel fork prima della cella 8 Elite
> (per ora solo etichetta, ma va reso esplicito). → Luna ee4741e9: chunking nel
> runtime secondo l'ammissione + test (partizione 305, coda GPU 49, nessun
> doppio eval, ≥1 token e commit>0 su 1329/512), un commit fork, pin+sync,
> UNA CI. CI 33941238832 (803b499) cancellata: superata.

> **5/09 (23:50 Mac) — Chunking consegnato (Luna): fork `e1a0f5028` "decode
> prefill batches in admitted chunks" (runtime.cpp loop su `chunk_sizes` con
> sub-view di `llama_batch` per offset, `return k_prefill_chunked` e al
> chiamante `policy_rc == k_prefill_chunked ? 0 : policy_rc` per evitare il
> replay del batch intero; commento "routing is by n_tokens > 1;
> admission.engine is telemetry only"; test +115 righe: partizione
> {128,128,49}, no doppio eval, `governor_chunked_prefill=PASS
> decodes=512+512+128+128+49 generated=1 commit_bytes=9186048` — dichiarato,
> da rieseguire dall'auditor). App `ac4820d` pin+sync (solo governor files +
> VENDOR_SHA/build-info, verificato). Fork pushato. CI 33941962100 in volo
> (waiter → `~/kalsa-qdc/apk/apk-gov-ac4820d/`). Delta audit 4 → grok, con
> obbligo di rieseguire i test del fork.

> **6/09 EDT Mac — OWNER: "Devi fare tutti e tre :) In ordine se pensi sia difficile".** Ordine 1→2→3.
> **(1) Trappola 9 — typing ladder** (PREREG §"Run 8 → run 9"): scala `200 100` (il gradino 500 non è mai
> passato su 3 board, costava 59-127 s/turno), cap per tentativo 400 s a 200 / 700 s a 100. Luna 2d5dfbe0
> su parse.sh+dryrun, poi audit deepseek.
> **(2) Governor multi-SoC — piano.** Fatti letti: `generation` V73/V75/V79 sono generazioni Hexagon (8 Gen 2 /
> 8 Gen 3 / 8 Elite); SM7675 e SM8635 hanno Hexagon V73 → la mappa giusta è **7675/8635 → V73**, non una
> classe nuova. Il parser stringa→enum sta nella patch llama.rn dell'app (`patches/llama.rn+0.12.8.patch`
> ~:1896, `bool_or(governor, ...)` ~:1974-1985), non nel fork; `forced` dell'app NON arriva al nativo.
> Design: **fork** `llama_governor_params.bench_force_gpu_prefill=false` + in `prefill_engine()` dopo le
> guardie termiche/LOWBAT `if (bench_force_gpu_prefill && gpu_fit==Fit) return GPU;` + test in
> test-governor-v0-devices.cpp (V73 dense+force+Fit→GPU; force+NoFit→CPU; force+CRITICAL→CPU). **App**:
> patch passa `bench_force_gpu_prefill` (hand-edit dell'hunk, MAI patch-package regenerate), TS type;
> `generationFor` soc `(SM8550|KALAMA|SM7675|SM8635)`→V73 e testo `QRD7675|QRD8635`→V73;
> `buildGovernorParams` passa `bench_force_gpu_prefill: force`; `GPU_PREFILL_CORRECT[V73]` resta **false**
> finché non c'è un oracolo in-app (la leva bench `kalsa.bench.governor_force=1` accende `enabled` e forza la
> GPU: così si misura senza mentire in produzione); test aggiornati. Poi pin bump (`scripts/sync-kalsallama.sh
> pin <sha>`), APK debuggable da CI, driver: `governor_force` per B su tutti i tag (non solo 8-Gen-3), PREREG
> "run 9+" con bande: mid-tier parità (B/A 0,95-1,05), 8 Gen 2 atteso B/A ≥ 1 (740: CPU pura più veloce,
> memoria adreno-moe-two-defects). Run 9 QRD7675, 10 QRD8635, 11 HDK8550. La policy di produzione si
> aggiorna DOPO, dai dati. Fork e app in parallelo su due Luna (repo diversi), audit deepseek ciascuno.
> **(3) Difetto Adreno 750**: prima websearch upstream (regola "cercare prima online"), poi riproduttore
> minimo su QDC dal caso run 8 (divergenza idx 7). Dopo (2).

> **6/09 — Websearch punto 3 (Luna a574b968, finestra 2026-03→09-06): NESSUN fix upstream per il nostro
> sintomo** (Adreno 750 + E031.45 + f16/bf16 batched MUL_MAT sbagliato). Vicini ma altri kernel: #23800
> (750, FLASH_ATTN ViT, 28/05), #17351 (750, E031.45.02.16, VLM, 11/2025), #25477 (740, Q6_K, f16 270/270 ok),
> #25910 (batched MUL_MAT quantizzato: view_offs/broadcast persi, merged 20/07 `178a6c4` — verificare che
> sia nel nostro pick 12f6d9b6d), #26476 (q6_K gated a E031<45, merged 20/08), #27640 (F32 batched GEMM
> bypass ne11>8, perf, 29/08), FA fixes #26428/#26434. Backend mappa 730/740/750 → `A7X`. ⇒ Punto 3 si caccia
> da noi partendo dal riproduttore già in mano: **ALIVE 41 = 20 FAIL di test-backend-ops sul 750** (shape
> f16 batched): elencare i 20 casi, mappare al kernel dispatchato (`ggml-opencl.cpp` mul_mm/mul_mat f16
> tiled vs generic), bisect kernel/flag su QDC, fix nel fork, oracolo in-app. Riferimenti URL nel report
> dell'agente (Paseo a574b968).
> Verificato su disco: `git merge-base --is-ancestor 178a6c4 12f6d9b6d` → **NO**: il pick `kalsa/opencl-picks-2026-09`
> (12f6d9b6d = #26434 FA WAR race, 18/08) è cherry-pick su base a0cabca6b e NON contiene #25910 (`178a6c449
> opencl: Support broadcast for Adreno MUL_MAT and honor view_offs for Adreno Q8`, 20/07). Candidato n. 1 del
> punto 3: cherry-pick di 178a6c449 sul pick branch → test-backend-ops sul 750 (i 20 FAIL di ALIVE 41) →
> se restano, mappare i 20 casi al kernel f16 batched dispatchato.

> **6/09 — Stato dei tre pezzi.** (1) Ladder typing + force su tutti i tag + gate RAM su tutti: su disco
> (Luna 2d5dfbe0), dryrun rc=0 verificato da me, **audit #19 deepseek in corso**. (2) Fork: `bench_force_gpu_prefill`
> commit **9c28322ac** (test policy 5 casi passano prima dello skip GPU; rc 77 = skip device senza GPU sul Mac),
> **audit #17 GO** (1 nit), **PUSHATO** su Aspis0/kalsallama governor-v0.3. App (worktree kalsa-wt-governor):
> **79c04a9** generationFor SM7675/SM8635→V73 + `bench_force_gpu_prefill: force` + patch hand-edit (3 hunk
> header +1) + 28 righe test, jest/tsc rc 0; **audit #18 mimo GO** (0 finding);
> **Punto 3 — PREREG scritta** in `scratchpad/agents/qdc-750-mulmat-view/PREREG.md`: i 20 FAIL del 750 sono TUTTI
> `MUL_MAT f16/bf16×f32 m=128 n=1, batched b≠[1,1], vista k_v=2112/k=1056 o=1`, 14/20 con broadcast nr=4 →
> ipotesi H1 = stessa classe del fix upstream 178a6c449 (view_offs/broadcast Adreno MUL_MAT) mancante nel pick;
> meccanismo in-app: K·Q dell'attenzione in prefill (FA off) = batched+GQA broadcast su vista del K cache.
> Procedura: cherry-pick su `kalsa/opencl-picks-2026-09+25910` → kit → test-backend-ops MUL_MAT/MUL_MAT_ID/FA
> sul QRD8650 dopo run 9 → esiti pre-dichiarati (0 FAIL → run 8b in-app con oracolo; 20 → porting al path f16).
> **Punto 3, avanzamento (Luna a1643e91, worktree `kalsallama-wt-oclpicks-25910`):** cherry-pick 178a6c449 pulito
> (c7ad97025) ma **quantized-only** (f16/bf16 esclusi: `src0t != F16 && != F32`) → H1 as-is prevista REFUTED
> (PREREG Amendment 1). Per la shape fallita il dispatch sceglie `kernel_mul_mat_f16_f32_l4_y8`
> (`mul_mv_f16_f32_l4.cl:519-520`), che è già stride-aware (nb01/nb02/nb03 + offset0): il bug vero NON è
> spiegato dalla lettura. Fix candidato = **gate** (2f3b24dee): `gpu_family==ADRENO && !ggml_is_contiguous(src0)`
> → kernel generico `kernel_mul_mat_f16_f32`. Dubbi miei all'audit #20: il 732 passa con compilatore
> E031.45.02.16, il 750 QDC fallisce con **.02.06** → possibile miscompile per versione (gate per versione
> come upstream #26476 sarebbe più chirurgico); il gate globale tocca la K·QV con vista del V-cache anche su
> 8 Elite → guardia pp512 anche lì prima di adottarlo. ANALYSIS-f16-l4.md (69 righe) nella cella.
> Meccanismo in-app corretto: è la **KQV** (src0 = V-cache vista, m=head_dim 128, k=n_kv, broadcast GQA r2=4), non la K·Q.
> **Audit #20 deepseek GO** (2 minori, 1 nit): la mia ipotesi compilatore è **REFUTATA** — nei raw del 732 (cella 52)
> compaiono sia .02.06 sia .02.16 e passa comunque → il discriminante è la GPU 750, gate per famiglia Adreno come
> scritto. Minori recepiti (PREREG Amendment 2): guardia pp512 su 8 Elite prima di adottare il gate (rerouta le viste
> del V-cache su tutti gli Adreno); report separato dei casi vista con n>1/o>1. Build kit baseline 12f6d9b6d in corso
> (`build-kit.sh`, Docker), poi candidato 2f3b24dee; device test sul 750 dopo run 9.

- **2026-09-06 — S5 qdc-governor-s5: BANCATA (audit REPORT deepseek
  BANK-WITH-FIXES, applicati) — G1-REFUTED su APK ac4820d, meccanismo PROVATO:
  primi turni governor end-to-end nell'app (prefill GPU, commit KV, decode CPU,
  4/4 B); oracolo FAIL @14 deterministico; endpoint 2 non analizzabile
  (zero coppie PASS), descrittivo B 21.9 < A 24.4 tok/s; TTFT B non misurabile
  (fixato 64931c1); termica non interpretabile (skin cached, fixato driver).**
  PREREG locked 694d3154 + emendamenti; REPORT 145 righe; raw sa803287/sa803304
  (VOID) + sa803354; ALIVE 48. Fix codice nati dalla cella: fork
  e131345b7/6f0a33c0d/e1a0f5028/6ed44f567, app db1606c/803b499/ac4820d/64931c1.

> **6/09 00:05 Mac — Delta audit 4 (grok): GO per il run 3 su QRD8650.**
> Pre-fix ricostruito: il loop di chunking c'era già (runtime.cpp:56-89) ma il
> chiamante rigiocava il batch intero dopo i chunk → `-2`; ora
> `policy_rc == k_prefill_chunked ? 0 : policy_rc`. Test rieseguiti
> dall'auditor: build 0, router golden PASS con assert {128,128,49} sotto
> richiesta GPU, turns PASS. Vendor = fork (MATCH dopo rinomina). Prewarm
> veritiero senza falsi skip. Residuo minore: `k_prefill_chunked==1` collide
> con l'rc "KV slot" di llama.cpp (un chunk che torna 1 verrebbe inghiottito;
> improbabile a 8192/1329) → da rinominare a un valore negativo dedicato in un
> commit successivo. **Vincolo:** niente cella 8 Elite finché la policy non ha
> un ramo GPU per V79. Gate run 3: CI 33941962100 (ac4820d).

> **6/09 00:20 Mac — CI 33941962100 VERDE (~50 min): APK ac4820d in
> `~/kalsa-qdc/apk/apk-gov-ac4820d/`, sha `1a1356ac…e2bc`, debuggable ✓.**
> PREREG emendato pre-dati (run 2 VOID con causa, identità APK run 3). Apro
> la sessione `S5-QRD8650-r3`.

> **6/09 00:30 Mac — S5 RUN 3 IN CORSO: sessione 799285 `S5-QRD8650-r3`
> (45 min, SSH only), job sa803354, tunnel 6037 (`~/kalsa-qdc/tunnel-799285.pid`),
> serial 7b5f6c52 (stessa board del run 2), APK ac4820d, driver df07c616.**
> Watcher attivo. Budget 8 Gen 3 prima della sessione: 822 min.

> **6/09 00:40 Mac — S5 RUN 3 COMPLETO (sa803354, 8/8 turni, exit 0): PRIMI
> TURNI END-TO-END DEL GOVERNOR SU UN DEVICE.** B×4: `engine_prefill GPU`,
> `engine_decode CPU`, `commit_bytes 9.2 MB / 10.5 ms`, thermal FAST, prewarm
> GPU 5.2 s (1024 token). Endpoint PREREG però: **oracolo FAIL** — i 32 id
> greedy divergono al token 14 (A=20, B=5439), deterministico su 4/4 turni B
> (stesso ids_sha) e 4/4 A → numerica GPU≠CPU nel prefill, non rumore;
> **decode**: mediana B turni 2-4 = 21.9 vs A 24.4 tok/s (FAIL, richiesto ≥),
> con B3 a 4.26 tok/s e 76 righe lowmemorykiller nel turno (pressione RAM a
> due contesti: MemAvailable 8.7 → 4.4 GB); **TTFT B non misurabile**:
> `promptMs 0` su tutti i B (il timer del prompt dell'app non copre il
> prefill del governor) → endpoint 2 NON VALUTABILE, fix di telemetria
> necessario. A: 4 turni stabili 42-44 s / 24.1-24.5 tok/s, ids identici ai
> run 1-2. Sessione 799285 chiusa. Prossimo: REPORT (Luna 5fcd34c9) → audit
> deepseek → ALIVE 48 come "governor funziona, endpoint FAIL con diagnosi".

> **6/09 01:00 Mac — REPORT S5 scritto (Luna 5fcd34c9, 136 righe, ogni numero
> con file:riga): "G1-REFUTED on this APK; governor mechanism PROVEN".** Il
> tokenizer del fork ha decodificato gli id: A inizia con il blocco di
> ragionamento ("The user wants a short sentence about mountains…"), B
> diverge al token 14. Prewarm come unico confronto prefill GPU vs CPU
> (etichettato, non endpoint): B ≈ 5.16 s vs A 9.3-9.9 s per i 1024 token
> cached (1.8×). B3: un kill lmkd (`com.android.dynsystem`), 76 righe. Difetto
> driver scoperto dal report: la skin letta è la riga cached (31.4 fissa), non
> la sezione HAL → colonne skin da trattare come non valide. Audit REPORT →
> deepseek (706f8d2f). In volo: telemetria `prefill_ms` (ee4741e9).

> **6/09 01:20 Mac — Telemetria prefill governor (Luna ee4741e9): causa radice
> del `promptMs 0`** = `JSICompletion.h:193` legge `llama_perf_context(active_ctx())`
> e in governor mode `active_ctx()` è il contesto di DECODE (l'ultimo batch è
> di 1 token), che non ha timer di prompt; il prewarm restava sul contesto
> prefill e per questo aveva un valore. Fix fork `6ed44f567` (`stats_.prefill_us`
> accumulato attorno ai decode di prefill; test: `prefill_us=250465` su
> 512+512+128+128+49) + app `64931c1` (JSI usa le stats governor per
> prompt_n/prompt_ms; `getGovernorStats` espone `prefill_ms`, `prefill_chunks`,
> `prefill_ctx_ngl`; riga `KALSA_GOVERNOR` estesa). CI 33946344038 in volo.
> Delta audit 5 → grok.

> **6/09 01:35 Mac — Audit REPORT S5 (deepseek): BANK-WITH-FIXES, 0 blocker,
> 3 major di etichetta, 7 minori; TUTTI i numeri riprodotti (incl. tokenizer:
> id 20 = "," → A "a simple, general" vs B "a simple request").** F1: la regola
> pre-registrata usa solo coppie oracle-PASS → endpoint 2 = NON ANALIZZABILE,
> mediane 24.4/21.9 solo descrittive. **F2 (importante anche per il run 4): il
> driver ha letto la skin dal blocco CACHED del dumpsys (31.4 fisso) e quel
> valore è finito nell'override thermo dell'app; la HAL viva andava 29.3 →
> 40.0 °C (alcuni "after" di B sopra la soglia di warning 39.5) → il FAST del
> governor è stato calcolato su input stantio; dimensione termica del run 3
> non interpretabile.** F3: numerica f16 GPU = ipotesi principale, alternative
> (fedeltà del commit KV, bordi dei chunk, routing) da escludere. Fix REPORT +
> driver (skin dalla sezione HAL, dry-run con fixture doppia) → Luna 5fcd34c9.
> Poi bank: ALIVE 48 + registro.

> **6/09 01:45 Mac — Delta audit 5 (grok): GO per il run 4 (TTFT) con APK
> 64931c1.** `prefill_us` avvolge ogni `llama_decode` con n_tokens>1
> (chunk inclusi, replay escluso), reset a `beginCompletion`; arm A
> funzionalmente identico (`governor_prefill = hasGovernor() && prefill_n>0`);
> nessun throw né `time_us` per token; vendor = fork; test rieseguiti
> (`prefill_us=251443`). Nota metodologica per il run 4: l'oracolo fallirà di
> nuovo (divergenza deterministica nota) → per la regola bloccata l'endpoint 2
> resterebbe "non analizzabile"; il run 4 va dichiarato pre-dati come run
> DESCRITTIVO (TTFT B vs A con `promptMs`/`prefill_ms` del turno, decode, skin
> HAL corretta), non come nuovo test dell'ipotesi. Da decidere dopo il bank.

> **6/09 02:00 Mac — S5 BANCATA (ALIVE 48, registro).** REPORT corretto per
> F1-F10 (145 righe); driver: skin dalla sezione HAL (dry-run prova 37.25 ≠
> cached), PREREG post-data note. Prossimo: run 4 DESCRITTIVO con APK 64931c1
> appena la CI 33946344038 è verde (TTFT B/A misurabile, skin corretta, oracolo
> atteso FAIL), poi indagine divergenza.

> **6/09 02:40 Mac — CI 33946344038 (64931c1) CANCELLATA dalla concurrency del
> workflow** quando Luna ha pushato `e8c2b1f` "fix(governor): clear KV and skip
> sessions" (residui delta 2 lato app) e lanciato la CI 33947705999. Lezione:
> una sola CI viva per branch — non dispatchare residui mentre l'APK di una
> cella è in build (o usare un tag dedicato). Decisione: run 4 con l'APK
> e8c2b1f dopo delta audit 6 (residui app + fork: sentinella, V79, clear KV).
> Waiter su 33947705999 → `~/kalsa-qdc/apk/apk-gov-e8c2b1f/`.

> **6/09 02:50 Mac — Residui consegnati (Luna ee4741e9), verificati su disco:**
> fork `135232fa0` (sentinella `k_prefill_chunked = -1001`), `8f939aa7d` (ramo
> GPU V79 in `prefill_engine()` con cit. ALIVE #38 e test router V79),
> `3a161adfc` (`llama_governor::clear_cache` pulisce ENTRAMBI i KV e azzera
> watermark/fase/commit); app `e8c2b1f` (pin → 3a161adfc, `clearCache` in
> governor mode chiama la nuova API invece di lanciare; session save/load in
> governor mode = skip esplicito JS con riga `KALSA_SESSION
> {"op":"save","ok":false,"reason":"governor-mode"}`). CI 33947705999 in volo →
> APK del run 4. Delta audit 6 → grok.

> **6/09 03:15 Mac — CI 33947705999 VERDE (~47 min): APK e8c2b1f in
> `~/kalsa-qdc/apk/apk-gov-e8c2b1f/`, sha `e16cf0b6…8eaf`, debuggable ✓.** PREREG
> emendato pre-dati: run 4 DESCRITTIVO (TTFT B misurabile, skin HAL, oracolo
> atteso FAIL → endpoint 2 resta non analizzabile). Apro `S5-QRD8650-r4`.

> **6/09 03:25 Mac — S5 RUN 4 (descrittivo) IN CORSO: sessione 799321
> `S5-QRD8650-r4`, job sa803390, tunnel 6037 (`~/kalsa-qdc/tunnel-799321.pid`),
> serial 72c4dabb (board diversa dai run 2-3), APK e8c2b1f, driver con skin HAL.**
> Budget 8 Gen 3 prima: 797 min. Watcher attivo.

> **6/09 03:40 Mac — S5 RUN 4 (sa803390, board 72c4dabb): 4 turni poi ABORT a B2
> — IL GATE TERMICO DEL GOVERNOR SI È VISTO DAL VIVO.** Skin HAL viva: 30.3 →
> 33.4 (A1) → 35.4 (B1) → 38.1 (A2) °C. A B2 il bench thermo mandava 38.1 °C
> con trend +0.92 °C/min (`t_idle 29.5`): la policy ha risposto
> `admit_prefill: prefill admission is waiting for a safe tabled chunk` →
> nessun prefill GPU, prewarm `skip eval-failed` (veritiero), turno senza
> telemetria → il driver ha abortito (gate B). **Finding di prodotto (S7):** il
> "Wait" della policy deve degradare a prefill CPU (l'`engine=CPUFallback`
> dell'ammissione non è consumato dal runtime, delta 3), non bloccare il turno.
> Numeri descrittivi ottenuti: B1 `promptMs 454 ms`, `prefill_chunks "2+13"`,
> `commit 9.2 MB / 6.2 ms`, decode 20.7 tok/s; A1/A2 TTFT 335/324 ms (!) vs 44 s
> del run 3 con lo STESSO `tokensCached 1397`: nel run 3 la cache del prewarm
> non veniva sfruttata dal turno, nel run 4 sì (APK e8c2b1f: sospetto il fix
> clearCache/session, da spiegare nell'addendum). Il TTFT del turno confronta
> ~15 token nuovi (sistema in cache): il confronto GPU/CPU su 1024 token resta
> il prewarm (run 3: 5.2 s vs 9.3-9.9 s). Sessione 799321 chiusa (~19 min).
> Addendum REPORT → Luna 5fcd34c9; poi fix "Wait → CPU fallback" (fork+app).

> **6/09 03:40 EDT Mac — RUN 9 LANCIATA su QRD7675** (sessione QDC **807351** = sa811420, aperta 03:33, 120 min;
> APK debuggable **7e3d6d6** sha 4ae5bf63…, 142,7 MB, da CI run 34017852150; driver 93623d28 con ladder 200/100,
> force per B su tutti i tag, gate RAM passato con 11,6 GB; `ABABAB 85`, fine ≤05:05). Al primo lancio NO_DEVICE
> (server adb remoto non pronto ~40 s dopo il tunnel, come per 804701): rilancio 03:40. Build kit baseline
> 12f6d9b6d: primo tentativo morto sul parser dei target (fix: basename prima dei `:`), secondo morto per un
> `embed_kernel.py relu.cl` fallito nel container senza messaggio (in locale rc 0 → race transitoria del file
> sharing Docker con -j8), terzo lancio incrementale in corso.

> **6/09 04:00 Mac — Addendum run 4 nel REPORT (Luna 5fcd34c9, 183 righe
> totali)**: numeri descrittivi, semantica TTFT (15 token nuovi), gate termico
> a 38.14 °C / +0.917 °C/min, 44 s vs 335 ms "non determinabile dai log"
> (stesso riuso KV in entrambi i run; proposta riga nativa start/end prefill
> per turno). Audit addendum → deepseek. Fix "Wait → prefill CPU" in corso
> (ee4741e9).

> **6/09 04:15 Mac — Addendum run 4 auditato (deepseek BANK-WITH-FIXES, 5 minori
> di forma, applicati da me: 3 turni + abort, citazioni durata/budget da
> portale non da raw, "consistent with" per l'overhead chunking, floor n=2/n=1
> per le mediane, "first in this evidence base"). ALIVE 48 aggiornata col run 4.**
> Stato S5: bancata con 4 run, 2 bug engine + 3 bug integrazione trovati e
> fixati, gate termico osservato. In volo: fix "Wait → prefill CPU" (ee4741e9).

> **6/09 04:15 — RUN 9 prima coppia (QRD7675, B forzata): GPU prefill 7,42 s vs CPU 11,77 s → B/A 0,631 (1,59×)**,
> FUORI dalla banda di parità pre-registrata e sotto la soglia 0,85 che riapre la policy per i mid-tier (il prior
> presumeva uno sconto in-app 0,6 sul 1,6× CLI: qui lo sconto non c'è). Decode B −12%. **Oracolo FAIL con ids GPU
> byte-identici a quelli del 750** (d4556574…), CPU identica su 732/750/8 Elite, 8 Elite GPU differisce per 1 token.
> ⇒ la divergenza in-app è una proprietà dei kernel A7X, non del difetto 750 dei 20 FAIL (che il 732 passa). Post hoc
> in PREREG S5b + Amendment 3 nella cella 750 con predizioni per run 8b (gate cambia gli ids? → l4_y8 sul critical
> path; ids invariati → precisione/altro). Kit baseline pronto (99d7245e…), candidato in build.
> Trappola build: `embed_kernel.py` fallisce senza messaggio in 2 build su 3 nel container (race del file sharing
> Docker/macOS con -j8 sul passo Generate); il rilancio incrementale passa sempre. Da mettere nel build-kit.sh un
> retry automatico del passo 02 (una volta) prima di dichiarare fallito.
> **04:45 — kit candidato pronto** (`gpu-kit-2f3b24d.tgz`, ea665c37…). `d_run.sh` della cella 750 (Luna 2d5dfbe0,
> 148 righe: baseline→candidato, tbo MUL_MAT/MUL_MAT_ID/FLASH_ATTN_EXT + llama-bench, gate termico di cella 58,
> BASELINE_GATE = esattamente 20 FAIL altrimenti exit 6): **audit #21 deepseek NO-GO** — blocker: il conteggio FAIL
> dava 40 sul file reale (righe `: FAIL` + riga nuda duplicata per shape) → il gate baseline non poteva mai passare;
> major: i sub-conteggi filtravano n>1/o>1, che la famiglia (n=1,o=1) non ha. Fix in corso con validazione sul file
> di cella 58 (905/20). Run 9: A1 11,77 / B1 GPU 7,42 / A2 12,48 valide, B2 in typing dopo 810 s di cooldown.
> **04:50 — audit #21b GO**, d_run 750 committato. **Run 9 seconda coppia: B2 GPU 7,42 s (identica a B1) vs A2 CPU
> 12,48 s → 0,595; mediana delle 2 coppie stesso-turno 0,613 (1,63×)**, stessi ids GPU d4556574 (oracolo FAIL ×2).
> A3 in cooldown, deadline 05:05. Poi: End Session 807351, REPORT run 9, ALIVE 52; sessione QRD8650 per il test kit.
> **05:15 — RUN 9 CHIUSA** (deadline 05:04:50): **5/5 righe valide**, A3 12,54 s spaiata, B3 persa; raw d78a39fb;
> sessione 807351 Completed; REPORT run 9 Luna 81005e53 in scrittura. **Sessione QDC 807841 = sa811910 (QRD8650,
> df8ea83f) aperta 05:11; d_run 750 lanciato 05:14** (baseline gpu-kit-12f6d9b → gate 20 FAIL → candidato
> gpu-kit-2f3b24d; tbo MUL_MAT/MUL_MAT_ID/FA + llama-bench; deadline 60 min). Trappola: `raw/` mancante nella
> cella nuova → nohup silenziosamente fallito al primo lancio (mkdir prima).
> **05:30 — TEST KIT 750: H1′ CONFERMATA A LIVELLO KERNEL.** Baseline gpu-kit-12f6d9b riproduce esattamente
> `MUL_MAT 905/20` (gate baseline passato; famiglia k_v=2112/m=128/n=1: 28 pass / 20 fail; altre viste 145/0);
> **candidato gpu-kit-2f3b24d (gate `ADRENO && !ggml_is_contiguous(src0)` → kernel f16 generico): MUL_MAT 925/0**,
> famiglia 48/0; MUL_MAT_ID 407/407 e FLASH_ATTN_EXT 226/226 identici su entrambi; SHA256SUMS OK su device per
> entrambi i kit; gate termico PASS. Bench baseline pp512 289,04±1,01 / tg128 22,67±0,10 (≈ #58); bench candidato
> in corso (guardia ±10%). Restano: 8 Elite pp512 col candidato (Amendment 2) e run 8b in-app (Amendment 3: gli ids
> GPU cambiano da d4556574?) prima di qualunque decisione su allowlist/pin.
> **05:40 — test kit 750 COMPLETO** (END complete 05:25): bench candidato pp512 289,59±0,05 / tg128 22,17±0,02 →
> +0,2% / −2,2% (guardia ±10% ok). Sessione 807841 Completed (~14 min usati), raw committato, **fork branch
> `kalsa/opencl-picks-2026-09+25910` pushato** (c7ad97025 + 2f3b24dee). REPORT cella 750 Luna 0f36d889 → audit →
> ALIVE 53. **Sessione 807861 (QRD8635) aperta 05:38 per run 10** (stesso APK 7e3d6d6, driver S5b, `ABABAB 85`).
> **06:00 — ALIVE 53 bancata** (449cdab8). Fork: branch **`kalsa/governor-v0.3-on-2f3b24dee`** = governor 9c28322ac
> + merge del pick branch (3bec271fd, solo ggml-opencl.cpp +28/−6, test policy ok), pushato. App: **pin bump c8d137e**
> (3bec271fd), pushato; **APK CI run 34025628896** in corso (~40 min) → serve per run 8b (750 in-app col gate) e,
> via kit CLI già pronto, per il bench 8 Elite. Run 10 QRD8635 in volo (sessione 807861, driver 05:34).
> **06:05 — RUN 10 prima coppia (QRD8635 / Adreno 735, B forzata): GPU 6,88 s vs CPU 11,62 s → 0,592 (1,69×)**,
> forced/FAST, commit 12,1 MB / 13,5 ms, decode 15,3 vs 17,2. **Oracolo FAIL con ids GPU d4556574 = 732 = 750**: tre
> board A7X con la stessa sequenza GPU, CPU 647f906d identica su quattro board. La proprietà A7X è confermata su
> tre GPU (732/735/750). Driver 750 con `KIT_BASELINE_GATE` committato; APK c8d137e in build (~06:27).
> **06:32 — APK c8d137e pronto** (CI 34025628896, sha 14f48561…): governor + pick + gate 750. Piano sessioni (una alla
> volta): fine run 10 (~07:00) → **Guard A** su QRD8750 (kit CLI baseline vs candidato, `KIT_BASELINE_GATE=0`,
> letture ±10%/25% pre-dichiarate) → **run 8b** su QRD8650 (in-app, ids GPU ≠ d4556574?) → **run 11** HDK8550.
> **07:15 — run 10 BANCATA (ALIVE 54, f415caf2)**: 735 forzato 1,72×, ids GPU = 732 = 750. **Guard A rinviata**: la
> sessione 807910 sull'8 Elite è rimasta "Device is offline, attempting to reconnect" per 10 min (chiusa, ~13 min
> bruciati). Ordine invertito: **run 8b su QRD8650 ora**, poi Guard A (ritentare), poi run 11 HDK8550.
> **07:50 — QDC MUTO dalle ~07:00**: tre sessioni consecutive senza adb (807910 8 Elite "offline"; 807913 QRD8650
> Running ma `protocol fault` per 18 min; 807914 HDK8550 idem 8 min; tunnel verificato con lsof e sonda grezza:
> connessione resettata dal remoto → il server adb dell'host non parte). Tutte chiuse (~35 min di budget bruciati
> in totale). Pausa 45 min, poi ritentare con UN board (run 11 HDK8550). Nel frattempo nessun lavoro device.
> Stato punti owner: (1) FATTO; (2) run 9 e 10 bancate (ALIVE 52/54), run 11 in attesa QDC; (3) gate bancato
> kernel-level (ALIVE 53), Guard A e run 8b in attesa QDC.

> **6/09 04:40 Mac — Fix "Wait → prefill CPU" consegnato (Luna ee4741e9): fork
> `a6642b73d` (route decisa UNA volta per turno al primo batch multi-token:
> Wait o CPUFallback-non-FAST ⇒ tutto il prompt su ctx_decode, etichetta CPU,
> commit 0, `prefill_chunks "cpu:N"`; altrimenti GPU per tutto il turno), app
> `0517dc2` (pin + sync). Test: hot ⇒ CPU/commit 0/posizioni coerenti; cool ⇒
> GPU + commit. Build/router/turns 0. CI 33951262697 in volo. Delta audit 7 →
> grok (attenzione: assert `generated >= 0` nel test hot è debole; condizione
> `thermal_state != FAST` per il CPUFallback da giustificare).

> **6/09 04:55 Mac (Roma 10:55) — CI 33951825993 VERDE (~50 min): APK 0265333
> in `~/kalsa-qdc/apk/apk-gov-0265333/`, sha `38d63210…b35b`.** PREREG emendato
> pre-dati: run 5 descrittivo, attesa turno B caldo completato su CPU
> (`engine_prefill CPU`, `cpu:N`); nota sul gate B del driver (riga degradata
> valida anche se il driver abortisce). Apro `S5-QRD8650-r5`.

> **6/09 05:00 Mac — Delta audit 7 (grok): GO-WITH-FIXES, 3 cambi obbligatori
> prima del run 5:** (1) `prefill_route_` non si resetta per turno JS: il
> prewarm freddo lascia `last_phase=Prefill` e un turno caldo successivo
> ignora il Wait (resto valutato su GPU); (2) `refresh_policy_stats()`
> sovrascrive `prefill_engine` con l'etichetta della policy (GPU in WARM) dopo
> il primo token → `KALSA_GOVERNOR` mentirebbe sul route eseguito; (3) test
> `generated >= 0` → `>= 1` + test prewarm→turno caldo. Fix → Luna ee4741e9
> (fork, un commit, pin+sync, una CI; la CI 33951262697 verrà cancellata dalla
> concurrency: atteso).

> **6/09 05:05 Mac — S5 RUN 5 (descrittivo, degradazione termica) IN CORSO:
> sessione 799390 `S5-QRD8650-r5`, job sa803459, tunnel 6037
> (`~/kalsa-qdc/tunnel-799390.pid`), serial 45207755 (terza board), APK 0265333.**
> Budget 8 Gen 3 prima: 776 min. Watcher attivo. Attesa: se la board scalda
> oltre 38 °C, un turno B con `engine_prefill CPU` e `cpu:N` che COMPLETA.

> **6/09 05:15 Mac — S5 RUN 5 (sa803459, board 45207755): 6 turni, poi abort
> dopo B3 per il gate GPU del driver (riga degradata VALIDA). DUE RISULTATI
> CHIAVE.** (1) **Degradazione termica funziona end-to-end**: skin 30.6 →
> 38.5 °C in 5 turni; a B3 (38.53 °C, stato WARM) la policy ha detto Wait e il
> runtime ha instradato il turno su CPU e lo ha COMPLETATO: prewarm CPU 10.3 s
> (vs GPU 5.6 s a B2), `KALSA_GOVERNOR {engine_prefill:"CPU", commit_bytes:0,
> prefill_ms:337.6, prefill_chunks:"cpu:2+13", thermal_state:"WARM"}`, decode
> 22.1 tok/s. (2) **ORACOLO PASS sul turno CPU-routed**: ids_sha di B3 =
> 0f4b385a… = A → con il prefill su CPU il governor produce ESATTAMENTE i token
> di A; B1/B2 (prefill GPU) FAIL con il solito ed228033… → la divergenza al
> token 14 è isolata causalmente nel prefill GPU (numerica OpenCL Adreno 750
> nel KV), non nel commit né nel routing. B1/B2: GPU 452.9/457.4 ms `2+13`,
> commit 6.8/14.5 ms, decode 22.8/22.2. A: TTFT 44.9/41.8/42.1 s (come run 3;
> il 335 ms del run 4 era della board 72c4dabb — dipende dalla board/sessione,
> non dall'APK), decode 24.8/24.1/24.1. Sessione 799390 chiusa (~15 min).
> Addendum → Luna 5fcd34c9; poi audit, ALIVE 48, memoria. Prossimo tecnico:
> indagine numerica del prefill GPU (fork: precisione f16 nel path OpenCL /
> KV) — ora con un test causale a portata di mano (CPU-routed = identico).

> **6/09 05:20 Mac — Fix delta 7 consegnati (Luna): fork `39c35bd1e`
> (`reset_prefill_stats()` azzera anche `prefill_route_`, chiamato da
> `beginCompletion`; etichetta = route eseguita, policy solo se Undecided; test
> hot con 3 token decodificati e label CPU stabile), app `0265333` (pin+sync).
> Build/router/turns 0. CI 33951825993 in volo. Delta audit 8 → grok (verifica
> anche il test prewarm→turno caldo e l'assert sui token generati).

> **6/09 05:30 Mac — Attribuzione della divergenza: il repo lo sapeva.** ALIVE
> #38 (QRD8650): `MUL_MAT 905/925 — 20 FAIL, tutti f16|bf16 × f32 batched
> m=128 n=1 k=1056 k_v=2112` = difetto driver/compiler del 750; ALIVE #39: il
> 735 è pulito → "SOLO del 750". Il prefill GPU del governor sul QRD8650 passa
> per quel path. **Test decisivo pre-registrato (run 6): stesso APK 0265333 e
> driver sull'8 Elite (QRD8750, Adreno 830, V79 con ramo GPU in policy):
> attesa oracolo PASS su B GPU; se FAIL, l'attribuzione al 750 è refutata.**
> Indagine documentale parallela su Luna ee4741e9
> (`docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md`). Apro `S5-8Elite-r6`.

> **6/09 05:40 Mac — Delta audit 8 (grok): GO per il run 5 con APK 0265333**
> (reset route per turno, etichetta = route eseguita, test rieseguiti). Attesa
> per il run 5: un turno B caldo completa con `engine_prefill CPU` e
> `prefill_chunks "cpu:…"`. Gate: CI 33951825993.

> **6/09 05:40 Mac — S5 RUN 6 (8 ELITE) IN CORSO: sessione 799540 `S5-8Elite-r6`,
> job sa803609, tunnel 6037 (`~/kalsa-qdc/tunnel-799540.pid`), serial 2a38935c,
> `ro.soc.model SM8750` (driver BOARD=8-Elite), Android 16, APK 0265333.** Budget
> 8 Elite prima: 623 min. Watcher attivo. Test pre-registrato: oracolo PASS su
> B con prefill GPU ⇒ il difetto è del 750; FAIL ⇒ divergenza generica OpenCL.

> **6/09 05:50 Mac — Addendum run 5 nel REPORT (Luna, 212 righe totali):** B3
> degradato a CPU, completato, oracolo PASS; B1/B2 GPU FAIL. Correzione mia a
> verbale: il trend a B3 era +0.422 °C/min (il +0.917 era il B2 del run 4).
> Audit addendum → deepseek. Run 6 (8 Elite) in corso.

> **6/09 05:55 Mac — RUN 6 (8 ELITE, sa803609): ORACOLO PASS CON PREFILL GPU.**
> B1: `engine_prefill GPU`, commit 9.2 MB / 7.7 ms, `prefill_ms 358`, `2+13`,
> FAST, ids_sha = A (0f4b385a…) → **il test pre-registrato conferma
> l'attribuzione: la divergenza al token 14 era il difetto f16/bf16-batched
> del SOLO Adreno 750 (ALIVE #38/#39); su Adreno 830 il prefill GPU del
> governor è token-identico alla CPU.** Prime coppie oracle-PASS ⇒ endpoint 2
> analizzabile. Parziali: A 28.7/28.4 tok/s, B 28.5; TTFT A 43.7/41.1 s
> (pattern "prewarm non riusato" anche qui), B 358 ms (15 token); prewarm GPU
> 4.06 s; MemAvailable 12.3 → 8.0 GB (B). Run in corso (B2-B4).

> **6/09 06:00 Mac — RUN 6 (8 ELITE, sa803609) COMPLETO: 8/8 turni, ORACOLO
> PASS 4/4** (B1-B3 con prefill GPU; B4 instradato su CPU a 38.08 °C / WARM e
> completato: `cpu:2+13`, 246 ms, 28.3 tok/s). **Decode: mediane turni 2-4 A
> 28.53 vs B 28.33 tok/s** — parità entro l'1%, formalmente sotto il "≥" della
> regola bloccata (da riportare come tale). **TTFT del turno: B 358 ms vs A
> 41-43 s** — MA il braccio A non riusa il KV del prewarm (rivaluta 1329 token
> a ~30 tok/s; `tokensCached 1397` uguale in entrambi) mentre B sì: il
> confronto è "riuso vs non-riuso", non GPU vs CPU → va dichiarato non equo;
> la cifra GPU vs CPU comparabile è il prewarm a 1024 token: B GPU 4.06/4.30 s
> vs A CPU 6.6-6.8 s (≈1.6×; il #38 del fork su prompt 512 senza cache dava
> ~10×: differenza da spiegare, sospetto overhead non-GPU nel prewarm). RAM:
> MemAvailable 12.2-12.4 → 7.8-8.0 GB (B), → 10.0 (A); nessun lmkd. Skin 30.3
> → 39.5 °C. Sessione 799540 chiusa (~23 min). Addendum → Luna 5fcd34c9.

> **6/09 06:10 Mac — In volo:** addendum run 6 (Luna 5fcd34c9); indagine
> documentale divergenza (ee4741e9, `docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md`,
> ora già confermata dal device); **nuova indagine (Luna 9392e981,
> `docs/ARM-A-PREFIX-REUSE-2026-09-06.md`)**: perché il braccio A non riusa il
> KV del prewarm (TTFT 41-45 s su 3 board, 335 ms su 72c4dabb) — sospetto
> session save/load KV attivo solo fuori dal governor mode. Finché non è
> capito, il TTFT del turno A/B non è un confronto GPU-vs-CPU valido.
> Memoria aggiornata (run 6, indice).

> **6/09 06:20 Mac — Decisione prodotto per V75 (Adreno 750):** finché il difetto
> f16/bf16-batched non è aggirato nel fork, l'app NON deve fare prefill GPU su
> V75 → gate di correttezza per generazione in `governorInputs.ts`
> (`GPU_PREFILL_CORRECT`: V79 true da run 6; V75 false da run 3-5; V73/Unknown
> false), governor disabilitato con riga `KALSA_GOVERNOR_FALLBACK
> {stage:"correctness", reason:"gpu-prefill-incorrect-V75"}`, override bench
> `kalsa.bench.governor_force=1` per le celle di test. → Luna ee4741e9 (solo
> src/engine, niente CI finché non atterrano anche le altre modifiche).
> Indagine divergenza in `docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md` (108 righe +
> nota di conferma dal run 6): ipotesi `kernel_mul_mm_f16_f32_l4_lm`
> miscompilato da E031/A7X; nessun flag di fix nel fork; contenimento possibile
> via `GGML_OPENCL_OPFILTER`; esperimento #1 = test-backend-ops sulla board.

> **6/09 06:35 Mac — RISOLTO il mistero del TTFT 41-45 s del braccio A (Luna
> 9392e981, `docs/ARM-A-PREFIX-REUSE-2026-09-06.md`): A RIUSA il prefisso come B
> (`reusing 1314/1329`, `n_past=1314` in tutte le run), il `promptMs` è timer
> inquinato — `llama_perf_context_reset` azzera `t_p_eval_us`/`n_p_eval` ma non
> `t_compute_start_us`/`n_queued_tokens`, usati da `synchronize()` per
> accumulare il tempo di prompt → include l'attesa fra prewarm e Send (run 5:
> gap 44.5 s ≈ 44.9 s riportati; run 4: gap 20 ms ≈ 335 ms).** Conseguenze:
> (a) il TTFT del turno A/B DIVENTA equo (entrambi 15 token nuovi) appena il
> timer è corretto; (b) i 42-45 s di A nei run 3/5/6 non sono prefill.
> Fix nel fork (`llama_perf_context_reset` azzera anche lo stato asincrono +
> test di regressione con sleep) → Luna 9392e981, un commit, senza push; pin
> bump dopo il gate V75 di ee4741e9, poi UNA CI.

> **6/09 06:45 Mac — Gate di correttezza V75 consegnato (ee4741e9, app
> `f98a9fa`, non ancora in CI):** tabella `GPU_PREFILL_CORRECT` (V79 true /
> V75 false / V73 false / Unknown false con citazioni ALIVE), refusal JS
> `KALSA_GOVERNOR_FALLBACK {stage:"correctness", reason:"gpu-prefill-incorrect-V75",
> forced}`, override bench `kalsa.bench.governor_force=1`; jest 16/16, tsc 0.
> Addendum run 6 nel REPORT (245 righe) con la nota sul timer inquinato di A →
> audit deepseek in corso. Aspetto il fix perf del fork (9392e981) per pin bump
> + sync + UNA CI, poi delta audit 9 (gate + perf + pin).

> **6/09 07:00 Mac — Fix timer perf nel fork (Luna 9392e981): `e31b9144c`
> `perf_reset()` chiama `synchronize()` e azzera `t_compute_start_us`/
> `n_queued_tokens` (+ `tests/test-perf-reset.cpp`); build/router/turns 0;
> pushato su Aspis0/kalsallama.** Sospetto passato all'audit: il test stampa
> `prompt_ms=0.000` dopo un batch di 2 token (dovrebbe essere > 0). In volo:
> pin bump + sync + UNA CI (ee4741e9) e delta audit 9 di grok (gate V75
> f98a9fa + perf e31b914 + pin). Poi run 7 sull'8 Elite: primo TTFT equo.

> **6/09 07:15 Mac — Pin bump app `8a56edc` (→ fork e31b9144c; vendor: solo
> llama-context.cpp + VENDOR_SHA + build-info; npm ci/clang/jest 16/tsc 0),
> CI 33957267070 in volo (waiter → `~/kalsa-qdc/apk/apk-gov-8a56edc/`).** Delta
> audit 9 di grok in corso.

> **6/09 07:30 Mac — Delta audit 9 (grok): GO-WITH-FIXES per il run 7.** (1)
> pin bump: già atterrato (8a56edc, CI 33957267070 in volo); (2) commento V79
> "ALIVE 48 = run 6 PASS": corretto, la riga 48 include il run 6 dal commit
> 4df043e6 (l'auditor l'ha letta prima); (3) `test-perf-reset` passa con
> `prompt_ms=0.000` → deve asserire `n_p_eval ≥ 2` e `0 < t_p_eval_ms < 100`
> + controllo negativo dello sleep → Luna 9392e981, solo test, fork.

> **6/09 07:45 Mac — Test perf-reset reso decisivo (fork `3f71159fd`, solo test,
> pushato):** `n_p_eval=2, prompt_ms=3.84` dopo il reset vs controllo negativo
> senza reset `prompt_ms=316.99` (≥ 300 = lo sleep) → la pollution è
> riprodotta e il fix la elimina. Lo 0.000 di prima era `no_perf=true` di
> default nel test. Non tocca l'APK (CI 33957267070 di 8a56edc in volo).

> **6/09 07:55 — OWNER: oracolo a logit OK "purché non facciamo passare una cosa sbagliata".** Pre-registrato in
> `scratchpad/agents/logit-oracle/PREREG.md` (R1 disaccordo con CPU sicura ≥0,03 = FAIL; R2 top-5 entro 0,10 nats,
> p1 entro 0,02; R3 divergenze solo near-tie e scelta = #2, max 1; R4 teacher forcing 32 passi su ≥2 coppie; R5
> sanità 8 Elite PASS + build rotta FAIL; R6 nessuna promozione automatica; soglie solo restringibili).
> Fattibilità (Luna 5e7af1d9, read-only, con quote): `n_probs` di llama.rn è POST-sampler (con top_k=1 resta un solo
> candidato), nessun `post_sampling_probs`, `logit_bias` statico, grammar letterale non garantisce gli id → serve
> un hook nativo bench-only nella patch: `bench_raw_probs` (top-N da softmax sui logit grezzi PRIMA di
> `common_sampler_sample`) + `bench_force_ids` (id forzato per passo attraverso lo stesso accept path).
> **In corso**: Luna 5e7af1d9 implementa hook + chiavi `kalsa.bench.probs` / `kalsa.bench.force_ids` + log
> `KALSA_BENCH_PROBS`; Luna 2d5dfbe0 il driver (`ORACLE_MODE=logit`, `oracle_logit.py` R1-R4, colonne
> `oracle_logit`/`oracle_rule`, dryrun). Poi audit, APK, sanità R5 sull'8 Elite, TF su 750/732/735.
> **08:40 — QDC: SLOGGATI.** Alla ripresa il portale reindirizza alla home; il login Okta (Qualcomm ID) chiede la
> password (Keychain ok) e poi la 2FA email. Ho provato a passare la password al browser da un server locale
> usa-e-getta per non farla transitare nei log, ma il browser Paseo non gira su questo Mac (fetch a 127.0.0.1
> fallisce) e non digito segreti in chiaro nei comandi. **Serve il login manuale dell'owner nel tab Paseo**
> (518a42c3, account.qualcomm.com). Fino ad allora niente device: run 11, run 8b, Guard A e le run TF dell'oracolo
> restano in coda. Il lavoro sull'oracolo (app + driver) continua.
> **08:55 — driver oracolo (Luna 2d5dfbe0: `ORACLE_MODE=logit`, `oracle_logit.py` 117 righe, colonne
> `oracle_logit`/`oracle_rule`, dryrun rc=0): audit #25 deepseek NO-GO per un MAJOR che è esattamente il rischio del
> mandato** — in TF un passo forzato con token diverso faceva uscire DESCRIPTIVE R4 subito, nascondendo violazioni
> R1/R2 nei passi successivi (caso avversario dell'auditor: R1 con margine 0,40 al passo 1 → invisibile). Fix in
> corso: tutti i passi vengono valutati, FAIL domina, DESCRIPTIVE solo senza violazioni e con copertura difettosa;
> divergenza con margine alto etichettata R1. I casi avversari del REPORT (drift p1 0,60→0,50 → FAIL R2; token pA
> 0,05 assente dal top-5 B → FAIL R2) passano già.
> **09:05 — app: hook oracolo committato 28424c3** (Luna 5e7af1d9; patch +160/−4: `benchRawTopProbs` = softmax su
> `llama_get_logits_ith(ctx,-1)` PRIMA di `common_sampler_sample`, `raw_probs` nell'item di streaming,
> `bench_force_ids` consumato un id per passo; TS: chiavi `kalsa.bench.probs`/`kalsa.bench.force_ids` solo sotto
> greedy, log `KALSA_BENCH_PROBS`; jest/tsc rc 0; 197 hunk verificati). Audit #26 deepseek in corso (focus:
> pre-sampler garantito, accept path identico, nessun effetto fuori bench).
> **09:40 — audit #26 GO** (pre-sampler confermato: il sampler lavora su `cur_p`, copia; forced id via accept path;
> bench-only; 1 minore F6 mitigato) → app pushata, **APK CI 34034615470** in corso. Driver oracolo: audit #25b ancora
> NO-GO per un buco residuo in TF (R1 strutturalmente irraggiungibile: in TF il tok è forzato, il disaccordo sta nel
> top-1 grezzo; un passo con forcing fallito era escluso senza valutarlo) → PREREG Amendment 2 (raw top-1 per R1;
> il passo con forcing fallito si valuta e poi si smette; FAIL domina) e fix in corso (Luna 2d5dfbe0).
> **Controllo negativo R5** (PREREG Amendment 1): branch fork usa-e-getta `kalsa/bench-fault-inject` (33ebbd210):
> guasto `c0..c3 *= 0.5h` nel GEMM Q4_0 Adreno `gemm_noshuffle_q4_0_f32` (path certo del prefill Q4_0 con n=128,
> dispatch quotato); il primo tentativo sul kernel f16 l4_lm era su un path forse inattivo → spostato. Il define va
> reso incondizionato sul branch (llama.rn non riceve flag CMake dal fork) → poi app branch `bench/fault-inject-apk`
> + pin + APK. Attesa sull'8 Elite: APK normale PASS, APK fault FAIL R1/R2.
> **09:55 — fault branch 5f0701dac (define incondizionato) → app branch usa-e-getta `bench/fault-inject-apk` @ca3b1b3
> (pin bump, vendor con kernel Q4_0 guasto), APK CI 34035120099 in corso; APK normale 28424c3 (34034615470) in corso.**
> **10:05 — driver oracolo committato dce92481 (audit #25c GO, incluso il caso cardine: tutti forzati, tok corretti,
> disaccordo grezzo a margine 0,30 → FAIL R1).** Piano R5 pre-registrato (§Session plan): una sessione 8 Elite, APK
> normale → PASS atteso, APK fault → FAIL atteso, letture delle quattro combinazioni dichiarate. Tutto pronto tranne
> il login QDC (owner).
> **10:35 — login QDC: password dal Keychain (autorizzata in chat) ACCETTATA da Okta (`/idp/idx/challenge/answer`,
> `/users/me` ok), ma il redirect OAuth verso qdc.qualcomm.com non si completa: "Signing in…" indefinito, poi un
> nuovo `authorize` con state diverso (QDC riceve il codice e rimbalza); in un tab nuovo il widget Okta non si
> inizializza affatto. Con l'adb muto delle 07:00-08:00 su tre board, il quadro è un incidente lato QDC. Il 30/08 lo
> stesso login via script era passato. Pausa 45 min, poi login pulito (mai URL diretti dopo il login: nav a click).
> **09:52 — APK pronti**: oracolo 28424c3 (sha b2cc9675…) e fault ca3b1b3 (sha b6c24011…), in ~/kalsa-qdc/apk/. Tutto
> il materiale per R5 è sul Mac; manca solo il login QDC (ritento ~10:20).
> **10:45 — login QDC: STOP dopo 6 tentativi.** Diagnosi: Okta accetta la password (`/idp/idx/challenge/answer`,
> `/users/me` 200) ma la navigazione post-successo verso QDC non parte ("Signing in…" per sempre); in un tab nuovo
> con sessione Okta ricordata il widget non monta nemmeno e, montato a mano (`renderEl` con lo stateToken della
> pagina), non emette alcuna richiesta `/idp/idx/*`: nessun errore JS, nessuna rete → le navigazioni avviate dallo
> script Okta sembrano soppresse in silenzio nel browser Paseo di oggi. Il 30/08 lo stesso flusso via script era
> passato. Bloccante per tutto il lavoro device (R5, TF A7X, run 11, Guard A). Serve: login in un browser dove il
> redirect funziona (owner nell'app Paseo, se mostra il browser) o attendere. **pin bump 7e3d6d6** (`sync-kalsallama.sh pin` con
> KALSALLAMA_SRC, 5 file vendor); **PUSHATO** 8a56edc..7e3d6d6; **APK debuggable CI run 34017852150** in corso (~40 min). Driver runs 9-11 committato 93623d28 (audit #19 GO). (3) Websearch chiusa, candidato
> 178a6c449 annotato. Trappola ops: Paseo `create_agent` con provider pi NON accetta modeId (solo codex).

> La cronaca integrale è in **PLAN-archive.md** (spostata verbatim il 20/08,
> niente è andato perso). Regola invariata: ogni verdetto nuovo si appende QUI;
> quando questa vista supera ~300 righe, si archivia di nuovo.

> I capitoli chiusi di agosto (fix Adreno "trans4", K2, qk23, sessioni #16/#18/#20,
> "LA SPIEGAZIONE SEMPLICE", TL;DR lanes 14/08, scheda prodotto, regole operative,
> telemetria §8) sono in **PLAN-archive.md → «Vista PLAN.md agosto (spostata 5/09)»**.


> **6/09 08:50 Mac — CI 33957267070 VERDE: APK 8a56edc in
> `~/kalsa-qdc/apk/apk-gov-8a56edc/`, sha `272f4547…9946`, debuggable ✓.**
> PREREG emendato pre-dati: run 7 su 8 Elite = run 6 con timer corretto (TTFT
> equo sui ~15 token nuovi; la soglia ≤ 1/3 nasce per il prompt intero e va
> letta di conseguenza). Apro `S5-8Elite-r7`.

> **6/09 09:00 Mac — S5 RUN 7 (8 ELITE, TTFT equo) IN CORSO: sessione 800201
> `S5-8Elite-r7`, job sa804270, tunnel 6037 (`~/kalsa-qdc/tunnel-800201.pid`),
> serial 2a38935c (stessa board del run 6), `SM8750`, APK 8a56edc.** Budget
> 8 Elite prima: 600 min. Watcher attivo. Attesa: A `promptMs` di poche
> centinaia di ms (timer pulito), oracolo PASS, decode ≈ parità.

> **6/09 09:05 Mac — RUN 7 (8 ELITE, sa804270): 4 turni validi + abort ad A3
> per flake UI del driver (Send non trovato dopo il prewarm; regola PREREG).**
> **IL TIMER È CORRETTO E IL TTFT È FINALMENTE EQUO:** A `promptMs` 205 / 488
> ms (era 41-45 s), B GPU 358 / 359 ms sui ~15 token nuovi (`2+13`, commit
> 9.2 MB / 7.0 ms) → sui batch minuscoli CPU e GPU sono alla pari (la soglia
> ≤ 1/3 del PREREG, scritta per il prompt intero, non si applica al tail);
> prewarm 1024 token: A CPU 6.60/6.77/6.82 s vs B GPU 4.06/4.32 s (1.6×).
> Oracolo PASS 2/2 (GPU). Decode A 28.4/29.3 vs B 27.6/28.4 tok/s. Skin
> 32.9 → 38.2 °C. Sessione 800201 chiusa (~17 min; 8 Elite ≈ 583 min).
> Addendum → Luna 5fcd34c9. Nota driver: il flake Send va reso robusto
> (retry del dump UI) prima di un'altra cella.

> **6/09 09:30 Mac — Addendum run 7 nel REPORT (265 righe) → audit deepseek in
> corso. Driver reso robusto (retry UI in parse.sh, gate B solo in FAST;
> dry-run 0).** Prossima cella proposta (S5b): TTFT su prefill GRANDE senza
> prewarm (stesso driver, `kalsa.bench.prewarm=off` se esiste o prompt lungo
> nuovo), per riconciliare 1.6× (prewarm app) con ~10× (fork #38).

> **6/09 09:45 Mac — Audit addendum run 7 (deepseek): BANK-WITH-FIXES, 4
> minori di forma (rapporto di medie → rapporti per coppia 1.743/0.737;
> citazioni; "non applicabile" → "molto probabilmente non significativo,
> interpretazione"), applicati da me. ALIVE 48 aggiornata col run 7.** S5 è
> chiusa a 7 run: meccanismo, degradazione termica, correttezza su 830, timer
> e TTFT equo tutti a verbale.

> **6/09 10:15 Mac — S5b in bozza (Luna 5fcd34c9, `scratchpad/agents/qdc-governor-s5b/`:
> PREREG 103, d_run.sh 299, parse.sh 50, dryrun 91, PROMPT.txt 893 parole).**
> Meccanismo: nessuna chiave per spegnere il prewarm → prompt utente lungo
> (5.1 kB) via `input text`, prefisso di sistema resta in cache, la coda lunga
> è prefill nuovo. Rischi dichiarati: troncamento IME del payload, conteggio
> token non noto a priori. Audit pre-run → deepseek.

> **6/09 10:25 Mac — Audit pre-run S5b (deepseek): GO-WITH-FIXES, 4 major (M1 nessuna
> verifica della lunghezza del composer e il retry UI può raddoppiare il
> prompt; M2 regola mediane/esclusione WARM sottospecificata; M3 soglia ≥3× che
> ignora il prior 1.65× della cella stessa; M4 conteggio token non
> pre-registrato: il prompt è 938 token, non 1300-1500) + 5 minori → fix a
> Luna 5fcd34c9 con decisioni prese (verifica ≥90% + retype unico, retry mai
> ridigita; mediane solo su coppie GPU/FAST, WARM separate; due attese
> falsificabili ≥3× e ≈1.6×; colonna new_tokens da prefill_chunks/reusing).
> Memoria consolidata per la compattazione.

> **6/09 12:56 EDT — QDC RIENTRATO (login fatto dall'owner dal browser Paseo, nessun codice email). R5 IN VOLO.**
> Sessione **807948** `kalsa-oracle-R5-8elite` QRD8750 (host sa812017, serial b4bd0901, board `sun`, **Android 16**,
> 150 min, SSH only, chiave kalsa-mac; il campo minuti via `browser_fill` è stato preso: 149m48s). Tunnel 6037 pid
> `~/kalsa-qdc/tunnel-sa812017.pid`. Trappola nuova: una `adb devices` con `ANDROID_ADB_SERVER_PORT=6037` PRIMA del
> tunnel avvia un server adb locale sulla 6037 e il tunnel poi non binda IPv4 (`Address already in use`): kill-server,
> poi tunnel. Driver positivo: `ORACLE_MODE=logit d_run.sh sa812017 <APK 28424c3> ABABAB 50` (pid /tmp/s5b-driver.pid,
> raw/sa812017/) — `ABAB` del piano rifiutato dal validatore del driver → Amendment 3 nel PREREG logit-oracle. Poi
> negativo con APK ca3b1b3 sui minuti restanti.
> 13:22 — primo tentativo R5 positivo: A1 VOID `toolcall` (`document_chat`, tool sempre esposto, mai chiamato nelle run
> 8-10). Driver ucciso, `set_prefs` scrive anche `kalsa.bench.toolchoice=none` (chiave bench esistente, letta a ogni turno),
> dryrun rc=0, rilancio `ABABAB 45` (pid /tmp/s5b-driver.pid, raw/sa812017/; il tentativo vuoto in raw/sa812017-toolcall-void/).
> PREREG logit-oracle Amendment 4.
> 13:40 — secondo tentativo: A1 senza tool call strutturata ma con **fallback LFM eseguito** (`toolChoice:none` lascia i
> tool nel template e il parser di fallback non guarda toolChoice) → niente KALSA_BENCH_TOKENS → PREREQUISITE exit 3.
> Sessione 807948 CHIUSA (~48 min usati), tunnel giù. Fix app bench-only dispatchato a Luna 467e65e3 (feat/governor-in-app
> + cherry-pick su bench/fault-inject-apk), poi audit deepseek, 2 APK da CI, nuova sessione 8 Elite. PREREG Amendment 5.
> 13:55 — fix app bench-only da Luna 467e65e3: **1ec63a0** (feat/governor-in-app) e cherry-pick **14be59b**
> (bench/fault-inject-apk, parent ca3b1b3), patch byte-identico (verificato: `git diff` sha uguale), jest/tsc rc=0.
> `shouldUseToolCalling(mode)`: con bench "none" niente `tools` nella completion, pre-pass document_chat e parser di
> fallback saltati; produzione invariata. CI apk.yml lanciata su entrambi (run 34048611688 normale, 34048612833 fault);
> audit deepseek e6df762c sul diff in corso. Test di Luna coprono solo l'helper → la prova è on-device (A1 con
> KALSA_BENCH_TOKENS e `fallbackCalls:0`).
> 14:05 — audit #27 deepseek su 1ec63a0: GO-WITH-FIXES (prompt di sistema "hai web_search" ancora attivo; prewarm KV con
> tool → re-prefill a ogni turno; execute strutturato senza guard). Round 2 su Luna 467e65e3; gli APK 1ec63a0/14be59b
> in build NON verranno usati. Poi re-audit, rebuild, sessione.
> 14:20 — round 2 Luna: **19b67b6** (governor) / **e54f529** (fault; il ramo ha un commit doppio d911f70+e54f529 per un
> conflitto nel cherry-pick, src identici alle due punte, patch sha uguale — usa-e-getta, accettato). Chiude: prompt di
> sistema tool-free sotto "none", prewarm KV con lo stesso prefisso del turno (resolvePrewarmPrefix prende il mode;
> notifyStaticPrefixInputs legge la pref in `.then`), env-hash/turnPrefixHash coerenti, execute strutturato guardato.
> Mio dubbio passato al re-audit: il prewarm in produzione ora parte un tick dopo (lettura AsyncStorage), non più sincrono.
> CI 34049642898 (normale) / 34049644191 (fault); le build 1ec63a0 cancellate dalla concurrency. Re-audit deepseek in corso.
> 14:35 — re-audit #28 deepseek su 19b67b6: GO-WITH-FIXES, residui = micro-race di produzione (busy stantio di un tick,
> doppio prewarm raro, promise fluttuanti) → TODO fuori dal percorso critico. Strumenti R5 = APK 19b67b6 / e54f529.
> 14:40 — APK pronti: normale **19b67b6** sha c6d24bbd8b72…, fault **e54f529** sha 17850b2121b4… (run CI 34049642898 /
> 34049644191, ~25 min). Sessione **807952** `kalsa-oracle-R5b-8elite` QRD8750 (stessa board b4bd0901, Android 16), 150 min
> (149m46s: i minuti via JS stavolta presi), SSH only, kalsa-mac; Screen Always On rimasto OFF (l'harness forza stayon).
> Host sa812021, tunnel pid ~/kalsa-qdc/tunnel-sa812021.pid (aperto PRIMA del probe adb). Driver positivo pid
> /tmp/s5b-driver.pid = 16667: `ORACLE_MODE=logit d_run.sh sa812021 <apk 19b67b6> ABABAB 45`, raw/sa812021/.
> Attesi su A1: `fallbackCalls:0`, KALSA_BENCH_TOKENS presente, tokensCached < 2410.
> 15:05 — terzo tentativo: A1 pulita lato tool (fallback 0, TOKENS presente, prefisso prewarm = turno: 1474/546) ma VOID
> per `new_tokens_a=na`: il driver lo leggeva SOLO dalla riga di rollback `reusing N/M`, che ora non compare perché il
> KV non diverge più. Fallback da KALSA_KVPREFIX (text_tokens−n_common=928) in parse.sh/d_run.sh, testato sul logcat
> reale + dryrun rc=0. Quarto tentativo in volo (pid /tmp/s5b-driver.pid=64866, raw/sa812021/). Amendment 6.
> Prompt ora ~620 token più corto delle run 8-10 (non ~60 come stimato).
> 15:25 — quarto tentativo: **A1 VALIDA** (new_tokens_a=928 dal fallback KVPREFIX, tool_calls=0, ids_sha 558522c0…,
> TTFT 5,43 s, prefisso prewarm = turno) ma **B1 VOID `composer`**: il dump UI ha catturato il LAUNCHER, non l'app.
> Cronologia dal logcat B1: `am start` 744,69 → `Displayed com.kalsa.app` 744,92 → prewarm/prefill 756-770 →
> **`wm_on_top_resumed_gained_called [QuickstepLauncher]` 770,87** → dump edit.xml a 855 → `dump_fail stage=edit`.
> Nessun crash nativo, nessun LMKD: l'app è finita in background dopo il `device_wake` che gira DOPO poll_load
> (d_run.sh:380 → wake_sequence: `wm dismiss-keyguard` + tap). Su Android 16 il dismiss-keyguard riporta in cima il
> launcher. Fix minimo: prima di `ui_send`, verificare la top activity e rifare `am start` se non è com.kalsa.app.
> 15:40 — quinto tentativo in volo (pid 35313, `ABABAB 40`, raw/sa812021/). Aggiunto `app_foreground` (topResumedActivity
> + `am start` di rimessa in primo piano, 2 tentativi, altrimenti VOID `foreground`); dryrun rc=0 dopo aver registrato la
> funzione e lo stub `dumpsys activity activities`. Quarto tentativo archiviato in raw/sa812021-foreground-void/
> (A1/A2 valide, B1/B2 VOID composer). PREREG Amendment 7.
> 16:21 — quinta run: la guardia `app_foreground` FUNZIONA (B1: launcher → am start → app), ma la deadline 40 ha
> tagliato B1 a metà (solo A1 in results). Costo misurato per coppia ≈ 32 min → due coppie ≈ 65 min in una sola run.
> Con 44 min di sessione residui inverto l'ordine: **controllo NEGATIVO ora** (APK e54f529, `ABABAB 33`, tag
> sa812021-fault), positivo in una sessione dedicata da ~70 min. PREREG Amendment 8.
> 17:00 — anche il negativo ha perso B per deadline (`deadline_33_min`, A1 valida). Budget 8 Elite sceso a **89 min**:
> insufficiente. Sessione 807952 chiusa (Completed), tunnel giù, raw committati (43092dd5). **R5 si sposta su QRD8650**
> (623 min): positivo `ABABAB 85` + negativo `ABABAB 50` nella stessa sessione. Resta aperto il caso specifico
> dell'8 Elite (flip a idx 29). PREREG Amendment 9.
> 17:00 — sessione **807954** `kalsa-oracle-R5-8gen3` QRD8650 (host sa812023, serial 45207755, board pineapple,
> Android 14), 150 min (scade ~19:29 EDT), SSH only, kalsa-mac; tunnel pid ~/kalsa-qdc/tunnel-sa812023.pid.
> Positivo in volo: `ORACLE_MODE=logit d_run.sh sa812023 <apk 19b67b6> ABABAB 85` (pid /tmp/s5b-driver.pid=64715,
> raw/sa812023/). A seguire il negativo con l'APK e54f529, `ABABAB 50`.
> 18:40 — **QRD8650: crash nativo sul turno B.** A1/A2 valide (7,49 / 7,72 s), B1 VOID: `Fatal signal 11 (SIGSEGV) …
> fault addr 0x0 … librnllama…so` 4 s dopo l'inizio del prefill, zero righe BENCH_PROBS. Il turno A con gli stessi
> `probs=1` funziona (125 KB di probs) → il difetto è sul percorso B (prefill GPU forzato + `bench_force_ids`), e la
> run 8 senza hook sullo stesso board funzionava. Sessione 807954 chiusa, tunnel giù. Fix dispatchato a Luna ba2ac459
> (null-check nell'hook, ids esauriti = stop pulito, niente patch-package). Poi audit, rebuild APK, sessione nuova.
> Typing su 8650 con APK nuovo: 803-818 s/turno (gradino 200 sempre fallito) contro 386-397 s della run 8 → coppia ~48 min.
> 18:55 — fix crash da Luna ba2ac459: **1cf865a** (governor) / **db2e0a0** (fault, pin 5f0701dac intatto), patch
> byte-identico sui due rami (`patches/llama.rn+0.12.8.patch`, +156/-65): guardie su logits/ctx/model/vocab/n_vocab,
> ids forzati con bounds e `>= n_vocab`, logits assenti → `"top":[]` (passo visibile, non silenzioso); tsc rc=0,
> jest 9 test rc=0; nessuna build nativa possibile in locale. Audit mimo 1d36c152 in corso, con enfasi sulla
> **validità del patch hand-edited** (conteggi `@@` degli hunk) oltre che sulle guardie.
> 19:05 — audit #29 (mimo) su 1cf865a: GO-WITH-FIXES. Hunk del patch corretti. **Regressione confermata da me sul
> disco**: il fix ha rimosso `llama_synchronize` da `benchRawTopProbs`. **Ma la tesi dell'auditor sulla causa del crash
> è sbagliata**: la build morta (19b67b6) la sync ce l'aveva; la causa coerente resta il dereferenziamento dei candidati
> del sampler in modalità forzata, che 1cf865a ha chiuso. Round 2 su Luna: ripristino sync + lettura unica dei logit,
> niente troncamento del turno quando i probs mancano.
> 19:20 — round 2 crash-fix: **8b6d548** / **aa4ddf2** (patch identico, pin fault 5f0701dac intatto). Verificato da me:
> `llama_synchronize` di nuovo presente (3 occorrenze come in 19b67b6), lettura unica di `llama_get_logits_ith` dopo la
> sync, `has_next_token = false` rimosso (niente troncamento del turno), passo senza logit → `"top":[]` visibile nel log
> (`[]` è truthy nel lato JS). tsc/jest rc=0. CI 34066610611 / 34066611883 in corso → APK per la sessione R5.
> 20:05 — APK con le guardie: normale **8b6d548** sha 9200f23647a0…, fault **aa4ddf2** sha 68ddef99c470…
> Sessione **807965** `kalsa-oracle-R5c-8gen3` QRD8650 (host sa812034, serial 72c4dabb, pineapple), 170 min
> (scade ~22:55 EDT), tunnel ~/kalsa-qdc/tunnel-sa812034.pid. Positivo in volo:
> `TYPE_LADDER=100 ORACLE_MODE=logit d_run.sh sa812034 <apk 8b6d548> ABABAB 110` (pid 62577, raw/sa812034/).
> Prova che il fix del crash regge: B1 arriva in fondo con `KALSA_GOVERNOR` e righe BENCH_PROBS forzate.
> 20:30 — **APK 8b6d548: regressione JS.** A1 gira bene (272 righe BENCH_PROBS, telemetria, nessun crash) ma il ramo JS
> che emette `KALSA_TOOLCALL`, `KALSA_BENCH_TOKENS` e la telemetria governor non viene mai raggiunto, e nel log compare
> due volte `[TypeError: Cannot read property 'catch' of undefined]` → driver `END exit_3` (prerequisito). Correlazione
> netta: TypeError=2/TOOLCALL=0/TOKENS=0 solo con 9200f23 (=8b6d548); con c6d24bb (=19b67b6) TypeError=0 e i due log ci
> sono. Unico delta = il patch nativo. Sessione 807965 chiusa, tunnel giù. Round 3 su Luna ba2ac459 con la tabella di
> correlazione e l'ordine di NON tirare a indovinare (una build sbagliata costa 25 min + un'ora di device).
> 21:15 — APK round 3: normale **8269aa2** sha 8bbd449117b4…, fault **5243755** sha 3da1fc303dad… (la CI verde è anche
> la prova che il patch scritto a mano applica). Sessione **807970** QRD8650 host sa812039 (serial 36aa3b71), 170 min
> (scade ~00:05), tunnel ~/kalsa-qdc/tunnel-sa812039.pid. Positivo in volo: `TYPE_LADDER=100 ORACLE_MODE=logit
> d_run.sh sa812039 <apk 8269aa2> ABABAB 110` (pid 80817, raw/sa812039/). Da controllare su A1 prima di fidarsi:
> `KALSA_TOOLCALL` + `KALSA_BENCH_TOKENS` presenti, TypeError assente, e nessuna interruzione anomala (Amendment 11).
> 22:35 — **turno B in fondo per la prima volta**: A1 7,294 s / B1 4,105 s (prefill GPU 1,78× CPU), B1 `row_void=0`,
> 32 passi forzati con probabilità complete (`"forced":true`, tok = ids di A), A1 e A2 con ids_sha identico.
> MA `oracle_logit=DESCRIPTIVE R4 steps=0`: difetto **dello script di valutazione**, non dei dati. La riga 33 di B1 è il
> passo di esaurimento degli ids e porta `"top":[]` (la visibilità che ho voluto stamattina); `load()` in oracle_logit.py
> alza ValueError su `len(top)<5` e **scarta l'intero file** → zero passi confrontabili. Nessuna modifica finché il
> driver gira; i verdetti si ricalcolano offline dai .probs.jsonl salvati, senza altro tempo di dispositivo.
> 23:06 — positivo chiuso a `deadline_110_min`: **coppia 1 COMPLETA** (A1 7,294 s / B1 4,105 s, 32 passi forzati),
> **coppia 2 persa per termica** (B2 `void_reason=hot`, `cooldown_s=900` = tetto raggiunto senza scendere a 37,0 °C —
> il gate ha funzionato), A3 tagliata dalla deadline. Serve una seconda coppia per un verdetto (R4).
> Negativo lanciato subito con APK fault 5243755 (`TYPE_LADDER=100 ORACLE_MODE=logit … ABABAB 50`, pid 17524,
> raw/sa812039-fault/) per usare la sessione fino a scadenza (~00:05).

- **7/09 sera — la campagna kernel è CHIUSA sulla causa; la fase nuova è il governor nell'app (ALIVE 56-59).**
  Cinque assi refutati **per misura** (attenzione, flag del compilatore, accumulatore f16, dequantizzazione,
  precisione dell'operando in memoria): **l'unica cosa che muove la divergenza è la moltiplicazione in f16**, di 95,8×.
  Fix = accumulatori `float8` + 16 righe `c0 += convert_float8(B) * (float)dequantized_weights.s0;`, costo **0,659×**
  di prefill. **Decode NPU refutato** (ALIVE 58): la KV sul DSP si mappa e peggiora → decode resta CPU, ora misurato
  sul modello spedito. **Prossima fase**: promuovere il fix da variante d'ambiente a default del fork, APK dalla CI,
  e la coppia A/B in-app che falsifica la previsione qui sotto.

- **7/09 — perché il prefill GPU sbagliava, e quanto costa non sbagliare più (ALIVE 56+57).**
  La divergenza del prefill GPU su Adreno **non** è l'attenzione, **non** sono i flag del compilatore e **non** è
  l'accumulatore f16: è la **moltiplicazione eseguita in half** dentro `gemm_noshuffle_q4_0_f32.cl`. Misurato con
  `llama-perplexity --kl-divergence` sul modello che spediamo: KLD mediana **0,4538 → 0,004736**, same-top
  **62,8 % → 94,8 %**, col prodotto portato a float. Il fix è di 16 righe più due tipi. **Costa ~0,65× di prefill**
  (indicativo, misura pulita ancora da fare). Conseguenza per il governor, da falsificare: il vantaggio del prefill
  GPU in-app su 750/735/732 (1,78×/1,72×/1,63×) è misurato col kernel **infedele**; pagando la fedeltà scenderebbe a
  ~1,16×/1,13×/1,07×, cioè **quasi parità** — la GPU in questa fascia servirebbe per il vantaggio termico e per
  liberare la CPU, non per la velocità. Su V79 non si applica (prefill ~10×) ma là la fedeltà non è mai stata misurata.
  Residuo aperto e localizzato: il kernel di trasposizione restringe a f16 attivazioni che arrivano in f32
  (`transpose.cl:113/127/139`) → cella `adreno-operand-b`. Documento vivo: `docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md`.

### 7/09 mattina — cella `adreno-acc-type`: la causa NON è l'accumulatore, è la moltiplicazione
> 07:50 — aperta la cella ACC_TYPE con esploratori in parallelo (recon codice + prior art online). Il recon ha
> trovato un **quinto asse** che la cella precedente non conosceva: il GEMM è compilato con
> `-cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math` (`ggml-opencl.cpp:1575-1577`) e il GEMV
> no (`:3678-3681`), quindi l'esperimento batch-1 di stanotte cambiava CINQUE cose insieme, non quattro. PREREG
> riscritto prima di misurare (Amendment 1). Il prior art dice che nessuno ha mai fatto fp32-accumulate sui kernel
> Adreno, ma che la stessa leva ha riparato lo stesso sintomo su WebGPU (#25748) e Vulkan (#18969) → V1 per prima.
> 08:10 — gate di sintassi OpenCL trovato e auto-testato col clang dell'NDK: rifiuta la modifica ingenua di una riga
> (`float8 c0` con prodotto half non compila), quindi serve `convert_float8`. Costo zero, evita di scoprirlo sul device.
> 08:40 — due difetti chiusi prima di spendere minuti: il parser delle metriche cercava `Mean KLD:` mentre l'output vero
> è `Mean    KLD:` con spazi multipli (avrebbe VOIDato tutte le righe), e `local a="$1" b="${a}"` sotto `set -u` in
> entrambi gli script (in `d_run.sh` non crashava: espandeva in silenzio la variabile del chiamante).
> 09:15 — sessione 808196 su QRD8650, otto misure. **`strict` identico a `stock` alla sesta cifra in tutte le coppie**
> (i flag matematici non c'entrano); **`acc` non ripara** (0,4610 contro 0,4538) e costa il 40 % del prefill;
> **`mul` porta la mediana a 0,004736 e il same-top a 94,8 %** (96× di riduzione); `deq` non aggiunge nulla.
> La causa è il **prodotto in f16**, non l'accumulatore: refuta l'analogia con WebGPU/Vulkan.
> 09:40 — chiusa la sessione con ~40 min residui. Due limiti dichiarati nel REPORT e nel PREREG (Amendment 7 e 8):
> le righe sono VOID per provenienza (llama-perplexity filtra i log INFO del backend; la riga è archiviata a parte da
> `llama-bench -v`), e le velocità non sono una misura — rieseguendo la stessa config stock dopo 20 min di carico il
> board ha dato `pp512 165,74 ± 53,58` contro 286,30 ± 0,61. Prossimo: cella sull'ultimo asse (immagine B
> `CL_HALF_FLOAT` scritta dal kernel di trasposizione), misura di velocità a freddo, e le altre board.

#### Conseguenza per il governor, da verificare (non ancora un dato)
Il vantaggio del prefill GPU misurato **in-app** su questi tier è: 750 → 1,78× la CPU (ALIVE 55, 4,105 s contro
7,294 s), 735 → 1,72× (ALIVE 54), 732 → 1,63× (riga 52). Tutti e tre sono però misurati con il kernel **infedele**.
Se la correzione costa il fattore che questa cella indica (0,654× di `pp512`, e `pp512` è proprio la metrica del
prefill), il vantaggio di un prefill GPU **corretto** diventa circa **1,16× su 750, 1,13× su 735, 1,07× su 732**.
Cioè: pagando la fedeltà, il margine della GPU sul prefill in questa fascia **quasi sparisce**, e la decisione del
governor su V73/V75 cambia di natura — da "la GPU vince il prefill" a "la GPU pareggia il prefill e serve solo per il
vantaggio termico e per liberare la CPU". Da trattare come una composizione di due misure fatte in condizioni diverse
(una in-app, una kernel-level e per giunta a caldo), quindi **una previsione da falsificare**, non un numero bancato.
Le due misure che la chiudono: (1) il costo di `mul` misurato a freddo e a ordine randomizzato, (2) una coppia
A/B in-app con l'APK che monta il kernel corretto. Sull'8 Elite (V79) non si applica: là il prefill GPU è ~10× la CPU
(#38) e anche un 0,65× lascerebbe un margine enorme — ma la fedeltà su V79 non è mai stata misurata.

### 7/09 pomeriggio (EDT) — cella `gemm-f32-ship`: il fix esce dal laboratorio, e il piano cambia forma
> 12:20-12:40 — Promosso il fix da variante d'ambiente a codice normale: `float8` per gli accumulatori e le 16 righe
> `c0 += convert_float8(B) * (float)dequantized_weights.sN`, **niente macro, niente variabili d'ambiente**. Le variabili
> restano sul ramo sonda `kalsa/gemm-acc-probe`, che resta lo strumento di misura (finalmente pushato a `eefa27e30`:
> il commit del narrowing era rimasto solo locale, cioè l'artefatto non era riproducibile — corretto).
> Gate decisivo, verificato da me e non solo dall'agente: il kernel da spedire è **identico dopo preprocessore** al
> variante `KALSA_GEMM_PREC=2` che è stato misurato (167 righe, diff vuoto), e il controllo negativo `PREC=0` differisce.
> Quindi ciò che spediamo *è* ciò che è stato misurato. Rami: `kalsa/gemm-f32-mul` @`33c3817c4` (base a0cabca6b) e
> **`kalsa/gemm-f32-mul-on-governor` @`513bf4cea`** (base `3bec271fd`), pushati. Il file era byte-identico su entrambe
> le basi, quindi il cherry-pick è esatto (blob identici, verificato).
>
> **Due scoperte che riscrivono il piano di fase.**
> 1. Il governor **esiste già** e non va costruito: è nativo nel fork (`src/llama-governor-*.cpp`, runtime v0.3, route
>    del prefill per turno, degradazione termica a CPU vista dal vivo nel run 5) ed è cablato nell'app su
>    `feat/governor-in-app`, che pinna `3bec271fd`. C'è da **sbloccarlo**, non da scriverlo.
> 2. Il gate che lo tiene spento sul 750 (`src/engine/governorInputs.ts:16`, `V75: false`) cita un difetto **diverso**
>    dal nostro: i 20 FAIL `f16|bf16 × f32 … batched` che sono solo del 750 e non si riproducono sul 735 (ALIVE 38/39),
>    cioè lo stack driver/compiler. Quindi **flippare V75 non è una conseguenza del fix**: è un'ipotesi che solo
>    l'oracolo può decidere. Le due cause possono coesistere.
>
> **Buco di copertura trovato spedendo** (verificato: nove kernel gemelli hanno ancora `half8 c0`): fra questi
> `gemm_noshuffle_q4_k_f32.cl:54`, che serve `qwen3.5-4b` **Q4_K_M**, modello nel catalogo dell'app
> (`ModelRegistry.ts:179`). Accendere il prefill GPU col solo q4_0 sistemato lascerebbe vivo un percorso infedele per un
> modello di catalogo → il fix va esteso a q4_k (meccanismo identico; misura NON trasferibile, né la fedeltà né lo
> 0,659×). Gli altri otto restano fuori: nessun modello di catalogo li raggiunge.
>
> **Il colpo di fortuna**: l'APK di controllo esiste già ed è `8269aa2` — la stessa che ha prodotto i numeri di ALIVE 55.
> L'A/B è quindi a una variabile sola (stesso commit dell'app, solo il pin del fork), e risparmia una build da 40 minuti.
>
> **Punto pre-registrato prima di qualunque dato** (PREREG della cella): con same-top 94,8 % l'oracolo a 32 passi
> forzati darà **FAIL anche col fix giusto** (~1,7 flip attesi; R2 chiede |Δp₁| ≤ 0,02 a OGNI passo). Il verdetto
> binario è il cancello di promozione, non la misura dell'effetto: la domanda si risponde sulle metriche continue
> (mediana |Δp₁| 0,0861, mediana max|Δlogp| 3,444, 21/32 oltre soglia, 8/32 flip) che devono collassare.
>
> 12:37 — Su richiesta owner le due linee dell'app sono state **unite**: `feat/governor-ux` @`07a279b` (governor + UX
> miniapp/battery/i18n), unico conflitto in `ModelRegistry.ts` risolto tenendo entrambi i lati. Il pin del kernel resta
> un commit separato, così la coppia di misura non perde la variabile unica.
>
> 13:20 — **Correzione mia, trovata dall'audit e verificata sul disco**: avevo scritto che il modello di catalogo
> coperto dal fix era quello spedito. Falso. `ModelRegistry.ts:213` mette `default: true` dentro l'entry di
> **`qwen3.5-4b`, quant Q4_K_M** (`:176`/`:179`), non dentro quella del 2.6B (`:216`/`:219`), e `getDefaultModel()`
> (`:317-318`) restituisce la prima con quel flag. Cioè il modello **di default** dell'app fa il prefill su
> `gemm_noshuffle_q4_k_f32.cl`, il kernel NON sistemato: spedire il solo q4_0 avrebbe lasciato l'esperienza di default
> sul percorso infedele sistemando un modello che l'utente deve andare a scegliere. Fixato anche q4_k (fork
> `kalsa/gemm-f32-mul-q4k` @`67c73d26c`, 21/17 righe, verificato da me: zero `half8` residui, 16 righe col pattern
> giusto, sintassi rc 0 senza warning, epilogo intatto). Per q4_k **non c'è nessuna misura**: né la fedeltà né lo
> 0,659× si trasferiscono, e né il codice né i messaggi di commit lo lasciano intendere.
> Resta da chiedere all'owner se quel `default: true` sia stale rispetto alla decisione del 25/08 (spedisce il 2.6B).
>
> Il buco è più largo di come l'avevo scritto: oltre agli otto `gemm_noshuffle_*` rimasti, **dieci kernel MoE
> `gemm_moe_*_ns.cl` usano `half8 acc8`** (i nostri, dalla campagna KEXP). Nessun modello di catalogo li raggiunge —
> si registrano, non si toccano.
>
> 13:35 — Due APK in coda su CI in parallelo: `bench/gemm-f32-apk` @`6fc14d1` (arm B a variabile unica: commit app
> invariato da `8269aa2`, si muove solo il pin; diff vendorizzato = pin + VENDOR_SHA + build-info + due `.cl`, come
> pre-registrato) e `feat/governor-ux` @`c4c5280` (governor + UX + kernel, l'APK da usare davvero).
> L'audit GLM è morto in piedi dopo un'ora senza scrivere il report (token fermi a due rilevazioni): ucciso e
> ridispacciato a deepseek col brief allargato al lavoro nuovo. Ogni claim portante era già stato verificato da me.
>
> 14:25 — **Le due APK sono verdi.** `bench/gemm-f32-apk` @`6fc14d1` (arm B, artefatto
> `kalsa-apk-arm64-v8a-debuggable-6fc14d17…`, 60 141 315 byte) e `feat/governor-ux` @`c4c5280`
> (`…-c4c5280f…`, 60 159 868 byte), entrambe arm64-v8a debuggable, run 34148006630 e 34148008166.
> Nota di provenienza: l'artefatto del ramo prodotto è costruito da `c4c5280`, mentre la punta del ramo è ora
> `d1e3861` — il commit che ripara la topologia della merge con `merge -s ours`. L'albero è identico
> (`git diff c4c5280 d1e3861` vuoto), quindi l'APK è esattamente quella che `d1e3861` produrrebbe: nessuna rebuild.
>
> **Audit deepseek: BANK-WITH-FIXES**, quattro fix richiesti, adjudicati uno per uno sul disco.
> (1) Topologia della merge: **vero, ed era colpa mia** — `git checkout -b` dopo `git merge --no-commit` azzera
> `MERGE_HEAD`, il commit esce con UN genitore e nessun comando dà errore. Riparato additivo in `d1e3861`.
> (2) "la risoluzione del conflitto ha perso `qwen3.5-4b-q3`": **refutato nel meccanismo**. Il catalogo passa davvero
> da 9 voci a 4, ma per una potatura VOLUTA di `feat/moe-stream` (`7b71d18`, messaggio: *"Prune
> gemma/qwen2b/qwen4b-q3/lfm8b(+kexp)"*), che una merge corretta deve prendere. La mia prima verifica di questa accusa
> era a sua volta sbagliata (un `printf` con sostituzioni annidate mi ha corrotto i conteggi): corretto nel report.
> (3) "q4_K è il kernel del modello di default e non è misurato": **vero**, risolto con l'Amendment 1 del PREREG
> (braccio q4_K su `LFM2.5-2.6B-Q4_K_M.gguf`, già sul Mac, stesse weight dell'arm Q4_0 → le due fedeltà differiscono
> per il kernel e non per il modello; regola di decisione ≥9,6× di riduzione KLD e costo ≥0,55×).
> (4) "il prefill MoE di un modello spedito usa ancora la via half": **refutato per il prodotto** — i due 8B MoE sono
> fra i potati da `7b71d18`. Numeri di riga del report presi da un albero diverso da quello citato.
>
> **Conseguenza che vale la pena dire chiara**: sul ramo prodotto il catalogo è di **due LLM** — `qwen3.5-4b` Q4_K_M
> e `lfm2.5-2.6b` QAD-Q4_0 — e dopo questo lavoro **entrambi i loro kernel di prefill sono corretti**. Gli otto
> `gemm_noshuffle_*` e i dieci `gemm_moe_*_ns.cl` rimasti in half non sono raggiungibili da lì.
>
> Prossimo: sessione QDC su QRD8650, driver `qdc-governor-s5/d_run.sh`, protocollo oracolo di ALIVE 55.
> Arm A = APK `8269aa2` già archiviata, arm B = `6fc14d1`.
>
> 14:45 — **Correzione dell'owner, e la mia formulazione era sbagliata due volte.** Non esiste "il kernel del modello
> di default": **è il telefono a scegliere il kernel**. `recommendedModelId()` (`contextProfile.ts:89-99`) dà
> low/mid → `lfm2.5-2.6b` QAD-Q4_0 (`ModelRegistry.ts:244`) e high → `qwen3.5-4b` Q4_K_M (`:212`), con soglie
> high ≥ 6,9 GB e mid ≥ 5,4 GB (`contextProfile.ts:60-62`). Il flag `default: true` non è il modello di default:
> `getDefaultModel()` ha un solo chiamante non di test, `AppShell.tsx:2541`, dove decide **da dove parte il carosello**
> dei modelli; la raccomandazione per fascia è dichiaratamente advisory (*"NEVER auto-switches the user's chosen
> model"*, badge in `SettingsScreen.tsx:936`).
> Conseguenza sulla priorità: **q4_0 = metà bassa del parco, q4_K = metà alta**, e la metà alta è quella non misurata.
> I board QDC su cui misuriamo (12+ GB) sono essi stessi di fascia high, quindi il modello che raccomanderebbero è
> proprio quello col kernel senza misura. Il braccio q4_K sale da nota a piè di pagina a misura che copre metà del parco.

### 7/09 sera — operando refutato, e la fase nuova
> 16:10 — `adreno-operand-b`: tenere le attivazioni in f32 fino dentro il GEMM non cambia nulla (0,004641 contro
> 0,004736, same-top leggermente peggiore). Quinto asse refutato. I due controlli riproducono i valori bancati alla
> sesta cifra col terzo kit, e tutte le righe sono OK: la sonda di provenienza per variante ha eliminato i VOID.
> Velocità a freddo: `mul` 0,659× — ma la lettura di validità che avevo pre-registrato FALLISCE (5,71 °C di escursione
> contro 2 ammessi), causa un difetto del nostro harness (cooldown assente prima del primo passo). Non ho allargato la
> banda: il debito resta aperto. `b=float` costa 0,509× e non rende → scartata.
> **Decisione owner**: si passa alla fase governor-nell'app col kernel corretto. Il residuo 5× (geometria del tile,
> ordine di somma) e le altre board restano in coda, non sul percorso critico del prodotto.

### 7/09 sera (EDT) — LA MISURA: il fix funziona sul device, e il costo di banco si trasferisce entro il 2 %
> 19:45 — Cella `gemm-f32-ship`, QRD8650/Adreno 750 (unità 36aa3b71), sessione QDC 808521, job `sa812590d`,
> APK `6fc14d1`. **Fedeltà**: sullo stesso board e sullo stesso protocollo a 32 passi teacher-forced di ALIVE 55,
> mediana |Δp₁| 0,0861 → **0,0014**, mediana max|Δlogp| 3,444 → **0,3037**, passi oltre 0,02 21/32 → 8/32, e i
> **flip del top-1 con la CPU sicura 8/32 → ZERO**. Tutti e quattro i criteri pre-registrati soddisfatti.
> Il verdetto binario è `FAIL rule=R2`, ma era **scritto prima dei dati** che sarebbe successo: R2 chiede
> |Δp₁| ≤ 0,02 a ogni passo e il same-top è 94,8 %. Il passo peggiore dopo il fix vale il passo tipico prima.
> **Velocità**: prefill da 925 token, `engine_prefill=GPU` verificato nei route facts, CPU 7,599 s vs GPU 6,119 s
> = **1,242×** contro 1,78× pre-fix. Previsione pre-registrata 1,17× (intervallo 1,05-1,30): dentro. E il costo
> misurato al banco predice il tempo in-app entro il 2 % (6,229 s attesi contro 6,119). Decode invariato.
>
> **Conseguenza per il governor, e correzione della previsione del PLAN**: avevo scritto che il vantaggio sarebbe
> sceso "a quasi parità" (~1,16× sul 750). La direzione è giusta ma la stima era troppo forte: **1,24× è un
> vantaggio reale**, non parità. Sulla fascia V75 la GPU mantiene un caso di velocità più piccolo, più il
> vantaggio termico (nello stesso turno: GPU +4,5 °C contro CPU +10,1 °C di skin) e la CPU liberata.
> Non è invece deciso il flip di `GPU_PREFILL_CORRECT.V75`: R6 vieta la promozione automatica e R2 fallisce
> ancora — ma ora fallisce per rumore numerico un ordine di grandezza più piccolo e con zero disaccordi sui token.
>
> **Tre run perse prima, tutte per parametri miei dell'harness**: deadline 40 min (una coppia qui ne costa ~50,
> per via di reinstall + copia modello 1,6 GB + bootstrap a OGNI turno); poi due cooldown falliti al tetto di
> 900 s, il secondo per 0,22 °C. Amendment 2 registrato e pushato PRIMA della run: tetto di **attesa** 900 → 1500 s,
> target termico **invariato a 37,0** — alzarlo avrebbe invalidato l'esperimento, perché sopra ~38 °C il governor
> degrada il turno a prefill CPU e il braccio B avrebbe misurato la CPU. Col nuovo tetto il cooldown ha chiuso a
> 36,96 °C in **1200 s**: il device ne chiedeva 1200 e l'harness ne concedeva 900.
> Sessione chiusa e verificata (`Completed`, Ended On 19:46:35), tunnel chiuso. ALIVE riga 60.
>
> 20:10 — **Decisione owner: prefill GPU ACCESO su V75.** `GPU_PREFILL_CORRECT.V75` false → true. È una decisione
> sotto **R6** (il protocollo dell'oracolo vieta la promozione automatica: il PASS si riporta, accendere una
> generazione in produzione è scelta dell'owner sui numeri) e va a verbale in
> `scratchpad/agents/gemm-f32-ship/DECISION.md`. Presa sull'**effect size**, non sul cancello binario: il verdetto
> grezzo resta `FAIL rule=R2` per disegno, perché R2 chiede |Δp₁| ≤ 0,02 a OGNI passo e il same-top è 94,8 %.
> Ciò che si accetta sapendolo, scritto nel verbale: n=1 coppia su un board e un'unità; **q4_K non misurato** ed è
> il kernel della fascia high (`qwen3.5-4b` Q4_K_M), quindi si accende un percorso misurato per low/mid e non
> misurato per high; 732/735/8 Elite non rifatti; V73 resta false; e il guadagno è 1,24×, non l'1,78× di prima —
> quel numero era comprato con un modello che rispondeva diverso. Decode invariato (non usa quel kernel) e la
> policy termica invariata (a ~38 °C il runtime degrada comunque a prefill CPU).

- **9/09 notte — OWNER TORNATO, PIVOT SUL PIANO PRATICO `kalsa/docs/PROPOSTA-OTTIMIZZAZIONE-CHAT-2026-09-08.md`**
  (criterio: una conversazione intera che funziona nell'APK; G0 il 9/09, G1 scelta LFM2.5-2.6B vs MiniCPM5-2B
  il 15/09, M1 il 9/10). ALIVE e PLAN restano in uso; il diario è qui. Owner: "stiamo rallentando facendo
  migliaia di test per il prefill" → le code di prefill (q4_K in-app, 732/735/8 Elite, residuo 5×) sono FERME.
  **Correzione a verbale: "V75 acceso" era FALSO** — `V75:true` è una riga di tabella, il governor parte solo
  con `kalsa.governor.enabled=1` in AsyncStorage, che nessun file dell'app scrive (solo il driver QDC):
  installazione pulita = CPU-only ovunque. Presente ≠ abilitato ≠ eseguito (PROPOSTA §14).
  **Repo app ripulito (decisione owner "si mergia tutto, si lavora solo su main")**: `main` @9e90f99 =
  fast-forward di `feat/governor-ux` (governor v0.3 + UX + pin fork 67c73d26c) + merge `lot-a/chat-ui`
  (7 commit UX, 2 conflitti risolti keep-both) + merge `bench-dev-models` (catalogo GGUF dev opt-in,
  `kalsa.bench.devmodels`, 6 conflitti risolti HEAD-first, una classe duplicata rimossa); typecheck 0,
  jest mirati 12/12 e 59/59. NON mergiati, archiviati come tag `archive/*` (17, pushati): `bench/fault-inject-apk`
  (pin guasto THROWAWAY; i suoi fix di banco erano già su main in altra forma), `chore/engine-pin-12f6d9b6d`
  (pin superato: i 3 pick upstream #53 erano GIÀ nel lignaggio pinnato — merge-base(67c73d26c, 12f6d9b6d) = 12f6d9b6d;
  il `main` del fork è stato portato in fast-forward a 67c73d26c il 9/09, tag `archive/fork-main-2026-09-09` sul vecchio tip),
  `chore/repo-reorg*`, `bench/kvtranscript-probe`, `bench/jelly-minsdk33*` (main ha già minSdk 33 dal 22/08).
  Tutti i rami locali e remoti cancellati, 7 worktree rimossi (log agenti 4-5/09 spostati in
  `_kalsa_archive/wt-governor-logs-2026-09-05`). `node_modules/llama.rn` reinstallato pulito (la patch
  governor non si applicava sopra lo stato del vecchio ramo).
  **Telefoni**: Xiaomi 14 in LAN (192.168.1.193) ma debug wireless SPENTO (5555 rifiutata, niente mDNS):
  serve un tocco sul telefono o USB domani; S23 e Jelly domani. Nessun manifest device ancora.
  **G0 in volo (Paseo)**: kit MiniCPM5 + build fork 67c73d26c CPU-only su Mac (Luna 37bd9e6c), corpus 80
  casi + runner (Luna 131645cd), recon config spedita dall'app (deepseek 10d2cc82) →
  `scratchpad/agents/g1-model-select/`. Il confronto qualità si fa su macOS con le stesse quant del telefono
  (come si faceva su PC), i telefoni servono per tempi/memoria/termica.

- **9/09 ~06:40 EDT — G0 a che punto è (cella `scratchpad/agents/g1-model-select/`, tutto committato):**
  (a) **Xiaomi 14 operativo**: wireless adb 192.168.1.193:5555 (dopo 1 h persa sul gate macOS "consenti accessori"),
  manifest `devices/xiaomi14.md`, APK **main@332aeed debuggable** installata (sha 67fff2d7…), LFM2.5-2.6B-QAD-Q4_0
  nella dir dell'app con sha verificata sul device (a247afd6…), smoke di avvio OK (834 ms, vivo a 25 s, 254 MB RSS,
  zero FATAL). Il telefono ha ancora Qwen 2B/4B+mmproj e 10 GB di GGUF di agosto in /data/local/tmp. S23 e Jelly: domani.
  (b) **Kit G1 su Mac pronto e verificato**: MiniCPM5-2B Q4_K_M ufficiale (rev d00c954e, sha ec2d5801…), inventario
  gguf-py dei 4 candidati (MiniCPM5 = Q4_K 253 / Q6_K 43, tool call in **XML** `<function name=…><param>`, EOT
  `<|im_end|>` senza eot_token_id), fork 67c73d26c buildato CPU-only (`~/kalsa-mac/build-kalsallama-67c73d26c/bin`),
  smoke IT con thinking acceso: LFM 179,8/56,6 t/s, MiniCPM5 259,1/55,1 t/s (M-series, indicativi).
  (c) **Config spedita dall'app** (`APP-SHIPPED-CONFIG.md`, valori del catalogo confermati dall'audit; io ho verificato
  a mano il payload del turno utente `LlamaService.ts:3235-3245` + `thinkingBudgets.ts:55-77`): temp 0,7 / top_k 40 /
  top_p 0,95, n_predict ≥ 1024, thinking sempre ON con `thinking_budget_tokens` 256 (esteso 512), `preserve_thinking`
  per LFM, prompt di sistema **per locale** (`it.ts:1042`, `en.ts:1082`), n_ctx 8192 (16384 se RAM ≥ 7,5 GB), KV
  q8_0/q4_0, ubatch 256, mmap+repack. Il server del fork accetta la stessa chiave `thinking_budget_tokens`.
  Trovate due chiamate con `enable_thinking:false` fuori dal turno utente (prewarm del prefisso :783 e estrazione
  memoria :3888): il prewarm renderizza il template senza thinking → **possibile miss del prefisso** da misurare in §3.
  (d) **Corpus 80 casi + runner: BOCCIATO all'audit** (deepseek, `CORPUS.AUDIT.md`, 8 difetti confermati: prompt
  inglese su 40 casi IT, reasoning non strippato prima dei check, crash su connection reset, memoria a 1 turno,
  check fragili su ~25 casi, leakage C15/C16, tool check solo su calls[0]). Riscrittura + passata dev in corso
  (Luna 131645cd). Lezione: mimo muore a metà report → audit lunghi a deepseek.
  (e) **Fork**: `main` = pin app 67c73d26c (ff), i 3 pick upstream erano già dentro. **CI**: E2E emulatore sul merge
  ancora in corso (34335570917). **Non fatto**: quote QDC/RTL live (2FA), S23/Jelly, prova Gallery.

- **9/09 ~07:00 EDT — TRE TELEFONI OPERATIVI, tutti su main@332aeed debuggable con LFM di spedizione (sha a247afd6…)
  verificato sul device e smoke di avvio pulito**: Xiaomi 14 192.168.1.193:5555 (V75, nessun eager-load), S23
  192.168.1.152:5555 (V73, eager-load di qwen3.5-4b a 4 GB RSS per prefs di banco di agosto → azzerare prima di
  misurare; /data al 92 %), Jelly Star 192.168.1.82:5555 (G99, Android 13, eager-load lfm2.5-2.6b `fits`, 2,27 GB RSS).
  Schede in `scratchpad/agents/g1-model-select/devices/`. QDC non necessario per M1 (8 Elite senza minuti); Samsung
  RTL più avanti per la compatibilità. Owner ha ripreso lo Xiaomi in mano dalle ~06:40.

- **9/09 ~07:30 EDT — L'APP NON ASPETTA G1 (owner: "aspettare il confronto serve a decidere il modello, ma l'app in sé no")**:
  partono in parallelo i lavori del piano chat che non dipendono dal modello scelto, tutti via Paseo:
  (1) **voce dev-catalog MiniCPM5-2B Q4_K_M nell'app** (Luna 80b2da28; riga "10–11 set" della timeline §12; il fork al
  pin 67c73d26c e l'overlay `node_modules/llama.rn/cpp/common/chat.cpp` hanno GIÀ il parser specializzato MiniCPM5,
  `<think>` + tool call XML, verificato a mano: 5 occorrenze); (2) **ricognizione §3 contratto di sessione** su main
  (deepseek 4a1da067: save/restore, identità, token riusati osservabili, stato ricorrente LFM vs issue upstream 25913,
  prefisso prewarm senza thinking, stop/edit/regen, job accessori); (3) **prep confronto concorrenti §10** (Luna
  f22bd8b9: APK Gallery + LiteRT MiniCPM5 scaricati con sha in `~/kalsa-qdc/competitors/`, protocollo device, note
  Noema → `scratchpad/agents/competitors/PREP-2026-09-09.md`); (4) **inventario feature chat vs gap competitor**
  (mimo 80edb3d8, report ≤110 righe: edit/regen, stop, documenti/retrieval, tool, memoria, voce, vision, auto-release,
  ctx pieno, /bench, persistenza, harness E2E). **CI E2E emulatore sul merge: PASS** (run 34335570917, main 9e90f99).
  **Wild block pronto e verificato** (`corpus/wild.jsonl` 30 casi: es/fr/de/pt/zh/ja ×3 + 12 assurdi en/it,
  `validate_wild.py` rc=0, zero overlap con gli 80): NON ancora eseguito perché `run_corpus.py:71` indicizza il prompt
  di sistema con `case["lang"]` e conosce solo en/it → serve il fallback en (come farebbe l'app con locale ≠ it);
  la fix va all'agente corpus 131645cd (proprietario del runner) appena finisce la rigenerazione dev.

- **9/09 ~08:00 EDT — §3 RICOGNIZIONE SESSIONE FATTA (deepseek, verificata a campione; report
  `scratchpad/agents/session-contract/RECON-MAIN-332aeed.md`)**: save/restore esistono e sono ben protetti sul
  percorso CPU (hash del prefisso, meta sidecar, guardia `resumable` contro il falso-warm dell'issue upstream 25913,
  checkpoint di stato per gli ibridi = fix di §7.29). Sette buchi in ordine di impatto: (1) **ogni turno con tool
  rende la sessione non salvabile** (`kvReproState=tool_calls_detected` :3188 → save saltato :2117) → riapertura
  FREDDA per ogni chat che ha usato un tool, e `document_chat` È un tool: il RAG perde sempre il restore;
  (2) prewarm ed estrazione memoria renderizzano senza thinking (:783, :3888), i turni veri con thinking → possibile
  miss del prefisso, da misurare (test 12); (3) `translateText`/`completeOnce` fanno clearCache e distruggono la KV
  della chat; (4) quant/template/versione motore NON sono nell'identità della sessione; (5) Stop non salva;
  (6) identità dello stato ricorrente mai verificata al restore; (7) nessuna riga "token riusati": si deriva da
  `tokensCached`+`promptMs`. Dodici casi obbligatori per la suite device elencati nel report. In corso: protocollo
  restore sull'S23 in config di spedizione (Luna 6c0dfc7f) e document chat E2E sul Jelly (Luna e1b923b9).
  Inventario feature (mimo 80edb3d8): sulla carta c'è quasi tutto (edit/regen, stop, documenti, tool, memoria, voce,
  vision, auto-release, compattazione), quasi niente provato sui telefoni col modello spedito.

- **9/09 ~08:10 EDT — MiniCPM5 NELL'APP: main@7836db7** (`dev-minicpm5-2b`, opt-in via `/bench devmodels on`;
  Luna 80b2da28, audit deepseek 2ca5328c in due round → SHIP). Nessuna modifica al motore: il parser MiniCPM5 è
  già nel fork/overlay. Aggiunto `ModelInfo.sha256` opzionale: verifica UNA volta dopo il download o lazy per un
  file caricato via adb, poi sidecar `.sha256-ok` → avvio senza hash (l'auditor aveva beccato l'hash da 1,5 GB a
  ogni boot, F3). Il claim "hash RNFS su Android mai uguale" (F1) era FALSO: `%02x` su un `Byte` negativo in Java
  stampa due cifre (Formatter aggiunge 2^8); guardia aggiunta comunque (digest ≠ 64 hex → errore, mai delete).
  tsc 0, jest 17/17 rifatti a mano. **APK debuggabile arm64 in build: run 34349153745.** Path atteso sul telefono:
  `files/models/dev-minicpm5-2b/MiniCPM5-2B-Q4_K_M.gguf` (+ marker lazy al primo check).
  **Corpus dev rigenerato e committato (d1314fc4)**: 48 casi deterministici/modello, LFM 2 FAIL, MiniCPM5 3 FAIL,
  stesso FAIL in conversazione EN → parità; decidono rubrica cieca (12), wild (30), bake-off 44, estesa 512 — in
  corso sul corpus agent con fallback lingua en nel runner e pacchetto anonimo A/B `results/judge-pack.jsonl`.

- **9/09 ~08:40 EDT — G1 BLOCCHI COMPLETI (commit moe-exp) + DIFETTO DI PRODOTTO NEL PROMPT**: wild deterministico
  LFM 11/14 vs MiniCPM5 6/14; bake-off 44 domande dell'owner MiniCPM5 30/44 vs LFM 25/44 (@256; @512 29 vs 23; MiniCPM
  vince fermi 4/4 vs 1/4 e local_knowledge 3/4 vs 1/4, LFM vince absurd_gift e format); estesa 3/4 entrambi (I11).
  Letti i FAIL wild a mano: W19/W24/W28 sono risposte buone bocciate da check rigidi (NON si allentano: restano
  registrati), W20/W25 impossibili per entrambi. Segnale vero: **MiniCPM5 risponde in inglese a prompt es/zh/ja
  (7/9) e scrive "I must answer in English per my language rules"** → il prompt di sistema spedito (`en.ts:1087`)
  dice "Write all natural-language answer text … in English" (it.ts: "in italiano"): il modello OBBEDISCE, LFM
  disobbedisce e risponde nella lingua dell'utente. È un difetto dell'app per un utente umano (telefono in EN,
  utente scrive in spagnolo → risposta in inglese). Fix in corso (Luna: "nella lingua in cui scrive l'utente,
  fallback locale"), poi wild v2 con il prompt nuovo per entrambi. Difetti veri di MiniCPM5 restati: W02 rifiuto
  immotivato (riscrittura in spagnolo), W23 inglese a un prompt italiano, W10 perde il nome. LFM: W16 ja→en.
  Giudizio cieco in corso su 72 righe con due giudici indipendenti (deepseek 5b79eee5, mimo 020b69f0), chiave
  in `results/judge-key.json` mai aperta dai giudici. Il verdetto wild-multilingue sotto il prompt vecchio va
  letto come "obbedienza al prompt", non come qualità linguistica.

- **9/09 ~08:50 EDT — GIUDIZIO CIECO v1 + FIX LINGUA SU MAIN (f77ea7b)**: due giudici indipendenti (deepseek A,
  mimo B) sblindati con `unblind.py`: A = MiniCPM5 29 / LFM 25 / pari 18, B = LFM 29 / MiniCPM5 27 / pari 16; accordo
  60/72, 4 verdetti opposti. Senza il blocco multilingue: MiniCPM5 25 vs LFM 18-20. Per categoria concordano:
  MiniCPM5 conversazione/fatti/stime/assurdi, LFM sicurezza/formati/assurdi-innocui. **Due artefatti di harness in
  direzioni opposte**: (1) prompt spedito impone la lingua del locale → penalizza MiniCPM5 (obbedisce); (2) il bake-off
  non offre tool mentre il prompt li nomina → LFM emette `<|tool_call_start|>[web_search…]` grezzo in 15/44 e prende
  1 dai giudici (in-app la chiamata è instradata); MiniCPM5 4/44. Nessun verdetto G1 da v1. **Fix prompt su main
  f77ea7b** (rule (a): "nella lingua in cui scrive l'utente, fallback locale", systemPrompt + WithSearch + blocco
  operativo, en+it; tsc 0, jest mirati 0; i `.kvs` vecchi restano validi: promptEnvHash = locale, il motore
  ri-prefilla solo il suffisso). **Harness morto trovato**: `scripts/memoryFactsTailHarness.mjs` chiama export
  inesistenti (`sanitizeFactForPrompt`, `selectPromptFacts`) → 7 FAIL preesistenti, non è in CI; da sistemare o
  cancellare. **v2 in corso** (corpus agent): wild + bake-off con prompt v2 e i 7 tool default dell'app con executor
  stub, judge-pack-v2. **APK**: 34349153745 (7836db7, MiniCPM5) in build; 34353143627 (f77ea7b, + fix lingua) in coda
  — sui telefoni va la seconda. Lezione in memoria `kalsa-measure-the-shipped-config` (addendum).

- **9/09 ~09:00 EDT — S23: IL RESTORE FUNZIONA IN CONFIG DI SPEDIZIONE (n=1, thinking ON, LFM, main@332aeed)**
  (`session-contract/S23-RESTORE-2026-09-09.md`, Luna 6c0dfc7f): seed a freddo 37,9 s per 1811 token; dopo
  force-stop + riapertura `KALSA_KVRESUME resumable=1`, `KALSA_SESSION load ok tokens=2051` in 36 ms, `KALSA_KVDIAG
  n_past=2051`, turno di continuazione **prefill 562 ms** (evaluated 2075, cached 2314), decode 7,4 tok/s, `.kvs`
  15,8 MB vs stima 16,0 MB, UN solo save. Dei quattro difetti di §7.30: n_past=0 FIXED, disk gate 12,7× FIXED
  (1,01×), doppio save FIXED, `KALSA_PREWARM match:false` ancora presente ma con `reason:"kv_holds_chat"` →
  diagnostica cosmetica, non un miss. Cicli 2-4 non fatti: **thermal status 3 a 42,7 °C** (telefono scollegato,
  wireless) → fermato al gate. Buchi di harness confermati: `uiautomator dump` sull'S23 muore (rc=164, segnale 36);
  il deep link `kalsa://share` non riempie il draft React su questa build → il turno è stato inviato dai controlli
  visibili; prefs di banco di agosto rimosse (era su qwen3.5-2b, norepack=1), snapshot in `artifacts/`.

- **9/09 ~09:20 EDT — JELLY: DOCUMENT CHAT 1/5 (LFM spedito, main@332aeed)** (`product-suite/JELLY-DOCCHAT-2026-09-09.md`,
  Luna e1b923b9; PDF piccolo 1 pagina/5 fatti, PDF grande 40 pagine/3 fatti sepolti): PASS solo "due fatti dal
  piccolo" (full_context, 199 s a completare, 4,2 tok/s). FAIL: fatto assente (errore "Documento non trovato
  id=<stem>" arriva in chat), i tre fatti sepolti (mai visti), follow-up (allucina "1.860 euro" come coppia),
  riapertura (promptMs 564 s, loop). **Tre difetti confermati sul sorgente**: (1) `pdfBridgeProtocol.ts:28
  MAX_PDF_PAGES=5` tronca OGNI PDF a 5 pagine (era il cap vision) → il retrieval non parte mai; (2) i filtri
  SEND/SEND_MULTIPLE generati dal manifest hanno il prefisso raddoppiato (`android.intent.action.android.intent.
  action.SEND`, app.config.js passa il nome già prefissato) → "condividi a Kalsa" non matcha da nessuna app;
  (3) `documentChatTool.ts selectDoc` match esatto sull'id, il modello passa lo stem del file → errore con un solo
  documento in libreria. Fix in corso: (1)+(3) Luna 41…(agent "document chat fixes"), (2) all'agente share-intent
  ad050d23 (stesso file app.config.js). **Punto di design aperto (§5/§8)**: `decideDocStrategy` manda in
  full_context tutto ciò che sta in metà ctx (fino a 8k token su ctx 16k) → sul Jelly sono minuti di prefill;
  la soglia deve dipendere dal budget di prefill del telefono, non solo dal fit. Il Jelly a 2,4-4 tok/s con
  thermal status 3 costante (36-40 °C) non regge un documento medio con questa strategia.

- **9/09 ~10:10 EDT — G1 v2 (prompt corretto + 7 tool dell'app con stub offline), committato**: wild det. LFM 11/14
  → 11/14, MiniCPM5 6/14 → 9/14; bake-off @256 LFM 25 → 25, MiniCPM5 30 → 32; @512 LFM 23 → 20, MiniCPM5 29 → 33.
  Sintassi tool grezza nelle risposte finali: 0 per entrambi (artefatto v1 chiuso). **Propensione ai tool**: LFM
  chiama tool in 30/44 righe bake-off (web_search anche offline, 53 round), MiniCPM5 in 19/44 (27 round); con lo
  stub "offline" conta come il modello ripiega. **Deriva di lingua residua col prompt nuovo** (euristica mia sul
  wild-v2): MiniCPM5 3/9 prompt es/ja ancora in inglese (W01, W02 es; W16 ja), LFM 0/9 (1 caso it→en su un assurdo).
  È un segnale vero sul modello, non più sul prompt. Giudizio cieco v2 (60 righe, A/B ri-randomizzati, chiave
  `judge-key-v2.json`) in corso con gli stessi due giudici. `tools-app-default.json` = schemi esatti dei 7 tool
  default dell'app, riusabile per ogni harness futuro.

- **9/09 ~10:40 EDT — GIUDICE B v2 SBLINDATO + TERZO ARTEFATTO (contro LFM)**: mimo v2 = MiniCPM5 24 / LFM 23 /
  pari 13, media 3,17 vs 2,77; senza multilingue MiniCPM5 20 / LFM 16 / pari 12; multilingue LFM 7 / MiniCPM5 4.
  Ma **14 risposte finali LFM su 60 sono VUOTE** (tutte bake-off: fact_spa2000, honesty_unknown, fermi, local_knowledge,
  false_premise): LFM richiama web_search 3-6 volte dopo lo stub "offline" e lo stub v2 si ferma a 2 round con
  finish=tool_calls. **L'app non fa così**: `MAX_TOOL_ROUNDS=3` (LlamaService:478), ultimo round text-only con
  `tool_choice:"none"` (:3204), stessa chiave fallita due volte → sintesi forzata (:495/:3416), round esauriti → una
  completion text-only extra (:3548) poi messaggio di fallback (:3652). → **v2b** in corso: solo le righe finite in
  tool_calls/vuote, rieseguite con la semantica esatta dell'app, stessa mappatura A/B così i giudizi sulle altre
  righe restano validi. Lezione (già in memoria): ogni harness deve replicare il loop tool dell'app, non solo
  offrire gli schemi. Segnale che resta vero per l'utente: LFM insiste sui tool offline, MiniCPM5 ripiega da solo.

- **9/09 ~10:50 EDT — main@5707cfe: FIX DOCUMENTI + SHARE (18 file, due audit ostili deepseek+mimo → SHIP)**:
  estrazione testo PDF con cap proprio (200 pagine / 1,5 M unità UTF-16, applicato dentro la WebView e lato RN;
  vision resta 5), pagina densa tronca solo se stessa, troncamento persistito e visibile "(N/M)" + "first N of M
  pages" nel tool, documenti grandi → retrieval (test fino a pagina 31); timeout totale = vincolo UX 180 s con
  testo PARZIALE restituito (deepseek aveva messo 100 minuti: corretto); selezione documento tollerante (id →
  nome/titolo/stem → unico documento con riga "id non trovato" → allegato solo senza id → errore con elenco);
  filtri SEND/SEND_MULTIPLE/DEFAULT corretti in app.config.js (il plugin Expo prefissa da solo); cold-start share
  parcheggiato fino a `conversationsReady`; `extractionScope.ts` al posto di 4 copie. tsc 0, jest 33/33, 6 harness 0.
  **APK debuggabile in build: run 34363702891** → da installare su S23/Jelly e ripetere i 5 scenari del document
  chat sul Jelly + i 2 casi cold-start share sull'S23. Canali: Luna ha esaurito la quota ~10:00 (tre agenti morti),
  owner: "usa coder bench (deepseek) intanto, se no aspetti" → round 2 documenti e runner device su deepseek;
  v2b ripresa sul vecchio agente Luna alla riapertura (un doppione creato per errore è stato ucciso subito).

- **9/09 ~10:55 EDT — GIUDICI v2 ENTRAMBI SBLINDATI (committati)**: A deepseek = LFM 25 / MiniCPM5 22 / pari 13;
  B mimo = MiniCPM5 24 / LFM 23 / pari 13; accordo 43/60. **Escludendo le 14 righe con finale LFM vuoto (artefatto
  round-cap, in rifacimento v2b)**: A = LFM 25 / MiniCPM5 11 / pari 10; B = LFM 21 / MiniCPM5 15 / pari 10. Quindi
  sulle righe in cui LFM ha risposto davvero, col prompt corretto e i tool offerti, LFM è avanti nelle risposte
  aperte; il vantaggio MiniCPM5 di v2 veniva dai vuoti. Le medie (MiniCPM5 3,1 vs LFM 2,8) sono trascinate dagli
  stessi vuoti. Nessun verdetto prima di v2b + pass sui telefoni (24 casi × 3) del 14-15/09.

- **9/09 ~11:10 EDT — RUNNER DEVICE G1 PRONTO, DRY RUN S23 4/4 PASS** (`g1-model-select/device/`, deepseek
  100fe465, committato): 24 casi dev (7 conv, 11 istruzioni, 2 tool offline, 4 memoria; 12 IT/12 EN; scarto
  dichiarato: il corpus ha tool `weather.*`/`calendar.*`/`web.search` che l'APK non ha, solo T09/T11 sono offline),
  `run_device_subset.sh` con cambio modello via prefs, conversazione nuova per caso, fine turno = testo stabile ×2 +
  20 s di logcat quieto, watchdog termico; `score_device.py`; `PROTOCOL.md` (S23 ~4-5 h per sweep 24×2, Jelly 12-16 h
  a blocchi). **Primi numeri device (S23, CPU, prefisso ~2000 token in cache)**: decode LFM 9,5-10,4 tok/s vs
  MiniCPM5 6,5-6,6; promptMs LFM 3,4-3,6 s vs MiniCPM5 2,8-6,8 s. **MiniCPM5 prewarm ~2,5 min senza mai loggare
  `KALSA_PREWARM done`** (la completion n_predict=0 non riporta timings → "skip eval-failed"; KV comunque
  popolata) contro ~38 s di LFM: Q4_K_M senza repack ARM vs QAD-Q4_0 repack → da confrontare con un MiniCPM5 Q4_0
  se il repo ufficiale lo offre (controllo in corso). Difetto UI MiniCPM5: nel turno tool la risposta contiene
  anche l'eco testuale `<function>` oltre alla chiamata strutturata. LFM chiama device_calc anche per "2+2".
  Prossimo: install 5707cfe + re-test share cold-start su S23 (Luna ad050d23), poi sweep 24×2 sull'S23.

- **9/09 ~11:30 EDT — SHARE COLD-START RISOLTO SU S23 (APK 5707cfe, sha cedd7301…)**: filtri SEND corretti nel
  package dump; cold VIEW `kalsa://share` PASS; cold SEND text/plain dal ResolverActivity PASS (composer riempito);
  SEND application/pdf con URI `file://` → Kalsa riceve il clip ma nessun documento in libreria (FAIL, da capire se
  è solo `file://`: il Jelly v2 prova `content://`). Evidenze copiate in `S23-SHARE-INTENT-2026-09-09-artifacts/`.
  **Sweep G1 24×2 sull'S23 partito** (deepseek 100fe465, ~4-5 h, PROTOCOL.md). **S23 IN CARICA via cavo Mac durante
  lo sweep** (owner, ~11:35): i tempi di questo sweep valgono solo come confronto interno LFM vs MiniCPM5, non come
  riferimento; batteria/termica finali restano senza carica (§11). In parallelo: Jelly v2 document
  chat su 5707cfe (Luna e1b923b9), v2b (Luna 131645cd), MiniCPM5 Q4_0 dal F16 (Luna e2d0075b).

- **9/09 ~11:50 EDT — MiniCPM5 Q4_0 costruito dal F16 (`MINICPM5-Q4_0.md`)**: PPL Q8_0 22,34 / Q4_K_M 23,55 (+5 %) /
  Q4_0 26,19 (+17 %): il Q4_0 NON è un QAD come quello di LFM, costa qualità. E il quant non è la leva del prefill:
  l'overlay ripacchetta anche Q4_K su ARM (`repack.cpp:5130` → `q4_K_8x8_q8_K` con NEON+i8mm, che l'S23 ha).
  Sul Mac MiniCPM5 prefilla PIÙ veloce di LFM (378 vs ~180 tok/s) → il "prewarm 2,5 min / skip eval-failed" sull'S23
  è sospetto di artefatto app/runner (template + n_predict 0 + enable_thinking:false?) → recon deepseek in corso sui
  log del dry run. Il Q4_0 resta come riferimento se servirà a separare quant e architettura sul telefono.

- **9/09 ~11:55 EDT — OWNER: "il quant giusto possiamo farlo noi, e magari dopo un fine tune sui casi dove sbaglia /
  tool call (Apache 2.0, possiamo farlo nostro)"** → linea di lavoro registrata: (1) prima chiudere il dubbio prewarm
  S23; (2) quant con imatrix dal F16 sul Mac quando la v2b libera la CPU (Q4_K_M e Q4_0 + imatrix, PPL vs ufficiali);
  (3) dopo G1, solo se vince MiniCPM5: LoRA/SFT sulle classi di errore misurate (deriva es/ja, eco XML nel testo,
  rifiuti), Runpod, corpus G1 come eval con i 20 riservati sigillati. Pesa nel tie-break di licenza di §9.

- **9/09 ~12:05 EDT — QUANT NOSTRI CON IMATRIX (MiniCPM5, `MINICPM5-Q4_0.md` §imatrix)**: calibrazione 370 KB
  disgiunta dal corpus G1 (sha 241f2b…, 55 chunk, 756 s). PPL sullo stesso testo: Q8_0 22,34 · Q4_K_M ufficiale 23,55 ·
  **Q4_K_M-imx 23,36** · Q4_0 ufficiale 26,19 · **Q4_0-imx 24,64** (Q4_0-imx contiene 5 tensori Q4_1 promossi dal
  quantizzatore: verificare la copertura kernel prima di un'abilitazione GPU). Il 4-bit migliore resta Q4_K_M-imx
  (+4,6 % vs +5,4 % dell'ufficiale) e Q4_K viene ripacchettato su ARM: se MiniCPM5 vince G1 il candidato è
  Q4_K_M-imx. File in `~/kalsa-qdc/models/MiniCPM5-2B-{Q4_K_M,Q4_0}-imx.gguf`. Nessun push sui telefoni finché il
  dubbio prewarm S23 non è chiuso.

- **9/09 ~12:15 EDT — JELLY DOCUMENT CHAT: 7/7 PASS SU main@5707cfe (era 1/5)** (`product-suite/JELLY-DOCCHAT-2026-09-09.md`
  §v2, Luna e1b923b9, stesse domande e stesso protocollo): il PDF da 40 pagine ora ha pageCount=40/processed=40,
  estimatedTokens 26 655 → strategia `hybrid` (retrieval), i tre fatti sepolti (p.3/17/31) trovati con la pagina
  citata, il fatto assente detto assente, follow-up corretto, riapertura corretta (allegato da riselezionare).
  **Tempi sul Jelly**: 2,8-3,7 tok/s, completamento 119-417 s per scenario, thermal status 3 costante a 37-40 °C:
  corretto ma lento — sono i numeri da cui fissare gli obiettivi Jelly a G1 (§9/§13). Import via intent SEND:
  fallito per "no access" del MediaProvider = adb `am start` non concede il permesso URI (un'app vera lo dà con
  FLAG_GRANT_READ_URI_PERMISSION); re-test con `--grant-read-uri-permission` in corso prima di chiamarlo difetto.
  Embedding in background arrivato a 707 chunk senza riga `done` prima del force-stop (da guardare in §8).

- **9/09 ~12:30 EDT — PREWARM MiniCPM5 SULL'S23: ANOMALIA REALE, CAUSA NON ANCORA TROVATA** — SUPERATA dalla voce delle 14:00: non era ingest a token singoli (recon deepseek 0399b4e5
  sui log del dry run + lettura mia del sorgente): `KALSA_PREWARM start → skip eval-failed` dopo **138 s** (e 116 s
  nell'altro run) con `promptMs:0, promptN:1, tokensEvaluated:2112`; LFM `done` in 40 s (1919 token, 48 tok/s =
  coerente col seed a freddo del protocollo restore). `eval-failed` = `promptMs <= 0` (LlamaService:811); promptN=1
  viene da `llama-context.cpp:655-673`: le decode con batch==1 sono contabilizzate come eval, non come prompt →
  **i 2112 token sono stati processati un token alla volta** (138 s ≈ 2112 × 65 ms). Escluso: il template
  (`enable_thinking` è letto solo con add_generation_prompt, che il prewarm mette a false); il frazionamento a
  checkpoint di stato (solo modelli ricorrenti/ibridi, `rn-completion.cpp:150`); `n_batch` (fisso 512,
  LlamaService:1456). ATTENZIONE: la conclusione del recon "prefill reale MiniCPM5 619 tok/s" è una lettura
  sbagliata (il turno vero riusava ~2200 token di KV: 3,5 s è prefill incrementale). Il runner filtra il logcat
  con una whitelist (`run_device_subset.sh:347`) → nessuna riga nativa (perf, reusing, repack) disponibile.
  **Prossima misura decisiva sul Jelly** (libero): prewarm dei due modelli con logcat COMPLETO (perf "prompt eval
  time", n_p_eval, KALSA_GOVERNOR/KVPREFIX), poi un turno vero a KV vuota. Decode MiniCPM5 6,5 vs LFM 10,4-11,7
  tok/s sull'S23 resta un dato vero.

- **9/09 ~14:00 EDT — PREWARM MiniCPM5: LA CAUSA È TROVATA, E LA LETTURA DELLE 12:30 ERA SBAGLIATA** (misura Jelly a
  logcat completo, Luna e1b923b9, `product-suite/JELLY-PREWARM-2026-09-09.md` + verifica mia sul sorgente, righe
  citate nel report). Non è ingest a token singoli: è un **artefatto di contabilità dei contatori perf**. Catena:
  `llama_context::decode()` non sincronizza mai (`llama-context.cpp:2021`, chiamata commentata); i token in coda
  entrano in `n_p_eval/t_p_eval_us` solo dentro `synchronize()` (`:664-682`); `perf_get_data()` è `const` e non
  sincronizza (`:3150`, e `max(1, n_p_eval)` a `:3157` è l'origine dell'`1`); llama.rn lo legge così com'è
  (`JSICompletion.h:205`); con `n_predict: 0` la completion esce prima di qualunque `llama_get_logits*`
  (`rn-completion.cpp:1203`). LFM e Qwen3.5 sincronizzano per caso: la cattura del checkpoint di stato chiama
  `llama_state_seq_get_data_ext` → `ctx->synchronize()`, ed è abilitata solo per modelli ricorrenti/ibridi
  (`rn-completion.cpp:146-152`). **Prova che il KV c'era**: il turno caldo dopo il prewarm MiniCPM5 riusa il prefisso
  (`KALSA_KVPREFIX n_common=2109`). Conseguenza prodotto: OGNI modello denso ha il prewarm marcato `eval-failed`
  (`evalFailed = … || promptMs <= 0`, LlamaService:811), `prewarmPrefixHash` resta null e il trigger successivo
  rifà minuti di prefill — sul Jelly 223 s a 47 °C di skin. Fix app in corso (Luna 53f7ade9: criterio senza
  `prompt_ms`, helper puro + test); follow-up nel fork: `llama_synchronize` prima di `llama_perf_context` in
  `JSICompletion.h`. Numeri veri che restano: prefill MiniCPM5 9,4 vs LFM 15,9 tok/s sul Jelly (~15 vs ~48 sull'S23),
  decode 1,9 vs 3,1 tok/s sul Jelly a 47 °C (6,5 vs 10,4-11,7 sull'S23). Se il gap sia il percorso repack Q4_K
  (`q4_K_8x4`) è una domanda per lo sweep G1 sui device, non un'anomalia. HARNESS_FINDINGS §7.44 riscritta.

- **9/09 ~14:40 EDT — FIX PREWARM COMMITTATO: `e168b4a` su main** (Luna 53f7ade9, audit mimo 9f763325: 0 rilievi
  bloccanti, criterio CONFERMATO su decode fallita / interrupt / prefisso pieno / context full). Criterio nuovo in
  `src/engine/prefixPrewarm.ts::classifyPrewarmResult`: nessun errore nativo, non interrotto, zero token generati,
  `tokens_evaluated > 0 && tokens_cached >= tokens_evaluated` (`n_past` avanza solo dopo una decode riuscita,
  `rn-completion.cpp:1143-1157`); `promptMs/promptN` restano nel log come diagnostica. 6 test, tsc pulito.
  Nota dell'audit: `result.error` non viene mai valorizzato sul percorso diretto `engine.completion()` (solo su
  quello a coda), il guard resta per difesa. APK debuggable arm64 in CI (run 34384060378); poi ri-misura del prewarm
  MiniCPM5 sul Jelly con logcat completo, attesa `op=done`.

- **9/09 ~15:00 EDT — FIX PREWARM VERIFICATO SUL JELLY (APK e168b4a, sha 3e59781e…): PASS** (Luna e1b923b9,
  `JELLY-PREWARM-2026-09-09.md` §Re-measure). MiniCPM5 a freddo: `op=start 14:24:10.063 → op=done 14:26:06.523`
  = 116,5 s (2112 token, 29 °C di partenza contro i 223 s a 47 °C della mattina), `promptMs=0/promptN=1` restano
  diagnostici come previsto. HOME → foreground → nuova chat: nessun secondo `op=start` sullo stesso hash. Turno
  caldo: `n_common=2263`, `tokensCached=2388/tokensEvaluated=2281`, `promptMs=2460`, 4,5 tok/s a 32 °C. L'unico
  altro start (14:29:37) è un reload del motore nello stesso PID provocato da un tentativo di share sbagliato
  dell'harness: reload → hash azzerato per design, non regressione. Il difetto "ogni modello denso rifà minuti
  di prefill a ogni trigger" è chiuso sul device. Resta il follow-up nel fork (sync prima dei timing) per avere
  `promptMs` veri nei log dei prewarm densi.

- **9/09 ~15:40 EDT — G1 MAC, GIUDIZIO CIECO v2b UNITO A v2: IL QUADRO SI RIBALTA VERSO LFM** (giudici deepseek
  5b79eee5 e mimo 020b69f0, 18/18 righe ciascuno, unblind mio con `judge-key-v2b.json` = `judge-key-v2.json` sulle 18).
  A v2 i due giudici davano parità (25/22/13 e 23/24/13) perché 14 finali LFM erano vuoti per il tetto a 2 round
  dello stub. Con la semantica dell'app (3 round, ultimo text-only, fallback) le 18 righe passano da LFM 0-2 vittorie
  a 9, e il totale a 60 righe diventa **deepseek LFM 34 / MiniCPM5 13 / pari 13, mimo 30 / 15 / 15** (medie 3,57 vs
  3,18 e 3,72 vs 3,22). Cautele scritte in `RESULTS-DEV.md`: sessione di giudizio separata per le 18; 17/18 sono
  riparazioni lato LFM, quindi misura il costo che l'harness infliggeva a LFM, non una debolezza nuova di MiniCPM5.
  Artefatto trovato nel pack: MiniCPM5 `@256` ha 2/44 risposte che sono solo `>` (`predicted_n=258`, il budget di
  thinking 256 taglia il ragionamento e la chiusura forzata lascia `>`), 0/44 a `@512`, 0 per LFM → rischio prodotto
  sul budget corto dell'app se MiniCPM5 vincesse, e domanda per il fork (enforcement del budget / parser).
  Patch nativa dei timing: `e6d6aa0` su main (sync prima di `llama_perf_context`), APK in CI run 34393538176.

- **9/09 ~16:00 EDT — OWNER: i budget di thinking 256/512 furono tarati sul vecchio Qwen, mai su LFM né su
  MiniCPM5 → non sono un vincolo di prodotto, sono un'eredità.** Quindi la cella v2c (MiniCPM5 a budget 1024 e
  libero, stesse 60 righe, token di ragionamento contati e costo in secondi su S23/Jelly) è la misura giusta per
  G1, non un contro-esperimento. Rimandata di un'ora su richiesta dell'owner (rumore del Mac): agente 131645cd
  cancellato prima che il server partisse, nessun artefatto scritto. Lo sweep S23 continua (lavoro sul telefono).
  Nota per la decisione: il budget va scelto per modello sui dati, con il vincolo umano dell'attesa alla prima
  parola, non ereditato.

### Undated state notes from the former “Dove siamo”

- **Governor v0.2 nel fork** (`kalsa/governor-v0.2` @1a33da0f6, ~4.3k righe, 8
  step auditati): due contesti (prefill/decode), commit KV per range, input
  host già definiti — generazione (V73/V75/V79), fit GPU/NPU, batteria %,
  temperatura, plugged, T idle, trend (`src/llama-ext.h:198-230`); policy con
  soglie 38/39.5/42/43 °C, floor batteria 25 %, isteresi, budget flip 1 h
  (`src/llama-governor-policy.cpp`); GPU_COOLMODE; NPU lane **deferita**
  (`llama-ext.h:149`). Misurato: 8 Elite #38 (ttft ~10× CPU, decode ≥ CPU,
  vantaggio termico), 8B #41, tabella KEXP #40, VL #42, tier 750/735 #55-58.

- **App oggi**: `deviceTuning.ts:374` → `cpu-only` (`gpu-fit-gate-blind`) su
  ogni Android; `useThermalMonitor.ts` = banner UI, non decide nulla; visione
  CPU su Android (`LlamaService.ts:1499`); fallback `KALSA_GPU_FALLBACK` solo
  per errori di init (lmkd non è catturabile); gate RAM cieco alla memoria GPU
  (§7.18: 3.4 GB invisibili a /proc, lmkd uccide); backend Hexagon NON
  compilato nel plugin; commenti stantii in `engineParams.ts:100-113` e
  `LlamaService.ts:1429-1437,1496-1500` che parlano di GPU "ora attiva".

- **NPU**: v79 prefill 7.2× CPU ma correttezza NON provata (0/301 + 36
  INTERNAL-ERROR); v75 prefill 3.19-4.82×, decode 0.63×; v73 offload parziale
  vive, pieno muore (mapping su OGNI commit incl. pin); la TLBMISS v73 è
  bisezionata: culprit `0a50d9909` = upstream #26049 (#64, ALIVE 47) — si
  fixa nel fork o si lascia, MAI issue upstream.

- **Oracolo a logit / R5 (6/09, IN CORSO, NIENTE ANCORA BANCATO):** l'oracolo a logit è implementato (app 19b67b6 hook
  `raw_probs` + `bench_force_ids`, driver `oracle_logit.py` R1-R4, audit #25-#26) e i suoi controlli di sanità R5 sono in
  volo su QRD8650 (sessione 807954, sa812023). Sei tentativi bruciati sull'8 Elite hanno però prodotto TRE difetti reali,
  tutti chiusi: (a) **app** — `kalsa.bench.toolchoice=none` non toglieva i tool dal template, dal prompt di sistema né
  dal prewarm, e il parser di fallback eseguiva la tool call scritta in testo (commit 19b67b6/e54f529, audit #27-#28);
  (b) **driver** — `new_tokens_a` veniva letto solo dalla riga di rollback `reusing N/M`, che sparisce quando il prefisso
  prewarm combacia (fallback su KALSA_KVPREFIX, commit 17b93d1e); (c) **driver/board** — su Android 16 il risveglio
  schermo porta in cima il launcher e il dump UI fotografava la home (guardia `app_foreground`, commit c946e79a).
  Budget 8 Elite esaurito (89 min) → R5 spostata su QRD8650 (PREREG Amendment 9); il caso 8 Elite (flip a idx 29) resta
  aperto. Costo misurato di una coppia A/B: **35-40 min**.

- **S5b run 10 (6/09, ALIVE 54, BANCATA descrittiva):** QRD8635 forzato: prefill GPU 1,72× (mediana 0,581, 2 coppie, 5/5 valide), oracolo FAIL ×2 con ids GPU = 732 = 750. Mid-tier V73 in-app: 732 1,63×, 735 1,72×. Guard A (8 Elite kit CLI) in lancio su sessione 807910 (board offline al primo giro); poi run 8b QRD8650 con APK c8d137e, poi run 11 HDK8550.

- **750 mul_mat view (6/09, ALIVE 53, BANCATA kernel-level):** gate `ADRENO && !contiguous(src0)` → 925/0 sul 750 (baseline 905/20 riprodotto), MUL_MAT_ID/FA invariati, bench ±2%; causa radice inspiegata; fork branch `opencl-picks-2026-09+25910` pushato. Da fare: 8 Elite pp512 col candidato, run 8b in-app (predizione: ids GPU invariati). Run 10 QRD8635 IN VOLO (sessione 807861).

- **S5b run 9 (6/09, ALIVE 52, BANCATA descrittiva):** QRD7675 con governor FORZATO: prefill GPU 1,63× CPU (mediana 0,613, 2 coppie, 5/5 righe valide) — prior di parità SBAGLIATO; oracolo FAIL ×2 con ids GPU = 750 → divergenza = proprietà A7X, non il difetto 20-FAIL. Policy: velocità sì, oracolo no → V73 resta false. Test kit 750 (baseline→candidato gate) IN VOLO su sessione 807841. Poi run 10 QRD8635, run 11 HDK8550, 8 Elite pp512 col candidato, run 8b.

- **S5b run 8 (5/09, ALIVE 51, BANCATA descrittiva):** QRD8650 con governor FORZATO sulla B: prefill GPU 4,29 s vs CPU 8,50 s (1,98×, una coppia), commit KV 12,1 MB/13 ms, FAST; oracolo strict FAIL da idx 7 (difetto 750) → NOT MET come pre-registrato. Trappola 9 (typing degrada a caldo) ha bruciato A2. **Decisioni owner**: 8635/8550 (nessuna B in-app), 750 allowlist OFF vs 2× prefill. Nessuna sessione QDC aperta, nessun driver vivo.

- **S5b run 7 (5/09, ALIVE 50, BANCATA null descrittivo):** sul QRD7675 il governor v0.3 è INERTE per allowlist (`Unknown`→CPU): B≡A per design, parità NON testata; CPU TTFT 12,1-12,6 s su 938 token; su 7675/8635/8550 non esiste una B in-app, solo QRD8650 (V75) con `kalsa.bench.governor_force=1` → run 8 pre-registrata (PREREG §"Run 7e → run 8"), driver in audit #15. 8635/8550 parcheggiati per l'owner.

- **S5b (5/09, ALIVE 49, BANCATA descrittiva):** governor prefill 1,81× la CPU sull'8 Elite in-app (3,32 vs 5,86-6,18 s su 925 token, 2 coppie stesso-turno, PASS-1 esplorativo); oracolo stretto FAIL per 1 token ⇒ endpoint NOT MET per costruzione; PASS-1 pre-registrato per runs 7+ (QRD7675 in volo dalle 15:30, poi 8635, 8550, 8650).

- **Governor nell'app (fase 1, `docs/PLAN-governor-in-app.md`) — stato 6/09 mattina:** S1-S4 fatti, cella S5 BANCATA (ALIVE 48, 6 run QDC): il governor gira end-to-end nell'app (prefill GPU + commit KV + decode CPU), la degradazione termica funziona (Wait a ≥38 °C → turno su CPU, completato), l'oracolo greedy PASSA su 8 Elite (Adreno 830) e FALLISCE solo su Adreno 750 (difetto f16/bf16-batched noto, ALIVE #38/#39) → gate di correttezza per generazione (V75 OFF). Decode: parità con la CPU (28.3 vs 28.5 tok/s su 8 Elite). TTFT: il timer di A era inquinato (fix fork e31b9144c); col run 7 il confronto equo sui ~15 token nuovi (sistema in cache dal prewarm) dà parità CPU/GPU (A 205-488 ms, B 358 ms); il vantaggio GPU sta nel prefill grande: prewarm 1024 token 4.1-4.3 s vs 6.6-6.8 s (1.6×) — ma il fork #38 misurava ~10× su 512 token senza cache: prossima cella = prefill grande SENZA prewarm nell'app. Branch app `feat/governor-in-app` @8a56edc (pin fork e31b9144c), 9 delta audit grok GO; nove bug trovati e fixati dalla cella (elenco nel diario). Aperti: 1.65× prewarm GPU vs ~10× del fork #38 da spiegare; headroom RAM a due contesti; workaround del difetto 750 nel fork; S6 (gate RAM con GPU) e S7 (loop termico in produzione via BatteryManager).

- **Mali G57 (Jelly)**: PARKED per decisione owner 22/08 (ALIVE 405): f32 e
  q8_0 corretti ma GPU < CPU in tutti i 20 casi; si riapre con G610/G615.

- **Strumenti pronti**: APK debuggable A/B (run-as, ALIVE 46), QDC con 8 Gen
  2/3, 8s Gen 3, 8 Elite (~900/866/981/623 min), kit v73 per commit.

- **9/09 ~16:20 EDT — TRE FIX APP COMMITTATI SU main, APK COMBINATO IN CI** (dopo i due doc). (1) `33502b2` document chat:
  `full_context` solo se il documento sta nel budget di prefill del telefono (tok/s misurati × 20 s, EMA per modello,
  fallback 800 token finché non c'è un campione), riga `KALSA_DOC_STRATEGY` alla decisione; audit mimo: fallback
  abbassato da 1500, alpha 0,3, test ai bordi. (2) sessione dopo un turno con tool (Luna d1552823, audit deepseek
  586ed041 "nessun percorso di corruzione"): il `.kvs` buono precedente resta e viene marcato `divergesAtLastExchange`,
  la riapertura accetta esattamente prefisso + [user, assistant] non interrotto → riapertura calda fino al prefisso;
  limiti scritti nel codice (due turni tool consecutivi → fredda; tool al primo turno → `kv_prefix_unavailable`);
  il no-op logga `op:"mark_prefix"`, mai `save ok:true`. (3) campione di prefill agganciato al prewarm e alla telemetria
  con `prompt_n/prompt_ms` (mai `tokens_evaluated`: con il riuso del prefisso gonfierebbe la stima di ~60×).
  Nativo: `e6d6aa0` (sync prima dei contatori) passato da CI, installato sul Jelly, misura in corso.

- **9/09 ~16:40 EDT — TIMING NATIVI VERI SUL JELLY (APK e6d6aa0), E IL "GAP DI PREFILL" SUL JELLY ERA TERMICO** (Luna
  e1b923b9, `product-suite/JELLY-PREWARM-2026-09-09.md` §Native sync). Prewarm MiniCPM5 a freddo, 29 °C:
  `promptMs=118648.554`, `promptN=2112`, wall 118,694 s → contatori a 45 ms dal wall, **17,8 tok/s** di prefill. Il
  9,4 tok/s di stamattina era la stessa misura a 47 °C di skin: sul Jelly a pari temperatura MiniCPM5 (17,8) non è più
  lento di LFM (15,9). Il gap 15 vs 48 sull'S23 resta da rimisurare a temperatura controllata (sweep in corso, telefono
  a 40 °C in carica). Turno caldo: `n_common=2109`, `promptMs=2562` per 13 token incrementali (costo fisso del primo
  token, non una velocità). Residuo dell'harness: lo share deep link ricrea il motore e rifà il prewarm prima del turno
  → segnato PARTIAL dall'agente, non è un difetto dell'app. Da oggi il campione di prefill del prewarm entra nell'EMA
  (`recordPrefillSample`, a36074e), quindi il budget del document chat sul Jelly parte da ~350 token invece del
  fallback 800.

- **9/09 ~17:00 EDT — CELLA v2c (MAC): IL BUDGET DI THINKING NON SPOSTA IL PUNTEGGIO DETERMINISTICO DI MiniCPM5, MA
  TOGLIE L'ARTEFATTO** (Luna 131645cd, `g1-model-select/RESULTS-DEV.md` §v2c, `results/{bakeoff,wild}-v2c/`). Stesso
  setup v2b, MiniCPM5 a budget 1024 e libero (`thinking_budget_tokens` omesso = default del fork −1), 60 righe ciascuno,
  zero errori HTTP. Deterministico bake-off **33/44 a entrambi**, uguale al @512 (33) e quasi al @256 (32); LFM v2b 34.
  Risposte vuote o `>`: **0/60** a entrambi (erano 2/44 a @256). Token di ragionamento: mediana 157 (1024) / 187 (libero),
  p90 717, max 3751 → costo prima parola stimato a 6,5 tok/s sull'S23: mediana 24-29 s, p90 110 s; sul Jelly a 4,5:
  35-41 s / 159 s. Lettura: la mediana sta sotto 256 anche a budget libero, è la coda (p90) che il 256 tagliava
  lasciando `>`; la scelta del budget è un problema di coda e di UX, non di media. Giudizio cieco dei due pack
  (MiniCPM5@1024 vs LFM v2b, MiniCPM5@libero vs LFM v2b) mandato a deepseek e mimo, mappe A/B fresche.

- **9/09 ~17:30 EDT — v2c GIUDICATO: IL BUDGET NON ERA LA CAUSA, LFM RESTA AVANTI A OGNI BUDGET** (deepseek 5b79eee5,
  mimo 020b69f0, 60+60 righe, mappe fresche; unblind mio). @1024: LFM 28/15/17 (deepseek) e 27/13/20 (mimo); libero:
  26/17/17 e 24/15/21. Accordo tra giudici 43/60 e 38/60. Rispetto a v2b (34/13/13, 30/15/15) MiniCPM5 recupera 2-4 righe,
  tutte sul blocco wild; sul bake-off il gap non si muove: fatti inventati (Lirinda, Vichy, Mairzac, "Sahara Solar",
  Villeneuve), risposte in inglese a prompt es/fr/it, un carattere cinese in una risposta spagnola. La mia ipotesi
  delle 15:30 ("è il budget che lo strozza") è **smentita dai dati**. Domanda dell'owner: questi fallimenti sono
  recuperabili col fine tuning? Sono comportamentali (onestà, lingua, tool offline), il bersaglio classico di SFT/DPO su
  un 2B; ma prima va separata la quant dal modello → cella v2d (MiniCPM5 Q8_0, thinking libero, stesso harness) in
  corso sul Mac. G1 sceglie sul modello com'è oggi; "MiniCPM5 + fine tune" resta una traccia post-G1.

- **9/09 ~18:00 EDT — v2d GIUDICATO: NEANCHE LA QUANT È LA CAUSA. LA CATENA v2b→v2c→v2d È CHIUSA** (deepseek e mimo,
  60 righe, mappe fresche, unblind mio). MiniCPM5 **Q8_0** a thinking libero contro LFM v2b: LFM 24/16/20 e 26/13/21;
  deterministico 31/44 (Q4_K_M 33/44, fr 5/11). Stesse classi di errore a 8 bit (Lirinda, "Sahara Solar", Lorenzo
  de' Medici, tedesco sgrammaticato in W08). Conclusione: su questo corpus, con prompt e tool loop dell'app,
  **LFM2.5-2.6B batte MiniCPM5-2B sul comportamento da assistente** (onestà, fedeltà alla lingua, tool offline)
  indipendentemente dal budget di thinking e dalla quantizzazione; i punteggi deterministici sono pari (34 vs 33).
  Per MiniCPM5 resta solo il post-training (fine tuning, Apache 2.0), che l'owner ha messo dopo G1. Sui telefoni:
  sweep S23 in corso; sul Jelly il prefill a pari temperatura è alla pari (17,8 vs 15,9 tok/s), decode 4,5 vs 3,1-3,7.

- **9/09 ~16:50 EDT — SWEEP S23 FERMATO DA ME: 11 `send_failed` di fila dopo C01.** `device/s23/lfm.out.jsonl`: C01 ok
  (15:03), poi C02…I05 tutti `send_failed` a ~8 min l'uno (timeout), evidenza in `device-share-send-out/case-*` senza
  `turn0.ev`: l'invio non è mai arrivato all'app, che era viva (pid 16425, 37 %, 40,8 °C). Il loop di monitoraggio
  dell'agente deepseek 100fe465 controllava solo che il processo del runner fosse vivo, non che le righe fossero `ok`
  → tre ore di telefono perse. Runner ucciso (pid 42506), agente cancellato e rilanciato in sola diagnosi (script di
  invio, logcat attorno all'ultimo caso, stato schermo/keyguard, un probe manuale). Lezione da scrivere nel runner:
  il watchdog deve guardare l'ultima riga scritta, e fermarsi al terzo `send_failed` consecutivo.

- **9/09 ~17:05 EDT — CAUSA DEI `send_failed` S23: BUG DEL RUNNER, L'APP È SANA** (deepseek 100fe465, diagnosi in
  `device/s23/RUN-STATE.md`; verificato da me sul file). `run_device_subset.sh:361` tronca il "needle" ai primi 48
  caratteri del turno e poi pretende l'uguaglianza esatta col composer: ogni turno più lungo di 48 caratteri non
  combacia mai → rilancio (che distrugge il testo atterrato) → nuovo share → fallimento. C01 (46 caratteri) passava,
  coerente con 12/12. Secondo bug: `OUT=` a riga 48 viene definito dopo il `source` di `device-share-send.sh`, che a
  riga 29 imposta il proprio default → tutta l'evidenza finiva in `device-share-send-out/`. Probe manuale con lo
  script non modificato: percorso di invio integro. Fix in corso (uguaglianza sul testo intero, OUT prima del source,
  watchdog che esce al terzo fallimento consecutivo, no re-run di C01), righe fallite rimosse lato host e conservate in
  `s23/lfm.out.send_failed-2026-09-09.jsonl`, braccio LFM ripartito col gate termico del protocollo (telefono a 41 °C).

- **9/09 ~17:35 EDT — I TRE FIX DELL'APK a36074e VERIFICATI SUL JELLY** (Luna e1b923b9,
  `product-suite/JELLY-FIXES-a36074e-2026-09-09.md`). **A, budget di prefill: funziona come da specifica.** Il prewarm
  LFM (1832 token, 53,7 s a 30 °C = 34 tok/s) entra nell'EMA → `budgetTokens 653`; il PDF grande (26 655 token) va a
  `retrieve`; il PDF piccolo (489 token) va a `retrieve` perché nel frattempo l'EMA è scesa a 17 tok/s (telefono caldo)
  → budget 344 < 489. Prima sarebbe andato in `full_context`. TTFT 39 s e 30 s. Due residui non del fix: entrambe le
  risposte chiuse `interrupted=true` (poll/timeout dell'harness) e la risposta sul manuale inglese è partita in inglese a
  una domanda italiana (deriva di lingua di LFM su documento inglese: aperto). **B, sessione dopo turno con tool: PASS.**
  Turno 1 `save ok`; turno 2 col PDF `mark_prefix ok` (usedTokens 3200) e nessun `save ok`; force-stop → riapertura
  `load ok tokens 2161`; turno 3 `n_common=2161`, `promptMs 32,2 s` contro ~120 s a freddo. **C: PASS**, il prewarm LFM
  logga timing reali. Nota di misura: LFM prefill 34 tok/s a 30 °C contro 15,9 misurato a caldo stamattina → ogni
  numero di prefill sul Jelly va letto con la temperatura accanto.

- **9/09 ~18:15 EDT — FIX LINGUA NEL DOCUMENT CHAT COMMITTATO** (deepseek 72ebe055, audit mimo a4f2664c). Il risultato
  del tool documento finisce con una riga di istruzione: "Answer in the language of the user's question (if unclear,
  <locale>). Quote passages in their original language." — la lingua della domanda resta primaria, il locale è solo il
  tie-break, coerente con la regola (a) di f77ea7b. Il cue è riservato dentro il budget del corpo del tool (LlamaService
  taglia a ~2319 caratteri dalla coda): l'audit ha trovato che con ≥15 passaggi corti il percorso retrieval sforava e il
  cue sarebbe stato tagliato → ora entrambi i percorsi calcolano `maxBody` e troncano il corpo, mai il cue. Sull'`interrupted`
  dei documenti: non è un timeout dell'app, è lo stop del composer (l'harness ha interrotto il turno); il tool ha 190 s
  ma la generazione continua. Nulla da toccare. APK in CI per la verifica sul Jelly (domanda italiana su manuale inglese).
  Debito annotato: `documentChatTool.ts` è a 1566 righe.

- **9/09 ~18:45 EDT — CUE DI LINGUA VERIFICATO SUL JELLY (APK 4b29466): PASS** (Luna e1b923b9, `JELLY-FIXES-a36074e-2026-09-09.md`
  §Answer language). Manuale inglese, domanda italiana → risposta italiana in tre frasi, `interrupted:false`, TTFT 94 s,
  totale 150 s; stessa domanda in inglese → risposta inglese, TTFT 30 s, totale 69 s. Entrambe via `retrieve`. Il TTFT
  di 94 s della prima è la costruzione dell'indice del documento al primo attach più il prefill; la seconda riusa
  l'indice. Con questo la giornata chiude quattro difetti visibili all'utente oltre ai tre di stamattina: prewarm dei
  modelli densi, budget di prefill per i documenti, riapertura calda dopo un turno con tool, lingua della risposta sui
  documenti. Prossimo: sweep G1 notturno sul Jelly col runner corretto.

- **9/09 ~19:05 EDT — S23 BRACCIO LFM COMPLETATO COL RUNNER CORRETTO; SWEEP NOTTURNO JELLY LANCIATO.** `s23/lfm.out.jsonl`:
  22 righe, 21 `ok` + 1 `reply_timeout` (C04 doppia, il runner tiene la più recente), ~3,5 min a caso, telefono a
  40-42 °C in carica lenta (42 % stabile). Il runner ha il watchdog a riga 592 (esce al terzo fallimento consecutivo).
  Braccio MiniCPM5 in coda dopo il raffreddamento da protocollo (deepseek 100fe465). Jelly: nuovo agente deepseek
  d680d546, APK 4b29466 (l'S23 gira 5707cfe: differenza dichiarata nell'header — prewarm, budget documenti, cue di
  lingua; stesso prompt e tool loop), 24 × LFM poi 24 × MiniCPM5, gate termico del protocollo, monitoraggio per righe,
  probe >48 caratteri prima del braccio. Stima 12-16 h → SCORE.md domani mattina.


- **9/09 sera (21:00–22:45) — tre telefoni in sweep, S23 rivela un bug prestazionale, canale opencode-go finito.**
  (1) **S23**: owner scollega il telefono alle 21:15 (52 %, 37 °C). Il supervisore deepseek `s23/supervisor.sh`
  rilanciava il braccio MiniCPM5 a ogni giro (tre runner concorrenti 21:13/21:15/21:17): ucciso, log tenuto in
  `s23/minicpm.run.contaminated-3runners-2113.log`, un runner solo rilanciato a mano 21:20. `lfm.out.jsonl` S23 =
  33 righe / 24 id (9 rilanci ok): lo score prende la prima riga ok per id. Braccio MiniCPM5 fermato dal watchdog
  dopo 5 casi: C01 ok 410 s, C02 ok 537 s (decode 6,9 tok/s), C03/C04 banner `turnInterrupted` (motore smontato a
  metà turno), C05 `reply_timeout` 480 s con prewarm 2112 token in 286 s (7,4 tok/s) e **15 token in 260 s (0,06
  tok/s)**, `failed to mlock 375 MB: Out of memory`, swap 2 GB/4 GB usati, `traced`+`traced_perf` attivi (431 MB).
  Batteria 52 % → 28 % in 65 min per 5 domande: **l'owner lo classifica bug prestazionale da risolvere** (PLAN
  "Aperti", prima voce). APK S23 ancora 5707cfe. Rifare domani a telefono carico e freddo, timeout 900 s, memoria
  campionata per turno. (2) **Jelly**: LFM 20/24 ok; M02 `send_failed` al turno 4 (turno 3 "settled" dopo 25 s a
  stato termico 3, poi nessun nodo Send: ipotesi falso settle del runner, non bug app); M03 `NOT ready after 600 s`
  a telefono caldo. Luna e1b923b9 riprende alle 22:40 con i 4 casi mancanti (M02, M03, T09, T11) poi MiniCPM5
  completo, stop solo dopo 3 non-ok consecutivi. (3) **Xiaomi 14** (owner lo concede 21:15): adb TLS
  `192.168.1.193:35049` (porta da mDNS, la 5555 è chiusa), APK 4b29466 con `install -r` (dati tenuti), MiniCPM5
  Q4_K_M spinto (sha ec2d5801…), 80 % scarico, 32 °C. Sweep di Luna 67865c00 (`xiaomi/supervise_g1.sh`, floor
  30 %): 21 righe LFM ok in 53 min (~2,5 min/caso, 97 s il C01), 40 °C a 66 %. (4) **Mac**: runner committato
  c24d4e5d; split di `documentChatTool.ts` 1566 → 15 moduli + entry 38 righe (Luna 54bc9812, tsc 0, 45 test) in
  audit su GLM 5.3 (openrouter); ricognizione embedding senza `done` (mimo, file completo prima del 429): tutte le
  uscite chiamano `logEmbedDone` tranne il `catch` esterno `AppShell.tsx:1891` che logga solo `skip: job
  exception` → verdetto buco di log (finestra di cattura), fix difensivo minimo in corso; analisi budget di
  thinking sui dati passata a Luna 131645cd. (5) **Canale**: opencode-go (deepseek, mimo, omen) quota mensile
  finita ~22:30, reset ~15/09; i 400 "senza body" di prima erano già la quota. Audit → GLM via openrouter.

- **9/09 22:35–23:00 — Xiaomi perso due volte, braccio MiniCPM5 rinviato; owner a letto.** LFM sullo Xiaomi 14:
  **24/24 ok** in 53 min (T11 121 s). Poi (1) 22:34 gate termico del supervisore Luna in `unknown` (pattern
  `Current thermal status:`, i telefoni stampano `Thermal Status:`), senza timeout; (2) 22:36 kill del supervisore
  → trap EXIT del runner cancella `screen_off_timeout` → schermo spento → keyguard SICURO (PIN) → HyperOS congela
  l'app: C01 MiniCPM5 `ready_timeout` 738 s con `cpuset=/background`, `wakefulness=Dozing`, RSS 278 MB; (3) owner
  sblocca due volte; 22:58 il watch_arm legge la vecchia riga C01 come primo non-ok 40 s dopo il rilancio → stop →
  trap → lock 2, guardia esterna a 10 s arrivata tardi. Tutto fermato, app chiusa, nessun processo tocca lo
  Xiaomi. Post-mortem in `xiaomi/RUN-STATE.md` con le tre modifiche prima del rilancio (righe solo post-avvio,
  niente restore del timeout con un braccio pendente, START_AT senza check delle righe stantie). Regola in memoria
  ([[kalsa-campaign-ops-lessons]]). **Budget thinking (v2, Mac)**: LFM a "256" ha mediana 470 token di ragionamento
  con `finish=stop` → il tetto non ha mai morso sul server; MiniCPM5 perde uguale (61-67 %) a 1024 e libero; analisi
  rifatta sul set completo (44+44+30 per modello) in corso, RESULTS-DEV.md "Thinking budget per model (data)".
  Jelly 23:00: 22 righe LFM, M02 in corso, 38 °C stato termico 3 a 100 % su USB.

- **9/09 23:20 — Jelly: M02 fallisce due volte per lo smontaggio del motore in background, non per il runner.** I 4
  casi LFM rifatti: M03 641 s ok, T09 400 s ok, T11 527 s ok, M02 `send_failed` (turno 3 stavolta, turno 4 ok).
  Telemetria `ev-lfm-remaining/case-M02.turn1.ev`: 8 s dopo la risposta del turno 1 → `KALSA_SESSION init` +
  `load no_file` + `PREWARM start` = motore ricreato. Causa nel codice (`AppShell.tsx`, handler `onAppState`): su
  QUALSIASI evento `background` l'app aborta l'invio, salva e chiama `disposeEngine()` subito, senza grazia
  (`model.unload reason:"background"`). Ogni `kalsa://share` (harness e utente da Files) e ogni salto breve su
  un'altra app costano al rientro init + prewarm completo: Jelly 60-120 s (a stato termico 3 oltre la pazienza
  del runner → nodo Send assente → `send_failed`), S23 ~30 s. È il ciclo "background breve" di §13 e il punto §3
  "attività accessorie non devono occupare il motore al messaggio successivo". Fix in corso: grazia di 45 s in
  background prima dello smontaggio (annullata al rientro; smontaggio immediato solo su pressione memoria), APK
  da CI e verifica sul Jelly domani. Braccio MiniCPM5 Jelly partito 23:16 con il supervisore corretto.

- **9/09 23:45 — commit 0b75254 (app main): fail-fast, ammissione a freddo, grazia in background.** Da dati S23 di
  stasera: `stallWatchdog.ts` (gap 10 s o <0,5 tok/s dopo 30 s, armato al primo token, reset per round),
  `prefillDeadline.ts` (5× tempo EMA, floor 90 s, senza EMA non sorveglia; stima = max(chars/4, ultimo prompt reale)),
  `admissionModel.ts` (il gate misura il modello che verrà caricato, anche a freddo), background: salvataggio subito
  come prima, `disposeEngine` dopo 45 s di grazia (annullata al rientro, saltata con gen più nuova o turno vivo,
  immediata sotto pressione). Due audit GLM per parte, report in `product-suite/*2026-09-09.md`. APK CI run
  34434394330 (arm64 debuggable) per domani: S23 carico → riproduzione con memoria campionata; Jelly → ciclo
  "background breve" senza prewarm al rientro. Jelly MiniCPM5 C01 ok 621 s (23:41); v2e 1024 completa, libera in corso.

- **10/09 00:05 — v2e giudicata: per LFM 1024 > 256, modesto ma concorde.** GLM 17-11 (32 pari), Luna 22-14 (24 pari),
  medie 3,77/3,57 e 3,68/3,45; libero ≈ 1024 (16-12, 21-13). Deterministico 36 vs 34/44. Costo p90 780 vs 600 token
  di ragionamento per riga (~+60 s sul Jelly, ~+20 s sull'S23). Decisione all'owner in PLAN "Aperti" con proposta
  (LFM 1024 da S23 in su, 512 sul Jelly). Giudici GLM+Luna perché deepseek/mimo fuori quota. Jelly MiniCPM5 3/24 alle
  23:59 (C03 786 s, stato termico 3), fine stimata ~04:00.

- **10/09 05:25 — Jelly SCORE (G1 sweep 24×2, APK 4b29466, USB 100 %, 37-39 °C, stato termico 0-3).** Deterministico:
  LFM 19 pass / 2 fail / 1 error, MiniCPM5 16 / 5 / 1; 2 righe a rubrica per modello (giudizio cieco da fare con
  S23/Xiaomi). **Tool offline: LFM 2/2 (device_calc, write_note), MiniCPM5 0/2** (nessuna chiamata richiesta né
  eseguita). Velocità sul Jelly (mediane su 24): decode LFM 3,4 tok/s vs MiniCPM5 2,3; promptMs 6,2 s vs 13,0 s.
  M02 `send_failed` per entrambi = smontaggio del motore in background (fix 0b75254, da verificare). Fallimenti
  deterministici: LFM C02, I06; MiniCPM5 I05, I06, I07 (JSON non valido), T09, T11. `device/jelly/SCORE.md`,
  `RUN-STATE.md`. Xiaomi: solo LFM 24/24 (score al braccio MiniCPM5). S23: LFM 24 ok, MiniCPM5 da rifare.

- **10/09 08:15 — budget di thinking deciso e committato (acade04).** Owner 07:40: "alto per S23, basso per il
  MediaTek". Implementato senza rami per telefono: `decodeSpeed.ts` (EMA per modello, ≥16 token, turni interrotti
  esclusi), `thinkingBudgets.ts` sceglie `extended` (LFM 1024) con decode misurato ≥ 5 tok/s, altrimenti `short`
  (512), prima misura → short; registro LFM e dev-MiniCPM5 512/1024; `KALSA_THINKING {budget, decodeTokPerSec}`
  per turno. Audit GLM pulito. APK CI in build. Jelly: cicli di vita su 0b75254 in corso (Luna 0235aac7); S23:
  braccio MiniCPM5 15/24 alle 08:00; proposta all'owner: G1 chiuso oggi per LFM e tre stream paralleli sui telefoni.

- **10/09 08:15 — G1 CHIUSO dall'owner: LFM2.5-2.6B è il modello principale** (5 giorni prima del 15/09, "stiamo
  andando troppo lenti"). Evidenza in PLAN "Decisioni prese" 10/09. Conseguenze: braccio MiniCPM5 sullo Xiaomi
  annullato; braccio S23 fermato a 16/24 (score parziale in `s23/SCORE.md`); i telefoni passano a tre stream
  distinti: Jelly cicli di vita (0b75254, in corso), S23 riproduzione bug memoria/batteria con l'APK 899e76b
  (budget 512/1024 per velocità, watchdog, grazia), Xiaomi Gallery + memoria HyperOS quando sbloccato. Fine tuning
  MiniCPM5 resta opzione post-M1.

- **10/09 ~14:15 — S23 SCORE FINALE (commit `43aeb46c`).** `device/s23/SCORE.md`, 41 righe dedup per id (ultima `ok`):
  **LFM 24/24 senza errori** (22 pass + 2 rubrica; tool 2/2, memoria 4/4), decode mediana 10,7 tok/s (max 11,8),
  promptMs mediana 1,5 s (max 5,0); **MiniCPM5 15/24 ok + 2 `reply_timeout` (I01, I06)**, 7 casi non eseguiti
  (I14, M01-M04, T09, T11), decode 6,1 tok/s (max 6,9), promptMs 5,4 s (max 21,3). Il braccio MiniCPM5 notturno
  era col telefono in carica: MemAvailable 2,2-2,4 GB e SwapFree 1,8-2,0 GB su 4 GB durante I01-I12, cioè
  ~2 GB di swap già occupati a riposo (tabella in `s23/RUN-STATE.md`). Nessun runner residuo, app force-stopped,
  pref LFM ripristinata. Risultato coerente col G1 chiuso: sull'S23 LFM è più veloce (percorso Q4_0) e non ha
  fallito un caso. Prossimo passo S23: riproduzione del bug memoria/batteria con l'APK 899e76b (CI in corso).

- **10/09 ~14:40 — CICLI DI VITA JELLY SU 0b75254: 7 PASS, 2 FAIL (smontaggio a 45 s), 2 SKIP** (Luna 0235aac7,
  report `product-suite/JELLY-LIFECYCLE-0b75254-2026-09-10.md` + cartella evidenze). PASS: baseline freddo
  (promptMs 17,3 s, 6,7 tok/s, nessuno stallo, fit a caldo `availableMb=3829`), background breve 15 s (nessun
  unload/init/prewarm, secondo invio promptMs 4,7 s poi 2,0 s: il bug M02 dello share è chiuso), kill del processo
  (storia conservata, `load ok tokens=2508`), back/riapertura (stesso PID, grazia annullata), stop generazione
  (parziale tenuto, invio successivo ok, nessuno stallo), background breve ripetuto. FAIL ×2: 70 s in HOME → nessun
  `model.unload`, al rientro `background.grace {"cancelled":true}`. **Causa trovata su disco:** i timer JS di
  RN Android sono guidati dal Choreographer e si fermano ad activity in pausa
  (`JavaTimerManager.kt:72-74 onHostPause → clearFrameCallback`): il `setTimeout` da 45 s non può scattare in
  background, mai. Il percorso di ammissione `no_active_model` a freddo resta quindi non esercitato sul Jelly.
  SKIP: rigenera/modifica (nessun nodo UI accessibile via dump, solo `Altro`: da fare a mano). Fix in corso: modulo
  Expo locale `modules/kalsa-lifecycle` (Handler sul main looper per il timer + inoltro di `onTrimMemory`), grazia
  generica sull'handle; cablaggio AppShell dopo il commit dell'estrazione memoria (Luna 54bc9812).

- **10/09 ~15:20 — ESTRAZIONE MEMORIA CORRETTA SU MAIN (`e455afc`).** Recon GLM (`MEMORY-EXTRACT-RECON`): dopo ogni
  turno l'estrazione girava con thinking off, n_predict 256, timeout fisso 20 s, e l'invio successivo la aspettava
  (`await memoryExtractRef`); sul Jelly scadeva sempre a 20 s senza un fatto. Fix (Luna d1552823): timeout =
  prefill + decode stimati dalle EMA misurate, clamp 20-120 s, EMA assente/non finita → 20 s (`extractBudget.ts`);
  un nuovo invio abortisce l'estrazione in coda o in corso (ferma la completion nativa) e non la aspetta più; il
  restore del checkpoint KV gira sempre; n_predict 192 (caso peggiore del parser: 3 add × 120 char + 10 remove);
  `KALSA_MEMORY_EXTRACT {durationMs, timeoutMs, stopReason, extractParseOutcome}`. Audit GLM ostile
  (`MEMORY-EXTRACT-AUDIT-2026-09-10.md`): race confutate, due blocchi (guardia NaN, 128 token troncavano il JSON)
  corretti e ri-auditati → SHIP. Resta aperto (pre-esistente): stop/clearChat non annullano un'estrazione in corso.
  Verifica sul Jelly con il prossimo APK: attesi `stopReason:"done"` con fatti e `aborted_by_send` sugli invii ravvicinati.

- **10/09 ~15:50 — GRAZIA DI SMONTAGGIO RESA NATIVA (`3ca6145` su main).** Modulo Expo locale `modules/kalsa-lifecycle`
  (Kotlin 118 righe, come `kalsa-thermal`): timer su Handler del main looper (`backgroundTimerDidFire`) e inoltro di
  `ComponentCallbacks2.onTrimMemory` (`trimMemory {level}`), registrato solo quando JS ascolta. AppShell inietta lo
  scheduler nativo nella grazia (`src/app/backgroundTimer.ts`, fallback JS se il modulo manca, log una tantum
  `background.grace {"timer":"native"|"js"}`); trim ≥ 40 in background con grazia pendente → smontaggio immediato
  (`background.grace {"cancelled":true,"reason":"trim","level":N}` poi `model.unload {"reason":"trim","level":N}`).
  Audit GLM (`LIFECYCLE-MODULE-AUDIT-2026-09-10.md`): consegna eventi ad activity in pausa CONFERMATA nei sorgenti
  expo-modules-core (nessun gate sui listener, emit accodato sul thread JS; non copre Doze); due blocchi corretti
  (registrazione in OnStartObserving, no memoizzazione del null) → SHIP parte 1 e parte 2. Non ancora provato su
  telefono: APK CI 34478649461 (3ca6145, arm64 debuggable) in build; contiene anche l'estrazione `e455afc`.
  Verifica Jelly: ciclo lungo 70 s deve mostrare `timer:"native"` e `model.unload {"reason":"background"}` a ~45 s,
  poi riapertura con `.kvs` caldo e gate a freddo `no_active_model` con `availableMb`.

- **10/09 ~16:40 — VERIFICA JELLY SU 3ca6145 FALLITA ALL'AVVIO: modulo nativo NON collegato** (`background.grace
  {"timer":"js"}`, report `JELLY-LIFECYCLE-3ca6145-2026-09-10.md`, resto SKIP per condizione di stop). Causa, mia:
  `.gitignore` riga 42 (`android/`) ha escluso `modules/kalsa-lifecycle/android/` dal commit; `3ca6145` conteneva solo
  config, package e TS, autolinking non ha trovato nulla (log CI: solo `kalsa-thermal`). Avevo verificato i file su
  disco e non quelli nel commit. Fix `1e02fe3` (eccezione `!modules/*/android/**` + add forzato), più `e89bd2a`
  (testID `message-action-{more,copy,edit}` sul menu messaggi, RN-rendered; "rigenera" non esiste nella UI di
  questo checkout). APK CI 34483949398 in build; il Jelly ripete la stessa verifica appena pronto. L'S23 sta
  riproducendo il bug batteria su 3ca6145: valido, perché contiene tutti i fix tranne il timer nativo.

- **10/09 ~17:10 — IDENTITÀ DELLA SESSIONE LEGATA AL FILE E AL MOTORE (`e2e09f5` su main).** Recon GLM
  (`SESSION-IDENTITY-RECON-2026-09-10.md`): il `.kvs` era già legato a modello, conversazione, hash dell'ambiente
  prompt, storia, nCtx e tipi cache, con rifiuti nominati `meta_mismatch:<campo>`; i fatti memoria vanno in coda
  all'ultimo messaggio utente (`MEMORY_FACTS_ON_USER_TAIL`) e non entrano nell'hash, quindi l'estrazione non fa
  ripartire la sessione da freddo; il restore passa da `llama_state_save_file`/`load_file` (stato ricorrente LFM
  incluso) con doppia guardia sul caso upstream #25913. Buchi chiusi ora: `modelFileId` (size:mtime del GGUF
  caricato + sha dichiarato se presente) e `engineBuild` (impronta di `systemInfo`, contiene il marker
  `kalsa-native-patches`) nel meta, `formatVersion` 1→2, salvataggio saltato con `session_identity_unavailable`
  quando l'identità è ignota (l'identità vuota non arriva mai su disco); `KALSA_PREFIX` logga il cambio di
  ambiente prompt fra i turni coi campi che differiscono; `tokensOnDisk` nella riga di load. 20 test, tsc pulito.
  **Non ancora auditato in modo ostile né provato su telefono** (fermata la giornata su richiesta dell'owner).

- **10/09 ~17:30 — S23, RIPRODUZIONE DEL BUG BATTERIA SU 3ca6145: PARZIALE, NON RIPRODOTTO CON LFM**
  (report `S23-BATTERY-REPRO-3ca6145-2026-09-10.md`, evidenze `evidence-final2/`). Telefono scollegato, 89 %,
  35,4 °C, thermal 0; 5 domande (C02-C06) via `kalsa://share` con 60 s di idle. Risultato: **89 → 86 %, cioè
  −0,6 punti per domanda contro −4,8 del 9/09**; picco 39,0 °C, thermal sempre 1; decode 11,0-13,1 tok/s contro
  0,06; nessun `KALSA_STALL`, nessuna scadenza di prefill, nessun `model.unload`, nessun `turnInterrupted`.
  `KALSA_THINKING`: turno 1 budget 512 con EMA nulla, turni 2-5 budget 1024 con EMA 11,3-12,3 — la regola di
  velocità funziona come deciso. Fit `allow:true, alreadyResident:true`, `availableMb` 2088-2259.
  **ATTENZIONE, non è un confronto alla pari:** il 9/09 il crollo era con **MiniCPM5 Q4_K_M**, qui gira **LFM**,
  il modello spedito. Quindi questo prova che LFM sull'APK corretto è sano sull'S23, non che i fix curino la
  patologia di MiniCPM5 (modello parcheggiato: non si rifà). Due cose restano aperte: il warning
  `failed to mlock 223 MB: Out of memory` compare ancora al caricamento a freddo (cosmetico, RLIMIT 64 MB), e
  il prewarm a freddo è costato 38,6 s per 1832 token. **La correzione dell'estrazione memoria NON è stata
  esercitata**: tutti e cinque i turni hanno loggato `KALSA_MEMORY_EXTRACT {memoryEnabled:0, stopReason:
  "skipped_no_snapshot"}`, cioè la memoria è spenta su quell'installazione. Va riprovata col Jelly a memoria accesa.

- **10/09 current-state update — G1 is closed; LFM is the main model and M1 remains 9 October.** The S23 result stays
  **PARTIAL** and is not a paired cure claim: 9/09 was MiniCPM5 Q4_K_M, 10/09 was LFM; C02's final retry
  false-settled, C03-C06 are the four valid answers, and memory extraction was disabled. Lifecycle sources missing
  from 3ca6145 are fixed in `1e02fe3`; APK CI `e89bd2a`, run `34483949398`, installed on the Jelly today with
  `Success`. Luna0235 verification is in progress and is **not PASS**. `e2e09f5` is in hostile audit by Reviewer
  Doc MiMo with a new profile because the old GLM profile is unavailable; no identity APK exists. Do not promote
  either result until the Jelly verification and audit are complete.

- **10/09 verified follow-up — Jelly lifecycle and session identity.** On APK CI `e89bd2a` / run `34483949398`,
  SHA `a2d08f9df19d179d86d55db1e0407bd4ec77ec9e6d2edb0954083487c27ea5fb`, the native lifecycle gate is **PASS**:
  `HOME 10:34:18.945 save` → `unload 10:35:04.621` (~45.7 s), reopen fit `no_active_model availableMb=5789`,
  `load ok 3628 tokens/62 ms`, `prewarm skip kv_holds_chat`, continuation `promptMs=1489.054`. The short check is
  **PASS with limits** (missing shell HOME/reopen markers); no blanket lifecycle PASS. Stop SKIP, Edit SKIP,
  Regenerate absent. Memory `e455afc` is BLOCKED (`memoryEnabled:0`, no done/aborted proof). Identity `e2e09f5`
  is BLOCKED by static `engineBuild=kalsa-native-patches:app:1`; DeepSeek `98c66` remains working-tree only and
  MiMo `42a` is re-auditing. New identity tests are 16/16; no new APK exists. No other device test was run.

- **10/09 final identity update.** The e2e09f5 app fix is now local commit
  `095466ec5c88a8cf4588b898b00cce632b1c1508` on `main` (ahead 1, not pushed); all eight fix files, including the
  three new files, are included. MiMo re-audit is **SHIP by code-review approval**; the updated re-audit report
  explicitly records that CI/APK execution was not performed. No new APK exists. Jelly remains native/long-gate
  PASS with the stated limits, memory extraction BLOCKED, and Stop/Edit SKIP.

- **10/09 latest verified session/memory update.** App commit `095466ec5c88a8cf4588b898b00cce632b1c1508` and
  experiments commit `76ac60e1` are pushed. APK CI `34494832409` and E2E emulator `34494789017` are **SUCCESS** on
  the exact app head; an independent calculation from the committed inputs matches the embedded
  `engineBuildId` `kalsa-eng-v1:source:765509c292652441bd8bc8a3ebbad51c51657a4127cd545b47488800f9433a65` exactly.
  The separate Jelly session/memory result is **PASS scoped**: meta v2, load `4517` tokens, prewarm skip, facts
  `1/1` and `2/2`, and `aborted_by_send` after `8688 ms` with facts `0` and restore `5022`. The native/long
  lifecycle result remains PASS under its separate `e89bd2a` provenance; the brief slice is PASS with limits. Stop
  partial preservation and Edit save remain unverified. The concrete open gap is `abortRef=null` after send while
  `onAbortRelease` reaches only `saveGate`; recon correction and Skilled98c66 are in progress. No blanket G2 PASS.

- **10/09 evening — Stop partial preservation PASS scoped on Jelly.** Same installed `095466e` APK
  (`224fb7d1…346a`), no new build. After waiting for a *new* streaming assistant in SQLite (uiautomator dump
  blocks until idle and cannot see mid-stream text), Stop at composer `426,805` left assistant `a-8080264`
  at 285 chars, `interrupted:true`, UI `Generazione interrotta.`, session save `messageCount:5`,
  `extractStopReason:4`. The kept text is English chain-of-thought, not the Italian `Il mare è vasto`
  answer. Two earlier shots were harness misses (dump idle-wait; tapping the previous assistant during
  think). Edit save and Regenerate still open. Report:
  `scratchpad/agents/product-suite/STOP-PARTIAL-JELLY-EVIDENCE-2026-09-10.md`. Experiments commit `3ecd1c55`
  records the evidence (local, not pushed). Automatic E2E `34528014849` on app `1edf5c6` is **SUCCESS**;
  `34526920272` on `f99fe45` was **cancelled**. Next open M1 items: Edit save, Regenera.

- **10/09 evening — Edit→Salva PASS scoped on Jelly.** Same `095466e` APK. Nuova chat, share-send
  `Dimmi solo la parola: ciao.`, Stop during think, Altro→Modifica→Salva **without typing**.
  `edited:true` persisted; `KALSA_SESSION save messageCount:2`; completed assistant `ciao`.
  Explorer's "Bluetooth keyboard required" is REFUTED. Report:
  `scratchpad/agents/product-suite/EDIT-SAVE-JELLY-EVIDENCE-2026-09-10.md`. Regenera UI is in the
  working tree (`regenTarget.ts` + sheet row) under MiMo hostile audit; not in the APK.

- **10/09 evening — Regenera UI SHIP by code review.** Assistant Altro row `testID=message-action-regen`
  calls existing `editMessage` with `{ edited: false }` so the user bubble is not badged as edited.
  Helper `editedFlagForResend` default true keeps Modifica→Salva. MiMo first audit SHIP-WITH-FIXES
  (false edited badge); re-audit **SHIP** after the flag. Orchestrator verified file:line, tsc 0,
  Jest 10/10. Pushed as `c370c98`; device shot waits on APK `34539915778` of descendant `1807aad`.
  Reports: `REGEN-UI-FIX-2026-09-10.md`, `REGEN-UI-AUDIT-2026-09-10.md`.

- **10/09 evening — model-switch after stop SHIP by code review.** `selectModel` dispose is
  `runNativeOpBounded` 5s (`1807aad`); drain waits `sendClaimRef || sendingInFlightRef`; extract
  timer cleared. Timeout copy tells the user to retry, not restart. MiMo SHIP-WITH-FIXES then
  re-audit **SHIP**. Reports: `MODEL-SWITCH-STOP-RECON/FIX/AUDIT-2026-09-10.md`.

- **10/09 evening — one APK, not two.** `1807aad` already contains Regenera. APK `34538930575`
  (`c370c98`) cancelled as redundant. Live CI APK is `34539915778` on `1807aad` (`apk.yml`
  arm64-v8a debuggable). Two sequential Jelly shots on that install: Regenera, then model-switch.

- **10/09 evening — Altro Copy invert + decode EMA 3-sample withhold SHIP.** Sheet Copy was
  `!text.trim()` (unreachable for normal messages); now `sheetCopyVisible`. Jelly `KALSA_THINKING
  budget:1024` after one short turn: EMA published only after 3 accepted samples so first measure
  stays short (owner). In-memory Map, restart resets. MiMo SHIP-WITH-FIXES (comments only) then
  re-audit **SHIP**. App `c906727`. Not in the live `1807aad` APK; do not cut a third build until
  Regenera and model-switch shots finish. Reports: `THINK-COPY-RECON/FIX/AUDIT-2026-09-10.md`.

- **10/09 evening — LFM Open License v1.0 read (not a decision).** §5 Commercial Use is licensed
  below USD 10M annual revenue; above that it is not licensed. MiniCPM5 Apache remains the 12/10
  fallback. Source: `https://huggingface.co/LiquidAI/LFM2.5-2.6B/raw/main/LICENSE`. No MiniCPM5
  cells.

- **10/09 evening — APK `34539915778` SUCCESS; Regenera and model-switch PASS scoped on Jelly.**
  SHA-256 `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` local==installed.
  Regenera: sheet row present, `regen:true`, user not re-badged edited, assistant `ciao`,
  `budget:512` (EMA null after install). Model-switch: Settings → Qwen Seleziona, LFM
  `detach_threadpool` in 2 s, header `Qwen 3.5 4B · Tocca per ricaricare`, not checking.
  Hung-FIFO timeout not exercised (chain empty). Pref restored to LFM. Reports:
  `REGEN-JELLY-EVIDENCE-2026-09-10.md`, `MODEL-SWITCH-JELLY-EVIDENCE-2026-09-10.md`.

- **10/09 night — same `1807aad` APK on S23; extract-cancel shot delegated, not claimed.** SHA-256
  `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` local==installed,
  `lastUpdateTime` 2026-09-10 20:01:55. `memoryEnabled` was 0 after the battery repro; set to 1
  via force-stop + sql_write, then launch. `f99fe45` is an ancestor of `1807aad`, so this APK
  contains the extract-cancel wiring; that is still **no device claim**. Skilled Coder
  `grok/grok-4.6` agent `798d29e6` owns S23 `192.168.1.152:5555` for Nuova-chat-during-extract.
  Parent does not adb that serial while the agent runs. Xiaomi `192.168.1.193` untouched.

- **10/09 night — Copy/EMA APK `34544351697` cut on `c906727` after the two Jelly shots.**
  `apk.yml` arm64-v8a debuggable, gradle `Build APK` in_progress since `2026-09-10T23:59:45Z`.
  Install target is Jelly only (`install -r`); S23 stays on `1807aad` until extract-cancel
  finishes. Duplicate `gh run watch` on the same run was killed; one watcher remains. Do not
  cut another APK until Copy lands. G2 is not claimed.

- **10/09 night — Copy sheet PASS scoped on Jelly APK `34544351697` / `c906727`.** SHA-256
  `1a47fff2c5f75dd2c8929cb75ec3e06b9d68f0124642987167c54c13154f4298` local==installed,
  `lastUpdateTime` 2026-09-10 20:32:37. Altro sheet listed Copia (`[19,462][461,536]`) plus
  Salva nelle note, Traduci, Rigenera, Annulla. Oneshot `has_copy` and `sheet` true. Decode-EMA
  3-sample withhold is in this APK and was not device-measured. App force-stopped after the
  shot. Report: `COPY-SHEET-JELLY-EVIDENCE-2026-09-10.md`. G2 is not claimed.

- **11/09 00:42 — extract-cancel PASS scoped on S23 APK `1807aad`.** Hash match `9c03c710…3693`,
  no reinstall. `KALSA_MEMORY` `20:42:34.732` `memoryEnabled:1` → Nuova chat tap `00:42:35Z`
  `984,285` → `KALSA_MEMORY_EXTRACT` `20:42:39.024` `stopReason:"aborted_by_send"`
  `extractGateSource:1` `extractStopReason:0` `durationMs:4222`. Native
  `util-extractMemory-2` `interrupted:true` `tokensPredicted:0` `promptMs=4110`. Not `done`,
  not VOID. Agent grok-4.6 `798d29e6`; parent verified the quoted lines on disk. Report:
  `S23-EXTRACT-CANCEL-1807aad-2026-09-10.md`. Jelly/Xiaomi untouched by that agent.

- **11/09 00:46 — decode-EMA withhold PASS scoped on Jelly APK `c906727`.** After force-stop,
  first send `ciao`: `KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null}` at
  `20:46:46.393` pid 14192. Turn completed `interrupted:false` `predictedPerSecond:6.48`
  (above the 5 tok/s extended threshold). EMA unpublished so this send stayed short. Report:
  `EMA-WITHHOLD-JELLY-EVIDENCE-2026-09-11.md`. G2 is not claimed.

- **11/09 01:10 — background-discard extract-cancel PASS scoped on S23.** HOME at
  `01:09:46Z` after `KALSA_MEMORY` `21:09:45.480` → EXTRACT `21:10:08.675`
  `stopReason:"aborted_by_send"` `extractGateSource:1` `extractStopReason:0`
  `durationMs:23123`. Native `util-extractMemory-2` `interrupted:true`
  `promptMs=23036`. Same `1807aad` hash, no reinstall. Parent verified quoted
  lines. Report: `S23-BG-EXTRACT-CANCEL-1807aad-2026-09-11.md`. f99fe45 Nuova
  chat + HOME are both PASS on S23; conversation-switch still unproven.

- **11/09 01:12 — Jelly session restore on `c906727` is no_file, not reuse.**
  `KALSA_SESSION load ok:false reason:no_file` at `21:12:55.866`. Active
  `conv-g1-m01` has MiniCPM5 `.kvs` from 03:44 and **no** LFM stem, even though
  the same process logged `save ok:true usedTokens:3305` at `21:07:53` (then
  extract timeout). Conversation-switch during extract on Jelly was a harness
  miss (`activeId` never left `conv-g1-m01`). Engine-change invalidation still
  has no second-APK proof (native identity inputs unchanged `095466e`→`c906727`).
  Recon of the vanished save is in flight (Explorer). G2 is not claimed.

- **11/09 01:25 — conversation-switch during extract is HARNESS_MISS on S23.**
  `activeId` stayed `conv-g1-i14-1789042691` after Menu/swipe+tap. EXTRACT `done`
  because the switch never landed, not because cancel failed. Path untested, not
  refuted. Report: `S23-SWITCH-EXTRACT-CANCEL-1807aad-2026-09-11.md`.

- **11/09 recon — session `no_file` after `save ok:true`.** Parent verified:
  load hash in `AppShell.tsx:3792` hardcodes `hasTools=true`; save hash in
  `LlamaService.ts:3118` uses `hasTools && toolCallingEnabled`. F6 said they
  must match. `no_file` means `staleDropped===0` (no kvs for that model+conv
  under any env hash). Save logs `ok:true` only after `.kvs` rename **and**
  after `evictSessionPool`. Explorer report:
  `SESSION-NO-FILE-RECON-2026-09-11.md`. Hash unify is on disk uncommitted.
  `computeSessionPromptEnvHash` lives in `src/engine/sessionPromptEnv.ts` (AppShell
  import). `sessionSaveOkAfterEvict` removed; save `evicted` is a direct
  `sessionFileExists` check. Parent Jest 18/18. App commit `2619db0` pushed.
  Re-audit SHIP-WITH-FIXES: `!MEMORY_FACTS_ON_USER_TAIL` branch kept (symmetric
  with save if the flag flips). Device restore on this APK not done. G2 not
  claimed.

- **11/09 — session load/save prompt-env hash unify SHIP (`2619db0`).** Load no
  longer hardcodes `hasTools=true`. Shared `promptEnvToolHashFields`. Save
  `reason:evicted` if keepStem missing after pool evict. `KALSA_SESSION` logs
  `stem`. Re-audit: leftover `!MEMORY_FACTS_ON_USER_TAIL` branch is dead while
  the flag is true; kept for save/load symmetry. Device restore of this commit
  not yet run. G2 not claimed.
