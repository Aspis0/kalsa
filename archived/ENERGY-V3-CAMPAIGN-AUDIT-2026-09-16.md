# Stamped v3 Jelly campaign — hostile audit of the dataset and its analysis

Commit under audit: `b3a4fed` `bench(energy): stamped v3 Jelly dataset — 3 back-to-back runs, raw data + report`
(branch `energy-framework`, HEAD == `origin/energy-framework`, tree clean).
Subject: `device-v3-out/run1|run2|run3/` (raw sampler CSVs, `.marks`, `.stamps`, per-rep `_rN.txt`,
`.phases.csv`), `device-v3-out/run1-v2fallback/`, and the analyst's `device-v3-out/CAMPAIGN-REPORT.md`.
Date: 2026-09-16.
Mode: read-only verification. Every command ran from the worktree; all scratch under `/tmp/kalsa-audit-v3/`;
no repo file was created or modified; no commit, no push; **no adb, neither phone touched**.
Scope: falsify the eight claims in the brief. Nothing is accepted here that does not rest on a command in
this report. The published tables were re-derived from raw bytes with an independent parser and integrator
(no repo module imported for the arithmetic), and the committed pipeline was re-run on the committed bytes.

## Verdict

**NO-SHIP (narrow, claim-level).** Every published number survives: all 288 section-3 table cells, all 12
within-run spreads, all 4 between-run spreads, all 8 MDE figures, all cross-stem ratios, the v2-vs-v3
deltas and the whole-window conservation all reproduce exactly, and re-running the committed splitter on the
committed bytes regenerates all 16 `.phases.csv` byte-identically. The dataset is sound and is byte-identical
to the campaign's own working directory.

What blocks publication is the surrounding text. Seven statements in the report are false or unreachable as
written and four more are overstated or under-specified, while four findings the data does support are
missing. One of the false statements (§8, clocks pinned at 2.20 GHz in *every* decode window) is the only
quantitative support for the mechanism conclusion and reads in the opposite direction from the truth; one
(§2, mid-campaign charge gate) describes a safety check that is dead code under `ARMS=none` and that the S23
replication will inherit; and the missing baseline finding undercuts the use of these numbers as a
cross-session reference.

This is not a data-integrity NO-SHIP. The corrections are listed per item at the end; the numbers themselves
need no change.

## 1. THERMAL COLLAPSE — the decay is real; the recorded clock does not explain it; the report's clock sentence is false

**Decay: confirmed.** From the `.stamps` sidecars (`predicted_n / predicted_ms`), all 36 reps:

```
stem       run       t/s   dec_s  meanW_dec  battT   j/tok
2.6B/REP   run1     3.91  65.422      3.527   28.8  0.8837
2.6B/REP   run3     2.74  93.332      2.439   37.1  0.8760   run1->run3  t/s -29.9%  dec_s +42.7%  meanW -30.9%  j/tok -0.9%
2.6B/PURE  run1     4.05  50.392      3.664   32.1  0.8880
2.6B/PURE  run3     2.66  76.820      2.293   37.9  0.8470   run1->run3  t/s -34.4%  dec_s +52.4%  meanW -37.4%  j/tok -4.6%
1.2B/REP   run1     8.77  29.191      3.666   34.1  0.4043
1.2B/REP   run3     5.76  44.469      2.261   38.0  0.3800   run1->run3  t/s -34.4%  dec_s +52.3%  meanW -38.3%  j/tok -6.0%
1.2B/PURE  run1     9.35   3.209      3.570   35.0  0.2517
1.2B/PURE  run3     7.42   4.041      2.646   38.0  0.2690   run1->run3  t/s -20.6%  dec_s +25.9%  meanW -25.9%  j/tok +6.9%
```
Command: `python3 /tmp/kalsa-audit-v3/analyze4.py` (arms table §S/V) and the mechanism table in
`/tmp/kalsa-audit-v3/mechanism.txt`. Decode-window mean power is the tool-identical right-Riemann integral
over `[mark_N − predicted_ms/1000, mark_N)`; `battT` is the mean `batt_temp_deciC` over the same window.

**Clocks: the recorded column does not fall, and it also does not track the achieved frequency.** Per-rep
`cpu6` (`scaling_cur_freq`, cpu6==cpu7 on 2318/2319 rows) inside the tool's own decode window:

```
decode windows with MEAN cpu6 < 2200 MHz: 5/36
  run1 2.6B/REP r3  2176.95 MHz | run1 2.6B/PURE r3 2179.59 | run2 1.2B/REP r2 2165.70
  run2 1.2B/PURE r1 1831.25 MHz | run3 1.2B/PURE r2 1831.25
decode windows with MEDIAN cpu6 < 2200 MHz: 0/36
```
In all five cases the sub-max reading is the *last* sample of the decode segment and exactly one sample;
e.g. `run1 2.6B/REP r3` reads 2200 MHz sixty-three times then 725 MHz once, and its whole-window big-core
mean is otherwise identical to the fast reps. Two of the five are in cold run1. So:

- The report's §8 sentence "the sampled big-core clocks (cpu6/cpu7) read a **pinned 2.20 GHz mean in EVERY
  decode window** of runs 1–3" is **false**: five of thirty-six decode windows have means of 1831–2180 MHz.
  The defensible statement is: *median* 2.20 GHz in 36/36 decode windows, with single-sample dips at the
  mark boundary that also occur in the cold run.
- **The collapse is unexplained by the recorded clock.** Say it plainly: as recorded, the big-cluster clock
  does not fall across run1→run3, so the on-disk clock column cannot be the mechanism.
- What the data *does* show, and the report misses, is that the achieved frequency almost certainly did fall.
  Mean decode power tracks throughput almost one-for-one (−30.9 %, −37.4 %, −38.3 % power against −29.9 %,
  −34.4 %, −34.4 % throughput) while the reported clock is constant at the cluster maximum. Throughput
  constant-clock with constant work would require a 30–34 % IPC loss on an IDENTICAL token stream
  (the generated text is byte-identical across all 9 reps of a stem, verified below); a concurrent 38 % power
  drop is the signature of a resource reduction the sampler does not record: either a lower achieved CPU
  frequency that `scaling_cur_freq` (a governor-reported request) does not expose, or a lower memory-subsystem
  clock/bandwidth, which on this SoC can be throttled without touching `cpufreq` and which a bandwidth-bound
  decode would show exactly this way. The dataset holds no DRAM-clock or achieved-frequency column and no
  compute-only control, so the two cannot be separated here. Either way the correct conclusion is *not* "no
  thermal throttling": it is "the recorded clock column cannot decide this, and the power column shows the
  chip did the same work in more time at proportionally less power".

**Battery level and temperature per run.** The sampler schema is
`t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz` — there is **no level column in the CSVs**;
level comes from `dumpsys` in `results.txt`, temperature is in the CSVs:

```
run1: n=649  batt_temp 27.0-35.0 C  mean 31.33 C   level 92 -> 85   (results.txt before/after lines)
run2: n=810  batt_temp 35.0-38.0 C  mean 36.63 C   level 85 -> 79
run3: n=860  batt_temp 37.0-38.0 C  mean 37.59 C   level 79 -> 73
```
The step is not gradual: 2.6B/REP holds 3.87 t/s at 35.0 C in run2 r1, then falls to 2.98 t/s at 36.0 C in
run2 r2 and never recovers (2.80 at 36.5 C, 2.83 at 37.2 C in run3). A 1.0 C battery-temperature rise
coincides with a 23 % throughput loss and no clock change. The report's checkpoint table (§2) is correct
cell-for-cell against `results.txt`; its "23:50:27 preflight … temperature: 270" lines etc. all verified.

## 2. NEVER ON CHARGE — verified from the CSVs; the gate claim is not

```
total sampler rows (runs 1-3): 2319
status counts (runs1-3): Counter({'Discharging': 2319})
status counts (all incl. v2fallback copy): Counter({'Discharging': 2968})
```
Also: `results.txt` contains 15 `AC/USB/Wireless powered: false` lines (3 preflight + 12 per-stem `before:`),
all false; no run aborted. The no-charge claim **survives on the sampler evidence**, which is 1 Hz and
continuous, and is stronger than any per-arm check.

The gate claim does not. `scripts/device-ngram-spec.sh` at the analysis-time revision `f2f9ea1` is
byte-identical to HEAD (`md5 a6c1f6874fee4eebabf54a900fa1daf2`), and in it:

```
262-      if [ "$arm" = "none" ]; then
263-        continue  # baseline is the reference, no gate against itself
264-      fi
...
269:      # Mid-campaign re-check: plugging in mid-run invalidates the rest.
270-      if [ "${SMOKE:-0}" != "1" ] && printf '%s' "$(battery_line)" | grep -qE '(AC|USB) powered: true'; then
271-        blog "ABORT: device plugged in mid-campaign."
```
All three runs used `ARMS="none"`, so the loop `continue`s **before** the mid-campaign gate: the gate did not
"not trip", it never executed. The same `continue` also skips the `after:` battery line, the correctness gate
and the 45 s settling sleep. Report §2's "mid-campaign gate never tripped" must be replaced by "the
mid-campaign gate is unreachable for `ARMS=none` and therefore provided no protection; charging is excluded by
the 2319-row sampler status column and the preflight". This matters for the S23 replication, which will use
the same harness.

