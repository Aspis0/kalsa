# Per-phase energy split audit — round 3 (delta) — `95cf975` + `e50772f` (branch `energy-framework`)

Commits: `95cf975 fix(energy): anchor decode phase to rep end; counts manifest, guards, cadence
honesty (audit F1-F8)` and `e50772f ci(energy): wire energy harnesses into bench/apk workflows
(audit F9)`.
Predecessor: round-2 report `ENERGY-PHASE-AUDIT-2026-09-15.md` (NO-SHIP) on `572d3be` + `f936c16`.
Worktree: `/Users/marco/Projects/kalsa-ngram-spec` · Date: 2026-09-15.
Mode: read-only adversarial **delta** review (no repo file modified except this report; no commit, no
push, no adb; `/Users/marco/Projects/kalsa` untouched). Scratch code and copies under
`/tmp/kalsa-audit-r3/`. Round-2 items that were CONFIRMED there (base partition math, marks/clock
semantics, token-count semantics against the vendored source, aggregate glob fix) are taken as given
and not re-derived; item 1 nevertheless re-integrates every rep from raw bytes with an independent
parser, so the core arithmetic is re-verified from scratch, not inherited.

## Verdict

**NO-SHIP (narrow).** The round-2 core defect is genuinely fixed: nothing computes a boundary from
`window_start + prompt_eval` any more, the two phases are named for what they contain, `j_pre` is
declared to hold load + idle + prompt eval, and the counts/guards/cadence/CI items all verify
(180/180 cells, residual ≤ 2.8e-14 J, provenance tracked and reproducible, both harnesses green, CI
wired). What keeps this at NO-SHIP is a smaller instance of the *same class* of defect the round 2
rejected: the schema still describes `j_decode` as the energy of `[decode_start, mark_N)`
(`docs/ENERGY-SCHEMA.md:148`), while the integration covers the sample grid only — the straddle
interval is charged to `j_pre` and the last partial interval before the mark is charged to nothing —
and the v2 row no longer carries the decode segment's integrated duration, so the resulting
under-count is not visible from the row. On the 1.2B/PURE arms that under-count reaches −40 % of the
published `j_per_tok_decode` (published 0.183 vs 0.308 J/tok over the nominal decode window) and it
flips the schema's own sanctioned use (same-stem arm delta) for the 1.2B pair from 1.6× to 1.0×, with
no warning (cadence 1.06 s, below the 2 s threshold). Two claims in the fix are also inaccurate: the
round-2 8.9× wrong-counts scenario is *damped*, not rejected, and the cross-stem "2.1-2.3× per decode
token" statement is the use the doc forbids and is arm-dependent.

| # | Severity | Subject | Verdict |
|---|---|---|---|
| R1 | MEDIUM | `j_decode` documented as `[decode_start, mark_N)` but integrated over the sample grid only (tail interval always dropped, straddle→`j_pre`); decode-side integrated duration dropped from the v2 row, so the bias is invisible | CONFIRMED |
| R2 | MEDIUM | on the 1.2B pair the sanctioned same-stem arm delta of `j_per_tok_decode` is convention-dependent (REP/PURE 1.60× vs 1.00× at r2) and fires no warning; the published 1.2B/PURE per-token figure is sampling-granularity dominated (3 samples for 3.3 s) | CONFIRMED |
| R3 | LOW-MEDIUM | commit message and harness comment claim the round-2 8.9× wrong-stem-counts scenario "is now rejected": that direction still exits 0 (error damped from +789 % to −40 %); only the mirror direction exits 1 | REFUTED |
| R4 | LOW | `w_decode` averages the decode segment's samples including the boundary sample `b`, whose interval energy is in `j_pre`; `w_decode ≠ j_decode / decode_s` by construction (59 % apart on 1.2B/PURE r1) and the row does not say so | CONFIRMED |
| R5 | LOW | the fix's cross-stem claim ("2.6B = 2.1-2.3× per decode token vs 1.2B") is the absolute-J/token use `docs/ENERGY-SCHEMA.md:16` forbids; it holds for the REP arm (2.13-2.21×) and reads 3.13× from the PURE rows | CONFIRMED |
| R6 | LOW | fixture README's reference patch is offset ~4 lines from the pristine source (`@@ -373` vs the hunk at `:377`); the raw scratch bytes remain unrecoverable, which the README states | CONFIRMED |

Audit items, one by one:

| Item | Subject | Verdict |
|---|---|---|
| 1a | boundary no longer `window_start + prompt_eval` | CONFIRMED (fixed) |
| 1b | independent re-integration, 4 stems × 3 reps, manifest-counts, declared J/tok bands | CONFIRMED (180/180 cells, bands exact) |
| 1c | one rep verified by hand (power series × dt) | CONFIRMED |
| 2 | schema v2 declares `j_pre` holds load and prompt-eval-only J is unresolvable; honesty of the cross-stem claim | PARTIAL (new declarations correct; cross-stem claim → R5) |
| 3 | manifest + 4 raw outputs + README tracked; `--counts-manifest` preferred; flags warn; tps-mismatch warning | CONFIRMED |
| 4 | guards (`decode_s ≥ window` → exit 1, `gen_tokens ≤ 0` → exit 1, band warning); the round-2 8.9× scenario and the "damps to −40 %" claim | PARTIAL (mechanism CONFIRMED; "rejected" for the 8.9× direction → R3; −40 % damping CONFIRMED) |
| 5 | `cadence_median_s`/`cadence_max_s` per row, >2 s warning, docs without the false "≤ 1 s" | CONFIRMED |
| 6 | out-of-order/equal/pre-CSV marks fatal with no file; no "verbose llama-cli" count-source suggestion | CONFIRMED |
| 7 | `e50772f`: harnesses invoked in `bench.yml`/`apk.yml`, valid syntax, `matrixParityHarness` untouched and passing | CONFIRMED |
| 8 | aggregate regression, harness counts, declared-files-only, no Italian, binaries intact | CONFIRMED |
| 9 | residual v2 defect not anticipated in round 2 | FOUND (R1/R2, quantified below) |

## 1. The re-anchor (ex-F1) — FIXED

### 1a. Source reading

`scripts/energyPhaseSplit.mjs` computes the boundary as `B = end - decodeDur` (`:361`) with
`decodeDur = perf.evalMs / 1000` when a `llama_perf_context_print` eval line exists, else
`genTokens / speed.genTps` from the rep's own speed line (`:291-295`). `B` is compared against the
window samples as `b = first index with t >= B` (`:362-363`); `j_pre` integrates `win[0..b]` (`:364`)
and `j_decode = whole - j_pre` (`:367`, `:378`). `promptEvalMs` and `promptTokens` reach only
`prefill_est_s` (`:370-377`) and the count columns — no path from prompt-eval duration to the
boundary. The v1 expression `window_start + prompt_eval` survives nowhere but the history comments
(`:5`, `docs/ENERGY-SCHEMA.md:64`). Item 1a **CONFIRMED**.

### 1b. Independent re-integration

Own parser, own marks/speed-line parsers, own right-Riemann integrator
(`/tmp/kalsa-audit-r3/reintegrate.mjs`, `/tmp/kalsa-audit-r3/compare.mjs`), counts from the tracked
manifest, no repo module imported.

| stem | rep | `j_pre` (J) | `j_decode` (J) | `J_window` (J) | J/decode-tok | declared band | in band |
|---|---|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 16.093 | 5.521 | 21.614 | 0.184 | 0.183-0.242 | yes |
| 1.2B/PURE | 2 | 17.886 | 5.497 | 23.383 | 0.183 | | yes |
| 1.2B/PURE | 3 | 15.743 | 7.253 | 22.996 | 0.242 | | yes |
| 1.2B/REP | 1 | 19.119 | 75.001 | 94.120 | 0.293 | 0.293-0.295 | yes |
| 1.2B/REP | 2 | 19.944 | 74.992 | 94.936 | 0.293 | | yes |
| 1.2B/REP | 3 | 20.364 | 75.525 | 95.889 | 0.295 | | yes |
| 2.6B/PURE | 1 | 41.775 | 137.032 | 178.807 | 0.672 | 0.608-0.672 | yes |
| 2.6B/PURE | 2 | 38.098 | 128.370 | 166.468 | 0.629 | | yes |
| 2.6B/PURE | 3 | 29.087 | 124.034 | 153.121 | 0.608 | | yes |
| 2.6B/REP | 1 | 31.914 | 165.389 | 197.303 | 0.646 | 0.645-0.653 | yes |
| 2.6B/REP | 2 | 25.717 | 165.148 | 190.864 | 0.645 | | yes |
| 2.6B/REP | 3 | 31.945 | 167.138 | 199.083 | 0.653 | | yes |

