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

## Delta audit #14 — REPORT run 7

Line-by-line — CONFIRMED, every number/quote reproduced: results.tsv:2-4 EXACT (A1 na/
33.073→35.471; B1 12082.106/16.7674810783565/35.29→44.526/fallback=1/VOID; A2 12575.789/925/
16.5567619207553/38.429→46.69/647f906d); statuses A1 row_void=1/composer, B1 row_void=1/
new_tokens_b=na/governor_count=0, A2 row_void=0/new_tokens_a=925; B1:604 FALLBACK
`{"stage":"correctness","reason":"gpu-prefill-incorrect-Unknown",…}` VERBATIM; B1:1149 and
A2:1164 `offloaded 0/31 layers to GPU`; B1:6951 and A2:7743 `KALSA_BENCH_TOKENS …"n":1023…`;
typing_wake_4_before:7 `mWakefulness=Awake`; typing_chunks:3 `len=1412 expected=1500
result=short t=59s`; type_prompt:2 `attempt=2 chunk_size=200 seconds=34 rc=2`; adb-exit
:160/:213/:352 `rc=255 … dumpsys power`; B2 cooldown:53 `wait_s=780 skin=37.139`; driver
log:7 `DEADLINE_45_MIN`; recon:3-6 SM7675/pineapple; ratio 12082.106/12575.789 = 0.960743
→ "0.96" ✓.
Altitude — CONFIRMED. B1-as-CPU justified by :604 correctness-FALLBACK + :1149 0/31;
"labelled CPU vs CPU, not the pre-registered B/A" explicit; parity NOT-tested stated (also
PREREG:192-193); strict oracle correctly not evaluable (the pair lacks A-side ids); 
bankability confined to CPU TTFT + governor-inert-by-allowlist — no overclaim.
Omissions — CONFIRMED none: n=1023 recorded on both rows; B2/deadline included.
Cross-file — CONFIRMED: consistent with the post hoc (:191-193, :201-202, :215-217,
:224-240; "MemTotal ≤ 8 GiB" matches PREREG:233) and the :11 pointer; the 0.55-0.58 band
matches the delta-9b-corrected numbers.
F1 — MINOR, PLAUSIBLE: "oracle=VOID by construction" — the B-side ids ARE extractable from
:6951; VOID comes from the row rules; prefer "pair not evaluable (A side missing)".
F2 — NIT: PREREG:192-193 compound citation for the band quote.

## Delta audit #14 — verdict

BANK (descriptive, as a null + CPU numbers). All citations/arithmetic reproduce; CPU-vs-CPU
labelling, parity NOT-tested, oracle not-evaluable, bankability scope right; 1 minor (F1),
1 nit (F2).

## Delta audit #16 — REPORT run 8

