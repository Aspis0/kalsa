# Energy-schema commit audit — `2dbc9a9` (branch `energy-framework`)

Commit: `2dbc9a9 bench(energy): shared schema module + CodeCarbon-compatible emissions export`
Parent: `9e93be6` · Worktree: `/Users/marco/Projects/kalsa-ngram-spec` · Date: 2026-09-15
Mode: read-only adversarial review (no repo file modified, no commit, no push, no adb;
`/Users/marco/Projects/kalsa` untouched). Only this report was written.

## Verdict

**SHIP.** No BLOCKER, no HIGH. The refactor is behavior-preserving: old vs new stdout is
byte-identical (`md5 f8ffe9cf0c9b8aa515ea6983356cbcf5`) on the real campaign dir **and** on 12
synthetic edge-case arms; the extraction is verbatim apart from a variable rename and an
empty-array guard; the joules/kWh/emissions math checks out against the raw CSVs; the harness
exits 0 with 51 non-vacuous checks. What needs fixing is documentation, not the pipeline:
the CodeCarbon column-name promise (F1) and the "one file per arm" promise (F2) are both
inaccurate as written.

| # | Severity | Subject | Verdict |
|---|---|---|---|
| F1 | MEDIUM | `duration_seconds` is not CodeCarbon's column name (`duration`) | CONFIRMED |
| F2 | MEDIUM | `--emissions` writes a file only for arms with ≥2 rows and power; doc says "per arm" | CONFIRMED |
| F3 | MEDIUM | write failure aborts the run mid-table with a raw stack trace | CONFIRMED |
| F4 | MEDIUM | `skipped` is counted but never reported by any caller | CONFIRMED |
| F5 | LOW | module comment says `t <= previous` is dropped; code drops only `t < previous` | CONFIRMED |
| F6 | LOW | upstream repo is GPL-3.0, not AGPL | CONFIRMED |
| F7 | LOW | grid factor accepts 0 and negatives (emissions cell `0` / negative kgCO2eq) | CONFIRMED |
| F8 | LOW | grid env var is read and warns even without `--emissions` | CONFIRMED |
| F9 | LOW | 0-byte CSV is labelled "torn tail dropped" | CONFIRMED |
| F10 | LOW | exported row can be internally inconsistent (`0 kWh` at `0.40 W` for `1.00 s`) | CONFIRMED |
| F11 | LOW | `os`/`cpu_count`/`cpu_model` value domain differs from CodeCarbon | CONFIRMED |
| F12 | LOW | harness has no golden-output test for the table | CONFIRMED |
| F13 | LOW | charging current is counted as consumption; no consumer reads `status` | PLAUSIBLE |
| F14 | PLAUSIBLE (claim) | AGPL provenance: zero lines copied | PLAUSIBLE |

Claims audited one by one:

| Commit claim | Verdict |
|---|---|
| (1) verbatim extraction of parser/integrator into `energySchema.mjs` | CONFIRMED (identical modulo `rs`→`rows`, `tPrev` guard) |
| (2) `energyAggregate.mjs` stdout byte-identical without `--emissions` | CONFIRMED (real dir + 12 fixtures) |
| (3) `--emissions` writes `<dir>/emissions/<stem>_emissions.csv` | CONFIRMED for arms with ≥2 rows and `n_power > 0`; overclaimed for the rest (F2) |
| (4) `docs/ENERGY-SCHEMA.md` schema v1 frozen + reserved per-rep + CodeCarbon mapping + AGPL note | CONFIRMED for the code path; column name (F1) and AGPL label (F6) wrong |
| (5) harness 51 checks PASS | CONFIRMED (51/0, exit 0) |
| (6) diff-empty regression on `device-ngram-spec-out` | CONFIRMED (only the happy path; extended below) |

## 1. Extraction fidelity (scope 1)

`git show 9e93be6:scripts/energyAggregate.mjs` vs `scripts/energySchema.mjs`, normalized diff of
the integration loop:

```
--- old.loop.js
+++ new.loop.js
 let joules = 0, wsum = 0, nP = 0, fwsum = 0, nF = 0, fmin = Infinity;
-let dur = 0, tPrev = rs[0].t, tReg = 0;
-for (const r of rs) {
+let dur = 0, tPrev = rows.length ? rows[0].t : 0, tReg = 0;
+for (const r of rows) {
   if (r.t < tPrev) { tReg++; continue; } // non-monotonic (reboot): drop
```

Everything else is character-identical: row regex `scripts/energySchema.mjs:28` (same
`\d+\.\d+` for `t`, `-?\d*` for the raw i/v/temp strings, `[:\d]*` for the clock field),
`|V*I|` at `uA*uV/1e12` with the same `cur !== 0 && volt !== 0` guard (`:59-68`), per-metric
denominators `nP`/`nF` (`:70-72`), the 0.1–20 W band (`:71-73`), J/rep from `${stem}_r<N>.txt`
(`energyAggregate.mjs:72`), right-Riemann convention (`dt` attached to the arriving sample,
so the first sample contributes 0 s). The only additions are the `skipped` counter and the
`warnings` array, neither of which reaches stdout. Warning order (band, then non-monotonic) is
preserved; verified by the `nonmono_band` fixture, whose two warning lines are identical old/new.

## 2. Regression run by the reviewer (scope 2)

Old script materialized from `git show 9e93be6:scripts/energyAggregate.mjs` into a temp file,
both run against the real dir:

```
$ node $TMP/old.mjs device-ngram-spec-out > old.out   # exit 0
$ node scripts/energyAggregate.mjs device-ngram-spec-out > new.out   # exit 0
$ diff old.out new.out   # (empty)
$ diff old.err new.err   # (empty)
$ md5 -q old.out new.out
f8ffe9cf0c9b8aa515ea6983356cbcf5
f8ffe9cf0c9b8aa515ea6983356cbcf5
```

Real-data table (unchanged):

```
| LFM2.5-1.2B-Instruct-Q4_K_M_ngram-simple_COPY | 89 | 92 | 1.62 | 149 | 75 | 7056742 | 4450000 |
| LFM2.5-1.2B-Instruct-Q4_K_M_ngram-simple_PURE | 34 | 34 | 1.42 |  49 | 25 | 6497059 | 4450000 |
| LFM2.5-1.2B-Instruct-Q4_K_M_none_COPY         | 79 | 81 | 1.93 | 157 | 79 | 7181646 | 4450000 |
| LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE         | 33 | 33 | 1.55 |  52 | 26 | 6989394 | 4450000 |
```

That regression alone is weak: all four real arms are in-band, monotonic and end with `\n`
(checked: last byte `0x0a` on all four), so no warning path executes. I therefore repeated the
differential on 12 synthetic arms — `torn` (no trailing newline), `nonmono_band` (25 W mean + a
reboot row), `single`, `empty` (0 bytes), `headeronly`, `allinvalid`, `charging` (+200 mA),
`freqmissing` (empty clock field, empty i/v mid-file), `crlf_int_t` (CRLF + integer `t_s`),
`dup_t`, `subsec`, `reps_arm` (with `_r1.txt`/`_r2.txt`). stdout **and** stderr are byte-identical
old/new on all 12, including the warning lines and the `+torn` / `(torn tail dropped)` markers.
The refactor claim holds beyond the happy path.

## 3. Arithmetic and units (scope 3, 4)

Independent recompute straight from the CSV bytes (no module import):

```
simple_COPY | n=89 dur=91.5800 J=149.105904 meanW=1.617410 nP=89 skipped=0 torn=false tReg=0
simple_PURE | n=34 dur=34.2600 J= 49.480360 meanW=1.418739 nP=34 skipped=0 torn=false tReg=0
none_COPY   | n=79 dur=80.9500 J=157.280251 meanW=1.927751 nP=79 skipped=0 torn=false tReg=0
none_PURE   | n=33 dur=33.2100 J= 51.665250 meanW=1.554178 nP=33 skipped=0 torn=false tReg=0
```