## 3. WITHIN-RUN SPREADS — all twelve figures and all thirty-six j/tok values are correct

```
stem       run     recomputed   report  match  vals (recomputed)                 vals (report)
1.2B/PURE  run1          1.59     1.59   True  [0.253, 0.249, 0.253]   [0.253, 0.249, 0.253]
1.2B/PURE  run2         35.72    35.72   True  [0.319, 0.226, 0.236]   [0.319, 0.226, 0.236]
1.2B/PURE  run3          8.18     8.18   True  [0.258, 0.269, 0.28]    [0.258, 0.269, 0.280]
1.2B/REP   run1          4.95     4.95   True  [0.394, 0.405, 0.414]   [0.394, 0.405, 0.414]
1.2B/REP   run2          3.65     3.65   True  [0.384, 0.391, 0.377]   [0.384, 0.391, 0.377]
1.2B/REP   run3          1.58     1.58   True  [0.378, 0.384, 0.378]   [0.378, 0.384, 0.378]
2.6B/PURE  run1          0.79     0.79   True  [0.891, 0.884, 0.889]   [0.891, 0.884, 0.889]
2.6B/PURE  run2          4.54     4.54   True  [0.84, 0.858, 0.879]    [0.840, 0.858, 0.879]
2.6B/PURE  run3          0.83     0.83   True  [0.848, 0.85, 0.843]    [0.848, 0.850, 0.843]
2.6B/REP   run1          3.85     3.85   True  [0.868, 0.881, 0.902]   [0.868, 0.881, 0.902]
2.6B/REP   run2          8.06     8.06   True  [0.937, 0.865, 0.878]   [0.937, 0.865, 0.878]
2.6B/REP   run3          4.45     4.45   True  [0.901, 0.862, 0.865]   [0.901, 0.862, 0.865]
spread mismatches: []
```
Command: `python3 /tmp/kalsa-audit-v3/analyze.py` (§D), formula `(max−min)/mean×100`. Re-running that
formula on `device-ngram-spec-out/*.phases.csv` reproduces all four *committed* v2 figures exactly —
`1.2B/PURE [0.184, 0.183, 0.242] 29.06%`, `1.2B/REP [0.293, 0.293, 0.295] 0.68%`,
`2.6B/PURE [0.672, 0.629, 0.608] 10.06%`, `2.6B/REP [0.646, 0.645, 0.653] 1.23%` — so §4's "this formula
reproduces all four committed figures from the findings table" is itself verified.

**The 2.6B/PURE claim survives**: 10.06 % does not reproduce (0.79 / 4.54 / 0.83 %). Not an offset artefact:
in absolute terms the old campaign's three reps span 13.0 J of decode energy (137.032/128.370/124.034) where
run1 spans 1.6 J (181.863/180.259/181.288). **The 1.2B/PURE fragility claim survives too**: run2's flagged
reps swing 35.72 % against a committed 29.06 %.

Two qualifications the report does not make. (i) The comparison is between a 1.04 s-resolution bucket and the
old campaign's 3.02–3.52 s-resolution bucket, and the old campaign's two 2.6B stems are exactly the two stems
that carried >1.5 s sampler stalls (2.6B/REP 79/286 intervals >1.5 s; 2.6B/PURE 26/219; both 1.2B stems zero).
The old 10.06 % sits on the stem that had the stalls, so part of what "does not reproduce" may be the old
sampling resolution rather than a device difference; the direction of the conclusion is unchanged, the
like-for-like status of the comparison is not established. (ii) §4's "with 98–99 % decode coverage on every
rep" holds for 2.6B/PURE (97.5–99.0 %).

## 4. BETWEEN-RUN SPREADS — correct; the MDE table is correct but its convention is unstated, and the pooling choice is wrong for two of four stems

§5 reproduces exactly (`python3 analyze.py` §E):

```
1.2B/PURE  means=[0.2517, 0.2603, 0.2690] grand=0.2603 spread=6.66%  report=6.66%
1.2B/REP   means=[0.4043, 0.3840, 0.3800] grand=0.3894 spread=6.25%  report=6.25%
2.6B/PURE  means=[0.8880, 0.8590, 0.8470] grand=0.8647 spread=4.74%  report=4.74%
2.6B/REP   means=[0.8837, 0.8933, 0.8760] grand=0.8843 spread=1.96%  report=1.96%
```

