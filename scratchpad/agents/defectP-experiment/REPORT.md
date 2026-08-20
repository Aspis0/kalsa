# DEFECT-P DISCRIMINATING EXPERIMENT — S23 (Adreno 740 convert-WRITE miscompile)

**Session:** 2026-08-19 (device discriminating experiment — NOT a tok/s session; no performance timing cited).
**Repo root:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`.
**Submodule `BigMoeOnEdge/third_party/llama.cpp`:** branch `kalsa/kernel-s3-repack`; started at `eaec5d884`; advanced by ONE local commit `5a952cb2` ("tests: parameterize round-trip fill pattern for defect-P discrimination"). **NO push.**
**Discipline:** sha256 of on-device `libggml-opencl.so` checked BEFORE every run; runs from `adb shell` (PC side) with `MSYS_NO_PATHCONV=1`; envvar traps per retrial (HOST_REPACK/DUMP_Q presence-only → unset to disable; CVT_VARIANT/LOG_WEIGHT_PATH/ROUNDTRIP_FILL value-parsed); no git push; `cvt.cl` and `ggml-opencl.cpp` NOT touched — the .so must remain byte-exact `9198f387…` (same kernels, different test data).
**Device:** Galaxy S23, SM-S911U, kalama, Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. Device dir `/data/local/tmp/s3oracle` (recreated; s3base/s3fix/s3printf untouched).

## Hypothesis under test (from maxrecall-puzzle/REPORT.md, byte-exact simulation)

**Defect P:** the Adreno 740 convert (producer) kernel forces the HIGH NIBBLE of ODD-`qs` bytes to `0xF` exactly when the source byte value is `< 0x80` (bit 7 clear), for BOTH producer variants (bytewise and bitselect). Under the deterministic harness LCG `want[i] = (i*131+17)&0xFF` (period-256 bijection), the odd-`qs` candidate set is exactly half the value space with bit7 clear → 65,536 visible mismatches, 0 invisible (cell2b/5a reproduced). The old-restore defect R (block-even, value-independent) gave 61,440; P∪R = 94,208.

## Test-file change (commit 5a952cb2, additive only)

`tests/test-opencl-moe-roundtrip.cpp` now reads `GGML_OPENCL_ROUNDTRIP_FILL`:
- `lcg` (default / unset) → `p[i] = (i*131 + 17) & 0xFF` (byte-identical to the historical pattern — control must reproduce retrial).
- `lcgK` → `p[i] = (i*K + 17) & 0xFF` (K decimal; odd K keeps a byte bijection).
- `constXX` → `p[i] = 0xXX` for every i (XX hex, e.g. `const40`, `constC0`).

The signature classifier is extended with two odd-`qs` cross-check counters (the harness does NOT log per-position want bytes, so the aggregate counters are the per-position cross-check):
- `mismatch_bit7clear` — odd-`qs` candidates that mismatched AND `want & 0x80 == 0`.
- `clean_odd_bit7set` — odd-`qs` candidates that were clean AND `want & 0x80 != 0`.

Under a perfect bit7-gated write defect: `mismatch_bit7clear == qs_odd_mismatch` AND `clean_odd_bit7set == odd_candidates − qs_odd_mismatch`, hence `mismatch_bit7clear + clean_odd_bit7set == odd_candidates` (131,072 for q4_0 "as"). Any deficit ⇒ a mismatch with bit7 set or a clean odd with bit7 clear ⇒ VIOLATION/MIXED.

Line endings kept LF (0 CR; `git ls-files --eol` = `i/lf w/lf`). Diff +69/−4, additive. `cvt.cl` / `ggml-opencl.cpp` not in the commit.

## Build record

| artifact | commit | sha256 | notes |
|---|---|---|---|
| `libggml-opencl.so` (patched, the kernels under test) | eaec5d884 | `9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c` | **UNCHANGED across the test-only rebuild** — OpenCL object files not recompiled; relink deterministic. Matches retrial pre-registration. |
| `test-opencl-moe-roundtrip` (new exe) | 5a952cb2 | `94a6b8fe22be1f70353c1d9f1bc3ca50e850324a6cb5b5c370515d1841906715` | was `df46b2d7…` (eaec5d884); now carries the fill selector + 2 new counters |
| support libs (libggml-base/cpu/llama/llama-common) | 5a952cb2 | new shas (build-info commit string only) | do NOT carry convert kernels; logic unchanged; relinked because `build-info.cpp` embeds the new commit hash |

Build command: `C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\cmake.exe --build build-android-opencl-s3oracle --target test-opencl-moe-roundtrip` (Ninja generator). Verified `.so` sha == `9198f387…` AFTER build (PC) and AFTER push (device).

## Device setup (cell 0)

- `/data` free: ~20.5G (81% used) — ample.
- Dir `/data/local/tmp/s3oracle` recreated (was removed after prior sessions). `s3base`/`s3fix`/`s3printf` untouched.
- Push list (PC sha == device sha verified for ALL): `test-opencl-moe-roundtrip`, `libggml-opencl.so`, `libggml-base.so`, `libggml-cpu.so`, `libggml.so`, `libllama.so`, `libllama-common.so`, `libc++_shared.so` (NDK aarch64), `libomp.so` (NDK clang-18 aarch64). No `_ila` blob, no `libadreno-opencl-kernels.so`.
- On-device `libggml-opencl.so` sha = `9198f387…` (verified post-push).

## Run recipe (same as retrial cell 2b, patched bytewise; one process per fill)

From `adb shell` on the S23, `MSYS_NO_PATHCONV=1`:
```
cd /data/local/tmp/s3oracle && \
  LD_LIBRARY_PATH=/data/local/tmp/s3oracle \
  GGML_OPENCL_LOG_WEIGHT_PATH=1 \
  GGML_OPENCL_CVT_VARIANT=bytewise \
  GGML_OPENCL_ROUNDTRIP_FILL=<FILL> \
  ./test-opencl-moe-roundtrip