The declared example (91.58 s × 1.62 W): `149.105904 J / 3.6e6 = 4.14183e-5 kWh`, written as
`0.0000414183067249692`; `× 400 / 1000 = 1.65673e-5 kgCO2eq = 0.0166 gCO2eq` for that arm.
`mean W × duration = 148.1 J` vs `J = 149.1 J` (0.7% apart) — the gap is the first sample's
zero-length interval, an expected property of the right-Riemann loop, not a bug.
`KALSA_GRID_G_PER_KWH=nope` → `energyAggregate: ignoring non-numeric KALSA_GRID_G_PER_KWH=nope`
on stderr, emissions cell empty, exit 0: as declared in `docs/ENERGY-SCHEMA.md:88`.

Timestamp: the written row is `2026-09-15T21:49:51.873Z` for a run made at 17:49 local (−0400),
i.e. host generation time, while `t_s` in the CSVs is 554416–554508 s of device uptime (6.42
days). `docs/ENERGY-SCHEMA.md:77` states exactly that, and `energySchema.mjs:100`
(`now.toISOString()`) implements it.

Units vs CodeCarbon's own reference (`docs.codecarbon.io/latest/reference/output/`): `duration`
= seconds, `emissions` = kg CO2eq, `cpu_power` = mean CPU power (W), `cpu_energy` = kWh. Our
values and units match those four; the *name* of the duration column does not (F1).

## Findings

### F1 — MEDIUM — `duration_seconds` is not a CodeCarbon column name — CONFIRMED
`scripts/energySchema.mjs:89` exports `"duration_seconds"`; CodeCarbon's emissions CSV uses
`duration` (`examples/emissions.csv` header; `codecarbon/output_methods/emissions_data.py:16,81`;
docs output reference: "duration — Duration of the compute, in seconds"). `docs/ENERGY-SCHEMA.md:70-71`
claims the column names "match CodeCarbon's emissions CSV so the files can be ingested by tooling
that expects it", and `:80` documents the column as `duration_seconds`. Nine of ten names match;
the mismatch is on the first content column. A consumer doing `pandas.read_csv(...)["duration"]`
raises `KeyError`. Fix before any external consumer exists: rename the column to `duration`, or
drop the ingestion claim and call the export "CodeCarbon-derived".

```
ours     : timestamp,project_name,run_id,duration_seconds,cpu_power,cpu_energy,emissions,os,cpu_count,cpu_model
codecarbon: timestamp,project_name,run_id,duration,emissions,emissions_rate,cpu_power,gpu_power,...
```

(Omission of `emissions_rate`, `experiment_id`, the gpu/ram columns and the country fields is
fine for a documented subset; the doc already says so at `:72-73`.)

### F2 — MEDIUM — "one file per arm" is not what the writer does — CONFIRMED
`energyAggregate.mjs:57-68`: the `continue` for `rs.length < 2` fires before the export, and the
export itself is gated on `m.n_power > 0`. On the fixture dir the table lists 12 arms and only 7
emissions files exist: `allinvalid`, `crlf_int_t`, `empty`, `headeronly`, `single` are skipped
without any stderr line (`emissions: wrote ...` appears only for the 7). `docs/ENERGY-SCHEMA.md:68-69`
promises one file per arm. A downstream joiner that assumes one file per arm will silently miss
arms; a one-line stderr note (`emissions: skipped <stem> (too few samples)`) would close it
without touching stdout.

### F3 — MEDIUM — `--emissions` on a read-only dir dies mid-table — CONFIRMED
`energyAggregate.mjs:64` (`mkdirSync`) is unguarded. Reproduced by running the aggregate with
`--emissions` on a `chmod 555` copy of the campaign dir:

```
exit=1 · stdout lines: 2
Error: EACCES: permission denied, mkdir '.../ro/emissions'
    at mkdirSync (node:fs:1334:26)
    at file:///Users/marco/Projects/kalsa-ngram-spec/scripts/energyAggregate.mjs:64:5
```

