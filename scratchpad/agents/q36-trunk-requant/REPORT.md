# q36 — Re-quantize KEXP trunk only (owner 28c / B′)

PC-only. No device. No git push. `BigMoeOnEdge/` WIP not modified, not
rebuilt, not checked out to another rev.

**Recommendation line (owner):** two questions, two answers.

1. **Can we requant the *shipped* KEXP file (Q5_K trunk → Q8_0/IQ4_NL/Q4_0)
   and keep quality?** **No.** Experts stay byte-identical; attn types become
   NPU-legal on paper; **greedy sanity q1 (Spa 2000) fails on all three
   arms**, and Q8_0-from-KEXP loops. That is double-quant, N=1, campaign
   protocol — enough to **not ship those three GGUFs**. It is **not** a
   measurement of Q8_0-from-source.
2. **Which trunk type wins B′?** **Not decided.** Clean B′ (trunk from
   original Q8_0/F16, experts copied from KEXP) **was not runnable**: that
   source is not on this PC (deleted after the original KEXP cook; no
   download). **Road A (HVX K-quant kernels) remains necessary if HTP attn
   must keep today's Q5_K trunk.** If the owner re-downloads Marco Q8_0
   (18.36 GB, sha below) we can cook a clean trunk and re-run this A/B.

---

## 1. Inventory

### 1.1 KEXP GGUFs on this PC (`models/`)

| file | bytes | role |
|---|---:|---|
| `Marco-Mini-Instruct-KEXP.gguf` | 6 385 238 848 | **product / this experiment** (Marco1c, ~6.4G) |
| `LFM2.5-8B-A1B-KEXP.gguf` | 3 326 160 384 | second KEXP; not iterated |
| `Qwen3.6-35B-A3B-KEXP.gguf` | 13 416 430 592 | CalaQwen; too big to iterate, skipped |

Marco disk sha256 (from the original cook, `results/marcokexp/QUANTIZE_VERIFY.md`):
`2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777`.

PLAN.md nickname: **Marco1c / Marco-Mini KEXP**. Recipe in
`results/marcokexp/tensor_types_1c.txt` + verify dump:

| class | count | type | payload bytes (this dump) |
|---|---:|---|---:|
| norms + router | 141 | F32 | 113 norms (262 144 B) + 28 router (29 360 128 B); no other F32 |
| trunk (attn + token_embd) | 113 | **Q5_K** | **228 073 472** |
| down experts | 28 | Q3_K | 2 422 210 560 |
| gate+up experts | 56 | Q2_K | 3 699 376 128 |
| **experts total** | 84 | Q2_K+Q3_K | **6 121 586 688** |

PLAN's generic line "trunk Q5_K/Q6_K" is the family recipe. **This Marco 1c
file is Q5_K-only trunk** — there is no Q6_K tensor
(`baseline_summary.txt`, `verify_variants.json`). No `output.weight` (tied
embeddings). 28 layers, hidden 1024, vocab 151936, GQA 16/8 head_dim 128.

Dump: `baseline_tensors.json` / `baseline_summary.txt`.

### 1.2 Original unquantized source — **NOT ON DISK**

Clean requant needs f16/bf16 GGUF or HF safetensors, or at least the Q8_0
the KEXP was cooked from. Searched (no download):

- `models/` — only the three KEXP + Mellum2 + OLMoE + drafts. No
  `Marco-Mini-Instruct.Q8_0.gguf`, no F16/BF16, no safetensors.
- `models_staging/` — LFM REAP, not Marco.
- `C:\Users\gualt\.cache\huggingface\hub` — Ornith, LFM REAP-50, Qwen
  embedding. **No Marco repo.**
- `Desktop\Kalsa` depth-4 name match — only the shipped KEXP (~5.95 GiB).

Documented deletion, not a search miss:

- PLAN.md (MarcoKEXP FASE 2): *"Originale Q4KM + cons + sorgente Q8
  CANCELLATI (PC −35 GB; device cleanup in corso)"*.
- `models/DELETED-2026-08-17.md` records the later deletion of
  `Marco-Mini-Instruct.imatrix.gguf` (81 548 704 B, sha
  `f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23`).
