# Hostile read-only audit — session #16 Xiaomi 14 / Adreno 750

Scope: on-disk evidence only. No device/ADB access, reruns, git operations, or writes outside this file.

Status: complete.

## Verdict convention

- CONFIRMED: raw evidence directly supports the claim, including its arithmetic and stated qualifiers.
- REFUTED: raw evidence contradicts the claim.
- UNVERIFIABLE: the supplied disk evidence is absent, incomplete, ambiguous, or cannot establish the claim.

## Evidence index

Primary evidence is under `results/xiaomi750_validation/raw/`; the reference rules are in `results/kexp_speed_s23/PREREG_KEXP_N5.md`. Line numbers below refer to the files as read from disk during this audit. I independently parsed the JSONL and re-counted classified test rows; the report transcription is not treated as primary evidence.

Important scope split: the nine phase-b cells are `c01`–`c09`, explicitly enumerated by `raw/b/cells.csv:2-10`. `raw/b/cells/c10_C_awake.out` is a later control and is not in that CSV. Any calculation that globbed every `*.out` would silently mix the control into arm C and change the median.

## Claim audit

### 1. Phase a MUL_MAT GPUOpenCL failure cluster

Status: **CONFIRMED** for the Xiaomi/750 assertions; the S23 compiler comparison is only reference-backed, not present in the S23 KEXP raw logs.

- `raw/a/MUL_MAT.meta:1` identifies `backend=GPUOpenCL`; `MUL_MAT.out:3` identifies the same backend. The result summary is `905/925 tests passed` at `MUL_MAT.out:73209`, with `Backend OpenCL: FAIL`/final `FAIL` at `:73216-73220`, and `MUL_MAT.rc:1` is `1`.
- `MUL_MAT.FAIL_CASES.txt:1-5` independently records `count=20`, `ok_ansi=905`, `total=925`, the cluster filter, and first `ERR=0.100341672` against `0.000500000`; the 20 named failures occupy `:7-26`. Every named failure has `type_a=f16` or `bf16`, `type_b=f32`, `m=128,n=1,k=1056,k_v=2112` (the `bs/nr` variants are explicit in those lines).
- The exact 750 banner is `MUL_MAT.err:3-6`: Adreno 750 and `OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25`. The same exact banner is also in `cluster_r1.err:6`, `cluster_r2.err:6`, and `MUL_MAT_ID.err:6`.
- Caveat: `rg` found no `E031.41.03.62` line in `results/kexp_speed_s23/`; the S23 side is stated in the session report (`scratchpad/agents/q16-xiaomi/REPORT.md:66`) and other historical workspace notes, not in the supplied S23 KEXP raw logs. That does not weaken the 750 banner, but it weakens the claimed same-format log-to-log comparison.

### 2. MUL_MAT_ID coverage and discriminators

Status: **CONFIRMED**.

- `raw/a/MUL_MAT_ID.rc:1` is `0`; `MUL_MAT_ID.out:815-818` says `407/407 tests passed`, `Backend OpenCL: OK`, and `2/2 backends passed`.
- Recounting `MUL_MAT_ID.out` rows gives the reported passing counts: `q4_K=82`, `q2_K=5`, `q3_K=5`, `q6_K=5`, `q5_K=6`, `q4_0=74`, `q4_1=75`, `q8_0=75`, and `mxfp4=74`. The relevant quantized rows begin at `:14-31`; the full 407-row output through `:814` contains only `OK` for these types. No FAIL row was found.
- The discriminators are present and pass: `m=96` rows at `MUL_MAT_ID.out:797-806`; `n_mats=64,k=2304` rows at `:807-811` and `:814`. These are separate discriminator cases; no single row combines `m=96` with `n_mats=64,k=2304`.
- The 401 unsupported cases are not silently counted as passes: the output visibly labels them `not supported [OpenCL]` near the start and throughout the unsupported sections; the 407 summary is the tested/passing set.

### 3. Cluster isolation and determinism

Status: **REFUTED as written; corrected isolation result confirmed**.

- `raw/a/cluster_compare.txt:1-5` reports 20 FAIL/28 OK in each run, unequal output bytes, equal fail lists, and `err_pairs_same=0 diff=20`. The first ERR is `0.153321972` in r1 (`:7`) versus `0.121416414` in r2 (`:28`), so the claimed non-bit-identical error behavior is confirmed.
- Independent ANSI-stripped parsing of `cluster_r1.out` and `cluster_r2.out` found 48 named rows each: 28 OK and 20 FAIL; both all-name lists and both fail-name lists are identical. The r1 first rows are at `cluster_r1.out:7-13`; the extra non-`bs=[1,1]` passes are directly visible at `:13-14`, `:2071-2072`, `:16431-16432`, and `:19513-19514`.
- The hostile correction is material: the 28 passes are **16 f32×f32 + 12 f16/bf16 rows with `nr=[1,1]` across `bs=[1,1],[2,1],[4,1],[1,3],[2,3]`**, not merely f32×f32 plus f16/bf16 at `bs=[1,1]`. Only four f16/bf16 passes have `bs=[1,1]`; eight additional f16/bf16 passes have other `bs` values. The raw set therefore contradicts the exhaustive wording of the claim.

### 4. Phase b A/B/C table and protocol/provenance checks

Status: **CONFIRMED** for the stated quick-table observables. The separate reference-protocol compliance subcheck is **REFUTED**, and device-side GGUF identity is **UNVERIFIABLE**.

- Using only the nine rows declared in `raw/b/cells.csv:2-10`, full-precision JSONL recomputation gives: A tg `17.061999,24.471472,24.930818` → median `24.471472` (24.471); B tg `6.953580,7.400516,8.180969` → `7.400516` (7.401); C tg `24.250144,24.274778,24.363520` → `24.274778` (24.275). pp medians are A `87.424307`, B `40.629111`, C `39.553458`. Representative raw JSONL lines are `raw/b/cells/c01_A.out:1-2`, `c02_B.out:1-2`, `c03_C.out:1-2`, `c04_C.out:1-2`, `c05_B.out:1-2`, `c06_A.out:1-2`, `c07_A.out:1-2`, `c08_B.out:1-2`, and `c09_C.out:1-2`.
- Arm fields match the reference: A `n_gpu_layers=99,n_cpu_moe=0` (`c01_A.out:1`); B `n_gpu_layers=99,n_cpu_moe=99` (`c02_B.out:1`); C `n_gpu_layers=0` (`c03_C.out:1`). Across all 18 main JSON objects, independent checks found `n_threads=4`, `flash_attn=0`, `no_repack=true`, the same `build_commit`, and the same model filename every time. The harness forces these flags at `raw/b/one_cell.sh:23`.
- File write times and JSON `test_time` order are `A,B,C,C,B,A,A,B,C`, i.e. `ABC CBA ABC`: `raw/b/cells/c01_A.out:1-2` through `c09_C.out:1-2`; filesystem times are monotonically ordered in the same sequence.
- All nine main `.rc` files are `0` (the same values are in `cells.csv:2-10`). All nine main battery pre/post rows are 98%, and battery probes show `status: 3` plus AC/USB false; see `raw/b/cells.csv:2-10` and e.g. `raw/b/probes/c01_A_batt_pre.txt:1-6`.
- All nine main wake-pre probes are Awake and all nine wake-post probes are Dozing, recorded compactly in `cells.csv:2-10` and directly at `raw/b/probes/c01_A_wake_pre.txt:1`, `c01_A_wake_post.txt:1`. The `Dozing` result is real and declared, but it is a protocol failure: the reference requires `wake_post=Awake` and excludes non-Awake cells (`PREREG_KEXP_N5.md:131-133,171-178`). The reference also requires ≥5 complete six-cell blocks and ≥10 cells per arm (`:73-75,139-143,191-200`); this quick run has N=3/arm and tg128/pp128.
- All ten phase-b SHA probe files, including the later control, have identical three-line contents: `raw/b/probes/c01_A_sha.txt:1-3` and `c02_B_sha.txt:1-3` are representative; the disk-wide comparison found no differing file. `gguf_sha_pc.txt:1-5` proves the PC file hash equals the prereg expected `b07c8087…`, but no phase-b raw probe hashes the device GGUF. Therefore “PC hash matches prereg” is CONFIRMED; “device GGUF is proven equal” is UNVERIFIABLE from these raws.
- The literal `raw/b/cells/*.out` glob contains `c10_C_awake.out` in addition to the nine main cells. Including it changes C medians (tg `24.262461`, pp `39.533868`), so the reported values require the explicit `cells.csv`/control exclusion. This is disclosed by the separate control claim, but it must be stated whenever the glob is used.

### 5. Phase b ratios and first-A-cell median

Status: **CONFIRMED for the nine-cell main set**.

- Full precision gives `24.471472 / 24.274778 = 1.0081028` → **1.008** and `87.424307 / 39.553458 = 2.2102823` → **2.21**. Inputs are the JSONL values cited above; the session report prints the same values at `scratchpad/agents/q16-xiaomi/REPORT.md:184-190`.
- The first A cell is `c01_A.out:2`, `avg_ts=17.061999`; the other A cells are `c06_A.out:2` (`24.930818`) and `c07_A.out:2` (`24.471472`). Sorting those three gives the stated median `24.471472`; the 17.062 cell is included, not silently dropped. The session report explicitly says “Kept in the median” at `:178`.

### 6. Phase c triplet, ratios, no-repack distinction, dense GGUF provenance

Status: **UNVERIFIABLE as a whole; numeric/configuration subclaims CONFIRMED, current dense-GGUF identity not proven**.

- Re-reading the six JSONL files gives the exact `avg_ts` values: GPU pp128 `181.500604` → 181.501 and pp512 `212.111029` → 212.111 (`raw/c/cells/c_gpu_pp128.out:1`, `c_gpu_pp512.out:1`); CPU repack `126.656097`/`122.496133` (`c_cpu_pp128.out:1`, `c_cpu_pp512.out:1`); CPU `-nr` `69.414628`/`66.723627` (`c_cpu_nr_pp128.out:1`, `c_cpu_nr_pp512.out:1`). All six `.rc` files are `0`.
- Ratios recomputed from those unrounded `avg_ts` fields are repack `1.4330191×` and `1.7315733×` → **1.43×/1.73×**; CPU-nr `2.6147314×` and `3.1789493×` → **2.62×/3.18×**. `raw/c/summary.txt:1-8` independently records the first pair and historical GPU comparison.
- The no-repack distinction is real: GPU and CPU-repack JSON objects have `no_repack=false`, while both CPU-nr objects have `no_repack=true` (`raw/c/cells/c_gpu_pp128.out:1`, `c_cpu_pp128.out:1`, `c_cpu_nr_pp128.out:1`). The two CPU arms are a clean flag contrast; the GPU/CPU-nr ratios are not literally equal-flag comparisons because the GPU JSON also says `false`.
- All six JSON objects carry `build_commit=1882bf8cd`, and the six per-cell binary SHA probes agree (`raw/c/probes/c_gpu_pp128_sha.txt:1-3`, `c_cpu_nr_pp128_sha.txt:1-3`; disk-wide comparison found no differing probe).
- The current phase-c raw evidence does **not** include a model-GGUF hash. The six `.out` lines identify the path and size but no model SHA; the six `*_sha.txt` probes contain only `llama-bench`, `libllama-bench-impl.so`, and `libggml-opencl.so` (`raw/c/probes/c_gpu_pp128_sha.txt:1-3`). The `aaf42c8b…` value exists in the historical `results/xiaomi_ab/sha_records.md:14-16`, and is repeated by the session report (`scratchpad/agents/q16-xiaomi/REPORT.md:204`), but that record does not prove the exact current phase-c device file. This subclaim is therefore UNVERIFIABLE from the phase-c raw archive.

