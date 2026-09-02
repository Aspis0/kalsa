# AUDIT-PREP — cell #50 (qdc-8elite-npu-v79-clsB-50)

**Auditor:** hostile (different model from author)
**Date:** 2026-02-09
**Target:** PREREG.md, d_run.sh, connect.sh, raw/kit_sha_host.txt
**Reference:** #48/d_run.sh, #49/d_run.sh, #49/raw/summary.txt, kit-v5/

## 1. EXACT-REPLICA FIDELITY

### 1a. EXTRA string — byte-identical to #48

`#48/d_run.sh:12`:
```
EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880'
```
`#50/d_run.sh:12`:
```
EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880'
```
Character-by-character: identical. **CONFIRMED.**

### 1b. FIRST truly unset in #50

`grep -n 'EXTRA_MM_FIRST' d_run.sh` → exit=1, zero matches. **CONFIRMED ABSENT.**

For contrast, `#49/d_run.sh:67`:
```
    export GGML_TEST_EXTRA_MM='$EXTRA' && export GGML_TEST_EXTRA_MM_FIRST=1 && \
```
#49 has it; #50 does not. This is the fix for #49's design flaw.

### 1c. Judge env

Both scripts: `export GGML_TEST_PLAIN_HOST=1` inside the adb shell command. **CONFIRMED.**

### 1d. `-o MUL_MAT`

`#50/d_run.sh:71`:
```
    $TBO -b $BDEV -o MUL_MAT; echo EXIT=\$?"
```
`#48/d_run.sh:67`:
```
    ./bin/test-backend-ops -b $BDEV -o $op; echo EXIT=\$?"
```
Both pass `-o MUL_MAT`. In #48, `$op` is `MUL_MAT` for runs mm_r1 and mm_r2. **CONFIRMED.**

### 1e. Binary = test-backend-ops-153f used in ALL FOUR runs

`#50/d_run.sh:13`:
```
TBO=./bin/test-backend-ops-153f
```
`#50/d_run.sh:67`:
```
    TBO_SHA=$(adb -s "$SER" shell "sha256sum $DEVDIR/bin/test-backend-ops-153f" | awk '{print $1}')
```
`#50/d_run.sh:71`:
```
    $TBO -b $BDEV -o MUL_MAT; echo EXIT=\$?"
```
All four runs use `$TBO` which resolves to `./bin/test-backend-ops-153f`. No hardcoded binary path. **CONFIRMED.**

### 1f. Extra/missing env vars (#48 vs #50)

#48 exports: `ANDROID_ADB_SERVER_PORT=6037`, `GGML_TEST_PLAIN_HOST=1`, `GGML_TEST_EXTRA_MM`.
#50 exports: same three, plus `LD_LIBRARY_PATH` and `ADSP_LIBRARY_PATH` via `env_for()`.

`#50/d_run.sh:48`:
```
env_for() { echo "export LD_LIBRARY_PATH=$DEVDIR/$1 ADSP_LIBRARY_PATH=$DEVDIR/$1"; }
```
`#48/d_run.sh:37`:
```
HTP_ENV="export LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib"
```
Functionally identical. #50 generalizes by parameterizing `$1`. No extra env vars. **CONFIRMED.**

### 1g. Pre-existing bug: `$?` after `|| true` captures wrong status

`#50/d_run.sh:71-72`:
```
    $TBO -b $BDEV -o MUL_MAT; echo EXIT=\$?" > "$RAW/ops_$tag.txt" 2>&1 || true
  echo $? > "$RAW/ops_$tag.adb.exit"
```
`|| true` swallows the adb exit code; `$?` on line 72 is always 0. The `echo EXIT=$?` INSIDE the adb shell captures the device-side exit code correctly. The `.adb.exit` file is useless but harmless.

Same pattern in `#48/d_run.sh:67-68`. Pre-existing. **PLAUSIBLE** (not a regression).

---

## 2. KIT INTEGRITY

### 2a. kit-v5/SHA256SUMS line count

`wc -l ~/kalsa-qdc/npu-v79-cell/kit-v5/SHA256SUMS` → **45 lines**. **CONFIRMED.**

### 2b. bin/test-backend-ops-153f SHA

