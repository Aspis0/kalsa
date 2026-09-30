# REPORT — kalsa-reap-prep (2026-09-30 probe appended; 2026-09-29 audit base)

Preparation + the $0 Mac probe. No pod created, nothing spent, no phones, no
push. This report covers (F3) the Fable-3 §9 fixes with Mac proof, (0) the
Fable-2 fixes + GPU-probe prep, (1) the $0 probe run, and (2) the ten
hostile-audit items against commit 5f8d5f10.

## Fable-3 §9 fixes + Mac end-to-end proof (2026-09-30, commits below)

The five fatal defects and the eight §9 items:

1. `podprobe/00_env.sh:17-23` — venv is `--system-site-packages` (the
   image's torch is visible; transformers only pulls torch via extras) and
   the hub pin is `huggingface_hub[cli]>=1.5,<2.0`, which satisfies
   transformers 5.16.0's `huggingface-hub<2.0,>=1.5.0` (the old
   `==0.34.4` pin was unsatisfiable — PyPI re-read).
2. `eval/run_gen_eval.py:186` — the `score_tools(raw, item, args_match)`
   arity bug is gone; tools now score from STRUCTURED `message.tool_calls`
   first (`:118-130` calls_from), content parsing as fallback.
3. `eval/run_bpb_eval.py` — per-language concatenation, ONE
   llama-perplexity run per language at `-c 1024` (the fork refuses
   < 2·n_ctx tokens, perplexity.cpp:480, which killed every per-doc run),
   per-CHUNK `[n]ppl` values as the bootstrap units; pre-run token-count
   guard names the cause.
4. README — creation is now a PARAMETER LIST for the coordinator's Runpod
   MCP (GPU `NVIDIA L40`, image `runpod/pytorch:1.4.0-cu1290-torch271-ubuntu2204`
   — tag verified on Docker Hub 2026-09-30; the old `2.7.1-cuda12.8.0-…`
   tag does not exist — container disk 40 GB, volume 200 GB, SSH yes, no
   ports, no env). The phantom `--terminate-after`/`--container-disk`
   runpodctl flags are gone (runpodctl create.go registers none of them).
   The in-pod hard stop is armed FIRST in `run_probe.sh:20-33`: a
   background sleep DELETEs its own pod through
   `https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID` with the injected key
   passed via child ENVIRONMENT (never argv, never printed). README states
   plainly: **the pod-scoped key's permission to delete its own pod is
   UNVERIFIED until a 1-minute CPU-pod test**; until then the only real
   stops are the console and the per-arm uploads.
5. `run_probe.sh` — per-arm `timeout -k` (`PROBE_ARM_TIMEOUT_H`), upload
   after EVERY arm (a late hard stop can only lose the arm in flight),
   resume marker = `bench.txt` (withheld unless gsm8k+tools+bpb all
   EXIT=0, `30_gate.sh:82-90`), order lfm → razor19-k8 → **qwen35-4b
   (control promoted)** → razor19-k4 → qwen36-k4 → k2 → extras.
6. `30_gate.sh:66-77` — second bench per arm: `-ngl 0` all-vCPU threads,
   labelled the PC proxy (community vCPU counts vary); GPU bench kept for
   arm ranking on the pod. Portable NPROC fallback (macOS has no nproc).
7. `run_gen_eval.py:131-140` + `:48-58` — tools requests carry the
   structured `tools` field (extracted from the holdout's system message,
   `:143-156`; 100/100 items verified to carry a parseable OpenAI-shape
   array), so the server renders each model's NATIVE tool format and
   returns `message.tool_calls`; the old Hermes-dialect-in-prompt
   asymmetry is gone.
8. `run_gen_eval.py:196-205` — per-arm truncation report: every item
   stores `finish_reason`, the summary and JSON carry
   `truncated` (items that hit the 4096 cap).

