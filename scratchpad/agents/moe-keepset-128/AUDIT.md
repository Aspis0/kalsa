# AUDIT — `moe-keepset-128` (128-expert keep-set study)

Hostile review of REPORT.md + raw/ (7 scripts, CSVs, logs, run_commands.txt,
source_hashes.txt). Read-only; all experiments under `/tmp/audit-keepset`; no model runs;
every command capped at 5 min; fixed seeds; no exhaustive enumeration.

## Verdict: USABLE WITH CAVEATS

Every headline number reproduces from the CSVs, the content-disjoint split is genuinely
disjoint, the allocation code does what it says (budget exactly 5,120; the three allocation
methods really do produce identical outputs; B is not a silent copy of uniform), and the
parameter arithmetic is independently confirmed from the GGUF header. The caveats: two
misstated statistics (the "+0.4–0.9 pp" gain range and the split-sd ranges), one number with
no artifact behind it (Jaccard 0.93), a handful of wording overclaims, and a provenance gap
in the hash/exit-code record (post-chain edits + a masked `shasum` failure).

---

## F1 — CONFIRMED (positive). Content-disjoint split is really disjoint, and the same 5 splits serve every row.

> REPORT.md:21-23: *"The split is **content-disjoint per audit F1**: the corpus manifest's 40
> FLORES line blocks are shared by all ten languages, so a block is in calibration for all ten
> languages or in test for all ten (20/20 blocks); CODE and MATH split by item (20/20). Five
> splits, seed 20261001."*

Reconstructed with the study's own `k128_common.make_splits` (seed 20261001) and checked
directly (`split_check.py`, EXIT=0):

- All 10 FLORES groups use integer content ids = block start line, and the id **set is
  identical across all ten languages** (40 ids each); code/math are `(group, seg_id)` items
  (40 unique each) — so no language segment can fall through to an independent per-group
  split.
- All 5 splits: **0 disjoint violations** (no content id ever on both sides), every group
  20/20, **test cid sets identical across all 10 FLORES languages** per split, code and math
  cal/test item overlap = 0.
- Line ranges: EN/ZH take 10 sentences (`lines 1350-1359`) where the others take 8
  (`lines 1350-1357`) — same start, nested range, same side → still disjoint. The `len == 40`
  assertion in `k128_common.py:57` would have fired had any language been misaligned.

Same 5 splits for every row: `make_splits` is deterministic (single `random.Random(SEED)` at
`k128_common.py:60`, one call per script), and empirically `tokens_test` is **identical across
all three per-split CSVs in 60/60 (split, group) cells** (`csv_check.py` check 6, EXIT=0).
Selection on calibration only, evaluation on test: `run_weighted.py:22-27` vs
`k128_common.eval_groups` — matches REPORT Design.

## F2 — CONFIRMED (positive). "Per-token normalised" is done right.

> REPORT.md:66: *"Score = Σ_g w_g · (calibration selected mass of g per token)"*

`k128_common.py:83-91`: `score += w * (mass_cal[g].sum(axis=0) / tokens_cal[g])` with
`tokens_cal[g] = float(tokens[calib[g].sum()])` (`run_uniform.py:27`, `run_weighted.py:23`,
`run_alloc.py:69`) — normalisation is by **group calibration token count**, not segment count.
Groups are not token-equal (e.g. test tokens it 5,648 vs fr 5,945), so the distinction is
real and handled correctly.

## F3 — CONFIRMED (positive). Waterline/greedy budget, bounds and ties are correct.

- `run_alloc.py:18` `TOTAL = 40 * 128`; `global_alloc` fills exactly `TOTAL − floor·40` after
  the floor (`run_alloc.py:31-37`); `greedy_alloc` stops at `while picks < TOTAL`
  (`run_alloc.py:54`).
- Every `(split, strategy)` count sum in `alloc_counts.csv` is **exactly 5120** (checked all
  45 cells). Per-layer counts: **min 100, max 180, mean 128.0** → within [floor, 256] for both
  floors 64 and 96; **floors never bind** (min 100 > 96) — REPORT.md:85-86 and :9 correct for
  w=1 (see F9f for the w2/w4 range).
- Ties: `topk_mask` uses `np.argsort(-score, kind="stable")` (`k128_common.py:93`) → lower id
  first; the greedy heap keys are `(-norm, layer, position)` → deterministic, layer-major, the
  same tie order as the flat stable sort in `global_alloc`. No RNG anywhere in the allocation
  code.

