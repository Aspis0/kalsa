# HOSTILE AUDIT — qdc-8elite-speed-kexp (session 792790)

Auditor: fresh start (prior auditor stalled, no verdict produced).
Claim under audit: Adreno 830 / qwen3moe 17.25B Q4_K — GPU wins prefill 2.56x (274.5 vs 107.4 t/s), CPU wins decode 1.24x (60.7 vs 48.9), per prereg ABBA design and >=5% rule.

## A. Prereg integrity / rule-following
Verdict: CONFIRMED

Evidence:
- `git log` on PREREG.md: `3af32c18 08-30 06:10 PREREG: KEXP A-vs-C speed decision table on Adreno 830 (locked before any measurement)` — commit precedes all raw mtimes (07:23–07:27 per ls -la) and the cell commit `86422968 08-30 07:28 Cell #40 candidate: ... audit pending`.
- `git diff 3af32c18 -- .../PREREG.md` is empty and `git status --porcelain` clean: worktree prereg = lock, no post-hoc rule edits.
- Prereg rule (PREREG.md, "Decision rule"): "compare the **median of the medians of the two blocks** per arm. An arm **wins a phase** if its median is ≥ **5%** above the other arm's; below 5% the phase is a **TIE**. No composite score; the two phases are reported separately."
- REPORT.md follows exactly: "Verdict per the pre-written rule (median of block medians, ≥5% wins)" with two separate phase verdicts, no composite. No post-hoc reinterpretation found: the C-decode win is reported even though it contradicts 750's "A ≈ C decode", and the 750/740 comparators it cites were already named in the prereg's background section ("750 (bank #16, 22/08): A ≈ C decode, A = 2.21× prefill"; "740 ...: C wins always").
- Minor nit (non-blocking): PREREG.md wording "Parent commit at lock: **14909190** (the commit hash of this file is the lock id)" conflates the parent-commit id with the file-lock id; the REPORT cites `3af32c18`, which git confirms is the actual prereg commit.

## B. Arithmetic
Verdict: CONFIRMED

From raw/bench_{A_b1,A_b2,C_b1,C_b2}_792790.out (all lines quoted under Check C / F evidence):
- pp512: A = 274.24, 274.83 → median 274.535; C = 107.84, 107.00 → median 107.420. Ratio A/C = 2.5557 → "2.56×" ✓. Margin +155.6% ≫ 5%.
- tg128: C = 61.16, 60.26 → median 60.710; A = 48.83, 48.88 → median 48.855. Ratio C/A = 1.2427 → "1.24×" ✓. Margin +24.3% > 5%.
- REPORT table digit-for-digit vs raw: A1 `274.24 ± 0.72 / 48.83 ± 0.23`, C1 `107.84 ± 0.66 / 61.16 ± 0.45`, C2 `107.00 ± 1.12 / 60.26 ± 0.59`, A2 `274.83 ± 0.45 / 48.88 ± 0.04` — all match, including ± values.
- ngl: A rows `|  99 |` in both A files; C rows `|   0 |` in both C files. REPORT's A=(GPU ngl 99) / C=(CPU ngl 0) mapping is correct.
- REPORT medians `274.5 vs 107.4` and `60.7 vs 48.9` are correct roundings of 274.535/107.420/60.710/48.855.
- Cosmetic nit (non-blocking, noted for C): the C-run result rows list backend `OpenCL` despite ngl 0 (no layers offloaded); the numbers are CPU-class (match VOID CPU-fallback exhibit, Check F), so this is a header-labeling oddity of the kit, not a misattribution.

## C. GPU-really-ran
Verdict: CONFIRMED

- raw/bench_A_b1_792790.out lines 1, 3: `ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'` and `ggml_opencl: device: 'QUALCOMM Adreno(TM) 830 (OpenCL 3.0 Adreno(TM) 830)'`; row: `| ... | OpenCL     |  99 |           pp512 |        274.24 ± 0.72 |`.
- raw/bench_A_b2_792790.out: same two header lines; row `| ... | OpenCL     |  99 |           pp512 |        274.83 ± 0.45 |`.
- Both A blocks carry the QUALCOMM platform + Adreno 830 device identifiers → no silent CPU fallback in the GPU arm. The load-bearing discriminator REPORT names ("a run whose header lacks `selected platform: 'QUALCOMM` is not a GPU run") is satisfied.
- C runs (ngl=0) do not need the GPU header — all layers pinned to CPU — and they print the same OpenCL init lines anyway (backend loaded, zero layers offloaded), consistent with `|   0 |` in their rows.
- REPORT's claim of "Compiler E031.47.18.47" in A1's header is NOT in the quoted raw .out (which shows only platform/device/build `5c3979438 (10050)`); the E031 compiler reference traces to the prereg's correctness precondition ("cell E031/830 correctness PASS ... commit 0f35d4f5") — see Check I.

