# olmoe_gpu_moe_s23 — W5 staged, NOT RUN

Speed / thermal cell: OLMoE-1B-7B-0924-Instruct Q4_K_M on S23 Adreno 740.
**Do not run until the owner says the phone is unplugged.** Scripts hard-refuse USB/AC power.

## Why noextra on BOTH arms

Stock llama-bench `use_extra_bufts=true` ARM-repacks Q4_K/Q6_K into an anonymous buffer. OLMoE is 3.92 GiB, almost all Q4_K experts — ~3.5 GiB REPACK dest, same class as the Mellum2 wall. W5 uses **`libllama-bench-impl.so` sha `d2030f23…` (W4c noextra)** for Arm A **and** Arm B so the A/B is expert placement, not extra_bufts. OpenCL `.so` stays `2ed2e48a…`. `-fa off` on every cell (W2/W4c `map::at` FA abort). `GGML_OPENCL_LOG_ALLOC` unset (timing).

## Model

| | |
|---|---|
| file | `models/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` |
| bytes | 4213513024 (3.92 GiB) |
| sha256 | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |
| arch | olmoe, 16 layers, 64 experts / 8 used |
| experts | 48 `ffn_*_exps`: 40× Q4_K + 8× Q6_K; `ne00=2048` so Adreno MoE kernels can fire |
| dump | `results/oomwall_s23/olmoe_q4km_tensors.txt` |

Device dest: `/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`. USB `R3CW406P8CV`. Not Jelly.

## ngl probe (anonymous allocations)

16 repeating layers + output. `-ngl N` = last N of those. Adreno scratch **~377 MiB** ION on first OpenCL buffer, ngl-independent.

| ngl | GPU repeating layers | notes |
|---:|---|---|
| 4 | 13–15 + output | **start here.** ~3 expert layers on GPU (Arm A). |
| 8 | 9–15 + output | next step if 4 lived and MemAvailable stayed healthy |
| 12 | 5–15 + output | |
| 16 / 99 | all repeating + output | ~file-scale GPU weights + 377 MiB scratch. **Do not jump here.** `clCreateBuffer` can still panic the device. |

CPU leftover with noextra = mmap (reclaimable). Watch MemAvailable anyway: GPU ION is unreclaimable.

## Protocol (after unplug green light)

1. `pwsh push_model.ps1` — GGUF + noextra impl, sha-verify (plugged OK).
2. Unplug. `pwsh probe_ngl.ps1 -Ngl 4` then raise only if load+16 tok lived. Writes `ngl.txt`.
3. `pwsh run_ab.ps1` — **ABBA ×2** at that ngl. Arm A: experts GPU. Arm B: `-ncmoe 99`. `-p 128 -n 128 -r 1 -fa off -t 4`. Sensors start/end: battery level, temp °C, mWakefulness, MemAvailable, MemFree → `runs.csv`.
4. If time: `pwsh run_sustain.ps1` — 4× consecutive `-p 0 -n 512` per arm (A then B). Temp curve = thermal-valve sag, not burst.

## Binary pins

| artifact | sha256 |
|---|---|
| noextra `libllama-bench-impl.so` | `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` |
| `libggml-opencl.so` | `2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87` |
| OLMoE GGUF | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |
