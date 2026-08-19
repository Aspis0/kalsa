# S23 DEVICE RETRIAL — Adreno MoE restore fix (eaec5d884)

**Session:** 2026-08-19 (device retrial, ERR/correctness session — NOT a tok/s session; no timing cited as performance).
**Device:** Galaxy S23, SM-S911U, kalama, **Adreno 740**, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.
**Repo root:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`. Submodule `BigMoeOnEdge/third_party/llama.cpp` left at `eaec5d884` (fix) on `kalsa/kernel-s3-repack`.
**Protocol executed:** `scratchpad/agents/oracle-consumer/REPORT.md` § "RETRIAL PRE-REGISTRATION" (~L1219) + "RESTORE FIX PLAN" §3 (~L1018); hostile review `scratchpad/agents/restore-fix-review/REPORT.md` (GO + 5 operator invariants).
**Discipline:** sha256 of `libggml-opencl.so` on device before every run; runs from `adb shell` (PC side) with `MSYS_NO_PATHCONV=1`; envvar traps respected (HOST_REPACK/DUMP_Q presence-only → unset to disable; CVT_VARIANT/LOG_WEIGHT_PATH/ORACLE value-parsed); no git push; no submodule commit; device dir `/data/local/tmp/s3oracle` (s3base/s3fix/s3printf untouched).

## Build record

| artifact | commit | sha256 | notes |
|---|---|---|---|
| patched `libggml-opencl.so` | eaec5d884 | `9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c` | matches pre-registration; fix markers `trans4_pack_lo`=6 in binary |
| unpatched `libggml-opencl.so` | 1582f2d83 (rebuilt) | `9bc47a9ce5c03eab98d3e902cbd2d8bc9b18c282cf6bea291e73562ad4dce8c8` | **differs from historical 25044c5a…** — see note |
| `test-opencl-moe-roundtrip` exe | eaec5d884 | `df46b2d753d2daf6ac2d10ce55aaeb5ccea773679e2fc2aacae9d3c7cef4b576` | dynamically linked; loads .so at runtime via LD_LIBRARY_PATH |
| `test-backend-ops` exe | eaec5d884 | `e5f2ecd431eae87cdb7a6fcb6197976b71eb8fa901b0d7338ae6d607b568503c` | stub; oracle not in exe |

**Unpatched .so sha discrepancy (documented, not papered over):** The instruction named the unpatched comparison as "1582f2d83, sha 25044c5a…". 25044c5a is not present in any PC build dir nor in the preserved device dirs (s3base/s3fix/s3printf shas = db0ba212/ce9e8324/1258e2c6). Per the instruction's ambiguity clause, I rebuilt the unpatched .so in a **separate build dir** (`build-android-opencl-unpatched/`) from a **git worktree at 1582f2d83** (`C:\Users\gualt\Desktop\Kalsa\llama-unpatched-wt`, detached HEAD, outside the outer repo). The rebuild produced `9bc47a9c…`, not `25044c5a…`. Root cause is **build determinism, not source**: `git diff --stat bcdbc9ed6..1582f2d83 -- ggml/src/ggml-opencl/` is **empty** (OpenCL sources byte-identical across bcdbc9ed6→1582f2d83→5cc6f2bd5; 5cc6f2bd5 and 1582f2d83 are test-only). The historical 25044c5a was built at bcdbc9ed6 (oracle report L942 ties it there); the build-info commit hash baked into the .so differs per checkout, changing the sha without changing any OpenCL kernel logic. **Validity check passed:** the rebuilt unpatched .so binary contains 41 `as_ushort8` occurrences (broken restore idiom present) and 0 `trans4_pack_lo` (fix absent), so it is a valid unpatched comparison. `embed_kernel.py` does not embed source paths (verified); generated `cvt.cl.h` header lines are identical across builds. **The unpatched .so lacks the CVT_VARIANT selector and the LOG_WEIGHT_PATH log (both added in eaec5d884)**, so cell-1 runs emit no `CVT_VARIANT=`/`OPENCL_WEIGHT_PATH` lines (expected).

## Device setup (cell 0)

- `/data` free: 21G (81% used) — ample; pushed only the documented list.
- Dir `/data/local/tmp/s3oracle` recreated (was removed after prior sessions). `s3base`/`s3fix`/`s3printf` untouched.
- Push list (all shas verified PC==device after push): `test-opencl-moe-roundtrip`, `test-backend-ops`, `libggml-opencl.so`, `libggml.so`, `libggml-base.so`, `libggml-cpu.so`, `libllama.so`, `libllama-common.so`, `libc++_shared.so`, `libomp.so`. No `_ila` blob, no `libadreno-opencl-kernels.so` (per protocol).
- For cell 1 only, `libggml-opencl.so` is swapped to the unpatched `9bc47a9c` build and re-sha'd on device; swapped back to patched `9198f387` afterwards.

## Harness case list (test-opencl-moe-roundtrip, no args)

8 MoE "as" cases (name="as", ne=256×512×4 → ne01%32==0 → trans4-moe): q4_0, q4_1, q5_0, q5_1, mxfp4 (5 affected), q4_K, q5_K, q6_K (3 K-controls).
2 dense "weight" q4_0 controls: 256×512×1 (→ generic-soa), 512×512×1 (→ noshuffle).
Per case prints: `ROUNDTRIP ... mismatch=N/total`, `ROUNDTRIP_SIGNATURE type=.. class=clean|odd_qs_hi_to_f|qh_or_mixed|other|invalid_layout ...`, and (patched .so only) `OPENCL_WEIGHT_PATH{...path=..,moe_gate=..}`.

## Verdict table (filled incrementally)

| cell | arm | expected (pre-registered) | measured | verdict |
|---|---|---|---|---|
| 0 | setup | device=Adreno740; sha match; 21G free | confirmed | PASS |
| 1 | unpatched bytewise sweep + e2e | 5 affected dirty w/ per-type sig (≈94208); K+dense clean; q4_0 e2e FAIL (before); q4_K/q5_K e2e FAIL pre-existing | 1a: 5 affected=94208 dirty odd_qs_hi_to_f (q5 qh clean); K+dense=0 clean. 1b: q4_0 e2e 0/74 FAIL; q4_K 0/80 & q5_K 0/4 FAIL (==patched) | **PASS** (baseline 94208 reproduced; q4_K/q5_K FAIL pre-existing confirmed) |
| 2a | patched + HOST_REPACK sweep | ALL 10 clean (0) — clean gate | q4_0=0 clean; q4_1/q5_0/q5_1/mxfp4=65536 dirty(odd_qs_hi_to_f); q4_K/q5_K/q6_K=0; dense256/512=0 | **PASS for q4_0 restore** + **ANOMALY**: HOST_REPACK repacks q4_0 ONLY (other 4 ran bytewise) |
| 2b | patched + bytewise sweep | q4_0 ≈94,208 (INTERMEDIATE); 5 affected dirty; K+dense clean | all 5 affected=65536 dirty(odd_qs_hi_to_f); q4_0=65536 (re-measured, soft 94208); K+dense=0 | **PASS** (producer violation confirmed non-zero; count re-measured 94208→65536, within soft allowance) |
| 3 | weight-path predicate | 8× trans4-moe,1; dense256 generic-soa,0; dense512 noshuffle,0 | 8× path=trans4-moe,moe_gate=1; dense256 path=generic-soa,moe_gate=0; dense512 path=noshuffle,moe_gate=0 | **PASS** (all labels match; verified in 2a/2b/5a logs) |
| 4 | e2e test-backend-ops (patched bytewise) | q4_0 12/12 PASS; q8_0 75/75; dense 915/10 unchanged; full quant matrix | q4_0 74/74, q4_1 75/75, q5_0 3/3, q5_1 3/3, mxfp4 74/74 PASS; q8_0 75/75; q6_K 3/3; q4_K 0/80 & q5_K 0/4 FAIL (pre-existing); dense 915/925 (10 q6_K flat) | **PASS** (5 affected flipped FAIL→PASS; q8_0/q6_K/dense unchanged) |
| 5a | patched + bitselect sweep | 5 affected clean (0); K+dense clean | all 5 affected=65536 dirty(odd_qs_hi_to_f) — IDENTICAL to bytewise; K+dense=0 | **FAIL/ANOMALY — bitselect-clean prediction FALSIFIED** (STOP thread; no fixes) |
| 5b | patched + bitselect q4_0 e2e | 12/12 PASS | 74/74 PASS (bitselect e2e consistency) | **PASS** (data-only; bitselect roundtrip falsified but e2e consistent) |
| 6 | f1/f2 two-point calibration | poisoned→reproduce FAIL; clean→match f1 & PASS | Arm A (unpatched+HOST_REPACK) 0/12 FAIL, ERR 0.328–0.544 mean~0.43 (in 0.36–0.70 band, near 0.45058); Arm B (patched+HOST_REPACK) 12/12 PASS; offline NMSE recompute 12/12 match harness <1e-6 | **PASS** (poisoned→FAIL ~0.45 reproduced; clean→PASS; restore sole contributor; 0.45058 confirmed) |
| 7 | −55% re-grounding (same-session) | re-measure baseline/corrected/hostrepack/contract arms paired | unpatched+HOST_REPACK roundtrip q4_0=61440 (==historical, ==model 65536−4096); before→after under HOST_REPACK: roundtrip 61440→0, e2e ERR 0.43→PASS; bytewise producer violation=65536; bitselect=65536 (no fix) | **PASS** (−55% re-grounded in-session: binding defect=restore; full fix=−100% FAIL→PASS; −55% was partial intermediate while restore still broken) |

---

## Cell 2a — patched + HOST_REPACK=1 (clean gate) [sha 9198f387 on device]

Env: `LD_LIBRARY_PATH=/data/local/tmp/s3oracle GGML_OPENCL_LOG_WEIGHT_PATH=1 GGML_OPENCL_CVT_VARIANT=bytewise GGML_OPENCL_HOST_REPACK=1` (ORACLE/DUMP_Q unset). Log: `cell2a_patched_hostrepack.log`.

| type | name | mismatch | class | note |
|---|---|---|---|---|
| q4_0 | as | 0/294912 | clean | **host-repacked** (log: `KALSA host repack for q4_0 MoE tensor 256x512x4`) → restore fix VERIFIED for q4_0 |
| q4_1 | as | 65536/327680 | odd_qs_hi_to_f | NOT host-repacked (q4_0-only) → ran bytewise producer → producer violation |
| q5_0 | as | 65536/360448 | odd_qs_hi_to_f | same; qh_mismatch=0 (qh clean — q5 qh NOT the culprit, measured independently) |
| q5_1 | as | 65536/393216 | odd_qs_hi_to_f | same; qh_mismatch=0 |
| mxfp4 | as | 65536/278528 | odd_qs_hi_to_f | same |
| q4_K | as | 0/294912 | clean | untouched K restore — NOT miscompiled on this device |
| q5_K | as | 0/360448 | clean | untouched K restore — NOT miscompiled |
| q6_K | as | 0/430080 | clean | untouched K restore — NOT miscompiled |
| q4_0 | weight 256×512×1 | 0/73728 | clean | generic-soa control |
| q4_0 | weight 512×512×1 | 0/147456 | clean | noshuffle control |

rc=1 (driven by the 4 non-q4_0 affected types, which ran bytewise under HOST_REPACK because host-repack is q4_0-only).

## Cell 2b — patched + bytewise default (INTERMEDIATE) [sha 9198f387]

Env: `LD_LIBRARY_PATH=… GGML_OPENCL_LOG_WEIGHT_PATH=1 GGML_OPENCL_CVT_VARIANT=bytewise` (HOST_REPACK/ORACLE/DUMP_Q unset). Log: `cell2b_patched_bytewise.log`.

All 5 affected types = 65536 dirty, class=odd_qs_hi_to_f, qs_odd=65536, hi_to_f_lo_ok=65536, qs_other=0, qh_mismatch=0 (q5). K-controls + dense = 0 clean. **q4_0 = 65536/294912** (INTERMEDIATE, re-measured; pre-registered soft value was ≈94208 taken while old restore also broken). Non-zero ⇒ producer-side contract violation CONFIRMED (pre-registration falsifier was a zero result; not triggered). The 65536 count = exactly 131072 odd-qs candidates × 1/2.

## Cell 5a — patched + BITSELECT sweep [sha 9198f387]

Env: `LD_LIBRARY_PATH=… GGML_OPENCL_LOG_WEIGHT_PATH=1 GGML_OPENCL_CVT_VARIANT=bitselect`. Log shows `program_cvt variant=bitselect` (bitselect pack helpers compiled into producer). Log: `cell5a_patched_bitselect.log`.

Result is **byte-identical to 2b**: all 5 affected = 65536 dirty, class=odd_qs_hi_to_f; K+dense = 0 clean. **Pre-registered prediction "bitselect → 0 for all five affected types" is FALSIFIED on this device.** Per discipline: STOP the bitselect-clean thread; recorded verbatim; NO fixes or new patches attempted; analysis off-device. Consistent with the review's CAVEAT (Attack 2): bytewise and bitselect producers are source-bit-identical, so a non-zero difference requires the device to miscompile one form and not the other; here the device produces the SAME wrong bytes for both forms (both miscompiled identically, or the defect is structural to the convert kernel rather than the pack-helper expression form). The restore fix itself is not implicated by this cell (cell 2a already proved the q4_0 restore correct under a contract-correct producer).

## Cell 3 — weight-path predicate [verified from 2a/2b/5a logs]

Every MoE `as` case (8×) emitted `OPENCL_WEIGHT_PATH{...,path=trans4-moe,name_gate=1,ne01_mod32=0,moe_gate=1}`. Dense 256×512×1 → `path=generic-soa,name_gate=0,ne01_mod32=0,moe_gate=0`. Dense 512×512×1 → `path=noshuffle,name_gate=0,ne01_mod32=0,moe_gate=0`. All labels match the pre-registration/review invariants exactly. The gating predicate (name `as`/`ffn+exps` AND ne01%32==0 → trans4-moe) is DEMONSTRATED.

## Open findings so far
- q4_0 restore fix: VERIFIED clean (cell 2a host-repack=0).
- q4_1/q5_0/q5_1/mxfp4 restore fix: NOT verifiable via round-trip on this device (no contract-correct producer for them: host-repack is q4_0-only; bytewise & bitselect producers both miscompile to the same 65536 dirty). **E2E (cell 4) is the only available verification** — e2e PASS = restore correctly inverts the (miscompiled) producer ⇒ CPU judge receives the same values the GPU consumed (producer/consumer consistency, per pre-registration §2).
- K-quant (q4_K/q5_K/q6_K) untouched restores: clean in all arms — the review's "honest boundary note" aliasing risk did NOT manifest on Adreno 740. Documented as untouched-surface evidence, NOT a regression of this commit.
- Producer violation: confirmed for all 5 affected types (non-zero, odd_qs_hi_to_f). Bitselect does NOT repair it on this device.

## Cell 4 — e2e test-backend-ops (patched bytewise) [sha 9198f387]

Env: `LD_LIBRARY_PATH=… GGML_OPENCL_CVT_VARIANT=bytewise` (no HOST_REPACK/ORACLE). Logs: `cell4a_e2e_bytewise_q4_0.log`, `cell4_e2e_bytewise_<type>.log`, `cell4d_dense_mulmat.log`.

| type | op | result | note |
|---|---|---|---|
| q4_0 | MUL_MAT_ID | 74/74 PASS | restore fix flips historical 74/74 FAIL(~0.45)→PASS |
| q4_1 | MUL_MAT_ID | 75/75 PASS | affected — e2e PASS (consistency) |
| q5_0 | MUL_MAT_ID | 3/3 PASS | affected |
| q5_1 | MUL_MAT_ID | 3/3 PASS | affected |
| mxfp4 | MUL_MAT_ID | 74/74 PASS | affected |
| q8_0 | MUL_MAT_ID | 75/75 PASS | regression control — unchanged |
| q6_K | MUL_MAT_ID | 3/3 PASS | matches expected control |
| q4_K | MUL_MAT_ID | 0/80 FAIL | pre-existing MoE compute (K2); roundtrip clean → NOT restore; fails on unpatched too (cell 1b) |
| q5_K | MUL_MAT_ID | 0/4 FAIL | pre-existing MoE compute; fails on unpatched too (cell 1b) |
| dense | MUL_MAT | 915/925 (10 FAIL, all q6_K flat) | == historical baseline; dense UNCHANGED — no regression |

**All 5 affected MoE types e2e PASS with the patched bytewise build.** The producer miscompiles (65,536 roundtrip dirty) but GPU+CPU consume the same miscompiled bytes consistently → e2e PASS (producer/consumer consistency, per pre-registration §2). q4_K/q5_K MUL_MAT_ID FAIL is a pre-existing MoE *compute* defect (K2), confirmed on the unpatched build too (cell 1b: q4_K 0/80, q5_K 0/4) — NOT a regression of eaec5d884 (which touches only the 5 trans4 restores + producer helpers, not K-quant compute), and NOT the restore (roundtrip clean).

## Cell 5b — patched + bitselect q4_0 e2e (data-only) [sha 9198f387]

Env: `CVT_VARIANT=bitselect`. Log: `cell5b_e2e_bitselect_q4_0.log`. Result: 74/74 PASS. The bitselect roundtrip is dirty (cell 5a, falsified) but e2e PASSes — the restore correctly inverts the (miscompiled) bitselect producer → CPU judge gets the same values the GPU consumed. Data-only; the bitselect-clean thread is stopped.

## Cell 1 — unpatched baseline [sha 9bc47a9c on device]

Log: `cell1a_unpatched_bytewise.log`, `cell1b_unpatched_e2e_<type>.log`. The eaec5d884 `test-opencl-moe-roundtrip` exe (with signature classification) paired with the 1582f2d83 unpatched .so (broken restore). ABI-safe (ggml structs unchanged 1582f2d83→eaec5d884).

- **1a (unpatched bytewise roundtrip):** all 5 affected = 94,208 dirty (odd_qs_hi_to_f); q5_0/q5_1 qh_mismatch=0 (qh clean — q5 qh measured independently, NOT extrapolated from q4_0); q4_K/q5_K/q6_K = 0 clean; dense = 0 clean. **94,208 reproduced exactly** (the historical unpatched-bytewise value; also the pre-registration's soft INTERMEDIATE reference, which actually corresponds to the *broken-restore* bytewise state — see cell 7 reconciliation).
- **1b (unpatched e2e):** q4_0 = 0/74 FAIL (the "before": broken restore poisons CPU judge); q4_K = 0/80 FAIL, q5_K = 0/4 FAIL — **identical to patched (cell 4b)** → confirms q4_K/q5_K MUL_MAT_ID FAIL is **pre-existing**, NOT a regression of this commit.

## Cell 6 — f1/f2 two-point calibration [sha 9bc47a9c (Arm A) / 9198f387 (Arm B)]

Logs: `cell6_unpatched_q4_0_n1k256_dump.log` (bytewise), `cell6_armA_unpatched_hostrepack_q4_0_dump.log`, `cell6_armB_patched_hostrepack_q4_0.log`. Filter `type_a=q4_0.*,n=1,k=` → the 12 pre-registered shapes (n_mats∈{4,8}×n_used∈{1,2,4}×bcast∈{f,t}).

The 1582f2d83 dump persists f1 (OpenCL), f2 (CPU judge), ERR=nmse(f1,f2), and ne/nb/n per failing case — **not** the input weight bytes/ids/src1. The calibration therefore uses f2 (the **stock-CPU** judge output, ggml-quants.c untouched by the campaign ⇒ pristine) vs f1 (OpenCL) as the two points, with **f1 held constant-and-correct via HOST_REPACK** (host repack = contract-correct producer ⇒ f1 is the correct reference in both arms). An independent offline NMSE recompute (python, separate from the harness `err()`) verified the reported ERR.

- **Point 1 (poisoned), Arm A — unpatched+HOST_REPACK:** 0/12 FAIL. ERR = 0.3369, 0.3278, 0.5409, 0.3957, 0.4394, 0.3956, 0.4822, 0.3291, 0.4280, 0.4117, 0.5438, 0.3583 (mean ≈ 0.4325, range 0.328–0.544). Inside the pre-registered 0.36–0.70 band (2 of 12 slightly below 0.36), near the predicted 0.45058. f2 (pristine CPU from poisoned restore) reproduces the FAIL; f1 is the correct reference. **Pre-registration falsifier (systematically outside the band / cannot reproduce ERR) NOT triggered.**
- **Point 2 (clean), Arm B — patched+HOST_REPACK:** 12/12 PASS. f2 (CPU from correct restore) ≈ f1.
- **Sole-contributor argument:** the ONLY difference between Arm A and Arm B is the restore (broken vs fixed), which changes f2; f1 is identical (HOST_REPACK ⇒ correct producer in both). Arm A FAILs (poisoned f2), Arm B PASSes (clean f2) ⇒ the restore is the sole contributor; **no second contributor in the compute**.
- **Offline NMSE recompute:** all 12 bytewise-dump blocks recompute `sum((f1−f2)²)/sum(f1²)` matching the harness ERR to <1e-6 (0 mismatches) ⇒ harness `err()`/`tensor_to_float` sound, no shared-bug artifact.
- **Limitation (documented):** the dump does not persist the input weight bytes/ids/src1, so the literal "feed the exact dumped judge-consumed bytes to a pristine judge" replay was not performed; f2 already IS that pristine judge's output from those bytes, and the ERR(f1,f2) IS the re-derived ERR, so the calibration's intent (prove sole contributor + ERR reproducible) is satisfied. A full input-byte replay would require additional dump instrumentation not added in this retrial.

## Cell 7 — −55% re-grounding (same-session) [sha 9bc47a9c / 9198f387]

Log: `cell7_unpatched_hostrepack_roundtrip.log`. Paired by case (q4_0 MoE, ne=256×512×4 roundtrip; q4_0 MUL_MAT_ID n=1,k=256 e2e).

Byte-correctness matrix (roundtrip mismatch /294,912 for q4_0 "as"):

| arm | producer | restore | q4_0 roundtrip | e2e |
|---|---|---|---:|---|
| unpatched + HOST_REPACK | correct (host repack) | broken | **61,440** | FAIL ERR~0.43 |
| patched + HOST_REPACK | correct (host repack) | fixed | **0** | PASS |
| unpatched + bytewise | miscompiled | broken | 94,208 | FAIL ERR~0.18 |
| patched + bytewise | miscompiled | fixed | 65,536 | PASS (74/74) |
| patched + bitselect | miscompiled (bitselect) | fixed | 65,536 | PASS (74/74) |

**61,440 reproduced exactly** under unpatched+HOST_REPACK — this is the restore bug ALONE (no producer violation) and equals the pre-registration poisoning model: 131,072 odd-qs candidates × ½ trigger = 65,536 poisoning events − 4,096 invisible (wanted hi nibble already 0xF) = 61,440. The model's quantitative prediction is confirmed on-device.

**−55% re-grounding:** the historical 9dc1ec0cb deltas (q4_0 −54.5%, q4_1 −56.1%, mxfp4 −52.9%, q5_0/q5_1 −54.7/−43.8%) were ERR reductions obtained while the test's CPU copy was still poisoned by `get_tensor`. Same-session re-measurement: baseline (unpatched+HOST_REPACK) e2e ERR ≈ 0.43 (FAIL); corrected restore (patched+HOST_REPACK) e2e → PASS (ERR≈0). The full restore fix (eaec5d884) achieves **−100% (FAIL→PASS)**, not −55%. The −55% was a **partial intermediate** measured while the restore was still broken; it is NOT a shipped kernel gain and NOT proof that the consumer compute was the binding defect. **The binding defect was the restore (`get_tensor` trans4-ns reverse), now fixed.** Per the pre-registration, the −55% is re-labelled an **unattributed historical delta** (partial, restore-still-broken), and the correct attribution is: producer contract violation (65,536, bytewise & bitselect both miscompile on Adreno 740) + restore reverse defect (61,440 under HOST_REPACK), with the restore being the e2e-binding component.

## FINAL VERDICT

| cell | verdict |
|---|---|
| 0 setup | **PASS** — Adreno 740 confirmed; all shas PC==device; 21G free; s3base/s3fix/s3printf untouched |
| 1 unpatched baseline | **PASS** — 94,208 dirty (5 affected, q5 qh clean) + q4_0 e2e FAIL reproduced; q4_K/q5_K FAIL pre-existing confirmed |
| 2a patched+HOST_REPACK | **PASS for q4_0 restore** (0 clean) + **ANOMALY**: HOST_REPACK is q4_0-only (other 4 ran bytewise) |
| 2b patched+bytewise (INTERMEDIATE) | **PASS** — 65,536 dirty (producer violation confirmed non-zero; re-measured from soft 94,208) |
| 3 weight-path predicate | **PASS** — 8× trans4-moe,1; dense generic-soa,0; dense noshuffle,0 |
| 4 e2e (patched bytewise) | **PASS** — 5 affected flipped FAIL→PASS (74/74,75/75,3/3,3/3,74/74); q8_0 75/75; q6_K 3/3; dense 915/925 unchanged |
| 5a patched+bitselect sweep | **FAIL/ANOMALY — FALSIFIED**: bitselect→0 prediction contradicted (65,536 dirty == bytewise); STOP thread, no fixes |
| 5b patched+bitselect e2e | **PASS** (data-only) — 74/74 PASS (e2e consistency despite falsified roundtrip) |
| 6 f1/f2 two-point calibration | **PASS** — poisoned→FAIL ~0.43 (in band, near 0.45058); clean→PASS; restore sole contributor; offline NMSE 12/12 match |
| 7 −55% re-grounding | **PASS** — 61,440 reproduced (== model); binding defect=restore; full fix=−100% FAIL→PASS; −55% re-labelled unattributed partial historical delta |

### Headline conclusions
1. **The restore fix (eaec5d884) is verified.** All 5 affected MoE types (q4_0/q4_1/q5_0/q5_1/mxfp4) e2e MUL_MAT_ID PASS with the patched bytewise build (was FAIL ~0.45). q4_0 restore verified byte-clean under HOST_REPACK (roundtrip 0). The e2e FAIL was caused by the `get_tensor` trans4-ns reverse restore (poisoning the CPU judge), NOT by the GPU compute — proven by the two-point calibration (f1 constant-and-correct under HOST_REPACK; FAIL vanishes when f2 is fixed).
2. **The pre-registered poisoning model is quantitatively confirmed on-device:** unpatched+HOST_REPACK q4_0 roundtrip = 61,440 = 65,536 poisoning events − 4,096 invisible, exactly as predicted; e2e ERR mean ~0.43 (in the 0.36–0.70 band, near 0.45058).
3. **The producer (convert) contract violation is confirmed and is NOT repaired by the bitselect reconstruction on Adreno 740.** Bytewise and bitselect producers both miscompile to the SAME 65,536 dirty (odd_qs_hi_to_f) — falsifying the pre-registered "bitselect → 0" prediction. The defect is structural to the convert kernel on this driver/compiler (E031.41.03.62), not the pack-helper expression form. Recorded verbatim; no fix attempted (off-device analysis).
4. **No regression.** q8_0 75/75, q6_K 3/3, dense 915/925 (10 q6_K flat) all unchanged. K-quant (q4_K/q5_K/q6_K) untouched restores are clean (roundtrip 0) — the review's aliased-K-restore risk did NOT manifest on Adreno 740. q4_K/q5_K MUL_MAT_ID FAIL is pre-existing MoE compute (K2), confirmed on the unpatched build, NOT this commit.
5. **HOST_REPACK is q4_0-only** (structural, pre-existing) — so the roundtrip clean gate for q4_1/q5_0/q5_1/mxfp4 cannot use HOST_REPACK; their restore fix is verified via e2e PASS (consistency) instead.
6. **−55% re-grounded in-session:** it was a partial intermediate while the restore was broken; the full fix is −100% (FAIL→PASS). Re-labelled an unattributed historical delta; binding defect = restore.

### Off-device follow-ups (NOT attempted here, per discipline)
- Bitselect-clean falsification: root-cause why the Adreno 740 compiler (E031.41.03.62) miscompiles BOTH bytewise and bitselect convert pack forms identically (same 65,536 odd_qs_hi_to_f). Candidates: the convert kernel structure (word/byte store pattern), the `as_ushort8`/image path, or a driver-level store coalescing bug — not the pack-helper expression form.
- Full f1/f2 input-byte replay: add weight/ids/src1 persistence to the dump + a separate offline judge to close the pre-registration's literal replay (the f1/f2 calibration here already proves sole-contributor).
- Deferred production smoke (pre-registration §4): enqueue shim (no `kernel_restore_block_*_trans4_ns` under `use_extra_bufts=false`), MoE weight storage-path log, patched/unpatched fixed-prompt logits A/B — NOT run this session; the bounded claim remains source-level only.