### 7. Doze control

Status: **CONFIRMED**.

- `raw/b/cells/c10_C_awake.out:2` reports `avg_ts=23.682758` (23.68 tg128), `n_gpu_layers=0`, `no_repack=true`; its pre/post wake probes are `raw/b/probes/c10_C_awake_wake_pre.txt:1` = Awake and `c10_C_awake_wake_post.txt:1` = Dozing.
- The nine-cell main C median is independently `24.274778` (24.28) from `c03_C.out:2`, `c04_C.out:2`, and `c09_C.out:2`; the control is therefore slightly lower, `23.682758 < 24.274778`. Its `.rc` is `0` and its binary probe is present at `raw/b/probes/c10_C_awake_sha.txt:1-3`.
- This confirms the observed control. It does not prove the causal wording “Doze does not explain A≈C”; that is an inference from one additional single-sample control and remains weakly identified.

### 8. Session-level provenance and isolation

Status: **UNVERIFIABLE as written; several scoped subfacts CONFIRMED**.

- All 20 phase-b JSON objects (nine main cells plus c10) and all six phase-c JSON objects have `build_commit=1882bf8cd`; independent count: 20 + 6 objects, zero mismatches. Representative raw lines: `raw/b/cells/c01_A.out:1`, `c10_C_awake.out:1`, and `raw/c/cells/c_cpu_nr_pp512.out:1`.
- Battery probes support 98% at the session start (`raw/a/pre_mul_mat_battery.txt:1-8`) and 94% at the final c10 control (`raw/b/probes/c10_C_awake_batt_post.txt:1-6`); all 32 b/c battery probes have `status: 3` and no non-3 status, with AC/USB false in the probes. Intermediate levels 97/95 are present, so “98→94” is a correct endpoint summary, not a claim of a flat level.
- The raw Xiaomi scripts contain only the Xiaomi TLS serial at `raw/b/run_phase_b.ps1:3` and `raw/c/run_phase_c.ps1:3`; a raw-tree search found no S23 serial, S911U, Adreno 740, or `S23`. That supports “no S23 serial in these archived scripts/raw logs.” It cannot prove the negative event “S23 was never touched” outside the archived commands/logs. The session report itself names the S23 serial as a do-not-touch device (`scratchpad/agents/q16-xiaomi/REPORT.md:10,248`), so the stronger non-contact claim is not disk-provable.
- Phase-a PC/device SHA pairs are directly recorded: `raw/a/sha256_device.txt:1-9` and `raw/a/sha256_pc.txt:4-12` match on the listed test binary and libraries; the pre-run files `sha256_pre_mul_mat.txt:1-6`, `sha256_pre_mul_mat_id.txt:1-7`, and `sha256_pre_mul_mat_after_runtime.txt:1-4` record the relevant transitions. Per-cell b/c probes are device-side snapshots, taken immediately before execution by `raw/b/run_phase_b.ps1:66-72` and `raw/c/run_phase_c.ps1:57-62`; they are not fresh PC/device pairs for every individual cell. Thus artifact pinning is supported, but the literal “pair for every binary run” wording is too strong.

## Additional hostile findings

