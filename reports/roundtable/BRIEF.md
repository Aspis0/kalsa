# SHARED GROUND TRUTH — read this before writing anything

This file is the **only** source of measured numbers for this roundtable. Every participant
must respect it. If you believe a number here is wrong, say so explicitly and show the
arithmetic — do not silently substitute your own.

Three tiers of confidence are marked throughout:

- **[M]** measured on the device, in `results/runs.csv`, reproducible
- **[D]** derived from [M] by arithmetic — check the arithmetic, it may be wrong
- **[U]** unverified / assumed — treat as a hypothesis, not a fact

---

## 1. The system under study

**Goal**: run a 35B-parameter MoE language model on a stock consumer smartphone, at a speed
and quality that make it usable as a chat assistant, by streaming experts from flash storage
instead of holding the model in RAM.

**Device** — Samsung Galaxy S23, unrooted, stock Android:
- SoC Snapdragon 8 Gen 2 (SM8550) [M]
- CPU: 1× Cortex-X3 (cpu7), 2× Cortex-A715 (cpu3-4), 2× Cortex-A710 (cpu5-6),
  3× Cortex-A510 (cpu0-2) [M]
- 8 GB LPDDR5X; ~7.2 GB usable; **lmkd kills the process at roughly 5.6 GB RSS** [M —
  a run with `--cache-mb 3000` was killed mid-model-load]
- Storage: UFS 3.1, 128 GB [M]
- GPU: Adreno 740. **Not** in llama.cpp's OpenCL supported-adreno list (750/810/830/840/
  X1-85/X2-90 are). `MUL_MAT_ID` (the MoE dispatch op) has OpenCL kernels only for
  Q4_0, Q4_1, Q4_K, MXFP4 — **not** for any IQ quant [M, from upstream source]
- Hexagon DSP present; its thermal zones (`nspss-0..3`) are readable, nothing else about it
  is currently reachable without Qualcomm's non-public stack [M]
- No root. Runtime lives in Termux and must be in `cpuset:/top-app` to be allowed more than
  3 cores; in `cpuset:/background` it gets only the 3 A510s [M — this confounded an entire
  day of measurements: 0.82 tok/s on 3 little cores vs 5.06 on the full set]

**Storage baseline** [M]: `fio` random read at 1 MiB block size ≈ **413 MiB/s**.

**Model** — Qwen3.6-35B-A3B, unsloth GGUF `UD-IQ2_M`, **11.52 GiB** on disk [M].
- `token_embd.weight` = Q5_K, `output.weight` = Q4_K, `attn_output.weight` = Q5_K — the
  token-selection path is **not** at 2 bits; only the expert MLPs are [M]
- Quality has been checked by human reading of 5 prompts (chat IT, reasoning, coding,
  summarisation, tool-call): verdict **usable**, with roughly **2 malformed words per
  ~1000 tokens** [M, but a weak instrument — see §5]

**Runtime** — BigMoeOnEdge (`b0c4e5b`), a fork of llama.cpp with an LRU expert cache that
streams experts from the GGUF on flash. Relevant flags: `--moe-stream`, `--cache-mb`,
`--dense-weights anon|ahwb`, `--overlap`, `--io-threads`, `--route-trace`,
`--drop-cold-experts`.

---

## 2. The headline measurement [M]

Best validated configuration: `t=4 --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4`, screen on, process in `top-app`, unplugged, cold page cache via
`posix_fadvise(DONTNEED)`, 180 s cooldown, 64 generated tokens, `--temp 0`.

| quantity | value |
|---|---|
| decode speed (warm median of 3 reps) | **5.02 tok/s** |
| cold run / reps / anti-drift sentinel | 5.06 / 5.02 / 5.08 / 4.97 |
| `decode` | **0.201 s/tok** |
| `compute` | **0.116 s/tok** |
| `cache_mgmt` | **0.012 s/tok** |
| `flash_io` | **0.319 s/tok** |
| reported throughput | **266 MiB/s** |
| bytes read per token | **84.73 MiB/tok** |
| expert hit rate (per request) | **56.9%** |
| peak RSS | ~4.6 GB |
| time to first token | ~27.5 s (≈19 s model load + ≈10 s prefill) |

## 3. Architecture and derived quantities

> **This section was corrected after Round 0.** An earlier version of this brief carried
> wrong figures (343 MB/token naive, ~45 layers, 74% byte hit). They are wrong and are
> superseded below. You are still expected to **verify the corrected values independently** —
> do not simply inherit them. The error that produced them is instructive and is stated so
> you can check whether it contaminated anything else.