- Original cook log `logs/quantize-marcokexp.outer.err.log` loaded
  `models\Marco-Mini-Instruct.Q8_0.gguf` → wrote the KEXP we still have.

Identified but **not fetched** (owner rule: report first):

| artefact | URL | bytes | sha256 |
|---|---|---:|---|
| Q8_0 source | https://huggingface.co/mradermacher/Marco-Mini-Instruct-GGUF/resolve/main/Marco-Mini-Instruct.Q8_0.gguf | 18 356 453 952 | `3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c` |
| imatrix | https://huggingface.co/mradermacher/Marco-Mini-Instruct-i1-GGUF/resolve/main/Marco-Mini-Instruct.imatrix.gguf | 81 548 704 | `f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23` |

Script already in tree: `scripts/dl_marco_q8_imatrix.ps1`.
IDs: `reports/moe-prep-marcokexp-litert.md`, `results/marcokexp/SOURCE_IDENTIFIED.md`.

**Path actually used in this cell:** requant **from the shipped KEXP**
(`--allow-requantize`). That is double-quant of the trunk. It **understates**
quality of a from-source B′ and, as the A/B shows, is not even a faithful
stand-in for "Q8_0 ≈ Q5_K".

No F16/BF16/HF weights for Marco were ever local per SOURCE_IDENTIFIED
(Q8_0 GGUF was the chosen source).

### 1.3 Disk

Three ~6 GiB variants were written under this directory (not `models/`);
none of the existing models were deleted. A live `Get-PSDrive` at cell
start showed C: ~171 GiB free of ~953 — **not captured to a file**
(`REVIEW_MATH.md` marks it UNTRACEABLE; do not re-quote as evidence).
The writes succeeding is the evidence that space was enough.

---

## 2. Tooling

| binary | path | mtime | notes |
|---|---|---|---|
| llama-quantize | `build-pc-quantize/bin/llama-quantize.exe` | 2026-08-10 10:24:50 | **used**. `--help` saved as `llama-quantize-help.txt` |
| bmoe-cli | `build-pc-mellum-ppl/cli/bmoe-cli.exe` | 2026-08-14 01:58:57 | A/B harness, same as `scripts/run_answer_quality_ab.py` |
| llama-cli / llama-bench | `build-llama-pc/bin/` | 2026-08-10 / 08-21 | present, not needed |

`build-pc-quantize/CMakeCache.txt` points at
`BigMoeOnEdge/third_party/llama.cpp`. **No rebuild, no worktree, no branch
switch.** The 2026-08-10 binary already implements `--tensor-type`,
`--tensor-type-file`, `--allow-requantize`, and `COPY`.

Same-type skip (byte copy) is in the *sources we read* at
`BigMoeOnEdge/third_party/llama.cpp/src/llama-quant.cpp:1148-1178`:
`quantize = cur_type != new_type`; if false, `new_data = tensor->data`.
`COPY` as an ftype sets `only_copy` and **blocks all overrides**
(`tensor_allows_quantization` returns false at line 290) — so we did **not**
use ftype COPY. Experts were pinned to `q2_k`/`q3_k` via `--tensor-type-file`
so they hit the same-type copy path.

IQ4_NL does **not** require imatrix (`tensor_requires_imatrix` flags
IQ3_XXS, IQ2_XXS, IQ2_XS, IQ2_S, IQ1_M, IQ1_S, and Q2_K only when ftype is
`MOSTLY_Q2_K_S`; IQ4_NL hits `default: return false`). `--pure` was not
used: it would skip tensor-type overrides and requantize experts.

---

## 3. Variants generated

Recipe files (regex, experts pinned to current types, trunk forced):

- `tensor_types_trunk_q8_0.txt`
- `tensor_types_trunk_iq4_nl.txt`
- `tensor_types_trunk_q4_0.txt`

Command (one per type), cwd PATH includes `build-pc-quantize/bin`:

```
llama-quantize --allow-requantize --tensor-type-file <recipe> \
  models\Marco-Mini-Instruct-KEXP.gguf \
  scratchpad\agents\q36-trunk-requant\gguf\Marco-Mini-Instruct-KEXP-trunk-<tag>.gguf \
  <Q8_0|IQ4_NL|Q4_0> 16
```

