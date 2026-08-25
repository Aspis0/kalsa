# q59 — Dense-model HTP-readable quant gate: IQ4_NL / Q4_0 vs shipped Q4_K_M (PREREG)

**Status: LOCKED at commit time.** Owner 25/08: ship dense models in an HTP-readable quant
with no kernel work; "cell PC qualità/dimensione decide il vincitore". Primary model:
Qwen3.5-4B (the app default). PC-only, CPU, PC-gentile (`-t 8`, Idle priority).

## Arms (ALL from the SAME source, same pinned llama-quantize — never requantize a quant)
| arm | role |
|---|---|
| Q4_K_M | control = the quality bar the app ships today |
| IQ4_NL | HTP-readable candidate #1 (expected near-Q4_K_M quality) |
| Q4_0   | HTP-readable candidate #2 (fallback) |
| Q8_0   | optional ceiling (HTP-readable, large) |

Source policy (frozen): prefer quantizing from the official F16/BF16 source with our pinned
build (record source sha, build commit); if the source cannot be obtained, use pre-made ggufs
ONLY if all arms come from the same publisher + same source revision (record provenance). Any
mix of provenance across arms = STOP (q36 lesson: double quantization falsifies the comparison).
Sizes recorded in bytes.

## Corpora (frozen, reuse q43)
wiki (`scratchpad/agents/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw`, sha `173c87a5…`) +
q43 IT/ES/FR/ZH corpora (`scratchpad/agents/q43-q8trunk-ppl-gate/corpus/`, shas per MANIFEST).
`-c 2048`, all chunks, same chunk count per arm per corpus.

## Gate (frozen)
For each candidate, Δ% = PPL_candidate / PPL_Q4_K_M − 1 on EVERY corpus.
- **IQ4_NL SHIPS** iff Δ% ≤ +1.0 % on all 5 corpora.
- Else **Q4_0 ships** iff Δ% ≤ +1.0 % on all 5 (unlikely; recorded either way).
- Else no readable dense quant ships without a quality decision by the owner (numbers on the
  table). Size difference vs Q4_K_M reported; not gated.
Secondary models (Qwen3.5-2B, Gemma-4-e2b): same protocol if time allows; reported separately.

## Hygiene
sha256 via Python hashlib; downloads/quantize at Idle priority; one llama process at a time;
no git push; prereg before any download; `RUN_LOG.md`, `manifest.json`, `REPORT.md` (numbers).

## Amendment 1 (PRE-RESULT, 25/08 — no PPL value had been read when this was written)
Compute budget: the first cell (control/wiki, 145 chunks) projected 2h26m → 15 cells ≈ 36 h at
`-t 8` Idle on a dense 4B. Amended, before any result exists:
- wiki: first **64 chunks** (`--chunks 64`, `-c 2048`) for every arm; IT/ES/FR/ZH: all chunks
  (small corpora), identical chunk counts per corpus across arms (unchanged rule).
- Order: control and IQ4_NL alternating per corpus (wiki, IT, ES, FR, ZH) → verdict on IQ4_NL
  first; Q4_0 cells run only if IQ4_NL fails the gate on any corpus (else recorded as skipped).
- Q8_0 ceiling: skipped (optional in the original letter).
Gate arithmetic and thresholds unchanged (Δ% ≤ +1.0 % on all 5 corpora).
