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
| source model | `Qwen/Qwen3.6-35B-A3B` BF16, 26 shards, index total 71,903,645,408 B | REAP input; the F0 rule stands: Q8_0 GGUF is not a REAP input |
| transformers | 5.16.0 (pod env) | first line with `qwen3_5_moe`; matches the fork's validated version; torch 2.7.1, accelerate 1.10.0, safetensors 0.5.3, hf hub 0.34.4, datasets 3.6.0 |
| GGUF converter | `Aspis0/kalsallama` fork **main** @ `e8065c7cfd0daed1b64a94353ff8d2e0edfbc4da` | `conversion/qwen.py:643` registers `Qwen3_5MoeForConditionalGeneration`/`ForCausalLM`; the `kalsallama-onecopy-hmx` spike predates that registration — main is the only correct choice of the two |
| calibration | 1,280 samples, IT 384 / EN 280 / ES 204 / FR 204 / ZH 208; chat 820 / reasoning 240 / code 120 (EN) / tool-call 100 (EN) | Apache-2.0/MIT sources only (calib/SOURCES.md); disjoint from `corpus/multi5` by 80-char normalized windows; `counts.json` has the filled matrix |
| ratios | prune 25 / 50 / 65 / 75% (keep 192/128/90/64 per layer) | 25–50% is the published flat zone; 65/75 are the "as small as quality allows" probes; one observation feeds all four |
| budget | floor $40 / soft $120 / STOP $150 (FASE A); `run_all.sh <CAP_USD>` hard-stops | estimates below |

## The pod job, in one line each

`pod/00_env.sh` pinned venv + clones + llama.cpp CPU tools →
`10_fetch_model.sh` 72 GB HF download, size+shard verified →
`20_observe.sh` one `moep profile` pass over `kalsa-reap-calib.jsonl`
(coverage must be 100%, stats finite) → `30_prune.sh` 4 × (score + surgery),
CPU-only, each pruned dir's `num_experts` asserted → `40_convert.sh`
kalsallama converter → BF16 GGUF → `llama-quantize` Q8_0 → one-shot
`llama-cli` load-verify per artifact, serialized to cap disk →
`50_upload.sh` stats + keep-sets + logs always, GGUFs only with
`POD_UPLOAD=1` to a **private HF repo (proposed, not created by this task):
`Aspis0/kalsa-reap-drafts`**, `runpodctl` as the alternative pull path.

Idempotent at every stage; re-running after a cap stop resumes without redoing
finished stages.

## Cost and disk estimate (arithmetic)

Assumptions: RunPod 1× A100 80GB at $1.98/h (on-demand), pod NVMe ≥1 GB/s,
HF download ≥500 MB/s. Estimates are deliberately padded.

| step | bytes moved | estimate | billed |
|---|---|---|---|
| 10 fetch | 72 GB from HF | 2.5 min at 500 MB/s → padded | 0.5 h |
| 20 observe | 409k tokens measured (1,280 rows, avg 319, max 3,181, none over the 4096 pack) | ~2 min at ~4,000 tok/s (hooks recompute all-expert activations, ≈2× MoE FLOPs) + ~5 min streaming load | 0.5 h |
| 30 prune ×4 | read 72 GB + write 53.2+37.1+27.5+21.0 GB | ~10 min at 1 GB/s | 0.3 h |
| 40 convert ×4 | read 139 GB pruned, write 139 GB BF16, write 73.7 GB Q8_0 (28.26+19.70+14.62+11.14) | ~25 min | 0.8 h |
| 50 upload | 73.7 GB Q8_0 + ~1 MB stats/keeps | 12–25 min at 100–50 MB/s | 0.4 h |
| **total** | | **≈ 1.7–2.5 h** | **≈ $3.5–5.0** |

Pod volume peak (serialized conversion): base 72 + pruned dirs 138.8 + one
transient BF16 GGUF ≤53 + Q8_0 set 73.7 ≈ **340 GB → order a 400 GB volume**.
The pruned HF dirs are re-derivable anywhere from the keep-set JSONs + the
base model (surgery is deterministic and byte-verified), so they may be
deleted after upload if the volume is smaller.

## Deliverable map

- `docs/PARAM-BUDGET.md` — per-ratio parameter arithmetic from the real
  tensors, GGUF sizes at Q4_0/Q4_K_M/Q8_0, resident-fit table per device
  class, and which ratios need `--moe-stream` on the 8 GB class (answer: all).
- `docs/EVIDENCE.md` — why moep, why not the 0xSero fork (not public) or
  upstream (no Qwen3.6), saliency-once quotes, what arXiv:2607.16721 changes
  about calibration, ratios, SFT, and perplexity gating.
- `docs/EVAL-GATE.md` — LFM2.5-2.6B QAD-Q4_0 baseline columns and the
  concrete "wins clearly" thresholds (bpb, GSM8K-200, tool-calls, speed
  floor, fit) for FASE C.
- `calib/build_calib.py`, `calib/SOURCES.md` — the calibration builder and
  licence quotations; data lives outside git in `~/kalsa-models/reap-calib/`.
- `verify/param_table.py` — regenerates the size table from
  `tensor-shapes.json` and asserts the base sum equals the index.
- `CALIB_MANIFEST.sha256`, `CALIB-COUNTS.json` — hashes and filled quota
  matrix of the built calibration set.
- `REPORT.md` — this session's verification log: commands, exit codes,
  hashes, what could not be verified.

## What could not be verified on the Mac

- The 0xSero fork's observer: private; only its published card claims and the
  REAP20 GGUF (`n_expert=205`) are public evidence.
- `moep profile` on CUDA and the kalsallama conversion of a pruned dir: both
  need the weights/GPU — they are the pod job's first smoke targets, which is
  why 20/40 assert their own outputs.
- Exact final GGUF byte sizes: the tables are param-count estimates anchored
  to three published files (±1–3%); llama-quantize prints the real numbers.
