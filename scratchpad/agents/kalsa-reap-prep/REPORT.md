# REPORT — kalsa-reap-prep (2026-09-29)

Preparation only. No pod created, nothing spent, no phones, no push. All
verification ran on the Mac against downloaded metadata only (config, index,
26 shard headers, tokenizer, transformers source) — no model weights.

## Pins (all read live today)

| thing | value |
|---|---|
| pruning pipeline | `anik-jha/moep` @ `fdc9a3fc025236bfbc48e050e23e46d0562a5956` (MIT, HEAD 2026-08-03) |
| REAP fork (reference) | `hqta1110/reap` @ `711033277033b8111c3b9f89cd07f2dfc97a2aef` (Apache-2.0) |
| upstream (rejected) | `CerebrasResearch/reap` @ `1970473` — MODEL_ATTRS still has no `Qwen3_5Moe*`; issue search `qwen3_5` = 0 |
| GGUF converter | `Aspis0/kalsallama` main @ `e8065c7cfd0daed1b64a94353ff8d2e0edfbc4da` (converter registers the arch; `-hmx` spike does not — that is the "which and why") |
| transformers | 5.16.0 — `qwen3_5_moe` absent in 4.57.6 (raw file 404), present from the 5.x line; matches the fork commit's own note. The config's `transformers_version: 4.57.1` field is misleading |
| pod env | torch 2.7.1, transformers 5.16.0, accelerate 1.10.0, safetensors 0.5.3, hub[cli] 0.34.4, datasets 3.6.0 (moep lockfile pins 4.55.0 — stale vs its own commit message; we pin 5.16.0 and verified class names against its source) |
| source model | `Qwen/Qwen3.6-35B-A3B`, 26 shards, index total_size 71,903,645,408 B |

## Verification log (commands → exit codes)

- `python3 verify/verify_attrs.py` → **EXIT=0**, 19/19 PASS: arch name,
  text geometry (256/8/512/2048/40), layer-0 expert/router shapes read from
  the real shard headers, hqta1110 grouped entries, moep regexes, transformers
  class definitions, mtp load-ignore, param sum 35,951,822,704 == index.
- `python3 verify/param_table.py qwen36-meta/tensor-shapes.json` → **EXIT=0**;
  table reproduced in docs/PARAM-BUDGET.md; Q4_K_M factor 1.0155 anchored to
  unsloth's measured 22,134,528,992 B file.
- `calib/build_calib.py` (venv py3.12, datasets 3.6.0) → **EXIT=0**,
  `OK: 1280 rows` — IT 384 / EN 280 / ES 204 / FR 204 / ZH 208; chat 820 /
  reasoning 240 / code 120 (EN) / toolcall 100 (EN); skips short=576 dupe=16
  multi5=0 (first run exited 1 on a name-key guard bug — fixed, re-run clean).
- Template check: `apply_chat_template` (transformers 5.16, torch-less venv)
  on sampled rows of every (lang, category) → `<|im_start|>` framing
  everywhere; 1,280 rows tokenize to avg 319, max 3,181 tokens, 0 over the
  4096 pack → ~409k profiled tokens.
- `bash -n pod/*.sh` → all 7 OK. `shellcheck -x pod/*.sh` → **EXIT=0** after
  fixing SC2012 (find not ls) and SC2034 (unused var).
- `PYTHONPATH=moep/src python3 -c "import moep.cli ..."` → adapter resolves
  on the real config: `Qwen3_5MoeAdapter, experts 256, top_k 8, layers 40`;
  expert tensor → `expert_fused`, `mtp.*` → `drop`.
- `ast.parse` on the three python files → OK; module imports OK.

## Hashes

`CALIB_MANIFEST.sha256` (jsonl `9154a84f…`, counts `db113a99…`, config
`93a4693f…`, index `41b93561…`, tensor-shapes `259089b6…`, modeling source
`682f99cb…`, tokenizer `5f9e4d49…`). Baseline ship file:
`LFM2.5-2.6B-QAD-Q4_0.gguf` sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
(1,593,894,944 B — matches docs/ALIVE.md's ship line).

## Answers to the brief

1. **REAP code**: pod base = moep (paper pipeline, same REAP statistic,
   validated on Qwen3.6 by its Table 3, CPU ratio sweep via no-load surgery).
   The 0xSero fork is not public (89 upstream forks + 140 of its repos
   enumerated; its observations dataset is gated) — documented in
   docs/EVIDENCE.md. hqta1110 pinned as the metric reference; its grouped
   attrs match the real tensors verbatim, but its *layerwise* path lacks the
   grouped branch, so FASE A's "layerwise on 1×A100" premise is replaced by
   moep's memory-deterministic loader (peak = weights + one shard,
   `--max-gpu-gib` disk-offload fallback).
2. **Saliency once → many ratios**: yes. moep: one `profile` →
   `profile.stats.pt`; `score --keep-ratio X` ranks; `prune` cuts the base
   checkpoint (peak memory one tensor). REAP fork:
   `layerwise_prune.py:296-298` cached-observation load, `:312-314`
   `run_observer_only`, `:323-326` ratio applied from cached
   `expert_frequency`. Per extra ratio: no forward passes — only CPU
   rank+surgery (moep) or GPU reload+cluster+save (fork).
3. **Calibration**: 1,280 rows, five languages, IT 30.0% largest, others
   ≥15.9%; matrix + sources + licences in CALIB-COUNTS.json /
   calib/SOURCES.md; disjoint from multi5 by construction + window check
   (0 hits); sha256 manifest committed.
4. **Pod**: `pod/run_all.sh <CAP_USD>` — idempotent stages, hard stop at the
   cap (FASE A 40/120/150), upload gated behind `POD_UPLOAD=1` to a proposed
   private HF repo (never created here). Estimate ≈1.7–2.5 h ≈ $3.5–5.0 on
   1×A100 80GB; 400 GB volume (arithmetic in README.md).
5. **Dry-run**: as logged above; the weights-dependent steps assert their own
   outputs on the pod (shard count, stats coverage, config num_experts,
   per-artifact `n_expert` in the load-verify logs).

## Not verified here (stated plainly)

- `moep profile` under CUDA and the kalsallama conversion of a pruned dir
  need the weights/GPU: first smoke targets of the pod job, whose stages
  fail loudly on wrong output.
- Exact final GGUF sizes: tables are param-derived and anchored to three
  published files (±1–3%); llama-quantize prints ground truth.
- 0xSero's actual observer code (private): only its public card and the
  REAP20 GGUF `n_expert=205` are evidence.
- The GSM8K-200 / tool-call holdouts of the eval gate are specified, not
  yet extracted (FASE C material).

Pre-existing repo state untouched: the working tree had unrelated modified
files (docs-refresh, quant-alignment, spec-dspark logs) — not staged.