## D. Exit codes
Verdict: CONFIRMED

All four exit artifacts contain exactly `0`:
- bench_A_b1_792790.exit: `0`
- bench_A_b2_792790.exit: `0`
- bench_C_b1_792790.exit: `0`
- bench_C_b2_792790.exit: `0`
Matches REPORT: "exit code preserved as artifact (raw/bench_*_792790.exit, all `0`)" and the table's exit column (four `0`s).

## E. Thermal pre/post gates
Verdict: CONFIRMED (with one prose inaccuracy flagged)

Pre-gates — all four files start line 1 with the LIVE group, not the frozen `Cached temperatures:`:
- therm_pre_A1_792790.txt line 1: `Current temperatures from HAL:`; ends `max_hal_temp=42.0 status=0`
- therm_pre_C1_792790.txt line 1: `Current temperatures from HAL:`; ends `max_hal_temp=42.0 status=0`
- therm_pre_C2_792790.txt line 1: `Current temperatures from HAL:`; ends `max_hal_temp=42.0 status=0`
- therm_pre_A2_792790.txt line 1: `Current temperatures from HAL:`; ends `max_hal_temp=42.0 status=0`
All `Thermal Status: 0`; 42.0 ≤ 60 and 0 ≤ 1 → gate passes for all four invocations.

Post files exist for all four (therm_post_{A1,C1,C2,A2}_792790.txt, 1738 B each): max_hal_temp=42.0 (A1, A2, C1) and 44.0 (C2), all status=0.

Inaccuracy flagged (non-blocking): REPORT says "all GATE_PASS, max HAL temp 42-43 °C" — the actual observed range across pre+post files is 42–44 °C (all four PRE gates are exactly 42.0; the 44.0 is the C2 POST). The decision-relevant facts (live group, ≤60 °C, status ≤1, before every invocation) hold regardless.

## F. VOID-session honesty
Verdict: CONFIRMED

- REPORT discloses session 792778 as VOID with the LD_LIBRARY_PATH/`/vendor/lib64` → sphal-bypass → libCB.so dlopen failure root cause and the self-correction of the "broken unit" diagnosis. Backed by raw/opencl_init_failure_792778.txt: "The root cause was OURS, not the unit's: putting /vendor/lib64 in LD_LIBRARY_PATH bypasses the sphal linker namespace" and "bench_A_b1.out (exit 0, labeled OpenCL ngl=99) actually ran on CPU - SILENT FALLBACK, kept as negative exhibit only. No numbers banked from this session."
- Independent verification of the fallback: raw/bench_A_b1.out line 2 is `ggml_opencl: platform IDs not available.` (no QUALCOMM platform line) yet the table shows `| ... | OpenCL     |  99 |           pp512 |        108.29 ± 1.17 |` / `tg128 | 61.14 ± 1.17` — GPU header absent, ngl=99 claimed, exit 0.
- Numbers match real arm C within run noise: VOID pp 108.29 vs C blocks 107.84/107.00 (median 107.42, Δ≈0.8%); VOID tg 61.14 vs C blocks 61.16/60.26 (median 60.71, Δ≈0.7%). REPORT's "pp 108.29, tg 61.14" quotes the exhibit exactly. The CPU-fallback inference is sound.
- REPORT also states the operating rule derived from it ("a run whose header lacks `selected platform: 'QUALCOMM` is not a GPU run regardless of what the results table claims") — consistent with the exhibit.

## G. Upload gate
Verdict: CONFIRMED (with disclosure gap flagged)

- raw/upload_gate.txt: `elapsed 16s, transferred 355 MiB, rate 22 MiB/s, projected total ~4 min` — this is the FIRST (VOID) session's push (mtime 06:48, pairs with model_push.log `23.1 MB/s ... 263.122s` on unit eb49fb9d). No `upload_gate_792790.txt` exists for the real cell.
- raw/model_push_792790.log: `1 file pushed, 0 skipped. 22.3 MB/s (6385238848 bytes in 272.969s)` — the real cell's push, 273 s ≈ 4.55 min « 45 min limit → gate PASS, no fallback. 6385238848/273/2^20 = 22.3 MiB/s, REPORT's arithmetic is correct.
- Conflation finding: REPORT's "PASS with wide margin: 22 MiB/s measured at ~355 MiB into the push (raw/upload_gate.txt)" presents the VOID session's partial-push rate as evidence for THIS cell's gate without labeling it as such (different unit, different session). File-to-number citation is correct, but session attribution is missing. Non-blocking: the real cell's own log (273 s actual total) independently clears the gate with strictly stronger evidence than a projection.
- Procedural nit: prereg specifies "measure throughput on the first ~500 MB of the push"; the real cell recorded only the full-push summary, not a first-~500 MB snapshot. Outcome-equivalent and conservative (actual total time vs projection), so the PASS stands.
- SHAs: model_sha_local.txt and model_sha_device_792790.txt both carry hash `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` (only the path differs: Mac source vs `/data/local/tmp/kalsa/kexp.gguf`). diff confirms hashes identical. Matches REPORT's `2f921958...4777`.