**Architecture** [V — from the GGUF metadata dump, `PLAN.md` §3.1 and §5]:

| property | value |
|---|---|
| `general.architecture` | `qwen35moe` |
| layers (`block_count`) | **40** |
| routed experts per layer (`expert_count`) | **256** |
| active routed per token (`expert_used_count`) | **8** |
| shared expert | **1, always-on, RESIDENT in RAM — never streamed** |
| active params/token | ~3B (8 routed + 1 shared) |
| `embedding_length` | 2048 |
| `expert_feed_forward_length` | 512 |
| attention | hybrid, `full_attention_interval=4` → 10×(3 Gated DeltaNet → 1 Gated Attention) |
| KV cache | 10 full-attn layers of 40, 2 KV heads × head_dim 256 → ≈10 KB/token, ≈40 MB at 4k [S] |

**Expert size at IQ2_M** [V]: **942 080 B = 0.942 MB** in 37/40 layers (gate IQ2_XXS + up
IQ2_XXS + down IQ3_XXS); **1 097 728 B = 1.098 MB** in layers 34, 38, 39 (down raised to
IQ4_XS).

**Derived** [D]:

```
naive traffic/token = 8 routed × (37 × 942080 + 3 × 1097728)
                    = 305 201 152 B = 305.2 MB/tok = 291.1 MiB/tok
actual traffic      = 84.73 MiB/tok = 88.8 MB/tok                      [M]
byte-level hit rate = 1 − 84.73/291.1 = 70.9%
expert-loads/token at 0% hit = 8 × 40 = 320
```

The **70.9% byte hit** and the **56.9% per-request hit** answer different questions; both are
informative. Note also [M, from the F4.5 quality checkpoint]: Italian chat traffic shows
**71–77% request-hit** against the benchmark prompt's 56.9% — real product traffic has better
locality than the gate number suggests.

**The error that produced the old figures**, for calibration: 343 MB/token came from counting
**9** experts per layer instead of 8 — i.e. from charging the always-on shared expert to
per-token flash traffic, when it is resident and read once at load. `37×9×0.942 +
3×9×1.098 = 343`. The "~45 layers" figure in the old brief was then back-inferred *from* that
bad number and was never real. Check whether this same double-count appears anywhere else.

## 4. Resolved: the runtime is AT the storage ceiling [settled in Round 0 — verify it]

The F4 report concluded "266 MiB/s achieved vs 413 MiB/s available on fio, therefore there is
bandwidth headroom". **That conclusion is an artefact of dividing by summed thread time.**

```
84.73 MiB/tok ÷ 0.319 s/tok  = 265.6 MiB/s   ← the reported 266: bytes ÷ SUMMED I/O thread-seconds
84.73 MiB/tok × 5.02 tok/s   = 425.3 MiB/s   ← wall-clock delivered throughput
```

`t_flash_io` cannot be exclusive wall-clock I/O time, because `0.201 s/tok` of decode cannot
contain `0.319 s/tok` of anything, and `0.116 + 0.012 + 0.319 = 0.447 ≠ 0.201`. It is
thread-seconds. An independent cross-check via an overlap model, `t_decode ≈ t_cache +
max(t_compute, t_io_wall)` ⇒ `t_io_wall ≈ 0.189 s/tok` ⇒ `84.73/0.189 ≈ 448 MiB/s`, lands in
the same band.

So delivered wall-clock throughput is **420–450 MiB/s** against a measured fio 1 MiB
random-read ceiling of **413 MiB/s**. We are at, or marginally above, the device ceiling —
the slight overshoot is consistent with residual page-cache hits, partial contiguity between
co-activated experts, and buffered-vs-DirectIO path differences.

**Consequence, which reshapes the whole hypothesis space:** "make the I/O faster by adding
workers or queue depth" is **dead** at the current layout. What remains live is *fewer
bytes*, *more contiguous bytes*, *a different I/O path*, or *not needing the bytes on the
critical path at all*. The failed fifth I/O thread (`t=3 --io-threads 5`: `flash_io` 0.319 →
0.359, throughput 266 → 236, speed 5.02 → 4.835 [M]) is the signature of saturation, not
starvation, and now has an explanation.

