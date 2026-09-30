# kalsa-reap-prep

Preparation for the REAP pod job that produces Kalsa from
`Qwen/Qwen3.6-35B-A3B`. **Scope after the Fable 5.1 review + owner decision
(2026-09-30)**: target is PC + 16 GB phones resident; LFM2.5-2.6B stays on
the 8 GB class; the pod job runs only if the $0 Mac probe (`REPORT.md`)
clears the gate; one prune ratio (50 %).

## The split: pod profiles, Mac cuts (review top-change 1)

The pod does ONLY the GPU work — profile the base model over the calibration
set and rank experts once. Everything downstream (surgery, GGUF conversion,
imatrix, quantisation) is Mac-side CPU work:

| stage | where | what | upload |
|---|---|---|---|
| `pod/00_env.sh` | pod | pinned venv + moep clone (no compiler, no CUDA build) | — |
| `pod/05_fetch_calib.sh` | pod | calibration from our private HF dataset repo, sha-verified | — |
| `pod/10_fetch_model.sh` | pod | base BF16 @ pinned revision, size/shard/header verified | — |
| `pod/20_observe.sh` | pod | one `moep profile` pass (coverage 100 %, stats finite) | — |
| `pod/30_score.sh` | pod | `moep score` → ONE keep-set (`keep_reap_0.5.json`) | — |
| `pod/40_upload.sh` | pod | stats + keep-set + logs, **~1 MB**, privacy-gated, remote-tree verified | ~1 MB |
| `mac/10_fetch_base.sh` | Mac | same base fetch + verify, for surgery | — |
| `mac/20_surgery.sh` | Mac | `moep prune` from the keep-set (CPU shard-streaming) | — |
| `mac/30_convert.sh` | Mac | convert `--no-mtp` → BF16 → imatrix → **Q4_0 + Q4_K_M** → single-turn load-verify | — |

The old 12-GGUF / 156 GB upload job is gone (review T5d/T8): no Q8_0, no
25 % arm, no GGUF ever touches the pod or the network.

## Spend stop — three layers, cheapest first

