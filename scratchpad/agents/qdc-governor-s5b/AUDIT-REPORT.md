# AUDIT-REPORT — hostile audit of S5b REPORT.md (run 4, sa805734)

Date 2026-09-05. Read-only except this file. Re-derived every number against raw/sa805734,
raw/sa805443/cooldown_probe.txt, the LOCKED PREREG (124 lines incl. amendments). No device.

## Verified clean (all reproduce, cited line-by-line)

- final_rc=0: driver-sa805734.log:13 `[11:42:43] DONE board=8-Elite final_rc=0 …` ✓.
- 8 rows + five VOID: results.tsv:2-9 — A1 5945.225/26.5903761137222/30.927→41.436/647f906d… :
  2; B1 3200.713/3200.713/26.2663122657311/35.914→44.63/17b3765f…/FAIL :3; A2 VOID(hot) :4;
  B2 na/VOID :5; A3 :6; B3 3228.259/3228.259/26.6350649301958/35.98→45.336/17b3765f…/VOID :7;
  A4 :8; B4 VOID :9. Status files :1 confirm: A1 status=0 row_void=0 new_tokens_a=925
  structuredCalls=0; B1 status=0 cooldown_s=150 new_tokens_b=925; A2/A3/A4/B4 `row_void=1
  cooldown_s=600 void_reason=hot`; B2 `row_void=1 cooldown_s=225 void_reason=na`; B3 status=0
  cooldown_s=480 new_tokens_b=925 ✓ — rows table exact.
- Ratio: 3200.713/5945.225 = 0.538367 → "0.538367" ✓; reciprocal 1.85746 → "1.857×" ✓; band
  placement correct: 1.857 ∈ [1.4, 1.9] prewarm-prior band, outside ≥3× fork expectation, with
  the explicit n=1/descriptive caveat [PREREG.md:61-63 endpoint rule] ✓.
- Oracle: A_t1_filtered.txt:776 and B_t1_filtered.txt:777 both `KALSA_BENCH_TOKENS
  {"turnId":"1","n":1023,…` ✓; `diff` of the ids files: only line 30 differs — A=640, B=1194;
  lines 1-29 identical, 31-32 identical (597…4388…|358,1094) ✓ — report exact: "first 29
  match; only file line 30 differs; lines 31–32 reconverge" ✓. "HYPOTHESIS" label with the
  near-tie-logit reading and the explicit "not the systematic run-3/Adreno-750 pattern; no
  stronger causal claim from one differing ID" — no overclaim ✓.
- Governor evidence: B1 filtered.txt:776 `KALSA_GOVERNOR {"engine_prefill":"GPU",
  "engine_decode":"CPU","commit_bytes":12114944,"commit_ms":8.356,"prefill_ms":3200.713,
  "prefill_chunks":"2+512+128+128+128+27","prefill_ctx_ngl":99,"forced":false,
  "thermal_state":"FAST","thermo_source":"bench-skin","fit":"Fit","fallback_reason":""}` ✓
  verbatim; B3 :776 with commit_ms=13.549/prefill_ms=3228.259 ✓; chunk sum 2+512+128+128+128+27
  = 925 = new_tokens_b ✓. Statuses governor_count=1/commit_bytes=12114944; TSV fallback 0,
  lmkd 0 ✓.
- Thermal: skin rises 30.927→41.436 (A1), 35.914→44.630 (B1), 35.980→45.336 (B3) —
  results.tsv:2-3,7 + after_thermal values (A1 after 41.436, B1 44.63, B3 45.336) ✓.
  Cooldown files: A2_cool:41 `wait_s=600 skin=36.44`, A3:41 36.968, A4:41 37.706, B4:41
  36.262 → the "36.3–37.7 °C plateau at the 600-s cap" ✓ (36.262 rounds to 36.3); B1_cool:11
  `wait_s=150 skin=35.914`, B3_cool:33 `wait_s=480 skin=35.974` ✓ "150–480 s" ✓. Probe context
  (cooldown_probe.txt:1-16): 36.04→33.227 over the recorded samples ✓.
- Harness: composer 5142/5142/5142/5080 for A1/B1/B3/B2 (:1 of each composer_len.txt),
  type times 58/58/71/81 s (type_prompt.txt:1) ✓. adb-exit.log: exactly ten `rc=255 …logcat -v
  epoch -d -b all` lines (grep count 10; first at :949) ✓; B2 Send tap `rc=0 … input tap
  1304 1763` at :944 precedes the failures ✓; B2 logcat ends mid-line at 15100
  (`…ProtoXDBBu` truncated) ✓. Filtered toolcall lines :774 show structuredCalls=0 ✓.
- Identity: recon.txt:1-6 serial 2a38935c/SM8750/Sun/16 ✓; apk_sha.txt sha 272f4547…59946 +
  DEBUGGABLE (2 matches) ✓; model_copy 1593894944 ✓; run-3 A1 5842.393 cross-check
  (raw/sa805443/results.tsv:2) and its exclusion [PREREG.md:113-120] ✓.
- "What this does and does not show": shows GPU prefill + KV commit + decode parity
  descriptively; does NOT establish the locked endpoint, oracle correctness, or a
  thermal-performance estimate; no "GPU is 1.857× faster" finding anywhere — the ratio is
  confined to the descriptive section with the n=1 caveat ✓.

## Findings

