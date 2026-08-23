# q42 — CalaQwen kernel-readability (desk)

PC-only. No device, no download, no push. GGUF not modified.

**CalaQwen kernel-readability: CERTIFIED-with-exceptions (`output.weight` Q4_K; embed/lm-head NPU FAIL_DIM vocab=248320).**

#29 expert 8x4: **120/120 PASS, 0 tensors stay native, 0% of expert bytes.**

## File dumped

| | |
|---|---|
| GGUF | `models/Qwen3.6-35B-A3B-KEXP.gguf` |
| bytes_on_disk | **13416430592** |
| dump | `scratchpad/agents/q42-calaqwen-readability/dump.json` + `dump.txt` (`dump_gguf.py`) |
| NPU desk | `npu_desk.md` / `npu_desk.json` (`npu_desk.py`, q36/`ggml_hexagon_supported_mul_mat`) |
| analysis | `analysis.json` (gates + recipe vs dump; no second GGUF read) |
| n_tensors | **733** |
| arch | `qwen35moe` · 40 blocks · embd **2048** · experts **256**/top-**8** · expert_ff **512** · shared_ff **512** |
| types | F32 361 · Q2_K 80 · Q3_K 40 · Q4_K **1** · Q5_K 181 · Q6_K 70 |

`dump_gguf.py` role=`trunk` is incomplete (misses `attn_gate` / `*_shexp` / `ssm_out`). Table below is suffix-class from the dump, same expert/trunk split as `verify_variants.py`.

## Certification table

Repack #29 applies only to `*_exps` (ne[0]%256==0 ∧ per-expert ne[1]%8==0). NPU column = current type; `IQ4_NL` = B-prime hypothetical (geometry only).

| tensor class | n | type | geometry (ggml ne) | bytes | repack #29 | NPU now | NPU if IQ4_NL |
|---|---:|---|---|---:|---|---|---|
| `ffn_gate_exps.weight` | 40 | Q2_K | **[2048, 512, 256]** | 3523215360 | **PASS** (2048%256=0, 512%8=0) | FAIL_TYPE | FAIL_TYPE (K-quant) |
| `ffn_up_exps.weight` | 40 | Q2_K | **[2048, 512, 256]** | 3523215360 | **PASS** | FAIL_TYPE | FAIL_TYPE |
| `ffn_down_exps.weight` | 40 | Q3_K | **[512, 2048, 256]** | 4613734400 | **PASS** (512%256=0, 2048%8=0) | FAIL_TYPE | FAIL_TYPE |
| `attn_qkv.weight` | 30 | Q5_K | [2048, 8192] | 346030080 | n/a | FAIL_TYPE | **PASS** (2048%32=0, 8192≤32768) |
| `attn_q.weight` | 10 | Q5_K | [2048, 8192] | 115343360 | n/a | FAIL_TYPE | **PASS** |
| `attn_k.weight` | 10 | Q5_K | [2048, 512] | 7208960 | n/a | FAIL_TYPE | **PASS** |
| `attn_v.weight` | 10 | Q5_K | [2048, 512] | 7208960 | n/a | FAIL_TYPE | **PASS** |
| `attn_output.weight` | 10 | Q5_K | [4096, 2048] | 57671680 | n/a | FAIL_TYPE | **PASS** (4096%32=0) |
| `attn_gate.weight` | 30 | Q5_K | [2048, 4096] | 173015040 | n/a | FAIL_TYPE | **PASS** (not in npu_desk ATTN list) |
| `ffn_gate_shexp.weight` | 40 | Q5_K | [2048, 512] | 28835840 | n/a | FAIL_TYPE | **PASS** |
| `ffn_up_shexp.weight` | 40 | Q5_K | [2048, 512] | 28835840 | n/a | FAIL_TYPE | **PASS** |
| `ffn_down_shexp.weight` | 40 | Q6_K | [512, 2048] | 34406400 | n/a | FAIL_TYPE | **PASS** |
| `ssm_out.weight` | 30 | Q6_K | [4096, 2048] | 206438400 | n/a | FAIL_TYPE | **PASS** |
| `token_embd.weight` | 1 | Q5_K | [2048, **248320**] | 349634560 | n/a | FAIL_TYPE | **FAIL_DIM** (+ GET_ROWS F32-only) |
| `output.weight` | 1 | **Q4_K** | [2048, **248320**] | 286064640 | n/a | FAIL_TYPE | **FAIL_DIM** |

