# Audit: Jelly cache-cell rerun (Marco-Mini KEXP, cpuset-covariate harness)

Date: 2026-08-19. Mode: hostile recomputation from raw data. Read-only; no fixes.
Subject report: `scratchpad/agents/jelly-cache-rerun/REPORT.md` (2026-08-19).
New data: `results/cachesweep_marco_jelly_c{1500,2000,4000}_cov/` (runs.csv, sweep.log=outer.log, STATUS.txt, HEARTBEAT.txt; sweep.log and outer.log are byte-identical in all three cells).
Original data: `scratchpad/agents/jelly-cache-rerun/originals/` — the agent's own copies; no other in-repo source exists (Finding 7).
Other evidence: `scripts/run_dropsweep_jelly.sh` @ `6a26036`, `scripts/watch_dropsweep_lfm_jelly.ps1`, `logs/watch-cachesweep_marco_jelly_{c1500,c2000,c4000}_cov.log`, `logs/watch-cachesweep_marco_jelly_c1000.log`, `docs/ALIVE.md` §2, `scratchpad/agents/jelly-cache-rerun/chain.log`, `scratchpad/agents/jelly-cache-rerun/chain.ps1`.

Pairing definition used throughout: per round, the drop arm vs d0.0 of the same round; benefit % = (s/tok_d0.0 − s/tok_drop)/s/tok_d0.0 (negative % = drop faster). This is the pairing the agent used; my numbers reproduce theirs exactly where they stated them.

---

## Verdict summary (severity-ordered)

| # | Severity | Claim under audit | Verdict |
|---|---|---|---|
| 1 | HIGH | (d) c4000 "drop HURTS +15/+20% on thermally paired pairs"; "drop still hurts at cache 4000" | Airithmetic CONFIRMED for the r2/r3 subset only; **overclaim for the stated conclusion** — with all accepted rounds the rerun mean is ≈ +2% (≈ 0) and the aggregate ratio is −3.1%; "thermally paired" is not supported by the temp columns; outlier handling is asymmetric vs the original |
| 2 | HIGH | (c) "bytes (read_MiB / proc_read_bytes) and cache hit rates are bit-identical" | FALSE as stated: `proc_read_bytes` differs in **all 24 paired rows** (−0.58%…+1.16%); read_MiB / cache_hit_pct / evictions / rereads / experts_* are deterministic formula columns (identical across 3 independent days), so their "identity" is trivial |
| 3 | MED | (b) "battery 97%→55%, never under 45" | UNPLUGGED all 28 rows and floor never hit: CONFIRMED. Endpoints: data files say 94→56; 97 and 55 appear in no data file (97 = report prose dumpsys read; 55 = nowhere; last CSV batt_end = 56) |
| 4 | MED | (f) "original thermal outlier 0.184 came back as 0.142" | Number CONFIRMED (0.184→0.142, both CSVs). "Thermal" explanation REFUTED by the rerun itself: the rerun measured 0.142 at the same 35 °C, matching r1/r2; the original 0.184 was run-to-run variance |
| 5 | MED | (a) covariate capture; nproc=0 row mechanism | Accepted rows 24/24 = nproc 8, mask ff, UNPLUGGED: CONFIRMED. The agent's mechanism for the one excluded nproc=0 row ("first sample empty, popcount fell through to 0") is incompatible with the harness code; real mechanism reproduced by test (Finding 5) |
| 6 | LOW | (e) same binary sha as originals | CONFIRMED at the precision the run data records: identical 16-hex prefix `77a94640a56a9043` in all 3 new logs and all 3 original logs; harness computes it from the file at launch (`sha256sum "$BIN" | cut -c1-16`, harness L423). Full sha exists only as report prose (out-of-band ssh), not archived |
| 7 | LOW | provenance of the "originals" | The bit-identity comparison rests on the agent's own copies; original Jelly runs.csv exist nowhere else in the repo (results dirs hold only launch.sh). Copies are internally coherent but not independently verifiable |
| 8 | LOW | (a)/(7) watchdog residual note | TRUE at code level and confirmed live: `grep ',0,ok$'` at `watch_dropsweep_lfm_jelly.ps1` probe (~L112) never matches the new schema; shown live by the c4000_cov STOP_VOID alert printing "good rows: 0 of 12"; counter is display-only (relaunch uses ALIVE/STARTING/STATUS/BEATAGE), as the agent claimed; the "of 12" is hardcoded (wrong for 6-row cells, display-only) |