- Cell-by-cell against the shipped `device-ngram-spec-out/*.phases.csv`: **180/180 cells match**
  (15 numeric/identity columns × 12 rows; `window_start_s`, `window_end_s`, `duration`, `decode_s`,
  `prefill_est_s`, `j_pre`, `j_decode`, `j_per_tok_decode`, `prompt_tokens`, `gen_tokens`,
  `w_decode`, `n_pre`, `n_decode`, `cadence_median_s`, `cadence_max_s`).
- Partition invariant: `j_pre + j_decode − J_window` is 0.0 J for 11 reps and 2.84e-14 J for the
  twelfth (float64 rounding) — within the fix's declared "≤ 5.7e-14 J". `n_pre + n_decode` equals
  the window's sample count in all 12 rows (13, 16, 16 / 41, 44, 44 / 72, 73, 72 / 95, 95, 95).
- Re-running the current tool on a byte copy with `--counts-manifest
  scripts/fixtures/energy-counts/manifest.csv` reproduces the four shipped sidecars
  **byte-identically** (4/4 `diff -q` clean). The sidecars are what the committed code produces.
- Cadence recomputed over the whole stem CSV: median 1.040 s for all four; max 1.060 s (1.2B/PURE),
  1.070 s (1.2B/REP), 3.020 s (2.6B/PURE), 3.520 s (2.6B/REP) — matching the declared 3.02/3.52 and
  the `cadence_*` cells.
- No rep's `_rN.txt` contains a `llama_perf_context_print` line (0 of 12), so every `decode_s` in
  this campaign came from `gen_tokens / gen tps` of the rep's own speed line, as documented.

### 1c. Hand-check, one rep, explicit arithmetic

1.2B/PURE rep 2. Window `[558864.28, 558880.62)` (mark r1 → mark r2), 16 samples, integrated window
duration 15.550 s, `J_window = 23.383 J`. Speed line of `_r2.txt`: `Prompt: 11.2 t/s | Generation:
9.0 t/s`; manifest `gen_tokens = 30`, so `decode_s = 30/9.0 = 3.333 s` and
`B = 558880.62 − 3.333 = 558877.287`. First sample at/after `B` is `b = 13` (t = 558878.15, P = 3.1218 W).

Sample power series in the window (W, then dt to previous sample in s):
`558864.67:1.2866 · 558865.71:0.4120/1.040 · 558866.74:0.4975/1.030 · 558867.79:0.4198/1.050 ·
558868.82:0.4198/1.030 · 558869.86:0.9562/1.040 · 558870.88:1.0573/1.020 · 558871.92:1.6520/1.040 ·
558872.96:1.2283/1.040 · 558874.00:1.7686/1.040 · 558875.04:1.7647/1.040 · 558876.08:1.7802/1.040 ·
558877.12:2.1751/1.040 · 558878.15:3.1218/1.030 · 558879.19:2.6631/1.040 · 558880.22:2.6475/1.030`.

- `j_pre` = Σ of the 13 intervals with right endpoints at 558865.71 … 558878.15 = **17.886 J**
  (the straddling interval `[558877.12, 558878.15)`, 1.030 s × 3.1218 W = 3.216 J, is charged to
  `j_pre` in full, as documented at `energyPhaseSplit.mjs:47-49`).
- `j_decode` = the two remaining intervals: `2.6631 × 1.040 + 2.6475 × 1.030 = 2.7696 + 2.7269 =
  5.4966 J` → cell 5.497 ✓; `j_per_tok_decode = 5.4966 / 30 = 0.1832` → cell 0.183 ✓;
  `w_decode` = mean of samples 13, 14, 15 = (3.1218 + 2.6631 + 2.6475)/3 = **2.811 W** ✓.
- Decomposition of the nominal decode window `[B, mark)` = 3.333 s: 2.070 s integrated (the two
  intervals above), 0.863 s inside the straddle interval (3.1218 × 0.863 = 2.694 J → `j_pre`), and
  0.400 s after the last sample (2.6475 × 0.400 = 1.059 J → nowhere). Nominal-window energy =
  5.497 + 2.694 + 1.059 = **9.250 J = 0.308 J/tok**, i.e. the published cell is 40.6 % below what
  the documented `[decode_start, mark_N)` span holds. This is R1/R2 below.