- **Aggregation honesty:** the phase-b harness hard-codes `-r 1` (`raw/b/one_cell.sh:23`). Every main JSON object has one-element `samples_ts` and `stddev_ts=0` (for example `raw/b/cells/c01_A.out:2`). The reported medians are honestly medians of three *cells* per arm, not medians of three repeated measurements per cell. They provide no within-cell variance estimate; calling them “medians-of-3 across blocks” is acceptable only if “cells” is made explicit. Phase c is different: its `-r 3` is visible in `raw/c/run_phase_c.ps1:37-40`, and its JSON contains three samples with nonzero standard deviations.
- **Exclusions are mostly disclosed, but the set definition is fragile:** c10 is absent from `raw/b/cells.csv:2-10` and separately named `c10_C_awake`; the session report also labels it optional (`scratchpad/agents/q16-xiaomi/REPORT.md:311-320`). That is not a silent numerical exclusion, but an unqualified `cells/*.out` aggregation would be wrong. Conversely, the two CPU-nr continuation files are present under `raw/c/cells/` with probes and rc files, but are absent from `raw/c/cells.csv:1-5`; the continuation is traceable by filename, not by the phase-c index.
- **Reference-protocol failure is decisive for interpretation:** the prereg requires `wake_post=Awake` (`PREREG_KEXP_N5.md:131-133,177`), a six-cell palindrome with ≥5 complete blocks (`:73-75,193`), and tg512 primary cells (`:139-143`). The quick run has 9 main cells, tg128/pp128, N=3/arm, and Dozing after every cell. It is valid exploratory evidence after correction, not a confirmatory ship instance.
- **No cherry-pick of the phase-b A outlier was found:** `c01_A` is in the declared nine-row CSV and its 17.061999 value is in the median computation. The c10 control is a separate later run, not a replacement. The phase-a 20 failures are retained in `MUL_MAT.FAIL_CASES.txt`; the later `MUL_MAT_ID` continuation is separately archived and does not rewrite the failed 925-case result.
- **Selected-filter limitation:** cluster r1/r2 are explicitly a filtered 48-case slice (`m=128,n=1,k=1056`), not a second full 925-case campaign. Their deterministic fail-set result is valid for that slice; it cannot establish behavior outside the filter. The full-run claim must rely on `MUL_MAT.out`/`FAIL_CASES`, not on the cluster files.
- **Type-count scope:** the `MUL_MAT_ID` q-type counts are passing test rows, not proof that every possible model shape or every end-to-end MoE invocation is correct. The 401 unsupported rows are excluded by the harness (`MUL_MAT_ID.out` independently parses to 407 OK + 401 unsupported + 0 FAIL), so “all our kernel types pass” must remain scoped to the tested supported rows.
- **Phase-c comparison confound:** the CPU-repack versus CPU-nr contrast is clean on `no_repack`; GPU versus CPU-nr is not an identical JSON-flag configuration because GPU says `no_repack=false` while CPU-nr says `true`. The throughput arithmetic is correct, but the shorthand “apples-to-apples `-nr`” is overstated unless the explanation is limited to CPU repack behavior.
- **Causal overreach:** raw evidence establishes a 750 compiler banner and a reproducible numerical failure set. It does not isolate the compiler as the cause, prove “concatenated-K path,” or prove that the S23 compiler passed the identical cases: those are hypotheses/comparisons stated in the session report (`scratchpad/agents/q16-xiaomi/REPORT.md:116,291-294`), not demonstrated by the supplied S23 KEXP raw logs.
- **Current-model provenance gaps:** phase-b has a PC GGUF hash but no device GGUF hash (`raw/b/gguf_sha_pc.txt:1-5`); phase-c has neither a current model hash probe nor a model-hash field in JSON, only historical `results/xiaomi_ab/sha_records.md:16`. Binary pinning is stronger than model pinning here.
- **Session-report claims lacking raw support or only indirectly supported:** the “remotes empty/not modified/not pushed” statement at `scratchpad/agents/q16-xiaomi/REPORT.md:336` is not established by the supplied raw archive and was not git-audited; the assertion that Xiaomi “ignored” the timeout (`:249`) is causal speculation beyond the observed Dozing probes; the historical S23 and August CPU/GPU comparisons rely on other workspace artifacts rather than this session’s raw c/b archive. These should be labeled provenance/reference claims, not raw-session facts.

## Claim status summary