**Bottom line for the log entry:** "replica, not artefact" is FAIR for c1500 and c2000 (direction + rough magnitude, 6/6 rows per cell, both runs, d > 10, drop-arm means within ≤1.5% across runs). It is NOT fair as written for c4000: only rounds 2–3 replicate; the all-round mean is ≈ 0; the original's "+39%" magnitude was itself an artifact of its own round-1 outlier and does not replicate.

---

## Finding 1 — Drop-benefit recomputation (claim d)

All s/tok from runs.csv; per-round pairing as defined above.

### c1500 (DROPS `0.0 1.0nr`, 6 rows/run)

Rerun: r1 (0.191−0.142)/0.191 = 25.65% · r2 (0.188−0.140)/0.188 = 25.53% · r3 (0.185−0.142)/0.185 = 23.24% → **mean −24.81%**. Agent's −25.7/−25.5/−23.2 ✓.
Original: r1 25.26% · r2 24.87% · r3 (0.189−0.184)/0.189 = **2.65%** → mean **−17.59%**; **−25.06% after removing the r3 outlier**. So the campaign's "−25%" (ALIVE.md L280) itself requires removing the original r3 outlier; the rerun's "−25%" likewise requires the same (its own r3 is clean). Direction: 6/6 rows faster with drop in each run. CONFIRMED as direction; magnitude −25% is the outlier-adjusted mean of both runs.

### c2000 (DROPS `0.0 0.65 1.0 1.0nr`, 12 rows/run; pairing d1.0nr vs d0.0)

