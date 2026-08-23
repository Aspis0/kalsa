# Q36 — NPU Desk Check: Can Marco-Mini Trunk Re-quant Types Actually Run on HTP?

> **Status:** READ-ONLY desk check complete (2026-08-23)  
> **Source trees scanned:** `upstream-hexagon/` (primary, newer) and `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-hexagon/` (secondary, identical predicates)  
> **No device access, no git writes.**

---

## Executive Summary

**The trunk itself can run on HTP with Q8_0, IQ4_NL, or Q4_0.** Every trunk MUL_MAT (attn Q/K/V/O projections, MoE gate_inp, router logits) satisfies all HTP predicates. But **the tied `token_embd.weight` kills HTP at two points**: (1) `GET_ROWS` of the embedding table requires F32 source, so any quantized `token_embd.weight` is rejected; (2) `MUL_MAT` for the LM head with `ne[1]=151936 > 32768` is rejected for all quantized types. Since embeddings and LM head are tied to one tensor, the entire embedding/head subsystem must stay on CPU in F32. The practical consequence: **a single quantized trunk copy cannot serve both CPU decode and HTP prefill as-is**, because the tied `token_embd.weight` must be F32 for HTP's `GET_ROWS`, but F32 `token_embd.weight` is 600 MB — negating most of the quantization savings. Kernel-level work (road A) or model surgery (untieing the head) remain necessary.

---

## 1. Supported Types in `supports_op` / MUL_MAT / MUL_MAT_ID

### Source: `ggml-hexagon.cpp` — `ggml_hexagon_supported_mul_mat` (line 2783)

The supported weight types for quantized MUL_MAT are an explicit `switch`:

| Source (file:line) | Supported quantized weight types |
|---|---|
| `upstream-hexagon/.../ggml-hexagon.cpp:2806` (BigMoeOnEdge identical at 2837) | **Q4_0, Q4_1, Q8_0, IQ4_NL, MXFP4** |
| `upstream-hexagon/.../ggml-hexagon.cpp:211` (`is_repack_type`) | Same five types |
| `upstream-hexagon/.../htp/htp-ops.h:20-28` (`HTP_TYPE` enum) | F32(0), F16(1), Q4_0(2), Q4_1(3), Q8_0(8), IQ4_NL(20), I32(26), I64(27), MXFP4(39); tiled variants for Q4_0/Q4_1/Q8_0/MXFP4 |

**NOT supported:** Q4_K, Q5_K, Q6_K, Q2_K, Q3_K, and all other K-quants. There is no `case GGML_TYPE_Q5_K:` in any type switch. K-quant tensors will cause `supports_op` to return `false`, and the scheduler falls back to CPU.

Additional non-quantized paths:
- **F16 weights:** supported (line 2821), but no HMX batching for non-F16 in quantized path (line 2232).
- **F32 weights:** supported (line 2831), requires F32 activations.

Activation types (src1 / Q/K/V):
- MUL_MAT: F32 or F16 (line 2791)
- MUL_MAT_ID: F32 only (line 2858)
- dst: F32 only (both ops)

### Source: `MUL_MAT_ID` (line 2855)

Same five quantized types. No 32768 column limit (different from MUL_MAT). But src1 must be F32, src2 (expert indices) must be I32.

---

## 2. Dimension Constraints

### 2a. K/N Alignment — `src0->ne[0] % 32`

**File:line:** `ggml-hexagon.cpp:2801` (MUL_MAT), `ggml-hexagon.cpp:2871` (MUL_MAT_ID)

```c
if (src0->ne[0] % 32) {
    return false;
}
```

