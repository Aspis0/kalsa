# AUDIT — `moe-expert-usage-v3` held-out expert-usage study

Auditor: hostile re-review. Read-only. Nothing outside `/tmp/audit-moe-v3/` and this file was
written. **No model was run.** All recomputation is read-only Python over the already-committed
router bins (`/tmp/moe-expert-usage-v3/runs/`) and the committed CSVs.

Scripts: `/tmp/audit-moe-v3/{splits.py,leak.py,repro.py,bal.py,honest.py,misc.py,dom.py,final.py,subset2.py,run_repro.py}`
→ `*.log`. Every command was run as `cmd > log 2>&1; echo "EXIT=$?"` with the real exit code
(sections at the end).

Side note on method: importing the subject's `router_data.py` created
`raw/__pycache__/router_data.cpython-314.pyc`; it was deleted and the directory removed, so the
subject tree is byte-identical to how it was found apart from this file.

---

## Overall verdict

**USABLE WITH CAVEATS.** The engineering is much better than the predecessor and the central
scientific correction it was built to make **survives**. Three specific words and one headline
number need fixing; nothing needs re-running.

What I confirmed holds:

* The whole analysis reproduces **bit-for-bit** from the committed scripts plus the router bins:
  `analyze_usage.py` re-run in a sandbox (`ROUTER_OUT_DIR=/tmp/audit-moe-v3/repro`) exits 0 in 98 s
  and writes all four CSVs **identical** to the committed ones (`run_repro.log`).
* Every headline number recomputes from the bins to ≤ 5×10⁻⁷ (`repro.log`, `misc.log`,
  `bal.log`, `final.log`).
* The RAZOR-vs-random-half result — the thing this study was commissioned to establish — is real and
  correct. IT/FR/ES are indistinguishable from a random half (p = 0.28 / 1.00 / 0.71), EN/ZH/MATH/
  CODE are significantly below it. Reproduced exactly.
* The instrument's tensor read is the already-audited one, extended only with per-segment looping
  and new invariants. The predecessor's "CORRECT" verdict carries; I did not re-derive it from the
  engine sources.
* The instrument CANNOT have produced a fake: top-k ↔ weights pairing, k-match, token-count and
  call-count assertions are all in the v3 diff, plus the selections ≡ 8×tokens invariant in the
  validator. The predecessor's "fabricated exit code" class of defect is gone.

What is wrong: the report says "**All inference is held out**" and it is not (F1). It says the
balanced set is "**never** worse than RAZOR anywhere" and it is not (F2). The headline table's
intervals are not confidence intervals on the headline numbers (F3). And 116 is not the number of
hashed files (F6). None of these move the retained-mass numbers by more than ~0.6 pp, and I
quantified that rather than assuming it (F1.2).

---

## Things I attacked and could NOT break (negative results on file)

**0.1 — REFUTED (as a concern): the cross-language content leak does *not* inflate the numbers.**
This was my primary hypothesis and it is wrong. See F1.2 — a properly content-disjoint re-run moves
every language number by ≤ 0.6 pp *downward*.

**0.2 — REFUTED: the analysis is not reproducible / not stale.** Bit-for-bit, exit 0
(`run_repro.log`). The published CSVs match the current bins exactly; `tokens_test` in
`curve_retained_mass.csv` matches a 20-segment split of `full_segs.csv` for all 35 (split, group)
pairs (`repro.log`).

**0.3 — REFUTED: `MIN_SELECTIONS = 16` is too weak a bar to make the "sacrifice-dominated" count
noise.** `dom.log`: the per-layer median is **3.40 at ≥16 selections and still 3.40 at ≥64 and at
≥256**; at ≥1000 it is 3.10. A "dominated" expert holds a median of **5 744 test selections**
(min 143, max 14 917) against a per-expert median of 1 290 overall. The counted experts are not
rounding errors. (The 80 % share threshold *is* load-bearing — that is F7.)