**If you want to reopen this**, the one measurement that would settle it beyond argument:
sample `/proc/<pid>/io` `read_bytes` over a fixed 64-token window with a cold page cache,
while a background `fio` 1 MiB random job competes. If the app sustains 400+ MiB/s and fio
collapses, the ceiling is confirmed. If the app stays under 300 MiB/s while fio keeps its
bandwidth, there is a software path bug and the headroom story returns. [not yet measured]

## 4b. A project hypothesis that is FALSIFIED and had not been noticed

`PLAN.md` §7 states **H2**: *"an expert cache in DRAM with a ~2 GB budget reduces flash
traffic ≥5× vs naive"*, target **≤50 MB/token**. Measured: **88.8 MB/token at exactly that
2 GB budget** [M]. H2 as written is **not met** — the reduction is 3.4×, not 5×.

This matters beyond bookkeeping: the literature's LRU expert-cache results claim 80–90% hit
at "2× working set". We get 71% byte hit. Either the working set is larger than assumed, or
LRU is materially weaker here than the offline policies those papers compare against, or the
benchmark prompt has unusually poor locality (the Italian-chat 71–77% request-hit figure
supports the last). **Deciding which is a live research question, not a knob.**

## 5. What we do NOT know, and must not pretend to know

1. **The hit-rate curve h(C).** We have exactly **one** point: C = 2000 MB → h ≈ 74% [D].
   `--cache-mb 3000` was never measured in a valid regime (lmkd killed it during load).
   The shape of h(C) — and therefore the marginal value of every extra MB — is unknown.
2. **The access distribution over experts.** Never traced in the valid regime. Route traces
   are supported by the runtime (`--route-trace`) but the analysis has not been done.
3. **Sustained behaviour.** Every number above comes from 64-token bursts with a 180 s
   cooldown. An earlier phase suggested roughly **half** the burst speed after 10 minutes,
   but that was measured in the invalid 3-core regime and is not trustworthy.
4. **Quality, quantitatively.** The only instrument is 5 human-read prompts. It would catch a
   catastrophe; it cannot distinguish a 5% degradation from noise. There is no perplexity
   baseline on any corpus, and the target language is Italian.
5. **Prefill.** ~10 s for a short prompt. Never optimised, never decomposed.
6. **Battery.** Speed is **flat** from 32% to 24% charge (4.84 / 4.98 / 4.84 / 4.92 tok/s)
   with power-saver off and thermal status 0 [M]. No effect observed *yet*.
7. **Thermals.** The battery sensor reads 31 °C while `cpu-1-5` reads 36.4 °C and the AP die
   touched **47.1 °C inside a single decode** [M]. All thermal gating so far has been on the
   battery sensor, i.e. on a slow, damped proxy. Android reported `Thermal Status: 0`
   throughout, so nothing has been throttled yet.

## 6. Hard constraints on any proposal

A proposal that violates one of these is not interesting, however elegant:

- **No root.** Nothing that needs a custom kernel, a modified init, or privileged sysfs writes.
- **Stock Android, stock storage.** No ZNS, no raw block device, no filesystem replacement.
- **8 GB RAM, hard.** lmkd kills around 5.6 GB RSS. The model is 11.52 GiB — it *cannot* be
  resident.
- **Quality is a first-class constraint.** Any lossy lever must come with a way to measure
  what it cost, and the current instrument is not good enough to license one.
- **The product is a chat assistant.** Both tok/s *and* time-to-first-token matter. A change
  that doubles decode speed but triples TTFT may be a net loss.
- **Energy matters** — this is a phone. A change that is faster but drains the battery twice
  as fast is a different product, not a better one.
- Measurements are never taken while charging; runs are cooled and gated.

## 7. What has already been tried, and failed [M]

Do not re-propose these without a new argument for why they would work now:

| lever | result |
|---|---|
| more I/O threads (`t=3 --io-threads 5`) | **−3.7%** — I/O got *slower*, looks like saturation |
| `--cache-mb 3000` | killed by lmkd during load; RAM ceiling |
| `taskset` to widen core affinity | cannot widen beyond the cgroup's cpuset; no effect |
| naive mmap of the 11.5 GiB model (no streaming) | ~0.10 tok/s — this is the wall the whole project exists to get around |

## 8. Where the project stands

The engineering gate has passed: 5.02 tok/s is above the 3 tok/s threshold that was set in
advance, and the quality is usable. What remains is not "make it work" but "understand what
actually limits it, and whether the limit can be moved by an idea rather than by a knob".
Every knob that was easy to turn has been turned.
