# q37 — B′ from source: trunk simple-quant, experts unchanged (general)

PC-only. No device. No git push. `BigMoeOnEdge/` WIP not modified.
q36 leftover GGUFs under `scratchpad/agents/q36-trunk-requant/gguf/` were **not** deleted (we did not create them).

**Recommendation line (owner):** the general answer, not just Marco.

1. **Trunk is not always tiny.** Payload share of the from-source KEXP control is **Marco 3.57 % (228 MB / 6.39 GB)**, **OLMoE 12.22 % (326 MB / 2.67 GB)**, **LFM2.5 15.20 % (506 MB / 3.33 GB)**. The q36 headline (228 MB / 6.4 GB) is Marco-specific. Hybrid / untied-head MoEs pay more.
2. **NPU attn MUL_MAT predicates (desk) hold for Q8_0 / IQ4_NL / Q4_0 on all three models' attention tensors.** Control Q5_K/Q6_K is FAIL_TYPE. LM head / `token_embd` still FAIL_DIM (`ne[1]` = 151936 / 50304 / 128000, all > 32768). LFM **shortconv** in/out also PASS once simple-quant (18+18 tensors) — that is extra HTP surface Marco does not have.
3. **Quality does not give a universal default trunk type.** From-source **kills the q36 double-quant collapse**, but:
   - Marco Q8_0 **fails Spa 2000** (ends on Schumacher). IQ4_NL and Q4_0 keep Häkkinen, then **fail the code `nproc>=6` filter**. Control passes both gates.
   - OLMoE-1B-7B KEXP is **below the suite floor** (control itself names Schumacher). Size/NPU still count.
   - LFM2.5-8B-A1B **always-thinks** into `reasoning` even with `--no-think`; visible `text` is often empty. Control also names Schumacher. Not a clean discriminator.
4. **If HTP attn is required: IQ4_NL is the size default, not Q8_0.** Same byte size as Q4_0 on every model here, NPU-legal, smaller than control. Q8_0 is the expensive one (+1.95 / +6.67 / +7.64 %) and lost the only clean factual gate we have (Marco q1). **If HTP attn is not required: keep the Q5_K/Q6_K KEXP trunk.**

---

## 0. Model choice

