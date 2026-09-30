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
- Gate corpus `corpus/text-holdout/` (tracked; scratchpad .txt is
  gitignored): ≥ 500 KB/language × 5 (public-domain PG
  books, non-Wikipedia, header/footer stripped, MANIFEST with sha256).
  Containment-checked against the calibration (`eval/check_holdout_disjoint.py`;
  Jaccard replaced — it was structurally ~0).
- Scoring: `eval/run_gen_eval.py` — dialect-fair tool matching
  (`eval/toolcalls.py`; LFM's `<|tool_call_start|>[name(args)]<|tool_call_end|>`
  read from its GGUF, Qwen's `<tool_call>{json}</tool_call>`), `--no-display-
  prompt`, `--single-turn`, thinking-off for every model, per-item JSON.
- CIs: `eval/bootstrap_ci.py`, paired percentile bootstrap on every metric.
- Thresholds and the verdict rule: `docs/EVAL-GATE.md`.

## What could not be verified on the Mac

- Whether the pod-scoped `RUNPOD_API_KEY` is allowed to terminate its own
  pod (Runpod's DELETE doc does not say; the `--terminate-after` creation
  guard makes the answer non-load-bearing).
- `moep profile`/`score` on CUDA and the surgery/convert path at scale —
  first smoke targets on the pod/Mac when the probe says GO.
- Exact GGUF bytes for our own pruned artifact (estimates anchored to three
  published files, ±1–3 %).
