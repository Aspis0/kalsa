# Per-phase energy split audit — round 4 (narrow flip-to-SHIP check) — `cc612ef` (branch `energy-framework`)

Commit under audit: `cc612ef fix(energy): publish decode coverage (audit R1-R6)` — 4 files,
+238/−78 (`docs/ENERGY-SCHEMA.md`, `scripts/energyPhaseSplit.mjs`,
`scripts/energyPhaseSplitHarness.mjs`, `scripts/fixtures/energy-counts/README.md`).
Predecessor: round-3 report `ENERGY-PHASE-AUDIT-R3-2026-09-15.md` (NO-SHIP, narrow), whose
flip-list was "items 1-4 plus one column".
Worktree: `/Users/marco/Projects/kalsa-ngram-spec` · Date: 2026-09-15.
Mode: read-only verification of the single commit `cc612ef`; every command ran from this
worktree, all scratch under `/tmp/kalsa-audit-r4/`; no repo file was modified except this report;
no commit, no push, no adb; `/Users/marco/Projects/kalsa` untouched.
Scope: new defects and residuals of the R1-R6 classes only. Round-3 items CONFIRMED there (base
partition math, marks/clock semantics, token-count provenance, guards, cadence, CI wiring) are
taken as given and re-checked only where this commit touched them. Item 1 nevertheless
re-integrates all 12 reps from raw bytes with an independent parser and integrator (no repo module
imported), so the decode-side arithmetic is re-derived from scratch, not inherited.

## Verdict

**SHIP (with non-blocking notes).** The declared flip-to-SHIP was "4 text fixes + one column";
the commit delivers all six items and every regression is green. `decode_s_int` is published in
the tool, the header and the four sidecars (byte-identical to a fresh run of the committed code),
coverage is defined in the doc, the low-resolution warning fires exactly on the two rows it was
promised for, the R3 "rejected" claim is replaced by a fixture that reproduces exit 0 + warning +
−41 %, `w_decode` is defined exactly, the REP-vs-REP-only rule is where the per-token numbers are
described, and the fixture hunk now anchors at the pristine source line.

One residual of the R1 class remains (**N1**): the doc's "exact interval set" sentence names the
straddle interval as part of the decode bucket while the code and the same paragraph's bullets put
it in `j_pre`. It is a wording defect, not a data defect: the correct truncations are stated two
lines below it, repeated in the `w_decode` paragraph, and quantified per row by `decode_s_int`
(+ the low-res warning), so `j_decode` is no longer the invisible bias it was in round 3. I measured
the sentence's numeric consequence per row (one straddle interval, 1.6–58.5 % of `j_decode`). Notes
N2–N6 are metadata/claim-precision nits. None blocks publication.

| # | round-3 item | status |
|---|---|---|
| R1 | `j_decode` described as `[decode_start, mark_N)` but integrated over the grid only; bias invisible | DELIVERED — column + coverage + warning; one wording residual (N1) |
| R2 | 1.2B same-stem arm delta convention-dependent, no warning | DELIVERED — warning fires on exactly the two declared rows |
| R3 | "8.9× scenario is rejected" claim | DELIVERED — text corrected; fixture reproduces exit 0 + warning + −41 % |
| R4 | `w_decode` sample set undocumented | DELIVERED — doc/code coherent, verified numerically 12/12 |
| R5 | cross-stem "2.1-2.3×" claim (forbidden use) | DELIVERED — rule in doc + footer; claim gone from tracked files |
| R6 | fixture hunk offset | DELIVERED — anchor line 376 correct; line-count nit N2 |

## 1. R1 — `decode_s_int`, coverage, and the exact interval set

**Tool.** `PHASES_COLUMNS` (`scripts/energyPhaseSplit.mjs:88-92`) carries `decode_s_int`
immediately after `decode_s`; the cell is written as `fmt(decInt.duration_s)` (`:386`) and is empty
when the decode segment has no samples. The segment is `win.slice(b)` with `B = end − decodeDur`
and `b` = index of the first sample at/after `B` (`:377-382`), so the bucket is the intervals
`[win[i], win[i+1])` for `i >= b`.

