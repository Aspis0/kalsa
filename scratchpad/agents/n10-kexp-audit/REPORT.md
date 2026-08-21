# AUDIT REPORT — n10-kexp-audit (hostile data audit, S23 session 2026-08-21)

Auditor: hostile/paranoid, read-only. Protocol judged against **PREREG_N10.md v1.2** (changelog confirms N≥5 amendment was declared pre-analysis; session.log line 1 `2026-08-21T16:13:46 … protocol=v1.2 TargetComplete=5` predates the first cell at 16:19:15, so no block was collected under v1.1 and the reduced N was not conditioned on observed ratios).

Targets audited: `results\olmoe_gpu_moe_s23\n10\` (runs.csv + 20 cells stdout + MANIFEST + metas + logs), `results\kexp_speed_s23\` (runs.csv + 8 cells stdout + MANIFEST + host log), `results\olmoe_gpu_moe_s23\n10\mellum2\`, session report `scratchpad\agents\n10-kexp-session\REPORT.md`.

---

## FINDINGS

### OLMoE confirmatory cell (claimed SHIP)

**F1 — CONFIRMED (minor, numeric):** median peak temp B is **38.95 °C**, reported as **39.0 °C** in both `scratchpad\agents\n10-kexp-session\REPORT.md` (§OLMoE, "Median peak temp: A 38.4 / B 39.0") and `results\olmoe_gpu_moe_s23\n10\REPORT.md`. Recompute from runs.csv B-arm temp_peak (33.7, 36.8, 38.1, 38.4, 38.9, 39.0, 39.0, 39.2, 39.3, 39.3): median = (38.9+39.0)/2 = **38.95**. Rounding up inflates the B side. Does not change the verdict: criterion is A ≤ B + 0.5 and 38.4 ≤ 38.95+0.5 = 39.45 passes regardless. Fix the number, keep the PASS.

**F2 — REFUTED (attack fails): medians/ratio recompute exactly.** From runs.csv raw values: A median = (15.322094+17.389984)/2 = **16.356039**; B median = (10.497329+10.563061)/2 = **10.530195**; ratio = **1.553251 → 1.553** as claimed. Every one of the 20 csv tg512 values matches its stdout file's `avg_ts` to 1e-4 (programmatic cross-check, 20/20 PASS). No stdout file missing, no duplicate content (sha256 all unique), and every stdout JSON's `test_time` falls inside its row's iso_pre→iso_post window — the csv↔file pairing is genuine, not value-copied.

**F3 — REFUTED (attack fails): gates hold on every counted cell.**
- Wakefulness `mWakefulness=Awake` at launch in all 20 rows (csv wake_pre/wake_post; harness `_lib_n10.ps1:51-64` greps mWakefulness and wakes+rechecks).
- rc=0 in all 20 rows and session.log (`RC bXX_cY rc=0` ×20, lines 17–113).
- MemAvailable drop < 2 GB everywhere: max observed "drop" is −601692 kB (an *increase*); all others ≤ 216052 kB (session.log MemAvailable lines; csv mem_avail_pre/post).
- sha pins: impl `d2030f23…` + opencl `2ed2e48a…` in all 20 csv rows; model `3bd9ec48…` present in `sha_session_start.txt` (line 13) and matched to the stdout `model_filename .../OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`; stock extra_bufts forbidden-pin checked in code (`run_n10.ps1:273`). Per-cell sha verification is enforced in code (`run_n10.ps1:269-274`, aborts session on drift) — note the full SHA_BLOCK is only *logged* once at session start (`session.log:11`), so the per-cell check is code-audited, not log-evidenced. Acceptable; noted as F-minor.

**F4 — REFUTED (attack fails): prereg conformance complete.**
- ABBA order A,B,B,A in all 5 blocks (csv arm sequence); timestamps strictly monotonic; cells contiguous (3–4 s inter-cell).
- Cooldown gate ≤35.0 at every block start: 28.6 / 34.5 / 34.8 / 34.8 / **35.0** (block meta JSONs + session.log COOLDOWN lines). Block 5 at exactly 35.0 is legal per v1.1/v1.2 ("≤ 35.0"); warm_start=False correct. All 5 blocks cool-start, so cool-start secondary = primary (1.553×) as reported.
- Battery floor at block starts: levels 76/72/70/67/64, all ≥40; session never dipped below 40 during OLMoE.
- Unplug gate: header lines `USB powered: false` + `AC powered: false` archived in all 5 `block_0X_meta.json` `.unplug` fields; `Assert-Unplugged` called per block (`run_n10.ps1:232-239`).
- Pins recorded: `session_pins.json` screen_off_timeout 1800000, brightness 128, wifi_on 1; governor walt×8 recorded per block in csv and metas.
- tg512-only: every stdout JSON has `n_prompt:0, n_gen:512`, single sample (`samples_ns` len 1 ⇒ r=1), flash_attn 0, n_threads 4, same ngl 16 both arms, n_cpu_moe 0 (A) / 99 (B) — all verified programmatically, 20/20.

**F5 — REFUTED (attack fails): exclusion honesty.** Exactly 20 rows, blocks 1..5 × 4 cells, seq_global 1..20 with no holes, excluded=False ×20, exclude_reason empty, no replaced cells. Inter-block gaps (91–336 s) are accounted cooldown-polling windows with matching COOLDOWN log lines — no hidden retries (cells dir contains exactly 20 files, all referenced).

**F6 — CONFIRMED (cosmetic): `complete_block` column empty in all 20 csv rows** instead of True; block completeness lives only in `state.json` (`complete_ids [1..5]`). No data impact.

**F7 — CONFIRMED (minor): J/token reconciliation.** Report's charge-counter sums verified: ΣΔ A = 161250, ΣΔ B = 243750 µAh (csv deltas are negative = discharge; report quotes magnitudes without saying so). Level 76→61 confirmed. The "first A cell Δ=0 same-tick artifact" caveat is honest (b01_c1 2853750→2853750) but note block_01_meta.json unplug header shows counter 2865000 two seconds earlier — consistent with slow counter ticks, flagged already.

### Mellum2 exploratory

**F8 — CONFIRMED (admission verified, attack satisfied):** the killed experts-GPU cell appears in **no** runs.csv (n10 csv = 20 OLMoE rows only). Stub files `mellum2/m2_ngl2_gpu_experts.stdout.txt` (18:44) and `.json` explicitly state `# NO llama-bench jsonl`, `"llama_bench_avg_ts": null`, `"stdout_file_present": false` — honest markers, not fabricated data. The "~0.15 t/s" figure appears only as flagged wall-clock inference with `"not_a_llama_bench_avg_ts": true` and "Do not quote it as a ship number". Harness-error admission is explicit: "That kill was a harness mistake: the cell was not hung" (session REPORT §Mellum2). rc=143 timeline verified: RUN 17:08:50 → RC 143 18:23:31 (mellum2_host.log), ~74m40s ≈ "~75 min".
- Load-sanity cell verified: `-ngl 2 -ncmoe 99`, n_gen 16, rc=0, avg_ts **0.222682** matches log and report.

