# Hostile audit: LANE_MOD equidistribution deliverable

Status: audit in progress. The target code and deliverables are read-only;
this file is the only artifact being written.

Target deliverable: `REPORT.md`, `OUTPUT.txt`, and `lane_mod_check.py` in this
directory. Target implementation: the `GEMV_AUDIT` / `LANE_MOD` classifier in
the current llama.cpp tree, with lineage located through git history.

Requested claim under attack: LANE_MOD is biased by construction via three
synthetic false-tag classes; no archived firings occur in 76 case lines; and
the proposed gap-equality gate removes all three classes.

Findings will be appended with verdicts `CONFIRMED`, `PLAUSIBLE`, or
`REFUTED`.

## 1. Faithfulness against the C classifier

The named `d77e82347` object is present. A zero-context diff of the current
`ggml-opencl.cpp` against d77e82347 shows no changed classifier lines for
`mod_tot`, `mod_bad`, `n_full_bad`, `n_partial`, `lane_hit`, or `LANE_MOD_`.
The current C block is therefore the right source of truth at
`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp:21705-21742`
(the current file has later line shifts from unrelated additions).

Constant-by-constant comparison:

| Python | C | result |
|---|---|---|
| `MOD = 128` (`lane_mod_check.py:45`) | `mods[2] == 128`, `m_mod=mods[mi]` (`ggml-opencl.cpp:21478,21716-21717`) | exact |
| `MIN_TOT = 4` (`:48`, `:66`) | `mod_tot[mi][r] < 4` (`:21721`) | exact |
| `rt >= 0.80` (`:69`) | `rt >= 0.80` (`:21724-21726`) | exact |
| `0.20 < rt < 0.80` (`:72`) | `else if (rt > 0.20)` (`:21727-21729`) | exact |
| `128 % n_full_bad == 0` | `m_mod % n_full_bad == 0` (`:21732`) | exact |
| `period = 128/n_full_bad`, `period >= 2` | C `:21733-21735` | exact |
| suppress on any partial residue | `n_partial == 0` (`:21732`) | exact |

The Python row loop (`lane_mod_check.py:56-73`) also matches the C residue
update (`ggml-opencl.cpp:21569-21574`) for a row-only map repeated over every
`i20`: the C counts are simply multiplied by `ne20`, leaving each rate
unchanged. The outer C `n_bad == 0` gate (`ggml-opencl.cpp:21681-21683`) is
not modeled by `lane_mod_classify`, but every synthetic non-empty map has bad
rows and the empty map returns no tag, so it does not alter these Part B
results.

There is nevertheless a real scope mismatch. C aggregates a two-dimensional
`(i20,i01)` bad matrix; Python accepts only `m` and a one-dimensional
`bad_rows` set. C loops `i20` and `i01` independently (`:21485-21491`) and
increments one residue total per pair. The Python file cannot represent
slot/expert-dependent badness. That omission does not invalidate the three
row-only constructions, but it does invalidate calling the reimplementation
fully faithful for arbitrary C observations.

One smaller reproducibility flaw: `lane_mod_check.py:155` globs
`results/.../run*/*.log`, not specifically run5..run10. In the current archive
only run5..run10 contain matching `GEMV_AUDIT` lines, so the reported count is
unchanged; a future run* log with matching lines would silently enter Part A.

VERDICT: `REFUTED` for a constants/threshold mismatch in the row-only Part B
replay; `CONFIRMED` for the missing C `i20` aggregation dimension and the
over-broad Part A glob.

## 2. The three reported constructions are real

For `m=512`, every residue modulo 128 has exactly four observations. Therefore
the C/Python thresholds simplify sharply: a residue is fully bad only at 4/4,
and one bad observation is 1/4 = 0.25, which is partial and blocks LANE_MOD.

### Union of two mod-64 classes, by hand

The script's `i % 64 in {3,40}` map (`lane_mod_check.py:129-132`) projects to
these mod-128 classes:

- `i % 64 == 3` gives residues `{3,67}`;
- `i % 64 == 40` gives residues `{40,104}`.

Thus `n_full_bad = 4`, every one is 4/4 bad, every other residue is 0/4,
and `n_partial = 0`. The current classifier computes
`128 % 4 == 0`, `period = 128/4 = 32`, and fires `LANE_MOD_32`.
The sorted cyclic gaps are `37,27,37,27`, not 32, so the proposed gate
rejects it. This is a genuine false period-32 tag under the current C
semantics, and it is silent with respect to `BLOCK_RUNS` because the bad rows
are isolated.

The other two maps check out identically:

| map | fully-bad residues mod 128 | `n_full_bad` | current tag | cyclic gaps |
|---|---|---:|---|---|
| band `32 <= i%128 < 64` | 32..63 | 32 | `LANE_MOD_4` | 31 gaps of 1, wrap gap 97 |
| `i%64 in {3,40}` | 3,40,67,104 | 4 | `LANE_MOD_32` | 37,27,37,27 |
| `i%32 in {7,19}` | 7,19,39,51,71,83,103,115 | 8 | `LANE_MOD_16` | 12,20 alternating |

The band co-fires `BLOCK_RUNS` as the deliverable says; the two unions do
not need that secondary tag. The six nominal cosets have all gaps exactly
equal to their inferred period, so the gate preserves those six controls.

VERDICT: `CONFIRMED` — all three deterministic false-tag constructions
reproduce under the actual C thresholds, and the gap-equality gate rejects
these three specific `m=512`, row-only maps without rejecting the six nominal
single-coset controls.

## 3. Gap equality is not a complete discriminator

The requested adversarial construction exists.

### Same archived `m=512` geometry, using C's `i20` aggregation

Take `m=512`, `ne20=5`. Define badness as the union of:

1. for every `i20`, all rows with `i01 % 32 == 5`; and
2. only for `i20==0`, all rows with `i01 % 32 == 6`.

For the primary coset, residues `{5,37,69,101}` are bad on all 5 slots and
have 20/20 rate, so they are fully bad. For the secondary coset, residues
`{6,38,70,102}` are bad on one slot and have 4/20 = exactly 0.20 rate. The C
code uses `else if (rt > 0.20)`, not `>=`, so those residues are neither full
nor partial. The inferred full set is still `{5,37,69,101}`, all cyclic gaps
are 32, and the proposed gate passes `LANE_MOD_32` even though the actual bad
map is a union of two slot-dependent cosets, not one row-only lattice. The
in-memory replay of these exact counts gives `LANE_MOD_32` and gaps
`[32,32,32,32]`.

### Even the one-dimensional model has a threshold-boundary counterexample

With `m=640`, take the union `{i : i % 32 == 5} ∪ {6}`. Every mod-128 residue
has five observations. The primary four residues are 5/5 bad; residue 6 is
1/5 = exactly 0.20 and is ignored by the strict partial test. The full set
still has equal 32-gaps, so the gate passes `LANE_MOD_32` for a non-coset map.
This is a union of a period-32 coset with a sparse period-640 component.

The gate is still valuable: it kills the band and both offset-union examples
at the tested `m=512` row-only geometry. It is not sufficient to claim that
all non-single-coset maps are removed. The needed weakening is “removes the
three tested classes under the m=512 row-only model”; it must not be sold as
a complete empirical single-coset proof.

VERDICT: `CONFIRMED` residual false positives. The gap recommendation stands
as a useful filter, but the deliverable's unqualified “removes all three
classes”/single-coset implication is too broad once actual C aggregation and
the strict 0.20 boundary are admitted.

## 4. Part A archive check

I independently parsed the raw files, without running `lane_mod_check.py` (its
`main()` rewrites `OUTPUT.txt`):

- `run5/run5.log`, `run6/run6.log`, `run7/run7.log`, `run8/run8.log`,
  `run9/run9.log`, and `run10/run10.log`: 12 `GEMV_AUDIT{...}` lines each;
