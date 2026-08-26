# S23 day-1 pinned set

Device: `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`.

The pinned kalsakernel-v4 + barrier-safe set is `/data/local/tmp/s3oracle/`. All 11 files were present and hashed on device after cleanup and certification.

| file | device bytes | device SHA-256 | PC/archive reference | result |
|---|---:|---|---|---|
| `test-backend-ops` | 10,182,432 | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | barrier PC `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | MATCH |
| `llama-bench` | 7,600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | barrier PC `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | MATCH |
| `libllama-bench-impl.so` | 4,253,160 | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` | barrier PC `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` | MATCH |
| `libggml-opencl.so` | 8,376,320 | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` | archived barrier PC `bbd700de84e32c30c7ea68725e6ed553c5ac25d842f7d0d9b4271917f79f81ea` / 8,381,304 B | MISMATCH |
| `libggml.so` | 536,880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | barrier PC `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | MATCH |
| `libggml-base.so` | 6,103,496 | `ed6bba3bd2f539ad044e1cb3ddabae12807bbaa698fbfd41b97e3c9a7f91e85c` | archived barrier PC `2e16b95119208c7bb70cf3be444670611259a050480e9923f2790541d3e489a8` / 6,103,496 B | MISMATCH |
| `libggml-cpu.so` | 5,165,056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | barrier PC `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | MATCH |
| `libllama.so` | 39,807,624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | barrier PC `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | MATCH |
| `libllama-common.so` | 78,377,240 | `e58ece316ea0d8f829b748c8b663ac2bc2b53e66272c22f530291fd06a0a5200` | archived barrier PC `7547a07298165871f415b835bc66852713ca02afcc43c0d3e3abcb2eca8be2c8` / 78,377,240 B | MISMATCH |
| `libc++_shared.so` | 1,794,776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | NDK 27.1.12297006 PC `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | MATCH |
| `libomp.so` | 1,229,304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | NDK 27.1.12297006 PC `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | MATCH |

Archived barrier comparison: **8/11 match, 3/11 mismatch** (`libggml-opencl.so`, `libggml-base.so`, `libllama-common.so`). The archived PC build directory is not the current deployed variant for those three files. The functional certification in `CERT_DAY0.md` is the authority that pins the current `s3oracle` set for day 1.
