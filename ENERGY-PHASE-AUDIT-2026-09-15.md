# Per-phase energy split audit — `572d3be` + `f936c16` (branch `energy-framework`)

Commits: `572d3be bench(energy): per-phase (prefill/decode) energy disaggregation tool` and
`f936c16 bench(energy): skip *.phases.csv in aggregate; unlock per-phase numbers with exact token counts`
Parent: `2964da5` · Worktree: `/Users/marco/Projects/kalsa-ngram-spec` · Date: 2026-09-15
Mode: read-only adversarial review (no repo file modified except this report; no commit, no push, no adb;
`/Users/marco/Projects/kalsa` untouched). Every number below was recomputed from the raw CSVs with
scratch scripts under `/tmp/kalsa-audit/` (independent re-implementation, not the repo modules).

## Verdict

**NO-SHIP as-is.** The partition arithmetic is exact and reproducible (F-verdicts: all math claims
CONFIRMED, 0 mismatching cells over 4 stems × 3 reps × 16 columns), the token counts check out against
the vendored server source, and the aggregate glob fix is a verified no-op where it must be. But the two
commits ship numbers under a *physical* name ("prefill/decode disaggregation") that the data does not
support: the boundary is computed from the window **start**, while the run's startup (inter-rep sleep,
model load) sits between the window start and the real prompt processing, so `j_prefill` is dominated by
inter-rep idle energy and `j_decode` absorbs the entire prefill plus the load. Three independent findings
(F1 HIGH, F2 HIGH, F3 MEDIUM) plus a footgun (F4) have to be fixed before these numbers can go into a
report. Minimal flip-to-SHIP list at the end.

| # | Severity | Subject | Verdict |
|---|---|---|---|
| F1 | HIGH | `j_prefill`/`prefill_s` are not prefill: the boundary precedes the model load in 8/12 reps, `j_decode` contains the whole prefill | CONFIRMED |
| F2 | HIGH | commit title, `docs/ENERGY-SCHEMA.md` column table and the cited J/decode-tok figures overstate what the split measures (mark-anchored recompute: 12–153 % lower) | CONFIRMED |
| F3 | MEDIUM | token-count provenance is not reproducible: scratch patch never committed, patched binary deleted, evidence only in gitignored `tmp/` + untracked `device-counts-out/` | CONFIRMED |
| F4 | MEDIUM | wrong `--prompt-tokens`/`--gen-tokens` silently accepted (demonstrated 8.5× error, exit 0, no warning); flags apply to every stem in the invocation | CONFIRMED |
| F5 | MEDIUM | doc/tool assert "≤ 1 sample (~1 s)" edge uncertainty; real 2.6B arms sample at up to 3.52 s intervals | CONFIRMED |
| F6 | LOW | `--prompt-tokens`/`--gen-tokens` interpolation: the tool silently produces different phase energies with wrong counts, and no stem→counts manifest exists in the repo | CONFIRMED |
| F7 | LOW | marks edge cases: pre-CSV/zero marks reported as "non-monotonic"; the following rep silently absorbs samples that predate its window; `gen_tokens=0` renders `0` where the doc says empty | CONFIRMED |
| F8 | LOW | "measured with a verbose llama-cli run" alternative is not parseable by `parsePerfLines` (fork prints `eval time = … / N tokens` with a slot prefix, parser wants `llama_perf_context_print:` + `/ N runs`) | PLAUSIBLE |
| F9 | LOW | the new harness is not wired into CI (`bench.yml`/`apk.yml` enumerate harnesses; neither energy harness is listed) | CONFIRMED |

