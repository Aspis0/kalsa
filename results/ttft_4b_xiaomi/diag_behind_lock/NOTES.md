# Diagnostic launch behind HyperOS PIN (2026-08-14 06:19)

Cold `am start` with `mDreamingLockscreen=true`. JS ran.

| marker | time | detail |
|---|---|---|
| `engine.eagerInit` | 06:19:33.310 | `{"modelId":"qwen3.5-4b","generation":0}` |
| `loadModel` start | 06:19:33.770 | n_parallel 1 |
| `loadModel` ctx | 06:20:25.896 | **52.1 s load** |
| mmproj | 06:20:26.037 | `/data/user/0/com.kalsa.app/files/models/qwen3.5-4b/mmproj-F16.gguf` n_ctx=16384 n_embd=2560 |
| `KALSA_SESSION load` | 06:20:26.036 | `ok:false reason=meta_mismatch:conversationId` |
| `KALSA_KVDIAG` | 06:20:26.036 | `n_past:0 tokens_on_disk:0 ok:false` |
| `KALSA_PREWARM` | 06:20:27.101 | `skip reason=background` (foreground gate — expected) |

Conclusion: in-app catalog 4B (official size + mmproj) is already selected and complete. Campaign 2.74 GB file is a different revision; product path uses the catalog bundle already in app storage. Recipe flags are live. Prewarm will not run until the lock is dismissed.