**0.4 — REFUTED: the language labels are wrong or mixed.** Script profile of 4 000 chars per file:
`arb` 99.8 % Arabic, `rus` 97.2 % Cyrillic, `jpn` 62–67 % Kana, `kor` 93–95 % Hangul, `zho`
91–94 % CJK, all seven Latin-script files 100 % Latin. No mislabelling.

**0.5 — REFUTED: markup leftovers in the corpus.** Zero `**`, zero `<tag>`, zero `{{`/`[[`, zero
URLs, zero HTML entities across **all 400 FLORES segments**. The 41 `**` and 41 `<` hits are C++
pointer-dereference and templates in the code group; the 131 `[calc:` are the intended GSM8K
calculator rewrites. (`misc`/markup run.)

**0.6 — REFUTED: code/math near-duplicates.** 40 code segments come from **40 distinct files**
(20 macOS CPython 3.14 stdlib + 20 kalsallama engine sources) and 40 math segments from **40
distinct GSM8K rows**; each math segment is a single problem. Splitting code/math by segment index
is therefore genuinely held out. (`misc.log` §J.)

**0.7 — REFUTED: the RAZOR keep-set mapping.** `kept_expert_indices.json`: 41 keys, every
`main_0…main_39` exactly 128 unique ids in [0,255], zero malformed (`misc.log` §I).
`razor_keep_masks` reads only `main_l` for l in 0…39 — correct layer/expert indexing.

**0.8 — REFUTED: denominators and the top-k mass definition.** `mass` is per-segment
`[40][256]` selected-only mass; `mt[:, mask].sum() / mt.sum()` is the top-k mass share, and
`mt.sum(axis=(1,2))` the per-segment denominator. `bootstrap_ci` clusters on the segment. All
correct. `razor_check.py:41-43` computes removed share as a share of the **selected** mass, matching
the report's wording.

**0.9 — REFUTED: the wsum / selection invariants.** Across all 480 segments, `wsum_min` ≥ 0.0513
and `wsum_max` ≤ 0.9644, i.e. inside (0, 1] as `REPORT.md:47` claims; `ubatches` 1–3 per segment,
consistent with `-ub 256` on 57–384-token segments. Validator: **25 PASS, 0 FAIL**.

