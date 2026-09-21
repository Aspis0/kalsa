# Flip-check — `scripts/device-energy-sweep.sh`, F1–F5 closure + sequential-edit collision check

Repo: `kalsa-ngram-spec`, branch `energy-framework`. Audited baseline `da3192e`, fixes `4dc7baa`
(F1/F3/F4/F5 + most of F2) and `686fc63` (F2 remainder). Audited state: **`686fc63`**, file md5
`611e88983b68914d4fe4cbddbab55bb8` (888 lines). Date 2026-09-16.
Mode: read-only, scratch under `/tmp/kalsa-flip-sweep/`. **No adb was run against a phone**; `adb` on `PATH`
resolves to `/tmp/kalsa-flip-sweep/bin/adb`, a scripted fake. `git status --porcelain` empty before and after.

Method. The audited file's function prefix was extracted the way the original auditor did
(`awk '/^main\(\) \{/{exit} {print}'`). My extraction of `da3192e` is md5 `4571c3ad1d2976e9cbbab5cec0f7a2e5`,
identical to the md5 the predecessor published — the harness reproduction is byte-exact. The fixed prefix is
md5 `a349bc4c481068611582bb236edeeb0f`. The report heredoc was extracted byte-exact
(md5 `d651c4f0c8cb7fd21b59a5bc3deed29a`) and driven with synthetic phase-data trees.

## F1 — BLOCKER: closed

```
$ /bin/bash --version | head -1
GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)
$ bash -c 'set -u; f(){ local tag="$1" stop="/x/$tag"; echo "ok stop=$stop"; }; f hello'; echo "rc=$?"
bash: tag: unbound variable
rc=127

$ /tmp/kalsa-flip-sweep/h-f1.sh /tmp/kalsa-flip-sweep/scripts/sweep-prefix-audited.sh ...
pre-call global: h-f1.sh: line 19: declare: tag: not found
INVOKE energy_start 'LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2' 7200
/tmp/kalsa-flip-sweep/scripts/sweep-prefix-audited.sh: line 261: tag: unbound variable
driver rc=1

$ /tmp/kalsa-flip-sweep/h-f1.sh /tmp/kalsa-flip-sweep/scripts/sweep-prefix-fixed.sh ...
INVOKE energy_start 'LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2' 7200
energy_start rc=0 SAMPLER_ACTIVE=1 CURRENT_TAG=LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2
INVOKE energy_stop 'LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2'
energy_stop rc=0 SAMPLER_ACTIVE=0 CURRENT_TAG=<unset>
DRIVER DONE
driver rc=0
```

The audited run made **0** fake-adb calls (its `TRACE` file is never created): the death is the first
statement of `energy_start`, before any device action, and `results.txt` stays empty because the error
bypasses `blog`. The fixed run makes 5 device calls (`pkill` + `setsid` start + stopfile kill + 2 pulls) and
pairs start/stop (`SAMPLER_ACTIVE=0` after `energy_stop`). The correction is the split at
`device-energy-sweep.sh:291-292` (`local tag="$1" max_iter="$2"` then `local stop="$BENCH_DIR/stop.energy.$tag"`).

Harness note worth recording: my first driver defined a global `tag`, and the audited line silently read it
(`stop=[/x/LEAKED_VALUE]`, rc=0) — the buggy line *passes* whenever a same-named global happens to exist. A
harness can therefore false-pass the audited revision; the predecessor's F1 diagnosis is not affected, and my
rerun explicitly `unset`s `tag` and proves the global is absent before the call.

Tag completeness (from the fixed trace):

```
$ grep -o 'stop\.energy\.[A-Za-z0-9._-]*' cases/f1/fixed/trace.txt | sort | uniq -c
   3 stop.energy.LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2
$ grep -o '[A-Za-z0-9._-]*\.csv\.pid' cases/f1/fixed/trace.txt | sort | uniq -c
   2 LFM2.5-2.6B-Q4_K_M_primary_t2_p1_a55_t2.csv.pid
```