- `_extract_r9r10.txt`: 4 lines;
- total: 76 lines;
- `n_bad != 0`: 0;
- `pattern != ok`: 0;
- all `m`: 512.

Raw spot checks agree: `results/oracle_consumer_s23/run5/run5.log:32,40`
and `run10/run10.log:38,42` show `n_bad=0`, `pattern=ok`, `m=512`.
The extract agrees at `_extract_r9r10.txt:23,28,58,70`. The independent
file-by-file parser found exactly the same `4 + 6*12 = 76` result as
`OUTPUT.txt:6-18`.

This is a clean negative result, not evidence that LANE_MOD is correct: there
are zero positive/any-bad samples, so no real firing can validate or refute
the period inference. The report is right to call the Part A conclusion
“no empirical validation.”

VERDICT: `CONFIRMED` for the 76-case count and the all-`n_bad=0`/all-`ok`
claim in the current archive; `REFUTED` for any implication that this archive
provides a positive empirical test of LANE_MOD.

## 5. Session-2 recommendations

The recommendation in `REPORT.md:138-145` is directionally correct: a full
`(i20,row)` bad-entry list or a 128-entry residue table is enough to recompute
the C ratios and cyclic gaps offline. It must preserve `i20`; deduplicating
to row numbers would hide the slot-dependent counterexample above.

It is not operationally sufficient as written against the current logger.
The C code emits detail only when `n_bad>0` and the process-wide
`n_detail_left` remains positive (`ggml-opencl.cpp:21829-21832`). Defaults are
only four detailed cases and twelve bad rows per case, initialized at
`ggml-opencl.cpp:21336-21337`; both environment values are clamped to 64.
The `GEMV_AUDIT_BAD` records do include `row`, `expert`, and `i20`
(`:21850-21868`), but the default/truncated stream is not a full map and the
summary line never dumps `mod_tot[]`/`mod_bad[]`.

An actionable session-2 protocol therefore needs one of these explicit
actions before the run:

1. emit all 128 `mod_tot/mod_bad` pairs per positive case, preferably with
   the inferred full/partial sets and the cyclic gaps; or
2. configure the detail limits high enough for the planned case count and
   bad-row count, verify that the 64-entry hard caps cannot truncate the
   expected map, and retain every `(i20,row)` `GEMV_AUDIT_BAD` record.

If expected bad maps can exceed 64 cases/rows, only the first option is
actually sufficient. The existing fallback “ratio_clusters + raw dumps” is
not enough unless “raw dumps” means complete, non-truncated bad support.

VERDICT: `PLAUSIBLE` — the session-2 direction is actionable and technically
right, but it needs explicit logger configuration or a compact residue-table
change before it can guarantee an empirical check.

## 6. Edge and lineage checks

The current tree is newer than d77 and contains an unrelated empty-MoE
dispatch guard at `ggml-opencl.cpp:22089-22091` (`src0->ne[1] == 0` returns
before dispatch). Thus the `ne01==0`/`ne01-1` concern is not a current
reachable LANE_MOD issue. The classifier semantics themselves are unchanged
after d77: a zero-context diff finds no changed `mod_tot/mod_bad/n_full_bad`
or `LANE_MOD_` lines.

VERDICT: `REFUTED` for a current empty-row classifier defect; the d77/current
lineage comparison is valid for the claimed positive `m=512` archive.

## Final disposition

The core analysis is sound: the production classifier is demonstrably biased
by construction, and the band, dual-mod-64, and dual-mod-32 false tags all
reproduce under faithful row-only semantics. The proposed gap-equality gate
is worth landing and does suppress those three exact `m=512` controls. But it
is not a complete single-coset proof: strict 0.20 boundary rates and the C
classifier's `(i20,row)` aggregation permit maps that pass the gate while
remaining non-single-coset. The report must narrow the gate claim and make
session-2 dumping operationally complete.

UNSOUND (gap equality misses threshold-boundary and slot-dependent unions; the core BIASED verdict stands)