**0.10 — REFUTED: exit-code fabrication (the predecessor's F8).** `run_commands.txt` uses
`echo "EXIT=$?"` form, not the typed literal, and honestly records a **non-zero** exit
(`CLI_BUILD_EXIT=2`). `full_exit.txt` contains the captured `FULL_RUN_EXIT=0`. The criticism that
survives is narrower — see F8.

**0.11 — REFUTED: the instrument's read was changed in a way that could bias it.** The v3 diff
keeps the audited strided read (`tok * t->nb[1]` for top-k, `tok * t->nb[2] + r * t->nb[1]` for
weights) and *adds* guards: `router_fail` on non-4-byte element strides, "new top-k while weights
pending", "weights k does not match pending top-k", "weights token count does not match pending
top-k", and per-segment `topk_calls == weights_calls == ubatches`. Strictly more instrumented than
the audited base.

**0.12 — REFUTED: token balance / group size.** Per-group tokens 8 116 (math) … 12 122 (fr),
max/min = **1.494**, matching `REPORT.md:38`. Total **130 975** tokens over 480 segments, matching
`REPORT.md:27`. The report's own "what went wrong #1" (the v1 corpus imbalance) is real and fixed.

**0.13 — REFUTED: the archived corpus is not the corpus that was run.** `raw/corpus/segments.txt`
and `raw/corpus/manifest.csv` hash-match `/tmp/moe-expert-usage-v3/corpus_v2/` exactly and do
**not** match the superseded v1 corpus.

**0.14 — REFUTED: "the balanced set is never worse than RAZOR" in the *mean*.** Balanced beats
RAZOR in 139/140 (split, size, group) cells and in every group mean, including code
(70.0 vs 69.0). The word "never" is still false — F2.

**0.15 — REFUTED: the 3.4 statistic is an artifact of the eligibility filter.** See 0.3. The
artifact is the share threshold, not the count floor — F7.

---

## Findings

### F1 — CONFIRMED. "All inference is held out" is false: 100 % of language test segments have content-identical siblings in another group's calibration. (The numbers survive the fix; the sentence does not.)

`REPORT.md:48`: *"All inference is **held out**: five random calibration/test splits of each group's
segments (20/20)."*

`raw/analyze_usage.py:64-65`:

```python
for g in gidx:
    calib[g], test[g] = split_half(gidx[g], rng)
```

The split is drawn **per group, independently**, from one shared RNG stream. But the corpus is
parallel by construction — `raw/build_corpus.py:37-48` takes block *i* of the same 2 009
line-aligned FLORES sentences in every language (`step = 2009 // 40 = 50`, so IT segment *i* and EN
segment *i* are the same eight sentences, EN/ZH using ten). The split unit is therefore the
*within-group position*, not the *content id*, and the two do not agree.

Measured (`leak.log`):

```
mean over 5 splits, fraction of test segments whose identical FLORES content also sits in another group's calibration
  it 1.000   fr 1.000   es 1.000   en 1.000   zh 1.000
  de 1.000   ja 1.000   ko 1.000   ru 1.000   ar 1.000
  code 0.000   math 0.000
  ... and restricting the leak to KEEP-group calibration only: it/fr/es/en/zh 0.960, de 1.000, ja 0.980, ko 0.990, ru 0.970, ar 0.990

split 0..4: 0.719 / 0.641 / 0.636 / 0.697 / 0.753 of ALL KEEP test tokens
            have content-identical text inside the KEEP calibration pool
```

So for Italian, on average 19 of 20 test segments are translations of sentences the ranker already
saw — in English, French, Spanish or Chinese — while fitting the keep-set. "Held out" is the wrong
word for a design in which the held-out content is, in another language, in the training half.

**F1.2 — the leakage does not inflate the numbers, and I checked rather than assumed.** I re-ran the
whole design with a **content-disjoint** split: the same 20 content ids in calibration for all ten
languages, so no test segment's content appears in any language's calibration. Mean of 5 splits,
% of selected top-k mass retained (`honest.log` §C):

| size | comparator | IT | FR | ES | EN | ZH | CODE | MATH |
|---|---|---|---|---|---|---|---|---|
| 128 | balanced — **published** | 89.4 | 89.3 | 89.9 | 86.6 | 85.3 | 70.0 | 74.7 |
| 128 | balanced — **content-disjoint** | 89.26 | 89.08 | 89.83 | 86.40 | 84.72 | 69.59 | 75.37 |
| 128 | EN-only — content-disjoint | 80.05 | 80.65 | 81.51 | 90.75 | 77.84 | 28.54 | 63.17 |
| 128 | RAZOR — content-disjoint | 49.03 | 50.16 | 50.02 | 58.81 | 54.46 | 69.33 | 58.07 |
| 192 | balanced — content-disjoint | 97.19 | 97.00 | 97.33 | 96.45 | 96.15 | 89.58 | 92.60 |
| 224 | balanced — content-disjoint | 99.10 | 99.03 | 99.14 | 98.88 | 98.70 | 96.31 | 97.79 |

Worst case ZH 85.3 → 84.7 (−0.6 pp); everything else moves ≤ 0.4 pp, in both directions. **The
leak is a design defect in the claim, not an inflation of the result.** The corrected 128-expert
language row is **IT 89.3 / FR 89.1 / ES 89.8 / EN 86.4 / ZH 84.7 / CODE 69.6 / MATH 75.4**.

Verdict: **CONFIRMED** (false sentence, and the design is weaker than advertised) /
**numbers stand**.

### F2 — CONFIRMED. "The balanced set is never worse than RAZOR anywhere" is falsified by the report's own CSV.

`REPORT.md:86-87`: *"The balanced set is never worse than RAZOR anywhere, including code (70.0 vs
69.0 at 128)"*.

