# MAX RECALL — Claims-vs-Artifacts Forensic Audit (Angle 2/3)

**Subject:** `scratchpad/agents/retrial-s23/REPORT.md` (S23 device retrial)  
**Artifacts audited:** 22 logs + MANIFEST.txt + 2 `.so` files in `results/oracle_consumer_s23/retrial/`  
**Method:** Every quantitative claim traced to a named log line; hashes computed independently; env hygiene checked cell-by-cell; interpretive claims scrutinized for overreach.  
**Auditor posture:** Hostile. Assumed false until proven.

---

## EXECUTIVE SUMMARY

**Overall trust grade: B**

The retrial report is substantially honest and well-documented. The vast majority of quantitative claims are confirmed verbatim in the raw artifacts. The SHA hashes, MANIFEST integrity, e2e tallies, roundtrip mismatch counts, signature fields, weight-path labels, and env hygiene all check out. However, two numerical claims in cell 6 (f1/f2 calibration) are **REFUTED**: the ERR mean is misreported (0.4325 claimed vs 0.4158 actual) and the in-band/out-of-band split is wrong (2/12 below 0.36 claimed vs 4/12 actual). These errors make the calibration appear tighter than it is, though they do not change the qualitative verdict (the ERR range is still within or near the pre-registered band). One additional claim (cell 0 "21G free") is asserted without a log artifact. The interpretive section correctly hedges the non-q4_0 e2e claims but the headline conclusion slightly overstates by saying "verified" for all 5 types without qualification.

---

## DETAILED FINDINGS

### F1. SHA256 hashes of .so files — CONFIRMED

**Claim:** Patched `9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c`, unpatched `9bc47a9ce5c03eab98d3e902cbd2d8bc9b18c282cf6bea291e73562ad4dce8c8`.

**Evidence:** Independent `sha256sum` of the two `.so` files in the retrial directory:
```
9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c *libggml-opencl.patched.eaec5d884.so
9bc47a9ce5c03eab98d3e902cbd2d8bc9b18c282cf6bea291e73562ad4dce8c8 *libggml-opencl.unpatched.1582f2d83.so
```
Matches report byte-for-byte. On-device shas in all log headers match PC-side shas. **CONFIRMED.**

---

### F2. MANIFEST integrity — CONFIRMED

**Claim:** 22 runs in manifest; every run has a log; every log is in the manifest; on-device sha per run; patched=9198f387, unpatched=9bc47a9c.

**Evidence:** 22 entries in `MANIFEST.txt`, 22 `.log` files on disk. Cross-referenced every manifest entry against `ls` output: 1:1 mapping, no orphan logs, no missing logs. On-device sha verified in each log header against the manifest column:
- All 14 patched-cell logs show `9198f387...` — matches manifest
- All 8 unpatched-cell logs show `9bc47a9c...` — matches manifest

**CONFIRMED.**

---

### F3. Cell 0 setup — PLAUSIBLE (unverifiable)

**Claim:** "21G free, s3base/s3fix/s3printf untouched."

**Evidence:** No `cell0` log file exists in the retrial directory. The "21G" and "untouched" claims appear only in the report prose. Cannot verify from artifacts.

**PLAUSIBLE.** The claim is consistent with no contradictory evidence, but is asserted, not proven.

---

### F4. Cell 1 (unpatched baseline) — CONFIRMED (minor note)

**Claim:** 5 affected types = 94208 dirty; K+dense = 0; q4_0 e2e 0/74 FAIL; q4_K 0/80 FAIL; q5_K 0/4 FAIL.