**F9 — CONFIRMED (evidence gap): the probe numbers "47:08 CPU time" and "gpubusy ~49%" have no archived raw capture.** They exist only hand-transcribed in `m2_ngl2_gpu_experts.json` (orchestrator_probe block) and the reports. The archived health probes (`_health.txt` 18:02, `_health2.txt` 18:13, `_stop.txt` 18:23) show pid 16270 alive in R/D state, MemAvailable 4237220/4264748 kB (=the claimed 4.25 GB ✓), unplugged ✓ — but their `ps` lines carry no TIME column and there is no kgsl gpubusy readout file. Verdict: PLAUSIBLE and consistent (process demonstrably alive and computing when killed), but the specific 47:08 / 49% figures are unauditable. Archive raw probe output next time.

**F10 — CONFIRMED (minor, internal inconsistency):** `_stop.txt` justifies the kill as "75min, Dozing mid-cell, KEXP priority / battery floor" while the session report calls the kill a harness mistake. Both can be true (stop motive vs. wrong mechanism), and the device did Doze mid-cell despite the 30-min screen-timeout pin (cell ran ~75 min; Awake at start per log). But the report nowhere mentions that the wakefulness pin was violated *during* this cell — irrelevant to datasets since the cell is discarded, yet worth one sentence.

### KEXP #14 exploratory

**F11 — REFUTED (attack fails): numbers recompute exactly.** A median = (12.278213+15.202009)/2 = **13.740111**; B median = (7.569378+7.594689)/2 = **7.582034**; ratio **1.812193 → 1.812**. All 8 csv values match their stdout JSONs; pairing via test_time inside cell windows PASS.

**F12 — REFUTED (attack fails): per-block ratios do not make the pooled median misleading.** Block 1 mean-ratio = 14.120/7.582 = **1.862**; block 2 = 13.385/7.499 = **1.785**. Both blocks independently clear 1.3 by a wide margin and bracket the pooled 1.812 — the headline number is representative, not an artifact of pooling.
- However: **CONFIRMED observation — A-arm position effect unremarked.** First-A vs second-A within block: 15.96→12.28 (−23%) and 15.20→11.57 (−24%), while B pairs are near-flat (7.595/7.569; 7.683/7.314). A consistent ~24% intra-block decay on A only, plausibly thermal, is worth a sentence in any future write-up. With n=2 blocks this stays exploratory-grade noise.