`curve_retained_mass.csv` split 4, size 128, group `code`: balanced **0.684…** vs RAZOR
**0.702…** (`final.log` §N prints the per-split code row: balanced `[70.7, 70.9, 69.6, 70.2,
68.4]`, RAZOR `[68.7, 68.7, 68.5, 68.7, 70.2]`). Balanced is worse than RAZOR on code in **1 of
140** (split, size, group) cells. The word "never" is wrong; the substantive claim ("balanced is
never materially worse, and is 20 pp better on the languages") holds. The sentence also invites
the reading that RAZOR's code preservation is *reproduced* by balancing; on split 4 it is not.

Verdict: **CONFIRMED**, one word.

### F3 — CONFIRMED. The intervals in the headline table are not confidence intervals on the headline numbers.

`REPORT.md:59` heads the table *"mean of 5 splits, bootstrap 95% CI"* and the table prints e.g.
`89.4 [88.2,90.5]`. But `summarize.py:43-44`:

```python
lo = sum(x[1] for x in v) / len(v)
hi = sum(x[2] for x in v) / len(v)
```

averages the **lower bounds** and the **upper bounds** of five *independent per-split* bootstraps.
The average of five CIs is not a CI — it is neither an interval for the mean-of-splits (which would
be about ±sd/√5, i.e. ~4× narrower) nor for any single split. `summarize.py:33` is honest about it
(`[bootstrap 95% CI mean]`); the report is not. Secondary problem: the 5 splits are **not
independent** — each re-fits the keep-set and re-scores on test halves drawn from the *same* 40
segments, so the five rows are pseudo-replicates and cannot be treated as repeats.

The bootstrap itself is sound (cluster bootstrap over segments, 2 000 resamples; I reproduced the
endpoints to 0.06 pp with an independent stream, `final.log` §L).

Verdict: **CONFIRMED** — relabel as "mean of 5 per-split 95 % CIs", or publish a proper interval.

### F4 — CONFIRMED. Multiple comparisons are uncorrected, and four of the twelve p-values sit on the Monte-Carlo floor.

`raw/razor_check.py:19,60`:

```python
N_NULL_DRAWS = 20000
p = min(1.0, 2 * (1 + np.sum(np.abs(null_share - null_mean) >= dev)) / (N_NULL_DRAWS + 1))
```

12 groups are tested with no correction. Bonferroni at 12 tests needs p < 4.2×10⁻³; the four
significant sacrifice-language results (DE 4×10⁻⁴, JA/KO/RU 1×10⁻⁴) survive, so this is not fatal —
but the report prints `p <0.001` for the 1×10⁻⁴ rows while **1×10⁻⁴ is the smallest p this
estimator can emit** (2/(N+1) with N = 20 000). Those four entries are censored, not measured.
Secondary: the null is built once from the *whole* 480-segment mass matrix
(`razor_check.py:19-25`) rather than per group; for a random-subset null that is defensible (the
per-group null I recomputed is 50.00 ± 0.63, identical), but the report does not say so.

Verdict: **CONFIRMED** (minor; state the MC floor, apply a correction or say it is uncorrected).

### F5 — CONFIRMED. The report never states the corpus licence, and one balance claim is one-sided.

`REPORT.md:41`: *"license headers stripped"* — that is about the *code* group. The report names
FLORES-200 and GSM8K (`REPORT.md:32,39`) and **never states a single licence for either**, though
FLORES-200 is CC-BY-SA-4.0 and GSM8K is MIT, and the code group mixes CPython (PSF) with
kalsallama. The archived `raw/corpus/flores/flores200_README` contains no licence text either.
For a study whose central artifact is a redistributed third-party corpus, this is a real gap and
the cheapest thing on this list to fix.

`REPORT.md:38` and `REPORT.md:88-90` present the *benefit* of balancing (code 28 → 70) but never
its *cost* to the languages. It is not free (`honest.log` §D, content-disjoint, ranking on the five
languages only, 128 experts):

```
langs-only balanced128 : it=92.53 fr=92.27 es=92.89 en=90.34 zh=90.62 code=26.41 math=59.57
all-7 balanced128      : it=89.26 fr=89.08 es=89.83 en=86.40 zh=84.72 code=69.59 math=75.37
```

Including CODE and MATH in the KEEP score costs the languages **~3.3 pp** (IT 92.5 → 89.3). The
headline 89.4 is the price of the code column, and the report presents the trade-off in one
direction only. That the number *includes* CODE/MATH in the ranking is stated
(`REPORT.md:49-50`) — good — but the reader is left thinking 89.4 is the language-optimal figure.

Verdict: **CONFIRMED**.

### F6 — CONFIRMED. "sha256 of all 116 inputs and outputs" — there are 107 hashes in 116 lines.

`REPORT.md:162`: *"`sha256` of all 116 inputs and outputs (model, corpora, corpus copies,
instrument source and binary, bins, logs, CSVs) in [raw/source_hashes.txt]"*.

