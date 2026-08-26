# SCOUT — q62: pp512 prefill under the PRODUCT streamer (CalaQwen KEXP, Xiaomi)

> READ-ONLY scouting report. All file:line references are permalinks into the `BigMoeOnEdge`
> submodule at commit pinned by `moe-experiments/.gitmodules`.

---

## 1. Streamer entry points

### Binary and CLI

The streamer has **one binary**: `bmoe-cli` (`BigMoeOnEdge/cli/main.cpp`). There is no
llama-bench-like bench wrapper for the streaming path — `llama-bench` (from llama.cpp upstream)
does not know about `--moe-stream` or the eval-callback hook, so it **cannot** exercise
streaming. Every on-device streaming measurement in this repo uses `bmoe-cli`.

| What | File : line | Note |
|------|-------------|------|
| Entry point | `cli/main.cpp:main()` | Parses flags → `RunConfig` → `validate()` → `Session::open()` → `Session::generate()` |
| Flag `--moe-stream` | `cli/main.cpp` (arg parse) | Sets `cfg.moe.enabled = true`; this is the master switch |
| Flag `--cache-mb N\|auto` | `cli/main.cpp` (arg parse) | `0` = off (shared slots); `>=1500` = LRU cache; `auto` = device-sized |
| Flag `--ubatch N` | `cli/main.cpp` | Controls `cparams.n_ubatch`; a smaller value hands RAM back to the cache at the cost of prefill speed |
| Flag `--overlap` | `cli/main.cpp` | Needs the Helldez/llama.cpp fork branch (the `expert-ready` hook, `~25 lines`). Serial path builds against stock upstream |
| Flag `--dense-weights anon\|warm\|mmap` | `cli/main.cpp` | `anon` (default): O_DIRECT read into anon buffers, rebind tensors |
| Flag `--io-threads N` | `cli/main.cpp` | Parallel read lanes [1..8]; 4 measured sweet spot on UFS4 |

### How prefill is driven

`Session::generate()` (`core/src/engine/session.cpp:1274–1318`) runs prefill as a loop:

```cpp
for (int i = (int) n_common; i < n_prompt; i += im.cfg.n_batch) {
    const int chunk = std::min(im.cfg.n_batch, n_prompt - i);
    // ... build llama_batch pf ...
    trace_begin(i, chunk, /*phase*/ 0);  // phase 0 = prefill
    if (llama_decode(ctx, pf) != 0) { ... }
    trace_flush();
}
```

- `n_batch` defaults to 512 (llama.cpp default). With `-p 512` the entire prompt is one chunk.
- `n_ubatch` (`--ubatch`) controls the **compute buffer reservation** (`session.cpp:701`):
  `cparams.n_ubatch = cfg.n_ubatch > 0 ? cfg.n_ubatch : cfg.n_batch`. The reservation is
  `ubatch × vocab × sizeof(float)` for the logits buffer — at ubatch 512 and 152k vocab this
  is ~300 MiB; at ubatch 64 it is ~38 MiB. The ubatch does **not** split prefill chunks; it
  sets how wide the graph is when `llama_decode` runs.

### The eval-callback fires during prefill too

When `--moe-stream` is on, the eval-callback is installed (`session.cpp:702–706`):

```cpp
if (cfg.moe.enabled || compute_trace) {
    cparams.cb_eval = &RouterHook::c_eval;
    cparams.cb_eval_user_data = im.hook.get();
}
```

This means the routing hook fires on **every** `ffn_moe_topk-<il>` node during prefill. For
pp512, the union of 512 × k routed experts ≈ all 128 experts per layer, so the streaming path
reads **every expert** — the cache is irrelevant during prefill (the comment at
`session.cpp:1328` confirms: "prefill routes near the whole bank"). The cache only starts
helping from the first decode token onward.

**Consequence for q62**: a pp512 prefill under `--moe-stream` exercises the streaming path
but with the cold-cache worst case: every expert is a cache miss, and every expert is read.
The measurement is meaningful as a **flash I/O ceiling** and **compute floor** for the
streaming engine, but it is NOT the steady-state streaming performance (decode).

---

## 2. How experts are read