**Evidence per type (cell1a_unpatched_bytewise.log):**
| Type | Claimed mismatch | Log line | Verdict |
|---|---|---|---|
| q4_0 as | 94208/294912 | `mismatch=94208/294912 first=3` | **CONFIRMED** |
| q4_1 as | 94208/327680 | `mismatch=94208/327680 first=9` | **CONFIRMED** |
| q5_0 as | 94208/360448 | `mismatch=94208/360448 first=9` | **CONFIRMED** |
| q5_1 as | 94208/393216 | `mismatch=94208/393216 first=9` | **CONFIRMED** |
| mxfp4 as | 94208/278528 | `mismatch=94208/278528 first=2` | **CONFIRMED** |
| q4_K as | 0/294912 | `mismatch=0/294912` | **CONFIRMED** |
| q5_K as | 0/360448 | `mismatch=0/360448` | **CONFIRMED** |
| q6_K as | 0/430080 | `mismatch=0/430080` | **CONFIRMED** |
| weight 256×512×1 | 0/73728 | `mismatch=0/73728` | **CONFIRMED** |
| weight 512×512×1 | 0/147456 | `mismatch=0/147456` | **CONFIRMED** |

**Signature fields:** q5_0 `qh_mismatch=0` — CONFIRMED (`qh_mismatch=0` in log). q5_1 `qh_mismatch=0` — CONFIRMED.

**q4_0 e2e FAIL:** cell1b log shows `ERR = 0.189483092` and `Backend OpenCL: FAIL`. **CONFIRMED.**

**q4_K e2e 0/80 FAIL:** 81 ERR lines in log (80 unique — first ERR duplicated as first-case sample). No "tests passed" line present (trimmed away). **PLAUSIBLE** — count derivable from ERR lines but not directly from a summary line.

**q5_K e2e 0/4 FAIL:** cell1b log shows `0/4 tests passed`. **CONFIRMED.**

---

### F5. Cell 2a (patched+HOST_REPACK) — CONFIRMED

**Claim:** q4_0=0 clean with host repack; other 4 affected=65536 dirty; K+dense=0; rc=1.

**Evidence (cell2a_patched_hostrepack.log):**
- `mismatch=0/294912 first=18446744073709551615` for q4_0, class=clean — **CONFIRMED**
- `KALSA host repack for q4_0 MoE tensor 256x512x4` — **CONFIRMED** (only for q4_0)
- q4_1: `mismatch=65536/327680`, class=odd_qs_hi_to_f — **CONFIRMED**
- q5_0: `mismatch=65536/360448`, qh_mismatch=0 — **CONFIRMED**
- q5_1: `mismatch=65536/393216` — **CONFIRMED**
- mxfp4: `mismatch=65536/278528` — **CONFIRMED**
- q4_K/q5_K/q6_K: all 0 — **CONFIRMED**
- dense 256: `mismatch=0/73728` — **CONFIRMED**
- dense 512: `mismatch=0/147456` — **CONFIRMED**
- `EXIT 1` — **CONFIRMED**

---

### F6. Cell 2b (patched+bytewise) — CONFIRMED

**Claim:** All 5 affected = 65536 dirty; q4_0 re-measured as 65536; K+dense = 0.

**Evidence (cell2b_patched_bytewise.log):**
- q4_0: `mismatch=65536/294912`, class=odd_qs_hi_to_f, `hi_to_f_lo_ok=65536`, `qs_other=0` — **CONFIRMED**
- q4_1: `mismatch=65536/327680` — **CONFIRMED**
- q5_0: `mismatch=65536/360448`, `qh_mismatch=0` — **CONFIRMED**
- q5_1: `mismatch=65536/393216`, `qh_mismatch=0` — **CONFIRMED**
- mxfp4: `mismatch=65536/278528` — **CONFIRMED**
- K+dense: all 0 — **CONFIRMED**

**Claim:** "131072 odd-qs candidates × 1/2 = 65536."
**Evidence:** `odd_candidates=131072 qs_odd=65536` in log. 131072/2 = 65536. **CONFIRMED.**

---

### F7. Cell 3 (weight-path predicate) — CONFIRMED

**Claim:** 8× trans4-moe with moe_gate=1; dense256=generic-soa,0; dense512=noshuffle,0.

**Evidence (from cell2a, cell2b, cell5a logs):**
- `OPENCL_WEIGHT_PATH{tensor=as,type=q4_0,...,path=trans4-moe,...,moe_gate=1}` — through to q6_K — 8 total. **CONFIRMED**
- `OPENCL_WEIGHT_PATH{tensor=weight,type=q4_0,ne=256x512x1,...,path=generic-soa,...,moe_gate=0}` — **CONFIRMED**
- `OPENCL_WEIGHT_PATH{tensor=weight,type=q4_0,ne=512x512x1,...,path=noshuffle,...,moe_gate=0}` — **CONFIRMED**

---

### F8. Cell 4 (e2e patched bytewise) — CONFIRMED

| Type | Claimed | Log evidence | Verdict |
|---|---|---|---|
| q4_0 | 74/74 | `74/74 tests passed` in cell4a_e2e_bytewise_q4_0.log | **CONFIRMED** |
| q4_1 | 75/75 | `75/75 tests passed` in cell4_e2e_bytewise_q4_1.log | **CONFIRMED** |
| q5_0 | 3/3 | `3/3 tests passed` in cell4_e2e_bytewise_q5_0.log | **CONFIRMED** |
| q5_1 | 3/3 | `3/3 tests passed` in cell4_e2e_bytewise_q5_1.log | **CONFIRMED** |
| mxfp4 | 74/74 | `74/74 tests passed` in cell4_e2e_bytewise_mxfp4.log | **CONFIRMED** |
| q8_0 | 75/75 | `75/75 tests passed` in cell4_e2e_bytewise_q8_0.log | **CONFIRMED** |
| q6_K | 3/3 | `3/3 tests passed` in cell4_e2e_bytewise_q6_K.log | **CONFIRMED** |
| q4_K | 0/80 FAIL | 80 unique ERR lines; no "tests passed" line (trimmed) | **PLAUSIBLE** |
| q5_K | 0/4 FAIL | `0/4 tests passed` in cell4_e2e_bytewise_q5_K.log | **CONFIRMED** |
| dense | 915/925 | `915/925 tests passed` in cell4d_dense_mulmat.log | **CONFIRMED** |

**Dense FAIL count:** 10 FAIL lines confirmed (all q6_K flat, as reported). **CONFIRMED.**

---

### F9. Cell 5a (patched+bitselect sweep) — CONFIRMED

**Claim:** All 5 affected = 65536 dirty (identical to bytewise); K+dense = 0.

**Evidence (cell5a_patched_bitselect.log):**
- q4_0: `mismatch=65536/294912`, class=odd_qs_hi_to_f — **CONFIRMED**
- q4_1–mxfp4: all 65536 dirty — **CONFIRMED**
- K+dense: all 0 — **CONFIRMED**
- `program_cvt variant=bitselect` — **CONFIRMED** (separate process launch)

---

### F10. Cell 5b (patched+bitselect e2e) — CONFIRMED

**Claim:** 74/74 PASS.

**Evidence (cell5b_e2e_bitselect_q4_0.log):** `74/74 tests passed`. **CONFIRMED.**

---

### F11. Cell 6 (f1/f2 calibration) — **TWO FINDINGS REFUTED**

**Claim 11a:** Arm A ERR values = 0.3369, 0.3278, 0.5409, 0.3957, 0.4394, 0.3956, 0.4822, 0.3291, 0.4280, 0.4117, 0.5438, 0.3583.

**Evidence (cell6_armA_unpatched_hostrepack_q4_0_dump.log):** All 12 ERR values match exactly (rounded to 4dp). **CONFIRMED.**

**Claim 11b:** "mean ≈ 0.4325" (detailed section) / "mean~0.43" (verdict table).

**Evidence:** Independent computation: (0.336868059 + 0.327763304 + 0.540895162 + 0.395667961 + 0.439381110 + 0.395620802 + 0.482230200 + 0.329095432 + 0.428028391 + 0.411656407 + 0.543830446 + 0.358309780) / 12 = **0.415779**. The report claims 0.4325 — an over-reporting of **+4.0%**. The verdict table's "mean~0.43" also rounds up from the actual ~0.42.

