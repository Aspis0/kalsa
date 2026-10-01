# Expert-usage study: can a 50% expert prune keep Kalsa's needs?

**Verdict: yes on the routing-mass proxy, with the choice of keep-set doing all the work.**
On held-out segments, a Kalsa-balanced keep-set of 128 of 256 experts per layer (the same
size RAZOR kept) retains **85–90% of the selected top-k routing mass for every one of the five
Kalsa languages and 70–75% for code and math**. The published RAZOR set at the same size
retains only 49–58% for the languages — statistically a random half-split for Italian, French
and Spanish — while being fine for code (69%). Enlarging the balanced set to 192 buys ≥96%
everywhere; 224 buys ~99%. Only ~3.4 of 256 experts per layer (median) are predominantly used
by the sacrifice languages, and code needs its own experts (an EN-only keep-set collapses code
retention to 28%).

This study measures **router usage mass, not deletion damage** — see [Limits](#limits).

## Design (what the hostile audit asked for, and how it was done)

Instrument: the audited `ffn_moe_topk` / `ffn_moe_weights` read (strided top-k view, pre-renorm
softmax mass, per-(layer, microbatch) pairing) from `/tmp/razor-italian-loss/kalsallama`
(engine commit `61c9094811cb200fd475491f18f594fbde77634b`), extended to v3
([raw/instrument/eval-callback.cpp](raw/instrument/eval-callback.cpp),
diff in [raw/instrument/instrument_v3.diff](raw/instrument/instrument_v3.diff)): the file
`segments.txt` holds 480 segments under `<<<SEG group=NAME id=N >>>` headers; each segment is
tokenized and evaluated **as its own sequence** (KV cache cleared between segments), and the
program appends per-segment `[40][256]` selection-count and selected-mass blocks to two binary
streams plus a per-segment CSV ([raw/router_data.py](raw/router_data.py) documents the format).
Per segment, every layer must see the same number of paired topk/weights calls and exactly the
segment's token count, and every top-k weight sum must lie in (0, 1]; violations exit nonzero.
The full run (480 segments, 130,975 tokens, `-ub 256 -ngl 0 -t 10`, CPU, Q4_K_M GGUF) ended
with a real captured exit code `FULL_RUN_EXIT=0` and zero sanity failures.

Corpus (built by [raw/build_corpus.py](raw/build_corpus.py), seed 20261001):

- **Parallel languages** — FLORES-200 dev+devtest (`ita_Latn`, `fra_Latn`, `spa_Latn`,
  `eng_Latn`, `zho_Hans` as KEEP; `deu_Latn`, `jpn_Jpan`, `kor_Hang`, `rus_Cyrl`, `arb_Arab`
  as SACRIFICE). Exactly **40 segments × 8–10 consecutive sentences per language**, blocks
  evenly spaced across the 2,009 line-aligned sentences, so topic is controlled across the ten
  languages (the same news/medicine/… sentences in every language).
- **MATH** — 40 GSM8K train word problems with worked solutions (calculator annotations
  rewritten), one problem per segment.
- **CODE** — 40 segments from 40 distinct files: 20 macOS Python-stdlib modules and 20
  kalsallama C/C++ sources (the engine Kalsa actually ships), license headers stripped.

Groups are 8,116–12,121 tokens each (max/min ratio 1.49; math, the smallest, is 8.1k).
Copy of the corpus and provenance extracts are in [raw/corpus/](raw/corpus/); every corpus
file, the instrument source and binary, and all 116 input/output artifacts are SHA-256 hashed
in [raw/source_hashes.txt](raw/source_hashes.txt) (paths with `~`).

All inference is **held out**: five random calibration/test splits of each group's segments
(20/20). Keep-sets are ranked per layer by selected mass per token, averaged with equal weight
over the 7 KEEP groups (or EN alone for the EN-only variant), **on calibration segments only**;
every reported number is computed on that split's test segments. CIs are percentile bootstrap
over test segments (2,000 resamples); the random null draws 2,000 random keep-sets per size per
layer (the same draws for every group); the RAZOR check uses 20,000 draws. Definitions of the
secondary metrics are stated inline below. The validator
([raw/validate_outputs.py](raw/validate_outputs.py)) fails on uniform per-(group, layer) counts,
on low count diversity, on coverage/manifest mismatches, on per-group token shortfalls, and on
the selections ≡ top-k × tokens invariant (0 violations in 480/480 group-layer checks); final run: 25 PASS,
0 failures, `EXIT=0` ([raw/validator.log](raw/validator.log)).

Model architecture is read from the GGUF itself
([raw/model_metadata.json](raw/model_metadata.json), via the checkout's `gguf_dump`):
arch `qwen35moe`, `block_count=40`, `expert_count=256`, `expert_used_count=8`,
`expert_shared_feed_forward_length=512`; confirmed by a verbose model-load log
([raw/model_load.log](raw/model_load.log), `print_info: n_layer=40, n_expert=256,
n_expert_used=8`). The fork's examples never set the library's log threshold, which is why the
load block is absent from the run log itself — the mechanism behind razor-italian-loss audit F9.

## Held-out retained-mass curve (test segments, mean of 5 splits, bootstrap 95% CI)

Retained share of selected top-k routing mass, aggregated over all 40 layers:

| keep-set size | comparator | IT | FR | ES | EN | ZH | CODE | MATH |
|---|---|---|---|---|---|---|---|---|
| 128 | **balanced (Kalsa)** | **89.4** [88.2,90.5] | **89.3** [88.3,90.3] | **89.9** [88.9,90.9] | **86.6** [85.2,88.0] | **85.3** [84.0,86.5] | **70.0** [66.5,73.2] | **74.7** [73.0,76.4] |
| 160 | balanced | 94.2 | 94.1 | 94.4 | 92.6 | 92.0 | 81.1 | 84.7 |
| 192 | balanced | 97.2 | 97.1 | 97.3 | 96.5 | 96.3 | 89.9 | 92.4 |
| 224 | balanced | 99.1 | 99.1 | 99.2 | 98.9 | 98.7 | 96.4 | 97.7 |
| 128 | EN-only | 80.0 | 80.9 | 81.7 | 91.0 | 78.2 | 28.2 | 62.7 |
| 128 | RAZOR published | 49.2 [47.4,51.0] | 50.5 [48.7,52.4] | 50.7 [48.8,52.5] | 58.0 [55.7,60.4] | 55.6 [53.3,57.7] | 69.0 [65.4,71.8] | 57.5 [55.8,59.2] |
| 128 | random 128-subset (null) | 50.0 ± 1.1 | 50.0 ± 1.1 | 50.0 ± 1.1 | 50.0 ± 0.7 | 50.0 ± 0.9 | 50.0 ± 1.1 | 50.0 ± 1.1 |

Full per-split, per-group rows with CIs: [raw/curve_retained_mass.csv](raw/curve_retained_mass.csv)
and [raw/random_null.csv](raw/random_null.csv). Keep-all (256) is 100% by construction.

Reading: at 128 the balanced set is ~35 null-sd above random for every KEEP group while RAZOR
sits on the null for IT/FR/ES. The balanced set is never worse than RAZOR anywhere, including
code (70.0 vs 69.0 at 128) — RAZOR's calibration demonstrably preserved code experts, and
balancing keeps that property while adding the languages. The EN-only variant shows that
language-only calibration is a trap: code falls to 28%. SACRIFICE languages under the balanced
128-set retain 70.9–78.8% (de 74.0, ja 70.9, ko 71.2, ru 74.6, ar 78.8) — they give up the most
headroom, as intended, but keep majority mass.

## RAZOR check vs the random-half null (all segments; fixed published set, no fitting)

Share of selected top-k routing mass landing on RAZOR-**removed** experts
([raw/razor_check.csv](raw/razor_check.csv), bootstrap CI over segments, two-sided empirical p
against 20,000 random 128-of-256 draws, null = 50.00 ± 0.63):

| group | removed mass | 95% CI | p |
|---|---:|---:|---:|
| IT | 50.9% | [49.6, 52.3] | 0.28 |
| FR | 49.8% | [48.5, 51.2] | 1.00 |
| ES | 49.4% | [48.1, 50.8] | 0.71 |
| EN | 41.5% | [39.8, 43.2] | <0.001 |
| ZH | 44.9% | [43.2, 46.6] | <0.001 |
| CODE | 30.6% | [28.7, 32.8] | <0.001 |
| MATH | 42.6% | [41.3, 43.7] | <0.001 |
| DE | 52.5% | [51.3, 53.8] | <0.001 |
| JA | 55.0% | [53.8, 56.3] | <0.001 |
| KO | 54.2% | [53.0, 55.5] | <0.001 |
| RU | 52.8% | [51.5, 54.1] | <0.001 |
| AR | 50.8% | [49.5, 52.1] | 0.42 |

Run 2's headline does not survive the fixed design: with many segments per language, **IT, FR
and ES are indistinguishable from a random half-split** (run 2's FR +21 pp was a single-document
artifact, exactly what the audit predicted). What remains real: RAZOR's calibration set
preferentially **preserved** EN/ZH/code/math experts (removed share significantly below 50%,
strongest for code at 30.6%) and mildly disfavored DE/JA/KO/RU (52.5–55.0%); AR is null.

## Sacrifice-dominated experts and language top-k overlap

- **Sacrifice-dominated experts** — per layer, an expert counts if it drew ≥16 test selections
  and ≥80% of its test mass comes from {DE, JA, KO, RU, AR}: **median 3.4 of 256 per layer,
  min 0.6, max 24.0** (mean over 5 splits; per-layer rows in
  [raw/sacrifice_dominated.csv](raw/sacrifice_dominated.csv)). A language-targeted expert pool
  barely exists; the sacrifice languages mostly share the generalists.
- **Top-k overlap** — Jaccard overlap of per-group top-128 expert sets (by test mass) per
  layer, averaged over layers and splits ([raw/topk_overlap.csv](raw/topk_overlap.csv)):
  IT~EN 0.76, IT~ZH 0.70, EN~ZH 0.69 — the three Kalsa-heavy languages share one expert pool.
  MATH overlaps them at 0.36–0.43, and **CODE is a distinct pool (0.25–0.27 with every
  language)** — any keep-set chosen from text alone will gut code, as the EN-only row shows.

## Limits

- **Usage frequency/mass is a proxy, not deletion damage.** RAZOR's own paper states that
  routing frequency and output magnitude do not fully describe deletion damage, which depends
  on how surviving experts compensate. After pruning, the router **refills** each deleted slot
  (the card: deleting expert i promotes its highest-ranked unselected expert r), and every
  layer keeps its **shared expert** (`expert_shared_feed_forward_length=512`, same width as a
  routed expert, always active). Our shares are also pre-renormalization softmax mass over the
  top-8 only (~18% of total router mass on average in run 2's measurement).
- **The only real test of a prune is bpb/evals on the pruned model.** Nothing here predicts
  perplexity or downstream accuracy; it bounds which experts Kalsa's workload actually uses.
- Retained-mass ≠ equal quality: 85–90% retained mass at 128 could still hurt if the missing
  10–15% is concentrated in hard tokens; the curve at 192 (≥96% everywhere) prices that hedge.
- Probe model is the Q4_K_M GGUF, not BF16; quantization could shift router distributions.
- Corpus is FLORES prose + GSM8K + stdlib/engine code — not Kalsa's real chat/RAG/app workload,
  and raw text without chat templates (consistent with run 2, so comparable with it).
- Keep-sets are selected on 20 calibration segments per group; split-to-split variation is
  small (per-split rows in the curve CSV), but there is no CI over the corpus draw itself.
- The random null resamples keep-sets with the test mass fixed; it isolates set choice, not
  corpus or token uncertainty.
- RAZOR's own card warns its survivor set depends on the calibration draw — an independent
  RAZOR run reproduces the procedure, not these exact expert ids.

## Hygiene and provenance

- Real exit codes only: `FULL_RUN_EXIT=0`, validator `EXIT=0` (after two validator defects were
  fixed — a NameError and an over-strict diversity threshold that even run-2's valid data would
  have failed; the selections ≡ 8 × tokens invariant was added and passes 480/480),
  analyses `EXIT=0`. All in [raw/run_commands.txt](raw/run_commands.txt).
- `sha256` of all 116 inputs and outputs (model, corpora, corpus copies, instrument source and
  binary, bins, logs, CSVs) in [raw/source_hashes.txt](raw/source_hashes.txt), `~` paths.
- Big artifacts stay under `/tmp/moe-expert-usage-v3/` (FLORES tarball 25.6 MB, GSM8K parquet
  2.3 MB, router bins 19.7 MB each, full log); nothing in the lab exceeds 5 MB per file.
- No HF token, no paid API, no cloud compute, nothing pushed. No test suites were run.
- Run timeline: started 11:10, hit the >2 h rule under external load from other sessions
  (load average 25–64, throughput 30 → 6 tok/s), was frozen with SIGSTOP at 269/480 segments
  for ~40 min and resumed on the coordinator's instruction; finished 13:36 with exit 0. The
  pause touches wall clock only.

## What went wrong (and was fixed along the way)

1. First corpus build (v1) had CODE at ~3.5× the token budget of the language groups and MATH
   at ~2× — caught by per-group token measurement in the smoke run, rebuilt as v2.
2. My own analysis dry-runs competed with the model run for CPU and corrupted two timing
   measurements; a clean window restored ~30 tok/s. Lesson applied: no heavy local compute
   during model runs.
3. The model-load block is missing from this fork's example logs by construction
   (verbosity threshold never wired in examples) — root-caused and replaced with two independent
   architecture records (GGUF metadata dump; `llama-simple -v` load log).
4. A `llama-cli` build failed (the fork renamed its targets); `llama-simple` was used instead.
5. Three numpy boolean-mask/axis bugs in the analysis scripts were caught by dry-running them
   against the 24-segment smoke data before the real data existed.
6. An ubatch A/B (-ub 512) initially looked 2× slower; per-segment timestamps showed the
   slowdown was system noise, not the ubatch size. Stayed with run 2's `-ub 256`.
