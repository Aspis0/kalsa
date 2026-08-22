# Session #16 — Xiaomi 14 / Adreno 750 kernel transfer

**Date:** 2026-08-22
**Device:** Xiaomi 14 ("houji"), Adreno 750, SM8650
**Serial:** `adb-625689a2-9xEOfw._adb-tls-connect._tcp`
**Work dir (device):** `/data/local/tmp/kalsa16`
**Build tree:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-s3oracle`
**Engine:** `BigMoeOnEdge\third_party\llama.cpp`, branch `kalsa/kernel-s3-repack`
**Expected HEAD:** `1882bf8cd` — DO NOT checkout/reset/modify
**Other device (DO NOT TOUCH):** `adb-R3CW406P8CV...` (SM_S911U / S23)

Status: **COMPLETE** (continuation banked). MUL_MAT_ID 407/407; f16 cluster deterministic fails / non-identical ERR; CPU `-nr` triplet; Doze control. Engine not modified. No git commit/push.

---

## Environment verification

| Item | Value |
|------|-------|
| llama.cpp HEAD (verified) | `1882bf8cd99659246f4ddecb99c268669d7bb3c9` (`git log -1` in `BigMoeOnEdge/third_party/llama.cpp`; **matches expected prefix `1882bf8cd`**) |
| llama.cpp branch | `kalsa/kernel-s3-repack` |
| llama.cpp remotes | **none** (empty `git remote -v`; not touched) |
| CMake ggml commit | `1882bf8cd` |
| Build ninja result | Full `ninja -C build-android-opencl-s3oracle` **FAILED** at `[50/237]` `tests/test-chat.cpp`: `#include "mtmd.h"` not found. **Did not modify engine.** Targeted `ninja test-backend-ops llama-bench` **OK** `[7/7]` after OpenCL re-link. |
| Battery at session start | **98%**, USB/AC/Wireless **false**, temp **33.9 °C** (`dumpsys battery temperature: 339`), status 3 (discharging). Floor 40%. |
| Device identity | `houji` / `23127PN0CG` / platform `pineapple` (SM8650) |
| Device cpuset | `0-7` |
| Device work dir created | `/data/local/tmp/kalsa16` yes |
| Free space `/data` | 314G avail / 482G (`df -h /data`) |
| Other device | `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM_S911U **not touched** |

---

## Phase (a) — correctness: `test-backend-ops` on Adreno 750

Status: **MUL_MAT 905/925 FAIL (f16/bf16 dense); MUL_MAT_ID 407/407 PASS after unblock.** Raw: `results/xiaomi750_validation/raw/a/`.

### SHA256 pairs (PC vs on-device)

All 9 files match. Recorded **before** `test-backend-ops` launch.

| Binary | SHA256 | Match |
|--------|--------|-------|
| test-backend-ops | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | YES |
| llama-bench (stub) | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | YES (same stub pin as S23 kexp n5) |
| libllama-bench-impl.so | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` | YES (same impl pin as S23 kexp n5) |
| libggml-opencl.so | `0154b01db52b48bc7d75da55e9949ac13131972c97fbfc78158e5c489f116083` | YES (HEAD 1882bf8cd; **not** S23 n5 pin `f4325483…`) |
| libggml-base.so | `8aa74499f1fea39bfbcb32f729f7904a2b1b98622af2c628f4a6cc017238ba59` | YES |
| libggml-cpu.so | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | YES |
| libggml.so | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | YES |
| libllama.so | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | YES |
| libllama-common.so | `5370b18b8354aa45af1b8bdf7dc67a98c17768bfb8d89c5d3bab8cd41161e270` | YES |
| libomp.so (NDK 27.1 aarch64) | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | YES (required; first exec died without it) |
| libc++_shared.so (NDK 27.1 aarch64) | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | YES |

### OpenCL driver/compiler version

**CRITICAL DATUM (verbatim from `MUL_MAT.err` while GPUOpenCL cases were running):**

```
ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'
ggml_opencl: device: 'QUALCOMM Adreno(TM) 750 (OpenCL 3.0 Adreno(TM) 750)'
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25
```

- S23 (Adreno 740) reference: `E031.41.03.62`
- Xiaomi 14 (Adreno 750): **`E031.45.02.25`** (QUALCOMM build `0762.36.1`)
- Same A7X family, **newer compiler** than 740 (`41.03.62` → `45.02.25`).