### File API: pread (O_DIRECT), NOT mmap

Expert reads use **positioned reads** (`pread`), not mmap. The streamer explicitly rebinds
expert tensors away from the mmap'd file onto its own buffers and uses O_DIRECT to bypass
the page cache.

| Component | File : line | Mechanism |
|-----------|-------------|-----------|
| FileReader::open | `core/src/io/file_reader.cpp:38–131` | Opens each shard fd per lane; verifies O_DIRECT correctness with a compare-then-fallback test |
| FileReader::read | `core/src/io/file_reader.cpp:136–198` | `pio::pread_at(fd, ...)` in a loop; O_DIRECT path uses aligned bounce buffer, `memcpy` to destination |
| ExpertStreamSource::read_slice | `core/src/moe/expert_stream_source.cpp:300–320` | Wraps `FileReader::read()` with I/O trace timing |
| ExpertStreamSource::load_layer | `core/src/moe/expert_stream_source.cpp:700–800` | Stages jobs (file offset + dst buffer), dispatches to I/O lanes, waits for completion |

### Block size

- **Slice size**: one expert's projection = `nb[2]` bytes (the tensor's second-dimension stride
  × n_expert gives the full tensor; one expert = `nb[2]`). For Qwen3.6-35B-A3B-KEXP this is
  ~2–6 MiB per projection per layer (3 projections × 128 experts × 48 layers).
- **Alignment**: `align_ = 4096` (page size). O_DIRECT reads are rounded to alignment boundaries
  (`file_reader.cpp:175–176`).
- **No explicit block-size flag**: the engine reads exactly the expert slice size, not a fixed
  block. The "~1 MiB expert block" description in the task is approximately right for the KEXP
  recipe: each expert's three projections sum to a few MiB.

### Cache

- **LRU cache**: per-(layer, expert) entry; pages committed on first miss, released on eviction
  via `madvise(MADV_DONTNEED)` / `MEM_DECOMMIT` (`expert_stream_source.cpp:800–850`).
- **Budget**: `--cache-mb N` sets the total; `--cache-mb auto` sizes from `MemAvailable` minus
  `--cache-floor-mb` (default 1536 MiB), clamped to `[1500, total_expert_bytes]`.
- **The cliff** (`docs/cache-sizing.md`): below `token_demand_MiB` the hit rate is exactly 0%,
  not "low". For Qwen3.6-35B top-6: `token_demand_MiB` ≈ 40–60 MiB (6 active experts × ~7 MiB
  per expert per layer × 48 layers / many ≈ cumulative unique per token). If the budget is
  below this, every evicted entry is re-read within the same token cycle.

### Counters the engine prints (in `bmoe-cli` `--progress` output)

From `core/include/bmoe/metrics.h` and `docs/telemetry.md`:

| Counter | Where printed | Meaning |
|---------|---------------|---------|
| `moe-stream: read X MiB` | `--progress` summary + per-token `BMOE_LOAD` | Flash bytes pulled this token/total |
| `moe-cache: X% hit, resident Y MiB` | summary | Cumulative LRU hit rate + current cache residency |
| `moe-stream: compute X + cache mgmt Y + flash I/O Z s/token` | summary | Per-token breakdown |
| `moe-stream: stall_ms` | `BMOE_PROGRESS` per-token | Overlap-only: wall time compute waited on flash |
| `moe-cache: evictions X, rereads Y` | summary (via `RunSummary`) | Cache churn diagnostics |
| `moe-spec: X MiB spec-read, Y useful / Z prefetched` | summary | Prefetch efficiency |
| Per-token `io_ms`, `compute_ms`, `mgmt_ms`, `stall_ms` | `BMOE_PROGRESS` JSON line | Decomposition for CSV sink |
| `majflt`, `cpu_ms`, `dense_resident_frac` | `BMOE_PROGRESS` JSON line | Dense-residency stall signal |

**Key point for q62**: the engine already provides `io_ms` (flash read time), `compute_ms`
(residual), `mgmt_ms` (cache management), and `majflt`/`cpu_ms` in its own telemetry.
The `/proc` sampler (utime, stime, read_bytes, majflt) is a **cross-check**, not the primary
source. For pp512 prefill, the engine's own timing is more accurate because it measures the
streaming path's I/O latency directly (the time blocked on `pread`), while the `/proc` sampler
sees aggregate user+sys time without the I/O attribution.

