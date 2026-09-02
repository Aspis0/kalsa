# PREREG — cell #48 `npu-v79-fixA-48`: Class A fix verification + Class B discrimination

Status: rev-1 FINAL. Design shown to the owner as PREREG-DRAFT rev-1; **owner
approved 2/09 in chat ("Ok vai")**. Hostile audit of this prereg required
BEFORE any QDC session is created. Locked before any measurement.

## Session

- QDC interactive, **QRD8750 / Snapdragon 8 Elite / Android 16 ONLY**, name
  `npu-v79-fixA-48`, SSH + mirror, key `kalsa-mac`. Cap **20 min**,
  launch-stop 16 min (`over()` = 960 s). QDC balance ~646 min.
- Tunnel: `ANDROID_ADB_SERVER_PORT=6037` — NEVER 5037 (Jelly). Connect via
  `connect.sh` after the wizard's Connect.
- No models, no corpus. Only the kit (~10 MB) is pushed — the lightest cell of
  the campaign.

## Kit

`npu-kit-153fdbafd.tgz` — kalsallama branch `kalsa/npu-judge-v79` tip
`153fdbafd` = judge (`93e9592fa`, audited APPLY×2) + Class A host fix
(`736ddd206`, AUDIT-2 all-MINOR survived) + `GGML_TEST_EXTRA_MM` (`153fdbafd`,
audit APPLY zero defects). Incremental build in the official container
(`ghcr.io/snapdragon-toolchain/arm64-android:v0.7`), same tree/flags as kit v2;
only `libggml-hexagon.so` and `test-backend-ops` differ from v2 (DSP skel
byte-identical to the certified one). Kit sha recorded in `raw/kit_sha_host.txt`
at package time; on-device SHA256SUMS verify binding as #46/#47.

## Runs (all HTP0, judge ON `GGML_TEST_PLAIN_HOST=1`, thermal pre-gate per run)

EXTRA (fixed string, binding):
`q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880`

- **R1** `-o MUL_MAT` with `GGML_TEST_EXTRA_MM=$EXTRA` — stock census (Class A
  verification) + 6 extra cases (Class B probes) in one pass. Stock already
  contains `q4_0 2880,32,2880` once → 4 within-run occurrences of the NaN shape.
- **R2** identical repeat of R1 — cross-run determinism.
- **R3** `-o MUL_MAT_ID` (no EXTRA) — the 301-case spot lane.

Drop order R1→R2→R3; crash signature ⇒ `NPU_DEAD=1`, remaining HTP runs
skipped, cell reported with what landed. `over()` ⇒ skip remaining runs.

## Acceptance — binding

Baseline = #46 (`qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt`): 505/542,
`Failing tests:` = 37 (36 INTERNAL-ERROR, all test-m % 32 ≠ 0, + 1 NaN
`q4_0 m=2880,n=32,k=2880`).

1. **A-fix (gate, binding):** in R1 and R2, grep-pair count of
   `dsp-rsp: INTERNAL-ERROR` = **0** and `ggml_backend_graph_compute failed` = 0
   for those (the pair must agree); none of the 36 former-IE shapes appears in
   the final `Failing tests:` list. Any former-IE shape that now FAILs
   *numerically* (on HVX) = NEW defect, banked as a finding; the cell stays
   valid, the gate reads FAIL-with-finding.
2. **No regression (gate, binding):** no shape outside the 36 that passed in
   #46 may fail in R1/R2 (`Failing tests:` diff vs baseline), except the known
   NaN case and the 6 extra cases (whose verdicts are data, not gates). The
   aligned control `q4_0 m=576,n=512,k=576` must stay PASS.
3. **MUL_MAT_ID spot (gate, binding):** R3 = 301/301 PASS.
4. **Class B (data, NOT a gate):** verdict + NaN index for each of the 8
   occurrences of `q4_0 2880,32,2880` (1 stock + 3 extra, ×2 runs), and for
   `2880,32,1024`, `2880,64,2880`, `q8_0 2880,32,2880` (×2 runs). Interpretation
   grid (pre-declared): all-8 identical NaN at the same index → deterministic
   path (disfavors uninit-pad); any flakiness across occurrences/runs → uninit
   memory (pad or VTCM layout undercount); `k=1024` clean while `k=2880` NaN →
   k-dependent (accumulation or tiling length); `q8_0` clean throughout →
   quant-layout-dependent. No theory is confirmed by this cell alone; the grid
   only narrows candidates (three live: fp16 acc / scale-pad / VTCM undercount).
5. **Census tool:** adopted `census.awk` (ex-headerfix); per-category split
   reported-not-binding; binding counts come from the grep pair + the
   `Failing tests:` list + code guarantee (`test-backend-ops.cpp:1850`).

## Method notes (binding)

- Judge-integrity lines (`recopy=get/set`, `PLAIN_HOST=1`) must appear in R1/R3
  logs; absence ⇒ METHOD-VOID for that run.
- `Hexagon Arch version v79` must appear in list-devices before R1; absence ⇒
  METHOD-VOID (end).
- Full ops logs pulled raw (no on-device filtering — census logs are a few MB).
- Thermal: live-HAL gate pre-run (60 °C threshold, one 180 s retry); post-run
  snapshot disclosed, in-run excursions do not void (pre-invocation gate by
  design, as #43/#46/#47).
- `EXIT=` echoed in-shell is the binding rc per run.

## What this cell cannot say

Nothing about speed; nothing about PPL (closed in #47); nothing about
v73/v75/KEXP; no Class B root cause (only candidate narrowing); no governor/app
claim. DSP-side code untouched.

## Post-run addendum (AUDIT-REPORT F-8, MINOR — for FUTURE preregs, this cell's text unchanged)

Gate 1's letter was silent on IE→NS transitions (it required IE grep-pair = 0
and absence from `Failing tests:`, which the 2 NS flips satisfy — adjudicated
honest, not lawyerly, since the REPORT discloses the capability decline).
Future fix-verification preregs must state explicitly: "each former-failing
shape must become OK or NS (an honest upfront decline); any FAIL = defect."
