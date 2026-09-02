# PREREG rev-1 — DRAFT, NOT QUEUED — cell #48: Class A fix verification + Class B discrimination

Status: **DRAFT for owner review. No QDC session may be created until the owner
has seen this design** (standing rule). Kit sha TBD (Docker build of
`kalsa/npu-judge-v79` @ `736ddd206` + the extra-shapes test addition, both
audited first). Estimated device time ~12 min, cap 20 min. QDC balance ~646 min.

Rev-1 (2/09): the m=576 "outlier" of rev-0 was a pty-interleave misread (AUDIT F1
refuted by the writer's dissent, verified by orchestrator on the `Failing tests:`
list — `v79-defect-desk/ARBITRATION.md` erratum). The %32 mechanism covers 36/36;
the bracket arm is deleted; m=576 stays as a single aligned control.

## What this cell decides

1. **A-fix works on device**: with the host HMX gate on logical
   `src0->ne[1] % 32` (commit `736ddd206`, matching the DSP contract at
   `matmul-ops.c:2327/2596/2841`), the 36 former INTERNAL-ERROR shapes route to
   HVX and PASS.
2. **A-fix regresses nothing**: aligned shapes (incl. `q4_0 m=576,n=512,k=576`,
   OK today at raw `:1803`) still pass; #47's real-model HMX shapes are all
   %32-aligned (FIXNOTES F12) so the fix is inert on ship/OLMoE.
3. **Class B (single NaN, q4_0 m=2880,n=32,k=2880)**: neither theory is
   established (fp16 overflow disfavored; scale-pad theory's q8_0 discriminator
   was based on wrong arithmetic — q8_0 has the same 64-valid+64-pad structure).
   Discriminate empirically.

## Kit

- kalsallama branch `kalsa/npu-judge-v79` @ `736ddd206` (judge + DSP error
  propagation + Class A host fix) + a small test-backend-ops addition: env
  `GGML_TEST_EXTRA_MM="type:m,n,k;..."` appending parameterized MUL_MAT cases
  (probe shapes below are not in the stock list). Addition audited before build.
- Docker kit pipeline (as 93e9592fa).

## Arms (all HTP0, judge-on `GGML_TEST_PLAIN_HOST=1`, per-arm thermal pre-gate as #46/#47)

**Arm 1 — A-fix census (~5 min).** `test-backend-ops -o MUL_MAT` for the five
repack quants, judge-on. Acceptance (vs #46 baseline, binding = grep pair +
code guarantee, split per category reported-not-binding):
- the 36 former INTERNAL-ERROR tests all PASS (routed to HVX);
- `INTERNAL-ERROR` grep count 36 → **0**;
- total FAIL 37 → **1** (only the Class B NaN q4_0 m=2880 may remain);
- no new FAIL on any previously-passing test (incl. m=576 control);
- MUL_MAT_ID spot lane still 301/301.

**Arm 2 — Class B discrimination (~5 min).** Extra shapes via
`GGML_TEST_EXTRA_MM`:
- `q4_0 2880,32,2880` × 3 repeats (determinism probe: uninit-pad theories
  predict flakiness across runs; a stable NaN at the same index says
  deterministic input-dependent path)
- `q4_0 2880,32,1024` (short-k probe: kills or keeps long-k accumulation)
- `q8_0 2880,32,2880` (stock-confirmed PASS — the quant discriminator, re-run
  beside the q4_0 repeats in the same session)
- `q4_0 2880,64,2880` (wider batch: does the NaN column scale with n?)
Acceptance: record NaN presence + index per run; the pattern selects between
(a) k-dependent accumulation, (b) quant-layout-dependent scale path, (c)
nondeterministic uninit memory.

## Non-goals

No PPL (certified in #47), no speed claims, no v73/v75, no KEXP quants, no
MUL_MAT_ID beyond the spot lane, no m=576 diagnostics (not a defect). DSP-side
code untouched (fix is host-only).

## Ops

Same skeleton as #47's d_run.sh: tunnel 6037, sha-verified pushes, on-device
filtered grep (toybox-safe, no --line-buffered), `EXIT=$?` binding, per-arm
pre-gate, crash → skip remaining HTP arms only, cap 20 min / launch-stop 16.
