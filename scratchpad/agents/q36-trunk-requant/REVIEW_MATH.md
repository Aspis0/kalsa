# REVIEW_MATH.md — hostile math/numbers audit of q36-trunk-requant REPORT.md

**Audited:** `scratchpad/agents/q36-trunk-requant/REPORT.md` (2026-08-23 11:37)
**Auditor method:** every claim was re-derived from the cited artifacts (all read
on disk), the three GGUFs + baseline were re-parsed with an independent minimal
GGUF parser, and the expert-content SHA256 was **recomputed from raw file bytes**
(`_audit_sha.py`, written for this audit, left in the cell dir).
**Legend:** CONFIRMED (source + arithmetic) · REFUTED (correct math shown) ·
UNTRACEABLE (claimed, no artifact carries it).

**Bottom line:** zero refuted numbers. Every byte count, delta, percentage,
GiB/MiB conversion, tensor count and payload sum in REPORT.md checks out,
including the two hashes, which I recomputed independently from disk.
Three minor wording nits and two UNTRACEABLE side-claims noted at the end.

---

## 1. File inventory (§1.1)

| Claim | Verdict | Evidence / recalculation |
|---|---|---|
| KEXP `6 385 238 848` bytes | **CONFIRMED** | `ls models/` = 6,385,238,848; `verify_variants.json` baseline.bytes_on_disk = 6385238848; `results/marcokexp/QUANTIZE_VERIFY.md` "size=6385238848" — three independent sources agree |
| LFM2.5 KEXP `3 326 160 384` | **CONFIRMED** | `ls models/` |
| Qwen KEXP `13 416 430 592` | **CONFIRMED** | `ls models/` |
| "~6.4G" (Marco) | **CONFIRMED** | 6,385,238,848 B = 6.385 GB decimal |
| "~5.95 GiB" (Marco, §1.2) | **CONFIRMED** | 6,385,238,848 / 2^30 = 5.9466 GiB |
| Marco disk sha `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` | **CONFIRMED** | Re-computed full-file SHA256 of on-disk `models/Marco-Mini-Instruct-KEXP.gguf` = `2f921958…` — **byte-identical to the cook-time hash in QUANTIZE_VERIFY.md**. The shipped file is unchanged since the cook |
| 338 tensors, F32 141 / Q5_K 113 / Q3_K 28 / Q2_K 56 | **CONFIRMED** | Re-parsed header: 338 records; histogram (gguf-py names): F32=141, Q5_K=113, Q3_K=28, Q2_K=56. Same in `verify_variants.json`, `baseline_summary.txt`, `QUANTIZE_VERIFY.md` |
| "113 = 28×(attn_q,k,v,output) + token_embd.weight" | **CONFIRMED** | 28×4 = 112 + 1 = 113. Re-parsed: 112 tensors named `blk.N.attn_{q,k,v,output}.weight` + `token_embd.weight`, all Q5_K on baseline |
| "no Q6_K tensor" | **CONFIRMED** | No Q6_K in `baseline_summary.txt` nor in the re-parsed histogram; same for all four files |
| "No `output.weight` (tied embeddings)" | **CONFIRMED** | No output.weight in either dump or my re-parse. (The recipe `tensor_types_1c.txt` contains a dead `^output\.weight$=q5_k` line — harmless, no such tensor exists) |
| "28 layers, hidden 1024, vocab 151936, GQA 16/8 head_dim 128" | **CONFIRMED** | Layers `blk.0`…`blk.27`; n_embd 1024; token_embd (1024, 151936); attn_q (1024, 2048) = 16×128, attn_k/v (1024, 1024) = 8×128 |
| router payload `29 360 128` | **CONFIRMED** | `baseline_summary.txt` router: 28×F32, bytes=29360128; = 28 × 1024×256×4 B = 28 × 1,048,576 = 29,360,128 ✓ |
| "norms + router + extras \| 141 F32" | **CONFIRMED** (nit below) | 113 norm (262,144 B) + 28 router (29,360,128 B) = 141. **"extras" is empty** — the dump contains exactly norms + router, no extras (nit R1) |

## 2. Expert payloads — the 2422210560 + 1849688064 + 1849688064 probe

