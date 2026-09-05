# S5b report — runs 4–6

## Summary

Run 4 completed with `final_rc=0` [raw/driver-sa805734.log:13].

Run 4 produced one complete A/B pair, one additional valid GPU B row, and five VOID rows [raw/sa805734/results.tsv:2-9]. Run 6 adds three valid CPU A rows, two valid GPU/FAST B rows, and one `VOID(hot)` B row [raw/sa806967/results.tsv:2-7].

Across runs 4–6, GPU prefill points are n=7 and CPU A points are n=4; the locked speed endpoint remains NOT MET under the strict oracle. Run 6’s corrected same-turn exploratory PASS-1 median is B/A=0.554 (A/B=1.81×), not an endpoint result [raw/sa806967/results.tsv:3,7; PREREG.md:64-67,137].

Run 7e’s QRD7675/SM7675/Adreno 732 result exists below [PREREG.md:165 — “Two facts learned from run 7e on QRD7675 (SM7675, `ro.product.name=pineapple`, Adreno 732)”].

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
