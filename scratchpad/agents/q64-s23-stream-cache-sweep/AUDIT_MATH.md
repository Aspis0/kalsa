# AUDIT_MATH — q64-s23-stream-cache-sweep (hostile re-derivation)

Audit date: 2026-08-26. Auditor: independent agent. Mode: read-only w.r.t. the cell, except this file.
Nothing in `raw/`, `run_records.jsonl`, `STATUS.txt` was modified. (Transparency note: two mis-patched
temp-reproduction runs of `finalize_q64.py` briefly re-executed against the real cell; the script is
deterministic and idempotent, so REPORT.md/manifest.json were rewritten byte-identically (verified by
empty diff against a fresh temp reproduction and by independent re-derivation of every printed number),
and RUN_LOG.md was restored to its pristine content — 5× "finalize_q64 complete", verified.)

Re-derivation tooling: Python stdlib only, per-run recomputation from `raw/*.csv` +
`raw/*.stdout.jsonl` (per-token `wall_ms/io_ms/compute_ms/read_bytes/cache_hit_pct`), engine summary
lines, and `run_records.jsonl`.

---

## A. Per-invocation numbers (decode t/s, prefill t/s, read_mb, hit, io share) — CONFIRMED

CSV semantics (raw/b1_a1_0.csv:6): `step,steps,wall_ms,io_ms,compute_ms,read_bytes,cache_hit_pct,
stall_ms,mgmt_ms,majflt,cpu_ms,...` — `step` is 1-based (first data row = step 1); `wall_ms` is
per-token wall (not cumulative); `read_bytes` is a per-token delta; `cache_hit_pct = -1.00` is a
no-cache sentinel (arm 0). Cross-validation: my Σwall over 102 tokens reproduces the engine's own
`generation: 102 tokens, X s/token (Y tok/s)` line to 3 dp in every run (e.g. b1_a1_0: 1.097075 vs
engine 1.097; b1_a4_4000: 2.785148 vs 2.785).

All 15 CSVs: exactly 102 data rows, steps 1–102 contiguous, `steps=128` (requested -n 128) in every
row. Per-arm medians over N=3 blocks re-derived from raw match REPORT.md to the printed 6 dp, every
column:

| C_MiB | tok/s 9–102 | tok/s 1–102 | read_mb | read_rate_MB/s | hit last | io_share 9–102 | prefill_tok_s(128/s) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.070611 ✓ | 1.066873 ✓ | 32918.982656 ✓ | 344.317286 ✓ | −1.0 ✓ | 0.465373 ✓ | 11.954796 ✓ |
| 1500 | 1.755435 ✓ | 1.713534 ✓ | 20839.067648 ✓ | 350.082942 ✓ | 29.27 ✓ | 0.496791 ✓ | 10.873259 ✓ |
| 2000 | 1.934488 ✓ | 1.904931 ✓ | 16626.495488 ✓ | 310.512946 ✓ | 39.44 ✓ | 0.490315 ✓ | 7.936508 ✓ |
| 4000 | 2.838197 ✓ | 2.756121 ✓ | 8716.431360 ✓ | 235.524896 ✓ | 58.56 ✓ | 0.379229 ✓ | 7.938969 ✓ |
| auto | 2.752912 ✓ | 2.753804 ✓ | 10032.152576 ✓ | 272.063093 ✓ | 55.38 ✓ | 0.404809 ✓ | 7.775011 ✓ |

(✓ = identical to REPORT to 6 dp; all values also match the engine `# summary` line, e.g. read_MiB
31394.0 = 32918.98 MB/1.048576.)

Latin square: RUN_LOG order == records == REPORT blocks table: b1 = 0,1500,2000,4000,auto;
b2 = 1500,2000,4000,auto,0; b3 = 2000,4000,auto,0,1500. Each arm's 3 runs sit in 3 different
blocks. Medians are over exactly N=3 (n_success=3 for all 5 arms; no killed/skipped runs).

Detail: within-arm read totals are byte-identical across runs for fixed C (e.g. 16626.495488 MB on
all three 2000 runs) — deterministic expert routing, a good internal-consistency check.

