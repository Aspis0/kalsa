# Governor v0 — step 8 device smoke (QDC Snapdragon 8 Elite)

**NOT a bankable cell.** No prereg, no ABBA, r=2, one session, thermals not controlled.
This is an engineering smoke: does the governor RUN on real silicon, and do the assertions
that are vacuous on CPU-only survive a real backend? Any performance claim below must be
re-measured under a prereg before it is cited anywhere.

- Date: 2026-08-29 ~06:00 EDT. Session `governor-v0-step8-smoke` (id 788164), SSH-only,
  60 min cap, host sa792233, device `87b3a4aa` = QRD8750 "Sun for arm64" (SM8750),
  Android 16, GPU **Adreno 830**.
- Binaries: `~/kalsa-qdc/bin-gov-ocl-stripped` (stripped from bin-governor-1bb3c24a0-ocl),
  built from kalsallama `kalsa/governor-v0` @ **1bb3c24a0** (NOTE: the step-7 staged-cache
  fix 1bfd144a2 is NOT in this build — irrelevant for fixed-range smoke, rebuild for any
  long/bankable run).
- Runtime dep found the hard way: the NDK build needs **libomp.so** pushed alongside
  (`LD_LIBRARY_PATH=/data/local/tmp/gov`), else CANNOT LINK EXECUTABLE.

## Correctness — the whole governor suite is GREEN on 8 Elite

| test | result |
|---|---|
| test-governor-v0 (handoff oracle) | exit 0, `logits_max_abs_diff=0`, token check PASS (8) |
| test-governor-v0-shared-cells | exit 0, decode/seq_rm fences + negative guards PASS |
| test-governor-v0-commit | exit 0, subranges PASS, reject-mismatched-type PASS |
| test-governor-v0-turns | exit 0, 3 turns / 18 tokens, one_token_prompt PASS |
| test-governor-v0-hybrid (LFM2.5-2.6B QAD-Q4_0, the shipping model) | exit 0, PASS, staged v_gets=8 |

Numbers identical to macOS where they should be: commit bytes `269568 == expected` (stories15M),
`1392640 == expected` (lfm2); staged V transfers `1728 → 6`; stats `graph_builds=4/1`,
`decode_reused=18`. Commit wall time on device: 74 µs (stories15M, 3 commits), 372 µs (lfm2).
**Cross-platform reproducibility of the byte oracles is now established (macOS arm64 ↔ Android arm64).**

## The governor premise, measured (smoke-grade, llama-bench, r=2, LFM2.5-2.6B QAD-Q4_0)

| config | pp512 (t/s) | tg128 (t/s) |
|---|---:|---:|
| OpenCL/Adreno 830, ngl=99 | **383.33 ± 0.03** | 26.25 ± 0.02 |
| CPU (ngl=0) | 42.87 ± 0.46 | **28.09 ± 0.18** |

- **Prefill on GPU is 8.9× CPU** — the arm-A-style win the governor exists to capture.
- **Decode on CPU beats GPU** (28.09 vs 26.25, +7%) — the same direction as the S23/Adreno-740
  finding, on a much newer GPU, so per-phase routing (prefill→GPU, decode→CPU) is the right
  shape here too, though the decode gap is now small.
- Split-count constancy asserts, vacuous on CPU-only, still hold with the OpenCL backend loaded
  (suite green); a true CPU+GPU *governor* pairing (ctx_prefill on OpenCL, ctx_decode on CPU
  in one process) is the NEXT step — this smoke ran the suite CPU+CPU with OpenCL available,
  it did not yet cross backends inside the governor.

## Honest gaps
1. Not bankable (see header). 2. The governor has not yet been run with the two contexts on
DIFFERENT backends — that is the actual step-8 goal and needs a small tool/flag to select
devices per context. 3. Thermals unmeasured; rack device, battery service stubbed.
4. Build lacks the staged-cache bound fix.