The reduction dimension (K, which is `ne[0]` in ggml's MUL_MAT convention where weight is `[K, N]`) must be divisible by **32** for all quantized types. This is because HVX/HMX tiled kernels process 32-element chunks.

### 2b. LM-Head Column Limit — `src0->ne[1] > 32768`

**File:line:** `ggml-hexagon.cpp:2806` (MUL_MAT only, NOT MUL_MAT_ID)

```c
// hardcoded limit to refuse the lm-head for now
if (src0->ne[1] > 32768) {
    return false;
}
```

This check exists **only** in the quantized `case` block for MUL_MAT. The F32 and F16 paths do NOT have this limit. The comment says "for now" — it is a policy gate, not a kernel limitation. But it blocks all quantized MUL_MAT ops where the output feature dimension (N, i.e., `ne[1]` of the weight) exceeds 32768.

For Marco-Mini's `token_embd.weight [1024, 151936]` used as LM head: `ne[1] = 151936 > 32768` → **REJECTED** for Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4.

### 2c. No Broadcasting for Quantized MUL_MAT

**File:line:** `ggml-hexagon.cpp:2811`

```c
if (src1->ne[2] != 1 || src1->ne[3] != 1) {
    return false;  // no broadcasting (for now)
}
```

Quantized MUL_MAT rejects batched activation tensors (`ne[2] > 1` or `ne[3] > 1`). This is the nseq constraint from issue #26094: single-sequence prefill (`npl1`) works; multi-sequence batching falls back to CPU.

### 2d. HMX N-dimension Alignment

**File:line:** `ggml-hexagon.cpp:2208`

```c
if (ne01_padded % 32 != 0) {
    return false;
}
```

HMX (Hexagon Matrix eXtensions) requires the output N dimension (padded) to be 32-aligned. For repacked types, `ne01_padded = hex_round_up(ne01, 32)`. Marco-Mini's trunk tensors have `ne01 = 1024`, which is 32-aligned → **PASS**.

### 2e. RoPE — F32 Only, Offset Alignment

**File:line:** `ggml-hexagon.cpp:3180-3230`

```c
if (op_params[15] % 32 != 0) {
    return false;
}
if (src0->type != GGML_TYPE_F32) { return false; }
if (dst->type != GGML_TYPE_F32) { return false; }
if (src1->type != GGML_TYPE_I32) { return false; }
```

RoPE is F32-only for both input and output. The position offset must be 32-aligned. For Marco-Mini with head_dim=128, `ne0 = 128`, and RoPE operates on the F32 Q/K tensors (which is what the graph produces after quantized matmul + implicit dequant to F32). **PASS** for all trunk types.

### 2f. LM-Head Column Limit Specifics

For `token_embd.weight [1024, 151936]` used as LM head (src0 in MUL_MAT):
- `ne[0] = 1024` (K) → `1024 % 32 = 0` → **PASS** on alignment
- `ne[1] = 151936` (N) → `151936 > 32768` → **FAIL** on column limit for ALL quantized types

---

## 3. Per-Tensor × Per-Type Verdict

Marco-Mini trunk tensors (28 layers, hidden=1024, n_head=16, n_kv=8, head_dim=128):

### Trunk MUL_MAT tensors (weights)

| Tensor | Shape [K, N] | Q8_0 | IQ4_NL | Q4_0 | Verdict | Predicate |
|---|---|---|---|---|---|---|
| `attn_q` | [1024, 2048] | ✅ | ✅ | ✅ | **PASS** | `ne[0]=1024%32=0`, `ne[1]=2048≤32768`, no broadcast needed, type in repack set |
| `attn_k` | [1024, 1024] | ✅ | ✅ | ✅ | **PASS** | Same as above; GQA `n_gqa=2` broadcast on activation side, not weight side |
| `attn_v` | [1024, 1024] | ✅ | ✅ | ✅ | **PASS** | Same |
| `attn_output` | [2048, 1024] | ✅ | ✅ | ✅ | **PASS** | `ne[0]=2048%32=0`, `ne[1]=1024≤32768` |
| `ffn_gate_inp` (router) | [1024, 256] | F32 | F32 | F32 | **N/A** | Already F32; F32 MUL_MAT supported (line 2831) |
| `ffn_gate_exps` | [1024, 768] per expert | ❌ K-quant | ❌ K-quant | ❌ K-quant | **CPU forever** | Q2_K not in type switch; excluded from scope |
| `ffn_up_exps` | [1024, 768] per expert | ❌ K-quant | ❌ K-quant | ❌ K-quant | **CPU forever** | Same |
| `ffn_down_exps` | [768, 1024] per expert | ❌ K-quant | ❌ K-quant | ❌ K-quant | **CPU forever** | Q3_K not in type switch |
| `token_embd.weight` (as LM head) | [1024, 151936] | ❌ | ❌ | ❌ | **FAIL_LM_HEAD** | `ne[1]=151936 > 32768` at line 2806 |

### Embedding / LM head

| Operation | src type | dst type | Shape | Verdict | Predicate |
|---|---|---|---|---|---|
| `GET_ROWS(token_embd.weight, tokens)` | **Must be F32** | F32 | [1024, vocab] → [1024, n_tokens] | **FAIL_QUANT** | `ggml-hexagon.cpp:3139`: `src0->type != HTP_TYPE_F32 → return HTP_STATUS_NO_SUPPORT` |
| `MUL_MAT(token_embd.weight, hidden)` (LM head) | Q8_0/Q4_0/IQ4_NL | F32 | [1024, 151936] × [1024, 1] | **FAIL_LM_HEAD** | `ne[1]=151936 > 32768` at line 2806 |
| `MUL_MAT(token_embd.weight, hidden)` (F32 fallback) | F32 | F32 | [1024, 151936] × [1024, 1] | **PASS (technically)** | F32 path (line 2831) has no ne[1] limit; but 600 MB, defeats purpose |

### Norms and element-wise (all F32)

| Op | Type | Verdict | Predicate |
|---|---|---|---|
| RMS_NORM (28×, final norm) | F32 in, F32 out | **PASS** | `ggml-hexagon.cpp:4107` — unary path, F32→F32 |
| ADD (residual connections, 28×) | F32 + F32 → F32 | **PASS** | `ggml-hexagon.cpp:4125` — binary path, F32+F32→F32 |
| MUL (norm scale) | F32 × F32 → F32 | **PASS** | Binary path |
| SwiGLU / GEGLU (FFN activation) | F32 → F32 | **PASS** | `ggml-hexagon.cpp:4143` — activations path, F32 |
| SOFTMAX (attention scores) | F32 → F32 | **PASS (with caveats)** | See §5 |

### Attention

| Op | Type | Verdict | Predicate |
|---|---|---|---|
| RoPE (28×, Q and K) | F32 → F32 | **PASS** | `line 3208`: src0 F32, dst F32, offset % 32 = 0; head_dim=128 → ne[0]=128 ✓ |
| Flash Attention (28×) | Q: F32/F16, K/V: F16 | **PASS (with caveats)** | See §5 |
| Softmax (attention scores) | F32 → F32 | **PASS** | See §5 |

---

## 4. The Tied Embedding Problem — `vocab=151936 > 32768`

### Does this block HTP logits / GET_ROWS / MUL_MAT of the head while attn still runs on HTP?

**Yes.** Two independent blocks:

**Block 1 — GET_ROWS for token embedding lookup:**
- `upstream-hexagon/.../get-rows-ops.c:101` (function `op_get_rows`):
  ```c
  if (octx->src[0]->type != HTP_TYPE_F32) {
      return HTP_STATUS_NO_SUPPORT;
  }
  ```
- This is in the HTP device-side kernel, not just the host predicate. Even if `supports_op` returned true, the kernel itself rejects non-F32 input.
- **Consequence:** `token_embd.weight` MUST be F32 for embedding lookup to run on HTP. Any quantized version (Q8_0, Q4_0, etc.) is rejected.

**Block 2 — MUL_MAT for LM head:**
- `ggml-hexagon.cpp:2806`: `ne[1] > 32768` rejects ALL quantized types.
- `ne[1] = 151936` (vocab size) → rejected.
- **Consequence:** Even if the weight were quantized, the LM head MUL_MAT would not run on HTP.

**Combined effect with tied embeddings:**
- In gguf/llama.cpp, `token_embd.weight` and `model.output` are the **same tensor** (tied, no separate `output.weight`).
- For HTP: the tensor must be F32 (for GET_ROWS) → but then the LM head MUL_MAT works (F32 path has no ne[1] limit).
- The F32 LM head MUL_MAT at line 2831 passes all checks: F32 src0, F32 src1, `nb[1] >= nb[0]` (151936×4 ≥ 1024×4 ✓).
- **However:** keeping `token_embd.weight` as F32 costs ~600 MB (151936 × 1024 × 4 bytes), negating most quantization savings.

**Practical consequence:**
- Trunk attention/FFN (excluding experts) CAN run on HTP with quantized types.
- Token embedding lookup (start of forward pass) MUST run on CPU with F32 embeddings.
- LM head MUL_MAT (end of forward pass) can technically run on HTP with F32 weights, but only if the F32 weight is in an HTP buffer — which is expensive.
- The scheduler will split the graph: GET_ROWS on CPU, trunk on HTP, LM head likely on CPU (or HTP if F32 buffer is allocated).

---

## 5. Other Trunk Prefill Ops on HTP

### RMS_NORM
- **PASS.** Unary path at line 4107. src0 F32, dst F32, contiguous, same shape. No dimension restrictions beyond contiguity.

### SOFTMAX
- **File:line:** `ggml-hexagon.cpp:3047-3112`
- F32 in, F32 out. **Constraint:** `ne[0] > 32 && (ne[0] & 31) != 0` → rejected (line 3104).
- For attention softmax with `ne[0] = n_kv * head_dim = 8 × 128 = 1024`: `1024 % 32 = 0` → **PASS**.
- Max row size: 131072 (line 3101). 1024 is well under → **PASS**.
- Mask (src1): F32 or F16, contiguous, compatible shape → supported.

### FLASH_ATTN_EXT
- **File:line:** `ggml-hexagon.cpp:2093-2135`
- Q: F32 or F16, K: F16, V: F16, mask: F16, dst: F32 or F16.
- HMX path requires `DK % 64 == 0 && DV % 64 == 0` (line 1960). With head_dim=128: `128 % 64 = 0` → **PASS**.
- HVX fallback path always available when HMX fails.
- GQA factor `G = n_head / n_kv = 16/8 = 2` → handled by `kparams->G`.
- VTCM budget check: depends on seq_len, but for typical prefill lengths (≤2048 tokens) this passes.

### GET_ROWS (of quantized embeddings)
- **FAIL.** `get-rows-ops.c:101` and `ggml-hexagon.cpp:3139`: src0 must be F32. No quantized GET_ROWS kernel exists.

### GET_ROWS (of F32 tensors)
- **PASS.** `ggml-hexagon.cpp:3136-3155`: F32 src0, I32/I64 indices, F32 dst. Used for index lookups on F32 tensors (e.g., expert selection, positional buckets).

### Binary ops (ADD/SUB/MUL/DIV)
- **PASS** for F32+F32→F32 (residual connections, norm scales). `ggml-hexagon.cpp:2903-2940`.

### SwiGLU / GEGLU activations
- **PASS.** F32 input, F32 output, contiguous. `ggml-hexagon.cpp:3025-3045`. Used in FFN gating.

### MUL_MAT_ID (MoE expert matmul)
- **FAIL for experts.** Expert weights are Q2_K/Q3_K → not in the supported type set.
- **The MUL_MAT_ID kernel itself supports:** Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 (line 2866-2870), same as MUL_MAT.
- But Marco-Mini's experts use K-quants → they never reach this kernel.

### MUL_MAT for router gate_inp (F32 × F32 → F32)
- **PASS.** F32 path at line 2831. `src0 [1024, 256]`, `src1 [1024, n_tokens]`. No ne[1] limit for F32.

---

## 6. Verdict

### Can a single Q8_0 / IQ4_NL / Q4_0 trunk copy serve CPU decode + future HTP prefill?

**No — not without model surgery or kernel work.** Here is why:

1. **Trunk attention/FFN projections:** ALL pass HTP predicates with Q8_0, IQ4_NL, or Q4_0. Every dimension is 32-aligned, no broadcasting issues, types are in the supported set. **This part of the trunk can run on HTP.**

2. **Tied `token_embd.weight`:**
   - Must be F32 for `GET_ROWS` (HTP kernel-level hard requirement at `get-rows-ops.c:101`).
   - At F32, this tensor is ~600 MB — roughly half the entire model. The quantization savings on the trunk (~200 MB saved by going Q5_K→Q8_0 on ~300 MB of trunk weights) are partially offset by the need to keep the embedding in F32.
   - **The tied head MUL_MAT** with `ne[1]=151936 > 32768` is rejected for all quantized types (`ggml-hexagon.cpp:2806`). The F32 path has no such limit, but using F32 weights for the LM head wastes the quantization.

3. **The graph splits cleanly in two:**
   - **CPU:** `GET_ROWS(token_embd.weight F32, tokens)` → embedding lookup → dequantized F32 activation → feed to HTP.
   - **HTP:** All trunk ops (RMS_NORM, MUL_MAT Q/K/V/O, RoPE, Softmax, FlashAttention, ADD, SwiGLU, MoE gate).
   - **CPU:** Final norm → `MUL_MAT(token_embd.weight F32, hidden)` → logits.
   - This works, but the "single quantized trunk copy" dream fails: `token_embd.weight` must remain F32 for the CPU→HTP→CPU pipeline to function.

4. **What would fix it (road A — kernel work):**
   - Add a quantized `GET_ROWS` kernel (Q8_0/Q4_0 source → F32 dst) in `get-rows-ops.c`. This would let `token_embd.weight` be stored as Q8_0 (~150 MB instead of 600 MB) and dequantized on-the-fly during embedding lookup.
   - Remove or raise the `ne[1] > 32768` limit in `ggml_hexagon_supported_mul_mat` (line 2806). The comment says "for now" — the HVX/HMX kernels may already handle large N; this is a policy gate, not necessarily a kernel limitation.
   - If both changes land, a single Q8_0 `token_embd.weight` would serve both embedding lookup (via quantized GET_ROWS) and LM head (via quantized MUL_MAT with raised limit).

5. **What would fix it (model surgery — no kernel work):**
   - **Untie the embeddings.** Store `token_embd.weight` as F32 (for GET_ROWS) and a separate `output.weight` as Q8_0 (for LM head). This requires modifying the GGUF or the model builder.
   - The F32 embeddings still cost 600 MB, but the LM head can now be quantized. The LM head MUL_MAT on HTP with Q8_0 would save ~150 MB vs F32.
   - Net: ~600 MB (embeddings F32) + ~150 MB (LM head Q8_0) = ~750 MB, vs ~600 MB F32 for both tied. Only a marginal improvement.

### Bottom line

The **type constraint is not the blocker** — Q8_0/IQ4_NL/Q4_0 work fine for every trunk tensor. The blocker is the **dimension constraint on the LM head** (`ne[1] > 32768` at line 2806) combined with the **GET_ROWS F32-only requirement** (at `get-rows-ops.c:101`) for the tied embedding. Together, they force `token_embd.weight` to stay F32, which cripples the memory argument for re-quantization.

**Kernels (road A) remain necessary** — specifically:
1. A quantized `GET_ROWS` kernel (accepting Q8_0/Q4_0/IQ4_NL source, outputting F32).
2. Raising or removing the `ne[1] > 32768` ceiling in `supported_mul_mat`.

Without these, the re-quant trunk can serve HTP prefill for the **attention/FFN layers only**, while the embedding lookup and LM head stay on CPU with F32 weights. This is a valid split, but it means the "single trunk copy" is really "trunk on HTP + embedding/head on CPU in F32" — which is less memory-efficient than it sounds.

---

## Appendix: File:Line Reference Index

| Predicate | File | Line(s) |
|---|---|---|
| `is_repack_type` (supported quant types) | `ggml-hexagon.cpp` | 211-213 |
| HTP_TYPE enum | `htp/htp-ops.h` | 20-36 |
| MUL_MAT supported types + dims | `ggml-hexagon.cpp` | 2783-2852 |
| `ne[0] % 32` alignment | `ggml-hexagon.cpp` | 2801 |
| `ne[1] > 32768` LM head limit | `ggml-hexagon.cpp` | 2806 |
| No broadcasting (`ne[2]!=1 ∥ ne[3]!=1`) | `ggml-hexagon.cpp` | 2811 |
| MUL_MAT_ID supported types + dims | `ggml-hexagon.cpp` | 2855-2892 |
| F32 MUL_MAT path (no ne[1] limit) | `ggml-hexagon.cpp` | 2831-2841 |
| HMX N-dim alignment (`ne01_padded % 32`) | `ggml-hexagon.cpp` | 2208 |
| RoPE F32-only + offset % 32 | `ggml-hexagon.cpp` | 3180-3230 |
| Softmax F32 + ne[0] alignment | `ggml-hexagon.cpp` | 3047-3112 |
| FlashAttn types + DK%64, DV%64 | `ggml-hexagon.cpp` | 1934-1960, 2093-2135 |
| GET_ROWS F32-only (host) | `ggml-hexagon.cpp` | 3136-3155 |
| GET_ROWS F32-only (kernel) | `htp/get-rows-ops.c` | 101 |
| RMS_NORM / unary F32 | `ggml-hexagon.cpp` | 3025-3045, 4105-4110 |
| Binary ADD F32 | `ggml-hexagon.cpp` | 2903-2940 |
| `supports_op` dispatch table | `ggml-hexagon.cpp` | 4062-4200 |
| static_assert HTP↔GGML type mapping | `ggml-hexagon.cpp` | 4370-4378 |
| LM head graph construction (Qwen3moe) | `models/qwen3moe.cpp` | 170-176 |
| Embedding lookup (`ggml_get_rows`) | `llama-graph.cpp` | 2333 |