`raw/source_hashes.txt` has 116 lines, of which **9 are `#` comments** (`make_hashes.sh` emits
them); the hash entries number **107**. The coverage itself is genuinely good and a large
improvement on the predecessor's 3 hashes: model, RAZOR manifest+config, instrument source + diff
+ **binary**, both corpus downloads, all 20 FLORES files, segments.txt, manifest.csv, the GSM8K
extract, all 60 code source files, all 7 run artifacts, the scripts, and every output CSV. Nothing
material is unhashed.

Verdict: **CONFIRMED**, one number. (Cosmetic: `make_hashes.sh` ends with
`echo "wrote $OUT: $(grep -c . $OUT) lines"` — counting comment lines is the source of the error.)

### F7 — CONFIRMED. "Median 3.4 sacrifice-dominated experts" is a property of the 80 % threshold, not of the model.

`REPORT.md:122-124`: *"an expert counts if it drew ≥16 test selections and ≥80 % of its test mass
comes from {DE, JA, KO, RU, AR}: **median 3.4 of 256 per layer, min 0.6, max 24.0**"*, used to
conclude *"A language-targeted expert pool barely exists."*

The rule is stated, which is good, but the number is entirely threshold-driven (`dom.log` §K2,
per-layer median of the mean over 5 splits):

| rule | median | min | max | mean |
|---|---:|---:|---:|---:|
| ≥16 sel, ≥80 % of mass (**published**) | 3.40 | 0.60 | 24.00 | 5.69 |
| ≥16 sel, ≥90 % | 1.90 | 0.00 | 22.20 | 4.15 |
| ≥16 sel, ≥95 % | 1.00 | 0.00 | 18.40 | 3.20 |
| ≥16 sel, **≥50 %** | **35.00** | 22.80 | 66.80 | 35.90 |
| ≥256 sel, ≥80 % | 3.40 | 0.60 | 24.00 | 5.67 |

The conclusion survives at every threshold (a dedicated pool is a minority of 256 even at 50 %,
where it is 35/256 = 14 %), but "3.4" and the "min 0.6, max 24.0" spread should not be quoted
without the 80 % next to them, and the mean 5.69 vs median 3.40 shows the distribution is
right-skewed with a heavy tail. Note also that `share` is computed over **all 12 groups' test
segments** (`analyze_usage.py:120-124`), so an expert used only by sacrifice languages scores 1.0
by construction — that is the intended semantics and it is documented.

Verdict: **CONFIRMED** (number is threshold-conditional; the qualitative claim is safe).

### F8 — PLAUSIBLE. Exit codes: honest form, but only one of them is a captured artifact.

`run_commands.txt` is a marked improvement on the predecessor — real `echo "EXIT=$?"` form, and it
records a genuine failure (`CLI_BUILD_EXIT=2`, "No rule to make target 'llama-cli'"). But:

* `/tmp/moe-expert-usage-v3/runs/full_exit.txt` contains the captured `FULL_RUN_EXIT=0` — real.
* Everything else (`BUILD_EXIT=0`, `GGUF_DUMP_EXIT=0`, `SIMPLE_EXIT=0`, `EXIT=0` for the
  validator, `RAZOR_EXIT=0`, `ANALYZE_EXIT=0`, `SUMMARIZE_EXIT=0`) exists only as a **comment
  asserting the outcome**, in a file that is itself hashed after the fact. `REPORT.md:158-159`
  presents these as recorded results: *"Real exit codes only: `FULL_RUN_EXIT=0`, validator
  `EXIT=0` … analyses `EXIT=0`. All in [raw/run_commands.txt]"*.

Completion *is* independently evidenced — `validator.log` ends `0 failure(s)` and I re-ran
`analyze_usage.py` myself to exit 0 (`run_repro.log`) — so this is a provenance-formality defect,
not a fabrication. It is still one `echo "EXIT=$?" > exits.txt` away from being airtight.

Verdict: **PLAUSIBLE**.

### F9 — PLAUSIBLE. Every language segment is a cold-start sequence, and two code segments are 57 and 78 tokens. Undiscussed.

`REPORT.md:26-27`: *"each segment is tokenized and evaluated **as its own sequence** (KV cache
cleared between segments)"*. `REPORT.md:148` notes only *"raw text without chat templates"*.

The implication is not drawn anywhere: 100 % of the 400 FLORES segments and 400/400 GSM8K
segments are **sequence-initial** contexts (the smallest is a 57-token code segment, then 78, 78,
110, 110 tokens). Router behaviour on the first ~200 tokens of a context is not established to
match mid-document behaviour, and FLORES segments are 200–384 tokens, so *most of the language
measurement is cold-start routing*. This does not invalidate anything — it is the same protocol as
run 2, so the comparison to RAZOR remains internally valid — but "held-out retained mass for
Kalsa's needs" is being read off a distribution dominated by prompt-position effects, and the
report does not say so.

Verdict: **PLAUSIBLE** (unquantified; would need a packed-continuation run to settle).

### F10 — PLAUSIBLE. "~35 null-sd above random" is not an effect size, and the metric's denominator is 18.5 % of router mass.

`REPORT.md:85`: *"at 128 the balanced set is ~35 null-sd above random for every KEEP group"*.

