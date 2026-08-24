# q44 — S23 `-ngl` sweep with live memory accounting

Accounting cell (promoted #31). **Not a speed-ship cell.** Every t/s number below is **exploratory / descriptive**. Protocol: `PREREG.md` locked at commit `2ae386ae`. Raw: `results/ngl_sweep_s23/`.

Device: SM-S911U (S23), serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, adb shell (never Termux), unplugged, start 100 % / 26.8 °C, end 96 % / 28.3 °C. Model `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf`.

## Pins

| item | value |
|---|---|
| binary dir | `/data/local/tmp/s3oracle` (#18 n5, on-device sha match) |
| llama-bench stub | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| libllama-bench-impl.so | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` |
| libggml-opencl.so | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` |
| GGUF | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` (3326160384 B) |
| threads | `-t 4` (n5 pin, verified, not guessed) |
| flags | `-nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl`; ngl>0 also `-v` |
| env | `GGML_OPENCL_LOG_ALLOC=1` (accounting payload; #18 speed cells had it unset) |
| N | **25** from `load_tensors: offloaded 1/25 layers to GPU` (`-v` ngl1 probe) |
| points | `-ngl {0, 7, 13, 19, 99}` = `{0, ceil(N/4), ceil(N/2), ceil(3N/4), 99}` |
| cpuset gate | `/` and `Cpus_allowed_list: 0-7` on every point (cell valid) |

## Per-point table

MemAvailable in kB. Peak Rss* from the 1 Hz sampler (llama-bench pid). Speed = llama-bench `avg_ts`, **exploratory**.

| ngl req | offloaded | pp512 t/s | tg128 t/s | MApre | MAmin | MApost | peak RssAnon | peak RssFile | peak VmSwap | cpuset | Cpus_allowed | batt T pre/post °C | rc |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 0 | 0/25 | 24.961 | 13.290 | 3276416 | 3240032 | 4255176 | 82608 | 3220144 | 47844 | `/` | 0-7 | 26.8 / 29.9 | 0 |
| 7 | 7/25 | 20.067 | 7.985 | 4170764 | 2363496 | 4387372 | 113140 | 2599696 | 83756 | `/` | 0-7 | 27.3 / 29.9 | 0 |
| 13 | 13/25 | 21.203 | 6.247 | 4326084 | 1665804 | 4334880 | 85592 | 3141788 | 75420 | `/` | 0-7 | 28.1 / 29.9 | 0 |
| 19 | 19/25 | 40.493 | 11.635 | 4258468 | 883008 | 4398256 | 81120 | 3053792 | 96424 | `/` | 0-7 | 28.0 / 30.3 | 0 |
| 99 | 25/25 | 68.512 | 13.218 | 4035088 | 608732 | 4835924 | 78172 | 2733868 | 73180 | `/` | 0-7 | 28.2 / 30.9 | 0 |

ngl 0 had no `offloaded X/N` line (no `-v`); offloaded recorded as 0 after N=25 from the `-v` probe. Sampler n: 37 / 47 / 61 / 48 / 44 (all ≥ 30). All cpuset captured during the live pid.

## Derived k

Prereg: `k = (MemAvailable_preload − MemAvailable_min_during) / bytes_offloaded`.

Two denominators from this cell's payload:

- **layer-frac**: `jsonl model_size * (offloaded / 25)` with `model_size = 3317921536`.
- **set-tensor**: sum of `OPENCL_SET_TENSOR{nbytes=...}` (actual GPU tensor bytes). Closest thing this cell has to "offloaded weight bytes".

`OPENCL_ALLOC` `sum_mib` is created-bytes including `try.*` staging (double-count vs live). Reported for completeness, **not** used as the primary k denominator.

| ngl | off | ΔMA MiB | layer-frac MiB | k_layer | set-tensor MiB | k_set | OPENCL sum_mib (created) | k_opencl_created |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 35.5 | 0 | n/a | 0 | n/a | 753.69 (Adreno prealloc only) | n/a |
| 7 | 7 | 1764.9 | 886.0 | **1.99** | 1014.9 | **1.74** | 5051.89 | 0.35 |
| 13 | 13 | 2597.9 | 1645.4 | **1.58** | 1810.9 | **1.43** | 8127.72 | 0.32 |
| 19 | 19 | 3296.3 | 2404.8 | **1.37** | 2602.2 | **1.27** | 11197.13 | 0.29 |
| 99 | 25 | 3346.1 | 3164.2 | **1.06** | 3179.8 | **1.05** | 13432.17 | 0.25 |

Linearity in BYTES: **fails** as a single constant. k falls as more layers go on GPU.

Denominator note (audit nit #1): the "1.7–2.0" conservative band mixes denominators —
**1.74 is k_set(ngl7), 1.99 is k_layer(ngl7)**; the band spans both conventions.
Byte-weighted pooled k_set = **1.28** (the 1.37 below is the unweighted mean; audit nit #2).

Incremental (set-tensor denominator, Δ vs previous GPU point; ngl0 drop treated as baseline noise):

| step | extra ΔMA MiB | extra set-tensor MiB | k_incremental |
|---|---:|---:|---:|
| 0 → 7 | 1729 | 1015 | 1.70 |
| 7 → 13 | 833 | 796 | 1.05 |
| 13 → 19 | 698 | 791 | 0.88 |
| 19 → 99 | 50 | 578 | 0.09 |

The last 6 layers add ~578 MiB of GPU tensors and almost no extra MemAvailable drop. A fit-gate that uses ngl99's k≈1.05 will **under-predict** the hit of the first GPU layers (k≈1.7–2.0). Honest recommendation: do **not** ship a single k from this cell; if the app needs one conservative number for "will this ngl fit", use the **high** end (~1.7–2.0 system byte per offloaded-weight byte), not the pooled mean.

Pooled mean k_set across GPU points = 1.37 (unweighted; byte-weighted = 1.28). Neither average is a model of the curve.

### Post-hoc affine reading (orchestrator fit, NOT pre-registered — n=1 sweep, single model/device)

The excess ΔMA − set_tensor per GPU point is **750.0 / 787.0 / 694.1 / 166.3 MiB**
(ngl 7/13/19/99). The three partial points sit within ±47 MiB of the ~754 MiB Adreno
prealloc observed even at ngl 0 — i.e. the partial-offload data is described almost
exactly by **cost ≈ fixed ~750 MiB + 1.0 × offloaded bytes**; full offload comes in
~580 MiB cheaper than that (pool-fill hypothesis, unproven). A conservative affine
gate `predicted = 800 MiB + 1.05 × offloaded_bytes` over-predicts (safe direction)
on all five measured points and is far tighter at full offload than a multiplicative
1.7–2.0 (which would over-predict ngl99 by ~2.3 GiB). Status: candidate estimator
for the app, to be validated on a second model/device before trusting the constants.

### `MemAvailable − RssFile` (validation series)

Sampler CSV per point (`epoch,MemAvailable_kB,...,RssFile_kB,...`). File-backed GGUF mmap (~2.6–3.2 GiB peak RssFile) does **not** show up as a MemAvailable cliff — ngl0 ΔMA is only 35.5 MiB while RssFile peaks at 3145 MiB. The cliff appears when OpenCL allocations become unreclaimable (GPU points). RssAnon stays ~80–110 MiB at every point: GPU weight copies are **not** in RssAnon. The accounting metric the app asked for is MemAvailable, not RssAnon.

## Anomalies (honest)

1. **ngl0 stderr has no `offloaded X/N` without `-v`.** First driver STOP (`cannot_parse_N`). A `-v` ngl1 probe then printed `offloaded 1/25 layers`. A second STOP was a harness bug: `N=$(probe_N)` captured `log()` stdout. Recovered by reading N from `offload_line_raw.txt`. ngl0 was **not** re-run. Remaining points used `-v`.
2. **Adreno OpenCL prealloc even at ngl 0**: `OPENCL_ALLOC` sum_mib=753.69 (`try.*` + real, ~377 MiB live) before any layer offload. Constant at every point.
3. **KGSL per-pid node not readable**: `ls: /sys/class/kgsl/kgsl-3d0/proc/<pid>/: No such file or directory` on every point. Opportunistic, not a gate. Sampler `gpumem` column is `NA`.
4. **`nproc` in the shell is 6–8 while `Cpus_allowed_list` is always `0-7`.** Gate is cpuset/`Cpus_allowed_list`, both captured. Do not use `nproc`.
5. **Cooldown wall ≫ 180 s** (`sleep 15` stretched to ~40 s by idle timer slack). Counted 180 s, wall ~8 min. Still `>= 180 s`. Not a protocol miss.
6. **SwapFree moved a lot at ngl0** (2935380 → 1811496 kB) while llama `VmSwap` peaked at 47 MiB. System-wide, not the bench rss. Later points stay in the 1.6–2.8 GiB SwapFree band.
7. **ngl0 MemAvailable_pre is ~1 GiB lower** than later points' pre (3.12 vs ~4.0–4.2 GiB). After ngl0 exits, MApost=4.06 GiB — the lower start was a colder/busier baseline, not the GPU cliff. (Audit: conclusion robust to the MApre convention — the alternative gives k_set 1.82/1.47/1.30/1.16, still monotone.)
8. **tg128 at ngl 99 (13.22 t/s) ≈ ngl 0 (13.29 t/s).** Exploratory, but it matches the #18 A/C picture: full GPU offload does not win generate on this KEXP recipe. pp512 does climb (25 → 69). Do not ship these ratios.
9. **`dumpsys battery` "Broken pipe"** once at ngl0 start in `driver.out`. `battery_pre.txt` for ngl0 is still a full dump (level 100, temp 268).
10. set-tensor n at ngl99 (1173) is **lower** than ngl19 (1376) while nbytes is higher — naming/lifetime of compute nodes, not a missing-layer bug (`offloaded 25/25` is in stderr).

## Harness

Device-side `nohup` driver under `/data/local/tmp/kalsa_q44/`. LF-only (CR=0 on device). PC only launched and polled. One llama-bench at a time. Cool-start ≤ 35.0 °C before every point (all passed on the first poll). Stop conditions not hit (model sha match, batt ≥ 96 %, temp ≤ 30.9 °C, no rc≠0).

ngl0 was the smoke: rc=0, 37 samples, then unattended remainder.

## What this cell is for

GPU fit-gate constant k is **not** a single number here. Use the per-point table and the incremental k, and treat 1.7–2.0 as the conservative "first GPU layers" factor. The live sampler series is the payload; speed is a side effect.

---

## PHASE 2 — B-prime Q8_0-trunk HTP smoke (v73)

**Class:** REGISTRA+DICHIARA (declared smoke, not a pre-registered cell). Ran after the sweep. Battery at start of phase 2: 95 % unplugged, 28.0 °C (later attempts 91 % / 25.7 °C). Floor 40 % / cool-start 35.0 °C: PASS. Nothing deleted on device.

### Pins

| item | value |
|---|---|
| dir | `/data/local/tmp/kalsahtp` (q31/v73) |
| llama-bench | `5db18906…` @ `3f545be` |
| libggml-hexagon.so | `f06aa309…` |
| libggml-htp-v73.so | `c8f9d14a…` |
| GGUF | `/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` 6509642624 B, on-device sha `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` MATCH |
| env | `GGML_HEXAGON_NDEV=1` `VERBOSE=1` **HOSTBUF unset** (v73 `run_bench_htp.sh`; HOSTBUF=1 is the test-backend-ops path and CPU-falls back quantized MUL_MAT) |

### (a) pp16/tg8 `-v` — did **not** finish

Two detached attempts (nohup, then `setsid`+nohup). Both died during `load_all_data` with same-size (196051 B), structurally identical stderr (not byte-identical — ASLR pointers differ; audit nit), **no rc**, **no stdout jsonl**, **0 `execute-op` lines**. Driver pid gone; no llama-bench left; no new tombstone. Not retried a third time.

Load-time evidence that **is** in stderr (both attempts):

```
load_tensors: offloaded 29/29 layers to GPU
load_tensors:          CPU model buffer size =  5995.65 MiB
load_tensors:   CPU_REPACK model buffer size =   157.65 MiB
load_tensors:         HTP0 model buffer size =    28.25 MiB
load_tensors:  HTP0-REPACK model buffer size =   178.50 MiB
```

`ggml-hex: HTP0 init-tensor blk.{0..27}.attn_{q,k,v,output}.weight` — Q8_0 trunk attn weights **are** placed on HTP0. The 5995 MiB CPU buffer is the Q2_K/Q3_K experts (not HTP-supported). That split is the design and it **is** visible at load. Generation never started, so there is **no** `HTP0 execute-op MUL_MAT` proof on those attn matmuls.

Likely cause: S23 8 GB vs ~6360 MiB model buffers (CPU 5995 + CPU_REPACK 158 + HTP 28 + HTP-REPACK 179) plus OS. Process disappears mid `.....` with no stderr footer → SIGKILL/LMK, not a clean rc≠0.

### (b) pp512 + tg128 — **not run**

Prereq was (a) sane (rc=0, non-garbage, HTP dispatch proven). (a) failed that gate. No exploratory t/s.

GGUF left on device for the next window. Raw: `results/htp_smoke/s23_v73_bprime/`.