## 2. Presentation honesty, and the cross-stem claim (ex-F2)

The two declarations added by the fix are present and correct:
`docs/ENERGY-SCHEMA.md:96-101` ("`j_pre` is model load + inter-rep idle + prompt eval. The
prompt-eval-only J is NOT resolvable at 1 Hz with the model load inside the window … must not be
quoted as one") and `:63-69` (v1 retracted, with the round-2 finding as the reason). `prefill_est_s`
is explicitly "INFORMATIONAL ONLY and drives nothing" (`:84-86`, `:146`) and the code honours that.

What is not honest enough:

- **R1**: `docs/ENERGY-SCHEMA.md:148` defines `j_decode` as "energy of `[decode_start, mark_N)`". The
  integration never covers the last partial interval before `mark_N`, for any rep (tail gap 0.07-1.51 s,
  0.10-3.89 J), and it charges the post-`decode_start` part of the straddling interval to `j_pre`
  (0.09-2.70 J). `j_decode` is therefore a *lower bound* on the nominal decode window, biased low by
  up to two sample intervals — the "edge uncertainty" wording (`:132-136`) presents one interval *per
  edge* but reads as symmetric ±, while the construction is one-directional.
- **R2**: the sanctioned use — between-arm deltas of the same phase on the same (model, prompt) — is
  affected where the two arms have very different decode lengths. On the 1.2B pair the PURE arm's
  decode bucket is 3 samples (2.07-3.11 s integrated for a 3.30 s nominal decode) while the REP arm's
  is 29 samples (28.99 s for 30.48 s). Under the v2 convention REP/PURE = 1.60/1.60/1.22; counting the
  nominal `[B, mark)` span it is 1.05/1.00/1.22. The direction of the arm conclusion for the 1.2B
  ("speculation costs more per decode token") is a convention artefact at r1/r2, and the 1.2B is the
  app-relevant model. No warning fires (1.2B cadence max 1.06 s < 2 s).
- **R5**: the fix's report claims "2.6B = 2.1-2.3× per decode token vs 1.2B". No such figure exists in
  the repo docs, and the doc's read-first rule (`:10-16`, `:149`) forbids quoting absolute J/token
  from this harness. The number is real but arm-dependent: REP 2.21× (v2) / 2.16× (+tail) / 2.13×
  (nominal span); PURE 3.13× (v2) / 2.75× / 2.31×. Only the REP-arm version supports "2.1-2.3×", and
  the published PURE rows support 3.13×. A cross-stem statement needs the arm label and the R1 caveat,
  or it should stay out of any report.

## 3. Counts provenance (ex-F3/F6)

- `scripts/fixtures/energy-counts/` is tracked (`git ls-files`: 4 `*_counts.txt`, `manifest.csv`,
  `README.md`, all added by `95cf975`; `git check-ignore` finds nothing).
- Manifest content is exactly the 4 stems with `prompt_tokens`/`gen_tokens` 51/30, 72/256, 52/204,
  73/256, plus the count-run gen tps, the three per-rep campaign gen tps and the raw-file name.
- The 4 raw outputs are **byte-identical** to the untracked originals in `device-counts-out/`, each
  carries exactly one `COUNTS prompt_n=… predicted_n=…` line, and cleaning them with the harness rules
  reproduces the campaign reps byte-for-byte (md5 `5f433f6451`, `81f0e7f757`, `9e79921828`,
  `857e2248c1` = all three reps of each stem). The README's evidence claim holds.
- Behavioural delta with/without the manifest (fresh dirs, no stale sidecars):
  - `--counts-manifest` → stderr `counts from manifest … (preferred count source)`, all 12 rows
    populated, byte-identical to the shipped sidecars.
  - no count source → sidecars still written, phase columns **empty**, row warning "decode duration
    not derivable …", exit 0 (documented).
  - `--prompt-tokens/--gen-tokens` only → `WARNING: --counts-manifest is the preferred count source;
    --prompt-tokens/--gen-tokens apply to every stem (caller-verified counts)`. The values are applied
    exactly (0.184/0.183/0.242 for the PURE stem with 51/30), i.e. the flag path is faithful, and the
    "every stem" caveat is stated.
  - manifest present but a stem missing + flags given → note "no manifest entry — falling back to
    --prompt-tokens/--gen-tokens" for that stem only (`:483-485`).
  - malformed manifest (bad header, short row) → exit 1, "refusing to split", no files.
- Speed-line/manifest pairing warning works: doctoring `campaign_gen_tps_r1..r2` to 7.7 against a
  8.4 t/s speed line puts the warning in those rows (`manifest campaign_gen_tps_r1 (7.7) differs from
  this run's speed line (8.4) — wrong manifest/campaign pairing?`); the untouched r3 cell stays clean.
  Note the check compares gen tps only; a wrong `prompt_tokens` with matching gen tps passes silently,
  which is harmless (it feeds `prefill_est_s` and the informational `prompt_tokens` column only).
- Provenance of the diagnostic build: the README's quoted hunk matches the pristine
  `tmp/kalsallama-pin/tools/cli/cli-context.cpp` at `:377-380` (timings handler, `timings_per_token`
  at `:356`), `grep prompt_n` in `tools/cli/` is empty, and the working binaries equal the
  pre-patch record (`llama-cli` `cca1187c7974655a50efe45d3cfd73d8`, `libllama-cli-impl.so`
  `4e1eab9cd3d99a65373fe720193e4c24`, also equal to `tmp/counts-scratch-backup/`). R6 is only the
  `@@ -373` hunk offset (the hunk sits 4 lines lower in the file); the README already states the exact
  scratch bytes are gone and the patch is a reconstruction.

## 4. Guards (ex-F4)

Mechanism verified with constructed inputs:

| scenario | expected | observed |
|---|---|---|
| `decode_s ≥ window` (REP counts on a PURE stem via flags) | exit 1, stem refused, no file | exit 1, `FATAL … decode duration (28.132 s) >= window duration (12.430 s)`, no PURE sidecar |
| `decode_s ≥ window` via manifest | exit 1 | exit 1, same message |
| `gen_tokens = 0` in the manifest | exit 1 | exit 1, `FATAL … gen_tokens = 0 <= 0 with a count source present — incoherent input`, no file for that stem |
| implied decode power < 0.1 W (manifest `gen_tokens=10`, decode segment = 1 sample → `j_decode = 0`) | warning | warning on stderr **and** in the row: `implied decode power 0.00 W (j_decode / decode_s) outside the 0.1-20 W sanity band — counts wrong?`; `j_per_tok_decode = 0.000` published |
| implied decode power > 20 W | warning | not reachable with this device (max single-sample \|V·I\| across the four stems = 3.13 W, 691 samples); the harness covers it synthetically (24 W fixture, 69/0 run) |
| empty `.marks` | stem skipped, no file | no sidecar for that stem, notes on stderr (`missing mark boundary`), exit 0 while another stem produced |

The fix's two claims about the round-2 scenario:

- "The auditor's 8.9x wrong-stem-counts scenario is now rejected instead of silently accepted"
  (`95cf975` message) / "the 8.9x wrong-stem-counts scenario is REJECTED"
  (`energyPhaseSplitHarness.mjs`:§10 comment) — **REFUTED** for the scenario in question. Round 2's
  demonstration was "passing the PURE counts to the REP stem" (v1: 3.029 instead of 0.340 J/tok,
  8.9×). Under v2 the same input still exits **0** with **no warning** and yields 0.176/0.173/0.176
  against the correct 0.293/0.293/0.295 — an error of −39.9 %, −41.0 %, −40.3 %. The harness's
  regression fixture uses a synthetic 5 s window at 2.0 t/s, where 30 generated tokens put
  `decode_s` past the window, i.e. it tests the *mirror* direction.
- "the error damps to −40 % with plausible wrong counts" — **CONFIRMED**: −40 % ± 1 pp in all three
  REPS, and the full sweep of cross-stem count mix-ups gives −0.9 % … −41 % or exit 1 (table below).

| target stem | counts from | exit | `J/tok` error vs correct |
|---|---|---|---|
| 1.2B/PURE | any 256-token set (1.2B/REP, 2.6B/REP) | 1 | — (guard) |
| 1.2B/PURE | 2.6B/PURE (204 tok) | 1 | — (guard) |
| 1.2B/REP | 1.2B/PURE (30 tok) | 0 | −39.9 / −41.0 / −40.3 % |
| 1.2B/REP | 2.6B/PURE (204 tok) | 0 | −2.0 / −2.0 / −1.7 % |
| 1.2B/REP | 2.6B/REP (256 tok) | 0 | 0 % (same counts) |
| 2.6B/PURE | 1.2B/PURE (30 tok) | 0 | −17.1 / −18.1 / −28.1 % |
| 2.6B/PURE | 1.2B/REP or 2.6B/REP (256 tok) | 0 | −4.9 / −3.2 / −13.7 % |
| 2.6B/REP | 1.2B/PURE (30 tok) | 0 | −12.8 / −14.4 / −22.8 % |
| 2.6B/REP | 2.6B/PURE (204 tok) | 0 | −0.9 / −1.6 / −1.2 % |

The guard's design cannot catch wrong counts whose implied duration stays plausible (the boundary and
the divider move together, so the J/tok error is bounded by the fraction of the window the boundary
moves); that bound is what makes the damping claim true. A stronger check exists in principle
(compare `prompt_est_s + load + decode_s` against the window span — for 1.2B/REP the wrong input
leaves ~37 s of a 41 s window unexplained) but is not implemented. Since the manifest is the pinned
source and the flags print a warning, this is R3 (a claim/text issue), not a blocker.