1. **Runpod-side (the real one)**: the pod is created with `--terminate-after`
   set past the hard runtime cap — it DELETES the pod, while `--stop-after`
   would only stop it and disk keeps billing (runpodctl skill,
   `runpodctl/SKILL.md:88`; golden path 06: `--terminate-after <iso8601>`.
   Documented create command for the coordinator — run only with the owner's OK:
   ```bash
   runpodctl pod create --name kalsa-reap-profile \
     --image runpod/pytorch:2.7.1-cuda12.8.0-cudnn9-devel-ubuntu22.04 \
     --gpu-id "NVIDIA A100 80GB PCIe" --container-disk 60 --volume 130 \
     --env POD_HF_UPLOAD_REPO=Aspis0/kalsa-reap-drafts \
     --ssh --terminate-after "<now + 6h, iso8601>"
   ```
   (volume 130 GB fits the recomputed peak, see below; the HF token goes in
   `$POD_SECRETS_DIR/hf_token` per the coordinator's secret mount, never on
   the command line.)
2. **In-pod watchdog + cap** (`pod/run_all.sh`, `pod/watchdog.sh`): global
   deadline kills the job tree; per-stage `timeout` reserves.
3. **`pod/terminate_pod.sh`** (best-effort extra): REST
   `DELETE https://rest.runpod.io/v1/pods/{podId}` with
   `Authorization: Bearer` (docs.runpod.io/api-reference/pods/DELETE/pods/podId;
   responses 204/400/401; the page says nothing about key scoping, so whether
   the pod-scoped `RUNPOD_API_KEY` may terminate is UNVERIFIED — the control
   REST is v1-only, `api.runpod.ai/v2` is the serverless runtime API, which
   is what the old script got wrong). Fallback: `runpodctl pod delete`.
   **No terminate before results are verified off the pod**: on any failure
   path `run_all.sh` re-runs `40_upload.sh --mini` up to 3× and terminates
   only if the remote-tree check passes; if the upload will not land, the pod
   is kept alive (loud log) so the ~1 MB of results is not destroyed with it
   — `POD_DESTROY_ON_FAILED_UPLOAD=1` trades artifacts back for billing.

## Budget (owner: ~$15)

Pod wall estimate at $1.98/h (A100 80 GB): env+venv ~10 min, calib seconds,
72 GB fetch ~10–20 min, profile ~40–70 min, score ~5 min, 1 MB upload ~1 min
→ **1.5–2.5 h ≈ $3–5 compute**, storage 130 GB × $0.10/GB/mo ≈ $0.02/h →
**<$0.10**. The ~$15 ceiling covers one full retry; the Mac-side half of the
pipeline costs $0. Old $40/$120/$150 ladder withdrawn with the old job shape.

**Pod volume peak (recomputed for the new shape)**: base BF16 67 GB (26
shards, index total 71.9 GB on-disk ≈ 66.98 GiB) + venv ~8 GB + runs/stats
~1 GB + upload staging ~1 GB ≈ **77 GiB → a 130 GB volume leaves ~40 %
headroom**. No pruned dirs, no BF16 GGUFs, no quants on the pod anymore.

## Calibration + gate (review T6/T7)

- `calib/build_calib.py` (+ `calib/sources.py`): 10,620 rows / **2.11M
  tokens** (tokenizer-measured, guard ≥ 2M), **IT 30.4 %**, thinking rows
  with real reasoning content (175, from full GSM8K train solutions inside a
  `<think>` block) + non-thinking (175), 120 multi-turn (glaive dialogues
  with ≥ 2 user turns), Aya sampled seed-shuffled, `translated_dolly` rows
  tagged **cc-by-sa-3.0** (SOURCES.md).
- Gate corpus `corpus/postcutoff/` (tracked; built by
  `eval/build_postcutoff_corpus.py` — Fable-2 replaced the memorised-Gutenberg
  corpus): one file per document, 50+ documents per language, every document
  a Wikipedia article CREATED after 2026-07-01 (recentchanges rctype=new —
  post-cutoff by construction), CC-BY-SA-4.0 with per-document
  title/pageid/revid attribution in `MANIFEST.json`. bpb is evaluated
  per-document and the bootstrap units are documents.
- Scoring: `eval/run_gen_eval.py` — dialect-fair tool matching
  (`eval/toolcalls.py`; LFM's `<|tool_call_start|>[name(args)]<|tool_call_end|>`
  read from its GGUF, Qwen's `<tool_call>{json}</tool_call>`; args compared
  on canonicalised, order-insensitive JSON), **thinking ON for every model
  (product parity), n_predict 4096**, prompts sent through the server's
  `/v1/chat/completions` so the SERVER owns template + tokenization (single
  BOS; the raw-prompt path doubled BOS — Fable-2), raw model output stored
  per item, per-item JSON.
- CIs: `eval/bootstrap_ci.py`, paired percentile bootstrap on every metric
  (per-document for bpb, per-item for gsm8k/tools).
- Thresholds and the verdict rule: `docs/EVAL-GATE.md`.

## One-shot GPU gate probe (owner cap $10) — podprobe/

Answers, on ONE L40 48 GB pod, with the FIXED gate: does RAZOR-19B (the free
published 50 % prune of Qwen3.6-35B-A3B, k=8 and k=4) or the unpruned model
at k=4 beat the ship LFM2.5-2.6B clearly enough to justify a $15 REAP pod —
and does the dense Qwen3.5-2B (same size class as LFM; ~32 tok/s reported on
an iPhone 16) beat LFM at similar speed as an 8 GB-class candidate?

**RAZOR checkpoint**: `Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256`
(Apache-2.0, pinned `d897617a…`), from "RAZOR: Pruning Replaceable Experts
in LLMs", arXiv:2609.30465 — training-free consensus-residual pruning,
tested on this exact base at 25 %/50 % removal, +2.12 to +5.59 points over
REAP on a nine-task reasoning average at lower reverse KL. A 25 % variant
also exists (`…RAZOR-28B-A3B-E192of256`, `298d343b…`); it is an OPTIONAL
arm (`PROBE_WITH_RAZOR28=1`, off by default): ~28B → Q4_K_M ≈ 16 GB, which
fits NO 16 GB budget — it can only inform the 32 GB PC tier.

**k=4** uses llama.cpp standard renormalisation via
`--override-kv qwen35moe.expert_used_count=int:4`. The k2=16 renormalisation
variant (arXiv:2609.04575: activate top-k1 but normalise by the top-k2
probability mass; −0.35 MMLU vs −4.65 for standard renorm on this model
going 8→4) is branch `spike/topk-k2-renorm` in kalsallama (commit
`a2f252fbd`, +33 lines, off unless `expert_used_k2` is overridden) — the
probe builds THAT branch for everything, so the extra arm is just
`--override-kv qwen35moe.expert_used_k2=int:16`.

### Arms, runtime and cost estimates (L40, $0.69/h, thinking-ON 4096)

| # | arm | gate | est. hours | est. cost |
|---|---|---|---:|---:|
| 0 | setup: build + fetch (~70 GB) + convert RAZOR-19B + 2 quants | — | 1.3 | $0.90 |
| 1 | LFM2.5-2.6B ship QAD-Q4_0 (baseline) | full | 0.8 | $0.55 |
| 2 | RAZOR-19B k=8 Q4_K_M | full | 2.1 | $1.45 |
| 3 | RAZOR-19B k=4 Q4_K_M | full | 2.0 | $1.40 |
| 4 | Qwen3.6-35B-A3B unpruned k=4 Q4_K_M | full | 2.2 | $1.50 |
| 5 | Qwen3.5-2B Q4_K_M (8 GB-class candidate) | full | 0.7 | $0.50 |
| 6 | Qwen3.5-2B Q4_0 | full | 0.7 | $0.50 |
| 7 | Qwen3.5-4B Q4_K_M (dense control) | full | 1.0 | $0.70 |
| 8 | RAZOR-19B k=8 Q4_0 | full | 1.4 | $0.95 |
| 9 | RAZOR-19B k=4 + k2=16 renorm (spike build) | full | 2.0 | $1.40 |
| — | **core total (0–8)** | | **12.2** | **$8.40** |
| opt | RAZOR-28B k=8 Q4_K_M (25 %; no 16 GB fit) | full | 3.0 | $2.05 |

Core sits under the $10 cap with ~$1.6 headroom; the budget guard
(`PROBE_BUDGET_H=12.5`, arm order = value: baseline → decision arms →
extras) SKIPS any arm whose estimate no longer fits, so a slow pod degrades
gracefully instead of dying mid-arm. bpb dominates arm time because each
document is a separate `llama-perplexity` load (the fork's server exposes
logprobs for generated tokens only — teacher-forced NLL needs the CLI).

### Coordinator launch sequence (I do not run these)

Prerequisites (once, owner/coordinator):
1. `hf repo create Aspis0/kalsa-gate-probe-results --repo-type dataset --private`
2. One-time ship-baseline upload (it exists only on the Mac):
   `hf upload Aspis0/kalsa-gate-probe-results ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf ship/LFM2.5-2.6B-QAD-Q4_0.gguf --repo-type dataset`
3. If arm 9 (k2) is wanted: `git -C ~/Projects/kalsallama-spike-k2 push origin spike/topk-k2-renorm`
   (not pushed by the prep session — pushes are the coordinator's call; the
   job falls back to fork main and skips arm 9 if the branch is absent).

Create + launch (live `runpodctl pod create --help` is authoritative for
exact flag spellings — runpodctl is not installed on the prep Mac):
```bash
runpodctl pod create \
  --name kalsa-gate-probe \
  --image runpod/pytorch:2.7.1-cuda12.8.0-cudnn9-devel-ubuntu22.04 \
  --gpu-id "NVIDIA L40" \
  --container-disk 40 --volume 200 \
  --ssh \
  --terminate-after "$(date -u -v+14H +%Y-%m-%dT%H:%M:%SZ)"
# 14h x $0.69 = $9.66 hard stop (owner cap $10); the guard stops work at 12.5h.
# RTX PRO 5000 48GB (~$0.82/h) also fits every arm: use --terminate-after +13H
# and PROBE_RATE_USD_H irrelevant (guard is hours-based; cost math in README).

# bundle: gate code + corpus + tokenizers + terminate script (~65 MB),
# arranged exactly as podprobe/env.sh expects ($CELL = /workspace/kalsa-reap-prep)
CELL=~/Projects/kalsa-moe-experiments/scratchpad/agents/kalsa-reap-prep
ssh root@POD_IP 'mkdir -p /workspace/kalsa-reap-prep/corpus'
rsync -a "$CELL"/eval "$CELL"/podprobe "$CELL"/pod           root@POD_IP:/workspace/kalsa-reap-prep/
rsync -a ~/Projects/kalsa-moe-experiments/corpus/postcutoff  root@POD_IP:/workspace/kalsa-reap-prep/corpus/
rsync -a ~/kalsa-models/reap-calib/qwen36-meta               root@POD_IP:/workspace/kalsa-reap-prep/
rsync -a ~/kalsa-models/probe/tokenizer-qwen35-4b            root@POD_IP:/workspace/kalsa-reap-prep/qwen35-tok/
rsync -a ~/kalsa-models/reap-calib/lfm2.5-tokenizer          root@POD_IP:/workspace/kalsa-reap-prep/

# token: file on the pod only (never argv); run_probe reads it per stage
ssh root@POD_IP 'mkdir -p /root/.secrets && chmod 700 /root/.secrets'
scp HF_TOKEN_FILE root@POD_IP:/root/.secrets/hf_token
ssh root@POD_IP 'chmod 600 /root/.secrets/hf_token && bash /workspace/kalsa-reap-prep/podprobe/run_probe.sh'
```
The job downloads at pinned revisions, converts RAZOR (`--no-mtp`), runs the
arms in value order, uploads raw outputs + JSON + logs to the PRIVATE
dataset repo (privacy-gated, token via env/file only, upload verified),
then terminates. On upload failure it stays alive for manual salvage (the
`--terminate-after` stop still applies).

## What could not be verified on the Mac

- The `spike/topk-k2-renorm` patch compiles (Mac compute freeze until 14:00;
  the GPU probe's build is its first compile) — if it breaks, the job falls
  back to fork main and skips only the k2 arm.
- The podprobe scripts against a live model — the one-shot pod run is their
  first execution (bash -n / shellcheck -x / py_compile all EXIT=0).
- runpodctl flag spellings: runpodctl is not installed on this Mac; the
  create command follows the installed Runpod skills, and live
  `runpodctl pod create --help` is authoritative.
- Whether the pod-scoped `RUNPOD_API_KEY` is allowed to terminate its own
  pod (Runpod's DELETE doc does not say; the `--terminate-after` creation
  guard makes the answer non-load-bearing).
- `moep profile`/`score` on CUDA and the surgery/convert path at scale —
  first smoke targets on the pod/Mac when the probe says GO.
- Exact GGUF bytes for our own pruned artifact (estimates anchored to three
  published files, ±1–3 %).