**§7 re-derived.** The analyst's pooled SD is the sample SD over the 9 reps pooled across runs, and its CV is
exact: 10.446 / 3.328 / 2.412 / 2.807 % against the published 10.45 / 3.33 / 2.41 / 2.81 %. The eight MDE
figures reproduce **exactly** under the convention
`MDE = (t_{0.975,2n−2} + t_{0.80,2n−2})·SD·sqrt(2/n)` — 31.7 / 10.1 / 7.3 / 8.5 % at n=3 and
21.1 / 6.7 / 4.9 / 5.7 % at n=5 — as do the run1-only figures 2.8 / 7.5 / 1.2 / 5.9 %. They do **not**
reproduce under the normal approximation a reader would apply to the stated recipe ("two-sample, two-sided
alpha 0.05, power 0.8"), which gives 23.9 / 7.6 / 5.5 / 6.4 % at n=3. The report must state that it used the
t quantile with df = 2n−2.

**Is pooling the 9 reps right for "is a sequential A-then-B usable"? Partly.** Pooling captures both variance
components, so it is defensible and conservative where the run effect is not significant, but for a
*sequential* design the correct error term on an A−B difference is the **block** (run) component, not the
pooled rep scatter, because the drift does not average out with more reps inside a block. One-way ANOVA over
3 runs × 3 reps, `sd_run = sqrt((MS_between − MS_within)/n)`:

```
stem        MS_between  MS_within  sd_within  sd_run  CV_within%  CV_run%  MDE n=3 pool9  MDE n=3 nested  MDE n=5 nested
1.2B/PURE    2.253e-04  9.109e-04   0.03018  0.00000   11.593     0.000      31.71%        31.74%          24.58%
1.2B/REP     5.108e-04  5.378e-05   0.00733  0.01234    1.883     3.169      10.10%        25.41%          24.87%
2.6B/PURE    1.333e-03  1.357e-04   0.01165  0.01998    1.347     2.310       7.32%        18.49%          18.11%
2.6B/REP     2.263e-04  7.459e-04   0.02731  0.00000    3.088     0.000       8.52%         8.45%           6.55%
```
So the pooled choice is right for 1.2B/PURE and 2.6B/REP and **understates the sequential MDE by ~2.5× for
1.2B/REP and 2.6B/PURE** (10.1 → 25.4 %, 7.3 → 18.5 % at n=3). More importantly, the drift is *systematic*:
the run1→run3 change in the run-mean j/tok is **+6.9 % (1.2B/PURE), −6.0 % (1.2B/REP), −4.6 % (2.6B/PURE),
−0.9 % (2.6B/REP)** — stem-dependent in **sign**, so a sequential A-then-B pair acquires a spurious effect of
that size and direction merely from run order, and increasing n does not shrink it (the nested MDE stays
18–25 % at n=5). The report's decision (sequential not usable; ABBA plus a temperature gate) is correct and
is if anything understated; the per-stem n=5 column invites a reader to think n=5 rescues the design, which
it does not for two stems. Three of four stems are monotone in run order (crude joint p ≈ 0.11), which is
consistent with a real run-order artefact rather than noise.

## 5. CROSS-STEM RATIO — the committed 2.20–2.21× does not quite reproduce; the drift under throttling does

Paired per rep, REP-vs-REP only, from the committed `.phases.csv`:

```
run1: per-rep ratios = [2.203, 2.175, 2.179]  mean=2.186  ratio-of-means=2.185  decodeJ-sum ratio=2.187
run2: per-rep ratios = [2.44, 2.212, 2.329]   mean=2.327  ratio-of-means=2.326  decodeJ-sum ratio=2.327
run3: per-rep ratios = [2.384, 2.245, 2.288]  mean=2.306  ratio-of-means=2.305  decodeJ-sum ratio=2.305
```
The committed figure is `docs/ENERGY-PERPHASE-FINDINGS.md:68-70` — "2.20–2.21x per decode token
(r1 0.646/0.293 = 2.20, r2 0.645/0.293 = 2.20, r3 0.653/0.295 = 2.21; 2.21x on decode-J sums,
497.675/225.518 J)". Two of the three cold-run paired reps land at 2.175 and 2.179, i.e. ~1 % **below** the
committed band, and the decode-J-sum ratio is 2.187 against 2.207. The honest statement is "2.18–2.20 in the
cold run, straddling the lower edge of the committed 2.20–2.21 band", not "reproduces". The drift under
throttling (run2 2.33×, run3 2.31×) is verified, as is the report's arithmetic elsewhere in §5.

## 6. V2-VERSUS-V3 ON IDENTICAL BYTES — isolation legitimate, conservation circular, "bit-identical" overstated

Isolation: `device-v3-out/run1-v2fallback/` is byte-identical to `device-v3-out/run1/` for every `.csv`,
`.marks` and `_rN.txt` (30/30 non-sidecar files identical by `cmp`, including `results.txt`; only the four
`.phases.csv` differ, as they must), carries **0** `.stamps`, and carries regenerated `.phases.csv`. Independently, the whole tree matches the campaign's own working copy: all 41
files of each of `run1`, `run2`, `run3` and all 29 of `run1-v2only` are byte-identical to
`/tmp/kalsa-v3/…/device-ngram-spec-out` (0 differences), and `CAMPAIGN-REPORT.md` is byte-identical to
`/tmp/kalsa-v3/REPORT.md`. So the committed bytes are the campaign's bytes and only the stamps differ.

Bucket move: the real test is the sample index at which the decode bucket starts (`d` from the stamp's
`predicted_ms`, `b` from `gen_tokens/speed_line_tps`):

```
2.6B/REP  r1 d=23 b=23 same=True   2.6B/PURE r1 d=17 b=16 same=False  jdec 181.863 vs 185.691  (+3.828 J)
2.6B/REP  r2 d=24 b=24 same=True   2.6B/PURE r2 d=19 b=19 same=True
2.6B/REP  r3 d=24 b=24 same=True   2.6B/PURE r3 d=20 b=19 same=False  jdec 181.288 vs 185.043  (+3.755 J)
1.2B/REP  r1..r3 same=True         1.2B/PURE  r1..r3 same=True
buckets that MOVED: [('2.6B/PURE', 1, 17, 16), ('2.6B/PURE', 3, 20, 19)]
```
So the 10/12 and the two moved reps (2.6B/PURE r1, r3) are **confirmed**, and the magnitude (~3.8 J, ~2 %) is
confirmed. What the two moved reps have in common the report does not say: they are on the one stem whose
re-anchor band is widest. The v2 anchor uses `gen_tokens/round(gen_tps)`; for 2.6B/PURE the speed line is
4.0 t/s, giving 204/4.0 = 51.000 s against the stamp's 50.398 s, a 0.602 s band = 58 % of a cadence interval.
The other stems' bands are 0.19–0.35 s (19–34 %) and 0.009–0.142 s (1–14 %), so a boundary sample rarely
lands inside them. Both moved reps are "a sample happened to fall in the 0.60 s band"; r2 escaped the same
0.602 s band purely by sampler phase.

Two corrections. (i) "On 10/12 reps the decode bucket is bit-identical" is only true of the *interval set*:
the published `j_decode` differs by ±0.001 J on 5 of those 10 (1.2B/REP r1/r2/r3, 1.2B/PURE r2/r3) because
the v3 path rounds three components and the v2 path rounds one residual. Say "identical to the printed
3-decimal resolution (≤0.001 J)". (ii) "Whole-window J is conserved exactly (v3 li+pre+dec equals v2
pre+dec to ≤0.001 J on all 12 reps)" is true but **circular**: both paths define one bucket as the residual
`whole − other buckets`, so the identity is a construction, not a check. I verified it unrounded for all 12
rows (`worst |printed 3-bucket sum − independently integrated window J| = 0.000469 J`, itself the 3-decimal
rounding of each cell), which is the check that was actually wanted.

## 7. STAMP INTEGRITY — fully verified, 36/36

```
stamps present and parsed: 36/36   mismatches: 0
stamp durations vs window span: violations = 0 over 36 reps
duplicate (prompt_ms,predicted_ms) pairs across the 36 reps: 0
marks strictly increasing across runs (per stem): True (all four stems)
stamps file sizes: min=74 max=77 (report claims 74-77 bytes)
per-rep .txt files containing a speed line: 36/36
```
For every rep, `prompt_n/predicted_n` equals the committed manifest (`51/30`, `72/256`, `52/204`, `73/256`)
**and** the stamp-derived throughput agrees with that rep's own speed line to ≤0.06 t/s. The wrong-run test
is the strongest available: every `(prompt_ms, predicted_ms)` pair is unique across the 36 reps, every
stamped phase duration fits inside its own rep's window, and per stem the twelve marks are strictly
increasing across the three runs (e.g. 2.6B/REP 579467.98 → 581275.63). No stamp can belong to another rep
or run. The report's §2 "all 36 `.stamps` files present and non-empty (74–77 bytes)" and "identical to the
committed manifest on every rep" both hold.

## 8. COVERAGE — flags fire exactly where the rule says; one headline family rests on flagged rows

Independent recomputation of the trigger (`intervals < 3 || coverage < 0.7`) matches the published warning
on **36/36** rows:

```
flagged rows: [('run1','1.2B/PURE','1', 2 intervals, 64.7%), ('run1','1.2B/PURE','2', 2, 64.0%),
               ('run1','1.2B/PURE','3', 2, 63.9%), ('run2','1.2B/PURE','2', 2, 59.6%),
               ('run2','1.2B/PURE','3', 2, 62.5%)]
run3 1.2B/PURE r1/r2/r3: 3 intervals, 73.9/77.3/78.6% coverage, no flag (rule requires <70%)
run2 1.2B/PURE r1: 3 intervals, 85.0% coverage, no flag
```
All REP rows and all 2.6B/PURE rows: 97.5–99.5 % coverage, no flag. Prefill coverage above 100 % occurs on
17 rows by construction (straddle interval charged to prefill), max 110.7 %.

**Headline numbers resting on flagged rows:** the entire 1.2B/PURE column of §5 (6.66 % between-run spread)
and of §7 (CV 10.45 %, MDE 31.7 %), and both §4 1.2B/PURE statements (run1 1.59 %, run2 35.72 %), all rest on
rows whose decode bucket is 2–3 intervals. Nothing else does: the cross-stem ratio is REP-only, the 2.6B
spreads are on 97–99 % coverage, and the v2/v3 isolation is unaffected. This is disclosed in §8 but not
carried into §5 and §7, where the 1.2B/PURE row is printed beside the REP rows as if it were of the same
resolution.

## 9. Section 8 items — two verified, two wrong, one measurable bound the report left open

- **Cadence: verified.** `cadence_median_s = 1.030` and `cadence_max_s ∈ {1.040, 1.050}` for all 12 stem-runs,
  recomputed from the CSVs. The tool's cadence warning threshold is `max > 2 s`, so nothing fires. The old
  campaign's claim is verified too: `device-ngram-spec-out` shows 2.6B/PURE max 3.020 s and 2.6B/REP max 3.520 s
  against 1.06/1.07 s on both 1.2B stems. **The report calls this unexplained; the data excludes the sampler
  revision as the cause.** `scripts/energy-sample.sh` is byte-identical (`md5 091727ab882c490993e819b27eccd86e`)
  at the revision that precedes both campaigns (16:01) and at the analysis revision, and it is unchanged at
  HEAD; the same sampler gave 79 stall intervals >1.5 s in the old 2.6B/REP run and 0 in the v3 run. The old
  stalls are therefore a device-session phenomenon confined to the two 2.6B stems, not a code artefact.
- **Clocks: the sentence is false** (five of thirty-six decode-window means below 2.20 GHz, all single
  boundary samples, two of them in cold run1). Replace "pinned 2.20 GHz mean in EVERY decode window" with
  "median 2.20 GHz in every decode window, with one isolated 725–1200 MHz sample at the mark boundary in
  5/36 windows", and add the power-vs-clock contradiction from §1 above.
- **Prefill coverage >100 %: verified** (17 rows, documented straddle convention).
- **"Run2 1.2B/PURE r1 (85.0% coverage, 4 intervals, no flag, 0.319 J/tok)" — wrong count.** The committed
  `n_decode` for that row is 4 *samples*, i.e. **3** intervals, which is why the low-resolution trigger
  (`< 3`) does not fire while coverage (85.0 %) also stays above 0.70. The number 4 is the sample count.
- **"max 110.7 %, run3 1.2B/REP r2" — wrong stem.** The 110.7 % row is run3 **1.2B/PURE** r2
  (`5.160/4.663`); run3 1.2B/REP r2 is 109.8 % (`8.280/7.541`). The §3 table itself is right.

**Added: what the report missed.**

1. **Cross-session baseline step.** The deep-idle power floor (lowest `|I·V|` over all sampler rows) is
   `old 0.035 W (p5 0.074 W)` against `run1 0.900 W (p5 0.961)`, `run2 0.926 (0.992)`, `run3 0.926 (0.993)`.
   Within v3 the floor is stable to 0.03 W; between the two sessions it steps by ~0.87 W. The v3 campaign's
   `j_per_tok_decode` is 36–40 % above the old campaign's on **all four stems** (e.g. 1.2B/REP 0.293 →
   0.394) while the throughput changed by only +2.5…+8.6 % (decode-window meanV 3.84–3.95 V at 55 % SoC in the old
   campaign against 4.13–4.20 V at 92–73 % SoC here). The level shift is the same order as the baseline step, so the two campaigns'
   absolute levels are not comparable without resolving it, and the cause is not determinable from the
   committed files. Within v3 the offset is constant, so it cancels from every within-v3 comparison the
   report makes, including §6; but the report quotes the committed v2 spreads as its reference, and the S23
   replication now inherits an unstated, unresolved baseline. Its own idle floor must be measured first.