Also: the invented LFM `[Start thinking]/[End thinking]` dialect is
DELETED — the ship GGUF's template ends `<|im_start|>assistant\n<think>`
(verified again from the tokenizer file), so only `<think>…</think>` is
stripped and an unclosed `<think>` is a miss; results repo renamed to
**`Kalsa-ai/kalsa-gate-probe-results`** (env.sh/README; never created by
us); `bootstrap_ci.py` follows the `chunks` key; the corpus docs now carry
Fable-3's contamination caveat (page creation ≠ content novelty — mostly
translations; cross-lingual recall bias, symmetric across arms).

### Mac proof (quiet window cancelled by the owner; Metal build e8065c7cf)

`30_gate.sh` executed end to end through the pod layout (symlinked
`/tmp/kalsa-probe-mac` root, `POD_ROOT`/`POD_PY`/`LLAMA_BIN` overrides)
against the ship LFM GGUF with `PROBE_GEN_LIMIT=2`, `PROBE_BPB_LANGS=en`:

- `caffeinate -i env POD_ROOT=… bash 30_gate.sh lfm-mac-proof …` →
  **PROOF_EXIT=0** (log `/tmp/mac-proof.log`): gsm8k EXIT=0 · tools
  EXIT=0 · bpb EXIT=0 · bench wrote bench.txt (the marker) ·
  `30: [lfm-mac-proof] done 13:05:12`.
- `gsm8k.json` first item: `{"id": "gsm8k-200-000", "pass": 0,
  "finish_reason": "stop", "raw": "…Kim raises $320 more than
  Alexandra…"}` — 1/2 pass (item 000 is the known GSM8K label-noise item),
  `truncated: 0/2`, thinking ON, raw stored, answer-side content only.
- `tools.json`: **2/2 pass with `finish_reason: "tool_calls"`** — the
  structured tools path works end to end (schemas in the request, calls
  parsed from the response).
- `bpb.json` (en): `overall_bpb 1.10009` over `63` chunks, 55 docs,
  291,968 bytes — the concatenated `-c 1024` pipeline works; the LFM en
  number on the new corpus is 1.10 (vs 1.19 on Gutenberg — different
  corpus, not comparable by design).
- `notes.txt`: `DOUBLE_BOS_WARN count=0` — grep ran against the real
  post-request server.log (4 prompt entries), not a pre-request empty log.
- Known Mac gap, fixed during the run: the CPU-bench line called `nproc`
  (Linux); macOS printed `nproc: command not found` and that one bench
  line fell through `|| true`. Fixed with the portable fallback
  (`30_gate.sh:69`); the pod is Linux and unaffected either way.



## Fable-2 fixes + GPU probe prep (2026-09-30 afternoon; light work only until 14:00)

Gate (review §"Top actions" 1, owner addenda):
- `eval/run_gen_eval.py` rewritten around `/v1/chat/completions` — the
  SERVER now applies the model's own template and tokenizes once (single
  BOS; the raw-prompt path doubled it, llama-vocab.cpp:602 warns
  "final prompt starts with 2 BOS tokens"); **thinking ON for every model**
  (`chat_template_kwargs.enable_thinking=true`, supported in the fork at
  tools/server/server-common.cpp:1330; LFM's template opens `<think>`
  unconditionally so the flag is a no-op there); `--max-tokens` default
  **4096** (at 1024, 3/4 regenerated LFM GSM8K items died mid-reasoning);
  **raw output stored per item** in the results JSON; the CLI path stays
  for local single-artifact checks.
- `eval/toolcalls.py`: `canonical()` + `args_match()` — tools compared on
  order-insensitive canonicalised JSON with type-lenient scalars, replacing
  `str(args)`; 8 new test cases in `eval/test_toolcalls.py` (EXIT=0).
- `eval/run_bpb_eval.py`: per-document evaluation (`<lang>/<doc>.txt`),
  byte-weighted per-language overall, per-doc JSON for bootstrap over
  documents; `eval/bootstrap_ci.py` follows the `docs` key.