**Verdict: REFUTED.** The mean ERR is 0.4158, not 0.4325. The error is arithmetical (mis-summed or mis-averaged).

**Claim 11c:** "2 of 12 slightly below 0.36" (in the pre-registered 0.36–0.70 band).

**Evidence:** Values below 0.36: 0.3369, 0.3278, 0.3291, 0.3583. That is **4 of 12**, not 2. The report under-counts out-of-band values by a factor of 2.

**Verdict: REFUTED.** 8 of 12 are in-band; 4 of 12 are out-of-band. The report's claim of "2 of 12 slightly below 0.36" misrepresents the spread. This makes the calibration appear tighter than the data support.

**Claim 11d:** Arm B (patched+HOST_REPACK): 12/12 PASS.

**Evidence (cell6_armB_patched_hostrepack_q4_0.log):** `12/12 tests passed`, no ERR lines. **CONFIRMED.**

**Claim 11e:** "Sole contributor" argument — restore is the only difference; f1 constant via HOST_REPACK.

**Evidence:** Arm A log shows `HOST_REPACK=[1]` and `KALSA host repack for q4_0`. Arm B log shows same. The only code difference between the two arms is the .so (patched vs unpatched). **CONFIRMED** the experimental design supports the sole-contributor claim.

---

### F12. Cell 7 (−55% re-grounding) — CONFIRMED

**Claim:** Unpatched+HOST_REPACK q4_0 roundtrip = 61440.

**Evidence (cell7_unpatched_hostrepack_roundtrip.log):** `mismatch=61440/294912 first=3`, `qs_odd=61440`. **CONFIRMED.**

**Claim:** 61440 = 65536 − 4096 (poisoning model).

**Evidence:** 65536 − 61440 = 4096. **CONFIRMED arithmetically.**

**Claim:** Under unpatched+HOST_REPACK, q4_1/q5_0/q5_1/mxfp4 = 94208 dirty.

**Evidence (cell7 log):**
- q4_1: `mismatch=94208/327680` — **CONFIRMED**
- q5_0: `mismatch=94208/360448` — **CONFIRMED**
- q5_1: `mismatch=94208/393216` — **CONFIRMED**
- mxfp4: `mismatch=94208/278528` — **CONFIRMED**

**Claim:** K+dense = 0 under unpatched+HOST_REPACK.
**Evidence:** All 0. **CONFIRMED.**

---

### F13. Env hygiene — CONFIRMED

**Claim:** No leftover instrument env from a previous cell; bitselect cells are separate process launches.

**Evidence per cell:**
| Cell | CVT_VARIANT | HOST_REPACK | ORACLE | DUMP_Q | Separate launch? |
|---|---|---|---|---|---|
| 1a (unpatched) | [bytewise(default)] | [unset] | [unset] | [unset] | Yes (different .so) |
| 2a (patched+HR) | [bytewise] | [1] | unset | unset | Yes |
| 2b (patched+bw) | [bytewise] | [unset] | unset | unset | Yes |
| 4a (e2e q4_0) | [bytewise] | unset | unset | unset | Yes |
| 5a (bitselect sweep) | [bitselect] | [unset] | unset | unset | Yes |
| 5b (bitselect e2e) | bitselect | — | — | — | Yes |
| 6 ArmA | (none) | [1] | — | — | Yes |
| 6 ArmB | (none — bytewise default) | [1] | — | — | Yes |
| 7 | [bytewise(default)] | [1] | unset | unset | Yes |

Each bitselect cell (5a, 5b) is a separate process launch with its own log and env header. No cross-contamination detected. **CONFIRMED.**

---

### F14. Signature claims — CONFIRMED

All four signature fields verified verbatim in sweep logs:

| Claim | Log evidence (cell2b/5a, representative) | Verdict |
|---|---|---|
| `qh_mismatch=0` | `qh_mismatch=0` (q5_0, q5_1 lines) | **CONFIRMED** |
| `class=odd_qs_hi_to_f` | `class=odd_qs_hi_to_f` (all 5 affected types) | **CONFIRMED** |
| `hi_to_f_lo_ok=65536` | `hi_to_f_lo_ok=65536` (all 5 affected types) | **CONFIRMED** |
| `qs_other=0` | `qs_other=0` (all types, all cells) | **CONFIRMED** |

---

### F15. Interpretive honesty — PLAUSIBLE with caveats

**Cell 5b "PASS (data-only)":** Report explicitly labels this "data-only" and says "the bitselect-clean thread is stopped." The 74/74 PASS is correctly reported, and the limitation is stated. **CONFIRMED as appropriately hedged.**

**Cell 4 non-q4_0 types:** The report states: "e2e PASS = restore correctly inverts the (miscompiled) producer ⇒ CPU judge receives the same values the GPU consumed (producer/consumer consistency, per pre-registration §2)." It further acknowledges in the open findings: "NOT verifiable via round-trip on this device (no contract-correct producer for them)." **CONFIRMED as appropriately hedged.**

**Headline conclusion overclaim:** The report says "The restore fix (eaec5d884) is verified" for ALL 5 affected types. For q4_0 this is backed by HOST_REPACK byte-clean proof (roundtrip 0). For the other 4 types, the evidence is e2e consistency (FAIL→PASS with only the restore changed), which is strong but not byte-clean proof. The headline should read "verified for q4_0 (byte-clean); strong consistency evidence for q4_1/q5_0/q5_1/mxfp4 (e2e only, no contract-correct producer available)." **PLAUSIBLE** — the body text hedges correctly, but the headline does not.

**Cell 6 "sole contributor" claim:** Logically valid — only the restore differs between Arm A and Arm B; f1 is held constant by HOST_REPACK; the ERR difference is fully explained by the restore. **CONFIRMED.**

---

### F16. Provenance (s3base/s3fix/s3printf) — PLAUSIBLE (unverifiable)

**Claim:** "s3base/s3fix/s3printf untouched; s3oracle recreated."

**Evidence:** No log artifact records the state of these directories. The claim is asserted in the report prose. **PLAUSIBLE** — no contradictory evidence, but unverified.

---

## FINDINGS SUMMARY (most severe first)

| # | Finding | Verdict | Severity |
|---|---|---|---|
| F11b | Cell 6 mean ERR reported as 0.4325; actual is 0.4158 (+4.0% over-reporting) | **REFUTED** | Medium — arithmetic error makes calibration appear tighter |
| F11c | Cell 6 "2 of 12 below 0.36"; actual is 4 of 12 | **REFUTED** | Medium — misrepresents spread; twice as many out-of-band values |
| F15 | Headline says "verified" for all 5 types without qualifying the non-byte-clean proof gap | **PLAUSIBLE** (overclaim) | Low — body hedges correctly |
| F3 | Cell 0 "21G free" claimed without log artifact | **PLAUSIBLE** (unverifiable) | Low |
| F16 | s3base/s3fix/s3printf "untouched" claimed without log artifact | **PLAUSIBLE** (unverifiable) | Low |
| F4 | q4_K 0/80 — no "tests passed" line in trimmed log | **PLAUSIBLE** (derivable from 80 ERR lines) | Negligible |
| F1–F10, F12–F14 | All other quantitative claims | **CONFIRMED** | — |

---

## OVERALL TRUST GRADE: **B**

**Rationale:** The report is 90%+ accurate by claim count and 95%+ accurate by importance. The SHA hashes, MANIFEST integrity, e2e tallies, roundtrip counts, signature fields, weight-path labels, env hygiene, and the core experimental design all verify cleanly. The two REFUTED findings (ERR mean and in-band count) are arithmetical errors that make the calibration appear ~4% tighter than reality, but they do not change the qualitative conclusion (the ERR range is still broadly consistent with the pre-registered band). The interpretive hedging is generally good, with a mild overclaim in the headline. This is a **B** grade: trustworthy on the science, with correctable numerical errors.
