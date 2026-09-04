# PREREG — Cell #60: is the v73 death a mapping BUDGET? (host-vs-DSP discriminator, HDK8550)

Date: 2026-09-04 early morning, owner full delegation. Follow-up of cell #59 (ALIVE row 42),
which replicated the S23 `dspqueue_read 0x2e` death on reference v73 hardware and left the
question "host path or DSP/firmware?" open. Step 0 of this cell (DISASM.md, Mac-side, zero QDC
minutes) already moved the fault OFF the host: the #59 logcat shows the cDSP process calling
`abort()` from `libggml-htp-v73.so` at `htp_iface_start+0x1348`, and the disassembly of that
exact skel resolves the site to `htp/main.c:729` — `mmap_buf()`: `HAP_mmap()` returned -1 for a
weight buffer and the v73 path aborts (v75+ uses `HAP_mmap2`). The host `0x2e` is the symptom
(PD crashed → dspsignal_wait aborted). This cell asks WHY `HAP_mmap` fails, with two size knobs
that cost nothing to turn.

## Question

On HDK8550 (v73), with the same kit, model and template as #59, does the death depend on the
TOTAL bytes mapped into the DSP user PD (H1, cumulative VA budget of a 32-bit PD: #59 mapped
3.57 GiB in 8 buffers, three of ~1 GiB), or on the SIZE of individual mappings (H2, a
per-`HAP_mmap` limit below the 1 GiB default `GGML_HEXAGON_MBUF`), or on neither (H0)?

## Arms (in order; HOSTBUF unset throughout — exonerated by #59; each behind the #38 thermal
gate; env `GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1`, lib paths as #59; logcat ring +
tombstones pulled per arm; `--mmap 0` as amended in #59)