2. **The collapse is a time cost, not an energy-per-token cost.** Run1→run3, the framework's own metric
   moves −0.9 %, −4.6 %, −6.0 % and +6.9 % while the wall time moves +42.7 %, +52.4 %, +52.3 % and +25.9 %
   and the decode power moves −30.9 %, −37.4 %, −38.3 % and −25.9 %. For Fase 2b, whose metric is
   `j_per_tok_decode`, the between-run drift is the 2–7 % of §5; the 31–35 % "collapse" is a throughput
   phenomenon. The commit message's framing ("the Jelly is NOT thermally flat", "a 31-35 % drop") is
   therefore about time, and §2's parenthetical "the thermal story in one glance" labels as mechanism what
   §8 correctly refuses to attribute.
3. **Mark lag is now bounded, not merely "not measured".** In 5/36 reps the last sample of the decode bucket
   already reads idle clock, meaning the load had ended before that sample; the gap from it to the mark is
   0.020–0.090 s, so the teardown lag can reach one full sample interval (≈1.0 s), wider than the doc's
   assumed 0.05–0.5 s. On the three low-resolution PURE reps this closing interval carries ~30 % of the
   bucket (e.g. run2 1.2B/PURE r1: 0.319 J/tok with it, 0.215 without), while the measured current at that
   sample (3.037 W) is indistinguishable from the bucket mean (3.002 W) — the fuel gauge does not respond
   within one interval, so the bucket cannot be trimmed by inspection.