## 5. Cadence honesty (ex-F5)

`cadence_median_s`/`cadence_max_s` are per-row (`PHASES_COLUMNS`, filled from the whole-stem CSV at
`:301-303`), the >2 s warning is per-row without demanding a failure, and the measured values match
my recomputation exactly (1.040 median everywhere; 1.060 / 1.070 / 3.020 / 3.520 maxima). The
declared 3.02/3.52 warning is present in every 2.6B row and absent from the 1.2B rows. The docs no
longer contain the false "≤ 1 s" edge claim (`docs/ENERGY-SCHEMA.md:132-136`) and the tool header
(`:47-51`) and stdout footer carry the same wording. **CONFIRMED.**

## 6. Marks hygiene and count-source wording (ex-F7/F8)

| input | exit | sidecar | message |
|---|---|---|---|
| `r1 > r2` (out of order) | 1 | none for that stem | `FATAL <stem>: marks out of order: r2 (…) <= r1 (…) — refusing the stem` |
| `r1 = r2` (equal) | 1 | none | same message with equal values |
| `r1` before the first CSV sample | 1 | none | `FATAL <stem>: mark r1 (…) precedes the first CSV sample (…) — refusing the stem` |
| `mark_1 = first CSV sample` (empty window) | 0 | row skipped with note | `empty rep window (start … >= end …) — rep skipped` |
| rep `_rN.txt` without a speed line | 0 | file with that rep absent | `<stem>: r2: no parsable speed/perf line (failed run?) — rep skipped` |