## F4 — CONFIRMED. "All three allocation methods give the identical keep-set" — real, and B is not a silent uniform.

- Within the same weight w, `alloc_retained.csv`: **180/180 (split, group, w) cells have
  bit-identical retained shares (6 dp) across `global_f64`, `global_f96`, `greedy`**; max
  spread 0.0. `alloc_counts.csv`: **600/600 (split, layer, w) cells identical** (`alloc_check.py`,
  EXIT=0).
- Not B==uniform: per-layer counts span 100–180 (uniform would be 128 everywhere), and B's
  shares differ from `balanced_u128` on every group (e.g. CODE 69.7 vs 69.1). The identity is
  also theoretically expected (F3: floors slack ⇒ all three reduce to the same
  normalized-score waterline).
- `weighted_w1_u128` in `weighted_sweep.csv` is **exactly** `balanced_u128` — max per-split,
  per-group raw difference 0.0 — confirming REPORT.md:67 *"the sweep's w=1 point is the
  balanced-128 row"*.
- Caveat: keep-masks themselves were never persisted (only per-layer counts), so the identity
  is verified through outputs (shares + counts), not mask files. Sufficient evidence, but not
  literally a keep-set diff.

## F5 — REFUTED (as written). "+0.4–0.9 pp" allocation gain range is wrong at both ends.

> REPORT.md:8-9: *"Non-uniform per-layer allocation at the same 5,120-expert budget adds only
> +0.4–0.9 pp over the uniform split"*

Unrounded means, allocation vs uniform at the same w (computed from `alloc_retained.csv`,
`weighted_sweep.csv`, `uniform_rows.csv`):

| w | Δ lang_mean | Δ CODE | Δ MATH |
|---|---|---|---|
| 1 | +0.395 | +0.584 | +0.260 |
| 2 | +0.343 | +0.895 | +0.453 |
| 4 | +0.379 | **+1.076** | +0.572 |

True range **+0.26 to +1.08 pp**. The stated "+0.4–0.9" misses both the low end (w1 MATH
+0.26) and the high end (w4 CODE **+1.1**, which the merged table itself prints as 81.5 vs
80.5). REPORT.md:86-87's per-metric w=1 figures (+0.4/+0.6/+0.3) are correct, and "small but
consistent" holds: all 15 per-split gains (3 w × 5 splits × 3 metrics) are positive.

**Corrected:** allocation buys **+0.3 to +1.1 pp** (lang +0.34–0.40, CODE +0.58–1.08,
MATH +0.26–0.57). The qualitative conclusion (the budget, not its distribution, binds) stands.

## F6 — REFUTED (as written). The split-sd ranges don't match the CSVs.

> REPORT.md:26-27: *"split-to-split sd of lang_mean is 0.7–1.2 pp, of CODE/MATH 0.7–1.4 pp"*

Sample sd over the 5 splits, all rows (`csv_check.py` / `alloc_check.py`):

- lang_mean: **0.11 … 1.27** (min `balanced_u224` 0.11; max `global_w4_f64` 1.27)
- CODE: **0.23 … 1.59** (`balanced_u224` 0.23; `global_w1_f64`/`greedy_w1` 1.59 —
  `balanced_u128` itself 1.58, already above the claimed 1.4 ceiling)
- MATH: **0.17 … 1.19**

Restricting to 128-size selection rows still gives lang 0.54–1.27 and CODE 0.72–1.59. The
sentence is wrong under either ddof and under any obvious row subset; the underlying
variability is still small (≤1.6 pp), so no conclusion flips.

**Corrected:** sd ranges are lang 0.11–1.27, CODE 0.23–1.59, MATH 0.17–1.19 pp (ddof=1).

## F7 — CONFIRMED (unsupported). "Jaccard 0.93" has no artifact.

> REPORT.md:87: *"(mean Jaccard of kept sets vs uniform 0.93)"*

`grep -rn jaccard` over the study returns only REPORT.md:71 and :87. No script computes a
Jaccard, and no keep-masks are saved (only per-layer counts in `alloc_counts.csv`, from which
Jaccard is not recoverable). The number may be true, but nothing in the artifact set supports
it — v3's audit would flag this as an F6-style claim.

By contrast, the Jaccards REPORT.md:71 attributes to **v3 do check out** against
`moe-expert-usage-v3/raw/topk_overlap.csv` (means over 200 rows): it~en 0.764 → "0.76",
it~zh 0.699 / en~zh 0.693 → "0.69–0.70", zh~code 0.252 → "0.25", zh~math 0.357 → "0.36",
en~code 0.269 → "0.27", en~math 0.428 → "0.43".