4. **Determinism check the report never states.** The generated text is byte-identical across all nine reps of
   each stem (one distinct hash per stem after removing the perf line), so all throughput and per-token
   comparisons are on an identical token stream with identical counts. This is what makes the 3-decimal
   comparisons meaningful and should be recorded.

## 10. Claim-by-claim disposition

| # | claim | verdict |
|---|---|---|
| 1 | Thermal collapse; settle the mechanism from the clock column | **Partially survives.** Decay confirmed (−20.6…−34.4 % run1→run3). Recorded clock does not fall (median 2.20 GHz 36/36). Collapse **unexplained by the clock column**, and the report's clause "2.20 GHz mean in EVERY decode window" is false (5/36 means below). "Thermal" is a hypothesis, not a result; the power column points to a real frequency reduction the column cannot see. |
| 2 | Never on charge; all 2319 rows Discharging; gate never tripped | **Survives on the data** (2319/2319 Discharging, 15/15 `powered: false`). **The gate clause falls**: the gate is dead code under `ARMS=none` and never executed. |
| 3 | Within-run spreads and the two verdicts on the committed figures | **Survives.** 12/12 spreads and 36/36 j/tok values exact; 10.06 % does not reproduce; 1.2B/PURE fragility does. |
| 4 | Between-run spreads and the MDE table | **Survives numerically** (4/4 spreads, 8/8 MDE under the t convention). **Falls on specification and on pooling**: convention unstated (z version differs by 1.33×); pooled-9 SD understates the sequential MDE ~2.5× for 1.2B/REP and 2.6B/PURE. |
| 5 | 2.20–2.21× reproduces in the cold run, drifts under throttling | **Partially.** Cold-run paired ratios are 2.175/2.179/2.203, two of three ~1 % below the committed band. Drift verified (2.33×, 2.31×). |
| 6 | v2 fallback is a legitimate isolation; J conserved; 10 identical + 2 moved | **Survives**, with two wording corrections: conservation is circular by construction; "bit-identical" is 3-decimal-identical (5 of 10 differ by 0.001 J). The 2 moved reps' commonality is named for the first time. |
| 7 | Stamp integrity | **Survives.** 36/36 present, unique, manifest-consistent, speed-line-consistent, in-window, no cross-run mixing. |
| 8 | Coverage and low-resolution warnings | **Survives.** 36/36 trigger agreement; 5 flagged rows exactly as published; flag fires where the rule says. Headline numbers on flagged rows identified. |

