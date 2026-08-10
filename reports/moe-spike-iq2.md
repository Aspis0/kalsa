# Spike — ik_llama i-quant kernel vs mainline on S23 (g_kernel)

**Date:** 2026-08-09  
**Mandate:** `mandates/spike-iq2-kernels.md` + `mandates/sessione-staccato-065-s1.md`  
**Device:** Galaxy S23 (Termux), Snapdragon 8 Gen 2, SSH `u0_a344@192.168.1.152:8022`  
**Research base:** `reports/research-iq2-kernels.md`  
**Status:** **S0 COMPLETE · S1 COMPLETE · VERDICT NO-GO**

---

## Executive summary

S0 (clone, builds, dense IQ2/IQ3 model download) completed while charging. S1 timing ran **UNPLUGGED** (batt 68%→63%, die start ~44°C) after the speed-065 gate of the same session.

**g_kernel (IQ2_XXS, tg128 @ -t 4) = 0.719** (mediana ik 5.855 / mediana ref 8.14).  
Rule: g < 1.20 → **NO-GO: capitolo kernel CHIUSO**. Port plan not written.

M3 pp512 shows ik **3.39×** faster on prefill (29.21 vs 8.61) — setup is alive; the gap is real on GEMM/prefill but **not** on TG decode, which is the decision metric. IQ3_XXS TG g = 0.805 (also < 1.20).

---

## S0 — setup results

### ik_llama.cpp

| Field | Value |
|-------|--------|
| Repo | https://github.com/ikawrakow/ik_llama.cpp |
| Path (phone) | `~/src/ik_llama.cpp` |
| **Commit SHA** | **`a7c81affa48c6800d63111bdb33469a01d062daa`** |
| Tip subject | `GLM-5.2 vision hack (#2283)` |
| Out-of-tree build | `~/build/ik_llama-bench` |
| Binary | `~/build/ik_llama-bench/bin/llama-bench` (~4.0 MiB) |
| `-rtr` | present (`--run-time-repack <0\|1>`, default 0) |
| CMake flags | `Release`, `GGML_NATIVE=OFF`, `LLAMA_CURL=OFF`, `GGML_IQK_MUL_MAT=ON`, `GGML_IQK_FLASH_ATTENTION=ON`, `GGML_IQK_FA_ALL_QUANTS=OFF`, `CMAKE_{C,CXX}_FLAGS=-march=armv8.2-a+dotprod+i8mm+fp16` |
| Configure notes | “Using optimized iqk matrix multiplications”; “Enabling IQK Flash Attention kernels”; ARM detected; OpenMP found |

**Build attempts (serious):**

1. **Attempt 1** — FA all-quants ON: compiling heavy `iqk_fa_*.cpp`; killed to save time after ~11 min still early in FA set. Not a failure of ik, operator abort for Termux wall-time.
2. **Attempt 2** — `GGML_IQK_FLASH_ATTENTION=OFF`: link **FAILED** with undefined `iqk_fa_work_buffer_size` / `iqk_flash_attn_noalibi` (FA stubs still referenced). Documented in `results/spike_iq2/ik_build2.log`.
3. **Attempt 3** — FA ON, `GGML_IQK_FA_ALL_QUANTS=OFF`: **SUCCESS** (`BUILD_EXIT:0`, binary present). Log: `results/spike_iq2/ik_build3.log`.

Mandate GIALLO gate (“build fails after 2 serious attempts”) **not triggered** — attempt 3 green.

### Reference mainline (fork kernels today)

| Field | Value |
|-------|--------|
| Source tree | `~/src/BigMoeOnEdge/third_party/llama.cpp` (**not modified**; out-of-tree build only) |
| **Commit SHA** | **`5236140e514d5ceef2b801815b3ba9330f19732e`** |
| Note | CMake reports `5236140e5-dirty` (submodule working tree dirt from campaign mmap hooks / expert-ready — same pin as research) |
| Out-of-tree build | `~/build/llamacpp-ref-bench` |
| Binary | `~/build/llamacpp-ref-bench/bin/llama-bench` |
| CMake flags | `Release`, `GGML_NATIVE=OFF`, `LLAMA_CURL=OFF`, `GGML_OPENCL=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` |
| Configure notes | HAVE_SVE Failed, HAVE_SME Failed, HAVE_MATMUL_INT8 Success; CPU backend `-march=armv8.2-a+dotprod+i8mm+fp16` |
| Build | **SUCCESS** (~3.5 min, 240 ninja steps) |