---

## 3. Existing on-device deployments

### Binaries on the Xiaomi (SM8650 / houji / UFS 4.0)

From `q61 inventory.json` (`scratchpad/agents/q61-xiaomi-ufs4-streaming-floor/inventory.json`):

| Binary | Path on device | Size | SHA256 (prefix) | Notes |
|--------|----------------|------|-----------------|-------|
| llama-bench (kalsa16) | `/data/local/tmp/kalsa16/llama-bench` | 7600 B | `b2ae0fa6...` | Wrapper; impl .so at `libllama-bench-impl.so` (4.2 MB, `8adc148c...`) |
| llama-bench (gdn_750) | `/data/local/tmp/gdn_750/bin/llama-bench` | 6.2 MB | `5092a319...` | Different build |
| llama-bench (kalsahtp) | `/data/local/tmp/kalsahtp/llama-bench` | 7536 B | `5db18906...` | HTP-linked |
| **bmoe-cli** (from kalsa16) | NOT on device yet | — | — | Must be pushed |

**bmoe-cli has NOT been run on the Xiaomi.** The q61 cell used `llama-bench` (which does NOT
exercise streaming). The q60 cell on the Jelly used `llama-bench` too, with the plan noting
that `bmoe-cli` is the streaming measurement tool. q62 would be the **first `bmoe-cli`
streaming measurement on the Xiaomi.**

### Models on the Xiaomi

| Model | Path | Size (GB) | Streaming? |
|-------|------|-----------|------------|
| **Qwen3.6-35B-A3B-KEXP** | `/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf` | 13.42 | **YES** — 13.4 GB > MemAvailable (~6 GB) = streaming regime |
| Marco-Mini-KEXP (Q8_0 trunk) | `/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` | 6.51 | Borderline (6.5 GB < MemTotal 11.4 GB but ≈ MemAvailable) |
| Marco-Mini-KEXP | `/data/local/tmp/gdn_750/taskb/Marco-Mini-Instruct-KEXP.gguf` | 6.39 | Same |
| Mellum2 Q4_K_M | `/data/local/tmp/ship_ab/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` | 8.07 | Yes (8 GB > 6 GB available) |
| LFM2.5-8B-A1B-KEXP | `/data/local/tmp/kalsa16/LFM2.5-8B-A1B-KEXP.gguf` | 3.33 | No (fits in RAM) |

**CalaQwen KEXP = Qwen3.6-35B-A3B-KEXP.gguf**, sha `ac44e20c...`, 13416430592 bytes
(13.42 GiB). This is the model the task targets.

### Mellum2 product number

From `PLAN.md:607,714,824`: **5.151 t/s** is the Mellum2-S23 decode product number
(k6d1.0, stock t2, `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4
--ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm`). This is the
**decode** benchmark, not prefill. The Mellum2 product number was measured with `bmoe-cli`
on the S23.

The `lineup-abs` REPORT confirms the product binary for Mellum2 was at
`$HOME/bin/mellum2/bmoe-cli` with its own `.so` set, sha `0ac612de...`.

### Product flags (from lineup-abs REPORT, line 18–32)

```
# Marco / CalaQwen campaign config:
-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 --n-expert-used 6 --temp 0 --chatml --no-think

# CalaQwen specific (drop-cold, no-renorm):
--drop-cold-experts 1.0 --drop-no-renorm
```

### q61 results (llama-bench on Xiaomi, Marco-Mini 6.5 GB, pp512)

From `q61 manifest.json`:
- **Cold pp512**: 13.77 s wall, user_share_8t = 0.349, read_MB = 12494 (prefetch+eval),
  majflt = 524, flash-bound
- **Warm pp512**: 10.05 s wall, user_share_8t = 0.485, read_MB = 5099,
  majflt = 598, flash-bound
- **pp2048 cold**: 60.46 s wall, user_share_8t = 0.343, majflt = 117783 (dense-fault storm),
  flash-bound