The arithmetic is right ((89.4 − 50.0)/1.13 = 34.9). But the null sd is the Monte-Carlo spread of
**keep-set choice with the data held fixed** — `REPORT.md:150` admits this (*"it isolates set
choice, not corpus or token uncertainty"*) — so "35 sd" measures nothing about uncertainty in the
estimate. In absolute terms the margin over a random half is **39.4 pp on a metric that runs from
~25 % (worst 128-subset, per the predecessor) to 100 %**, and the denominator is only the top-8 of
the router. I measured the top-8 share of total router mass directly (`honest.log` §G): IT 0.1850,
FR 0.1848, ES 0.1862, EN 0.1937, ZH 0.1906, CODE 0.1799, MATH 0.1678 — consistent with the "~18 %"
`REPORT.md:141` cites from run 2, and the same order for all groups. So a 10.6 pp language gap
between IT 89.4 and CODE 70.0 is ~1.8 pp of *total* router probability.

Verdict: **PLAUSIBLE** — a misleading framing that survived into the prose, not a wrong number.

### F11 — PLAUSIBLE. `razor_per_layer.csv` is computed, hashed, and then ignored — and it carries the dispersion the report needs.

`raw/razor_per_layer.csv` exists (481 rows) and is in `source_hashes.txt`, but no report sentence
uses it. It shows the IT/FR/ES result is *not* a uniform layer effect (`misc.log`):

```
group  mean   min    max    sd     layers>50%
it    51.75  29.49  86.42  13.11   22/40
fr    50.75  28.85  82.08  12.23   21/40
es    50.31  29.22  77.49  11.69   21/40
code  30.20  15.48  45.78   7.02    0/40
```

Italian sits above 50 % in **22 of 40 layers** with a per-layer sd of 13 pp. The aggregate 50.9 %
with p = 0.28 already says "null", but the honest sentence — "IT is above chance in barely half
its layers, and the per-layer spread is ±13 pp" — is the one a reader needs, and it is the same
defect the predecessor audit raised (F13 there). The report's own dispersion sentence for this
metric does not exist.

Verdict: **PLAUSIBLE**.

### F12 — Minor, CONFIRMED as facts / low severity.

* **`REPORT.md:162` — username leak in an archived log.** `raw/model_load.log:1`:
  `llama_model_loader: loaded meta data … from /Users/marco/kalsa-models/probe/qwen36-35b-a3b-q4/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`.
  `make_hashes.sh:38` scrubs `/Users/marco` from **the hash file only** (`} | sed "s|/Users/marco|~|" > $OUT`);
  the log keeps it. Same latent class as the predecessor's F14. (Secrets sweep over `REPORT.md`,
  all `raw/*.py|*.txt|*.json|*.log`, `raw/instrument/*`, `raw/corpus/*.{txt,csv}`: **zero** hits for
  `hf_*`, `sk-*`, `ghp_`, `AKIA`, `api_key`, `bearer`, `password`, `cookie`. No emails, no IPs.)
* **`raw/build_corpus.py:180-183` — committed defaults do not reproduce the run.** The defaults are
  `--problems-per-seg 2 --code-chars 2400`; the run used `--problems-per-seg 1 --code-chars 950`
  (`run_commands.txt:23-25`). Anyone re-running the script bare gets a different corpus. The flags
  *are* recorded, so this is a documentation defect.
* **No big binaries in the lab.** Largest file is `raw/corpus/segments.txt` at 621 KB; the lab
  totals 4.4 MB. `raw/corpus/code_sources.txt` and `make_hashes.sh` reference `/tmp` paths only.
  Nothing in the lab exceeds the report's own "< 5 MB per file" claim.
* **Dead code.** `analyze_usage.py:12` imports `retained_share`, and `router_data.py:63-72`
  (`retained_share`, `per_segment_totals`) is never called — `analyze_usage.py` inlines both
  instead. Harmless, but two of the three "definitions" a reader would check are not the ones the
  pipeline actually runs.
* **`REPORT.md:41` "kalsallama C/C++ sources (the engine Kalsa actually ships)"** — 20 of the 40
  code segments are macOS CPython 3.14 stdlib modules (`raw/corpus/code_sources.txt:1-20`), which
  is a desktop-interpreter corpus, not a phone assistant's code. The report says this plainly at
  `REPORT.md:42-43`; the headline just has to be read with it.

---

## Metric validity: the wording is honest, and I could not fault it

The brief's angle 5 asked whether the report overclaims. **It does not.** Checked line by line:

* `REPORT.md:11-12` and the title line scope the result to the proxy: *"This study measures
  **router usage mass, not deletion damage**"*.
* `REPORT.md:139-141` names the two confounds the brief cares about — router refill
  (*"deleting expert i promotes its highest-ranked unselected expert r"*), the always-on shared
  expert (`expert_shared_feed_forward_length=512`, *same width as a routed expert*), renormalisation
  — and states that the shares are pre-renormalisation top-8 mass.
* `REPORT.md:143-144`: *"The only real test of a prune is bpb/evals on the pruned model. Nothing
  here predicts perplexity or downstream accuracy."*
* `REPORT.md:145-147`: *"Retained-mass ≠ equal quality: 85–90 % retained mass at 128 could still hurt
  if the missing 10–15 % is concentrated in hard tokens."*
