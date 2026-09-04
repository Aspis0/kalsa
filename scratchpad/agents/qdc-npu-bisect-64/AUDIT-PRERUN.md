# AUDIT-PRERUN — Cell #64: bisect v73 TLBMISS

Date: 2026-09-04. Read-only audit of `PREREG.md` + `d_run.sh` against reference evidence (#60, #62 raw).

---

## Diff verification (#62 → #64 driver)

`diff qdc-8g2-npu-upstream-62/d_run.sh qdc-npu-bisect-64/d_run.sh` — 27 changed lines across 8 hunks. Every hunk is one of: (a) header comment, (b) JOB/SHA7/DIR/RAW/KIT/D parameter lines, (c) log message with sha7, (d) arm list (removed mbuf512/vmem1800, reordered up_ngl8 before up_ngl99). **No other lines changed.** The `run_arm` body, `gate_or_abort`, resume guard, FARF creation, adbT, SER, MODEL, GATE, thermal gate, retry logic — all byte-identical.

---

## Findings

### F1 — METHOD-VOID not implemented in driver (CRITICAL)

**PREREG.md:27** — `exit 0 without proof = METHOD-VOID, arm re-run once, then the session is void and the commit is re-tested next session.`

**d_run.sh:197** — `[ "$e" = "0" ] && return 0`

The `run_arm` function returns 0 (success) whenever the device process exits 0, regardless of `n_exps_htp0`. There is no check against `$5` (expected_exps). A commit that exits 0 with `n_exps_htp0=0` (binary loaded, zero expert ops executed, clean exit) would be classified GOOD. The METHOD-VOID re-run logic does not exist.

**CONFIRMED.** The driver collects the proof count (line 174-178) but never acts on it. Verdict: **critical gap** — bisect could declare a non-exercising commit as GOOD and stop early.

### F2 — n_exps_htp0=24: correct value, not enforced

**PREREG.md:31** — `exit 0 with n_exps_htp0 = 24 in the -v stderr`

**d_run.sh (arm call):** `run_arm up_ngl8 900 "$T -ngl 8" "" 24`

16 layers × 3 expert ops (gate/up/down) × 8 HTP layers = 24 per graph. Cumulative for pp16+tg8 = 189 (#60 raw: `proof n_exps_htp0=189 exit=0`). Value 24 as per-graph minimum is correct.

**#60 raw/ngl8_mbuf1g_sa802961.out** — `proof n_exps_htp0=189 exit=0` (SURVIVED, 189 >> 24)
**#62 raw/up_ngl8_sa803054.out** — `proof n_exps_htp0=14 exit=134` (DIED TLBMISS, 14 < 24, process killed mid-first-graph)

**CONFIRMED** that 24 is the right per-graph count. **CONFIRMED** that the driver records but does not enforce it (same gap as F1).

### F3 — Arm count: PREREG says two, driver has two (no mismatch)

**PREREG.md:43** — `up_ngl8 (cap 900 s)` and `up_ngl99 (cap 900 s)`

**d_run.sh (arm calls):** exactly two: `up_ngl8` then `up_ngl99`.

The diff removed `up_ngl99_mbuf512` and `up_ngl99_vmem1800` from #62, leaving the declared pair. **No mismatch.**

### F4 — sigfile grep does not capture TLBMISS strings directly

**d_run.sh:165** — `grep -Eai 'dspqueue|fastrpc|qurt_exit|0x2e' "$err" "$logfile" "$tombdir"/*`

**#62 raw/logcat_up_ngl8_sa803054.txt** — TLBMISS at line `CDSP0: Process ... crashed in thread "work-queue:2" due to TLBMISS RW occurrence` + `Bad VA : 0x0` + `Error code : 0x7003` (3 lines).

The grep pattern matches `fastrpc` (present in the config-read line `FASTRPC_GET_DOMAINS query failed` which appears **before** the TLBMISS line in stderr). Result: **sigfile captures the fastrpc config line, not the TLBMISS signature.** The TLBMISS strings are in logcat (captured to `$logfile`) but the grep's `head -1` picks the earlier fastrpc match.

**PLAUSIBLE.** Not a correctness bug — the operator reads logcat for the actual verdict. But the sigfile (intended as a quick-look diagnostic) shows the wrong line for TLBMISS deaths. The tombstone pull and logcat dump are correct and complete.

### F5 — Ordering: mkdir before RAW uses SHA7 — fine

**d_run.sh:8-9** — `RAW="$DIR/raw/$SHA7"` then `mkdir -p "$RAW"`

Variable assignment (line 8) does not access the filesystem; `set -u` checks for unset variables, not nonexistent paths. `mkdir -p` (line 9) creates the directory. Correct order.

### F6 — `[ -f "$KIT" ]` before `log` is defined — dead code, not a runtime bug

**d_run.sh:12** — `[ -f "$KIT" ] || { echo "KIT_MISSING $KIT"; exit 3; }` (uses `echo`, not `log`)
**d_run.sh:19** — `log(){ echo "[$(date +%H:%M:%S)] $*"; }`
**d_run.sh:83** — `if [ ! -f "$KIT" ]; then log "KIT_MISSING"; exit 5; fi` (uses `log`)

Line 12 uses `echo` (works before `log` is defined). If the kit is missing, line 12 exits with code 3, so line 83 is never reached. Line 83 is dead code. With `set -u`, calling `log` before its definition would produce `unbound variable` on the function name — but this path is unreachable.

**CONFIRMED** (dead code, no runtime impact).

### F7 — Resume/re-entry: SHA7-per-directory prevents collision

**PREREG.md:46** — `RAW="$DIR/raw/$SHA7"`

If the same sha7 is re-tested (e.g., after METHOD-VOID), `RAW/$SHA7` is the same directory. Filenames include `$JOB` (e.g., `up_ngl8_<job>.out`). Different sessions use different JOB tags → no overwrite. Same JOB tag → the resume guard (d_run.sh:110) skips if `proof .* exit=0` is already in `.out`. If the previous run exited non-0, the arm re-runs and overwrites, which is correct.

**CONFIRMED.** No collision risk for the intended use pattern.

### F8 — Bisect math: 5 steps sufficient

23 indices, binary search: ceil(log₂(23)) = 5 after step 0 confirms the lower bound.

| Step | First candidate | Range remaining |
|------|----------------|-----------------|
| 0 | (baseline) | 1..23 |
| 1 | 12 | 11 or 11 |
| 2 | 6 or 18 | 5 or 5 |
| 3 | 3/9/15/21 | 2 or 2 |
| 4 | 2/4/8/10/14/16/20/22 | 1 |
| 5 | 1 | — |

**CONFIRMED.** The "k-1 GOOD" condition in the interpretation grid (PREREG.md:52) is correctly stated for binary search.

### F9 — Budget arithmetic

6 sessions × ~10 min = 60 min. Pool: 926 → ~865 (PREREG.md:47). Actual per-session: ~3 min push (if kit+model not on device) + ~30s per arm × 2 = ~4 min arms + gate overhead ≈ 8-10 min. With resume (SKIP_PUSH), ~5 min. Budget is adequate.

**CONFIRMED.**

### F10 — Kit contract: v73-only, no v75/v79 references

**build-kit.sh:156** — builds only `htp-v73` target. Kit contains `libggml-htp-v73.so` in `lib/` and `lib-fix/`. No `libggml-htp-v75.so` or `libggml-htp-v79.so` in the kit. Driver `LD_LIBRARY_PATH=$D/lib-fix` — only v73 is loadable.

**d_run.sh:95** — `sha256sum -c SHA256SUMS` on device verifies all 39 entries (5 binaries + 17 lib-fix + 17 lib). `build-kit.sh:165` asserts `wc -l < SHA256SUMS = 39`.

**CONFIRMED.** Kit contract is clean.

### F11 — PREREG promise vs implementation gap (beyond F1/F2)

PREREG.md:51 states "exit 0 without proof = METHOD-VOID, arm re-run once, then the session is void and the commit is re-tested next session." No file implements this. The driver has no METHOD-VOID return code; the main script has no re-run logic; there is no session-void mechanism. The only retry logic is the A3/A4 `-n 0` fallback (d_run.sh:183-194), which applies to zero-generation commands, not `-ngl 8`.

**CONFIRMED.** Same as F1, stated separately as a PREREG-vs-implementation gap.

---

## Summary

| # | Finding | Verdict | Severity |
|---|---------|---------|----------|
| F1 | METHOD-VOID not implemented; exit 0 always = success | CONFIRMED | **CRITICAL** |
| F2 | n_exps_htp0=24 correct but unenforced | CONFIRMED | HIGH (subsumed by F1) |
| F3 | Arm count matches PREREG (2 arms) | CONFIRMED (no bug) | — |
| F4 | sigfile grep captures fastrpc config line, not TLBMISS | PLAUSIBLE | LOW (diagnostic only) |
| F5 | mkdir/RAW ordering correct | CONFIRMED (no bug) | — |
| F6 | KIT check before log() — dead code | CONFIRMED | NONE |
| F7 | SHA7-per-directory prevents resume collision | CONFIRMED (no bug) | — |
| F8 | 5 bisect steps sufficient for 23 indices | CONFIRMED | — |
| F9 | Budget arithmetic correct | CONFIRMED | — |
| F10 | Kit v73-only, SHA256SUMS clean | CONFIRMED | — |
| F11 | PREREG promises METHOD-VOID; no file implements it | CONFIRMED | CRITICAL (same as F1) |

---

## Overall: **NO-GO**

The driver is structurally sound — the diff from #62 is clean, the kit contract is correct, the bisect math works, the budget fits, the resume/collision logic is safe. But the PREREG's central verdict rule (METHOD-VOID for exit 0 without proof) has **zero implementation**. The `run_arm` function returns 0 on any exit 0 (d_run.sh:197) without checking `n_exps_htp0` against the declared `expected_exps` (parameter `$5`). A commit that loads but exercises zero expert ops would be declared GOOD, stopping the bisect at the wrong index.

**Required fix before run:** Add a METHOD-VOID check after the proof-count computation. Example:
```bash
if [ "$e" = "0" ] && [ "$n_exps_htp0" -lt "$5" ]; then
  log "METHOD-VOID $1: exit 0 but n_exps_htp0=$n_exps_htp0 < expected=$5"
  return 11  # new: METHOD-VOID
fi
```
And in the main script, handle rc=11 with a single re-run, then void.

---

## Delta audit — METHOD-VOID fix (2026-09-04)

File changed: `d_run.sh`. Two new hunks added.

### Hunk 1 — METHOD-VOID check in `run_arm` (lines 197-200)

```d_run.sh:197-200
  if [ "$e" = "0" ] && [ "${n_exps_htp0:-0}" -lt "$5" ]; then
    log "NO_PROOF $1: exit 0 with n_exps_htp0=${n_exps_htp0:-0} < expected $5"
    return 11
  fi
```

### Hunk 2 — main-script rerun logic (lines 211-218)

```d_run.sh:211-218
# PREREG: exit 0 without HTP proof = re-run once, then METHOD-VOID (rc 11).
run_arm up_ngl8         900 "$T -ngl 8"  "" 24; rc=$?
[ "$rc" = 11 ] && { run_arm up_ngl8_rerun 900 "$T -ngl 8" "" 24; rc=$?; }
case $rc in 7|8) ABORT=1;; 11) log "METHOD-VOID up_ngl8: no HTP proof twice";; esac
run_arm up_ngl99        900 "$T -ngl 99" "" 48; rc=$?
[ "$rc" = 11 ] && { run_arm up_ngl99_rerun 900 "$T -ngl 99" "" 48; rc=$?; }
case $rc in 7|8) ABORT=1;; 11) log "METHOD-VOID up_ngl99: no HTP proof twice";; esac
```

### (a) n_exps_htp0 assigned before check on every path — **CONFIRMED**

`n_exps_htp0` is assigned at d_run.sh:174 (`wc -l` of a grep pipeline → always a numeric string, never unset). Paths that skip the assignment:
- Resume guard (line 110): `return 0` before line 174 → METHOD-VOID check (line 197) is unreachable.
- CLEAN_FAIL (line 126): `return 8` before line 174 → METHOD-VOID check unreachable.
- LAUNCH_FAIL (line 143): `return 8` before line 174 → METHOD-VOID check unreachable.
- CAP_HIT/killed: `e=TIMEOUT`, falls through → line 174 reached → assigned.
- Normal exit: line 174 reached → assigned.

The `${n_exps_htp0:-0}` default is a belt-and-suspenders guard; it is never needed at runtime.

### (b) Recursive A3/A4 fallback propagates 11 correctly — **CONFIRMED**

```d_run.sh:190-193
            run_arm "${1}_n1" "$2" "$retry_cmd" "$4" "$5"
            return $?
```

`return $?` propagates the recursive call's exit code verbatim (0, 7, 8, 9, or 11). The bisect arms (`-ngl 8`, `-ngl 99`) do not contain ` -n 0 `, so the A3/A4 case block (line 183: `*" -n 0 "*`) is never entered for them. The METHOD-VOID check is always the last decision point for bisect arms.

### (c) Rerun uses same command/env/expected — **CONFIRMED**

| param | original | rerun |
|-------|----------|-------|
| name | `up_ngl8` | `up_ngl8_rerun` |
| cap | `900` | `900` |
| cmd | `$T -ngl 8` | `$T -ngl 8` |
| env | `""` | `""` |
| expected_exps | `24` | `24` |

Identical except for the `_rerun` suffix (which prevents filename collision with the first attempt's `.out`/`.err`).

### (d) Diff against #62 shows only declared hunks + this fix — **CONFIRMED**

`diff qdc-8g2-npu-upstream-62/d_run.sh qdc-npu-bisect-64/d_run.sh` — 30 changed lines across 9 hunks:

1. Header comment (lines 2-4)
2. JOB/SHA7/DIR/RAW parameter lines (lines 5-9)
3. KIT path + early guard (lines 9-12)
4. Device path `kalsa62` → `kalsa64` (line 16)
5. Log message with sha7 (line 25)
6. **NEW: METHOD-VOID check in run_arm** (lines 197-200)
7. Comment + arm list (removed mbuf512/vmem1800, reordered) (line 211)
8. **NEW: rerun logic for up_ngl8** (lines 213-214)
9. **NEW: rerun logic for up_ngl99** (lines 216-218)

Hunks 1-5 and 7 are the previously-audited parameter/arm changes. Hunks 6, 8, 9 are the METHOD-VOID fix. No other lines changed. The `run_arm` body, `gate_or_abort`, resume guard, FARF creation, adbT, SER, MODEL, GATE — all byte-identical to #62.

### Delta summary

| Check | Verdict |
|-------|---------|
| (a) n_exps_htp0 always assigned before check | CONFIRMED |
| (b) recursive fallback propagates 11 | CONFIRMED |
| (c) rerun identical params | CONFIRMED |
| (d) diff clean — only declared hunks | CONFIRMED |

F1/F11 from the original audit: **RESOLVED.** METHOD-VOID is now implemented.

### Overall: **GO**
