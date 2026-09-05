# AUDIT-REPORT — hostile audit of S5 REPORT.md (run 3, job sa803354); 2026-09-04; read-only except this file.
Re-derived every number from raw
(sa803354, sa803287, sa803304, *-VOID-*), PREREG.md (188, locked+3 amendments),
PLAN.md (1853), ALIVE.md, git log, and the fork llama-tokenize (local run, no device).

## Arithmetic — verified (all reproduce)

- TSV: A ttft 44262.824/42632.688/42787.961/42169.747; decode 24.2413/24.4669/24.3977/
  24.1046 vs B 22.0781/22.0671/4.2603/21.8947 — exact match with report table,
  raw/sa803354/results.tsv:2-9. Plateau medians turns 2-4: A 24.3977→24.4, B 21.8947→21.9.
- Prewarm: B 5156.717 (:2758), 5147.748 (:2733), 5155.171 (:2835), 5154.895 (:2724); A 9308.16
  (:1828), 9879.509 (:1659). Hash "30001358", systemChars 3015, toolCount 5 identical in both
  arms. Commit: 9206272 bytes, 10.476/8.573/9.731/9.457 ms (:6009/:6010/:6176/:6055) — all exact.
- Native variant: B "prefill":99,"decode":0 (:2605/:2581/:2636/:2577), A nGpuLayers 0 — exact.
- promptMs=0 on all B (:6006/:6006/:6173/:6052) — exact.
- Oracle: my own diff of the two ids files: positions 1-13 identical; position 14 A=20, B=5439;
  B tail 4 extra ids after realignment. ids_sha reproduce: 0f4b385a…/ed228033…. n=67 (A1 :5728),
  n=63 (B). A sha 0f4b385a in all 6 A observations incl. runs 1-2 (different APKs, see F10).
- Decode claim REPRODUCED: fork `llama-tokenize` on the locked GGUF gives exactly
  597='The'…1016='use' (32/32 tokens matching the quoted A text; id 20 = ',' at pos 14 — A
  "a simple, general" vs B "a simple request").
- lmkd_all.txt: 76 lines, 1 kill (line 4: 'com.android.dynsystem:dynsystem' (6063) …
  oom_score_adj 995); TSV app-scoped lmkd_count 0 on B rows; status=0 in all 8 *_status.txt.
- MemAvailable B3 8641760→4411844, A3 8709648→6396284 kB (meminfo files and
  driver-sa803354.log:9-12). Anchors 21:19:34.000→21:37:03.000. APK 1a1356ac… (sha file:
  "flags=[ DEBUGGABLE …]"), model push 1593894944 bytes, recon serial 7b5f6c52/SM8650/userdebug,
  session 799285/job sa803354 per PLAN.md:869-870 — all exact. Driver commits 874e326b, 7fe207ca,
  0c004018, 6bbb67b6, df07c616 verified via `git log --oneline -- d_run.sh`.
