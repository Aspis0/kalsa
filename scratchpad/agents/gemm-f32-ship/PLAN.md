# Cell `gemm-f32-ship` — the corrected Adreno kernel reaches the app

Opened 2026-09-07. First step of the governor phase.

## What is already banked (do not re-measure)

ALIVE 56/57/59, cells `adreno-precision-bisect` / `adreno-acc-type` / `adreno-operand-b`,
QRD8650 / Adreno 750:

- The Adreno OpenCL Q4_0 GEMM (prefill path, `ne1 > 1`) computes the **product** in
  half. That is the cause of the GPU/CPU divergence measured by KL-divergence.
- Fix = `float8` accumulators **and** `c0 += convert_float8(B) * (float)dq.sN`.
  Median KLD 0.4538 -> 0.004736, same-top 62.8% -> 94.8%, prefill cost **0.659x**.
- Refuted by measurement, not by argument: attention, `-cl-fast-relaxed-math`,
  the accumulator on its own, dequantisation precision, stored operand precision
  (`b=float` costs 0.509x and buys nothing — discarded).
- Decode is not exposed (batch-1 GEMV is already fp32) and stays on the CPU (ALIVE 58).

## THE TWO DEFECTS — do not conflate them

The app's gate at `src/engine/governorInputs.ts:16` reads

    V75: false, // Adreno 750 f16/bf16-batched MUL_MAT defect: S5 runs 3-5 deterministic divergence @token 14 (ALIVE 38/39/48)

It names ONE cause. There are two, and only one is fixed:

- **(A) the f16 multiply in `gemm_noshuffle_q4_0_f32.cl`** — common to every Adreno,
  measured by KLD on the 750 (ALIVE 56/57), **fixed on `kalsa/gemm-f32-mul`**.
- **(B) a 750-only driver/compiler defect** — `test-backend-ops` MUL_MAT 905/925 with
  all 20 FAILs in one family, `f16|bf16 x f32, m=128 n=1 k=1056 k_v=2112` batched
  (ALIVE 38). It does NOT reproduce on the 735 (ALIVE 39), so it is per-GPU, not per
  generation. **Untouched by this work.**

So flipping `V75: true` is NOT a consequence of the fix. It is a hypothesis that the
in-app divergence was (A) and not (B). Only the logit oracle can decide it.

## Topology verified on disk 2026-09-07

- App branch `feat/governor-in-app` pins `Aspis0/kalsallama`
  `kalsa/governor-v0.3-on-2f3b24dee` @ **3bec271fd** — the fork already carries the
  native tri-engine governor (v0.2/v0.3), a per-turn prefill route, thermal
  degradation to CPU prefill, and the `bench_force_gpu_prefill` lever.
- `main` of the app (and `feat/moe-stream`) still pins **a0cabca6b**, whose vendored
  kernel reads `half8 c0` at line 38 — the current shipped APK carries the infidel one.
- `gemm_noshuffle_q4_0_f32.cl` is **byte-identical** at a0cabca6b, 2f3b24dee and
  3bec271fd. So the one-file fix grafts onto the governor pin unchanged, and the A/B
  differs by one file and nothing else.
- `deviceTuning.ts:374` still returns `cpu-only` on both branches: whole-model
  offload stays off. The governor's GPU prefill is a separate, per-turn mechanism —
  it does not go through `n_gpu_layers`.

## Steps

1. **Ship branch**: one file, 17 code lines, no macros, no env vars.
   Cut on a worktree off a0cabca6b for convenience, then **cherry-picked onto a branch
   off 3bec271fd** (the governor pin lineage) — the file being identical, the graft is
   exact. The env-var machinery stays on `kalsa/gemm-acc-probe` (@eefa27e30, pushed),
   which remains the measurement instrument.
   Gate: preprocessor equivalence against the measured `KALSA_GEMM_PREC=2` variant.
2. Bump the pin on `feat/governor-in-app` + re-vendor via `scripts/sync-kalsallama.sh`.
3. APK from CI (`apk.yml`, workflow_dispatch, ~35-45 min). Never a local Android build.
4. **The decisive measurement — logit oracle on a 750, PREREG first.** Re-run the S5
   protocol (ALIVE 55) with the fixed kernel on QRD8650 and read the verdict:
   - oracle PASS -> the in-app divergence was (A). Then, and only then, V75 may flip,
     and the speed question below becomes live.
   - oracle still FAIL -> (B) is the operative cause on the 750; the fix is still
     correct but does not unlock V75, and the 735/732/830 become the interesting
     boards because they do not carry (B).

## The prediction step 4 must falsify (secondary, only if the oracle passes)

The GPU prefill advantages recorded in-app were measured with the **infidel** kernel:
750 **1.78x** on the very pair that failed the oracle (ALIVE 55: 4.105 s vs 7.294 s),
735 1.72x, 732 1.63x. If the 0.659x cost transfers, they become ~1.16x / 1.13x / 1.07x
— near parity. If that holds, on V73/V75-class parts the GPU earns its place for
**thermals and for freeing the CPU**, not for speed, and the governor's policy changes
accordingly. A prediction to falsify, not a banked number.

## Traps to respect in step 4