Other OpenCL facts from the same banner: global mem 5584 MB, max alloc 1024 MB, FP16 true, subgroup shuffle true, vector subgroup broadcast **false**, SVM coarse+fine buffer true, `GGML_OPENCL_SOA_Q` flattening on, Adreno kernels on, `program_cvt variant=bytewise`.

### Results

| Op | Expected (740) | Observed (750) | Log |
|----|----------------|----------------|-----|
| `MUL_MAT` | 925/925 | **905/925 FAIL** (`GPUOpenCL`; rc=1) | `raw/a/MUL_MAT.out` + `MUL_MAT.FAIL_CASES.txt` |
| `MUL_MAT_ID` | 407/407 | **407/407 PASS** (rc=0, wall 277 s). 401 `not supported` (f16/bf16 etc.) not counted. | `raw/a/MUL_MAT_ID.*` |

### Failures — PROMINENT

**20/925 cases FAIL on Adreno 750.** All 20 are one cluster. 740 expected 925/925. **No fixes attempted.**

| Field | Value |
|-------|-------|
| Pass | 905 OK |
| Fail | 20 FAIL (plus 2 summary `FAIL` lines) |
| Total named cases | **925** (same count as 740) |
| First dump | `[MUL_MAT] ERR = 0.100341672 > 0.000500000` — not epsilon. Some element diffs ~50. |
| Cluster | `type_a=f16\|bf16`, `type_b=f32`, **`m=128 n=1 k=1056 k_v=2112 o=1`**, permute `[0,1,2,3]`, various `bs`/`nr` |

Failing case names (verbatim):

```
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[2,1],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[2,1],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[4,1],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[4,1],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[8,1],nr=[1,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[8,1],nr=[1,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[8,1],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[8,1],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[1,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[1,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[2,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[2,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[4,3],nr=[1,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[4,3],nr=[1,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[4,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[4,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[8,3],nr=[1,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[8,3],nr=[1,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=f16,type_b=f32,m=128,n=1,k=1056,bs=[8,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
MUL_MAT(type_a=bf16,type_b=f32,m=128,n=1,k=1056,bs=[8,3],nr=[4,1],per=[0,1,2,3],k_v=2112,o=1)
```

Quantized / other dense shapes in the 905: **OK**. Failures are **f16/bf16 GEMV with k=1056 and k_v=2112** (looks like a concatenated-K path). Compiler `E031.45.02.25` vs 740 `E031.41.03.62` is the transfer-risk.

### Phase (a) notes (not failures)

- Registered backend name is **`GPUOpenCL`**, not `OpenCL`. Literal `-b OpenCL` skipped all tests (`2/2 backends passed` with 0 cases). Re-ran with `-b GPUOpenCL`.
- Toybox `taskset -c 0-7` rejected; used `taskset ff` (cpus 0-7).
- First link failed: missing `libomp.so` + `libc++_shared.so` (NDK 27.1 aarch64). Pushed; sha in `raw/a/sha256_runtime_libs_pc.txt`.
- Full-tree ninja died on unrelated `test-chat.cpp` / `mtmd.h`. Targeted ninja of the two bins succeeded. Engine not modified.

---

## Phase (b) — A/B/C speed table (fits-in-RAM MoE)

Status: **DONE** (9/9 cells rc=0). Model: LFM2.5-8B-A1B-KEXP.gguf sha `b07c8087…` (PC=device=prereg). `-nr -fa off -t 4 -p 128 -n 128 -r 1`. `no_repack=true` in every jsonl. `build_commit=1882bf8cd`.

### Arm definitions (from S23 prereg `PREREG_KEXP_N5.md` v1.2)

**`-nr` (`--no-repack`) MANDATORY on all three arms.** Also `-fa off -t 4`. LOG_ALLOC unset.

S23 ship cell used tg512 (`-p 0 -n 512 -r 1`). This session is the **QUICK** variant: **tg128 + pp128** (`-p 128 -n 128 -r 1`), N=3 cells/arm, order `ABC CBA ABC`, 90s cooldown.

