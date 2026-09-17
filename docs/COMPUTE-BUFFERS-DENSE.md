# Compute buffers, the 512 MiB forfait, and the fit facility

Date: 2026-09-17 · Machine: Apple M1 Max, 64 GiB unified · Binary:
`runtime/builds/metal/llama-b10950` (commit `ad6c66839`, **not present in the
worktree history**; source quotes are from `~/Projects/kalsallama-wt-upstream`
at HEAD `64a155d24` — every behavioural claim below was verified against the
shipped binary, not the worktree).

The original question — does 512 MiB hold for a large **dense** model — is
still open: ollama's `qwen3.5:4b` blob turned out to be (a) unloadable by
b10950 (`key qwen35.rope.dimension_sections has wrong array length; expected
4, got 3`) and (b) not dense at all (`qwen35.attention.head_count_kv =
[0, 0, 0, 4, …]` over 32 blocks — only every 4th layer holds a KV cache, plus
a vision tower). No dense model was downloaded. This document answers the
question that failure raised: **the binary already ships a facility that
measures a model's real footprint — `llama-fit-params` — can it replace the
512 MiB forfait, or the budget arithmetic that carries it?**

Our forfait, for reference — `crates/kalsa-catalog/src/footprint.rs:32-39`:

```rust
/// The compute buffers (the micro-batch's attention and FFN intermediates):
/// they follow the batch, not the model, which is the naive formula's first
/// mistake. Measured on the shipped build with the shipped Trinity row at
/// the shipped ubatch 512, the allocator reports ~60 MiB where the weights
/// are ~4 GiB; the forfait stays 512 MiB on purpose, because a large dense
/// row's buffers cost more than an MoE's and the point of a forfait is to
/// stop the arithmetic from chasing per-model measurements.
pub const COMPUTE_BUFFER_BYTES: u64 = 512 * MIB;
```

---

## 1. What the fit actually accounts for

**It does not model memory — it builds the real thing and reads the bill.**
`common/fit.cpp:55-65`:

```cpp
    llama_model_params mparams_copy = *mparams;
    mparams_copy.no_alloc  = true;
    mparams_copy.load_mode = LLAMA_LOAD_MODE_NONE;

    llama_model * model = llama_model_load_from_file(path_model, mparams_copy);
    ...
    llama_context * ctx = llama_init_from_model(model, *cparams);
```

Weights (tensor layout, not data — `no_alloc`), **KV cache and compute
buffers are all real allocations of a real context**, summed per device from
the context's own memory breakdown (`fit.cpp:75-97`):

```cpp
    llama_memory_breakdown memory_breakdown = llama_get_memory_breakdown(ctx);

    for (const auto & [buft, mb] : memory_breakdown) {
        ...
        ret[i].mb.model   += mb.model;
        ret[i].mb.context += mb.context;
        ret[i].mb.compute += mb.compute;
```

The compute figure is the scheduler's graph reserve — the same
`sched_reserve: … compute buffer size` line our own logs quote — so graph
overhead is inside it, not added on top. The binary's own summary on Trinity
(`llama-fit-params -m … -v`, this Mac):

```
common_memory_breakdown_print: |   - MTL0 (Apple M1 Max) | 53084 = 53083 + (5784 =  3494 +    1897 +     393) +       -5784 |
common_params_fit_impl: projected to use 5784 MiB of device memory vs. 53083 MiB of free device memory
common_params_fit_impl: will leave 47299 >= 1024 MiB of free device memory, no changes needed
```

**The safety margin is 1 GiB per device, flat, and configurable**
(`common/common.h:481`, flag `-fitt/--fit-target`):

```cpp
    std::vector<size_t> fit_params_target = std::vector<size_t>(llama_max_devices(), 1024 * 1024*1024);
```

Other knobs: context floor 4096 (`common.h:478`, `-fitc`), context ceiling =
trained context (`fit.cpp:266`):

```cpp
    const uint32_t n_ctx_max       = (uint32_t) std::min<uint64_t>(uint64_t(hp_nct)    * n_streams, UINT32_MAX);
```

