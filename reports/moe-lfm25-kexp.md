# LFM2.5-KEXP — expert compression for the G99 free tier

**Date:** 2026-08-12  
**Scope:** PC only. No phone. Jelly speed re-test is a later task.  
**Status: PREP_ONLY** — recipe, source, imatrix, gates, commands ready.  
Quantize / imatrix-compute / PPL not started: Marco quality (`run_marcokexp_quality.ps1` +
`bmoe-cli --ppl-decode` on `Marco-Mini-Instruct-KEXP.gguf`) still owns the CPU.

Precedent: KEXP 1c (`results/requant1c/tensor_types.txt`) and MarcoKEXP prep
(`reports/moe-prep-marcokexp-litert.md`). Context: `reports/moe-g99-freetier.md`.

Artefacts: `results/lfm25_kexp/`

---

## 1. Source

Highest-precision official GGUF: **F16**.

| | |
|---|---|
| Repo | https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF |
| File | `LFM2.5-8B-A1B-F16.gguf` |
| Size | **16 947 260 640** B |
| sha256 (HF LFS oid) | `c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159` |
| Dest | `models/LFM2.5-8B-A1B-F16.gguf` |
| pc_sha | `c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159` |
| Match | **YES** (Get-FileHash 2026-08-12) |

Q8_0 exists on the same repo (9 010 195 680 B, sha
`33ab3b8ce6a964fb8ebac89360c9b3cf72c4fa418d5e4c0a94d46883124d5c02`) — KEXP/Marco
precedent, not chosen because F16 is official and avoids `--allow-requantize`.

Dump / A0 model (already verified):

| | |
|---|---|
| File | `models/LFM2.5-8B-A1B-Q4_K_M.gguf` |
| Size | 5 155 564 768 |
| sha256 | `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0` MATCH HF |

Deprecated, unused: `models/LFM2-8B-A1B-Q4_K_M.gguf`.

Full verbal: `results/lfm25_kexp/SOURCE_IDENTIFIED.md`.

---

## 2. Recipe

Dump of 256 tensors from the official Q4_K_M via `gguf.GGUFReader`.
Names are arch-level; F16 shares them.

`lfm2moe`: 24 layers, hidden 2048, 32 experts, k=4, expert FFN **1792**,
**2 leading dense** (blk.0–1), **6 attn** (2, 6, 10, 14, 18, 21), **18 shortconv**,
**22 MoE**, **no shared expert**, tied embeddings.

| class | type | n | KEXP analog |
|---|---|---:|---|
| `ffn_gate_exps`, `ffn_up_exps` | q2_k | 44 | 1c gate/up |
| `ffn_down_exps` | q3_k | 22 | 1c down |
| dense `ffn_gate/up` | q5_k | 4 | dense |
| dense `ffn_down` | q6_k | 2 | shexp-down (no shexp here) |
| attn Q/K/V/O | q5_k | 24 | attn |
| `shortconv.in_proj` | q5_k | 18 | **not in KEXP** — treated as attn |
| `shortconv.out_proj` | q6_k | 18 | analogy of `ssm_out` |
| `shortconv.conv`, norms, router, `exp_probs_b` | f32 | 123 | norms/router/conv |
| `token_embd` | q5_k | 1 | embd |
| `^output\.weight$` | q5_k | 0 | 1c lesson; **will not match** (tied) |

**Inapplicable (not forced):** `ffn_*_shexp`, `attn_qkv`, `attn_gate`, `ssm_*`,
`output.weight`. See `NOTES.md`.

**Correction vs the brief:** LFM expert FFN 1792 is **wider** than the 35B's 512
(`qwen35moe.expert_feed_forward_length` in the KEXP dump). The risk is not "tiny
experts". It is: no shared expert, 32 generalist experts, hybrid shortconv mixer.

Files:

- `results/lfm25_kexp/tensor_types_lfm25.txt` — passed to `--tensor-type-file`
- `results/lfm25_kexp/tensor_types_patterns.txt`
- `results/lfm25_kexp/layer_map.txt`
- `results/lfm25_kexp/NOTES.md`

k-quants only. No IQ*. OpenCL-safe.

---

## 3. imatrix