These are stock llama-bench numbers (NOT streaming). They serve as the non-streaming baseline
for q62's comparison.

### What binary to push for q62

The task needs a `bmoe-cli` build with `BMOE_BUILD_CLI=ON` and `GGML_OPENCL=OFF` (CPU-only,
matching the product decode config). From `bmoe-smoke` REPORT (line 29):

> Existing `build-android-opencl-k4split` bmoe-cli is STATIC (`BUILD_SHARED_LIBS=OFF`,
> 108 MB). [...] Configure a separate bmoe-cli build dir with
> `BUILD_SHARED_LIBS=ON` + `GGML_OPENCL=ON` + `BMOE_BUILD_CLI=ON`.

For q62 CPU-only, the build dir should set `GGML_OPENCL=OFF`. The binary and its .so set
should be pushed to `/data/local/tmp/bmoe_q62/` with LD_LIBRARY_PATH pointing there.

---

## 4. Fair CPU-only pp512 prefill benchmark under the streamer

### Proposed command line

```bash
# Push bmoe-cli + .so set
adb push build-android-q62/* /data/local/tmp/bmoe_q62/

# Push model (already on device)
# /data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf (13.42 GB)

# Run pp512 prefill (no decode: -n 0)
LD_LIBRARY_PATH=/data/local/tmp/bmoe_q62 \
  /data/local/tmp/bmoe_q62/bmoe-cli \
  -m /data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf \
  --moe-stream \
  -p 512 -n 0 -r 3 --no-warmup \
  --cache-mb 0 \
  --dense-weights anon \
  --io-threads 4 \
  -t 4 \
  -c 512 \
  --ubatch 512 \
  --no-think \
  --progress \
  --csv /data/local/tmp/q62_prefill.csv
```

Key design choices:

| Flag | Value | Rationale |
|------|-------|-----------|
| `--cache-mb 0` | Off | During pp512 prefill, all 128 experts per layer are routed (union of 512×k ≈ all). Cache provides zero benefit and wastes RAM. `cache-mb 0` is strictly better than a small cache (docs/cache-sizing.md: "below one token cycle the hit rate is exactly 0%"). |
| `-c 512` | Match pp | Context = prompt size. Saves ~240 MiB of KV reservation vs `-c 4096` |
| `--ubatch 512` | Full width | The graph runs at full width in one pass. A smaller ubatch would chunk the prefill but save compute-buffer RAM — irrelevant when cache is off. |
| `-t 4` | Product thread count | Measured sweet spot for this SoC. `-t 2` might be better (see q60/q61 data: user_share_8t = 0.349 suggests heavy I/O, not compute saturation) |
| `--no-think` | Skip CoT | Qwen3.5/3.6 reasoning models open a thinking channel; `--no-think` gives a clean prefill measurement |
| `-n 0` | Prefill only | No decode tokens; measures prefill wall time exclusively |

### Variants to run

1. **`--cache-mb 0`** (cache off): cleanest measurement of streaming-path prefill I/O
2. **`--cache-mb 2000`**: with cache enabled, to show cache does nothing for prefill
3. **`--cache-mb auto`**: auto-sized, to check if the auto-sizing code handles pp512 correctly
4. **`--overlap`** (if the fork binary is available): shows whether I/O/compute overlap changes prefill

### What "compute share" means under the streamer

From q60 PREREG: `compute_share = (utime+stime)/(n_threads × wall)`, clipped to [0,1].

**Critical caveat for the streaming path**: the I/O threads (`--io-threads 4`) run as
separate threads within the process. `utime` and `stime` from `/proc/<pid>/stat` account
ALL threads of the process — including the I/O worker threads. This means:

- `utime/(8×wall)` where 8 = `n_threads + io_threads` (4 compute + 4 I/O) gives the **true**
  CPU utilization across all threads
- `utime/(4×wall)` where 4 = `n_threads` only **under-counts** the I/O thread CPU time
  (the I/O threads spend time in pread syscall = stime, plus bounce-buffer memcpy = utime)

The product's `--progress` output already decomposes this correctly:
- `io_ms`: wall time blocked on flash reads (serial mode)
- `compute_ms`: residual (wall - io - mgmt)
- `mgmt_ms`: cache-management overhead
- `stall_ms`: overlap mode only (wall time compute waited on flash)

