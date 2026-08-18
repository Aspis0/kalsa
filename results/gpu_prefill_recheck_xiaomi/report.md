# Adreno 750 GPU-prefill re-verify + squeeze

Date: 2026-08-18
Device: Xiaomi 14 (`houji` / 23127PN0CG / SM8650 / QUALCOMM Adreno(TM) 750)
Binary: on-device `/data/local/tmp/gdn_750/bin/llama-bench` (b9969-a92a51627, OpenCL). Not rebuilt.
Serial: USB `625689a2` dropped during the first smoke GPU; all measurement cells ran over wireless `adb-625689a2-9xEOfw._adb-tls-connect._tcp` of the **same** phone. S23 `R3CW406P8CV` was never addressed.
Condition: **unplugged the entire measurement window** (AC/USB/Wireless powered = false, status 3). Battery **69% → 37%**. Battery temp **31.6 °C → peak 42.8 °C → 37.8 °C** after the last cell. The device heated; numbers below are not isothermal.
Raw JSON: `results/gpu_prefill_recheck_xiaomi/cells/` (filename = config). Nothing under `results/` besides this folder was touched. Nothing committed.

No repetition was dropped. Two CPU cells are slow outliers; they stay in the tables and are called out.

---

## 1. Verdict on the 5.77×

**The GPU number is real. The 5.77× is not.**

`reports/moe-gdn-750.md` compared GPU pp128 = 181.65 t/s to CPU pp128 = 31.46 t/s. This re-run, interleaved, r=1 × 5 per ordering, unplugged:

| cell | every repetition (t/s) | mean |
|---|---|---:|
| **Order A CPU** (`-ngl 0 -t 6 -p 128 -n 0`) | 62.239, 61.927, 61.660, 57.292, 57.187 | 60.061 |
| **Order A GPU** (`-ngl 99 -fa off -t 6 -p 128 -n 0`) | 187.541, 187.594, 183.740, 183.117, 187.566 | 185.912 |
| **Order B GPU** (GPU first in each pair) | 184.767, 187.417, 188.172, 188.464, 187.287 | 187.222 |
| **Order B CPU** | 57.338, 57.212, 57.332, 57.345, 57.232 | 57.292 |
| Session-warmup GPU (labeled, first GPU of the night) | 179.653 | — |
| Pre-session smoke CPU (USB still up, first llama-bench of the night) | 62.389 | — |

- All 10 interleaved CPU: **mean 58.676 t/s** (range 57.187–62.239). None is near 31.46.
- All 10 interleaved GPU: **mean 186.567 t/s** (range 183.117–188.464). Matches the book 181.65 / samples 184.569, 178.735.
- Speedup tonight: **186.567 / 58.676 = 3.18×**, not 5.77×.
- Order A (CPU-then-GPU): 185.912 / 60.061 = **3.10×**.
- Order B (GPU-then-CPU): 187.222 / 57.292 = **3.27×**.
- Same effect in both orderings. This is not a 740-style cold-first-cell artifact.

What the 740 failure mode would have looked like: first GPU of the session inflated, later GPUs collapse toward CPU. Observed: the labeled warmup GPU is the **slowest** GPU of the night (179.653). Later GPUs sit at 183–188. The first CPUs are the **fastest** (62.4 → settle at 57.2). Opposite of the feared artifact.

The 5.77× is an artifact of a **weak CPU baseline**, not a fake GPU. Original CPU samples were internally consistent (31.763, 31.156) so that run was in a real slow state — we reproduced similar CPU dips later (pp1024 CPU rep2 = 29.501; pp2048 CPU rep1 = 18.757) once the phone was hot. That state exists. It is not the best CPU, and it is not the typical CPU. The campaign number cannot be “GPU vs a throttled/contended CPU”.

Against tonight’s best CPU at the same point (`-t 6`, first three order-A reps ~62 t/s, or the settled 57 t/s): GPU prefill is **~3.0–3.3×**, and it is repeatable.

### Decode (not disputed; 2 interleaved pairs)

llama-bench `-p 128 -n 256 -r 1` (JSON has two tests; both shown):

