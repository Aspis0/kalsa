# Mellum2 CPU baseline — queue #23

**PLUGGED.** Owner instruction: run on AC anyway. Declare it.

The GPU arms of this comparison (n10 Mellum2 cells under `results/olmoe_gpu_moe_s23/n10/mellum2/`) were **unplugged**. At the expected ~20× effect size vs the 5.10 bmoe+recipe product number the plugged bias is cosmetic, but it is on the record. Absolutes from this cell carry a plugged flag. Do not quote them as unplugged.

## What this cell is

Same-harness CPU baseline for the streaming table.

- **This cell:** llama-bench mmap, HEAD s3oracle, `-ngl 0 -nr -fa off -t 4 -o jsonl -p 0 -n 16 -r 1`. Pure CPU, no GPU, no repack.
- **Pairs with:** n10 load-sanity `m2_ngl2_ncmoe99` (same llama-bench mmap harness, `-ngl 2 -ncmoe 99`, n=16, **unplugged**, tg **0.222682** t/s).
- **Contrasts with:** lineup product-card Mellum2 **5.098 t/s median** (`bmoe-cli` + recipe, **DIFFERENT harness**). Do not treat 5.10 / this-cell as a llama-bench speedup.

## Pins (on-device, verified; no rebuild / no redeploy)

| artifact | sha256 | note |
|---|---|---|
| libllama-bench-impl.so | 8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807 | HEAD; `-nr` mandatory |
| libggml-opencl.so | f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d | HEAD; **unused at ngl=0**, still verified |
| llama-bench stub | b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c | unchanged |
| Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf | b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7 | `/data/local/tmp/_gguf_keep/` |

n10 used the old noextra impl + opencl `2ed2e48a`. This cell uses HEAD + `-nr` (semantically `use_extra_bufts=false`). Cross-build caveat is explicit: same *harness class* (llama-bench mmap), not the same `.so`.

## Gates

Awake at launch. MemAvailable drop ≥ 2.0 GB = abort. On-device sha of impl+opencl+stub+gguf before the cell. Raw probes archived. No SIGTERM. 10-min cap = wait for natural exit (exclude if wall≥10 min and rc=0). 15-min stall = STOP, leave process.
