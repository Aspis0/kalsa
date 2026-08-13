# k4split N1+N2 verdict — 2026-08-13 morning (S23, plugged)

**N1: PASS** at `--cache-mb 1000 --force-cache` (2000 and 1500 ram-guard refuse).
**N2: FAIL_CORRECTNESS.** Hook is alive. Split arms A/B/AUTO are byte-identical
to each other. CPU (`-ngl 0`) diverges at the first contentful choice after
`</think>` (`distinct` vs `smaller`). Mandate: no N3/N4 speed work.

Device stayed up. Cable was in the whole time (PLUGGED_AC, charging 34% → 66%,
batt temp 27–38 °C). Speed numbers below are **not** a gate; they are load/gen
side-effects logged because the binary prints them.

Binary: `~/gdn_k2/k4split/bin/bmoe-cli` sha
`b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab`.
KEXP sha `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a`
size `13416430592`. `LD_LIBRARY_PATH` must include `/vendor/lib64` (vendor
`libOpenCL.so`). `bmoe-cli` has **no `-f`**; prompt file was slurped into `-p`
(byte-identical across the four N2 arms).

Raw logs: `results/k4split/n1/`, `results/k4split/n2/`,
`results/k4split/s23_logs/logs/`.

---

## Battery / device (honest)

| when | plugged | % | temp °C | MemFree | MemAvailable |
|---|---|---:|---:|---:|---:|
| SSH arrive (05:29) | PLUGGED_AC | 34 | 27.2 | 532904 KiB | 3861132 KiB |
| N1 session start | PLUGGED_AC | 42 | 30.1 | 1469308 KiB | 3967960 KiB |
| N2 start | PLUGGED_AC | 58 | 34.6 | (recovered) | (recovered) |
| N2 end / now | PLUGGED_AC | 66 | 37.0 | 3939484 KiB | 5009824 KiB |

No Xiaomi/Jelly. No PC MarcoKEXP / LFM2.5 touch. 4B `llama-cli` was already
dead (`pgrep` CLEAR). `run_n1_n2.ps1 -Push` does not parse (PowerShell
here-string); push was the MORNING.md scp block.

After the required 13 GiB `sha256sum`, MemFree was 168–200 MiB because the
hash pulled the GGUF into page cache. `posix_fadvise(DONTNEED)` on the GGUF
only (not `drop_caches`) restored MemFree to ~1440 MiB. Documented in
`n1/battery_note.txt`.

---

## N1 — load + RAM smoke (PLUGGED OK) — PASS

Campaign k6d065 + ARM_B (`--ngl 99 --flash-attn off --moe-cpu-experts on
--dense-weights anon`). Tiny prompt `Say OK in one word.`, `-n 8`.

### Cache fallback (mandated order)

| cache-mb | result |
|---|---|
| 2000 | ram-guard **refuse**: need 4538 MiB / avail 3856 (`gpu_dense=1330 host_dense=333 leftover_mmap=0 cache=2000 kv+rs=73 compute=501 slack=300`) |
| 1500 | ram-guard **refuse**: need 4038 / avail 3844 |
| **1000 + `--force-cache`** | ram-guard **allow**: need 3538 / avail 3830. This is the N1/N2 config of record. |

`cache_min_mb=1500` is real: 1000 without `--force-cache` is not a legal
product flag.

### Load cells at cache 1000

| cell | wall | model load | rc | graph splits | notes |
|---|---:|---:|---:|---:|---|
| c512 first try (15 s abort) | 21 s | — | 143 SIGTERM | — | sampler killed during `sched_reserve` (3×5 s MemFree<300) |
| **c512 retry (60 s abort)** | ~30 s | **23.076 s** | **0** | 82 | text `OK`; hook alive |
| **sched-debug GGML_SCHED_DEBUG=2** | 32 s | **24.456 s** | **0** | **82** | 3.2 MiB `n1_sched_B_c1000.err` |
| **c4096** | 32 s | **22.718 s** | **0** | 82 | text `OK`; hook alive |

Placement (every successful split load):

```
bmoe: placement n_gpu_layers=99 flash_attn=off moe_cpu_experts=on pin_ffn_exps=1 extra_ot=0
bmoe: dense-weights=anon — skipping 1330 MiB already on GPU (no host twin)
bmoe: dense-weights=anon — 333 MiB in 1 anon buffers
bmoe: routing tensor 'ffn_moe_topk-0' is not host-backed — copying ids/weights through the backend
```

Mechanism B pin is visible in the loader: every `blk.N.ffn_{down,gate,up}_exps`
is `buffer type overridden to CPU` (q3_K / q2_K). All 40 layers assigned
`GPUOpenCL`. `token_embd` stays host (the 333 MiB). HostAlias copy fired once
as designed.

Streaming stats on the c512 retry (n=8, not a speed claim):

```
moe-stream: read 490.6 MiB (81.76 MiB/token)
moe-cache: 38.5% hit, resident 999.1 MiB
moe-overlap: stall 0.045 s/token
```

### MemFree curve (the spike is real, the phone is not dying)

OpenCL alloc + convert + `sched_reserve` drives **MemFree** into the
RescueParty-looking zone for ~15–25 s, then anon-drop jumps it back to 3–4 GiB.