For pp512 under `--cache-mb 0` (no overlap, serial I/O), the engine's `io_ms` is the
**direct measurement** of flash time, and `compute_ms` is the compute residual. The `/proc`
sampler is a secondary cross-check, not the primary metric.

### Extra metrics the engine provides

1. **`moe-stream: read X MiB (Y MiB/token), decode Z s/tok (compute + mgmt + flash)`** — the
   engine's own I/O/compute split, directly from the streaming path's instrumentation
2. **`moe-cache: X% hit`** — will be 0% for pp512 with cold cache (all experts miss)
3. **`token_demand_mib`** and **`layer_demand_mib`** — how many MiB a single token demands
   (from `RunSummary`), the key sizing metric
4. **`majflt` per token** — dense-weight faults during the decode; for pp512 this captures
   dense-set refaults if `--dense-weights mmap` is used (switch to `anon` to eliminate these)
5. **`io-trace`** (`--io-trace PATH`): per-read CSV with (layer, expert, projection, offset,
   req_bytes, read_bytes, latency_ns). This gives the **exact flash bandwidth** per expert
   read — the most granular I/O measurement available.
6. **`compute-trace-layers`** (`--compute-trace-layers PATH`): per-layer wall breakdown
   without serializing the graph. Shows which layers are I/O-bound vs compute-bound during
   prefill.

---

## 5. Risks

### Risk 1: pp512 prefill under streaming is NOT decode-like

The streaming architecture is designed for **autoregressive, one-token-at-a-time decoding**
(`docs/moe-streaming.md:1–4`):

> A batch of T tokens routes the union of T × k experts, which approaches all of them
> for any useful T. So streaming deliberately runs at n=1.

For pp512 (T=512, k=6): 512×6 = 3072 routed slots per layer, but there are only 128 experts
→ the union is ≈128 (all experts). The streaming path fires but reads everything. The cache
does nothing (cold or warm: every expert is needed).

**Consequence**: the pp512 prefill measurement tells you the **flash I/O ceiling** and
**compute floor** of the streaming engine, NOT its steady-state decode performance. This is
useful for characterizing the "first prompt" case but should not be confused with the
sustained tok/s number.

### Risk 2: Memory headroom

| Quantity | Value |
|----------|-------|
| Model size | 13.42 GiB |
| MemTotal | 11.44 GiB |
| MemAvailable (at inventory time) | 6.05 GiB |
| KV cache (c=512, 48 layers) | ~80 MiB |
| Compute buffer (ubatch=512) | ~300 MiB |
| Dense weights (anon buffers) | ~4.5–5 GiB (embeddings + attention + norms + lm_head) |
| Expert cache (if --cache-mb 2000) | 2000 MiB |
| I/O bounce buffers (4 lanes × ~6 MiB) | ~24 MiB |

With `--cache-mb 0` and `--dense-weights anon`:
- Dense anon: ~5 GiB (the dense set is the complement of expert bytes in the file)
- KV + compute: ~380 MiB
- **Total ~5.4 GiB**, MemAvailable ~6 GiB → **tight but fits**

With `--cache-mb 2000`:
- +2000 MiB cache = ~7.4 GiB → **exceeds MemAvailable**, LMK risk

With `--cache-mb auto`:
- Budget = MemAvailable - floor_mb = 6050 - 1536 = 4514 MiB, but the dense conversion
  hasn't happened yet when auto sizes → the budget is over-committed by ~5 GiB
- `--cache-ceil-mb 2000` would be the safety cap

**Recommendation**: run pp512 with `--cache-mb 0` first (safest, measures pure streaming
I/O). If cache measurement is needed, use `--cache-ceil-mb 2000` with `--cache-mb auto`.

### Risk 3: The OOM wall (q61 finding)

From `q61 manifest.json` anomalies: "the selected model is secondary borderline: 6.5 GB file
is > current MemAvailable but < MemTotal". The CalaQwen KEXP at 13.4 GB is **well beyond**
MemAvailable. Under `--dense-weights anon`, the dense set (~5 GiB) moves into anonymous
buffers that the kernel cannot reclaim. Combined with the KV, compute buffers, and any cache,
this **will** push the process past MemAvailable.