- Corpus REPLACED (Fable-2: one memorised classic per language is not a
  language-modelling instrument): `eval/build_postcutoff_corpus.py` collects
  Wikipedia articles CREATED after 2026-07-01 (recentchanges `rctype=new`,
  wikitext-size floor 4000 B, prose floor 2500 chars, ≤ 12 KB), one file per
  document, ≥ 50 docs/language, CC-BY-SA-4.0 with per-document
  title/pageid/revid attribution in `MANIFEST.json`. Post-cutoff by
  construction: the page did not exist before July 2026. Gutenberg corpus
  (`corpus/text-holdout/`, `eval/build_text_holdout.py`) removed. Two
  Wikimedia traps found while building: full (non-intro) extracts return
  empty for all but ONE page of a batch (19/20 empty, measured), and burst
  fetching 429s hard — the builder fetches one page per request, 3 s apart,
  escalating Retry-After backoff.
- `eval/check_holdout_disjoint.py`: accepts the per-document layout.

Bug fixes (review "Pod still cannot complete" + addenda):
- `pod/10_fetch_model.sh`: `next(list)` → `sorted(...)[0]` (stage died).
- `pod/05_fetch_calib.sh` + `calib/stage_calib.sh`: row count carried in
  staging.json (`n_rows`) and asserted against it — the old hard 1280 assert
  failed on every post-Part-A rebuild (set is 10,620).
- `pod/40_upload.sh`: explicit path-in-repo (`upload-staging`) — a bare
  directory upload lands files at the repo ROOT while verification reads
  them under `upload-staging/`, so the upload never verified.
- `pod/run_all.sh`: `timeout` WITHOUT `--foreground` (default mode signals
  the stage's whole process group; `--foreground` left GPU children
  running); setsid re-exec so watchdog's group kill can take the job tree;
  failure path terminates when there is NOTHING to salvage (a stage-20
  failure with no stats kept the pod billing for an empty volume).
- `mac/30_convert.sh`: `${q,,}` (bash-4) → precomputed lowercase array —
  macOS ships bash 3.2.
- `calib/sources.py`: `(tuple).__hash__()` seed (salted per process) →
  sha256-derived integer; the Aya sampling is now reproducible.

GPU probe prep (podprobe/, owner cap $10, no pod created):
- k2=16 renormalisation (arXiv:2609.04575 — activate top-k1, normalise by
  top-k2 mass): **branch `spike/topk-k2-renorm` @ `a2f252fbd`** in a fresh
  worktree of kalsallama (main e8065c7cf + 33 lines: llama-arch.{h,cpp},
  llama-hparams.h, llama-model.cpp, llama-graph.cpp — the `norm_w` divisor
  becomes the top-k2 probability mass when
  `--override-kv <arch>.expert_used_k2=int:<k2>` is set; off by default).
  NOT compiled (Mac freeze until 14:00) — the pod probe is its first build.
- `podprobe/` one-shot job: env.sh (pins), 00_env (CUDA build from the
  spike sha, falls back to main + skips the k2 arm if the branch was not
  pushed), 10_fetch (pinned revisions incl. the ship LFM from the private
  dataset repo, sha256-verified), 20_convert (RAZOR --no-mtp → Q4_K_M +
  Q4_0, load-verified, no imatrix — same plain quant for every arm so
  quantisation cannot masquerade as a model difference), 30_gate (per-arm
  server launch with the arm's --override-kv flags, full gate + double-BOS
  grep on the server log), 40_upload (private-dataset privacy gate,
  path-in-repo, remote-tree verify), run_probe.sh (value-ordered arms with
  a remaining-budget guard, upload verified, then terminate).
- RAZOR evidence pinned next to the checkpoint in the README: arXiv:2609.30465
  ("RAZOR: Pruning Replaceable Experts in LLMs", training-free,
  consensus-residual; tested on this exact base at 25 %/50 %; +2.12..+5.59
  points over REAP on a nine-task reasoning average). RAZOR-19B = Apache-2.0
  @ d897617a; the 25 % RAZOR-28B exists (298d343b) as an OPTIONAL arm,
  off by default — ~28B → Q4_K_M ≈ 16 GB, fits NO 16 GB budget.