and the per-device target each measurement must stay under (`fit.cpp:646-651`):

```cpp
    for (size_t id = 0; id < nd; id++) {
        targets.push_back(dmds_full[id].free - margins[id]);
```

If everything fits it changes nothing and returns early (`fit.cpp:352-355`:
"will leave … >= … MiB of free device memory, no changes needed"); otherwise
it shrinks the context by **linear interpolation between two real
measurements** (`fit.cpp:423-429`), then drops whole layers (or partial
layer fractions for MoE) back-to-front, re-measuring each trial configuration
for real. The header states the boundary of the whole facility
(`common/fit.h:24`):

```cpp
// fits mparams and cparams to free device memory (assumes system memory is unlimited)
```

So, plainly: **weights, KV, and compute buffers ARE in the fit** — measured,
not estimated. What is *not* in the fit: any budget for host/system memory
once a GPU is present, any reserve beyond the flat 1 GiB, and any notion of
*should this model run at all*.

## 2. Does it read the per-layer KV structure?

**The fit reads none of it — and that is why it is right.** `fit.cpp:139-144`
is the complete list of model attributes the fit itself consumes:

```cpp
    hp_ngl         = llama_model_n_layer(model);
    ...
    hp_n_ctx_train = llama_model_n_ctx_train(model);
    hp_n_expert    = llama_model_n_expert(model);
```

There is no `head_count_kv`, no `n_swa`, no `full_attention_interval` in
`fit.cpp`. The structure enters through the back door: the context it builds
is the *real* context, and the real KV cache is sized **per layer** from the
model's hyperparameters — `src/llama-kv-cache.cpp:209-210, 226-227`:

```cpp
        const uint32_t n_embd_k_gqa =            hparams.n_embd_k_gqa(il);
        const uint32_t n_embd_v_gqa = !v_trans ? hparams.n_embd_v_gqa(il) : hparams.n_embd_v_gqa_max();
        ...
        ggml_tensor * k = has_k ? ggml_new_tensor_3d(ctx, type_k, n_embd_k_gqa, kv_size, n_stream) : nullptr;
```

`n_embd_k_gqa(il)` is `n_head_kv(il) × head_dim` from the per-layer
`head_count_kv` **array** — a linear-attention layer with 0 KV heads is a
zero-width tensor, i.e. billed nothing. SWA models get the split cache
(`src/llama-model.cpp` instantiates `llama_kv_cache_iswa`), and
`full_attention_interval` is consumed where it belongs, in the arch loader —
`src/models/qwen35.cpp:19`:

```cpp
        ml.get_key(LLM_KV_FULL_ATTENTION_INTERVAL, full_attn_interval, false);
```

Verified on the shipped binary, Trinity (`llama-fit-params -m … -v`) — the
fit's measured KV **is** the iswa structure, 14 full-window layers + 42 SWA
layers, not 56 flat layers:

```
llama_context: flash_attn            = auto
llama_kv_cache_iswa: creating non-SWA KV cache, size = 131072 cells
llama_kv_cache: size = 1792.00 MiB (131072 cells,  14 layers,  1/1 seqs), K (f16):  896.00 MiB, V (f16):  896.00 MiB
llama_kv_cache_iswa: creating     SWA KV cache, size = 2560 cells
llama_kv_cache: size =  105.00 MiB ( 2560 cells,  42 layers,  1/1 seqs), K (f16):  52.50 MiB, V (f16):  52.50 MiB
```

Answer: **it does not assume every layer holds a full KV cache. It assumes
nothing — it bills the cache the model's own builder constructs.** The same
mechanism would handle qwen3.5's 8-of-32 hybrid correctly.

## 3. Side by side on Trinity — the one large model on disk

Same file
(`runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf`), same machine, same day.
Our side is the real `plan()` — run through the `kalsa-launch` lib test
`every_shipped_plan_keeps_the_whole_reservation_inside_the_budget`
(`cargo test --locked -p kalsa-launch --lib … -- --nocapture`, exit 0):

```
Arcee Trinity Nano           64 GiB | ctx  414767 | roof  6144 MiB
```

