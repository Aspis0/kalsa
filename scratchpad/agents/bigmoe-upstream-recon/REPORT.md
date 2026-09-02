# BigMoeOnEdge Upstream Recon — 31 Commits (b0c4e5b..FETCH_HEAD)

**Date:** 2025-08-30
**Repo:** `/Users/marco/Projects/kalsa-moe-experiments/BigMoeOnEdge` (our fork checkout)
**Merge-base:** b0c4e5b | **Our sole local commit:** 9f2584f (submodule repoint)
**Upstream:** Helldez/main via FETCH_HEAD

---

## Priority Commit Deep-Dives

### 1. `4334c89` — Cache-Aware Expert Substitution (`--expert-substitute`, `--ppl`)

**What it does mechanically:**

Adds a new lossy routing policy: before a decode routing is committed, every expert already in the LRU cache has its router score boosted by `λ × (this token's score range)`, then the top-k is re-taken. A resident expert wins a slot only when it was within that margin of the one it displaces. The number of experts runs is unchanged; fewer of them cost a flash read.

The mechanism walks from the routing IDs tensor back through `GGML_OP_VIEW` / `GGML_OP_ARGSORT` / `GGML_OP_TOP_K` to find the *sorted score tensor* — the one the graph itself produced. It checks if that tensor's op is `GGML_OP_SOFTMAX` to decide log-space vs. raw scoring. Per-token, it computes `(hi - lo)` of all finite scores, multiplies by `λ`, and adds that boost to every *resident* expert's score. Then `rank_top_k()` re-ranks and the ids are overwritten if the *set membership* changed (not just order).

Key code path:
```
core/src/moe/router_hook.cpp:~1340-1470 — apply_substitute()
core/include/bmoe/config.h:149-170 — substitute_lambda field + docstring
core/src/config.cpp:228-240 — validation: requires cache on, λ ∈ [0, 1]
```

**Quality guardrails:**
- Refused without a live LRU cache (`config.cpp:228-234`)
- λ ∈ [0, 1] enforced at validation
- Only fires in decode (`batch_phase_ == 1`), never prefill
- Reports `experts_reranked` / `experts_substituted` in CSV + run summary — inert flag is detectable
- `--ppl` (teacher-forced perplexity) is the quality measurement tool, with `--ppl-step` for decode-regime scoring. Both report what the policy actually did (`ppl-policy:` line), so a flag that touched nothing scores the baseline
- Measured: λ=0.15 on Qwen3.6-35B → 258→119 MiB flash/token, 2.37→3.84 tok/s, ppl +1-4%, tinyMMLU 88→84
- λ=0.30 costs 25% ppl; λ=0.60 "destroys the model (ppl 31)"

**Relevance to our lanes:**

| Lane | Relevance | Notes |
|---|---|---|
| Expert-cache (93.5% hit) | **HIGH** | This is the *same concept* as our expert-cache story but implemented differently. They boost resident experts' scores; we achieve 93.5% cache-hit through our governor's route-trace-aware eviction. Their mechanism is a direct intervention on the routing; ours is a cache management strategy. |
| Governor tri-engine | **HIGH** | Our governor could adopt substitution as a *tool* alongside eviction. When cache is nearly full and a new expert is needed, substituting a near-tie resident expert avoids both an eviction AND a flash read. The lambda parameter maps directly to a governor knob. |
| CPU/NEON repack | LOW | No interaction with repack kernels |
| iOS/macOS | LOW | Substitution logic is pure C++, portable |

**Verdict: IDEA** — The mechanism (boost resident experts by λ × score range, re-rank) is conceptually brilliant and directly applicable to our governor. The *code* is not portable as-is because it walks our specific ggml graph shape and depends on their `RouterHook` / `IExpertSource` / `query_residency()` API. But the *concept* — "before committing routing, check if a resident near-tie can displace a flash-bound winner" — is a governor knob we should design. The `--ppl` quality measurement methodology is also worth stealing for our bench harness.

---

### 2. `9153dcc` — Row-Gathered Dense Tables from Flash (`--row-stream`)