Line-by-line — CONFIRMED, everything reproduced: results.tsv:2-5 verbatim (A1 8504.842/
21.2117596087664/30.519→43.227/647f906d; B1 4294.885/18.943680382669/GPU/CPU/FAST/36.98→
47.444/d4556574e…/FAIL; A2 na/38.46→42.633; B2 na/38.491/VOID); statuses A1/B1 row_void=0,
A2 composer, B2 hot; B1 logcat:19371 KALSA_GOVERNOR JSON EXACT — engine_prefill GPU,
engine_decode CPU, commit_bytes 12114944, commit_ms 13.387, prefill_ms 4294.885, chunks
2+128+128+128+128+128+128+128+27, prefill_ctx_ngl 99, `"forced":true`,
`"thermal_state":"FAST"` (verified in the line tail); KALSA_GOVERNOR_FALLBACK count in B1 =
0 ✓; A1:19272 / B1:19368 TELEMETRY (tokensEvaluated 1766, tokensPredicted 1023, promptMs
8504.842/4294.885, predictedPerSecond …76641/…66901) ✓; bench n=1023 at A1:19275/B1:19372 ✓;
ids verified PAIRWISE: first differing zero-based index = 7 (A 14991 vs B 2352), **24/32**
differ (my paste-compare: 24 — the report's number correct), first=597 both, last A 1094 vs
B 11319 ✓; A2 type_prompt.txt:1-4 exact (21/314/406/741 rc=2) and typing_chunks:26
(`len=4991 expected=5000 result=short t=310`) + :70 (`chunk=44 len=4400 expected=4400
result=exact t=406` — the exact-chunk-then-400-s-cap rc=2 story) ✓; B2 cooldown :1
`wait_s=0 skin=42.6` + :61 `wait_s=900 skin=38.491` ✓; driver-sa808770.log:9
`DEADLINE_85_MIN` ✓; adb-exit rc=255 count = exactly 1 at :3117 (`shell dumpsys power`) with
the `attempt=1 rc=255 has_wakefulness=1` power log ✓ (Trap-8 content-over-rc exercised);
recon memtotal_kb=11544332 (the RAM precondition passes the 8 GiB gate) ✓. Arithmetic:
4294.885/8504.842 = 0.50499 → "0.505"; inverse 1.9802 → "1.980×"; 0.55−0.505 = 0.045 ✓.
Altitude — CONFIRMED: descriptive-only per the pre-registration (PREREG:136/239 cited);
n=1 pair stated; the 0.505-vs-0.55–0.58 band comparison stated without any new claim;
"forced" explicit in the table and the evidence; the oracle FAIL correctly NOT called
"token-14" — "the observed index differs from the fork's token-14 expectation" with the
index-7 fact ✓.
Omissions — CONFIRMED none material: A2 (composer, 21/314/406/741 s ladder, 200-char-loss
observation), B2 (hot, 42.6→38.491 at 900 s), A3 (deadline) all present with causes; the
`governor_force`-value and `offloaded …/31` admissions are honest ("not in raw"), and the
GPU claim is correctly rested on the KALSA_GOVERNOR JSON alone (forced:true + ngl 99 + commit
12114944 + no-FALLBACK — sufficient, honestly bounded).
Cross-file — CONFIRMED: consistent with PREREG:235-238 (FAIL expected by the 750 defect),
:64-67 (≥2-pair rule → NOT MET with n=1), :197-200/:215-217 (next steps), and the summary
pointer at :13.
F1 — NIT: my initial pairwise doubt about "24/32" (a 30-line diff count would suggest 15)
is resolved — the direct A/B paste comparison gives exactly 24 differing indices, matching
the report.


VERDICT: BANK (descriptive) — 0 blockers, 0 majors, 0 minors, 1 nit (F1 resolved: 24/32 ids verified pairwise); every number and framing reproduced verbatim, GPU evidence honestly bounded.

## Delta audit #24 — REPORT run 10

Line-by-line — CONFIRMED: results.tsv:2-6 verbatim (A1 11619.113/17.1588647030898/28.612→
41.332; B1 6879.411/15.2509317193723/GPU CPU FAST/36.829→45.307/FAIL; A2 12158.214/
16.0592378976414; B2 6933.403/15.0910087401133/36.974→46.501/FAIL; A3 12237.042/
15.827347924405); statuses all `status=0 row_void=0 void_reason=na` (5/5 valid); B1:19597/
B2:18191 governor JSONs (prefill 6879.411/6933.403, commit_ms 13.456/12.188, forced:true,
ngl 99, FAST), `fallback_reason":""`, fallback_count=0, FALLBACK-in-logcat 0; ids pair-
verified — first diff idx 7 (14991 vs 2352), 24/32, B1==B2 and B735==B732 byte-identical
(d4556574, verified with cmp), A 647f906d; type_prompt all
`attempt=1 chunk_size=200 seconds=348/357/352/364/355 rc=0`; B2 cooldown :41
`wait_s=600 skin=36.98 target_c=37.0`; adb rc=255 count exactly 8 at
:1258/:1884/:1949/:2570/:2662/:2666/:2697/:2849, with the five `attempt=1 rc=0
has_wakefulness=1` power captures; driver-sa811930.log:11 `DEADLINE_85_MIN`. Arithmetic:
6879.411/11619.113=0.592077→0.592; 6933.403/12158.214=0.570265→0.570; median 0.581171→
0.581; 1/0.581171=1.72066→1.721 ✓. Decode deltas recomputed: (15.25093−17.15886)/
17.15886=−11.1%; (15.09101−16.05924)/16.05924=−6.0%; paired means −8.7% ✓.
F1 — MAJOR, CONFIRMED: "B3 is not in raw" is FALSE. raw/sa811930 contains
`8s-Gen-3_B_t3_cooldown.txt` with 33 samples — the cooldown was running when the deadline
hit: `wait_s=0 skin=44.92` → `wait_s=480 skin=38.245` (still above the 37.0 target), plus
11 further B_t3 files (apk_sha, bootstrap, …). The correct statement: "B3 began its
cooldown (480 s of samples, 44.92→38.25 °C) and was cut by the deadline; no B3 row". The
false "not in raw" admission sits in the report's own deviations section — fix one line.
F2 — MINOR, CONFIRMED: the decode ±10% band verdict is omitted (run 9 stated it): pair 1
−11.1% sits OUTSIDE ±10%, the paired mean −8.7% inside. State it.
Altitude — CONFIRMED: median outside the 0.95–1.05 band and below 0.85, stated as the
prior miss (PREREG:279-282, 297-299 cited); forced explicit on both B rows with A rows
"not in raw" ✓; oracle FAIL×2 with the identical-ids fact (three A7X boards now; the
PREREG:300-304 quote supports the 732/750 pair, the 735 enters via the raw cross-refs) ✓
no new claims; §(4) quotes the rule (:290-292) and lists met/unmet only, "No
recommendation" ✓; the run-9-vs-run-10 median line (0.613 vs 0.581) is arithmetic only ✓.
Omissions — otherwise none: A3 unpaired (valid, stated); harness 5/5, 200-rung-first, 
trap-8 (8 rc=255 vs 5 has_wakefulness captures — the report notes the asymmetry correctly
as "absorbed"); telemetry present for all five rows; B ends 45.307–46.501 °C.
Cross-file — CONFIRMED: consistent with the run-9 section (shared d4556574e/647f906d
cross-refs) and the :17 pointer; no contradiction.

## Delta audit #24 — verdict

NO-BANK until F1's one line is corrected ("B3 began cooldown, 480 s of samples, cut by the deadline") and F2's ±10% verdict stated. All other numbers, logs, ids, times, rc counts, and arithmetic verified verbatim.
