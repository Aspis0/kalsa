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
   responses 204/400/401; verified 2026-09-30 that the pod-scoped key gets
   **403** there — a pod cannot delete itself, so the shelved REAP job's
   in-pod delete was never going to fire; the control REST is v1-only,
   `api.runpod.ai/v2` is the serverless runtime API, which is what the old
   script got wrong). The WORKING in-pod action is STOP — see the GPU
   probe section, prerequisite 4.
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
  a Wikipedia article CREATED after 2026-07-01 (recentchanges rctype=new).
  CAVEAT (Fable-3): page creation is not content novelty — many pages are
  translations of long-existing articles, so this measures cross-lingual
  recall with a cutoff asymmetry favouring Qwen; symmetric across arms but
  not a clean instrument. CC-BY-SA-4.0 with per-document
  title/pageid/revid attribution in `MANIFEST.json`. bpb is evaluated
  per-document and the bootstrap units are documents.
- Scoring: `eval/run_gen_eval.py` — dialect-fair tool matching
  (`eval/toolcalls.py`; LFM's `<|tool_call_start|>[name(args)]<|tool_call_end|>`
  read from its GGUF, Qwen's `<tool_call>{json}</tool_call>`; args compared
  on canonicalised, order-insensitive JSON), **thinking ON for every model
  (product parity), math datasets at n_predict 8192** (the A40 probe cut
  reasoning models mid-think at 4096; tools stay at 4096), prompts sent
  through the server's `/v1/chat/completions` so the SERVER owns template +
  tokenization (single BOS; the raw-prompt path doubled BOS — Fable-2), raw
  model output stored per item, per-item JSON.
- Added 2026-10-01 (DESIGN §4 item 3, details in `PHASE0-EVALS.md`):
  HumanEval+ (`eval/run_humaneval.py`, sandboxed subprocess execution — the
  harness never execs model code, the isolation is best-effort for the
  disposable pod and the runner refuses macOS), FLORES-200 devtest
  EN→{IT,FR,ES,ZH} chrF++ + wrong-language rate (`eval/run_flores.py`,
  fastText lid.176; truncations reported separately, failing the run above
  2 %), GSM8K-Italian 100 items (`eval/gsm8kit-100.jsonl` via
  `--dataset gsm8kit`), the S1 stop-rule check (`eval/check_stop_rule.py`,
  fail-closed: missing or partial JSON is a STOP — and WIRED into the
  probe: `run_probe.sh` runs it for the k=4 128-expert arms vs
  `qwen36-k4` after the arm loop), and the holdout builders
  (`eval/build_{humaneval,flores,gsm8kit}_holdout.py`,
  `eval/fetch_lid176.sh`; the sha256 pins are enforced comparisons, and
  `00_env.sh` verifies/rebuilds `humaneval-164.jsonl` on the pod before any
  GPU hour). Every generation runner appends to a per-item journal and
  resumes on rerun (a killed arm keeps its finished evals), and the evals
  run concurrently on `llama-server -np $PROBE_SLOTS` slots with matching
  `--concurrency`.
- CIs: `eval/bootstrap_ci.py`, paired percentile bootstrap on every metric
  (per-chunk for bpb, per-item for gsm8k/tools; also the per-sentence chrF
  and per-item wrong-language units — the FLORES JSONs are bpb-shaped).
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

### Arms, runtime and cost estimates (A100 80 GB, ~$1.98/h, thinking ON, math+humaneval at 8192)

Order = decision value (Fable-3 §1): the baseline, then the free-prune
verdict (RAZOR k=8) WITH its control (dense 4B) before the k=4 arms, then
the owner's 8 GB-class extras. The guard skips any arm whose estimate no
longer fits `PROBE_BUDGET_H`; each arm also has its own
`PROBE_ARM_TIMEOUT_H` kill switch; results upload after EVERY arm, so a
late failure or the hard stop can only lose the arm in flight. The gate
now carries 964 generations/arm with the evals running 4 concurrent slots
(`PROBE_SLOTS=4`) — the estimates and the budget knobs come from the
per-arm token arithmetic in `PHASE0-EVALS.md` ("Probe budgets"); nothing
about the 35B throughput on a pod GPU is measured yet, so the honest band
per 35B-class arm is wide (2.5 h realistic → 8.3 h mid → 16.7 h at the
audit's conservative floor; est 3.0 h books the realistic case and the
guard degrades gracefully).

| # | arm | gate | est. hours | est. cost |
|---|---|---|---:|---:|
| 0 | setup: venv + CUDA build + fetch (~66 GB) + convert RAZOR-19B + 2 quants | — | 1.3–2.0 | $2.60–4.00 |
| 1 | LFM2.5-2.6B ship QAD-Q4_0 (baseline) | full | 0.8–1.5 | $1.60–3.00 |
| 2 | RAZOR-19B k=8 Q4_K_M — the free 50 % prune verdict | full | 2.5–8.5 | $5.00–16.80 |
| 3 | Qwen3.5-4B Q4_K_M (the control the bar is written against) | full | 1.0–2.0 | $2.00–4.00 |
| 4 | RAZOR-19B k=4 Q4_K_M (cost of the only speed lever) | full | 2.5–8.5 | $5.00–16.80 |
| 5 | Qwen3.6-35B-A3B unpruned k=4 (separates "pruning hurt" from "k=4 hurt") | full | 2.5–8.5 | $5.00–16.80 |
| 6 | RAZOR-19B k=4 + k2=16 renorm (spike build; the product config if any) | full | 2.5–8.5 | $5.00–16.80 |
| 7 | Qwen3.5-2B Q4_K_M (8 GB-class candidate) | full | 0.4–0.8 | $0.80–1.60 |
| 8 | Qwen3.5-2B Q4_0 | full | 0.4–0.8 | $0.80–1.60 |
| 9 | RAZOR-19B k=8 Q4_0 (phone-quant cost) | full | 2.5–8.5 | $5.00–16.80 |
| — | **core total (0–5)** | | **10.6–31.0** | **$21.00–61.40** |