## H. Scope creep
Verdict: CONFIRMED

- REPORT's "What this cell cannot say" section mirrors the prereg's binding list verbatim in substance: governor arm, half-offload, 740/750, sustained-load thermals, shipped app. No claim in REPORT exceeds the measured A/C phases.
- Cross-cell citations are explicitly labeled as other banked cells, never as this cell's raw/: "Extends the 750 finding (A = 2.21× prefill) to the 830", "The 750's \"A ≈ C decode\" resolves clearly in CPU's favor on the 830", "Three generations now measured: 740 C-always → 750 A-prefill/tie-decode → 830 ..., each re-measured, none transferred." The 740/750 numbers trace to PREREG.md's own background ("740 ...: **C wins always**"; "750 (bank #16, 22/08): **A ≈ C decode, A = 2.21× prefill**"), not to this cell's raw/.
- Minor editorial: "the exact split the per-phase governor exploits" mentions the governor but asserts no governor-arm measurement; combined with the binding "Nothing about the governor arm" section, this stays on the right side of the line. No app, no sustained-thermal, no half-offload claims found.

## I. Unsourced numbers
Verdict: CONFIRMED (four traceability defects, all prose-level)

Traced successfully: prereg `3af32c18` / parent `14909190` (git); session ids; serial `41c5710f` and fingerprint line `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/...` (raw/provenance_792790.txt, Android 16 = `:16/`); model sha and 5.94 GiB / 17.25B / qwen3moe / Q4_K Medium (raw bench headers); all table t/s; verdict medians/ratios; VOID `108.29 / 61.14`; "~30 min" (raw/opencl_init_failure_792778.txt: "~30 min lost"); upload numbers (raw logs); 750 `2.21×` (prereg text).

Defects:
1. "max HAL temp 42-43 °C" — actual range is 42–44 °C (post C2 = 44.0); all four pre-gates are exactly 42.0. Loose prose.
2. "A1's header shows ... Compiler E031.47.18.47" — FALSE as written: raw/bench_A_b1_792790.out contains no compiler line (only platform/device + `build: 5c3979438 (10050)`). The E031.47.18.47 string comes from raw/opencl_init_failure_792778.txt's description of the 792790 session's init. Sourced, but misattributed to the A1 header — the exact kind of header-content misstatement this cell's own operating rule forbids.
3. "QRD8750" (REPORT: "both QRD8750 / Snapdragon 8 Elite") — the board string appears in NO raw/ artifact; provenance gives only the `qti/sun/sun` fingerprint and serial. Plausible (sun = SM8750) but untraceable within this cell's record.
4. "22 MiB/s measured at ~355 MiB into the push (raw/upload_gate.txt)" — number/file correct, but the file is the VOID session's push; session attribution omitted (detailed in G).

No fabricated or numerically wrong figure found; all defects are attribution/prose.

## FINAL VERDICT
Verdict: FIX

The audited claim is CONFIRMED on every substantive axis: prereg locked before measurement (3af32c18 @ 06:10 vs raw 07:23–07:27) and followed exactly; arithmetic digit-accurate (A_pp median 274.535 vs C_pp 107.420 = 2.5557×; C_tg 60.710 vs A_tg 48.855 = 1.2427×; both ≫ 5%); GPU arm verifiably ran on Adreno 830 (QUALCOMM platform + device headers in both A blocks); all exit codes 0; live-HAL thermal gates pass (42.0 °C, status 0) with post snapshots; VOID session honestly disclosed and the silent-CPU-fallback exhibit independently verified (pp 108.29/tg 61.14 ≈ C arm); upload gate passed with wide margin on the real cell's own log; SHAs match; no scope creep.

FIX required before registry entry (text-only corrections in REPORT.md, no re-measurement needed):
1. Correct "A1's header shows ... Compiler E031.47.18.47" — cite raw/opencl_init_failure_792778.txt, not the A1 header.
2. Correct "42-43 °C" to the actual 42–44 °C (pre-gates 42.0, post C2 44.0).
3. Label upload_gate.txt's 22 MiB/s as measured during the VOID session's push; the real cell's gate evidence is model_push_792790.log (273 s total).
4. Source or drop "QRD8750".

None of these affect the banked numbers or the A-prefill/C-decode verdict; with the four corrections applied, the cell is registry-ready (would be APPLY).

## RE-AUDIT (post-fix)

REPORT.md re-read from disk (mtime Aug 30 14:41, 4286 B). Per-item:

**1. E031 compiler misattribution — FIXED.**
REPORT now claims only what the A1 .out actually contains: "A1's header shows `ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'` and `device: 'QUALCOMM Adreno(TM) 830 ...'` (raw/bench_A_b1_792790.out)". Verified against raw/bench_A_b1_792790.out lines 1/3: `ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'` / `ggml_opencl: device: 'QUALCOMM Adreno(TM) 830 (OpenCL 3.0 Adreno(TM) 830)'` — both lines exist verbatim. The compiler string is now correctly attributed: "The driver's Compiler string (E031.47.18.47) was captured in the standalone OpenCL probe, recorded in raw/opencl_init_failure_792778.txt, not in the bench .out headers." Verified: opencl_init_failure_792778.txt line 16 contains `Compiler E031.47.18.47.` (in the 792790-session CORRECTION passage) and no bench .out contains it. Statement matches evidence.

**2. Thermal figures — FIXED.**
REPORT: "max HAL temp 42 °C, status 0 — raw/therm_pre_*_792790.txt" (all four pre-gates are exactly 42.0 ✓) and "snapshot after (raw/therm_post_*_792790.txt: max 42/42/42/44 °C, status 0)". Verified post files: therm_post_A1 `max_hal_temp=42.0 status=0`, therm_post_A2 `max_hal_temp=42.0 status=0`, therm_post_C1 `max_hal_temp=42.0 status=0`, therm_post_C2 `max_hal_temp=44.0 status=0`. Multiset {42,42,42,44} matches the REPORT string exactly.

**3. QRD8750 naming — FIXED (one residual nit).**
REPORT: "Device is the QDC catalog's 'Snapdragon 8 Elite / QRD8750' (that catalog name comes from the QDC UI, not from device props); the unit's own props report arch `sun` / SoC SM8750 (raw/provenance_792790.txt: `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/...`, serial `41c5710f`), Android 16." Verified: provenance_792790.txt carries exactly `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys` and `41c5710f`; the literal `SM8750` string is NOT in provenance_792790.txt — it is in this cell's raw/provenance.txt line 2 (VOID-session unit eb49fb9d) and in sibling-cell preregs (qdc-8elite-cpu-day0/PREREG.md: "QRD8750 (SM8750, 'Sun for arm64')"). Residual nit (non-blocking): the SM8750 literal is traceable only to the VOID unit's provenance and the wider bank record, not to unit 41c5710f's own props; the catalog-name caveat is itself external ("QDC UI") and unverifiable from this cell's artifacts. The load-bearing identifiers (sun fingerprint, serial, Android 16) are quoted verbatim from the correct file.

**4. Upload gate — FIXED.**
REPORT: "The interim rate probe (raw/upload_gate.txt: 22 MiB/s at ~355 MiB) is from the FIRST (VOID) session's push and is kept only as the method check; the CELL's own push is raw/model_push_792790.log: 6385238848 bytes in 273 s = 22.3 MiB/s, projected ≈5 min « 45 min limit". Verified: upload_gate.txt is the VOID push (pairs with model_push.log 23.1 MB/s, mtime 06:48); model_push_792790.log `22.3 MB/s (6385238848 bytes in 272.969s)`, 6385238848/273/2^20 = 22.3 MiB/s. Gate now rests solely on the cell's own log, which is sufficient. Minor nit (non-blocking): "Both pushes ran at the same rate" — 23.1 vs 22.3 MB/s is ~3.5% apart; "comparable rate" would be exact.

**New-numbers sweep:** table, verdict medians (274.5/107.4 = 2.56×; 60.7/48.9 = 1.24×), VOID exhibit (108.29/61.14), ~30 min, sha `2f921958...4777`, "≈5 min" (273 s = 4.55 min) — all unchanged from the previously verified set and still trace. No new unsourced number found beyond the two nits above (SM8750 provenance file; "same rate" looseness). Scope creep: none introduced; "cannot say" section unchanged.

### RE-AUDIT FINAL VERDICT
Verdict: APPLY

All four FIX items verified against raw evidence; every remaining discrepancy is a disclosed-or-trivial nit that does not touch a banked number. Cell #40 (qdc-8elite-speed-kexp, session 792790) is registry-ready: GPU wins prefill 2.56× (274.5 vs 107.4 t/s), CPU wins decode 1.24× (60.7 vs 48.9 t/s), per prereg 3af32c18.
