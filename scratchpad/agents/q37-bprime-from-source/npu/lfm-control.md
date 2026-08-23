# NPU desk — LFM2.5-8B-A1B-KEXP-fromsrc-trunk-control.gguf

Method: q36 / `ggml_hexagon_supported_mul_mat`. Desk only, no device.

- attn tensors: 24; PASS=0 FAIL_TYPE=24 other=0
- shortconv: 36 PASS=0

| tensor | type | shape | kind | predicate | note |
|---|---|---|---|---|---|
| `token_embd.weight` | Q5_K | [2048, 128000] | embed_or_head | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4; GET_ROWS is F32-only so embed lookup on HTP is FAIL_TYPE regardless |
| `shortconv.in_proj.weight ×18` | Q5_K | [2048, 6144] | shortconv | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `shortconv.out_proj.weight ×18` | Q6_K | [2048, 2048] | shortconv | **FAIL_TYPE** | Q6_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_k.weight ×6` | Q5_K | [2048, 512] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_output.weight ×6` | Q5_K | [2048, 2048] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_q.weight ×6` | Q5_K | [2048, 2048] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
| `attn_v.weight ×6` | Q5_K | [2048, 512] | attn | **FAIL_TYPE** | Q5_K not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 |