| cell | pp128 | tg256 |
|---|---:|---:|
| CPU rep1 | 57.221 | **26.968** |
| GPU rep1 | 188.466 | **17.413** |
| GPU rep2 | 189.079 | **17.514** |
| CPU rep2 | 57.163 | **26.039** |

Decode GPU/CPU = 17.46 / 26.50 = **0.66×**. Still a loss. Original 7.07 vs 16.15 (0.44×) is the same qualitative result; tonight both sides are faster, GPU decode especially (17.5 vs book 7.07). Gate ≥1.15× still FAIL.

### Battery / thermal across Part 1

Unplugged the whole time. Battery 69% → 67%. Battery temp 31.6 → 35.1 °C. `dumpsys thermalservice` CPU0/GPU0/skin values were **stuck** at 73.0 / 58.8 / 37.903 for every cell — cached, not live. Do not use them. Battery `temperature:` is the only number that moved.

---

## 2. pp-length curve (the product question)

Same known-good pair, interleaved CPU/GPU, r=3 per length. Qwen3.5-2B Q4_K_M, `-t 6`, GPU `-ngl 99 -fa off`, default `-b 2048 -ub 512`.

### 2B — every rep

| pp | CPU reps (t/s) | CPU mean | GPU reps (t/s) | GPU mean | GPU/CPU |
|---:|---|---:|---|---:|---:|
| 128 | 62.239, 61.927, 61.660, 57.292, 57.187, 57.338, 57.212, 57.332, 57.345, 57.232 | 58.676 | 187.541, 187.594, 183.740, 183.117, 187.566, 184.767, 187.417, 188.172, 188.464, 187.287 | 186.567 | **3.18×** |
| 512 | 54.903, 53.642, 53.553 | 54.033 | 208.597, 217.710, 214.247 | 213.518 | **3.95×** |
| 1024 | 46.050, **29.501**, 45.967 | 40.506 (median 45.967) | 216.834, 216.686, 216.580 | 216.700 | **5.35×** (4.71× vs median CPU) |
| 2048 | **18.757**, 38.239, 37.806 | 31.601 (median 37.806) | 212.196, 209.786, 211.781 | 211.255 | **6.69×** (5.56× vs median CPU) |

pp1024 CPU 29.501 and pp2048 CPU 18.757 are **not dropped**. They happened at battery temp 38.5 °C and 39.7 °C. GPU next to them stayed 216.7 and 212.2. CPU is thermally fragile; GPU prefill is not.

### 4B — every rep (model fits)

| pp | CPU reps (t/s) | CPU mean | GPU reps (t/s) | GPU mean | GPU/CPU |
|---:|---|---:|---|---:|---:|
| 128 | 18.498, 18.520, 18.476 | 18.498 | 76.857, 76.891, 77.908 | 77.219 | **4.17×** |
| 512 | 16.631, 15.296, 14.931 | 15.619 | 88.789, 89.205, 89.077 | 89.024 | **5.70×** |
| 1024 | 11.331, 13.291, 13.542 | 12.722 | 88.335, 88.348, 88.435 | 88.373 | **6.95×** |
| 2048 | 13.308, 13.369, 13.308 | 13.328 | 85.950, 86.321, 86.201 | 86.157 | **6.46×** |

### What this means for a ~1.4k-token system prompt

GPU advantage **grows from 128 to 1024 and holds at 2048**. It does not collapse.

Linear interpolate 1024→2048 at 1400 tokens:

| model | GPU t/s (interp.) | best-CPU t/s (interp., 2B uses medians) | TTFT 1400 tok GPU | TTFT 1400 tok CPU |
|---|---:|---:|---:|---:|
| Qwen3.5-2B Q4_K_M | ~215 | ~43 | **~6.5 s** | **~33 s** |
| Qwen3.5-4B Q4_K_M | ~87.6 | ~12.9 | **~16 s** | **~108 s** |

The book’s “prefill is the lever” stands. The book’s 5.77× at pp128 overstates the ratio against a healthy CPU; at the **actual operating point** the ratio is **larger**, because CPU throughput falls with length and heat while GPU stays in a 210–217 (2B) / 86–89 (4B) band.

---

## 3. Best configuration found

Squeezing one knob at a time from the known-good point, all at **2B pp1024** unless noted. Default cell (already measured in the curve): `-ngl 99 -fa off -t 6 -b 2048 -ub 512` = 216.834 / 216.686 / 216.580.