## F8 — CONFIRMED (hygiene). Masked hash failure + post-chain edits: the provenance record is incomplete.

> REPORT.md:140-142: *"All commands and their real exit codes (all `EXIT=0`) in
> raw/run_commands.txt; final chain run by raw/run.sh."*
> REPORT.md:143-144: *"sha256 of inputs and outputs … in raw/source_hashes.txt"*

Facts:

- `raw/make_hashes.log:1` — `shasum: ~/Projects/…/raw/../REPORT.md: No such file or
  directory` → **the hash step failed on REPORT.md during the recorded chain run**.
- `raw/make_hashes.log:2` — `wrote … source_hashes.txt: 41 lines`, but the current file has
  **42 non-empty lines / 35 hashes** (the extra line is a REPORT.md hash).
- Exit-code masking: `make_hashes.sh:5` has `set -e`, but the failing `shasum`
  (`make_hashes.sh:29`) sits inside `{ … } | sed` — the pipeline's status is `sed`'s (0), so
  the script exits 0, and `run.sh` dutifully records `run_commands.txt:7` →
  `hashes :: EXIT=0`. The recorded exit code is real but hides a real failure.
- Mtimeline: `run_commands.txt` 17:21:42 < `REPORT.md` 17:29:51 < `source_hashes.txt`
  17:31:11 < `make_hashes.log` 17:32:21. So REPORT.md did not exist when the chain ran (the
  `shasum` error), the REPORT.md hash was appended to `source_hashes.txt` **after** the
  recorded chain by an unlogged command, and `make_hashes.log` was rewritten afterwards — its
  `~` paths can only come from a post-hoc sed, because the script only seds the hash stdout
  (make_hashes.sh:33) while its own stderr/echo would print the expanded `~` path.
- **Mitigation (positive):** I recomputed all 35 recorded hashes against the current tree —
  **every one matches** (including REPORT.md and the 22,134,528,992-byte GGUF); verification
  loop `VERIFY_EXIT=0`, no MISMATCH/MISSING.

**Corrected wording:** the artifact set is internally consistent *now*, but at least two
commands (REPORT hash append, log scrub) ran outside run.sh and are not in run_commands.txt,
and `EXIT=0` for the `hashes` step masks a `shasum` failure.

## F9 — CONFIRMED (wording overclaims). Six sentences the data don't say.

1. **REPORT.md:96** *"MATH cannot reach its 160 value at any weight: it saturates at 84.1
   (w=8)"* — only w ≤ 8 was tested, and the last doubling still gains +2.3 pp (81.8→84.1) with
   the trend (3.8 → 3.3 → 2.3) extrapolating past 160's 84.8 around w≈12–16. "At any weight"
   is an untested extrapolation. (MATH *at w ≤ 8* indeed never reaches 84.8 — REFUTED only the
   universal quantifier.)
2. **REPORT.md:75-76** *"a languages-only prune is nearly as bad for code as EN-only"* —
   w=0.25 CODE = 45.3 vs EN-only 27.2: an 18.1 pp gap is not "nearly as bad".
3. **REPORT.md:118** *"(w=2/w=4 dominate it at equal size)"* — they give up 2.4/6.7 pp of
   lang_mean; this is a trade, not a Pareto domination (the report itself correctly says
   "128 never dominates 160" elsewhere).
4. **REPORT.md:119** *"floors 96 vs 64 vs greedy (provably identical here)"* — identical on
   all 5 tested splits (F4) plus a slackness argument; that is evidence, not proof.
5. **REPORT.md:12** *"if languages must stay ≥ 86 mean, stay at 160"* — contradicted by the
   report's own table: balanced-128 is 86.7 and B waterline 87.1, both ≥ 86. The rule only
   holds jointly with a CODE/MATH bar, which the sentence omits.
6. **REPORT.md:9 / :85-86** *"the … waterline keeps 100–172 experts per layer"* — exact for
   the w=1 rows; across **all** waterline rows the range is **100–180** (`run_alloc.log`, w=4
   split 0 max=180). Verdict sentence (line 9) blends B and C, so the bound is under-stated by
   8 experts for C.
