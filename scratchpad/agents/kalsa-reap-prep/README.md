# kalsa-reap-prep

Preparation for the one-shot REAP pod job that produces Kalsa from
`Qwen/Qwen3.6-35B-A3B` (owner decision 2026-09-29). Everything here was
verified on the Mac without weights; the pod job itself is a single scripted
run (`pod/run_all.sh <CAP_USD>`) with a hard spend cap.

## What is decided and pinned

| thing | pin | why |
|---|---|---|
| pruning pipeline | `anik-jha/moep` @ `fdc9a3fc025236bfbc48e050e23e46d0562a5956` (MIT) | paper pipeline (arXiv:2607.16721); REAP statistic verified on Qwen3.6; one observation → N ratios via no-load surgery; MTP dropped; MIT. Full argument: docs/EVIDENCE.md |
| REAP metric reference | `hqta1110/reap` @ `711033277033b8111c3b9f89cd07f2dfc97a2aef` (Apache-2.0) | only public fork with Qwen3_5Moe-aware REAP observer; its grouped attrs match the real checkpoint tensor names verbatim; kept as cross-read reference, not run |
| upstream REAP (rejected) | `CerebrasResearch/reap` @ `1970473` | MODEL_ATTRS still lacks `Qwen3_5Moe*` (the FASE A blocker, re-checked today); no PR pending |
| source model | `Qwen/Qwen3.6-35B-A3B` BF16 @ **`995ad96eacd98c81ed38be0c5b274b04031597b0`**, 26 shards, index total 71,903,645,408 B | REAP input; fetched `--revision` pinned; the F0 rule stands: Q8_0 GGUF is not a REAP input |
| transformers | 5.16.0 (pod env) | first line with `qwen3_5_moe`; matches the fork's validated version; torch 2.7.1, accelerate 1.10.0, safetensors 0.5.3, hf hub 0.34.4, datasets 3.6.0 |
| GGUF converter | `Aspis0/kalsallama` fork **main** @ `e8065c7cfd0daed1b64a94353ff8d2e0edfbc4da` | `conversion/qwen.py:643` registers `Qwen3_5MoeForConditionalGeneration`/`ForCausalLM`; the `kalsallama-onecopy-hmx` spike predates that registration — main is the only correct choice of the two |
| calibration | 1,280 samples, IT 384 / EN 280 / ES 204 / FR 204 / ZH 208; chat 820 / reasoning 240 / code 120 (EN) / tool-call 100 (EN) | Apache-2.0/MIT sources only (calib/SOURCES.md); disjoint from `corpus/multi5` by 80-char normalized windows; `counts.json` has the filled matrix |
| ratios | prune 25 / 50 / 65 / 75% (keep 192/128/90/64 per layer) | 25–50% is the published flat zone; 65/75 are the "as small as quality allows" probes; one observation feeds all four |
| budget | floor $40 / soft $120 / STOP $150 (FASE A); `run_all.sh <CAP_USD>` hard-stops | estimates below |

## The pod job, in one line each

`pod/00_env.sh` pinned venv + clones + **CUDA** llama.cpp build
(llama-cli/quantize/imatrix; needs NO HF token) → `05_fetch_calib.sh`
calibration set from our **private** HF dataset repo at the pinned revision
(sha256 + row-count verified) → `10_fetch_model.sh` 72 GB HF download
**`--revision 995ad96e…`**, size+shard+header verified → `20_observe.sh` one
`moep profile` pass (coverage must be 100%, stats finite) → `30_prune.sh`
4 × (score + surgery), config `num_experts` AND moep's byte-row manifest
asserted per ratio → `40_convert.sh` kalsallama converter **`--no-mtp`**
(mandatory for moep dirs; without it the converter asserts — proven on the
Mac) → BF16 GGUF → `llama-imatrix` on the calibration text →
`llama-quantize --imatrix` to **Q4_0, Q4_K_M, Q8_0** → one-shot load-verify
per artifact; pruned HF dir deleted after its three quants verify (byte-
re-derivable from keep-sets) → `50_upload.sh` stats + keep-sets + logs + all
12 GGUFs to a **private** HF repo (existence + privacy verified via API
before any byte is sent; repo never created by us — owner creates
`Aspis0/kalsa-reap-drafts` private, once).

Every stage writes its `.ok` marker **only after its own verification
passes** and deletes partial outputs on failure; re-running resumes at the
first unverified stage.

## Spend stop (audit item 1 — billing, not just skipping)

Billing ends only when the pod is TERMINATED (stopped pods still bill
volume disk: "$0.20/GB/month (stopped)" vs "deleted when the Pod is
terminated" — docs.runpod.io/pods/storage; docs.runpod.io/pods/manage-pods:
"Terminating permanently deletes all data not stored in a network volume").
Runpod predefines `RUNPOD_POD_ID` and `RUNPOD_API_KEY` in every pod
(docs.runpod.io/pods/templates/manage-templates), so `pod/terminate_pod.sh`
can terminate from inside: REST `DELETE https://api.runpod.ai/v2/pods/$id`
with `x-api-key` (fallback `runpodctl remove pod` / `pod delete`, then
`poweroff`). `pod/run_all.sh` arms this on **every exit path** — success,
stage failure, per-stage `timeout --kill-after`, cap-stop, and the global
deadline enforced by `pod/watchdog.sh` (independent process; kills the job
tree so the trap fires). `POD_KEEP_ALIVE=1` is the debug escape hatch. On
failure it first best-effort uploads the ~1 MB keep-sets/stats, then
terminates.

**HF token scoping**: the token lives only in `$POD_SECRETS_DIR/hf_token`
(mounted file, chmod 600) and is injected into exactly three stages
(05/10/50) via `env HF_TOKEN=…`; every other stage runs under
`env -u HF_TOKEN`. Setup tools never see it.

**Storage**: job data goes on the pod's **volume disk** (400 GB), which is
deleted (billing stops) at termination; nothing on a network volume.

## Cost and disk estimate (audit-fixed)

Assumptions: RunPod 1× A100 80GB $1.98/h on-demand; volume disk
$0.10/GB/month while running; HF CDN ≥500 MB/s; pod NVMe ≥1 GB/s.

| step | bytes moved | wall estimate | reserve (timeout) |
|---|---|---|---|
| 00_env (venv + clones + **CUDA build**) | ~3 GB wheels/src | 15–25 min build + 5 min | 0.75 h |
| 05_fetch_calib | 3.3 MB | seconds | 0.2 h |
| 10_fetch_model | 72 GB | 2.5–8 min + verify | 0.6 h |
| 20_observe | 409k tokens | load ~5 min + ~2–4 min profile | 0.6 h |
| 30_prune ×4 | read 72 GB, write 142.4 GB (incl. vision) | ~10–15 min | 0.4 h |
| 40_convert ×4 | per ratio: convert (≤54 GB in/≤54 GB out), imatrix (409k tok), 3 quants, 3 load-verifies | ~15–25 min each | 1.7 h |
| 50_upload | ~156 GB GGUFs + 1 MB stats | 15–45 min | 1.6 h |
| **total** | | **≈ 3.0–4.5 h expected** | **≤ 5.85 h hard** |

**Compute**: expected $6–9 at $1.98/h; hard ceiling = min(cap, deadline) —
with the FASE A STOP of $150 the deadline is 75 h, so in practice the cap
that binds is the soft budget: pass `run_all.sh 15` (≈$30) to bound this job
comfortably.

**Storage**: 400 GB volume × $0.10/GB/mo ÷ 730 h ≈ **$0.055/h → ~$0.17–0.25
for the job**; terminated at the end, so $0 after (container disk, default
small, is freed with the pod). **Total storage cost < $0.5.**

**Volume peak** (40 deletes each pruned HF dir after its quants verify):
72 base + ≤54.1 largest pruned dir + ≤53.2 largest transient BF16 GGUF +
155.5 accumulated quants ≈ **335 GB → order 400 GB**.

## Deliverable map

- `docs/PARAM-BUDGET.md` — per-ratio parameter arithmetic from the real
  tensors, GGUF sizes at Q4_0/Q4_K_M/Q8_0, resident-fit table per device
  class, and which ratios need `--moe-stream` on the 8 GB class (answer: all).
- `docs/EVIDENCE.md` — why moep, why not the 0xSero fork (not public) or
  upstream (no Qwen3.6), saliency-once quotes, what arXiv:2607.16721 changes
  about calibration, ratios, SFT, and perplexity gating.
- `docs/EVAL-GATE.md` — LFM2.5-2.6B QAD-Q4_0 baseline columns (bpb for all
  five languages **measured on the Mac 2026-09-29**), the matched-quant rule
  (Kalsa Q4_0 vs LFM Q4_0 headline), and the concrete "wins clearly"
  thresholds for FASE C.
- `calib/build_calib.py`, `calib/SOURCES.md`, `calib/near_dup_check.py`,
  `calib/stage_calib.sh`, `calib/make_imatrix_text.py` — the calibration
  builder (revisions pinned, MBPP code source), licence quotations, the
  MinHash/exact-Jaccard near-duplicate check (max true overlap 0.0081), the
  privacy-checked private-repo uploader that writes `calib/staging.json`,
  and the imatrix text renderer; data lives outside git in
  `~/kalsa-models/reap-calib/`.
- `eval/run_bpb_eval.py`, `eval/build_holdouts.py`, `eval/run_gen_eval.py`,
  `eval/gsm8k-200.jsonl`, `eval/tools-100.jsonl` — the Mac-side gate harness
  (five-language bpb, greedy GSM8K-200 and tools-100 scorers) and the
  committed, licence-tagged holdout sets.
- `verify/param_table.py` — regenerates the size table from
  `tensor-shapes.json` and asserts the base sum equals the index.
- `verify/make_synth_checkpoint.py` — the tiny moep-shaped checkpoint behind
  the `--no-mtp` converter proof.
- `CALIB_MANIFEST.sha256`, `CALIB-COUNTS.json` — hashes and filled quota
  matrix of the built calibration set.
- `REPORT.md` — this session's verification log: commands, exit codes,
  hashes, what could not be verified, and the audit items 1–10 one by one.

## What could not be verified on the Mac

- The 0xSero fork's observer: private; only its published card claims and the
  REAP20 GGUF (`n_expert=205`) are public evidence.
- `moep profile` on CUDA and the kalsallama conversion of a pruned dir: both
  need the weights/GPU — they are the pod job's first smoke targets, which is
  why 20/40 assert their own outputs.
- Exact final GGUF byte sizes: the tables are param-count estimates anchored
  to three published files (±1–3%); llama-quantize prints the real numbers.
