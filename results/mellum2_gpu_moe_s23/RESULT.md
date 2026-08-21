# EXPLORATORY RESULT — Mellum2 GPU-resident vs CPU-resident experts (S23)

**EXPLORATORY. Not a ship cell.** n=0 completed speed runs.

## Verdict

**BLOCKED_DRIVER.** The Adreno 740 GPU-MoE path on this 8 GB S23 hits a **driver/kernel-level wall well before userspace OOM**, and well before a tok/s number.

Two independent hard reboots, both Arm A (GPU-resident experts), both after OpenCL selected the device and before any `pp`/`tg` row:

| attempt | ngl | wall clock to death | MemAvailable | bootreason |
|---|---:|---|---|---|
| 1 (original probe) | 8 | ~15 s | stayed 3.5–4.8 GB, truncated high | `reboot` |
| 2 (authorized retry) | 2 | ~28 s | cliff 4.7 GB → **450 MB**, then reboot | `reboot` |

Arm B (`-ngl N -ncmoe 99`) was **never started**. A vs B tok/s is **not measured**. Thermal cost of a completed decode is **not measured**. llama-cli sanity not run.

HARD STOP (a) fired: **second reboot at any `-ngl` → cell terminated permanently. No further GPU-experts config tonight.**

This is publishable context, not just a lab mishap: **the K2-fixed kernels being numerically correct (391/391 MUL_MAT_ID) does not imply the production OpenCL MoE path is loadable on an 8 GB A740 at 12B-Q4_K_M scale.**

## Authorized retry — what we verified first

Phone came back healthy after reboot 1 (uptime 4 min, load settling). Re-sha:

- `libggml-opencl.so` = `a09ef68f6e4e0f8d0f778c9e4c9310780d57fbd4f891ff366dff49a7a7e502da` (match)
- GGUF `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` (match, 8071293600 B)

Unplugged (AC/USB/Wireless false, status 3, level 99). Temp 30.8 °C. Then `-ngl 2` Arm A `tg64` (`-p 0 -n 64 -r 1 -t 4`).

## What ran vs intended

| | intended | actual |
|---|---|---|
| Model | Mellum2-12B-A2.5B-Instruct Q4_K_M, q4_K experts | pushed + sha-verified |
| Binary | llama-bench `c1bb48d32` + `.so` `a09ef68f` | yes |
| N | highest safe, same both arms | **8 reboots. 2 reboots.** No safe N found. |
| Protocol | ABBA, 2 reps/arm, pp128+tg128 | **0/4**. Retry was tg64-only and died in load. |
| Unplug | required | yes, both attempts |
| Screen | constant | probe1 `Dozing`; retry `Awake` (post-reboot). Recorded. |

## Numbers

- A vs B **decode tok/s:** NA / NA
- A vs B **prefill tok/s:** NA / NA
- stderr both crashes: **209 B**, identical 3-line OpenCL device banner. No kernel names. No CSV.
- ngl=2 mem poll (1 Hz, 28 samples): start 4111 MB → reclaim to ~4843 MB → **monotonic cliff** 4736→450 MB over ~12 s → reboot. Userspace LMK would have killed `llama-bench`; the **kernel rebooted** instead. Low RAM is a trigger candidate, not a userspace-OOM verdict.
- ngl=8 mem poll never reached that cliff (died earlier, RAM still ~4.6 GB) → **8-layer GPU-expert alloc can kill the driver without exhausting MemAvailable.**
- Temps: probe1 start 30.1 °C; after reboot1 34.1 °C; retry start 31.3 °C; after reboot2 **36.4 °C**. Never crossed the 40 °C stop. Level 100→98.

## Expert override (tree, unused)

llama-bench at `c1bb48d32` has `-ncmoe/--n-cpu-moe N` (`blk.{i}\.ffn_(up\|down\|gate\|gate_up)_(ch\|)exps` → CPU) and `-ot/--override-tensor`. Arm B would have been `-ngl 2 -ncmoe 99`. Not executed.

## Open follow-up (not tonight)

Proper investigation needs a **smaller q4_K MoE GGUF (2–4 GB class)** on this same device + same `.so`, to separate:

1. **GPU MoE inherently reboots the A740 driver** (even a tiny expert offload), vs
2. **12B-scale allocation** (7.5 GiB mmap + GPU buffers on 8 GB shared RAM) is what trips the kernel.

`-ngl 1` was **not** tried after the second reboot (HARD STOP). CPU-only (`-ngl 0`) was not in scope; it would not exercise the fixed kernels.

## Caveats

- Exploratory. Plugged-history of the evening: USB 85→100 % until ~23:01, then unplug.
- Wireless adb died with each reboot (TLS port 42645 → 34909).
- Kernel comments / 391/391 remain the correctness story. This cell is **loadability**, not NMSE.

## Artifacts

`results/mellum2_gpu_moe_s23/` — `MANIFEST.md`, `runs.csv`, `probe_ngl8.*`, `ngl2_A1.{pre,err,csv,mem_poll}`, `run_ngl2.sh`.

DONE