Read that honestly: the new workload no longer fits the original $10 owner
cap at ANY documented rate — the realistic band (~$21–30 for the decision
set) needs the owner's OK, and at the audit's conservative 15 tok/s floor
the 35B arms do not fit any budget (the guard skips them by design). The
knobs (`PROBE_BUDGET_H=24`, `PROBE_HARD_STOP_H=26`,
`PROBE_ARM_TIMEOUT_H=10`) are ceilings, not spend targets; the per-item
journals mean a killed or relaunched arm keeps every finished eval. bpb is
ONE llama-perplexity run per language
(concatenated documents, `-c 1024` chunks as CI units), not 275 separate
loads. Each arm reports, next to pass rates: the thinking-truncation rate
per stage (math/humaneval at the 8192 cap, tools at 4096, flores at 4096
with a hard FAIL above 2 % truncated), a double-BOS warning count (checked
after the requests), and TWO benches — GPU (`-ngl 99`, ranks arms on this
pod) and CPU (`-ngl 0 -t $(nproc)`, the PC proxy; community vCPU counts
vary, so it is a proxy, not a device number). Speed on a real 16 GB phone
remains a later device session.

### Coordinator launch sequence (I do not run these)

Prerequisites (once, owner/coordinator):
1. Create PRIVATE dataset repo (owner's org; the job never creates repos):
   `hf repo create Kalsa-ai/kalsa-gate-probe-results --repo-type dataset --private`
   (2026-09-30: creation with our token was rejected by the org — 403,
   owner deciding; the repo id stays pinned in `podprobe/env.sh` meanwhile,
   override with `HF_RESULTS_REPO` if it lands elsewhere)
2. One-time ship-baseline upload (it exists only on the Mac):
   `hf upload Kalsa-ai/kalsa-gate-probe-results ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf ship/LFM2.5-2.6B-QAD-Q4_0.gguf --repo-type dataset`
3. If arm 6 (k2) is wanted: `git -C ~/Projects/kalsallama-spike-k2 push origin spike/topk-k2-renorm`
   (not pushed by the prep session; the job falls back to fork main and
   skips arm 6 if the branch is absent).
4. Self-stop **VERIFIED 2026-09-30 on a 1-minute CPU pod**: the
   pod-scoped key CAN stop its own pod (REST `POST …/pods/{id}/stop`, or
   the GraphQL `podStop` mutation — keep both, REST first; the coordinator
   could not tell which of the two acted) but CANNOT delete it
   (`DELETE …/pods/{id}` → 403). The job stops itself at the hard-stop
   deadline, after the final upload, and on the no-salvage failure path;
   **a stopped pod still bills its VOLUME until you delete it** — delete
   the pod in the console when you collect the results.

Pod creation is done by the COORDINATOR through the Runpod MCP with these
parameters (runpodctl create flags verified absent for terminate-after, so
the MCP is the path; adjust names to the MCP tool's fields):

- GPU type: `NVIDIA A100 80GB PCIe` (the gate pod; the budget knobs in
  `podprobe/env.sh` are derived for it — see `PHASE0-EVALS.md` "Probe
  budgets"). An L40/RTX PRO 5000 48 GB also fits every arm but at lower
  decode rates: re-derive the knobs from that table instead of copying
  them (and note the 28B arm does not fit 48 GB).
- Image: `runpod/pytorch:1.4.0-cu1281-torch271-ubuntu2204` — tag verified
  on Docker Hub 2026-09-30 (torch 2.7.1, CUDA 12.9; the previous
  `2.7.1-cuda12.8.0-…` tag does not exist).
- Container disk: 40 GB · Volume: 200 GB mounted at `/workspace`.
- Ports: none needed · SSH: yes (bundle upload + launch).
- Env: nothing (the HF token goes to `/root/.secrets/hf_token` by scp, not
  into the pod env).

```bash
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
The job arms its own hard STOP first (sleep PROBE_HARD_STOP_H, then stop
of its own pod via the injected key — REST then GraphQL podStop, verified
per prerequisite 4), then: pinned downloads, RAZOR `--no-mtp` conversion,
value-ordered arms with per-arm timeout, per-arm upload to the PRIVATE
dataset repo (privacy-gated, token via env/file only, tree-verified), and
a self-stop at the end (success or no-salvage failure) so an idle pod
never keeps billing the GPU. Volume billing ends only when you delete it.

## What could not be verified on the Mac

- The `spike/topk-k2-renorm` patch compiles (Mac compute freeze until 14:00;
  the GPU probe's build is its first compile) — if it breaks, the job falls
  back to fork main and skips only the k2 arm.
- The podprobe scripts against a live model — the one-shot pod run is their
  first execution (bash -n / shellcheck -x / py_compile all EXIT=0).
- runpodctl flag spellings: runpodctl is not installed on this Mac; the
  create command follows the installed Runpod skills, and live
  `runpodctl pod create --help` is authoritative.
- RESOLVED 2026-09-30 (coordinator, two CPU pods): self-STOP works
  (REST/GraphQL), self-DELETE is 403 — see prerequisite 4.
- `moep profile`/`score` on CUDA and the surgery/convert path at scale —
  first smoke targets on the pod/Mac when the probe says GO.
- Exact GGUF bytes for our own pruned artifact (estimates anchored to three
  published files, ±1–3 %).