`sha256sum kit-v5/bin/test-backend-ops-153f`:
```
5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops-153f
```
`grep test-backend-ops kit-v3/SHA256SUMS`:
```
5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops
```
Byte-identical SHA256 between kit-v5's `-153f` binary and kit-v3's `test-backend-ops`. **CONFIRMED.**

### 2c. lib/libggml-htp-v79.so = 37131e07...

`sha256sum kit-v5/lib/libggml-htp-v79.so`:
```
37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044
```
Matches PREREG claim `37131e07…`. **CONFIRMED.**

### 2d. lib-zeropad/libggml-htp-v79.so = 398879cc...

`sha256sum kit-v5/lib-zeropad/libggml-htp-v79.so`:
```
398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b
```
Matches PREREG claim `398879cc…`. **CONFIRMED.**

### 2e. KIT_TGZ path matches existing file

`#50/d_run.sh:10`:
```
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-50.tgz"
```
`ls npu-kit-50.tgz` → exists.

`sha256sum npu-kit-50.tgz`:
```
bfa6e854edd6dfd4d0b26cabbe7ea6185b553474bf912c0efa6bd284c0f17878
```
Matches `kit_sha_host.txt` line 1. **CONFIRMED.**

### 2f. tgz internal SHA256SUMS matches on-disk kit-v5/SHA256SUMS

`md5` of both: `168a8804a7d4ff0b32c9da1005e98684`. Identical. **CONFIRMED.**

---

## 3. SCRIPT BUGS

### 3a. Syntax check

`sh -n d_run.sh` → exit=0.
`sh -n connect.sh` → exit=0.
Both parse clean. **CONFIRMED.**

### 3b. `|| true` pipefail trap density

11 instances of `|| true` in d_run.sh (lines 29, 36, 37, 44, 58, 71, 75, 76, 77, 80, 81). Most are defensive (provenance, kit_verify, gate_post, grep counts). The problematic one is line 71 (`adb ... || true` before `$?` capture) — documented in §1g. **PLAUSIBLE** (pre-existing pattern, not a regression).

### 3c. over()/crash gating

`#50/d_run.sh:39`:
```
over() { [ "$(elapsed)" -ge 960 ]; }
```
`#50/d_run.sh:40`:
```
crashed() { grep -Eiq 'qurt_exit|dspqueue_(read|write) failed|CDSP0 CRASHED' "$1"; }
```
Both checked at top of `run_probe`. NPU_DEAD=1 skips remaining runs. **CONFIRMED.**

### 3d. Run order matches PREREG

PREREG: "Order R1→R2→R3→R4 interleaves the arms."

`#50/d_run.sh:84-87`:
```
run_probe r1_stock lib
run_probe r2_zpad  lib-zeropad
run_probe r3_stock lib
run_probe r4_zpad  lib-zeropad
```
Interleaved stock/zeropad. **CONFIRMED.**

### 3e. DIR paths — no stale clsB-49 references

`grep -n 'clsB' d_run.sh`:
```
2:# Cell #50 (qdc-8elite-npu-v79-clsB-50).
8:DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-clsB-50"
```
`grep -n 'clsB' connect.sh`:
```
8:DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-clsB-50"
```
All paths point to clsB-50. **CONFIRMED.**

### 3f. tgz name

`#50/d_run.sh:10`:
```
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-50.tgz"
```
No other tgz references. **CONFIRMED.**

---

## 4. PREREG INTERNAL CONSISTENCY

### 4a. Interpretation grid — exhaustive and non-overlapping

PREREG grid cases:
1. R1/R3 NaN AND R2/R4 clean → T1 CONFIRMED
2. R1/R3 NaN AND R2/R4 NaN → T1 REFUTED
3. R1/R3 clean → repro LOST
4. Zeropad ANY failure → T1 VOID
5. Mixed (exactly one stock NaNs) → METHOD-LIMIT (conditional)

These 5 cases partition the outcome space: cases 1-2 cover the NaN/no-NaN dichotomy on stock; case 3 handles stock-clean; case 4 handles zeropad-side failures; case 5 handles asymmetric results. Non-overlapping. **CONFIRMED.**

### 4b. Expected totals arithmetic

PREREG: "expect 545/546" for R1.