Template T = `./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl
--mmap 0 -fa on --ubatch-size 1024` (= #59's template minus `-ngl 99`, which each arm sets).

- B1 `ngl8_mbuf1g` (cap 900 s): T + `-ngl 8`. Eight layers' experts on HTP0-REPACK
  (~1.8 GiB), the other eight on CPU. Predictions: H1 → survives; H2 → dies (buffers still ~1 GiB).
- B2 `ngl99_mbuf512` (cap 900 s): T + `-ngl 99`, env `GGML_HEXAGON_MBUF=512`. Same 3.6 GiB
  total, split into ~8 buffers of 512 MiB (≈13 mappings, under the skel's 16 slots).
  Predictions: H1 → dies; H2 → survives.
- B3 `ngl12_mbuf1g` (cap 900 s): T + `-ngl 12` (~2.7 GiB). Runs after B1/B2 regardless of
  their outcome; brackets the threshold under H1; informative under H2/H0.
- B4 `ngl8_tg128` (cap 1200 s): T with `-p 0 -n 128` + `-ngl 8`. Runs ONLY if B1 survived:
  the decode surface (the other S23 death surface) with partial offload.
- No `-ngl 99` / MBUF 1 GiB control: it is #59 A1 (same kit, model, board class), declared as
  the control.

"Dies" = non-zero exit or a dspqueue/fastrpc fatal in stderr/logcat. "Survives" = exit 0 with
HTP proof in -v stderr: `n_exps_htp0` (MUL_MAT_ID execute-ops on HTP0) = 3 × offloaded layers
(24 for B1/B4, 36 for B3, 48 for B2); exit 0 with a lower count is METHOD-VOID for that arm
(silent CPU fallback), not a survival. Signature identification: the logcat cDSP block's
`htp_iface_start+0x1348` on THIS skel = `main.c:729` (binding, DISASM.md); any other offset is
resolved post hoc with the same objdump procedure and reported as such.

## Binding interpretation grid

- G1 (VA-BUDGET, H1): B1 survives with proof AND B2 dies with the :729 signature → the v73
  death is a cumulative mapping budget of the user PD, not a host bug and not (as far as this
  goes) a firmware fault. F6 is REFORMULATED from "experts-on-NPU = v75-class-only" to
  "v73: HTP-resident weight bytes must stay under a budget" (bracketed by B3: ≥ 2.7 GiB if B3
  survives, between 1.8 and 2.7 GiB if it dies). Upstream dossier #8: `mmap_buf` aborts on
  `HAP_mmap` failure with no fallback/eviction on v73 — actionable. No router change tonight
  (partial-offload MoE on v73 becomes a NEW option to measure, not a decision).
- G2 (MAP-SIZE, H2): B2 survives with proof 48 AND B1 dies with :729 → a per-mapping limit;
  the fix is a host-side MBUF cap on v73. Experts-on-NPU on v73 is back on the table as an
  owner question; F6 flagged for revision, not changed.
- G3 (BOTH SURVIVE): size-bound, mechanism ambiguous (both knobs relieve it) → banked as
  "size-bound"; B3 still informative; a follow-up with MBUF=768 / ngl 16 is queued. No policy
  change.
- G4 (BOTH DIE at :729): neither knob matters → H0; the failure has another cause (fd/flags/
  pinning/firmware); "stack-bound" stays as in #59; next step would be the FARF message
  (fd/size) and a skel rebuild with the failure code logged.
- G5 (DIFFERENT SIGNATURE in any arm — TLBMISS, another abort line such as :292 VTCM or :722,
  non-dspqueue) → new finding, banked; no H claim for that arm.
- Mixed with METHOD-VOID arms: only arms with proof count; a grid needing a void arm is not
  claimed.

## Declared confounds

Inherited from #59: newer build than the S23's (kalsa/npu-judge-v79), allenai model bytes
(same 113/81/1 census), Android 16, `--mmap 0` load path. New: partial offload (B1/B3/B4)
changes the graph (CPU experts for the remaining layers) — nothing measured here is a
performance number. B2's mapping count is read from the host `mapped buffer` lines; if it
exceeds 16 (HTP_MAX_MMAPS) the arm is METHOD-VOID (slot overflow, a different failure).
Best-effort capture: a `llama-bench.farf` file (`0x1F`) is placed in `$D/lib-fix` before the
arms to route runtime FARF messages to logcat per the SDK convention; this mechanism is
UNVERIFIED on this device — if the `mmap failed : va` line appears, its fd/size are recorded;
its absence proves nothing.

## Fixed materials

- Kit `~/kalsa-qdc/npu-v79-cell/npu-kit-59.tgz` (unchanged from #59; SHA256SUMS verified
  on-device). Model `~/kalsa-qdc/models/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` sha
  `361e8d83…` (verified on device; mismatch = METHOD-VOID). Device dir `/data/local/tmp/kalsa60`.
- Driver `d_run.sh` derived from #59's (T4 launch, adbT perl-alarm caps, re-entrant arms,
  bracketed pkill, `-n 1` fallback if `-n 0` is rejected — not expected here). Thermal gate #38.
- Session: HDK8550 (8 Gen 2 pool ≈ 946 min), booked 30 min, expected ~12 min billed (3.9 GB
  push ≈ 3 min, four short arms). One session at a time. End Session = ref-click End + ref-click
  Yes + reload + read "Ended On" within one minute; repeat if still Running.

## Non-goals

No v75/v79 arms, no performance claims, no skel modification, no upstream filing (dossier text
only), no HOSTBUF arms.

## Pre-run amendment 1 (before any session; after the websearch and a second source read)

Two facts sharpen H1 into H1′ and add a fix candidate:
- Qualcomm (fastrpc issue #137, maintainer comment 2025-04-17): the cDSP user PD has a
  32-bit VA space, "limited to 2GB on older devices and increased to 3GB on newer devices
  (8gen3)". The host backend assumes `opt_vmem = 3000 MiB` for arch < 75
  (ggml-hexagon.cpp:4373; `HTP_OP_MAX_VMEM_DEFAULT` = 3200 MiB for v75+) and passes it to
  `htp_iface_start(..., max_vmem)`; the skel's `prep_op_bufs()` (main.c:743-777) drops unused
  mappings ONLY when `mapped + extra > max_vmem`. With three ~1 GiB buffers the skel never
  evicts (≤ 3000 MiB) while the real v73 budget is ~2 GiB → `HAP_mmap` fails → `abort()` :729.
- The host can MEASURE the budget: `GGML_HEXAGON_VMEM=0` calls `ggml_hexagon_measure_max_vmem`
  (ggml-hexagon.cpp:1608, pinned allocs until failure, logs "measured max vmem N"); the env is
  in MiB (line 4395).

Arms added (same T, HOSTBUF unset), run after B2 and before B3:
- B5 `ngl99_vmem1800` (cap 900 s): T + `-ngl 99`, env `GGML_HEXAGON_VMEM=1800`. H1′ predicts
  SURVIVE with proof 48 (eviction engages before the PD runs out). This is the fix candidate.
- B6 `ngl99_vmem0` (cap 900 s): T + `-ngl 99`, env `GGML_HEXAGON_VMEM=0`. Records the measured
  budget N (stderr line `measured max vmem`); predicted SURVIVE if N ≤ real budget − batch need.

Grid refinement (binding): G1 now has two sub-rows. G1a (H1′ + FIX): B1 survives, B2 dies,
B5 survives → the death is the host's 3000 MiB assumption for v73; the fix is a v73 default
≤ the measured budget (B6's N is the number to propose upstream); F6 reformulated as in G1.
G1b (H1 without fix): B1 survives, B2 dies, B5 dies at :729 → budget real but the eviction
path does not save it (batch larger than budget or eviction bug); banked, fix needs skel work.
B6 outcomes are informative only: its N is banked whatever the arm's exit; a B6 death is not
a grid input. All other rows unchanged. Session estimate becomes ~14 min (six arms).

## Audit response (AUDIT-PRERUN.md, before the session)

- P2 (B2 slot count) REFUTED by arithmetic on the #59 log: the 8 mapped buffers are
  1028657152 ×2 + 1019219968 + 698355712 (= 3600 MiB of experts, FOUR buffers) + four
  non-expert buffers (33.5 MB, 12.3 MB, 8.9 MB, 2.0 MB). At MBUF=512 MiB the 48 expert
  tensors of 72 MiB pack 7 per buffer → 7 expert buffers + 4 = 11 mappings ≤ 16. The
  PREREG's "≈13" is corrected to "≈11 (7+4)". The METHOD-VOID clause stays.
- P5 accepted: G6 (B2 METHOD-VOID by slot overflow, i.e. > 16 `mapped buffer` lines or a
  non-:729 fault in B2) → B2 says nothing about H2; the cell is carried by B1/B5/B6/B3.
- P6 REFUTED by reading d_run.sh: a died arm returns 9 (`[ "$e" = "0" ] && return 0; return 9`),
  `ABORT=1` is set only on rc 7|8 (gate abort / launch failure), so B3 runs after B1/B2 deaths
  exactly as the PREREG says.