| knob | reps (t/s) | mean | vs default 216.7 |
|---|---|---:|---|
| `-ngl 8 -fa off` | 53.838, 53.809 | 53.823 | much worse (≈ CPU) |
| `-ngl 16 -fa off` | 89.760, 89.303 | 89.531 | worse |
| `-ngl 24 -fa off` | 198.271, 202.386 | 200.329 | close; model has a bit more than 24 layers |
| `-ngl 99` (full) | 216.834, 216.686, 216.580 | **216.700** | **best ngl** |
| `-fa on` | **EXIT 134**, empty JSON | — | dead, see §4 |
| `-ub 128` | 193.075, 193.158 | 193.116 | worse |
| `-ub 256` | 208.164, 209.329 | 208.746 | worse |
| `-ub 512` (default) | (curve) | **216.700** | **best ub** |
| `-ub 1024` | 214.556, 215.460 | 215.008 | slightly worse |
| `-b 512 -ub 512` | 214.561, 214.603 | 214.582 | slightly worse |
| GPU `-t 4` | 217.191, 217.035 | **217.113** | +0.4 t/s, noise |
| GPU `-t 8` | 216.188, 217.370 | 216.779 | noise |
| CPU `-t 4` pp1024 | 28.190, 28.278 | 28.234 | worse than `-t 6` |
| CPU `-t 8` pp1024 | 28.676, 38.166 | 33.421 | worse than `-t 6` |

4B ubatch at pp1024 (default ub512 = 88.373):

| knob | reps | mean |
|---|---|---:|
| `-ub 1024` | 87.486, 87.474 | 87.480 |
| `-ub 256` | 86.085, 86.088 | 86.086 |

Default `-ub 512` wins on both models. Full offload wins. FA-on is not a config. Threads on GPU do not matter.

### Best GPU (2B, product-relevant)

There is no real squeeze past the original cell. Highest mean at pp1024 is `-t 4` at 217.113 vs `-t 6` at 216.700. Call it a tie; keep `-t 6` as the documented point.

```
export LD_LIBRARY_PATH=/data/local/tmp/gdn_750/bin:/vendor/lib64:/system/vendor/lib64
/data/local/tmp/gdn_750/bin/llama-bench \
  -m /data/local/tmp/gdn_750/Qwen3.5-2B-Q4_K_M.gguf \
  -t 6 -ngl 99 -fa off -b 2048 -ub 512 \
  -p 1024 -n 0 -r 1 -o json
```

Measured: **216.700 t/s mean** (216.834, 216.686, 216.580).

Best CPU at the same length: `-t 6 -ngl 0` = 46.050 / 29.501 / 45.967. Against the two healthy reps (mean 46.008): **216.700 / 46.008 = 4.71×**. Against all three (mean 40.506): 5.35×. Do **not** cite 5.35× as the campaign number; the 29.501 is a heat dip.

### Best GPU (4B, the more interesting slot)

4B Q4_K_M **fits** and runs. Same flags.

```
/data/local/tmp/gdn_750/bin/llama-bench \
  -m /data/local/tmp/gdn_750/Qwen3.5-4B-Q4_K_M.gguf \
  -t 6 -ngl 99 -fa off -b 2048 -ub 512 \
  -p 1024 -n 0 -r 1 -o json
```

Measured: **88.373 t/s mean** (88.335, 88.348, 88.435) vs best CPU 12.722 → **6.95×**. At 1400 tokens this is the number that matters for the 4B product slot: ~16 s GPU prefill vs ~108 s CPU.

Peak 4B GPU in this run: pp512 mean **89.024 t/s**.

---

## 4. Where the device disagrees with the brief / the book