7. **REPORT.md:135** *"The random null is 50.0 ± 1.2 pp"* — mean of `uniform_null.csv`
   `null_sd` = **1.13 pp** over all 60 rows (1.02 over the seven KEEP groups; max 1.43; v3
   reports ±1.1). "1.2" is reproduced by no straightforward aggregation. Mean of null means =
   49.99 ✓ "50.0".

## F10 — CONFIRMED (positive). Parameter and GB arithmetic independently verified from the GGUF.

Independent header read with gguf-py (`gguf_check.py`, EXIT=0; `gguf_check.log`):

- routed experts **32,212,254,720** = 40 layers × 256 experts × 3 × 2048 × 512 (gate/up/down
  each 10,737,418,240; per expert **3,145,728** ✓ = REPORT.md:103's "3 × 2048 × 512")
- everything else **2,448,355,968** ✓, incl. the shared expert (160 `*_shexp*` tensors =
  125,911,040) and both untied `token_embd`/`output` (508,559,360 each) — shared expert
  counted as non-expert ✓
- **no MTP tensors** (blk ids 0–39 only; no `mtp`/`predict` names) and no dense-FFN tensors →
  nothing misclassified either way
- total **34,660,610,688** ✓; 128-keep = 2,448,355,968 + 5,120×3,145,728 =
  **18,555,466,368 → 18.55 B** ✓; all four `model_sizes.csv` rows recompute exactly
  (18.554/22.581/26.608/30.634 B → 11.25/9.05/7.98, … GB at 4.85/3.9/3.44 bpw)
- file size 22,134,528,992 B → implied **5.109 bpw** ("5.11", REPORT.md:107 ✓);
  5.109/4.85 = +5.4% → "~5% larger than the Q4_K_M column" ✓
- bpw constants are standard estimates (Q4_K_M 4.85 and IQ3_S 3.44 are the usual cited
  figures; Q3_K_M 3.9 sits at the low end of the commonly cited ~3.9–4.1) and are explicitly
  labelled ESTIMATES (REPORT.md:103-107, :136) — honest; GB is decimal.

Minor: **REPORT.md:108** *"1.9 at Q3_K_M"* — 4.0265 B × 3.9/8 = **1.96 GB → rounds to 2.0**,
not 1.9 (truncation). Also note the headline ~11.3 GB is at 4.85 bpw; at the probe's own
implied 5.11 bpw the pruned file would be ~11.9 GB (the report does disclose the +5%).

## F11 — CONFIRMED (positive). Both anchors do what the report says.

- Leak-anchor: max |diff| vs v3 published = **0.05 pp** (`check_leaky_anchor.log`;
  REPORT.md:30 says "within 0.05 pp" ✓, `ANCHOR OK`, script exits 1 on mismatch).
- Fixed RAZOR vs audit F1.2 content-disjoint row: max **1.13 pp** (MATH) ≤ 1.2 —
  REPORT.md:31-33 ✓.
- Selection rows vs audit F1.2: balanced-128 languages −0.88…−1.38 (IT −1.26, matching
  REPORT.md:33-34's "IT 88.0 vs 89.26"); code −0.51, math −0.65. "~1 pp below" is fair for
  languages (EN-only code is −1.36, but the report only claims languages there).

## F12 — CONFIRMED (positive). Headline numbers all reproduce.

- REPORT's D table vs `merged_curve.csv`: **15/15 rows match cell-for-cell** (programmatic
  compare, `table_check.log`).
- uniform 128 = lang_mean **86.7** / CODE **69.1** / MATH **74.7** ✓;
  C waterline w=2 = **84.3 / 76.3 / 79.0** ✓; w=4 = **80.0 / 81.5 / 82.4** ✓;
  ZH deltas vs balanced: −4.4 (w=2), −11.0 (w=4), −18.3 (w=8) ✓; verdict's 2.4 / 6.7 /
  12.4 pp deltas ✓; per-doubling increments CODE +3.4…+14.0, MATH +2.3…+3.8, lang cost
  1.3…5.5 ✓ (REPORT.md:68-73); merge_table means recompute from the three long CSVs with no
  cell off by >0.06 pp; `merged_curve.csv` sacrifice column = mean of de/ja/ko/ru/ar ✓.
- Design claim (REPORT.md:24-26) that everything was recomputed on the same splits rather
  than copied from v3 holds: values differ from v3's published rows exactly as the split-draw
  offset predicts (F11).

## F13 — hygiene negatives checked, mostly clean.

- No `~` in any output except the intended scrub in `make_hashes.sh:30`; the
  report and hashes use `~` paths as claimed (REPORT.md:144) ✓. `make_hashes.log`'s `~`
  paths are post-hoc scrubbed output (F8), still no home-path leak.
- No API keys/tokens/secrets anywhere in raw/ or REPORT.md (grep) ✓.
- No model runs, no cloud: all scripts are offline analysis over `full_mass.bin` /
  `full_counts.bin` / GGUF metadata ✓ (REPORT.md:140 plausible and consistent with code).
- `run_commands.txt` really is written by `run.sh`'s `run()` at execution time (append per
  step, last touch 17:21:42 = the hashes step) — a genuine capture, subject to F8's masking
  and post-chain edits.
