# AUDIT — REPORT.md vs PREREG/BISECT/BUILDS/raw (cell #64)

Scope: D/REPORT.md against D/PREREG.md, BISECT.md, BISECT-LOG.md, BUILDS.txt,
d_run.sh, build-kit.sh, raw/ for the six commits + VOID dir, logs/. All quotes
are verbatim from the cited files.

## 1. Core verdict data — CONFIRMED

- REPORT.md:12 "Index 7 is GOOD … BAD at indices 8, 9, and 12" with the six
  .out citations: CONFIRMED. Each cited line holds exactly the claimed text:
  `raw/022458a/up_ngl8_sa803224.out:3` = `proof n_htp=1895 n_mul_mat_id=189
  n_exps_htp0=189 exit=0` (same for 0278d83, c0bc859); the three BAD .out:1 =
  `proof n_htp=223 n_mul_mat_id=21 n_exps_htp0=21 exit=134`. Monotone in index
  order (6,7 GOOD; 8,9,12 BAD); G1 per PREREG.md:71-73 (k=8, k-1=7 GOOD) holds.
- Index 8 = 0a50d99: BAD is decided by the TLBMISS family in logcat, not exit
  134 alone (PREREG.md:47-51). `logcat_up_ngl8_sa803245.txt:502` =
  `crashed in thread "work-queue:1" due to TLBMISS RW occurrence`, `:505` =
  `Fault PC   :    0x20089ECC`. Same for 990e3bf (:169/:172, work-queue:0,
  0x20089E4C) and 355303e (:631/:634, work-queue:2, 0x20089EEC). All CONFIRMED.
- Index 7 = c0bc859: `up_ngl8_sa803245.out:3` `exit=0`, n_exps_htp0=189 ≥ 24 ✓.
- Kit SHA prefixes match BUILDS.txt:4-6,8-10 and driver "kit tgz sha=" lines;
  kit_verify:39 = `lib/libmtmd.so: OK` for all six (39 lines each) ✓.
- Table ngl99 column: GOOD rows `mmap failed : va FFFFFFFF` found at
  logcat_up_ngl99 lines 492/449/579, inside cited ranges (491-497, 448-456,
  577-579) ✓; BAD rows `exit 134, 0x2e` at up_ngl99.out:1 ✓.

## 2. Void run — CONFIRMED, cleanly excluded

REPORT.md:41-42 "reused the step-0 kit … skipped both pushes
(driver_void.log:1-10)": `driver_void.log:2` =
`resume: kit+model already on device, skipping pushes`; no "pushing kit" line.
The VOID dir's inherited run is GOOD-shaped (exit=0 proof) — consistent with
running the 022458a kit. d_run.sh:53-68 contains the fix: `:60` =
`rm -rf $D/bin $D/lib $D/lib-fix $D/SHA256SUMS $D/kit.tgz` (all five, verbatim);
valid rerun logs fresh push+resume+sha at driver_990e3bf:2-5 ✓.

## 3. Confound / rev-list — CONFIRMED, not upgraded