Dry-run logs: `dryrun-q8_0.log` etc. Real cook: `quantize-*.log`,
`QUANTIZE_STATUS.txt`. Wall: Q8_0 29.4 s, IQ4_NL 58.1 s, Q4_0 45.0 s
(experts copied, only ~217 MiB trunk requantized).

### 3.1 Sizes

All bytes from `verify_variants.json` (Python `path.stat().st_size` +
GGUFReader tensor payloads) and `QUANTIZE_STATUS.txt`.

| | total bytes | vs baseline | % | trunk payload | trunk Δ | experts payload |
|---|---:|---:|---:|---:|---:|---:|
| **baseline KEXP** | 6 385 238 848 | 0 | 0 | 228 073 472 | 0 | 6 121 586 688 |
| trunk **Q8_0** | 6 509 642 560 | **+124 403 712** | **+1.948 %** | 352 477 184 | +124 403 712 | 6 121 586 688 |
| trunk **IQ4_NL** | 6 343 770 944 | **−41 467 904** | **−0.649 %** | 186 605 568 | −41 467 904 | 6 121 586 688 |
| trunk **Q4_0** | 6 343 770 944 | **−41 467 904** | **−0.649 %** | 186 605 568 | −41 467 904 | 6 121 586 688 |

IQ4_NL and Q4_0 have the same *size* (both ~4.5 bpw on the same shapes);
they do **not** have the same types (next table). Trunk is only 3.6 % of the
file, so even Q8_0 is a **+2 %** GGUF. RAM/mmap on device moves by the same
delta.