Three tag-carrying stopfile references, zero tagless; the pidfile appears twice in the fixed script
(`:309` kill + rm) plus the device-side write `echo $$ > "$OUT.pid"` in `scripts/energy-sample.sh`, which
receives `$tag.csv` as `$OUT`. No `stop.energy.` or `.csv.pid` literal in the file is untagged.

## F2 — in-band placement evidence: present, and falsified

Source (`device-energy-sweep.sh:368-369`):

```bash
launcher="sh -c 'grep -E ^Cpus_allowed /proc/self/status; exec ./llama-cli \"\$@\"' _"
[ -n "$mask" ] && launcher="taskset $mask $launcher"
```

`$launcher` is expanded inside the double-quoted `adb shell` argument, so the quotes reach the device intact
and the *remote* shell parses them. Reproduced with real `taskset` in a 4-CPU Linux container, using the
verbatim launcher string handed to `sh -c` exactly as adb hands it to the device shell:

```
################ mask=[3] ################
remote=[... timeout 600 taskset 3 sh -c 'grep -E ^Cpus_allowed /proc/self/status; exec ./llama-cli "$@"' _ -m model.gguf ...]
Cpus_allowed:	3
Cpus_allowed_list:	0-1
CLI-ARGV-START
argv: -m / argv: model.gguf / argv: -f / argv: rep.txt / argv: -n / argv: 256 / argv: -t / argv: 2 / argv: -st / argv: --temp / argv: 0 / argv: --simple-io
CLI-SELF: Cpus_allowed_list:	0-1
[ Prompt: 250.0 t/s | Generation: 3.6 t/s ]
remote-shell rc=0
################ mask=[c] ################   -> Cpus_allowed: c / Cpus_allowed_list: 2-3 / CLI-SELF 2-3
################ mask=[unset] ################ -> Cpus_allowed: f / Cpus_allowed_list: 0-3 / CLI-SELF 0-3
```

The two `Cpus_allowed*` lines are printed by the same process image that then `exec`s the CLI, the CLI's own
`/proc/self/status` reading agrees, and all 12 CLI arguments arrive intact. The report consumes that record
with `observedCpusOf` (`:731`, regex `/^Cpus_allowed_list:\s*(\S+)/m`); I re-ran that regex against the real
container bytes: `"2-3"`, with `speed_of` still matching `Generation: 3.6 t/s`.

Report behaviour, synthetic phase-data trees (`match` / `mismatch` / `absent` / `absent-both`):

```
################ match — in-band agrees with the request ################
 p1 rep=1 mask=3f observed=0-5  warn=—
 p1 rep=2 mask=3f observed=0-5  warn=—      (MASK PLACEMENT WARNING count: 0)
################ mismatch — in-band says the mask was ignored ################
 p1 rep=1 mask=3f observed=0-7  warn=MASK PLACEMENT WARNING: requested 3f, observed 0-7 (in-band)
 ... 6 rows, all a55_t2 reps of p1 and p4   (MASK PLACEMENT WARNING count: 6)
################ absent — one rep lost the in-band record, probe present ################
 p1 rep=2 mask=3f observed=0-5 (probe)  warn=—
################ absent-both — no in-band record and no probe value ################
 p1 rep=1 mask=3f observed=n/a  warn=MASK PLACEMENT WARNING: requested 3f, observed unreadable (probe fallback; in-band record absent)
```

Falsification passes: requested-vs-observed disagreement produces a loud per-row warning naming the source,
and a missing in-band record is printed as an annotated probe fallback, not silence.

**Residual (R1, non-blocking).** The placement warning is built in the `§4` loop (`:734`) and never enters
`group.unstable` (`:655`), so a probe-pass/in-band-fail arm still reaches the headline. In the `mismatch`
tree:

```
$ awk '/^## 6\./{f=1} f' syn/mismatch/REPORT.md | grep -E '^\| LFM2'
| LFM2.5-2.6B-Q4_K_M | control   | none   | 65.000 | 0.880 | n/a%   | n/a%   | n/a |
| LFM2.5-2.6B-Q4_K_M | primary_t2| a55_t2 | 80.000 | 0.700 | 23.1%  | -20.5% | meets rule |
| LFM2.5-2.6B-Q4_K_M | primary_t2| a76_t2 | 65.000 | 0.880 | 0.0%   | 0.0%   | does not meet rule |
```