`git -C …/kalsallama-wt-upstream rev-list --count c0bc8591e..0a50d9909` = **1**;
`git log --oneline c0bc8591e..0a50d9909` = exactly
`0a50d9909 hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA) (#26049)`;
verified parent of 0a50d9909 = c0bc8591e. REPORT.md:79-84 states the adjacency
and explicitly keeps the claim as "first BAD hexagon commit," not "only cause."
No over-upgrade. 23-row table in BISECT.md matches `git log --range --
ggml/src/ggml-hexagon` 23/23 (all rows, incl. 153d324/fe8156f/57291f2/0190529,
do touch hexagon) ✓ — but note NOTHING between index 7 and 8 means the only
untested hazard is pre-index-6 (indices 1-5 never run; fine under the grid's
monotone G3 check).
Cross-check on kit purity: all six worktree HEADs (kalsallama-wt-bisect-*)
equal the claimed sha7; c0bc859 JSON's unexpected `"load_mode"` field is
explained by e6dd0e29a (#20834, merged between 0278d83 and c0bc859) — clean.

## 4. "What #26049 changes" — CONFIRMED with one imprecision

`git show --stat 0a50d9909` = 17 files, 1662 insertions, 757 deletions — exact.
All 15 htp/ files named ✓. But "the remaining files are ggml-hexagon.cpp,
ggml-hexagon-profile.py, and ggml-hexagon-trace.py" (REPORT.md:63): the two
scripts are under `scripts/snapdragon/`, NOT `ggml/src/ggml-hexagon/` — the
apposition implies they sit beside ggml-hexagon.cpp. Data right, path implied
wrong. PLAUSIBLE/REFUTED-as-to-location.

## 5. Session accounting — PLAUSIBLE, lightly supported

REPORT.md:87-94 marks it "PLAUSIBLE, not raw-file measurements" ✓ honest.
But: (a) durations (~10/6/7/25 min, 9 queue, 12 idle) appear NOWHERE in
BISECT-LOG.md — the citation BISECT-LOG.md:5-10 covers only table rows 0-3;
session 799176 rows are at BISECT-LOG.md:13-14 (out of range). (b) BISECT-LOG
.md:16 claims "Six sessions, ~44 min" while REPORT counts four sessions
(~48 min sum) — the discrepancy is never reconciled or flagged. (c) driver
wall-times (8/4.3/4.6/20 min) are shorter than the portal figures; raw logs
confirm ordering and model reuse ✓ but not durations.

## 6. ngl99 mapping-death presence (angle 7) — CONFIRMED

Grep: GOOD commits ngl99 logcat TLBMISS=0, mmap-failed=2, cDSP CRASHED=1 →
mapping death, no TLBMISS ✓ (BISECT-LOG's "mapping death, no TLBMISS" ✓).
BAD commits ngl99: TLBMISS=1, mmap-failed=0 → they die TLBMISS at ngl99 too;
REPORT table prints only `exit 134, 0x2e` for them and never calls it a
mapping death ✓. No v75/perf/fix over-claims: REPORT.md:102-104 disclaims
fix/v75/perf (PREREG.md:80-86 ✓).

## 7. Build detours / missing evidence — CONFIRMED, two narrative gaps

- runner.log:4-8 = syntax failure lines 6-7 (`unexpected EOF…`, `syntax
  error: unexpected end of file`) ✓. "edited while active" not evidenced —
  narrative (PLAUSIBLE).
- 04-install.log:4-10 lists all four HTP skels; :33-41 = `file INSTALL cannot
  find … test-tokenizer-0 … exit=1` ✓ at cited lines (33=CMake Error, 41=END).
- b2dd28a/03-host-build.log:337-345: "[221/485]" at line 344, no END record
  (345 lines total) ✓. "cut short by the pkill that also hit the runner":
  no pkill artifact exists; runner.log shows the runner alive at 15:19-15:45
  failing on a syntax error, hours after b2dd28a's ~13:2x cutoff. Unsupported
  by the cited lines. PLAUSIBLE (from BISECT-LOG.md:24-25), not confirmable.
- build-kit.sh:116-196 ✓ (assemble_kit at :116; 4 host bins + test-backend-
  ops-153f from V6_ROOT; skel into lib/ and lib-fix/; `-eq 39` at :184;
  05-assemble-kit.log:3-6 ✓ `manifest entries 39`).
- All cited files exist; nothing missing. Note: logs/rerun-022458a.log and
  rerun2-022458a.log are empty (0 B) and unused — unexplained but unclaimed.

## 8. Citation errors — REFUTED (systematic)

- REPORT.md:12 "(BISECT-LOG.md:7)": BISECT-LOG.md:7 is the TABLE HEADER; the
  sha/title/RESULT live at BISECT-LOG.md:16. REFUTED.
- REPORT.md:22/25 "BISECT.md:18" (990e3bf) and ":13" (c0bc859): actual rows at
  BISECT.md:24 and :19. REFUTED.
- REPORT.md:23 "BISECT.md:12" (0278d83): actual BISECT.md:18. REFUTED.
- REPORT.md:24 "BISECT.md:15" (355303e): actual BISECT.md:21. REFUTED.
- REPORT.md:24 "BISECT.md:14" (0a50d99): actual BISECT.md:20. REFUTED.
  (All five table citations are shifted exactly −6 — stale line numbers.)
- REPORT.md:36-37 "(BISECT.md:20, BISECT.md:28)" for #26501/#28202: those
  rows are at BISECT.md:26 and :34. REFUTED.
- REPORT.md:74 "(BISECT.md:30-34)" for the confound caveat: that text is at
  BISECT.md:47-50; :30-34 is mid-table. REFUTED.
- REPORT.md:97 "(BISECT-LOG.md:5-10)": see §5 — partial (799155 at :9 ✓;
  799168/:176 outside range; durations absent). REFUTED as cited.
- REPORT.md:102 "(PREREG.md:11-17)" for "ngl99 … discriminating test for
  #26501/#28202": :11-17 is the #62 background; the mapping-question/#26501/
  #28202 wording is at PREREG.md:6-7 and :71-73. Mis-cited (PLAUSIBLE content).
- (PREREG.md:1, 40-44), (PREREG.md:3-7), (PREREG.md:80-86), (BUILDS.txt:4-10),
  (d_run.sh:53-68), all raw file:line citations: CONFIRMED, exact.

## 9. Minor internal inconsistencies

- PREREG.md:27 says the proof is `n_exps_htp0=24` exactly; observed (and
  BISECT-LOG.md:5) is `≥ 24` with 189. Reporting is consistent; PREREG wording
  is stale, not a REPORT error.
- BISECT-LOG.md:10 asserts "Fault PC 0x20089E4C = op_binary+0x5B9C" — no raw
  file (addr2line output) supports the symbol offset; REPORT correctly omits it.
- BISECT-LOG.md:16 "Six sessions" vs REPORT's four sessions (§5b).

## Verdict

Data layer: every measured number, signature, and verdict is exactly right —
G1, culprit 0a50d99 #26049, monotone grid, void-run exclusion, rev-list=1,
manifest, kit identities, ngl99 mapping-death asymmetry. The wrongness is
concentrated in line-number citations (one systematic BISECT.md −6 shift), a
session-count contradiction with BISECT-LOG, and an unsourced "pkill" clause.

**BANK-WITH-FIXES** — no data rework needed; correct the BISECT.md/BISECT-LOG
.md line citations (or point to table rows), reconcile "six sessions ~44 min"
vs four sessions, reword "the remaining files" to give the scripts' real path,
and downgrade or source the "pkill that also hit the runner" clause.