| Claim | Verdict | Evidence / recalculation |
|---|---|---|
| down experts 28 × Q3_K = 2,422,210,560 | **CONFIRMED** | Per-tensor: shape (768, 1024, 256) = 201,326,592 elems; Q3_K = 110 B/256 (verified against llama-quantize's own cook log "204.00 MiB -> 82.50 MiB": 82.50 MiB = 86,507,520 B = 110/256 × 201,326,592; also `GGML_QUANT_SIZES[Q3_K] = (256, 110)`). 28 × 86,507,520 = 2,422,210,560 ✓ |
| gate 28 × Q2_K = 1,849,688,064 | **CONFIRMED** | Q2_K = 84 B/256 (dry-run log "63.000 MiB" for 201,326,592 elems; `GGML_QUANT_SIZES[Q2_K] = (256, 84)`). 28 × 66,060,288 = 1,849,688,064 ✓ |
| up 28 × Q2_K = 1,849,688,064 | **CONFIRMED** | Same shapes/types as gate (dims identical: (1024, 768, 256)); class sum from my re-parse = 1,849,688,064 |
| experts total = 6,121,586,688 | **CONFIRMED** | 2,422,210,560 + 1,849,688,064 + 1,849,688,064 = 6,121,586,688 ✓ (arithmetic exact; also equals 84 × 72,876,032 mean — class sums verified per-class from re-parsed GGUF) |
| trunk Q5_K = 228,073,472 | **CONFIRMED** | Re-parse: attn 121,110,528 (28 × 4,325,376) + token_embd 106,962,944 = 228,073,472. Cross-check by hand: 1,441,792+720,896+720,896+1,441,792 per layer × 28 = 121,110,528; token_embd 155,582,464/256×176 = 106,962,944 |
| "tied embedding (102 MiB of 217 MiB trunk)" (§4.1) | **CONFIRMED** | 106,962,944 B = 102.01 MiB; 228,073,472 B = 217.51 MiB. Ratio 46.9% of trunk |
| "Trunk is only 3.6 % of the file" | **CONFIRMED** | 228,073,472 / 6,385,238,848 = 3.5717 % |
| mini bookkeeping | **CONFIRMED** | Payload sum 6,379,282,432 + header/data_offset 5,956,416 = 6,385,238,848 ✓ exact (data_offset independently confirmed: 5,956,416) |

## 3. Sizes, deltas, percentages (§3.1, §3.2, §7)

| Claim | Verdict | Evidence / recalculation |
|---|---|---|
| q8_0 total 6,509,642,560, Δ +124,403,712, +1.948 % | **CONFIRMED** | `verify_variants.json` + `ls gguf/`. Δ = 6,509,642,560 − 6,385,238,848 = 124,403,712; % = 124,403,712/6,385,238,848 = 1.9483016213084343 % (json carries full precision; report rounds to 1.948) |
| iq4_nl & q4_0 totals 6,343,770,944, Δ −41,467,904, −0.649 % | **CONFIRMED** | 6,343,770,944 − 6,385,238,848 = −41,467,904; % = −0.6494338737694781; both files identical size in `ls`; both json entries match |
| q8_0 trunk 352,477,184 = baseline + 124,403,712 | **CONFIRMED** | 352,477,184 − 228,073,472 = 124,403,712 ✓. Re-parse: attn 187,170,816 (28 × 6,684,672; Q8_0 = 34 B/32) + token_embd 165,306,368 (4,861,952 × 34) = 352,477,184 |
| iq4_nl / q4_0 trunk 186,605,568 = baseline − 41,467,904 | **CONFIRMED** | Re-parse both: attn 99,090,432 + token_embd 87,515,136 = 186,605,568. −41,467,904 ✓. 4.5 bpw both (Q4_0 and IQ4_NL both 18 B/32): 331,743,232 elems × 0.5625 = 186,605,568 ✓ |
| "even Q8_0 is a +2 % GGUF" | **CONFIRMED** | +1.948 % |
| GiB columns 6.063 / 5.908 / 5.908 in QUANTIZE_STATUS.txt | **CONFIRMED** | 6,509,642,560/2^30 = 6.0626; 6,343,770,944/2^30 = 5.9080 |
| dry-run totals 6083.76 → 6202.40 / 6044.21 / 6044.21 MiB | **CONFIRMED** | Verbatim last lines of `dryrun-q8_0.log`, `dryrun-iq4_nl.log`, `dryrun-q4_0.log` (also BPW 2.96 → 3.02 / 2.94 / 2.94 there) |
| "Matches the disk deltas to the MiB" | **CONFIRMED** | 6202.40−6083.76 = 118.64 MiB vs 124,403,712/2^20 = 118.642 MiB; 6044.21−6083.76 = −39.55 vs −41,467,904/2^20 = −39.548 MiB |
| expert sha `d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d` identical on all 4 files | **CONFIRMED** | **Recomputed from raw bytes** (name utf-8 + payload, 84 experts/file, SHA256): baseline `d84c4b43…`, q8_0 `d84c4b43…`, iq4_nl `d84c4b43…`, q4_0 `d84c4b43…` — all four MATCH the claim. Experts are byte-identical, not just same-size. Also all 84 expert spans are block-exact (0 padding, 0 length mismatches in re-parse) |
| expert types remain 56×Q2_K + 28×Q3_K, zero leftover Q5_K, all_ok True | **CONFIRMED** | `verify_variants.json` (types, missing/extra/bad lists empty) + my re-parse histograms: F32 141 / Q2_K 56 / Q3_K 28 / {Q5_K|Q8_0|IQ4_NL|Q4_0} 113 |
| variant file sizes on disk | **CONFIRMED** | `ls gguf/`: 6,509,642,560 and 6,343,770,944 ×2 — match json to the byte |
| wall times Q8_0 29.4 s, IQ4_NL 58.1 s, Q4_0 45.0 s | **CONFIRMED** | `QUANTIZE_STATUS.txt` (rc=0 all) |
| "~217 MiB trunk requantized" | **CONFIRMED** | 228,073,472 B = 217.51 MiB (2^20 divisor; the auditor's first-pass "217.54" was the auditor's own slip — report value 217.51 is correct) |

## 4. Tooling / source claims (§2, §3)

| Claim | Verdict | Evidence |
|---|---|---|
| llama-quantize mtime 2026-08-10 10:24:50 | CONFIRMED | `tooling_probe.txt`, `bin-pc-quantize.txt` |
| bmoe-cli mtime 2026-08-14 01:58:57 | CONFIRMED | `tooling_probe.txt` |
| build-pc-quantize CMakeCache → BigMoeOnEdge/third_party/llama.cpp | CONFIRMED | `ggml_SOURCE_DIR` entry |
| `llama-quant.cpp` same-type skip at 1148–1178 (`quantize = cur_type != new_type`; else `new_data = tensor->data`) | CONFIRMED | read in `BigMoeOnEdge/third_party/llama.cpp/src/llama-quant.cpp:1148-1178` |
| `tensor_allows_quantization` returns false for COPY at line 290 | CONFIRMED | `if (params->only_copy) return false;` is line 290 |
| `--tensor-type-file`, `--allow-requantize` in the 08-10 binary | CONFIRMED | `llama-quantize-help.txt` lines 1, 6, 25, 29 |
| "IQ4_NL does not require imatrix" | CONFIRMED (nit) | `tensor_requires_imatrix` (line 768): flags IQ3_XXS, IQ2_XXS, IQ2_XS, IQ2_S, IQ1_M, IQ1_S + Q2_K only under `MOSTLY_Q2_K_S` ftype; IQ4_NL hits `default: return false` (nit R2: the report's parenthetical enumeration "IQ1/IQ2_XXS and Q2_K_S" is incomplete and garbles Q2_K_S as a type rather than an ftype) |

## 5. Q8/imatrix provenance (§1.2)

| Claim | Verdict | Evidence |
|---|---|---|
| Q8_0 source 18,356,453,952 B (report: "18.36 GB") | CONFIRMED | `SOURCE_IDENTIFIED.md` ("18 356 453 952 B (17.09 GiB)" — 18.36 GB decimal ✓); `logs/dl-marco-q8.log`: got=18356453952 expect=18356453952, sha verified 3287457a… 2026-08-12T23:04:47; `scripts/dl_marco_q8_imatrix.ps1` constants identical |
| imatrix 81,548,704 B, sha f05d4d4a… | CONFIRMED | Same three sources (dl log 23:05:04 OK); `models/DELETED-2026-08-17.md` |
| "no download performed" (this cell) / not re-fetched | CONFIRMED | `results/marcokexp/DL_STATUS.txt` = "OK" but mtime **2026-08-12 23:05:04** (the original cook-time download, files since deleted); no later rewrite. `models/` has no Q8_0/imatrix. `models_staging/marco_dl.log` (100 % of a 5.30 G file, 2026-08-14) is a **staging-era** artefact (matches the i1-IQ2_M line in `models_staging/SHA256SUMS.txt`), not a Q8_0; `logs/dl-marco-q4km.err.log` (9.78 G, 08-14) = the old Q4_K_M, deleted per PLAN.md. Neither contradicts the report |
| PLAN.md quote "Originale Q4KM + cons + sorgente Q8 CANCELLATI (PC −35 GB)" | CONFIRMED (nit R3) | PLAN.md line 802, verbatim "Originale Q4KM + cons + sorgente Q8 CANCELLATI (PC −35 GB; device cleanup in corso)." — the report elides "; device cleanup in corso" and the original has no closing paren after "35 GB" |
| models/ contains no Q8_0/F16/BF16/safetensors | CONFIRMED | `ls models/` (KEXP ×3, Mellum2, OLMoE, LFM badsize, imatrix .gguf_file ×2, logs, dirs) |
| HF cache has no Marco repo | CONFIRMED | `hf-hub-dirs.txt` (Ornith, LFM REAP-50, Qwen-embedding only) |
| cook log loaded `Marco-Mini-Instruct.Q8_0.gguf` → wrote KEXP | CONFIRMED | `logs/quantize-marcokexp.outer.err.log` first line + 197 q8_0 tensors dump |

## 6. Quality A/B (§4) — log arithmetic

| Claim | Verdict | Evidence |
|---|---|---|
| two START baseline lines in ab-sanity.log | CONFIRMED | 10:54:40 and 10:59:29 |
| second run window 10:59:29–11:10:49 | CONFIRMED | log (ANSWERS.md written 11:10:49) |
| long run 11:11:23–11:36:13, ngen=420, 6 prompts | CONFIRMED | `ab-long.log` |
| sanity ngen=300, n=4, k=6 drop=0.0 | CONFIRMED | log header lines; `run_q36_ab.py` K="6" DROP="0.0" |
| "k=6 drop=0.0 (Marco shipped arm in scripts/run_answer_quality_ab.py)" | CONFIRMED (context note) | harness marco arm: `{"id": "shipped", "k": "6", "drop": "0.0", …, label "CONFIG DA SPEDIRE (bpb 0.766534, 13% del budget)"}`; 2026-08-18 log ran shipped k6d0. **Note:** PLAN.md "Scheda prodotto" (line 712) later records product default = k6 **drop 1.0 + --drop-no-renorm** (2026-08-18) — the harness "shipped" label predates/coexists with that; the report's claim refers to the harness arm and is exactly right as stated |
| baseline matches 2026-08-18 shipped arm | CONFIRMED | `answer-sanity-marco-ab.log`: shipped q1 chars=860 tokens=287 — identical to this cell's baseline q1 (chars=860 tokens=287); text in `results/answer_sanity_marco/ANSWERS.md` ("shipped" section) is **verbatim identical** to `ab/sanity/ANSWERS.md` baseline section |
| q8_0 q1 repetition collapse to 300 tok | CONFIRMED | log tokens=300 (ngen cap); text = Button/Trulli self-contradiction loop; stderr_q8_0.log exists (caveat 5) |
| iq4_nl q1 "race cancelled in 2000"; q4_0 starts Häkkinen then "corrects" to Button | CONFIRMED | `ab/sanity/ANSWERS.md` §q1 texts |
| tabellina 9 1–10 correct all; q4_vocali 5/5/5-4/4 pattern | CONFIRMED | `QUALITY_SANITY.md` + ANSWERS.md (iq4_nl self-debate 5→4 at lines 318-355; q4_0 "4 vocali: a, i, a, o" texts) |
| zero identical variant answers (0/12) | CONFIRMED | 12 `DIFFERS` tags in `ab/sanity/ANSWERS.md` |
| f45_1 RAM-math claims (q8_0 "7B×4B=28 GB", iq4_nl "7B×2B=14 GB", q4_0 "~7 GB") | CONFIRMED | `ab/long/ANSWERS.md` lines 40 (q8_0 section), 52 (iq4_nl), 60 (q4_0) |
| f45_3: 3 sentences + 2 questions everywhere; q4_0 typo "misurarele" | CONFIRMED | prompt at lines 66-81; q4_0 answer (lines 108-119) has exactly 3 declarative sentences + 2 questions + typo at line 111 |
| f45_4: function right, q4_0 wrong comment on example | CONFIRMED | q4_0 code (lines 228-257) implements nproc≥6/not-None filter, skip-None, median, None-if-empty correctly; comment "Example 1: No rows with nproc >= 6" contradicts its data (nproc 6 and 7) |
| f45_2: q8_0 adds "server di inferenza" coda | CONFIRMED | line 351 in q8_0 section |
| long_conversational_it: iq4_nl "Bari on a Milano–Napoli train" | CONFIRMED | line 413 in iq4_nl section (Bari listed among stations) |
| tok/s table | CONFIRMED | `QUALITY_SANITY.md` table matches `ab-sanity.log` for all 16 cells |
| deadlock fix story (stderr PIPE → file) | CONFIRMED | `run_q36_ab.py:74-76` documents it; two START lines corroborate |
| "bmoe-cli RSS 22 MiB, CPU ~0" (§4 intro) | **UNTRACEABLE** | No artifact in this cell records RSS/CPU of the deadlocked process (only REPORT.md prose). Plausible, unverifiable |

## 7. NPU desk (§5)

All predicates verified in `upstream-hexagon/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp` (exists; 170,310 B, 2026-08-22):

| Claim | Verdict | Evidence |
|---|---|---|
| quantized MUL_MAT types Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 only, K-quants `default: return false` | CONFIRMED | `ggml_hexagon_supported_mul_mat` switch (cases at 2796-2801; default at ~2841); second switch (2866-2881) same five |
| ne[0] % 32 == 0; ne[1] ≤ 32768 with exact comment "hardcoded limit to refuse the lm-head for now"; nseq=1; repack-buffer check | CONFIRMED | lines 2801-2816 verbatim |
| repack types list (is_repack_type) | CONFIRMED | lines 210-214: Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| GET_ROWS F32-only | CONFIRMED | `ggml_hexagon_supported_get_rows` 3136-3155: src0 F32, src1 I32/I64, dst F32 |
| Marco shapes: attn_q (1024,2048) 1024%32=0; attn_k/v (1024,1024); attn_output (2048,1024); token_embd (1024,151936) → 151936 > 32768 = FAIL_DIM; gate_inp (1024,256); experts Q2_K/Q3_K FAIL_TYPE | CONFIRMED | shapes from re-parsed GGUF/`baseline_summary.txt`; 1024%32=0 ✓; 151936>32768 ✓ |

## 8. UNTRACEABLE items (summary)

1. **§1.3 "C: 171.54 GiB free of 952.87"** — grep across `scratchpad/`, `logs/`, `results/` finds it **only in REPORT.md itself**. No Get-PSDrive capture in any cell artifact. Probably measured live; not auditable.
2. **§4 "bmoe-cli RSS 22 MiB, CPU ~0"** — same; no artifact carries it.

## 9. Nits (minor imprecisions, not numeric errors)

- **R1** §1.1 "norms + router + **extras**" — the F32 141 class is exactly 113 norms + 28 routers; there are no "extras" in the dumps. Cosmetic.
- **R2** §2 imatrix parenthetical: `tensor_requires_imatrix` flags **IQ3_XXS, IQ2_XXS, IQ2_XS, IQ2_S, IQ1_M, IQ1_S** and Q2_K **when ftype == MOSTLY_Q2_K_S**; the report's "only IQ1/IQ2_XXS and Q2_K_S" understates the list. Core claim (IQ4_NL exempt, `--pure` not needed) is correct.
- **R3** PLAN.md quote (§1.2) is an elided fragment (original: "CANCELLATI (PC −35 GB; device cleanup in corso)").
- **R4** context note (not an error): PLAN.md "Scheda prodotto" (2026-08-18) records the *product* default as k6 **drop 1.0 + --drop-no-renorm**, while `run_answer_quality_ab.py`'s marco arm labels k6 **drop 0.0** as "shipped" (the 08-18 harness). The report's "shipped arm" statement is faithful to the harness; anyone reading "shipped = k6d0" against the current product card should be aware the card moved to drop 1.0.
- **R5** A 5.30 G download log exists in `models_staging/marco_dl.log` (2026-08-14). It is not the Q8_0 and does not contradict "not fetched": `SHA256SUMS.txt` there lists the sibling staging artefacts (incl. `Marco-Mini-Instruct.i1-IQ2_M.gguf`), and no Marco GGUF except the KEXP remains on disk.

## 10. Audit method (reproducibility)

- `_audit_sha.py` (this directory): self-contained GGUF header parser (v2-style header layout with version=3, u64 dims in tensor infos, 32-aligned data section) + `GGML_QUANT_SIZES` tables + SHA256 over name+payload of the 84 `ffn_{gate,up,down}_exps` tensors + full-file SHA256.
- Results: n_tensors=338 on all files; span-vs-table length mismatches 0/338 per file; inter-tensor padding 0 (all payloads are 32-byte multiples).
- Baseline full-file sha `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` — matches `.cache`-independent cook record; variants full shas (not claimed in REPORT.md, recorded for the record): q8_0 `816ec02ef7dfe1e74519c553b6059f425402e02322841693a677d367a79fb5e0`, iq4_nl `83b51fdc57e14ad5aad18e7ade875f5d3901f1a484385b59b4c7da5fab99ee60`, q4_0 `ce5fafd4b026b7891b7f3dcc2a359eecac3933746ae8a187fa5f04a00cc603ff`.
- Expert class sums re-derived: baseline 6,121,586,688 B (84 tensors) — identical on all four files, matching `verify_variants.json` and REPORT.md to the byte.

## 11. Verdict

**All 50+ numeric claims audited: 0 REFUTED, 48 CONFIRMED, 2 UNTRACEABLE**
(minor side-claims). No hallucinated totals, no wrong conversions, no table-vs-source
drift (verify_variants.json ≡ QUANTIZE_STATUS.txt ≡ QUANTIZE_VERIFY.md ≡
baseline_summary.txt ≡ dryrun logs ≡ ab logs, and the two hashes recompute cleanly
from disk). REPORT.md's numbers can be trusted; only the two UNTRACEABLE
environmental figures (§1.3 disk free, §4 RSS) should not be re-quoted as evidence.

## 12. Revision delta (REPORT.md rewritten 11:42 while this audit ran)

REPORT.md was modified mid-audit (17,201 B @ 11:37 → 19,304 B @ 11:42; the
11:37 text is what §1-§11 above were checked against). The 11:42 revision added
new numeric claims, all re-verified against the same artifacts:

| New claim (11:42 revision) | Verdict | Evidence |
|---|---|---|
| `token_embd.weight` payload 106 962 944 B = 102.01 MiB | CONFIRMED | baseline_summary.txt (token_embd bytes=106962944); 106,962,944/2^20 = 102.0078 → 102.01; my GGUF re-parse agrees |
| dry-run line `token_embd.weight` 102.01 MiB → 157.65 MiB (q8_0) | CONFIRMED | `dryrun-q8_0.log` line 173 verbatim; 165,306,368/2^20 = 157.648 → 157.65; my re-parse: token_embd q8_0 payload = 165,306,368 ✓ |
| trunk payload 228 073 472 B = 217.51 MiB | CONFIRMED | 228,073,472/2^20 = 217.5078 → 217.51. (First-pass auditor note "217.54" was the auditor's error, now corrected above) |
| "~600 MB" if embeddings were F32 | CONFIRMED | 151,936 × 1024 × 4 = 622,329,856 B = 0.622 GB decimal / 0.580 GiB — "~600 MB" is a fair rounding |
| trace rows: `QUALITY_LONG.md`, `REVIEW_DOC.md`, `ab/sanity/gen/q1_f1_spa2000__q8_0.json` | CONFIRMED (exist) | ls: QUALITY_LONG.md 11:39, REVIEW_DOC.md 11:41, ab/sanity/gen/*q8_0* present; QUALITY_LONG marks 0/18 variant texts identical (3 variants × 6 prompts ✓) |
| §4.2 synthesis: "breaks single-hop factual recall … not because the model became illiterate" | CONFIRMED (qualitative) | consistent with ANSWERS.md long texts and sanity q1 |
| §7 quality column "FAIL q1 / Not a from-source result" | CONFIRMED | consistent with ab-sanity.log tokens and ANSWERS.md q1 texts |

No number in the 11:42 revision conflicts with any source file. The only
numeric wording changed by the revision ("~217 MiB" → "217.51 MiB") is the
precise one and is correct.