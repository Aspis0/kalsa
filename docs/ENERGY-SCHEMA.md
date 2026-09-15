# Energy metric schema

Shared contract for the on-device energy harness (sampler, aggregator, and the
per-rep phase splitter). Code lives in `scripts/energySchema.mjs`
(parsing + integration + export row), `scripts/energy-sample.sh` (producer),
`scripts/energyAggregate.mjs` (between-arm table + export writer), and
`scripts/energyPhaseSplit.mjs` (per-rep pre/decode phase split,
`kalsa-energy-rep-v2`).

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

**Honest phase naming**: `j_pre` is model load + inter-rep idle + prompt
eval. The prompt-eval-only J is NOT resolvable at 1 Hz with the model load
inside the window — a future in-engine phase timestamp would be needed.
Between-arm deltas of the same phase stay meaningful (identical arithmetic
per arm), but `j_pre` is not a prefill measurement and must not be quoted as
one.

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
sample. Warnings, not failures: implied decode power (`j_decode / decode_s`)
outside the 0.1–20 W sanity band; sampler cadence max > 2 s.

**Integration**: `energySchema.integrate` on each sub-window (same
right-Riemann sums as the whole-arm J; an interval belongs to its
right-endpoint sample). The interval straddling `decode_start` starts before
the boundary, so it is attributed to `j_pre` ("decode starts strictly after
its start point"); `j_decode` is taken as the exact remainder, so
`j_pre + j_decode` equals the whole-window J exactly (harness-tested), and
`n_pre + n_decode` equals the window's sample count. `w_decode` is the mean
over the decode segment's OWN samples.

**Edge uncertainty**: each phase edge carries up to ONE SAMPLE INTERVAL of
attribution uncertainty. The sampler is ~1 Hz nominal, but the observed
interval reaches 3.5 s under load, so there is no flat "≤ 1 s" claim: edge
uncertainty ≤ max sample interval, and the observed median/max per stem are
in the phases.csv (`cadence_median_s`/`cadence_max_s`, warning past 2 s).

| column             | unit  | meaning                                                     |
|--------------------|-------|-------------------------------------------------------------|
| `run_id`           | —     | the stem (`${model}_${arm}_${prompt}`)                       |
| `rep`              | —     | rep number N (joins `_rN.txt` and `rN` marks)                |
| `window_start_s`   | s     | device uptime of the rep window start (mark_{i-1}; first CSV sample for rep 1) |
| `window_end_s`     | s     | device uptime of the rep window end (mark_N — the rep's END) |
| `duration`         | s     | integrated duration of the whole rep window                  |
| `decode_s`         | s     | nominal decode duration = `gen_tokens / gen tps` (perf eval-time ms when present); the boundary anchor |
| `prefill_est_s`    | s     | `prompt_tokens / prompt tps` — INFORMATIONAL ONLY, drives nothing; empty when not derivable |
| `j_pre`            | J     | energy before `decode_start`: model load + inter-rep idle + prompt eval (not resolvable further) |
| `j_decode`         | J     | energy of `[decode_start, mark_N)`; `j_pre + j_decode` = whole-window J exactly |
| `j_per_tok_decode` | J/tok | `j_decode / gen_tokens` — only when gen_tokens is verifiable and the segment has samples; else empty (relative metric, see above) |
| `prompt_tokens`    | tok   | verified prompt length (perf line > manifest > `--prompt-tokens`); else empty |
| `gen_tokens`       | tok   | verified generated tokens, EOS included (perf line > manifest > `--gen-tokens`); else empty — never assumed from n_predict |
| `w_decode`         | W     | mean `\|V*I\|` over the decode segment's own samples         |
| `n_pre`            | —     | CSV samples with `t` strictly before `decode_start`          |
| `n_decode`         | —     | CSV samples with `t` at/after `decode_start`                 |
| `cadence_median_s` | s     | median inter-sample interval of the stem's whole CSV         |
| `cadence_max_s`    | s     | max inter-sample interval of the stem's whole CSV (warning when > 2 s) |
| `warnings`         | —     | `; `-joined notes (undeterminable boundary, empty segments, degenerate windows, band/cadence warnings) |

`kalsa-energy-rep-v1` was never published outside this repository;
`kalsa-energy-rep-v2` is the first published phases schema.

Consumer note: `<stem>.phases.csv` lives in the campaign dir but is NOT a
sampler CSV — `energyAggregate.mjs` skips `*.phases.csv` when it globs the
dir's `*.csv`, so aggregating after a split is safe.

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
