# S5b report — run 4 (`sa805734`)

## Summary

The 8 Elite run completed with `final_rc=0` [raw/driver-sa805734.log:13].

It produced one complete A/B pair, one additional valid GPU B row, and five VOID rows [raw/sa805734/results.tsv:2-9].

The locked speed endpoint was not met because the complete pair failed the oracle; the observed ratio is descriptive only [raw/sa805734/results.tsv:2-3].

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

Across runs, GPU points are now n=5: 3200.713 and 3228.259 ms in run 4, then 3325.721, 3324.109, and 3325.665 ms in 5b [raw/sa805734/results.tsv:3,7; raw/sa806366b/results.tsv:3,5,7]. The CPU A point remains n=1 at 5945.225 ms [raw/sa805734/results.tsv:2]. The descriptive B/A range is 0.54–0.56 (A/B 1.79–1.86×): inside the 1.4–1.9× prewarm-prior band, not the fork’s ≥3× [raw/sa805734/results.tsv:2-3,7; raw/sa806366b/results.tsv:2-7].

The pre-registered endpoint remains **NOT MET**: zero valid A rows produced zero adjacent A/B pairs [raw/sa806366b/results.tsv:2-7]. Thermal asymmetry caused this: GPU rows ended at 46.37–47.007 °C, while the post-GPU A cooldowns capped at 37.078/37.248 °C after 720 s; B cooldowns reached 37.0 °C in 75–435 s [raw/sa806366b/results.tsv:3-7; raw/sa806366b/8-Elite_A_t2_cooldown.txt:49; raw/sa806366b/8-Elite_A_t3_cooldown.txt:49; raw/sa806366b/8-Elite_B_t1_cooldown.txt:30; raw/sa806366b/8-Elite_B_t2_cooldown.txt:6; raw/sa806366b/8-Elite_B_t3_cooldown.txt:9]. Thus every A after B was `VOID(hot)` and no further pair existed [raw/sa806366b/8-Elite_A_t2_status.txt:1; raw/sa806366b/8-Elite_A_t3_status.txt:1].