**What it does mechanically:**

A new port `IRowSource` (`core/include/bmoe/row_source.h`) + adapter `core/src/moe/row_stream.cpp` (267 lines) that serves dense weights the graph only *gathers rows from* (like token embeddings) from flash instead of making them resident.

During the **capture decode**, `RouterHook::on_eval` classifies every dense weight reference:
- If a tensor is only ever used as `table` in `GGML_OP_GET_ROWS` with a materialized index → qualifies for row-streaming (`row_gathered_` set)
- Any other use (matmul, tied embeddings as output head) → disqualified (`row_disqualified_` set)
- The verdict is `row_gathered_weights()` = gathered minus disqualified

Qualifying tables are bound to **reserved address space** (not physically present). Before each gather node runs, the eval callback's ask pass calls `row_source_->gather(table, idx, n)`, which pulls only the requested rows from flash in 16 KiB slabs inside a bounded LRU window (`--row-stream-mb`, default 64 MiB).

Key files:
```
core/include/bmoe/row_source.h — IRowSource interface (67 lines)
core/src/moe/row_stream.cpp — RowStream implementation (267 lines)
core/src/moe/router_hook.cpp:~1263-1305 — capture-time classification + eval-time gather dispatch
core/src/moe/dense_weights.cpp:151-220 — take_row_gathered() moves tables out of resident set
docs/row-gathered-tables.md — full documentation
```

**Impact on streaming regime:** The repack kernel coexists. Row-streaming is for *dense* non-expert weights (embeddings), not expert weights. Expert streaming is untouched. The two policies operate on disjoint tensor sets. Measured: Qwen3.8-Flash-Next dense set drops from 4313→3816 MiB (-497 MiB); Qwen3.6-35B drops 2436→1921 MiB (-515 MiB). Expert bytes, cache hit rate, evictions, and re-reads are *identical* with the flag on and off. Throughput is neutral.

**Relevance to our lanes:**

| Lane | Relevance | Notes |
|---|---|---|
| NEON repack kernels | LOW | Different tensor class (dense vs expert) |
| Governor | MEDIUM | Row-streaming returns ~500 MiB to the expert cache budget on our target models — directly increases cache headroom |
| iOS/macOS | MEDIUM | The IRowSource interface is portable C++; the same pattern works on Apple platforms |
| CPU today | MEDIUM | 500 MiB of extra cache on a 6-8 GB phone is substantial |

**Verdict: IDEA** — The mechanism is portable (pure C++ interface, no platform deps), and the capture-time classification (every reference must be a row gather with materialized index) is elegant. We could implement our own `IRowSource` in the kalsa fork. The 500 MiB of dense-set reduction is the *exact* RAM our expert cache competes for. Worth designing into our architecture.

---

### 3. `2a7efae` — Hold Back Dense Tensors Larger Than RAM Under Every Mode

**What it does mechanically:**

Moves the "tensor > MemAvailable → stays mmap'd" logic from being Anonymous/Pinned-only to applying under **every mode** (Mmap, Warmed, Anonymous, Pinned). The new `hold_back_oversized()` method runs first in `DenseWeights::init()`:

```cpp
// dense_weights.cpp:hold_back_oversized()
const uint64_t avail = pio::mem_available_bytes();
for (const DenseTensorRef & d : tensors_) {
    if (d.size <= avail) { keep.push_back(d); continue; }
    mapped_.push_back(d);  // stays mmap'd
    held += d.size;
    subtract_range(ranges_[...], d.file_off, d.file_off + d.size); // carve from sweep/sensor
}
```

Then `advise_random_mapped()` applies `MADV_RANDOM` to every held-back tensor so faults map one page instead of a readahead window. The held-back tensors:
- Leave the resident dense set entirely
- Leave the warm sweep
- Leave the residency sensor (which would otherwise report a set that can never be resident)
- Are not counted by the auto cache budget as a conversion to reserve for

The bound is `pio::mem_available_bytes()` — the kernel's own MemAvailable, not a constant. A tensor that *fits* keeps its mode (demand-faulting a fitting table costs -16% decode per their measurement).