- Trivial: REPORT.md:150 *"`k128_common.py` 118 lines; the rest 37–92"* is true for the
  seven `.py` files (37/49/63/75/86/92 + 118) but excludes `run.sh` (21) and
  `make_hashes.sh` (31).
- Trivial: REPORT.md:142-143 *"null and allocations derived from the same master stream"* —
  each script re-instantiates `random.Random(20261001)`; `run_alloc.py` uses no RNG at all.
  Harmless wording, not a shared stream.

---

## What I attacked and could NOT break (negative results on file)

1. **Leakage** — same-content-on-both-sides: 0 violations across 5 splits, all 12 groups;
   the 8-vs-10-sentence EN/ZH wrinkle does not create cross-language leakage (F1).
2. **B silently equals uniform**: refuted — counts 100–180 vs 128, shares differ on every
   group, per-split gains positive (F4).
3. **Allocation methods differ but report claims identical**: refuted — 180/180 share cells
   and 600/600 count cells identical (F4).
4. **Budget/bounds violations** in the greedy/floor fills: none; all sums exactly 5,120 (F3).
5. **w=1 sweep point ≠ balanced row**: identical to 6 dp on every split/group (F4).
6. **Parameter arithmetic**: recomputed from the GGUF header, matches to the digit (F10).
7. **Hashes stale/edited**: all 35 recorded sha256 match the current tree (F8).
8. **Table numbers ≠ CSVs**: 15/15 rows match; merge means recompute (F12).
9. **v3-cited overlap numbers**: reproduce from `topk_overlap.csv` (F7).

## Corrected numbers (summary)

| Claim | As written | Correct |
|---|---|---|
| Allocation gain range (REPORT:8) | +0.4–0.9 pp | **+0.26 to +1.08 pp** (lang +0.34–0.40, CODE +0.58–1.08, MATH +0.26–0.57) |
| Split-sd lang_mean (REPORT:27) | 0.7–1.2 | **0.11–1.27** |
| Split-sd CODE / MATH (REPORT:27) | 0.7–1.4 / 0.7–1.4 | **0.23–1.59 / 0.17–1.19** |
| Random-null sd (REPORT:135) | ±1.2 pp | **±1.13 pp** (all 60 rows; ±1.02 KEEP groups; v3 says ±1.1) |
| Waterline per-layer range (REPORT:9) | 100–172 | **100–172 for w=1; 100–180 across all w** (min 100 > 96 → floors still slack) |
| 160→128 saving at Q3_K_M (REPORT:108) | 1.9 GB | **1.96 → 2.0 GB** |
| "Jaccard 0.93 vs uniform" (REPORT:87) | stated | **no artifact — drop or compute** |
| 18.55 B / 11.3 GB / per-expert 3.146 M | stated | **confirmed** (11.25 GB at 4.85 bpw; ~11.9 GB at probe-implied 5.11) |

## Commands run (real exit codes)

```
split_check.py  (split reconstruction, disjointness)                EXIT=0
csv_check.py    (w1==balanced, sds, null, tokens_test, merge)       EXIT=0
alloc_check.py  (identical keep-set, gains, per-row sds)            EXIT=0
gguf_check.py   (independent GGUF param/GB recompute)               EXIT=0
python3 final_stats (null aggregation, RAZOR/EN-only vs audit)      EXIT=0
python3 table_check (REPORT D-table vs merged_curve.csv)            EXIT=0
hash verify loop over source_hashes.txt (all 35 files, incl GGUF)   VERIFY_EXIT=0
grep/awk quote-line extractions (REPORT.md, raw/*)                  EXIT=0
first csv_check heredoc, alloc-vs-uniform one-liner (my key bugs)   EXIT=1  (fixed, rerun EXIT=0)
```

No files outside this AUDIT.md were modified; experiments confined to `/tmp/audit-keepset`.
