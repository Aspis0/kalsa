# NPU desk — Qwen3.6-35B-A3B-KEXP.gguf

Method: q36 / `ggml_hexagon_supported_mul_mat`. Desk only, no device.

- attn tensors: 70; PASS=0 FAIL_TYPE=70 other=0
- shortconv: 0 PASS=0

| tensor | type | shape | kind | predicate | note |
|---|---|---|---|---|---|
| `output.weight` | Q4_K | [2048, 248320] | embed_or_head | **FAIL_TYPE** | Q4_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `token_embd.weight` | Q5_K | [2048, 248320] | embed_or_head | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4; GET_ROWS is F32-only so embed lookup on HTP is FAIL_TYPE regardless |
| `attn_qkv.weight ×30` | Q5_K | [2048, 8192] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_k.weight ×10` | Q5_K | [2048, 512] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_output.weight ×10` | Q5_K | [4096, 2048] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_q.weight ×10` | Q5_K | [2048, 8192] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_v.weight ×10` | Q5_K | [2048, 512] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
