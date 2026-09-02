# AUDIT-PREP — cell #51 (qdc-8elite-npu-v79-clsB-51)

**Auditor:** hostile (different model from author)
**Date:** 2026-02-09
**Target:** PREREG.md, d_run.sh, connect.sh, raw/kit_sha_host.txt
**Reference:** #50/d_run.sh, #50/PREREG.md, #50/AUDIT-PREP.md (audited baseline this cell replays), kit-v6/

## 1. SINGLE-VARIABLE INTEGRITY (THE CRITICAL CHECK)

### 1a. lib/ vs lib-fix/ — exactly one file differs

`ls ~/kalsa-qdc/npu-v79-cell/kit-v6/lib/ | wc -l` → **20 files**.
`ls ~/kalsa-qdc/npu-v79-cell/kit-v6/lib-fix/ | wc -l` → **20 files**.

`diff <(cd lib && shasum -a 256 * | sort) <(cd lib-fix && shasum -a 256 * | sort)`:
```
20c20
< e91fbcef...  libggml-hexagon.so
---
> e95fa35e...  libggml-hexagon.so
```

Single differing file: `libggml-hexagon.so`. lib = `e91fbcef71f0...` (buggy, 777,416 B). lib-fix = `e95fa35eed6e...` (descfix, 777,464 B). All 19 other files — byte-identical. **CONFIRMED.**

### 1b. Skel identical in both dirs

`lib/libggml-htp-v79.so` = `37131e079e14...`
`lib-fix/libggml-htp-v79.so` = `37131e079e14...`

PREREG line: "Skel byte-identical certified `37131e07…` in BOTH dirs." **CONFIRMED.**

### 1c. PREREG SHA claims match kit_sha_host.txt

PREREG line `lib-fix/libggml-hexagon.so` sha `e95fa35e…` → kit_sha_host.txt:
```
e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a  lib-fix/libggml-hexagon.so
```
**CONFIRMED.**

PREREG line `lib/libggml-hexagon.so` sha `e91fbcef…` → kit_sha_host.txt:
```
e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba  lib/libggml-hexagon.so
```
**CONFIRMED.**

PREREG skel `37131e07…` → kit_sha_host.txt:
```
37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib-fix/libggml-htp-v79.so
37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib/libggml-htp-v79.so
```
**CONFIRMED.**

PREREG tbo `5cf3565b…` → kit_sha_host.txt:
```
5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops-153f
```
**CONFIRMED.**

PREREG tgz sha → kit_sha_host.txt line 1:
```
a5b290115c85d226adb8ef24fb0fce1308410d11e039ac5f393701b93e92be23  npu-kit-51.tgz
```
Disk: `a5b290115c85d226adb8ef24fb0fce1308410d11e039ac5f393701b93e92be23  /Users/marco/kalsa-qdc/npu-v79-cell/npu-kit-51.tgz`. **CONFIRMED.**

### 1d. Tgz internal SHA256SUMS matches on-disk kit-v6/SHA256SUMS

`tar xzf npu-kit-51.tgz SHA256SUMS` → 45 lines, same hexagon entries as kit-v6/SHA256SUMS. **CONFIRMED.**

### 1e. Tgz contains lib/ and lib-fix/

`tar tzf npu-kit-51.tgz | grep -cE '^lib/'` → 21 (1 dir + 20 files).
`tar tzf npu-kit-51.tgz | grep -cE '^lib-fix/'` → 21 (1 dir + 20 files). **CONFIRMED.**

**Single-variable integrity verdict: PASS. One file differs. No second differing file = no BLOCKER.**

---

## 2. THE FIX PROVENANCE

### 2a. HEAD = 022458a28, on kalsa/npu-judge-v79

`git -C /Users/marco/Projects/kalsallama rev-parse HEAD` → `022458a28b4539468f75b41ddbf10a2263e1f5a4`.
`git -C /Users/marco/Projects/kalsallama branch --show-current` → `kalsa/npu-judge-v79`. **CONFIRMED.**

### 2b. Commit is exactly the 2-line type-check addition

`git show 022458a28 --format="%H %s" -p`:
```
diff --git a/ggml/src/ggml-hexagon/ggml-hexagon.cpp b/ggml/src/ggml-hexagon/ggml-hexagon.cpp
-        return (h->ne[0] == ne0) && (h->ne[1] == ne1) && ...
+        return (h->type == t->type) &&
+               (h->ne[0] == ne0) && (h->ne[1] == ne1) && ...
```

1 file changed, 2 insertions(+), 1 deletion(-). The ONLY change is adding `h->type == t->type` at line 1186 of ggml-hexagon.cpp and wrapping the continuation. **CONFIRMED.**