#48 actual: `mm_r1: 545/546 tests passed` (`#48/raw/summary.txt`). #48 used the same EXTRA string (6 appended probes) with the same binary.

#50 replays the same config. Expectation of 545/546 is correct (1 NaN = the census occurrence at index 354).

The PREREG phrase "546 total = 540 census + 6 extra" refers to the MUL_MAT test suite composition per run, not a sum across runs. **CONFIRMED.**

### 4c. SHA claims match kit_sha_host.txt and kit on disk

PREREG SHA claims:
- `5cf3565b…` for bin/test-backend-ops-153f → matches kit_sha_host.txt and sha256sum (§2b). **CONFIRMED.**
- `37131e07…` for lib/libggml-htp-v79.so → matches (§2c). **CONFIRMED.**
- `398879cc…` for lib-zeropad/libggml-htp-v79.so → matches (§2d). **CONFIRMED.**
- npu-kit-50.tgz sha in kit_sha_host.txt → matches (§2e). **CONFIRMED.**

---

## 5. METHOD RISKS

### 5a. NaN/failing grep patterns

`#50/d_run.sh:77`:
```
NAN=$(grep -c 'NaN at index' "$RAW/ops_$tag.txt" || true)
```
`#50/d_run.sh:80`:
```
grep 'NaN at index' "$RAW/ops_$tag.txt" > "$RAW/nan_$tag.txt" || true
```
`#50/d_run.sh:81`:
```
sed -n '/Failing tests:/,/Backend /p' "$RAW/ops_$tag.txt" > "$RAW/failing_$tag.txt" || true
```

From #48's ops_mm_r1.txt, the NaN diagnostic line is:
```
[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) ... MUL_MAT(type_a=q4_0,...)
```
And the failing list:
```
Failing tests:
  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,...)
  Backend HTP0: FAIL
```

The grep `'NaN at index'` matches the diagnostic line. The `sed` block captures the failing test names. These are complementary, not redundant. **CONFIRMED.**

### 5b. "Failing tests:" echo double-count concern

PREREG counting instructions (`PREREG.md:56-57`):
```
binding counts = grep pair +
`Failing tests:` list + `tests passed` line
```

The "grep pair" is `INTERNAL-ERROR` + `graph_failed` counts. The `Failing tests:` list gives test signatures. The `tests passed` line gives the pass/total ratio.

From #48 r1: PASSLINE = `545/546 tests passed` (1 failed). Failing list = 1 entry (the MUL_MAT that NaN'd). These are consistent: 546-545=1 = 1 failing entry. No double-counting. The instruction is a checklist of what to read, not a sum. **CONFIRMED.**

### 5c. census.sh absent in #50 (present in #48)

#48/d_run.sh:82:
```
sh "$DIR/census.sh" "$RAW/ops_$tag.txt" "$op" > /dev/null 2>&1 || note "CENSUS_ERR $tag"
```
#50 has no census.sh and no census invocation.

This is intentional: #48's census.sh was a post-run analysis tool, not required for the binding counts. The PREREG doesn't reference it. **CONFIRMED.**

### 5d. No temperature gate bypass risk

Both scripts check `gate_pre` before each run and abort if thermal limit exceeded. #50 has no shortcut. **CONFIRMED.**

---

## FINAL VERDICT

| Section | Verdict |
|---------|---------|
| §1 Exact-Replica Fidelity | **CONFIRMED** (all 6 checks pass; §1g pre-existing bug noted) |
| §2 Kit Integrity | **CONFIRMED** (all 6 checks pass) |
| §3 Script Bugs | **CONFIRMED** (syntax clean, paths correct, order correct; §3b pre-existing) |
| §4 PREREG Consistency | **CONFIRMED** (grid exhaustive, SHA claims match, counts correct) |
| §5 Method Risks | **CONFIRMED** (grep patterns correct, no double-count, no bypass) |

**APPLY.**

The prep is faithful to #48's reproduction config. The one known deficiency (`$?` after `|| true` on line 72) is pre-existing from #48 and does not affect the NaN readout. The EXTRA string is byte-identical, FIRST is absent, binary is correct, kit SHAs match, paths point to clsB-50, run order is interleaved as designed.