| csv | min MemFree | min MemAvailable | abort? |
|---|---:|---:|---|
| n1_c512_B_c1000 (15 s rule) | 70.3 MiB | 1788 MiB | YES (killed) |
| n1_c512_B_c1000_retry60 | **13.7 MiB** | 1475 MiB | no (recovered, gen finished) |
| n1_sched_B_c1000 | 68.2 MiB | 1091 MiB | no |
| n1_c4096_B_c1000 | 52.8 MiB | 1033 MiB | no |

Sustained = 12 consecutive 5 s samples (60 s). MORNING's first-sample / 15 s
kill is a **false BLOCKED_RAM** during the transient convert workspace
(`recon_dense_ram.md`). MemAvailable never went below ~1 GiB on N1. Device
recovered to MemFree 2.3–3.9 GiB after every run.

This is **not** BLOCKED_RAM: the split loads, generates, and the phone is
alive. It **is** a product warning: any watchdog that keys on MemFree<300
without a 30–60 s window will murder the load. Campaign RescueParty is
MemFree<100 **and** die>85 °C — die was 27–38 °C.

---

## N2 — correctness + hook-alive (PLUGGED OK) — FAIL_CORRECTNESS

Same binary, same prompt (`p_fact.txt` via `-p`), greedy `--temp 0 --seed 42
-n 32 -c 4096`, same `--cache-mb 1000 --force-cache`.

| arm | flags | wall | load | rc | splits | hit% | MiB/tok |
|---|---|---:|---:|---:|---:|---:|---:|
| ARM_CPU | `-ngl 0 --moe-cpu-experts off --dense-weights anon` | 31 s | 11.155 s | 0 | 1 | 44.0 | 72.04 |
| ARM_A | `-ngl 99 --moe-cpu-experts off --dense-weights anon` | 51 s | 23.510 s | 0 | 82 | 45.0 | 68.89 |
| ARM_B | `-ngl 99 --moe-cpu-experts on --dense-weights anon` | 43 s | 22.520 s | 0 | 82 | 45.0 | 68.89 |
| ARM_AUTO | `-ngl 99 --moe-cpu-experts auto --dense-weights anon-gpu` | 58 s | 22.893 s | 0 | 82 | 45.0 | 68.89 |

### Hook: ALIVE (not the fail)

- Streaming stats present on every arm (including CPU).
- hit% 44.0 vs 45.0 — well inside ±10 pt.
- MiB/tok 72.04 vs 68.89 — same ballpark.
- stall > 0 on split arms (0.044–0.104 s/tok) so the expert-ready hook waited.
- A/B/AUTO cache fingerprint is identical (4889 evictions, 1656 re-reads,
  926/7680 dropped). CPU is close but not the same (4978 / 1748 / 946) —
  different trunk changes timing of the streamer, not the hook.

### Text: FAIL

Generated continuation after `</think>` (n=32):

```
CPU:   A Mixture-of-Experts (MoE) model consists of multiple distinct neural network "experts" that are selectively activated for each
A/B/AUTO: A Mixture-of-Experts (MoE) model consists of multiple smaller "expert" networks that are selectively activated for each input token
```

- Common prefix: `A Mixture-of-Experts (MoE) model consists of multiple `
- First diverge: **`distinct` vs `smaller`** (early, systematic).
- A == B == AUTO (sha `6de0d965377a7162`, 514 bytes). CPU sha `ef2239b26ec28018`, 510 bytes.

Bodies: `results/k4split/n2/n2_{CPU,A,B,AUTO}_c1000.out`.

This is GPU-trunk vs CPU-trunk numerics, not a dead hook and not Mechanism A
vs B. Pin vs no-pin vs auto all emit the same 32 tokens. The mandate does not
give a "fp reorder, semantic-OK" pass: **systematic early divergence =
FAIL_CORRECTNESS, no speed work.**

### N2 RAM

Same transient MemFree spike. CPU arm dipped to **15.8 MiB** MemFree
(MemAvailable still 1703 MiB) — anon of the full 1664 MiB host trunk.
Split arms min MemFree ~50–57 MiB, min MemAvailable ~953 MiB. No abort.

---

## What morning should do

1. **Do not run N3/N4.** Fail-correctness kill-gate.
2. Treat A=B=AUTO + live hook as evidence the **split placement and streamer
   are working**. The fail is trunk-op numerics (`-ngl 99` OpenCL vs `-ngl 0`
   CPU) on the first divergent token.
3. Next debug (not this agent's job): token-level dump (`--progress` or
   logits) at the `distinct`/`smaller` position; compare a single dense
   `MUL_MAT` (Q5_K/Q6_K) CPU vs OpenCL on this prompt; do **not** "fix" by
   loosening the token-identical rule.
4. Any later speed cell must stay **UNPLUGGED, batt ≥45%**, cache **1000 +
   `--force-cache`**, `LD_LIBRARY_PATH=.../bin:/vendor/lib64`, and a MemFree
   sampler that waits ~60 s through the alloc spike.
5. Binary and prompts stay staged at `~/gdn_k2/k4split/`. Do not git push.
   Do not touch PLAN.md.

---

## File map

- N1 refuse: `n1/n1_c512_B_c2000.err`, `n1/n1_c512_B_c1500.err`
- N1 pass: `n1/n1_c512_B_c1000_retry60.{out,err,csv}`, `n1/n1_c4096_B_c1000.*`
- N1 sched debug: `n1/n1_sched_B_c1000.err` (3.2 MiB)
- N2 greedy: `n2/n2_{CPU,A,B,AUTO}_c1000.{out,err}` + matching `memfree_*.csv`
- N2 `-f` false start (unknown arg): `n2/bad_dash_f/`