- Arms (L40 $0.69/h estimates in the README table): setup 1.3 h/$0.90;
  LFM baseline 0.8; RAZOR k8 Q4_K_M 2.1; RAZOR k4 2.0; unpruned k4 2.2;
  Qwen3.5-2B Q4_K_M + Q4_0 (8 GB-class candidate, owner addendum) 0.7+0.7;
  Qwen3.5-4B control 1.0; RAZOR k8 Q4_0 1.4; k2 arm 2.0; optional RAZOR-28B
  3.0. Core total 12.2 h ≈ $8.40; guard at 12.5 h; hard stop
  `--terminate-after` 14 h = $9.66.

Verification this session: `bash -n` + `shellcheck -x` (pod/, mac/, calib/,
podprobe/) EXIT=0; `python3 -m py_compile` (eval/, calib/) EXIT=0;
`eval/test_toolcalls.py` EXIT=0 (9 parse + 8 match cases). NOT verified:
the spike patch compiles (no builds before 14:00), the probe scripts against
a live model (the pod run is their first execution), runpodctl flag
spellings (runpodctl is not installed on this Mac — the README says live
`pod create --help` is authoritative), GPU memory headroom for the unpruned
22 GB arm at ctx 16384 on a 48 GB L40 (comfortable on paper).

## $0 probe, 2026-09-30 (owner decision: PC + 16 GB; LFM stays on 8 GB)

Fixes landed in `4d202f91` (Part A); probe harness fixes are in the Part B
commit below. All five models ran on ONE build (kalsallama main `e8065c7cf`,
Metal, `build-metal/`), same session, paired items/segments, greedy,
thinking-off everywhere. Generation went through `llama-server /completion`
(clean JSON — the CLI echoes the `-f` prompt even with `--no-display-prompt`,
verified); bpb = per-segment llama-perplexity (8 segments × 600 KB/language)
over `corpus/text-holdout/` (PG books, non-Wikipedia, containment-checked);
CIs = paired percentile bootstrap (10k, seed 42). Mac = M1 Max (10-core,
64 GB), `llama-bench -p 512 -n 128`. **All numbers below are Mac numbers.**

| model | en | it | es | fr | zh (bpb) | GSM8K-200 | tools-100 | pp512 t/s | tg128 t/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| LFM2.5-2.6B QAD-Q4_0 (ship) | 1.1935 | 1.9030 | 1.7070 | 1.5792 | 2.3484 | 54.5 % | 77 % | 1228 | 127.2 |
| LFM2.5-2.6B Q4_K_M | 1.1771 | 1.9458 | 1.7306 | 1.5824 | 2.3948 | 44.5 % | 78 % | 1072 | 102.0 |
| Qwen3.5-4B Q4_K_M (dense control) | 0.7082 | 1.1123 | 1.0227 | 0.9163 | 1.2691 | 85.5 % | 81 % | 635 | 55.3 |
| REAP20 `0xSero/Qwen3.6-28B` Q4_K_M (MIT) | 0.5703 | 1.1625 | 0.8405 | 0.8615 | 1.4128 | 86.5 % | 82 % | 695 | 57.8 |
| Qwen3.6-35B-A3B unpruned Q4_K_M | 0.0240 | 0.9267 | 0.6970 | 0.8018 | 0.5215 | 86.0 % | 82 % | 694 | 50.0 |

CIs (diff vs ship LFM, 95 % paired bootstrap):

- **REAP20**: bpb it −0.740 [−0.781, −0.701] · en −0.623 [−0.660, −0.585] ·
  es −0.867 [−0.893, −0.843] · fr −0.718 [−0.747, −0.684] ·
  zh −0.936 [−0.983, −0.893]; gsm8k +32.0 [+24.5, +40.0];
  **tools +5.0 [−1.0, +11.0]**; speed 57.8/127.2 = **0.45× LFM**.
- **Unpruned Qwen3.6**: bpb −0.78 … −1.83 (all CIs < 0; but see the
  memorization confound — en 0.024 and zh 0.52 are recall, not language
  modelling); gsm8k +31.5 [+23.5, +39.5]; tools +5.0 [+0.0, +11.0];
  speed 0.39× LFM.