**Not touched:** BigMoeOnEdge fork tree sources, CAMPAIGN/PREFAULT pinned binaries, `../ai-chat`.

### Bench model (dense, not MoE)

| Field | Value |
|-------|--------|
| HF repo | **`unsloth/Llama-3.2-3B-Instruct-GGUF`** |
| Why this | Dense 3B isolates `vec_dot` / mul_mat like method #164; fits S23 RAM; both IQ2_XXS and IQ3_XXS available cheaply (~1.0 + 1.3 GiB) |
| Path (phone) | `~/models/spike_iq2/` |

| File | Size (B) | SHA-256 (= HF LFS oid) | git blob oid |
|------|----------|------------------------|--------------|
| `Llama-3.2-3B-Instruct-UD-IQ2_XXS.gguf` | 1 046 579 648 | `71aae376aa27117203ae4311aba8733408a7caf437a7367da8067017f1e8a25d` | `8b977aaa710a8cba10d65109ce48dcbf1809f82b` |
| `Llama-3.2-3B-Instruct-UD-IQ3_XXS.gguf` | 1 370 147 264 | `33d2b042a1bc0ab57b046328a89f27616a973c98fea7ed9163b295bd7afc2073` | `fb68804cd2379badf42885deebcf99cb04092423` |

GGUF magic verified on both files. No GGUF mirrored to PC (light artifacts only).

### Phone state at S0 end

```text
plugged: PLUGGED_AC
status:  CHARGING
percentage: 49
battery temperature: ~37 °C
timestamp: 2026-08-09T21:03:14-04:00
```

### Harness ready for S1

- Script: `~/experiments/results/spike_iq2/run_s1_bench.sh` (mirrored under `results/spike_iq2/`)
- `bash -n` → **OK**
- Preconditions enforced: `UNPLUGGED`, battery ≥ 40% start / floor 30%
- Cold path: `~/bin/cold_model.sh` + `fadv` before every run
- Guardrails: `source lib_guardrails.sh` + post-run `guardrail_tick`
- Protocol: ABBA on IQ2 TG (ref, ik+rtr=1, ik+rtr=1, ref), then M3 pp512 control, then M4 IQ3 ABBA if model present
- Config fixed: `-t 4`, `-n 128` / `-p 512`, 2 reps TG, 1 rep PP

**To run S1 later (on phone, unplugged):**

```bash
bash ~/experiments/results/spike_iq2/run_s1_bench.sh
# then pull CSV + runs/ and fill tables below
```

---

## S1 — measures (COMPLETE, UNPLUGGED)

Config: `-t 4`, same files, **ABBA**, fadvise cold each run, die + battery annotated, 2 reps TG via `-r 2`.  
Harness: `~/experiments/results/spike_iq2/run_s1_bench.sh`.  
Session: start batt **68%** UNPLUGGED die 44.5°C → end batt **63%** UNPLUGGED 40.9°C. Floor 30% non toccato. Screen timeout restored to 1800000.

### M1 — mainline `llama-bench -p 0 -n 128 -t 4` (tg128 t/s) — IQ2_XXS

| run | order | tg128 t/s | die °C start→end | batt % | plugged |
|-----|-------|-----------|------------------|--------|---------|
| M1a | A | **8.70** ±0.38 | 49.4→72.1 | 68 | UNPLUGGED |
| M1b | A (close) | **7.58** ±… | 50.5→62.4 | 66 | UNPLUGGED |

**mediana(M1): 8.14**

### M2 — ik `llama-bench -p 0 -n 128 -t 4 -rtr 1` (tg128 t/s) — IQ2_XXS