**Golden header.** `scripts/energyPhaseSplitHarness.mjs:314` asserts
`lines[0] === PHASES_COLUMNS.join(",")`, and that constant now contains `decode_s_int`; the check
passes (72/0). The four sidecars carry the same 19-column header, `decode_s_int` in field 7.

**Sidecars.** All four files in the gitignored `device-ngram-spec-out/` are the committed code's
output: a fresh run on a copy with `--counts-manifest scripts/fixtures/energy-counts/manifest.csv`
reproduces them **byte-identically** (`diff -q`, 4/4 clean), so nothing is stale.

**Independent re-integration.** Own CSV/marks/speed-line parsers, own right-Riemann integrator,
counts from the tracked manifest. `j_pre`, `j_decode` and `decode_s_int` match the sidecars on
12/12 rows within 5e-4 (the CSV's 3-decimal formatting). The last column is the energy of the
straddle interval `[t_{b-1}, t_b)` — the interval the doc's headline sentence would put in decode
and the code puts in `j_pre`; it is the size of the N1 wording risk, not of a data error.

| stem | rep | `decode_s` (s) | `decode_s_int` (s) | coverage | decode intervals | `j_pre`/`j_decode` (mine = sidecar) | low-res warning | straddle in decode? (N1 delta, J) |
|---|---|---|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 3.297 | 2.070 | 62.8 % | 2 | 16.093 / 5.521 | yes | 2.801 (50.7 % of `j_decode`) |
| 1.2B/PURE | 2 | 3.333 | 2.070 | 62.1 % | 2 | 17.886 / 5.497 | yes | 3.215 (58.5 %) |
| 1.2B/PURE | 3 | 3.297 | 3.110 | 94.3 % | 3 | 15.743 / 7.253 | no | 2.523 (34.8 %) |
| 1.2B/REP | 1 | 30.476 | 28.990 | 95.1 % | 28 | 19.119 / 75.001 | no | 2.777 (3.7 %) |
| 1.2B/REP | 2 | 30.476 | 28.970 | 95.1 % | 28 | 19.944 / 74.992 | no | 2.719 (3.6 %) |
| 1.2B/REP | 3 | 30.476 | 28.980 | 95.1 % | 28 | 20.364 / 75.525 | no | 2.747 (3.6 %) |
| 2.6B/PURE | 1 | 52.308 | 50.710 | 96.9 % | 49 | 41.775 / 137.032 | no | 2.789 (2.0 %) |
| 2.6B/PURE | 2 | 52.308 | 50.690 | 96.9 % | 48 | 38.098 / 128.370 | no | 2.800 (2.2 %) |
| 2.6B/PURE | 3 | 52.308 | 50.600 | 96.7 % | 48 | 29.087 / 124.034 | no | 2.746 (2.2 %) |
| 2.6B/REP | 1 | 71.111 | 70.210 | 98.7 % | 67 | 31.914 / 165.389 | no | 2.583 (1.6 %) |
| 2.6B/REP | 2 | 71.111 | 70.440 | 99.1 % | 67 | 25.717 / 165.148 | no | 2.583 (1.6 %) |
| 2.6B/REP | 3 | 71.111 | 69.690 | 98.0 % | 66 | 31.945 / 167.138 | no | 2.611 (1.6 %) |

Partition: the raw (unrounded) `j_pre + j_decode − whole-window J` is 0.0 J on 11 reps and
+2.84e-14 J on 2.6B/REP r2 — the declared machine-precision bound holds 12/12. At printed
3-decimal precision the two cells can differ from the unrounded window J by up to 5.65e-4 J
(`fmt` rounding on each cell); that is formatting, not a partition failure. `w_decode` recomputed
as the mean over `win[b..]` matches the sidecar on 12/12 (see §4).

**Doc vs code, line by line — where they agree.** The bullets at `docs/ENERGY-SCHEMA.md:102-106`
(straddle interval → `j_pre` IN FULL; partial interval before `mark_N` → no bucket), the
lower-bound paragraph `:108-110`, the `w_decode` paragraph `:163-169`, the Edge-uncertainty
paragraph `:176-179` and the column rows `:189`/`:192` all describe exactly what the code does.
The implemented set is: **intervals fully inside `[decode_start, mark_N)`**, equivalently the
intervals whose *left* endpoint is at/after `decode_start`, equivalently the intervals whose
right-endpoint sample comes strictly after the first sample at/after `decode_start`.

**Where they do not (N1).** The headline sentence `:98-100` ("the sample intervals whose
RIGHT-ENDPOINT sample is at/after `decode_start` — nothing else"), its repeat in the Integration
section `:158-159`, the `decode_s_int` parenthetical `:189`, the `j_decode` row's first clause
`:192`, and the tool's own header comment `scripts/energyPhaseSplit.mjs:41-43` would each include
the straddle interval `[t_{b-1}, t_b)`, whose right-endpoint sample `t_b` *is* at/after
`decode_start`; the code excludes it (and the bullet three lines below says so). So the doc
contradicts itself by one interval, in the one direction that matters. I measured the consequence
of reading the headline literally: `j_decode` would be overstated by the last column of the table
above on **every** row (2.5–3.2 J; 34.8–58.5 % of `j_decode` on the two low-resolution PURE rows,
1.6–3.7 % elsewhere). The mitigations are real: the bullet immediately below names the exclusion,
the R4 paragraph repeats it, the row exposes `decode_s_int` and coverage, the warning fires on the
rows where the stakes are highest, and the imprecise phrasing is the one round 3 itself proposed
("right-endpoint samples at or after `decode_start`"). I record it as N1, not as a blocker: the
published numbers are the code's, and the code's rule is stated in the same paragraph.

## 2. R2 — low-resolution warning

The condition (`scripts/energyPhaseSplit.mjs:409-417`) is
`decInt !== null && (decIntervals < 3 || decodeSInt < 0.7 * decodeDur)`, i.e. the union of the two
documented triggers (`docs/ENERGY-SCHEMA.md:113-114`, `:151-152`); both comparisons are strict,
matching "fewer than 3 intervals" and "coverage < 0.7". The trigger set, from the sidecars and
confirmed independently by my recomputation:

| stem | rep | decode intervals | `decode_s_int / decode_s` | coverage | warning fired |
|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 2 | 2.070 / 3.297 | 62.8 % → 63 % | **yes** |
| 1.2B/PURE | 2 | 2 | 2.070 / 3.333 | 62.1 % → 62 % | **yes** |
| 1.2B/PURE | 3 | 3 | 3.110 / 3.297 | 94.3 % | no |
| 1.2B/REP | 1–3 | 28 | 28.97–28.99 / 30.476 | 95.1 % | no |
| 2.6B/PURE | 1–3 | 48–49 | 50.60–50.71 / 52.308 | 96.7–96.9 % | no |
| 2.6B/REP | 1–3 | 66–67 | 69.69–70.44 / 71.111 | 98.0–99.1 % | no |

So the declared behaviour is exact: fires on 1.2B/PURE r1/r2 (2 intervals, 62–63 %), silent on r3
(94 %, 3 intervals — the `< 3` bound is strict) and on all six REP rows (95–99 %). The 2.6B rows
carry only the cadence warning, as before.

Warning text: comma-free (0 comma characters) and placed in the last (19th) CSV column; the two
rows that carry it parse correctly with a naive comma split (as do the remaining 1.2B/PURE rows).
Inline numbers are correct:
2.070/3.297 → `coverage 2.07/3.30 s = 63%`, 2.070/3.333 → `2.07/3.33 s = 62%` (the percentage is
computed from unrounded values and agrees with the displayed rounded fraction). One general claim
in the harness about comma-freedom is overstated (N3). The coverage-only half of the OR is not
exercised by any harness fixture (N4); I exercised it with a synthetic stem (3 decode intervals,
`decode_s_int` 3.000 s of a 4.500 s nominal = 67 %) — the warning fires, exit 0.

## 3. R3 — "rejected" claim and the damped/flagged fixture

- **No residual "rejected" claim.** The tracked energy files contain only the corrected wording:
  `scripts/energyPhaseSplitHarness.mjs:21-24` ("is NOT rejected: the error is damped to ~-40% and
  flagged by the decode-bucket low-resolution warning — exit 0 … only the MIRROR direction …
  exits 1"), `:452-455`, `:468-469` and the check name `:480`. `git grep "rejected instead"`
  over tracked files: 0 hits. The tool footer and the docs state the same (damped, flagged,
  MIRROR-only rejection).
- **§10b fixture, reproduced independently** with the same geometry (40 s of 1 W samples, marks
  at 50.00, 8.4 t/s speed line): `--gen-tokens 30` → exit 0, `decode_s` 3.571, `decode_s_int`
  2.000 (2 intervals, 56 %), `j_decode` 2.000, `j_per_tok_decode` **0.067**, low-resolution
  warning in the row. The tracked manifest (256 tok) → `decode_s` 30.476, `decode_s_int` 29.000,
  `j_per_tok_decode` **0.113**, no low-resolution warning. Damping = (0.0667 − 0.1133) / 0.1133 =
  **−41.1 %** → the declared "−41 %" and "0.067 vs 0.113" are correct to the digit.
- **Real campaign direction** (PURE counts on 1.2B/REP, the round-3 8.9× scenario): still exit 0,
  now **flagged on all three reps** — 0.176/0.173/0.176 against 0.293/0.293/0.295
  (−40.0/−40.9/−40.5 %), `decode_s_int` 2.07/2.05/2.06 s of 3.571 (58/57/58 %). Round 3's
  complaint (no warning on those rows) is fixed. The harness's "the auditor's damped error" refers
  to the direction and magnitude, which match; the fixture's absolute cells are its own synthetic
  1 W strain, not the campaign's 0.176/0.293, and no repo text claims otherwise.

## 4. R4 — `w_decode`

Doc (`docs/ENERGY-SCHEMA.md:163-169`, column row `:196`): the mean `|V*I|` over the decode
segment's **own samples, INCLUDING the boundary sample** (the first sample at/after
`decode_start`), whose interval energy is charged to `j_pre`; hence `w_decode ≠ j_decode /
decode_s` by construction. Code: `decSeg = win.slice(b)`, `w_decode = decInt.mean_w` over exactly
those samples (`:396`, `energySchema.mjs:48-67`), including `win[b]` whose interval is not in
`j_decode`. Doc and code agree verbatim; my recomputation of the segment mean matches the sidecar
on all 12 rows (e.g. 1.2B/PURE r1: 2.667 W, versus `j_decode / decode_s` = 5.521/3.297 = 1.675 W,
i.e. 59 % apart — the doc's "up to 59 % apart on a 3-sample bucket" is the observed maximum).

## 5. R5 — cross-stem rule

The arm-anchored rule is present where the per-token column is described:
`docs/ENERGY-SCHEMA.md:128-136` ("Cross-stem ratios … are the forbidden absolute use: they hold
only between REP arms of the same prompt style — REP-vs-REP only"), reinforced in the column row
`:193` and in the tool's stdout footer (`scripts/energyPhaseSplit.mjs:579-582`). The residual
claim from round 3 is gone: `git grep` over tracked files for `2.1-2.3`, `2.1–2.3` and
`per decode token` = 0 hits. No unqualified cross-stem figure remains.

## 6. R6 — fixture hunk anchor

`grep -n 'chunk.contains("timings")' tmp/kalsallama-pin/tools/cli/cli-context.cpp` → **376**, and
line 356 is `timings_per_token` (both quoted by the README). The reference hunk in
`scripts/fixtures/energy-counts/README.md:51` now starts at old line 376 with that line as its
first context line, i.e. the anchor is coherent with the pristine source (round 3: `@@ -373`).
N2: the header's counts (`-376,6 +376,12`) do not match the published body (4 leading + 1
trailing context lines, 6 additions = 5 old / 11 new); a reconstruction block, cosmetic only.

## 7. Regressions

| check | result |
|---|---|
| `node scripts/energySchemaHarness.mjs` | 77 passed / 0 failed, exit 0 |
| `node scripts/energyPhaseSplitHarness.mjs` | 72 passed / 0 failed, exit 0 (round 3: 69/0, +3) |
| `node scripts/matrixParityHarness.mjs` | 15 passed / 0 failed, exit 0 |
| `energyAggregate.mjs` stdout on `device-ngram-spec-out-ngram-2026-09` | md5 `f8ffe9cf0c9b8aa515ea6983356cbcf5` = round-3 baseline; empty stderr |
| partition, raw values, 12 rows | 0.0 J ×11, +2.84e-14 J ×1 (≤ declared) |
| sidecar regeneration with the tracked manifest | 4/4 byte-identical (`diff -q`) |
| `git show --stat cc612ef` | exactly the 4 declared-scope files; nothing else |
| Italian sweep (diff + the 4 changed files) | 0 hits (only English "non-…" forms and the fixture stem `solo`) |
| aggregator exposure to the new column | none — it skips `*.phases.csv` (`energyAggregate.mjs:47`), table unchanged |

Worktree state after the audit: only the pre-existing untracked files plus this report; the four
`*.phases.csv` sidecars were read, and the regeneration/scratch runs wrote into `/tmp` copies only.

## 8. Non-blocking notes

| # | severity | finding |
|---|---|---|
| N1 | LOW (residual R1 class) | `docs/ENERGY-SCHEMA.md:98-100`, `:158-159`, `:189`, `:192` and `scripts/energyPhaseSplit.mjs:41-43` define the bucket as "right-endpoint sample at/after `decode_start` — nothing else", which would include the straddle interval; the code and the same paragraph's bullet `:102-104` exclude it. Suggested wording: "intervals fully inside `[decode_start, mark_N)` (the right-endpoint samples strictly after the first sample at/after `decode_start`)". Numeric consequence if read literally: +2.5–3.2 J on every rep (up to +58.5 % of `j_decode`). |
| N2 | LOW (residual R6 class) | `scripts/fixtures/energy-counts/README.md:51`: hunk header counts `-376,6 +376,12` vs a body of 5 context + 6 added lines (5/11). Start line is now correct. |
| N3 | NIT (claim precision) | `scripts/energyPhaseSplitHarness.mjs:77-78`: "comma-free like every row warning" is not true — the pre-existing "decode duration not derivable (needs … / perf line, and a speed line)" row warning contains a comma (properly quoted by `esc`, `energyPhaseSplit.mjs:210`). The new low-res text itself is comma-free, as required. |
| N4 | NIT | `scripts/energyPhaseSplitHarness.mjs:27`: "low-resolution warning fixtures for both triggers" — all low-res fixtures exercise the `< 3 intervals` branch (2 or 0 intervals); no fixture has ≥ 3 intervals with coverage < 0.7. I verified that branch by hand (3 intervals, 3.000/4.500 s = 67 % → warning fires). |
| N5 | NIT | `scripts/energySchemaHarness.mjs:439-446`: the "what energyPhaseSplit.mjs leaves next to it" fixture still writes a v2 header without `decode_s_int`. Test-only, passes; worth refreshing so the fixture stays representative. |
| N6 | NIT (wording) | The warning tail (`energyPhaseSplit.mjs:415` and the sidecar field) says "between-arm deltas of the same stem remain the sanctioned use" without the doc's caveat "only when their decode buckets have similar coverage" (`docs/ENERGY-SCHEMA.md:116-119`) — and it fires precisely on rows whose coverage differs most from the sibling arm (63 % vs 95 % on 1.2B). A parenthetical pointing at the sibling arm's `decode_s_int` would make the warning self-contained. |

## 9. Free judgement: is the published artifact defensible?

The three key declarations are all visible in the product, not only in the report:

- **(a) decode = lower bound, biased low** — doc `:108-110` ("never HIGH, short by at most two
  sample intervals"), `:176-179`, column rows `:192`/`:193`, tool footer `:573-576`; in the data
  files as the `decode_s_int` vs `decode_s` pair, with text in-band whenever the bucket is
  low-resolution. A reader who only opens the CSVs sees the gap but no prose; the schema doc is the
  contract, which is the same arrangement the campaign already relies on.
- **(b) PURE low-resolution flagged** — the two 1.2B/PURE rows carry the warning in the sidecar;
  2.6B/PURE is not flagged because its coverage is 97 %, and the cross-stem rule covers that case.
- **(c) cross-stem only REP-vs-REP** — doc `:128-136`, column row `:193`, tool footer
  `:579-582`; not embedded in the CSVs (data files carry no rule text). Together the three
  declarations close the round-3 gap: a reader can now see *that* `j_decode` is truncated, *by how
  much* per row, *when* the per-token figure must not be compared at all, and *which* comparisons
  are sanctioned. With N1 fixed the artifact is quotable outside the repo without a footnote; as
  it stands it is defensible with the caveat that one definition sentence is corrected two lines
  later.

## Minimal post-flip cleanup (optional, none blocking)

1. N1 — reword the four doc sentences + the tool comment to "intervals fully inside
   `[decode_start, mark_N)`".
2. N2 — fix the hunk counts to `-376,5 +376,11`.
3. N4 — add a coverage-only low-resolution fixture (≥ 3 intervals, coverage < 0.7).
4. N3/N5/N6 — one-line comment/fixture/warning-tail touch-ups.

## Commands executed (read-only; scratch under `/tmp/kalsa-audit-r4/`)

```
git status --short ; git branch --show-current ; git log --oneline -8
git show --stat cc612ef ; git show cc612ef > /tmp/cc612ef.diff
git grep -n -i "reject" -- . ':!tmp' ; git grep -n "8\.9x" -- . ':!tmp'
git grep -n "2\.1-2\.3\|per decode token\|j_per_tok" -- docs scripts
grep -n 'chunk.contains("timings")\|timings_per_token' tmp/kalsallama-pin/tools/cli/cli-context.cpp
python3 /tmp/kalsa-audit-r4/reintegrate.py        # own parser/integrator, 12/12 cells + coverage + w_decode
node scripts/energySchemaHarness.mjs ; node scripts/energyPhaseSplitHarness.mjs ; node scripts/matrixParityHarness.mjs
node scripts/energyAggregate.mjs device-ngram-spec-out-ngram-2026-09 | md5
node scripts/energyPhaseSplit.mjs <copy> --counts-manifest scripts/fixtures/energy-counts/manifest.csv  # 4/4 byte-identical
node scripts/energyPhaseSplit.mjs <scratch> wc --prompt-tokens 51 --gen-tokens 30   # R3 fixture, exit 0 + warning
node scripts/energyPhaseSplit.mjs <scratch> wc --counts-manifest <scratch>/manifest.csv
node scripts/energyPhaseSplit.mjs <copy> LFM2.5-1.2B-Instruct-Q4_K_M_none_REP --prompt-tokens 51 --gen-tokens 30
node scripts/energyPhaseSplit.mjs <scratch> cov --prompt-tokens 8 --gen-tokens 9   # coverage-only trigger
python3 -c "csv row counts / comma check on the 4 sidecars"
```

## Final verdict

**SHIP.** `cc612ef` is a genuine narrow flip: the decode coverage is published in the tool, the
header and the four sidecars; the warning set, the damping figures and the `w_decode` definition
verify exactly; the regressions are clean (77/0, 72/0, 15/0, aggregate md5 unchanged, 4/4
sidecars byte-identical, 4 declared files only, no Italian). The one residual defect of the
original class (N1, the interval-set sentence) is a wording fault that the same paragraph and the
new per-row column correct in place, and it does not make any published number wrong. Fix N1 and
N2 on the next touch; nothing here blocks publication.