| | our policy (`plan()`, 64 GiB Metal tier) | `llama-fit-params` (b10950) | our app path (`llama-server`, our argv) |
|---|---|---|---|
| budget it sees | `usable = 64 GiB − max(3 GiB, 25%) = 48 GiB` | live free 53083 MiB − 1024 MiB margin | whatever is free at boot |
| context it funds | **414 767** tokens | **131 072** (= `n_ctx_train`, capped) | 16 384 (what we pass) |
| KV it accounts | assumed 96 KiB/token → **38.9 GiB** at funded ctx | measured: 1897 MiB f16 / **1007 MiB at q8_0** at 128k | measured **174.78 MiB** at 16k q8_0 |
| compute buffers | forfait **512 MiB** | measured **393 MiB MTL0 + 269 MiB Host** | measured **53.43 + 22.68×2 MiB** |
| offload | all-or-nothing (`Offload::All`) | `-ngl -1`, would split layers if needed | `-ngl all` |
| can say no | yes — `plan()` returns `None` | **no** — degrades ctx toward 4096 | — |

The app-path compute lines, from the b10950 `llama-server` booted for ~20 s
on 127.0.0.1:8197 with the policy argv and killed (exit 0, confirmed stopped)
— identical to the morning `llama-cli` numbers:

```
llama_context: n_outputs_max         = 1
llama_kv_cache: size =  119.00 MiB ( 16384 cells,  14 layers,  1/1 seqs), K (q8_0):   59.50 MiB, V (q8_0):   59.50 MiB
llama_kv_cache: size =   55.78 MiB ( 2560 cells,  42 layers,  1/1 seqs), K (q8_0):   27.89 MiB, V (q8_0):   27.89 MiB
sched_reserve:       MTL0 compute buffer size =    53.43 MiB
sched_reserve:        CPU compute buffer size =    22.68 MiB
```

**Where they disagree, and who is right:**

1. **KV cost — the fit is right.** Trinity's row carries no measurement
   (`kv_bytes_per_token: None`, `manifest.rs:551`), so our arithmetic assumes
   96 KiB/token; the measured iswa cache is ~11 KiB/token at 16k and ~8
   KiB/token at 128k (q8_0), sub-linear because only 14 layers keep growing.
   We over-reserve Trinity's KV by roughly 12×. Direction is conservative —
   context smaller than fundable — and `footprint.rs:46-50` says so out loud.
   But it is a guess where the binary hands us a measurement.
2. **Context cap — the fit is right, by our own admission.** It caps at
   `n_ctx_train` (131072); we fund 414 767 for a 131k-trained model. Our own
   comment, `policy.rs:79-80`: *"a context ten times the model's training
   length is funded arithmetic, not memory anyone's conversation reaches."*
3. **Compute — the standalone tool's number is not our number.** The tool
   measured 393 MiB at *both* 16k and 128k; the server measured 53.43 at 16k.
   The cause is a context-param difference, not accounting: the tool's
   context runs `n_outputs_max = 2048` (its default, `common.h:457`
   `0 = n_batch`) where our path runs `n_outputs_max = 1` — log lines quoted
   above from both. 7.4× skew, conservative direction, and **no CLI flag
   exposes `n_outputs_max`** — "ask the binary" only works if the asking
   replicates the exact launch shape.
4. **Margin philosophy — different, not wrong.** 1 GiB flat vs our
   `max(3 GiB, 25%)`. On this machine they land within 2 GiB of each other;
   on an 8 GiB Windows machine the 1 GiB default would be reckless — we
   would have to own the margin anyway.

## 4. Verdict

**The 512 MiB forfait can be replaced by asking the binary — as a
measurement, not as the decider.** `llama-fit-params --fit-print on` with the
app's exact flags (FA, cache types, ubatch/batch, parallel — everything
except `n_outputs_max`, which is not askable and must be remembered) returns
the real per-device model/context/compute split; per-model measurements from
it would retire both `COMPUTE_BUFFER_BYTES` and the 96 KiB KV assumption,
which is exactly the honest fix `footprint.rs` and `policy.rs` keep saying
they want. Note also that **the fit already runs inside every server we
start** (`common.cpp:1295`, on by default, `common.h:476`) — with our argv it
is a no-op today, but its breakdown could be read from our own startup logs
and reconciled against the budget at zero extra cost.