`gen_tokens` never renders 0 on a valid row (the only `0` I could produce is the `j_per_tok_decode =
0.000` of the band-warning case in §4, where a count source *is* present and the decode segment holds
a single sample — a separate, smaller nit: a zero per-token cell with a warning is weaker than an
empty cell). The "verbose llama-cli run" count-source suggestion is gone from both docs and tool, and
both now state outright that the pristine CLI cannot print counts
(`docs/ENERGY-SCHEMA.md:110-114`, fixtures `README.md:31-35`). **CONFIRMED.**

## 7. CI wiring (ex-F9)

`e50772f` touches only `.github/workflows/bench.yml` and `.github/workflows/apk.yml` (+4 lines each).
Both files parse as YAML (jobs `build`/`bench`/`aggregate` and `apk`), and both list
`node scripts/energySchemaHarness.mjs` + `node scripts/energyPhaseSplitHarness.mjs` in the
"Typecheck + logic harnesses" step, immediately after `telemetryClampHarness` and before
`npx jest --silent`. `node scripts/matrixParityHarness.mjs` passes (15/0) and is untouched by the
commit — its parity check ("apk.yml runs every bench.yml typecheck harness") now sees the two new
lines on both sides. Both energy harnesses are offline: `mkdtempSync`/`tmpdir` scratch dirs only, no
`adb`, no reference to the gitignored campaign dirs, so they run in a bare checkout.
**CONFIRMED.**

## 8. Regressions