| Commit claim | Verdict |
|---|---|
| (1) mark_N is rep N's END, same device clock as `t_s`, no conversion | CONFIRMED (`scripts/device-ngram-spec.sh:205` written after the `llama-cli` call at :183-184, before `sleep 5` at :206; `scripts/energy-sample.sh:39` reads `/proc/uptime` field 1) |
| (2) rep 1 = [first CSV sample, mark_1), rep i>1 = [mark_{i-1}, mark_i), tail excluded | CONFIRMED (all 4 stems; tail = 2–5 samples) |
| (3) boundary = window_start + prompt-eval duration, perf line first, else prompt_tokens / own prompt t/s | CONFIRMED (`scripts/energyPhaseSplit.mjs:168-172`, harness fixture `perf_line`) |
| (4) straddling interval → decode with a borrowed predecessor sample | CONFIRMED (`:212-218`; straddle energy 0.16–1.99 J, Δt 1.03–2.47 s) |
| (5) `j_prefill + j_decode == J_window` exactly | CONFIRMED (residual ≤ 5.7e-14 J over 12/12 reps; 0-cell diff re-integration) |
| (6) the shipped `.phases.csv` files are what the current code produces | CONFIRMED (fresh run on a copy: 4/4 files byte-identical) |
| (7) `prompt_n = n_prompt_tokens_processed`, `predicted_n = n_decoded`, EOS included | CONFIRMED from vendored source (`server-context.cpp:509/514`, `:3397`, `:3739`, `:1926-1928`, `:3881`) |
| (8) pristine CLI prints no counts | CONFIRMED (`cli-context.h:14-17`, `cli-context.cpp:376-380`, `:647-651`, `cli.cpp:36` verbosity=ERROR) |
| (9) binaries returned byte-identical | CONFIRMED for the local tree (current == `tmp/counts-scratch-backup/` == before/restored md5) — but the counting binary itself is gone (F3) |
| (10) the patch never entered git | CONFIRMED (`git log -p --all \| grep COUNTS` empty, `git grep 'prompt_n=' <all revs>` empty, `git status` clean apart from untracked dirs) |
| (11) count-run text byte-identical to the campaign reps | CONFIRMED for all 4 stems × 3 reps (cleaned per `clean_out` + the `COUNTS` line removed) |
| (12) `predicted_n=30` explains the 1.2B/PURE ≈ 51 s window | CONFIRMED (whole-stem integrated duration 50.87 s; with 256 tok/rep the arm would run ≳100 s) |
| (13) prompt t/s of the count run 14–17 % below campaign | PARTIAL: 1.2B stems −14.2 … −16.8 %; 2.6B/PURE −17 % on r1/r2 but 0 % on r3; 2.6B/REP 0 … −2.5 % (generation t/s identical everywhere) |
| (14) glob fix changes nothing on a dir without `.phases.csv` | CONFIRMED (stdout+stderr md5 `f8ffe9cf0c9b8aa515ea6983356cbcf5`, identical to the pre-fix script) |
| (15) glob fix removes the garbage arms on `device-ngram-spec-out` | CONFIRMED (4 `.phases` pseudo-arms dropped) |
| (16) harnesses green, check added to `energySchemaHarness.mjs` | CONFIRMED (77/0 and 37/0, exit 0; new block at `energySchemaHarness.mjs:432-470`) |
| (17) `J/decode-tok ≈ 0.34-0.36` (1.2B REP) vs `≈ 0.74-0.79` (2.6B) | CONFIRMED against the CSV cells; the *interpretation* is F1/F2 |

## 1. Partition math, re-integrated independently (CONFIRMED)

Scratch implementation (`/tmp/kalsa-audit/compare2.mjs`): own CSV parser, right-Riemann with the
documented right-endpoint rule, own marks/`Prompt:` parsers, per-stem counts from `device-counts-out/`
(51/30, 72/256, 52/204, 73/256). Result vs the shipped `device-ngram-spec-out/*.phases.csv`:
**0 mismatching cells** over all 12 rep rows × 16 numeric/identity columns (the 17th, `warnings`, is
empty on every real row, which the tool also writes). `j_prefill + j_decode − J_window` ranged
−3.6e-14 … +5.7e-14 J; `prefill_s + decode_s = duration` exactly. Sum of per-rep window J vs whole-stem J
(the difference is the excluded tail plus the inter-window gaps): 72.26/67.99, 293.49/284.95,
500.56/498.40, 588.59/587.25 — all consistent with "samples after the last mark belong to no rep".