* The title asks *"can a 50 % expert prune keep Kalsa's needs?"* and the verdict line
  (`REPORT.md:3`) answers *"yes on the routing-mass proxy"* — scoped to the proxy in the same
  breath. Given `REPORT.md:143`, I do not call that overreach. The one thing the report should add
  is F5's cost side and F9's cold-start caveat, both of which are limitations of the *evidence*,
  not of the wording.

The proxy's ceiling is real and the report does not hide it: a random 128-subset already retains
50.0 ± 1.1 % of the top-8 mass (`summary.txt`), so the entire dynamic range the study can express
is 50 % → 100 % on a denominator that is 18.5 % of router mass.

---

## What would make the numbers usable (cheapest first)

1. Change `REPORT.md:48` from "All inference is held out" to "split by segment index within each
   group; because FLORES is parallel, 96–100 % of language test segments have content-identical
   siblings in another group's calibration — we re-ran with a content-disjoint split and every
   number moves by ≤ 0.6 pp (F1.2)". Optionally adopt the content-disjoint split; it is a
   two-line change in `analyze_usage.py:64-65` and it needs no re-run of the model.
2. Delete "never" from `REPORT.md:86` (split 4 code is 68.4 vs 70.2).
3. Relabel the table intervals as the mean of 5 per-split CIs, or publish an interval for the
   mean-of-splits (`summarize.py:33` already says it correctly; only `REPORT.md:59` is wrong).
4. State the corpus licences (FLORES-200 CC-BY-SA-4.0, GSM8K MIT, CPython PSF, kalsallama).
5. Add F5's cost side: the balanced 128-set gives up ~3.3 pp on the five languages relative to a
   language-only ranking, in exchange for code 26 → 70.
6. Put the 80 % threshold next to "median 3.4" every time it is quoted (F7), and mention the
   `razor_per_layer.csv` dispersion — IT above 50 % in 22/40 layers (F11).
7. Fix `REPORT.md:162` to 107 hashes; scrub `model_load.log:1`; `echo "EXIT=$?" > exits.txt` for
   every step, not just the model run.
8. Note in Limits that 100 % of segments are cold-start contexts (F9).

None of 1–8 requires re-running the model.

---

## Commands run (real exit codes)

```
$ python3 splits.py    > splits.log    2>&1; echo "EXIT=$?"  → 0   (v1 exited 1: IndexError, perm is a
                                                              permutation of values not positions; fixed)
$ python3 leak.py      > leak.log      2>&1; echo "EXIT=$?"  → 0
$ python3 repro.py     > repro.log     2>&1; echo "EXIT=$?"  → 0   (all 35 razor rows bit-identical)
$ python3 bal.py       > bal.log       2>&1; echo "EXIT=$?"  → 0   (all 140 balanced rows bit-identical)
$ python3 honest.py    > honest.log    2>&1; echo "EXIT=$?"  → 0   (content-disjoint + LOO + in-sample)
$ python3 misc.py      > misc.log      2>&1; echo "EXIT=$?"  → 0   (razor_check, hashes, manifest, null)
$ python3 dom.py       > dom.log       2>&1; echo "EXIT=$?"  → 0   (dominance-threshold sensitivity)
$ python3 final.py     > final.log     2>&1; echo "EXIT=$?"  → 0   (CI widths, sacrifice row, per-split)
$ python3 subset.py    > subset.log    2>&1; echo "EXIT=$?"  → 0   (superseded: buggy + brute force)
$ python3 subset2.py / selfcheck.py                            → killed by the coordinator (2h38m,
                                                              full CPU); brute-force subset search
                                                              abandoned, replaced by the RNG-stream
                                                              reconstruction in repro.py
$ python3 run_repro.py > run_repro.log 2>&1; echo "EXIT=$?"  → 0   (analyze_usage.py exit=0, 98.0 s,
                                                              all 4 CSVs identical to committed)
```

No model was run. No test suite was run. Nothing was pushed. The only file written outside
`/tmp/audit-moe-v3/` is this audit.