| check | result |
|---|---|
| `energyAggregate.mjs` stdout on `device-ngram-spec-out-ngram-2026-09` (no phases) | md5 `f8ffe9cf0c9b8aa515ea6983356cbcf5` — identical to the round-2 baseline (strict no-op) |
| `energyAggregate.mjs` stdout on `device-ngram-spec-out` (4 v2 sidecars present) | the 4 real arms only (72 / 293 / 501 / 589 J, matching my whole-stem recompute); no `.phases` pseudo-arm, empty stderr |
| `energySchemaHarness.mjs` | 77 passed / 0 failed, exit 0 |
| `energyPhaseSplitHarness.mjs` | 69 passed / 0 failed, exit 0 |
| copy + re-run of the splitter with the manifest | 4/4 sidecars byte-identical (regenerated, not stale) |
| `git show --name-only` for both commits | exactly the 10 declared files (`95cf975`) and the 2 workflows (`e50772f`); nothing else |
| Italian sweep of both diffs | 0 hits (the single regex hit is the English word "solo" used as a synthetic fixture stem name, `energyPhaseSplitHarness.mjs`) |
| binaries | `tmp/build-android/bin/llama-cli` `cca1187c…`, `libllama-cli-impl.so` `4e1eab9c…` — unchanged, equal to `tmp/counts-scratch-backup/` |
| worktree state | only the pre-existing untracked files (`AGENTS.md`, the two earlier audit reports, `device-counts-out/`, `device-ngram-spec-out-ngram-2026-09/`); the four `*.phases.csv` live in the gitignored `device-ngram-spec-out/` and were not rewritten by this audit (mtimes 19:46/19:54; every splitter run here wrote into `/tmp` copies) |

## 9. Free judgement: the residual v2 defect (R1/R2, quantified)

The round-2 report looked for a boundary in the wrong place; the new failure mode is a boundary in
the right place measured on a grid that is too coarse for the bucket it has to fill. Every rep's
straddle and tail mass, from the real CSVs:

| stem | rep | `decode_s` (s) | integrated decode span (s) | straddle after `B` (s) | tail gap (s) | J/tok v2 | J/tok nominal `[B,mark)` | v2 − nominal |
|---|---|---|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 3.297 | 2.070 | 0.577 | 0.650 | 0.184 | 0.293 | −37 % |
| 1.2B/PURE | 2 | 3.333 | 2.070 | 0.863 | 0.400 | 0.183 | 0.308 | −41 % |
| 1.2B/PURE | 3 | 3.297 | 3.110 | 0.037 | 0.150 | 0.242 | 0.253 | −5 % |
| 1.2B/REP | 1-3 | 30.476 | 28.97-28.99 | 0.52-0.62 | 0.88-0.97 | 0.293-0.295 | 0.308-0.310 | −5 % |
| 2.6B/PURE | 1-3 | 52.308 | 50.60-50.71 | 0.20-0.78 | 0.82-1.51 | 0.608-0.672 | 0.630-0.693 | −3 % |
| 2.6B/REP | 1-3 | 71.111 | 69.69-70.44 | 0.25-0.60 | 0.07-1.17 | 0.645-0.653 | 0.651-0.666 | −1 to −2 % |

The specific hazard in the audit brief — a 3.5 s gap straddling `decode_start` — is the *benign* case:
on the 2.6B/REP stem the largest observed sample interval is 3.520 s and the decode-segment power is
2.51 W, so at most 8.83 J (5.3 % of `j_decode`, 0.035 J/tok) can be moved from decode to pre, and the
row carries the `sampler cadence max 3.520 s exceeds 2 s` warning for the whole stem. On 2.6B/PURE the
same bound is 8.2 J ≈ 6.4 %. The warnings cover that case.

They do not cover the case that actually matters. The 1.2B/PURE arms run a 3.3 s decode — three
sample intervals — so the two convention truncations remove 1.23-1.26 s of the 3.3 s nominal decode
(37 % of the phase at r1, 38 % at r2, 6 % at r3). The published cells are therefore 37-41 % below the
documented `[B, mark)` span on two of the three reps, the `w_decode` (2.67/2.81/2.36 W) and
`j_decode / decode_s` (1.68/1.65/2.20 W) columns disagree by up to 60 % with no explanation, and no
warning fires because the cadence (1.060 s) is well under the 2 s threshold. The threshold is
mis-targeted: it is silent exactly where the decode bucket is one to two intervals wide. The 1.2B
arm-delta consequence is in §2 (R2).