Running the tool itself on a copy of the real dir (`/tmp/kalsa-audit/out`, one invocation per stem with
that stem's counts) reproduced the four shipped `.phases.csv` files **byte-identically**; the default
no-flag path on the same data writes the documented empty-phase rows + warning (no guessing).

## 2. F1 — the "prefill" bucket is not prefill (HIGH, CONFIRMED)

Mechanism: `window_start` is the rep boundary, but the run's prompt processing starts after
`adb round-trip + sleep 5 (rep≥2) + process spawn + model load`. The tool places the prefill/decode edge
at `window_start + P` (`energyPhaseSplit.mjs:212`), i.e. **P seconds after the window start**, ignoring
that whole startup offset. Consequence: the prefill bucket covers the tail of the previous rep's decay +
the inter-rep idle (rep≥2) or the pre-launch idle (rep 1), and the decode bucket contains the remainder of
the startup, the *entire* real prefill, and the real decode.

Evidence 1 — the harness's own ordering is airtight for `P < 5 s`: the mark is written before `sleep 5`
(`device-ngram-spec.sh:205`, then `:206`), so no prompt processing can start before
`mark_{i-1} + 5 s + ε`. For 1.2B/PURE r2/r3, `P = 51/11.3 = 4.51 s`; the last prefill-bucket sample sits
at +3.51 s / +3.77 s from the mark — strictly before the load can exist.

Evidence 2 — the sampled power inside the prefill buckets (right-endpoint W values, offsets from the
window start) is idle-level:

| stem | rep | P (s) | W of prefill-bucket samples |
|---|---|---|---|
| 1.2B/PURE | 2 | 4.51 | `0.4:1.29  1.4:0.41  2.5:0.50  3.5:0.42` |
| 1.2B/PURE | 3 | 4.51 | `0.6:0.48  1.7:0.47  2.7:0.75  3.8:0.47` |
| 1.2B/REP | 2 | 6.37 | `0.1:1.79  1.1:0.44  2.1:0.45  3.2:0.45  4.3:0.45  5.3:0.47  6.3:1.06` |
| 2.6B/PURE | 3 | 13.33 | `1.6:0.15  4.0:0.16  5.6:0.88  8.1:0.04  10.2:0.20  13.2:0.03` |
| 2.6B/REP | 1 | 18.72 | `0.0:0.33  2.3:0.13  3.3:0.66  6.8:0.04  8.3:0.82  11.1:0.09  13.5:0.10  16.8:0.29` |
| 2.6B/REP | 2 | 18.25 | `0.5:0.65  3.8:0.07  5.5:0.25  7.2:0.07  10.5:0.06  12.8:0.07  15.9:0.05` |

Setting aside each bucket's first sample — the previous rep's decode decay (1.29 W in 1.2B/PURE r2,
1.79/2.53 W in 1.2B/REP r2/r3), not local work — **8 of the 12 buckets never exceed 1.1 W**, i.e. they sit
entirely in the idle gap. The four exceptions are the reps where the boundary reaches into the run's
start-up: 1.2B/PURE r1 (1.02 → 1.51 W at +3…4 s, load ramp), 1.2B/REP r1 (1.26 → 1.84 → 1.75 W at
+4…6 s), 2.6B/PURE r1 (up to 3.13 W) and 2.6B/PURE r2 (up to 1.79 W).

Evidence 3 — the same CSV supports a better boundary. Anchoring the run's own reported durations
**backwards from the mark** (`decode = [end−G, end)`, `prefill = [end−G−P, end−G)` with `G = predicted_n /
generation t/s` from the run's own speed line) gives a mark-anchored split of the *same* right-Riemann
sums (`/tmp/kalsa-audit/tailanchor.mjs`):

| stem | rep | J_decode (tool) | J/tok (tool) | J/tok (mark-anchored) | tool inflation |
|---|---|---|---|---|---|
| 1.2B/PURE | 2 | 22.00 | 0.733 | 0.290 | 2.5× |
| 1.2B/REP | 2 | 91.48 | 0.357 | 0.304 | 17 % |
| 2.6B/PURE | 2 | 157.56 | 0.772 | 0.643 | 20 % |
| 2.6B/REP | 2 | 189.62 | 0.741 | 0.655 | 13 % |

Over all 12 reps the tool's `J/decode-tok` is 12–153 % above the mark-anchored value (+111…+153 % for the
short-EOS 1.2B/PURE runs, +12…+20 % for the long 1.2B/REP and 2.6B runs), so the inflation differs by more
than a factor of 2 between stems of the same campaign. The
mark-anchored split is itself ±1 sample (up to ±3.5 s, F5) and inherits the run's self-reported P/G, but it
is much closer to physics than a boundary that provably sits in the inter-rep sleep.

Nothing in the code is arithmetically wrong, and the header does say "Phase J is therefore a convention,
not a clean physical prefill" (`energyPhaseSplit.mjs:41-45`). The defect is that no sentence states the
consequence — that the prefill bucket precedes the run's start, that `j_prefill` is essentially idle
energy, and that `j_decode` carries the whole prefill. The column table then calls them "the prefill
segment" (`docs/ENERGY-SCHEMA.md:111-113`), and the commit title calls the tool a
"prefill/decode energy disaggregation".

## 3. F2 — the cited numbers vs the doc's own usage boundary (HIGH, CONFIRMED)

`docs/ENERGY-SCHEMA.md:9-15` and the tool header both say: RELATIVE metric, between-arm deltas of the same
(model, prompt) only, "never quote absolute J/token from this harness"; `:77-79` extends that to phase J
("between-arm deltas of the same phase stay meaningful because every arm gets identical arithmetic").

The declared interpretation in the commit report is a **cross-stem comparison** of absolute values
(`J/decode-tok ≈ 0.34-0.36` for 1.2B/REP vs `≈ 0.74-0.79` for 2.6B/PURE/REP, plus `J/prefill-tok`
0.02-0.33). The numbers are coherent with the CSV cells (verified: 0.340/0.357/0.361; 0.792/0.772/0.739 and
0.756/0.741/0.744; prefill-per-tok range 0.017-0.331), but they are exactly the use the doc forbids, and
F1 shows the decode bucket's non-decode wall-time share is 14–20 % (1.2B/REP) vs 17–42 % (2.6B) — a
model-dependent bias of ∼1.2× between the two families that is not disclosed. The direction of the
"2.6B costs ~2× J/token" conclusion survives the mark-anchored recompute (0.30 vs 0.62–0.66 J/tok,
ratio 2.1–2.2×), so the fix is a labelling/qualification fix, not a new campaign.

The declared "rep-1 (with model load) systematically heavier" is **REFUTED as stated**: rep-1 has the
largest `J/prefill-tok` in 3/4 stems (1.2B/PURE 0.080, 1.2B/REP 0.097, 2.6B/PURE 0.331) but 2.6B/REP's
heaviest is rep 3 (0.119 vs 0.051 for rep 1). It is a plausible *tendency* explained by where the load
lands relative to the boundary (F1), not a systematic property.

## 4. Token-count provenance (source-level CONFIRMED; evidence retention F3)

Verified in the vendored tree `tmp/kalsallama-pin/` (b674-c6e2376, same build as the campaign):

- `prompt_n` is the *processed* prompt count: `result_timings.prompt_n = n_prompt_tokens_processed`
  (`tools/server/server-context.cpp:509`), reset at prompt start (`:3309`) and incremented per text token
  actually added to a batch (`:3397`), plus image chunks (`:3397` region) — no cache reuse in these runs.
- `predicted_n` is `n_decoded` (`:514`), incremented *before* the stop check (`:3739` in the
  non-speculative path, `:3881` in the draft-accept path), while the EOG branch sets
  `has_next_token = false` (`:1926-1928`) and `process_token` returns false → the terminating EOS token is
  counted. Both fields reach the client as `timings.prompt_n`/`timings.predicted_n`
  (`server-task.cpp:240-260`), attached on the final response or on every chunk under
  `timings_per_token` (`server-context.cpp:2064-2066`; the CLI sets that flag at
  `tools/cli/cli-context.cpp:356`).
- The pristine CLI cannot print counts: `cli_timings` has only two doubles (`tools/cli/cli-context.h:14-17`),
  the SSE handler stores only `prompt_per_second`/`predicted_per_second` (`cli-context.cpp:376-380`), the
  only print is the speed line (`:647-651`), and `tools/cli/cli.cpp:36` pins verbosity to `LOG_LEVEL_ERROR`.
  `git grep 'prompt_n=' $(git rev-list --all)` returns nothing.
- Self-consistency of the values: `predicted_n = 256 = n_predict` for both REP stems (the text is truncated
  mid-line at "- item 39", i.e. the cap was hit), and `predicted_n = 30 / 204` for the EOS-truncated PURE
  stems. A per-chunk print would have produced one `COUNTS` line per token; the artifact has exactly one,
  placed after the generated text — consistent with an end-of-stream read of the final timings.

F3 (evidence retention): the counting build was a scratch patch that exists nowhere. `cli-context.cpp` is
back to pristine (mtime 18:57, `grep prompt_n` empty), there is no build log for it (`tmp/build2.log`,
`tmp/build3.log` are the 13:59/14:10 builds), and the patched `libllama-cli-impl.so` (md5
`b2e0d588d89fb8aeeb4725e48310e2d4`) has been overwritten. What remains: `tmp/counts-scratch-bin-md5-*.txt`
(gitignored) and the untracked `device-counts-out/`. I verified the **restore** claim independently: the
current `tmp/build-android/bin/llama-cli` and `libllama-cli-impl.so` md5s equal both
`tmp/counts-scratch-backup/*` and the "before"/"restored" records (`cca1187c…`, `4e1eab9c…`), and all other
libs are unchanged — so no patched binary was shipped anywhere. But a third party cannot rebuild the
counting tool from the repo, and no committed file ties a stem to its `(prompt_n, predicted_n)` pair.

## 5. Counts applicability, the timing anomaly, and item-3 claims (CONFIRMED)

Cleaning the count-run text with the harness's own rules (`grep -v '^\[ Prompt:\|^Exiting\|^Loading model'`
+ strip trailing whitespace + drop empty lines, plus dropping the scratch `COUNTS` line) gives a cleaned
md5 that is **identical to all three campaign reps for all four stems** (5f433f64…, 81f0e7f7…, 9e799218…,
857e2248…). Because the cleaned text includes the echoed prompt, this proves the same prompt and the same
generated sequence — so the counts are the counts of the runs whose energy is being split, including the
EOS position. The 1.2B/PURE claim holds: the whole stem window integrates to 50.87 s ≈ 51 s, which only
makes sense with 30 generated tokens (three × 256 tokens at 9.1 t/s would be ≳ 100 s with the loads).

Timing anomaly judgement: prompt t/s are −14.2 % (1.2B/PURE), −15.3…−16.8 % (1.2B/REP), −17 %/−17 %/0 %
(2.6B/PURE) and 0 %/−2.5 %/0 % (2.6B/REP) vs the campaign, while generation t/s agree to ≤ 0.1 t/s
everywhere. The declared "14-17 % below campaign" is therefore only true for the 1.2B stems and 2.6B/PURE
r1/r2. **Proceeding was still justified**: `--prompt-tokens/--gen-tokens` are token *counts* (timing-free),
each rep's boundary uses the campaign `_rN.txt` prompt t/s (`energyPhaseSplit.mjs:171-172`), and the
count-run speed line never reaches the tool (the count files live in a different directory and the tool
reads only `<dir>/${stem}_rN.txt`).

## 6. Aggregate glob fix (CONFIRMED)

- Dir without sidecars (`device-ngram-spec-out-ngram-2026-09`, 4 CSVs, no `.phases.csv`): new
  `scripts/energyAggregate.mjs` vs the pre-fix script extracted from `572d3be` → stdout and stderr both
  byte-identical, md5 `f8ffe9cf0c9b8aa515ea6983356cbcf5` (the same baseline md5 recorded in the previous
  audit report). Strict no-op.
- Dir with sidecars (`device-ngram-spec-out`): pre-fix prints four extra pseudo-arms
  (`…_none_PURE.phases | 0 | too few samples`) plus four "skipped 4 unparseable row(s)" stderr lines;
  post-fix prints only the four real arms (72/293/501/589 J — matching my independent whole-stem J).
- Harness check added (`energySchemaHarness.mjs:432-470`) asserts exit 0, the real arm aggregated, and no
  `.phases` string in the table; `energySchemaHarness.mjs` runs 77 PASS / 0 FAIL, exit 0.
- Edge: a dir containing *only* `.phases.csv` files now fails explicitly (`no *.csv in <dir>`, exit 1) for
  both tools — a good failure mode, no silent empty table.

## 7. Documentation judgement (F5, F8)

`docs/ENERGY-SCHEMA.md` is otherwise strong: the frozen v1 schema, the relative-metric warning, the
"never a guess" token rule, the straddle/borrow rule (`:92-99`) and the consumer note (`:125-127`) all match
the code. What is missing is stated in F1/F2. Two more imprecisions:

- F5: `:100-103` and the tool footer claim "~1 Hz" and "≤ 1 sample (~1 s)" per edge. Measured inter-sample
  intervals: median 1.04 s in all stems, but p90 1.98 s / max 3.02 s (2.6B/PURE) and p90 2.47 s / max
  3.52 s (2.6B/REP). On the biggest model each phase edge can therefore carry ~3.5 s of uncertainty
  (and the "up to ~20 J per edge" ceiling scales with the interval, not with 1 s).
- F8: `--prompt-tokens` provenance is described as "measured once on-device with a verbose llama-cli run".
  That is a usable *manual* method (with `-v`, `print_timings()` prints
  `prompt eval time = … ms / N tokens` and `eval time = … ms / N tokens`, `server-context.cpp:590-605`), but
  `parsePerfLines` cannot auto-detect it: it requires the upstream `llama_perf_context_print:` prefix and
  `/ N runs` on the eval line (`energyPhaseSplit.mjs:81-95`), while the fork's CLI writes a slot-prefixed
  line ending in `/ N tokens`. A verbose campaign run would silently fall back to the empty-phase row.

## 8. Edge cases exercised beyond the harness (item 7)

Probed via the exported `splitStem` and the CLI (`/tmp/kalsa-audit/edges.mjs`):

| case | behaviour | assessment |
|---|---|---|
| marks out of order in the file | Map + numeric sort → correct windows | fine |
| duplicate mark lines | last write wins (documented) | fine |
| `mark_2 < mark_1` | rep 2 skipped, note "non-monotonic marks (12 >= 11)"; rep 3 starts at `mark_2` | fine |
| `mark_1` before the first CSV sample / `mark = 0` | rep 1 reported as "non-monotonic marks (10 >= 0)" (misleading wording) and rep 2 silently absorbs samples that predate its window | F7 |
| equal marks | "non-monotonic marks (14 >= 14)" | minor wording |
| `gen_tokens = 0` from a perf line | `gen_tokens` column prints `0`, `j_per_tok_decode` empty although the doc says empty | F7 |
| no speed line but `--prompt-tokens/--gen-tokens` supplied | rep skipped ("no parsable speed/perf line (failed run?)") — duration cannot be derived, so this is correct, but the counts are ignored without saying so | acceptable |
| empty `.marks` | every rep skipped, exit 1 with reasons | fine |
| last mark past the CSV end | window takes the remaining samples | fine |
| mark with CRLF/trailing tab | parsed | fine |

F4 is the one that matters operationally: passing the PURE counts to the REP stem exits 0 with no warning
and produces `j_per_tok_decode` 3.029 instead of 0.340 (8.9×) — a wrong boundary move, a wrong divider, and
the same "caller-verified count" stderr line. A cheap guard would compare `prompt_tokens / prompt t/s` and
`gen_tokens / gen t/s` against the window span and warn when the derived decode time exceeds the window.

## 9. Hygiene (CONFIRMED)

`git show --name-only`: `572d3be` = `docs/ENERGY-SCHEMA.md`, `scripts/energyPhaseSplit.mjs`,
`scripts/energyPhaseSplitHarness.mjs`; `f936c16` = `docs/ENERGY-SCHEMA.md`,
`scripts/energyAggregate.mjs`, `scripts/energyPhaseSplit.mjs`, `scripts/energySchemaHarness.mjs`. Nothing
else in either commit. No Italian markers in either diff (accented-vowel and Italian-word sweep). No npm
dependencies: `node:` builtins + the local `./energySchema.mjs` only; `package.json`/`package-lock.json`
untouched. Both harnesses pass with exit 0 (77/0 and 37/0). `git status` shows only untracked
`AGENTS.md`, `ENERGY-SCHEMA-AUDIT-2026-09-15.md`, `device-counts-out/`,
`device-ngram-spec-out-ngram-2026-09/`. The author's own split-invariance evidence
(`tmp/campaign-dir-md5-{before,after}-split.txt`) confirms the split added exactly the four new sidecars
and touched nothing else.

## Commands executed (all read-only; scratch code under `/tmp/kalsa-audit/`)

```
git show --stat/-p 572d3be f936c16 ; git log -p --all | grep -n COUNTS ; git grep 'prompt_n=' <all revs>
git status --short ; git check-ignore -v device-ngram-spec-out/
md5 tmp/build-android/bin/llama-cli libllama-cli-impl.so tmp/counts-scratch-backup/*
node /tmp/kalsa-audit/compare2.mjs            # independent re-integration, 0 mismatching cells
node /tmp/kalsa-audit/table.mjs                # per-rep J / durations / contamination
node /tmp/kalsa-audit/tailanchor.mjs           # mark-anchored split of the same sums
node /tmp/kalsa-audit/timeline.mjs             # 1 Hz W per sample, boundary marked
node /tmp/kalsa-audit/prefillsamples.mjs       # prefill-bucket sample W + sampler cadence
python3 /tmp/kalsa-audit/cleancheck.py         # count-run vs campaign cleaned-text md5s
node scripts/energyPhaseSplit.mjs /tmp/kalsa-audit/out <stem> --prompt-tokens N --gen-tokens M   (x4)
node scripts/energyPhaseSplit.mjs /tmp/kalsa-audit/out3          # default no-flag path
node scripts/energyAggregate.mjs <dir-with-phases> ; node /tmp/kalsa-audit/old/energyAggregate.mjs <same>
node scripts/energyAggregate.mjs <dir-without-phases> ; node /tmp/kalsa-audit/old/energyAggregate.mjs <same>
node scripts/energySchemaHarness.mjs ; node scripts/energyPhaseSplitHarness.mjs
node /tmp/kalsa-audit/edges.mjs                # 11 synthetic marks/count edge cases
sed -n '...' tmp/kalsallama-pin/tools/server/server-context.cpp ...  (source reads, no writes)
```

## Final verdict

**NO-SHIP.** The arithmetic, the mark semantics, the count semantics and the aggregate fix are all
verified; this is not a math failure. It is a *meaning* failure: the commits publish "prefill/decode"
energy that is, for these seven-minute campaign dirs, inter-rep idle vs load+prefill+decode, and the only
place that could have said so (the column table + the cited numbers) does not. Flip to SHIP after:

1. **F1/F2** — state in `docs/ENERGY-SCHEMA.md` (and in the tool footer) that the boundary sits at
   `window_start + P` and therefore *precedes* the run's prompt processing by the sleep/load/startup
   offset; rename or annotate the columns (`j_prefill` → start-up energy, `j_decode` → includes the entire
   prefill), or implement the mark-anchored split (same right-Riemann rule, boundary measured backwards
   from `mark_N` with the run's own `P`/`G`) and re-generate the 4 sidecars; and re-label the cited
   `J/decode-tok` figures as cross-model absolutes subject to a 12–153 % stem-dependent inflation.
2. **F3** — commit the count provenance: the patch (or a rebuild script), a per-stem `(prompt_n,
   predicted_n)` manifest next to the campaign dir, and a line in the docs saying the counts came from a
   scratch SSE-timings build, not from a "verbose llama-cli run".
3. **F4** — add the consistency guard (reject or warn when the supplied counts contradict the run's own
   speed line / window span).
4. **F5** — replace "~1 Hz / ≤ 1 s" with the measured cadence (max 3.5 s) and scale the edge-uncertainty
   sentence accordingly.
