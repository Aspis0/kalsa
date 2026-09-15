# Energy metric schema

Shared contract for the on-device energy harness (sampler, aggregator, and the
per-rep phase splitter). Code lives in `scripts/energySchema.mjs`
(parsing + integration + export row), `scripts/energy-sample.sh` (producer),
`scripts/energyAggregate.mjs` (between-arm table + export writer), and
`scripts/energyPhaseSplit.mjs` (per-rep prefill/decode disaggregation).

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

## Per-rep schema `kalsa-energy-rep-v1` — PRODUCED by energyPhaseSplit.mjs

One row per rep, joining the sampler CSV with the rep boundary markers
(`${stem}.marks`) so prefill and decode energy separate.
`node scripts/energyPhaseSplit.mjs <dir> [stem ...] [--prompt-tokens N]
[--gen-tokens N]` writes `<dir>/<stem>.phases.csv` and prints a markdown
table per stem.

Verified inputs, from `device-ngram-spec.sh` and campaign data:

- `.marks`: one `r<N> <uptime>` line per rep, written AFTER rep N's llama-cli
  exits — `mark_N` is rep N's **end**, not its start. The value is
  `/proc/uptime` field 1, the same monotonic device clock as the CSV `t_s`
  column: joined as-is, **no conversion**.
- `${stem}_rN.txt`: the run's guaranteed perf info is the single speed line
  `[ Prompt: X t/s | Generation: Y t/s ]`. Upstream `llama_perf_context_print`
  lines ("prompt eval time = ... ms / N tokens", "eval time = ... ms / M runs")
  are used when present; current campaign data contains none.

**Rep windows**: rep 1 = `[first CSV sample, mark_1)`; rep i>1 =
`[mark_{i-1}, mark_i)`. Samples after the last mark (sampler shutdown lag)
belong to no rep. Since windows start where the previous rep ended, rep i>1
contains the harness's inter-rep `sleep 5` and the model load; whatever the
boundary convention puts before prompt-eval-end lands in the prefill bucket.
Phase J is therefore a convention, not a clean physical prefill — but
between-arm deltas of the same phase stay meaningful because every arm gets
identical arithmetic.

**Boundary math**: prefill ends at `window_start + prompt-eval duration`,
where prompt-eval duration is the run's own "prompt eval time" ms when the
perf line exists (preferred: not rounded), else
`prompt_tokens / prompt_tps` from the speed line; decode takes the remainder.
`prompt_tokens`/`gen_tokens` must be verifiable — from the run's own perf
lines, or from `--prompt-tokens`/`--gen-tokens` supplied by the caller (e.g.
measured once on-device with a verbose llama-cli run; never assume
gen_tokens == n_predict — EOS can truncate long before). If neither exists
the phase columns stay empty with a warning; a rep whose .txt is missing or
has no parsable speed/perf line is skipped. Never a guess.

**Integration**: `energySchema.integrate` on each sub-window (same
right-Riemann sums as the whole-arm J). The sample interval straddling the
boundary is attributed to the decode side (an interval belongs to its
right-endpoint sample), so `j_prefill + j_decode` equals the whole-window J
exactly and `prefill_s + decode_s = duration`. An interval belongs to its
right-endpoint sample; the borrowed predecessor sample affects only that one
interval, while `mean_w_*` are means over the phase's OWN samples.

**Edge uncertainty**: the sampler is ~1 Hz, so each phase edge carries ≤ 1
sample (~1 s) of attribution uncertainty — up to ~20 J per edge at the sanity
band's 20 W ceiling, a few J at the G99's typical 2–5 W. Duration per phase
inherits the same ≤ ~1 s.

| column             | unit  | meaning                                                     |
|--------------------|-------|-------------------------------------------------------------|
| `run_id`           | —     | the stem (`${model}_${arm}_${prompt}`)                       |
| `rep`              | —     | rep number N (joins `_rN.txt` and `rN` marks)                |
| `window_start_s`   | s     | device uptime of the rep window start (mark_{i-1}; first CSV sample for rep 1) |
| `duration`         | s     | integrated duration of the whole rep window                  |
| `prefill_s`        | s     | integrated duration of the prefill segment (empty if the boundary is not derivable or the segment has no samples) |
| `decode_s`         | s     | integrated duration of the decode segment (same emptiness rule) |
| `j_prefill`        | J     | integrated energy over the prefill segment                   |
| `j_decode`         | J     | integrated energy over the decode segment                    |
| `j_prefill_per_ptok` | J/tok | `j_prefill / prompt_tokens` — only when prompt_tokens is verifiable and the segment has samples; else empty |
| `j_per_tok_decode` | J/tok | `j_decode / gen_tokens` — only when gen_tokens is verifiable and the segment has samples; else empty (relative metric, see above) |
| `prompt_tokens`    | tok   | verified prompt length (run's perf line or `--prompt-tokens`); else empty |
| `gen_tokens`       | tok   | verified generated tokens (run's perf line or `--gen-tokens`); else empty — never assumed from n_predict |
| `mean_w_prefill`   | W     | mean `\|V*I\|` over the prefill segment's own samples        |
| `mean_w_decode`    | W     | mean `\|V*I\|` over the decode segment's own samples         |
| `n_samples_prefill`| —     | CSV samples with `t` strictly before the boundary            |
| `n_samples_decode` | —     | CSV samples with `t` at/after the boundary                   |
| `warnings`         | —     | `; `-joined notes (undeterminable boundary, empty segments, degenerate windows) |

Consumer note: `<stem>.phases.csv` lives in the campaign dir but is NOT a
sampler CSV — `energyAggregate.mjs` lists every `*.csv`, so run the aggregate
before splitting (or on a dir without `.phases.csv` files).

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
