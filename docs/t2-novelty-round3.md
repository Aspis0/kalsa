# Novelty web-sweep round 3 — the bio-derived trio (K, L, M)

**Date:** 2026-08-15  
**Bar:** "nobody has even TRIED it". False NOVEL wastes days. This report errs toward prior art.  
**None of the three clears the bar.** K is llama.cpp's shipped online-repack with a different *schedule*. L is the union of `onTrimMemory` / `--mlock` / GPU-pressure shrink. M is EdgeMoE + usage-profile pruning (PreMoe/REAP) + Apple's overnight-adapter slot, glued.

Companion to `report.md` (A–C) and `report2.md` (D–E).

---

## Candidate K — "Chaperones": tiered-JIT weight layouts in a streaming expert cache

### Verdict: **NEAR-DUPLICATE (llama.cpp online-repack)**

Closest match: **llama.cpp aarch64 online repacking** (PR [#9921](https://github.com/ggml-org/llama.cpp/pull/9921), refactor [#10446](https://github.com/ggml-org/llama.cpp/pull/10446)). Same transform (stock GGUF block → i8mm/dotprod interleaved `Q4_0_4_4` / `Q4_0_8_8` / later Q4_K), same kernel win. Difference is **when** it runs: they do it at **load for every resident tensor**. The candidate does it **later, only for hot streamed cache entries, on idle I/O threads**.

That is a scheduling policy on a shipped mechanism, not "nobody tried SIMD layout promotion of quantized weights."

### What the candidate is

1. Cache insert keeps stock `Q4_K`; serve immediately with the generic `vecdot`.  
2. A **background folder thread**, only when I/O threads are idle, re-packs the **hottest** cache entries in place to an i8mm-friendly 8×8 interleaved layout.  
3. Hot experts get a measured ~1.27× GEMV; cold ones never pay the repack.  
4. Analogy: JVM interpreter → C1 → C2, applied to **weight layouts** in an expert cache; hotness counters decide promotion.

Known context (accepted): llama.cpp already online-repacks **resident** weights at load. Repack-at-insert on the streaming critical path is too expensive. The claim is the **lazy / background / hotness-prioritized schedule**.

### What prior art actually does

**llama.cpp online-repack (shipped, default-on).**  
https://github.com/ggml-org/llama.cpp/pull/9921 · bartowski note: https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF  
Reddit: https://www.reddit.com/r/LocalLLaMA/comments/1p88mwr/llamacpp_now_supports_online_repacking_for_q4_k/

- At **model load**, if the CPU has `DOTPROD` / `I8MM` / `AARCH64_REPACK`, Q4_0 (then Q4_K) tensors are rewritten in RAM into `Q4_0_4_4` / `Q4_0_4_8` / `Q4_0_8_8` (and K-quant analogues).  
- Flag: `--repack` / `-nr --no-repack` (`LLAMA_ARG_REPACK`). Default: enabled.  
- Motivation is exactly K's: the on-disk GGUF is portable; the fast layout is CPU-ISA specific.  
- Cost is paid **once, for all tensors that are loaded**. For a mmap'd MoE that streams experts, this either (a) tries to repack the world and dies (Colibrì/DeepSeek-V4 reports: "tries to build a 147 GB repacked buffer"), or (b) is turned off with `--no-repack`, and streamed experts stay on the generic kernel forever.

**Issue #19578 — "Repack with mmap doubles ram usage on arm"** (12 Feb 2026).  
https://github.com/ggml-org/llama.cpp/issues/19578  
They already know the layout-promoted copy is an **extra RAM buffer**. That is why a streaming expert cache cannot afford load-time / insert-time repack of every expert. The issue does **not** propose background hot-only promotion; it compares "new online-repack" vs the old pre-baked `q4_0_4_4` GGUF.

**Issue #10757, #10435** — runtime repack bugs / 10× regression when the fast path is missing. Community treats online-repack as **all-or-nothing at load**, not a tiered JIT.

**Pre-baked layouts** (`Q4_0_4_4` GGUFs) — the 2024 workaround before online-repack. Offline, for the whole file. Opposite of lazy.

**JVM / HotSpot tiered compilation** — the analogy is public and old. Interpreter → C1 → C2 on **method hotness**. Nobody in the MoE-cache literature writes "apply HotSpot to GGML block layout." Combining a known compiler policy with a known ggml transform is still a combination, not a green field.

**TVM AutoTVM / Ansor, torch.compile, cuBLASLt algo cache, MLC-LLM autotune** — compile-time or first-touch kernel specialization. They do not re-pack *streamed expert cache slots* by runtime hotness while a generic kernel already serves.

**T-MAC / LUT GEMM** (Microsoft, llama.cpp PR #10181) — mixed-precision lookup kernels; layout chosen at convert/load, not promoted in a cache.

**Any-Precision / PagedWeight / DynaExq** (rounds 1–2) — runtime **bitwidth** of hot vs cold experts. Different object (precision, not SIMD interleave).

No llama.cpp / ik_llama.cpp / ollama issue or PR found that says: "idle I/O thread; promote hottest expert-cache entries from Q4_K → i8mm-interleaved." The community repeatedly hits the cost (`--no-repack`, mmap-double-RAM, 147 GB buffer) and stops at disable-or-load-everything.

### Three closest works (one line each)

| Work | How it differs from K |
|---|---|
| **llama.cpp online-repack** https://github.com/ggml-org/llama.cpp/pull/9921 | **Same layout transform and same kernel win**; runs at **load for every resident tensor**, not background / idle-I/O / hottest-only inside a streaming expert cache. |
| **#19578 mmap-repack doubles RAM** https://github.com/ggml-org/llama.cpp/issues/19578 | Documents the extra buffer that *motivates* lazy promotion; does **not** implement hotness-gated background repack. |
| **HotSpot C1/C2** (and TVM/torch.compile) | Same *policy* (promote hot code); object is **bytecode/kernels**, not quantized expert tiles in a cache. |

### Remaining sliver (do not treat as NOVEL)

Idle-I/O-thread + hotness-counter promotion **inside an expert cache**, serving generic `vecdot` until then. That schedule is the only un-shipped piece. It is the obvious answer to "repack is too expensive for streamed MoE, `--no-repack` leaves tok/s on the table." A reviewer will write "llama.cpp already does this transform; you changed the timer."

### Search queries run (K)

- `llama.cpp runtime repack streamed experts background repack quantized weights hot`
- `site:github.com/ggml-org/llama.cpp online repack OR "runtime repack" OR "repack" MoE expert cache background OR lazy OR idle`
- `"online repacking" OR "lazy repack" OR "background repack" OR "JIT weight layout" OR "tiered compilation" weights llama.cpp i8mm`
- `"online repacking" llama.cpp Q4_K ARM i8mm PR`
- `llama.cpp "repack" MoE experts "too slow" OR "only hot" OR background OR incremental OR deferred OR lazy PR OR issue`
- `llama.cpp MoE expert online repack slow mmap streaming --no-repack`
- `github.com ggml llama.cpp pull 9921 online repacking Q4_0 ARM`

---

## Candidate L — "Autophagy": memory-pressure-driven self-shrinking engine

### Verdict: **NEAR-DUPLICATE (onTrimMemory + llama.cpp `--mlock` / `--sleep-idle` + DynaExq/PagedWeight)**

Every control surface exists. Apps already **evict the loaded model** on OS memory warnings. Engines already **`mlock`** to stop zram/swap of weights. GPU MoE systems already **shrink expert residency under memory pressure**. Nobody we found wires **PSI / major-fault / swap-delta → shrink expert cache AND mlock/madvise-promote dense tensors, class-aware, before the kernel swaps them**. That combo is a sliver on top of three shipped behaviors, not "nobody tried trading an LLM engine's own footprint against OS swap."

### What the candidate is

The engine self-monitors OS pressure (own major-fault rate, swap deltas, `/proc/self`, PSI). When pressure rises it:

1. **shrinks its own expert cache**, and  
2. **re-pins critical dense weights** (`mlock` / `madvise` priority inversion)  
**before** the OS swaps them.

Motivation: ~1.5 GB anon in zram, stock config 60–100× slower because the kernel swaps **dense** weights while page-cache churns.

Question: has any **LLM engine** dynamically traded *its own* expert/weight cache against OS swap with **weight-class-aware pinning**? (Not generic app `onTrimMemory`.)

### What prior art actually does

**Android / iOS app-level: evict the whole model.**  
https://mvpfactory.io/blog/running-gemma-3-on-device-in-production-memory-budgets-quant/

> "We cache the loaded model and evict on `onTrimMemory(RUNNING_LOW)` on Android and the equivalent `didReceiveMemoryWarning` on iOS, both surfaced through a shared `MemoryMonitor`."

That is a memory-pressure callback that **drops the engine's weights**. Not class-aware (dense vs expert), not PSI, not "pin attention, shrink expert cache." It *is* a shipped LLM-on-device response to OS pressure.

**llama.cpp `--mlock`** — static, all-or-nothing pin.  
Documented specifically against **zram / high `vm.swappiness`**: without it, "a swap event mid-session can make TG appear to stall."  
https://carteakey.dev/blog/local-inference/local-llm-optimization/  
Community diagnosis (discussion [#638](https://github.com/ggml-org/llama.cpp/discussions/638)): Linux prefers reclaiming **clean mmap** (expert file pages) over writing **anon** to swap — the exact failure mode in the motivation. The prescribed fix is `--mlock`, not a controller. `--mlock` of a 30B MoE is often impossible (`RLIMIT_MEMLOCK`).

**`--no-mmap`** — opposite knob: force anon so the kernel cannot silently drop expert pages; increases swap risk. Same discussion.

**llama.cpp `--sleep-idle-seconds` (PR [#18228](https://github.com/ggml-org/llama.cpp/pull/18228))**  
https://huggingface.co/blog/ggml-org/model-management-in-llamacpp  
Unloads **the entire model + KV** after idle. Router mode + `--models-max` LRU-evicts whole models. Self-shrink, but **idle-timer**, not PSI, and not weight-class-aware.

**DynaExq / PagedWeight** (rounds 1–2)  
https://arxiv.org/abs/2511.15015 · https://arxiv.org/abs/2607.16184  
Runtime **shrink of expert precision / pages under a hard HBM (or KV) budget**. Pressure signal is **GPU allocator**, not `/proc` PSI / major faults / zram. Class-aware in the MoE sense (hot experts stay wide). Server, not phone swap.

**Linux primitives the candidate would call:** `mlock`/`mlock2(MLOCK_ONFAULT)`, `madvise(MADV_WILLNEED|DONTNEED|COLD|PAGEOUT)`, PSI (`/proc/pressure/memory`), `vm.swappiness`. These are generic. No llama.cpp / llama.rn / MLC / ollama / ExecuTorch / ORT path found that **reads PSI and then `mlock`s attention while `MADV_COLD`s cold experts**.

**ExecuTorch / ONNX Runtime / LiteRT / MediaPipe** — mobile memory APIs exist (NNAPI, LiteRT delegates, ORT session options). Search did not surface a **weight-class-aware** `onTrimMemory` handler *inside* those engines; the Gemma production write-up handles it **above** the engine (unload session).

**AICore / Gemini Nano** — OS-level singleton so *apps* do not each hold a model (LMK avoidance). Not an engine shrinking its expert cache.

**OpenVINO Model Server #4141** (Apr 2026) copies llama.cpp sleep-idle: unload weights + KV on idle. Same coarse self-shrink.

### Three closest works (one line each)

| Work | How it differs from L |
|---|---|
| **Gemma-on-device `onTrimMemory` evict** https://mvpfactory.io/blog/running-gemma-3-on-device-in-production-memory-budgets-quant/ | OS pressure → **drop the whole loaded model**. No expert-cache shrink, no dense-vs-expert pin. |
| **llama.cpp `--mlock` + mmap/swappiness lore** https://github.com/ggml-org/llama.cpp/discussions/638 | Same failure mode (kernel swaps/reclaims the wrong pages). Fix is **static pin-everything**, not a PSI loop, and not class-aware. |
| **DynaExq / PagedWeight** https://arxiv.org/abs/2511.15015 | Pressure-driven **expert shrink**, but GPU-HBM/KV, not OS swap/PSI, and they **lower bitwidth**, they do not `mlock` dense tensors. |

### Remaining sliver (do not treat as NOVEL)

PSI + major-fault + swap-delta → **shrink expert cache AND invert pin priority (dense first)** before kswapd. That specific sensor→actuator graph is unpublished. The *behaviors* (respond to pressure, pin weights, shrink experts) are all shipped. A reviewer will not accept "nobody thought an inference engine should yield RAM when the OS is drowning."

### Search queries run (L)

- `llama.cpp mlock swap zram "memory pressure" PSI Android onTrimMemory LLM expert cache shrink`
- `"onTrimMemory" OR "memory pressure" OR PSI OR "trim memory" LLM OR "llama.cpp" OR MLC OR ExecuTorch OR "onnx runtime" weights cache shrink`
- `ExecuTorch OR "llama.rn" OR MLC-LLM OR "onnx runtime" OR MediaPipe onTrimMemory OR "memory pressure" callback shrink model cache Android`
- `llama.cpp madvise DONTNEED OR "mlock" attention only OR "pin" dense weights experts swap Android PSI adaptive cache`
- `llama.cpp --sleep-idle-seconds PR 18228 unload model idle memory`
- `inference engine memory pressure adaptive cache shrink` (covered by the above)

---

## Candidate M — "REM sleep": nightly on-device self-reorganization of a local MoE, per user

### Verdict: **NEAR-DUPLICATE (EdgeMoE + PreMoe/REAP + Apple on-device adapters)**

The **physical rewrite of a local MoE from that user's routing histogram**, overnight, with an on-device PPL gate and rollback, as one shipped phone feature, was **not** found. Every component is published:

- per-expert bitwidth from a usage/importance profile → **EdgeMoE**  
- usage/router telemetry → drop or keep experts, optionally rewrite the file → **REAP, PreMoe, frequency pruning**  
- overnight / idle on-device personalization slot, nothing uploaded → **Apple Intelligence adapters** (training, not requant)  
- quality check after compression → every PTQ paper's PPL table; PreMoe's GPQA probe  

"Has anyone proposed/shipped per-user usage-driven **restructuring of the model file** for LLM/MoE on the edge (not training, not federated)?"  
**Proposed, yes, in pieces. Shipped as that pipeline on a phone, no.** Under this bar that is **NEAR-DUPLICATE**, not NOVEL.

### What the candidate is

While charging + idle, replay the day's **routing telemetry** and restructure the **local** model file:

- never-used experts → lower bitwidth **on disk**  
- hot experts stay high-precision  
- optional co-activation layout (see report2 candidate E)  
- cache priors refresh  
- **on-device mini quality gate** (small PPL probe) + **rollback**  
- each phone's file drifts toward its owner; **nothing leaves the device**

Not training. Not federated stats.

### What prior art actually does

**EdgeMoE** (Yi et al., arXiv:2308.14352).  
https://arxiv.org/abs/2308.14352  
**Static, offline, population** per-expert bitwidth from importance profiling. Writes a mixed-precision model. Not per-user, not nightly, not from *this phone's* router log. This is the bitwidth half of M, frozen.

**DynaExq** (arXiv:2511.15015) — runtime HP/LP under a **server HBM** budget from **live** router hotness. Does not rewrite the on-disk file; does not sleep/charge; no PPL rollback of a new GGUF.

**PreMoe** (Pei et al., arXiv:2505.17639).  
https://arxiv.org/abs/2505.17639 · https://github.com/JarvisPei/PreMoe  

- Offline: build **task-conditioned expert importance** (TCESS) from router logits.  
- Online: match the query to a stored task pattern, **load only those experts** (reconstruct a smaller model).  
- They also **quantize** the reduced expert set (W4).  
- Patterns are from **task datasets / synthetic traces**, not a day of one user's phone.  
- I/O is "load subset," not "rewrite the GGUF tonight."  
This is usage-driven **restructuring of which experts exist in the working set**, with a quality table. Closest algorithmic cousin.

**REAP — Router-weighted Expert Activation Pruning** (Lasby et al., Cerebras; arXiv:2510.13999).  
https://arxiv.org/abs/2510.13999 · https://github.com/CerebrasResearch/reap  

- One-shot prune from **calibration / your traffic**. Saliency = router gate × activation norm.  
- NVIDIA/DGX write-ups (2026) explicitly: hook vLLM, collect **live** `(layer, expert)` frequency + gate mass on *your* workload, export a profile, prune, **write a new checkpoint**.  
https://forums.developer.nvidia.com/t/why-you-should-reap-it-yourself-live-moe-expert-pruning-in-vllm/364098  
- "Do not ship the reap model, ship the reap **profile**."  
- On-device REAP articles exist as a *future application*, not a charging-idle daemon with rollback.  
This is **usage-driven file rewrite** of a MoE. Missing: phone, nightly, PPL gate, requantize-instead-of-delete.

**Frequency-based expert pruning** (REAP paper's baseline): `S_i = ν_i` (usage count). That *is* "never-used experts go away." M keeps them at Q2 instead of deleting — EdgeMoE's move, not a new idea.

**Apple on-device adapters** (Foundation Models, 2024–2026).  
https://machinelearning.apple.com/research/introducing-apple-foundation-models  

- Small adapter modules, **dynamically loaded/swapped**, "specialize on the fly," memory-managed so the OS stays responsive.  
- Fine-tuned for **users' everyday activities**. Privacy: on-device + PCC.  
- This is the **overnight / idle personalization product slot**, but the write is **trained adapter weights**, not requantized experts from router histograms.

**Google / federated on-device personalization** — typically **training** small heads or federated **aggregates that leave the device**. Opposite of M's "nothing leaves."

**CMoE** (Pei et al., arXiv:2502.04416) — "carve" a dense LLM into an MoE by activation. Offline compression, not per-user nightly.

**u-MoE / test-time pruning** (Koike-Akino, MERL) — prune at inference from activations; not a durable on-disk personal file.

**Patents** on "recompressing neural network weights based on usage on device": no grant closer than EdgeMoE + on-device PTQ + Apple adapters turned up in this sweep. Not FTO.

### Three closest works (one line each)

| Work | How it differs from M |
|---|---|
| **EdgeMoE** https://arxiv.org/abs/2308.14352 | Per-expert bitwidth from an importance profile, written into the model — **population, offline, once**, not this user's day and not a PPL-gated nightly rewrite. |
| **PreMoe / REAP** https://arxiv.org/abs/2505.17639 · https://arxiv.org/abs/2510.13999 | Usage/router telemetry → **drop or subset experts** and emit a new checkpoint. Server/calibration (REAP can use live vLLM traffic). Not charging-idle, not requantize-in-place, not on-device PPL rollback. |
| **Apple on-device adapters** https://machinelearning.apple.com/research/introducing-apple-foundation-models | Overnight/idle **personal** specialization on-device with memory discipline — **trained adapters**, not physical requant/layout of MoE experts. |

### Remaining sliver (do not treat as NOVEL)

Daemon: charging ∧ idle → replay **this device's** router log → rewrite GGUF (Q2 cold / Q4–Q6 hot, optional E-layout) → tiny PPL probe → rollback. That *product* is unpublished. The science is EdgeMoE + REAP + a cron job. A reviewer will ask why this is not "run REAP+GPTQ on last night's traces." If you still build it, the only non-obvious bit is the **on-device quality gate + atomic rollback** so a bad day of routing cannot brick the phone's model.

### Search queries run (M)

- `personalized quantization per user on-device overnight charging idle expert pruning MoE "usage driven" model restructuring edge`
- `PreMoe "Lightening MoEs" expert pruning on-device usage profile retrieval 2505.17639`
- `Apple Google "on-device personalization" overnight charging idle LLM federated "private compute" model adaptation weights`
- `REAP "Router-weighted Expert Activation Pruning" MoE on-device OR vLLM Lasby`
- `adaptive per-expert bitwidth usage profile device` / `patents recompressing neural network weights based on usage on device` (no closer hit than the papers above)

---

## Cross-check (named systems + new hits)

| System | K (tiered layout JIT) | L (PSI self-shrink) | M (nightly file rewrite) |
|---|---|---|---|
| llama.cpp online-repack | **YES — at load, all tensors** | `--mlock`, `--no-mmap`, `--sleep-idle` | No |
| ik_llama.cpp / ollama / MLC | inherit load-repack | inherit mlock | No |
| EdgeMoE | No | No | **static bitwidth profile** |
| DynaExq / PagedWeight | bitwidth, not SIMD layout | **HBM pressure shrink** | runtime, not on-disk nightly |
| HOBBIT / DyMoE | No | No | No |
| PreMoe / REAP | No | No | **usage → new expert set / file** |
| Apple adapters / PCC | No | adapter swap for RAM | **personal, on-device, not requant** |
| Android `onTrimMemory` | No | **evict whole model** | No |
| ExecuTorch / ORT / LiteRT | No | app-level, not class-aware | No |
| JVM HotSpot | **policy analog** | — | — |

---

## Bottom line

| Candidate | Verdict | One-sentence reason |
|---|---|---|
| **K Chaperones** | **NEAR-DUPLICATE (llama.cpp online-repack, PR #9921)** | Same Q4→i8mm interleave, shipped at load. Background/hot-only in an expert cache is a **timer change** after `--no-repack` made the cost visible. |
| **L Autophagy** | **NEAR-DUPLICATE (`onTrimMemory` + `--mlock` + DynaExq)** | Engines already pin, already unload on pressure/idle, already shrink experts under a memory budget. PSI + class-aware pin is a **sensor fusion**, not a new idea. |
| **M REM sleep** | **NEAR-DUPLICATE (EdgeMoE + PreMoe/REAP + Apple adapters)** | Usage→bitwidth/prune→new file is published; overnight personal on-device is Apple's adapter slot. The cron+PPL-rollback **product** is unpublished; the science is not. |

**Do not schedule any of the three as "nobody has even tried it."**  
If something still ships: K is the cheapest incremental (idle thread over existing ggml_repack); L is OS-hygiene the kernel already half-does; M is REAP+GPTQ in a charging job — budget the quality-gate, not the novelty.

DONE