The `--cache-ceil-mb` flag exists for this exact case (`docs/cache-sizing.md`): bound the
auto-sized budget so it doesn't claim all headroom the dense set is about to consume.

### Risk 4: /proc/pressure/io unreadable

From q61: `/proc/pressure/io` returns "Permission denied" on this device (non-root). PSI
data is unavailable. This means the I/O stall cross-check from q60's method is blind. The
engine's own `io_ms` / `stall_ms` counters are the only I/O attribution available.

### Risk 5: pp512 prefill bypasses the streaming cache by design

This is not a bug — it is the architecture. But it means a pp512 "streaming prefill" benchmark
is actually measuring "the streaming engine's mmap-to-O_DIRECT rebind overhead + O_DIRECT read
bandwidth for the full expert bank". The q60/q61 measurements with stock `llama-bench`
(mmap-only) serve as the baseline: the difference between stock mmap pp512 and `bmoe-cli
--moe-stream` pp512 is the overhead of the streaming rebind + O_DIRECT vs kernel-served mmap.

---

## 6. Proposed exact command lines

### Primary cell: pp512 cold prefill, cache off

```bash
adb shell "cd /data/local/tmp && \
  LD_LIBRARY_PATH=/data/local/tmp/bmoe_q62 \
  /data/local/tmp/bmoe_q62/bmoe-cli \
  -m /data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf \
  --moe-stream \
  --cache-mb 0 \
  --dense-weights anon \
  --io-threads 4 \
  -t 4 \
  -p 512 -n 0 -r 3 --no-warmup \
  -c 512 \
  --ubatch 512 \
  --no-think \
  --progress \
  --csv /data/local/tmp/q62_prefill_cache0.csv \
  2>/data/local/tmp/q62_prefill_cache0.stderr.txt"
```

### Secondary cell: pp512 cold prefill, cache 2000 MiB

```bash
# Same as above but:
  --cache-mb 2000 --cache-ceil-mb 2000 \
  --csv /data/local/tmp/q62_prefill_cache2000.csv \
  2>/data/local/tmp/q62_prefill_cache2000.stderr.txt
```

### Tertiary cell: pp512 with io-trace (diagnostic)

```bash
# Same as primary but add:
  --io-trace /data/local/tmp/q62_prefill_io_trace.csv
```

### Instrumentation plan

1. **Engine-native** (primary): `--progress` gives per-token `io_ms`, `compute_ms`, `mgmt_ms`,
   `majflt`, `cpu_ms`, `read_mb`, `cache_hit_pct`. The `--csv` flag writes all per-token
   metrics to CSV. The `--io-trace` flag gives per-read latency. The summary line gives
   aggregate `moe-stream:` and `moe-cache:` numbers.

2. **/proc sampler** (cross-check): deploy `q60_sampler.sh` alongside each launch. Samples
   `utime`, `stime`, `majflt`, `read_bytes` at 1 Hz. Derive `user_share_8t = utime/(8×wall)`.
   Note: this includes I/O thread time.

3. **Thermal guard**: deploy `q56-thermal-watchdog/thermal_guard.sh` with WARN=40°C, KILL=43°C.
   Cool-start ≤ 32°C, unplugged, battery ≥ 45%.

4. **Cold protocol**: sha256sum the model file, then ≥600 s idle without touching it. Rep 1 =
   cold, reps 2–3 = warm. Each rep a separate launch.

5. **Stderr timeline**: capture stderr to file; extract load-start and eval-start markers
   (timestamps from bmoe-cli) to split load time from prefill time.

---

## 7. Open questions

1. **Does the eval-callback fire during prefill in `llama_decode` for a batch?** The code at
   `session.cpp:1302` checks `im.source.fatal()` after prefill decode, confirming overlap I/O
   runs during prefill. The callback is installed for all decode calls. But the batch-width
   routing (512 tokens → all experts) means the load_layer path reads everything regardless.
   Need to confirm with `--io-trace` that per-read rows appear during prefill (they should).