| # | model | why | source used |
|---|---|---|---|
| 1 | **Marco-Mini-Instruct** (mandatory) | Product 6.4G KEXP. q36 A/B was double-quant. | Q8_0 18 356 453 952 B sha `3287457a…` (same as original cook) |
| 2 | **OLMoE-1B-7B-0924-Instruct** | Small MoE already in `models/` (Q4_K_M 4.21 GB). Official AllenAI Q8_0 **7.36 GB ≤ 8 GB**. Different family (`olmoe`, 64 experts / top-8, **untied** `output.weight`). | `olmoe-1b-7b-0924-instruct-q8_0.gguf` 7 359 943 136 B sha `d089e8b1…` |
| 3 | **LFM2.5-8B-A1B** | Product-relevant: KEXP pulled from in-app catalog (PLAN #29). Hybrid attn+shortconv. Existing recipe `results/lfm25_kexp/`. | Official LiquidAI Q8_0 9 010 195 680 B sha `33ab3b8c…` (9.01 GB, slightly over the 8 GB small-model hint; listed separately by the owner). F16 16.95 GB not fetched. |

Skipped: CalaQwen 35B (owner: not required), Mellum2 (Q4_K_M already 8.07 GB), Qwen3-30B, Ornith, REAP.

On-disk Q4_K_M OLMoE is **not** the source (would be double-quant). Control for OLMoE is a **new** KEXP cook from official Q8_0.

Details: `SOURCE.md`, `NOTES.md`.

---

## 1. Method (from source, not from shipped KEXP)

All four arms of a model from the **same** high-precision GGUF:

- **control** = KEXP recipe (experts Q2_K+Q3_K, trunk Q5_K, plus LFM's Q6_K on shortconv.out / dense down).
- **variants** = same experts + F32, trunk retargeted to Q8_0 / IQ4_NL / Q4_0.

Trunk = every non-expert non-F32 weight (attn, `token_embd`, `output.weight` if present, LFM shortconv in/out + leading dense FFN).

`llama-quantize --allow-requantize --tensor-type-file … --imatrix` (Marco + LFM; OLMoE has none). ftype Q4_K_M for control (original Marco cook), Q8_0 / IQ4_NL / Q4_0 for variants. Binary: `build-pc-quantize/bin/llama-quantize.exe` (same as q36).

Verify: `verify_variants.py` — expert payloads byte-identical across control+variants; trunk types; size table. `all_ok True` on all three models.

A/B: `run_q37_ab.py` = q36 harness (bmoe-cli session JSON, temp 0, `--chatml --no-think`). Marco k=6 drop=0; LFM k=4 drop=0. **OLMoE: bmoe-cli has no `olmoe` recipe** (`arch_registry.cpp`) — A/B redone with `build-llama-pc/bin/llama-cli.exe` `-f` + `-cnv --single-turn --temp 0` (UTF-8 via `--file`/`-o`, not argv). See `ab/olmoe/QUALITY_*.md`.

NPU desk: `npu_desk.py`, same predicates as q36 (`ggml_hexagon_supported_mul_mat`).

One model at a time. After A/B: delete **our** source + non-winning GGUFs. Winner kept = **control** (quality-matched KEXP recook). Min C: free this cell: **120.36 GB** (`DISK_LOG.md` post-marco-q4_0). Never < 40 GB.

---

## 2. Sizes matrix (from `verify/*/verify_variants.txt`)

### 2.1 Marco (from Q8_0 + mradermacher imatrix)

Expert sha `d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d` — **identical to the shipped KEXP** (`q36 REPORT` / `verify_variants.json`). Control disk **6 385 238 912** vs shipped **6 385 238 848** (**+64 B**, metadata). Types: F32 141, Q5_K 113, Q3_K 28, Q2_K 56 — same histogram as shipped.

| arm | total bytes | vs control | % | trunk payload | trunk share |
|---|---:|---:|---:|---:|---:|
| **control Q5_K** | 6 385 238 912 | 0 | 0 | 228 073 472 | **3.57 %** |
| trunk **Q8_0** | 6 509 642 624 | **+124 403 712** | **+1.948 %** | 352 477 184 | 5.41 % |
| trunk **IQ4_NL** | 6 343 771 008 | **−41 467 904** | **−0.649 %** | 186 605 568 | 2.94 % |
| trunk **Q4_0** | 6 343 771 008 | **−41 467 904** | **−0.649 %** | 186 605 568 | 2.94 % |

Deltas match q36's from-KEXP sizes to the byte except the +64 B header. Payload physics is the same; quality is not (next section).

### 2.2 OLMoE (from official Instruct Q8_0, no imatrix)

New KEXP. 16 layers, 64 experts, untied `output.weight` [2048, 50304]. Types control: Q5_K 66, F32 81, Q3_K 16, Q2_K 32.

| arm | total bytes | vs control | % | trunk payload | trunk share |
|---|---:|---:|---:|---:|---:|
| **control Q5_K** | 2 668 941 792 | 0 | 0 | 326 205 440 | **12.22 %** |
| trunk **Q8_0** | 2 846 872 032 | **+177 930 240** | **+6.667 %** | 504 135 680 | 17.71 % |
| trunk **IQ4_NL** | 2 609 631 712 | **−59 310 080** | **−2.222 %** | 266 895 360 | 10.23 % |
| trunk **Q4_0** | 2 609 631 712 | **−59 310 080** | **−2.222 %** | 266 895 360 | 10.23 % |

Expert sha `5109661dfa5e849ae6a3ea754a1543f5ce09d6450b1fa372241852b8f0cf527a` identical across arms.

### 2.3 LFM2.5-8B-A1B (from official Q8_0 + on-disk Unsloth imatrix)

Control disk **3 326 160 384 = shipped `models/LFM2.5-8B-A1B-KEXP.gguf` exactly**. Types: Q5_K 47, F32 123, Q6_K 20, Q3_K 22, Q2_K 44. Original shipped cook was F16; this recook is Q8_0. Same byte size, **not** claimed byte-identical experts to the F16 cook.

| arm | total bytes | vs control | % | trunk payload | trunk share |
|---|---:|---:|---:|---:|---:|
| **control Q5_K/Q6_K** | 3 326 160 384 | 0 | 0 | 505 577 472 | **15.20 %** |
| trunk **Q8_0** | 3 580 407 296 | **+254 246 912** | **+7.644 %** | 759 824 384 | 21.22 % |
| trunk **IQ4_NL** | 3 222 842 880 | **−103 317 504** | **−3.106 %** | 402 259 968 | 12.48 % |
| trunk **Q4_0** | 3 222 842 880 | **−103 317 504** | **−3.106 %** | 402 259 968 | 12.48 % |

Expert sha `00ef935a4653e9e5086f8ff6d806ad7bae7b89f0148f95834c995df92198a946` identical across arms. Variant type count Q8_0/IQ4_NL/Q4_0 = 67 = 47 Q5_K + 20 Q6_K retargeted.

### 2.4 Cross-model

| | trunk share of control | Q8_0 vs control | IQ4_NL/Q4_0 vs control |
|---|---:|---:|---:|
| Marco | 3.57 % | +1.95 % | −0.65 % |
| OLMoE | 12.22 % | +6.67 % | −2.22 % |
| LFM2.5 | 15.20 % | +7.64 % | −3.11 % |

**B′ cost scales with trunk share.** It is cheap on Marco; it is a several-percent GGUF move on LFM/OLMoE.

---

## 3. NPU desk (no device)

Method: q36. Quantized MUL_MAT legal types: Q4_0 / Q4_1 / Q8_0 / IQ4_NL / MXFP4. `ne[0]%32==0`, `ne[1]≤32768`, nseq=1 assumed. K-quants FAIL_TYPE. GET_ROWS F32-only for embed lookup.

| model | control attn | simple-quant attn | LM head / token_embd | extra |
|---|---|---|---|---|
| Marco | 112× Q5_K **FAIL_TYPE** | 112× PASS (Q8_0/IQ4_NL/Q4_0). Shapes [1024,2048]/[1024,1024]/[2048,1024] | [1024, **151936**] FAIL_DIM | — |
| OLMoE | 64× Q5_K **FAIL_TYPE** | 64× PASS. Shape [2048,2048] | [2048, **50304**] FAIL_DIM (untied `output.weight` too) | — |
| LFM2.5 | 24× Q5_K attn **FAIL_TYPE**; 18× Q5_K + 18× Q6_K shortconv **FAIL_TYPE** | 24 attn PASS; **36 shortconv PASS** | [2048, **128000**] FAIL_DIM | shortconv.in [2048,6144] / out [2048,2048] both align |

Files: `npu/*.md`. q36's conclusion stands and **generalizes**: simple-quant is enough for hexagon to *accept* attention (and LFM shortconv). It is not enough for the LM head. Alignment is not the blocker.

---

## 4. Quality A/B

Judge conservative, N=1 greedy, temp 0. Full texts in `ab/<model>/{sanity,long}/`.

### 4.1 Marco (the only clean discriminator) — bmoe-cli, k=6 drop=0

Sanity (`ab/marco/QUALITY_SANITY.md`):

| prompt | control | Q8_0 | IQ4_NL | Q4_0 |
|---|---|---|---|---|
| q1 Spa 2000 | **Häkkinen** | starts Häkkinen, **ends Schumacher**. No q36 loop | **Häkkinen** (wrong podium) | **Häkkinen** (wrong margin) |
| q2 tabellina | 1–10 OK | 1–25+ OK | 1–10 OK | 1–10 OK |
| q3 regalo | No | No | No | No |
| q4 vocali | 5 (wrong) | 5 | 5 | 4 |

**From-source does not reproduce the q36 Q8_0 repetition collapse.** Q8_0 still **fails the factual gate**. IQ4_NL/Q4_0 keep the winner.

Long (`ab/marco/QUALITY_LONG.md`): f45_3 PASS all four (3 sentences + 2 questions). **f45_4 code: control PASS, Q8_0 PASS, IQ4_NL FAIL, Q4_0 FAIL** (neither filters `nproc >= 6`). Italian prose holds to 420 tok on all arms.

| arm | sanity q1 | long code | NPU attn | size |
|---|---|---|---|---|
| control Q5_K | PASS | PASS | FAIL_TYPE | 0 |
| Q8_0 | **FAIL** | PASS | PASS | +1.95 % |
| IQ4_NL | PASS | **FAIL** | PASS | −0.65 % |
| Q4_0 | PASS | **FAIL** | PASS | −0.65 % |

No from-source trunk type wins both checkable gates.

### 4.2 OLMoE — llama-cli (bmoe-cli refused `olmoe`)

Control itself fails q1 (Schumacher, "britannico", "Spagna"). Q8_0 word-salad (tennis). Q4_0 names Nico Rosberg. q4_0 says yes to the faeces gift. **Floor effect:** 1B-7B KEXP is below this suite. Trunk type still moves text (0 identical). Size/NPU remain valid. `ab/olmoe/QUALITY_*.md`.

### 4.3 LFM2.5 — bmoe-cli, k=4; **always-think confound**

`--no-think` does not stop LFM2.5-8B-A1B: JSON `text` often empty, generation in `reasoning` (English planning). Scored from `ANSWERS_EXTRACTED.md`. Control **also** names Schumacher on q1. Visible vowel count: control/Q8_0/Q4_0 = 4, IQ4_NL = 5. Long suite is English planning, not user-visible Italian/code. **Do not pick a default from this A/B.** Size/NPU/verify stand.

---

## 5. Caveats

1. LFM source is official **Q8_0**, not the F16 the original KEXP was cooked from. Control file size matches shipped exactly; experts not claimed identical to the F16 cook.
2. OLMoE A/B is llama-cli, not bmoe-cli (no recipe in `arch_registry.cpp`). We did **not** patch BigMoeOnEdge.
3. LFM always-think pollutes visible answers.
4. A/B is qualitative, N=1, temp 0 — campaign design.
5. No imatrix on OLMoE IQ4_NL.
6. Winner GGUFs kept on disk are **control**, not a B′ variant.
7. First Marco SHA check used `Get-FileHash` which returned empty in 0 s (false FAIL). Rechecked with Python hashlib: match. Later downloads use `sha256.py`.
8. q36 GGUFs (~19 GB) still in `q36-trunk-requant/gguf/` — pre-existing, not ours to delete.

---

## 6. Disk cleanup

`CLEANUP_LOG.md`. Freed: Marco 35.05 GB + OLMoE 14.37 GB + LFM 17.73 GB. Kept (this cell only):

| kept | bytes |
|---|---:|
| `gguf/marco/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` | 6 385 238 912 |
| `gguf/olmoe/OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-control.gguf` | 2 668 941 792 |
| `gguf/lfm/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-control.gguf` | 3 326 160 384 |

Not touched: `models/*` shipped KEXP / OLMoE Q4_K_M / LFM imatrix, q36 GGUFs.

`DISK_LOG.md`: start 162.21 GB free; nadir 120.36 GB; always ≥ 40 GB.

---

## 7. General recommendation

| question | answer |
|---|---|
| Does "trunk → simple quant, experts unchanged" hold as a **size** trick across MoE? | **Yes, with a scale factor.** Experts stay byte-identical. Trunk share 3.6–15 %. Q8_0 is +2 to +8 %; IQ4_NL/Q4_0 are −0.65 to −3.1 %. |
| Does it hold as **NPU attn**? | **Yes on the desk predicates**, all three models (LFM also shortconv). Head still CPU. |
| Does it hold as **quality**? | **Not as a free lunch.** From-source is better than q36 double-quant (no collapse), but **no trunk type matches control on both Marco gates.** Q8_0 is not the quality pick. |
| Default if we must ship a simple-quant trunk? | **IQ4_NL** (size = Q4_0, NPU-legal). Re-check the product model's own q1 + code gates; do not copy Marco's Q8_0 hope. |
| Default if we do not need HTP attn? | **Keep Q5_K/Q6_K trunk.** Road A (HVX K-quant) remains the path that does not change the product GGUF. |

Hostile audits: `REVIEW_DOC.md`, `REVIEW_MATH.md`.

---

## Trace index

| claim | file |
|---|---|
| sources / shas | `SOURCE.md`, `logs/dl-q37-*.log` |
| recipes | `recipes/{marco,olmoe,lfm}/*.txt` |
| cook | `logs/cook-*.log`, `COOK_*_RESULT.json` |
| verify | `verify/{marco,olmoe,lfm}/verify_variants.txt` |
| NPU | `npu/*.md` |
| Marco A/B | `ab/marco/**`, `logs/ab-marco-*.log` |
| OLMoE A/B | `ab/olmoe/**`, `logs/ab-olmoe-cli-*.log` |
| LFM A/B | `ab/lfm/**`, `extract_lfm_answers.py` |
| disk / cleanup | `DISK_LOG.md`, `CLEANUP_LOG.md` |