F1 — MINOR, CONFIRMED. "three seconds after the Send-era log activity" (REPORT line ~53): the
cited adb-exit/logcat lines support "after Send" but not the specific 3 s; unverifiable from
the cited evidence. Fix: drop the interval or cite the two epochs.
F2 — MINOR, CONFIRMED. "the overwriting re-dump destroyed the usable evidence": the mechanism
is each poll's `>` re-dump being killed mid-write (rc=255), leaving the last partial file; the
report's phrasing is loose but the substance (truncated 15100-line file, row VOID, reason na
via the new_tokens band gate) is right. Fix: reword to "the killed re-dump truncated the file".
F3 — MINOR, CONFIRMED. "36.440/36.968/37.706/36.262": the cooldown files print 2-decimal skin
(A2 `skin=36.44`); the 3-decimal rendering overstates precision. Values equal; formatting nit.

## Verdict (Audit A)

BANK. Every number, ratio, band placement, oracle detail, governor line, thermal statement, and
harness count reproduces verbatim from the cited raw; the endpoint verdict (NOT MET, 0
oracle-PASS pairs) and the descriptive-only framing are exactly per the locked PREREG; the
single-token-oracle HYPOTHESIS is properly labelled. Three cosmetic nits (F1-F3).
## REPORT verdict — run 6

Verified vs raw/sa806967 — all numbers reproduced: rows = results.tsv:2-7 (A1 5855.472/
26.779/33.158→42.719; B1 3323.508/26.580/36.919→45.279; A2 6182.904/26.439/38.411→47.889;
B2 na/VOID; A3 6155.242/26.638/37.375→46.675; B3 3321.319/26.937/36.986→46.392); cooldown_s
per status file A1 0/B1 195/A2 285/B2 900/A3 0/B3 855; cool_target_c 38.5/37.0 per arm;
commit_bytes 12114944, commit_ms 10.455/10.796; END.txt:1 `exit_0`; driver log:12
`final_rc=0`; recon 55b03820/SM8750/`Sun for arm64`; B2 cooldown :61 `wait_s=900 skin=37.066
target_c=37.0`; ids diffs (A1/B1, A2/B1, A3/B3) all `30c30 < 640 --- > 1194` — only idx 29,
reconverging, repeating run 4. "A3 cooldown 0" legitimate: cooldown :1 `wait_s=0
skin=37.382 target_c=38.5` (exited instantly, not missing). Arithmetic: 0.537532 / 0.539592 /
median 0.539 / A/B 1.86× / 0.56759 (1.76×) / A2,A3 vs A1 = 5.6%, 5.1%. Cross-run GPU n=7,
CPU n=4, each cited line exact; run-5b A1 correctly excluded. Strict NOT MET first; PASS-1
"exploratory"; no endpoint-win overclaim; summary block consistent with run-4 BANK text;
line 108 (A3 row) complete — not truncated. The .bak per-arm driver references exist.

F1 — CONFIRMED, MAJOR. PASS-1 pairing deviates from the pre-registered same-turn rule.
PREREG endpoint: "median of each B prefill_ms divided by its same-turn A promptMs …
adjacent A/B pairs". REPORT.md:104: "Under exploratory PASS-1, both pairs pass: B1/A2=
`3323.508/6182.904=0.5375` and A3/B3=`3321.319/6155.242=0.5396`, median `0.539`" — B1's
same-turn A is A1, not A2; A1/B1 also PASSes under PASS-1 (0.5676) but is demoted to
"sensitivity". Rule-based PASS-1 median = median(0.5676, 0.5396) = 0.5536 → 1.81×, not
0.539/1.86×. Post-hoc selection of the more favourable ratio. Fix: same-turn pairs, or
pre-register the cross-turn pairing; conclusion (inside 1.4–1.9×, below ≥3×) unchanged.
F2 — MINOR. Non-retroactivity of PASS-1 is imported only via the PREREG:137 citation;
restate in the report's own words.
F3 — MINOR. B2 skin renders "37.066 at cooldown cap→na"; the TSV B2 has before=na,
after=37.066 — render "na→37.066 (cap 37.066)".

## REPORT verdict — run 6

NO-BANK as written: all data verified; F1 (PASS-1 uses non-adjacent B1/A2 instead of the
pre-registered same-turn A1/B1, shifting 0.554→0.539) blocks; plus F2/F3 wording nits.
Fix F1's pairing (or amend the pairing pre-registration), then re-bank.

## REPORT verdict — run 6 (delta)

F1 — CONFIRMED-FIXED. REPORT.md:113 quotes the pre-registered same-turn rule, computes
A1/B1=0.5676 and A3/B3=0.5396, median `median(0.5676,0.5396)=0.5536→0.554` (A/B 1.81×);
summary (:9) and verdict (:121) both say 0.554/1.81×; B1/A2=0.5375 is labelled "is not a
pre-registered pair … it is the LOWER ratio, so the post-hoc temptation ran in favour of the
governor and was refused" — owned. `grep -n '1\.86\|0\.539'` returns only :113 (the labelled
sentence + the legitimate 0.5396). F2 — CONFIRMED-FIXED. :113 "PASS-1 is pre-registered for
runs 7+ only; for runs 4–6 it is an exploratory reading and the strict verdict stands."
F3 — CONFIRMED-FIXED. :107 "| B2 | … | na→37.066 (at 900 s cap) | 900 |".

VERDICT: BANK (descriptive) — F1-F3 all fixed, no regressions; 1.81× in the 1.4-1.9× band, strict endpoint NOT MET.
