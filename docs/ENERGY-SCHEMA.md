# Energy metric schema

Shared contract for the on-device energy harness (sampler, aggregator, and the
per-rep phase splitter). Code lives in `scripts/energySchema.mjs`
(parsing + integration + export row), `scripts/energy-sample.sh` (producer),
`scripts/energyAggregate.mjs` (between-arm table + export writer), and
`scripts/energyPhaseSplit.mjs` (per-rep v2 fallback and stamped
load-idle/prefill/decode split, schemas `kalsa-energy-rep-v2` and
`kalsa-energy-rep-v3`).

## Read this first: the metric is RELATIVE

Power is `|V*I|` at the battery terminal with ~1 s gauge smoothing, sampled
over the WHOLE arm window (load + prefill + reps). The window is identical
across arms of the same (model, prompt), so **between-arm deltas are
meaningful and absolute values are not**: display/radio floor dilutes J, so J
deltas run smaller than tok/s deltas. Never quote absolute J/token from this
harness.

## Sampler CSV v1 — FROZEN

Produced on-device by `scripts/energy-sample.sh` (1 Hz nominal cadence; the
sampled `t_s` is authoritative since the loop cost drifts the real period).

| column             | unit  | meaning                                              |
|--------------------|-------|------------------------------------------------------|
| `t_s`              | s     | `/proc/uptime` on the device (NOT wall-clock)         |
| `current_uA`       | µA    | battery current (sign = charge/discharge)            |
| `voltage_uV`       | µV    | battery voltage                                       |
| `batt_temp_deciC`  | 0.1 °C| battery temperature (slow, coarse throttle signal)    |
| `status`           | —     | `Discharging` / `Charging` / … (free text)            |
| `cpu_freqs_kHz`    | kHz   | per-CPU `scaling_cur_freq`, colon-joined              |

`t_s` being uptime means it is monotonic within one boot but is not an
absolute sample time: durations computed from it are exact, timestamps are
not portable. Invariants enforced by `parseEnergyCsv` (audit of c5fae2f):

- the file must end with `\n`; a torn last line (pull during write) is dropped;
  a 0-byte file is an `empty file`, not a torn one;
- strict field regex; non-conforming rows are dropped and counted in
  `skipped`;
- `t` must be non-decreasing; a smaller `t` (device reboot) drops the row and
  raises a warning;
- power sanity band 0.1–20 W on the mean — outside it is a unit-mismatch
  warning, not an error.

Charging is not filtered: power is `|V*I|`, so a sample taken while the
battery charges would count as consumption. Campaigns abort on charge during
preflight (and re-check mid-run); the sampler's `status` column stays in the
CSV for post-hoc verification of any window.

This schema is **frozen**: the sampler writes exactly these columns; new
signals mean a v2 with a new header, not edits here.

## Per-rep schema `kalsa-energy-rep-v2` — PRODUCED by energyPhaseSplit.mjs

One row per rep, joining the sampler CSV with the rep boundary markers
(`${stem}.marks`) so each rep's energy splits into a PRE phase and a DECODE
phase. `node scripts/energyPhaseSplit.mjs <dir> [stem ...]
[--counts-manifest file] [--prompt-tokens N] [--gen-tokens N]` writes
`<dir>/<stem>.phases.csv` (same filename pattern as v1) and prints a
markdown table per stem.

**Why v2 exists (v1 retracted)**: v1 (commits `572d3be`/`f936c16`, never
published) placed the prefill/decode boundary at `window_start + prompt-eval
duration`. The run's startup — inter-rep sleep, process spawn, model load —
sits between the window start and the real prompt processing, so the v1
"prefill" bucket was inter-rep idle (0.03–1.1 W) in 8/12 campaign reps and
`j_decode` carried load + prefill + decode (audit
`ENERGY-PHASE-AUDIT-2026-09-15`, F1/F2: NO-SHIP). v2 re-anchors the split to
what is exactly derivable and names the phases honestly.