1. **5.77× is the wrong ratio.** GPU ~182–187 t/s is confirmed. CPU 31.46 is a slow-state baseline, not the best CPU and not tonight’s typical CPU (~58 t/s at pp128, ~46 t/s at pp1024 when not dipped). Honest pp128 speedup is **~3.2×**. Honest pp1024 speedup vs best CPU is **~4.7×**. At 1.4k the ratio is larger still because CPU falls.
2. **Original CPU 31 t/s and original GPU-decode 7.07 t/s are both slower than this phone tonight.** GPU prefill is the one number that replicated. Something about the 2026-08-13 session (100% pack after a 45 min AC wait, then unplug) left CPU — and GPU decode — in a hole that this session did not start in. We did re-enter a ~30 t/s CPU hole once the pack hit ~39 °C.
3. **`-fa on` is still dead.** Exit 134. Raw stderr, nothing omitted:
   ```
   ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'
   ggml_opencl: device: 'QUALCOMM Adreno(TM) 750 (OpenCL 3.0 Adreno(TM) 750)'
   ggml_opencl: default device: 'QUALCOMM Adreno(TM) 750 (OpenCL 3.0 Adreno(TM) 750)'
   libc++abi: terminating due to uncaught exception of type std::out_of_range: map::at:  key not found
   Aborted
   ```
   This session did **not** reprint the `sub_group_shuffle_xor` / `clBuildProgram err=-11` lines from `moe-gdn-750.md` §3.1; it jumped straight to the `map::at` abort. Same failure class, shorter log. JSON is empty. Do not turn FA on.
4. **USB serial `625689a2` is not a stable handle.** It vanished after the first smoke. Wireless of the same device is what the original 750 writeup actually used. The S23 wireless node was listed the whole time and was not touched.
5. **`dumpsys thermalservice` is a lie on this unit tonight** (cached CPU0=73.0 / GPU0=58.8 / skin=37.903 on every cell). Battery `temperature:` is the live signal: 316 → 428 (31.6 → 42.8 °C) across the campaign.
6. **Partial offload is not “almost as good” until you are nearly at full.** ngl 8 ≈ CPU. ngl 16 ≈ 2× CPU. ngl 24 ≈ 200 t/s (93% of full). Full offload is the right product setting.
7. **ubatch/batch are not a hidden 2×.** Default 512/2048 is already the top of the local hill. ub 128 costs ~11%. The original measurement was not leaving throughput on the table.
8. **4B is not hypothetical.** It prefills at 86–89 t/s on this 750 with `-ngl 99 -fa off`. That is the product-slot number.

### Smoke GPU that failed (not silent)

First GPU invocation was launched over USB `625689a2` and produced an empty JSON because that adb session died when the cable/AC dropped. File kept: `cells/smoke_2b_gpu_ngl99_faoff_t6_pp128.json` (0 bytes). Not used in any mean. The next GPU (wireless, labeled warmup) is 179.653.

### Exact Part 1 command (one cell)

```
export LD_LIBRARY_PATH=/data/local/tmp/gdn_750/bin:/vendor/lib64:/system/vendor/lib64
/data/local/tmp/gdn_750/bin/llama-bench \
  -m /data/local/tmp/gdn_750/Qwen3.5-2B-Q4_K_M.gguf \
  -t 6 -ngl 0 -p 128 -n 0 -r 1 -o json
# interleaved with
/data/local/tmp/gdn_750/bin/llama-bench \
  -m /data/local/tmp/gdn_750/Qwen3.5-2B-Q4_K_M.gguf \
  -t 6 -ngl 99 -fa off -p 128 -n 0 -r 1 -o json
```

Runners on device: `/data/local/tmp/gdn_750/recheck/run_part1.sh`, `run_part2.sh` (also copied under `results/gpu_prefill_recheck_xiaomi/`).

---

## Bottom line

- Prefill GPU on Adreno 750 is **real and large**. ~187 t/s at pp128 2B, **~217 t/s at pp1024 2B**, **~88 t/s at pp1024 4B**.
- The campaign 5.77× is **an artifact of a 31 t/s CPU baseline**. Against the best CPU this phone actually produced: **~3.2× at 128**, **~4.7× at 1024**, and **~5.5× at 2048** (2B, medians). 4B is **4.2× / 5.7× / 7.0× / 6.5×** at 128/512/1024/2048.
- For a 1.4k system prompt, use GPU prefill. 2B ≈ 6.5 s vs ≈ 33 s CPU. 4B ≈ 16 s vs ≈ 108 s CPU. 4B fits.
- Decode GPU still loses (0.66×). Do not offload decode.
- Do not turn FA on. Do not half-offload. Do not chase `-ub`/`-b`/`-t` — the original flags were already the top.
