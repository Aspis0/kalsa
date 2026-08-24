# NPU desk — OLMoE-1B-7B-0924-Instruct-Q4_0.gguf

Method: q36 / `ggml_hexagon_supported_mul_mat`. Desk only, no device.

- attn tensors: 64; PASS=64 FAIL_TYPE=0 other=0
- shortconv: 0 PASS=0

| tensor | type | shape | kind | predicate | note |
|---|---|---|---|---|---|
| `output.weight` | Q6_K | [2048, 50304] | embed_or_head | **FAIL_TYPE** | Q6_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `token_embd.weight` | Q4_0 | [2048, 50304] | embed_or_head | **FAIL_DIM** | ne[1]=50304 > 32768 (lm-head cap); GET_ROWS is F32-only so embed lookup on HTP is FAIL_TYPE regardless |
| `attn_k.weight ×16` | Q4_0 | [2048, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_output.weight ×16` | Q4_0 | [2048, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_q.weight ×16` | Q4_0 | [2048, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_v.weight ×16` | Q4_0 | [2048, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