Six `MASK PLACEMENT WARNING` rows in §4 and a `meets rule` headline in §6. This is only reachable when the
fail-closed probe (`probe_placement`, which aborts the run on a probe mismatch) and the per-rep witness
disagree. One-line hardening if the owner wants the F4 principle applied to the mask witness:

```
group.entries.some((e) => /low-resolution|cadence max|MASK PLACEMENT WARNING/.test(e.row.warnings || ""))
```
(with the placement warning pushed into `e.row.warnings` before the group loop instead of only into the §4
string). I am not calling this a blocker because the required F2 behaviour — positive in-band record plus a
loud per-row mismatch warning — is present and demonstrated.

## F3 — idle floor and arms, same state, recorded for both: closed

Fixed-prefix run of `run_idle_floor` plus a `primary_t2` block (REPS=1, gate forced to wait once):

```
=== event order around the first gated arm ===
TRACE screen_on          <- run_idle_floor wake, before the floor sampler starts
TRACE sampler_start
TRACE sampler_stop
TRACE pull .../idle_floor.csv
TRACE screen_off         <- temperature gate parks the display while cooling
TRACE screen_on          <- new wake after the gate, before probe/meta/arm
TRACE sampler_pkill
TRACE sampler_start      <- arm sampler starts with the display awake
```

```
=== idle-meta.tsv ===
start_screen       end_screen         start_level start_temp_deci end_level end_temp_deci ...
mWakefulness=Awake mWakefulness=Awake 50          290             50        290 ...
=== block-meta.tsv (screen columns) ===
primary_t2 p1 a55_t2 eff=0-5 screen=mWakefulness=Awake -> mWakefulness=Awake
primary_t2 p2 a76_t2 eff=6-7 screen=mWakefulness=Awake -> mWakefulness=Awake
```

The record is a live read, not a constant: with the fake device forced to answer `mWakefulness=Dozing`,
`block-meta`/`idle-meta` carry `Dozing`, and the report renders it in §2 ("Idle screen state: … → …"), §3
(start/end screen) and §4 (`screen start→end`). Run block start is guarded (`:439-440`) and the wake is
guarded (`:434-437`), so an unreadable state aborts rather than being recorded as unknown, and no code path
reaches an arm without the post-gate wake. The audited revision had exactly two `keyevent` calls, both
outside `run_block`; the fixed file has the same two plus the post-gate wake and the two screen reads.

## F4 — stability gate fails closed: closed, and the regex is the splitter's own string

Splitter templates read out of `scripts/energyPhaseSplit.mjs` (not from the report):

```
:261  `${label} bucket low-resolution: ${intervals} interval(s) attributed to ${label} (coverage …%)${LOWRES_TAIL}`
      labels: "decode" (:421/:742), "load+idle" (:483), "prefill" (:484)
:535  `sampler cadence max ${cad.max.toFixed(3)} s exceeds 2 s (edge uncertainty up to one interval)`
```

The report's regex is `/low-resolution|cadence max/`; cross-tested against strings built from those templates:

```
MATCH  decode bucket low-resolution: 2 interval(s) attributed to decode (coverage 4.50/6.50 s = 69%…
MATCH  load+idle bucket low-resolution: 1 interval(s) attributed to load+idle (…
MATCH  prefill bucket low-resolution: 1 interval(s) attributed to prefill (…
MATCH  sampler cadence max 3.512 s exceeds 2 s (edge uncertainty up to one interval)
no     prefill bucket unavailable; j_load_idle includes the v2 PRE phase (…)
no     implied decode power 25.00 W (j_decode / decode_s) outside the 0.1-20 W sanity band - counts wrong?
```

The harness asserts the same emitted strings (`energyPhaseSplitHarness.mjs:100`, `:436`:
`sr[23].includes("prefill bucket low-resolution") && sr[23].includes("decode bucket low-resolution")`).

Gate behaviour, one scenario per path (all with `REPS=3`, verified `expectedReps = 3` reaches the report):

