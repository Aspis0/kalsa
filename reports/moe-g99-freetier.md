# G99 free-tier feasibility — LFM2.5-8B-A1B on Jelly Star

**Date:** 2026-08-12  
**Device:** Unihertz Jelly Star · Helio G99 (2×A76 + 6×A55) · 8 GB · Mali-G57  
**Access:** `ssh -p 8022 u0_a225@192.168.1.82` (id_ed25519)  
**Binary:** `~/bin/bmoe-cli` sha `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81`  
**Discipline:** UNPLUGGED · `-t 2` · batt ≥35% · temp guard 45°C · cold `fadvise` before every run  
**Quality:** **NOT measured.** Speed only. PC PPL / requant gates are the next work.

Artefacts: `results/g99_freetier/`

---

## Verdict (one line)

**15–20 tok/s is NOT reached on Q4_K_M.** Default k=4 is **10.60 tok/s**. Cutting to k=2 (flag works on `lfm2moe`) gets **14.38 tok/s** — 0.6 under the 15 floor. The 15–20 band is only a **PROJECTION** via KEXP-style 2–3-bit expert compression (≈16–18 tok/s at measured effective bandwidth, k=3 or k=2), and that path still needs quality gates.

---

## Phase 0 — Models on device

| item | value |
|---|---|
| Official repo | https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF |
| File | `LFM2.5-8B-A1B-Q4_K_M.gguf` |
| URL | https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/LFM2.5-8B-A1B-Q4_K_M.gguf |
| Size | **5 155 564 768** B (4.79 GiB, 4.86 BPW) |
| sha256 | `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0` |
| PC | `models/LFM2.5-8B-A1B-Q4_K_M.gguf` — sha match |
| Jelly | `~/models/LFM2.5-8B-A1B-Q4_K_M.gguf` — sha match |
| **Not used** | `models/LFM2-8B-A1B-Q4_K_M.gguf` (deprecated LFM2, not 2.5) |
| Qwen3.5-2B Q4_K_M | already on device `~/models/` · 1 280 835 840 B · sha `aaf42c8b…699223` match vs `models_staging/` |
| Jelly free space | 169 G available before push |

`--list-archs` on the campaign binary includes **`lfm2moe`**. GGUF `general.architecture = lfm2moe`. Fork pin supports it — **not BLOCKED_ARCH**.

---

## Phase 1 — GGUF facts (defines the k-grid)

From header parse + on-device `print_info` (identical):

| key | value |
|---|---|
| arch | `lfm2moe` |
| params | 8.47 B · label `32x959M` · type `8B.A1B` |
| layers | 24 (hybrid: 6 attn GQA n_kv=8 + 18 shortconv; **2 leading dense**) |
| embd | 2048 |
| dense FFN | 7168 |
| expert_count | **32** |
| expert_used_count | **4 = K0 (default k)** |
| expert FFN | 1792 |
| vocab | 128000 |
| ctx train | 128000 |
| file_type | Q4_K_M (15) |

**k-grid:** K0=4 · K0−1=3 · K0−2=2.

---

## Phase 2 / 3 — Measured decode (n=200, temp 0, `-t 2`, `-c 1024`, `--ubatch 256`, cold)

One fixed prompt (campaign fact prompt). Two runs per cell. mmap, **no `--moe-stream`** (model fits).

| cell | model | k | run1 | run2 | **median** | batt% start | temp °C | vs 15–20 |
|---|---|---|---|---|---|---|---|---|
| **B1** | Qwen3.5-2B Q4_K_M | — | 8.023 | 8.060 | **8.04** | 87 / 86 | 31 | MISS · 0.54× floor |
| **B2** | LFM2.5-8B-A1B Q4_K_M | 4 (default) | 10.471 | 10.730 | **10.60** | 86 / 85 | 32–33 | MISS · 0.71× floor |
| **K3** | same | 3 (`--n-expert-used 3`) | 12.271 | 12.286 | **12.28** | 85 / 84 | 33–34 | MISS · 0.82× floor |
| **K2** | same | 2 (`--n-expert-used 2`) | 14.354 | 14.411 | **14.38** | 84 / 83 | 34 | MISS · 0.96× floor (−0.62 t/s) |

`--n-expert-used` **applies to `lfm2moe`**. Logs show `n_expert_used = 4 / 3 / 2` respectively. Speed scales cleanly: k4→k3 **+15.8%**, k4→k2 **+35.6%**.

B2 headline (the number the owner asked for): **10.60 tok/s** mmap-resident on a cold start, UNPLUGGED G99, 2×A76.

Dense 2B reference lands in the physics band the brief quoted (6–9 t/s real): **8.04**.

### RAM behaviour (B2 / k cells)