| run | order | tg128 t/s | die °C start→end | batt % | plugged |
|-----|-------|-----------|------------------|--------|---------|
| M2a | B | **6.05** ±0.68 | 59.1→60.1 | 68 | UNPLUGGED |
| M2b | B | **5.66** ±… | 50.6→59.5 | 67 | UNPLUGGED |

**mediana(M2): 5.855**

Thermal note: M1a ended hotter (72.1°C) than M2a start (59.1); M2 still slower after cool-down (M2b at 50.6→59.5). Drift does **not** explain the gap — ik is slower on TG across both ABBA arms.

### g (IQ2_XXS) — decision metric

\[
g = \mathrm{median}(M2) / \mathrm{median}(M1) = 5.855 / 8.14 = \mathbf{0.719}
\]

**g = 0.719 < 1.20 → NO-GO.**

### M3 — pp512 control (`-p 512 -n 0`, 1 rep) — sanity / prefill upside only

| engine | pp512 t/s | die °C start→end | batt % |
|--------|-----------|------------------|--------|
| ref | **8.61** | 52.5→56.3 | 66 |
| ik `-rtr 1` | **29.21** | 50.9→61.6 | 65 |

pp g ≈ **3.39×** (literature M2-Max ~4.7×; direction matches, magnitude lower on 8 Gen 2 thermals). Setup is **not** broken: ik wins hard on prefill GEMM, loses on TG decode. M3 does **not** enter GO/NO-GO (mandate).

### M4 — IQ3_XXS TG (ABBA, 2 rep)

| run | engine | tg128 t/s | die °C start→end | batt % |
|-----|--------|-----------|------------------|--------|
| M4_1a | ref | **5.73** | 50.5→59.7 | 65 |
| M4_2a | ik `-rtr 1` | **4.39** | 51.3→58.5 | 64 |
| M4_2b | ik `-rtr 1` | **4.31** | 50.5→59.1 | 64 |
| M4_1b | ref | **5.08** | 51.0→58.9 | 63 |

**mediana(M4_ref)=5.405 · mediana(M4_ik)=4.35 · g_IQ3 = 0.805** (< 1.20, consistent with IQ2 NO-GO).

---

## Decision rules (applied)

| esito g su IQ2_XXS (@ -t 4) | decisione |
|---|---|
| **g ≥ 1.30** | GO: selective port plan |
| **1.20 ≤ g < 1.30** | GO conditional |
| **g < 1.20** | **NO-GO: kernel chapter CLOSED** ← **this case (g=0.719)** |
| ik build fails after 2 serious attempts | GIALLO — not this case (S0 attempt 3 green) |

**Verdict: NO-GO.** Capitolo kernel i-quant **chiuso** sul nostro silicio (8 Gen 2, frequenze termiche vere, UNPLUGGED). Plateau decode on-device non si compra con il port ik_llama dei vec_dot IQ2/IQ3: ik è **più lento** del mainline del fork su TG, pur restando più veloce su PP.

Port file list / cost estimate: **non applicabile** (NO-GO).

Caveat a verbale (non ribalta il gate): ik reporta size/params leggermente diversi sullo stesso file HF (`1.22 GiB / 3.61 B` vs ref `990.6 MiB / 3.21 B`) — differenza di metadata/repack path, non di GGUF. Il confronto resta sullo stesso path file e stesso `-t 4`.

---

## Artifacts

| Location | Contents |
|----------|----------|
| Phone `~/experiments/results/spike_iq2/` | S0 logs + `s1_results.csv`, `s1_console.log`, `runs/*.txt`, `status.txt=S1_DONE` |
| Phone `~/models/spike_iq2/` | GGUF (not mirrored) |
| Phone `~/build/ik_llama-bench/`, `~/build/llamacpp-ref-bench/` | binaries |
| PC `results/spike_iq2/` | light mirror + S1 CSV/runs (no GGUF) |
| PC `reports/moe-spike-iq2.md` | this report |

---

## STOP

Report ends here per mandate. **NO-GO is the measured gate; opening a kernel cantiere remains a gualt override only.**
