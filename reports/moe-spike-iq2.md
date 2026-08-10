# Spike — ik_llama i-quant kernel vs mainline on S23 (g_kernel)

**Date:** 2026-08-09  
**Mandate:** `mandates/spike-iq2-kernels.md`  
**Device:** Galaxy S23 (Termux), Snapdragon 8 Gen 2, SSH `u0_a344@192.168.1.152:8022`  
**Research base:** `reports/research-iq2-kernels.md`  
**Status:** **S0 COMPLETE · S1 PENDING** (phone still on AC when S0 finished)

---

## Executive summary

S0 (clone, builds, dense IQ2/IQ3 model download) completed successfully on the campaign S23 while charging. Both `llama-bench` binaries are built and help-smoke OK. Models verified by size + SHA-256 = HF LFS oid.

**S1 timing (M1–M4, ABBA, fadvise cold) was NOT run:** at S0 completion the phone was `PLUGGED_AC` (battery 49%). Campaign rule: no timing benchmarks while charging. Harness is ready at `~/experiments/results/spike_iq2/run_s1_bench.sh` for an unplugged session with battery ≥ 40%.

**Verdict:** **not available yet** — `g` requires S1. Build is **GREEN** (not GIALLO). No port GO/NO-GO until S1 medians exist.

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

## S1 — measures (PENDING)

Config declared (unchanged from mandate): `-t 4`, same files, **ABBA**, fadvise cold each run, die + battery annotated, 2 reps TG.

### M1 — mainline `llama-bench -p 0 -n 128 -t 4` (tg128 t/s) — IQ2_XXS

| run | order | tg128 t/s | die °C start→end | batt % | plugged |
|-----|-------|-----------|------------------|--------|---------|
| M1a | A | — | — | — | S1 PENDING |
| M1b | A (close) | — | — | — | S1 PENDING |

**mediana(M1):** —

### M2 — ik `llama-bench -p 0 -n 128 -t 4 -rtr 1` (tg128 t/s) — IQ2_XXS

| run | order | tg128 t/s | die °C start→end | batt % | plugged |
|-----|-------|-----------|------------------|--------|---------|
| M2a | B | — | — | — | S1 PENDING |
| M2b | B | — | — | — | S1 PENDING |

**mediana(M2):** —

### g (IQ2_XXS)

\[
g = \mathrm{median}(M2) / \mathrm{median}(M1) = \mathbf{—}
\]

### M3 — pp512 control (`-p 512 -n 0`, 1 rep) — sanity / prefill upside only

| engine | pp512 t/s | die °C | batt % |
|--------|-----------|--------|--------|
| ref | — | — | S1 PENDING |
| ik `-rtr 1` | — | — | S1 PENDING |

M3 **does not** enter GO/NO-GO (mandate). Expected literature gap on M2-Max was ~4.7× pp for IQ2_XXS; if M3 shows no gap, re-check setup.

### M4 — IQ3_XXS TG (models downloaded) — S1 PENDING

| run | engine | tg128 t/s | die °C | batt % |
|-----|--------|-----------|--------|--------|
| M4_1a/b | ref | — | — | S1 PENDING |
| M4_2a/b | ik `-rtr 1` | — | — | S1 PENDING |

**g_IQ3 = mediana(M4_ik) / mediana(M4_ref):** —

---

## Decision rules (recalled — not applied without g)

| esito g su IQ2_XXS (@ -t 4) | decisione |
|---|---|
| **g ≥ 1.30** | **GO**: selective port plan (iqk mul_mat/mul_mat_id for IQ2_XXS/IQ3_XXS + repack-at-fill) |
| **1.20 ≤ g < 1.30** | GO **conditional**: only if repack-at-fill ≤1 p-week and e2e expected ≥ +8% |
| **g < 1.20** | **NO-GO**: kernel chapter CLOSED |
| ik build fails after 2 serious attempts | GIALLO — **not this case** (attempt 3 succeeded) |

**Current verdict:** **S1 PENDING: waiting for unplugged phone.**  
No GO / NO-GO / conditional. Port file list and cost estimate deferred until g exists.

---

## Artifacts

| Location | Contents |
|----------|----------|
| Phone `~/experiments/results/spike_iq2/` | commits, model meta+sha, cmake/build logs, `run_s1_bench.sh`, `s0_complete.txt` |
| Phone `~/models/spike_iq2/` | GGUF files (not mirrored) |
| Phone `~/build/ik_llama-bench/`, `~/build/llamacpp-ref-bench/` | binaries |
| PC `results/spike_iq2/` | light mirror (no GGUF) |
| PC `reports/moe-spike-iq2.md` | this report |

---

## STOP

Report ends here per mandate. **S1 and final g/verdict are for a later unplugged session; port cantiere decision remains with gualt after S1.**

**S1 PENDING: waiting for unplugged phone.**