| Claim | Status | Audit disposition |
|---|---|---|
| 1 | CONFIRMED | 750 raw result and exact compiler banner stand; S23-side banner is not in the S23 KEXP raw logs. |
| 2 | CONFIRMED | 407 supported rows pass; requested quantized types and discriminator rows pass. |
| 3 | REFUTED | Deterministic/non-bit-identical part stands, but the 28-pass classification omitted eight non-`bs=[1,1]` f16/bf16 passes. |
| 4 | CONFIRMED | Nine-cell arithmetic/config/probes/rc/order/battery facts stand; full reference-protocol compliance fails, device GGUF equality is unverified, and c10 must be excluded explicitly. |
| 5 | CONFIRMED | Ratios and inclusion of c01_A recompute exactly on c01–c09. |
| 6 | UNVERIFIABLE | Numeric triplet/ratios and no-repack distinction stand; current dense GGUF hash is absent from phase-c raw probes. |
| 7 | CONFIRMED | Control value and Awake→Dozing transition are directly recorded. |
| 8 | UNVERIFIABLE | Commit/battery/status/binary-pin subfacts stand; “never touched S23” and per-run PC/device pair wording exceed the disk evidence. |

## Final verdict

**BANK-WITH-CORRECTIONS** — bank the session only as exploratory/device-diagnostic evidence, with the claim-3 classification corrected, c10 excluded by an explicit set definition, current GGUF identity marked unverified, and all reference-protocol/ship interpretations blocked. 

BANK-WITH-CORRECTIONS

## Phase d audit

Status: complete. Scope: on-disk evidence only; no device/ADB access, reruns, git operations, or writes outside this report.

### Claim d1 — LFM ACACACACAC, N=5/arm

Status: **CONFIRMED, with a provenance caveat**.

Evidence and recomputation:

- `results/xiaomi750_validation/raw/d/cells.csv:2-11` declares exactly ten d1 rows in ACACACACAC order: five A (`-ngl 99`) and five C (`-ngl 0`), all `done`. The d1 runner explicitly loads only `^d1,` rows, rejects a count other than ten, and says “No glob” (`results/xiaomi750_validation/raw/d/run_d1.ps1:33-41`). The corresponding `d1_runs.csv` has ten data rows and every rc is `0` (`results/xiaomi750_validation/raw/d/d1_runs.csv:1-11`; the ten `.rc` files independently contain `0`).
- `wake_post` is `mWakefulness=Awake` in every d1 post-wake probe; the run CSV also records Awake for every row (`results/xiaomi750_validation/raw/d/probes/d1_c01_A_wake_post.txt:1`; same-named probes for c02–c10; `results/xiaomi750_validation/raw/d/d1_runs.csv:2-11`). All ten per-cell GGUF lines are the same full LFM hash `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` (`results/xiaomi750_validation/raw/d/probes/d1_c01_A_sha.txt:4`; c02–c10 likewise), and the phase-start device-side probe exists and says `match=YES` (`results/xiaomi750_validation/raw/d/probes/d1_gguf_sha_device.txt:1-7`). This closes the previous on-device-hash gap for d1.
- Parsing all twenty JSON objects from the ten d1 `.out` files gives, at full precision: A tg `[21.902063,23.632221,24.155226,24.589192,24.999394]`, median `24.155226`; C tg `[22.803582,23.673893,24.338497,25.075062,25.093543]`, median `24.338497`; A pp median `88.079815`; C pp median `35.554156`. Therefore A/C tg = `0.992469912994216` -> `0.992`, and A/C pp = `2.47734231126173` -> `2.477`. The saved summary agrees (`results/xiaomi750_validation/raw/d/d1_summary.txt:2-7`).
- Battery probes show unplugged/discharging status for all ten cells (for example `results/xiaomi750_validation/raw/d/probes/d1_c01_A_batt_pre.txt:2-4,10,13`; the same fields are present for c02–c10). The d1 run rows show the expected 90% to 87% decline (`d1_runs.csv:2-11`).