**Could not test.** (a) The process claims in §1 that no split ran before run3 finished and that the tree was
clean at analysis time — both are statements about the agent's actions, not about the committed bytes; what I
can confirm is that the committed tool (`md5 59234fbf…`) does regenerate all 16 sidecars byte-identically, so
revision `708499f` (`md5 ed1a7dca…`) played no part in the published numbers. (b) The 4-line diff claim:
verified (`git diff --stat 708499f f2f9ea1` shows 3 insertions/1 deletion in the splitter plus docs). (c) Any
device state not in the committed files, including why the power baseline stepped between sessions and
whether anything else touched the phone — `/tmp/kalsa-v3` matching the commit byte-for-byte is the strongest
provenance available and it holds. (d) The Galaxy S23: untouched, unverified, as ordered.

## Flip list — exact corrections required

| where | published | verified | correction |
|---|---|---|---|
| §2 charging evidence | "mid-campaign gate never tripped" | gate unreachable with `ARMS="none"` (device-ngram-spec.sh:262-271) | replace with "the mid-campaign gate did not execute (`ARMS=none` short-circuits before it); charging is excluded by 2319/2319 Discharging rows and 15/15 `powered: false` lines" |
| §3 warnings | "Every row carries a manifest tps-mismatch note" | 35/36; run2 1.2B/PURE r3 has none (manifest r3 = 9.1 equals its speed line 9.1) | "35 of 36 rows; the exception is run2 1.2B/PURE r3" |
| §8 clocks | "pinned 2.20 GHz mean in EVERY decode window of runs 1–3" | 31/36 means = 2200; 5/36 means 1831.25–2179.59; 36/36 medians = 2200 | "median 2.20 GHz in 36/36, with a single 725–1200 MHz sample at the mark boundary in 5/36 (two of them in cold run1)" |
| §8 clocks, mechanism | clocks "do not account for the decay; mechanism unexplained" | power falls −30.9/−37.4/−38.3 % with throughput −29.9/−34.4/−34.4 % at constant reported clock | add: "a constant reported clock with a 30–38 % power drop is not a valid clock reading; the frequency almost certainly fell and the column cannot see it" |
| §8 run2 1.2B/PURE r1 | "85.0 % coverage, 4 intervals" | `n_decode = 4` samples, 3 intervals | "3 intervals (4 samples)" |
| §8 max prefill coverage | "max 110.7 %, run3 1.2B/REP r2" | 110.7 % is run3 1.2B/PURE r2; run3 1.2B/REP r2 = 109.8 % | retarget the row |
| §6 | "On 10/12 reps the decode bucket is bit-identical" | interval set identical on 10/12; `j_decode` differs by ±0.001 J on 5 of the 10 | "identical to the published 3-decimal resolution (≤0.001 J) on 10/12" |
| §6 | "Whole-window J is conserved exactly" | true, but both paths define a bucket as the residual | "conserved by construction (one bucket is the residual); I re-integrated the whole window independently, agreeing to ≤0.002 J" |
| §5 ratio | "the committed 2.20–2.21x finding reproduces in the cold run" | paired ratios 2.175 / 2.179 / 2.203; decode-J-sum 2.187 vs committed 2.207 | "reproduces to within ~1 %: 2.18–2.20, straddling the lower edge of the committed 2.20–2.21 band" |
| §7 MDE | "two-sample, two-sided alpha 0.05, power 0.8" | figures need `t_{0.975,2n−2}` and `t_{0.80,2n−2}` (df = 2n−2) | state the convention; z version gives 23.9 / 7.6 / 5.5 / 6.4 % at n=3 |
| §7 pooling | pooled 9-rep SD presented as the sequential-design error | nested run effect: 1.2B/REP MDE 25.4 % (not 10.1 %), 2.6B/PURE 18.5 % (not 7.3 %) at n=3 | add the nested column and the +6.9/−6.0/−4.6/−0.9 % run-order artefact; note n=5 does not fix it |
| §9 item 1 | "Did NOT copy evidence into …/device-v3-out/run{1,2,3}" | the commit ships it, byte-identical to `/tmp/kalsa-v3/…` (41/41, 41/41, 41/41 files; report byte-identical) | replace with "the committed copy is byte-identical to the campaign working copy; verified with cmp" |
| new § | — (absent) | idle floor 0.035 W (old) vs 0.900/0.926/0.926 W (v3); v3 j/tok 36–40 % above the old campaign on all four stems | add a cross-session baseline section: absolute levels are not comparable between sessions; each new session must measure its own idle floor |
| new § | — (absent) | run1→run3 time +25.9…+52.4 %, power −25.9…−38.3 %, `j_per_tok_decode` −6.0…+6.9 % | add: the collapse is a throughput/time effect, not an energy-per-token effect; the commit message's "31-35 % drop" is a t/s statement |
| §9 item 2 | mark lag "not measured per rep … 0.05–0.5 s plausible" | 5/36 reps end the decode bucket with an idle-clock sample, 0.020–0.090 s before the mark | bound it: the lag can reach one full sample interval (~1.0 s); on low-resolution PURE reps that interval is ~30 % of the bucket |

Every other published figure — the 288 §3 table cells, the 12 §4 spreads, the 4 §5 spreads, the 8 §7 MDE
figures, the §5 ratios under throttling, the §6 v2/v3 deltas and decode-duration comparisons, the §2
checkpoint table, the 74–77 byte stamp sizes, the "all 36 speed lines" count, and the tool-revision md5
claims (`ed1a7dca` at `708499f`, `59234fbf` here, harness `7d08810a`) — is correct and was reproduced
independently.

Reproduction: `/tmp/kalsa-audit-v3/analyze.py`, `analyze2.py`, `analyze3.py`, `analyze4.py`, `mechanism.txt`,
`parsed.json`, and the regenerated sidecars under `/tmp/kalsa-audit-v3/repro/`.

**Verdict: NO-SHIP** (narrow, claim-level: the thirteen corrections above; no published number changes).
Once those land, the dataset is the reference and the S23 replication may be measured against it.