**What asking the binary would NOT cover** — Marco's three, then four more:

1. It fits to free memory *at this instant* (on unified memory, 53083 MiB
   "free" includes what the OS may want back; the number moves every run).
2. It knows nothing about heat and power.
3. It has no idea one machine is divided between several people.
4. **Host memory is un-budgeted once a GPU is present** — `fit.h:24`,
   *"assumes system memory is unlimited"*. Our 3 GiB floor / 25 % OS margin
   has no equivalent; on a small machine the fit would spend everything.
5. **It cannot refuse.** It degrades silently — context down to 4096, layers
   to CPU — so every model "fits" somewhere. `policy.rs:36-38` (*"a model
   that cannot be given even one token of context must not be started
   smaller, it must not be started"*) and the refusal tests have no
   equivalent in the facility.
6. **No prompt-cache concept** — the roof that keeps yesterday's chat warm
   (`policy.rs:119-139`) would be competed away by a bigger context.
7. **Offload policy is out of scope** — the fit will happily emit partial
   layer splits (`-ts`, `-ot`), and our own measurement says the split is the
   worst option (`policy.rs:149-151`: split 2.15× slower than plain CPU).
8. **Auditability and cost** — catalog figures are committed, reviewable
   data; a live fit varies with machine state and build, and each fit costs
   seconds of real context creation per candidate model.

And the original dense question stands: this facility **measures**, it does
not extrapolate — the 14 B-class dense row remains a prediction-shaped hole
until a dense model is actually loaded.

---

### Appendix — commands and exit codes (all logs in `/tmp/cbdense/`)

```
llama-fit-params -m TRINITY                          → exit 0, "-c 131072 -ngl -1"
llama-fit-params -m TRINITY -fitp on                 → exit 0, "MTL0 3494 1897 393 / Host 109 0 269"
llama-fit-params -m TRINITY -fitp on -fa on -ctk q8_0 -ctv q8_0
                                                     → exit 0, "MTL0 3494 1007 393 / Host 109 0 269"
llama-fit-params -m TRINITY -fitp on -fa on -ctk q8_0 -ctv q8_0 -c 16384
                                                     → exit 0, "MTL0 3494 174 393 / Host 109 0 45"
cargo test --locked -p kalsa-launch --lib every_shipped_plan -- --nocapture
                                                     → exit 0
llama-server -m TRINITY … --port 8197 (≈20 s, killed) → exit 0, stopped & verified
```

No server left running; ports 8199/65015/11434 untouched; the ollama process
was not started, stopped, or contacted; no downloads.

## 5. The scalar is the wrong shape — checked against this morning's own numbers

Added after re-verifying the report. `common/fit.h:24` reads, verbatim:

```c
// fits mparams and cparams to free device memory (assumes system memory is unlimited)
```

and our two constants are where the report says they are:

```rust
// crates/kalsa-catalog/src/footprint.rs:39
pub const COMPUTE_BUFFER_BYTES: u64 = 512 * MIB;
// crates/kalsa-catalog/src/footprint.rs:51
pub const ASSUMED_KV_BYTES_PER_TOKEN: u64 = 96 * KIB;
```

The 96 KiB is derived honestly for a **flat** model — "eight KV heads of 128 dimensions,
one byte each, forty-eight layers". Two tensors × 8 × 128 × 48 = 98 304 bytes. The
arithmetic is right; the shape it assumes is what fails.

Put this morning's server-verified figure next to the fit's, both for Trinity:

| context | KV total | bytes/token |
|---|---|---|
| 16 384 (measured here at 09:40, `llama-cli -v`) | 174.78 MiB | 11 186 (10.9 KiB) |
| 131 072 (the fit) | 1007 MiB | 8 062 (7.9 KiB) |

Those two are not two measurements of one constant — they are two points on a line with
an intercept. The 14 global layers scale with context (119.00 MiB at 16k → ×8 → 952 MiB
at 128k); the 42 sliding-window layers hold 2560 cells and **never grow** (55.78 MiB at
both). 952 + 55.78 = 1007.8, which is the fit's number to within rounding. So:

```
KV(n) ≈ 55.78 MiB + n × 7.26 KiB      for this model
```

**Per-token KV cost is not a constant for this architecture — it falls as the context
grows.** `ModelEntry::kv_bytes_per_token`, a scalar, cannot express that: pick the 16k
figure and you over-charge every long context; pick the 128k figure and you under-charge
every short one. And the assumed 96 KiB over-charges this row by **8.8× at 16k and 12.2×
at 128k** — the error is not even a fixed multiple.

Three architectures in two days have each broken the flat assumption differently:
Trinity is sliding-window (14 full layers of 56), Qwen 3.5 is hybrid linear attention
(8 KV layers of 32, plus a vision tower), and the catalog's own comment already concedes
one row the constant under-counts. The fix is therefore not a better constant and not a
fitted formula from two models: it is to read `block_count`, the per-layer
`head_count_kv` array, `full_attention_interval`, `key_length` and `value_length` out of
the GGUF — every one of which the loader already prints — or to ask the binary, as §4
concludes, and keep our own policy as the one that decides.

What is still owed, unchanged: the 512 MiB compute figure on a genuinely dense row. The
fit's 393 MiB for Trinity is not comparable to our server-verified 53.43 MiB, because
the standalone tool reserves for many more outputs than our path ever asks for.

## 6. The dense row, at last — and it is not flat either

This section pays the debt §5 names. 2026-09-17, the same M1 Max, the shipped b10950
binary; every number below is a real log line from `/tmp/cbdense/gemma/`.

**The pin.** The research record's only dense row of the right class is Google Gemma
4 12B (`CATALOG`, apache-2.0 since the 2026-07-20 research pass). Google's own repo
ships safetensors only; the GGUF used is the community standard quantisation:
`bartowski/gemma-4-12B-it-GGUF` at commit
`2ae7d41be21ca62de00a2d320ee9cec50daa3aa6`, file `gemma-4-12B-it-Q4_K_M.gguf`, pinned
from the response headers of the resolve URL (not the model card):

```
x-linked-size: 7662533088
x-linked-etag: "3962624dcd25b947d889dc9ae1bf275b61db6cd4dbe694057f34fffef1671509"
```

Licence from the repo's own README front matter — `license: apache-2.0` (its
`license_link` points at Google's gemma_4_license page), `gated: False` in the API.
Downloaded to `runtime/models/`: curl exit 0, exactly 7 662 533 088 bytes, and
`shasum -a 256` = the etag above. The digest matched before anything touched the file.

**The shape check fails — again.** Dense in parameters (`n_expert = 0`, all 11.91 B
active — the loader and llama-bench agree), but the attention is hybrid sliding-window:

```
llama_model_loader: - kv  16:   gemma4.block_count u32 = 48
llama_model_loader: - kv  21:   gemma4.attention.head_count_kv arr[i32,48] = [8, 8, 8, 8, 8, 1, 8, 8, 8, 8, 8, 1, ...
llama_model_loader: - kv  25:   gemma4.attention.key_length u32 = 512
llama_model_loader: - kv  32:   gemma4.attention.key_length_swa u32 = 256
print_info: n_embd = 3840 · n_layer = 48 · n_head = 16 · n_expert = 0
llama_kv_cache_iswa: creating non-SWA KV cache, size = 16384 cells
llama_kv_cache: size =  136.00 MiB ( 16384 cells,   8 layers,  1/1 seqs), K (q8_0):   68.00 MiB, V (q8_0):   68.00 MiB
llama_kv_cache_iswa: creating     SWA KV cache, size = 1536 cells
llama_kv_cache: size =  255.00 MiB ( 1536 cells,  40 layers,  1/1 seqs), K (q8_0):  127.50 MiB, V (q8_0):  127.50 MiB
```

Eight full-attention layers of 48 (one per `[8, 8, 8, 8, 8, 1]` group), forty SWA
layers. **Third architecture in a row that is not the flat thing the forfait was
written for.** A truly flat dense GGUF (every layer full-window) is still missing from
disk and from the table; what this row measures is the shipped class: dense-parameter,
hybrid-attention.

**The measurement.** `llama-cli -ngl 999 -fa on -ctk q8_0 -ctv q8_0 -b 2048`, the
app-path context shape (`n_outputs_max = 1`), six runs, all exit 0:

| ubatch | context | MTL0 compute | CPU compute (printed twice — see below) | total (printed lines) | with both CPU lines |
|---:|---:|---:|---|---:|---:|
| 512 | 4096 | 127.80 MiB | 21.80 MiB | 149.6 MiB | 171.4 MiB |
| 512 | 16384 | 139.80 MiB | 33.80 MiB | 173.6 MiB | 207.4 MiB |
| 1024 | 4096 | 255.32 MiB | 43.32 MiB | 298.6 MiB | 342.0 MiB |
| 1024 | 16384 | 279.32 MiB | 67.32 MiB | 346.6 MiB | 414.0 MiB |
| 2048 | 4096 | 513.35 MiB | 89.36 MiB | 602.7 MiB | 692.1 MiB |
| 2048 | 16384 | 561.35 MiB | 137.36 MiB | 698.7 MiB | 836.1 MiB |

Quoted raw, ubatch 512 / context 16384:

```
sched_reserve:       MTL0 compute buffer size =   139.80 MiB
sched_reserve:        CPU compute buffer size =    33.80 MiB
sched_reserve:        CPU compute buffer size =    33.80 MiB
```

A discovery the earlier logs hid by truncation: **the binary builds two identical
contexts** — llama-cli and llama-server alike (two `constructing llama_context` blocks
in the same process, this build) — so each reserve appears twice. Whether both stay
resident is not settled from the logs; a live-process probe (server booted at
ubatch 512 vs 2048, killed after, RSS 7.65 GiB vs 7.95 GiB) shows the ubatch step
costing ~310 MiB of resident memory — directionally the reserve, but RSS under-tracks
untouched Metal pages, so the `sched_reserve` lines remain the citation convention.
Verdicts below hold under every counting.

**The answers.**

1. **512 MiB holds at ubatch 512.** Margin: 338.4 MiB at 16k context (2.95×) by the
   printed-line convention, 304.6 MiB (2.47×) counting both CPU lines.
2. **The margin moves with context** — 362.4 MiB at 4096 → 338.4 MiB at 16384, i.e.
   the compute reserve grows ~2 KiB per token of context even with flash attention
   on. Affine, not constant — §5's finding confirmed on the new row.
3. **The largest ubatch under the forfait is 1024** (346.6–414.0 MiB at 16k, margin
   ≥ 98 MiB). **2048 breaches at both contexts** — 602.7 MiB at 4096 already, and its
   MTL0 line alone (561.35) exceeds the forfait. The ~10 % prefill gain of ubatch
   2048 is not affordable under today's budget on this class of model. Side cost:
   raising ubatch also raises the SWA cache's cell count — the log shows 1536 / 2048 /
   3072 cells for ubatch 512 / 1024 / 2048 (cells = n_swa 1024 + ubatch), so the KV
   grows 255 → 510 MiB too.
4. **Per-token KV is not flat here either**: 70.6 KiB/token average at 4096, 23.9 at
   16384 (q8_0) — the SWA part saturates, only 8 layers keep growing. The row
   therefore carries `kv_bytes_per_token: None` like Trinity: no single figure is
   honest. At the contexts the chooser funds (≥ 4096) the 96 KiB assumption
   over-counts, the safe direction.

The row moved to `DOWNLOADABLE` with the pin, the measured decode (20.44 tok/s, tg128,
Metal, q8_0 KV, flash-attention, context 512 — pp512 231.06, llama-bench, 2 reps), and
the cache caveat in a comment; the two table-content tests were extended with it, and
the filtered invariant tests pass (5 across two runs). Through the real `plan()`:
`Google Gemma 4 12B  64 GiB | ctx  375343 | roof  6144 MiB`.
