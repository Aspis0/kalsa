# AUDIT REPORT — Cell #59 REPORT.md

Hostile read-only audit. Every verdict backed by quoted source line.

---

## 1. Proof counters: n_htp=484 / n_mul_mat_id=48 / n_exps_htp0=48

**Source lines (.out files):**
```
proof n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 exit=134    [both .out files, 56 bytes each]
```

**S23 comparator (hostbuf1/driver.out):**
```
2026-08-24T13:50:37Z a proof rc_a=134 n_json=0 n_json_err=0 n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 n_attn=96
```

**Counters match to the unit.**

**Are the counting rules identical?**

Cell59 d_run.sh extraction (lines ~100-102):
```bash
n_htp=$(grep "execute-op" "$err" 2>/dev/null | grep "HTP0" 2>/dev/null | wc -l | tr -d ' ')
n_mul_mat_id=$(grep "execute-op" "$err" 2>/dev/null | grep "MUL_MAT_ID" 2>/dev/null | wc -l | tr -d ' ')
n_exps_htp0=$(grep "HTP0 execute-op MUL_MAT_ID" "$err" 2>/dev/null | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" 2>/dev/null | wc -l | tr -d ' ')
```

S23 hostbuf1_driver.sh extraction:
```bash
grep "execute-op" "$src" | grep "HTP0" > "$BASE/${prefix}_execute_op_htp0.txt"
grep "execute-op" "$src" | grep "MUL_MAT_ID" > "$BASE/${prefix}_execute_op_mul_mat_id.txt"
grep "HTP0 execute-op MUL_MAT_ID" "$src" | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" > "$BASE/${prefix}_execute_op_exps_htp0.txt"
```
Then counted via `count_lines()` = `wc -l`.

**Verdict: CONFIRMED.** Same grep pipeline, same source file (stderr), same field definitions. The identical numbers are not a coincidence of different counting rules. Cell59 extracts from `.err`, S23 from `a_stderr.txt` — both the llama-bench `-v` stderr stream.

**Minor note:** S23 driver also outputs `n_attn=96` (attention execute-ops). Cell59 does not compute this. Not a discrepancy — just a missing field in cell59's proof line. The REPORT does not claim n_attn matches.

---

## 2. Exit codes, signatures, tombstones, logcat

**Exit codes 134:**
REPORT claims "exit 134" for both arms. The `.out` files show `exit=134` in the proof line. The `.exit` file (device-side, not pulled to raw/) would hold the raw value. Exit 134 = 128+6 = SIGABRT, consistent with the `ggml_abort` in the backtrace. **CONFIRMED.**

**Signature line:**
REPORT: `dspqueue_read failed: 0x0000002e`

Both `.err` files end with:
```
/workspace/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1552: ggml-hex: dspqueue_read failed: 0x0000002e
```
**CONFIRMED.** Identical file:line and error code in both arms.

**.sig files:**
```
SIGNATURE=.../exp_pp16_nohostbuf_sa802553.err:/workspace/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1552: ggml-hex: dspqueue_read failed: 0x0000002e
SIGNATURE=.../exp_pp16_hostbuf1_sa802553.err:/workspace/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1552: ggml-hex: dspqueue_read failed: 0x0000002e
```
**CONFIRMED.**

**Tombstones:**
```
tomb_exp_pp16_nohostbuf_sa802553/tombstone_00    136786 bytes
tomb_exp_pp16_nohostbuf_sa802553/tombstone_00.pb  71211 bytes
tomb_exp_pp16_hostbuf1_sa802553/tombstone_01      137004 bytes
tomb_exp_pp16_hostbuf1_sa802553/tombstone_01.pb    71210 bytes
```
Non-empty, ~130KB each. Present and non-trivial. **CONFIRMED.**

**Logcat dspqueue line counts:**
```
logcat_exp_pp16_hostbuf1_sa802553.txt:  6 dspqueue lines
logcat_exp_pp16_nohostbuf_sa802553.txt: 6 dspqueue lines
```
REPORT claims "6 dspqueue lines per arm." **CONFIRMED.**

The logcat lines show: fastrpc open (handle + domain), dspqueue_create (Queue 0), dspqueue_notif_callback (status 3). Status 3 = DSP_QUEUE_NOTIFICATION_STATUS_DONE. These are the queue lifecycle events, not the fatal — the fatal is on the host side in ggml-hexagon.cpp.

---

## 3. Grid application (G1)

PREREG G1: "A1 and A2 both die at pp16 with a dspqueue/fastrpc signature"

- A1 (nohostbuf): exit=134, signature `dspqueue_read failed: 0x0000002e` ✅
- A2 (hostbuf1): exit=134, signature `dspqueue_read failed: 0x0000002e` ✅

**G1 satisfied.**

**A3-A5 gating:** PREREG says A3 runs "ONLY if A1 exits 0", A4 "ONLY if A2 exits 0", A5 "ONLY if A3 exits 0." Both A1 and A2 exited non-zero (134). A3-A5 correctly skipped. d_run.sh confirms:
```bash
if [ "$A1_OK" -eq 1 ]; then
  run_arm exp_pp512_nohostbuf ...
```
A1_OK=0 (rc=9 from `return 9` after non-zero exit), so A3 skipped. Same for A4/A5. **CONFIRMED, no post-hoc reinterpretation.**

