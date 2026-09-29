# Eval gate: Kalsa-REAP vs shipped LFM2.5-2.6B

Plan only — nothing here has been run; it defines what the FASE C campaign
must measure and the exact "wins clearly" thresholds. Every cell is measured
**paired**: same device, same llama.cpp build, same session, same prompts,
greedy where deterministic.

## Baseline anchors already in the lab (not re-derived)

| fact | value | source |
|---|---|---|
| ship artifact | `LFM2.5-2.6B-QAD-Q4_0.gguf`, 1,593,894,944 B, sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` | `~/kalsa-models/mac/`, matches `docs/ALIVE.md` "Ship model" line |
| S23, Q4_K_M | pp512 84.09 / tg128 16.04 tok/s | `scratchpad/agents/archive-gpu-docs/REPORT.md:183` |
| Hexagon-adjacent CPU, tg128 @ d1920 | 17.68 ± 4.17 tok/s | `scratchpad/agents/npu-spec-verify/REPORT.md:20` |
| official decode | 30 tok/s on unnamed phone | `reports/research-lfm25-26b.md` |

The ship baseline column is re-measured in every gate session anyway; the
anchors exist so a suspicious Kalsa number can be cross-read immediately.

## Gate matrix (columns = models, rows = metrics)

| metric | LFM2.5-2.6B QAD-Q4_0 (ship baseline) | Qwen3.6-35B-A3B unpruned (ceiling) | Kalsa-REAP50 | Kalsa-REAP65 | Kalsa-REAP75 |
|---|---|---|---|---|---|
| EN bpb, `corpus/multi5/en.txt` | measure | ceiling | measure | measure | measure |
| IT bpb, `corpus/multi5/it.txt` | measure | ceiling | measure | measure | measure |
| reasoning: GSM8K-200 pass@1, greedy | measure | measure | measure | measure | measure |
| tool calls: 100 hermes-format prompts, exact JSON-arg match | measure | measure | measure | measure | measure |
| decode tok/s, S23 (+ G99 second opinion) | measure | n/a (does not fit any class) | measure (streamed) | measure | measure |
| peak RSS / resident budget | measure | n/a | per PARAM-BUDGET table | per table | per table |
| degeneration (8-prompt smoke) | 0 | 0 | 0 | 0 | 0 |

- **Quant**: primary Q4_K_M (16 GB phone/PC resident arms), plus Q4_0 for the
  8 GB streaming arms; both quants for the winning ratio. Imatrix-calibrated
  on the Kalsa calibration mix (same mix for both quants, mirroring the
  paper's equal-footing rule).
- **bpb harness**: the F0 pipeline (`scripts/run_reap_f0_pc.py`, bmoe-cli)
  over the frozen multi5 slices — the same slices used for F0, whose numbers
  (EN 12.89, IT 115.27 for REAP20-Q2_K with coding-only calibration) show
  what a mismatched calibration does to IT; our gate exists to prove the
  opposite.
- **Reasoning/template**: `enable_thinking` off for Qwen-family columns;
  GSM8K-200 is a fixed 200-item slice (seed 42) of the test split, strict
  match on the `####` answer, served through llama-server.
- **Tool calls**: 100 prompts built from hermes-format schemas that are NOT
  in the calibration rows (holdout by id), EN 40 + IT 20 + ES/FR/ZH 40 to
  test cross-lingual transfer of the tool path; exact-match on called
  function + JSON args.
- **Unpruned ceiling on phones**: not runnable at any ratio/quant in the fit
  table; measured on the 16 GB PC class only, and marked n/a elsewhere.

## "Wins clearly" — the ship threshold

Kalsa (one chosen artifact: ratio + quant) must satisfy **all** of the
following against LFM2.5-2.6B QAD-Q4_0 measured in the same session:

1. **IT bpb** ≤ LFM_IT − 0.30 (absolute bits-per-byte on the frozen slice).
2. **EN bpb** ≤ LFM_EN − 0.20.
3. **Reasoning**: GSM8K-200 pass@1 ≥ LFM + 15 points.
4. **Tool calls**: exact-match ≥ LFM + 15 points (and ≥ LFM in EVERY
   language slice — no language may regress).
5. **Degeneration**: 0 of 8 smoke prompts degenerate (hard fail otherwise,
   regardless of other numbers — the paper's §5.4 smoke caveats are why this
   is a gate and not a score).
6. **Speed floor**: decode ≥ 0.5 × LFM decode on the same device. (LFM is
   resident-dense; a streamed Kalsa that falls below half its speed loses
   the product argument even with better quality. CalaQwen's 5.70 tok/s
   streamed is the precedent for what streamed Qwen3.6 costs.)
7. **Fit**: peak RSS within the PARAM-BUDGET budget for the class shipped
   (resident arms), or streamed with the flash footprint of the chosen
   artifact.

Rationale for the margins: ±3–4 points is the noise floor of a 164-item
benchmark (paper §4), so 15 points on a 200-item set is ~4× noise; 0.2–0.3
bpb is well above slice-level measurement jitter in F0's runs (±0.02 bpb
class); 0.5× speed is the point where a chat user notices waiting.

**Verdict rule**: if no ratio passes all seven, the default is `no-ship` and
CalaQwen/LFM2.5-2.6B stay the lineup — the gate exists precisely to prevent
shipping a big model that does not clear the small one by a wide margin.
