# q41 — pre-registered PPL gate (written BEFORE any measurement)

**Locked:** 2026-08-23, before Marco source re-download, before IQ4_NL recook, before any llama-perplexity invocation.

## Decision object

Marco B′ **IQ4_NL trunk** (experts Q2_K+Q3_K unchanged, from-source cook as in q37) vs **KEXP control** (from-source Q5_K trunk, the kept q37 control GGUF).

## Primary corpus

`wikitext-2-raw` **test** split (`wiki.test.raw`), the llama.cpp CI / `llama-perplexity` standard file (ggml-org/ci zip). Full test set, or a **fixed** chunk count **≥ 100** — same integer for every arm.

## Metric

llama.cpp **perplexity** `P` as printed by `llama-perplexity` (final "perplexity: N.NNNN" / Final estimate). Not bpb, not generation quality.

## Settings (locked; identical across arms)

Binary: `build-llama-pc/bin/llama-perplexity.exe` (built this cell from the existing Ninja tree; `--help` saved as `llama-perplexity-help.txt`). Locked CLI, identical for every arm, **before the first real run**:

```
llama-perplexity.exe -m <MODEL.gguf> -f wiki.test.raw
  -c 512 -b 512 -ub 512 -t 16 -ngl 0
  --chunks -1 --ppl-stride 0
```

- `-c 512` is llama.cpp's default and the conventional wiki-2 PPL context (CI uses 1024; we lock 512).
- `--chunks -1` = entire test file (will be ≥ 100 chunks at ctx 512; if a run prints fewer than 100 we abort and do not score).
- CPU only (`-ngl 0`). Default warmup left ON (same for all).
- No `--n-expert-used`: this binary has no such flag. Uses the GGUF architecture default (Marco `expert_used_count`, native top-k, no campaign drop). This cell measures **weights**, not drop policy.
- one process at a time; PATH includes `build-llama-pc/bin` for DLLs.

## Gate (IQ4_NL vs control)

Let `d = 100 * (P_IQ4_NL - P_control) / P_control`.

| d | verdict |
|---|---|
| **d ≤ +0.5 %** | **PASS** — IQ4_NL-trunk is ship-viable on this gate |
| **+0.5 % < d ≤ +1.0 %** | **GREY** — owner call |
| **d > +1.0 %** | **FAIL** — not ship-viable on this gate |

Negative d (IQ4_NL better) is PASS.

## Optional second arm

Q4_0-trunk, **same** settings, reported but **not** the pre-registered gate. Gate is IQ4_NL-only.

## Optional secondary corpus

Italian `corpus/multi5/it.txt` (already on disk, Wikipedia Caffè v2 / campaign IT slice) **if** the primary run finishes with disk/time left. Not the gate. Skip is allowed; must be noted.

## What this gate does not decide

Speed, NPU runtime, generation A/B (q37). This cell is PPL vs control only.
