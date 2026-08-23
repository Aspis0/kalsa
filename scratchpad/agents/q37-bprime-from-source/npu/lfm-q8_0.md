# NPU desk — LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf

Method: q36 / `ggml_hexagon_supported_mul_mat`. Desk only, no device.

- attn tensors: 24; PASS=24 FAIL_TYPE=0 other=0
- shortconv: 36 PASS=36

| tensor | type | shape | kind | predicate | note |
|---|---|---|---|---|---|
| `token_embd.weight` | Q8_0 | [2048, 128000] | embed_or_head | **FAIL_DIM** | ne[1]=128000 > 32768 (lm-head cap); GET_ROWS is F32-only so embed lookup on HTP is FAIL_TYPE regardless |
| `shortconv.in_proj.weight ×18` | Q8_0 | [2048, 6144] | shortconv | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `shortconv.out_proj.weight ×18` | Q8_0 | [2048, 2048] | shortconv | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_k.weight ×6` | Q8_0 | [2048, 512] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_output.weight ×6` | Q8_0 | [2048, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_q.weight ×6` | Q8_0 | [2048, 2048] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
| `attn_v.weight ×6` | Q8_0 | [2048, 512] | attn | **PASS** | quantized MUL_MAT predicates hold (desk, nseq=1 assumed) |