---

## 4. "Strong result" reasoning — arch-bound vs stack-bound

REPORT: "The death is a property of the **v73 HTP stack under MoE expert dispatch**"

The backtrace:
```
3: _ZN20ggml_hexagon_session13flush_pendingEb
5: ggml_backend_sched_graph_compute_async
6: _ZN13llama_context13graph_computeEP11ggml_cgraphb
```

`flush_pending` is a **host-side** function. `dspqueue_read` is a **host-side** FA RPC call. The abort happens when the host reads back results from the DSP and gets error 0x2e.

**The report conflates two hypotheses:**
1. **DSP firmware bug** — the v73 firmware corrupts queue state during MoE dispatch, causing the host read to fail. This is "arch-bound" in the sense that v73 firmware has a defect.
2. **Host-side driver bug** — e.g., a race or buffer management error in `ggml-hexagon.cpp:1552` (or nearby in `flush_pending`) that would reproduce on ANY v73 stack regardless of DSP firmware. This is "stack-bound" (host + DSP together) but NOT "arch-bound."

The REPORT uses "v73 HTP stack" which is technically accurate (it includes both firmware and host driver), but the phrase "arch/stack-bound" in the conclusion overstates: it implies the architecture itself is the constraint, when the evidence only shows the **stack** (host driver + DSP) fails. A host-side bug in `ggml-hexagon.cpp:1552` that reproduces identically on different devices with the same host driver version would NOT be arch-bound — it would be build-bound.

**However:** the REPORT's declared confound section explicitly acknowledges the newer build could have FIXED the death. The fact that it didn't, on a different device, does strengthen the claim. The strongest honest statement is: "the death is a property of the v73 HTP stack including the host-side dispatch code, not device-specific." The REPORT's wording "v73 HTP stack" is defensible but "arch-bound" in the heading is a slight overclaim.

**Verdict: PLAUSIBLE but slightly overclaimed.** "Stack-bound" is well-supported. "Arch-bound" requires ruling out a host-side bug in ggml-hexagon.cpp, which this cell cannot do (same host binary on both devices).

---

## 5. `--mmap 0` as "pre-data amendment" — honesty check

REPORT: "No data was seen before the substitution."

**void-attempt1 evidence:**
```
exp_pp16_nohostbuf_sa802553.out:
usage: ./bin/llama-bench [options]
... [usage text] ...
proof n_htp=0 n_mul_mat_id=0 n_exps_htp0=0 exit=1
```
```
exp_pp16_nohostbuf_sa802553.err:
error: invalid parameter for argument: --load-mode
```
```
exp_pp16_nohostbuf_sa802553.sig:
SIGNATURE=...logcat...fastrpc_config.c:304: Reading configuration file...
```

The .out shows **usage text** (argument parse failure), **exit=1**, and **n_exps_htp0=0**. The .err shows the HTP0 session DID open (skel loaded, op-queue allocated) but then the parse error killed the process before any graph ran. No tombstones (tomb dirs empty, .before=.after both empty).

**Verdict: CONFIRMED.** Calling this a "pre-data amendment" is honest. The abort was at argument parsing, before any compute. No interpretable performance data existed. The substitution `--load-mode none` → `--mmap 0` was applied to correct a flag-name mismatch between the BigMoE-era invocation template and the kalsallama binary lineage.

---

## 6. Android 16 vs 14 confound

REPORT header: "Android 16 — the S23 ran Android 14: declared residual confound"

PREREG "Declared confound" section mentions: kit binary difference (newer build), reference hardware, model bytes, load path. **Android version is NOT mentioned in the PREREG declared confound section.**

The REPORT header calls it "declared residual confound" — but it was not declared in PREREG before the session. It appears to have been noticed post-hoc and retroactively labeled "declared."

**Severity: MODERATE.** Android 16 vs 14 could involve different `libcdsprpc.so` versions, different fastrpc kernel drivers, different CDSP management. This is a real confound. The REPORT acknowledges it as "residual" but its claim of pre-declaration is inaccurate — it was not in PREREG.md's declared confound section.

**Verdict: REFUTED** (on the claim it was "declared" in PREREG). The Android version confound exists but was not binding-declared before the session.

---

## 7. Session accounting vs cell59.log timestamps

REPORT: "Submitted ~22:37, Running 22:39:54; driver attempt 1 22:40:29 → 22:44:30 (kit 22 MB + model 3.9 GB push 172 s, two VOID arms); attempt 2 22:45:45 → 22:46:54 (two arms, ~27 s each incl. gate). Ended 22:48 EDT"

**cell59.log:**
```
[22:45:45] device=f623f410 job=sa802553
[22:45:52] resume: kit+model already on device, skipping pushes
GATE_PASS
[22:45:57] start exp_pp16_nohostbuf (cap 900s)
GATE_PASS
GATE_PASS
[22:46:27] start exp_pp16_hostbuf1 (cap 900s)
GATE_PASS
[22:46:54] DONE (ABORT=0) — raw/ populated. Remember: End Session in the portal.
```