- `LlamaService.ts:1438` retries at `n_gpu_layers = 0` after an init failure and logs
  `KALSA_GPU_FALLBACK`; the governor path has its own CPU degradation
  (`admit_prefill ... waiting for a safe tabled chunk` -> CPU). Either can publish a
  CPU number under a GPU label — check the route facts in the log, every turn.
- Thermal: on the 750 only the FIRST pair of a session fits under the 900 s cooldown
  ceiling (ALIVE 55). Budget one pair per session, or plan the cooldown explicitly.
- Two comments (`LlamaService.ts:1296`, `:1437`) claim "production now offloads on
  Android too (deviceTuning -> gpu-opencl)". They contradict line 374. Stale.

## Pre-registered reading of the oracle — fix this BEFORE the run

The oracle's binary verdict is the wrong instrument for this question, and reading it
naively would bank a false headline.

- The ALIVE 55 protocol forces **32 steps** and calls FAIL if the raw top-1 differs at
  any one of them. After the fix, same-top on the 750 is **94.8%**, not 100%. Expected
  flips over 32 independent-ish positions: **~1.7**. So a strict `oracle=FAIL` is the
  *likely* outcome even if the fix works exactly as measured, and it means nothing on
  its own.
- What must be read instead are the continuous metrics, whose pre-fix values are known
  from the very same board and protocol (ALIVE 55):
  - median |dp1| **0.0861** -> expect a collapse toward the CPU-vs-CPU floor (0.0000);
  - median max|dlogp| **3.444** -> expect a collapse;
  - steps beyond 0.02: **21/32** -> expect single digits;
  - top-1 flips where the CPU is confident: **8/32** -> expect 0-2.
- The CPU-vs-CPU control is already banked as an instrument check: 936/936 steps
  identical bit for bit, `max_dlogp = 0.0000`. Re-run it, it is free.

Decision rule, registered now: the fix is judged on the continuous metrics collapsing
to near the fp32 reference, NOT on the binary verdict. A flip count of 0-2 with the
medians collapsed = the in-app divergence was (A). Medians unchanged = (B) dominates
on the 750, and the interesting boards become 735/732/830, which do not carry (B).

## Competing readings of the existing evidence, stated before the run

Two facts pull in opposite directions and the run must arbitrate them:

- *Toward (B)*: on the 830 the oracle PASSED 4/4 with the SAME infidel kernel and the
  same ~15-token prefill chunk ("2+13"), while three different 750 boards failed
  deterministically at token 14. `use_adreno_kernels`
  (`ggml-opencl.cpp:7190` @3bec271fd) gates on the weight tensor's ne0/ne1 and the
  compiler version, not on the GPU model, so a 2.6B's matrices take the same
  `kernel_gemm_noshuffle_q4_0_f32` on both parts.
- *Toward (A)*: on the 750 the KLD went 0.4538 -> 0.004736 purely by changing the
  multiply's precision. If (B) dominated the numerical error on that board, changing
  the multiply could not have removed ~99% of it.

Both can be true at once: (A) dominates the bulk numerical error, (B) adds a 750-only
term. That is precisely why the verdict must come from the continuous metrics.

## Coverage gap found while shipping (verified 2026-09-07)

The fix covers ONE kernel. Nine sibling kernels in the same directory still declare
`half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;` and therefore still multiply in half:

    gemm_noshuffle_iq4_nl_f32.cl:55   gemm_noshuffle_q1_0_f32.cl:32
    gemm_noshuffle_q4_k_f32.cl:54     gemm_noshuffle_q5_0_f32.cl:32
    gemm_noshuffle_q4_1_f32.cl:35     gemm_noshuffle_q5_1_f32.cl:33
    gemm_noshuffle_q6_k_f32.cl:37     gemm_noshuffle_q8_0_f32.cl:35
    gemm_noshuffle_q5_k_f32.cl:55

That is a live shipping gap, not an academic one. The app catalog
(`src/engine/ModelRegistry.ts`) holds:

- `lfm2.5-2.6b`, quant `QAD-Q4_0` (:219) — the shipping model, **covered by the fix**;
- `qwen3.5-4b`, quant `Q4_K_M` (:179) — **not covered**: its prefill GEMM is
  `gemm_noshuffle_q4_k_f32.cl`, still infidel;
- `multilingual-e5-small` Q8_0 (:300) and `whisper-tiny` f16 (:263) — embeddings and
  ASR, loaded at `n_gpu_layers: 0` (`EmbeddingService.ts:443`, `:638`), so off the path.

So turning the governor's GPU prefill on while only q4_0 is fixed would ship a
known-infidel path for a catalogue model. The mechanism is identical (half product
accumulated over K), so the same edit transfers directly; what does NOT transfer is the
measurement — neither the fidelity gain nor the 0.659x cost is known for q4_k.

Decision taken: extend the same edit to `gemm_noshuffle_q4_k_f32.cl` and leave the other
eight alone (no catalogue model reaches them; KEXP's Q5_K/Q6_K trunk is out since the
2.6B shipping decision). The q4_k arm joins the KLD/speed cell as a separate reading —
it is NOT covered by the banked 0.659x.
