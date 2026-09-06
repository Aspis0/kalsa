# S5b report — runs 4–6

## Summary

Run 4 completed with `final_rc=0` [raw/driver-sa805734.log:13].

Run 4 produced one complete A/B pair, one additional valid GPU B row, and five VOID rows [raw/sa805734/results.tsv:2-9]. Run 6 adds three valid CPU A rows, two valid GPU/FAST B rows, and one `VOID(hot)` B row [raw/sa806967/results.tsv:2-7].

Across runs 4–6, GPU prefill points are n=7 and CPU A points are n=4; the locked speed endpoint remains NOT MET under the strict oracle. Run 6’s corrected same-turn exploratory PASS-1 median is B/A=0.554 (A/B=1.81×), not an endpoint result [raw/sa806967/results.tsv:3,7; PREREG.md:64-67,137].

Run 7e’s QRD7675/SM7675/Adreno 732 result exists below [PREREG.md:165 — “Two facts learned from run 7e on QRD7675 (SM7675, `ro.product.name=pineapple`, Adreno 732)”].

Run 8’s QRD8650/SM8650/Adreno 750 result exists below [PREREG.md:134 — “QRD8650/SM8650/Adreno 750”]; [raw/sa808770/results.tsv:2-5 — “A 1 8504.842 ...”; “B 1 4294.885 ...”; “A 2 na ...”; “B 2 na ...”].