**Discrepancies:**
1. REPORT claims "attempt 1 22:40:29 → 22:44:30 (kit 22 MB + model 3.9 GB push 172 s, two VOID arms)" — this run is **not recorded in cell59.log**. The cell59.log starts at 22:45:45 with resume "skipping pushes." Either the attempt-1 log was not captured, or it was a different session/job. The REPORT presents it as part of cell59's accounting but cell59.log does not corroborate the 172s push.
2. "Ended 22:48" — cell59.log says DONE at 22:46:54. The ~90-second gap could be portal End+reload, consistent.
3. "8-9 min billed" — from 22:39:54 to 22:48 = ~8 min. Plausible for portal billing. But the actual compute was ~67s (22:45:57 → 22:46:54).

**Verdict: PLAUSIBLE with caveat.** The attempt-1 (with push) is either from a separate log or not captured in cell59.log. The core timing (attempt 2: 22:45:45 → 22:46:54) is internally consistent. The "172 s push" claim cannot be verified from cell59.log alone.

---

## 8. Overclaims in prose

### "F6 confirmed"
ALIVE.md line 408 (the grep hit for "dspqueue"):
> `policy F6, OWNER-CONFIRMED 24/08: MoE-experts-on-NPU is v75-class-only`

REPORT says cell59 confirms F6. The cell59 data (v73 death replication) is consistent with F6. **CONFIRMED** — this is a valid inference from the data, though technically F6 was already owner-confirmed from S23 data alone. Cell59 upgrades it from "one device" to "reference hardware."

### "dossier #8 gains a QDC-reproducible case"
**PLAUSIBLE.** The cell59 data does add a QDC-reproducible case with reference board + public model + open build. Whether "dossier #8" already existed or is being created here is not verifiable from the files at hand, but the characterization is accurate.

### "not of the S23 unit, its ROM, its thermal history, the HOSTBUF setting, or the 3f545bec binary"

Breakdown:
- **"not of the S23 unit"** — SUPPORTED. Different device (HDK8550 f623f410).
- **"not of its ROM"** — PLAUSIBLE but overclaimed. ROM = firmware image. The HDK8550 may run the same v73 firmware version as the S23, or a different one. Cell59 does not identify the DSP firmware version. If both run the same firmware, the ROM IS a common factor, not an exonerated one.
- **"not of its thermal history"** — SUPPORTED. Thermal gate passed, HDK ran cool.
- **"not of the HOSTBUF setting"** — SUPPORTED. Both HOSTBUF=0 (A1) and HOSTBUF=1 (A2) died identically. The HOSTBUF confound is closed by the within-cell comparison.
- **"not of the 3f545bec binary"** — SUPPORTED. Cell59 uses a newer build (npu-judge-v79). The death occurs with a different binary, so the specific 3f545bec binary is exonerated as a necessary condition.

**Verdict: PLAUSIBLE overall.** The "ROM" claim is the weakest link — it needs explicit DSP firmware version comparison between S23 and HDK8550 to be rigorous.

---

## SEVERITY-RANKED FINDINGS

| # | Finding | Verdict | Severity |
|---|---------|---------|----------|
| 1 | Proof counters match and are computed identically | CONFIRMED | Clean |
| 2 | Exit 134, dspqueue_read 0x2e signature, tombstones, logcat | CONFIRMED | Clean |
| 3 | G1 grid correctly applied, A3-A5 correctly gated | CONFIRMED | Clean |
| 4 | `--mmap 0` pre-data amendment is honest | CONFIRMED | Clean |
| 5 | "Arch-bound" overclaims vs "stack-bound" | PLAUSIBLE | **Medium** — honest wording is "stack-bound"; "arch-bound" requires ruling out host-side bug |
| 6 | Session accounting attempt-1 push (172s) not in cell59.log | PLAUSIBLE | **Low** — timing internally consistent for attempt 2 |
| 7 | "not of its ROM" — DSP firmware version not compared | PLAUSIBLE | **Medium** — needs explicit firmware version check |
| 8 | Android 16 vs 14 not declared in PREREG | REFUTED | **Medium** — real confound, not pre-declared as claimed |

---

## BANK DECISION

**BANK-WITH-FIXES.**

The core finding (G1 replication, both arms die identically, proof counters match S23 to the unit) is solid. The grep extraction methods are identical. The grid was applied correctly.

**Fixes required before banking:**
1. Replace "arch/stack-bound" with "stack-bound" in the conclusion header — the evidence supports stack-bound (host driver + DSP firmware together) but cannot distinguish arch-bound (inherent v73 limitation) from a host-side bug in ggml-hexagon.cpp:1552.
2. Remove the claim that Android 16 vs 14 was "declared" in PREREG — it was not. Add it to the declared confound list retroactively or acknowledge it as post-hoc.
3. Soften "not of its ROM" to "not ruled out as a factor" unless DSP firmware versions are explicitly compared between S23 and HDK8550.
4. The attempt-1 session accounting (172s push) should reference its source log explicitly or be removed from cell59's accounting.