| Arm | Meaning | llama-bench flags (plus `-nr -fa off -t 4 -p 128 -n 128 -r 1`) |
|-----|---------|-------|
| A | full GPU offload incl. experts | `-ngl 99` |
| B | trunk GPU / experts CPU | `-ngl 99 -ncmoe 99` |
| C | pure CPU | `-ngl 0` |

S23 n5 verdict to test on 750 (tg512, N=10/arm): **C fastest** (17.553), **B worst** (7.904), **A = cool-mode** (14.252, A/B 1.803, A/C 0.812). Source: `results/kexp_speed_s23/n5/REPORT.md`.

### Model selection

| Item | Value |
|------|-------|
| Device GGUFs found | Qwen3.5-2B 1.1G; Qwen3.5-4B 2.5G; Qwen3.6-35B-A3B-KEXP 13G; Marco-Mini-KEXP 5.9G; Mellum2 7.5G. No LFM, no OLMoE. |
| PC GGUFs considered | `models/LFM2.5-8B-A1B-KEXP.gguf` (prereg), OLMoE-1B-7B Q4_K_M 4.0G, Marco KEXP 6.0G |
| Chosen model | **LFM2.5-8B-A1B-KEXP.gguf** (same as S23 prereg; 3.17G fits 11.4G RAM) |
| Free space `/data` before push | 314G |
| Pushed? | YES, 15.1 MB/s, 210 s, to `/data/local/tmp/kalsa16/` |
| GGUF sha PC = device = prereg | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` YES |
| llama-bench SHA256 PC=device | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| impl / opencl SHA256 | `8adc148c…` / `0154b01d…` (every cell) |

### Cell order

`ABC CBA ABC` (N=3 per arm), tg128 + pp128, 90s cooldown, temps recorded.

### Results table

jsonl `avg_ts`. Order ABC CBA ABC. All cells `wake_pre=Awake`, **`wake_post=Dozing`** (Xiaomi ignored 15 min timeout; recorded, not excluded in this quick table). Battery 98% throughout. SHA impl `8adc148c…` / opencl `0154b01d…` before every cell.

| cell | arm | tg128 | pp128 | batt T pre→post °C | quiet_therm pre→post (mC) | gpuss-0 pre→post (mC) | wall s |
|------|-----|------:|------:|--------------------|---------------------------|-----------------------|-------:|
| c01 | A | 17.062 | 87.068 | 32.7→32.4 | 34464→36357 | 35500→41000 | 38.1 |
| c02 | B | 8.181 | 42.532 | 32.8→33.2 | 34498→36464 | 35900→39400 | 52.4 |
| c03 | C | 24.250 | 40.260 | 32.8→32.5 | 34641→36870 | 35500→46900 | 12.8 |
| c04 | C | 24.275 | 39.553 | 32.8→32.6 | 34777→37151 | 35900→47700 | 13.1 |
| c05 | B | 7.401 | 40.629 | 33.2→33.0 | 34936→36511 | 36300→40600 | 49.5 |
| c06 | A | 24.931 | 87.769 | 32.8→33.1 | 34710→36735 | 35500→43800 | 29.3 |
| c07 | A | 24.471 | 87.424 | 32.9→33.0 | 34877→36723 | 36700→44200 | 31.0 |
| c08 | B | 6.954 | 32.760 | 33.1→33.2 | 34936→36505 | 35900→39000 | 62.7 |
| c09 | C | 24.364 | 39.514 | 32.9→33.1 | 34936→37230 | 35900→46900 | 13.0 |

c01_A tg **17.062** is an outlier vs later A (24.47 / 24.93) — first GPU cell, likely OpenCL kernel compile / first-touch. **Kept in the median** (not dropped).

### Medians vs S23 verdict

S23 n5 (tg512, N=10): **C fastest 17.553, B worst 7.904, A cool-mode 14.252** (A/B 1.803, A/C 0.812).

This session (tg128+pp128, N=3, **full precision, display 3 dp**):

| Arm | tg128 median | pp128 median | vs S23 |
|-----|--------------:|--------------:|--------|
| A | **24.471** (17.062, 24.471, 24.931) | **87.424** (87.068, 87.424, 87.769) | tg A/C = 1.008 (S23 0.812) |
| B | **7.401** (6.954, 7.401, 8.181) | **40.629** (32.760, 40.629, 42.532) | tg A/B = 3.307 (S23 1.803) |
| C | **24.275** (24.250, 24.275, 24.364) | **39.553** (39.514, 39.553, 40.260) | C tg extremely stable |

**Does the S23 verdict hold on 750?**

- **B worst: YES** (tg 7.401 vs A 24.471 / C 24.275). Same qualitative hole (experts-on-CPU + trunk-on-GPU).
- **C fastest: NO, not clearly.** tg median C 24.275 vs A 24.471 — **A slightly faster** on this N=3 tg128 bag. C is the stable one; A has a compile-tax first cell. If c01_A were dropped (it is not), A would be ~24.7. Either way this is **not** S23's A/C=0.812.
- **A = cool-mode: mixed.** Battery temp all arms ~32.4–33.2 °C. GPU `gpuss-0` post: A 41.0–44.2 °C, B 39.0–40.6, C 46.9–47.7 (C is ngl=0 so GPU zone is not the workload). quiet_therm similar across arms.

pp128 is a different story: **A 87.4 vs C 39.6 (2.21×)** — GPU prefill wins hard on this MoE; that was not the S23 tg512 headline.

---

## Phase (c) — dense prefill re-check (fixed kernels)

Status: **DONE** (4/4 original + 2/2 CPU `-nr` continuation, all rc=0). Model already on device: `/data/local/tmp/gdn_750/Qwen3.5-2B-Q4_K_M.gguf` sha **`aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`**. Original CPU arm: `-t 6 -fa off -ngl 0` (`no_repack=false`). Continuation CPU arm: same plus **`-nr`** (`no_repack=true`). SHA impl/opencl recorded before every cell.

Historical (12/08, VANILLA OpenCL, pre-fix): Xiaomi 750 GPU pp128 **181.652** vs CPU **31.459** (**5.77×**) ; pp512 GPU **214.485** vs CPU **35.937** (**5.97×**). Source `results/xiaomi_ab/curve_table.md`.

HEAD `1882bf8cd` (llama-bench `avg_ts` of 3 reps; also median of the 3 samples):

| Condition | pp128 avg_ts (samples) | pp128 median | pp512 avg_ts (samples) | pp512 median | batt T pre→post |
|-----------|------------------------|--------------|------------------------|--------------|-----------------|
| GPU `-ngl 99` (`no_repack=false`) | **181.501** (180.979, 182.477, 181.046) | 181.046 | **212.111** (206.892, 214.370, 215.072) | 214.370 | 32.9→32.3 / 32.6→32.4 |
| CPU `-ngl 0` repack ON | **126.656** (122.014, 134.991, 122.963) | 122.963 | **122.496** (118.119, 126.695, 122.675) | 122.675 | 32.3→32.5 / 32.4→32.8 |
| CPU `-ngl 0 -nr` (continuation) | **69.415** (66.801, 70.300, 71.142) | 70.300 | **66.724** (67.374, 67.562, 65.236) | 67.374 | batt 95%, 31.9→32.6 °C |
| GPU / CPU-repack | **1.433×** | | **1.732×** | | |
| GPU / CPU-norepack | **2.615×** | | **3.179×** | | vs hist 5.77× / 5.97× |

**Does the 5.77× prefill advantage survive the kernel stack?**

- **GPU kernel throughput: YES, essentially identical.** pp128 181.501 vs hist 181.652 (**0.999×**). pp512 212.111 vs hist 214.485 (**0.989×**).
- **The 5.77× ratio: NO**, even apples-to-apples `-nr`. GPU/CPU-norepack is **2.615×** (pp128) / **3.179×** (pp512). CPU `-nr` is still **2.21×** the August 31.5 (69.4 vs 31.5) — HEAD CPU kernels, not just extra_bufts. CPU-repack is another 1.83× on top of `-nr` (126.7 / 69.4).
- Historical 5.77× used a slower CPU baseline. GPU did not regress.

---

## Battery / thermal log

| When | Battery % | Temp (battery) | Skin/thermal | Action |
|------|-----------|----------------|--------------|--------|
| session start | 98 | 33.9 °C | dumpsys 339; quiet_therm later ~34 °C | unplugged, proceed |
| after phase a | 98 | 33.1 °C | MemAvailable 5.85 GB (was 1.68 GB during MUL_MAT) | unplugged, proceed to (b) |
| after phase b | 98 | 33.1 °C | quiet ~35 °C | unplugged, proceed to (c) |
| after phase c | 96 | 33.5 °C | still unplugged | then continuation |
| after MUL_MAT_ID | 96 | 32.9 °C | unplugged | 407/407 |
| after CPU `-nr` | 95 | 32.6 °C | unplugged | |
| after Doze control | 94 | 32.6 °C | unplugged | session complete |

Floor: **40%**. Unplugged throughout (speed session).

---

## Gaps / exclusions (verbatim)

- ~~MUL_MAT_ID not run~~ **Superseded:** MUL_MAT_ID **407/407 PASS**.
- Literal `-b OpenCL` is a no-op on this binary (backend registered as `GPUOpenCL`).
- Full ninja of the Android tree fails on `test-chat.cpp` missing `mtmd.h` (unrelated; engine not patched).
- Device GGUFs at session start: `Qwen3.5-2B-Q4_K_M.gguf` (1.1G, used in c), `Qwen3.5-4B-Q4_K_M.gguf` (2.5G, unused), `Qwen3.6-35B-A3B-KEXP.gguf` (13G, does not fit 11.4G RAM), `Marco-Mini-Instruct-KEXP.gguf` (5.9G, unused), `Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` (7.5G, unused). **LFM2.5-8B-A1B-KEXP was not on device** — pushed from PC `models/LFM2.5-8B-A1B-KEXP.gguf` (3.17G, sha `b07c8087…` = prereg). OLMoE Q4_K_M is on PC (4.0G) not on device; not used.
- S23 serial present on adb (`adb-R3CW406P8CV…`); **never used**.
- Phase (b) every cell `wake_post=Dozing` despite `screen_off_timeout=900000`. Launch was Awake. Numbers kept (quick table, not the n5 ship protocol).
- Phase (c) first CPU arm is HEAD default (`no_repack=false`). Continuation added `-nr` (does not restore hist 31.5 t/s).
- Phase (c) used `-r 3` not historical `-r 2`.
- Doze control: KEYCODE_WAKEUP at launch is not enough to keep houji Awake through an 18 s cell (`wake_post=Dozing`).

---

## Continuation (unblocked) — MUL_MAT_ID + f16 isolation + CPU-norepack

Owner note: the 20 MUL_MAT FAILs are f16/bf16 **dense** (upstream), not our MoE kernels. Phase (a) stop lifted for MUL_MAT_ID.

### 1. MUL_MAT_ID on Adreno 750

Status: **DONE — 407/407 PASS** (rc=0, wall 277 s). Matches 740. SHA pre-run identical (`test-backend-ops 9a3fd4b0…`, `libggml-opencl 0154b01d…`). Battery 96%, 32.9 °C, unplugged. Log: `407/407 tests passed` / `Backend OpenCL: OK`. 401 `not supported` (f16/bf16 etc.) excluded from the 407.

OK by `type_a` — **our MoE kernels all pass, 0 FAIL:**

| type_a | n OK |
|--------|-----:|
| q4_K | 82 |
| q4_1 | 75 |
| q8_0 | 75 |
| q4_0 | 74 |
| mxfp4 | 74 |
| q5_K | 6 |
| q2_K | 5 |
| q3_K | 5 |
| q6_K | 5 |
| q5_0 | 3 |
| q5_1 | 3 |
| **total tested** | **407** |
| FAIL | **0** |

### 2. f16/bf16 cluster isolation (deterministic?)

Status: **DONE**. Filter `-o MUL_MAT -p "m=128,n=1,k=1056"`. Two runs, same binary sha. **No fixes.**

| run | wall s | rc | FAIL | OK | out sha256 | out bytes |
|-----|-------:|---:|-----:|---:|------------|----------:|
| cluster_r1 | 63.7 | 1 | **20** | 28 | `01395f46e2f716b027bc530859d18661ca06866b639b1fd339f3e071b08d36b6` | 3189593 |
| cluster_r2 | 68.1 | 1 | **20** | 28 | `d2369bc6a5dd75dba44d7bd11cff3294f3ac796e66848c8809561a70794d1d58` | 3189958 |

- **Which cases fail: DETERMINISTIC.** The 20 FAIL names are identical across original / r1 / r2.
- **ERR dumps: NOT bit-identical.** All 20 `ERR =` values differ r1 vs r2 (first case 0.15332 vs 0.12142; original first dump 0.10034). RNG tensors each run. Magnitude always ~0.10–0.19 vs thresh 0.0005.
- Filter also matched **28 OK** with same `m,n,k` and `k_v=2112`: all **f32×f32**, plus **small-batch f16/bf16** (`bs=[1,1]`; `bs=[2,1] nr=[1,1]`). Fail is a **batched f16/bf16 + k_v=2112 kernel path**.
- Dossier: compiler `E031.45.02.25` deterministically breaks 20 f16/bf16 cases that `E031.41.03.62` passed; not a heisenbug, not our MoE kernels.

Raw: `raw/a/cluster_r1.out`, `cluster_r2.out`, `cluster_compare.txt`.

### 3. Phase (c) CPU `-nr` apples-to-apples

Status: **DONE** (2/2 rc=0). Same Qwen3.5-2B sha `aaf42c8b…`. `-ngl 0 -nr -fa off -t 6 -r 3`. jsonl `no_repack=true`. SHA impl `8adc148c…` / opencl `0154b01d…` before each cell. Battery 95%, unplugged.

| | pp128 avg_ts | pp512 avg_ts | GPU/this |
|--|-------------:|-------------:|---------:|
| GPU (earlier) | 181.501 | 212.111 | 1 |
| CPU-repack | 126.656 | 122.496 | 1.433× / 1.732× |
| **CPU `-nr`** | **69.415** | **66.724** | **2.615× / 3.179×** |
| hist CPU Aug | 31.459 | 35.937 | 5.77× / 5.97× |

`-nr` does **not** restore 31.5 t/s. HEAD CPU without extra_bufts is already ~2.2× the August CPU. Triplet is now readable: GPU unchanged, CPU-repack fastest CPU, CPU-norepack middle, August CPU slowest.

### Optional: Doze control (arm C tg128, screen awake)

Status: **DONE** (battery 94% > 60%). Double `KEYCODE_WAKEUP` + `screen_off_timeout=1800000` before `one_cell.sh c10_C_awake -ngl 0` (same LFM flags as bag C). SHA recorded.

| | wake_pre | wake_post | pp128 | tg128 |
|--|----------|-----------|------:|------:|
| bag C median (c03/c04/c09) | Awake | **Dozing** | 39.553 | 24.275 |
| c10_C_awake | **Awake** | **Dozing** (still) | **34.017** | **23.683** |

Houji still Dozes mid-cell (~18 s). Control is **slightly slower**, not faster. Doze does **not** explain A≈C (would have needed C-awake >> 24.5). Not a ship-protocol awake cell; KEYCODE_WAKEUP at launch is not enough on this device.

---

## Session outcome

**Compiler (the dossier datum):** Adreno 750 `OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25` vs S23 740 `E031.41.03.62`.

**Dense MUL_MAT does not fully transfer; MoE MUL_MAT_ID does.** MUL_MAT **905/925** (20 FAIL, f16/bf16 + `k_v=2112` batched path, deterministic case set, RNG-variable ERR). MUL_MAT_ID **407/407** including q2_K/q3_K/q4_K/q5_K/q6_K. No fixes.

**Speed A/B/C on LFM KEXP (tg128/pp128, N=3):** B-worst **transfers**. C-fastest **does not** on this bag: tg median A 24.471 ≈ C 24.275 (A/C 1.008 vs S23 0.812). A pp 87.4 vs C 39.6. First-A tg 17.06 looks like compile tax.

**Dense prefill kernels transfer; 5.77× ratio does not.** GPU pp128 181.5 vs hist 181.7. GPU/CPU-repack 1.43×; GPU/CPU-norepack **2.62×**; hist was 5.77× because August CPU was 31.5 vs HEAD `-nr` 69.4.

Doze control C tg128 23.68 (bag 24.28) with `wake_post` still Dozing — does not explain A≈C.

Battery 98% → 94%, unplugged the whole session. Engine HEAD `1882bf8cd` verified, remotes empty, not modified, not pushed.

Raw: `results/xiaomi750_validation/`. Report: `scratchpad/agents/q16-xiaomi/REPORT.md`.
