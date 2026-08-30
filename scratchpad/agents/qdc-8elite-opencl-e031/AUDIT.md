# AUDIT — E031 OpenCL kernel correctness on Adreno 830 (hostile, pre-registry gate)

Auditor: independent hostile audit, session-local, read-only except this file.
Files audited: PREREG.md, REPORT.md, raw/ (cert_mm_ocl.out, cert_mm_ocl2.out,
cert_mmid_ocl.out, cert_mmid_ocl2.out, provenance2.txt, therm_post.txt, therm_post2.txt).

## A. Prereg integrity
Verdict: PLAUSIBLE (rule sound; REPORT deviates on one required field)

Evidence:
- Rule placement: `PREREG.md:32:## Decision rule (written before the numbers)`, in a file whose
  line 1 reads `PREREG.md:1:# PREREG — E031 kernel correctness on Adreno 830 (QDC 8 Elite)` and
  which asserts `PREREG.md:3:Written BEFORE any measurement.` No counts appear in PREREG.md
  (grep for 925/545/407 returns nothing), so "before the numbers" is consistent within the file.
- The rule is unambiguous: `PREREG.md:36:- **PASS**: every executed case for both ops reports OK; skips explicitly listed as` /
  `PREREG.md:37:  not-supported by the backend are acceptable and counted separately (they are` and
  `PREREG.md:40:- Counts are reported as N_ok/N_executed with N_skipped alongside — never collapsed.`
- DEVIATION: the prereg demands N_skipped alongside for BOTH ops, but REPORT.md gives a skip
  count only for MUL_MAT: `REPORT.md:9:- **MUL_MAT: 925/925 tests passed** (raw/cert_mm_ocl2.out), 0 FAIL, 545 not-supported` while
  `REPORT.md:11:- **MUL_MAT_ID: 407/407 tests passed** (raw/cert_mmid_ocl2.out), 0 FAIL.` — no N_skipped
  for MUL_MAT_ID. Whether it is zero or nonzero must come from the recount (Check B/E).
- No post-hoc reinterpretation found in REPORT.md: it applies PASS as "every executed case OK,
  skips separate", matching the rule as written.

## B. Count verification (independent recount)
Verdict: CONFIRMED for the raw counts; REPORT's headline claim is OVERSTATED (see below)

Arithmetic recount (ANSI-color-aware, per-case lines only):
- cert_mm_ocl2.out: `grep -cE "MUL_MAT\\(.*[0-9]mOK"` → 925; FAIL → 0; `grep -c "not supported"` → 545.
  Cross-check: 925+545 = 1470 = `grep -c "MUL_MAT("` (1470). Summary agrees:
  `cert_mm_ocl2.out:1501:  925/925 tests passed`.
- cert_mmid_ocl2.out: OK → 407; FAIL → 0; "not supported" → 405. Cross-check: 407+405 = 812 =
  `grep -c "MUL_MAT_ID("` (812). Summary agrees: `cert_mmid_ocl2.out:843:  407/407 tests passed`.
- So the REPORT's N_ok/N_executed figures 925/925 and 407/407 DO reproduce; 925+545 executed+skip
  accounting closes exactly. `grep -ci "fail"` returns 0 for both files.

ADVERSE FINDING — the claim under audit does not follow from the data:
- ALL plain-MUL_MAT q2_K/q3_K cases were SKIPPED, not passed. Every one of the 13 q2_K and 13
  q3_K case lines reads e.g.
  `cert_mm_ocl2.out:1497:  MUL_MAT(type_a=q2_K,type_b=f32,m=8,n=1,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): not supported [OpenCL]`.
  `grep "q2_K" cert_mm_ocl2.out | grep -c OK` → 0.
- MUL_MAT_ID q2_K/q3_K: only 10 of 14 lines executed (OK); 4 skipped, e.g.
  `cert_mmid_ocl2.out:  MUL_MAT_ID(type_a=q2_K,type_b=f32,n_mats=3,n_used=2,b=0,m=8,n=1,k=256): not supported [OpenCL]`.