- VOID records: run 1 A1 42731.59/24.33487…; B1 skip at sa803287 logcat :2656 ("Governor mode
  does not support MTP or speculative decoding"); END exit_6 in sa803287-VOID-crash-line90:1 is
   CONSISTENT with the set -u crash — old driver line 90 `local name=…; local file=…; local
  gate="${file%.txt}_gate.txt"` — wait, old line 90 was the single-local form
  `local … gate="${file%.txt}_gate.txt"` expanding unbound $file inside
  $(thermal_record session_pre) → subshell death → NO_VALID_INITIAL_SKIN → exit 6. Run 2:
  DELETE_FAILED_INTERNAL_ERROR + count "0" + list_rc=1 + END exit_3 (fresh-board dir); rerun B1
  n_eval:305/n_past:1024 (:4852), tokensPredicted:0 (:4854), CPU/CPU commit 0 (:4858). All exact;
  PLAN.md:695-700, 707-720, 764-806 confirmed content.

## Findings

F1 — MAJOR, CONFIRMED. Endpoint-2 rule not applied as locked. PREREG.md:101-102 "Report median
plateau turns 2–4 using only oracle-PASS pairs"; all four pairs are FAIL → zero PASS pairs →
endpoint 2 is not analyzable; REPORT.md:100-101 "Plateau medians over turns 2–4 are A=24.4 and
B=21.9 tok/s, so B≥A FAILS" computes the verdict over oracle-FAIL rows. Direction is
conservative (B3's 4.26 is inside the median), but the verdict label must be "not analyzable
(zero oracle-PASS pairs); descriptive medians 24.4/21.9" — "decode FAIL" overrides the locked
rule. Fix: relabel, keep the numbers as descriptive.
F2 — MAJOR, CONFIRMED. The thermal override fed to the app carried the STALE cached skin:
QRD8650_B_t1_status.txt:1 `thermo={…"batt_temp_tenths_c":314,…"t_idle_c":31.4…}` on every turn,
t_idle_c=31.4, while live HAL skin ran 29.338-40.002 °C (some B after-readings > the declared
39.5 warning threshold). REPORT.md:111-117 flags the TSV columns as stale but its governor
evidence table (thermal_state=FAST) never states that FAST was computed from the same stale
input. Fix: one sentence in Thermals: "the same cached value was the app-side override".
F3 — MAJOR, CONFIRMED. REPORT.md:72-74 "This is deterministic divergence, therefore GPU-vs-CPU
numerics in prefill—KV computed on the Adreno 750 f16 path versus CPU—not sampling noise":
determinism is proven; the f16-numerics attribution is the leading hypothesis. Not excluded:
decode-context KV restore fidelity (commit 9206272 B), chunked-prefill boundary effects
(1329 = 512+512+305 per PLAN.md:820-832), policy/context routing differences. Fix: "leading
hypothesis", put the alternatives in the text.
F4 — MINOR, CONFIRMED. REPORT.md:114-116: live skin in B3-before is 37.562 (line 45), not
38.838; 38.838 is B3-AFTER; 40.002 is B4-AFTER (its own citation B_t4_after_thermal.txt:36,45 is
right, the label "B3-after" is wrong). Numbers as printed do not reproduce.
F5 — MINOR, CONFIRMED. REPORT.md:118 cites "raw …/driver.log:9-12"; no driver.log exists in
raw/; the file is driver-sa803354.log (values at :9-12 are correct).
F6 — MINOR, CONFIRMED. REPORT.md:125 "first device-side GPU-prefill/CPU-decode governor turns"
overreaches: PLAN S5 itself cites the fork QDC governor cell as prior art on-device; qualify
"first in this APK integration".
F7 — MINOR, CONFIRMED (omissions). Report lacks: run-3 session minutes/QDC budget usage
(PLAN.md:875 records "Budget 8 Gen 3 prima della sessione: 822 min" and "Sessione 799285
chiusa"; anchors span ≈17.5 min — report silent) and the two VOID-run APK shas
(12ecb731…3284 run 1, dd77516a…2b6a run 2 — banked in PREREG.md amendments, not the report).
Follow-up prefill_ms IS named (Next action 1) — good.
F8 — MINOR, CONFIRMED. REPORT.md:39 cites sa803304 B1 "then emitted tokensPredicted:0 (raw
…:4849-4853)"; the telemetry line is at :4854, outside the quoted range (governor line :4858
correct).
F9 — MINOR, PLAUSIBLE. REPORT.md:88 "The governor prefill path does not feed the app prompt
timer" is asserted as fact; the report gives no call-path evidence for where promptMs is set on
the governor path. Label as inference (PLAN delta-audit-3 diagnosed the batch/runtime paths,
not the timer). 
F10 — MINOR, CONFIRMED. Cross-run A determinism actually spans three different APK builds
(c5c55a4, db1606c, ac4820d) — REPORT.md:80-83 says "the same A hash appears in runs 1 and 2"
without noting those runs used other APKs; strengthens the claim but should say so.

## Checked clean

Grading label "G1-REFUTED, mechanism PROVEN" is consistent with repo usage (ALIVE row 40 "G3
refutata"; row 46 #63 "G1" for pass-grids; row 44 #61 "G1-AMENDED"): hypothesis graded and
refuted, mechanism separately stated. Oracle FAIL justified (exact-token rule, PREREG PASS/FAIL
definition applied; VOID rules respected: ids files/32 tokens present, EOS rules moot). TTFT
"not measurable" is honest (promptMs=0 vs PREREG ratio rule); prewarm comparison clearly
labelled NOT the endpoint. App-scoped lmkd=0 with the global-1-kill caveat stated. B3 memory
claim backed by meminfo. Skin ≥42 abort never triggered; thresholds acknowledged. t_idle_c/
trend units consistent. No old-contract reliance. All 13 TSV columns per PREREG. Evidence
preservation on runs 1-2 acceptable (VOID dirs + driver logs + END.txt reasons all coherent).
BANK-WITH-FIXES for the run-5 addendum. 0 blockers, 0 majors, 5 minors (F1-F5); every number, citation, and quoted log line reproduced verbatim.

## Verdict

BANK-WITH-FIXES. Every number reproduced; three labeling/conformance fixes (F1 endpoint-2
verdict per the oracle-PASS rule, F2 cached-thermo caveat on the FAST evidence, F3 mechanism →
leading hypothesis) plus the listed minors must be applied with the report. No finding changes

## Addendum audit (run 5)

Re-derived against raw/sa803459, driver-sa803459.log, PLAN.md:1038-1062, PREREG run-5 amendment.

Verified clean: 6 TSV rows (results.tsv:2-7): A1 44925.62/24.7691, B1 452.87/22.8428, A2
41845.602/24.1104, B2 457.385/22.1608, A3 42063.723/24.1201, B3 337.606/22.1401; ABORT/DONE
:13-14; skin 30.6→32.773/33.324→34.658/35.025→36.244/36.393→37.351/37.514→38.479/38.528→
39.796; thermo 306/333/350/364/375/385, t_idle 29.736, trends 0.343/1.119/0.676/0.555/0.448/
0.422 — recomputed from Δskin/Δmin, all exact; MemAvailable 8843824→6578164, 8798196→4609744, 8835648→6528764, 8821492→4586644, 8803508→6496668, 8787236→4534132; B1 :2607/:5388 (commit
9206272/6.811), B2 :2603/:5356 (14.485); B3 :2631/:5288 verbatim "…routing this turn to CPU",
:2880 prewarm 10332.545 CPU vs B2 :2818 5603.961 GPU, :5754 governor verbatim (CPU/CPU, 0/0,
337.606, cpu:2+13, WARM); gate :4 = 38.528; ids A3==B3 byte-identical (0f4b385a…), B1:14=5439
vs B3:14=20; A1 :4677/:5066, B3 :5272/:5750 (1397/1329, reusing 1314/1329) support the ~15-token
semantics; anchors 01:00:21→01:12:40; APK 0265333/sha 38d63210…/session 799390/serial
45207755; PREREG.md:227-230 gate-note quoted correctly (38.528 ≥ 38.0 ⇒ valid degraded row;
driver abort documented as limitation, status.txt:1 status=1). Causal wording compliant:
"CPU-prefilled B3 is token-identical to A" + "commit … exonerated only indirectly" as required.

F1 — MINOR, CONFIRMED. "not the requested +0.917": nothing requests it; +0.917 was run-4 B2's
observed trend. Fix: "vs the +0.917 observed in run-4 B2".
F2 — MINOR, CONFIRMED. "≈15 min and 776 min budget" cited to status.txt files that contain
neither; sources are PLAN.md:1042/:1059. Fix citation.
F3 — MINOR, CONFIRMED. Hypothesis named without the prior-art anchor (Adreno 750 f16/bf16-
batched MUL_MAT defect, ALIVE #38/#39) nor the pending decisive test (run 6 on 8 Elite). Fix:
one sentence tying it to #38/#39 and run 6.
F4 — MINOR, CONFIRMED. "board/session dependence" for A TTFT (44.9/41.8/42.1 s vs 334.86 ms)
is confounded: runs 3+5 and run 4 differ in APK too; APK-dependence fits equally. Fix:
"board and/or build; not resolved".
F5 — MINOR, CONFIRMED. Only commit is flagged "indirectly"; the two-context-design exoneration
is equally indirect (no GPU-prefilled single-context control; B3 is CPU-routed). Fix: extend
the qualifier.

## Verdict

BANK-WITH-FIXES. 0 blockers, 0 majors, 5 minors (F1-F5); every number, citation, and quoted log line reproduced verbatim.

## Addendum audit (run 6)


## Addendum audit (run 6)

Re-derived vs raw/sa803609 + driver log + PREREG run-6 amendment + ARM-A-PREFIX-REUSE doc.

Verified clean: 8 TSV rows exact (A1 43677.83/28.68714, B1 358.167/28.47050, A2 41147.348/
28.42617, B2 358.721/28.45468, A3 41689.67/28.65690, B3 359.635/28.19212, A4 41206.687/
28.53287, B4 246.45/28.33153); decode medians 28.5328696529083/28.3315347742104, ratio
0.992944 → 0.7056% lower, formal inclusive B>=A FAIL; TTFT medians 41206.687/358.721, ratio
0.00870541; oracle 4/4 PASS, sha 0f4b385a in every row; B1-B3 GPU lines :6671/:5939/:5761
(9206272, 2+13), :2814 variant 99/0; B4 :2868/:5441 routing verbatim, :5754 governor verbatim
(CPU/CPU, 0/0, 246.45, cpu:2+13, WARM), 38.084 in gate:18 and thermal:60; prewarm all 8 exact
(A 6595.56/6632.219/6748.909/6818.095, GPU-B 4063.01/4064.049/4303.089, B4 CPU 7162.874
correctly excluded); A median (6632.219+6748.909)/2=6690.564, B 4064.049; MemAvailable
driver-log:1-16 exact; skin 30.323→39.491; lmkd 0 all rows; ABORT :17/DONE :18; recon
SM8750/Android 16/2a38935c; anchors 01:23:45→01:40:08. Timer note: run-6 A logs show "reusing
1314/1329" (A_t1:6276) and "n_past=1314" (:6277), also in A2-A4; run-6 A1 gap prewarm-done
1788596641.248 → native reuse 1788596684.662 = 43.41 s vs promptMs 43677.83 — gap+eval ≈
promptMs, matching run-5's 44.471 vs 44925.62; pollution mechanism corroborated in both runs;
"reuses the prefix exactly like B" correct.

F1 — MINOR. "B4 … skin 38.084 (…gate.txt:4)": :4 is nsp4 41.1; skin sits at :18. Fix: :18.
F2 — MINOR. "budget … PREREG.md:249": 623 is at :252. Fix citation.
F3 — MINOR. "#38's 10× (ALIVE.md:418)": :418 is row 17; #38 = row 21 (~:438, ">=9.8x"). Fix.
F4 — MINOR. "CPU/GPU=1.647×": exact 6690.564/4064.049 = 1.6463×. Fix digit.
F5 — MINOR. "divergence is confined to Adreno 750": preregistered falsification logic OK, but
one 830 board + board/build confounds; kernel cause correctly stays hypothesis. Fix: "not
reproduced on the 830; attribution stands per the preregistered rule".
F6 — MINOR. Note asserts "It is timer pollution: … not the asynchronous accumulation state"
as fact; its own ARM doc says "Most likely root cause … do not print the raw stale fields needed
to prove that exact mechanism". Fix: "most consistent explanation".

## Verdict

BANK-WITH-FIXES. 0 blockers, 0 majors, 6 minors (F1-F6); every row, median, ratio, prewarm
value, oracle row, CPU-route line, and gap arithmetic reproduced verbatim.