**Comparison with our thinking:**

Our `docs/NPU-FIT-MODEL.md §1` addresses a similar concern (what fits in NPU-accessible memory), but from the *accelerator* side. Their approach is purely kernel-observed RAM availability. The key difference:
- They use `MemAvailable` (kernel's view of what can still be handed out)
- We think in terms of NPU SRAM/direct-mapped regions
- Their `MADV_RANDOM` insight is *directly* applicable: if our app's dense tensors are mmap'd on iOS/macOS, the same advice prevents page-cache pollution

**Relevance to our lanes:**

| Lane | Relevance | Notes |
|---|---|---|
| iOS/macOS | **HIGH** | The `MADV_RANDOM` / `F_NOCACHE` pattern for oversized mmap'd tensors feeds our iOS/macOS lane directly |
| App estimator | **HIGH** | Their admission logic (MemAvailable threshold) is simpler and more robust than complex estimators |
| Governor | MEDIUM | The "hold back oversized" pattern applies to any memory-constrained environment |
| NPU | LOW | Different memory model |

**Verdict: IDEA** — The MemAvailable-based admission + `MADV_RANDOM` for oversized tensors is a clean pattern. The `MADV_RANDOM` advice is directly applicable to our iOS/macOS mmap'd dense weights. The admission logic (one threshold, no complexity) is worth noting against our more complex estimator thinking.

---

### 4. `e02b477` — `F_NOCACHE` Uncached Reads on macOS + `o_direct` Outcome Reporting

**What it does mechanically:**

Three changes:

1. **Apple `F_NOCACHE`**: `platform_io.cpp:open_read()` on Apple now calls `fcntl(fd, F_NOCACHE, 1)` on every reader descriptor when `direct=true`. This is a *caching hint*, not an I/O mode — no alignment contract, no DMA promise. Plain `pread` semantics remain. A refusal is a downgrade to buffered, not a failure.

2. **`aligned_reads_` decoupling**: `FileReader` gains a second boolean `aligned_reads_` alongside `direct_`. On Apple, `direct_=true` (uncached) but `aligned_reads_=false` (no bounce, no alignment, no buffered-tail fd). On Linux, both track O_DIRECT.

3. **Outcome-based telemetry**: The `o_direct` field in CSV preamble, decode-trace header, and streaming banner now reports what the shard opens *achieved* (AND across shards after every platform refusal and open-time downgrade), not what was requested.

Key files:
```
core/src/io/platform_io.cpp:167-187 — Apple F_NOCACHE path in open_read()
core/src/io/platform_io.cpp:388-397 — direct_needs_alignment() returns false on Apple
core/src/io/file_reader.h:62-75 — direct_ vs aligned_reads_ split
core/src/io/file_reader.cpp:19-95 — FileReader::open() revised mechanics
core/src/moe/expert_stream_source.cpp:205-213 — effective_direct_ = AND over all shard readers
```

Measured: 16 GB Apple-silicon Mac, model on external volume, 256-token protocol, interleaved A B B A A B: decode 0.94 vs 0.61 tok/s (+56%, non-overlapping), byte-identical output. The gain is the buffered arm's page-cache pollution doubling the compute residual (1.22→0.60 s/tok) while stall stays flat (0.43→0.46 s/tok).

**Relevance to our lanes:**

| Lane | Relevance | Notes |
|---|---|---|
| iOS/macOS | **CRITICAL** | This is the *exact* API we need. `F_NOCACHE` + `direct_needs_alignment()` separation is the pattern for our Apple platform lane. |
| App vendor port | **HIGH** | Our byte-identical port of their MoE streamer inherits this automatically if we pull it |
| CPU today | LOW | Linux/Android path unchanged |

**Verdict: TAKE** — This is the highest-priority port candidate for our iOS/macOS lane. The mechanism is clean, self-contained in the IO layer, and the `aligned_reads_` decoupling is exactly the abstraction we need. Port effort: **S** (drop-in IO layer change). Conflict risk: **LOW** (we don't modify their IO layer). The `effective_direct_` pattern (AND over shard readers) is also the right telemetry approach.

---

### 5. `927e2d3` + `f24bd5a` — Qwen3.8-Flash-Next + Q2_K Catalog Build

**`927e2d3` What it does:**

Adds `qwen4exp` to `arch_registry.cpp` with standard split suffixes (`ffn_gate_exps`, `ffn_up_exps`, `ffn_down_exps`). The novelties (always-on shared expert, hybrid SSM/sparse attention, hyper-connections) all sit on the resident side of the seam — invisible to streaming. The 51B `per_layer_token_embd` n-gram table (~28.8 GB at IQ4_NL) is not indexed by expert, so the streamer doesn't bind it. Also introduces the `hold_back_oversized()` logic (see commit 3) and the `inspect-hf-moe-release.py` script.

**`f24bd5a` What it does:**

Adds a Q2_K build of Qwen3.8-Flash-Next to the app catalog. This is a plain `llama-quantize` build *without* an importance matrix — coarser experts, but dense side at 2-4 bit (2.4 GB pinned instead of 4.3 GB). The ~500 MiB saved goes to the expert cache.

**Do they run Q2_K on ARM WITHOUT repack?**

**YES.** There is zero reference to repack, NEON, or any ARM-specific kernel in either commit or any of the 31 upstream commits. The Q2_K build is a standard llama.cpp quantization running through the normal `llama_decode` path. Their "3.48 tok/s" (Q2_K on Qwen3.8-Flash-Next) is measured on a 12 GB Android phone with standard llama.cpp dequant — **no repack kernels**.

This is our *exact* value case: on a device where the expert cache evicts (residency < working set), their Q2_K runs at 3.48 tok/s with standard dequant, while our repack kernels deliver 6.6× residency improvement. The gap is the value of our ARM NEON repack for q2_K/q3_K.

**Relevance to our lanes:**

| Lane | Relevance | Notes |
|---|---|---|
| NEON repack kernels | **HIGH (confirmation)** | Confirms our value proposition: they run Q2_K without repack at 3.48 tok/s; our repack delivers 6.6× residency |
| qwen4exp support | MEDIUM | We should support this architecture in our fork |
| Governor | LOW | Architecture addition, no policy change |

**Verdict: IDEA (architecture registry row)** — The `qwen4exp` registry row is trivial to port (one line in arch_registry). The `inspect-hf-moe-release.py` script is useful tooling. The Q2_K numbers confirm our repack kernel's value proposition. No cherry-pick needed — just add the architecture string to our registry.

---

### 6. `039b8f1` + `7a8abcd` — Telemetry: Prefill-Phase Attribution + Critical-Path Stall Attribution

**`039b8f1` — Prefill-Phase Attribution:**

Adds `PrefillTally` struct that pins the source's cumulative counters *before* the prompt chunk loop and closes deltas *after* it, producing:
- `prefill_cpu_s` — process CPU over prefill (upper bound on compute-thread time)
- `prefill_read_mib` — delta of `read_bytes` across prefill chunks
- `prefill_io_s` — delta of `read_seconds` (summed lane busy time)
- `prefill_stall_s` — delta of `stall_seconds`
- `prefill_mgmt_s` — delta of `mgmt_seconds`

These ride both `BMOE_DONE` JSON and the CSV `# summary` trailer. The decode baseline seeds from `prefill_tally.post` instead of a separate snapshot, eliminating drift at the phase boundary.

Key insight: "Before #169-style attribution existed prefill was a single bare wall number (`prefill_s`) with no compute/flash split at all."

**`7a8abcd` — Critical-Path Stall Attribution:**

Replaces the per-thread stall sum / n_threads mean with a `StallUnion` — the cumulative wall time during which *at least one* compute thread was blocked. New `stall_union.h` (100 lines) implements an interval-union state machine with mutex + monotonic clock:

```cpp
// stall_union.h
void enter() { lock(); state_.enter_at(steady_ns()); }  // 0→1 opens interval
void exit()  { lock(); state_.exit_at(steady_ns()); }   // 1→0 closes + accumulates
long long total_ns() const { lock(); return state_.total_at(steady_ns()); } // includes open interval
```

The app panel now draws **four bars**: compute (process CPU / compute threads), flash wait (measured stall), cache mgmt, and **unattributed** (the off-CPU wall time the old residual absorbed as "compute").

Breaking change: `stall_ms` / `stall_s_tok` changed meaning — not comparable with older CSVs.

**Relevance to our lanes:**

| Lane | Relevance | Notes |
|---|---|---|
| Bench harness | **HIGH** | The `PrefillTally` pattern (pin counters before phase, close after, seed next phase from closing sample) is directly applicable to our bench harness |
| Governor | **HIGH** | StallUnion gives the governor a true critical-path stall signal — not a per-thread mean that underestimates. This is what our tri-engine governor needs for the I/O vs compute decision |
| All platforms | MEDIUM | Methodology is platform-agnostic |

**Verdict: IDEA** — The methodology is worth copying:
1. **PrefillTally pattern**: Pin cumulative counters at phase boundaries, close deltas, seed next phase from closing sample. Portable, no platform deps.
2. **StallUnion**: Interval-union state machine for critical-path stall. The pure arithmetic (no locking) in `StallUnionState` is testable and the mutex wrapper is clean.
3. **Four-bar attribution**: Compute (measured CPU proxy) / flash wait (measured stall) / cache mgmt / unattributed (honest remainder). Better than pretending the residual is compute.

Both are pure C++ with no dependencies on their specific streaming architecture. Worth designing into our bench harness.

---

## Remaining ~25 Commits — One-Line Triage

| SHA | Subject | Verdict | Notes |
|---|---|---|---|
| `92a1114` | bench-report: model size + storage probe | SKIP | Script fix, no engine change |
| `d574186` | README architecture clarification | SKIP | Docs typo |
| `557c63d` | Label hero clip | SKIP | Asset metadata |
| `33b9fcf` | Refresh hero, 3.48 tok/s on Q2_K | SKIP | Docs/assets |
| `ea23f98` | Sharded catalog entry on-device check | SKIP | App logic fix, minor |
| `4c02169` | Tell contributors to check mode line | SKIP | Docs |
| `d754dfd` | Windows exe double-click survival | SKIP | Windows-specific |
| `f3a17f5` | README qwen4 paragraphs | SKIP | Docs |
| `f78c344` | Trendshift badge | SKIP | Badge |
| `77476dc` | Name app settings for in-app rows | SKIP | Docs |
| `d9381f6` | Benchmark pages as contributor guide | IDEA | Community bench methodology worth reading |
| `2c73fb3` | Changelog: Qwen3.8 numbers | SKIP | Docs |
| `f9371b4` | CI: prebuilt bmoe-cli releases | SKIP | CI infra |
| `ecd7b56` | Community benchmarks protocol | IDEA | One-command host bench protocol, worth studying |
| `7ad04fa` | Name cache_cycle_mb in metrics view | SKIP | App UI fix |
| `0f193d3` | Warn on cache budget < one token cycle | IDEA | Guard we should add to our governor |
| `47c84fe` | Mark scripts executable | SKIP | chmod |
| `6f9cce7` | Report version the release cut | SKIP | Build fix |
| `2d4f2b1` | Ling 3.0 (bailingmoe3) support | SKIP | New arch, registry row only |
| `8c8c8f1` | Pin CI actions to SHA | SKIP | Security CI |
| `2b2f095` | Docs: correct macOS status | SKIP | Docs follow-up to e02b477 |
| `40b7882` | CI: macOS host target on PRs | SKIP | CI follow-up to e02b477 |
| `674e7dc` | CLI mode line + cache auto default | IDEA | UX insight: `--moe-stream` should default cache to auto |

**Substance in the noise:** `ecd7b56` (community bench protocol), `0f193d3` (cache budget warning), and `674e7dc` (cache auto default) have small but real ideas worth noting.

---

## Ranked TAKE List

| # | SHA | What | Our Lane | Port Effort | Conflict Risk |
|---|---|---|---|---|---|
| 1 | `e02b477` | `F_NOCACHE` uncached reads + `aligned_reads_` decoupling + outcome-based `o_direct` telemetry | **iOS/macOS** | **S** | LOW — IO layer is isolated; our fork doesn't modify it |
| 2 | `927e2d3` (arch_registry.cpp only) | `qwen4exp` architecture string + registry row | **All lanes** | **S** | LOW — one line in registry + submodule pin |
| 3 | `2a7efae` (hold_back_oversized + vm_advise_random) | MemAvailable admission + `MADV_RANDOM` for oversized dense tensors | **iOS/macOS, CPU** | **S** | LOW — dense_weights.cpp changes are isolated |
| 4 | `039b8f1` (PrefillTally pattern only) | Prefill-phase attribution methodology | **Bench harness** | **S** | LOW — new struct + session.cpp insertion point |
| 5 | `7a8abcd` (StallUnion only) | Critical-path stall attribution (interval union) | **Governor, bench** | **M** | MEDIUM — touches expert_stream_source.h/cpp, app Telemetry.kt |
| 6 | `9153dcc` (IRowSource interface + classification only) | Row-gathered dense tables from flash | **CPU, governor** | **M** | MEDIUM — deep integration with dense_weights + router_hook |
| 7 | `4334c89` (substitute concept only) | Cache-aware expert substitution | **Governor** | **L** | HIGH — tightly coupled to their RouterHook + IExpertSource API; concept is portable, code is not |

**Notes on TAKE list:**
- Items 1-3 are the most portable (IO layer, architecture registry, dense weight admission) with minimal conflict risk
- Items 4-5 are methodology/design patterns we adopt, not code we cherry-pick
- Item 6 (row-streaming) needs our own `IRowSource` implementation but the interface and classification logic are the template
- Item 7 (substitution) is pure IDEA — the code is deeply coupled to their streaming architecture, but the *concept* (boost resident experts by λ × score range, re-rank) is a governor knob

---

## IDEAS List (Concepts Worth Stealing, Code Not Portable)

1. **Cache-aware substitution (4334c89)**: Before committing routing, boost resident expert scores by λ × token score range, re-rank. A resident near-tie displaces a flash-bound winner without eviction. The λ parameter maps to a governor knob. The `--ppl` quality measurement methodology (teacher-forced, decode-regime stepping, policy-reported) is the right way to price lossy routing changes.

2. **Row-gathered dense tables (9153dcc)**: The capture-time classification (every reference must be `GET_ROWS` with materialized index) is an elegant, architecture-agnostic rule. The 500 MiB of dense-set reduction directly feeds our expert cache budget.

3. **MADV_RANDOM for oversized dense tensors (2a7efae)**: Default readahead (hundreds of KiB per fault) is wrong by 2 orders of magnitude for a table gathered a few rows per token. `MADV_RANDOM` makes each fault map one page. Applicable to our iOS/macOS mmap'd dense weights.

4. **StallUnion critical-path attribution (7a8abcd)**: The interval-union state machine gives a true "graph was blocked" signal. The per-thread sum / n_threads mean was silently undercounting and dumping the difference into "compute". Our governor needs this signal.

5. **PrefillTally pattern (039b8f1)**: Pin cumulative counters at phase boundaries, close deltas, seed next phase from closing sample. The decode baseline from `prefill_tally.post` eliminates snapshot drift at the phase boundary.

6. **Cache budget warning (0f193d3)**: Warn when cache < one expert cycle. Simple guard our governor should have.

7. **`--moe-stream` defaults cache to auto (674e7dc)**: UX insight — a first-time user who just types `--moe-stream` gets no cache (budget=0), which re-reads every expert from flash every token. Defaulting to `auto` is the right UX. Our CLI should do the same.

8. **Community bench protocol (ecd7b56)**: One-command host benchmark with standardized output. Worth studying for our bench harness.

---

*Paper only. No cherry-picks applied.*