- `load_tensors: mmap = true` · CPU_Mapped buffer **4908.87 MiB**
- Live RSS during B2/K2 ≈ **4.5–5.1 GiB** (sampled via `ps`)
- After each run: `buff/cache` ≈ 6.0 GiB, `available` ≈ 6.0 GiB — the 4.8 GiB file sits in page cache, not as anonymous RSS
- After `fadvise` cold: cache drops to ~1.1–1.8 GiB, then fills again during the run
- Swap stuck at **1.1–1.2 GiB** the whole block (already there before B2; not a B2-induced thrash)
- **No OOM.** `dmesg` is unavailable without root; `free` never showed a collapse and every run rc=0 in ~25–35 s wall
- No `--mlock` flag on this binary. mmap did **not** thrash; no retry needed
- Battery 87% → 83% over the 8-run block · temp 31 → 34 °C · stayed UNPLUGGED

---

## Phase 4 — Verdict table + KEXP projection

### Measured

| cell | tok/s | vs 15–20 target |
|---|---|---|
| B1 Qwen3.5-2B Q4 | 8.04 | no |
| B2 LFM2.5 k=4 Q4 | **10.60** | no |
| K3 LFM2.5 k=3 Q4 | 12.28 | no |
| K2 LFM2.5 k=2 Q4 | 14.38 | **no — closest, 4% under 15** |

### Bytes/token (derived, not traced)

Expert params ≈ `22 MoE layers × 32 × 3 × 2048 × 1792` = **7.74 B**. Shared (attn + 2 dense FFN + embed/norms) ≈ 8.47 − 7.74 = **0.73 B**.  
Active experts = `22 × k × 3 × 2048 × 1792`. Q4_K_M = **4.86 BPW**.

| k | active params | bytes/token | measured t/s | implied BW |
|---|---|---|---|---|
| 4 | 1.70 B | 1033 MiB | 10.60 | **10.95 GB/s** |
| 3 | 1.46 B | 884 MiB | 12.28 | **10.85 GB/s** |
| 2 | 1.21 B | 737 MiB | 14.38 | **10.60 GB/s** |

Implied effective bandwidth is **~10.6–11.0 GB/s**, stable across k. G99 DRAM is 15–17 GB/s, so we are at **~70% of the DRAM ceiling** — mixed compute/dequant + bandwidth, not a clean DRAM roofline.

### KEXP-style projection — **PROJECTION, not a measurement**

Hypothesis from the brief: compress **experts only** to 2–3 bit → expert bytes ≈ halved. Shared tensors stay Q4.

| cell (projected) | active bytes | @ measured 10.8 GB/s | @ DRAM 15–17 GB/s |
|---|---|---|---|
| KEXP k=4 | ~737 MiB | **14.7 t/s** | 20–23 t/s |
| KEXP k=3 | ~664 MiB | **16.3 t/s** | 23–26 t/s |
| KEXP k=2 | ~590 MiB | **18.3 t/s** | 25–29 t/s |

**Conservative (use this):** 14.5–18.5 tok/s. That puts **KEXP k=3/k=2 inside 15–20**, KEXP k=4 on the 15 line.  
**Optimistic DRAM ceiling:** 20+ — do not cite as a product number; we never measured 15 GB/s effective on this SoC with this binary.

k-reduction and expert-bit-reduction are **substitutes for the same bytes**: KEXP k=4 projects to the same active-byte budget as Q4 k=2 (which we *did* measure at 14.38). Extra speed beyond 14.4 only appears if 2–3-bit dequant is cheaper than Q4_K, or if we also drop k.

---

## Is 15–20 reachable?

| combination | status |
|---|---|
| Dense 2B Q4 | no (8.0) — confirms the brief's 6–9 physics |
| LFM2.5 Q4 k=4 mmap | no (10.6) — headline |
| LFM2.5 Q4 k=3 | no (12.3) — quality unknown |
| LFM2.5 Q4 k=2 | **almost** (14.4) — quality unknown, likely the quality cliff |
| LFM2.5 KEXP 2–3bit k=4 | **PROJECTION ~15** — needs requant + PPL |
| LFM2.5 KEXP + k=3 | **PROJECTION ~16** — best plausible product cell |
| More threads / A55s | forbidden by campaign rule |
| `--moe-stream` | not the free-tier path (model fits; streaming would add I/O tax) |

**Honest answer:** a *decent* model at 15–20 tok/s on G99 is **not demonstrated**. Q4_K_M LFM2.5 at default k is a 10.6 tok/s phone model — better than the dense 2B, not free-tier-fast. The only measured cell that even *approaches* 15 is k=2, which we must assume hurts quality until PPL says otherwise. Hitting the band cleanly wants **expert compression**, not just k-cutting.

---

## Quality gates that must run next (not this task)

1. **PC PPL** on LFM2.5-8B-A1B Q4_K_M at k=4 / k=3 / k=2 (same `--n-expert-used`). Gate: k=3 and k=2 vs k=4 Δbpb. If k=2 dies, 14.4 tok/s is not a product cell.
2. **KEXP requant** of LFM2.5 experts to 2–3 bit (shared stay Q4). Then:
   - PC PPL vs official Q4_K_M k=4
   - Jelly speed at k=4 and k=3, same harness as this report
