# REPORT — kalsa-reap-prep (2026-09-29, audit-fix commit)

Preparation only. No pod created, nothing spent, no phones, no push. Mac
verification only, metadata + the LFM2.5-2.6B Q4_0 ship file we already have.
This report covers the ten hostile-audit items against commit 5f8d5f10;
the original prep facts (fork recon, attr verification, paper reading) are
in the section at the end and unchanged.

## Audit item 1 — real spend stop (billing, not stage-skipping)

- `pod/terminate_pod.sh` (new): terminates THIS pod via
  `DELETE https://api.runpod.ai/v2/pods/$RUNPOD_POD_ID` with `x-api-key:
  $RUNPOD_API_KEY`, fallback `runpodctl remove pod` / `runpodctl pod delete`,
  last resort `poweroff`. No-ops off-pod (`RUNPOD_POD_ID` unset) so Mac
  dry-runs are safe.
- Docs facts (quoted): Runpod predefines `RUNPOD_POD_ID` and
  `RUNPOD_API_KEY` in every pod (docs.runpod.io/pods/templates/manage-templates:
  "RUNPOD_POD_ID: Unique identifier for your Pod. RUNPOD_API_KEY: API key for
  making Runpod API calls from within the Pod."). Terminate — not stop — ends
  billing: volume disk is "deleted when the Pod is terminated"
  (docs.runpod.io/pods/storage) and "Terminating permanently deletes all data
  not stored in a network volume" (docs.runpod.io/pods/manage-pods). Storage
  prices quoted there: volume $0.10/GB/mo running, $0.20 stopped; container
  disk $0.10/GB/mo, temporary. The REST DELETE endpoint is the one used by
  the Runpod REST API family (docs.runpod.io/api-reference; the pod-side
  fallbacks cover any version drift).
- `pod/watchdog.sh` (new): independent loop, global deadline (from
  `CAP/RATE` hours or `POD_DEADLINE_MIN`), kills the job process tree on
  breach.
- `pod/run_all.sh`: every stage under
  `timeout --foreground -k 120 <reserve_seconds>`; EXIT trap fires
  `terminate_pod.sh` on **every** exit path (success, stage failure, cap
  stop, watchdog kill); on failure it first best-effort-uploads the ~1 MB
  keep-sets/stats; `POD_KEEP_ALIVE=1` is the debug hatch.
- Time-budget table fixed (README.md): 00_env 0.5 h → **0.75 h** (CUDA
  build), 40_convert 0.8 → **1.7 h** (imatrix + 3 quants), 50_upload 0.4 →
  **1.6 h** (156 GB), totals **≈3.0–4.5 h expected / 5.85 h hard**, compute
  **$6–9 expected**, storage **<$0.5** (400 GB volume × $0.10/GB/mo ÷ 730 ≈
  $0.055/h, freed at termination).

## Audit item 2 — --no-mtp conversion proven on the Mac

- Flag: `convert_hf_to_gguf.py:125-126` — `"--no-nextn", "--no-mtp",
  dest="no_mtp", action="store_true"` ("Exclude NextN speculative draft
  tensors from the converted GGUF").
- Filter (audit said qwen.py:302-304; exact lines today):
  `conversion/qwen.py:324-326` — `if name.startswith("mtp."): if
  cls.no_mtp: return None`. The trap without the flag is
  `conversion/qwen.py:298-303` — `n_mtp = self.hparams.get(
  "mtp_num_hidden_layers", 0); if n_mtp == 0: assert
  self.opt_num_mtp_layers != 0`.
- Proof: `verify/make_synth_checkpoint.py` writes a doll-house checkpoint in
  the exact moep-surgery shape — fused `model.language_model.layers.N.mlp.
  experts.gate_up_proj [128,32,64]` / `down_proj`, `mlp.gate.weight`,
  `model.visual.*`, config with `text_config.mtp_num_hidden_layers=0` and
  **zero** `mtp.*` tensors (57 tensors; transformers save_pretrained is NOT
  used — it would re-serialize per-expert and hide the real layout).
  - `convert_hf_to_gguf.py <synth> --outtype bf16 --no-mtp --dry-run` →
    **EXIT=0**, "n_tensors = 38, total_size = 65.3M" (text-only: vision and
    mtp excluded).
  - same command WITHOUT `--no-mtp` → **EXIT=1**, `AssertionError` at
    `conversion/qwen.py:303` — the trap is real, the flag is mandatory.
  - `pod/40_convert.sh` passes `--no-mtp` with the quote in its header.

## Audit item 3 — revisions passed to downloads, not just recorded

- Model: `pod/10_fetch_model.sh:16-19` — `hf download Qwen/Qwen3.6-35B-A3B
  --revision 995ad96eacd98c81ed38be0c5b274b04031597b0`.
- Datasets: `calib/build_calib.py:REVISIONS` (full shas) passed as
  `revision=` to every `load_dataset` / `hf_hub_download`; holdouts in
  `eval/build_holdouts.py:GSM8K_REV/HERMES_REV` likewise.

## Audit item 4 — scripted private calibration staging

- `calib/stage_calib.sh` (Mac side): refuses unless the destination dataset
  repo exists AND `private == true` (API check before any upload — refusal
  proven on the Mac: `HF_TOKEN=dummy stage_calib.sh CohereLabs/aya_dataset`
  → **exit 1**, "REFUSING — CohereLabs/aya_dataset is public"); uploads
  jsonl + `calib-imatrix.txt` + counts; writes `calib/staging.json`
  {repo, revision, sha256s} which is committed.
- `pod/05_fetch_calib.sh` (pod side): downloads exactly that repo+revision,
  verifies both sha256s and the 1280-row count, only then `.ok`.

## Audit item 5 — verification-backed resume markers

Every stage's skip condition is its own verification, not file existence;
partials are deleted before a stage runs (10: `.weights-verified` +
shards re-verified incl. one real shard header read; 20: coverage==1.0 +
finite stats + reap usable; 30: per-ratio config `num_experts` AND moep's
manifest `status=="ok"` + `row_checks>0`; 40: per-quant `llama-cli`
one-shot load exit 0, failed artifact deleted; 50: remote tree contains
stats + all four keep-sets). File:line — `pod/00_env.sh:9-12`,
`10_fetch_model.sh:14-16,40-56`, `20_observe.sh:13-15,36-46`,
`30_prune.sh:19-25,44-60`, `40_convert.sh:26-31,52-60`,
`50_upload.sh:55-66`.

## Audit item 6 — eval-gate outputs + runnable Mac eval

- Pod: `40_convert.sh` now produces **Q4_0 + Q4_K_M + Q8_0** per ratio, all
  three quantized with `llama-quantize --imatrix <calibration imatrix>`
  (imatrix computed per ratio by CUDA `llama-imatrix` over
  `calib-imatrix.txt`, rendered from the calibration JSONL through the
  Qwen3.6 chat template — `calib/make_imatrix_text.py`, 1280 rows /
  1,314,955 chars). No requant-from-Q8_0 later.
- Mac: `eval/run_bpb_eval.py` replaces the Windows-era F0 harness — all
  five multi5 languages via our `kalsallama` main build
  (`llama-perplexity`), bpb = log2(ppl)·tok/byte with the model's own
  tokenizer. **Ran against the ship baseline** (`LFM2.5-2.6B-QAD-Q4_0.gguf`):
  **EXIT=0**, `en 1.0526 · it 1.4063 · es 1.1311 · fr 1.2723 · zh 1.6003`
  bpb — now the measured baseline column in docs/EVAL-GATE.md (thresholds
  became concrete: Kalsa IT ≤ 1.1063, EN ≤ 0.8526, ES/FR/ZH ≤ LFM).
- Holdouts (licences quoted in-file and in SOURCES.md): `eval/gsm8k-200.jsonl`
  (200 items, seed 42, gsm8k test @ `740312add88f…`, MIT) and
  `eval/tools-100.jsonl` (100 hermes dialogues @ `dae3e1d28cfb…`,
  Apache-2.0, content-hash-disjoint from the calibration rows). Built on the
  Mac: `build_holdouts.py` → **EXIT=0**, both quotas filled.
- `eval/run_gen_eval.py` scores both holdouts greedily through `llama-cli`
  (strict `####` number match / `<tool_call>` name+args superset). Two
  fork-specific traps found and fixed while smoking on LFM: `llama-cli`
  stays interactive after a `-p`/`-f` turn without `--single-turn` (first
  smoke burned 19 CPU-minutes in interactive mode), and conversation mode
  re-templates `-p` prompts (double template) — the runner writes the
  rendered prompt to a file and uses `-f`, then strips the trailing
  `[ Prompt: … | Generation: … ]` perf line before matching. Final smoke on
  the ship baseline: `--limit 5` → **EXIT=0, 3/5** — the harness measures
  real misses (item 000: model answered 2180, gold 2280). The full 200-item
  LFM run is FASE C's first session, not this prep. Unpruned Qwen3.6 Q4 is
  NOT present locally (22.13 GB unsloth file); the scripts take any GGUF,
  so it drops in when downloaded.
- Matched-quant rule (EVAL-GATE.md): headline Kalsa **Q4_0** vs LFM
  **QAD-Q4_0**; Q4_K_M produced and reported separately.

## Audit item 7 — HF token scoping + upload privacy refusal

- `pod/run_all.sh:NEEDS_TOKEN=" 05_fetch_calib 10_fetch_model 50_upload "`:
  those three get `env HF_TOKEN=$(cat $POD_SECRETS_DIR/hf_token)`; every
  other stage runs `env -u HF_TOKEN`; `00_env.sh` has no token reference.
- `pod/50_upload.sh:26-45`: privacy gate before upload — API
  `/api/models/{repo}` must return `private: true` (404 → "create it
  PRIVATE first"; public → "REFUSING"). Refusal path proven on the Mac
  against a public repo (exit 1). `calib/stage_calib.sh` has the same gate
  for the dataset repo (proof above).

## Audit item 8 — code source licence

Magicoder removed. Replacement: `google-research-datasets/mbpp`
(`sanitized` then `full` to fill the 120 quota), **CC-BY-4.0** — card licence
read live; §2 grants "reproduce and Share ... produce, reproduce, and Share
Adapted Material" for any purpose with attribution; human-written Google
research data, so the GPT-output provenance ambiguity of Magicoder (OSS-
Instruct → GPT-3.5) does not arise. Quote in `calib/SOURCES.md`. Rebuilt:
`build_calib.py` → **EXIT=0**, 1280 rows, code = 120 MBPP rows.

## Audit item 9 — near-duplicate check vs multi5

`calib/near_dup_check.py`: 8-char shingles, 64-perm MinHash (61-bit), plus
TRUE Jaccard per row. Result (**EXIT=0**): max MinHash estimate 0.0469
(fr/it), **max true Jaccard 0.0081** (en), zh 0.0003 — i.e. no near-dup
overlap anywhere near the 0.3 fail line. Exact 80-char-window check remains
in the builder (0 hits).

## Audit item 10 — vision weights

Counted, not dropped: `docs/PARAM-BUDGET.md` new table — each pruned HF dir
= text params + 446,571,248 vision params (+0.89 GB BF16); pod volume
estimate updated (peak ≈ 335 GB). GGUFs stay text-only: mmproj is written
only with `--mmproj` (`convert_hf_to_gguf.py:117-118`), never passed by
`40_convert.sh`; a base-derived mmproj can be produced later if needed.

## Verification log (this commit; all on the Mac)

| command | exit |
|---|---|
| `build_calib.py` (rebuild, MBPP + pinned revs) | 0 (1280 rows) |
| `near_dup_check.py kalsa-reap-calib.jsonl corpus/multi5` | 0 (max true 0.0081) |
| `make_imatrix_text.py qwen36-meta … calib-imatrix.txt` | 0 (1,314,955 chars) |
| `make_synth_checkpoint.py synth-pruned 128` | 0 (57 tensors, 0 mtp) |
| converter dry-run WITH `--no-mtp` | 0 (38 tensors, 65.3M) |
| converter dry-run WITHOUT flag | 1 (`AssertionError` qwen.py:303) |
| `stage_calib.sh` against a PUBLIC dataset repo | 1 (REFUSING) |
| `50_upload` privacy gate against a PUBLIC model repo | 1 (refusal path) |
| `run_bpb_eval.py` LFM Q4_0, 5 langs | 0 (table in EVAL-GATE.md) |
| `build_holdouts.py` | 0 (200 + 100) |
| `run_gen_eval.py --dataset gsm8k --limit 5` (LFM) | 0 (**3/5 pass**; harness proven) |
| `bash -n pod/*.sh calib/*.sh` | 0 (all) |
| `shellcheck pod/*.sh calib/*.sh` | 0 |
| `verify/param_table.py tensor-shapes.json` | 0 |
| `verify/verify_attrs.py` | 0 (19/19 PASS) |

Hashes: `CALIB_MANIFEST.sha256` (jsonl `b973b9be…`, imatrix `71720695…`,
counts `a7edbe53…`, config/index/shapes/modeling/tokenizer unchanged).
Baseline ship file: `LFM2.5-2.6B-QAD-Q4_0.gguf` sha256 `a247afd6…`
(unchanged).

## Still not verifiable on the Mac

- `RUNPOD_API_KEY`-authenticated DELETE and the CUDA build/imatrix runs —
  first action on the pod; terminate_pod no-ops locally by design.
- Real `hf download --revision` of the 72 GB model and pruned-dir
  conversion at scale (the synth proof covers the code path).
- Kalsa-side bpb/GSM8K/tool numbers (need the pod's artifacts).

## Original prep (unchanged from 5f8d5f10)

Pins: moep `fdc9a3fc…`, hqta1110 `7110332…`, kalsallama main `e8065c7cf…`,
transformers 5.16.0; 0xSero fork not public (89 upstream forks + 140 repos
enumerated; observations dataset gated); saliency-once→N-ratios quoted
(`layerwise_prune.py:296-298, 312-314, 323-326`; moep stats→score→surgery);
attr verification 19/19 PASS against config.json + all 26 shard headers
(param sum 35,951,822,704 == index); paper evidence and ratio rationale in
docs/EVIDENCE.md.
