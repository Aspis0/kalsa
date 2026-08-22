# Mellum2 CPU baseline — queue #23 (same-harness streaming-table CPU arm)

**PLUGGED.** Owner instruction: run anyway. AC powered true, USB false, Wireless false. Level 48->48. The GPU arms of this comparison (n10 Mellum2 cells) were **unplugged**. At the expected ~20x effect size the plugged bias is cosmetic; it is on the record. **Do not quote this as an unplugged absolute.**

## Number

**tg n=16: 0.216 t/s** (full precision `0.216388`). wall_s=87.7. over_cap=False. rc=0. `no_repack=true`. `n_gpu_layers=0`. `n_threads=4`. `flash_attn=0`.

Command: `llama-bench -m Mellum2-Q4_K_M -nr -fa off -t 4 -o jsonl -p 0 -n 16 -r 1 -ngl 0`.

## Cross-harness context

| cell | harness | ngl | n | tg t/s | plugged | what it is |
|---|---|---|---:|---:|---|---|
| this cell | llama-bench mmap HEAD `-nr` | 0 | 16 | **0.216** | **yes (AC)** | pure CPU baseline, same harness as n10 |
| n10 load sanity | llama-bench mmap noextra (old pin) | 2 + ncmoe 99 | 16 | **0.223** | no | dense GPU / experts CPU |
| n10 experts-GPU | llama-bench mmap noextra | 2 | 512 | <0.11 (exploratory) | no | experts on GPU, streaming-class |
| lineup product card | **bmoe-cli + recipe** (DIFFERENT harness) | CPU stream | ~222 gen | **5.098** median | no | not comparable as a speedup of this cell |

This number pairs with the n10 **0.22 t/s** `-ngl 2 -ncmoe 99` cell **SAME harness**. Both contrast with the **5.10** bmoe+recipe product number **DIFFERENT harness**. Do not divide 5.10 / 0.216 and call it a llama-bench speedup.

## Conditions

- Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
- Binaries (s3oracle, verified, no rebuild): impl `8adc148c...`, opencl `f4325483...` (unused at ngl=0, noted), stub `b2ae0fa6...`
- GGUF: `/data/local/tmp/_gguf_keep/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` sha `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7`
- Awake pre: `mWakefulness=Awake`
- wake_post: `mWakefulness=Awake`
- temp_c: 28.7 -> 33.8
- MemAvailable kB: 4324820 -> 5360488 (drop -1035668; cliff 2097152)
- No SIGTERM. 10-min cap = exclude/wait (over_cap=False).

Raw: `results/mellum2_cpu_baseline_s23/`