### 2c. ggml-hexagon.cpp:1186 now has the check

`sed -n '1183,1190p' ggml-hexagon.cpp`:
```
        return (h->type == t->type) &&
               (h->ne[0] == ne0) && (h->ne[1] == ne1) && (h->ne[2] == t->ne[2]) && (h->ne[3] == t->ne[3]) &&
               (h->nb[0] == t->nb[0]) && (h->nb[1] == nb1) && (h->nb[2] == nb2) && (h->nb[3] == nb3);
```
**CONFIRMED.**

### 2d. 022458a28 is cherry-pick of upstream 71102a73f

`git log --oneline --all | grep 71102a73f` → `71102a73f hexagon: check tensor type when reusing descriptors (#25968)`.
Commit message of 022458a28 is identical: `hexagon: check tensor type when reusing descriptors (#25968)`. Same author (Wei Wang). **CONFIRMED.**

### 2e. No OTHER file feeding libggml-hexagon.so changed between 153fdbafd and 022458a28

PREREG line: "git diff 153fdbafd..022458a28 —stat and confirm no OTHER file feeding libggml-hexagon.so changed (ca82efa8b touched only htp/matmul-ops.c and tests/)."

`git diff 153fdbafd..022458a28 --stat`:
```
 ggml/src/ggml-hexagon/ggml-hexagon.cpp |  3 ++-
 ggml/src/ggml-hexagon/htp/matmul-ops.c | 39 ++++++++++++++++++++++++++++++++++
 tests/test-backend-ops.cpp             | 14 +++++++++++-
```

3 files changed. Only `ggml-hexagon.cpp` feeds `libggml-hexagon.so`.
`git show ca82efa8b --stat` confirms it touched ONLY:
```
 ggml/src/ggml-hexagon/htp/matmul-ops.c | 39 ++++++++++++++++++++++++++++++++++
 tests/test-backend-ops.cpp             | 14 +++++++++++-
```

`htp/matmul-ops.c` = DSP-side (not host .so). `test-backend-ops.cpp` = test binary (not host .so). PREREG claim: "ca82efa8b touched only htp/matmul-ops.c and tests/" — verified, correct. **CONFIRMED.**

**Fix provenance verdict: PASS. Clean 2-line cherry-pick, no collateral.**

---

## 3. #50-REPLICA FIDELITY

`diff #50/d_run.sh #51/d_run.sh` — every change accounted for:

| Line(s) | #50 | #51 | Verdict |
|---------|-----|-----|---------|
| 2 | `Cell #50 (…clsB-50)` | `Cell #51 (…clsB-51)` | **EXPECTED** |
| 3-4 | `DROP ORDER: kit → R1 stock → R2 zeropad → R3 stock → R4 zeropad` | `DROP ORDER: kit → R1 ctrl → R2 fix → R3 ctrl → R4 fix` + arms-by-one-file line | **EXPECTED** |
| 8 | `DIR="…clsB-50"` | `DIR="…clsB-51"` | **EXPECTED** |
| 10 | `npu-kit-50.tgz` | `npu-kit-51.tgz` | **EXPECTED** |
| 31 | `kit (lib/ stock-certified, lib-zeropad/…)` | `kit (lib/ = buggy host CONTROL, lib-fix/ = descfix host; same certified skel)` | **EXPECTED** |
| 34 | `chmod -R 755 bin lib lib-zeropad` | `chmod -R 755 bin lib lib-fix` | **EXPECTED** |
| 66-68 | `ACTIVE_SHA=$(…libggml-htp-v79.so…)` → `active_skel=$ACTIVE_SHA tbo=$TBO_SHA` in `skel_active.txt` | `HEX_SHA=$(…libggml-hexagon.so…)` + `SKEL_SHA=$(…libggml-htp-v79.so…)` → `hexlib=$HEX_SHA skel=$SKEL_SHA tbo=$TBO_SHA` in `libs_active.txt` | **EXPECTED** (PREREG: "per-run hexlib+skel+tbo sha logging") |
| 72 | `echo $? > "$RAW/ops_$tag.adb.exit"` | **ABSENT** | **EXPECTED** (PREREG: "dropped useless .adb.exit capture") |
| 84-87 | `r1_stock lib` / `r2_zpad lib-zeropad` / `r3_stock lib` / `r4_zpad lib-zeropad` | `r1_ctrl lib` / `r2_fix lib-fix` / `r3_ctrl lib` / `r4_fix lib-fix` | **EXPECTED** |