The lock is operational rather than cryptographic: `cells.csv` was created before `d1_runs.csv`, and the runner uses the declared rows, but `cells.csv` was later modified for d2 (its LastWriteTime is later). There is no pre-aggregation hash/snapshot of the d1 plan. That does not refute the ten-row arithmetic, but it weakens the word “locked.”

### Claim d2 — Marco smoke/reboot and surviving CPU arm

Status: **PARTIALLY CONFIRMED; timing/cause require correction**.

Confirmed from disk:

- The PC and device probes record the same 6,385,238,848-byte file and full SHA-256 `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` (`results/xiaomi750_validation/raw/d/probes/d2_gguf_sha_pc.txt:1-3`; `d2_gguf_sha_device.txt:1-9`). The smoke is valid JSONL, rc=0 (`results/xiaomi750_validation/raw/d/d2_smoke.rc:1`; `d2_smoke.out:1-2`), with `-ngl 99`, pp16 `20.401510`, tg8 `23.910132`, commit `1882bf8cd`, and `no_repack=true` (`d2_smoke.out:1-2`).
- No d2 A/B cell artifacts exist under `raw/d`; the only A/B mentions are cancelled plan rows in `cells.csv:12-13,16-19`, all `cancelled_fitgate_failhard`. The CPU C plan is exactly c03/c04/c09 (`cells.csv:14-15,20`), and the C runner selects only `planned_safe_cpu_only`, requires count 3, and forbids the GPU path (`results/xiaomi750_validation/raw/d/run_d2_c.ps1:31-39`).
- The three surviving JSONL cell files each contain pp/tg pairs: c03 `35.102602/27.659435`, c04 `41.783727/28.228514`, c09 `45.827020/31.077595` (`results/xiaomi750_validation/raw/d/cells/d2_c03_C.out:1-2`; c04 and c09 likewise). All have `n_gpu_layers=0`, `no_repack=true`, `n_threads=4`, `flash_attn=0`, commit `1882bf8cd`, and rc=0 (`d2_c03_C.out:1-2`; `d2_c03_C.rc:1`; corresponding c04/c09 files). Full-precision medians are tg `28.228514` -> `28.229` and pp `41.783727` -> `41.784`.
- Battery/thermal/wake probes exist for all three C cells. They are unplugged, status 3, level 82%, and Awake both before and after; pre temperatures are 38.6/38.9/37.9 C (`results/xiaomi750_validation/raw/d/probes/d2_c03_C_batt_pre.txt:2-4,10,13,18`; corresponding c04/c09; wake probes at each `*_wake_pre.txt:1` and `*_wake_post.txt:1`).

The saved timeline proves a reset happened, but not the full causal story. The smoke timestamps are 15:22:24–25 local-equivalent UTC records (`d2_smoke.out:1-2`); crash-buffer lines at 15:22:40 and 15:22:42 say only that `crash_dump` failed or was killed (`results/xiaomi750_validation/raw/d/d2_logcat_crash.txt:3017-3018`). A later logcat capture is still alive through 15:23:30 (`d2_logcat_t500.txt:453-515`), then the first post-reset probe at 15:26:33 reports `up 1 min` (`results/xiaomi750_validation/raw/d/probes/d2_post_kernel_reboot.txt:1-4`). Thus “a reboot/reset occurred after the smoke” is supported; “~3 minutes later,” “kernel reboot” as the exact mechanism, and “delayed watchdog/GPU OOM cause” are not directly proven by the saved logs. The after-reboot crash capture is empty (zero bytes), so it cannot fill that gap (`results/xiaomi750_validation/raw/d/d2_logcat_crash_after_reboot.txt`, size 0).

The report does disclose the duplicate-run problem, but it is material: `d2_runs.csv:2-6` contains c04/c09 twice, with conflicting values (22.654059 and 11.610494 in the first-harness rows versus 28.228514 and 31.077595 in the later rows). `d2_runs_clean.csv:1-4` is a hand-selected derivative. The final cell JSONL and its timestamps match the later rows, and the exclusion is stated in the session report (`scratchpad/agents/q16-xiaomi/REPORT.md:419-421`), so this is not a silent exclusion; however, a run ID/hash or immutable per-run archive is missing.

