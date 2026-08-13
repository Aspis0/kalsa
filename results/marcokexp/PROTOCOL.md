# MarcoKEXP — quality protocol (PC only)

**GO:** 2026-08-12 — download Q8, build **both** recipes, PPL both on PC.  
**No phones** until `VERDICT.md`.

## Files

| id | tensor_types | out GGUF |
|---|---|---|
| KEXP-1c | `tensor_types_1c.txt` | `models/Marco-Mini-Instruct-KEXP.gguf` |
| KEXP-cons | `tensor_types_conservative_q3k.txt` | `models/Marco-Mini-Instruct-KEXP-q3k.gguf` |

Source: `models/Marco-Mini-Instruct.Q8_0.gguf` (18 356 453 952 B, sha `3287457a…`).  
imatrix: `models/Marco-Mini-Instruct.imatrix.gguf` (81 548 704 B, sha `f05d4d4a…`).

## Recipe 1c (clone CalaQwen requant-1c, no shexp/ssm)

- attn `q5_k` · `ffn_gate_exps`/`ffn_up_exps` `q2_k` · `ffn_down_exps` `q3_k`
- `token_embd` + `^output.weight$` `q5_k` · norms + router `f32`
- `--imatrix` on · `--allow-requantize`

KEXP-cons = prep as written: attn `q4_k`, all three expert mats `q3_k`.

## Metro (same slices as Fase 1)

- IT = Wikipedia «Caffè» v2 only (`corpus/multi5/it.txt`, sha `498a5f3b…`). **Never** literary Dante.
- Anchor A0 = i1-Q4_K_M (`A0_baseline.json`): en 0.6051 · es 0.6766 · fr 0.7234 · it 0.7501 · zh 0.8834 · macro 0.7277
- Runtime product cell: **A2** (`--n-expert-used 6 --drop-cold-experts 0.65`)
- Shared flags: `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096 -t 8 --ppl-decode`

## Gates (locked before numbers)

Per recipe, fail-fast **IT+EN** A2 vs A0:

| gate | threshold |
|---|---|
| IT / EN Δbpb | ≤ **+0.08** |
| FAIL | that recipe gets **no** full multi5 |

Full multi5 (en/es/fr/it/zh) only if fail-fast PASS:

| gate | threshold vs A0 |
|---|---|
| per-lang | no Δbpb > **+0.12** |
| macro-5 | Δbpb ≤ **+0.06** |

Extra **k=8 drop OFF** only on recipes that pass full (requant tax isolated). One such cell max if both pass (prefer 1c).

Not a gate: vs i1-Q4 A2 same k/drop.

If both PASS → owner picks. If one PASS → that one proceeds. If zero → **NO-GO** Fase 2.

## Device speed (NOT this GO)

After ≥1 recipe quality PASS, later ABBA vs i1-Q4 A2: MiB/tok ≤ −40% **or** hit ≥ +15 pt; decode ≥ 0.90×.

## STOP

No Q8 “just to look”. No phone push. No product default change. No GPU-750 work.