stdout stops after the header and separator, so a caller that ignores `$?` consumes a truncated
table as if it were complete. The old script could not fail this way. Wrap the write in
try/catch and report the failure on stderr (stdout contract preserved). Note the pre-existing
sibling: `readdirSync` on a non-directory argument throws the same way in both old and new
(`node scripts/energyAggregate.mjs .gitignore` → `node:fs:1554` stack trace, exit 1), so the
class of problem predates this commit.

### F4 — MEDIUM — `skipped` is counted, never reported — CONFIRMED
`energySchema.mjs:34-41` counts non-conforming rows; `energyAggregate.mjs:56` destructures only
`{ rows, torn }`, and no other file consumes the field (`grep -n skipped scripts/energyAggregate.mjs`
→ no match; the harness is the only consumer). Torn tails and reboots warn; garbage rows do not.
The commit message's "rows that do not parse are dropped and counted" is literally true of the
API but buys no operational signal: a campaign whose pull mangled half its rows still prints a
clean table. Emit a stderr warning when `skipped > 0` (stdout stays byte-identical, so claim (2)
survives).

### F5 — LOW — comment says `t <= previous` is dropped; the code drops only `t < previous` — CONFIRMED
`energySchema.mjs:13-16` (copied verbatim from the old header) vs `:53` (`if (r.t < tPrev)`).
Equal timestamps survive, add `dt = 0` and are counted by `nP`, so a duplicated sample nudges
`mean_w` without extending `dur`. The docs wording is the correct one:
`docs/ENERGY-SCHEMA.md:44` says "`t` must be non-decreasing". Mutation test: changing `<` to
`<=` drops the first row of every file and fails 7 harness checks, so the strict comparison is
load-bearing and tested — only the sentence is wrong. Pre-existing, not a refactor drift.

### F6 — LOW — upstream is GPL-3.0, not AGPL — CONFIRMED
`docs/ENERGY-SCHEMA.md:93` and the commit message call `LLM-energy-benchmark` "AGPL". The repo
(`sohampoddar26/LLM-energy-benchmark`) ships a plain `GNU GENERAL PUBLIC LICENSE Version 3` and
GitHub reports `spdx_id: GPL-3.0`. Same copyleft conclusion, wrong label. The rest of the
provenance note (F14) stands.

### F7 — LOW — grid factor has no range validation — CONFIRMED
`energyAggregate.mjs:40-48` accepts any finite number. `KALSA_GRID_G_PER_KWH=0` writes `0` in the
emissions cell instead of an empty one; `-5` writes `-6.872272280537696e-8` kgCO2eq. Tested both.
Cheap guard: treat `<= 0` as unset (or warn) if these files are to be ingested downstream.

### F8 — LOW — the grid env var is read even without `--emissions` — CONFIRMED
`energyAggregate.mjs:40-48` runs unconditionally, so `KALSA_GRID_G_PER_KWH=nope node ... <dir>`
(no flag) prints a warning the old script never printed:

```
$ diff <(KALSA_GRID_G_PER_KWH=nope node $TMP/old.mjs $TMP/real 2>&1 >/dev/null) \
       <(KALSA_GRID_G_PER_KWH=nope node scripts/energyAggregate.mjs $TMP/real 2>&1 >/dev/null)
0a1
> energyAggregate: ignoring non-numeric KALSA_GRID_G_PER_KWH=nope
```

stdout is unaffected (same md5 as the old script), which is what the commit claims, but the
warning is noise when the export was not requested. Move the read inside `if (emissions)`.

### F9 — LOW — an empty CSV is reported as torn — CONFIRMED
`energySchema.mjs:31`: `"".endsWith("\n")` is false, so a 0-byte file is flagged `torn` and the
table prints `| empty | 0 (torn tail dropped) | too few samples |`. `touch`/failed `adb pull`
produces exactly this. Cosmetic; pre-existing in the old script.

### F10 — LOW — an exported row can be internally inconsistent — CONFIRMED
The `freqmissing` fixture (one good sample, one row with empty i/v) passes `n_power > 0` and is
exported as:

```
2026-09-15T21:49:11.249Z,kalsa,freqmissing,1.00,0.40,0,,Android,,
```

`cpu_power = 0.40 W` next to `cpu_energy = 0 kWh` for a 1.00 s window. Both numbers are faithful
to their own metric (`mean_w` = unweighted over valid samples, `joules` = dt-weighted), and the
module documents the per-metric denominators; the export adds no note. Only reachable when a
mid-window read fails, but a downstream sanity check on `energy ≈ power × duration` would trip.
Consider writing `""` for power/energy when the two disagree beyond a tolerance, or document it.

### F11 — LOW — CodeCarbon column names with non-CodeCarbon value domains — CONFIRMED
`energySchema.mjs:110-112` hardcodes `os = "Android"` and leaves `cpu_count`/`cpu_model` empty.
Column names match; CodeCarbon writes e.g. `macOS-12.6-arm64-arm-64bit` and a real core count, so
a consumer that parses `os` or counts cores gets different shapes. Our docs state the values
(`docs/ENERGY-SCHEMA.md:84-86`), so doc and code agree; the risk is only on the ingestion claim
that F1 already qualifies.

### F12 — LOW — the harness does not guard the table format — CONFIRMED
`node scripts/energySchemaHarness.mjs` → 51 PASS / 0 FAIL, exit 0 (reproduced). To test whether
the checks bite, I ran the harness against mutated copies in a temp dir (never in the repo):

| mutation of `energySchema.mjs` / `energyAggregate.mjs` | harness result |
|---|---|
| `uA*uV/1e9` (unit drift) | 6 FAIL — caught |
| drop `Math.abs` on current | 5 FAIL — caught |
| lax row regex `^(.+)$` | 14 FAIL — caught |
| `fmin = 0` instead of `Infinity` | 2 FAIL — caught |
| monotonic check disabled | 3 FAIL — caught |
| band widened to 0–1e9 | 1 FAIL — caught |
| kWh `J/3.6e5` | 2 FAIL — caught |
| emissions without `/1000` | 2 FAIL — caught |
| torn-tail slice removed | 1 FAIL — caught |
| CSV escaping removed | 1 FAIL — caught |
| `--emissions` ignored | 2 FAIL — caught |
| table header renamed (`| ARM | N | SECS |`) | **51 PASS, exit 0 — not caught** |
| `rs.length < 2` guard removed | **51 PASS, exit 0 — not caught** |
| table rounding 2 → 4 decimals | **51 PASS, exit 0 — not caught** |

The 51 checks are assertive about the module and the e2e write path; they assert nothing about
the stdout artifact that claim (2) is about. A golden-fixture test (`spawnSync` the aggregate on
a committed 2-arm fixture dir, `assert.strictEqual(stdout, GOLDEN)`) plus an e2e fixture carrying
a torn and a non-monotonic arm would close the gap. The "51 checks, exits 0" claim itself is
CONFIRMED.

### F13 — LOW — charging energy is indistinguishable in the artifact — PLAUSIBLE
`energySchema.mjs:59-60` takes `|I|·|V|`, and `parseEnergyCsv` returns only `t/i/v/f` — the
`status` column is parsed by nobody, so a charging sample counts as consumption and the aggregate
cannot tell. The campaign script aborts on charge (`scripts/device-ngram-spec.sh:60` preflight,
`:261` mid-run re-check), **except** with `SMOKE=1`, which skips both gates (`:234-236`) while
energy sampling stays on by default (`:168`). A `SMOKE=1` arm CSV that lands in a campaign dir
would be aggregated as ordinary consumption. Not drift (old code identical) and out of scope for
this commit, but worth one sentence in `docs/ENERGY-SCHEMA.md`.

