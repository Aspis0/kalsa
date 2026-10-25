# RECON - gpu-next: the next concrete GPU-numerics action

Read-only reconnaissance, 2026-09-23. One file written (this one). No builds, no git
writes, no adb, no sub-agents. Sources read in full or in the cited ranges:
`PLAN.md` 160-274, `quant-alignment/REPORT.md`, `cok-residual/REPORT.md`,
`cok-accumulator-audit/REPORT.md`, `s23-kld-740-q4-0/REPORT.md` 1531-2669 (the file was
being appended live during this recon: the K-split treatment result landed at 14:54 and
is folded in below), `samsung-rtl-recon/REPORT.md`, `qdc-8elite-opencl-e031/REPORT.md`,
plus engine reads at `/Users/marco/Projects/kalsallama-wt-cok` (branch
`kalsa-opencl-cok-korder`, HEAD `7965f43e0`, `git status --porcelain` = 0 lines) and
`git show 1577495b9` against the same files. All paths below are relative to
`~/Projects/kalsa-moe-experiments` unless absolute.

**Headline: the K-split residual ablation FAILED and stopped itself today
(0.006983, `s23-kld-740-q4-0/REPORT.md:2638-2640`), so the `_cok` checklist's only
remaining blocker before the pin chain is the owner's accept-"partial" decision. The
next GPU-numerics action off the phone is the weight-side fp16 ablation (R3): one
`ninja -j 3` build, host-side, fully parallel to whatever the phone does next.**

## 1. The two zero-build probes (`quant-alignment/REPORT.md` sec. 3)

**Z2 - the env-only q4_K dp4a forcing probe at b256: RUN, same day.** Read against its
falsifier (< +0.002, i.e. KLD < 0.007412, pre-registered at
`s23-kld-740-q4-0/REPORT.md:1541-1547`):

> `| **RESULT** | **Median KLD 5.103422, same top 12.373 +/- 0.781 %, PPL(Q) 2556.19** (Delta = **+5.098**), rc=0, 1.12 min, bracket AC-false level 74 |`