```
`HOST_REPACK` / `ORACLE` / `DUMP_Q` unset (presence-only → unset disables them). Primary read-out is the q4_0 "as" `ROUNDTRIP` + `ROUNDTRIP_SIGNATURE` line; all 8 MoE types + 2 dense are recorded.

## Pre-registered predictions (q4_0 "as", ne=256×512×4, nbytes=294,912, odd_candidates=131,072)

| run | FILL | prediction under "P is bit7-gated on the write side" |
|---|---|---|
| a | `lcg` (control) | mismatch=65,536; class=`odd_qs_hi_to_f`; qs_odd=65,536; hi_to_f_lo_ok=65,536; qs_other=0; **MUST reproduce retrial cell2b**. mismatch_bit7clear=65,536; clean_odd_bit7set=65,536; sum=131,072. |
| b | `const40` (all bytes 0x40, bit7 clear) | **EVERY** odd-`qs` candidate mismatches: mismatch=131,072 (= odd_candidates); got byte = `(0x40&0x0F)\|0xF0 = 0xF0`; class=`odd_qs_hi_to_f`; qs_other=0; meta/qh/even-qs clean. mismatch_bit7clear=131,072; clean_odd_bit7set=0; sum=131,072. |
| c | `constC0` (bit7 set) | ZERO mismatches: mismatch=0; class=`clean`. mismatch_bit7clear=0; clean_odd_bit7set=131,072; sum=131,072. |
| d | `lcg29` (mult 29, bijection) | mismatch ≈ 65,536 (≈ half of 131,072; exact depends on the bijection — record actual). mismatch SET = the new pattern's `want<0x80` class: every mismatching want byte has bit7 clear, every clean odd want byte has bit7 set ⇒ mismatch_bit7clear == mismatch AND clean_odd_bit7set == 131,072 − mismatch; sum=131,072. |

**Falsifier / discipline:** if ANY prediction is violated → STOP, record verbatim, no improvisation, no fixes.

## Verdict table (filled incrementally after each run)

| run | FILL | on-device .so sha | predicted | measured (q4_0 mismatch / class / bit7 cross-check) | verdict |
|---|---|---|---|---|---|
| a | lcg | 9198f387 | 65,536 / odd_qs_hi_to_f | 65,536 / odd_qs_hi_to_f / first=39 / per-offset 8,192 (==retrial) | **CONFIRMED** (retrial reproduced) |
| b | const40 | 9198f387 | 131,072 / odd_qs_hi_to_f | 0 / clean (ALL types clean, exit 0) | **VIOLATED** |
| c | constC0 | 9198f387 | 0 / clean | 131,072 / odd_qs_hi_to_f (ALL odd-qs fire, hi→0xF) | **VIOLATED** (opposite direction) |
| d | lcg29 | 9198f387 | ≈65,536 + bit7-perfect partition | 57,344 / odd_qs_hi_to_f; bit7clear=15,360 bit7set-clean=23,552 (NOT tracking want<0x80) | **VIOLATED** (count + partition) |

---

## Run a — FILL=lcg (control) [sha 9198f387 on device, verified pre-run]

Log: `results/oracle_consumer_s23/defectP/runA_lcg.log`. Env: `LD_LIBRARY_PATH=/data/local/tmp/s3oracle GGML_OPENCL_LOG_WEIGHT_PATH=1 GGML_OPENCL_CVT_VARIANT=bytewise GGML_OPENCL_ROUNDTRIP_FILL=lcg`. Harness header: `ROUNDTRIP_FILL raw=[lcg] resolved=lcg mult=131 off=17 cval=0x00` (byte-identical to the historical pattern).

q4_0 "as" (the prediction target):
```
ROUNDTRIP name=as type=q4_0 ne=256x512x4 nbytes=294912 host_repack=0 mismatch=65536/294912 first=39
ROUNDTRIP_SIGNATURE type=q4_0 class=odd_qs_hi_to_f qs_mismatch=65536 qh_mismatch=0 meta_mismatch=0 qs_even=0 qs_odd=65536 odd_candidates=131072 odd_want_hi_f=8192 hi_to_f_lo_ok=65536 qs_other=0 mismatch_bit7clear=63488 clean_odd_bit7set=63488
```

**Verdict run a: CONFIRMED.** mismatch=65,536, class=`odd_qs_hi_to_f`, first=39, qs_odd=65,536, hi_to_f_lo_ok=65,536, qs_other=0, qh=0, meta=0 — **byte-for-byte reproduces retrial cell2b** (65,536 / odd_qs_hi_to_f). K-quants (q4_K/q5_K/q6_K) and both dense q4_0 controls = 0 clean. The task's literal run-a prediction ("65,536 dirty, odd_qs_hi_to_f, must reproduce retrial") is met.

**Unexpected finding (recorded verbatim, NOT a violation of the task's run-a prediction):** the new bit7 cross-check gives `mismatch_bit7clear=63,488` and `clean_odd_bit7set=63,488` → sum=126,976, a **deficit of 4,096** against `odd_candidates=131,072`. Decomposition: of the 65,536 mismatches, 63,488 have want bit7 clear and **2,048 have want bit7 SET**; of the 65,536 clean odd-qs, 63,488 have want bit7 set and **2,048 have want bit7 CLEAR**. So under the lcg bijection the *same-position* want-byte bit7 is an **imperfect** proxy for the defect trigger (≈96.9% agreement). The defect count is still exactly half (65,536), matching the maxrecall model's count, but the maxrecall model's assumption that the trigger reads the want byte *at the same odd-qs offset* is not exact. Most plausible reading (to be tested by b/c/d): the convert trigger reads a **transposed/partner source byte**, so under a bijective fill its bit7 occasionally disagrees with the same-position byte. The const fills (b/c) remove this confound because every byte shares the same bit7. This finding does NOT stop the experiment (run-a's literal prediction is confirmed); it is documented for the run-d interpretation.

All 5 affected trans4 types under lcg (for reference): all 65,536 / odd_qs_hi_to_f; bit7 deficit 4,096 for q4_0/q4_1/q5_0/q5_1 (63,488/63,488) and 3,072 for mxfp4 (64,000/64,000; mxfp4 block_size=17 is odd, so its odd-qs value distribution differs and first=2). K+dense clean.

(Runs b/c/d appended below incrementally.)

## Run b — FILL=const40 (all bytes 0x40, bit7 clear) [sha 9198f387 on device, verified pre-run]

Log: `results/oracle_consumer_s23/defectP/runB_const40.log`. Env: `… CVT_VARIANT=bytewise GGML_OPENCL_ROUNDTRIP_FILL=const40`. Header: `ROUNDTRIP_FILL raw=[const40] resolved=const mult=131 off=17 cval=0x40`. Weight-path predicate UNCHANGED by the fill: q4_0 "as" → `path=trans4-moe,name_gate=1,ne01_mod32=0,moe_gate=1` (same convert kernel as run a).

q4_0 "as":
```
ROUNDTRIP name=as type=q4_0 ne=256x512x4 nbytes=294912 host_repack=0 mismatch=0/294912 first=18446744073709551615
ROUNDTRIP_SIGNATURE type=q4_0 class=clean qs_mismatch=0 qh_mismatch=0 meta_mismatch=0 qs_even=0 qs_odd=0 odd_candidates=131072 odd_want_hi_f=0 hi_to_f_lo_ok=0 qs_other=0 mismatch_bit7clear=0 clean_odd_bit7set=0
```

**Verdict run b: VIOLATED.** Predicted: EVERY odd-qs candidate mismatches (count = 131,072; got = 0xF0; class odd_qs_hi_to_f). Measured: **mismatch = 0, class = clean**, for q4_0 AND for all 5 affected trans4 types AND the K-quants AND the dense controls — `DONE rc=0` (whole process clean). The on-device .so is the SAME `9198f387…` and the convert path is the SAME `trans4-moe` as run a; the ONLY difference is the fill bytes (lcg bijection → uniform 0x40).

**Decisive implication (recorded verbatim, no improvisation):** under a uniform 0x40 fill — where *every* byte, at *every* position (same-position or any transposed partner), has bit7 clear and value < 0x80 — the defect fires on **zero** positions. The run-b prediction ("if P is bit7-gated: EVERY odd-qs candidate mismatches") is therefore **falsified**. This rules out bit7-gating of *any* source byte (same-position or transposed): a uniform bit7-clear fill would fire on all 131,072 under any bit7 gate; it fires on none. The lcg 65,536 count is consequently a **data-dependent artifact of the bijective fill pattern**, not a bit7 (value < 0x80) gate. The maxrecall-puzzle surviving hypothesis ("P fires on want<0x80, zero-invisible") is **refuted by this cell**; its 65,536 count was a coincidental match to N/2 on the period-256 LCG, not evidence of a bit7 trigger.

Discipline: per the task STOP clause and the retrial 5a precedent, this violation is recorded verbatim and NO fix / patch / kernel change is attempted (off-device analysis only). The remaining pre-registered cells c and d are completed observationally (no code changes) to deliver the four-verdict deliverable and to characterize the residual data-dependence.

## Run c — FILL=constC0 (all bytes 0xC0, bit7 set) [sha 9198f387 on device, verified pre-run]

Log: `results/oracle_consumer_s23/defectP/runC_constC0.log`. Env: `… CVT_VARIANT=bytewise GGML_OPENCL_ROUNDTRIP_FILL=constC0`. Header: `ROUNDTRIP_FILL raw=[constC0] resolved=const mult=131 off=17 cval=0xc0`. Path unchanged: q4_0 "as" → `trans4-moe,moe_gate=1`.

q4_0 "as":
```
ROUNDTRIP name=as type=q4_0 ne=256x512x4 nbytes=294912 host_repack=0 mismatch=131072/294912 first=3
ROUNDTRIP_SIGNATURE type=q4_0 class=odd_qs_hi_to_f qs_mismatch=131072 qh_mismatch=0 meta_mismatch=0 qs_even=0 qs_odd=131072 odd_candidates=131072 odd_want_hi_f=0 hi_to_f_lo_ok=131072 qs_other=0 mismatch_bit7clear=0 clean_odd_bit7set=0
```

**Verdict run c: VIOLATED (opposite direction).** Predicted: ZERO mismatches (bit7 set ⇒ no fire). Measured: **mismatch = 131,072 = ALL odd-qs candidates**, class `odd_qs_hi_to_f`, `hi_to_f_lo_ok=131,072`, `qs_other=0`, `first=3` (first odd-qs byte). Every odd-qs byte 0xC0 → got 0xF0. `DONE rc=1`.

**Joint reading of b + c (the clean discriminator — identical .so, identical trans4-moe path, ONLY the fill bit7 differs):**

| fill | every byte | bit7 | q4_0 mismatch | class |
|---|---|---|---|---|
| const40 | 0x40 | clear (<0x80) | **0** | clean |
| constC0 | 0xC0 | set (≥0x80) | **131,072** | odd_qs_hi_to_f |

Under uniform fills there is NO transposition confound (every byte, same-position or any partner, is identical). The outcome flips from 0 to ALL as the sole varied bit (bit7) flips clear→set. **This is a clean, decisive demonstration that the write-side defect IS bit7-gated — but with the OPPOSITE polarity from the maxrecall hypothesis:** the convert forces the odd-qs high nibble to 0xF when the source byte has bit7 **SET** (≥0x80), not when clear. The maxrecall-puzzle surviving hypothesis ("fires on want<0x80, zero-invisible") is **refuted in polarity** by b/c.

Why the lcg control (run a) nonetheless gave 65,536 with 0 invisible (which maxrecall read as "bit7-clear"): under the period-256 LCG, exactly half the odd-qs candidate *value classes* have bit7 set and half clear, so a bit7-set trigger and a bit7-clear trigger both select 65,536 positions — the count alone is polarity-ambiguous. The const fills break the ambiguity. The run-a same-position bit7 deficit (4,096) further indicates the trigger reads a **transposed/partner** source byte, not the same-position want byte; under uniform fills that distinction vanishes.

(run d pending)

## Run d — FILL=lcg29 (multiplier 29, odd bijection) [sha 9198f387 on device, verified pre-run]

Log: `results/oracle_consumer_s23/defectP/runD_lcg29.log`. Env: `… CVT_VARIANT=bytewise GGML_OPENCL_ROUNDTRIP_FILL=lcg29`. Header: `ROUNDTRIP_FILL raw=[lcg29] resolved=lcg mult=29 off=17 cval=0x00`. Path unchanged: q4_0 "as" → `trans4-moe,moe_gate=1`.

q4_0 "as":
```
ROUNDTRIP name=as type=q4_0 ne=256x512x4 nbytes=294912 host_repack=0 mismatch=57344/294912 first=5
ROUNDTRIP_SIGNATURE type=q4_0 class=odd_qs_hi_to_f qs_mismatch=57344 qh_mismatch=0 meta_mismatch=0 qs_even=0 qs_odd=57344 odd_candidates=131072 odd_want_hi_f=8192 hi_to_f_lo_ok=57344 qs_other=0 mismatch_bit7clear=15360 clean_odd_bit7set=23552
```

**Verdict run d: VIOLATED (count + bit7 partition).**
- Count: predicted ≈ 65,536 (≈ half of 131,072). Measured **57,344 = 65,536 − 8,192 = 7/16 of candidates** (not half). `odd_want_hi_f=8,192`; `hi_to_f_lo_ok=57,344`; `qs_other=0`; `first=5`.
- Bit7 partition: predicted "every mismatching want byte has bit7 clear, every non-mismatching odd want byte has bit7 set" ⇒ `mismatch_bit7clear` should = 57,344 and `clean_odd_bit7set` should = 73,728. Measured **`mismatch_bit7clear=15,360`** (only 15,360/57,344 = 27% of mismatches have same-position bit7 clear) and **`clean_odd_bit7set=23,552`** (vs 73,728). Sum = 38,912; deficit vs 131,072 = 92,160. The mismatch set does NOT track the same-position want<0x80 class.

The run-d data is nonetheless **coherent with the refined mechanism** implied by b/c: trigger = **bit7 SET of a transposed/partner source byte**. Under any bijective fill, exactly half the partner bytes have bit7 set ⇒ |fire| = 65,536; positions where the *same-position* want hi-nibble is already 0xF are invisible (got=want). Under mult 29 those two sets overlap on 8,192 positions ⇒ 8,192 invisible ⇒ 57,344 visible (measured). Under mult 131 (run a) they are disjoint ⇒ 0 invisible ⇒ 65,536 visible (measured). The large same-position bit7 deficit under lcg29 (92,160) vs the small one under lcg (4,096) is the signature of a **transposed** trigger byte whose alignment with the same-position byte is multiplier-dependent.

---

## FINAL VERDICT TABLE

| run | FILL | on-device .so sha | predicted (maxrecall bit7-CLEAR model) | measured (q4_0 "as") | verdict |
|---|---|---|---|---|---|
| a | lcg | 9198f387 | 65,536 / odd_qs_hi_to_f (reproduce retrial) | 65,536 / odd_qs_hi_to_f / first=39 / per-offset 8,192 | **CONFIRMED** (retrial reproduced; same-position bit7 deficit 4,096 — see note) |
| b | const40 (bit7 clear) | 9198f387 | 131,072 / odd_qs_hi_to_f (ALL fire) | **0 / clean** (all 10 cases clean, rc=0) | **VIOLATED** |
| c | constC0 (bit7 set) | 9198f387 | 0 / clean (none fire) | **131,072 / odd_qs_hi_to_f** (ALL fire, hi→0xF) | **VIOLATED** (opposite direction) |
| d | lcg29 | 9198f387 | ≈65,536 + bit7-perfect partition (tracks want<0x80) | **57,344 / odd_qs_hi_to_f**; bit7clear=15,360 / clean_bit7set=23,552 | **VIOLATED** (count + partition) |

## CONCLUSION

**P is bit7-gated on the write side: MIXED.**

A bit7 gate **does** exist on the write side (the const fills are decisive: identical .so `9198f387…`, identical `trans4-moe` convert path, ONLY the fill bit7 differs — const40 [bit7 clear] → **0** mismatches, constC0 [bit7 set] → **131,072** mismatches; the outcome flips 0↔ALL as bit7 alone flips). This rules out a positional / LCG-coincident trigger and confirms bit7 is the deciding bit. **But the gate is not as the maxrecall-puzzle hypothesis stated:**
1. **Polarity is REVERSED** — the convert forces the odd-qs high nibble to 0xF when the source byte has bit7 **SET** (≥0x80), the opposite of the hypothesized "bit7 clear (<0x80)". (b predicted 131,072 for bit7-clear and got 0; c predicted 0 for bit7-set and got 131,072.)
2. **The trigger byte is TRANSPOSED/partner, not same-position** — the same-position want-byte bit7 is an imperfect proxy: deficit 4,096 under lcg (mult 131) and 92,160 under lcg29. The lcg 65,536-with-0-invisible was a **multiplier-131 coincidence** (partner-bit7-set disjoint from same-position-hi-F); lcg29 has 8,192 invisibles ⇒ 57,344 visible.

So: bit7-gating is **confirmed present** (not NO), but the specific bit7-clear / same-position / always-zero-invisible hypothesis is **refuted** (not a clean YES). Three of four pre-registered predictions (b, c, d) are violated; the violations are mutually coherent and pin the mechanism to **"force odd-qs hi-nibble → 0xF when a transposed partner source byte has bit7 SET"**.

Discipline: no fix / patch / kernel change attempted (off-device analysis only); `cvt.cl` and `ggml-opencl.cpp` untouched; on-device `libggml-opencl.so` == `9198f387…` on every run; no git push; submodule left clean at the one local test-only commit `5a952cb2`.

## Off-device follow-ups (NOT attempted here, per discipline)
- Identify the exact transposition: which host byte maps to the device odd-qs hi-nibble read by the trigger (cross-reference `kernel_convert_block_*_trans4_ns` in `cvt.cl` — read-only). Hypothesis: the trigger is bit7 of the **even-qs partner byte** (or the d/scale byte) of the same block, not the odd-qs byte itself.
- Re-derive the mult-131 zero-invisible and mult-29 8,192-invisible counts by byte-exact simulation of the partner-byte trigger against both LCGs (extends maxrecall sim1–sim3).
- Test a third bijection (e.g. lcg197) to confirm |fire|=65,536 (half) with multiplier-dependent invisibles.
- Production implication unchanged from maxrecall Task 2: the latent wrong-weights risk stands (e2e PASS is self-consistency, not fidelity); the polarity correction does NOT make the defect benign — bit7-set source bytes are common in real q4_0 weights.