Rerun: r1 30.39% · r2 27.65% · r3 27.06% → **mean −28.36%** (agent's −30.4/−27.6/−27.1 ✓).
Original: r1 23.93% · r2 23.03% · r3 28.07% → mean −25.01% ("−24.9%", ALIVE.md L281 −25% ✓).
Other arms for completeness (rerun): d1.0 vs d0.0: 30.9/27.1/24.7 → −27.6%; d0.65 vs d0.0: +4.4/−2.4/−3.5 → −0.5% (nothing; original was −5.1%). CONFIRMED: direction 6/6 rows, both runs; magnitude −25…−28% both runs.

### c4000 (DROPS `0.0 1.0nr`, accepted rows only; ratio d1.0nr/d0.0, >1 = drop hurts)

| round | rerun d0.0 | rerun d1.0nr | ratio | benefit |
|---|---|---|---|---|
| r1 | 0.189 (pass 1) | 0.137 (pass 2) | 0.725 | **−27.5% (drop FASTER)** |
| r2 | 0.111 (resume) | 0.133 | 1.198 | **+19.8% (hurts)** |
| r3 | 0.113 | 0.130 | 1.150 | **+15.0% (hurts)** |

- Agent's claimed pair +19.8% / +15.0% = exactly the r2/r3 subset ✓.
- **All rounds**: mean of the three ratios = (0.725+1.198+1.150)/3 = 1.024 → +2.4%; aggregate Σd1/Σd0 = (0.137+0.133+0.130)/(0.189+0.111+0.113) = 0.400/0.413 = 0.969 → **drop faster by 3.1%**. The stated conclusion "drop still hurts at cache 4000" does not survive inclusion of round 1.
- Original (accepted rows): r1 0.217/0.116 = +87.1% · r2 0.131/0.113 = +15.9% · r3 0.130/0.113 = +15.0% → mean ratio 1.393 = **+39.3%**, entirely carried by its r1 outlier 0.217 (which was retained, excluded=0, drop_mb=1043 ≥ MIN_DROP_MB).
- Symmetric treatment: discarding each run's round-1 (the only defensible common rule) leaves orig r2/r3 +15.5% vs rerun r2/r3 +17.4% — consistent. Keeping all rounds leaves orig +39% vs rerun +2% — inconsistent. The rerun therefore REPLICATES the original's required r2/r3 correction, and simultaneously DEMONSTRATES the original's headline +39% was an artifact.

**Is the r1_d0.0 = 0.189 discard legitimately justified by the temp columns?** No.
- temp_start/end of r1_d0.0 = 37.0/37.0; the accepted r2/r3 rows are 36.0–37.0. A 1 °C delta. The row's inflation is in `compute_s_tok` (0.154 vs 0.089–0.091 in r2/r3 d0.0) — a compute-side anomaly (DVFS/background), not an I/O or coldness signature; "just after allocating a 4000 MiB cache" is refuted by the original, whose first c4000 row (r1_d0.0) was the FASTEST of its cell (0.116).
- Cross-cell "thermal pairing" is false on the data: original c4000 r2/r3 ran at 29–32 °C; rerun r2/r3 at 36–37 °C. No accepted rerun row has a temperature-matched original. If "thermally paired" means within-rerun r2/r3, the criterion adds nothing beyond "drop round 1".
- Known device noise (±50% between consecutive runs) is larger than the 1 °C argument.

**Claim (d) verdict**: numbers CONFIRMED for the subset that was chosen; the conclusion as worded ("drop HURTS +15/+20… drop still hurts at cache 4000") is a post-hoc-subset overclaim. Correct log entry: "rounds 2–3 of both runs show drop +15–20% slower at cache 4000; round 1 is unstable in both runs (one arm each); original +39% not replicated; all-round rerun mean ≈ +2%".

---

## Finding 2 — (c) "bit-identical bytes": FALSE for the only measured counter

Row-paired new vs original by label (csv `line` for every value):

`read_MiB` — identical to 1 decimal, all 24 pairs (15192.9/4926.2; 11803.1/10535.0/3712.8/3562.4; 3365.8/1188.8).
`cache_hit_pct` — identical (39.5/59.0; 50.2/52.3/67.1/67.9; 76.8/81.7).
`proc_read_bytes` — **differs in all 24 pairs**:

c1500 (new vs orig): r1_d0.0 27098099712↔26982129664 (+0.430%) · r1_d1.0nr 16326651904↔16140034048 (+1.156%) · r2_d0.0 27073515520↔26885095424 (+0.701%) · r2_d1.0nr 16303202304↔16295526400 (+0.047%) · r3_d0.0 27074879488↔26950008832 (+0.463%) · r3_d1.0nr 16256475136↔16334884864 (−0.480%)

c2000: r1_d0.0 +0.261% · r1_d0.65 −0.166% · r1_d1.0 −0.114% · r1_d1.0nr +0.117% · r2_d0.0 +0.584% · r2_d0.65 +0.015% · r2_d1.0 +0.473% · r2_d1.0nr +0.320% · r3_d0.0 −0.581% · r3_d0.65 −0.006% · r3_d1.0 −0.174% · r3_d1.0nr −0.291%

c4000 (pass-2/resume rows vs original): r1_d0.0 +0.071% · r1_d1.0nr(p2) −0.327% · r2_d0.0(resume) −0.023% · r2_d1.0nr +0.121% · r3_d0.0 +0.307% · r3_d1.0nr +0.250%

Why "read_MiB/hit identical" is trivial: those columns (plus evictions, rereads, experts_routed, experts_dropped, n_tokens=200, majflt_tok=0.00) are **identical to the exact integer across three independent days** — 2026-08-16 (v1, `c2000_v1_runs.csv`), 2026-08-17/18 (originals) and 2026-08-19 (rerun) all report e.g. read_MiB=11803.1, evictions=16692, rereads=12514 for cache-2000 d0.0. A measured byte counter can never be integer-identical across days with different page-cache states (cached_before_kib itself differs run to run). These are formula-derived summary columns. The one genuine storage-I/O measurement in the CSV is `proc_read_bytes`, and it is not bit-identical in a single row.

Additional note: `read_MiB` does not equal proc_read_bytes/2²⁰ (c1500 d0.0: 25842 MiB measured vs 15192.9 reported) — they are different counters and should not be conflated in the log entry.

---

## Finding 3 — (b) battery and plug state

- Plugged: all 28 rows (24 accepted + 4 excluded) = UNPLUGGED. CONFIRMED.
- Floor: minimum recorded = 56 (c4000 resume row batt_start=batt_end=56), floor 45. Never approached. CONFIRMED.
- Endpoints: first data value batt_start=94 (c1500 r1, 09:44:47); last data value batt_end=56 (c4000 resume row, 11:04:41). The report's "97% → 55%": 97 is a pre-launch `dumpsys battery` line quoted in the report prose (Step 1), 55 appears in **no data file**; the watchdog BATT probes were all empty (`batt=` in every cov watch line), so no independent battery trace exists. The CSV terminal value is 56. This is the "quoted number that exists in no data file" class; PLAUSIBLE but unverifiable, and off by one from the recorded data.

---

## Finding 4 — (a) covariates, row by row; (e) binary sha

(a) Mechanical scan of the three runs.csv files (28 rows): all 24 accepted rows (excluded=0) have nproc=8, affinity_mask=ff, plugged=UNPLUGGED, excluded=0. No accepted row violates; no excluded row appears in any of the agent's means (c4000 excluded rows 0.134/0.112/0.113/0.110 are absent from both the table and the benefit arithmetic). Harness code confirms the source: the binary is launched (`"$BIN" … &`, pid=$!, harness L548–551) and `read_pid_cpuset "$pid"` samples `/proc/<pid>/status` of that binary on the first tick and every 8th second (L552–570); the gate (`cpuset OK nproc=8 bits=8 cpuset=/top-app`) is a separate /proc/self check (gate_cpuset, L211–248). Logs for all three cells show the gate passing and per-row `nproc=8 mask=ff`. CONFIRMED.

(e) Binary sha: recorded in each run's own log: e.g. `cachesweep_marco_jelly_c1500_cov/outer.log` L4 `bin=…/bmoe-cli sha=77a94640a56a9043`; identical 16-hex prefix in the three original sweep.logs. Harness computes it live: `sha256sum "$BIN" | cut -c1-16` (L423), not a constant. Model (`2f92195854011538`) and prompt (`b5301c32c0bd8aae`) prefixes also match. CONFIRMED at 64-bit precision; the full sha exists only in the report's out-of-band ssh note, not archived.

---

## Finding 5 — the nproc=0 row: agent's mechanism is wrong (impact nil)

Data: c4000 r1_d1.0nr pass 1: excluded=1, cold-invalid, `nproc=0`, `affinity_mask=ff` (runs.csv line 3). Agent's explanation: "the first /proc/<pid>/status sample was empty and popcount fell through to 0."

The harness (`read_pid_cpuset`, L141–173) prints `nproc mask` from ONE awk read of `/proc/<pid>/status`; n = popcount(mask) with fallback to count_cpu_list(list). Tested with the function extracted verbatim (synthetic /proc trees):

- unreadable file → prints `" "` → consumer `set --` gets NO fields → **no overwrite** (nproc/mask stay from a previous sample) — an "empty first sample" CANNOT produce nproc=0.
- status readable but Cpus_allowed line empty / list absent → prints `"0 "` → overwrites nproc to 0, mask untouched.
- Therefore the observed `0,ff` needs: an earlier good sample (`8 ff` sets both), then a later ragged sample (`0 ` with empty mask) as the LAST nproc-updating sample. "popcount fell through to 0" applies only to the ragged sample's empty mask; `ff` in the same CSV row comes from a different sample. The row is internally inconsistent with a single-read story, and the agent's described mechanism is not what the code does. Row is excluded → no impact on any mean. The real lesson (for the harness, not this audit): a transient ragged /proc read mid-process can silently downgrade nproc on a measured row; last-sample-wins without cross-field consistency checking.

---

## Finding 6 — Q6: STOP_VOID / resumed row posture (c4000)

Mechanics verified (device outer.log): r2_d0.0 failed cold validity on pass 1, 2, 3 (drop_mb 976/921/922 < MIN_DROP_MB=1000, harness L53/L528–534) → `=== SWEEP INCOMPLETE after 3 passes ===` → STOP_VOID (10:59:49) → operator relaunch at 11:03 (void=[r2_d0.0]) → smoke + fadv → drop_mb=1598, accepted (11:04:41). The original cell hit the identical wall (c4000_sweep.log L19–21: drop_mb=952 → EXCLUDE; then its own 12.5-min-death relaunch, resume row drop_mb=1311, temps dropped to 29 °C).

Posture of the resumed row vs the rest:
- cached_before_kib = 2 046 576 (2.0 GiB) vs failed-pass rows 1 465 192–1 749 824 — the smoke/relaunch left the page cache warmer before the reset; cached_drop_mb = 1598 vs 921–976; cached_after = 410 108 KiB — the coldest "after" value of the three accepted d0.0 rows (571 856 / 961 360 / 410 108).
- Timing: resumed row s/tok = 0.111; the three excluded cold-invalid rows measured 0.110–0.113; the original's (also resumed) r2_d0.0 = 0.113. Posture differs, timing is indistinguishable → **no demonstrable bias**; the comparison r2 is resumed-vs-resumed (matched). What the comparison cannot rule out: a warm-cache d0.0 row could in principle read less from storage; the measured timing shows no trace of it. Include the caveat, treat r2 as valid.

---

## Finding 7 — Q7 + provenance

Watchdog (Q7): verified at `scripts/watch_dropsweep_lfm_jelly.ps1` probe (~L112): `ROWS=$(tail -n +2 $cell/runs.csv | grep -c ',0,ok$')` — old rows end `,0,ok`; new rows end `,0,ok,8,ff` → ROWS ≡ 0. Consumers: the `Say` line (L166) and two Alert strings ("cell ended… good rows: 0 of 12", "relaunch budget… of 12 rows") — display only; the relaunch decision uses ALIVE/STARTING/STATUS/BEATAGE only (L175–205). The agent's residual note is accurate, corroborated live: `logs/watch-cachesweep_marco_jelly_c4000_cov.log` 11:00:48 printed "good rows: 0 of 12" for a cell that then contained 6 good rows; the "of 12" is hardcoded (6-row cells would report "… of 12"). No functional impact.

Provenance: `grep` across the repo finds the original Jelly runs.csv values ONLY in `scratchpad/agents/jelly-cache-rerun/originals/`; the campaign result dirs (`results/cachesweep_marco_jelly_c{1500,4000}/`, `results/dropsweep_marco_jelly/`) contain launch.sh only. The copies are internally coherent (paired sweep.logs with matching sha headers, monotonic battery/temperature, timestamps spanning the CSV rows, the 952→1311 exclude/resume sequence matching ALIVE.md's reading) — but claim (c) compares against files that exist only because this agent copied them, with no second source. That is the same unverifiable-covariate exposure class the campaign has retracted before; the log entry should state "compared against the agent's copies of the originals (device files no longer exist in repo)".

Also verified sound: harness file identity — disk sha256 `d37f0f1baf1da4ba59e2fd011d9de9c06a827ad00dc27be11dbaebebb970e1f5` == `git show 6a26036:scripts/run_dropsweep_jelly.sh` (commit message matches the gate work); `launch.sh` specs match the originals (c1500/c4000 export CACHE_MB; dropsweep_marco_jelly does NOT export it — harness default 2000 — and c2000_cov sets CACHE_MB=2000 explicitly); BASE_FLAGS identical to what the report states (L306–309); cells are untracked in git (`??`) — nothing was pushed, as claimed; `chain.log` ends at "fail … STOP_VOID" with no entry for the 11:03 operator relaunch, consistent with the report's "manual relaunch" disclosure.

---

## Q5 — n, effect size, and what the data can and cannot support

Within-run statistics (rerun accepted rows):

| cell | arm | mean s/tok (SD) | Δ | pooled SD | Cohen's d | mean-diff 95% CI (t(4)=2.776) |
|---|---|---|---|---|---|---|
| c1500 | d0.0 | 0.1880 (0.0030) | −0.0467 | 0.00227 | ≈20 | [−0.0518, −0.0415] |
| c1500 | d1.0nr | 0.1413 (0.0012) | | | | |
| c2000 | d0.0 | 0.1737 (0.0064) | −0.0493 | 0.00462 | ≈11 | [−0.0598, −0.0389] |
| c2000 | d1.0nr | 0.1243 (0.0015) | | | | |
| c4000 (r2,r3) | d0.0 | 0.1120 (0.0010) | +0.0195 | 0.00127 | ≈15 (t(2)=4.303) | [0.0140, 0.0250] — n=2 |

Between-run agreement on the drop arms (the honest noise floor): c1500 d1.0nr 0.1413 vs 0.1435 (no-outlier orig) = 1.5% apart; c2000 d1.0nr 0.1243 vs 0.1247 = 0.3%; c2000 d0.0 0.1737 vs 0.1663 = 4.4%.

What the data SUPPORT: at c1500 and c2000 the direction and rough magnitude (−23…−30%) are solid — 12/12 paired rows agree across two runs, within-run d > 10, drop-arm means stable to ≤1.5% across runs. The log entry "replica, not artefact — direction, not magnitude" is consistent with this for these two cells; magnitude precision is ±~3–5 percentage points, not ±1.

What the data do NOT support: any precise magnitude for c4000 (round-1 swings −27.5%…+87% across runs; all-round rerun mean ≈ +2%); the "−25%" for c1500 as if it held with all rounds of the original (original all-round mean −17.6%); the "drop hurts +15/+20" framing for c4000 without the "rounds 2–3 only" qualifier; and any claim that the original c4000 "+39%" replicated (it did not).

---

## Explicit SOUND list (verified, survives this audit)

1. (a) All 24 accepted rows: nproc=8, affinity_mask=ff, plugged=UNPLUGGED, excluded=0; covariates come from the launched binary's PID (harness L548–570); gate behavior in logs matches the committed code.
2. (b) Whole run UNPLUGGED (28/28 rows); battery floor 45 never approached (minimum recorded 56).
3. (d) c1500 −25.7/−25.5/−23.2% and c2000 −30.4/−27.6/−27.1% per-round arithmetic — exact; direction replicates the originals 6/6 rows per cell.
4. (e) Binary sha prefix `77a94640a56a9043` identical in the run data of all three rerun cells and all three original cells; harness prints sha256 of the actual binary at launch.
5. (f) Rerun value 0.142 for the label the original measured at 0.184 — confirmed in the CSVs.
6. STOP_VOID handling at c4000: procedure identical to the original cell's own cold-valid wall and resume; resumed row timing indistinguishable from the excluded rows (0.111 vs 0.110–0.113) and from the original resumed row (0.113) — no demonstrable bias.
7. Harness/launcher identity: disk harness == commit 6a26036 (sha d37f0f1b…); launch.sh specs match originals; c2000 cache default concern handled explicitly.
8. Watchdog residual note: accurate as described, counter display-only, evidenced live by the c4000_cov STOP_VOID alert.
9. No commits/pushes made; chain/watcher logs consistent with the narrative (including the disclosed operator relaunch for the c4000 resume).

## Minor notes (no impact on verdicts)

- The report's benchmark for the ALIVE=2 false positive ("the 18/08 c1500 watch log") is miscited: the 2026-08-18 ALIVE=2 probes are in `logs/watch-cachesweep_marco_jelly_c1000.log` (00:50:51, 00:54:36). The 18/08 c1500 watch log shows alive=1 throughout. The phenomenon itself is real and re-occurred on the new c2000_cov first probe (10:00:36) as claimed.
- `logs/watch-cachesweep_marco_jelly_c1500.log` starts at 01:04:37 for a cell launched 00:54:27 — the first ~10 min of the ORIGINAL c1500 cell were unwatched (watchdog started late). No impact on that run's completed data.
- Finding 5: the exact production trigger of the `0,ff` sample is not determined from the repo; what the harness test excludes is the agent's stated mechanism.

## Must be corrected before the log entry

1. (c) Reword: only the deterministic summary columns (read_MiB, cache_hit_pct, evictions, rereads, experts_*) are bit-identical; the measured counter proc_read_bytes differs in every row (−0.6…+1.2%); "bit-identical bytes" as claimed is false.
2. (d) c4000: replace "drop still hurts at cache 4000 (+15/+20)" with "rounds 2–3 of both runs: +15–20% slower; round 1 unstable in both runs; all-round rerun mean ≈ +2% ≈ 0; original +39% not replicated". Drop the "thermally paired" label (unfounded on the temp columns).
3. (b) Replace endpoints with the recorded 94→56 and record the pre-launch/post-run reads as prose, or archive the final battery read.
4. (f) Record the rerun as evidence AGAINST the thermal explanation (same 35 °C → 0.142), not for it.
5. State that the originals being compared are the agent's copies (no in-repo second source).