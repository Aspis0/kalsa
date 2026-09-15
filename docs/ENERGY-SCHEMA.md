# Energy metric schema

Shared contract for the on-device energy harness (sampler, aggregator, and the
reserved per-rep phase splitter). Code lives in `scripts/energySchema.mjs`
(parsing + integration + export row), `scripts/energy-sample.sh` (producer),
`scripts/energyAggregate.mjs` (between-arm table + export writer).

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

## Per-rep schema `kalsa-energy-rep-v1` — RESERVED (not yet produced)

One row per rep, joining the sampler CSV with the rep boundary markers
(`${stem}.marks`, device uptime) so prefill and decode energy separate. The
schema is reserved now so the exporter and any downstream consumer can rely
on it; the columns will be filled by `scripts/energyPhaseSplit.mjs`, which
does not exist yet.

| column             | unit | meaning                                        |
|--------------------|------|------------------------------------------------|
| `prefill_s`        | s    | duration of the prefill segment of the rep      |
| `decode_s`         | s    | duration of the decode segment of the rep       |
| `j_prefill`        | J    | integrated energy over the prefill segment      |
| `j_decode`         | J    | integrated energy over the decode segment       |
| `j_per_tok_decode` | J/tok| `j_decode / gen_tokens` (relative metric, see above) |
| `prompt_tokens`    | tok  | prompt length of the rep                        |
| `gen_tokens`       | tok  | generated tokens of the rep                     |

Rows with this schema do not exist yet; producing them is the next phase.

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