Run 9’s QRD7675/SM7675/Adreno 732 result exists below [PREREG.md:294 — “## Run 9 (QRD7675, forced B) — post hoc on the first pair”].

Run 10’s QRD8635/SM8635/Adreno 735 result exists below [PREREG.md:274 — “run 10 QRD8635 (Adreno 735)”]; [raw/sa811930/recon.txt:4 — “SM8635”].

## Identity

The device was serial `2a38935c`, SoC `SM8750`, Android 16, userdebug, and debuggable [raw/sa805734/recon.txt:1-12]. The installed APK SHA-256 is `272f4547…59946`, and its package flags include `DEBUGGABLE` [raw/sa805734/8-Elite_A_t1_apk_sha.txt:1-6]. The fixed model copy reports `1593894944` bytes [raw/sa805734/8-Elite_A_t1_model_copy.txt:1]; its locked SHA is in PREREG [PREREG.md:13-15].

## Pre-registered endpoints vs outcome

The locked primary speed endpoint requires at least two adjacent oracle-PASS pairs, retaining only GPU/FAST B rows [PREREG.md:58-63]. Outcome: **NOT MET: 0 oracle-PASS pairs** [raw/sa805734/results.tsv:2-7]. The greedy oracle is a secondary endpoint and failed on the only complete pair [raw/sa805734/results.tsv:2-3]. Decode, thermal, memory, fallback, and lmkd results are descriptive because the primary pair set is empty [raw/sa805734/results.tsv:2-9].

## Rows

| row | prompt/prefill ms | decode tok/s | route/state | skin before→after | ids/oracle |
|---|---:|---:|---|---|---|
| A1 | 5945.225 / — | 26.590 | CPU / — | 30.927→41.436 | `647f906d…` / — |
| B1 | 3200.713 / 3200.713 | 26.266 | GPU→CPU / FAST | 35.914→44.630 | `17b3765f…` / FAIL |
| A2 | — / — | — | VOID(hot), cooldown 600 s | —→36.446 | na / — |
| B2 | — / — | — | VOID, reason na, cooldown 225 s | 35.986→43.268 | na / VOID |
| A3 | — / — | — | VOID(hot), cooldown 600 s | —→36.968 | na / — |
| B3 | 3228.259 / 3228.259 | 26.635 | GPU→CPU / FAST | 35.980→45.336 | `17b3765f…` / VOID |
| A4 | — / — | — | VOID(hot), cooldown 600 s | —→37.688 | na / — |
| B4 | — / — | — | VOID(hot), cooldown 600 s | —→36.256 | na / VOID |

All TSV values above are quoted from the corresponding rows [raw/sa805734/results.tsv:2-9]. Status confirms the valid rows and VOID reasons, including the injected thermo JSON and governor fields [raw/sa805734/8-Elite_A_t1_status.txt:1; raw/sa805734/8-Elite_B_t1_status.txt:1; raw/sa805734/8-Elite_A_t2_status.txt:1; raw/sa805734/8-Elite_B_t2_status.txt:1; raw/sa805734/8-Elite_A_t3_status.txt:1; raw/sa805734/8-Elite_B_t3_status.txt:1; raw/sa805734/8-Elite_A_t4_status.txt:1; raw/sa805734/8-Elite_B_t4_status.txt:1].

## Speed (descriptive)

The only complete pair is B1/A1: `3200.713 / 5945.225 = 0.538367`, or 1.857× [raw/sa805734/results.tsv:2-3]. This single-pair ratio falls in the prewarm-prior band 1.4–1.9× and not the fork expectation ≥3×, but n=1 is descriptive and excluded from the locked median [PREREG.md:61-63]. B3 supplies a second GPU point, `3228.259` ms, without an A partner [raw/sa805734/results.tsv:7]. Run-3 A1 was `5842.393` ms and was explicitly excluded by amendment [raw/sa805443/results.tsv:2; PREREG.md:113-120].

Decode is near-parity descriptively: A1 is 26.590, while B1/B3 are 26.266/26.635 tok/s [raw/sa805734/results.tsv:2-3,7]. No formal decode median is reported because the locked primary set has no PASS pair.

## Oracle

The app emitted `n=1023` on both complete-turn token lines [raw/sa805734/8-Elite_A_t1_filtered.txt:776; raw/sa805734/8-Elite_B_t1_filtered.txt:777]. The first 29 IDs match; only file line 30 differs, A=`640` versus B=`1194`, and lines 31–32 reconverge [raw/sa805734/8-Elite_A_t1_ids.txt:1-32; raw/sa805734/8-Elite_B_t1_ids.txt:1-32]. Therefore B1/A1 is measured **FAIL**, not a PASS eligible for speed [raw/sa805734/results.tsv:2-3].

Interpretation is a **HYPOTHESIS**: a near-tie logit was resolved differently by GPU f16 versus CPU numerics. This is not the systematic run-3/Adreno-750 pattern; no stronger causal claim is made from one differing ID.

## Governor evidence

B1 logged exactly the expected GPU-prefill/CPU-decode record: `KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":12114944,"commit_ms":8.356,"prefill_ms":3200.713,"prefill_chunks":"2+512+128+128+128+27",..."thermal_state":"FAST","thermo_source":"bench-skin","fit":"Fit"}` [raw/sa805734/8-Elite_B_t1_filtered.txt:776]. B3 logged the same routing and chunking, with `commit_ms=13.549` and `prefill_ms=3228.259` [raw/sa805734/8-Elite_B_t3_filtered.txt:776]. Both valid B statuses report `governor_count=1`, `commit_bytes=12114944`, `fallback_count=0`, and `lmkd_count=0` [raw/sa805734/8-Elite_B_t1_status.txt:1; raw/sa805734/8-Elite_B_t3_status.txt:1].

## Thermal

The live HAL skin rose from 30.927→41.436 °C on A1, 35.914→44.630 °C on B1, and 35.980→45.336 °C on B3 [raw/sa805734/results.tsv:2-3,7; raw/sa805734/8-Elite_A_t1_after_thermal.txt:43,63; raw/sa805734/8-Elite_B_t1_after_thermal.txt:43,63; raw/sa805734/8-Elite_B_t3_after_thermal.txt:43,63]. With the locked 36.0 °C target, A2/A3/A4/B4 reached the 600-second cap at 36.440/36.968/37.706/36.262 °C [raw/sa805734/8-Elite_A_t2_cooldown.txt:41; raw/sa805734/8-Elite_A_t3_cooldown.txt:41; raw/sa805734/8-Elite_A_t4_cooldown.txt:41; raw/sa805734/8-Elite_B_t4_cooldown.txt:41]. The B1 and B3 cooldown records reached 35.914 °C at 150 s and 35.974 °C at 480 s [raw/sa805734/8-Elite_B_t1_cooldown.txt:11; raw/sa805734/8-Elite_B_t3_cooldown.txt:33].

Thus every A after B was VOID(hot), leaving no adjacent pairs beyond pair 1 [raw/sa805734/8-Elite_A_t2_status.txt:1; raw/sa805734/8-Elite_A_t3_status.txt:1; raw/sa805734/8-Elite_A_t4_status.txt:1]. The run-3 idle probe provides context: 36.04→33.227 °C across its recorded samples [raw/sa805443/cooldown_probe.txt:1-16].

## Robustness and harness defects

Typing was complete on A1/B1/B3 at 5142/5142 characters, with 58/58/71-second type records; B2 was 5080/5142 at 81 seconds [raw/sa805734/8-Elite_A_t1_composer_len.txt:1; raw/sa805734/8-Elite_B_t1_composer_len.txt:1; raw/sa805734/8-Elite_B_t2_composer_len.txt:1; raw/sa805734/8-Elite_B_t3_composer_len.txt:1; raw/sa805734/8-Elite_A_t1_type_prompt.txt:1; raw/sa805734/8-Elite_B_t1_type_prompt.txt:1; raw/sa805734/8-Elite_B_t2_type_prompt.txt:1; raw/sa805734/8-Elite_B_t3_type_prompt.txt:1]. Tool calls were zero on valid rows [raw/sa805734/8-Elite_A_t1_filtered.txt:774; raw/sa805734/8-Elite_B_t1_filtered.txt:774; raw/sa805734/8-Elite_B_t3_filtered.txt:774]. The four-run harness history is: run 1 typing defect, run 2 tool-call confound, run 3 thermal post-turn abort, and run 4 logcat corruption [PREREG.md:102-120; raw/sa805734/adb-exit.log:949-964,1613-1633].

There were ten `rc=255` `logcat -d -b all` calls [raw/sa805734/adb-exit.log:949-964,1613-1633]. B2’s saved logcat ends mid-line at line 15100, ≈3 s after the Send-era log activity (last timestamp 1788620077.640 vs Send 1788620074/075), so the final re-dump (which replaced the file with `>`) destroyed the usable evidence and made the row VOID [raw/sa805734/8-Elite_B_t2_logcat_all.txt:15100; raw/sa805734/8-Elite_B_t2_status.txt:1].

The B2 Send tap was issued successfully before those failed dumps [raw/sa805734/adb-exit.log:944-949]; its 5080-character composer was therefore accepted by the UI, but the saved post-Send log was unusable [raw/sa805734/8-Elite_B_t2_composer_len.txt:1; raw/sa805734/8-Elite_B_t2_logcat_all.txt:15100].

## What this does and does not show

It shows GPU prefill plus KV commit executing on the 8 Elite in B1 and B3, with descriptive decode parity and no counted lmkd/fallback events on those valid rows [raw/sa805734/8-Elite_B_t1_filtered.txt:776; raw/sa805734/8-Elite_B_t3_filtered.txt:776; raw/sa805734/results.tsv:3,7]. It does not establish the locked speed endpoint, oracle correctness, or a thermal-performance estimate: there are zero oracle-PASS pairs and only one complete pair, which failed [raw/sa805734/results.tsv:2-7].

## Recommendation for run 5

Use the atomic logcat dump and parse only the last good file; retain failed/rejected attempts as evidence. Register 37.0 °C and a 720-second cooldown cap, preserving `VOID(hot)` semantics, so the observed 36.3–37.7 °C GPU cooldown plateau is not converted into avoidable VOID rows [PREREG.md:122-124].

## Addendum — runs 5a and 5b (2026-09-05)

I aborted run 5a from the orchestrator: 147 `rc=0` ring-buffer dumps were rejected by the obsolete size rule, wasting the 600-second poll. This was an orchestrator-side acceptance-rule error, not a harness defect [raw/sa806366/8-Elite_A_t1_logcat_all.txt.failures:1-147; raw/sa806366/driver.log:1]. The corrected acceptance rule is recorded in PREREG [PREREG.md:122-128].

Run 5b ended at `END reason=deadline_55_min` [raw/sa806366b/END.txt:1].

| arm/turn | ttft_ms | oracle / void_reason | skin before→after °C | cooldown_s |
|---|---:|---|---:|---:|
| A1 | 7023.858 | VOID(toolcall) | 34.883→44.15 | 0 |
| B1 | 3325.721 | VOID (oracle; row valid) | 36.993→47.007 | 435 |
| A2 | na | VOID(hot) | na→37.072 | 720 |
| B2 | 3324.109 | VOID (oracle; row valid) | 36.974→46.37 | 75 |
| A3 | na | VOID(hot) | na→37.23 | 720 |
| B3 | 3325.665 | VOID (oracle; row valid) | 36.956→47.007 | 120 |

Rows: [raw/sa806366b/results.tsv:2-7; raw/sa806366b/8-Elite_A_t1_status.txt:1; raw/sa806366b/8-Elite_B_t1_status.txt:1; raw/sa806366b/8-Elite_A_t2_status.txt:1; raw/sa806366b/8-Elite_B_t2_status.txt:1; raw/sa806366b/8-Elite_A_t3_status.txt:1; raw/sa806366b/8-Elite_B_t3_status.txt:1].

All three valid B GPU rows were deterministic: `ids_sha=17b3765fa8caf224072703547f747e2f2a58139b7e54e266476798f3ae38c277` [raw/sa806366b/results.tsv:3,5,7]. Atomic logging recorded 30 rejection records across five `.failures` files, versus 147 in 5a; accepted refreshes were `rc=0` on attempt 1 or 2 [raw/sa806366b/8-Elite_A_t1_logcat_all.txt.failures:1-4; raw/sa806366b/8-Elite_B_t1_logcat_all.txt.failures:1-7; raw/sa806366b/8-Elite_B_t2_load.txt.failures:1; raw/sa806366b/8-Elite_B_t2_logcat_all.txt.failures:1-10; raw/sa806366b/8-Elite_B_t3_logcat_all.txt.failures:1-8].

Across runs, GPU points are now n=5: 3200.713 and 3228.259 ms in run 4, then 3325.721, 3324.109, and 3325.665 ms in 5b [raw/sa805734/results.tsv:3,7; raw/sa806366b/results.tsv:3,5,7]. The CPU A point remains n=1 at 5945.225 ms [raw/sa805734/results.tsv:2]. The descriptive B/A range is 0.54–0.56 (A/B approximately 1.8×): inside the 1.4–1.9× prewarm-prior band, not the fork’s ≥3× [raw/sa805734/results.tsv:2-3,7; raw/sa806366b/results.tsv:2-7].

The pre-registered endpoint remains **NOT MET**: zero valid A rows produced zero adjacent A/B pairs [raw/sa806366b/results.tsv:2-7]. Thermal asymmetry caused this: GPU rows ended at 46.37–47.007 °C, while the post-GPU A cooldowns capped at 37.078/37.248 °C after 720 s; B cooldowns reached 37.0 °C in 75–435 s [raw/sa806366b/results.tsv:3-7; raw/sa806366b/8-Elite_A_t2_cooldown.txt:49; raw/sa806366b/8-Elite_A_t3_cooldown.txt:49; raw/sa806366b/8-Elite_B_t1_cooldown.txt:30; raw/sa806366b/8-Elite_B_t2_cooldown.txt:6; raw/sa806366b/8-Elite_B_t3_cooldown.txt:9]. Thus every A after B was `VOID(hot)` and no further pair existed [raw/sa806366b/8-Elite_A_t2_status.txt:1; raw/sa806366b/8-Elite_A_t3_status.txt:1].

## Run 6 (sa806967, 2026-09-05) — per-arm cooldown, two adjacent pairs

**Endpoint verdict first: NOT MET.** Both strict adjacent oracle pairs failed; PASS-1 is exploratory here [raw/sa806967/results.tsv:3-7; PREREG.md:137]. The run ended `END reason=exit_0` with `final_rc=0` [raw/sa806967/END.txt:1; raw/driver-sa806967.log:12].

The preserved run-6 driver selected A=38.5 °C and B=37.0 °C with a 900 s cap [d_run.run6.bak.sh:257-266; parse.run6.bak.sh:73-93].
Device identity was serial `55b03820`, SoC `SM8750`, and model `Sun for arm64` [raw/sa806967/recon.txt:1-8].

| arm/turn | TTFT ms | decode tok/s | route/state | skin before→after °C | cooldown s | oracle |
|---|---:|---:|---|---:|---:|---|
| A1 | 5855.472 | 26.779 | CPU | 33.158→42.719 | 0 | — [raw/sa806967/results.tsv:2; raw/sa806967/8-Elite_A_t1_status.txt:1] |
| B1 | 3323.508 | 26.580 | GPU/FAST | 36.919→45.279 | 195 | FAIL [raw/sa806967/results.tsv:3; raw/sa806967/8-Elite_B_t1_status.txt:1] |
| A2 | 6182.904 | 26.439 | CPU | 38.411→47.889 | 285 | — [raw/sa806967/results.tsv:4; raw/sa806967/8-Elite_A_t2_status.txt:1] |
| B2 | na | na | VOID(hot) | na→37.066 (at 900 s cap) | 900 | VOID [raw/sa806967/results.tsv:5; raw/sa806967/8-Elite_B_t2_status.txt:1; raw/sa806967/8-Elite_B_t2_cooldown.txt:61] |
| A3 | 6155.242 | 26.638 | CPU | 37.375→46.675 | 0 | — [raw/sa806967/results.tsv:6; raw/sa806967/8-Elite_A_t3_status.txt:1] |
| B3 | 3321.319 | 26.937 | GPU/FAST | 36.986→46.392 | 855 | FAIL [raw/sa806967/results.tsv:7; raw/sa806967/8-Elite_B_t3_status.txt:1] |

B1/B3 carried `commit_bytes=12114944`, `commit_ms=10.455/10.796`, and GPU chunks `2+128+128+128+128+128+128+128+27` [raw/sa806967/8-Elite_B_t1_status.txt:1; raw/sa806967/8-Elite_B_t3_status.txt:1; raw/sa806967/results.tsv:3,7].

Strict oracle: A1/B1 and A3/B3 fail. A1/B1, A2/B1, and A3/B3 all differ only at index 29, A=`640` and B=`1194`, then re-converge at indices 30–32; this repeats run 4 [raw/sa806967/8-Elite_A_t1_ids.txt:30-32; raw/sa806967/8-Elite_A_t2_ids.txt:30-32; raw/sa806967/8-Elite_A_t3_ids.txt:30-32; raw/sa806967/8-Elite_B_t1_ids.txt:30-32; raw/sa806967/8-Elite_B_t3_ids.txt:30-32; raw/sa805734/8-Elite_A_t1_ids.txt:30-32; raw/sa805734/8-Elite_B_t1_ids.txt:30-32]. PREREG requires the “median of each B prefill_ms divided by its same-turn A promptMs … adjacent A/B pairs” [PREREG.md:64-67]. Thus A1/B1=`3323.508/5855.472=0.5676` and A3/B3=`3321.319/6155.242=0.5396`; A2/B2 has no valid B [raw/sa806967/results.tsv:2-7]. Under exploratory PASS-1, the same-turn pairs pass and their median is `median(0.5676,0.5396)=0.5536→0.554` (A/B `1.81×`), descriptive only [raw/sa806967/results.tsv:2-7]. B1/A2=`3323.508/6182.904=0.5375` is not a pre-registered pair; shown only because A2 started warm (38.4 °C) — it is the LOWER ratio, so the post-hoc temptation ran in favour of the governor and was refused [raw/sa806967/results.tsv:3-4]. An earlier draft paired B1/A2 at the orchestrator's instruction; corrected on audit to the pre-registered same-turn rule. PASS-1 is pre-registered for runs 7+ only; for runs 4–6 it is an exploratory reading and the strict verdict stands. This is descriptive, inside the 1.4–1.9× prewarm-prior band and below the fork’s ≥3× expectation [PREREG.md:135,137].

The fairness caveat materialised: A2/A3 were ≈5.6%/5.1% slower than A1, using the recorded A TTFTs; that bias is against CPU [raw/sa806967/results.tsv:2,4,6]. The per-arm scheme rescued 3/3 valid A rows versus 0/3 in run 5b, at the cost of B2 [raw/sa806967/results.tsv:2,4,6; raw/sa806366b/results.tsv:2,4,6; raw/sa806967/results.tsv:5].

The B target falsified PREREG:130’s “always reached in 75–435 s” statement. After A2 ended at 47.889 °C, B2 still read 37.066 °C at 900 s; B3 required 855 s [raw/sa806967/results.tsv:4; raw/sa806967/8-Elite_B_t2_cooldown.txt:61; raw/sa806967/8-Elite_B_t3_status.txt:1]. Decode was near-parity descriptively: A=`26.779/26.439/26.638` versus valid B=`26.580/26.937` tok/s [raw/sa806967/results.tsv:2-7].

Cross-run prefill points are GPU n=7: `3200.713, 3228.259` [raw/sa805734/results.tsv:3,7], `3325.721, 3324.109, 3325.665` [raw/sa806366b/results.tsv:3,5,7], and `3323.508, 3321.319` [raw/sa806967/results.tsv:3,7]; CPU n=4: `5945.225` [raw/sa805734/results.tsv:2] and `5855.472, 6182.904, 6155.242` [raw/sa806967/results.tsv:2,4,6].

**Verdict:** the pre-registered endpoint is NOT MET under the strict oracle; corrected exploratory PASS-1 gives a descriptive 1.81× governor prefill on 8 Elite in-app, not an endpoint win. Recommend BANK as descriptive only and defer the strict-oracle question to the 750 divergence study (`docs/GPU-PREFILL-DIVERGENCE*`).

## Run 7 — QRD7675 / SM7675 / Adreno 732 (7a–7e, 5/09)

| run | session | outcome | trap/cause | evidence file |
|---|---|---|---|---|
| 7a | sa807321a | no data | Composer trap: cleared length 17; A1/B1 VOID and A2 aborted | [PREREG.md:141 — “Run 7a produced no data: A1/B1 were composer VOID and A2 aborted”]; [raw/sa807321a/7p-Gen-3_A_t1_composer_len.txt:1-2 — “attempt=cleared actual=17 expected=5142”]; [raw/sa807321a/END.txt:1 — “END reason=exit_1”] |
| 7b | sa807321 | no data | A1 typing cap: initial 133 s, retype 55 s, total 188 s, rc=2 | [PREREG.md:148-149 — “retype_seconds=55 rc=2 total_seconds=188”; “150 s total typing cap caused the VOID”]; [raw/sa807321/7p-Gen-3_A_t1_type_prompt.txt:1-2 — “initial_seconds=133 rc=0 total_seconds=133”; “retype_seconds=55 rc=2 total_seconds=188”] |
| 7c | sa807902a | no data | UI dump failed before typing; 64-byte file reported no such file; prewarm 118 s | [PREREG.md:154 — “Run 7c aborted before typing: ... was 64 bytes (`cat: /data/local/tmp/kalsa-s5/ui.xml: No such file or directory`); the prewarm took 118 s”]; [raw/sa807902a/7p-Gen-3_A_t1_edit.xml:1 — “cat: /data/local/tmp/kalsa-s5/ui.xml: No such file or directory”] |
| 7d | sa807902b | no data | Edit dump was SystemUI/AOD with no EditText | [PREREG.md:159 — “Run 7d lost A1 and B1 to `VOID(composer)`: the successful edit dump was 9.6 kB of `com.android.systemui` AOD content with no `EditText`”]; [raw/sa807902b/7p-Gen-3_A_t1_edit.xml:1 — “package=\"com.android.systemui\"”] |

| arm | turn | TTFT ms | decode t/s | new tokens | skin before→after | fallback_count | oracle | void_reason |
|---|---:|---:|---:|---|---:|---:|---|---|
| A | 1 | na | na | na | 33.073→35.471 | 0 | na | composer [raw/sa807902/results.tsv:2 — “A 1 na na na na na na na na na na 33.073 35.471 0 0 na na”]; [raw/sa807902/7p-Gen-3_A_t1_status.txt:1 — “row_void=1 ... void_reason=composer”] |
| B | 1 | 12082.106 | 16.7674810783565 | na; bench n=1023 | 35.29→44.526 | 1 | VOID | na [raw/sa807902/results.tsv:3 — “B 1 12082.106 na na na na 16.7674810783565 na na na 35.29 44.526 1 0 na VOID”]; [raw/sa807902/7p-Gen-3_B_t1_status.txt:1 — “row_void=1 ... new_tokens_b=na ... governor_count=0 ... void_reason=na”]; [raw/sa807902/7p-Gen-3_B_t1_logcat_all.txt:6951 — “KALSA_BENCH_TOKENS {\"turnId\":\"1\",\"n\":1023”] |
| A | 2 | 12575.789 | 16.5567619207553 | 925; bench n=1023 | 38.429→46.69 | 0 | na | na [raw/sa807902/results.tsv:4 — “A 2 12575.789 na na 925 na 16.5567619207553 na na na 38.429 46.69 0 0 647f906da19958f2ed5acd8f80f17f5c01946a292743dd57e0ad3a68d4d5b27d na”]; [raw/sa807902/7p-Gen-3_A_t2_status.txt:1 — “row_void=0 ... new_tokens_a=925 ... governor_count=0 ... void_reason=na”]; [raw/sa807902/7p-Gen-3_A_t2_logcat_all.txt:7743 — “KALSA_BENCH_TOKENS {\"turnId\":\"1\",\"n\":1023”]; [raw/sa807902/7p-Gen-3_A_t2_ids.txt:1,32 — “597”; “1094”] |

## What run 7e establishes

Recon records `ro.soc.model=SM7675` and `ro.product.name=pineapple` [raw/sa807902/recon.txt:3-6 — “ro.soc.model”; “SM7675”; “ro.product.name”; “pineapple”]. The fixed prompt is 938 model tokens [PREREG.md:22-24 — “893 whitespace words, 5,142 bytes, auditor-tokenized to 938 model tokens”].

A2 TTFT is 12575.789 ms and B1 TTFT is 12082.106 ms [raw/sa807902/results.tsv:3-4 — “B 1 12082.106 ...”; “A 2 12575.789 ...”]. A2 is CPU because its logcat says “offloaded 0/31 layers to GPU” [raw/sa807902/7p-Gen-3_A_t2_logcat_all.txt:1164 — “offloaded 0/31 layers to GPU”]. B1 is CPU after the governor fallback because it logs “KALSA_GOVERNOR_FALLBACK ... Unknown” and “offloaded 0/31 layers to GPU” [raw/sa807902/7p-Gen-3_B_t1_logcat_all.txt:604,1149 — “KALSA_GOVERNOR_FALLBACK {\"stage\":\"correctness\",\"reason\":\"gpu-prefill-incorrect-Unknown\"”; “offloaded 0/31 layers to GPU”]. B1/A2 = 0.96, labelled **CPU vs CPU, not the pre-registered B/A** [raw/sa807902/results.tsv:3-4 — “B 1 12082.106 ...”; “A 2 12575.789 ...”]; [PREREG.md:136 — “endpoint definitions (median over at least two oracle-PASS GPU/FAST adjacent pairs)”].

The governor is inert on SM7675 by allowlist; PREREG post hoc point 2 says “QRD7675 (SM7675) ... Unknown → no in-app GPU prefill path exists” and “the shipped governor routes CPU there” [PREREG.md:179-181,191-195]. The pre-registered mid-tier endpoint, parity band 1.01–1.05, is **NOT tested by this run** [PREREG.md:192-193 — “the pre-registered mid-tier band (1.01–1.05, parity) ... run 7e does not test it”].

## Not bankable / deviations

Strict oracle: the A1/B1 pair is not evaluable because the A side is missing (A1 never sent); B1's ids are in its logcat (n=1023, raw/sa807902/7p-Gen-3_B_t1_logcat_all.txt:6951) and its `oracle=VOID` comes from the row rules (ids_sha forced na on a VOID row), not from absent ids (audit #14 F1) [raw/sa807902/7p-Gen-3_A_t1_status.txt:1 — “row_void=1 ... void_reason=composer”; raw/sa807902/7p-Gen-3_B_t1_status.txt:1 — “row_void=1 ... new_tokens_b=na”; raw/sa807902/results.tsv:3 — “... na VOID”]. There is n=1 valid A row: A2 has `row_void=0`, while A1 is `row_void=1` [raw/sa807902/7p-Gen-3_A_t2_status.txt:1 — “row_void=0”; raw/sa807902/7p-Gen-3_A_t1_status.txt:1 — “row_void=1”]. No B row reached GPU: B1 logged the fallback and “offloaded 0/31 layers to GPU,” with `governor_count=0` [raw/sa807902/7p-Gen-3_B_t1_logcat_all.txt:604,1149 — “KALSA_GOVERNOR_FALLBACK ... Unknown”; “offloaded 0/31 layers to GPU”]; [raw/sa807902/7p-Gen-3_B_t1_status.txt:1 — “governor_count=0”]. The prior blind spot is owned in PREREG: “§\"Runs 7+\" was written ... without reading the app allowlist. It is left as written; this section records the correction” [PREREG.md:201-202].

A1’s VOID cause was the rc-only wake trap: the wake file says “mWakefulness=Awake” [raw/sa807902/7p-Gen-3_A_t1_typing_wake_4_before.txt:7 — “mWakefulness=Awake”], but adb-exit has `rc=255 ... dumpsys power` at lines 160, 213, and 352 [raw/sa807902/adb-exit.log:160,213,352 — “rc=255 -s f6d5d957 shell dumpsys power”]. PREREG records that `typing_awake` treats any nonzero rc as fatal and sends the row to VOID [PREREG.md:168-177 — “typing_awake treats any rc≠0 as fatal ... → VOID”]. The typing trace also records “len=1412 expected=1500 result=short” and then `rc=2` [raw/sa807902/7p-Gen-3_A_t1_typing_chunks.txt:3 — “len=1412 expected=1500 result=short”; raw/sa807902/7p-Gen-3_A_t1_type_prompt.txt:2 — “attempt=2 chunk_size=200 seconds=34 rc=2”]. B2 produced no row before the deadline: results.tsv ends at A2 [raw/sa807902/results.tsv:1-4 — “A 1 ...”; “B 1 ...”; “A 2 ...”], cooldown reached `wait_s=780 skin=37.139 target_c=37.0`, then the driver ended `DEADLINE_45_MIN` [raw/sa807902/7p-Gen-3_B_t2_cooldown.txt:53 — “wait_s=780 skin=37.139 target_c=37.0”; raw/driver-sa807902.log:7 — “[19:17:51] DEADLINE_45_MIN”].

Next per PREREG “Run 7e → run 8”: QRD8650 is next because it is the only remaining board whose in-app B can reach the GPU; QRD8635 and HDK8550 are parked for the owner’s call [PREREG.md:215-217 — “QRD8650 is next because it is the only remaining board on which an in-app B arm can reach the GPU”; “QRD8635 and HDK8550 are NOT dropped here ... parked for the owner’s call”]. The registered run forces B on V75, voids B without GPU or with fallback, requires RAM above 8 GiB, and remains descriptive at B/A 0.55–0.58 with the known strict-oracle failure; it uses same-turn adjacent-pair medians, A/B cooldown 38.5/37.0 °C, a 900 s cap, ABABAB order, and an 85 min deadline on a fresh 120 min session [PREREG.md:224-240 — “Arm B forces the governor on V75 only”; “B must actually reach the GPU”; “MemTotal ≤ 8 GiB”; “Expected band B/A 0.55–0.58”; “Strict oracle expected FAIL”; “Pairing: same-turn adjacent pairs, median”; “Cooldown A 38.5 / B 37.0 °C, cap 900 s”; “Order ABABAB, deadline 85 min on a fresh 120-min session”].

## Run 8 — QRD8650 / SM8650 / Adreno 750 (5/09, governor forced on arm B)

| arm | turn | TTFT ms | prefill_ms | chunks | decode t/s | new tokens | engines (prefill/decode) | thermal_state | skin before→after | forced | oracle | void_reason |
|---|---:|---:|---:|---|---:|---:|---|---|---:|---|---|---|
| A | 1 | 8504.842 | na | na | 21.212 | 925 | na/na | na | 30.519→43.227 | not in raw | na | na [raw/sa808770/results.tsv:2 — “A 1 8504.842 na na na 925 na 21.2117596087664 na na na 30.519 43.227 0 0 647f906da19958f2ed5acd8f80f17f5c01946a292743dd57e0ad3a68d4d5b27d na”] |
| B | 1 | 4294.885 | 4294.885 | 2+128+128+128+128+128+128+128+27 | 18.944 | 925 | GPU/CPU | FAST | 36.98→47.444 | true | FAIL | na [raw/sa808770/results.tsv:3 — “B 1 4294.885 4294.885 2+128+128+128+128+128+128+128+27 na 925 18.943680382669 GPU CPU FAST 36.98 47.444 0 0 d4556574e02f80bccb5b5d0edb5cf67b134216bdaf05a119882e6a24787fdded FAIL”]; [raw/sa808770/8-Gen-3_B_t1_logcat_all.txt:19371 — “KALSA_GOVERNOR ... forced\":true ... thermal_state\":\"FAST\"”] |
| A | 2 | na | na | na | na | na | na/na | na | 38.46→42.633 | not in raw | na | composer [raw/sa808770/results.tsv:4 — “A 2 na na na na na na na na na na 38.46 42.633 0 0 na na”]; [raw/sa808770/8-Gen-3_A_t2_status.txt:1 — “row_void=1 ... void_reason=composer”] |
| B | 2 | na | na | na | na | na | na/na | na | na→38.491 | not in raw | VOID | hot [raw/sa808770/results.tsv:5 — “B 2 na na na na na na na na na na 38.491 0 0 na VOID”]; [raw/sa808770/8-Gen-3_B_t2_status.txt:1 — “row_void=1 ... void_reason=hot”] |

The A/B `set_prefs` files quote only successful push/permission returns, not `governor_force`; its A/B key values are **not in raw** [raw/sa808770/8-Gen-3_A_t1_set_prefs.txt:2-3 — “run_as_attempt=1 chmod_rc=0 run_rc=0”; raw/sa808770/8-Gen-3_B_t1_set_prefs.txt:2-3 — “run_as_attempt=1 chmod_rc=0 run_rc=0”].

## What run 8 establishes

B1/A1 = 4294.885/8504.842 = 0.505 = 1/1.980 (A/B=1.980×), calculated from the two valid TSV rows [raw/sa808770/results.tsv:2 — “A 1 8504.842 ...”; :3 — “B 1 4294.885 ...”]. This is one same-turn adjacent pair, and the 750 result is descriptive only [raw/sa808770/results.tsv:2-5 — “A 1 ...”; “B 1 ...”; “A 2 ...”; “B 2 ...”]; [PREREG.md:136 — “QRD8650 is last; its B rows are descriptive/oracle evidence only”]; [PREREG.md:239 — “Pairing: same-turn adjacent pairs, median”].

The observed 0.505 is below the pre-registered 0.55–0.58 band by 0.045 from its lower edge (0.55−0.505) [PREREG.md:235-236 — “Expected band B/A 0.55–0.58”]; [raw/sa808770/results.tsv:2-3 — “A 1 8504.842 ...”; “B 1 4294.885 ...”].

B1 committed 12114944 KV bytes in 13.387 ms [raw/sa808770/8-Gen-3_B_t1_logcat_all.txt:19371 — “commit_bytes":12114944,"commit_ms":13.387”]. Decode was 18.944 t/s on B versus 21.212 t/s on A [raw/sa808770/results.tsv:2-3 — “21.2117596087664”; “18.943680382669”]. The B1 governor record says `engine_prefill=GPU`, `engine_decode=CPU`, `prefill_ctx_ngl=99`, `forced=true`, and `thermal_state=FAST`; no `KALSA_GOVERNOR_FALLBACK` line is in raw [raw/sa808770/8-Gen-3_B_t1_logcat_all.txt:19371 — “KALSA_GOVERNOR ... engine_prefill\":\"GPU\" ... engine_decode\":\"CPU\" ... prefill_ctx_ngl\":99 ... forced\":true ... thermal_state\":\"FAST\"”].

A telemetry reports `promptMs=8504.842`, `tokensEvaluated=1766`, `tokensPredicted=1023`, and `predictedPerSecond=21.21175960876641`; B reports `promptMs=4294.885`, `tokensEvaluated=1766`, `tokensPredicted=1023`, and `predictedPerSecond=18.94368038266901` [raw/sa808770/8-Gen-3_A_t1_logcat_all.txt:19272 — “KALSA_TELEMETRY ... tokensEvaluated":1766 ... tokensPredicted":1023 ... promptMs":8504.842 ... predictedPerSecond":21.21175960876641”; raw/sa808770/8-Gen-3_B_t1_logcat_all.txt:19368 — “KALSA_TELEMETRY ... tokensEvaluated":1766 ... tokensPredicted":1023 ... promptMs":4294.885 ... predictedPerSecond":18.94368038266901”]. Both `KALSA_BENCH_TOKENS` lines report `n=1023`; the requested `offloaded .../31 layers to GPU` text is not in raw [raw/sa808770/8-Gen-3_A_t1_logcat_all.txt:19275 — “KALSA_BENCH_TOKENS {\"turnId\":\"1\",\"n\":1023”; raw/sa808770/8-Gen-3_B_t1_logcat_all.txt:19372 — “KALSA_BENCH_TOKENS {\"turnId\":\"1\",\"n\":1023”].

The strict oracle is FAIL: the first differing zero-based index is 7, where A has 14991 and B has 2352, and 24/32 IDs differ [raw/sa808770/8-Gen-3_A_t1_ids.txt:8 — “14991”; raw/sa808770/8-Gen-3_B_t1_ids.txt:8 — “2352”; raw/sa808770/8-Gen-3_A_t1_ids.txt:1,32 — “597”; “1094”; raw/sa808770/8-Gen-3_B_t1_ids.txt:1,32 — “597”; “11319”]; [raw/sa808770/results.tsv:3 — “... FAIL”]. This is consistent with the known 750 f16/bf16-batched defect, but the observed index differs from the fork’s token-14 expectation [PREREG.md:235-238 — “Strict oracle expected FAIL by the known Adreno 750 f16/bf16-batched MUL_MAT defect (deterministic divergence at token 14, ALIVE 38/39/48)”].

## Not bankable / deviations

Strict oracle FAIL means the primary endpoint is NOT MET: the preregistration requires at least 2 oracle-PASS GPU/FAST adjacent pairs, otherwise speed is descriptive [raw/sa808770/results.tsv:3 — “FAIL”]; [PREREG.md:64-67 — “Require ≥2 such pairs ... otherwise speed is descriptive only”]. Thus n=1 pair: A1/B1 is the only complete pair; A2/B2 are VOID [raw/sa808770/results.tsv:2-5 — “A 1 ...”; “B 1 ...”; “A 2 ...”; “B 2 ...”]; [raw/sa808770/8-Gen-3_A_t2_status.txt:1 — “row_void=1 ... void_reason=composer”]; [raw/sa808770/8-Gen-3_B_t2_status.txt:1 — “row_void=1 ... void_reason=hot”].

A2 was VOID(composer) on the hot board after GPU B1, with skin 38.46→42.633 °C: the 500-char attempt failed, the 200-char attempt failed after 314 s, and the 100-char attempt hit 406 s at chunk 44/4400 chars [raw/sa808770/results.tsv:3-4 — “B 1 ... GPU ... 47.444”; “A 2 ... 38.46 42.633 ...”]; [raw/sa808770/8-Gen-3_A_t2_type_prompt.txt:1-4 — “attempt=1 chunk_size=500 seconds=21 rc=1”; “attempt=2 chunk_size=200 seconds=314 rc=1”; “attempt=3 chunk_size=100 seconds=406 rc=2”; “initial_seconds=741 rc=2 total_seconds=741”]; [raw/sa808770/8-Gen-3_A_t2_typing_chunks.txt:70 — “attempt=3 chunk=44 len=4400 expected=4400 result=exact t=406”]. New harness observation: 200-char chunks also lose characters after the GPU turn [raw/sa808770/8-Gen-3_A_t2_typing_chunks.txt:26 — “attempt=2 chunk=25 len=4991 expected=5000 result=short t=310”].

B2 was VOID(hot): after A2 ended at 42.633 °C, B2 started at 42.6 °C and remained 38.491 °C at the 900 s cap against a 37.0 °C target [raw/sa808770/results.tsv:4 — “A 2 ... 38.46 42.633 ...”; raw/sa808770/8-Gen-3_B_t2_cooldown.txt:1,61 — “wait_s=0 skin=42.6 target_c=37.0”; “wait_s=900 skin=38.491 target_c=37.0”]. A3 was lost to the 85-minute deadline [raw/driver-sa808770.log:9 — “[21:11:05] DEADLINE_85_MIN”].

Trap-8’s content-over-rc fix was exercised: `adb-exit.log` has 1 `rc=255` line, while a power capture records `rc=255 has_wakefulness=1` [raw/sa808770/adb-exit.log:3117 — “rc=255 ... shell dumpsys power”; raw/sa808770/8-Gen-3_A_t3_typing_chunk_a2_c5.xml.power_attempt1.txt.log:1 — “attempt=1 rc=255 has_wakefulness=1”].

## Next

None beyond the owner’s call on QRD8635/HDK8550 and on whether the 750 stays allowlisted off [PREREG.md:197-200 — “QRD8650 (V75): GPU path exists but is allowlisted off ... `kalsa.bench.governor_force=1` re-enables it”; PREREG.md:215-217 — “QRD8635 and HDK8550 ... parked for the owner’s call”].

## Run 9 — QRD7675 / SM7675 / Adreno 732 (6/09, governor forced on arm B)

Identity: recon says `SM7675` and `memtotal_kb=11595000` [raw/sa811420/recon.txt:4 — “SM7675”; raw/sa811420/recon.txt:22 — “memtotal_kb=11595000”].

| arm | turn | TTFT ms | prefill_ms | chunks | decode t/s | new tokens | engines | thermal_state | skin before→after °C | forced | oracle | void_reason | evidence |
|---|---:|---:|---:|---|---:|---:|---|---|---:|---|---|---|---|
| A | 1 | 11769.454 | na | na | 16.975 | 925 | na/na | na | 28.18→40.718 | not in raw | na | na | [raw/sa811420/results.tsv:2 — “A 1 11769.454 na na 925 na 16.9754551180914 ... 28.18 40.718 ... na”]; [raw/sa811420/7p-Gen-3_A_t1_status.txt:1 — “status=0 row_void=0 ... governor_count=0 ... void_reason=na”] |
| B | 1 | 7423.184 | 7423.184 | 2+128+128+128+128+128+128+128+27 | 14.953 | 925 | GPU/CPU | FAST | 36.834→44.961 | true | FAIL | na | [raw/sa811420/results.tsv:3 — “B 1 7423.184 7423.184 ... 14.95339102565 GPU CPU FAST 36.834 44.961 ... FAIL”]; [raw/sa811420/7p-Gen-3_B_t1_logcat_all.txt:19210 — “KALSA_GOVERNOR ... forced":true ...”] |
| A | 2 | 12475.128 | na | na | 16.470 | 925 | na/na | na | 38.448→46.928 | not in raw | na | na | [raw/sa811420/results.tsv:4 — “A 2 12475.128 na na 925 na 16.4701727827384 ... 38.448 46.928 ... na”]; [raw/sa811420/7p-Gen-3_A_t2_status.txt:1 — “status=0 row_void=0 ... governor_count=0 ... void_reason=na”] |
| B | 2 | 7421.679 | 7421.679 | 2+128+128+128+128+128+128+128+27 | 14.857 | 925 | GPU/CPU | FAST | 36.956→46.631 | true | FAIL | na | [raw/sa811420/results.tsv:5 — “B 2 7421.679 7421.679 ... 14.8570697606086 GPU CPU FAST 36.956 46.631 ... FAIL”]; [raw/sa811420/7p-Gen-3_B_t2_logcat_all.txt:18017 — “KALSA_GOVERNOR ... forced":true ...”] |
| A | 3 | 12543.090 | na | na | 16.346 | 925 | na/na | na | 38.405→47.571 | not in raw | na | na | [raw/sa811420/results.tsv:6 — “A 3 12543.09 na na 925 na 16.3464519762333 ... 38.405 47.571 ... na”]; [raw/sa811420/7p-Gen-3_A_t3_status.txt:1 — “status=0 row_void=0 ... governor_count=0 ... void_reason=na”] |

Both B governor records also report `prefill_ctx_ngl=99` [raw/sa811420/7p-Gen-3_B_t1_logcat_all.txt:19210 — “prefill_ctx_ngl":99”; raw/sa811420/7p-Gen-3_B_t2_logcat_all.txt:18017 — “prefill_ctx_ngl":99”].

B-ID shasum/diff check: B1=B2 and run-9 B1=run-8 B1; the prereg record quotes “the GPU ids are byte-identical to the QRD8650 GPU ids” and names both ID files [raw/sa811420/results.tsv:3,5 — “d4556574e02f80...”]; [PREREG.md:300-302 — “GPU ids are byte-identical ... raw/sa811420/7p-Gen-3_B_t1_ids.txt and raw/sa808770/8-Gen-3_B_t1_ids.txt”].

## What run 9 establishes

Pairing was “same-turn adjacent pairs, median” [PREREG.md:274-276 — “Pairing: same-turn adjacent pairs, median”]. B1/A1 = `7423.184/11769.454 = 0.631`; B2/A2 = `7421.679/12475.128 = 0.595`; median = `0.613`, `1/median = 1.632` [results.tsv:2-5 — “A 1 11769.454 ...”; “B 1 7423.184 ...”; “A 2 12475.128 ...”; “B 2 7421.679 ...”].

The median is OUTSIDE the pre-registered `0.95–1.05` parity band and BELOW the `0.85` threshold that “would reopen the policy for V73 mid-tier” [PREREG.md:279-282 — “B/A 0.95–1.05 = parity ... B/A ≤ 0.85 would be a real gain and would reopen the policy for V73 mid-tier”]. This is a miss of the prior, which assumed an in-app discount; it is reported, not adjusted [PREREG.md:297-299 — “The prior assumed an in-app discount ... Reported as a miss of the prior, not adjusted”].

Decode B vs A is `−11.9%` for pair 1 and `−9.8%` for pair 2; paired-mean B vs A is `−10.9%`, just outside the `±10%` expectation [results.tsv:2-5 — “16.9754551180914”; “14.95339102565”; “16.4701727827384”; “14.8570697606086”]; [PREREG.md:288-289 — “B decode ... within ±10% of A decode”]. KV commit is `12114944` bytes at `15.847` ms (B1) and `13.439` ms (B2) [B_t1_logcat_all.txt:19210 — “commit_bytes":12114944,"commit_ms":15.847”; B_t2_logcat_all.txt:18017 — “commit_bytes":12114944,"commit_ms":13.439”].

Telemetry has `tokensPredicted=1023` plus `promptMs`/`predictedPerSecond` for every valid row [A_t1_filtered.txt:773 — “tokensPredicted":1023 ... promptMs":11769.454 ... predictedPerSecond":16.97545511809142”; B_t1_filtered.txt:773 — “tokensPredicted":1023 ... promptMs":7423.184 ... predictedPerSecond":14.95339102565002”; A_t2_filtered.txt:773 — “tokensPredicted":1023 ... promptMs":12475.128 ... predictedPerSecond":16.47017278273841”; B_t2_filtered.txt:773 — “tokensPredicted":1023 ... promptMs":7421.679 ... predictedPerSecond":14.857069760608603”; A_t3_filtered.txt:773 — “tokensPredicted":1023 ... promptMs":12543.09 ... predictedPerSecond":16.346451976233315”]. B status has `fallback_count=0` and governor JSON has `fallback_reason":""` [B_t1_status.txt:1 — “fallback_count=0”; B_t2_status.txt:1 — “fallback_count=0”; B_t1_logcat_all.txt:19210 — “fallback_reason":""”; B_t2_logcat_all.txt:18017 — “fallback_reason":""”].

B ends at `44.961–46.631 °C` (45–47 °C rounded); cooldown waits are `75 s` and `810 s` [results.tsv:3,5 — “44.961”; “46.631”]; [B_t1_cooldown.txt:6 — “wait_s=75 skin=36.858 target_c=37.0”; B_t2_cooldown.txt:55 — “wait_s=810 skin=36.962 target_c=37.0”]. B3 cooldown stopped at `wait_s=60`, `skin=43.777 °C` [B_t3_cooldown.txt:5 — “wait_s=60 skin=43.777 target_c=37.0”].

Oracle is FAIL×2 [results.tsv:3,5 — “... FAIL”; “... FAIL”]. A1/B1 first differs at zero-based index `7` (file line 8: A `14991`, B `2352`), with `24/32` IDs differing [A_t1_ids.txt:8 — “14991”; B_t1_ids.txt:8 — “2352”; A_t1_ids.txt:1-32; B_t1_ids.txt:1-32]. B1 and B2, and 732 B and 750 B, have the same `d4556574...` ID hash; CPU IDs share `647f906d...` across 732 and 750 [results.tsv:3,5 — “d4556574e02f80...”; raw/sa808770/results.tsv:3 — “d4556574e02f80...”; results.tsv:2,4,6 — “647f906da19958...”; raw/sa808770/results.tsv:2 — “647f906da19958...”]. Per the prereg post hoc: “the in-app divergence at index 7 is a deterministic property of the Adreno 7xx (A7X) GPU prefill path shared by the 732 and the 750 — it is NOT caused by the 750-only 20-FAIL MUL_MAT family” [PREREG.md:300-304].

Harness: 5/5 rows are valid [raw/sa811420/7p-Gen-3_A_t1_status.txt:1; raw/sa811420/7p-Gen-3_B_t1_status.txt:1; raw/sa811420/7p-Gen-3_A_t2_status.txt:1; raw/sa811420/7p-Gen-3_B_t2_status.txt:1; raw/sa811420/7p-Gen-3_A_t3_status.txt:1 — “status=0 row_void=0”]; typing was one first attempt at 200 every time: `361/369/377/378/381 s` [raw/sa811420/7p-Gen-3_A_t1_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=361 rc=0”; raw/sa811420/7p-Gen-3_B_t1_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=369 rc=0”; raw/sa811420/7p-Gen-3_A_t2_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=377 rc=0”; raw/sa811420/7p-Gen-3_B_t2_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=378 rc=0”; raw/sa811420/7p-Gen-3_A_t3_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=381 rc=0”]. Trap-8 was exercised: five `rc=255` power calls [raw/sa811420/adb-exit.log:350,763,1471,2253,2912 — “rc=255 ... shell dumpsys power”] versus five captures with `has_wakefulness=1` [raw/sa811420/7p-Gen-3_A_t1_load_wakes.txt.power.log:1; raw/sa811420/7p-Gen-3_A_t2_load_wakes.txt.power.log:1; raw/sa811420/7p-Gen-3_A_t3_load_wakes.txt.power.log:1; raw/sa811420/7p-Gen-3_B_t1_load_wakes.txt.power.log:1; raw/sa811420/7p-Gen-3_B_t2_load_wakes.txt.power.log:1 — “attempt=1 rc=0 has_wakefulness=1”].

## Not bankable / deviations

Strict oracle FAIL×2 means endpoint NOT MET; the result is descriptive [results.tsv:3,5 — “B 1 ... FAIL”; “B 2 ... FAIL”]; PREREG says an oracle FAIL “turns the row descriptive” [PREREG.md:286-287 — “A FAIL on the 732/735/740 ... turns the row descriptive”]. There are `n=2` pairs; B3 is not in raw after A3’s valid row, and the run ended at the deadline [results.tsv:6 — “A 3 12543.09 ... row”; END.txt:1 — “END reason=deadline_85_min”; driver-sa811420.log:11 — “DEADLINE_85_MIN”]. The prior miss is owned as reported above [PREREG.md:297-299 — “Reported as a miss of the prior, not adjusted”].

## Policy implication (per PREREG rule, not a decision)

Rule: “a generation gets `GPU_PREFILL_CORRECT=true` only with oracle PASS on all valid pairs of its run; the fork’s `prefill_engine()` gets a GPU rule for a generation only if its median B/A ≤ 0.85 with n ≥ 2 pairs. Otherwise the policy stays CPU and the runs bank the null” [PREREG.md:290-292]. Run 9 meets the median condition (`0.613 ≤ 0.85`, `n=2`): yes; it does not meet oracle PASS: no [results.tsv:3,5 — “FAIL”; “FAIL”].

## Run 10 — QRD8635 / SM8635 / Adreno 735 (6/09, governor forced on arm B)

Identity: recon says `SM8635` and `memtotal_kb=11530632` [raw/sa811930/recon.txt:4 — “SM8635”; raw/sa811930/recon.txt:22 — “memtotal_kb=11530632”].

| arm | turn | TTFT ms | prefill_ms | chunks | decode t/s | new tokens | engines | thermal_state | skin before→after °C | forced | oracle | void_reason | evidence |
|---|---:|---:|---:|---|---:|---:|---|---|---:|---|---|---|---|
| A | 1 | 11619.113 | na | na | 17.159 | 925 | na/na | na | 28.612→41.332 | not in raw | na | na | [raw/sa811930/results.tsv:2 — “A 1 11619.113 na na 925 na 17.1588647030898 ... 28.612 41.332 ... na”]; [raw/sa811930/8s-Gen-3_A_t1_status.txt:1 — “status=0 row_void=0 ... governor_count=0 ... void_reason=na”] |
| B | 1 | 6879.411 | 6879.411 | 2+128+128+128+128+128+128+128+27 | 15.251 | 925 | GPU/CPU | FAST | 36.829→45.307 | true | FAIL | na | [raw/sa811930/results.tsv:3 — “B 1 6879.411 6879.411 ... 15.2509317193723 GPU CPU FAST 36.829 45.307 ... FAIL”]; [raw/sa811930/8s-Gen-3_B_t1_logcat_all.txt:19597 — “KALSA_GOVERNOR ... forced":true ...”] |
| A | 2 | 12158.214 | na | na | 16.059 | 925 | na/na | na | 38.466→46.784 | not in raw | na | na | [raw/sa811930/results.tsv:4 — “A 2 12158.214 na na 925 na 16.0592378976414 ... 38.466 46.784 ... na”]; [raw/sa811930/8s-Gen-3_A_t2_status.txt:1 — “status=0 row_void=0 ... governor_count=0 ... void_reason=na”] |
| B | 2 | 6933.403 | 6933.403 | 2+128+128+128+128+128+128+128+27 | 15.091 | 925 | GPU/CPU | FAST | 36.974→46.501 | true | FAIL | na | [raw/sa811930/results.tsv:5 — “B 2 6933.403 6933.403 ... 15.0910087401133 GPU CPU FAST 36.974 46.501 ... FAIL”]; [raw/sa811930/8s-Gen-3_B_t2_logcat_all.txt:18191 — “KALSA_GOVERNOR ... forced":true ...”] |
| A | 3 | 12237.042 | na | na | 15.827 | 925 | na/na | na | 38.393→47.287 | not in raw | na | na | [raw/sa811930/results.tsv:6 — “A 3 12237.042 na na 925 na 15.827347924405 ... 38.393 47.287 ... na”]; [raw/sa811930/8s-Gen-3_A_t3_status.txt:1 — “status=0 row_void=0 ... governor_count=0 ... void_reason=na”] |

Both B governor records report GPU prefill, CPU decode, `prefill_ctx_ngl=99`, `forced=true`, and `thermal_state=FAST`; B1/B2 prefill is `6879.411/6933.403` ms [raw/sa811930/8s-Gen-3_B_t1_logcat_all.txt:19597 — “engine_prefill":"GPU" ... "engine_decode":"CPU" ... "prefill_ms":6879.411 ... "prefill_ctx_ngl":99 ... "forced":true ... "thermal_state":"FAST"”; raw/sa811930/8s-Gen-3_B_t2_logcat_all.txt:18191 — “engine_prefill":"GPU" ... "engine_decode":"CPU" ... "prefill_ms":6933.403 ... "prefill_ctx_ngl":99 ... "forced":true ... "thermal_state":"FAST"”].

B-ID shasum/diff check: B1=B2, and Run-10 B1 equals Run-9 B1 and Run-8 B1; the three A7X boards therefore have identical B IDs [raw/sa811930/results.tsv:3,5 — “d4556574e02f80bccb5b5d0edb5cf67b134216bdaf05a119882e6a24787fdded”; raw/sa811420/results.tsv:3,5 — “d4556574e02f80bccb5b5d0edb5cf67b134216bdaf05a119882e6a24787fdded”; raw/sa808770/results.tsv:3 — “d4556574e02f80bccb5b5d0edb5cf67b134216bdaf05a119882e6a24787fdded”]; [PREREG.md:300-304 — “the GPU ids are byte-identical to the QRD8650 GPU ids ... the 732 and the 750”].

## What run 10 establishes

Pairing was “same-turn adjacent pairs, median” [PREREG.md:274-276 — “Pairing: same-turn adjacent pairs, median”]. B1/A1 = `6879.411/11619.113 = 0.592`; B2/A2 = `6933.403/12158.214 = 0.570`; median = `0.581`, `1/median = 1.721` [raw/sa811930/results.tsv:2-5 — “A 1 11619.113 ...”; “B 1 6879.411 ...”; “A 2 12158.214 ...”; “B 2 6933.403 ...”].

The median is OUTSIDE the pre-registered `0.95–1.05` parity band and BELOW `0.85`; this is the prior miss, reported as for Run 9 [PREREG.md:279-282 — “B/A 0.95–1.05 = parity ... B/A ≤ 0.85 would be a real gain”; PREREG.md:297-299 — “Reported as a miss of the prior, not adjusted”]. Run 9 vs Run 10 medians are `0.613` vs `0.581`: the mid-tier V73 picture remains descriptive [REPORT.md:215 — “median = `0.613`”; raw/sa811930/results.tsv:2-5 — “A 1 11619.113 ...”; “B 1 6879.411 ...”; “A 2 12158.214 ...”; “B 2 6933.403 ...”; PREREG.md:266-268 — “SM7675/SM8635 → V73”].

Decode B vs A is `−11.1%` for pair 1 and `−6.0%` for pair 2; paired-mean B vs A is `−8.7%` [raw/sa811930/results.tsv:2-5 — “17.1588647030898”; “15.2509317193723”; “16.0592378976414”; “15.0910087401133”]. KV commit is `12114944` bytes at `13.456` ms (B1) and `12.188` ms (B2) [raw/sa811930/8s-Gen-3_B_t1_logcat_all.txt:19597 — “commit_bytes":12114944,"commit_ms":13.456”; raw/sa811930/8s-Gen-3_B_t2_logcat_all.txt:18191 — “commit_bytes":12114944,"commit_ms":12.188”]. Against the pre-registered ±10% expectation: pair 1 is outside (−11.1%), pair 2 inside (−6.0%), the paired mean inside (−8.7%) (audit #24 F2).

KALSA_TELEMETRY is present for all five valid rows [raw/sa811930/8s-Gen-3_A_t1_logcat_all.txt:19315 — “KALSA_TELEMETRY ... promptMs":11619.113”; raw/sa811930/8s-Gen-3_B_t1_logcat_all.txt:19594 — “KALSA_TELEMETRY ... promptMs":6879.411”; raw/sa811930/8s-Gen-3_A_t2_logcat_all.txt:18594 — “KALSA_TELEMETRY ... promptMs":12158.214”; raw/sa811930/8s-Gen-3_B_t2_logcat_all.txt:18188 — “KALSA_TELEMETRY ... promptMs":6933.403”; raw/sa811930/8s-Gen-3_A_t3_logcat_all.txt:12876 — “KALSA_TELEMETRY ... promptMs":12237.042”]. B status has `fallback_count=0`, both governor records have `fallback_reason":""`, and `KALSA_GOVERNOR_FALLBACK`: not in raw [raw/sa811930/8s-Gen-3_B_t1_status.txt:1 — “fallback_count=0”; raw/sa811930/8s-Gen-3_B_t2_status.txt:1 — “fallback_count=0”; raw/sa811930/8s-Gen-3_B_t1_logcat_all.txt:19597 — “fallback_reason":""”; raw/sa811930/8s-Gen-3_B_t2_logcat_all.txt:18191 — “fallback_reason":""”].

B ends at `45.307–46.501 °C`; B2 cooldown reached `600 s` [raw/sa811930/results.tsv:3,5 — “45.307”; “46.501”; raw/sa811930/8s-Gen-3_B_t2_cooldown.txt:41 — “wait_s=600 skin=36.98 target_c=37.0”].

Oracle is FAIL×2 [raw/sa811930/results.tsv:3,5 — “FAIL”; “FAIL”]. A1/B1 first differs at zero-based index `7` (file line 8: A `14991`, B `2352`), with `24/32` IDs differing [raw/sa811930/8s-Gen-3_A_t1_ids.txt:8 — “14991”; raw/sa811930/8s-Gen-3_B_t1_ids.txt:8 — “2352”; raw/sa811930/8s-Gen-3_A_t1_ids.txt:1,32 — “597”; “1094”; raw/sa811930/8s-Gen-3_B_t1_ids.txt:1,32 — “597”; “11319”].

Harness: 5/5 rows are valid [raw/sa811930/8s-Gen-3_A_t1_status.txt:1; raw/sa811930/8s-Gen-3_B_t1_status.txt:1; raw/sa811930/8s-Gen-3_A_t2_status.txt:1; raw/sa811930/8s-Gen-3_B_t2_status.txt:1; raw/sa811930/8s-Gen-3_A_t3_status.txt:1 — “status=0 row_void=0”]; typing was one first attempt at 200 every time: `348/357/352/364/355 s` [raw/sa811930/8s-Gen-3_A_t1_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=348 rc=0”; raw/sa811930/8s-Gen-3_B_t1_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=357 rc=0”; raw/sa811930/8s-Gen-3_A_t2_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=352 rc=0”; raw/sa811930/8s-Gen-3_B_t2_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=364 rc=0”; raw/sa811930/8s-Gen-3_A_t3_type_prompt.txt:1 — “attempt=1 chunk_size=200 seconds=355 rc=0”]. Trap-8 was exercised: eight `rc=255` lines were absorbed [raw/sa811930/adb-exit.log:1258,1884,1949,2570,2662,2666,2697,2849 — “rc=255”] versus five `has_wakefulness=1` power captures [raw/sa811930/8s-Gen-3_A_t1_load_wakes.txt.power.log:1; raw/sa811930/8s-Gen-3_A_t2_load_wakes.txt.power.log:1; raw/sa811930/8s-Gen-3_A_t3_load_wakes.txt.power.log:1; raw/sa811930/8s-Gen-3_B_t1_load_wakes.txt.power.log:1; raw/sa811930/8s-Gen-3_B_t2_load_wakes.txt.power.log:1 — “attempt=1 rc=0 has_wakefulness=1”].

## Not bankable / deviations

Strict oracle FAIL×2 means endpoint NOT MET; the result is descriptive [raw/sa811930/results.tsv:3,5 — “B 1 ... FAIL”; “B 2 ... FAIL”]; PREREG says an oracle FAIL “turns the row descriptive” [PREREG.md:286-287 — “A FAIL on the 732/735/740 ... turns the row descriptive”]. There are `n=2` pairs; A3 is unpaired and B3 began its cooldown (33 samples, wait_s=0 skin=44.92 → wait_s=480 skin=38.245, still above the 37.0 target [raw/sa811930/8s-Gen-3_B_t3_cooldown.txt:1,33]) and was cut by the deadline; no B3 row; the run ended at `DEADLINE_85_MIN` [raw/sa811930/results.tsv:2-5 — “A 1 ...”; “B 1 ...”; “A 2 ...”; “B 2 ...”; raw/sa811930/results.tsv:6 — “A 3 12237.042 ...”; raw/driver-sa811930.log:11 — “DEADLINE_85_MIN”].

## Policy implication (per PREREG rule)

Rule: “a generation gets `GPU_PREFILL_CORRECT=true` only with oracle PASS on all valid pairs of its run; the fork’s `prefill_engine()` gets a GPU rule for a generation only if its median B/A ≤ 0.85 with n ≥ 2 pairs. Otherwise the policy stays CPU and the runs bank the null” [PREREG.md:290-292]. Run 10 meets the median condition (`0.581 ≤ 0.85`, `n=2`): yes; it does not meet oracle PASS: no [raw/sa811930/results.tsv:3,5 — “FAIL”; “FAIL”]. No recommendation.

## R5 — controlli di sanità dell'oracolo a logit (6/09, QRD8750 poi QRD8650) — NESSUN VERDETTO ANCORA
Sei tentativi sull'8 Elite (sessioni 807948 e 807952, host sa812017/sa812021, board b4bd0901, Android 16), tutti
archiviati sotto `raw/sa8120{17,21}*`. Nessuna coppia A/B è arrivata in fondo: sotto ogni tentativo c'è un difetto vero,
non rumore. In ordine, con la prova letta sul dispositivo:

| # | raw | esito | causa | fix |
|---|-----|-------|-------|-----|
| 1 | `sa812017-toolcall-void/` | A1 VOID `toolcall` | l'app ha chiamato `document_chat` (tool sempre esposto) | driver scrive `kalsa.bench.toolchoice=none` (fcaa8e90) |
| 2 | `sa812017/` | A1 PREREQUISITE exit 3 | con `toolchoice=none` i tool restano nel template: il modello scrive la call in testo (dialetto LFM) e l'app la **esegue** (`fallbackCalls:1,executed:1`) → niente `KALSA_BENCH_TOKENS` | app 1ec63a0 (tool fuori da completion + parser di fallback) |
| 3 | `sa812021-newtokens-void/` | A1 VOID `new_tokens_a=na` | il driver leggeva i token nuovi solo da `restored state checkpoint: reusing N/M`, riga che sparisce quando il prefisso prewarm combacia (effetto del fix app) | fallback su `KALSA_KVPREFIX` `text_tokens−n_common` (17b93d1e) |
| 4 | `sa812021-foreground-void/` | A1/A2 valide, **B1/B2 VOID `composer`** | dopo `poll_load` il `device_wake` (`wm dismiss-keyguard` + tap) porta in cima `QuickstepLauncher`: il dump UI fotografa la home (`dump_fail stage=edit`), 26 s dopo `Displayed com.kalsa.app` | guardia `app_foreground` (c946e79a) |
| 5 | `sa812021/` | A1 valida, B1 tagliata | `END deadline_40_min`: la guardia funziona (`top=launcher` → `am start` → `top=com.kalsa.app`) ma una coppia costa 35-40 min | deadline più lunghe |
| 6 | `sa812021-fault/` | A1 valida, B1 tagliata | `END deadline_33_min` (negativo anticipato con i 44 min di sessione residui) | — |

Numeri validi raccolti (A = CPU, APK 19b67b6 salvo il n. 6 = e54f529), tutti sull'8 Elite: TTFT A 5,43 / 5,54 / 5,49 /
5,48 s, `new_tokens_a` 928, `ids_sha` 558522c0…, `tool_calls=0`, `tokensCached` 2441 contro 2410 della run 8 con un
prompt più corto di ~620 token (schemi tool e prompt di sistema "web_search" spariti). **Non sono un risultato**: senza
il turno B della stessa coppia non esiste confronto e l'oracolo non ha prodotto nessun `oracle_logit` diverso da
`DESCRIPTIVE R4` (copertura insufficiente) sulle righe VOID.

Prosecuzione (PREREG Amendment 9): budget 8 Elite esaurito (89 min contro i ~120 necessari) → entrambi i controlli su
**QRD8650** (623 min), sessione 807954/sa812023: positivo `ABABAB 85` con APK 19b67b6, poi negativo `ABABAB 50` con
e54f529. Resta esplicitamente scoperto il caso che ha motivato l'oracolo: il flip di 1 token a idx 29 dell'8 Elite.

### R5 su QRD8650 (sessione 807954, host sa812023, board pineapple, Android 14) — CRASH NATIVO, causa trovata
`ABABAB 85`, APK 19b67b6. Righe: A1 valida (TTFT 7,494 s), **B1 VOID `governor_fallback`**, A2 valida (7,719 s),
`END deadline_85_min`. Il turno B non ha prodotto né `KALSA_GOVERNOR` né `KALSA_TELEMETRY` perché **l'app è morta**:

```
F libc : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid (mqt_v_native), pid (com.kalsa.app)
Cause: null pointer dereference    x0 0  x1 0  x2 0x18
#00 pc 000000000086950c  librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so
#01 pc 000000000086a70c  librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so
```
Sequenza: `KALSA_KVPREFIX embd=369 text_tokens=1289 n_common=366` → `KALSA_KVDIVERGE` → `loadPrompt:707 Input processed`
→ righe Adreno → SIGSEGV 4,1 s dopo. **Zero** righe `KALSA_BENCH_PROBS` nel turno: muore al primo passo di sampling o
prima. Il turno A dello stesso run (prefill CPU, stesso APK, `probs=1`, senza ids forzati) emette 300+ righe di probs e
125 KB di `_probs.jsonl` → il difetto è sul percorso B (prefill GPU forzato e/o `bench_force_ids`), non nel softmax in sé.
La run 8 (5/09) forzava il prefill GPU sullo stesso board con lo stesso pin nativo ma **senza** l'hook dell'oracolo e
funzionava (`KALSA_GOVERNOR … prefill_ms 4294,885`): la variabile nuova è l'hook di 28424c3.
Conseguenza: **nessun controllo R5 è stato eseguito**; il verdetto dell'oracolo resta non prodotto e nessun risultato
di oggi è bancabile. Fix dispatchato (guardia sui puntatori nulli e sugli ids esauriti); poi audit, rebuild dei due APK,
sessione nuova.

Costo di typing misurato su questo board con l'APK nuovo: 803-818 s per turno (il gradino da 200 caratteri fallisce
sempre e ne brucia 300, poi 100 caratteri passano in ~510 s), contro 386-397 s della run 8 → una coppia costa ~48 min.
