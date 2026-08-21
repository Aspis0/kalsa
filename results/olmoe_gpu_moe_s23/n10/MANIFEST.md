# OLMoE confirmatory N≥5 — session manifest (PREREG v1.2)

Protocol: `../PREREG_N10.md` **v1.2**. Device: S23 TLS `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. PC-side `adb shell`.

## Commands

```text
pwsh -File results/olmoe_gpu_moe_s23/n10/run_n10.ps1
# TargetComplete=5 (v1.2). Restores frozen stack, session pins, ABBA tg512 until 5 complete blocks.
```

## Frozen pins (sha256 on-device before every cell)

| artifact | sha256 |
|---|---|
| noextra `libllama-bench-impl.so` | `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` |
| `libggml-opencl.so` | `2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87` |
| `llama-bench` stub | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| `libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| `libggml.so` | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| `libggml-cpu.so` | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| OLMoE Q4_K_M | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |

Stock extra_bufts `bad17952…` is forbidden. PC sources: `results/oomwall_s23/libggml-opencl.2ed2e48a.so`, `staging/noextra/*`, `models/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`.

## Arms

- A: `-ngl 16 -fa off -t 4` (experts GPU)
- B: `-ngl 16 -ncmoe 99 -fa off -t 4` (experts CPU)
- Cell: `-p 0 -n 512 -r 1` only. ABBA per block.

## Block table

Filled by `run_n10.ps1` into `runs.csv` and `scratchpad/agents/n10-kexp-session/REPORT.md`. See those files — they are ground truth.

## Notes

- `libggml-base.so` / `libllama-common.so` on device at restore are the q6k-era companions (`e51ed143…` / `646bd2d8…`). Original W4c device copies (`9f7081a2…` / `a1c034b0…`) were destroyed by the q6k `rm -rf s3oracle` and are not archived on PC. Not frozen pins.
- v1.2 amendment: N≥5 not N≥10. Zero blocks were collected pre-amendment.
