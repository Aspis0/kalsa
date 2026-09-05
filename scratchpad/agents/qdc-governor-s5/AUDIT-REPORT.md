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

## Verdict

BANK-WITH-FIXES. Every number reproduced; three labeling/conformance fixes (F1 endpoint-2
verdict per the oracle-PASS rule, F2 cached-thermo caveat on the FAST evidence, F3 mechanism →
leading hypothesis) plus the listed minors must be applied with the report. No finding changes
the outcomes: oracle FAIL, decode direction, TTFT not measurable, B3 memory pressure.