**F13 — REFUTED (attack fails): exploratory labeling is airtight.** "NOT ship"/"exploratory" appears in the KEXP MANIFEST title and body, KEXP REPORT.md title, session REPORT section, and csv `label=exploratory_kexp` on all 8 rows. No ship-smelling sentence found anywhere for KEXP.

**F14 — REFUTED (attack fails): gates/pins for KEXP.** SHA_BLOCK at 18:24:17 shows opencl **b9d99fa8…** swapped in + impl d2030f23… + GGUF **b07c8087…** verified on device (kexp_host.log:12-24); unplug gates PASS before each block; block starts 30.3 °C / 34.9 °C (both ≤35, cool-start); battery discipline correct — block 2 started at exactly 40 (legal floor), SOC crossed mid-block, block finished, block 3 refused at 37 (<40), pause recorded. Wakefulness: block1 c1 found Dozing, KEYCODE_WAKEUP applied, PRE re-check Awake — exactly the prereg procedure.
- Note: KEXP has no own prereg; it inherits v1.2 gates voluntarily (stricter than required for exploratory). Fine.

### Session report vs raw reconciliation

**F15 — REFUTED (attack fails): every number in `scratchpad\agents\n10-kexp-session\REPORT.md` reconciles** — medians (16.356/10.530/1.553; 13.740/7.582/1.812), per-block tables (all 28 tg values match csv to printed precision), block temps, levels, cool-start counts, pause record reference, Mellum2 sanity 0.222682, rc=143 timeline. Only exception: F1's 39.0-vs-38.95 rounding.

### Cross-cutting hygiene (minor)

- **F16:** The KEXP block-3 pause record lives at `results\olmoe_gpu_moe_s23\n10\pauses\pause_block03_20260821_183837.json` — inside the OLMoE dataset tree. Its content ("owner authorized 2 ABBA… Block 3 not started") refers to the **KEXP** run and flatly contradicts OLMoE `state.json` (5/5 complete) unless the reader knows it belongs to KEXP. The KEXP MANIFEST does document the location, so this is misfiling, not concealment. Move it or add a README pointer in the pauses dir.
- **F17:** `results\olmoe_gpu_moe_s23\n10\REPORT.md` is a stale mid-session snapshot ("Mellum2: Not started", "KEXP: Not started", "Status: SHIP (pending remaining ship-claim checks)"). Superseded by the scratchpad report but left in place — quote the scratchpad report, archive or mark the snapshot.
- **F18:** Device-side stderr (.err) files for the 28 counted cells were not pulled/archived (only the two Mellum2 errs). rc=0 + full stdout JSONL mitigate; archive them next session for completeness.
- **F19:** `GGML_OPENCL_LOG_ALLOC unset` pin is asserted in the prereg/MANIFEST but not directly evidenced in any captured file (absence of alloc spam in stdout is indirect). Trivial.

---

## VERDICT SUMMARY

| # | Finding | Verdict | Severity |
|---|---|---|---|
| F1 | Median peak temp B reported 39.0, actual 38.95 | CONFIRMED | trivial (pass unaffected) |
| F6 | csv complete_block column empty | CONFIRMED | cosmetic |
| F7 | Charge-counter Δ quoted as positive magnitudes | CONFIRMED | trivial |
| F8 | Killed Mellum2 cell excluded everywhere, error admitted | CONFIRMED (as correct behavior) | — |
| F9 | 47:08 CPU / gpubusy 49% probe figures lack raw capture | PLAUSIBLE (unevidenced) | minor |
| F10 | Stop-note rationale ≠ report narrative; mid-cell Doze unmentioned | CONFIRMED | minor |
| F12 | A-arm intra-block decay (~24%) undiscussed | CONFIRMED | minor (exploratory) |
| F16-F19 | Misfiled pause record; stale snapshot; .err not archived; LOG_ALLOC unevidenced | CONFIRMED | hygiene |
| F2-F5, F11, F13-F15 | Numbers, gates, conformance, honesty attacks | REFUTED (evidence survives) | — |

## OVERALL VERDICT: **BANK**

Every recomputed statistic matches the claimed numbers exactly, every counted cell passes every v1.2 gate with archived evidence, the zero-exclusion claim is literally true (20/20 rows, no holes), the killed Mellum2 cell is quarantined with honest markers and an admitted harness error, and KEXP is labeled exploratory in every artifact. The findings above are rounding, filing, and archiving hygiene — none touches a number, a gate, or a claim. Fix F1's 39.0→38.95, relocate the pause record (F16), and archive raw probe output next session (F9).