**Everything else byte-identical between #50 and #51 d_run.sh.** Specifically:
- EXTRA string line 12: byte-identical. `EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880'`. **CONFIRMED.**
- FIRST unset: `grep -n 'EXTRA_MM_FIRST' d_run.sh` → exit=1, zero matches. **CONFIRMED.**
- Judge env: `export GGML_TEST_PLAIN_HOST=1` present inside adb shell command. **CONFIRMED.**
- `-o MUL_MAT` in all four runs. **CONFIRMED.**
- Binary: `TBO=./bin/test-backend-ops-153f` (line 13), all four runs use `$TBO`. **CONFIRMED.**

**#50-replica fidelity verdict: PASS. No unintended deviations.**

---

## 4. SCRIPT BUGS

### 4a. Syntax

`sh -n d_run.sh` → exit=0. `sh -n connect.sh` → exit=0. **CONFIRMED clean.**

### 4b. DIR paths — clsB-51 everywhere

`grep -n 'clsB' d_run.sh`:
```
2:# Cell #51 (qdc-8elite-npu-v79-clsB-51). Call AFTER adb sees the QDC device on 6037.
9:DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-clsB-51"
```
`grep -n 'clsB' connect.sh`:
```
8:DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-clsB-51"
```
All three references = clsB-51. **CONFIRMED.**

### 4c. chmod covers bin, lib, lib-fix

`d_run.sh:35`: `chmod -R 755 bin lib lib-fix`. Matches the three kit directories. **CONFIRMED.**

### 4d. tgz name

`d_run.sh:11`: `KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-51.tgz"`. File exists on disk with correct sha. **CONFIRMED.**

### 4e. Interleaved order matches PREREG

PREREG: "Order R1→R2→R3→R4 interleaves the arms."
`d_run.sh:85-88`:
```
run_probe r1_ctrl lib
run_probe r2_fix  lib-fix
run_probe r3_ctrl lib
run_probe r4_fix  lib-fix
```
Control-fix-control-fix = interleaved. **CONFIRMED.**

### 4f. connect.sh

Same structure as #50's connect.sh (verified via #50/AUDIT-PREP.md). Port 6037 binding, tunnel setup, 20-retry device loop, exec into d_run.sh. **CONFIRMED.**

**Script bugs verdict: PASS.**

---

## 5. PREREG GRID

### 5a. Five cases, exhaustive and non-overlapping

PREREG cases:
1. R1/R3 NaN present AND R2/R4 clean → root cause CONFIRMED (Class B CLOSED)
2. R1/R3 NaN present AND R2/R4 NaN persists → fix REFUTED
3. R1/R3 clean → repro lost, METHOD-LIMIT
4. Fix arm ANY failure → fix unsafe, readout VOID
5. Mixed control → conditional per-pair

Cases 1-2 partition NaN-present-on-control. Case 3 handles control-clean. Case 4 handles fix-side failures. Case 5 handles asymmetric within pairs. Non-overlapping, exhaustive of the outcome space. **CONFIRMED.**

### 5b. Expected totals

PREREG line: "expected `546/546`" for fix arm if cured.

This is the total per run. #48 produced 545/546 with 1 NaN (same EXTRA string, same binary). Control arm expected 545/546 (1 NaN). Fix arm expected 546/546 (0 NaN) if the type check cures the descriptor-reuse corruption.

PREREG: "R1/R3 NaN present AND R2/R4 clean (expected 546/546)". This is internally consistent: the NaN count is per-run, not summed across runs. **CONFIRMED.**

### 5c. PREREG size claims

PREREG: "777,464 B vs 777,416 B stock".
Disk: `lib-fix/libggml-hexagon.so` = 777,464 B. `lib/libggml-hexagon.so` = 777,416 B. **CONFIRMED.**

**PREREG grid verdict: PASS.**

---

## FINAL VERDICT

| Section | Verdict |
|---------|---------|
| §1 Single-Variable Integrity | **CONFIRMED** — one file differs, all SHAs match |
| §2 Fix Provenance | **CONFIRMED** — clean 2-line cherry-pick, no collateral |
| §3 #50-Replica Fidelity | **CONFIRMED** — all deviations are intentional |
| §4 Script Bugs | **CONFIRMED** — syntax clean, paths correct, chmod correct, order correct |
| §5 PREREG Grid | **CONFIRMED** — grid exhaustive, totals consistent, SHAs match |

**APPLY.**

The prep is clean. Single-variable integrity holds (1 file differs: `libggml-hexagon.so` buggy vs fixed). The fix is a verified 2-line cherry-pick of upstream 71102a73f. The script replays #50's configuration faithfully with only the declared substitutions (lib-zeropad→lib-fix, tgz-50→tgz-51, stock/zpad→ctrl/fix tags, expanded sha logging, dropped dead .adb.exit line). PREREG grid is binding. No BLOCKERs. No surprises. Ship it.