What the fix could have added cheaply, and what would flip this audit: the decode segment's
integrated duration as a column (v1 had it as `decode_s`; v2 renamed `decode_s` to the nominal anchor
and dropped the integrated quantity), so `j_decode` is readable as a rate; a per-row note when the
integrated decode span is shorter than `decode_s` by more than the tail gap (i.e. "the decode bucket
covers N of M nominal seconds"); and the doc sentence for `j_decode` changed from `[decode_start,
mark_N)` to "the intervals whose right-endpoint sample is at/after `decode_start`", matching the
integration rule stated two paragraphs above it.

## Minimal flip-to-SHIP list

1. **R1** — `docs/ENERGY-SCHEMA.md:148`: state what `j_decode` integrates (right-endpoint samples at
   or after `decode_start`, last partial interval before the mark excluded), and note that the sum of
   both truncations is ≤ 2 sample intervals in one direction (`j_decode` is a lower bound).
2. **R1/R2** — put the decode segment's integrated duration in the row (or warn per row when the
   integrated span is more than the tail gap short of `decode_s`). That single column makes the
   1.2B/PURE weakness visible without a reader having to reconstruct it.
3. **R2/R5** — where the phase numbers are quoted: label `j_per_tok_decode` as arm-anchored (the
   1.2B PURE/REP arm delta is not readable at the current grid resolution) and drop or qualify the
   cross-stem 2.1-2.3× statement, which the schema forbids as an absolute.
4. **R3** — correct the claim in the `95cf975` message and in `energyPhaseSplitHarness.mjs` §10: the
   round-2 8.9× scenario is *damped to −40 %*, not rejected; the rejected case is the mirror
   direction (counts that imply `decode_s ≥ window`).
5. **R4, R6** — one sentence for `w_decode` (its sample set includes the boundary sample whose
   interval is in `j_pre`) and a hunk-offset fix in the fixtures README.

None of these is a math or provenance defect; all five are text plus one column. The mechanism, the
counts, the guards and the CI wiring are in good shape and do not need to change.

## Commands executed (all read-only; scratch under `/tmp/kalsa-audit-r3/`)

```
git status --short ; git show --stat/-p/--name-only 95cf975 e50772f
node /tmp/kalsa-audit-r3/reintegrate.mjs device-ngram-spec-out scripts/fixtures/energy-counts/manifest.csv
node /tmp/kalsa-audit-r3/compare.mjs            # 180/180 cells, residual <= 2.84e-14 J
node /tmp/kalsa-audit-r3/dbg.mjs                # hand-check rep 1.2B/PURE r2, per-sample power x dt
node /tmp/kalsa-audit-r3/final.mjs              # straddle/tail mass, conventions, cross-stem ratios
node /tmp/kalsa-audit-r3/sweep.mjs              # 12 cross-stem count mix-ups, exit codes + errors
bash /tmp/kalsa-audit-r3/scenarios2.sh          # no-counts / flags / wrong-stem / manifests / marks hygiene
node scripts/energyPhaseSplit.mjs <copy> --counts-manifest scripts/fixtures/energy-counts/manifest.csv
node scripts/energyAggregate.mjs device-ngram-spec-out-ngram-2026-09 ; node scripts/energyAggregate.mjs device-ngram-spec-out
node scripts/energySchemaHarness.mjs ; node scripts/energyPhaseSplitHarness.mjs ; node scripts/matrixParityHarness.mjs
python3 -c "import yaml; ..."                   # bench.yml / apk.yml parse
md5 tmp/build-android/bin/llama-cli tmp/build-android/bin/libllama-cli-impl.so tmp/counts-scratch-backup/*
python3  # cleaned-text md5 of the 4 committed count runs vs the 12 campaign reps
sed -n '350,382p' tmp/kalsallama-pin/tools/cli/cli-context.cpp ; grep -rn prompt_n tmp/kalsallama-pin/tools/cli/
```

## Final verdict

**NO-SHIP (narrow).** The semantic re-anchor that the round 2 demanded is done and verified: the
boundary is the rep end, `j_pre` is named for what it holds, the partition is bit-exact, the counts
have a tracked provenance that reproduces the campaign text, the guards reject the incoherent cases,
the cadence is honest and the harnesses run in CI. What still blocks publication is that the decode
side of the new contract describes coverage the integration does not deliver, the row no longer
exposes the quantity that would reveal it, and the 1.2B arm delta — the schema's own sanctioned use —
turns on a one-interval convention choice at the current sampling grid. Fix items 1-4 above and this
becomes SHIP; the numbers themselves are reproducible today, they are just not yet quotable without
a caveat the docs do not carry.