NOTES (minor):
- prefill_tok_s in REPORT = 128.0/prefill_s (finalize_q64.py:127 hard-codes 128; PREREG.md froze
  this formula: "tok/s (128/prefill_s)"), while the engine counts **133** prompt tokens in all 15
  runs ("prefill: 133 tokens, X s" everywhere; n_prompt=133 in every summary) and its own
  prefill_tps = 133/prefill_s. REPORT values are therefore 133/128 − 1 = 3.9 % below the engine's
  tps. Pre-registered, but the column label is misleading. MINOR, file finalize_q64.py:127.

## B. EOS / 102-row window — CONFIRMED (with caveat), arbitration premise holds

- 102 data rows in every CSV, steps 1–102, contiguous, all 15 runs (raw/*.csv tail row step 102;
  BMOE_PROGRESS count = 102 per stdout.jsonl; summary `tokens=102`).
- First-8 exclusion applied consistently: warm window = step ≥ 9 (1-based) → tokens 9–102, 94 rows,
  identical rule in every run (finalize_q64.py:96) and in my re-derivation.
- Stop reason: no explicit EOS log exists (stderr "eos" hits are the tokenizer's
  `eos_token_id = 151645` print_info; stdout's `=== perf ===` block does not state a stop reason).
  What is observed: `steps=128` in every progress row, generation ended at 102; decoded text is
  byte-identical across all 15 runs/arms (delta_text stream md5 `0043c7c0cc51f030`), ending "...It
  is about being right." Greedy (temp=0; seed irrelevant). Conclusion: PLAUSIBLE that the stop is
  EOS; a deterministic stop of any kind is indistinguishable from the logs — but all 15 runs stop
  at the same point, so "tokens 9–102" is the same window in every arm, which is all the arbitrated
  comparison needs. NOTE (not a validity issue).

## C. App constant — arithmetic CONFIRMED; arbitrated constant = 3437 MiB (auto resolved)

Frozen rule on the 9–102 medians (best non-killed arm = 4000):
- best = 4000 → 2.838197 t/s; 5 % threshold = 0.95 × 2.838197 = **2.696288** (REPORT prints
  2.696288 ✓).
- 0 (1.070611), 1500 (1.755435), 2000 (1.934488) — all below threshold. Smallest C within 5 % by
  the frozen rule alone: **4000**.
- auto = 2.752912; ratio to best = 2.752912 / 2.838197 = **0.969950** (deficit 3.005 % < 5 %;
  2.752912 ≥ 2.696288 ✓). Per the pre-declared arbitration (outside PREREG): auto is within 5 % of
  the best and auto's resolved size < 4000 → the constant is **auto's resolved size**.
- auto's resolved size (engine log/summary `cache_budget_MiB`, also the per-token
  `cache_budget_mib` column, constant within each run): b1_a5_auto = 3429.3, b2_a4_auto = 3437.0,
  b3_a3_auto = 3524.5 → median **3437.0 MiB** ✓ (REPORT auto_resolved_cache_MiB = 3437.000000 ✓).
  3437.0 < 4000 ✓. → **app constant = 3437 MiB** (session-dependent: resolved budget itself varied
  3429.3–3524.5 across runs).

REPORT.md as written prints `app_constant_C_MiB=NA`, `frozen_app_constant_available=False`,
`app_constant_observed_basis_C_MiB=4000` (finalize_q64.py:232-233 gating on observed_lengths==128;
the arbitration is not implemented in the script). The arbitrated decision is therefore not yet in
the REPORT — MAJOR only as a banking-input gap (the number itself is settled: 3437 MiB).

LMK/fit side: MemAvailable pre per arm (records): 0: [5359628, 5255404, 5292708]; 1500:
[5222360, 5357332, 5169168]; 2000: [5370224, 5337340, 5155904]; 4000: [5348288, 5370892, 5225148];
auto: [5319568, 5198304, 5298652] kB. No arm systematically lower; post-run MemAvailable 5.19–5.39
GB; lowmemorykiller logcat per run shows no kill events during the session (only two
`process_mrelease failed` lines from 16:28, before the session); likely_lmk=False ×15. 4000/auto
never approached the kill line. CONFIRMED.

## D. Prefill trend (11.95 → 7.9 t/s) — NOT ESTABLISHED as a cache-size effect

Raw prefill_s per run (engine line; identical 133 tokens): C=0: 10.387 / 10.707 / 14.213;
1500: 11.706 / 11.772 / 16.661; 2000: 16.128 / 11.317 / 16.187; 4000: 11.767 / 16.123 / 16.262;
auto: 14.296 / 16.463 / 16.512. Within-arm spread is huge (2000: 11.3–16.2 s; 4000: 11.8–16.3 s;
1500: 11.7–16.7 s) and every block-3 run is slow (14.2–16.7 s) regardless of arm; within block 1
the ordering (0 < 1500 < 4000 < auto < 2000) is non-monotonic. The reported medians are accurate
(re-derived ✓) but the decline 11.95 → ~7.9 is confounded with session drift (battery 90→82, pre
temps 26.7→29.9 °C, 15 loads of a 10.5 GB model) and within-block position. There is no prefill
phase telemetry at all (CSV/BMOE_PROGRESS rows are decode-only; `load_s` is separate; read_mb/mgmt
during prefill are not captured), so whether cache warm-up is charged to prefill cannot be checked.
**What can be concluded:** the medians as tabulated; nothing causal about prefill cost vs C.MINOR
if any text reads the table as a prefill-cost curve; NOTE otherwise.

## E. q60b comparison — arithmetic CONFIRMED; semantically apples/oranges as labeled only narrowly

- q64 numerator = median over 3 blocks of (Σread_bytes/1e6)/(Σwall_ms/1000) over all 102 observed
  decode tokens of the app-constant-basis arm (4000) = **235.524896 MB/s** (decimal MB) ✓ re-derived.
- q60b denominator = **430.223000** = hard-coded constant (finalize_q64.py:14; also hard-coded in
  q60b's finalize_q60b.py:21) sourced from `results/io_gate/s23_ufs31/summary.txt`:
  seq_MB_s=411.284,452.654,430.223 → seq_median=430.223: 3-rep median of a raw **o_direct
  sequential pread** loop (2000×0.94 MiB blocks of a different gguf, unplugged S23). It is a raw
  device-capability figure, not a q60b cell measurement, and not from the q64 model file.
- Ratio 235.524896 / 430.223 = **0.547448** ✓ (REPORT prints 0.547448 ✓). No causal claim
  declared ✓.
- The ratio is a wall-normalized *effective* rate, not an I/O-capability ratio: decode wall at
  arm 4000 is ~38 % io (median io_share 0.379). Cross-check on io-time-only denominators (my
  re-derivation, same raw): 4000: 569.4 MB/s median (runs 569–613; engine's own burst line 585
  MiB/s ✓ consistent); auto: 644.0; C=0: 749.7 — all above the 430.2 gate (ratio 1.32 at the
  app constant). So the same underlying data yields 0.55 (wall) or 1.32 (io-time) vs the gate:
  the single 0.547 number cannot stand without its denominator definition.
- Honest wording: "the product streamer at the app constant read the model at a median 235.5 MB/s
  per second of decode wall, 0.55× the S23's raw sequential-read gate (430.2 MB/s); decode wall
  includes ~60 % non-IO time at this arm, and burst read rate during decode (≈569–613 MB/s,
  io-time-only) exceeds the gate; q60b characterized the mmap page-fault path, a different
  mechanism (per-launch 300–1157 MB/s incl. prefetch; timed eval pass 312–393 MB/s at n≤512).
  No causal claim." MINOR (wording), the arithmetic itself is CONFIRMED.

## F. Gates / hygiene — CONFIRMED, with one documentation gap

- Battery: pre 90 (calib1 & b1_a1_0) → post 82 (b3_a5_1500); monotonic decline; every run ≥ 83
  pre, far above the 40 % gate; plugged=False on every gate line (records ac_powered=false).
- Temps: cool-start max 29.9 °C (299 tenths); guard max 31.3 °C (313 tenths, b2_a2_2000) —
  ≤ 31.3 ✓; guard warn 40/kill 43 never approached. REPORT max_temperature_C=31.3 ✓.
- cpuset: monitor sampled /proc/<binary_pid>/cpuset + cpus_allowed_list; all samples taken while
  the binary was alive show cpus_allowed_list 0-7; cpuset_violation=False ×15. CONFIRMED.
- Guard: 15/15 guard.rc files contain 0; 15/15 guard logs show START→READY→polls→MAX within the
  run window (e.g. b1_a2_1500: polls 1787778860→1787779021, MAX 291 tenths). CONFIRMED.
- Guard bookkeeping mismatch (the "q56 guard" item): b1_a2_1500's detached-guard rc was not
  captured at pull time → launcher_rc=1, guard_rc=None in the record (launch adapter exit path
  `guard_rc != 0 or workload_rc != 0` → 1); RUN_LOG STOPPED + "RESUME ... adapter-only bookkeeping
  correction; completed tags preserved". The guard process itself was alive and clean throughout
  (log evidence), the workload exited 0, CSV complete (102 rows), text identical. No validity
  impact. However: the SAME wrapper-rc artifact hit **b2_a2_2000 and b3_a4_0** (launcher_rc=1,
  workload_rc=0, complete 102-row CSVs), which REPORT's deviation_4 does not mention (it names
  only "a successful 1500-MiB arm"). NOTE — extend deviation text.
- Sampler: sampler_argument_pid == monitor binary_pid in all 15 records (q62 defect fixed) ✓.
- Model sha computed on device: model.sha256sum.txt = a001d324…6dbc for the /data/local/tmp path
  (RUN_LOG 17:07:28 "computed once on device") ✓; runtime 7 files: PC hashes == device hashes
  (bmoe-cli 0ac612de… matches PREREG) ✓; prompt q64_p128.txt device sha == PC sha
  (34ae0fff…c09c7) ✓; same prompt file used in all 15 commands (verbatim in records) ✓.

## G. finalize_q64.py — no math bugs; 2 minor labeling issues; reproduction byte-identical

- Window off-by-one: absent. 1-based steps; `>= 9` excludes exactly tokens 1–8 (finalize_q64.py:96);
  verified against row numbering.
- Wrong wall column: absent. `wall_ms` is the per-token column; Σwall reproduces the engine's
  tok/s (see A). (`read_mb` in PREREG = CSV `read_bytes` per-token delta; consistent.)
- Median with N≠3: absent. Exactly 3 per arm (all blocks), median over 3.
- Arm label mix-ups: absent. tag→arm verified 15/15 against RUN_LOG order.
- Issues found: (1) prefill_tok_s numerator hard-coded 128 (finalize_q64.py:127) vs engine 133 —
  pre-registered formula, 3.9 % below engine tps, MINOR; (2) `decode_tok_s_9_128` silently emits
  the 9–102 value when the frozen window is absent (finalize_q64.py:98 → REPORT prints the same
  number in both columns; disambiguated only by deviation_3 + status=BLOCKED), MINOR; (3) app-
  constant arbitration not implemented (prints NA + observed basis 4000), MINOR/process;
  (4) deviation_4 wording incomplete (see F); (5) tautological guard `int(prompt_tokens or 0)>=0`
  (finalize_q64.py:129), harmless. NOTE.
- Reproduction: temp copy with patched ROOT (Python stdlib, unmodified inputs) produced
  REPORT.md and manifest.json **byte-identical** to the cell's files, and run 2 == run 1
  (idempotent). CONFIRMED.

---

## Severity rollup

- BLOCKER: none.
- MAJOR: only as banking input — the arbitrated app constant (3437 MiB, auto resolved) is not in
  REPORT.md (it prints NA). The number is settled; the report/addendum must carry it.
- MINOR: prefill_tok_s convention (128 vs 133); decode_tok_s_9_128 column emits observed-window
  value; prefill-trend wording (confounded, non-causal); q60b ratio wording (wall-normalized
  effective rate; add io-time cross-check 569–613 MB/s).
- NOTE: EOS not directly logged (stop identical across runs); deviation_4 covers only 1 of 3
  wrapper-rc=1 runs; PREREG says "SM8450" but device_props ro.soc.model=SM8550 (S23 = SM8550;
  device identity itself verified SM-S911U); auto's resolved budget varies 3429.3–3524.5 MiB by run.

## NOT VERIFIED

- Explicit engine EOS-stop log (absent from artifacts; PLAUSIBLE via identical-length identical-
  text determinism).
- What happens inside prefill (no phase telemetry) — cache-warm-up charging to prefill.

VERDICT: BANK-WITH-CORRECTIONS (1) record the arbitrated app constant = 3437 MiB (auto resolved; auto 2.752912 within 5 % of 4000's 2.838197, 3437 < 4000) in REPORT/addendum; (2) qualify the prefill column (128/prefill_s convention, non-causal direction) and the q60b ratio wording (wall-normalized effective-rate ratio, not capability; io-time-only cross-check ≈569–613 MB/s > gate); (3) extend deviation_4 to the b2_a2_2000 / b3_a4_0 launcher_rc=1 artifacts