Expert total **11660165120** B (86.91% of file). Fail list: empty. First layer `blk.0` and last `blk.39` identical to the 38 in between.

## 1. Repack gates (#29)

Every expert tensor is one of two geometries; both pass.

- gate/up: K=2048=8×256, N=512=64×8, n_exp=256; 88080384 B/tensor; per-expert slice 344064 B
- down: K=512=2×256, N=2048=256×8, n_exp=256; 115343360 B/tensor; per-expert slice 450560 B

No native-stay exceptions.

## 2. Trunk types + B-prime IQ4_NL

Actual trunk (quantized, non-expert): **Q5_K + Q6_K**, plus **one Q4_K** (`output.weight`).

| bucket | tensors | types |
|---|---|---|
| full-attn (layers 3,7,11,15,19,23,27,31,35,39) | 10×(q,k,v,output) | all Q5_K |
| GDN (other 30 layers) | 30×`attn_qkv` + 30×`attn_gate` | all Q5_K |
| shared expert | 40×(gate/up Q5_K, down Q6_K) | |
| SSM out | 30× Q6_K | |
| embed | `token_embd` Q5_K | |
| lm head | `output.weight` **Q4_K** (untied) | |

npu_desk on this file: **attn 70, PASS=0, FAIL_TYPE=70** (Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4). Expected for KEXP.

B-prime swap **would apply cleanly to attn geometry**: all 70 npu_desk attn tensors have ne[0]%32==0 and ne[1]≤32768. Same for `attn_gate` / shexp / `ssm_out` if a CalaQwen recipe includes them (Marco B-prime only lists q/k/v/output + embed).

**Would not land on HTP:** `token_embd` and `output.weight`, ne[1]=**248320** > 32768 → FAIL_DIM after IQ4_NL. Same class as Marco embed FAIL_DIM (vocab 151936). CalaQwen is **untied** (Marco B-prime dump has no `output.weight`). GET_ROWS remains F32-only for embed lookup.

LM head / vocab: embd=2048, vocab=**248320** (from `token_embd.shape[1]`).

## 3. Recipe conformance

Nickname (PLAN.md, 20/08): **KEXP = experts Q2_K+Q3_K, trunk Q5_K/Q6_K**.

Cook file actually used: `results/requant1c/tensor_types_patterns.txt`.

| rule | dump | verdict |
|---|---|---|
| gate/up = Q2_K, down = Q3_K | 80 Q2_K + 40 Q3_K, **every** layer 0–39 | **exact** |
| first/last layer expert exceptions | none (`blk.0` = `blk.39` = all 40) | none |
| mixed expert types | 0 | none |
| trunk Q5_K/Q6_K | Q5_K 181 + Q6_K 70 | **match**, except |
| `output.weight` | **Q4_K** 1 tensor, 286064640 B | **recipe pin** (`output.weight=q4_k`), nickname exception |
| vs cook patterns | 0 mismatches | **PASS** |

No silent Q4_K-on-`attn_output` (that bug was the first cook; this file is the regex-fixed one).

## 4. Streaming-engine

| | CalaQwen (this dump) | Marco (q40 M5) | LFM2.5 (q37 inventory) |
|---|---|---|---|
| n_experts | **256** all 40 layers | 256 | 32 (MoE layers only) |
| expert 3D | [2048,512,256] / [512,2048,256] | [1024,768,256] / [768,1024,256] | [2048,1792,32] / [1792,2048,32] |
| MoE coverage | **40/40** layers, 3 `_exps` each | all layers | 22/24 (2 leading dense) |
| extra vs those two | **shared experts 2D** every layer; **GDN/SSM** on 30/40 | neither | shortconv hybrid, no shexp |

Nothing exotic in the 3D expert layout: uniform `n_exp=256` equals `qwen35moe.expert_count`, no per-layer expert-count change. Engine that only walks `ffn_*_exps` still sees a regular `[K,N,256]` stack; it must **also** keep `*_shexp` (2D) and GDN `ssm_*` / `attn_qkv` / `attn_gate` in the resident/stream set — those are not 3D expert tensors.

## Verdict

**CalaQwen kernel-readability: CERTIFIED-with-exceptions (`output.weight` Q4_K; embed/lm-head NPU FAIL_DIM vocab=248320).**

Axis A (this report) does **not** certify axis B (from-source quality / PPL).