2. **What is `token_demand_mib` for Qwen3.6-35B-KEXP at top-6?** This determines the minimum
   cache size for decode. From the model shape: 128 experts, 48 layers, 3 projections per
   expert, ~3 MiB per expert projection → `token_demand` ≈ 6 experts × 3 proj × ~3 MiB × 48
   layers = ~2.6 GiB cumulative unique. This is above the 1500 MiB cache floor, so the cache
   should work if budget ≥ ~3 GiB.

3. **Is there enough storage to push bmoe-cli + .so?** The Xiaomi has ~299 GB free on /data.
   The binary + .so set is ~10 MB. No issue.

4. **Should the ubatch be smaller to save RAM?** With `--cache-mb 0` the compute buffer is the
   only large reservation. At ubatch 512 it is ~300 MiB; at ubatch 64 it drops to ~38 MiB.
   Since cache is off, the RAM saving doesn't help — but it reduces the chance of the kernel
   OOM-killing the process before the measurement starts. Worth trying ubatch=64 as a safety
   variant.

5. **Overlap during prefill?** The `--overlap` flag requires the fork branch. If available,
   it would show whether I/O/compute overlap helps prefill (likely not, since the batch routes
   all experts and there is nothing to overlap — every expert must be read before the matmul
   can proceed). But the fork binary must be built and pushed separately.

6. **Thread count: t=4 vs t=2?** The q61 data on Marco 6.5 GB shows user_share_8t = 0.349
   (cold) and 0.485 (warm) with t=8. For a 13.4 GB model (heavier I/O), t=4 may already be
   I/O-saturated. A t=2 variant would show whether the compute is the bottleneck or the I/O.

---

## 8. PREREG skeleton

```markdown
# q62 — pp512 prefill under the PRODUCT streamer: CalaQwen KEXP on Xiaomi (PREREG)

**Status: DRAFT — pending owner review.**

## Model / device
Xiaomi houji (SM8650, 12 GB RAM, UFS 4.0). Model: Qwen3.6-35B-A3B-KEXP.gguf
(13416430592 B, sha `ac44e20c...`) — streaming regime (13.4 GB > ~6 GB MemAvailable).
Binary: bmoe-cli CPU-only build, pushed to `/data/local/tmp/bmoe_q62/`.
CPU-only (`-ngl 0`), `--moe-stream`, `--dense-weights anon`.

## Measurement (thermal guard WARN 40 / KILL 43, cool-start ≤ 32°C, unplugged)
- Cold protocol: sha256sum model, ≥600 s idle, then rep 1 cold; reps 2–3 warm.
- Primary: `bmoe-cli -m <KEXP> --moe-stream --cache-mb 0 --dense-weights anon
  --io-threads 4 -t 4 -p 512 -n 0 -r 3 --no-warmup -c 512 --ubatch 512
  --no-think --progress --csv <out.csv>`
- Variants: cache-2000 (`--cache-mb 2000 --cache-ceil-mb 2000`), ubatch-64, t=2.
- Instrumentation: engine `--progress` + `/proc` sampler (utime/stime/majflt/read_bytes)
  at 1 Hz + stderr timeline for load/eval split.

## Derived quantities (per rep)
- Prefill wall (from engine summary: `prefill_seconds`).
- I/O share: `io_ms / wall_ms` (engine-native); cross-check: `read_bytes / wall` → MB/s.
- Compute share: `compute_ms / wall_ms` (engine-native); cross-check: `utime / (n_threads × wall)`.
- Dense faults: `majflt` from engine (direct around `llama_decode`).
- Cache hit: from engine summary (expected 0% for cache-off; expected ~0% for cache-on
  during prefill since all experts are routed).

## Decision rule
- If compute_share(pp512, cache-0, warm) ≥ 0.50 → prefill has ≥ 2× compute headroom;
  NPU/HVX for prefill is viable as phase 2.
- If < 0.30 → I/O-bound; NPU cannot help prefill.
- 0.30–0.50 → owner decision with numbers.

## Outputs
`RUN_LOG.md`, `manifest.json`, `raw/`, `REPORT.md`.
```

---

*Scouting complete. File written to `scratchpad/agents/q62-product-streamer-prefill/SCOUT.md`.*