Verified inputs, from `device-ngram-spec.sh` and campaign data:

- `.marks`: one `r<N> <uptime>` line per rep, written AFTER rep N's llama-cli
  exits — `mark_N` is rep N's **end**, not its start. The value is
  `/proc/uptime` field 1, the same monotonic device clock as the CSV `t_s`
  column: joined as-is, **no conversion**. Marks hygiene is fatal:
  out-of-order marks, or a mark before the first CSV sample, refuse the
  whole stem (never silently absorb samples into the wrong window).
- `${stem}_rN.txt`: the run's guaranteed perf info is the single speed line
  `[ Prompt: X t/s | Generation: Y t/s ]`. Upstream `llama_perf_context_print`
  lines ("prompt eval time = ... ms / N tokens", "eval time = ... ms / M runs")
  are used when present; current campaign data contains none.

**Rep windows**: rep 1 = `[first CSV sample, mark_1)`; rep i>1 =
`[mark_{i-1}, mark_i)`. Samples after the last mark (sampler shutdown lag)
belong to no rep. Since windows start where the previous rep ended, rep i>1
contains the harness's inter-rep `sleep 5` and the model load — which is
exactly why the PRE phase below is named honestly instead of "prefill".

**Boundary math**: decode duration per rep = `gen_tokens / gen tps` from the
rep's OWN speed line (the perf `eval time` ms when present — not rounded).
Decode occupies the LAST `decode_s` seconds of the window ending at
`mark_N`: `decode = [mark_N − decode_s, mark_N)`. Everything before it is
the PRE phase. `prefill_est_s` (`prompt_tokens / prompt tps`) is
INFORMATIONAL ONLY and drives nothing.

**What `j_decode` actually integrates (exact interval set)**: exactly the
intervals fully inside `[decode_start, mark_N)` — equivalently, the intervals
whose right-endpoint sample comes strictly after the first sample at/after
`decode_start`. Two one-directional truncations follow, both reading the same
way:

- the interval straddling `decode_start` starts before the boundary and is
  attributed to `j_pre` IN FULL ("decode starts strictly after its start
  point");
- the partial interval between the last window sample and `mark_N` is
  charged to NO bucket.

So `j_decode` is a LOWER bound on the nominal `[decode_start, mark_N)` span:
`j_per_tok_decode` is biased LOW on short decode buckets, never HIGH, short
by at most two sample intervals (one per truncation). The row makes the
truncation visible: `decode_s_int` is the integrated seconds actually
attributed to the decode bucket, and **coverage** = `decode_s_int /
decode_s`. A row warning (`decode bucket low-resolution`) fires when fewer
than 3 intervals are attributed to decode or coverage < 0.7 — the honest
catch for short-decode stems, where the convention (not the physics)
dominates the per-token figure. Deltas between arms of the same stem remain
the sanctioned use: both arms carry the same bias only when their decode
buckets have similar coverage — read `decode_s_int` before comparing arms
with very different decode lengths.

That caveat is normative even though the historical v2 row-warning text ends
at "the sanctioned use": the tracked v2 sidecars retain that wording for
byte identity. Always read `decode_s_int` and compare coverage before using a
low-resolution between-arm delta.

**Honest phase naming**: `j_pre` is model load + inter-rep idle + prompt
eval. The prompt-eval-only J was NOT resolvable at 1 Hz with the model load
inside the v2 window; schema v3 below adds the existing in-engine phase
durations and resolves that split.
Between-arm deltas of the same phase stay meaningful (identical arithmetic
per arm), but `j_pre` is not a prefill measurement and must not be quoted as
one.

**Reading `j_per_tok_decode` (arm-anchored)**: the relative-metric rule
above applies per model+prompt arm. Cross-stem ratios (e.g. 2.6B vs 1.2B)
are the forbidden absolute use: they hold only between REP arms of the same
prompt style — REP-vs-REP only; PURE numbers are low-resolution (see the
row warnings) and must not be quoted against another stem. Any cross-stem
statement needs the arm label and the `decode_s_int` coverage caveat, or it
stays out of a report.

**Token counts provenance (never a guess)**: `--counts-manifest
scripts/fixtures/energy-counts/manifest.csv` is the preferred source — a
tracked per-stem `(prompt_tokens, gen_tokens)` manifest committed next to
the raw count-run outputs; see `scripts/fixtures/energy-counts/README.md`
for the SSE-timings provenance and the diagnostic-build method. The run's
own `llama_perf_context_print` lines still win when present;
`--prompt-tokens`/`--gen-tokens` remain a caller-verified fallback and warn
that the manifest is preferred. Counting requires a diagnostic
server-timings build — the pristine CLI cannot print token counts, so a
"verbose llama-cli run" is NOT a usable count source. Without any count
source the phase columns stay empty with a warning; a rep whose .txt is
missing or has no parsable speed/perf line is skipped. Never a guess.

**Guards** (exit 1): decode duration ≥ window duration; `gen_tokens ≤ 0`
with a count source present; out-of-order marks; a mark before the first CSV
sample. Warnings, not failures: decode bucket low-resolution (fewer than 3
intervals attributed to decode, or `decode_s_int` < 0.7 × `decode_s`);
implied decode power (`j_decode / decode_s`) outside the 0.1–20 W sanity
band; sampler cadence max > 2 s.

**Integration**: `energySchema.integrate` on each sub-window (same
right-Riemann sums as the whole-arm J; an interval belongs to its
right-endpoint sample). The decode bucket is exactly the intervals fully
inside `[decode_start, mark_N)` — right-endpoint samples strictly after the
first sample at/after `decode_start` (see Boundary math above
for the two one-directional truncations); `j_decode` is taken as the exact
remainder, so `j_pre + j_decode` equals the whole-window J exactly
(harness-tested), and `n_pre + n_decode` equals the window's sample count.
`w_decode` is the mean `|V*I|` over the decode segment's own samples —
which INCLUDES the boundary sample (the first sample at/after
`decode_start`) whose interval energy is charged to `j_pre`. Therefore
`w_decode ≠ j_decode / decode_s` by construction (audit: up to 59% apart on
a 3-sample bucket): `w_decode` is a plain power average over the segment's
samples, while `j_decode / decode_s` is the energy rate consistent with
`j_per_tok_decode`; on low-resolution buckets quote the latter.

**Edge uncertainty**: each phase edge carries up to ONE SAMPLE INTERVAL of
attribution uncertainty. The sampler is ~1 Hz nominal, but the observed
interval reaches 3.5 s under load, so there is no flat "≤ 1 s" claim: edge
uncertainty ≤ max sample interval, and the observed median/max per stem are
in the phases.csv (`cadence_median_s`/`cadence_max_s`, warning past 2 s).
On the decode side the two truncations point the SAME way (straddle →
`j_pre`, tail gap → no bucket), so the edge uncertainty is not a symmetric
±: `j_decode` is a lower bound, and its realized size per row is
`decode_s_int` with the low-resolution warning at small coverage.

| column             | unit  | meaning                                                     |
|--------------------|-------|-------------------------------------------------------------|
| `run_id`           | —     | the stem (`${model}_${arm}_${prompt}`)                       |
| `rep`              | —     | rep number N (joins `_rN.txt` and `rN` marks)                |
| `window_start_s`   | s     | device uptime of the rep window start (mark_{i-1}; first CSV sample for rep 1) |
| `window_end_s`     | s     | device uptime of the rep window end (mark_N — the rep's END) |
| `duration`         | s     | integrated duration of the whole rep window                  |
| `decode_s`         | s     | nominal decode duration = `gen_tokens / gen tps` (perf eval-time ms when present); the boundary anchor |
| `decode_s_int`     | s     | integrated seconds actually attributed to the decode bucket (intervals fully inside `[decode_start, mark_N)`; last partial interval before `mark_N` excluded); coverage = `decode_s_int / decode_s`, low-resolution warning below 3 intervals or coverage < 0.7; empty when the segment has no samples |
| `prefill_est_s`    | s     | `prompt_tokens / prompt tps` — INFORMATIONAL ONLY, drives nothing; empty when not derivable |
| `j_pre`            | J     | energy before `decode_start`: model load + inter-rep idle + prompt eval (not resolvable further) |
| `j_decode`         | J     | energy of the intervals fully inside `[decode_start, mark_N)` — NOT the full span: the straddle interval goes to `j_pre` and the last partial interval to no bucket, so this is a LOWER bound biased LOW by at most two sample intervals; `j_pre + j_decode` = whole-window J exactly |
| `j_per_tok_decode` | J/tok | `j_decode / gen_tokens` — only when gen_tokens is verifiable and the segment has samples; else empty (relative metric, see above; biased LOW on short buckets — read `decode_s_int` first) |
| `prompt_tokens`    | tok   | verified prompt length (perf line > manifest > `--prompt-tokens`); else empty |
| `gen_tokens`       | tok   | verified generated tokens, EOS included (perf line > manifest > `--gen-tokens`); else empty — never assumed from n_predict |
| `w_decode`         | W     | mean `\|V*I\|` over the decode segment's own samples — INCLUDES the boundary sample whose interval energy is in `j_pre`, so `w_decode ≠ j_decode / decode_s` (see Integration above) |
| `n_pre`            | —     | CSV samples with `t` strictly before `decode_start`          |
| `n_decode`         | —     | CSV samples with `t` at/after `decode_start`                 |
| `cadence_median_s` | s     | median inter-sample interval of the stem's whole CSV         |
| `cadence_max_s`    | s     | max inter-sample interval of the stem's whole CSV (warning when > 2 s) |
| `warnings`         | —     | `; `-joined notes (undeterminable boundary, empty segments, degenerate windows, low-resolution decode bucket, band/cadence warnings) |

`kalsa-energy-rep-v1` was never published outside this repository;
`kalsa-energy-rep-v2` is the published unstamped phases schema, and
`kalsa-energy-rep-v3` is the engine-stamped schema described below.

Consumer note: `<stem>.phases.csv` lives in the campaign dir but is NOT a
sampler CSV — `energyAggregate.mjs` skips `*.phases.csv` when it globs the
dir's `*.csv`, so aggregating after a split is safe.

## Per-rep schema `kalsa-energy-rep-v3` — ENGINE-STAMPED

Schema v3 is selected for a stem when at least one `${stem}_rN.stamps` file is
present. A fully unstamped stem continues to write the v2 header and rows
unchanged; this is required so the four committed v2 sidecars and archived
campaigns reproduce byte-for-byte. A mixed stem writes v3: rows with a stamp
use the engine boundaries, while rows without one use v2 arithmetic and say so
in their `warnings` cell. A fully unstamped stem reports one fallback line per
emitted row on stderr; a mixed stem records fallback only in the v3 row's
`warnings` cell. This compatibility rule does not change the meaning of v2.

The CLI sidecar has exactly one duration-only line per completed request:

```
phase prompt_n=<int> prompt_ms=<float, 3 decimals> predicted_n=<int> predicted_ms=<float, 3 decimals>
```

The values come from the final timings chunk carrying `finish_reason`. It has
no clock. The harness already joins `mark_N` and `t_s` through `/proc/uptime`,
which is CLOCK_BOOTTIME; adding a CLI clock based on CLOCK_MONOTONIC would
silently drift across suspend. A missing or unreadable stamp is an
instrumentation failure, not a run failure. If the CLI cannot open or write
the sidecar, it fails silently: it writes no stamp line, emits nothing on
stdout or stderr, and continues. The device harness detects the missing or
empty pulled sidecar and logs the rep and expected path through `blog()`.

For a stamped rep ending at `mark_N`, the nominal intervals are:

```
load+idle = [window_start, mark_N - predicted_ms/1000 - prompt_ms/1000)
prefill   = [mark_N - predicted_ms/1000 - prompt_ms/1000,
             mark_N - predicted_ms/1000)
decode    = [mark_N - predicted_ms/1000, mark_N)
```

`mark_N` is written after the CLI process exits, so both reconstructed
boundaries are late by a residual lag. The lag covers final streaming work,
the speed-line print, process teardown, and the `adb shell` round trip. Its
direction is one-way: the decode bucket contains that teardown, the first part
of real decode energy sits in prefill, and the first part of prompt processing
sits in load+idle. The lag is not measured. On this geometry, a plausible
0.05–0.5 s lag is about 0.07–15% of decode because the committed decode
durations span 71.111 s down to 3.297 s; the short fast-end bucket dominates
the range. It can also be up to about 10% of a short prefill. The mark is
restored to the v2 order before the stamp pull, so v3 and v2 remain comparable
on the decode side, but their residual lags are not identical: v3 removes the
host-side output, speed, and log checks before the mark and adds the sidecar
write inside the CLI. In this geometry that makes v3 a few milliseconds
smaller, so the direction favours v3. No timestamp or clock is added to the
stamp line.

The `prefill` bucket is named precisely: it is prompt evaluation through the
first generated token. The model's mmap page faults caused by the first prompt
therefore land in `prefill`, not in `load+idle`. `load+idle` is only the
earlier remainder of the rep window, including inter-rep idle and any model
loading before the prompt is accepted.

The sampler still uses right-Riemann integration. An interval is assigned to a
bucket only when its full sample interval lies inside that bucket. The
interval straddling a boundary is assigned to the earlier bucket; the partial
interval from the last sample to `mark_N` is assigned to no bucket. Thus every
sampled interval belongs to exactly one of the three buckets and the tool
computes `j_decode` as the exact remaining J after `j_load_idle` and
`j_prefill`: `j_load_idle + j_prefill + j_decode` equals the whole-window J
exactly. The `_s_int` columns expose the sampler-integrated seconds actually
attributed to each bucket, and coverage is `_s_int / _s` for each nominal
bucket. A low-resolution warning uses the v2 discipline for every non-zero
bucket: fewer than 3 attributed intervals or coverage below 0.7. The warning
is per bucket and does not turn an otherwise coherent row into a failure.

Stamped `prompt_n` and `predicted_n` win as the row's count values, but are
cross-checked against any run perf-line or manifest counts. A disagreement is
named in `warnings`; a non-positive, non-safe, or absurd stamped count is a
fatal incoherent-input error. The accepted stamped count range is 1 through
1,000,000,000 tokens.

If a row has no valid stamp, v3 retains the v2 decode anchor
(`gen_tokens / gen tps`, with the perf eval-time value preferred when present).
The entire old v2 PRE energy becomes `j_load_idle`, `j_prefill` is zero, and
the row explicitly says that the prefill bucket is unavailable and that
`j_load_idle` includes prompt evaluation. No prompt phase is invented from
the rounded speed line.

V3 columns are:

| column             | unit  | meaning |
|--------------------|-------|---------|
| `run_id`, `rep` | - | stem and rep number |
| `window_start_s`, `window_end_s` | s | sampler window boundaries; the end is `mark_N` |
| `duration` | s | integrated duration of the sampled rep window |
| `load_idle_s`, `prefill_s`, `decode_s` | s | nominal stamped bucket durations; `prefill_s = prompt_ms/1000`, `decode_s = predicted_ms/1000` |
| `load_idle_s_int`, `prefill_s_int`, `decode_s_int` | s | durations actually covered by full sampler intervals in each bucket |
| `j_load_idle`, `j_prefill`, `j_decode` | J | energy in the three bucket interval sets; their raw sum is the whole-window J; `j_decode` is empty when the decode bucket has no intervals |
| `j_per_tok_decode` | J/tok | `j_decode / gen_tokens`; empty when the decode bucket has no intervals; relative and coverage-limited as in v2 |
| `prompt_tokens`, `gen_tokens` | tok | stamped engine counts when available; otherwise the v2 provenance order |
| `w_decode` | W | mean power over the decode segment's own samples |
| `n_load_idle`, `n_prefill`, `n_decode` | - | sample positions used to describe the three interval regions |
| `cadence_median_s`, `cadence_max_s` | s | whole-CSV sampler cadence |
| `warnings` | - | per-bucket coverage, fallback, cadence, and sanity notes |

V2 figures are not carried over into v3 and must not be relabeled as stamped
numbers. V2's `j_pre` aggregates everything before its approximate decode
anchor: model load, idle, and prompt evaluation. V3 re-anchors decode with the
engine's measured `predicted_ms` and subdivides the preceding energy using the
measured `prompt_ms`; `j_load_idle + j_prefill` is the new, more specific
pre-decode view, not a renamed historical number. Re-anchoring means new
measurements and new comparisons: v2 sidecars remain valid v2 evidence, but
v2 and v3 phase figures are not a continuous numeric series.

## CodeCarbon-compatible export

`node scripts/energyAggregate.mjs <dir> --emissions` writes one
`<dir>/emissions/<stem>_emissions.csv` per arm (stem =
`${model}_${arm}_${prompt}`, same rule as the per-rep txt files) — one file
for EVERY run, no silent skips: a degenerate arm (fewer than two parsed rows,
or no valid power sample) exports a header-only file (header + one all-empty
row) with an explicit `degenerate run, header-only export` warning on
stderr. A write failure never truncates the table: stdout prints in full,
then a clean `emissions export failed: <reason>` line goes to stderr and the
aggregator exits 1. Column names match CodeCarbon's public emissions.csv
schema (MIT) so the files can be ingested by tooling that expects it; the
measured system is the whole SoC at the battery terminal, so there is a
single power/energy pair and no ram/gpu columns.

| column              | unit   | content                                                     |
|---------------------|--------|-------------------------------------------------------------|
| `timestamp`         | ISO8601| host-side generation time of the export. NOT the sample time: CSV `t_s` is device uptime, so no absolute sample timestamp exists |
| `project_name`      | —      | always `kalsa`                                              |
| `run_id`            | —      | the CSV stem (`${model}_${arm}_${prompt}`)                  |
| `duration`          | s      | integrated duration (from `t_s` deltas)                     |
| `cpu_power`         | W      | mean `|V*I|` over the window (rounded to 0.01 W)            |
| `cpu_energy`        | kWh    | CodeCarbon's unit: `joules / 3.6e6`                         |
| `emissions`         | kgCO2eq| empty by default (battery-powered, no grid to attribute). If env `KALSA_GRID_G_PER_KWH` is set (gCO2eq/kWh): `cpu_energy * KALSA_GRID_G_PER_KWH / 1000` |
| `os`                | —      | `Android`                                                   |
| `cpu_count`         | —      | present, empty (not collected by the sampler)               |
| `cpu_model`         | —      | present, empty (not collected by the sampler)               |

Value-domain divergence, by design: the columns exist for name-level
compatibility with CodeCarbon's emissions.csv, but `os` is fixed to
`Android` and `cpu_count`/`cpu_model` are deliberately left empty — the
sampler runs on one Android SoC and does not collect host identity. Do not
parse these three values the way a CodeCarbon consumer would.

`KALSA_GRID_G_PER_KWH` is read only when `--emissions` is active. A
non-numeric or non-positive (`<= 0`) value is ignored with a stderr warning
and the emissions cell stays empty.

## Provenance

Column names follow CodeCarbon's public emissions.csv schema (MIT).