| scenario | §1 group | §6 rule |
|---|---|---|
| missing rep (r3 row deleted) | `usable=2/3`, `**UNINTERPRETABLE**` | `UNINTERPRETABLE` |
| whole `.phases.csv` absent | `reps=none`, `spread=n/a%`, `usable=0/3`, `**UNINTERPRETABLE**` | `UNINTERPRETABLE` |
| stamps absent → speed but no J/token | `usable=0/3`, `**UNINTERPRETABLE**` | `UNINTERPRETABLE` |
| splitter low-resolution warning row | `**UNINTERPRETABLE**` | `UNINTERPRETABLE` |
| splitter cadence warning row | `**UNINTERPRETABLE**` | `UNINTERPRETABLE` |

The gate code at `:654-661` is `!Number.isFinite(spread) || entries.length < expectedReps || usable <
expectedReps || some(!finite(speed) || finite(decode_s) === null) || spread > limit ||
some(/low-resolution|cadence max/)`, so "no data" can no longer render as `stable` (the predecessor's F4b) and
the warnings it prints now gate the frontier (F4c).

## F5 — order-confound table next to the headline: closed

`§5 Order confound and self-consistency` sits immediately before `§6 Frontier`, and reports the same-arm
early/late position step with its n. Baseline vs a +10 % same-arm perturbation (p3, the second `a76_t2`
position, J/token 0.880 → 0.968):

```
=== baseline ===
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a55_t2 | 0.700 | 0.700 |  0.0% | 3/3 | bounded |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a76_t2 | 0.880 | 0.880 |  0.0% | 3/3 | bounded |
=== +10 % on p3 ===
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a55_t2 | 0.700 | 0.700 |  0.0% | 3/3 | bounded |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a76_t2 | 0.880 | 0.968 | 10.0% | 3/3 | **UNINTERPRETABLE** |
=== §6 under the same perturbation ===
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a55_t2 | 80.000 | 0.700 | 23.1% | -24.2% | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a76_t2 | 65.000 | 0.924 |  0.0% |   0.0% | UNINTERPRETABLE |
```

The predecessor's F5 artefact — a step in the one arm pair the ABBA exists to bracket, moving the headline
unflagged — is now surfaced and gates the frontier. Side effect to know about: `orderConfoundByModel` is
model-scoped (`:774`, `:835`), so an excessive step anywhere marks every comparison of that model
UNINTERPRETABLE, including the `control` row. Conservative, but broader than the block-scoped block gate.
`pairSpecs` (`:758`) hardcodes the p1/p4 and p2/p3 pairs and is not derived from `block_arm_list`; if the
schedule is ever changed the table would silently report `missing`.

## Collision check (the sequential-edit part)

Two authors edited one file; `git show --stat` for both fix commits is one file each, and
`git log --oneline da3192e..686fc63 -- scripts/device-energy-sweep.sh` lists exactly `4dc7baa` and `686fc63`.

* **No duplicate definitions.** 26 functions at top level, every name once (`grep -oE '^[a-zA-Z_]\w*\(\) \{'`
  → all counts 1). No duplicate helper: `screen_state`, `probe_placement`, `observedCpusOf`, `cpuClockSummary`
  and the three mean helpers each appear once.
* **No dead code.** Every defined function except `main` has at least one call site. `groupsByModel` (removed
  by the F10 fix) has 0 references left; `orderByStem`, `idleMetaRows`, `clocksByStem`,
  `actualOrderByComparison`, `anyUnstable`, `REPORT_GENERATED` are all consumed.
* **One of each mechanism.** One launcher construction (`:368-369`), one `wait_for_temperature_gate`
  definition and one call site (`:432`), one `probe_placement` definition and one call site (`:433`), one
  `generate_report` definition with two reachable call sites (`main:883`, and the partial-report fallback in
  `sweep_cleanup:327`, mutually exclusive via `REPORT_GENERATED`). No second launcher, no second gate, no
  orphan after `main "$@"`.
* Two `trap sweep_cleanup EXIT` sites (`:336` top level, `:870` in `main`) — intentional and pre-existing:
  `device_keepawake_begin` overwrites the shared EXIT trap and `main` re-installs the combined one. Both
  reachable (any abort before `main`'s trap is installed is caught by the first).
* `block-meta.tsv` and `idle-meta.tsv` writers agree with their headers and with the report's index maps
  (16/16 and 8/8 fields; `effective_cpus` at v[6], screen at v[11..12]; idle screen at v[0..1]). All five
  markdown tables in every report variant I generated are well-formed (header/separator/row widths equal).

**What the second edit left inconsistent with the first.** Two things, both display/gating, both in F2's
territory:

* **R1** — the first author's rule is "splitter warnings gate the frontier" (`:655`); the second author added
  a new warning class (`:734`) that is printed but does not gate. Demonstrated above.
* **R2** — `§1` (`:693`) and `§3` (`:718`) print `meta.effectiveCpus`, i.e. the *probe* value, while `§4`
  (`:731-733`) prefers the in-band value. In the `mismatch` tree the report shows `observed CPUs = 0-5` in
  `§1` (the section it tells the reader to read first) and `observed = 0-7` with a warning in `§4` — two
  tables of the same run contradicting each other, with the contradiction only visible in `§4`. One-line
  hardening: use `observedCpusOf(stem, rep) ?? meta.effectiveCpus` (annotated) in `§1`/`§3` too, or print
  the probe column under a name that says so.

Neither inconsistency breaks the audited F1–F5 requirements; both should be fixed before a device run if the
owner wants §1 to be a safe first read.

## Regressions

```
$ cd /Users/marco/Projects/kalsa-ngram-spec
$ bash -n scripts/device-energy-sweep.sh && echo OK
OK
$ git diff --check && echo "tree clean"
tree clean
$ git diff --check da3192e 686fc63 && echo "delta clean"
delta clean
$ awk '/^NODE$/{f=0} f{print} /<<.NODE.$/{f=1}' scripts/device-energy-sweep.sh > /tmp/…/report-committed.mjs
$ md5 /tmp/…/report-committed.mjs
d651c4f0c8cb7fd21b59a5bc3deed29a
$ node --check /tmp/…/report-committed.mjs && echo OK
OK
$ node scripts/energySchemaHarness.mjs | tail -1
=== OVERALL: PASS (77 passed, 0 failed) ===
$ node scripts/energyPhaseSplitHarness.mjs | tail -1
=== OVERALL: PASS (94 passed, 0 failed) ===
$ git status --porcelain            # read-only
(empty)
```

The extracted report JS is the same md5 I used for every synthetic report run, so the gate evidence above was
produced by the committed bytes, not a re-typed copy.

## What I could not test without a device

* Whether toybox `taskset` on the Jelly really maps `3f→0-5`, `c0→6-7`, unset→`0-7`. The container proves the
  launcher mechanism and the report's use of the record; the expected strings are still the design audit's
  on-device readings. `probe_placement` fails closed on any other answer, but it has never run on a phone.
* Whether Android's mksh parses the `sh -c '… "$@"' _` launcher identically to the container's dash (the
  shape is POSIX and quotes survive the adb string by construction, but this was not executed on the device).
* Whether `KEYCODE_WAKEUP` actually lights the panel under the shared 24 h `screen_off_timeout`, and what the
  floor-vs-arm power step is on this panel.
* Every energy number, the absolute idle floor, and the wall-clock cost of a gated arm.

## Verdict

**SHIP** for the audited delta. F1 is closed (the blocker is gone and `energy_start` returns 0 under `set -u`
with tag-complete stopfile/pidfile references), F2's required positive in-band evidence and per-row mismatch
warning are present and falsified both ways, F3's floor and arms are sampled awake with the state recorded,
F4 fails closed on all five paths with the splitter's own warning strings, F5's order-confound table reports
the same-arm step with its n and gates the headline. No duplicate, dead or competing implementation survives
the two sequential edits. Carry R1 and R2 as pre-run hardening, not as blockers: they are two one-line edits
and they concern a probe-pass/in-band-fail contradiction that the fail-closed probe already makes unlikely.