### F14 — PLAUSIBLE — AGPL provenance: zero lines copied — PLAUSIBLE (unprovable from inside)
What can be checked, I checked: the module imports nothing (`energySchema.mjs` has no imports at
all; the aggregate imports `node:fs`, `node:path` and the local module; the harness adds
`node:os`, `node:child_process`, `node:url` only), no npm dependency was added, there is no
attribution header, no vendored snippet, and the upstream project is Python (100% Python + 1.7%
shell), so a line-level copy would be visible. The provenance paragraph is present in both
`energySchema.mjs:24-26` and `docs/ENERGY-SCHEMA.md:90-97`. A claim of "zero lines" cannot be
proven by inspection; nothing contradicts it, and the label it uses for the upstream license is
wrong (F6).

## Edge cases (scope 7)

Each case was executed against old and new; the two agree byte-for-byte in every row.

| case | new behavior | correct? |
|---|---|---|
| 0-byte CSV | `0 (torn tail dropped) \| too few samples` | yes, except the misleading "torn" (F9) |
| header only | `0 \| too few samples` | yes |
| single valid row | `1 \| too few samples`, excluded from the export | yes (guarded, untested by the harness — F12) |
| all rows invalid | `0 \| too few samples`, `skipped` counted internally, nothing reported | yes mechanically; silent (F4) |
| torn tail (no `\n`) | partial line dropped, `+torn` marker, not counted as `skipped` | yes |
| non-monotonic `t` | row dropped, `WARNING: ... dropped 1 non-monotonic row(s)`, durations unaffected | yes |
| duplicate `t` | kept, `dt = 0`, counted in `nP` | yes, but contradicts the comment (F5) |
| current positive (charging) | `|I|`, counted as consumption | yes for the metric; no `status` filter (F13) |
| missing clock field | `sumCPU kHz mean = n/a`, `min = n/a` | yes (tests cover it) |
| empty i/v mid-file | skipped for power only, freqs still counted | yes per-metric; export can look odd (F10) |
| CRLF + integer `t_s` | all rows rejected → `too few samples`, `skipped` counted | yes; sampler always writes LF and `%.2f` uptime |
| sub-second `t` deltas | 0.8 s window integrated correctly (`J` prints `0` at 0 decimals) | yes; small energies round to `0` in the table |

Supporting check for the reserved per-rep schema (`docs/ENERGY-SCHEMA.md:46-64`): `scripts/energyPhaseSplit.mjs`
does not exist (confirmed), the `.marks` files do, and their uptime values fall inside the CSV
window for all four stems (e.g. `simple_COPY`: CSV 554416.38–554507.96, marks 554458.17 and
554503.04) — so the reserved schema is buildable on this data.

## Hygiene (scope 8)

```
$ git diff --name-status 9e93be6 2dbc9a9
A  docs/ENERGY-SCHEMA.md
M  scripts/energyAggregate.mjs
A  scripts/energySchema.mjs
A  scripts/energySchemaHarness.mjs
$ git diff 9e93be6 2dbc9a9 --stat -- package.json package-lock.json
(empty)
```

Exactly the four declared files; no dependency added; no other script holds a second copy of the
parser (`grep -rn "1e12|cpu_freqs_kHz|t_s,current_uA" scripts/` hits only `energy-sample.sh:36`,
the producer). `--emissions` writes into `<campaign>/emissions/`, which is covered by the existing
`device-ngram-spec-out/` ignore rule (`.gitignore:102`), and the aggregate only globs the top
level, so exported files cannot be re-ingested on a second run. Re-running the export is
idempotent apart from the timestamp column (verified).

## Final verdict

**SHIP** — the code does what the commit says, byte-for-byte, on the real data and on the edge
cases; the numbers are right; the harness passes and its checks bite. Two documentation promises
are wrong as written and should be fixed in the same branch before the export is handed to any
external consumer: F1 (rename `duration_seconds` → `duration`, or stop claiming CodeCarbon column
names) and F2 (say "one file per arm with ≥2 samples of valid power", or print the skipped arms).
F3 and F4 are worth a few lines of hardening (try/catch around the write; warn when
`skipped > 0`) because both failure modes are silent. F5–F13 are comment/doc polish.