- Therefore REPORT.md:13 `**Same counts as the E031.45 certification on Adreno 740** — our q2_K/q3_K kernels are
  correct on their third GPU generation/compiler, first run.` overstates: on the 830 the q2_K/q3_K
  MUL_MAT path was never exercised (declared not-supported), and only 10 MUL_MAT_ID cases touched
  these types. "Correct" is bankable ONLY for those 10 executed MMID cases; the bare claim as
  written is not supported by the raw evidence.

## C. Vacuous-run honesty
Verdict: CONFIRMED (disclosure honest; one minor omission)

Evidence:
- The first-attempt logs are indeed vacuous: `raw/cert_mm_ocl.out` (12 lines, matches REPORT's "12 lines")
  and `raw/cert_mmid_ocl.out` (12 lines) both show the OpenCL backend skipping:
  `Backend 1/2: GPUOpenCL` / `  Skipping` / `Backend 2/2: CPU` / `  Skipping` / `2/2 backends passed` /
  green `OK`. No per-case lines, no per-op counts — precisely the #37 VACUOUS SKIP signature.
- REPORT discloses it as a negative exhibit, not evidence:
  `REPORT.md:14:First runs used `-b OpenCL`: the backend registers as **`GPUOpenCL`**, so the filter` and
  `REPORT.md:15:matched nothing ... this is a VACUOUS SKIP and is not evidence; kept in raw/ as the negative exhibit.`
- The claimed mechanism is verified: `Backend 1/2: GPUOpenCL` shows the registered name, so `-b OpenCL` matching nothing is plausible and consistent.
- Minor omission: the second vacuous exhibit `raw/cert_mmid_ocl.out` is never cited by name in REPORT.md
  (only `raw/cert_mm_ocl.out` is). It exists and is identical; the "First runs" (plural) wording covers
  it implicitly, but the report should name both files.

## D. Backend/device header
Verdict: CONFIRMED

Evidence (both second-attempt logs):
- Platform: `cert_mm_ocl2.out:1:ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'`
- Device: `cert_mm_ocl2.out:2:ggml_opencl: device: 'QUALCOMM Adreno(TM) 830 (OpenCL 3.0 Adreno(TM) 830)'`
- Tested backend is GPUOpenCL, not CPU: `cert_mm_ocl2.out:27:Backend 1/2: GPUOpenCL` with
  `cert_mm_ocl2.out:28:  Device description: QUALCOMM Adreno(TM) 830`; CPU is backend 2 and skips
  (`cert_mm_ocl2.out:1503:Backend 2/2: CPU`).
- Identical header lines in cert_mmid_ocl2.out (`:1,:3,:25,:26,:845`).
- Compiler generation on record: `cert_mm_ocl2.out:5:ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0800.70 Compiler E031.47.18.47`
  — consistent with "third compiler generation" narrative.

## E. Skip accounting
Verdict: CONFIRMED for MUL_MAT; VIOLATION for MUL_MAT_ID (skip count withheld from REPORT)

Evidence:
- Mechanism is clean: skips are distinct per-case lines, e.g.
  `cert_mmid_ocl2.out:  MUL_MAT_ID(type_a=f16,type_b=f32,n_mats=16,n_used=16,b=0,m=32,n=1024,k=16): not supported [OpenCL]`,
  and the denominator of the summary counts only executed cases (`cert_mm_ocl2.out:1501:  925/925 tests passed`);
  skipped cases never appear as OK or FAIL. No silent folding.
- MUL_MAT skip count in REPORT matches my recount: `REPORT.md:10:  skips (capability declarations, counted separately per prereg).` with 545 on line 9; my count = 545. ✓
- VIOLATION: prereg `PREREG.md:40:- Counts are reported as N_ok/N_executed with N_skipped alongside — never collapsed.`
  is not honored for MUL_MAT_ID. REPORT.md:11 gives `407/407 tests passed ... 0 FAIL` with NO skip count.
  My recount of cert_mmid_ocl2.out gives **405** "not supported" lines — a large, undisclosed skip volume
  (more than half of the 812 MMID cases were skipped). This materially changes what "407/407" means and
  must be disclosed.

## F. Exit codes & completeness
Verdict: CONFIRMED (no crash evidence); NOTE: exit codes not preserved as artifacts

Evidence:
- Both second-attempt logs end with the full summary chain, no truncation:
  `cert_mm_ocl2.out` tail = `...Skipping\n2/2 backends passed\n` + green `OK`; identical tail in
  cert_mmid_ocl2.out. Per-case counts (`925/925 tests passed`, `407/407 tests passed`) and backend
  verdicts (`cert_mm_ocl2.out:1502:  Backend OpenCL: [1;32mOK[0m`) are present — the #37 completeness
  signature is satisfied. `grep -ci "fail"` = 0 in both; no FAIL line, therefore the prereg's
  "crash banks as FAIL" trigger has nothing to act on.
- GAP: the prereg demands runs recorded `PREREG.md:16:- Runs, in order, each `> file 2>&1` with real exit codes:`
  but NO exit code is recorded anywhere in raw/ (logs are stdout/stderr captures only). REPORT.md:16
  asserts the vacuous run had `exit 0`, and "2/2 backends passed" implies success for the real runs,
  but the claimed exit codes are not independently verifiable from the artifacts.

## G. Thermal/procedure honesty
Verdict: REFUTED as reported — promised pre-run snapshots missing; the cited "pre" numbers are unsourced

Evidence:
- Prereg promise: `PREREG.md:24:Thermal snapshot (live HAL group + Thermal Status — AMENDMENT-1 of cell #38 is` /
  `PREREG.md:25:  binding for all QDC cells) before and after each run;` — i.e. 4 snapshots for 2 runs.
- raw/ contains exactly TWO thermal files, both named post: `therm_post.txt` and `therm_post2.txt`.
  No pre-run snapshot file exists. Full inventory listed in the header of this audit.
- File contents: `therm_post.txt` = `Temperature{mValue=32.0, mType=1, mName=GPU0, mStatus=0}` /
  `Temperature{mValue=35.3, mType=0, mName=CPU0, mStatus=0}` / `Thermal Status: 0`;
  `therm_post2.txt` = GPU0 54.4 / CPU0 61.9 / `Thermal Status: 0`.
- UNSOURCED NUMBERS: REPORT.md:12 claims `pre 37.3/32.4 °C CPU0/GPU0 status 0 → post 61.9/54.4 status 0.`
  The post pair (61.9/54.4) matches therm_post2.txt. But "37.3" and "32.4" appear in NO file in raw/
  (`grep -rn "37.3\|32.4" raw/` → no matches). The only available earlier snapshot (therm_post.txt)
  reads 35.3 CPU0 / 32.0 GPU0 — and by mtime (17:16, same minute as the vacuous cert_mm_ocl.out) it is
  the POST of the vacuous first attempt, not a pre of the real runs.
- Coverage: both real logs (cert_mm_ocl2.out, cert_mmid_ocl2.out) are mtime 17:22, same as therm_post2.txt —
  ONE post snapshot is shared by TWO real runs; there is no pre snapshot for either, and per-run thermal
  coverage demanded by the prereg was not delivered.
- Mitigation (why this doesn't kill the cell): correctness is not clock-sensitive (prereg's own words) and
  `Thermal Status: 0` (never throttled) is on record; but the report's thermal sentence fabricates a "pre"
  state that has no artifact.

## H. Scope creep
Verdict: PLAUSIBLE (no speed/NPU claims; two scope overreaches found)

Evidence:
- Good: no speed/latency/tok-s-per-s/NPU/HVX claims anywhere in REPORT.md (`grep -n "ms\|tok/s\|speed\|faster\|NPU\|HVX\|throughput\|latency" REPORT.md` → no matches). The prereg's "What this cell cannot say" list is not directly violated.
- OVERREACH 1 (cross-cell): `REPORT.md:13:**Same counts as the E031.45 certification on Adreno 740** — our q2_K/q3_K kernels are` — this cell's raw/ contains nothing from E031.45 or the 740; the comparison is unverifiable from this cell's artifacts. Worse, the clause it introduces ("our q2_K/q3_K kernels are correct on their third GPU generation/compiler, first run.") asserts universal correctness of these kernel types on the 830, while Check B shows the MUL_MAT q2_K/q3_K path was never executed (13+13 cases "not supported") and only 10 of 14 MMID cases ran. Correctness claim must be narrowed to the executed cases.
- OVERREACH 2 (minor): REPORT.md:2 `QRD8750/Adreno 830, Android 16, device 87b3a4aa` — Android 16 is corroborated by `provenance2.txt:1:qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/...` but the device id 87b3a4aa and session id 792315 have no source in raw/.

## I. Internal consistency (dates/commits, unsourced numbers)
Verdict: PLAUSIBLE (commit chain coherent; one self-citation oddity; several unsourced REPORT numbers)

Evidence:
- Commits exist and the timeline is coherent:
  `git show -s e68414a9` → 2026-08-29 14:43:17; `e14b7fe1` → 2026-08-29 14:44:07 with subject
  "prereg: E031 kernel correctness on Adreno 830 (locked before any measurement)" adding exactly this
  PREREG.md; results commit `0f35d4f5` → 2026-08-29 17:23:30, subject "E031 on Adreno 830: 925/925 +
  407/407 first run (prereg e14b7fe1) — audit pending, vacuous -b OpenCL attempt kept as negative exhibit".
  Prereg (14:44) precedes all raw measurements (mtimes 17:16–17:22) → prereg-before-numbers holds.
- ODDITY: PREREG.md self-cites `PREREG.md:3:Written BEFORE any measurement. Locked at moe-experiments commit: **e68414a9**.`
  but e68414a9 is the BASE commit (bank #38 registry entry) that does NOT contain PREREG.md; the prereg was
  added by e14b7fe1. Charitable read: "locked at" = "written while HEAD was e68414a9". The REPORT cites the
  prereg commit correctly as e14b7fe1, and the results commit message agrees. Wording should be fixed, but
  it is not evidence tampering.
- UNSOURCED NUMBERS in REPORT.md (my check: no file in raw/ contains them):
  (a) the thermal "pre 37.3/32.4" pair (see Check G — worst offender);
  (b) `REPORT.md:2:...device 87b3a4aa` and session id 792315 — no artifact in raw/ records them;
  (c) kit/engine hash 5c3979438 — referenced but not recorded in raw/ (only test-backend-ops SHA256 is,
     `provenance2.txt:2:36ddd5ae4f59ef8b7f9a84ee70d9d2800628bacb56b6a6125fd8e18b390e3b5c  test-backend-ops`).
- Sourced numbers, verified: 925, 545, 407, "12 lines" (cert_mm_ocl.out has exactly 12 lines),
  61.9/54.4 (therm_post2.txt), Android 16 (provenance2.txt:1 `qti/sun/sun:16/...`).
- Stale line: `REPORT.md:19:Pending: hostile audit (GLM) before ALIVE/registro entry — queued post-compaction.`
  — the audit is no longer pending; line must not enter the registry.

## OVERALL VERDICT
**FIX** — bankable after the listed corrections; NOT bankable as written.

What survives hostile audit: the core measurement. Both real logs are complete, header-verified
(GPUOpenCL / QUALCOMM Adreno(TM) 830), with independently reproduced counts (925 OK + 0 FAIL + 545 skips;
407 OK + 0 FAIL + 405 skips; executed+skipped closes exactly to the per-case line totals 1470/812),
and no FAIL or crash evidence. The PASS verdict per the prereg decision rule is real.

What does NOT survive (mandatory corrections before registry entry):
1. REPORT must disclose the MUL_MAT_ID skip count: 405 "not supported" lines — more than half the MMID
   suite — currently omitted (prereg `PREREG.md:40` violated).
2. The q2_K/q3_K claim must be narrowed. Raw data: ALL 26 plain-MUL_MAT q2_K/q3_K cases were skipped
   ("not supported [OpenCL]"); only 10 of 14 MUL_MAT_ID q2_K/q3_K cases executed and passed.
   "Our q2_K/q3_K kernels are correct on their third GPU generation" is not supported as written.
3. The unsourced thermal "pre 37.3/32.4 °C" must be removed or sourced; disclose that pre-run snapshots
   were not captured (procedural deviation from PREREG.md:25) and that therm_post.txt is the post of the
   vacuous attempt (mtime 17:16), not a pre of the real runs.
4. Cite raw/cert_mmid_ocl.out next to raw/cert_mm_ocl.out in the vacuous-run note.
5. Drop or source device id 87b3a4aa and session id 792315; record kit/engine hash 5c3979438 provenance.
6. Fix the prereg self-citation (e68414a9 is the base commit; the lock commit is e14b7fe1).
7. Remove the stale "Pending: hostile audit" line.
8. For the record: exit codes are claimed but not preserved as artifacts; note the gap or re-emit runs
   with recorded exit codes. Thermal pre-snapshots were not captured; per prereg's own wording this does
   not invalidate correctness (clock-insensitive), but the procedural promise was broken and must be logged.

Not REJECT because no correction requires re-running on the device except the optional thermal/exit-code
re-emission; the arithmetic and the raw evidence fully support a PASS cell once the report is corrected.
Not APPLY because a report containing an unsourced measurement ("pre 37.3/32.4") and an overstated kernel
correctness claim cannot enter a permanent registry verbatim.

## RE-AUDIT (post-fix)
Re-read REPORT.md from disk in full; every raw/ number re-verified against the logs. Per-item verdicts
against the 8 mandatory corrections from the original audit:

1. MUL_MAT_ID skip count disclosed — **FIXED**.
   `REPORT.md:- **MUL_MAT_ID: 407/407 executed tests passed, 0 FAIL, 405 not-supported skips**` with the
   closure check `(raw/cert_mmid_ocl2.out; 407+405 = 812 = total per-case lines).` — matches my recount
   (405 skips, 812 case lines) and quotes the prereg's own "N_skipped alongside — never collapsed".

2. q2_K/q3_K claim narrowed — **FIXED**. Verified line-by-line against raw/:
   - Plain MUL_MAT: my recount = 13 q2_K + 13 q3_K case lines, zero executed (`grep -vc "not supported"`
     → 0). REPORT: `**Plain MUL_MAT q2_K/q3_K: NEVER EXECUTED on the 830** — all 26 cases (13 q2_K +` /
     `13 q3_K) report `not supported [OpenCL]`.` — exact.
   - MMID: my recount of all 14 `MUL_MAT_ID(type_a=q[23]_K` lines = 10 OK / 4 skipped. REPORT:
     `**MUL_MAT_ID q2_K/q3_K (the MoE path, where our 8x4 kernels live): 10 of 14 cases` — exact.
   - Shape pattern of the 4 skips: raw/ shows `MUL_MAT_ID(type_a=q2_K,type_b=f32,n_mats=3,n_used=2,b=0,m=8,n=1,k=256): not supported [OpenCL]`,
     the same q3_K m=8 n_mats=3 line, and the m=16 n_mats=5 pair. REPORT: `The 4 skipped cases are small
     shapes the kernels declare unsupported (m=8 n_mats=3, m=16 n_mats=5 ...)` — exact.
   - Executed shapes: raw/ OK lines are m=64/96/512, all n_mats=4, n∈{1,4,16,32} (e.g.
     `MUL_MAT_ID(type_a=q2_K,type_b=f32,n_mats=4,n_used=2,b=0,m=96,n=4,k=256): [1;32mOK[0m`).
     REPORT's `(m=64/96/512, n_mats=4, n=1..32)` is an accurate summary.
   - The bankable claim is now properly scoped: `**the q2_K/q3_K MoE (MUL_MAT_ID) kernels are` /
     `correct on the 830 for every shape they accept, first run, third GPU/compiler` / `generation.** Nothing broader.`
     The 740 cross-reference is hedged (`the 740 logs are not in this cell's raw/ and no per-case equivalence is claimed.`).

3. Unsourced thermal "pre 37.3/32.4" removed and retracted; pre-snapshot absence disclosed — **FIXED**.
   `**No pre-run snapshots were captured** — a procedural deviation from the prereg.` and the earlier
   draft numbers are explicitly retracted: `cited a "pre 37.3/32.4 °C" pair that exists in no artifact; it
   was a mis-transcription from the live terminal and is retracted.` Remaining thermal numbers verified:
   therm_post.txt = 35.3/32.0 status 0; therm_post2.txt = 61.9/54.4 status 0; mtimes 17:16 (vacuous
   attempt) and 17:22 (both real logs) — all match the artifacts as previously read.

4. cert_mmid_ocl.out cited — **FIXED**. `(raw/cert_mm_ocl.out AND raw/cert_mmid_ocl.out, 12 lines each)`
   — both files verified at 12 lines each (wc -l, original audit).

5. Device id / session id handled — **FIXED**. Ids removed from the result claims; disclosed as
   unverifiable: `The QDC session id and device serial were read from the live web UI and are not recorded
   in any raw/ artifact; they are reported here as unverifiable context only.` Android 16 is now sourced:
   `(raw/provenance2.txt:1 `qti/sun/sun:16/...`)`. Kit hash provenance honestly scoped: `hash provenance is
   the kit note, not a raw/ artifact`.

6. Prereg self-citation explained — **FIXED**. `PREREG.md's own "locked at e68414a9" line names the` /
   `BASE commit it was written on top of; the prereg entered the repo at e14b7fe1, before any` /
   `measurement — raw mtimes 17:16-17:22 vs prereg commit 14:44` — matches the git record from the
   original audit (e68414a9 = 14:43 base; e14b7fe1 = 14:44 prereg commit).

7. Stale "Pending: hostile audit" line removed — **FIXED**. Replaced by a factual record:
   `Audited: hostile GLM audit in AUDIT.md — verdict FIX, all 8 mandatory corrections` / `applied in this revision.`

8. Exit-code gap noted — **FIXED**. `Exit codes: claimed 0 at run time but not preserved as artifacts
   (logs are stdout/stderr captures only); the completeness signature (full per-case list + summary +
   green backend OK in both logs) is the evidence of clean completion.` — accurate and matches Check F.

NEW-NUMBER SCAN of the rewritten REPORT.md:
- Every quantitative claim traces to raw/ or the git record: 925/545/1470, 407/405/812, 26=13+13, 10 of 14,
  skip shapes, 12 lines each, 35.3/32.0, 61.9/54.4, mtimes 17:16/17:22. No new unsourced numbers found.
- Two NON-BLOCKING unsourced narrative clauses remain (flagged for the record, not measurement claims):
  (a) `in real inference those ops run on CPU` — a claim about runtime op placement this cell did not
      measure or source; (b) `consistent with the kernels' shape requirements` — an interpretation of the
      skip pattern referencing kernel code not present in this cell. Neither asserts a result; strike them
      if the registry demands absolute sourcing purity.

FINAL OVERALL VERDICT: **APPLY** — the report now matches the raw evidence exactly, all 8 corrections are
verified in place, no new unsourced numbers or overstated claims were introduced by the revision. Bank it.