Campaign has no owned calibration corpus (only multi5 + Dante, both meters).

KEXP 1c used Unsloth's precomputed imatrix. Same path here:

| | |
|---|---|
| Repo | https://huggingface.co/unsloth/LFM2.5-8B-A1B-GGUF |
| File | `imatrix_unsloth.gguf_file` |
| Size | 17 375 232 |
| sha256 | `09cf3e3f38c9906dc0239750f524d4e728b8fe985ad04bcfc07dd55bbb6e4474` |
| Local | `models/imatrix_lfm25_unsloth.gguf_file` |
| Match | **YES** |

Unsloth calib ≠ multi5. Campaign-owned `llama-imatrix` command is written in
`IMATRIX_PLAN.md` and **not run** (not needed; CPU reserved).

---

## 4. Quantize command (PREPARED)

Binary: `build-pc-quantize\bin\llama-quantize.exe`  
`--dry-run` supported (verified `--help`).

```powershell
$Q     = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc-quantize\bin\llama-quantize.exe"
$SRC   = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\LFM2.5-8B-A1B-F16.gguf"
$IM    = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\imatrix_lfm25_unsloth.gguf_file"
$TYPES = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\tensor_types_lfm25.txt"
$OUT   = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\LFM2.5-8B-A1B-KEXP.gguf"

& $Q --dry-run --imatrix $IM --tensor-type-file $TYPES $SRC $OUT Q5_K
& $Q          --imatrix $IM --tensor-type-file $TYPES $SRC $OUT Q5_K
```

No `--allow-requantize` (F16). No `--leave-output-tensor` (tied).  
Full script + sha gate: `results/lfm25_kexp/QUANTIZE_CMD.md`.  
**Not executed.**

---

## 5. Gates (declared before any LFM2.5 PPL)

See `results/lfm25_kexp/GATES.md`. Frozen (mandate text):

| id | comparison | threshold |
|---|---|---|
| G1 per-lang | KEXP-k vs A0-Q4KM **same k** (k=4,3,2) | Δbpb ≤ +0.10 |
| G1 macro | same | Δbpb ≤ +0.05 |
| G2 fail-fast | KEXP k=3/k=2 vs KEXP-k4, **IT+EN only** | Δbpb ≤ +0.05 |

zh/es/fr at k<4 are reported + G1, not G2 (mandate said IT+EN). A0-k3/A0-k2
are required so same-k G1 can be scored. A0 k-reduction vs A0-k4 is reported
(G99 product-cell question) but is not G1.

`it.txt` on disk **is** v2 (Wikipedia Caffè, sha `498a5f3b…545a`). Harness:
`scripts/run_multi5_ppl_host.py --threads 8 --moe-stream --n-expert-used N`.

**PPL tables: empty.** No LFM2.5 multi5 run exists on disk. No numbers invented.

A0 can run as soon as Marco releases the CPU (Q4 is already local). KEXP PPL
waits on quantize.

Jelly speed: **out of scope**.

---

## 6. Coexistence

Observed during prep (not llama-quantize):

- `run_marcokexp_quality.ps1`
- `run_multi5_ppl_host.py --tag KEXP-1c` on `Marco-Mini-Instruct-KEXP.gguf`
- `bmoe-cli.exe --ppl-decode` `-t 8`

Downloads only while that job ran. F16 + Unsloth imatrix pulled. No
`llama-quantize`, no `llama-imatrix`, no LFM PPL.

---

## Deliverable checklist

| item | state |
|---|---|
| Source ID + F16 download | yes, sha match |
| Unsloth imatrix + sha | yes, match |
| Tensor dump + recipe + NOTES | yes |
| Quantize command + dry-run flag | prepared, not run |
| Gates pre-declared | yes |
| A0 / KEXP PPL | **not run** |
| `models/LFM2.5-8B-A1B-KEXP.gguf` | **absent** |

Pipeline armed: `scripts/run_lfm25_kexp_when_idle.ps1` (poll 10 min). Status
`results/lfm25_kexp/PIPELINE_STATUS.txt`. When Marco releases the CPU it will
run A0 k=4/3/2 → dry-run → quantize → verify types → KEXP k=4/3/2.

**PREP_ONLY** (quantize/PPL not started in this session).