Dry-run payload totals (quantize's own accounting, `dryrun-*.log` last lines):
baseline 6083.76 MiB → Q8_0 6202.40 / IQ4_NL 6044.21 / Q4_0 6044.21 MiB.
Matches the disk deltas to the MiB.

### 3.2 Type + expert identity

`verify_variants.py` → `verify_variants.json` / `verify_variants.txt`.
SHA256 over **name+payload of every `ffn_{gate,up,down}_exps` tensor**:

`d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d`

**identical on baseline and all three variants.** Expert types remain
56×Q2_K + 28×Q3_K. Zero leftover Q5_K on variants. `all_ok True`.

| tag | tensor type histogram |
|---|---|
| baseline | F32 141, Q5_K 113, Q3_K 28, Q2_K 56 |
| q8_0 | F32 141, **Q8_0 113**, Q3_K 28, Q2_K 56 |
| iq4_nl | F32 141, **IQ4_NL 113**, Q3_K 28, Q2_K 56 |
| q4_0 | F32 141, **Q4_0 113**, Q3_K 28, Q2_K 56 |

113 = 28×(attn_q, attn_k, attn_v, attn_output) + `token_embd.weight`.
`token_embd` was Q5_K and is **not** "already simple"; it was converted
with the trunk (user: convert unless already simple). No `output.weight`.

Outputs (do not delete; not intermediates). Full-file SHA256 recomputed
in `REVIEW_MATH.md` / `_audit_sha.py`:

| file | sha256 |
|---|---|
| baseline `models/Marco-Mini-Instruct-KEXP.gguf` | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |
| `gguf/Marco-Mini-Instruct-KEXP-trunk-q8_0.gguf` | `816ec02ef7dfe1e74519c553b6059f425402e02322841693a677d367a79fb5e0` |
| `gguf/Marco-Mini-Instruct-KEXP-trunk-iq4_nl.gguf` | `83b51fdc57e14ad5aad18e7ade875f5d3901f1a484385b59b4c7da5fab99ee60` |
| `gguf/Marco-Mini-Instruct-KEXP-trunk-q4_0.gguf` | `ce5fafd4b026b7891b7f3dcc2a359eecac3933746ae8a187fa5f04a00cc603ff` |

---

## 4. Quality A/B (PC CPU)

Harness: `run_q36_ab.py` — same session-mode JSON protocol, temp 0,
`--chatml --no-think`, k=6 drop=0.0 (the Marco arm labelled **shipped** in
`scripts/run_answer_quality_ab.py`, and the 2026-08-18 sanity baseline this
cell matched verbatim). PLAN.md's later product card is k=6 **drop 1.0 +
`--drop-no-renorm`**; this cell did **not** use that. n_predict 300 (sanity)
/ 420 (long). Binary `bmoe-cli`. Prompts from `prompts/sanity/` and
`prompts/`.

First attempt deadlocked on stderr=PIPE during load (two START baseline
lines in `ab-sanity.log`). Fixed to stderr-file. RSS/CPU of the hung
process was a live observation, **not captured** (`REVIEW_MATH.md`
UNTRACEABLE). Scores below are the second, complete run
(2026-08-23T10:59:29 … 11:10:49).

The campaign harness itself compares drop/k on **one** GGUF. This cell
compares **GGUFs** at the shipped drop/k. That is the B′ question.

### 4.1 Sanity (complete) — this is the quality decision

Full texts: `ab/sanity/ANSWERS.md`. Scoring: `QUALITY_SANITY.md`.
Log: `ab-sanity.log`.

| prompt | baseline | Q8_0 trunk | IQ4_NL trunk | Q4_0 trunk |
|---|---|---|---|---|
| Spa 2000 (factual) | **Häkkinen, correct** | Button/Trulli + **repetition collapse** to 300 tok | "race cancelled in 2000" | starts Häkkinen, "corrects" to Button |
| tabellina 9 | 1–10 correct | 1–10 correct | 1–10 correct | 1–10 correct |
| regalo feci | No | No | No | No |
| vocali "armadio" | 5 (wrong; true=4) | 5 (same error) | 5 then 4, confused | 4 |

Zero variant answers identical to baseline (greedy, temp 0).

**q1 is the gate the campaign invented this suite for** ("says things that
make no sense"). Baseline matches the 2026-08-18 shipped arm
(`results/answer_sanity_marco/ANSWERS.md`). Every requant **fails q1**.
Q8_0 **from this KEXP** is not near-lossless vs the Q5_K trunk: dequant
Q5_K → quant Q8_0 is a different grid (Q5_K superblocks vs Q8_0/32). The
tied embedding is in that round-trip:
`token_embd.weight` payload **106 962 944 B = 102.01 MiB**
(`baseline_summary.txt`; dry-run `dryrun-q8_0.log` line with
`token_embd.weight` size = 102.01 MiB → 157.65 MiB) out of trunk payload
**228 073 472 B = 217.51 MiB** (`verify_variants.json`).
A from-source Q8_0 would **not** start from Q5_K and is **untested** here
(may still be near-lossless vs the original Q8). This cell **does**
falsify "just requant the file we ship".

### 4.2 Long suite (complete) — instruction-following mostly holds

Log `ab-long.log` (2026-08-23T11:11:23–11:36:13). Texts: `ab/long/ANSWERS.md`.
Zero variant answers identical to baseline.

Checkable keys from the harness docstring:

| prompt | what to check | baseline | Q8_0 | IQ4_NL | Q4_0 |
|---|---|---|---|---|---|
| f45_3_istruzioni | exactly 3 sentences, then 2 questions, IT, no titles | **PASS** | **PASS** | **PASS** | **PASS** (typo "misurarele") |
| f45_4_codice | `median_eval_tok_s`, nproc≥6, skip None, median, None if empty | **PASS** | **PASS** | **PASS** | **PASS** (wrong comment on the example data; function is right) |
| f45_1_esplicativo | MoE vs dense, IT, ≤180 words | coherent | coherent; **wrong RAM math** (7B×4 B = 28 GB) | coherent; 7B×2 B = 14 GB | coherent; ~7 GB for 7B |
| f45_2_scrittura | 2.4 bit, ~5 tok/s, screen on, annotate temp/batt/tok/s | all present | all present; adds a bogus "server di inferenza" coda | all present | all present, shortest |
| long_conversational_it | Italian prose, no list collapse | holds to 420 tok | holds | holds; **Bari on a Milano–Napoli train** | holds |

The long battery does **not** reproduce q1's collapse. Coding and the
three-sentence constraint survive trunk requant. Long PASS marks are
**instruction-constraint** scores, not factual accuracy: Q8_0 still
invents "7B = 28 GB RAM" and a "server di inferenza"; IQ4_NL puts Bari
on a Milano–Napoli train. Those parentheticals are content errors that
the f45_3/f45_4 gates do not catch.

**Synthesis:** from-KEXP trunk requant **preserves instruction-following
and a small Python function**, and **breaks single-hop factual recall**
(sanity q1, all three arms). That is why B′-from-KEXP is a no-ship for
the product file, not because the model became illiterate.

### 4.3 Perplexity

The campaign harness is generation, not PPL. No extra PPL run; the sanity
q1 failure is a stronger product signal than a 5-language bpb delta.

---

## 5. NPU-compat desk (no device)

Full cite list: `NPU_DESK.md`. Predicates from
`upstream-hexagon/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp`
(read-only). Shapes from llama-quantize dry-run / `baseline_summary.txt`.

Quantized MUL_MAT accepts Q4_0 / Q4_1 / Q8_0 / IQ4_NL / MXFP4 only
(`ggml_hexagon_supported_mul_mat`, ~2795–2818):

1. `src0->ne[0] % 32 == 0`
2. `src0->ne[1] <= 32768` — comment: *"hardcoded limit to refuse the lm-head for now"*
3. nseq=1 (`src1->ne[2]==1 && ne[3]==1`)
4. weights in a hexagon-repack buffer

K-quants → `default: return false`.

| Marco tensor | candidate type | ne[0]%32 | ne[1]≤32768 | HTP MUL_MAT *predicate* (desk, no runtime) |
|---|---|---|---|---|
| attn_q [1024,2048] | Q8_0 / IQ4_NL / Q4_0 | yes | yes | **PASS** |
| attn_k/v [1024,1024] | same | yes | yes | **PASS** |
| attn_output [2048,1024] | same | yes | yes | **PASS** |
| token_embd as **LM head** [1024,151936] | same | yes | **151936 > 32768** | **FAIL_DIM** |
| token_embd GET_ROWS | quant | — | — | **FAIL_TYPE** (GET_ROWS is F32-only, ~3136–3155) |
| ffn_gate_inp [1024,256] | F32 (unchanged) | F32 path | 256 | PASS |
| ffn_*_exps | Q2_K/Q3_K | — | — | **FAIL_TYPE** (policy + switch) |

Baseline Q5_K attn is FAIL_TYPE today. That is the whole point of B′.

RoPE / RMS_NORM are F32-activation ops, not weight types. FLASH_ATTN_EXT
wants F16 K/V (runtime/VTCM, not a GGUF-type reject). Softmax row cap
131072 is seq-length, not vocab.

**Desk conclusion:** a Q8_0 or IQ4_NL or Q4_0 trunk is enough for hexagon to
*accept* Marco **attention** weights. It is not enough to put the LM head
or the experts on HTP. Alignment is not the blocker (`ne[0]` is 1024/2048).
Vocab is.

`NPU_DESK.md` (second pass, explorer) is the long cite list. One claim in
its executive summary is **too strong** and is not adopted here: it says a
single quantized copy "cannot serve both CPU decode and HTP prefill"
because GET_ROWS is F32-only, so `token_embd` "must stay F32" (~600 MB).
That would only be true if we insisted on running **embedding lookup on
HTP**. llama.cpp already does quantized GET_ROWS on **CPU**; this cell's
A/B decoded the Q8_0/IQ4_NL/Q4_0 files that way. Prefill can keep that
GET_ROWS (and the 32768-capped LM head) on CPU and still put **attn
MUL_MAT** on HTP. Forcing F32 embeddings into the GGUF is not required
for B′. Raising the 32768 cap / adding quantized GET_ROWS on HTP is
optional extra kernel work to move embed+head onto the DSP, not a
precondition for trunk requant.

---

## 6. Caveats (hostile)

1. **Double-quant.** Every quality number here is Q5_K→{Q8_0,IQ4_NL,Q4_0},
   not Q8_0-source→those types. Q8_0-from-KEXP is *not* a proxy for
   Q8_0-from-source.
2. **No imatrix** on IQ4_NL. From-source IQ4_NL would normally use the
   mradermacher imatrix (deleted). IQ4_NL still ran (not a hard require).
3. **Tied embeddings.** `token_embd` is both lookup and LM head. Requant
   hits both. Hexagon still refuses the head on `ne[1]`.
4. **A/B is qualitative**, temp 0, one seed-less greedy run per prompt, N=1.
   That is the campaign's own design (`run_answer_quality_ab.py` docstring).
5. **Q8_0 q1 repetition** is a real collapse (300/300 tokens), not a
   truncated log. stderr is in `ab/sanity/stderr_q8_0.log`.
6. `BigMoeOnEdge` is a dirty WIP checkout. We only *read* llama-quant.cpp
   to confirm COPY/override semantics; the binary used is the 08-10
   `build-pc-quantize` artefact.
7. CalaQwen / LFM KEXP not cooked. Marco is the product 6.4G model.

---

## 7. Recommendation for 28c / B′

| option | size vs KEXP | NPU attn MUL_MAT *predicate* (desk, no device) | quality vs shipped KEXP (this cell, from-KEXP requant) |
|---|---|---|---|
| keep Q5_K trunk | 0 | FAIL_TYPE | — |
| trunk Q8_0 **from KEXP** | **+1.95 %** | predicate PASS | **FAIL q1** (collapse). Not a from-source result |
| trunk IQ4_NL **from KEXP** | **−0.65 %** | predicate PASS | **FAIL q1**. Not a from-source result |
| trunk Q4_0 **from KEXP** | **−0.65 %** | predicate PASS | **FAIL q1**. Not a from-source result |
| trunk {Q8_0,IQ4_NL,Q4_0} **from original Q8** | unknown until re-download | same dims → same predicates | **not measured** |
| Road A: HVX kernels for Q5_K | 0 | would be the point | keeps shipped weights |

**Which trunk type wins B′?** None of the three, on the only path that
existed on this PC.

**Do kernels (road A) remain necessary?** **Yes, if** the constraint is
"do not change the shipped GGUF / do not re-download 18 GB". **No, if** the
owner accepts a *from-source* trunk requant and a second A/B (Q8_0 is the
quality candidate, +2 % size; IQ4_NL is the size candidate). Even then
kernels are still required for K-quant-on-HTP or MoE-on-HTP, which B′ never
claimed.

**Owner action if B′ is still attractive:** re-download Q8_0 + imatrix
(sha above), cook trunk from that file with experts **copied** from the
current KEXP (same `--tensor-type` same-type skip, or a concat tool),
re-run `run_q36_ab.py`. Do not treat this cell's Q8_0 GGUF as that artefact.

Hostile audits of this report: `REVIEW_DOC.md` (CONFIRMED: table qualifier,
predicate-vs-runtime, 102 MiB trace, from-KEXP scoping — all patched here);
`REVIEW_MATH.md` (**0 REFUTED** of 50+ numeric claims; 2 UNTRACEABLE live
figures tagged above).

---

## Trace index

| claim | file |
|---|---|
| KEXP type histogram / sha | `results/marcokexp/QUANTIZE_VERIFY.md` |
| tensor dump | `baseline_tensors.json`, `baseline_summary.txt` |
| Q8 source IDs | `results/marcokexp/SOURCE_IDENTIFIED.md` |
| Q8/imatrix deleted | PLAN.md; `models/DELETED-2026-08-17.md` |
| quantize help / COPY | `llama-quantize-help.txt` |
| dry-run sizes | `dryrun-q8_0.log`, `dryrun-iq4_nl.log`, `dryrun-q4_0.log` |
| real cook | `QUANTIZE_STATUS.txt`, `quantize-*.log` |
| expert sha + sizes | `verify_variants.json` |
| token_embd 106 962 944 B / 102.01 MiB | `baseline_summary.txt`; `dryrun-q8_0.log` token_embd line |
| sanity texts | `ab/sanity/ANSWERS.md` |
| sanity log / Q8_0 q1 300 tok | `ab-sanity.log`; `ab/sanity/gen/q1_f1_spa2000__q8_0.json` |
| Q8_0 q1 stderr | `ab/sanity/stderr_q8_0.log` |
| long texts / scoring | `ab/long/ANSWERS.md`, `QUALITY_LONG.md` |
| NPU predicates | `NPU_DESK.md`; ggml-hexagon.cpp:210–214, 2783–2883, 2805–2808, 3136–3155 |
| hostile doc review | `REVIEW_DOC.md` |
| hostile math review (0 REFUTED; variant file shas) | `REVIEW_MATH.md`, `_audit_sha.py` |