3. Optional: one longer n=512 unplugged cell at the winning combo, to confirm the n=200 number is not a short-burst artefact.
4. Do **not** quote the DRAM-ceiling column as a measurement.

---

## Conditions / deviations

- ctx **1024** (not campaign 4096) and `--ubatch 256` to keep compute buffers small next to a 4.8 GiB mmap on 8 GB. Decode n=200 + 76-token prompt do not need 4096.
- Prompt via `-p` (bmoe-cli has no `-f`).
- `dmesg` OOM check: unavailable (no root). Substituted `free` + rc + wall-clock.
- Temp guard in the harness had a `|| true` that would swallow a >45°C abort; irrelevant here (max 34°C).
- S23 and Xiaomi were not touched.
- PC: download + sha only. No build.

---

## Files

```
results/g99_freetier/
  SHA_RECORDS.txt
  gguf_metadata_dump.txt          # clean Phase-1 dump
  gguf_metadata.txt               # raw header parse (includes tokenizer)
  LFM2.5-8B-A1B-Q4_K_M.header.bin
  runs.csv                        # cell,run,tok/s,batt,temp,rc
  G99.master.log
  mem.log
  prompt.txt
  logs/{B1,B2,K3,K2}_r{1,2}.log
```

---

## KEXP speed re-test (Jelly)

**Date:** 2026-08-13 · UNPLUGGED from 19:55 (AC until then; polls in `results/lfm25_kexp_jelly/battery_poll.log`)  
**Binary:** same pin `~/bin/bmoe-cli` sha `36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81`  
**File:** `~/models/LFM2.5-8B-A1B-KEXP.gguf` · 3 326 160 384 B · sha `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` (device MATCH) · 3.09 GiB, 3.13 BPW, 44×q2_K + 22×q3_K + 47×q5_K + 20×q6_K  
**Harness:** identical to this report (`-t 2 -c 1024 -n 200 --temp 0 --ubatch 256`, same prompt, cold `fadvise`, mmap, no `--moe-stream`)  
**A0 control:** left on device, 1 rep between the two KEXP k=4 reps (ABBA)

**Verdict:** **KEXP_REGRESSION + K4_FINAL.** KEXP k=4 is **8.83 tok/s**. k=3 is **10.27 tok/s** (1.16× k4, not ≥1.25×). The −35% file does **not** buy 15–20. It does not even beat Q4_K_M.

| cell | model | k | run1 | run2 | **median** | majflt/tok | mapped MiB | batt% | °C | vs G99 A0 10.60 |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 (G99) | Qwen3.5-2B Q4_K_M | — | 8.023 | 8.060 | **8.04** | — | — | 87 / 86 | 31 | 0.54× floor |
| B2 (G99) | LFM2.5 A0 Q4_K_M | 4 | 10.471 | 10.730 | **10.60** | 6.20 | 4908.87 | 86 / 85 | 32–33 | headline |
| K3 (G99) | same | 3 | 12.271 | 12.286 | **12.28** | — | 4908.87 | 85 / 84 | 33–34 | +15.8% vs B2 |
| K2 (G99) | same | 2 | 14.354 | 14.411 | **14.38** | — | 4908.87 | 84 / 83 | 34 | +35.6% vs B2 |
| **KEXP k4** | LFM2.5 KEXP | 4 | 8.882 | 8.787 | **8.83** | 0.00 / 2.15 | 3164.22 | 100 / 99 | 32–33 | **−16.7% · REGRESSION** |
| A0 k4 (this session) | LFM2.5 A0 Q4_K_M | 4 | 9.762 | — | **9.76** | 22.80 | 4908.87 | 100 | 32 | −7.9% vs G99 B2 (drift) |
| **KEXP k3** | LFM2.5 KEXP | 3 | 10.249 | 10.285 | **10.27** | 0.00 / 0.00 | 3164.22 | 98 / 98 | 34 | 1.16× KEXP k4 · K4_FINAL |

Same-session A0 is 8% under the 08-12 10.60 (22.80 decode faults vs 6.20; `Marco-Mini-Instruct-KEXP.gguf` 6.39 GiB now shares `~/models/`). KEXP is still slower than that A0 (8.83 vs 9.76).

The cache mechanism the projection counted on **did fire**. KEXP decode major-faults are ~0 (file 3.09 GiB stays ~100% resident after a run: 811k/811k pages). A0 this session faults 22.80/tok. Load/prefill/TTFT improve (KEXP load ~3.9 s vs A0 7.9 s; k3 prefill 13.6 t/s vs A0 8.3). Decode does not. G99 projected 14.7 / 16.3 tok/s by applying the Q4 implied 10.8 GB/s to a 737 / 664 MiB active-byte budget. Measured implied bandwidth at those budgets is **~6.8 / 7.1 GB/s**, and cpu-s/token *rises* (KEXP k4 0.225 vs A0 0.198). Q2_K/Q3_K dequant on 2×A76 is more expensive than the bytes it saves. 15–20 remains a projection, and this file is the wrong direction for decode.

Artefacts: `results/lfm25_kexp_jelly/`.
