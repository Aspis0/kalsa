# S23 pinned toolchain check — post-certification

Presence/hash audit plus correctness certification. No benchmark or model load was run. Device: `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`.

## Lineage target

The plan's target is the consolidated engine head `1882bf8cd`, with K2 `kalsakernel-v3` (`c1bb48d32`), qk23 `kalsakernel-v4` (`ec7235af`), and queue #13 barrier-safe q4/q5/q6 (`9a4112106`). The acceptance card is 407/407 `MUL_MAT_ID`, dense 925/925, roundtrip zero, and `-nr` smoke. The current deployed directory is `/data/local/tmp/s3oracle`.

## Device vs PC records

| device artifact | bytes | device SHA-256 | PC reference | result |
|---|---:|---|---|---|
| `test-backend-ops` | 10,182,432 | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | `results/barrier_verify_s23/pc_sha256.txt` | MATCH (recorded PC build; current build directory absent) |
| `llama-bench` | 7,600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | `results/barrier_verify_s23/pc_sha256.txt` | MATCH |
| `libllama-bench-impl.so` | 4,253,160 | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` | `results/barrier_verify_s23/pc_sha256.txt` | MATCH |
| `libggml-opencl.so` | 8,376,320 | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` | barrier record: 8,381,304 / `bbd700de84e32c30c7ea68725e6ed553c5ac25d842f7d0d9b4271917f79f81ea` | MISMATCH; `results/olmoe_gpu_moe_s23/armC/MANIFEST.md` labels current `f432...` as HEAD v4 + #26476 + barrier-safe |
| `libggml.so` | 536,880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | barrier record, same | MATCH |
| `libggml-base.so` | 6,103,496 | `ed6bba3bd2f539ad044e1cb3ddabae12807bbaa698fbfd41b97e3c9a7f91e85c` | barrier record: same bytes / `2e16b95119208c7bb70cf3be444670611259a050480e9923f2790541d3e489a8` | MISMATCH |
| `libggml-cpu.so` | 5,165,056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | barrier record, same | MATCH |
| `libllama.so` | 39,807,624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | barrier record, same | MATCH |
| `libllama-common.so` | 78,377,240 | `e58ece316ea0d8f829b748c8b663ac2bc2b53e66272c22f530291fd06a0a5200` | barrier record: same bytes / `7547a07298165871f415b835bc66852713ca02afcc43c0d3e3abcb2eca8be2c8` | MISMATCH |
| `libc++_shared.so` | 1,794,776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | `models_staging/ship_runtime_s23_0ac612de/` and NDK record | MATCH |
| `libomp.so` | 1,229,304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | `results/oracle_consumer_s23/defectP/` / NDK record | MATCH |

All eleven required toolchain artifacts exist under `/data/local/tmp/s3oracle`. The exact current PC build files for the barrier rows are no longer present; the comparison uses the archived PC/device records. `models_staging/ship_runtime_s23_0ac612de/` is a different legacy ship runtime: its core `.so` hashes mismatch this S3 set except `libc++_shared.so`. `results/oracle_consumer_s23/k2_phase1/` contains older OpenCL candidates; `backups/` contains source bundles, not deployable ELF copies.

Pinned status: **functionally pinned by `CERT_DAY0.md`**. Byte-exact audit against the archived barrier PC set is 8/11 MATCH and 3/11 MISMATCH (`libggml-opencl.so`, `libggml-base.so`, `libllama-common.so`). Keep the entire `s3oracle` directory; do not delete or replace it. No roundtrip executable was present in the preserved set, so roundtrip was not run.
