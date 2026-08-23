# NPU desk — Marco-Mini-Instruct-KEXP-fromsrc-trunk-iq4_nl.gguf

Method: q36 / `ggml_hexagon_supported_mul_mat`. Desk only, no device.

- attn tensors: 112; PASS=112 FAIL_TYPE=0 other=0
- shortconv: 0 PASS=0

| tensor | type | shape | kind | predicate | note |
|---|---|---|---|---|---|
| `token_embd.weight` | IQ4_NL | [1024, 151936] | embed_or_head | **FAIL_DIM** | ne[1]=151936 > 32768 (lm-head cap); GET_ROWS is F32-only so embed lookup on HTP is FAIL_TYPE regardless |
| `attn_k.weight ×28` | IQ4_NL | [1024, 1024] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_output.weight ×28` | IQ4_NL | [2048, 1024] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_q.weight ×28` | IQ4_NL | [1024, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_v.weight ×28` | IQ4_NL | [1024, 1024] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