(`:1594`; verdict `:1595`: "The falsifier did NOT happen - the hypothesis survives its
pre-registered kill line by three orders of magnitude".) The overshoot was later
attributed and closed: the sa-twin read 2.669362 / 30.259 % (`:1735-1736`), and the §32
matrix verdict names the mechanism - `e64352ac1` changed the UNSET q4_K-site default, so
the cross-binary matrix is VOID as designed, while "the forced q4_K path is safe by
DEFAULT on `e64352ac1` (0.005454-0.005615, ship-default neighbourhood)"
(`:1857`). Cost was 1.12 min (`:1581`).

**Z1 - the instrumented `-b 1` enqueue counters: NOT RUN, no result recorded
anywhere.** `quant-alignment/REPORT.md:18` still lists it as unverifiable "see Z1 for
the one run that turns this into data", and the definition at `:126-131` stands with no
result section in any REPORT: run the existing instrumented binary (atomic enqueue
counters, `s23-kld-740-q4-0/REPORT.md:804-807`, build `c6b45aaa4`, "EXPERIMENTAL, never
to land"), at `-b 1`; prediction `quant_a=0, dp4a=0, f32=all`; if
`kernel_quant_a_q8_1` enqueues > 0 at ne1==1 the section-0 refutation collapses. It
needs: the instrumented binary pushed to a phone (or reused if still in
`/data/local/tmp`), one ~1-4 min arm (`:247` prices it "0 build beyond what exists").
This is phone work; it queues behind the current phone state, it is not host-side.

## 2. The weight-side fp16 lead in the K-quant kernels

Verified by direct read at `7965f43e0` (clean worktree) AND by `git show 1577495b9` -
identical lines on both:

- `gemm_noshuffle_q4_k_f32.cl:63`: `half4 dequantized_weights;` - the f32 GEMM
  dequantises every weight to half before the float product (products at `:100-103`
  class; scale/minimum loads themselves are `half4` at `:74-75`). Same declaration:
  `gemm_noshuffle_q6_k_f32.cl:43` (with `convert_half(...)` rounding the dequantised
  value at `:65-66`; the residual report's `:47` is the same line at the older ref,
  `residual-after-q6k-route/REPORT.md:214`) and `gemm_noshuffle_q5_k_f32.cl:57`.
- The GEMV half sub-scale: `gemv_noshuffle_q4_k_f32.cl:284-285`:
  `regS = convert_half2(convert_float2(d) * convert_float2((uchar2)(sv0, sv1)));` -
  the `d*sv` product is computed in float then rounded to half on store (`regS/regM`
  declared `half2` at `:264-265`); the same line repeats in the macro variant at
  `:434-435` and third variant at `:545-546` (all three present on `1577495b9` too).

**Does a probe or ablation exist?** No, not for q4_K/q6_K anywhere. The only measured
weight-dequant ablation is q4_0 on the Adreno 750: `stock:deq` (float dequant) 0.004793
vs `stock:mul` 0.004736, i.e. no gain (`adreno-acc-type/REPORT.md:104-105`, summarised
as a bound caveat at `residual-after-q6k-route/REPORT.md:214`). The K-split failure
today (`:2638-2640`) removes the accumulation-order competitor and leaves the weight
side as the surviving batch-common candidate, exactly as `quant-alignment` ranked it
(`:180-193`, R3 at `:248`).

**Smallest env-gated ablation** (description only, per R3 `quant-alignment/REPORT.md:248`
and the `KALSA_GEMM_PREC` precedent at probe commit `7ef9389bc` on branch
`kalsa/gemm-acc-probe`, `gpu-numerics-fix-recon/REPORT.md:167`): one new define + one
env selector at the q4_K program build site (pattern of `KALSA_COK_ACC`,
`ggml-opencl.cpp:1587-1599`), flipping only: (a) `:63` `half4 dequantized_weights` ->
`float4` (with the `:74-75` scale loads promoted so the products stay float), and (b)
the GEMV `:284-285`/`:434-435`/`:545-546` stores kept float (`half2 regS/regM` ->
`float2`). q6_K `:43` as an optional second arm. Dispatch untouched, so the 76.4 t/s
dp4a default is preserved. Arms: b1 AND b256 (the only candidate that can move b1
without adding a quantiser). Pre-registered thresholds already on file (`:248`):
>= -0.0015 at BOTH shapes confirms the common weight-side term; < -0.0005 at both ->
drop it permanently. Cost: one Android arm64 build (`ninja -j 3`, ~3 min per
`cok-residual/REPORT.md:174`), cheap IR identity gates for the untouched arms, then
2-4 phone arms later.

## 3. The `_cok` shipping checklist (`PLAN.md:203-206`), status today

| step (PLAN.md:203-206) | status | evidence |
|---|---|---|
| app-shaped accuracy | **done - reads PARTIAL** | control 0.302991 in [0.28, 0.33] gate (`s23:2214`); treatment retry **0.012742**, PARTIAL by the literal line (<= 0.0065), **99.15 %** of the app-config gap (`:2268`) |
| tail-speed (app shape) | **done via set C** | §37b speed pair VOID twice on thermal (`:2308`, `:2359`); §37c b8 pair completed: control 8.88 s/pass vs treatment 8.78 s/pass = **1.93 % speedup**, "no meaningful cost" (`:2515`); b256 anchor 4.29 s/pass, PPL 24.9072 (`:2554`); derived 3,080-token effect -4.0 % (`:2593`) |
| decode check | **done** | §37b accuracy pair: control 0.006012 / 93.138 exact vs §17 (`:2410`); treatment bitwise identical, "the decode-zero prediction is confirmed" (`:2441`) |
| explicit decision on the partial threshold and the residual | **open - falls to the owner** | the residual question is now measured: K-split serial treatment **0.006983 = FAIL, "stop the pair (no third attempt)"** (`:2638-2640`) against the pre-registered rule (`cok-residual/REPORT.md:94-99`) |
| pins verified against exact reviewed SHA | open | not started; blocked on the decision |
| APK built and hashed from that chain | open | blocked on the decision |
| that APK installed | open | blocked on the decision |
| runtime arm + cache identity captured with a measured result | open | blocked on the decision |

**The owner's decision:** accept "partial" - treatment 0.012742 at app config (99.15 %
of the app gap; 0.006890 / 99.51 % in the f16-KV harness) with the +0.001478 residual
now *measured and unexplained-by-order* (K-split failed) - and let the pin chain move,
or hold the chain until the weight-side ablation explains the residual. Note §37b speed
staying VOID is cosmetic: set C measured the same pair at the same config to a verdict,
but saying so explicitly is part of the decision.

## 4. What runs in parallel with the phone queue (no phone)

- **Build the weight-side (R3) ablation binary now, host-side**: branch off
  `7965f43e0` or `1577495b9`, one Android arm64 configure+build, `ninja -j 3` exactly
  (load-check discipline per `cok-residual/REPORT.md:271-282`), plus `clang -emit-llvm`
  identity gates for the untouched arms - all local, zero phone contact. Write the
  pre-registration (predictions + falsifiers above) BEFORE the build, per house rule
  (`PLAN.md:254-255`).
- The native standing build + seven targets (`cok-residual/REPORT.md:231-268`) is a
  second heavy build: sequential after the Android one, never concurrent - one heavy
  build at a time, `ninja -j 3` cap.
- Z1 is NOT host-side (needs the instrumented binary on a phone). The QDC/RTL remote
  arms (below) are phone-free in the house sense (they are not *our* two phones) but
  need coordinator/owner go and session setup.

## 5. Remote second-Adreno arms (coordinator addendum)

**Was anything GPU-numeric already run on QDC?** Nothing KLD-shaped. The closest is the
E031 correctness cert on Adreno 830: `qdc-8elite-opencl-e031/REPORT.md:16-23`
"MUL_MAT: 925/925 executed tests passed... MUL_MAT_ID: 407/407", narrowed at `:36-40`
to the q2_K/q3_K MoE kernels, third GPU/compiler generation - a `test-backend-ops`
correctness cell, not a `llama-perplexity` KLD measurement (grep across
`scratchpad/agents/qdc-*/REPORT.md` for `median KLD|llama-perplexity|.kld`: no REPORT
hits, only build logs). Samsung RTL has recon only (`samsung-rtl-recon/REPORT.md:9`
verdict USABLE-WITH-LIMITS): native-ELF execution is unproven there and needs the
30-minute hello-ELF probe first (`:93-99`); 20 credits/day = 5 h, 30-min minimum
reservation (`:46-48`).

**Arms that would generalise the finding or catch a regression** (predictions must be
written per device before the session):

1. **The `_cok` tail pair at b8** (f16-KV config: control `KALSA_COK_ACC=fp16` vs
   treatment default, ref `cpu-q4km-b8.kld`): if the half-accumulator FTZ cliff is a
   family property, control reads ~0.30 and treatment ~0.0069; if control reads low,
   the cliff is 740/driver-specific and the fix is a no-op there - either result
   generalises. It also catches a regression: any future build that silently reverts
   the fix reads ~0.30 on this arm forever.
2. **The b256 KLD arm** (ship default, ref `cpu-q4km.kld`, expect ~0.0054): does the
   dp4a q6_K route and the ship-default residual band reproduce off-740.
3. **The b1 KLD arm** (ref `cpu-q4km-b1.kld`, expect ~0.0060): the batch-common
   residual the weight-side lead claims - R3's thresholds (`>= -0.0015` both shapes)
   become far stronger if confirmed on a second generation.

**Binaries and references each arm needs** (the on-device manifest is exactly
`s23-kld-740-q4-0/raw/run-scripts/kld-k-split-arm-device.sh:3-9`: binary, model,
corpus, reference, lib dir):

- Android arm64 `llama-perplexity`: ship-tip `1577495b9` build for arms 2-3; the
  `319b53937` build for the `_cok` pair (§37a's binary, `s23:1974`); optionally
  `6ff4124b...` for K-order confirmation. Embed check: `version: ... commit <sha>` at
  load, per `cok-residual/REPORT.md:182-194`.
- `LFM2.5-2.6B-Q4_K_M.gguf`, `corpus.txt` (md5 `1d037601...`, `s23:1535`),
  `lib/libomp.so`.
- References: `cpu-q4km.kld` (b256), `cpu-q4km-b8.kld` (b8 pair),
  `cpu-q4km-b1.kld` (b1); app-shaped variant needs `cpu-appkv-r2.kld` + `-fa on -ctk
  q8_0 -ctv q4_0`. Caveat to pre-register: these were generated on the S23 CPU at
  `-ngl 0` (`s23:354-360`, `:930`), and the app-KV reference reuse assumption is
  already flagged at `:1963-1968`; on a different SoC either regenerate the reference
  on-device (one CPU run per shape, ~1-3 min) or state the cross-CPU-identity
  assumption in the prediction block.

**Minimum QDC session lengths** (QDC bills the whole requested cap; measured walls:
b8 KLD arm 358-375 s (`:2642`, `:2601`), b1 KLD arm 925-965 s (`:2443`, `:2412`), b256
KLD arm 1.12-2.7 min (`:1581-1582`); plus one-time push of ~1.5 GB model + ~120 MB
binary over the tunnel, rate unmeasured):

- b8 `_cok` pair alone (2 arms, ~13 min compute): request a **30-min** cap.
- Full trio in one session (b8 pair + b256 + b1 pair, ~48 min compute + pushes):
  request a **90-min** cap; pushes happen once and serve all arms.
- Pair the arms control-first so a control-gate failure burns only the first minutes.
- Preferred first device: 8 Gen 3 QRD8650 (Adreno 750 - the one prior-art datapoint,
  the 750's E031.45 cert and q4_0 deq probe, exists there); 8 Elite QRD8750 (A830)
  second. RTL S23/S25 only after the ELF probe passes.