### Hostile extras

- **Crash versus reboot:** the session report makes the right conceptual distinction: first an owner-observed “crash” while ADB allegedly remained up, then a later reset with uptime back to one minute (`scratchpad/agents/q16-xiaomi/REPORT.md:411-415`). The raw record independently supports only part of this. `d2_logcat_t500.txt:453-515` shows the device/logging path still alive through 15:23:30, and `d2_post_kernel_reboot.txt:1-2` shows a post-reset capture at 15:26:33 with `up 1 min`. The raw archive has no `uptime 6 days`, transport-id 250→268, or “xiaomi resetted” record. Do not misread `d2_postcrash_battery.txt:7` (`+6d2h...`) as uptime: it is the age of a battery broadcast. The first event is therefore **UNVERIFIABLE from disk**; the later reset is **CONFIRMED as an occurrence**, while its exact mechanism and cause remain **UNVERIFIABLE**.
- **Exclusions:** d1 has a declared ten-row set and ten outputs/rcs. d2 has nine declared rows: six cancelled A/B rows and three completed C rows (`results/xiaomi750_validation/raw/d/cells.csv:12-20`), and no A/B cell artifacts were found. This is not a silent cell exclusion. The duplicate c04/c09 records in `d2_runs.csv` are disclosed by the report, but the clean CSV is a post-hoc selection and lacks an immutable run identifier. The audit correction is to treat the final `.out` files as the cited evidence and preserve/identify both harness attempts; do not present `d2_runs.csv` as a one-row-per-cell ledger.
- **Marco C spread:** tg values span `27.659435` to `31.077595`, absolute range `3.418160`, which is `12.11%` of the median (`28.228514`) and a max/min ratio of about `1.1235`. pp spans `35.102602` to `45.827020`, a `10.724418` range, `25.67%` of its median (`41.783727`), max/min about `1.3055`. N=3 is too small for a stability claim, and each cell has one sample. The median is mechanically valid as a descriptive table row, but it must carry a spread/N=3 caveat; it is not robust enough to be shown as a precise stable benchmark.
- **Single-sample honesty:** every d1 JSON object has one `samples_ts` value and `stddev_ts=0` (for example `results/xiaomi750_validation/raw/d/cells/d1_c01_A.out:1-2`), and the same is true of all six d2 C JSON objects (for example `raw/d/cells/d2_c03_C.out:1-2`). The d1 N=5 and d2 N=3 medians are medians across cell-level point estimates, not medians-of-repeated trials within each cell. That aggregation is honest if labeled exactly that way; the zero stddev must not be read as evidence of low measurement noise.
- **Unstated phase-d confound:** all surviving Marco observations are post-reset CPU-only C observations. There is no Marco A/B measurement, so no within-model A/C or A/B performance comparison is identifiable. The C bag is also warm (`37.9–38.9 C` post-cell temperatures; `results/xiaomi750_validation/raw/d/d2_runs.csv:3-6`), and the reboot/reset state is a session boundary. The table can support “CPU-only survived after the fit-gate event,” not a clean full-model arm comparison.

### Phase d verdict

Claim d1: **CONFIRMED** (with the non-cryptographic plan-lock and single-sample caveats above).

Claim d2: **UNVERIFIABLE as literally phrased** for the exact “~3 minutes” timing and kernel/watchdog/GPU-OOM causal label; the hash pair, smoke JSONL, reset occurrence, cancelled A/B set, and C median are **CONFIRMED** from disk.

**BANK-WITH-CORRECTIONS** — bank d1 and the explicitly scoped d2 fit-gate/CPU-survival facts; correct the reboot wording to separate observed reset from inferred cause/timing, retain the duplicate-run warning, and attach the Marco C spread caveat.