- **Qwen3.5-4B (dense control)**: bpb −0.49 … −1.08 (all CIs < 0);
  gsm8k +31.0 [+23.0, +39.0]; tools +4.0 [−1.0, +10.0]; speed 0.43× LFM.
- lfm-q4km cross-check: ≈ lfm-qad (±0.05 bpb; gsm8k −10 points is within one
  CI width) — quant class does not change the story.

**Verdict line.** REAP20 — and unpruned Qwen3.6 — clearly beat LFM2.5-2.6B
on language quality (every language's bpb CI excludes 0) and on GSM8K
(+32, CI well above 0), but NOT on tool calls (+5, CI crosses 0) and NOT on
speed (0.45× / 0.39× LFM on the same Mac build — below the gate's 0.5× floor,
exactly as the review predicted from active params being ratio-invariant).
**A 50 % prune is NOT worth $15 on this evidence**: the prune cannot change
speed (active compute is ratio-invariant), cannot make the 16 GB phone budget
(50 % Q4_0 = 10.4 GB > 9 GB), and its likely quality is *below* the free
published REAP20 (deeper prune = more loss, REAP paper §5). The quality jump
the probe was looking for is already available for $0 — either REAP20 itself
(16 GB: PC-only resident) or, more interestingly, the dense Qwen3.5-4B
control: REAP20-level GSM8K/tools, all five languages far above LFM, 2.5 GB
resident in every class including 8 GB phones, Apache-2.0 — at the same
~0.43× Mac speed. The MoE route fails the speed floor at any ratio; the
product decision this forces is (a) accept <0.5× speed for the quality jump
on PC/16 GB, or (b) pursue the dense 4B for the resident classes — both are
owner calls, and the gate's own verdict rule says no-ship as written.

**Confound to carry into any ship decision**: the bpb corpus is public-domain
classics (Pride and Prejudice, Don Quijote, 紅樓夢…), which every large model
has memorized in pretraining — the unpruned model's en 0.024 / zh 0.52 bpb
are recall, not modelling, and REAP20's bpb advantage is partly capacity for
memorization. The GSM8K/tools holdouts don't share that confound but have
their own (public benchmarks may be in pretraining). The 0.5× speed floor
and the tools margin, both failures, are unaffected by this.

Probe artifacts: `~/kalsa-models/probe/` (models + `results/<tag>/` with
bpb.json, gsm8k.json, tools.json, bench.txt, logs; outside git). Probe
runner: `~/kalsa-models/probe/run_probe.sh`.

Harness fixes found by the probe (Part B commit):
- this fork's `llama-cli` echoes the `-f` prompt in conversation mode even
  with `--no-display-prompt` (verified with a ZEBRATEST marker prompt) — the
  first probe run scored LFM 3/200 on GSM8K because LFM QAD emits
  `[Start thinking] … [End thinking]` and the echoed trailing `<think>` made
  every reply look like budget-exhausted reasoning; probe now runs
  `llama-server /completion` (clean JSON, one load per model) and
  `run_gen_eval.py` strips both reasoning dialects (`run_gen_eval.py`,
  `strip_reasoning`); a 12-item smoke restored a sane 7/12 for LFM;
- byte-sliced bpb segments could cut a UTF-8 sequence (EXIT=1 on the first
  run) — segments are now re-encoded with `errors="ignore"`
  (`run_bpb_eval.py`);
- the shared `/tmp` prompt file is pid-tagged so two runners cannot
  interleave prompts (`run_gen_eval.py`).

Not verified in the probe: degeneration smoke (8-prompt, gate condition 6 —
not part of the task's metric list), phone-class speeds (no phone touched —
Mac numbers only, labeled Mac), and whether LFM QAD's GSM8K label-noise item
000 (arithmetic answer 2180, stored gold 2280) skews single-item reads
(fixed 200-item set, unchanged by choice).

## Audit items 1–10 (2026-09-29, against 5f8d5f10)

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
